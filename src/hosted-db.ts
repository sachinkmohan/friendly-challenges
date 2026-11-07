import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { sqlStatements } from './statements.ts'

const dbDir = join(dirname(fileURLToPath(import.meta.url)), '../db')

export type Database = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
  exec(text: string): Promise<void>
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export function openPostgres(databaseUrl: string): Database {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 })
  pool.on('error', (error: unknown) => {
    console.error(error)
  })
  return {
    query: async (text, params) => {
      const result = params === undefined ? await pool.query(text) : await pool.query(text, params)
      return { rows: result.rows }
    },
    exec: (text) => runStatements(pool, text),
    transaction: async (fn) => {
      const client = await pool.connect()
      const tx = clientDatabase(client)
      try {
        await client.query('BEGIN')
        const value = await fn(tx)
        await client.query('COMMIT')
        return value
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

function clientDatabase(client: pg.PoolClient): Database {
  const database: Database = {
    query: async (text, params) => {
      const result = params === undefined ? await client.query(text) : await client.query(text, params)
      return { rows: result.rows }
    },
    exec: (text) => runStatements(client, text),
    transaction: (fn) => fn(database),
    close: async () => {},
  }
  return database
}

export async function prepareDatabase(db: Database): Promise<void> {
  const names = readdirSync(dbDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const ordered = [...names.filter((name) => name !== 'sample.sql'), ...names.filter((name) => name === 'sample.sql')]
  for (const name of ordered) await db.exec(readFileSync(join(dbDir, name), 'utf8'))
}

async function runStatements(runner: { query: (text: string) => Promise<unknown> }, text: string): Promise<void> {
  for (const statement of sqlStatements(text)) await runner.query(statement)
}

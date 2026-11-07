import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import pg from 'pg'
import { sqlStatements } from './statements.ts'

const dbDir = join(dirname(fileURLToPath(import.meta.url)), '../db')

export type Database = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
  exec(text: string): Promise<void>
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>
  close(): Promise<void>
}

function schemaNames(): string[] {
  return readdirSync(dbDir)
    .filter((name) => name.endsWith('.sql') && name !== 'sample.sql')
    .sort()
}

async function applySchema(db: Database): Promise<void> {
  for (const name of schemaNames()) {
    await db.exec(readFileSync(join(dbDir, name), 'utf8'))
  }
}

export async function loadSample(db: Database): Promise<void> {
  await db.exec(readFileSync(join(dbDir, 'sample.sql'), 'utf8'))
}

export async function openDatabase(dataDir?: string): Promise<Database> {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? ''
  if (databaseUrl !== '') {
    const db = openPostgres(databaseUrl)
    await applySchema(db)
    return db
  }
  const db = dataDir ? new PGlite(dataDir) : new PGlite()
  await db.waitReady
  const wrapped = fromPglite(db)
  await applySchema(wrapped)
  return wrapped
}

function fromPglite(db: PGlite): Database {
  return {
    query: (text, params) => db.query(text, params),
    exec: async (text) => {
      await db.exec(text)
    },
    transaction: (fn) => db.transaction((tx) => fn(fromTransaction(tx))),
    close: () => db.close(),
  }
}

function fromTransaction(tx: Transaction): Database {
  const database: Database = {
    query: (text, params) => tx.query(text, params),
    exec: async (text) => {
      await tx.exec(text)
    },
    transaction: (fn) => fn(database),
    close: async () => {},
  }
  return database
}

function openPostgres(databaseUrl: string): Database {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 })
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

async function runStatements(runner: { query: (text: string) => Promise<unknown> }, text: string): Promise<void> {
  for (const statement of sqlStatements(text)) await runner.query(statement)
}

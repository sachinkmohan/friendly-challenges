import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations')

export type Database = {
  query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export async function openDatabase(dataDir?: string): Promise<PGlite> {
  const db = dataDir ? new PGlite(dataDir) : new PGlite()
  await db.waitReady
  for (const name of migrationFiles()) {
    await db.exec(readFileSync(join(migrationsDir, name), 'utf8'))
  }
  return db
}

export async function openAppDatabase(dataDir?: string): Promise<Database> {
  const url = process.env.DATABASE_URL?.trim() ?? ''
  if (url !== '') return openPostgres(url)
  return openDatabase(dataDir)
}

function openPostgres(url: string): Database {
  const pool = new pg.Pool({ connectionString: url, max: 5 })
  return {
    async query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const result = await pool.query(query, params as never[] | undefined)
      return { rows: result.rows as T[] }
    },
  }
}

function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

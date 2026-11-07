import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { openPostgres, type Database } from './hosted-db.ts'

const dbDir = join(dirname(fileURLToPath(import.meta.url)), '../db')

export type { Database }

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
  if (databaseUrl !== '') return openPostgres(databaseUrl)
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

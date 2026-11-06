import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '../db/001_accounts.sql')

export async function openDatabase(dataDir?: string): Promise<PGlite> {
  const db = dataDir ? new PGlite(dataDir) : new PGlite()
  await db.waitReady
  await db.exec(readFileSync(schemaPath, 'utf8'))
  return db
}

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const dbDir = join(dirname(fileURLToPath(import.meta.url)), '../db')

export async function openDatabase(dataDir?: string): Promise<PGlite> {
  const db = dataDir ? new PGlite(dataDir) : new PGlite()
  await db.waitReady
  const files = readdirSync(dbDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of files) {
    await db.exec(readFileSync(join(dbDir, name), 'utf8'))
  }
  return db
}

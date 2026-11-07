import { readdir, readFile } from 'node:fs/promises'
import pg from 'pg'
import { sqlStatements } from '../src/statements.ts'

const url = process.env.DATABASE_URL?.trim() ?? ''
const names = (await readdir('db').catch(() => [])).filter((name) => name.endsWith('.sql'))
const files = [...names.filter((name) => name !== 'sample.sql').sort(), 'sample.sql'].filter((name) => names.includes(name))
if (url === '' || files.length === 0) {
  console.log('migrate: nothing to do')
  process.exit(0)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED?.trim() || url })
await client.connect()
try {
  await client.query("set lock_timeout = '60s'")
  await client.query('select pg_advisory_lock(7272741)')
  await client.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  )
  const done = new Set((await client.query('select name from schema_migrations')).rows.map((row) => row.name))
  for (const file of files.filter((name) => !done.has(name))) {
    await client.query('begin')
    try {
      const text = await readFile(`db/${file}`, 'utf8')
      for (const statement of sqlStatements(text)) await client.query(statement)
      await client.query('insert into schema_migrations (name) values ($1)', [file])
      await client.query('commit')
      console.log(`migrate: applied ${file}`)
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  }
} finally {
  await client.end()
}

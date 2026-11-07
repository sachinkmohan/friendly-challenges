import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { sqlStatements } from '../src/statements.ts'

test('schema scripts keep dollar-quoted bodies in one statement', () => {
  const groups = readFileSync(new URL('../db/002_groups.sql', import.meta.url), 'utf8')
  const statements = sqlStatements(groups)
  const body = statements.find((statement) =>
    statement.startsWith('CREATE OR REPLACE FUNCTION memberships_reject_sixth'),
  )
  assert.ok(body?.includes('group_full'))
  assert.ok(body?.includes('RETURN NEW'))
})

test('schema scripts run one statement at a time', async () => {
  const db = new PGlite()
  await db.waitReady
  const dir = new URL('../db/', import.meta.url)
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.sql') && name !== 'sample.sql')
    .sort()
  try {
    for (const name of names) {
      for (const statement of sqlStatements(readFileSync(new URL(name, dir), 'utf8'))) {
        await db.exec(statement)
      }
    }
    const caps = await db.query<{ cap: number; floor: number }>(
      'SELECT active_member_cap() AS cap, challenge_member_floor() AS floor',
    )
    assert.equal(caps.rows[0]?.cap, 5)
    assert.equal(caps.rows[0]?.floor, 3)
  } finally {
    await db.close()
  }
})

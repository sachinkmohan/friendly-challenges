import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { createApp } from '../src/app.ts'
import { readLedger, type Ledger } from '../src/balances.ts'
import { utcToday } from '../src/calendar.ts'
import { parseIsoDate } from '../src/challenge.ts'
import { loadSample, openDatabase, type Database } from '../src/db.ts'
import { parseGroupId, type GroupId } from '../src/groups.ts'
import { createSession } from '../src/sessions.ts'

const sampleSql = readFileSync(new URL('../db/sample.sql', import.meta.url), 'utf8')
const comment = /Expected open debt as of (\d{4}-\d{2}-\d{2}), in minor units: (\d+)/.exec(sampleSql)
if (!comment?.[1] || !comment[2]) throw new Error('sample comment')
const expectedDebt = Number(comment[2])
const asOf = parseIsoDate(comment[1])
if (!asOf || !Number.isSafeInteger(expectedDebt)) throw new Error('sample comment')

function debt(ledger: Ledger | null): number {
  if (!ledger) throw new Error('ledger')
  return ledger.open.reduce((sum, line) => sum + line.amountMinor, 0)
}

function pageDebt(html: string): number {
  return [...html.matchAll(/data-open="[^"]+" data-minor="(\d+)"/g)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  )
}

async function seeded(): Promise<{ db: Database; groupId: GroupId; adaId: string }> {
  const db = await openDatabase()
  await loadSample(db)
  await loadSample(db)
  const group = await db.query<{ id: string }>(`SELECT id::text AS id FROM groups WHERE name = 'Pantry'`)
  const groupId = parseGroupId(group.rows[0]?.id ?? '')
  const ada = await db.query<{ id: string }>(`SELECT id::text AS id FROM users WHERE google_sub = 'sample-ada'`)
  const adaId = ada.rows[0]?.id
  if (!groupId || !adaId) throw new Error('sample rows')
  return { db, groupId, adaId }
}

test('the sample balance matches the figure written next to the seed', async () => {
  const { db, groupId, adaId } = await seeded()
  const app = createApp({
    db,
    config: { clientId: 'client-id', clientSecret: 'client-secret' },
    today: () => asOf,
  })
  const server = createServer((req, res) => {
    void app(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const cookie = `session=${encodeURIComponent(await createSession(db, adaId))}`
  try {
    const ledger = await readLedger(db, groupId, asOf)
    assert.equal(debt(ledger), expectedDebt)
    assert.equal(ledger?.nets.reduce((sum, line) => sum + line.netMinor, 0), 0)
    if (utcToday() >= asOf) {
      assert.equal(debt(await readLedger(db, groupId, utcToday())), expectedDebt)
    }
    const html = await (
      await fetch(`http://127.0.0.1:${port}/groups/${groupId}`, { headers: { cookie } })
    ).text()
    assert.equal(pageDebt(html), expectedDebt)
    assert.match(html, /Pantry/)

    await db.query(
      `UPDATE check_ins SET color = 'green'
       WHERE group_id = $1::uuid AND day = '2026-10-02' AND user_id = $2::uuid`,
      [groupId, adaId],
    )
    assert.notEqual(debt(await readLedger(db, groupId, asOf)), expectedDebt)
    await db.query(
      `UPDATE check_ins SET color = 'red'
       WHERE group_id = $1::uuid AND day = '2026-10-02' AND user_id = $2::uuid`,
      [groupId, adaId],
    )
    assert.equal(debt(await readLedger(db, groupId, asOf)), expectedDebt)

    await db.query(
      `UPDATE memberships SET left_on = '2026-10-01'
       WHERE group_id = $1::uuid AND user_id = (SELECT id FROM users WHERE google_sub = 'sample-cam')`,
      [groupId],
    )
    assert.notEqual(debt(await readLedger(db, groupId, asOf)), expectedDebt)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await db.close()
  }
})

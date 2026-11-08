import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Ledger } from '../src/balances.ts'
import { utcToday } from '../src/calendar.ts'
import { parseIsoDate } from '../src/challenge.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { parseGroupId, type GroupId } from '../src/groups.ts'
import { loadSample, SAMPLE_OPEN_DEBT_MINOR } from '../src/sample.ts'
import { createSession } from '../src/sessions.ts'
import { checkInRef } from '../src/store.ts'
import { closeServer, listen, setLeftOn } from './support/fixtures.ts'
import { readLedger } from './support/reads.ts'

const sampleSource = readFileSync(new URL('../src/sample.ts', import.meta.url), 'utf8')
const comment = /Expected open debt as of (\d{4}-\d{2}-\d{2}), in minor units: (\d+)/.exec(sampleSource)
if (!comment?.[1] || !comment[2]) throw new Error('sample comment')
const expectedDebt = Number(comment[2])
const asOf = parseIsoDate(comment[1])
if (!asOf || expectedDebt !== SAMPLE_OPEN_DEBT_MINOR) throw new Error('sample comment')

function debt(ledger: Ledger | null): number {
  if (ledger?.kind !== 'group') throw new Error('ledger')
  return ledger.open.reduce((sum, line) => sum + line.amountMinor, 0)
}

function pageDebt(html: string): number {
  return [...html.matchAll(/data-open="[^"]+" data-minor="(\d+)"/g)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  )
}

async function seeded(): Promise<{ db: Database; groupId: GroupId; adaId: string }> {
  const db = openTestDatabase()
  await loadSample(db)
  await loadSample(db)
  const groups = await db.collection('groups').where('name', '==', 'Pantry').get()
  const groupId = parseGroupId(groups.docs[0]?.id ?? '')
  const ada = await db.collection('googleSubs').doc('sample-ada').get()
  const adaId = ada.data()?.userId
  if (groups.size !== 1 || !groupId || typeof adaId !== 'string') throw new Error('sample documents')
  return { db, groupId, adaId }
}

test('the sample balance matches the figure written next to the seed', async () => {
  const { db, groupId, adaId } = await seeded()
  const { server, base } = await listen(db, { today: () => asOf })
  const cookie = `session=${encodeURIComponent(await createSession(db, adaId))}`
  try {
    const ledger = await readLedger(db, groupId, asOf)
    assert.equal(debt(ledger), expectedDebt)
    assert.equal(ledger?.kind === 'group' && ledger.nets.reduce((sum, line) => sum + line.netMinor, 0), 0)
    if (utcToday() >= asOf) {
      assert.equal(debt(await readLedger(db, groupId, utcToday())), expectedDebt)
    }
    const html = await (await fetch(`${base}/groups/${groupId}`, { headers: { cookie } })).text()
    assert.equal(pageDebt(html), expectedDebt)
    assert.match(html, /Pantry/)

    const adaMiss = checkInRef(db, groupId, adaId, '2026-10-02')
    await adaMiss.update({ color: 'green' })
    assert.notEqual(debt(await readLedger(db, groupId, asOf)), expectedDebt)
    await loadSample(db)
    assert.equal((await adaMiss.get()).data()?.color, 'green')
    await adaMiss.update({ color: 'red' })
    assert.equal(debt(await readLedger(db, groupId, asOf)), expectedDebt)

    const cam = await db.collection('googleSubs').doc('sample-cam').get()
    await setLeftOn(db, groupId, cam.data()?.userId, '2026-10-01')
    assert.notEqual(debt(await readLedger(db, groupId, asOf)), expectedDebt)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

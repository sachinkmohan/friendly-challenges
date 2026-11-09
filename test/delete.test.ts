import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recordPayment } from '../src/balances.ts'
import { parseIsoDate, saveChallenge, saveRhythm, startChallenge, type IsoDate } from '../src/challenge.ts'
import { logCheckIn } from '../src/checkins.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { deleteGroup, listHomeGroups, type GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import { groupRef, readGroup } from '../src/store.ts'
import { CHECK_IN_TODAY, closeServer, cookieFor, groupWith, listen, person, post, setJoinedOn, setLeftOn } from './support/fixtures.ts'

function iso(raw: string): IsoDate {
  const day = parseIsoDate(raw)
  if (!day) throw new Error(raw)
  return day
}

const today = iso('2026-11-06')

type Crew = { db: Database; ada: Account; grace: Account; lin: Account; groupId: GroupId }

async function activeCrew(): Promise<Crew> {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const grace = await person(db, 'Grace')
  const lin = await person(db, 'Lin')
  const groupId = await groupWith(db, [ada, grace, lin])
  await setJoinedOn(db, groupId, '2026-11-01')
  const saved = await saveChallenge(db, ada, groupId, {
    name: 'No sweets',
    type: 'no_sugar',
    customLabel: '',
    currency: 'USD',
    stake: '5',
    startsOn: '2026-11-01',
    endsOn: '2026-11-30',
  })
  if (!saved.ok) throw new Error(saved.failure)
  for (const who of [ada, grace, lin]) {
    const rhythm = await saveRhythm(db, who, groupId, { interval: 'every_day' })
    if (!rhythm.ok) throw new Error(rhythm.failure)
  }
  const started = await startChallenge(db, ada, groupId, { cause: '' })
  if (!started.ok) throw new Error(started.failure)
  return { db, ada, grace, lin, groupId }
}

async function childCount(db: Database, groupId: GroupId): Promise<number> {
  const collections = await groupRef(db, groupId).listCollections()
  const sizes = await Promise.all(collections.map(async (ref) => (await ref.count().get()).data().count))
  return sizes.reduce((sum, size) => sum + size, 0)
}

test('only the creator can delete the group, and only after confirming', async () => {
  const { db, ada, grace, lin, groupId } = await activeCrew()
  const noor = await person(db, 'Noor')
  try {
    assert.deepEqual(await deleteGroup(db, noor, groupId, true), { ok: false, failure: 'not_member' })
    assert.deepEqual(await deleteGroup(db, grace, groupId, true), { ok: false, failure: 'not_creator' })
    assert.deepEqual(await deleteGroup(db, ada, groupId, false), { ok: false, failure: 'not_confirmed' })
    await setLeftOn(db, groupId, lin.id, '2026-11-03')
    assert.deepEqual(await deleteGroup(db, lin, groupId, true), { ok: false, failure: 'not_member' })
    assert.ok(await readGroup(db, groupId))
    assert.deepEqual(await deleteGroup(db, ada, crypto.randomUUID() as GroupId, true), { ok: false, failure: 'group_missing' })
  } finally {
    await closeDatabase(db)
  }
})

test('deleting removes the group, its check-ins, and its payments for every member', async () => {
  const { db, ada, grace, lin, groupId } = await activeCrew()
  try {
    assert.deepEqual(await logCheckIn(db, grace, groupId, { day: '2026-11-02', color: 'red' }, CHECK_IN_TODAY), { ok: true, day: '2026-11-02', color: 'red', previous: null })
    assert.deepEqual(await logCheckIn(db, ada, groupId, { day: '2026-11-02', color: 'green' }, CHECK_IN_TODAY), { ok: true, day: '2026-11-02', color: 'green', previous: null })
    const paid = await recordPayment(db, grace, groupId, { payeeId: ada.id, amount: '5', paidOn: '2026-11-03', paypalRef: '' }, today)
    assert.deepEqual(paid, { ok: true, amountMinor: 500, currency: 'USD', minorDigits: 2, payeeName: 'Ada' })
    assert.equal(await childCount(db, groupId), 3)

    assert.deepEqual(await deleteGroup(db, ada, groupId, true), { ok: true, label: 'No sweets' })

    assert.equal(await readGroup(db, groupId), null)
    assert.equal(await childCount(db, groupId), 0)
    for (const who of [ada, grace, lin]) assert.deepEqual(await listHomeGroups(db, who), [])
    assert.deepEqual(await logCheckIn(db, grace, groupId, { day: '2026-11-03', color: 'green' }, CHECK_IN_TODAY), {
      ok: false,
      failure: 'group_missing',
    })
  } finally {
    await closeDatabase(db)
  }
})

test('the creator deletes from the group page and lands on home, and other members never see the control', async () => {
  const { db, ada, grace, groupId } = await activeCrew()
  const { server, base } = await listen(db, { today: () => today })
  const adaCookie = await cookieFor(db, ada)
  const graceCookie = await cookieFor(db, grace)
  const page = async (cookie: string) => fetch(`${base}/groups/${groupId}`, { headers: { cookie } })
  try {
    assert.match(await (await page(adaCookie)).text(), /Delete group/)
    assert.doesNotMatch(await (await page(graceCookie)).text(), /Delete group/)

    const byMember = await post(base, `/groups/${groupId}/delete`, graceCookie, 'confirm=yes')
    assert.equal(byMember.status, 403)
    assert.match(await byMember.text(), /Only the person who made the group can delete it\./)

    const unconfirmed = await post(base, `/groups/${groupId}/delete`, adaCookie, '')
    assert.equal(unconfirmed.status, 400)
    assert.match(await unconfirmed.text(), /Tick the box to confirm/)

    const signedOut = await post(base, `/groups/${groupId}/delete`, null, 'confirm=yes')
    assert.equal(signedOut.status, 401)
    assert.ok(await readGroup(db, groupId))

    const deleted = await post(base, `/groups/${groupId}/delete`, adaCookie, 'confirm=yes')
    assert.equal(deleted.status, 303)
    assert.equal(deleted.headers.get('location'), '/')
    assert.equal((await page(graceCookie)).status, 404)
    assert.equal((await post(base, `/groups/${groupId}/delete`, adaCookie, 'confirm=yes')).status, 404)

    const wrongMethod = await fetch(`${base}/groups/${groupId}/delete`, { headers: { cookie: adaCookie } })
    assert.equal(wrongMethod.status, 405)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

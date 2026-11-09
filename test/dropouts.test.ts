import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GroupLedger } from '../src/balances.ts'
import { parseIsoDate, saveChallenge, saveRhythm, startChallenge, type IsoDate } from '../src/challenge.ts'
import { logCheckIn } from '../src/checkins.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { recordDropout } from '../src/dropouts.ts'
import { joinGroup, type GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import { readCheckIns, readGroup } from '../src/store.ts'
import { CHECK_IN_TODAY, closeServer, cookieFor, groupWith, listen, person, post, setJoinedOn } from './support/fixtures.ts'
import { readLedger, viewGroup } from './support/reads.ts'

function iso(raw: string): IsoDate {
  const day = parseIsoDate(raw)
  if (!day) throw new Error(raw)
  return day
}

const today = iso('2026-11-06')

async function group(db: Database, creator: Account, others: readonly Account[]): Promise<GroupId> {
  const groupId = await groupWith(db, [creator, ...others])
  await setJoinedOn(db, groupId, '2026-11-01')
  return groupId
}

type Crew = { db: Database; ada: Account; grace: Account; lin: Account; groupId: GroupId }

async function activeCrew(): Promise<Crew> {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const grace = await person(db, 'Grace')
  const lin = await person(db, 'Lin')
  const groupId = await group(db, ada, [grace, lin])
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

async function leftOn(db: Database, groupId: GroupId): Promise<Record<string, string | null>> {
  const read = await readGroup(db, groupId)
  assert.ok(read)
  return Object.fromEntries(Object.entries(read.members).map(([userId, member]) => [userId, member.leftOn]))
}

async function ledger(db: Database, groupId: GroupId): Promise<GroupLedger> {
  const read = await readLedger(db, groupId, today)
  if (read?.kind !== 'group') throw new Error('ledger')
  return read
}

function netsOf(read: GroupLedger): Record<string, number> {
  return Object.fromEntries(read.nets.map((line) => [line.userId, line.netMinor]))
}

function total(read: GroupLedger): number {
  return read.nets.reduce((sum, line) => sum + line.netMinor, 0)
}

test('the member or the group creator records a dropout and anyone else cannot', async () => {
  const { db, ada, grace, lin, groupId } = await activeCrew()
  const noor = await person(db, 'Noor')
  const drop = (actor: Account, memberId: string, lastDay: string) =>
    recordDropout(db, actor, groupId, { memberId, lastDay }, today)
  try {
    assert.deepEqual(await drop(grace, lin.id, '2026-11-03'), { ok: false, failure: 'not_allowed' })
    assert.deepEqual(await drop(noor, noor.id, '2026-11-03'), { ok: false, failure: 'not_member' })
    assert.deepEqual(await drop(ada, 'nobody', '2026-11-03'), { ok: false, failure: 'bad_member' })
    assert.deepEqual(await drop(ada, 'constructor', '2026-11-03'), { ok: false, failure: 'bad_member' })
    assert.deepEqual(await drop(ada, noor.id, '2026-11-03'), { ok: false, failure: 'bad_member' })
    assert.deepEqual(await drop(ada, grace.id, '2026-02-30'), { ok: false, failure: 'bad_day' })
    assert.deepEqual(await drop(ada, grace.id, '2026-10-31'), { ok: false, failure: 'before_join' })
    assert.deepEqual(await drop(ada, grace.id, '2026-11-07'), { ok: false, failure: 'future_day' })
    assert.deepEqual(await leftOn(db, groupId), { [ada.id]: null, [grace.id]: null, [lin.id]: null })

    assert.deepEqual(await drop(lin, lin.id, '2026-11-04'), { ok: true, groupName: 'No sweets', memberName: 'Lin', lastDay: '2026-11-04' })
    assert.deepEqual(await drop(ada, grace.id, '2026-11-06'), { ok: true, groupName: 'No sweets', memberName: 'Grace', lastDay: '2026-11-06' })
    assert.deepEqual(await leftOn(db, groupId), { [ada.id]: null, [grace.id]: '2026-11-06', [lin.id]: '2026-11-04' })

    assert.deepEqual(await drop(ada, lin.id, '2026-11-05'), { ok: false, failure: 'bad_member' })
    assert.deepEqual(await drop(lin, lin.id, '2026-11-05'), { ok: false, failure: 'not_member' })
    assert.deepEqual(await drop(ada, ada.id, '2026-11-01'), { ok: true, groupName: 'No sweets', memberName: 'Ada', lastDay: '2026-11-01' })
    assert.deepEqual(await recordDropout(db, ada, crypto.randomUUID() as GroupId, { memberId: ada.id, lastDay: '2026-11-01' }, today), {
      ok: false,
      failure: 'group_missing',
    })
  } finally {
    await closeDatabase(db)
  }
})

test('debts through the last day stay and later days owe the leaver nothing and cost them nothing', async () => {
  const { db, ada, grace, lin, groupId } = await activeCrew()
  const days: readonly [Account, string, 'green' | 'red'][] = [
    [ada, '2026-11-01', 'green'],
    [ada, '2026-11-02', 'red'],
    [ada, '2026-11-03', 'green'],
    [ada, '2026-11-04', 'green'],
    [ada, '2026-11-05', 'red'],
    [grace, '2026-11-01', 'green'],
    [grace, '2026-11-02', 'green'],
    [grace, '2026-11-03', 'green'],
    [grace, '2026-11-04', 'red'],
    [grace, '2026-11-05', 'green'],
    [lin, '2026-11-01', 'red'],
    [lin, '2026-11-02', 'green'],
    [lin, '2026-11-03', 'red'],
  ]
  try {
    for (const [who, day, color] of days) {
      assert.deepEqual(await logCheckIn(db, who, groupId, { day, color }, CHECK_IN_TODAY), { ok: true, day, color, previous: null })
    }
    const before = await ledger(db, groupId)
    assert.deepEqual(netsOf(before), { [ada.id]: 500, [grace.id]: 2000, [lin.id]: -2500 })

    assert.deepEqual(await recordDropout(db, lin, groupId, { memberId: lin.id, lastDay: '2026-11-03' }, today), {
      ok: true,
      groupName: 'No sweets',
      memberName: 'Lin',
      lastDay: '2026-11-03',
    })
    const after = await ledger(db, groupId)
    assert.deepEqual(netsOf(after), { [ada.id]: 0, [grace.id]: 1500, [lin.id]: -1500 })
    assert.equal(total(after), 0)
    assert.deepEqual(
      after.open.map((line) => [line.debtorId, line.creditorId, line.amountMinor]),
      [
        [ada.id, grace.id, 500],
        [lin.id, ada.id, 500],
        [lin.id, grace.id, 1000],
      ],
    )
    assert.deepEqual(await logCheckIn(db, lin, groupId, { day: '2026-11-04', color: 'green' }, CHECK_IN_TODAY), {
      ok: false,
      failure: 'outside_membership',
    })
  } finally {
    await closeDatabase(db)
  }
})

test('a dropout can leave fewer than 3 active and frees a seat in a full group', async () => {
  const db = openTestDatabase()
  try {
    const [ada, grace, lin, noor, omar, priya, quinn] = await Promise.all(
      ['Ada', 'Grace', 'Lin', 'Noor', 'Omar', 'Priya', 'Quinn'].map((name) => person(db, name)),
    )
    if (!ada || !grace || !lin || !noor || !omar || !priya || !quinn) throw new Error('people')
    const small = await group(db, ada, [grace, lin])
    assert.deepEqual(await recordDropout(db, ada, small, { memberId: lin.id, lastDay: '2026-11-02' }, today), {
      ok: true,
      groupName: 'Morning run',
      memberName: 'Lin',
      lastDay: '2026-11-02',
    })
    const smallView = await viewGroup(db, ada, small)
    assert.equal(smallView.kind === 'members' ? smallView.activeCount : null, 2)

    const full = await group(db, ada, [grace, lin, noor, omar])
    assert.deepEqual(await joinGroup(db, priya, full), { ok: false, failure: 'group_full' })
    assert.deepEqual(await recordDropout(db, omar, full, { memberId: omar.id, lastDay: '2026-11-05' }, today), {
      ok: true,
      groupName: 'Morning run',
      memberName: 'Omar',
      lastDay: '2026-11-05',
    })
    const joins = await Promise.all([joinGroup(db, priya, full), joinGroup(db, quinn, full)])
    assert.equal(joins.filter((joined) => joined.ok).length, 1)
    assert.deepEqual(joins.find((joined) => !joined.ok), { ok: false, failure: 'group_full' })
  } finally {
    await closeDatabase(db)
  }
})

function fields(values: Record<string, string>): string {
  return new URLSearchParams(values).toString()
}

function rowOf(html: string, userId: string): string {
  const start = html.indexOf(`<tr data-member="${userId}">`)
  if (start < 0) return ''
  return html.slice(start, html.indexOf('</tr>', start))
}

function markOn(row: string, day: string): string | undefined {
  return new RegExp(`data-day="${day}" data-mark="(\\w+)"`).exec(row)?.[1]
}

test('the group card records a dropout and the leaver keeps a calendar row with blank later days', async () => {
  const { db, ada, grace, lin, groupId } = await activeCrew()
  const adaCookie = await cookieFor(db, ada)
  const graceCookie = await cookieFor(db, grace)
  const linCookie = await cookieFor(db, lin)
  const noorCookie = await cookieFor(db, await person(db, 'Noor'))
  const { server, base } = await listen(db, { today: () => today })
  const groupPath = `/groups/${groupId}`
  const dropoutPath = `${groupPath}/dropout`
  const page = async (cookie: string) => (await fetch(`${base}${groupPath}`, { headers: { cookie } })).text()
  const dropoutForm = (html: string) => {
    const start = html.indexOf(`action="${dropoutPath}"`)
    return start < 0 ? '' : html.slice(start, html.indexOf('</form>', start))
  }
  try {
    const adaForm = dropoutForm(await page(adaCookie))
    for (const who of [ada, grace, lin]) assert.match(adaForm, new RegExp(`<option value="${who.id}"`))
    const graceForm = dropoutForm(await page(graceCookie))
    assert.match(graceForm, new RegExp(`<option value="${grace.id}"`))
    assert.doesNotMatch(graceForm, new RegExp(`<option value="${lin.id}"`))
    assert.doesNotMatch(graceForm, new RegExp(`<option value="${ada.id}"`))

    const looked = await fetch(`${base}${dropoutPath}`, { headers: { cookie: adaCookie } })
    assert.equal(looked.status, 405)
    assert.equal(looked.headers.get('allow'), 'POST')
    assert.equal((await post(base, dropoutPath, null, fields({ member: lin.id, last_day: '2026-11-03' }))).status, 401)

    const notAllowed = await post(base, dropoutPath, graceCookie, fields({ member: lin.id, last_day: '2026-11-03' }))
    assert.equal(notAllowed.status, 403)
    assert.match(await notAllowed.text(), /Only that member or the person who made the group can record this\./)
    const outsider = await post(base, dropoutPath, noorCookie, fields({ member: lin.id, last_day: '2026-11-03' }))
    assert.equal(outsider.status, 403)
    assert.match(await outsider.text(), /Join the group before you record a dropout\./)

    const future = await post(base, dropoutPath, adaCookie, fields({ member: grace.id, last_day: '2026-11-07' }))
    assert.equal(future.status, 400)
    const futureHtml = await future.text()
    assert.match(futureHtml, /Pick a last day that is today or earlier\./)
    assert.match(futureHtml, /name="last_day" type="date" value="2026-11-07"/)
    assert.match(dropoutForm(futureHtml), new RegExp(`<option value="${grace.id}" selected>`))
    assert.deepEqual(await leftOn(db, groupId), { [ada.id]: null, [grace.id]: null, [lin.id]: null })

    const self = await post(base, dropoutPath, linCookie, fields({ member: lin.id, last_day: '2026-11-03' }))
    assert.equal(self.status, 303)
    assert.equal(self.headers.get('location'), '/')
    const other = await post(base, dropoutPath, adaCookie, fields({ member: grace.id, last_day: '2026-11-05' }))
    assert.equal(other.status, 303)
    assert.equal(other.headers.get('location'), groupPath)

    const after = await page(adaCookie)
    const linRow = rowOf(after, lin.id)
    assert.notEqual(linRow, '')
    assert.equal(markOn(linRow, '2026-11-03'), 'red')
    for (const day of ['2026-11-04', '2026-11-05', '2026-11-06']) assert.equal(markOn(linRow, day), 'blank')
    const graceRow = rowOf(after, grace.id)
    assert.equal(markOn(graceRow, '2026-11-05'), 'red')
    assert.equal(markOn(graceRow, '2026-11-06'), 'blank')
    assert.equal(markOn(rowOf(after, ada.id), '2026-11-06'), 'empty')

    const lateCheckIn = await post(base, `${groupPath}/check-in`, linCookie, fields({ day: '2026-11-04', color: 'green' }))
    assert.equal(lateCheckIn.status, 400)
    assert.match(await lateCheckIn.text(), /You were not in the group on that day\./)
    assert.deepEqual(await readCheckIns(db, groupId), [])
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

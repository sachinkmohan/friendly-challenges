import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { upsertAccount } from '../src/accounts.ts'
import { createApp } from '../src/app.ts'
import { readLedger, type Ledger } from '../src/balances.ts'
import { parseIsoDate, saveChallenge, saveRhythm, startChallenge, type IsoDate } from '../src/challenge.ts'
import { logCheckIn } from '../src/checkins.ts'
import { openDatabase } from '../src/db.ts'
import { recordDropout } from '../src/dropouts.ts'
import { createGroup, joinGroup, viewGroup, type GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import { createSession } from '../src/sessions.ts'

function iso(raw: string): IsoDate {
  const day = parseIsoDate(raw)
  if (!day) throw new Error(raw)
  return day
}

const today = iso('2026-11-06')

async function person(db: PGlite, name: string): Promise<Account> {
  const saved = await upsertAccount(db, {
    sub: `sub-${name}`,
    email: `${name.toLowerCase()}@example.com`,
    emailVerified: true,
    displayName: name,
    avatarUrl: null,
  })
  if (!saved.ok) throw new Error('account')
  return saved.account
}

async function group(db: PGlite, creator: Account, others: readonly Account[]): Promise<GroupId> {
  const created = await createGroup(db, creator, 'Morning run')
  if (!created.ok) throw new Error(created.failure)
  for (const who of others) {
    const joined = await joinGroup(db, who, created.groupId)
    if (!joined.ok) throw new Error(joined.failure)
  }
  await db.query(`UPDATE memberships SET joined_on = '2026-11-01' WHERE group_id = $1`, [created.groupId])
  return created.groupId
}

type Crew = { db: PGlite; ada: Account; grace: Account; lin: Account; groupId: GroupId }

async function activeCrew(): Promise<Crew> {
  const db = await openDatabase()
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
    const rhythm = await saveRhythm(db, who, groupId, { interval: 'every_day', anchorOn: '2026-11-01' })
    if (!rhythm.ok) throw new Error(rhythm.failure)
  }
  const started = await startChallenge(db, ada, groupId)
  if (!started.ok) throw new Error(started.failure)
  return { db, ada, grace, lin, groupId }
}

async function leftOn(db: PGlite, groupId: GroupId): Promise<Record<string, string | null>> {
  const rows = await db.query<{ user_id: string; left_on: string | null }>(
    `SELECT user_id::text AS user_id, to_char(left_on, 'YYYY-MM-DD') AS left_on FROM memberships WHERE group_id = $1`,
    [groupId],
  )
  return Object.fromEntries(rows.rows.map((row) => [row.user_id, row.left_on]))
}

async function ledger(db: PGlite, groupId: GroupId): Promise<Ledger> {
  const read = await readLedger(db, groupId, today)
  if (!read) throw new Error('ledger')
  return read
}

function netsOf(read: Ledger): Record<string, number> {
  return Object.fromEntries(read.nets.map((line) => [line.userId, line.netMinor]))
}

function total(read: Ledger): number {
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
    assert.deepEqual(await drop(ada, noor.id, '2026-11-03'), { ok: false, failure: 'bad_member' })
    assert.deepEqual(await drop(ada, grace.id, '2026-02-30'), { ok: false, failure: 'bad_day' })
    assert.deepEqual(await drop(ada, grace.id, '2026-10-31'), { ok: false, failure: 'before_join' })
    assert.deepEqual(await drop(ada, grace.id, '2026-11-07'), { ok: false, failure: 'future_day' })
    assert.deepEqual(await leftOn(db, groupId), { [ada.id]: null, [grace.id]: null, [lin.id]: null })

    assert.deepEqual(await drop(lin, lin.id, '2026-11-04'), { ok: true })
    assert.deepEqual(await drop(ada, grace.id, '2026-11-06'), { ok: true })
    assert.deepEqual(await leftOn(db, groupId), { [ada.id]: null, [grace.id]: '2026-11-06', [lin.id]: '2026-11-04' })

    assert.deepEqual(await drop(ada, lin.id, '2026-11-05'), { ok: false, failure: 'bad_member' })
    assert.deepEqual(await drop(lin, lin.id, '2026-11-05'), { ok: false, failure: 'not_member' })
    assert.deepEqual(await drop(ada, ada.id, '2026-11-01'), { ok: true })
    assert.deepEqual(await recordDropout(db, ada, crypto.randomUUID() as GroupId, { memberId: ada.id, lastDay: '2026-11-01' }, today), {
      ok: false,
      failure: 'group_missing',
    })
  } finally {
    await db.close()
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
      assert.deepEqual(await logCheckIn(db, who, groupId, { day, color }), { ok: true })
    }
    const before = await ledger(db, groupId)
    assert.deepEqual(netsOf(before), { [ada.id]: 500, [grace.id]: 2000, [lin.id]: -2500 })

    assert.deepEqual(await recordDropout(db, lin, groupId, { memberId: lin.id, lastDay: '2026-11-03' }, today), {
      ok: true,
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
    assert.deepEqual(await logCheckIn(db, lin, groupId, { day: '2026-11-04', color: 'green' }), {
      ok: false,
      failure: 'outside_membership',
    })
  } finally {
    await db.close()
  }
})

test('a dropout can leave fewer than 3 active and frees a seat in a full group', async () => {
  const db = await openDatabase()
  try {
    const [ada, grace, lin, noor, omar, priya, quinn] = await Promise.all(
      ['Ada', 'Grace', 'Lin', 'Noor', 'Omar', 'Priya', 'Quinn'].map((name) => person(db, name)),
    )
    if (!ada || !grace || !lin || !noor || !omar || !priya || !quinn) throw new Error('people')
    const small = await group(db, ada, [grace, lin])
    assert.deepEqual(await recordDropout(db, ada, small, { memberId: lin.id, lastDay: '2026-11-02' }, today), { ok: true })
    const smallView = await viewGroup(db, ada, small)
    assert.equal(smallView.kind === 'members' ? smallView.activeCount : null, 2)

    const full = await group(db, ada, [grace, lin, noor, omar])
    assert.deepEqual(await joinGroup(db, priya, full), { ok: false, failure: 'group_full' })
    assert.deepEqual(await recordDropout(db, omar, full, { memberId: omar.id, lastDay: '2026-11-05' }, today), { ok: true })
    assert.deepEqual(await joinGroup(db, priya, full), { ok: true, groupId: full })
    assert.deepEqual(await joinGroup(db, quinn, full), { ok: false, failure: 'group_full' })
  } finally {
    await db.close()
  }
})

async function listen(db: PGlite) {
  const app = createApp({ db, config: { clientId: 'client-id', clientSecret: 'client-secret' }, today: () => today })
  const server = createServer((req, res) => {
    void app(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${address.port}` }
}

async function cookieFor(db: PGlite, account: Account): Promise<string> {
  return `session=${encodeURIComponent(await createSession(db, account.id))}`
}

async function post(base: string, path: string, cookie: string | null, fields: Record<string, string>) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  })
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
  const { server, base } = await listen(db)
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
    assert.equal((await post(base, dropoutPath, null, { member: lin.id, last_day: '2026-11-03' })).status, 401)

    const notAllowed = await post(base, dropoutPath, graceCookie, { member: lin.id, last_day: '2026-11-03' })
    assert.equal(notAllowed.status, 403)
    assert.match(await notAllowed.text(), /Only that member or the person who made the group can record this\./)
    const outsider = await post(base, dropoutPath, noorCookie, { member: lin.id, last_day: '2026-11-03' })
    assert.equal(outsider.status, 403)
    assert.match(await outsider.text(), /Join the group before you record a dropout\./)

    const future = await post(base, dropoutPath, adaCookie, { member: grace.id, last_day: '2026-11-07' })
    assert.equal(future.status, 400)
    const futureHtml = await future.text()
    assert.match(futureHtml, /Pick a last day that is today or earlier\./)
    assert.match(futureHtml, /name="last_day" type="date" value="2026-11-07"/)
    assert.match(dropoutForm(futureHtml), new RegExp(`<option value="${grace.id}" selected>`))
    assert.deepEqual(await leftOn(db, groupId), { [ada.id]: null, [grace.id]: null, [lin.id]: null })

    const self = await post(base, dropoutPath, linCookie, { member: lin.id, last_day: '2026-11-03' })
    assert.equal(self.status, 303)
    assert.equal(self.headers.get('location'), '/')
    const other = await post(base, dropoutPath, adaCookie, { member: grace.id, last_day: '2026-11-05' })
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

    const lateCheckIn = await post(base, `${groupPath}/check-in`, linCookie, { day: '2026-11-04', color: 'green' })
    assert.equal(lateCheckIn.status, 400)
    assert.match(await lateCheckIn.text(), /You were not in the group on that day\./)
    const stored = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM check_ins`)
    assert.equal(Number(stored.rows[0]?.n), 0)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await db.close()
  }
})

test('reopening the same data dir runs the migration again and fills a missing creator from the first member', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friendly-challenges-'))
  try {
    const first = await openDatabase(dir)
    const ada = await person(first, 'Ada')
    const grace = await person(first, 'Grace')
    const groupId = await group(first, ada, [grace])
    await first.query(`UPDATE memberships SET joined_on = '2026-10-01' WHERE user_id = $1`, [grace.id])
    await first.query(`ALTER TABLE groups ALTER COLUMN created_by DROP NOT NULL`)
    await first.query(`UPDATE groups SET created_by = NULL`)
    await first.close()

    const second = await openDatabase(dir)
    try {
      const row = await second.query<{ created_by: string }>(`SELECT created_by::text AS created_by FROM groups WHERE id = $1`, [
        groupId,
      ])
      assert.deepEqual(row.rows, [{ created_by: grace.id }])
      await assert.rejects(second.query(`UPDATE groups SET created_by = NULL`))
    } finally {
      await second.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

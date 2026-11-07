import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { upsertAccount } from '../src/accounts.ts'
import { createApp } from '../src/app.ts'
import { saveChallenge, saveRhythm, startChallenge, type RhythmKind } from '../src/challenge.ts'
import { listCheckIns, logCheckIn } from '../src/checkins.ts'
import { openDatabase } from '../src/db.ts'
import { createGroup, joinGroup, parseGroupId, type GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import { safeReturnPath } from '../src/page.ts'
import { createSession } from '../src/sessions.ts'

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

type Crew = { db: PGlite; ada: Account; grace: Account; lin: Account; groupId: GroupId }

async function rhythm(db: PGlite, who: Account, groupId: GroupId, interval: RhythmKind, anchorOn: string) {
  const saved = await saveRhythm(db, who, groupId, { interval, anchorOn })
  if (!saved.ok) throw new Error(saved.failure)
}

async function activeCrew(options: { start?: boolean } = {}): Promise<Crew> {
  const db = await openDatabase()
  const ada = await person(db, 'Ada')
  const grace = await person(db, 'Grace')
  const lin = await person(db, 'Lin')
  const created = await createGroup(db, ada, 'Morning run')
  if (!created.ok) throw new Error(created.failure)
  const groupId = created.groupId
  for (const member of [grace, lin]) {
    const joined = await joinGroup(db, member, groupId)
    if (!joined.ok) throw new Error(joined.failure)
  }
  await db.query(`UPDATE memberships SET joined_on = '2026-11-01' WHERE group_id = $1`, [groupId])
  await db.query(`UPDATE memberships SET joined_on = '2026-11-05' WHERE group_id = $1 AND user_id = $2`, [
    groupId,
    lin.id,
  ])
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
  await rhythm(db, ada, groupId, 'every_day', '2026-11-01')
  await rhythm(db, grace, groupId, 'every_2_days', '2026-11-02')
  await rhythm(db, lin, groupId, 'every_day', '2026-11-01')
  if (options.start !== false) {
    const started = await startChallenge(db, ada, groupId)
    if (!started.ok) throw new Error(started.failure)
  }
  return { db, ada, grace, lin, groupId }
}

test('a due day saves once and a second save replaces the color', async () => {
  const { db, ada, grace, groupId } = await activeCrew()
  try {
    assert.deepEqual(await logCheckIn(db, ada, groupId, { day: '2026-11-03', color: 'green' }), { ok: true })
    assert.deepEqual(await logCheckIn(db, grace, groupId, { day: '2026-11-04', color: 'red' }), { ok: true })
    assert.deepEqual(await listCheckIns(db, groupId), [
      { userId: grace.id, displayName: 'Grace', day: '2026-11-04', color: 'red' },
      { userId: ada.id, displayName: 'Ada', day: '2026-11-03', color: 'green' },
    ])

    assert.deepEqual(await logCheckIn(db, ada, groupId, { day: '2026-11-03', color: 'red' }), { ok: true })
    assert.deepEqual(await logCheckIn(db, ada, groupId, { day: '2026-11-03', color: 'red' }), { ok: true })
    const ada3 = (await listCheckIns(db, groupId)).filter((item) => item.userId === ada.id)
    assert.deepEqual(ada3, [{ userId: ada.id, displayName: 'Ada', day: '2026-11-03', color: 'red' }])
  } finally {
    await db.close()
  }
})

test('a day that is not due is rejected and nothing is written', async () => {
  const { db, ada, grace, groupId } = await activeCrew()
  try {
    const rejected: readonly (readonly [Account, string, string])[] = [
      [grace, '2026-11-03', 'not_due'],
      [grace, '2026-11-01', 'not_due'],
      [ada, '2026-12-01', 'not_due'],
      [ada, '2026-10-31', 'outside_membership'],
    ]
    for (const [who, day, failure] of rejected) {
      assert.deepEqual(await logCheckIn(db, who, groupId, { day, color: 'green' }), { ok: false, failure })
    }
    assert.deepEqual(await logCheckIn(db, ada, groupId, { day: '2026-11-31', color: 'green' }), {
      ok: false,
      failure: 'bad_day',
    })
    assert.deepEqual(await logCheckIn(db, ada, groupId, { day: '2026-11-03', color: 'blue' }), {
      ok: false,
      failure: 'bad_color',
    })
    assert.deepEqual(await listCheckIns(db, groupId), [])
  } finally {
    await db.close()
  }
})

test('a draft challenge has no due days', async () => {
  const { db, ada, groupId } = await activeCrew({ start: false })
  try {
    assert.deepEqual(await logCheckIn(db, ada, groupId, { day: '2026-11-03', color: 'green' }), {
      ok: false,
      failure: 'not_due',
    })
  } finally {
    await db.close()
  }
})

test('a day before joining or after leaving is rejected', async () => {
  const { db, grace, lin, groupId } = await activeCrew()
  const outsider = await person(db, 'Noor')
  try {
    assert.deepEqual(await logCheckIn(db, lin, groupId, { day: '2026-11-04', color: 'green' }), {
      ok: false,
      failure: 'outside_membership',
    })
    assert.deepEqual(await logCheckIn(db, lin, groupId, { day: '2026-11-05', color: 'green' }), { ok: true })

    await db.query(`UPDATE memberships SET left_on = '2026-11-10' WHERE group_id = $1 AND user_id = $2`, [
      groupId,
      grace.id,
    ])
    assert.deepEqual(await logCheckIn(db, grace, groupId, { day: '2026-11-12', color: 'green' }), {
      ok: false,
      failure: 'outside_membership',
    })
    assert.deepEqual(await logCheckIn(db, grace, groupId, { day: '2026-11-10', color: 'green' }), { ok: true })

    assert.deepEqual(await logCheckIn(db, outsider, groupId, { day: '2026-11-05', color: 'green' }), {
      ok: false,
      failure: 'not_member',
    })
    const missing = parseGroupId('00000000-0000-4000-8000-000000000099')
    if (!missing) throw new Error('id')
    assert.deepEqual(await logCheckIn(db, lin, missing, { day: '2026-11-05', color: 'green' }), {
      ok: false,
      failure: 'group_missing',
    })
    assert.deepEqual(
      (await listCheckIns(db, groupId)).map((item) => [item.displayName, item.day]),
      [
        ['Grace', '2026-11-10'],
        ['Lin', '2026-11-05'],
      ],
    )
  } finally {
    await db.close()
  }
})

test('the database refuses a color other than green or red', async () => {
  const { db, ada, groupId } = await activeCrew()
  try {
    await assert.rejects(
      db.query(`INSERT INTO check_ins (group_id, user_id, day, color) VALUES ($1, $2, '2026-11-03', 'amber')`, [
        groupId,
        ada.id,
      ]),
    )
  } finally {
    await db.close()
  }
})

test('a check-in path is not a sign-in return path', () => {
  assert.equal(safeReturnPath('/groups/00000000-0000-4000-8000-000000000001/check-in'), '/')
})

async function listen(db: PGlite) {
  const app = createApp({ db, config: { clientId: 'client-id', clientSecret: 'client-secret' } })
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

test('the group card logs a day and lists who logged what', async () => {
  const { db, ada, grace, groupId } = await activeCrew()
  const adaCookie = await cookieFor(db, ada)
  const graceCookie = await cookieFor(db, grace)
  const outsiderCookie = await cookieFor(db, await person(db, 'Noor'))
  const { server, base } = await listen(db)
  const groupPath = `/groups/${groupId}`
  const checkInPath = `${groupPath}/check-in`
  try {
    const page = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(page, new RegExp(`action="${checkInPath}"`))
    assert.match(page, /name="color" value="green"/)
    assert.match(page, /name="color" value="red"/)
    assert.doesNotMatch(page, /Check-ins/)

    const looked = await fetch(`${base}${checkInPath}`)
    assert.equal(looked.status, 405)
    assert.equal(looked.headers.get('allow'), 'POST')

    const signedOut = await post(base, checkInPath, null, { day: '2026-11-03', color: 'green' })
    assert.equal(signedOut.status, 401)

    const saved = await post(base, checkInPath, adaCookie, { day: '2026-11-03', color: 'green' })
    assert.equal(saved.status, 303)
    assert.equal(saved.headers.get('location'), groupPath)
    const replaced = await post(base, checkInPath, adaCookie, { day: '2026-11-03', color: 'red' })
    assert.equal(replaced.status, 303)
    const graceSaved = await post(base, checkInPath, graceCookie, { day: '2026-11-04', color: 'green' })
    assert.equal(graceSaved.status, 303)

    const after = await (await fetch(`${base}${groupPath}`, { headers: { cookie: graceCookie } })).text()
    const list = after.slice(after.indexOf('<ul class="check-ins">'))
    assert.match(
      list,
      /swatch green[\s\S]*Grace <time datetime="2026-11-04">2026-11-04<\/time>[\s\S]*Green[\s\S]*swatch red[\s\S]*Ada <time datetime="2026-11-03">2026-11-03<\/time>[\s\S]*Red/,
    )
    assert.doesNotMatch(list, /swatch green[^<]*<\/span> <span class="member-name">Ada/)

    const offDay = await post(base, checkInPath, graceCookie, { day: '2026-11-05', color: 'green' })
    assert.equal(offDay.status, 400)
    const offHtml = await offDay.text()
    assert.match(offHtml, /That day is not one of your logging days\./)
    assert.match(offHtml, /value="2026-11-05"/)

    const stranger = await post(base, checkInPath, outsiderCookie, { day: '2026-11-03', color: 'green' })
    assert.equal(stranger.status, 403)
    assert.match(await stranger.text(), /Join the group before you log a day\./)

    const rows = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM check_ins`)
    assert.equal(Number(rows.rows[0]?.n), 2)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await db.close()
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { saveChallenge, saveRhythm, startChallenge, type RhythmKind } from '../src/challenge.ts'
import { listCheckIns, logCheckIn } from '../src/checkins.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { parseGroupId, type GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import { safeReturnPath } from '../src/page.ts'
import { readCheckIns } from '../src/store.ts'
import { closeServer, cookieFor, groupWith, listen, person, post, setJoinedOn, setLeftOn } from './support/fixtures.ts'

type Crew = { db: Database; ada: Account; grace: Account; lin: Account; groupId: GroupId }

async function rhythm(db: Database, who: Account, groupId: GroupId, interval: RhythmKind, anchorOn: string) {
  const saved = await saveRhythm(db, who, groupId, { interval, anchorOn })
  if (!saved.ok) throw new Error(saved.failure)
}

async function activeCrew(options: { start?: boolean } = {}): Promise<Crew> {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const grace = await person(db, 'Grace')
  const lin = await person(db, 'Lin')
  const groupId = await groupWith(db, [ada, grace, lin])
  await setJoinedOn(db, groupId, '2026-11-01', [ada.id, grace.id])
  await setJoinedOn(db, groupId, '2026-11-05', [lin.id])
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
    const started = await startChallenge(db, ada, groupId, { cause: '' })
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
    await closeDatabase(db)
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
    await closeDatabase(db)
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
    await closeDatabase(db)
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

    await setLeftOn(db, groupId, grace.id, '2026-11-10')
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
    await closeDatabase(db)
  }
})

test('a check-in path is not a sign-in return path', () => {
  assert.equal(safeReturnPath('/groups/00000000-0000-4000-8000-000000000001/check-in'), '/')
})

function fields(values: Record<string, string>): string {
  return new URLSearchParams(values).toString()
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

    const signedOut = await post(base, checkInPath, null, fields({ day: '2026-11-03', color: 'green' }))
    assert.equal(signedOut.status, 401)

    const saved = await post(base, checkInPath, adaCookie, fields({ day: '2026-11-03', color: 'green' }))
    assert.equal(saved.status, 303)
    assert.equal(saved.headers.get('location'), groupPath)
    const replaced = await post(base, checkInPath, adaCookie, fields({ day: '2026-11-03', color: 'red' }))
    assert.equal(replaced.status, 303)
    const graceSaved = await post(base, checkInPath, graceCookie, fields({ day: '2026-11-04', color: 'green' }))
    assert.equal(graceSaved.status, 303)

    const after = await (await fetch(`${base}${groupPath}`, { headers: { cookie: graceCookie } })).text()
    const list = after.slice(after.indexOf('<ul class="check-ins">'))
    assert.match(
      list,
      /swatch green[\s\S]*Grace <time datetime="2026-11-04">2026-11-04<\/time>[\s\S]*Green[\s\S]*swatch red[\s\S]*Ada <time datetime="2026-11-03">2026-11-03<\/time>[\s\S]*Red/,
    )
    assert.doesNotMatch(list, /swatch green[^<]*<\/span> <span class="member-name">Ada/)

    const offDay = await post(base, checkInPath, graceCookie, fields({ day: '2026-11-05', color: 'green' }))
    assert.equal(offDay.status, 400)
    const offHtml = await offDay.text()
    assert.match(offHtml, /That day is not one of your logging days\./)
    assert.match(offHtml, /value="2026-11-05"/)

    const stranger = await post(base, checkInPath, outsiderCookie, fields({ day: '2026-11-03', color: 'green' }))
    assert.equal(stranger.status, 403)
    assert.match(await stranger.text(), /Join the group before you log a day\./)

    const amber = await post(base, checkInPath, adaCookie, fields({ day: '2026-11-05', color: 'amber' }))
    assert.equal(amber.status, 400)
    assert.match(await amber.text(), /Pick green or red\./)

    assert.deepEqual(
      (await readCheckIns(db, groupId)).map((item) => [item.userId, item.day, item.color]).sort(),
      [
        [ada.id, '2026-11-03', 'red'],
        [grace.id, '2026-11-04', 'green'],
      ].sort(),
    )
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

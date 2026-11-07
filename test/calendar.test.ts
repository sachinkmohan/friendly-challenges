import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { upsertAccount } from '../src/accounts.ts'
import { createApp } from '../src/app.ts'
import { buildCalendar, listHeatmaps, weeksOf, type CalendarMember, type DayMark } from '../src/calendar.ts'
import { parseIsoDate, saveChallenge, saveRhythm, startChallenge, type IsoDate } from '../src/challenge.ts'
import { logCheckIn } from '../src/checkins.ts'
import { openDatabase } from '../src/db.ts'
import { createGroup, joinGroup, type GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import { createSession } from '../src/sessions.ts'

function iso(raw: string): IsoDate {
  const day = parseIsoDate(raw)
  if (!day) throw new Error(raw)
  return day
}

const window = { phase: 'active', startsOn: iso('2026-11-01'), endsOn: iso('2026-11-30') } as const

function member(
  userId: string,
  joinedOn: string,
  rhythm: CalendarMember['rhythm'],
  colors: Record<string, 'green' | 'red'> = {},
): CalendarMember {
  return {
    userId,
    displayName: userId,
    span: { joinedOn: iso(joinedOn), leftOn: null },
    rhythm,
    colors: new Map(Object.entries(colors).map(([day, color]) => [iso(day), color])),
  }
}

function marks(days: readonly { mark: DayMark }[]): readonly DayMark[] {
  return days.map((item) => item.mark)
}

test('each member row marks green, red, empty, and blank days through today', () => {
  const calendar = buildCalendar({ window, today: iso('2026-11-06') }, [
    member('ada', '2026-11-01', { kind: 'every_day', anchorOn: iso('2026-11-01') }, {
      '2026-11-03': 'green',
      '2026-11-04': 'red',
    }),
    member('grace', '2026-11-01', { kind: 'every_2_days', anchorOn: iso('2026-11-02') }, { '2026-11-02': 'green' }),
    member('lin', '2026-11-05', { kind: 'every_day', anchorOn: iso('2026-11-01') }),
    member('noor', '2026-11-03', null),
  ])
  assert.deepEqual(calendar.days, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'])
  assert.deepEqual(
    calendar.rows.map((row) => [row.userId, marks(row.days)]),
    [
      ['ada', ['red', 'red', 'green', 'red', 'red', 'empty']],
      ['grace', ['blank', 'green', 'blank', 'red', 'blank', 'empty']],
      ['lin', ['blank', 'blank', 'blank', 'blank', 'red', 'empty']],
      ['noor', ['blank', 'blank', 'blank', 'blank', 'blank', 'blank']],
    ],
  )
})

test('a logged day after today keeps its color and an unlogged one stays empty', () => {
  const calendar = buildCalendar({ window, today: iso('2026-11-02') }, [
    member('ada', '2026-11-01', { kind: 'every_day', anchorOn: iso('2026-11-01') }, { '2026-11-02': 'green' }),
  ])
  assert.deepEqual(marks(calendar.rows[0]?.days ?? []), ['red', 'green'])
})

test('the columns stop at the end date once the challenge is over and are absent before it starts', () => {
  const over = buildCalendar({ window, today: iso('2027-01-15') }, [])
  assert.equal(over.days.length, 30)
  assert.equal(over.days.at(-1), '2026-11-30')
  assert.deepEqual(buildCalendar({ window, today: iso('2026-10-20') }, []).days, [])
})

test('the heatmap puts weeks in columns and weekdays in rows', () => {
  const days = buildCalendar({ window: { ...window, startsOn: iso('2026-11-03') }, today: iso('2026-11-12') }, [
    member('ada', '2026-11-01', { kind: 'every_day', anchorOn: iso('2026-11-01') }),
  ]).rows[0]?.days
  const weeks = weeksOf(days ?? [])
  assert.equal(weeks.length, 2)
  assert.ok(weeks.every((week) => week.length === 7))
  assert.deepEqual(
    weeks.map((week) => week.map((slot) => slot?.day ?? null)),
    [
      [null, null, '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'],
      ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', null, null],
    ],
  )
})

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

async function activeCrew(): Promise<Crew> {
  const db = await openDatabase()
  const ada = await person(db, 'Ada')
  const grace = await person(db, 'Grace')
  const lin = await person(db, 'Lin')
  const created = await createGroup(db, ada, 'Morning run')
  if (!created.ok) throw new Error(created.failure)
  const groupId = created.groupId
  for (const who of [grace, lin]) {
    const joined = await joinGroup(db, who, groupId)
    if (!joined.ok) throw new Error(joined.failure)
  }
  await db.query(`UPDATE memberships SET joined_on = '2026-11-01' WHERE group_id = $1`, [groupId])
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
  for (const [who, interval, anchorOn] of [
    [ada, 'every_day', '2026-11-01'],
    [grace, 'every_2_days', '2026-11-02'],
    [lin, 'every_day', '2026-11-01'],
  ] as const) {
    const rhythm = await saveRhythm(db, who, groupId, { interval, anchorOn })
    if (!rhythm.ok) throw new Error(rhythm.failure)
  }
  const started = await startChallenge(db, ada, groupId)
  if (!started.ok) throw new Error(started.failure)
  return { db, ada, grace, lin, groupId }
}

test('the home heatmap reads only the signed-in member days in active challenges', async () => {
  const { db, ada, grace, groupId } = await activeCrew()
  try {
    await logCheckIn(db, ada, groupId, { day: '2026-11-02', color: 'green' })
    await logCheckIn(db, grace, groupId, { day: '2026-11-02', color: 'red' })
    const [heatmap, ...rest] = await listHeatmaps(db, ada, iso('2026-11-03'))
    assert.equal(rest.length, 0)
    assert.equal(heatmap?.groupId, groupId)
    assert.deepEqual(
      heatmap?.weeks[0]?.map((slot) => slot?.mark ?? null),
      ['red', 'green', 'empty', null, null, null, null],
    )
    assert.deepEqual(await listHeatmaps(db, await person(db, 'Noor'), iso('2026-11-03')), [])
  } finally {
    await db.close()
  }
})

function rowMarks(html: string, marker: string): Record<string, string> {
  const start = html.indexOf(marker)
  assert.ok(start >= 0, `${marker} is on the page`)
  const end = html.indexOf('</tr>', start)
  const row = html.slice(start, end)
  return Object.fromEntries([...row.matchAll(/data-day="([^"]+)" data-mark="([^"]+)"/g)].map((m) => [m[1], m[2]]))
}

function heatmapMarks(html: string): Record<string, string> {
  const start = html.indexOf('class="grid heatmap"')
  assert.ok(start >= 0, 'heatmap is on home')
  const table = html.slice(start, html.indexOf('</table>', start))
  const out: Record<string, string> = {}
  for (const row of table.matchAll(/<tr data-weekday="(\d)">([\s\S]*?)<\/tr>/g)) {
    for (const cell of (row[2] ?? '').matchAll(/data-day="([^"]+)" data-mark="([^"]+)"/g)) {
      out[`${cell[1]}@${row[1]}`] = cell[2] ?? ''
    }
  }
  return out
}

test('replacing a check-in updates the group calendar and the home heatmap', async () => {
  const { db, ada, grace, groupId } = await activeCrew()
  const adaCookie = `session=${encodeURIComponent(await createSession(db, ada.id))}`
  const app = createApp({
    db,
    config: { clientId: 'client-id', clientSecret: 'client-secret' },
    today: () => iso('2026-11-04'),
  })
  const server = createServer((req, res) => {
    void app(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const groupPath = `/groups/${groupId}`
  const page = async (path: string) => (await fetch(`${base}${path}`, { headers: { cookie: adaCookie } })).text()
  const log = (day: string, color: string) =>
    fetch(`${base}${groupPath}/check-in`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: adaCookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ day, color }).toString(),
    })
  try {
    await logCheckIn(db, grace, groupId, { day: '2026-11-02', color: 'green' })
    assert.equal((await log('2026-11-03', 'green')).status, 303)

    const before = await page(groupPath)
    assert.deepEqual(rowMarks(before, `data-member="${ada.id}"`), {
      '2026-11-01': 'red',
      '2026-11-02': 'red',
      '2026-11-03': 'green',
      '2026-11-04': 'empty',
    })
    assert.deepEqual(rowMarks(before, `data-member="${grace.id}"`), {
      '2026-11-01': 'blank',
      '2026-11-02': 'green',
      '2026-11-03': 'blank',
      '2026-11-04': 'empty',
    })
    assert.match(before, /aria-label="2026-11-03 Kept it"/)
    assert.deepEqual(heatmapMarks(await page('/')), {
      '2026-11-01@0': 'red',
      '2026-11-02@1': 'red',
      '2026-11-03@2': 'green',
      '2026-11-04@3': 'empty',
    })

    assert.equal((await log('2026-11-03', 'red')).status, 303)
    assert.equal(rowMarks(await page(groupPath), `data-member="${ada.id}"`)['2026-11-03'], 'red')
    assert.equal(heatmapMarks(await page('/'))['2026-11-03@2'], 'red')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await db.close()
  }
})

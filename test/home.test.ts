import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseIsoDate, saveRhythm, startChallenge, type IsoDate } from '../src/challenge.ts'
import { logCheckIn } from '../src/checkins.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import type { GroupId } from '../src/groups.ts'
import type { DayStatus } from '../src/calendar.ts'
import { listHomeCards } from '../src/home.ts'
import type { Account } from '../src/identity.ts'
import { CHECK_IN_TODAY, closeServer, cookieFor, groupWith, listen, person, post, setJoinedOn } from './support/fixtures.ts'

function iso(raw: string): IsoDate {
  const day = parseIsoDate(raw)
  if (!day) throw new Error(raw)
  return day
}

type Pair = { db: Database; ada: Account; grace: Account; groupId: GroupId }

async function startedPair(startsOn = '2026-11-01'): Promise<Pair> {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const grace = await person(db, 'Grace')
  const groupId = await groupWith(db, [ada, grace], 'No sweets', { terms: { startsOn } })
  await setJoinedOn(db, groupId, startsOn)
  const rhythm = await saveRhythm(db, grace, groupId, { interval: 'every_2_days' })
  if (!rhythm.ok) throw new Error(rhythm.failure)
  const started = await startChallenge(db, ada, groupId)
  if (!started.ok) throw new Error(started.failure)
  return { db, ada, grace, groupId }
}

async function statuses(db: Database, who: Account, today: string): Promise<Record<string, DayStatus>> {
  const [card] = await listHomeCards(db, who, iso(today))
  if (card?.challenge.phase !== 'active') throw new Error('active card')
  return Object.fromEntries(card.challenge.days.map((line) => [line.day, line.status]))
}

test('each card knows yesterday, today, and tomorrow as due, kept, missed, or not due', async () => {
  const { db, ada, grace, groupId } = await startedPair()
  try {
    await logCheckIn(db, ada, groupId, { day: '2026-11-03', color: 'green' }, CHECK_IN_TODAY)
    await logCheckIn(db, ada, groupId, { day: '2026-11-05', color: 'red' }, CHECK_IN_TODAY)
    assert.deepEqual(await statuses(db, ada, '2026-11-04'), { '2026-11-03': 'kept', '2026-11-04': 'due', '2026-11-05': 'missed' })
    assert.deepEqual(await statuses(db, grace, '2026-11-04'), { '2026-11-03': 'due', '2026-11-04': 'not_due', '2026-11-05': 'due' })
  } finally {
    await closeDatabase(db)
  }
})

test('a challenge that has not reached its first day says when it starts, and a draft says it has not started', async () => {
  const { db, ada } = await startedPair('2026-11-10')
  const lin = await person(db, 'Lin')
  await groupWith(db, [lin], 'Read daily')
  try {
    assert.deepEqual(await statuses(db, ada, '2026-11-04'), {
      '2026-11-03': 'before_start',
      '2026-11-04': 'before_start',
      '2026-11-05': 'before_start',
    })
    const [draft] = await listHomeCards(db, lin, iso('2026-11-04'))
    assert.deepEqual(draft?.challenge, { phase: 'draft' })
    const { server, base } = await listen(db, { today: () => iso('2026-11-04') })
    try {
      const html = await (await fetch(`${base}/`, { headers: { cookie: await cookieFor(db, ada) } })).text()
      assert.match(html, /<div class="today" data-day="2026-11-04"><p class="today-status">Starts on <time datetime="2026-11-10">2026-11-10<\/time><\/p><\/div>/)
      assert.doesNotMatch(html, /class="card-log"/)
    } finally {
      await closeServer(server)
    }
  } finally {
    await closeDatabase(db)
  }
})

test('logging from a Home card returns to Home with the usual toast and shows the day as kept', async () => {
  const { db, ada, groupId } = await startedPair()
  const cookie = await cookieFor(db, ada)
  const { server, base } = await listen(db, { today: () => iso('2026-11-04') })
  const home = async () => (await fetch(`${base}/`, { headers: { cookie } })).text()
  try {
    const before = await home()
    assert.match(before, /<div class="today" data-day="2026-11-04"><p class="today-status">Today is due<\/p><form class="card-log" method="post" action="\/groups\/[^"]+\/check-in">/)
    assert.match(before, /<div class="today" data-day="2026-11-03" hidden>/, 'only the server day shows before the script runs')
    assert.match(before, /<input type="hidden" name="day" value="2026-11-04">\s*<input type="hidden" name="return" value="\/">/)

    const logged = await post(base, `/groups/${groupId}/check-in`, cookie, new URLSearchParams({ day: '2026-11-04', color: 'green', return: '/' }).toString())
    assert.equal(logged.status, 303)
    assert.equal(logged.headers.get('location'), '/')
    assert.match(logged.headers.get('set-cookie') ?? '', /toast=/)

    const after = await home()
    assert.match(after, /<div class="today" data-day="2026-11-04"><p class="today-status kept">Kept today ✓<\/p><\/div>/)

    const fromPage = await post(base, `/groups/${groupId}/check-in`, cookie, new URLSearchParams({ day: '2026-11-04', color: 'red' }).toString())
    assert.equal(fromPage.headers.get('location'), `/groups/${groupId}`, 'the challenge page still returns to itself')
    assert.match(await home(), /<p class="today-status missed">Missed today<\/p>/)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

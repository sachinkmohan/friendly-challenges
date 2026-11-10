import assert from 'node:assert/strict'
import { test } from 'node:test'
import { upsertAccount } from '../src/accounts.ts'
import { recordPayment } from '../src/balances.ts'
import { parseIsoDate, saveChallenge, saveRhythm, startChallenge, type IsoDate } from '../src/challenge.ts'
import { logCheckIn } from '../src/checkins.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import type { GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import { readUsers } from '../src/store.ts'
import { CHECK_IN_TODAY, closeServer, cookieFor, groupWith, listen, person, post, setJoinedOn, setLeftOn } from './support/fixtures.ts'

function iso(raw: string): IsoDate {
  const day = parseIsoDate(raw)
  if (!day) throw new Error(raw)
  return day
}

const today = () => iso('2026-11-04')

type Crew = { db: Database; ada: Account; grace: Account; lin: Account; groupId: GroupId }

async function startWith(db: Database, people: readonly Account[], groupId: GroupId, startsOn: string): Promise<void> {
  await setJoinedOn(db, groupId, startsOn)
  const saved = await saveChallenge(db, people[0] as Account, groupId, {
    name: 'No sweets',
    type: 'no_sugar',
    customLabel: '',
    currency: 'USD',
    stake: '5',
    startsOn,
    endsOn: '2026-11-30',
  })
  if (!saved.ok) throw new Error(saved.failure)
  for (const who of people) {
    const rhythm = await saveRhythm(db, who, groupId, { interval: 'every_day' })
    if (!rhythm.ok) throw new Error(rhythm.failure)
  }
  const started = await startChallenge(db, people[0] as Account, groupId)
  if (!started.ok) throw new Error(started.failure)
}

// Through 3 Nov: Ada keeps every day, Grace misses the 3rd, Lin misses all three.
// Ada is ahead by 20, Grace ahead by 5, Lin behind by 25, so the bags are 4, 1 and 5.
async function crew(startsOn = '2026-11-01'): Promise<Crew> {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada Lovelace')
  const grace = await person(db, 'Grace Hopper')
  const lin = await person(db, 'Lin')
  const groupId = await groupWith(db, [ada, grace, lin])
  await startWith(db, [ada, grace, lin], groupId, startsOn)
  if (startsOn === '2026-11-01') {
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-03']) {
      await logCheckIn(db, ada, groupId, { day, color: 'green' }, CHECK_IN_TODAY)
    }
    for (const day of ['2026-11-01', '2026-11-02']) {
      await logCheckIn(db, grace, groupId, { day, color: 'green' }, CHECK_IN_TODAY)
    }
  }
  return { db, ada, grace, lin, groupId }
}

type Item = { member: string; standing: string; label: string; bags: string; link: boolean; html: string }

function rowOf(html: string, groupId: GroupId): Item[] | null {
  const start = html.indexOf(`<ul class="standings"`)
  const at = html.indexOf(`data-group="${groupId}">`, start)
  if (start < 0 || at < 0) return null
  const ul = html.lastIndexOf('<ul class="standings"', at)
  const row = html.slice(ul, html.indexOf('</ul>', ul))
  return [...row.matchAll(/<li data-member="([^"]+)" data-standing="([^"]+)">([\s\S]*?)<\/li>/g)].map((m) => {
    const body = m[3] ?? ''
    return {
      member: m[1] ?? '',
      standing: m[2] ?? '',
      label: /aria-label="([^"]*)"/.exec(body)?.[1] ?? '',
      bags: /<span class="bags" aria-hidden="true">([^<]*)<\/span>/.exec(body)?.[1] ?? '',
      link: body.startsWith('<a '),
      html: body,
    }
  })
}

async function home(base: string, cookie: string): Promise<string> {
  return (await fetch(`${base}/`, { headers: { cookie } })).text()
}

function badgeForm(emoji: string): string {
  return new URLSearchParams({ emoji }).toString()
}

test('under a group heatmap, the row shows each member richest first with bags and no amounts', async () => {
  const { db, ada, grace, lin, groupId } = await crew()
  const { server, base } = await listen(db, { today })
  try {
    const html = await home(base, await cookieFor(db, ada))
    const table = html.indexOf(`<table class="grid heatmap" data-group="${groupId}">`)
    assert.ok(table >= 0)
    const afterTable = html.indexOf('</table></div>', table) + '</table></div>'.length
    assert.ok(html.startsWith('<ul class="standings"', afterTable), 'the row sits right under the heatmap')
    const row = rowOf(html, groupId)
    assert.deepEqual(
      row?.map((item) => [item.member, item.standing, item.bags]),
      [
        [ada.id, 'ahead', '💰💰💰💰'],
        [grace.id, 'ahead', '💰'],
        [lin.id, 'behind', '💸💸💸💸💸'],
      ],
    )
    assert.deepEqual(row?.map((item) => item.label), ['Ada, ahead. Change your badge', 'Grace, ahead', 'Lin, behind'])
    assert.match(row?.[1]?.html ?? '', /<span class="avatar badge-initials" aria-hidden="true">GH<\/span>/)
    assert.match(row?.[2]?.html ?? '', />LI<\/span>/)
    assert.match(row?.[1]?.html ?? '', /<span class="badge-name" aria-hidden="true">Grace<\/span>/)
    const rowHtml = row?.map((item) => item.html).join('') ?? ''
    assert.doesNotMatch(rowHtml, /\d/, 'no amounts in the row')
    // The heatmap keeps the viewer's own colors.
    assert.match(html, /data-day="2026-11-03" data-mark="green"/)
    assert.match(html, /data-day="2026-11-04" data-mark="empty"/)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('a payment does not change the bags', async () => {
  const { db, ada, lin, groupId } = await crew()
  const { server, base } = await listen(db, { today })
  try {
    const cookie = await cookieFor(db, ada)
    const before = rowOf(await home(base, cookie), groupId)
    const paid = await recordPayment(db, lin, groupId, { payeeId: ada.id, amount: '20', paidOn: '2026-11-04', paypalRef: '' }, today())
    assert.ok(paid.ok)
    assert.deepEqual(rowOf(await home(base, cookie), groupId), before)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('a member who left is not in the row but their missed days still count', async () => {
  const { db, ada, grace, lin, groupId } = await crew()
  await setLeftOn(db, groupId, lin.id, '2026-11-03')
  const { server, base } = await listen(db, { today })
  try {
    const row = rowOf(await home(base, await cookieFor(db, grace)), groupId)
    assert.deepEqual(
      row?.map((item) => [item.member, item.standing, item.bags]),
      [
        [ada.id, 'ahead', '💰💰💰💰'],
        [grace.id, 'ahead', '💰'],
      ],
    )
    assert.deepEqual(row?.map((item) => item.link), [false, true])
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('everyone even shows a dash for each member', async () => {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const grace = await person(db, 'Grace')
  const groupId = await groupWith(db, [ada, grace])
  await startWith(db, [ada, grace], groupId, '2026-11-04')
  const { server, base } = await listen(db, { today })
  try {
    const row = rowOf(await home(base, await cookieFor(db, ada)), groupId)
    assert.deepEqual(
      row?.map((item) => [item.standing, item.bags]),
      [
        ['even', '—'],
        ['even', '—'],
      ],
    )
    assert.equal(row?.[1]?.label, 'Grace, even')
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('a solo challenge has no row', async () => {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const groupId = await groupWith(db, [ada], 'Solo', { cause: 'Food bank' })
  await setJoinedOn(db, groupId, '2026-11-01')
  const started = await startChallenge(db, ada, groupId)
  if (!started.ok) throw new Error(started.failure)
  const { server, base } = await listen(db, { today })
  try {
    const html = await home(base, await cookieFor(db, ada))
    assert.match(html, new RegExp(`<table class="grid heatmap" data-group="${groupId}">`))
    assert.doesNotMatch(html, /<ul class="standings"/)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('before the first day the row shows badges and names but no standing', async () => {
  const { db, ada, groupId } = await crew('2026-11-10')
  const { server, base } = await listen(db, { today })
  try {
    const html = await home(base, await cookieFor(db, ada))
    assert.match(html, /The first day is <time datetime="2026-11-10">/)
    const row = rowOf(html, groupId)
    assert.equal(row?.length, 3)
    assert.deepEqual(row?.map((item) => [item.standing, item.bags]), [
      ['none', ''],
      ['none', ''],
      ['none', ''],
    ])
    assert.deepEqual(row?.map((item) => item.label), ['Ada. Change your badge', 'Grace', 'Lin'])
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('only the viewer badge links to the badge page', async () => {
  const { db, ada, lin, groupId } = await crew()
  const { server, base } = await listen(db, { today })
  try {
    const html = await home(base, await cookieFor(db, lin))
    const row = rowOf(html, groupId)
    assert.deepEqual(row?.map((item) => item.link), [false, false, true])
    assert.equal(row?.[0]?.member, ada.id)
    assert.match(row?.[2]?.html ?? '', /^<a class="row-badge" href="\/badge"/)
    assert.equal(html.match(/href="\/badge"/g)?.length, 1)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('picking an emoji shows it in the row with a toast once, and initials clear it', async () => {
  const { db, ada, grace, groupId } = await crew()
  const { server, base } = await listen(db, { today })
  try {
    const cookie = await cookieFor(db, ada)
    const page = await fetch(`${base}/badge`, { headers: { cookie } })
    assert.equal(page.status, 200)
    const pageHtml = await page.text()
    assert.match(pageHtml, /<button type="submit" name="emoji" value="🦊" aria-pressed="false">/)
    assert.match(pageHtml, /value="initials" aria-pressed="true">Use initials \(AL\)</)

    const saved = await post(base, '/badge', cookie, badgeForm('🦊'))
    assert.equal(saved.status, 303)
    assert.equal(saved.headers.get('location'), '/')
    const toast = saved.headers.getSetCookie().find((line) => line.startsWith('toast='))?.split(';')[0]
    assert.ok(toast)
    const landed = await home(base, `${cookie}; ${toast}`)
    assert.match(landed, /<div class="toast" role="status" aria-live="polite">\s*<p>Badge updated\.<\/p>/)
    assert.match(rowOf(landed, groupId)?.[0]?.html ?? '', /<span class="avatar badge-emoji" aria-hidden="true">🦊<\/span>/)
    assert.doesNotMatch(await home(base, cookie), /class="toast"/)

    const graceView = rowOf(await home(base, await cookieFor(db, grace)), groupId)
    assert.match(graceView?.[0]?.html ?? '', />🦊<\/span>/)
    assert.match(await (await fetch(`${base}/badge`, { headers: { cookie } })).text(), /value="🦊" aria-pressed="true"/)

    assert.equal((await post(base, '/badge', cookie, badgeForm('initials'))).status, 303)
    assert.match(rowOf(await home(base, cookie), groupId)?.[0]?.html ?? '', /badge-initials" aria-hidden="true">AL</)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('an emoji off the list is refused and leaves the badge as it was', async () => {
  const { db, ada } = await crew()
  const { server, base } = await listen(db, { today })
  try {
    const cookie = await cookieFor(db, ada)
    assert.equal((await post(base, '/badge', cookie, badgeForm('🐶'))).status, 303)
    const refused = await post(base, '/badge', cookie, badgeForm('💰'))
    assert.equal(refused.status, 400)
    assert.match(await refused.text(), /Pick one of the badges below\./)
    assert.equal((await post(base, '/badge', cookie, badgeForm(''))).status, 400)
    assert.equal((await readUsers(db, [ada.id])).get(ada.id)?.badgeEmoji, '🐶')
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('a signed-out visitor is asked to sign in and cannot save a badge', async () => {
  const db = openTestDatabase()
  const { server, base } = await listen(db, { today })
  try {
    const page = await fetch(`${base}/badge`)
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /Sign in to pick your badge\./)
    assert.match(html, /<input type="hidden" name="return" value="\/badge">/)
    assert.equal((await post(base, '/badge', null, badgeForm('🦊'))).status, 401)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('signing in again keeps the chosen badge', async () => {
  const { db, ada } = await crew('2026-11-10')
  const { server, base } = await listen(db, { today })
  try {
    assert.equal((await post(base, '/badge', await cookieFor(db, ada), badgeForm('🚀'))).status, 303)
    const again = await upsertAccount(db, {
      sub: ada.googleSub,
      email: ada.email,
      emailVerified: true,
      displayName: ada.displayName,
      avatarUrl: null,
    })
    assert.ok(again.ok)
    assert.equal((await readUsers(db, [ada.id])).get(ada.id)?.badgeEmoji, '🚀')
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

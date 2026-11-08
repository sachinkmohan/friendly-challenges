import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseIsoDate, saveChallenge, saveRhythm, startChallenge, type IsoDate } from '../src/challenge.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { parseGroupId, type GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import { closeServer, cookieFor, groupWith, listen, person, post, setJoinedOn } from './support/fixtures.ts'

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
    currency: 'INR',
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

function fields(values: Record<string, string>): string {
  return new URLSearchParams(values).toString()
}

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  return headers.getSetCookie?.() ?? []
}

function toastLine(response: Response): string | null {
  return setCookies(response).find((line) => line.startsWith('toast=')) ?? null
}

function toastPair(response: Response): string {
  const line = toastLine(response)
  if (!line) throw new Error('no toast cookie')
  return line.split(';')[0] as string
}

function toastShown(html: string): string | null {
  const match = /<div class="toast" role="status" aria-live="polite">\s*<p>([^<]*)<\/p>/.exec(html)
  return match ? (match[1] as string) : null
}

async function land(base: string, response: Response, session: string): Promise<Response> {
  const location = response.headers.get('location')
  if (!location) throw new Error('no redirect')
  return fetch(`${base}${location}`, { headers: { cookie: `${session}; ${toastPair(response)}` } })
}

function iso(raw: string): IsoDate {
  const day = parseIsoDate(raw)
  if (!day) throw new Error(raw)
  return day
}

const today = () => iso('2026-11-06')

test('a logged day sets a toast that the next page shows once and clears', async () => {
  const { db, ada, groupId } = await activeCrew()
  const adaCookie = await cookieFor(db, ada)
  const { server, base } = await listen(db, { today })
  const groupPath = `/groups/${groupId}`
  try {
    const logged = await post(base, `${groupPath}/check-in`, adaCookie, fields({ day: '2026-11-04', color: 'green' }))
    assert.equal(logged.status, 303)
    const line = toastLine(logged)
    assert.ok(line)
    assert.match(line, /HttpOnly/)
    assert.match(line, /SameSite=Lax/)
    assert.match(line, /Max-Age=60/)

    const page = await land(base, logged, adaCookie)
    assert.equal(page.status, 200)
    assert.equal(toastShown(await page.text()), 'Logged Wed 4 Nov as green.')
    const cleared = toastLine(page)
    assert.ok(cleared)
    assert.match(cleared, /^toast=;/)
    assert.match(cleared, /Max-Age=0/)

    const again = await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })
    const html = await again.text()
    assert.equal(toastShown(html), null)
    assert.doesNotMatch(html, /class="toast"/)
    assert.equal(toastLine(again), null)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('logging a day again names the colour it changed from, or just logs it when the colour is the same', async () => {
  const { db, ada, groupId } = await activeCrew()
  const adaCookie = await cookieFor(db, ada)
  const { server, base } = await listen(db, { today })
  const checkInPath = `/groups/${groupId}/check-in`
  const shown = async (color: string) => {
    const logged = await post(base, checkInPath, adaCookie, fields({ day: '2026-11-03', color }))
    assert.equal(logged.status, 303)
    return toastShown(await (await land(base, logged, adaCookie)).text())
  }
  try {
    assert.equal(await shown('red'), 'Logged Tue 3 Nov as red.')
    assert.equal(await shown('green'), 'Changed Tue 3 Nov from red to green.')
    assert.equal(await shown('green'), 'Logged Tue 3 Nov as green.')
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('a failed log shows its error inline and sets no toast', async () => {
  const { db, ada, groupId } = await activeCrew()
  const adaCookie = await cookieFor(db, ada)
  const { server, base } = await listen(db, { today })
  try {
    const failed = await post(base, `/groups/${groupId}/check-in`, adaCookie, fields({ day: '2026-11-04', color: 'amber' }))
    assert.equal(failed.status, 400)
    assert.equal(toastLine(failed), null)
    const html = await failed.text()
    assert.match(html, /Pick green or red\./)
    assert.equal(toastShown(html), null)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('a recorded payment names the amount in the ledger format and the payee', async () => {
  const { db, ada, grace, groupId } = await activeCrew()
  const graceCookie = await cookieFor(db, grace)
  const { server, base } = await listen(db, { today })
  try {
    const paid = await post(
      base,
      `/groups/${groupId}/payment`,
      graceCookie,
      fields({ payee: ada.id, amount: '200', paid_on: '2026-11-05', paypal_ref: '' }),
    )
    assert.equal(paid.status, 303)
    assert.equal(toastShown(await (await land(base, paid, graceCookie)).text()), 'Recorded 200.00 INR paid to Ada.')
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('leaving lands on home with the last day, and the creator recording someone else names them', async () => {
  const { db, ada, grace, lin, groupId } = await activeCrew()
  const adaCookie = await cookieFor(db, ada)
  const linCookie = await cookieFor(db, lin)
  const { server, base } = await listen(db, { today })
  const dropoutPath = `/groups/${groupId}/dropout`
  try {
    const left = await post(base, dropoutPath, linCookie, fields({ member: lin.id, last_day: '2026-11-05' }))
    assert.equal(left.status, 303)
    assert.equal(left.headers.get('location'), '/')
    assert.equal(toastShown(await (await land(base, left, linCookie)).text()), 'You left Morning run. Your last day is Thu 5 Nov.')

    const dropped = await post(base, dropoutPath, adaCookie, fields({ member: grace.id, last_day: '2026-11-05' }))
    assert.equal(dropped.status, 303)
    assert.equal(dropped.headers.get('location'), `/groups/${groupId}`)
    assert.equal(toastShown(await (await land(base, dropped, adaCookie)).text()), 'Recorded Grace&#39;s last day as Thu 5 Nov.')
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('deleting a group shows the toast on home', async () => {
  const { db, ada, groupId } = await activeCrew()
  const adaCookie = await cookieFor(db, ada)
  const { server, base } = await listen(db, { today })
  try {
    const deleted = await post(base, `/groups/${groupId}/delete`, adaCookie, 'confirm=yes')
    assert.equal(deleted.status, 303)
    assert.equal(deleted.headers.get('location'), '/')
    assert.equal(toastShown(await (await land(base, deleted, adaCookie)).text()), 'Deleted Morning run.')
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('creating, joining, saving terms, picking a rhythm and starting each confirm with a toast', async () => {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const grace = await person(db, 'Grace')
  const lin = await person(db, 'Lin')
  const adaCookie = await cookieFor(db, ada)
  const graceCookie = await cookieFor(db, grace)
  const linCookie = await cookieFor(db, lin)
  const { server, base } = await listen(db, { today })
  try {
    const created = await post(base, '/groups', adaCookie, fields({ name: 'Evening swim' }))
    assert.equal(created.status, 303)
    assert.equal(toastShown(await (await land(base, created, adaCookie)).text()), 'Created Evening swim.')
    const groupPath = created.headers.get('location') ?? ''
    const groupId = parseGroupId(groupPath.slice('/groups/'.length))
    assert.ok(groupId)

    for (const cookie of [graceCookie, linCookie]) {
      const joined = await post(base, `${groupPath}/join`, cookie, '')
      assert.equal(joined.status, 303)
      assert.equal(toastShown(await (await land(base, joined, cookie)).text()), 'Joined Evening swim.')
    }

    const terms = await post(
      base,
      `${groupPath}/challenge`,
      adaCookie,
      fields({
        name: 'Swim laps',
        type: 'custom',
        custom_label: 'Swimming',
        currency: 'USD',
        stake: '5',
        starts_on: '2026-11-01',
        ends_on: '2026-11-30',
      }),
    )
    assert.equal(terms.status, 303)
    assert.equal(toastShown(await (await land(base, terms, adaCookie)).text()), 'Saved the terms for Swim laps.')

    const everyOther = await post(base, `${groupPath}/rhythm`, adaCookie, fields({ interval: 'every_2_days' }))
    assert.equal(everyOther.status, 303)
    assert.equal(toastShown(await (await land(base, everyOther, adaCookie)).text()), 'You now log every 2 days.')
    for (const cookie of [graceCookie, linCookie]) {
      const daily = await post(base, `${groupPath}/rhythm`, cookie, fields({ interval: 'every_day' }))
      assert.equal(toastShown(await (await land(base, daily, cookie)).text()), 'You now log every day.')
    }

    const started = await post(base, `${groupPath}/challenge/start`, adaCookie, fields({ cause: '' }))
    assert.equal(started.status, 303)
    assert.equal(toastShown(await (await land(base, started, adaCookie)).text()), 'Started Swim laps.')
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('a page without a toast cookie draws no toast, and a forged cookie is escaped or dropped', async () => {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const adaCookie = await cookieFor(db, ada)
  const { server, base } = await listen(db, { today })
  const home = (cookie: string) => fetch(`${base}/`, { headers: { cookie } })
  try {
    const plain = await home(adaCookie)
    const html = await plain.text()
    assert.doesNotMatch(html, /class="toast"/)
    assert.equal(toastLine(plain), null)

    const forged = await home(`${adaCookie}; toast=${encodeURIComponent('<b>hi</b>')}`)
    assert.equal(toastShown(await forged.text()), '&lt;b&gt;hi&lt;/b&gt;')

    const long = await home(`${adaCookie}; toast=${'x'.repeat(201)}`)
    assert.doesNotMatch(await long.text(), /class="toast"/)
    assert.match(toastLine(long) ?? '', /Max-Age=0/)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseIsoDate, saveRhythm, startChallenge, type IsoDate } from '../src/challenge.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { joinGroup, type GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import { closeServer, cookieFor, groupWith, listen, person, post, setJoinedOn } from './support/fixtures.ts'

function iso(raw: string): IsoDate {
  const day = parseIsoDate(raw)
  if (!day) throw new Error(raw)
  return day
}

const today = iso('2026-11-04')

type Crew = {
  readonly db: Database
  readonly ada: Account
  readonly grace: Account
  readonly groupId: GroupId
  readonly base: string
  readonly page: (who: Account) => Promise<string>
  readonly send: (who: Account, suffix: string, form: Record<string, string>) => Promise<Response>
}

// Ada logs every day; Grace every 2 days, so 4 Nov is not one of her days.
async function withCrew(run: (crew: Crew) => Promise<void>): Promise<void> {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const grace = await person(db, 'Grace')
  const groupId = await groupWith(db, [ada, grace], 'No sweets')
  await setJoinedOn(db, groupId, '2026-11-01')
  const rhythm = await saveRhythm(db, grace, groupId, { interval: 'every_2_days' })
  if (!rhythm.ok) throw new Error(rhythm.failure)
  const started = await startChallenge(db, ada, groupId)
  if (!started.ok) throw new Error(started.failure)
  const { server, base } = await listen(db, { today: () => today })
  const path = `/groups/${groupId}`
  const page = async (who: Account) => (await fetch(`${base}${path}`, { headers: { cookie: await cookieFor(db, who) } })).text()
  const send = async (who: Account, suffix: string, form: Record<string, string>) =>
    post(base, `${path}${suffix}`, await cookieFor(db, who), new URLSearchParams(form).toString())
  try {
    await run({ db, ada, grace, groupId, base, page, send })
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
}

function between(html: string, start: string, end: string): string {
  const from = html.indexOf(start)
  assert.ok(from >= 0, `${start} is on the page`)
  const to = html.indexOf(end, from + start.length)
  return html.slice(from, to === -1 ? undefined : to)
}

// The server's own day, up to the next day's block or the Log a different day row.
function serverDay(html: string): string {
  const block = between(html, `<div class="today" data-day="${today}">`, '<details class="other-day"')
  const next = block.indexOf('<div class="today"', 1)
  return next === -1 ? block : block.slice(0, next)
}

// Up to the next folded row, so the rows nested inside a fold stay in it.
function fold(html: string, id: string): string {
  const start = `<details class="fold" id="${id}"`
  const from = html.indexOf(start)
  assert.ok(from >= 0, `${start} is on the page`)
  const next = html.indexOf('<details class="fold"', from + start.length)
  return html.slice(from, next === -1 ? html.indexOf('</article>', from) : next)
}

test('a started challenge reads top to bottom: terms line, today, calendar, then four closed rows', async () => {
  await withCrew(async ({ ada, page }) => {
    const html = await page(ada)
    const order = [
      '<p class="terms-line">5.00 USD per missed day · 1\u00a0Nov – 30\u00a0Nov · 2 active</p>',
      '<section class="today-area" data-days>',
      '<p class="grid-title">Calendar</p>',
      '<details class="fold" id="money">',
      '<details class="fold" id="members">',
      '<details class="fold" id="history">',
      '<details class="fold" id="manage">',
    ].map((marker) => html.indexOf(marker))
    assert.ok(order.every((at) => at > -1), `every section is present: ${order}`)
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections are in order')
    assert.doesNotMatch(html, /<details class="fold"[^>]* open>/, 'every row starts closed')
    assert.doesNotMatch(html, /<p class="count">/, 'the active count lives in the terms line')
  })
})

test('today takes one tap with no date picker, then shows its color with a Change to the other one', async () => {
  await withCrew(async ({ ada, groupId, page, send }) => {
    const due = serverDay(await page(ada))
    assert.match(due, /Today is due/)
    assert.match(due, new RegExp(`<input type="hidden" name="day" value="${today}">`))
    assert.match(due, /value="green">Kept it<\/button><button[^>]*value="red">Missed it<\/button>/)
    assert.doesNotMatch(due, /type="date"/)

    const logged = await send(ada, '/check-in', { day: today, color: 'green' })
    assert.equal(logged.status, 303)
    assert.equal(logged.headers.get('location'), `/groups/${groupId}`)

    const kept = serverDay(await page(ada))
    assert.match(kept, /Today: kept ✓/)
    assert.match(kept, /<details class="change"><summary>Change<\/summary>/)
    assert.match(kept, /value="red">Missed it/)
    assert.doesNotMatch(kept, /Kept it/)

    assert.equal((await send(ada, '/check-in', { day: today, color: 'red' })).status, 303)
    const missed = serverDay(await page(ada))
    assert.match(missed, /Today: missed/)
    assert.match(missed, /value="green">Kept it/)
  })
})

test('a day that is not yours to log says so, and Log a different day still catches up on a past day', async () => {
  await withCrew(async ({ grace, page, send }) => {
    const html = await page(grace)
    assert.match(serverDay(html), /Today is not a logging day for you\./)
    const other = between(html, '<details class="other-day">', '</details>')
    assert.match(other, /<summary>Log a different day<\/summary>/)
    assert.match(other, /<input id="check-in-day" name="day" type="date"/)

    assert.equal((await send(grace, '/check-in', { day: '2026-11-03', color: 'green' })).status, 303)
    assert.equal((await send(grace, '/check-in', { day: '2026-11-03', color: 'red' })).status, 303)
    assert.match(fold(await page(grace), 'history'), /Grace <time datetime="2026-11-03">2026-11-03<\/time><\/span> <span>Red<\/span>/)
  })
})

test('a failed form opens its own row and shows the error next to the form', async () => {
  await withCrew(async ({ ada, grace, send }) => {
    const checkIn = await (await send(ada, '/check-in', { day: '2026-11-02', color: 'blue' })).text()
    const other = between(checkIn, '<details class="other-day" open>', '</details>')
    assert.match(other, /class="form-error" role="alert"/)
    assert.doesNotMatch(checkIn, /<details class="fold"[^>]* open>/)

    const payment = await (await send(ada, '/payment', { payee: grace.id, amount: '0', paid_on: '2026-11-03', paypal_ref: '' })).text()
    const money = fold(payment, 'money')
    assert.match(money, /^<details class="fold" id="money" open>/)
    assert.match(money, /<p class="form-error" role="alert">[^<]+<\/p>\s*<label for="payment-payee">/)
    assert.doesNotMatch(fold(payment, 'manage'), / open>/)

    const deletion = await (await send(grace, '/delete', { confirm: 'yes' })).text()
    const manage = fold(deletion, 'manage')
    assert.match(manage, /^<details class="fold" id="manage" open>/)
    assert.match(manage, /<p class="form-error" role="alert">Only the person who made the challenge can delete it\.<\/p>/)
  })
})

test('a member who is not the creator and presses Start is told why at the top of today', async () => {
  await withCrew(async ({ grace, send }) => {
    const refused = await send(grace, '/challenge/start', {})
    assert.equal(refused.status, 403)
    const area = between(await refused.text(), '<section class="today-area" data-days>', '<details class="other-day"')
    assert.match(area, /class="form-error" role="alert"/)
  })
})

test('Members lists each badge and rhythm, and History lists the check-ins', async () => {
  await withCrew(async ({ ada, grace, page, send }) => {
    assert.match(fold(await page(ada), 'history'), /No check-ins yet\./)
    assert.equal((await send(ada, '/check-in', { day: '2026-11-02', color: 'green' })).status, 303)
    const html = await page(ada)
    const members = fold(html, 'members')
    assert.match(members, new RegExp(`<li data-member="${ada.id}"><span class="avatar badge-initials" aria-hidden="true">AD</span> <span class="member-name">Ada</span><span class="rhythm">Every day</span></li>`))
    assert.match(members, new RegExp(`<li data-member="${grace.id}">[^]*?<span class="rhythm">Every 2 days</span>`))
    assert.match(fold(html, 'history'), /Ada <time datetime="2026-11-02">2026-11-02<\/time><\/span> <span>Green<\/span>/)
  })
})

test('someone who joins after the start picks a rhythm where the log buttons would be', async () => {
  await withCrew(async ({ db, groupId, base, page }) => {
    const lin = await person(db, 'Lin')
    const joined = await joinGroup(db, lin, groupId)
    if (!joined.ok) throw new Error(joined.failure)
    const html = await page(lin)
    const area = between(html, '<section class="today-area">', '</section>')
    assert.match(area, /Pick your rhythm to start logging/)
    assert.doesNotMatch(area, /Kept it|Log a different day/)

    const refused = await post(base, `/groups/${groupId}/check-in`, await cookieFor(db, lin), new URLSearchParams({ day: '2026-11-04', color: 'green' }).toString())
    const shown = between(await refused.text(), '<section class="today-area">', '</section>')
    assert.match(shown, /class="form-error" role="alert"/, 'a refused log still says why')
  })
})

test('the folded Money row reads your own position, and Record a payment opens its form', async () => {
  await withCrew(async ({ ada, grace, page, send }) => {
    const note = (html: string) => /<span class="fold-note">([^<]+)<\/span>/.exec(fold(html, 'money'))?.[1]
    const adaHtml = await page(ada)
    assert.equal(note(adaHtml), 'You owe Grace 5.00 USD')
    assert.equal(note(await page(grace)), 'You are owed 5.00 USD')
    const money = fold(adaHtml, 'money')
    assert.match(money, /Ada owes Grace 5\.00 USD/)
    assert.match(money, /<details class="action record-payment"><summary>Record a payment<\/summary><form /, 'the payment form waits behind its button')
    assert.match(money, /<details class="action"><summary>All balances<\/summary><ul class="check-ins balances">/)

    const refused = await (await send(ada, '/payment', { payee: grace.id, amount: '0', paid_on: '2026-11-03', paypal_ref: 'pp-1' })).text()
    assert.match(fold(refused, 'money'), /<details class="action record-payment" open><summary>Record a payment<\/summary>[^]*name="paypal_ref" value="pp-1"/)

    assert.equal((await send(ada, '/payment', { payee: grace.id, amount: '5', paid_on: '2026-11-03', paypal_ref: '' })).status, 303)
    const paid = await page(ada)
    assert.equal(note(paid), 'You are even')
    assert.match(fold(paid, 'money'), /<details class="action"><summary>Payments<\/summary>[^]*Ada paid Grace 5\.00 USD/)
  })
})

test('Manage keeps every red button folded, and a member who is not the creator only sees Leave', async () => {
  await withCrew(async ({ ada, grace, page }) => {
    const titles = (html: string) => [...fold(html, 'manage').matchAll(/<details class="action"><summary>([^<]+)<\/summary>/g)].map((m) => m[1])
    const adaHtml = await page(ada)
    assert.deepEqual(titles(adaHtml), ['Leave this challenge', 'Record a dropout', 'Delete challenge'])
    assert.deepEqual(titles(await page(grace)), ['Leave this challenge'])
    const danger = adaHtml.indexOf('class="danger"')
    assert.ok(danger > adaHtml.indexOf('<details class="action"><summary>Delete challenge</summary>'), 'the red button sits inside the closed Delete challenge row')
    assert.match(fold(adaHtml, 'manage'), /<label class="confirm"><input type="checkbox" name="confirm" value="yes" required> Delete it for everyone<\/label>/)
  })
})

test('Invite a friend sits in Members with the link to copy by hand, and is gone once the challenge is full', async () => {
  await withCrew(async ({ db, ada, groupId, base, page }) => {
    const link = `${base}/groups/${groupId}`
    const members = fold(await page(ada), 'members')
    assert.match(members, /<button type="button" class="secondary invite-button" data-title="No sweets" hidden>Invite a friend<\/button>/)
    assert.match(members, new RegExp(`<input class="invite-link" type="text" readonly value="${link}"`))
    assert.doesNotMatch(await page(ada), /class="share"/, 'the raw link is gone from the bottom of the page')

    for (const name of ['Lin', 'Noor', 'Omar']) {
      const joined = await joinGroup(db, await person(db, name), groupId)
      if (!joined.ok) throw new Error(joined.failure)
    }
    assert.doesNotMatch(fold(await page(ada), 'members'), /<div class="invite">/)
  })
})

test('a solo challenge has no Invite a friend, and its Money row reads what you owe the cause', async () => {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const groupId = await groupWith(db, [ada], 'Run', { cause: 'Food bank' })
  await setJoinedOn(db, groupId, '2026-11-01')
  const started = await startChallenge(db, ada, groupId)
  if (!started.ok) throw new Error(started.failure)
  const { server, base } = await listen(db, { today: () => today })
  try {
    const html = await (await fetch(`${base}/groups/${groupId}`, { headers: { cookie: await cookieFor(db, ada) } })).text()
    assert.match(fold(html, 'money'), /<span class="fold-note">You owe Food bank 15\.00 USD<\/span>/)
    assert.doesNotMatch(fold(html, 'members'), /<div class="invite">/)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'
import { test } from 'node:test'
import { missedDayDebts, readLedger, recordPayment, settle, soloDue, type GroupLedger, type SoloLedger } from '../src/balances.ts'
import { buildCalendar, type CalendarMember } from '../src/calendar.ts'
import { parseIsoDate, saveChallenge, saveRhythm, startChallenge, type IsoDate } from '../src/challenge.ts'
import { logCheckIn } from '../src/checkins.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { recordDropout } from '../src/dropouts.ts'
import type { GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import { paymentRef, readPayments } from '../src/store.ts'
import { closeServer, cookieFor, groupWith, listen, person, setJoinedOn } from './support/fixtures.ts'

function iso(raw: string): IsoDate {
  const day = parseIsoDate(raw)
  if (!day) throw new Error(raw)
  return day
}

const window = { phase: 'active', startsOn: iso('2026-11-01'), endsOn: iso('2026-11-30') } as const

function member(
  userId: string,
  joinedOn: string,
  colors: Record<string, 'green' | 'red'> = {},
  leftOn: string | null = null,
): CalendarMember {
  return {
    userId,
    displayName: userId,
    span: { joinedOn: iso(joinedOn), leftOn: leftOn === null ? null : iso(leftOn) },
    rhythm: { kind: 'every_day', anchorOn: iso('2026-11-01') },
    colors: new Map(Object.entries(colors).map(([day, color]) => [iso(day), color])),
  }
}

function netsOf(settlement: { nets: readonly { userId: string; netMinor: number }[] }): Record<string, number> {
  return Object.fromEntries(settlement.nets.map((line) => [line.userId, line.netMinor]))
}

function total(settlement: { nets: readonly { netMinor: number }[] }): number {
  return settlement.nets.reduce((sum, line) => sum + line.netMinor, 0)
}

test('a red day owes the stake to each other member active that day and a green day owes nothing', () => {
  const members = [
    member('ada', '2026-11-01', { '2026-11-01': 'red', '2026-11-02': 'green' }),
    member('grace', '2026-11-01', { '2026-11-01': 'green', '2026-11-02': 'green' }),
    member('lin', '2026-11-02', { '2026-11-02': 'green' }),
  ]
  const debts = missedDayDebts({ window, today: iso('2026-11-03') }, 500, members)
  assert.deepEqual(debts, [{ debtorId: 'ada', creditorId: 'grace', day: '2026-11-01', amountMinor: 500 }])
})

test('a past due day with no check-in is red and today is not', () => {
  const members = [member('ada', '2026-11-01'), member('grace', '2026-11-01', {}, '2026-11-01')]
  const debts = missedDayDebts({ window, today: iso('2026-11-02') }, 500, members)
  assert.deepEqual(
    debts.map((debt) => [debt.debtorId, debt.creditorId, debt.day]),
    [
      ['ada', 'grace', '2026-11-01'],
      ['grace', 'ada', '2026-11-01'],
    ],
  )
})

test('the open amount nets both directions, then subtracts payments from debtor to creditor', () => {
  const people = ['ada', 'grace', 'lin'].map((userId) => ({ userId, displayName: userId }))
  const debts = [
    { debtorId: 'ada', creditorId: 'grace', day: iso('2026-11-01'), amountMinor: 700 },
    { debtorId: 'grace', creditorId: 'ada', day: iso('2026-11-02'), amountMinor: 200 },
    { debtorId: 'lin', creditorId: 'ada', day: iso('2026-11-02'), amountMinor: 300 },
  ]
  const settled = settle(people, debts, [{ payerId: 'ada', payeeId: 'grace', amountMinor: 100 }])
  assert.deepEqual(
    settled.open.map((line) => [line.debtorId, line.creditorId, line.amountMinor]),
    [
      ['ada', 'grace', 400],
      ['lin', 'ada', 300],
    ],
  )
  assert.deepEqual(netsOf(settled), { ada: -100, grace: 400, lin: -300 })
  assert.equal(total(settled), 0)

  const overpaid = settle(people, debts, [{ payerId: 'ada', payeeId: 'grace', amountMinor: 600 }])
  assert.deepEqual(
    overpaid.open.map((line) => [line.debtorId, line.creditorId, line.amountMinor]),
    [
      ['grace', 'ada', 100],
      ['lin', 'ada', 300],
    ],
  )
  assert.equal(total(overpaid), 0)
})

type Crew = { db: Database; ada: Account; grace: Account; lin: Account; groupId: GroupId }

async function crew(options: { start?: boolean } = {}): Promise<Crew> {
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
  for (const [who, interval, anchorOn] of [
    [ada, 'every_day', '2026-11-01'],
    [grace, 'every_2_days', '2026-11-02'],
    [lin, 'every_day', '2026-11-01'],
  ] as const) {
    const rhythm = await saveRhythm(db, who, groupId, { interval, anchorOn })
    if (!rhythm.ok) throw new Error(rhythm.failure)
  }
  if (options.start !== false) {
    const started = await startChallenge(db, ada, groupId, { cause: '' })
    if (!started.ok) throw new Error(started.failure)
  }
  return { db, ada, grace, lin, groupId }
}

async function ledger(db: Database, groupId: GroupId, today: string): Promise<GroupLedger> {
  const read = await readLedger(db, groupId, iso(today))
  if (read?.kind !== 'group') throw new Error('ledger')
  return read
}

async function soloLedger(db: Database, groupId: GroupId, today: string): Promise<SoloLedger> {
  const read = await readLedger(db, groupId, iso(today))
  if (read?.kind !== 'solo') throw new Error('solo ledger')
  return read
}

test('nets follow check-ins and payments with nothing stored between reads', async () => {
  const { db, ada, grace, lin, groupId } = await crew()
  try {
    const first = await ledger(db, groupId, '2026-11-04')
    assert.deepEqual(netsOf(first), { [ada.id]: -1000, [grace.id]: 2000, [lin.id]: -1000 })
    assert.equal(total(first), 0)

    for (const day of ['2026-11-01', '2026-11-02', '2026-11-03']) {
      assert.deepEqual(await logCheckIn(db, ada, groupId, { day, color: 'red' }), { ok: true })
    }
    assert.deepEqual(netsOf(await ledger(db, groupId, '2026-11-04')), netsOf(first))

    for (const day of ['2026-11-01', '2026-11-02', '2026-11-03']) {
      assert.deepEqual(await logCheckIn(db, ada, groupId, { day, color: 'green' }), { ok: true })
    }
    const green = await ledger(db, groupId, '2026-11-04')
    assert.deepEqual(netsOf(green), { [ada.id]: 2000, [grace.id]: 500, [lin.id]: -2500 })
    assert.equal(total(green), 0)

    const paid = await recordPayment(
      db,
      lin,
      groupId,
      { payeeId: ada.id, amount: '15.00', paidOn: '2026-11-04', paypalRef: ' 9XY12345AB6789012 ' },
      iso('2026-11-04'),
    )
    assert.deepEqual(paid, { ok: true })
    const after = await ledger(db, groupId, '2026-11-04')
    assert.deepEqual(netsOf(after), { [ada.id]: 500, [grace.id]: 500, [lin.id]: -1000 })
    assert.equal(total(after), 0)
    assert.deepEqual(
      after.payments.map((item) => [item.payerName, item.payeeName, item.amountMinor, item.currency, item.paidOn, item.paypalRef]),
      [['Lin', 'Ada', 1500, 'USD', '2026-11-04', '9XY12345AB6789012']],
    )
  } finally {
    await closeDatabase(db)
  }
})

test('a payment needs another member, a real past date, an amount in the currency, and a started challenge', async () => {
  const { db, ada, grace, groupId } = await crew()
  const today = iso('2026-11-04')
  const pay = (who: Account, input: Partial<Parameters<typeof recordPayment>[3]>) =>
    recordPayment(db, who, groupId, { payeeId: grace.id, amount: '1', paidOn: '2026-11-04', paypalRef: '', ...input }, today)
  try {
    assert.deepEqual(await pay(ada, { payeeId: ada.id }), { ok: false, failure: 'bad_payee' })
    assert.deepEqual(await pay(ada, { payeeId: 'nobody' }), { ok: false, failure: 'bad_payee' })
    assert.deepEqual(await pay(ada, { amount: '0' }), { ok: false, failure: 'amount_not_positive' })
    assert.deepEqual(await pay(ada, { amount: '1.005' }), { ok: false, failure: 'amount_not_positive' })
    assert.deepEqual(await pay(ada, { amount: '-3' }), { ok: false, failure: 'amount_not_positive' })
    assert.deepEqual(await pay(ada, { amount: '10000000001' }), { ok: false, failure: 'amount_too_large' })
    assert.deepEqual(await pay(ada, { paidOn: '2026-02-30' }), { ok: false, failure: 'bad_date' })
    assert.deepEqual(await pay(ada, { paidOn: '2026-11-05' }), { ok: false, failure: 'future_date' })
    assert.deepEqual(await pay(ada, { paypalRef: 'x'.repeat(65) }), { ok: false, failure: 'ref_too_long' })
    assert.deepEqual(await pay(await person(db, 'Noor'), {}), { ok: false, failure: 'not_member' })
    assert.deepEqual(await pay(ada, { amount: '0.01' }), { ok: true })
    const stored = await readPayments(db, groupId)
    assert.deepEqual(
      stored.map((row) => ({ amountMinor: row.amountMinor, currency: row.currency, paypalRef: row.paypalRef })),
      [{ amountMinor: 1, currency: 'USD', paypalRef: null }],
    )
  } finally {
    await closeDatabase(db)
  }
  const draft = await crew({ start: false })
  try {
    const result = await recordPayment(
      draft.db,
      draft.ada,
      draft.groupId,
      { payeeId: draft.grace.id, amount: '1', paidOn: '2026-11-04', paypalRef: '' },
      today,
    )
    assert.deepEqual(result, { ok: false, failure: 'not_active' })
    assert.equal(await readLedger(draft.db, draft.groupId, today), null)
  } finally {
    await closeDatabase(draft.db)
  }
})

test('a payment is always in the challenge currency and can go to a member who left', async () => {
  const { db, ada, grace, lin, groupId } = await crew()
  const today = iso('2026-11-04')
  try {
    assert.deepEqual(await recordDropout(db, lin, groupId, { memberId: lin.id, lastDay: '2026-11-02' }, today), { ok: true })
    const pay = (who: Account, payeeId: string) =>
      recordPayment(db, who, groupId, { payeeId, amount: '2.50', paidOn: '2026-11-04', paypalRef: '' }, today)
    assert.deepEqual(await pay(ada, lin.id), { ok: true })
    assert.deepEqual(await pay(lin, ada.id), { ok: false, failure: 'not_member' })
    assert.deepEqual(await pay(grace, grace.id), { ok: false, failure: 'bad_payee' })
    const stored = await readPayments(db, groupId)
    assert.deepEqual(
      stored.map((row) => [row.payerId, row.payee, row.amountMinor, row.currency]),
      [[ada.id, { kind: 'member', userId: lin.id }, 250, 'USD']],
    )
  } finally {
    await closeDatabase(db)
  }
})

test('the group card shows each net and who owes whom, and a recorded payment changes them', async () => {
  const { db, ada, grace, lin, groupId } = await crew()
  const linCookie = await cookieFor(db, lin)
  const { server, base } = await listen(db, { today: () => iso('2026-11-04') })
  const groupPath = `/groups/${groupId}`
  const page = async () => (await fetch(`${base}${groupPath}`, { headers: { cookie: linCookie } })).text()
  const pay = (fields: Record<string, string>) =>
    fetch(`${base}${groupPath}/payment`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: linCookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    })
  const net = (html: string, userId: string) => new RegExp(`data-net="${userId}" data-minor="(-?\\d+)"`).exec(html)?.[1]
  try {
    const before = await page()
    assert.equal(net(before, ada.id), '-1000')
    assert.equal(net(before, grace.id), '2000')
    assert.equal(net(before, lin.id), '-1000')
    assert.match(before, /Ada owes Grace 10\.00 USD/)
    assert.match(before, /Lin owes Grace 10\.00 USD/)
    assert.match(before, /Grace<\/span> <span class="net owed">is owed 20\.00 USD/)

    const bad = await pay({ payee: grace.id, amount: '0', paid_on: '2026-11-04', paypal_ref: '' })
    assert.equal(bad.status, 400)
    const badHtml = await bad.text()
    assert.match(badHtml, /Type an amount above zero\./)
    assert.match(badHtml, /name="paypal_ref" value=""/)

    const ok = await pay({ payee: grace.id, amount: '10', paid_on: '2026-11-03', paypal_ref: 'ABC123' })
    assert.equal(ok.status, 303)
    const after = await page()
    assert.equal(net(after, lin.id), '0')
    assert.equal(net(after, grace.id), '1000')
    assert.doesNotMatch(after, /Lin owes Grace/)
    assert.match(after, /Lin paid Grace 10\.00 USD <time datetime="2026-11-03">/)
    assert.match(after, /PayPal ABC123/)

    const signedOut = await fetch(`${base}${groupPath}/payment`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'payee=x',
    })
    assert.equal(signedOut.status, 401)
    assert.equal((await fetch(`${base}${groupPath}/payment`, { headers: { cookie: linCookie } })).status, 405)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('a stored payment with no payee id is a payment to the cause, and one with no payee field is refused', async () => {
  const db = openTestDatabase()
  const groupId = '00000000-0000-4000-8000-000000000043'
  const stored = (payeeId: unknown) => ({
    payerId: 'ada',
    ...(payeeId === undefined ? {} : { payeeId }),
    amountMinor: 500,
    currency: 'USD',
    paidOn: '2026-11-03',
    paypalRef: null,
    createdAt: Timestamp.fromDate(new Date('2026-11-03T12:00:00Z')),
  })
  try {
    await paymentRef(db, groupId, 'to-grace').set(stored('grace'))
    await paymentRef(db, groupId, 'to-cause').set(stored(null))
    const rows = await readPayments(db, groupId)
    assert.deepEqual(
      rows.map((row) => [row.id, row.payee]).sort(),
      [
        ['to-cause', { kind: 'cause' }],
        ['to-grace', { kind: 'member', userId: 'grace' }],
      ],
    )
    await paymentRef(db, groupId, 'no-payee').set(stored(undefined))
    await assert.rejects(readPayments(db, groupId))
  } finally {
    await closeDatabase(db)
  }
})

test('a solo member owes the cause one stake per red day, less what they paid it', () => {
  const ada = member('ada', '2026-11-01', { '2026-11-01': 'red', '2026-11-02': 'green', '2026-11-03': 'red' })
  const calendar = buildCalendar({ window, today: iso('2026-11-05') }, [ada])
  const cause = { kind: 'cause' } as const
  assert.deepEqual(soloDue(calendar, 500, []), { owedMinor: 1500, paidMinor: 0, dueMinor: 1500 })
  assert.deepEqual(
    soloDue(calendar, 500, [
      { payee: cause, amountMinor: 400 },
      { payee: cause, amountMinor: 100 },
    ]),
    { owedMinor: 1500, paidMinor: 500, dueMinor: 1000 },
  )
  assert.deepEqual(soloDue(calendar, 500, [{ payee: cause, amountMinor: 2000 }]), {
    owedMinor: 1500,
    paidMinor: 2000,
    dueMinor: -500,
  })
})

async function soloCrew(): Promise<{ db: Database; ada: Account; groupId: GroupId }> {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const groupId = await groupWith(db, [ada], 'Alone')
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
  const rhythm = await saveRhythm(db, ada, groupId, { interval: 'every_day', anchorOn: '2026-11-01' })
  if (!rhythm.ok) throw new Error(rhythm.failure)
  const started = await startChallenge(db, ada, groupId, { cause: 'Food bank' })
  if (!started.ok) throw new Error(started.failure)
  return { db, ada, groupId }
}

test('a solo member owes the cause for each missed day and records payments to it', async () => {
  const { db, ada, groupId } = await soloCrew()
  const today = iso('2026-11-04')
  const pay = (input: Partial<Parameters<typeof recordPayment>[3]>) =>
    recordPayment(db, ada, groupId, { payeeId: '', amount: '1', paidOn: '2026-11-04', paypalRef: '', ...input }, today)
  try {
    const first = await soloLedger(db, groupId, '2026-11-04')
    assert.equal(first.cause, 'Food bank')
    assert.deepEqual(first.member, { userId: ada.id, displayName: 'Ada' })
    assert.deepEqual([first.owedMinor, first.paidMinor, first.dueMinor], [1500, 0, 1500])

    assert.deepEqual(await logCheckIn(db, ada, groupId, { day: '2026-11-02', color: 'green' }), { ok: true })
    assert.deepEqual((await soloLedger(db, groupId, '2026-11-04')).owedMinor, 1000)

    assert.deepEqual(await pay({ payeeId: ada.id }), { ok: false, failure: 'bad_payee' })
    assert.deepEqual(await pay({ payeeId: 'nobody' }), { ok: false, failure: 'bad_payee' })
    assert.deepEqual(await pay({ amount: '0' }), { ok: false, failure: 'amount_not_positive' })
    assert.deepEqual(await pay({ amount: '4', paidOn: '2026-11-03', paypalRef: ' receipt 12 ' }), { ok: true })
    const stored = await readPayments(db, groupId)
    assert.deepEqual(
      stored.map((row) => [row.payerId, row.payee, row.amountMinor, row.currency, row.paidOn, row.paypalRef]),
      [[ada.id, { kind: 'cause' }, 400, 'USD', '2026-11-03', 'receipt 12']],
    )
    const paid = await soloLedger(db, groupId, '2026-11-04')
    assert.deepEqual([paid.owedMinor, paid.paidMinor, paid.dueMinor], [1000, 400, 600])
    assert.deepEqual(
      paid.payments.map((item) => [item.payerName, item.payee, item.payeeName, item.amountMinor]),
      [['Ada', { kind: 'cause' }, 'Food bank', 400]],
    )

    assert.deepEqual(await pay({ amount: '10' }), { ok: true })
    const ahead = await soloLedger(db, groupId, '2026-11-04')
    assert.deepEqual([ahead.owedMinor, ahead.paidMinor, ahead.dueMinor], [1000, 1400, -400])
  } finally {
    await closeDatabase(db)
  }
})

test('a group payment still needs a member payee and never goes to a cause', async () => {
  const { db, ada, groupId } = await crew()
  try {
    const result = await recordPayment(
      db,
      ada,
      groupId,
      { payeeId: '', amount: '1', paidOn: '2026-11-04', paypalRef: '' },
      iso('2026-11-04'),
    )
    assert.deepEqual(result, { ok: false, failure: 'bad_payee' })
    assert.deepEqual(await readPayments(db, groupId), [])
  } finally {
    await closeDatabase(db)
  }
})

test('the solo card shows what the member owes the cause and a payment to it without picking a payee', async () => {
  const { db, ada, groupId } = await soloCrew()
  const cookie = await cookieFor(db, ada)
  const { server, base } = await listen(db, { today: () => iso('2026-11-04') })
  const groupPath = `/groups/${groupId}`
  const page = async () => (await fetch(`${base}${groupPath}`, { headers: { cookie } })).text()
  const pay = (fields: Record<string, string>) =>
    fetch(`${base}${groupPath}/payment`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    })
  try {
    const before = await page()
    assert.match(before, /data-due="1500"/)
    assert.match(before, /Ada<\/span> <span class="net owes">owes Food bank 15\.00 USD<\/span>/)
    assert.doesNotMatch(before, /Who owes whom/)
    assert.doesNotMatch(before, /name="payee"/)
    assert.match(before, /Paid to Food bank/)
    assert.match(before, /<label for="payment-ref">Reference \(optional\)<\/label>/)
    assert.match(before, /name="paypal_ref"/)

    const bad = await pay({ amount: '0', paid_on: '2026-11-04', paypal_ref: 'r1' })
    assert.equal(bad.status, 400)
    const badHtml = await bad.text()
    assert.match(badHtml, /Type an amount above zero\./)
    assert.match(badHtml, /name="paypal_ref" value="r1"/)

    const ok = await pay({ amount: '15', paid_on: '2026-11-03', paypal_ref: 'r1' })
    assert.equal(ok.status, 303)
    const even = await page()
    assert.match(even, /data-due="0"/)
    assert.match(even, /Ada<\/span> <span class="net even">is even with Food bank<\/span>/)
    assert.match(even, /Ada paid Food bank 15\.00 USD <time datetime="2026-11-03">/)
    assert.match(even, /Reference r1/)

    assert.equal((await pay({ amount: '2.5', paid_on: '2026-11-04', paypal_ref: '' })).status, 303)
    const ahead = await page()
    assert.match(ahead, /data-due="-250"/)
    assert.match(ahead, /Ada<\/span> <span class="net owed">has paid Food bank 2\.50 USD ahead<\/span>/)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

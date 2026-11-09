import { Timestamp } from 'firebase-admin/firestore'
import type { Database } from './db.ts'
import { buildCalendar, type CalendarMember, type CalendarSpan, type GroupCalendar } from './calendar.ts'
import {
  parseIsoDate,
  parseMinorAmount,
  rhythmFrom,
  spanFrom,
  stakesGoFrom,
  windowFrom,
  type CauseName,
  type CurrencyCode,
  type IsoDate,
  type MembershipSpan,
  type StakesGo,
} from './challenge.ts'
import { minorDigitsOf } from './currencies.ts'
import { isColor, type CheckInColor } from './checkins.ts'
import type { GroupId } from './groups.ts'
import type { Account } from './identity.ts'
import {
  compare,
  memberOf,
  paymentData,
  paymentRef,
  readGroup,
  readUsers,
  rhythmOf,
  type CheckInDoc,
  type GroupDoc,
  type Payee,
  type PaymentDoc,
  type PaymentRow,
  type UserDoc,
} from './store.ts'

export const PAYMENT_MINOR_MAX = 1_000_000_000_000
const PAYPAL_REF_MAX = 64

export type Debt = {
  readonly debtorId: string
  readonly creditorId: string
  readonly day: IsoDate
  readonly amountMinor: number
}

export type PaymentLine = {
  readonly payerId: string
  readonly payeeId: string
  readonly amountMinor: number
}

export type Payment = {
  readonly id: string
  readonly payerId: string
  readonly payerName: string
  readonly payee: Payee
  readonly payeeName: string
  readonly amountMinor: number
  readonly currency: CurrencyCode
  readonly paidOn: IsoDate
  readonly paypalRef: string | null
}

export type NetLine = {
  readonly userId: string
  readonly displayName: string
  readonly netMinor: number
}

export type OpenAmount = {
  readonly debtorId: string
  readonly debtorName: string
  readonly creditorId: string
  readonly creditorName: string
  readonly amountMinor: number
}

export type Settlement = {
  readonly nets: readonly NetLine[]
  readonly open: readonly OpenAmount[]
}

type LedgerBase = {
  readonly calendar: GroupCalendar
  readonly currency: CurrencyCode
  readonly minorDigits: number
  readonly payments: readonly Payment[]
}

export type GroupLedger = LedgerBase &
  Settlement & {
    readonly kind: 'group'
    readonly people: readonly { readonly userId: string; readonly displayName: string }[]
  }

export type SoloDue = {
  readonly owedMinor: number
  readonly paidMinor: number
  readonly dueMinor: number
}

export type SoloLedger = LedgerBase &
  SoloDue & {
    readonly kind: 'solo'
    readonly member: { readonly userId: string; readonly displayName: string }
    readonly cause: CauseName
  }

export type Ledger = GroupLedger | SoloLedger

export type PaymentInput = {
  readonly payeeId: string
  readonly amount: string
  readonly paidOn: string
  readonly paypalRef: string
}

export type PaymentFailure =
  | 'group_missing'
  | 'not_member'
  | 'not_active'
  | 'bad_payee'
  | 'amount_not_positive'
  | 'amount_too_large'
  | 'bad_date'
  | 'future_date'
  | 'ref_too_long'

export const paymentFailureCopy = {
  group_missing: 'That group does not exist.',
  not_member: 'Join the group before you record a payment.',
  not_active: 'Payments open once the challenge has started.',
  bad_payee: 'Pick someone else in the group.',
  amount_not_positive: 'Type an amount above zero.',
  amount_too_large: `Use ${PAYMENT_MINOR_MAX} minor units or fewer.`,
  bad_date: 'Use a real date.',
  future_date: 'Record a payment that already happened.',
  ref_too_long: `Use ${PAYPAL_REF_MAX} characters or fewer for the reference.`,
} as const satisfies Record<PaymentFailure, string>

export type RecordPaymentResult =
  | {
      readonly ok: true
      readonly amountMinor: number
      readonly currency: CurrencyCode
      readonly minorDigits: number
      readonly payeeName: string
    }
  | { readonly ok: false; readonly failure: PaymentFailure }

function addMinor(left: number, right: number): number {
  const sum = left + right
  if (!Number.isSafeInteger(sum)) throw new Error('amount overflow')
  return sum
}

function withinSpan(span: MembershipSpan, day: IsoDate): boolean {
  return day >= span.joinedOn && (span.leftOn === null || day <= span.leftOn)
}

// A red day on the calendar is the only source of debt, so the grid and the money cannot disagree.
export function missedDayDebts(
  span: CalendarSpan,
  stakeMinor: number,
  members: readonly CalendarMember[],
): readonly Debt[] {
  return calendarDebts(buildCalendar(span, members), stakeMinor, members)
}

function calendarDebts(
  calendar: GroupCalendar,
  stakeMinor: number,
  members: readonly CalendarMember[],
): readonly Debt[] {
  const debts: Debt[] = []
  for (const row of calendar.rows) {
    for (const marked of row.days) {
      if (marked.mark !== 'red') continue
      for (const other of members) {
        if (other.userId === row.userId || !withinSpan(other.span, marked.day)) continue
        debts.push({ debtorId: row.userId, creditorId: other.userId, day: marked.day, amountMinor: stakeMinor })
      }
    }
  }
  return debts
}

export function soloDue(
  calendar: GroupCalendar,
  memberId: string,
  stakeMinor: number,
  payments: readonly Pick<Payment, 'payee' | 'amountMinor'>[],
): SoloDue {
  let owedMinor = 0
  for (const marked of calendar.rows.find((row) => row.userId === memberId)?.days ?? []) {
    if (marked.mark === 'red') owedMinor = addMinor(owedMinor, stakeMinor)
  }
  let paidMinor = 0
  for (const payment of payments) {
    if (payment.payee.kind === 'cause') paidMinor = addMinor(paidMinor, payment.amountMinor)
  }
  return { owedMinor, paidMinor, dueMinor: addMinor(owedMinor, -paidMinor) }
}

export function settle(
  people: readonly { readonly userId: string; readonly displayName: string }[],
  debts: readonly Debt[],
  payments: readonly PaymentLine[],
): Settlement {
  // owes.get(a).get(b) is what a owes b before netting against what b owes a.
  const owes = new Map<string, Map<string, number>>()
  const bump = (from: string, to: string, amount: number) => {
    const row = owes.get(from) ?? new Map<string, number>()
    row.set(to, addMinor(row.get(to) ?? 0, amount))
    owes.set(from, row)
  }
  for (const debt of debts) bump(debt.debtorId, debt.creditorId, debt.amountMinor)
  for (const payment of payments) bump(payment.payeeId, payment.payerId, payment.amountMinor)
  const owed = (from: string, to: string) => owes.get(from)?.get(to) ?? 0

  const open: OpenAmount[] = []
  const nets = new Map<string, number>(people.map((person) => [person.userId, 0]))
  for (const [i, left] of people.entries()) {
    for (const right of people.slice(i + 1)) {
      const amount = addMinor(owed(left.userId, right.userId), -owed(right.userId, left.userId))
      if (amount === 0) continue
      const [debtor, creditor] = amount > 0 ? [left, right] : [right, left]
      const size = Math.abs(amount)
      open.push({
        debtorId: debtor.userId,
        debtorName: debtor.displayName,
        creditorId: creditor.userId,
        creditorName: creditor.displayName,
        amountMinor: size,
      })
      nets.set(creditor.userId, addMinor(nets.get(creditor.userId) ?? 0, size))
      nets.set(debtor.userId, addMinor(nets.get(debtor.userId) ?? 0, -size))
    }
  }
  return {
    nets: people.map((person) => ({
      userId: person.userId,
      displayName: person.displayName,
      netMinor: nets.get(person.userId) ?? 0,
    })),
    open,
  }
}

class PaymentRejected extends Error {
  readonly failure: PaymentFailure

  constructor(failure: PaymentFailure) {
    super(failure)
    this.failure = failure
  }
}

type ActiveTerms = {
  readonly stakesGo: StakesGo
  readonly currency: CurrencyCode
  readonly minorDigits: number
  readonly stakeMinor: number
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
}

function activeTerms(group: GroupDoc): ActiveTerms | null {
  const window = windowFrom(group.challenge)
  if (!group.challenge || window?.phase !== 'active') return null
  const stakesGo = stakesGoFrom(group.challenge)
  const minorDigits = minorDigitsOf(group.challenge.currency)
  if (minorDigits === null) throw new Error('currency')
  return {
    stakesGo,
    currency: group.challenge.currency as CurrencyCode,
    minorDigits,
    stakeMinor: group.challenge.stakeMinor,
    startsOn: window.startsOn,
    endsOn: window.endsOn,
  }
}

function dateFrom(value: string): IsoDate {
  const parsed = parseIsoDate(value)
  if (!parsed) throw new Error('date')
  return parsed
}

function membersFrom(
  group: GroupDoc,
  checkIns: readonly CheckInDoc[],
  users: ReadonlyMap<string, UserDoc>,
): readonly CalendarMember[] {
  const members = Object.keys(group.members).flatMap((userId): CalendarMember[] => {
    const user = users.get(userId)
    const span = spanFrom(memberOf(group, userId))
    if (!user || !span) return []
    const colors = new Map<IsoDate, CheckInColor>()
    for (const item of checkIns) {
      if (item.userId !== userId) continue
      if (!isColor(item.color)) throw new Error('check-in color')
      colors.set(dateFrom(item.day), item.color)
    }
    return [{ userId, displayName: user.displayName, span, rhythm: rhythmFrom(rhythmOf(group, userId)), colors }]
  })
  return members.sort(
    (a, b) =>
      compare(a.span.joinedOn, b.span.joinedOn) || compare(a.displayName, b.displayName) || compare(a.userId, b.userId),
  )
}

function payeeName(payee: Payee, stakesGo: StakesGo, users: ReadonlyMap<string, { readonly displayName: string }>): string | null {
  if (payee.kind === 'member') return users.get(payee.userId)?.displayName ?? null
  return stakesGo.kind === 'cause' ? stakesGo.name : null
}

export function paymentUserIds(rows: readonly PaymentRow[]): readonly string[] {
  return rows.flatMap((row) => (row.payee.kind === 'member' ? [row.payerId, row.payee.userId] : [row.payerId]))
}

function paymentsFrom(rows: readonly PaymentRow[], stakesGo: StakesGo, users: ReadonlyMap<string, UserDoc>): readonly Payment[] {
  return [...rows]
    .sort(
      (a, b) =>
        compare(b.paidOn, a.paidOn) || b.createdAt.toMillis() - a.createdAt.toMillis() || compare(a.id, b.id),
    )
    .flatMap((row): Payment[] => {
      const payer = users.get(row.payerId)
      const payee = payeeName(row.payee, stakesGo, users)
      if (!payer || payee === null) return []
      return [
        {
          id: row.id,
          payerId: row.payerId,
          payerName: payer.displayName,
          payee: row.payee,
          payeeName: payee,
          amountMinor: row.amountMinor,
          currency: row.currency as CurrencyCode,
          paidOn: dateFrom(row.paidOn),
          paypalRef: row.paypalRef,
        },
      ]
    })
}

export type LedgerActivity = {
  readonly checkIns: readonly CheckInDoc[]
  readonly payments: readonly PaymentRow[]
}

// Nets are recomputed from check-ins, membership dates, and payments on every read. Nothing is cached.
// The calendar rows come from every membership, so a member who left keeps their row and their debts.
// users must hold every member and every payer and member payee.
export function ledgerFrom(
  group: GroupDoc,
  activity: LedgerActivity,
  users: ReadonlyMap<string, UserDoc>,
  today: IsoDate,
): Ledger | null {
  const terms = activeTerms(group)
  if (!terms) return null
  const members = membersFrom(group, activity.checkIns, users)
  const payments = paymentsFrom(activity.payments, terms.stakesGo, users)
  const window = { phase: 'active', startsOn: terms.startsOn, endsOn: terms.endsOn } as const
  const calendar = buildCalendar({ window, today }, members)
  const base = { calendar, currency: terms.currency, minorDigits: terms.minorDigits, payments }
  if (terms.stakesGo.kind === 'cause') {
    const member = members.find((item) => item.span.leftOn === null) ?? members.at(-1)
    if (!member) throw new Error('solo member')
    return {
      kind: 'solo',
      ...base,
      member: { userId: member.userId, displayName: member.displayName },
      cause: terms.stakesGo.name,
      ...soloDue(calendar, member.userId, terms.stakeMinor, payments),
    }
  }
  const debts = calendarDebts(calendar, terms.stakeMinor, members)
  const people = members.map((member) => ({ userId: member.userId, displayName: member.displayName }))
  const lines = payments.flatMap((payment): PaymentLine[] =>
    payment.payee.kind === 'member'
      ? [{ payerId: payment.payerId, payeeId: payment.payee.userId, amountMinor: payment.amountMinor }]
      : [],
  )
  return { kind: 'group', ...base, people, ...settle(people, debts, lines) }
}

function parsePaypalRef(raw: string): { ok: true; ref: string | null } | { ok: false } {
  const ref = raw.trim()
  if (ref === '') return { ok: true, ref: null }
  if (Array.from(ref).length > PAYPAL_REF_MAX) return { ok: false }
  return { ok: true, ref }
}

function payeeOf(group: GroupDoc, account: Account, stakesGo: StakesGo, payeeId: string): Payee {
  if (stakesGo.kind === 'cause') {
    if (payeeId !== '') throw new PaymentRejected('bad_payee')
    return { kind: 'cause' }
  }
  if (payeeId === account.id || !memberOf(group, payeeId)) throw new PaymentRejected('bad_payee')
  return { kind: 'member', userId: payeeId }
}

export async function recordPayment(
  db: Database,
  account: Account,
  groupId: GroupId,
  input: PaymentInput,
  today: IsoDate,
): Promise<RecordPaymentResult> {
  const paidOn = parseIsoDate(input.paidOn)
  if (!paidOn) return { ok: false, failure: 'bad_date' }
  if (paidOn > today) return { ok: false, failure: 'future_date' }
  const ref = parsePaypalRef(input.paypalRef)
  if (!ref.ok) return { ok: false, failure: 'ref_too_long' }
  try {
    const recorded = await db.runTransaction(async (tx) => {
      const group = await readGroup(db, groupId, tx)
      if (!group) throw new PaymentRejected('group_missing')
      if (memberOf(group, account.id)?.leftOn !== null) throw new PaymentRejected('not_member')
      const terms = activeTerms(group)
      if (!terms) throw new PaymentRejected('not_active')
      const payee = payeeOf(group, account, terms.stakesGo, input.payeeId)
      const amount = parseMinorAmount(input.amount, terms.minorDigits, PAYMENT_MINOR_MAX)
      if (!amount.ok) {
        throw new PaymentRejected(amount.failure === 'too_large' ? 'amount_too_large' : 'amount_not_positive')
      }
      const payment: PaymentDoc = {
        payerId: account.id,
        payee,
        amountMinor: amount.minor,
        currency: terms.currency,
        paidOn,
        paypalRef: ref.ref,
        createdAt: Timestamp.now(),
      }
      tx.create(paymentRef(db, groupId, crypto.randomUUID()), paymentData(payment))
      return { payee, stakesGo: terms.stakesGo, amountMinor: amount.minor, currency: terms.currency, minorDigits: terms.minorDigits }
    })
    const users = await readUsers(db, recorded.payee.kind === 'member' ? [recorded.payee.userId] : [])
    const name = payeeName(recorded.payee, recorded.stakesGo, users)
    if (name === null) throw new Error('payee')
    return {
      ok: true,
      amountMinor: recorded.amountMinor,
      currency: recorded.currency,
      minorDigits: recorded.minorDigits,
      payeeName: name,
    }
  } catch (error) {
    if (error instanceof PaymentRejected) return { ok: false, failure: error.failure }
    throw error
  }
}

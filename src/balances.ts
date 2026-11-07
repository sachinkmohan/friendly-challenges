import type { PGlite } from '@electric-sql/pglite'
import { buildCalendar, type CalendarMember, type CalendarSpan } from './calendar.ts'
import {
  isRhythmKind,
  parseIsoDate,
  parseMinorAmount,
  type CurrencyCode,
  type IsoDate,
  type MembershipSpan,
  type Rhythm,
} from './challenge.ts'
import { isColor, type CheckInColor } from './checkins.ts'
import type { GroupId } from './groups.ts'
import type { Account } from './identity.ts'

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

export type Payment = PaymentLine & {
  readonly id: string
  readonly payerName: string
  readonly payeeName: string
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

export type Ledger = Settlement & {
  readonly currency: CurrencyCode
  readonly minorDigits: number
  readonly people: readonly { readonly userId: string; readonly displayName: string }[]
  readonly payments: readonly Payment[]
}

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
  ref_too_long: `Use ${PAYPAL_REF_MAX} characters or fewer for the PayPal reference.`,
} as const satisfies Record<PaymentFailure, string>

export type RecordPaymentResult = { readonly ok: true } | { readonly ok: false; readonly failure: PaymentFailure }

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
  const calendar = buildCalendar(span, members)
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

type Sql = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

class PaymentRejected extends Error {
  readonly failure: PaymentFailure

  constructor(failure: PaymentFailure) {
    super(failure)
    this.failure = failure
  }
}

function dateFrom(value: unknown): IsoDate {
  const parsed = typeof value === 'string' ? parseIsoDate(value) : null
  if (!parsed) throw new Error('date')
  return parsed
}

function minorFrom(value: unknown): number {
  const parsed = typeof value === 'bigint' ? Number(value) : typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) throw new Error('amount')
  return parsed
}

function textFrom(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(what)
  return value
}

type ActiveTerms = {
  readonly currency: CurrencyCode
  readonly minorDigits: number
  readonly stakeMinor: number
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
}

async function loadActiveTerms(sql: Sql, groupId: GroupId, lock: boolean): Promise<ActiveTerms | null> {
  const result = await sql.query<Record<string, unknown>>(
    `SELECT btrim(c.currency) AS currency, k.minor_digits, c.stake_minor,
            to_char(c.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(c.ends_on, 'YYYY-MM-DD') AS ends_on
     FROM challenges c
     JOIN currency_codes k ON k.code = c.currency
     WHERE c.group_id = $1::uuid AND c.phase = 'active'
     ${lock ? 'FOR SHARE OF c' : ''}`,
    [groupId],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    currency: textFrom(row.currency, 'currency') as CurrencyCode,
    minorDigits: minorFrom(row.minor_digits),
    stakeMinor: minorFrom(row.stake_minor),
    startsOn: dateFrom(row.starts_on),
    endsOn: dateFrom(row.ends_on),
  }
}

async function loadMembers(db: PGlite, groupId: GroupId): Promise<readonly CalendarMember[]> {
  const people = await db.query<Record<string, unknown>>(
    `SELECT m.user_id::text AS user_id, u.display_name,
            to_char(m.joined_on, 'YYYY-MM-DD') AS joined_on, to_char(m.left_on, 'YYYY-MM-DD') AS left_on,
            r.kind, to_char(r.anchor_on, 'YYYY-MM-DD') AS anchor_on
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN logging_rhythms r ON r.group_id = m.group_id AND r.user_id = m.user_id
     WHERE m.group_id = $1::uuid
     ORDER BY m.joined_on, u.display_name, m.user_id`,
    [groupId],
  )
  const checkIns = await db.query<Record<string, unknown>>(
    `SELECT user_id::text AS user_id, to_char(day, 'YYYY-MM-DD') AS day, color
     FROM check_ins
     WHERE group_id = $1::uuid`,
    [groupId],
  )
  return people.rows.map((row) => {
    const userId = textFrom(row.user_id, 'member')
    let rhythm: Rhythm | null = null
    if (row.kind !== null) {
      if (typeof row.kind !== 'string' || !isRhythmKind(row.kind)) throw new Error('rhythm')
      rhythm = { kind: row.kind, anchorOn: dateFrom(row.anchor_on) }
    }
    const colors = new Map<IsoDate, CheckInColor>()
    for (const item of checkIns.rows) {
      if (item.user_id !== userId) continue
      if (typeof item.color !== 'string' || !isColor(item.color)) throw new Error('check-in color')
      colors.set(dateFrom(item.day), item.color)
    }
    return {
      userId,
      displayName: textFrom(row.display_name, 'member name'),
      span: { joinedOn: dateFrom(row.joined_on), leftOn: row.left_on === null ? null : dateFrom(row.left_on) },
      rhythm,
      colors,
    }
  })
}

async function loadPayments(db: PGlite, groupId: GroupId): Promise<readonly Payment[]> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT p.id::text AS id, p.payer_id::text AS payer_id, payer.display_name AS payer_name,
            p.payee_id::text AS payee_id, payee.display_name AS payee_name,
            p.amount_minor::text AS amount_minor, btrim(p.currency) AS currency,
            to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.paypal_ref
     FROM payments p
     JOIN users payer ON payer.id = p.payer_id
     JOIN users payee ON payee.id = p.payee_id
     WHERE p.group_id = $1::uuid
     ORDER BY p.paid_on DESC, p.created_at DESC, p.id`,
    [groupId],
  )
  return result.rows.map((row) => ({
    id: textFrom(row.id, 'payment'),
    payerId: textFrom(row.payer_id, 'payer'),
    payerName: textFrom(row.payer_name, 'payer name'),
    payeeId: textFrom(row.payee_id, 'payee'),
    payeeName: textFrom(row.payee_name, 'payee name'),
    amountMinor: minorFrom(row.amount_minor),
    currency: textFrom(row.currency, 'currency') as CurrencyCode,
    paidOn: dateFrom(row.paid_on),
    paypalRef: row.paypal_ref === null ? null : textFrom(row.paypal_ref, 'paypal ref'),
  }))
}

// Nets are recomputed from check-ins, membership dates, and payments on every read. Nothing is cached.
export async function readLedger(db: PGlite, groupId: GroupId, today: IsoDate): Promise<Ledger | null> {
  const terms = await loadActiveTerms(db, groupId, false)
  if (!terms) return null
  const members = await loadMembers(db, groupId)
  const payments = await loadPayments(db, groupId)
  const window = { phase: 'active', startsOn: terms.startsOn, endsOn: terms.endsOn } as const
  const debts = missedDayDebts({ window, today }, terms.stakeMinor, members)
  const people = members.map((member) => ({ userId: member.userId, displayName: member.displayName }))
  return {
    currency: terms.currency,
    minorDigits: terms.minorDigits,
    people,
    payments,
    ...settle(people, debts, payments),
  }
}

function parsePaypalRef(raw: string): { ok: true; ref: string | null } | { ok: false } {
  const ref = raw.trim()
  if (ref === '') return { ok: true, ref: null }
  if (Array.from(ref).length > PAYPAL_REF_MAX) return { ok: false }
  return { ok: true, ref }
}

export async function recordPayment(
  db: PGlite,
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
    return await db.transaction(async (tx) => {
      const group = await tx.query(`SELECT 1 AS ok FROM groups WHERE id = $1::uuid`, [groupId])
      if (!group.rows[0]) throw new PaymentRejected('group_missing')
      const payer = await tx.query(
        `SELECT 1 AS ok FROM active_memberships WHERE group_id = $1::uuid AND user_id = $2::uuid`,
        [groupId, account.id],
      )
      if (!payer.rows[0]) throw new PaymentRejected('not_member')
      const terms = await loadActiveTerms(tx, groupId, true)
      if (!terms) throw new PaymentRejected('not_active')
      const payee = await tx.query(
        `SELECT 1 AS ok FROM memberships
         WHERE group_id = $1::uuid AND user_id::text = $2 AND user_id <> $3::uuid`,
        [groupId, input.payeeId, account.id],
      )
      if (!payee.rows[0]) throw new PaymentRejected('bad_payee')
      const amount = parseMinorAmount(input.amount, terms.minorDigits, PAYMENT_MINOR_MAX)
      if (!amount.ok) {
        throw new PaymentRejected(amount.failure === 'too_large' ? 'amount_too_large' : 'amount_not_positive')
      }
      await tx.query(
        `INSERT INTO payments (id, group_id, payer_id, payee_id, amount_minor, currency, paid_on, paypal_ref)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, $6, $7::date, $8)`,
        [crypto.randomUUID(), groupId, account.id, input.payeeId, String(amount.minor), terms.currency, paidOn, ref.ref],
      )
      return { ok: true }
    })
  } catch (error) {
    if (error instanceof PaymentRejected) return { ok: false, failure: error.failure }
    throw error
  }
}

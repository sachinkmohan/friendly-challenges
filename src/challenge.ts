import type { PGlite } from '@electric-sql/pglite'
import type { Account } from './identity.ts'
import type { GroupId } from './groups.ts'

export const STAKE_MINOR_MAX = 1_000_000_000

export const PRESET_LABELS = {
  no_sugar: 'No sugar',
  coding: 'Coding',
  writing: 'Writing',
} as const

export type PresetKind = keyof typeof PRESET_LABELS

const RHYTHM_STEP = {
  every_day: 1,
  every_2_days: 2,
  every_3_days: 3,
  alternate_days: 2,
} as const

export type RhythmKind = keyof typeof RHYTHM_STEP

export const RHYTHM_LABELS: { readonly [K in RhythmKind]: string } = {
  every_day: 'Every day',
  every_2_days: 'Every 2 days',
  every_3_days: 'Every 3 days',
  alternate_days: 'Alternate days',
}

const NAME_MAX = 40
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const CURRENCY_SHAPE = /^[A-Z]{3}$/
const MS_PER_DAY = 86_400_000

export type IsoDate = string & { readonly brand: 'IsoDate' }
export type StakeMinor = number & { readonly brand: 'StakeMinor' }
export type CurrencyCode = string & { readonly brand: 'CurrencyCode' }

export type ChallengeType =
  | { readonly kind: 'preset'; readonly preset: PresetKind }
  | { readonly kind: 'custom'; readonly label: string }

export type ChallengeTerms = {
  readonly name: string
  readonly type: ChallengeType
  readonly currency: CurrencyCode
  readonly stakeMinor: StakeMinor
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
}

export type ChallengeInput = {
  readonly name: string
  readonly type: string
  readonly customLabel: string
  readonly currency: string
  readonly stake: string
  readonly startsOn: string
  readonly endsOn: string
}

export type RhythmInput = {
  readonly interval: string
  readonly anchorOn: string
}

export type Rhythm = {
  readonly kind: RhythmKind
  readonly anchorOn: IsoDate
}

export type RhythmLine = {
  readonly userId: string
  readonly kind: RhythmKind
  readonly anchorOn: IsoDate
}

export type ChallengeWindow = {
  readonly phase: 'draft' | 'active'
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
}

export type MembershipSpan = {
  readonly joinedOn: IsoDate
  readonly leftOn: IsoDate | null
}

export type ChallengeHeadline = {
  readonly terms: ChallengeTerms
  readonly minorDigits: number
}

export type MemberChallengeCard =
  | {
      readonly phase: 'unopened'
      readonly floor: number
      readonly cap: number
      readonly currencies: readonly CurrencyCode[]
    }
  | {
      readonly phase: 'draft'
      readonly terms: ChallengeTerms
      readonly minorDigits: number
      readonly floor: number
      readonly cap: number
      readonly currencies: readonly CurrencyCode[]
      readonly rhythms: readonly RhythmLine[]
    }
  | {
      readonly phase: 'active'
      readonly terms: ChallengeTerms
      readonly minorDigits: number
      readonly rhythms: readonly RhythmLine[]
    }

export type TermsFailure =
  | 'name_empty'
  | 'name_too_long'
  | 'type_missing'
  | 'custom_label_empty'
  | 'custom_label_too_long'
  | 'bad_currency'
  | 'stake_not_positive'
  | 'stake_too_large'
  | 'bad_date'
  | 'ends_before_start'

export type ChallengeFailure =
  | TermsFailure
  | 'group_missing'
  | 'not_member'
  | 'frozen'
  | 'no_challenge'
  | 'outside_headcount'
  | 'rhythm_past_end'
  | 'bad_interval'
  | 'bad_anchor'
  | 'anchor_after_end'

export const challengeFailureCopy = {
  name_empty: 'Type a challenge name.',
  name_too_long: 'Use 40 characters or fewer.',
  type_missing: 'Pick a challenge type.',
  custom_label_empty: 'Type a custom type.',
  custom_label_too_long: 'Use 40 characters or fewer.',
  bad_currency: 'Use a three-letter currency code.',
  stake_not_positive: 'Type a stake above zero.',
  stake_too_large: `Use ${STAKE_MINOR_MAX} minor units or fewer.`,
  bad_date: 'Use a real date.',
  ends_before_start: 'End on or after the start date.',
  group_missing: 'That group does not exist.',
  not_member: 'Join the group before changing the challenge.',
  frozen: 'This challenge has started, so those fields stay as they are.',
  no_challenge: 'Name the challenge before choosing how often you log.',
  outside_headcount: 'The number of active people is outside the range on this card.',
  rhythm_past_end: 'Fix a logging anchor that sits after the challenge ends.',
  bad_interval: 'Pick how often you log.',
  bad_anchor: 'Use a real anchor date.',
  anchor_after_end: 'Pick an anchor on or before the end date.',
} as const satisfies Record<ChallengeFailure, string>

export type SaveChallengeResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly failure: TermsFailure | 'group_missing' | 'not_member' | 'frozen' | 'anchor_after_end'
    }

export type StartChallengeResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly failure: 'group_missing' | 'not_member' | 'no_challenge' | 'outside_headcount' | 'rhythm_past_end'
    }

export type SaveRhythmResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly failure:
        | 'group_missing'
        | 'not_member'
        | 'no_challenge'
        | 'bad_interval'
        | 'bad_anchor'
        | 'anchor_after_end'
        | 'frozen'
    }

export type ReadChallengeResult =
  | { readonly ok: false; readonly failure: 'group_missing' | 'not_member' }
  | { readonly ok: true; readonly card: MemberChallengeCard }

export type RhythmSlot =
  | { readonly mode: 'open'; readonly rhythm: Rhythm | null }
  | { readonly mode: 'first' }
  | { readonly mode: 'locked'; readonly rhythm: Rhythm }

type Sql = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

type StakeParts = { readonly whole: string; readonly frac: string | null }

type ParsedChallenge = {
  readonly name: string
  readonly type: ChallengeType
  readonly currency: string
  readonly stake: StakeParts
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
}

type StoredChallenge = {
  readonly terms: ChallengeTerms
  readonly minorDigits: number
  readonly phase: 'draft' | 'active'
}

class CommandError extends Error {
  readonly failure: ChallengeFailure

  constructor(failure: ChallengeFailure) {
    super(failure)
    this.failure = failure
  }
}

const CHALLENGE_SELECT = `
  SELECT c.name,
         c.type_kind,
         c.custom_label,
         btrim(c.currency) AS currency,
         c.stake_minor,
         to_char(c.starts_on, 'YYYY-MM-DD') AS starts_on,
         to_char(c.ends_on, 'YYYY-MM-DD') AS ends_on,
         c.phase,
         k.minor_digits
  FROM challenges c
  LEFT JOIN currency_codes k ON k.code = c.currency
`

function codePointLength(value: string): number {
  return Array.from(value).length
}

function isPreset(value: string): value is PresetKind {
  return Object.prototype.hasOwnProperty.call(PRESET_LABELS, value)
}

export function isRhythmKind(value: string): value is RhythmKind {
  return Object.prototype.hasOwnProperty.call(RHYTHM_STEP, value)
}

function isFailure(value: string): value is ChallengeFailure {
  return Object.prototype.hasOwnProperty.call(challengeFailureCopy, value)
}

function readDbError(error: unknown): { code: string; message: string } | null {
  if (!(error instanceof Error)) return null
  const row = error as Error & { code?: unknown }
  if (typeof row.code !== 'string') return null
  return { code: row.code, message: error.message.trim() }
}

function failureFrom(error: unknown): ChallengeFailure | null {
  if (error instanceof CommandError) return error.failure
  const dbError = readDbError(error)
  if (!dbError || dbError.code !== 'P0001' || !isFailure(dbError.message)) return null
  return dbError.message
}

function dateFrom(value: unknown): IsoDate {
  if (typeof value !== 'string') throw new Error('date')
  const parsed = parseIsoDate(value)
  if (!parsed) throw new Error('date')
  return parsed
}

function currencyFrom(value: unknown): CurrencyCode {
  if (typeof value !== 'string') throw new Error('currency')
  const code = value.trim()
  if (!CURRENCY_SHAPE.test(code)) throw new Error('currency')
  return code as CurrencyCode
}

function integerFrom(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (
    typeof value === 'bigint' &&
    value <= BigInt(Number.MAX_SAFE_INTEGER) &&
    value >= BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return Number(value)
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  throw new Error('integer')
}

function minorDigitsFrom(value: unknown): number {
  const digits = integerFrom(value)
  if (digits < 0 || digits > 4) throw new Error('minor digits')
  return digits
}

function stakeFrom(value: unknown): StakeMinor {
  const stake = integerFrom(value)
  if (stake < 1 || stake > STAKE_MINOR_MAX) throw new Error('stake')
  return stake as StakeMinor
}

function typeFrom(kind: unknown, label: unknown): ChallengeType {
  if (kind === 'custom') {
    if (typeof label !== 'string' || codePointLength(label.trim()) === 0 || codePointLength(label.trim()) > NAME_MAX) {
      throw new Error('type')
    }
    return { kind: 'custom', label }
  }
  if (typeof kind === 'string' && isPreset(kind) && label === null) return { kind: 'preset', preset: kind }
  throw new Error('type')
}

function utcOrdinal(day: IsoDate): number {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const date = Number(day.slice(8, 10))
  const utc = new Date(Date.UTC(year, month - 1, date))
  if (year < 100) utc.setUTCFullYear(year, month - 1, date)
  return utc.getTime() / MS_PER_DAY
}

export function parseIsoDate(raw: string): IsoDate | null {
  const text = raw.trim()
  const match = ISO_DATE.exec(text)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (year < 100) utc.setUTCFullYear(year, month - 1, day)
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null
  return text as IsoDate
}

export function memberIsDue(
  challenge: ChallengeWindow | null,
  span: MembershipSpan | null,
  rhythm: Rhythm | null,
  day: IsoDate,
): boolean {
  if (!challenge || !span || !rhythm) return false
  if (challenge.phase === 'draft') return false
  if (day < challenge.startsOn || day > challenge.endsOn) return false
  if (day < span.joinedOn) return false
  if (span.leftOn !== null && day > span.leftOn) return false
  if (day < rhythm.anchorOn) return false
  const count = utcOrdinal(day) - utcOrdinal(rhythm.anchorOn)
  return count % RHYTHM_STEP[rhythm.kind] === 0
}

export function formatMinor(minor: number, minorDigits: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error('amount')
  const sign = minor < 0 ? '-' : ''
  const digits = String(Math.abs(minor))
  if (minorDigits === 0) return `${sign}${digits}`
  const padded = digits.padStart(minorDigits + 1, '0')
  return `${sign}${padded.slice(0, -minorDigits)}.${padded.slice(-minorDigits)}`
}

export function formatStake(stakeMinor: StakeMinor, minorDigits: number): string {
  return formatMinor(stakeMinor, minorDigits)
}

export function rhythmSlot(phase: 'draft' | 'active', rhythms: readonly RhythmLine[], userId: string): RhythmSlot {
  const line = rhythms.find((item) => item.userId === userId)
  const rhythm = line ? { kind: line.kind, anchorOn: line.anchorOn } : null
  if (phase === 'draft') return { mode: 'open', rhythm }
  if (!rhythm) return { mode: 'first' }
  return { mode: 'locked', rhythm }
}

function parseName(raw: string): { ok: true; name: string } | { ok: false; failure: 'name_empty' | 'name_too_long' } {
  const name = raw.trim()
  const length = codePointLength(name)
  if (length === 0) return { ok: false, failure: 'name_empty' }
  if (length > NAME_MAX) return { ok: false, failure: 'name_too_long' }
  return { ok: true, name }
}

function parseType(
  type: string,
  customLabel: string,
): { ok: true; type: ChallengeType } | { ok: false; failure: 'type_missing' | 'custom_label_empty' | 'custom_label_too_long' } {
  if (type === 'custom') {
    const label = customLabel.trim()
    const length = codePointLength(label)
    if (length === 0) return { ok: false, failure: 'custom_label_empty' }
    if (length > NAME_MAX) return { ok: false, failure: 'custom_label_too_long' }
    return { ok: true, type: { kind: 'custom', label } }
  }
  if (isPreset(type)) return { ok: true, type: { kind: 'preset', preset: type } }
  return { ok: false, failure: 'type_missing' }
}

function splitStake(raw: string): StakeParts | null {
  const text = raw.trim()
  if (text === '' || /[+\-,]/.test(text)) return null
  const parts = text.split('.')
  if (parts.length > 2) return null
  const whole = parts[0] ?? ''
  const frac = parts.length === 2 ? (parts[1] ?? '') : null
  if (frac === '') return null
  if (!/^\d+$/.test(whole)) return null
  if (frac !== null && !/^\d+$/.test(frac)) return null
  return { whole, frac }
}

export type AmountFailure = 'not_positive' | 'too_large'

export function parseMinorAmount(
  raw: string,
  minorDigits: number,
  max: number,
): { ok: true; minor: number } | { ok: false; failure: AmountFailure } {
  const parts = splitStake(raw)
  if (!parts) return { ok: false, failure: 'not_positive' }
  return scaleAmount(parts, minorDigits, max)
}

function scaleAmount(
  parts: StakeParts,
  minorDigits: number,
  max: number,
): { ok: true; minor: number } | { ok: false; failure: AmountFailure } {
  if (parts.frac !== null && (minorDigits === 0 || parts.frac.length > minorDigits)) {
    return { ok: false, failure: 'not_positive' }
  }
  const frac = (parts.frac ?? '').padEnd(minorDigits, '0')
  const digits = `${parts.whole}${frac}`.replace(/^0+/, '') || '0'
  const value = BigInt(digits)
  if (value === 0n) return { ok: false, failure: 'not_positive' }
  if (value > BigInt(max)) return { ok: false, failure: 'too_large' }
  return { ok: true, minor: Number(value) }
}

function scaleStake(
  parts: StakeParts,
  minorDigits: number,
): { ok: true; stakeMinor: StakeMinor } | { ok: false; failure: 'stake_not_positive' | 'stake_too_large' } {
  const scaled = scaleAmount(parts, minorDigits, STAKE_MINOR_MAX)
  if (!scaled.ok) return { ok: false, failure: scaled.failure === 'too_large' ? 'stake_too_large' : 'stake_not_positive' }
  return { ok: true, stakeMinor: scaled.minor as StakeMinor }
}

function parseChallengeInput(
  input: ChallengeInput,
): { ok: true; value: ParsedChallenge } | { ok: false; failure: TermsFailure } {
  const name = parseName(input.name)
  if (!name.ok) return name
  const type = parseType(input.type, input.customLabel)
  if (!type.ok) return type
  const currency = input.currency.trim().toUpperCase()
  if (!CURRENCY_SHAPE.test(currency)) return { ok: false, failure: 'bad_currency' }
  const stake = splitStake(input.stake)
  if (!stake) return { ok: false, failure: 'stake_not_positive' }
  const startsOn = parseIsoDate(input.startsOn)
  const endsOn = parseIsoDate(input.endsOn)
  if (!startsOn || !endsOn) return { ok: false, failure: 'bad_date' }
  if (endsOn < startsOn) return { ok: false, failure: 'ends_before_start' }
  return { ok: true, value: { name: name.name, type: type.type, currency, stake, startsOn, endsOn } }
}

function sameType(left: ChallengeType, right: ChallengeType): boolean {
  if (left.kind === 'preset' && right.kind === 'preset') return left.preset === right.preset
  if (left.kind === 'custom' && right.kind === 'custom') return left.label === right.label
  return false
}

function sameTerms(left: ChallengeTerms, right: ChallengeTerms): boolean {
  return (
    left.name === right.name &&
    sameType(left.type, right.type) &&
    left.currency === right.currency &&
    left.stakeMinor === right.stakeMinor &&
    left.startsOn === right.startsOn &&
    left.endsOn === right.endsOn
  )
}

function challengeFrom(row: Record<string, unknown>): StoredChallenge {
  const phase = row.phase
  if (phase !== 'draft' && phase !== 'active') throw new Error('phase')
  if (typeof row.name !== 'string' || codePointLength(row.name.trim()) === 0) throw new Error('name')
  return {
    phase,
    minorDigits: minorDigitsFrom(row.minor_digits),
    terms: {
      name: row.name,
      type: typeFrom(row.type_kind, row.custom_label),
      currency: currencyFrom(row.currency),
      stakeMinor: stakeFrom(row.stake_minor),
      startsOn: dateFrom(row.starts_on),
      endsOn: dateFrom(row.ends_on),
    },
  }
}

async function loadChallenge(sql: Sql, groupId: GroupId, lock: 'update' | 'share' | 'none'): Promise<StoredChallenge | null> {
  const clause = lock === 'update' ? 'FOR UPDATE OF c' : lock === 'share' ? 'FOR SHARE OF c' : ''
  const result = await sql.query(`${CHALLENGE_SELECT} WHERE c.group_id = $1::uuid ${clause}`, [groupId])
  const row = result.rows[0]
  if (!row) return null
  return challengeFrom(row)
}

async function requireGroup(sql: Sql, groupId: GroupId, lock: boolean): Promise<void> {
  const result = await sql.query(`SELECT 1 AS ok FROM groups WHERE id = $1::uuid ${lock ? 'FOR UPDATE' : ''}`, [groupId])
  if (!result.rows[0]) throw new CommandError('group_missing')
}

async function requireMember(sql: Sql, groupId: GroupId, userId: string): Promise<void> {
  const result = await sql.query(`SELECT 1 AS ok FROM active_memberships WHERE group_id = $1::uuid AND user_id = $2::uuid`, [
    groupId,
    userId,
  ])
  if (!result.rows[0]) throw new CommandError('not_member')
}

async function loadCurrencies(sql: Sql): Promise<readonly CurrencyCode[]> {
  const result = await sql.query<{ code: string }>(`SELECT btrim(code) AS code FROM currency_codes ORDER BY code`)
  return result.rows.map((row) => currencyFrom(row.code))
}

async function loadRhythms(sql: Sql, groupId: GroupId): Promise<readonly RhythmLine[]> {
  const result = await sql.query<{ user_id: string; kind: string; anchor_on: string }>(
    `SELECT user_id::text AS user_id, kind, to_char(anchor_on, 'YYYY-MM-DD') AS anchor_on
     FROM logging_rhythms
     WHERE group_id = $1::uuid
     ORDER BY user_id`,
    [groupId],
  )
  return result.rows.map((row) => {
    if (!isRhythmKind(row.kind)) throw new Error('rhythm')
    if (typeof row.user_id !== 'string' || row.user_id === '') throw new Error('rhythm user')
    return { userId: row.user_id, kind: row.kind, anchorOn: dateFrom(row.anchor_on) }
  })
}

async function boundsFrom(sql: Sql): Promise<{ floor: number; cap: number }> {
  const result = await sql.query<{ floor: number | string; cap: number | string }>(
    `SELECT challenge_member_floor() AS floor, active_member_cap() AS cap`,
  )
  const row = result.rows[0]
  if (!row) throw new Error('bounds')
  const floor = integerFrom(row.floor)
  const cap = integerFrom(row.cap)
  if (floor < 1 || cap < floor) throw new Error('bounds')
  return { floor, cap }
}

function labelOf(type: ChallengeType): string | null {
  return type.kind === 'custom' ? type.label : null
}

function kindOf(type: ChallengeType): string {
  return type.kind === 'custom' ? 'custom' : type.preset
}

export async function saveChallenge(
  db: PGlite,
  account: Account,
  groupId: GroupId,
  input: ChallengeInput,
): Promise<SaveChallengeResult> {
  const parsed = parseChallengeInput(input)
  if (!parsed.ok) return parsed
  try {
    return await db.transaction(async (tx) => {
      await requireGroup(tx, groupId, true)
      await requireMember(tx, groupId, account.id)
      const currency = await tx.query<{ minor_digits: number | string }>(
        `SELECT minor_digits FROM currency_codes WHERE code = $1`,
        [parsed.value.currency],
      )
      const digits = currency.rows[0]
      if (!digits) throw new CommandError('bad_currency')
      const scaled = scaleStake(parsed.value.stake, minorDigitsFrom(digits.minor_digits))
      if (!scaled.ok) throw new CommandError(scaled.failure)
      const terms: ChallengeTerms = {
        name: parsed.value.name,
        type: parsed.value.type,
        currency: currencyFrom(parsed.value.currency),
        stakeMinor: scaled.stakeMinor,
        startsOn: parsed.value.startsOn,
        endsOn: parsed.value.endsOn,
      }
      const existing = await loadChallenge(tx, groupId, 'update')
      if (existing?.phase === 'active') {
        if (sameTerms(existing.terms, terms)) return { ok: true }
        throw new CommandError('frozen')
      }
      if (
        existing?.phase === 'draft' &&
        (existing.terms.startsOn !== terms.startsOn || existing.terms.endsOn !== terms.endsOn)
      ) {
        const blocked = await tx.query(
          `SELECT 1 AS ok FROM logging_rhythms WHERE group_id = $1::uuid AND anchor_on > $2::date LIMIT 1`,
          [groupId, terms.endsOn],
        )
        if (blocked.rows[0]) throw new CommandError('anchor_after_end')
      }
      const written = await tx.query(
        `INSERT INTO challenges (
           group_id, name, type_kind, custom_label, currency, stake_minor, starts_on, ends_on, phase
         ) VALUES (
           $1::uuid, $2, $3, $4, $5, $6, $7::date, $8::date, 'draft'
         )
         ON CONFLICT (group_id) DO UPDATE SET
           name = EXCLUDED.name,
           type_kind = EXCLUDED.type_kind,
           custom_label = EXCLUDED.custom_label,
           currency = EXCLUDED.currency,
           stake_minor = EXCLUDED.stake_minor,
           starts_on = EXCLUDED.starts_on,
           ends_on = EXCLUDED.ends_on
         WHERE challenges.phase = 'draft'
         RETURNING group_id`,
        [groupId, terms.name, kindOf(terms.type), labelOf(terms.type), terms.currency, terms.stakeMinor, terms.startsOn, terms.endsOn],
      )
      if (!written.rows[0]) {
        const again = await loadChallenge(tx, groupId, 'update')
        if (again && sameTerms(again.terms, terms)) return { ok: true }
        throw new CommandError('frozen')
      }
      return { ok: true }
    })
  } catch (error) {
    const failure = failureFrom(error)
    if (failure === 'group_missing' || failure === 'not_member' || failure === 'frozen' || failure === 'anchor_after_end') {
      return { ok: false, failure }
    }
    if (failure === 'bad_currency' || failure === 'stake_not_positive' || failure === 'stake_too_large') {
      return { ok: false, failure }
    }
    throw error
  }
}

export async function startChallenge(db: PGlite, account: Account, groupId: GroupId): Promise<StartChallengeResult> {
  try {
    return await db.transaction(async (tx) => {
      await requireGroup(tx, groupId, true)
      await requireMember(tx, groupId, account.id)
      const existing = await loadChallenge(tx, groupId, 'update')
      if (!existing) throw new CommandError('no_challenge')
      if (existing.phase === 'active') return { ok: true }
      const past = await tx.query(
        `SELECT 1 AS ok
         FROM logging_rhythms r
         JOIN active_memberships a ON a.group_id = r.group_id AND a.user_id = r.user_id
         WHERE r.group_id = $1::uuid AND r.anchor_on > $2::date
         LIMIT 1`,
        [groupId, existing.terms.endsOn],
      )
      if (past.rows[0]) throw new CommandError('rhythm_past_end')
      await tx.query(`UPDATE challenges SET phase = 'active' WHERE group_id = $1::uuid AND phase = 'draft'`, [groupId])
      return { ok: true }
    })
  } catch (error) {
    const failure = failureFrom(error)
    if (
      failure === 'group_missing' ||
      failure === 'not_member' ||
      failure === 'no_challenge' ||
      failure === 'outside_headcount' ||
      failure === 'rhythm_past_end'
    ) {
      return { ok: false, failure }
    }
    throw error
  }
}

export async function saveRhythm(
  db: PGlite,
  account: Account,
  groupId: GroupId,
  input: RhythmInput,
): Promise<SaveRhythmResult> {
  if (!isRhythmKind(input.interval)) return { ok: false, failure: 'bad_interval' }
  const anchorOn = parseIsoDate(input.anchorOn)
  if (!anchorOn) return { ok: false, failure: 'bad_anchor' }
  const kind: RhythmKind = input.interval
  try {
    return await db.transaction(async (tx) => {
      await requireGroup(tx, groupId, false)
      await requireMember(tx, groupId, account.id)
      const existing = await loadChallenge(tx, groupId, 'share')
      if (!existing) throw new CommandError('no_challenge')
      if (anchorOn > existing.terms.endsOn) throw new CommandError('anchor_after_end')
      const current = await tx.query<{ kind: string; anchor_on: string }>(
        `SELECT kind, to_char(anchor_on, 'YYYY-MM-DD') AS anchor_on
         FROM logging_rhythms
         WHERE group_id = $1::uuid AND user_id = $2::uuid`,
        [groupId, account.id],
      )
      const row = current.rows[0]
      if (existing.phase === 'active' && row) {
        if (row.kind === kind && row.anchor_on === anchorOn) return { ok: true }
        throw new CommandError('frozen')
      }
      const written = await tx.query(
        `INSERT INTO logging_rhythms (group_id, user_id, kind, anchor_on)
         VALUES ($1::uuid, $2::uuid, $3, $4::date)
         ON CONFLICT (group_id, user_id) DO UPDATE SET
           kind = EXCLUDED.kind,
           anchor_on = EXCLUDED.anchor_on
         WHERE EXISTS (
           SELECT 1 FROM challenges c
           WHERE c.group_id = logging_rhythms.group_id AND c.phase = 'draft'
         )
         RETURNING group_id`,
        [groupId, account.id, kind, anchorOn],
      )
      if (!written.rows[0]) {
        const again = await tx.query<{ kind: string; anchor_on: string }>(
          `SELECT kind, to_char(anchor_on, 'YYYY-MM-DD') AS anchor_on
           FROM logging_rhythms
           WHERE group_id = $1::uuid AND user_id = $2::uuid`,
          [groupId, account.id],
        )
        const kept = again.rows[0]
        if (kept && kept.kind === kind && kept.anchor_on === anchorOn) return { ok: true }
        throw new CommandError('frozen')
      }
      return { ok: true }
    })
  } catch (error) {
    const failure = failureFrom(error)
    if (
      failure === 'group_missing' ||
      failure === 'not_member' ||
      failure === 'no_challenge' ||
      failure === 'anchor_after_end' ||
      failure === 'frozen'
    ) {
      return { ok: false, failure }
    }
    throw error
  }
}

export async function readChallengeHeadline(db: PGlite, groupId: GroupId): Promise<ChallengeHeadline | null> {
  const stored = await loadChallenge(db, groupId, 'none')
  if (!stored) return null
  return { terms: stored.terms, minorDigits: stored.minorDigits }
}

export async function readMemberChallenge(db: PGlite, account: Account, groupId: GroupId): Promise<ReadChallengeResult> {
  const group = await db.query(`SELECT 1 AS ok FROM groups WHERE id = $1::uuid`, [groupId])
  if (!group.rows[0]) return { ok: false, failure: 'group_missing' }
  const member = await db.query(`SELECT 1 AS ok FROM active_memberships WHERE group_id = $1::uuid AND user_id = $2::uuid`, [
    groupId,
    account.id,
  ])
  if (!member.rows[0]) return { ok: false, failure: 'not_member' }
  const stored = await loadChallenge(db, groupId, 'none')
  if (!stored) {
    const bounds = await boundsFrom(db)
    return { ok: true, card: { phase: 'unopened', ...bounds, currencies: await loadCurrencies(db) } }
  }
  const rhythms = await loadRhythms(db, groupId)
  if (stored.phase === 'draft') {
    const bounds = await boundsFrom(db)
    return {
      ok: true,
      card: {
        phase: 'draft',
        terms: stored.terms,
        minorDigits: stored.minorDigits,
        ...bounds,
        currencies: await loadCurrencies(db),
        rhythms,
      },
    }
  }
  return { ok: true, card: { phase: 'active', terms: stored.terms, minorDigits: stored.minorDigits, rhythms } }
}

import { CURRENCY_CODES, minorDigitsOf } from './currencies.ts'
import type { Database } from './db.ts'
import type { Account } from './identity.ts'
import type { GroupId } from './groups.ts'
import {
  ACTIVE_MEMBER_CAP,
  activeMemberIds,
  compare,
  groupRef,
  memberOf,
  readGroup,
  rhythmOf,
  type ChallengeDoc,
  type GroupDoc,
  type MemberDoc,
  type RhythmDoc,
} from './store.ts'

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
} as const

export type RhythmKind = keyof typeof RHYTHM_STEP

export const RHYTHM_LABELS: { readonly [K in RhythmKind]: string } = {
  every_day: 'Every day',
  every_2_days: 'Every 2 days',
  every_3_days: 'Every 3 days',
}

const NAME_MAX = 40
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const CURRENCY_SHAPE = /^[A-Z]{3}$/
const MS_PER_DAY = 86_400_000

export type IsoDate = string & { readonly brand: 'IsoDate' }
export type StakeMinor = number & { readonly brand: 'StakeMinor' }
export type CurrencyCode = string & { readonly brand: 'CurrencyCode' }
export type CauseName = string & { readonly brand: 'CauseName' }

export type StakesGo = { readonly kind: 'members' } | { readonly kind: 'cause'; readonly name: CauseName }

export type StartInput = {
  readonly cause: string
}

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
}

export type Rhythm = {
  readonly kind: RhythmKind
}

export type RhythmLine = {
  readonly userId: string
  readonly kind: RhythmKind
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
  readonly stakesGo: StakesGo | null
}

export type StartKind = 'solo' | 'group' | 'over_cap'

export type StartStep = 'terms_saved' | 'rhythms_picked' | 'headcount'

export type StartCheck = { readonly step: StartStep; readonly done: boolean }

const startStepFailure = {
  terms_saved: 'no_challenge',
  rhythms_picked: 'rhythms_missing',
  headcount: 'outside_headcount',
} as const satisfies Record<StartStep, ChallengeFailure>

export type MemberChallengeCard =
  | {
      readonly phase: 'unopened'
      readonly cap: number
      readonly currencies: readonly CurrencyCode[]
      readonly checks: readonly StartCheck[]
      readonly missingRhythms: readonly string[]
    }
  | {
      readonly phase: 'draft'
      readonly terms: ChallengeTerms
      readonly minorDigits: number
      readonly cap: number
      readonly start: StartKind
      readonly checks: readonly StartCheck[]
      readonly missingRhythms: readonly string[]
      readonly currencies: readonly CurrencyCode[]
      readonly rhythms: readonly RhythmLine[]
    }
  | {
      readonly phase: 'active'
      readonly terms: ChallengeTerms
      readonly minorDigits: number
      readonly stakesGo: StakesGo
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
  | 'not_creator'
  | 'frozen'
  | 'no_challenge'
  | 'outside_headcount'
  | 'cause_empty'
  | 'cause_too_long'
  | 'cause_for_group'
  | 'rhythms_missing'
  | 'bad_interval'

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
  not_creator: 'Only the person who made the group can change the terms or start the challenge.',
  frozen: 'This challenge has started, so those fields stay as they are.',
  no_challenge: 'Name the challenge before choosing how often you log.',
  outside_headcount: 'The number of active people is outside the range on this card.',
  cause_empty: 'Type who your missed days are owed to.',
  cause_too_long: 'Use 40 characters or fewer.',
  cause_for_group: 'Someone else joined, so this is a group challenge now and needs no cause. Press Start again.',
  rhythms_missing: 'Everyone needs to pick a rhythm before the challenge starts.',
  bad_interval: 'Pick how often you log.',
} as const satisfies Record<ChallengeFailure, string>

export type SaveChallengeResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly failure: TermsFailure | 'group_missing' | 'not_member' | 'not_creator' | 'frozen'
    }

export type StartChallengeResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly failure:
        | 'group_missing'
        | 'not_member'
        | 'not_creator'
        | 'no_challenge'
        | 'outside_headcount'
        | 'cause_empty'
        | 'cause_too_long'
        | 'cause_for_group'
        | 'rhythms_missing'
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
        | 'frozen'
    }

export type ReadChallengeResult =
  | { readonly ok: false; readonly failure: 'group_missing' | 'not_member' }
  | { readonly ok: true; readonly card: MemberChallengeCard }

export type RhythmSlot =
  | { readonly mode: 'open'; readonly rhythm: Rhythm | null }
  | { readonly mode: 'first' }
  | { readonly mode: 'locked'; readonly rhythm: Rhythm }

type StakeParts = { readonly whole: string; readonly frac: string | null }

type ParsedChallenge = {
  readonly name: string
  readonly type: ChallengeType
  readonly currency: string
  readonly stake: StakeParts
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
}

type StoredChallenge =
  | { readonly phase: 'draft'; readonly terms: ChallengeTerms; readonly minorDigits: number }
  | { readonly phase: 'active'; readonly terms: ChallengeTerms; readonly minorDigits: number; readonly stakesGo: StakesGo }

class CommandError extends Error {
  readonly failure: ChallengeFailure

  constructor(failure: ChallengeFailure) {
    super(failure)
    this.failure = failure
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function isPreset(value: string): value is PresetKind {
  return Object.prototype.hasOwnProperty.call(PRESET_LABELS, value)
}

export function isRhythmKind(value: string): value is RhythmKind {
  return Object.prototype.hasOwnProperty.call(RHYTHM_STEP, value)
}

export function utcOrdinal(day: IsoDate): number {
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
  return (utcOrdinal(day) - utcOrdinal(challenge.startsOn)) % RHYTHM_STEP[rhythm.kind] === 0
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
  const rhythm = line ? { kind: line.kind } : null
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

function parseCause(raw: string): { ok: true; name: CauseName } | { ok: false; failure: 'cause_empty' | 'cause_too_long' } {
  const name = raw.trim()
  const length = codePointLength(name)
  if (length === 0) return { ok: false, failure: 'cause_empty' }
  if (length > NAME_MAX) return { ok: false, failure: 'cause_too_long' }
  return { ok: true, name: name as CauseName }
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

function dateFrom(value: string): IsoDate {
  const parsed = parseIsoDate(value)
  if (!parsed) throw new Error('date')
  return parsed
}

function typeFrom(kind: string, label: string | null): ChallengeType {
  if (kind === 'custom' && label !== null) return { kind: 'custom', label }
  if (isPreset(kind) && label === null) return { kind: 'preset', preset: kind }
  throw new Error('type')
}

export function stakesGoFrom(doc: ChallengeDoc | null): StakesGo | null {
  if (doc?.phase !== 'active') return null
  if (doc.cause === null) return { kind: 'members' }
  const cause = parseCause(doc.cause)
  if (!cause.ok) throw new Error('cause')
  return { kind: 'cause', name: cause.name }
}

function storedFrom(doc: ChallengeDoc): StoredChallenge {
  const minorDigits = minorDigitsOf(doc.currency)
  if (minorDigits === null) throw new Error('currency')
  const terms: ChallengeTerms = {
    name: doc.name,
    type: typeFrom(doc.typeKind, doc.customLabel),
    currency: doc.currency as CurrencyCode,
    stakeMinor: doc.stakeMinor as StakeMinor,
    startsOn: dateFrom(doc.startsOn),
    endsOn: dateFrom(doc.endsOn),
  }
  const stakesGo = stakesGoFrom(doc)
  if (!stakesGo) return { phase: 'draft', minorDigits, terms }
  return { phase: 'active', minorDigits, terms, stakesGo }
}

function startKind(activeCount: number): StartKind {
  if (activeCount === 1) return 'solo'
  if (activeCount <= ACTIVE_MEMBER_CAP) return 'group'
  return 'over_cap'
}

function rhythmsMissing(group: GroupDoc): readonly string[] {
  return activeMemberIds(group).filter((userId) => !rhythmOf(group, userId))
}

// Listed in the order startChallenge reports them, so the first unmet step is the failure a press of Start gets.
function startChecks(group: GroupDoc): readonly StartCheck[] {
  const active = activeMemberIds(group)
  return [
    { step: 'terms_saved', done: group.challenge !== null },
    { step: 'rhythms_picked', done: rhythmsMissing(group).length === 0 },
    { step: 'headcount', done: startKind(active.length) !== 'over_cap' },
  ]
}

function draftDoc(terms: ChallengeTerms): ChallengeDoc {
  return {
    name: terms.name,
    typeKind: terms.type.kind === 'custom' ? 'custom' : terms.type.preset,
    customLabel: terms.type.kind === 'custom' ? terms.type.label : null,
    currency: terms.currency,
    stakeMinor: terms.stakeMinor,
    startsOn: terms.startsOn,
    endsOn: terms.endsOn,
    phase: 'draft',
  }
}

export function windowFrom(doc: ChallengeDoc | null): ChallengeWindow | null {
  if (!doc) return null
  return { phase: doc.phase, startsOn: dateFrom(doc.startsOn), endsOn: dateFrom(doc.endsOn) }
}

export function spanFrom(member: MemberDoc | null): MembershipSpan | null {
  if (!member) return null
  return { joinedOn: dateFrom(member.joinedOn), leftOn: member.leftOn === null ? null : dateFrom(member.leftOn) }
}

export function rhythmFrom(doc: RhythmDoc | null): Rhythm | null {
  if (!doc) return null
  if (!isRhythmKind(doc.kind)) throw new Error('rhythm')
  return { kind: doc.kind }
}

function rhythmLines(group: GroupDoc): readonly RhythmLine[] {
  return Object.keys(group.rhythms)
    .sort(compare)
    .map((userId) => {
      const rhythm = rhythmFrom(rhythmOf(group, userId))
      if (!rhythm) throw new Error('rhythm')
      return { userId, ...rhythm }
    })
}

function isActiveMember(group: GroupDoc, userId: string): boolean {
  return memberOf(group, userId)?.leftOn === null
}

function requireCreator(group: GroupDoc, account: Account): void {
  if (group.createdBy !== account.id) throw new CommandError('not_creator')
}

// Every write reads the group document first, so writers to one group serialize on it and each rule sees the latest members, terms, and rhythms.
type FailureOf<R> = R extends { readonly ok: false; readonly failure: infer F } ? F : never

async function changeGroup<R extends { readonly ok: boolean }>(
  db: Database,
  account: Account,
  groupId: GroupId,
  change: (group: GroupDoc) => { readonly [field: string]: unknown } | null,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly failure: FailureOf<R> }> {
  try {
    await db.runTransaction(async (tx) => {
      const group = await readGroup(db, groupId, tx)
      if (!group) throw new CommandError('group_missing')
      if (!isActiveMember(group, account.id)) throw new CommandError('not_member')
      const fields = change(group)
      if (fields) tx.update(groupRef(db, groupId), fields)
    })
    return { ok: true }
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, failure: error.failure as FailureOf<R> }
    throw error
  }
}

export async function saveChallenge(
  db: Database,
  account: Account,
  groupId: GroupId,
  input: ChallengeInput,
): Promise<SaveChallengeResult> {
  const parsed = parseChallengeInput(input)
  if (!parsed.ok) return parsed
  return changeGroup<SaveChallengeResult>(db, account, groupId, (group) => {
    requireCreator(group, account)
    const minorDigits = minorDigitsOf(parsed.value.currency)
    if (minorDigits === null) throw new CommandError('bad_currency')
    const scaled = scaleStake(parsed.value.stake, minorDigits)
    if (!scaled.ok) throw new CommandError(scaled.failure)
    const terms: ChallengeTerms = {
      name: parsed.value.name,
      type: parsed.value.type,
      currency: parsed.value.currency as CurrencyCode,
      stakeMinor: scaled.stakeMinor,
      startsOn: parsed.value.startsOn,
      endsOn: parsed.value.endsOn,
    }
    const existing = group.challenge ? storedFrom(group.challenge) : null
    if (existing?.phase === 'active') {
      if (sameTerms(existing.terms, terms)) return null
      throw new CommandError('frozen')
    }
    return { challenge: draftDoc(terms) }
  })
}

export async function startChallenge(
  db: Database,
  account: Account,
  groupId: GroupId,
  input: StartInput,
): Promise<StartChallengeResult> {
  return changeGroup<StartChallengeResult>(db, account, groupId, (group) => {
    requireCreator(group, account)
    if (group.challenge?.phase === 'active') return null
    const unmet = startChecks(group).find((check) => !check.done)
    if (unmet) throw new CommandError(startStepFailure[unmet.step])
    const fromStart = joinedFromStart(group)
    if (startKind(activeMemberIds(group).length) === 'group') {
      if (input.cause.trim() !== '') throw new CommandError('cause_for_group')
      return { ...fromStart, 'challenge.phase': 'active', 'challenge.cause': null }
    }
    const cause = parseCause(input.cause)
    if (!cause.ok) throw new CommandError(cause.failure)
    return { ...fromStart, 'challenge.phase': 'active', 'challenge.cause': cause.name }
  })
}

// A member who is in the group when it starts is in the challenge from its start date, even a backdated one.
function joinedFromStart(group: GroupDoc): { readonly [field: string]: string } {
  const startsOn = group.challenge?.startsOn
  if (!startsOn) return {}
  return Object.fromEntries(
    activeMemberIds(group)
      .filter((userId) => group.members[userId]!.joinedOn > startsOn)
      .map((userId) => [`members.${userId}.joinedOn`, startsOn]),
  )
}

export async function saveRhythm(
  db: Database,
  account: Account,
  groupId: GroupId,
  input: RhythmInput,
): Promise<SaveRhythmResult> {
  if (!isRhythmKind(input.interval)) return { ok: false, failure: 'bad_interval' }
  const rhythm: RhythmDoc = { kind: input.interval }
  return changeGroup<SaveRhythmResult>(db, account, groupId, (group) => {
    if (!group.challenge) throw new CommandError('no_challenge')
    const current = rhythmOf(group, account.id)
    if (group.challenge.phase === 'active' && current) {
      if (current.kind === rhythm.kind) return null
      throw new CommandError('frozen')
    }
    return { [`rhythms.${account.id}`]: rhythm }
  })
}

export async function readChallengeHeadline(db: Database, groupId: GroupId): Promise<ChallengeHeadline | null> {
  const group = await readGroup(db, groupId)
  if (!group?.challenge) return null
  const stored = storedFrom(group.challenge)
  return { terms: stored.terms, minorDigits: stored.minorDigits, stakesGo: stored.phase === 'active' ? stored.stakesGo : null }
}

export async function readMemberChallenge(db: Database, account: Account, groupId: GroupId): Promise<ReadChallengeResult> {
  const group = await readGroup(db, groupId)
  if (!group) return { ok: false, failure: 'group_missing' }
  if (!isActiveMember(group, account.id)) return { ok: false, failure: 'not_member' }
  const cap = ACTIVE_MEMBER_CAP
  const currencies = CURRENCY_CODES as readonly CurrencyCode[]
  const checks = startChecks(group)
  const missingRhythms = rhythmsMissing(group)
  if (!group.challenge) return { ok: true, card: { phase: 'unopened', cap, currencies, checks, missingRhythms } }
  const stored = storedFrom(group.challenge)
  const rhythms = rhythmLines(group)
  if (stored.phase === 'draft') {
    const start = startKind(activeMemberIds(group).length)
    return {
      ok: true,
      card: { phase: 'draft', terms: stored.terms, minorDigits: stored.minorDigits, cap, start, checks, missingRhythms, currencies, rhythms },
    }
  }
  return {
    ok: true,
    card: { phase: 'active', terms: stored.terms, minorDigits: stored.minorDigits, stakesGo: stored.stakesGo, rhythms },
  }
}

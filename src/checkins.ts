import type { Database } from './db.ts'
import { memberIsDue, parseIsoDate, rhythmFrom, spanFrom, utcOrdinal, windowFrom, type IsoDate, type MembershipSpan } from './challenge.ts'
import type { GroupId } from './groups.ts'
import type { Account } from './identity.ts'
import { checkInRef, compare, memberOf, parseCheckIn, readCheckIns, readGroup, readUsers, rhythmOf, type CheckInDoc } from './store.ts'

export const CHECK_IN_LABELS = {
  green: 'Green',
  red: 'Red',
} as const

export type CheckInColor = keyof typeof CHECK_IN_LABELS

export type CheckIn = {
  readonly userId: string
  readonly displayName: string
  readonly day: IsoDate
  readonly color: CheckInColor
}

export type CheckInInput = {
  readonly day: string
  readonly color: string
}

export type CheckInFailure =
  | 'group_missing'
  | 'not_member'
  | 'bad_day'
  | 'future_day'
  | 'bad_color'
  | 'outside_membership'
  | 'not_due'

export const checkInFailureCopy = {
  group_missing: 'That group does not exist.',
  not_member: 'Join the group before you log a day.',
  bad_day: 'Use a real date.',
  future_day: 'That day has not come yet.',
  bad_color: 'Pick green or red.',
  outside_membership: 'You were not in the group on that day.',
  not_due: 'That day is not one of your logging days.',
} as const satisfies Record<CheckInFailure, string>

export type LogCheckInResult =
  | { readonly ok: true; readonly day: IsoDate; readonly color: CheckInColor; readonly previous: CheckInColor | null }
  | { readonly ok: false; readonly failure: CheckInFailure }

class CheckInRejected extends Error {
  readonly failure: CheckInFailure

  constructor(failure: CheckInFailure) {
    super(failure)
    this.failure = failure
  }
}

export function isColor(value: string): value is CheckInColor {
  return Object.prototype.hasOwnProperty.call(CHECK_IN_LABELS, value)
}

// Today is the UTC day. Tomorrow is allowed too, because it has already begun in time zones ahead of UTC.
function hasBegun(day: IsoDate, today: IsoDate): boolean {
  return utcOrdinal(day) <= utcOrdinal(today) + 1
}

function colorOf(checkIn: CheckInDoc): CheckInColor {
  if (!isColor(checkIn.color)) throw new Error('check-in')
  return checkIn.color
}

function withinSpan(span: MembershipSpan, day: IsoDate): boolean {
  return day >= span.joinedOn && (span.leftOn === null || day <= span.leftOn)
}

export async function logCheckIn(
  db: Database,
  account: Account,
  groupId: GroupId,
  input: CheckInInput,
  today: IsoDate,
): Promise<LogCheckInResult> {
  const day = parseIsoDate(input.day)
  if (!day) return { ok: false, failure: 'bad_day' }
  if (!hasBegun(day, today)) return { ok: false, failure: 'future_day' }
  if (!isColor(input.color)) return { ok: false, failure: 'bad_color' }
  const checkIn: CheckInDoc = { userId: account.id, day, color: input.color }
  try {
    const previous = await db.runTransaction(async (tx): Promise<CheckInColor | null> => {
      const group = await readGroup(db, groupId, tx)
      if (!group) throw new CheckInRejected('group_missing')
      const span = spanFrom(memberOf(group, account.id))
      if (!span) throw new CheckInRejected('not_member')
      if (!withinSpan(span, day)) throw new CheckInRejected('outside_membership')
      const rhythm = rhythmFrom(rhythmOf(group, account.id))
      if (!memberIsDue(windowFrom(group.challenge), span, rhythm, day)) throw new CheckInRejected('not_due')
      const ref = checkInRef(db, groupId, account.id, day)
      const existing = await tx.get(ref)
      tx.set(ref, checkIn)
      return existing.exists ? colorOf(parseCheckIn(existing.data())) : null
    })
    return { ok: true, day, color: input.color, previous }
  } catch (error) {
    if (error instanceof CheckInRejected) return { ok: false, failure: error.failure }
    throw error
  }
}

export async function listCheckIns(db: Database, groupId: GroupId): Promise<readonly CheckIn[]> {
  const checkIns = await readCheckIns(db, groupId)
  const users = await readUsers(db, checkIns.map((item) => item.userId))
  return checkIns
    .flatMap((item): CheckIn[] => {
      const user = users.get(item.userId)
      const day = parseIsoDate(item.day)
      if (!user) return []
      if (!day || !isColor(item.color)) throw new Error('check-in')
      return [{ userId: item.userId, displayName: user.displayName, day, color: item.color }]
    })
    .sort((a, b) => compare(b.day, a.day) || compare(a.displayName, b.displayName) || compare(a.userId, b.userId))
}

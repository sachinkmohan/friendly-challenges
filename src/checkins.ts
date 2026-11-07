import type { PGlite } from '@electric-sql/pglite'
import {
  isRhythmKind,
  memberIsDue,
  parseIsoDate,
  type ChallengeWindow,
  type IsoDate,
  type MembershipSpan,
  type Rhythm,
} from './challenge.ts'
import type { GroupId } from './groups.ts'
import type { Account } from './identity.ts'

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
  | 'bad_color'
  | 'outside_membership'
  | 'not_due'

export const checkInFailureCopy = {
  group_missing: 'That group does not exist.',
  not_member: 'Join the group before you log a day.',
  bad_day: 'Use a real date.',
  bad_color: 'Pick green or red.',
  outside_membership: 'You were not in the group on that day.',
  not_due: 'That day is not one of your logging days.',
} as const satisfies Record<CheckInFailure, string>

export type LogCheckInResult = { readonly ok: true } | { readonly ok: false; readonly failure: CheckInFailure }

type Sql = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

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

function dateFrom(value: unknown): IsoDate {
  const parsed = typeof value === 'string' ? parseIsoDate(value) : null
  if (!parsed) throw new Error('date')
  return parsed
}

function withinSpan(span: MembershipSpan, day: IsoDate): boolean {
  return day >= span.joinedOn && (span.leftOn === null || day <= span.leftOn)
}

async function loadSpan(sql: Sql, groupId: GroupId, userId: string): Promise<MembershipSpan | null> {
  const result = await sql.query<{ joined_on: string; left_on: string | null }>(
    `SELECT to_char(joined_on, 'YYYY-MM-DD') AS joined_on, to_char(left_on, 'YYYY-MM-DD') AS left_on
     FROM memberships
     WHERE group_id = $1::uuid AND user_id = $2::uuid
     FOR SHARE`,
    [groupId, userId],
  )
  const row = result.rows[0]
  if (!row) return null
  return { joinedOn: dateFrom(row.joined_on), leftOn: row.left_on === null ? null : dateFrom(row.left_on) }
}

async function loadWindow(sql: Sql, groupId: GroupId): Promise<ChallengeWindow | null> {
  const result = await sql.query<{ phase: string; starts_on: string; ends_on: string }>(
    `SELECT phase, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
     FROM challenges
     WHERE group_id = $1::uuid
     FOR SHARE`,
    [groupId],
  )
  const row = result.rows[0]
  if (!row) return null
  if (row.phase !== 'draft' && row.phase !== 'active') throw new Error('phase')
  return { phase: row.phase, startsOn: dateFrom(row.starts_on), endsOn: dateFrom(row.ends_on) }
}

async function loadRhythm(sql: Sql, groupId: GroupId, userId: string): Promise<Rhythm | null> {
  const result = await sql.query<{ kind: string; anchor_on: string }>(
    `SELECT kind, to_char(anchor_on, 'YYYY-MM-DD') AS anchor_on
     FROM logging_rhythms
     WHERE group_id = $1::uuid AND user_id = $2::uuid
     FOR SHARE`,
    [groupId, userId],
  )
  const row = result.rows[0]
  if (!row) return null
  if (!isRhythmKind(row.kind)) throw new Error('rhythm')
  return { kind: row.kind, anchorOn: dateFrom(row.anchor_on) }
}

export async function logCheckIn(
  db: PGlite,
  account: Account,
  groupId: GroupId,
  input: CheckInInput,
): Promise<LogCheckInResult> {
  const day = parseIsoDate(input.day)
  if (!day) return { ok: false, failure: 'bad_day' }
  if (!isColor(input.color)) return { ok: false, failure: 'bad_color' }
  const color: CheckInColor = input.color
  try {
    return await db.transaction(async (tx) => {
      const group = await tx.query(`SELECT 1 AS ok FROM groups WHERE id = $1::uuid`, [groupId])
      if (!group.rows[0]) throw new CheckInRejected('group_missing')
      const span = await loadSpan(tx, groupId, account.id)
      if (!span) throw new CheckInRejected('not_member')
      if (!withinSpan(span, day)) throw new CheckInRejected('outside_membership')
      const window = await loadWindow(tx, groupId)
      const rhythm = await loadRhythm(tx, groupId, account.id)
      if (!memberIsDue(window, span, rhythm, day)) throw new CheckInRejected('not_due')
      await tx.query(
        `INSERT INTO check_ins (group_id, user_id, day, color)
         VALUES ($1::uuid, $2::uuid, $3::date, $4)
         ON CONFLICT (group_id, user_id, day) DO UPDATE SET color = EXCLUDED.color`,
        [groupId, account.id, day, color],
      )
      return { ok: true }
    })
  } catch (error) {
    if (error instanceof CheckInRejected) return { ok: false, failure: error.failure }
    throw error
  }
}

export async function listCheckIns(db: PGlite, groupId: GroupId): Promise<readonly CheckIn[]> {
  const result = await db.query<{ user_id: string; display_name: string; day: string; color: string }>(
    `SELECT k.user_id::text AS user_id, u.display_name, to_char(k.day, 'YYYY-MM-DD') AS day, k.color
     FROM check_ins k
     JOIN users u ON u.id = k.user_id
     WHERE k.group_id = $1::uuid
     ORDER BY k.day DESC, u.display_name, k.user_id`,
    [groupId],
  )
  return result.rows.map((row) => {
    if (typeof row.user_id !== 'string' || typeof row.display_name !== 'string') throw new Error('check-in user')
    if (!isColor(row.color)) throw new Error('check-in color')
    return { userId: row.user_id, displayName: row.display_name, day: dateFrom(row.day), color: row.color }
  })
}

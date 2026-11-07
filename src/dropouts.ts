import type { PGlite } from '@electric-sql/pglite'
import { parseIsoDate, type IsoDate } from './challenge.ts'
import type { GroupId } from './groups.ts'
import type { Account } from './identity.ts'

export type DropoutInput = {
  readonly memberId: string
  readonly lastDay: string
}

export type DropoutFailure =
  | 'group_missing'
  | 'not_member'
  | 'not_allowed'
  | 'bad_member'
  | 'bad_day'
  | 'before_join'
  | 'future_day'

export const dropoutFailureCopy = {
  group_missing: 'That group does not exist.',
  not_member: 'Join the group before you record a dropout.',
  not_allowed: 'Only that member or the person who made the group can record this.',
  bad_member: 'Pick someone who is still in the group.',
  bad_day: 'Use a real date.',
  before_join: 'Pick a last day on or after the day they joined.',
  future_day: 'Pick a last day that is today or earlier.',
} as const satisfies Record<DropoutFailure, string>

export type RecordDropoutResult = { readonly ok: true } | { readonly ok: false; readonly failure: DropoutFailure }

class DropoutRejected extends Error {
  readonly failure: DropoutFailure

  constructor(failure: DropoutFailure) {
    super(failure)
    this.failure = failure
  }
}

export async function recordDropout(
  db: PGlite,
  actor: Account,
  groupId: GroupId,
  input: DropoutInput,
  today: IsoDate,
): Promise<RecordDropoutResult> {
  try {
    return await db.transaction(async (tx) => {
      // The cap trigger takes this lock, so a join cannot count a member who is leaving at the same time.
      const group = await tx.query<{ created_by: string }>(
        `SELECT created_by::text AS created_by FROM groups WHERE id = $1::uuid FOR UPDATE`,
        [groupId],
      )
      const creatorId = group.rows[0]?.created_by
      if (creatorId === undefined) throw new DropoutRejected('group_missing')
      const actorRow = await tx.query(
        `SELECT 1 AS ok FROM active_memberships WHERE group_id = $1::uuid AND user_id = $2::uuid`,
        [groupId, actor.id],
      )
      if (!actorRow.rows[0]) throw new DropoutRejected('not_member')
      if (input.memberId !== actor.id && creatorId !== actor.id) throw new DropoutRejected('not_allowed')
      const target = await tx.query<{ joined_on: string }>(
        `SELECT to_char(joined_on, 'YYYY-MM-DD') AS joined_on FROM active_memberships
         WHERE group_id = $1::uuid AND user_id::text = $2`,
        [groupId, input.memberId],
      )
      const joinedOn = target.rows[0]?.joined_on
      if (joinedOn === undefined) throw new DropoutRejected('bad_member')
      const lastDay = parseIsoDate(input.lastDay)
      if (!lastDay) throw new DropoutRejected('bad_day')
      if (lastDay < joinedOn) throw new DropoutRejected('before_join')
      if (lastDay > today) throw new DropoutRejected('future_day')
      await tx.query(
        `UPDATE memberships SET left_on = $3::date
         WHERE group_id = $1::uuid AND user_id::text = $2 AND left_on IS NULL`,
        [groupId, input.memberId, lastDay],
      )
      return { ok: true }
    })
  } catch (error) {
    if (error instanceof DropoutRejected) return { ok: false, failure: error.failure }
    throw error
  }
}

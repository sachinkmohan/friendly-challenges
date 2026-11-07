import { FieldPath } from 'firebase-admin/firestore'
import type { Database } from './db.ts'
import { parseIsoDate, type IsoDate } from './challenge.ts'
import type { GroupId } from './groups.ts'
import type { Account } from './identity.ts'
import { groupRef, memberOf, readGroup } from './store.ts'

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
  db: Database,
  actor: Account,
  groupId: GroupId,
  input: DropoutInput,
  today: IsoDate,
): Promise<RecordDropoutResult> {
  try {
    await db.runTransaction(async (tx) => {
      const group = await readGroup(db, groupId, tx)
      if (!group) throw new DropoutRejected('group_missing')
      if (memberOf(group, actor.id)?.leftOn !== null) throw new DropoutRejected('not_member')
      if (input.memberId !== actor.id && group.createdBy !== actor.id) throw new DropoutRejected('not_allowed')
      const target = memberOf(group, input.memberId)
      if (!target || target.leftOn !== null) throw new DropoutRejected('bad_member')
      const lastDay = parseIsoDate(input.lastDay)
      if (!lastDay) throw new DropoutRejected('bad_day')
      if (lastDay < target.joinedOn) throw new DropoutRejected('before_join')
      if (lastDay > today) throw new DropoutRejected('future_day')
      tx.update(groupRef(db, groupId), new FieldPath('members', input.memberId, 'leftOn'), lastDay)
    })
    return { ok: true }
  } catch (error) {
    if (error instanceof DropoutRejected) return { ok: false, failure: error.failure }
    throw error
  }
}

import type { Database } from './db.ts'
import { ACTIVE_MEMBER_CAP, activeMemberIds, compare, groupRef, labelOf, memberOf, parseGroup, readGroup, utcToday, type GroupDoc, type UserDoc } from './store.ts'
import type { Account } from './identity.ts'

export type GroupId = string & { readonly brand: 'GroupId' }

const GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function parseGroupId(raw: string): GroupId | null {
  if (!GROUP_ID.test(raw)) return null
  return raw as GroupId
}

type JoinFailure = 'group_missing' | 'group_full' | 'solo'

export type JoinResult =
  | { ok: true; groupId: GroupId; label: string }
  | { ok: false; failure: JoinFailure }

export type MemberLine = {
  userId: string
  displayName: string
  avatarUrl: string | null
  joinedOn: string
}

export type GroupView =
  | { kind: 'missing' }
  | {
      kind: 'members'
      groupId: GroupId
      label: string
      hasGroupName: boolean
      activeCount: number
      creatorId: string
      members: readonly MemberLine[]
    }
  | { kind: 'preview'; groupId: GroupId; label: string; activeCount: number }
  | { kind: 'full'; groupId: GroupId; label: string; activeCount: number }
  | { kind: 'solo'; groupId: GroupId; label: string; activeCount: number }

export type HomeGroup = {
  groupId: GroupId
  label: string
  activeCount: number
}

export function newGroupId(): GroupId {
  const id = parseGroupId(crypto.randomUUID())
  if (!id) throw new Error('group id')
  return id
}

function isSolo(group: GroupDoc): boolean {
  return group.challenge !== null && group.challenge.cause !== null
}

export type DeleteFailure = 'group_missing' | 'not_member' | 'not_creator' | 'not_confirmed'

export const deleteFailureCopy = {
  group_missing: 'That challenge does not exist.',
  not_member: 'Join the challenge before you delete it.',
  not_creator: 'Only the person who made the challenge can delete it.',
  not_confirmed: 'Tick the box to confirm you want to delete the challenge for everyone.',
} as const satisfies Record<DeleteFailure, string>

export type DeleteResult = { ok: true; label: string } | { ok: false; failure: DeleteFailure }

export type DropNameFailure = 'group_missing' | 'not_member' | 'not_creator' | 'no_challenge'

export const dropNameFailureCopy = {
  group_missing: 'That challenge does not exist.',
  not_member: 'Join the challenge before you change its name.',
  not_creator: 'Only the person who made the challenge can change its name.',
  no_challenge: 'Save the challenge name first, then use it here.',
} as const satisfies Record<DropNameFailure, string>

export type DropNameResult = { ok: true; label: string } | { ok: false; failure: DropNameFailure }

class JoinRejected extends Error {
  readonly failure: JoinFailure

  constructor(failure: JoinFailure) {
    super(failure)
    this.failure = failure
  }
}

export async function joinGroup(db: Database, account: Account, groupId: GroupId): Promise<JoinResult> {
  try {
    const label = await db.runTransaction(async (tx) => {
      const group = await readGroup(db, groupId, tx)
      if (!group) throw new JoinRejected('group_missing')
      if (group.members[account.id]) return labelOf(group)
      if (isSolo(group)) throw new JoinRejected('solo')
      if (activeMemberIds(group).length >= ACTIVE_MEMBER_CAP) throw new JoinRejected('group_full')
      tx.update(groupRef(db, groupId), {
        memberIds: [...group.memberIds, account.id],
        [`members.${account.id}`]: { joinedOn: utcToday(), leftOn: null },
      })
      return labelOf(group)
    })
    return { ok: true, groupId, label }
  } catch (error) {
    if (error instanceof JoinRejected) return { ok: false, failure: error.failure }
    throw error
  }
}

// The group document goes first, inside the creator check, so a check-in or payment racing the delete
// finds no group and is refused. The sweep then removes the check-ins and payments under it.
export async function deleteGroup(db: Database, actor: Account, groupId: GroupId, confirmed: boolean): Promise<DeleteResult> {
  const outcome = await db.runTransaction(async (tx): Promise<{ failure: DeleteFailure } | { label: string }> => {
    const group = await readGroup(db, groupId, tx)
    if (!group) return { failure: 'group_missing' }
    if (memberOf(group, actor.id)?.leftOn !== null) return { failure: 'not_member' }
    if (group.createdBy !== actor.id) return { failure: 'not_creator' }
    if (!confirmed) return { failure: 'not_confirmed' }
    tx.delete(groupRef(db, groupId))
    return { label: labelOf(group) }
  })
  if ('failure' in outcome) return { ok: false, failure: outcome.failure }
  await db.recursiveDelete(groupRef(db, groupId))
  return { ok: true, label: outcome.label }
}

// Only the label changes, so it is allowed after Start too (ADR 0014). A second press finds no name and writes nothing.
export async function dropGroupName(db: Database, actor: Account, groupId: GroupId): Promise<DropNameResult> {
  const outcome = await db.runTransaction(async (tx): Promise<{ failure: DropNameFailure } | { label: string }> => {
    const group = await readGroup(db, groupId, tx)
    if (!group) return { failure: 'group_missing' }
    if (memberOf(group, actor.id)?.leftOn !== null) return { failure: 'not_member' }
    if (group.createdBy !== actor.id) return { failure: 'not_creator' }
    if (!group.challenge) return { failure: 'no_challenge' }
    if (group.name !== null) tx.update(groupRef(db, groupId), { name: null })
    return { label: group.challenge.name }
  })
  return 'failure' in outcome ? { ok: false, failure: outcome.failure } : { ok: true, label: outcome.label }
}

/** users must hold every active member when the viewer is one of them. */
export function groupViewFrom(
  groupId: GroupId,
  group: GroupDoc,
  viewerId: string | null,
  users: ReadonlyMap<string, UserDoc>,
): Exclude<GroupView, { kind: 'missing' }> {
  const active = activeMemberIds(group)
  const activeCount = active.length
  const label = labelOf(group)
  if (viewerId !== null && active.includes(viewerId)) {
    const members = active
      .map((userId): MemberLine => {
        const user = users.get(userId)
        if (!user) throw new Error('member user')
        return { userId, displayName: user.displayName, avatarUrl: user.avatarUrl, joinedOn: group.members[userId]!.joinedOn }
      })
      .sort(
        (a, b) =>
          compare(a.joinedOn, b.joinedOn) || compare(a.displayName, b.displayName) || compare(a.userId, b.userId),
      )
    return { kind: 'members', groupId, label, hasGroupName: group.name !== null, activeCount, creatorId: group.createdBy, members }
  }
  if (isSolo(group)) return { kind: 'solo', groupId, label, activeCount }
  if (activeCount >= ACTIVE_MEMBER_CAP) return { kind: 'full', groupId, label, activeCount }
  return { kind: 'preview', groupId, label, activeCount }
}

export async function listHomeGroups(db: Database, account: Account): Promise<readonly HomeGroup[]> {
  const snapshot = await db.collection('groups').where('memberIds', 'array-contains', account.id).get()
  const groups: HomeGroup[] = []
  for (const doc of snapshot.docs) {
    const groupId = parseGroupId(doc.id)
    if (!groupId) throw new Error('home group')
    const group = parseGroup(doc.data())
    const active = activeMemberIds(group)
    if (active.includes(account.id)) groups.push({ groupId, label: labelOf(group), activeCount: active.length })
  }
  return groups.sort((a, b) => compare(a.label, b.label) || compare(a.groupId, b.groupId))
}

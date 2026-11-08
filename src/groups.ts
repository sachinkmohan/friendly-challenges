import { stakesGoFrom } from './challenge.ts'
import type { Database } from './db.ts'
import { ACTIVE_MEMBER_CAP, activeMemberIds, compare, groupRef, memberOf, parseGroup, readGroup, readUsers, utcToday, type GroupDoc, type UserDoc } from './store.ts'
import type { Account } from './identity.ts'

export type GroupId = string & { readonly brand: 'GroupId' }

const GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NAME_MAX = 40

export function parseGroupId(raw: string): GroupId | null {
  if (!GROUP_ID.test(raw)) return null
  return raw as GroupId
}

export type CreateGroupResult =
  | { ok: true; groupId: GroupId; name: string }
  | { ok: false; failure: 'name_empty' | 'name_too_long' }

type JoinFailure = 'group_missing' | 'group_full' | 'solo_started'

export type JoinResult =
  | { ok: true; groupId: GroupId; name: string }
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
      name: string
      activeCount: number
      creatorId: string
      members: readonly MemberLine[]
    }
  | { kind: 'preview'; groupId: GroupId; name: string; activeCount: number }
  | { kind: 'full'; groupId: GroupId; name: string; activeCount: number }
  | { kind: 'solo'; groupId: GroupId; name: string; activeCount: number }

export type HomeGroup = {
  groupId: GroupId
  name: string
  activeCount: number
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function nameFailure(name: string): 'name_empty' | 'name_too_long' | null {
  const length = codePointLength(name)
  if (length === 0) return 'name_empty'
  if (length > NAME_MAX) return 'name_too_long'
  return null
}

function newGroupId(): GroupId {
  const id = parseGroupId(crypto.randomUUID())
  if (!id) throw new Error('group id')
  return id
}

function isStartedSolo(group: GroupDoc): boolean {
  return stakesGoFrom(group.challenge)?.kind === 'cause'
}

export type DeleteFailure = 'group_missing' | 'not_member' | 'not_creator' | 'not_confirmed'

export const deleteFailureCopy = {
  group_missing: 'That group does not exist.',
  not_member: 'Join the group before you delete it.',
  not_creator: 'Only the person who made the group can delete it.',
  not_confirmed: 'Tick the box to confirm you want to delete the group for everyone.',
} as const satisfies Record<DeleteFailure, string>

export type DeleteResult = { ok: true; name: string } | { ok: false; failure: DeleteFailure }

class JoinRejected extends Error {
  readonly failure: JoinFailure

  constructor(failure: JoinFailure) {
    super(failure)
    this.failure = failure
  }
}

export async function createGroup(
  db: Database,
  account: Account,
  rawName: string,
): Promise<CreateGroupResult> {
  const name = rawName.trim()
  const failure = nameFailure(name)
  if (failure) return { ok: false, failure }
  const groupId = newGroupId()
  const group: GroupDoc = {
    name,
    createdBy: account.id,
    memberIds: [account.id],
    members: { [account.id]: { joinedOn: utcToday(), leftOn: null } },
    challenge: null,
    rhythms: {},
  }
  await groupRef(db, groupId).create(group)
  return { ok: true, groupId, name }
}

export async function joinGroup(db: Database, account: Account, groupId: GroupId): Promise<JoinResult> {
  try {
    const name = await db.runTransaction(async (tx) => {
      const group = await readGroup(db, groupId, tx)
      if (!group) throw new JoinRejected('group_missing')
      if (group.members[account.id]) return group.name
      if (isStartedSolo(group)) throw new JoinRejected('solo_started')
      if (activeMemberIds(group).length >= ACTIVE_MEMBER_CAP) throw new JoinRejected('group_full')
      tx.update(groupRef(db, groupId), {
        memberIds: [...group.memberIds, account.id],
        [`members.${account.id}`]: { joinedOn: utcToday(), leftOn: null },
      })
      return group.name
    })
    return { ok: true, groupId, name }
  } catch (error) {
    if (error instanceof JoinRejected) return { ok: false, failure: error.failure }
    throw error
  }
}

// The group document goes first, inside the creator check, so a check-in or payment racing the delete
// finds no group and is refused. The sweep then removes the check-ins and payments under it.
export async function deleteGroup(db: Database, actor: Account, groupId: GroupId, confirmed: boolean): Promise<DeleteResult> {
  const outcome = await db.runTransaction(async (tx): Promise<{ failure: DeleteFailure } | { name: string }> => {
    const group = await readGroup(db, groupId, tx)
    if (!group) return { failure: 'group_missing' }
    if (memberOf(group, actor.id)?.leftOn !== null) return { failure: 'not_member' }
    if (group.createdBy !== actor.id) return { failure: 'not_creator' }
    if (!confirmed) return { failure: 'not_confirmed' }
    tx.delete(groupRef(db, groupId))
    return { name: group.name }
  })
  if ('failure' in outcome) return { ok: false, failure: outcome.failure }
  await db.recursiveDelete(groupRef(db, groupId))
  return { ok: true, name: outcome.name }
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
    return { kind: 'members', groupId, name: group.name, activeCount, creatorId: group.createdBy, members }
  }
  if (isStartedSolo(group)) return { kind: 'solo', groupId, name: group.name, activeCount }
  if (activeCount >= ACTIVE_MEMBER_CAP) return { kind: 'full', groupId, name: group.name, activeCount }
  return { kind: 'preview', groupId, name: group.name, activeCount }
}

export async function viewGroup(
  db: Database,
  account: Account | null,
  groupId: GroupId,
): Promise<GroupView> {
  const group = await readGroup(db, groupId)
  if (!group) return { kind: 'missing' }
  const active = activeMemberIds(group)
  const users = account && active.includes(account.id) ? await readUsers(db, active) : new Map<string, UserDoc>()
  return groupViewFrom(groupId, group, account?.id ?? null, users)
}

export async function listHomeGroups(db: Database, account: Account): Promise<readonly HomeGroup[]> {
  const snapshot = await db.collection('groups').where('memberIds', 'array-contains', account.id).get()
  const groups: HomeGroup[] = []
  for (const doc of snapshot.docs) {
    const groupId = parseGroupId(doc.id)
    if (!groupId) throw new Error('home group')
    const group = parseGroup(doc.data())
    const active = activeMemberIds(group)
    if (active.includes(account.id)) groups.push({ groupId, name: group.name, activeCount: active.length })
  }
  return groups.sort((a, b) => compare(a.name, b.name) || compare(a.groupId, b.groupId))
}

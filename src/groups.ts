import type { Database } from './db.ts'
import { ACTIVE_MEMBER_CAP, activeMemberIds, groupRef, parseGroup, readGroup, readUsers, utcToday, type GroupDoc } from './store.ts'
import type { Account } from './identity.ts'

export type GroupId = string & { readonly brand: 'GroupId' }

const GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NAME_MAX = 40

export function parseGroupId(raw: string): GroupId | null {
  if (!GROUP_ID.test(raw)) return null
  return raw as GroupId
}

export type CreateGroupResult =
  | { ok: true; groupId: GroupId }
  | { ok: false; failure: 'name_empty' | 'name_too_long' }

export type JoinResult =
  | { ok: true; groupId: GroupId }
  | { ok: false; failure: 'group_missing' | 'group_full' }

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

class JoinRejected extends Error {
  readonly failure: 'group_missing' | 'group_full'

  constructor(failure: 'group_missing' | 'group_full') {
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
  return { ok: true, groupId }
}

export async function joinGroup(db: Database, account: Account, groupId: GroupId): Promise<JoinResult> {
  try {
    await db.runTransaction(async (tx) => {
      const group = await readGroup(db, groupId, tx)
      if (!group) throw new JoinRejected('group_missing')
      if (group.members[account.id]) return
      if (activeMemberIds(group).length >= ACTIVE_MEMBER_CAP) throw new JoinRejected('group_full')
      tx.update(groupRef(db, groupId), {
        memberIds: [...group.memberIds, account.id],
        [`members.${account.id}`]: { joinedOn: utcToday(), leftOn: null },
      })
    })
    return { ok: true, groupId }
  } catch (error) {
    if (error instanceof JoinRejected) return { ok: false, failure: error.failure }
    throw error
  }
}

export async function viewGroup(
  db: Database,
  account: Account | null,
  groupId: GroupId,
): Promise<GroupView> {
  const group = await readGroup(db, groupId)
  if (!group) return { kind: 'missing' }
  const active = activeMemberIds(group)
  const activeCount = active.length
  if (account && active.includes(account.id)) {
    const users = await readUsers(db, active)
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
  if (activeCount >= ACTIVE_MEMBER_CAP) return { kind: 'full', groupId, name: group.name, activeCount }
  return { kind: 'preview', groupId, name: group.name, activeCount }
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

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

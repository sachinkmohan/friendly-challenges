import type { PGlite } from '@electric-sql/pglite'
import type { Account } from './identity.ts'

export type GroupId = string & { readonly brand: 'GroupId' }

const GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const JOINED_ON = /^\d{4}-\d{2}-\d{2}$/
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
      members: readonly MemberLine[]
    }
  | { kind: 'preview'; groupId: GroupId; name: string; activeCount: number }
  | { kind: 'full'; groupId: GroupId; name: string; activeCount: number }

export type HomeGroup = {
  groupId: GroupId
  name: string
  activeCount: number
}

type DbError = {
  code: string
  message: string
  constraint: string
}

type GroupPageRow = {
  name: string
  active_count: number | string
  full: boolean
  viewer_is_member: boolean | null
  members: unknown
}

type HomeRow = {
  id: string
  name: string
  active_count: number | string
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

function readDbError(error: unknown): DbError | null {
  if (!(error instanceof Error)) return null
  const row = error as Error & { code?: unknown; constraint?: unknown }
  if (typeof row.code !== 'string') return null
  return {
    code: row.code,
    message: error.message.trim(),
    constraint: typeof row.constraint === 'string' ? row.constraint : '',
  }
}

function isNameCheck(error: DbError): boolean {
  return (
    error.code === '23514' &&
    (error.constraint === 'groups_name_not_blank' || error.message.includes('groups_name_not_blank'))
  )
}

function newGroupId(): GroupId {
  const id = parseGroupId(crypto.randomUUID())
  if (!id) throw new Error('group id')
  return id
}

function countFrom(value: unknown): number {
  const count = Number(value)
  if (!Number.isInteger(count) || count < 0) throw new Error('active count')
  return count
}

function flagFrom(value: unknown): boolean {
  if (value === true || value === false) return value
  throw new Error('flag')
}

function parseMember(value: unknown): MemberLine {
  if (typeof value !== 'object' || value === null) throw new Error('member')
  const row = value as Record<string, unknown>
  if (typeof row.displayName !== 'string') throw new Error('member name')
  if (typeof row.joinedOn !== 'string' || !JOINED_ON.test(row.joinedOn)) throw new Error('member date')
  if (row.avatarUrl !== null && typeof row.avatarUrl !== 'string') throw new Error('member avatar')
  return {
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    joinedOn: row.joinedOn,
  }
}

function parseMembers(raw: unknown): readonly MemberLine[] {
  const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
  if (!Array.isArray(parsed)) throw new Error('members')
  return parsed.map(parseMember)
}

export async function createGroup(
  db: PGlite,
  account: Account,
  rawName: string,
): Promise<CreateGroupResult> {
  const name = rawName.trim()
  const failure = nameFailure(name)
  if (failure) return { ok: false, failure }
  const groupId = newGroupId()
  try {
    const result = await db.query<{ group_id: string }>(
      `WITH created AS (
         INSERT INTO groups (id, name) VALUES ($1::uuid, $2) RETURNING id
       )
       INSERT INTO memberships (group_id, user_id, joined_on)
       SELECT id, $3::uuid, (now() AT TIME ZONE 'utc')::date
       FROM created
       RETURNING group_id::text`,
      [groupId, name, account.id],
    )
    if (!result.rows[0]) throw new Error('create group')
    return { ok: true, groupId }
  } catch (error) {
    const dbError = readDbError(error)
    if (dbError && isNameCheck(dbError)) {
      return { ok: false, failure: nameFailure(name) ?? 'name_empty' }
    }
    throw error
  }
}

export async function joinGroup(db: PGlite, account: Account, groupId: GroupId): Promise<JoinResult> {
  try {
    await db.query(
      `INSERT INTO memberships (group_id, user_id, joined_on)
       VALUES ($1::uuid, $2::uuid, (now() AT TIME ZONE 'utc')::date)
       ON CONFLICT (group_id, user_id) DO NOTHING
       RETURNING group_id`,
      [groupId, account.id],
    )
    return { ok: true, groupId }
  } catch (error) {
    const dbError = readDbError(error)
    if (dbError?.code === 'P0001' && dbError.message === 'group_full') {
      return { ok: false, failure: 'group_full' }
    }
    if (dbError?.code === 'P0001' && dbError.message === 'group_missing') {
      return { ok: false, failure: 'group_missing' }
    }
    throw error
  }
}

export async function viewGroup(
  db: PGlite,
  account: Account | null,
  groupId: GroupId,
): Promise<GroupView> {
  const result = await db.query<GroupPageRow>(
    `SELECT g.name,
            count(a.user_id)::int AS active_count,
            count(a.user_id)::int >= active_member_cap() AS full,
            bool_or(a.user_id = $2::uuid) AS viewer_is_member,
            CASE WHEN bool_or(a.user_id = $2::uuid) THEN
              json_agg(
                json_build_object(
                  'displayName', u.display_name,
                  'joinedOn', to_char(a.joined_on, 'YYYY-MM-DD'),
                  'avatarUrl', u.avatar_url
                )
                ORDER BY a.joined_on, u.display_name, a.user_id
              )::text
            ELSE NULL END AS members
     FROM groups g
     LEFT JOIN active_memberships a ON a.group_id = g.id
     LEFT JOIN users u ON u.id = a.user_id
     WHERE g.id = $1::uuid
     GROUP BY g.id, g.name`,
    [groupId, account?.id ?? null],
  )
  const row = result.rows[0]
  if (!row) return { kind: 'missing' }
  if (typeof row.name !== 'string') throw new Error('group name')
  const activeCount = countFrom(row.active_count)
  const viewerIsMember = row.viewer_is_member === null ? false : flagFrom(row.viewer_is_member)
  if (account && viewerIsMember) {
    return {
      kind: 'members',
      groupId,
      name: row.name,
      activeCount,
      members: parseMembers(row.members),
    }
  }
  if (flagFrom(row.full)) {
    return { kind: 'full', groupId, name: row.name, activeCount }
  }
  return { kind: 'preview', groupId, name: row.name, activeCount }
}

export async function listHomeGroups(db: PGlite, account: Account): Promise<readonly HomeGroup[]> {
  const result = await db.query<HomeRow>(
    `SELECT g.id::text AS id,
            g.name,
            count(a.user_id)::int AS active_count
     FROM active_memberships mine
     JOIN groups g ON g.id = mine.group_id
     JOIN active_memberships a ON a.group_id = g.id
     WHERE mine.user_id = $1::uuid
     GROUP BY g.id, g.name
     ORDER BY g.name, g.id`,
    [account.id],
  )
  return result.rows.map((row) => {
    if (typeof row.id !== 'string' || typeof row.name !== 'string') throw new Error('home group')
    const groupId = parseGroupId(row.id)
    if (!groupId) throw new Error('home group')
    return { groupId, name: row.name, activeCount: countFrom(row.active_count) }
  })
}

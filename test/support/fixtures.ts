import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { FieldPath } from 'firebase-admin/firestore'
import { upsertAccount } from '../../src/accounts.ts'
import { createApp, type AppDeps } from '../../src/app.ts'
import { createChallenge, type ChallengeInput, type IsoDate } from '../../src/challenge.ts'
import type { Database } from '../../src/db.ts'
import { joinGroup, newGroupId, type GroupId } from '../../src/groups.ts'
import type { Account, FirebaseWebConfig, IdToken } from '../../src/identity.ts'
import { createSession } from '../../src/sessions.ts'
import { groupRef, readGroup, utcToday } from '../../src/store.ts'

export async function person(db: Database, name: string): Promise<Account> {
  const saved = await upsertAccount(db, {
    sub: `sub-${name}`,
    email: `${name.replaceAll(' ', '-').toLowerCase()}@example.com`,
    emailVerified: true,
    displayName: name,
    avatarUrl: null,
  })
  if (!saved.ok) throw new Error('account')
  return saved.account
}

// A day after every check-in the tests log, so none of them is in the future.
export const CHECK_IN_TODAY = '2026-11-30' as IsoDate

export const fixtureTerms: ChallengeInput = {
  name: 'Morning run',
  type: 'no_sugar',
  customLabel: '',
  currency: 'USD',
  stake: '5',
  startsOn: '2026-11-01',
  endsOn: '2026-11-30',
}

type GroupOptions = { readonly cause?: string; readonly terms?: Partial<ChallengeInput>; readonly interval?: string }

/** A challenge made the one-step way, so the creator already has a rhythm. A cause makes it solo. */
export async function groupWith(
  db: Database,
  people: readonly Account[],
  name = 'Morning run',
  options: GroupOptions = {},
): Promise<GroupId> {
  const created = await createChallenge(db, people[0] as Account, {
    ...fixtureTerms,
    name,
    ...options.terms,
    interval: options.interval ?? 'every_day',
    solo: options.cause !== undefined,
    cause: options.cause ?? '',
  })
  if (!created.ok) throw new Error(created.failure)
  await joinAll(db, people.slice(1), created.groupId)
  return created.groupId
}

/** A group made before ADR 0014: it has a name of its own and no challenge yet. */
export async function legacyGroupWith(db: Database, people: readonly Account[], groupName = 'Morning run'): Promise<GroupId> {
  const creator = people[0] as Account
  const groupId = newGroupId()
  await groupRef(db, groupId).create({
    name: groupName,
    createdBy: creator.id,
    memberIds: [creator.id],
    members: { [creator.id]: { joinedOn: utcToday(), leftOn: null } },
    challenge: null,
    rhythms: {},
  })
  await joinAll(db, people.slice(1), groupId)
  return groupId
}

async function joinAll(db: Database, people: readonly Account[], groupId: GroupId): Promise<void> {
  for (const member of people) {
    const joined = await joinGroup(db, member, groupId)
    if (!joined.ok) throw new Error(joined.failure)
  }
}

// Joins happen today, so tests move join dates back to put members inside a past challenge.
export async function setJoinedOn(db: Database, groupId: GroupId, day: string, userIds?: readonly string[]): Promise<void> {
  const group = await readGroup(db, groupId)
  if (!group) throw new Error('group')
  const ids = userIds ?? Object.keys(group.members)
  const fields = ids.flatMap((id) => [new FieldPath('members', id, 'joinedOn'), day])
  await groupRef(db, groupId).update(fields[0] as FieldPath, fields[1], ...fields.slice(2))
}

export async function setLeftOn(db: Database, groupId: GroupId, userId: string, day: string): Promise<void> {
  await groupRef(db, groupId).update(new FieldPath('members', userId, 'leftOn'), day)
}

export async function cookieFor(db: Database, account: Account): Promise<string> {
  return `session=${encodeURIComponent(await createSession(db, account.id))}`
}

export const testFirebase: FirebaseWebConfig = {
  apiKey: 'test-api-key',
  authDomain: 'friendly-test.firebaseapp.com',
  projectId: 'demo-friendly-test',
}

export function googleToken(sub: string, claims: Omit<IdToken, 'firebase'>): IdToken {
  return { ...claims, firebase: { sign_in_provider: 'google.com', identities: { 'google.com': [sub] } } }
}

// Stands in for Firebase Authentication: only the tokens in the map verify.
export function fakeVerifier(tokens: Map<string, IdToken>): (token: string) => Promise<IdToken> {
  return async (token) => {
    const claims = tokens.get(token)
    if (!claims) throw new Error('Firebase ID token has invalid signature.')
    return claims
  }
}

export async function listen(
  db: Database,
  deps: Partial<Omit<AppDeps, 'db'>> = {},
): Promise<{ server: Server; base: string }> {
  const app = createApp({ db, firebase: testFirebase, ...deps })
  const server = createServer((req, res) => {
    void app(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${address.port}` }
}

export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

export async function post(base: string, path: string, cookie: string | null, body?: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
    },
    body,
  })
}

/** The body of the Create a challenge form, filled in for a challenge with friends. */
export function createForm(overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    name: 'Morning run',
    type: 'no_sugar',
    custom_label: '',
    currency: 'USD',
    stake: '5',
    starts_on: '2026-11-01',
    ends_on: '2026-11-30',
    interval: 'every_day',
    ...overrides,
  }).toString()
}

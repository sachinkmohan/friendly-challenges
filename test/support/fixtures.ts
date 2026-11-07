import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { FieldPath } from 'firebase-admin/firestore'
import { upsertAccount } from '../../src/accounts.ts'
import { createApp } from '../../src/app.ts'
import type { IsoDate } from '../../src/challenge.ts'
import type { Database } from '../../src/db.ts'
import { createGroup, joinGroup, type GroupId } from '../../src/groups.ts'
import type { Account } from '../../src/identity.ts'
import { createSession } from '../../src/sessions.ts'
import { groupRef, readGroup } from '../../src/store.ts'

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

export async function groupWith(db: Database, people: readonly Account[], name = 'Morning run'): Promise<GroupId> {
  const created = await createGroup(db, people[0] as Account, name)
  if (!created.ok) throw new Error(created.failure)
  for (const member of people.slice(1)) {
    const joined = await joinGroup(db, member, created.groupId)
    if (!joined.ok) throw new Error(joined.failure)
  }
  return created.groupId
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

// Stands in for data written before a rule existed, which the app has to cope with on read.
export async function setChallengeDates(db: Database, groupId: GroupId, startsOn: string, endsOn: string): Promise<void> {
  await groupRef(db, groupId).update('challenge.startsOn', startsOn, 'challenge.endsOn', endsOn)
}

export async function cookieFor(db: Database, account: Account): Promise<string> {
  return `session=${encodeURIComponent(await createSession(db, account.id))}`
}

export async function listen(db: Database, today?: () => IsoDate): Promise<{ server: Server; base: string }> {
  const app = createApp({ db, config: { clientId: 'client-id', clientSecret: 'client-secret' }, today })
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

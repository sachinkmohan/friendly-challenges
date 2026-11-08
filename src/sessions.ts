import { createHash, randomBytes } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import type { Database } from './db.ts'
import type { Account } from './identity.ts'
import { countDocs, readUsers, type UserDoc } from './store.ts'

const SESSION_MS = 1000 * 60 * 60 * 24 * 30

function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

// The cookie holds the secret. The database stores only its hash, so a dump of the collection cannot be replayed as a cookie.
function sessionRef(db: Database, token: string) {
  return db.collection('sessions').doc(createHash('sha256').update(token).digest('hex'))
}

export async function createSession(db: Database, userId: string): Promise<string> {
  const token = newSessionToken()
  await sessionRef(db, token).create({
    userId,
    expiresAt: Timestamp.fromMillis(Date.now() + SESSION_MS),
    createdAt: Timestamp.now(),
  })
  return token
}

/** A live session whose user has not been looked up yet. Only claimSession makes one. */
export type SessionClaim = { readonly userId: string; readonly token: string } & { readonly brand: 'SessionClaim' }

function accountOf(id: string, user: UserDoc): Account {
  return { id, googleSub: user.googleSub, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl }
}

/** Reads the session and deletes it if it is expired or malformed. */
export async function claimSession(db: Database, token: string | null): Promise<SessionClaim | null> {
  if (!token) return null
  const ref = sessionRef(db, token)
  const session = (await ref.get()).data()
  if (!session) return null
  const live = session.expiresAt instanceof Timestamp && session.expiresAt.toMillis() > Date.now()
  if (!live || typeof session.userId !== 'string') {
    await ref.delete()
    return null
  }
  return { userId: session.userId, token } as SessionClaim
}

/** Finds the claim's user in users, which the caller read, and deletes the session if that user is gone. */
export async function settleSession(db: Database, claim: SessionClaim, users: ReadonlyMap<string, UserDoc>): Promise<Account | null> {
  const user = users.get(claim.userId)
  if (!user) {
    await sessionRef(db, claim.token).delete()
    return null
  }
  return accountOf(claim.userId, user)
}

export async function accountForSession(db: Database, token: string | null): Promise<Account | null> {
  const claim = await claimSession(db, token)
  return claim ? settleSession(db, claim, await readUsers(db, [claim.userId])) : null
}

export async function deleteSession(db: Database, token: string | null): Promise<void> {
  if (!token) return
  await sessionRef(db, token).delete()
}

export function countSessions(db: Database): Promise<number> {
  return countDocs(db, 'sessions')
}

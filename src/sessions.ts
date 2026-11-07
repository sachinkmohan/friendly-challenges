import { createHash, randomBytes } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import type { Database } from './db.ts'
import type { Account } from './identity.ts'
import { countDocs, parseUser, userRef } from './store.ts'

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

export async function accountForSession(db: Database, token: string | null): Promise<Account | null> {
  if (!token) return null
  const ref = sessionRef(db, token)
  const session = (await ref.get()).data()
  const live = session !== undefined && session.expiresAt instanceof Timestamp && session.expiresAt.toMillis() > Date.now()
  const user = live && typeof session.userId === 'string' ? await userRef(db, session.userId).get() : null
  if (!session || !user?.exists) {
    if (session) await ref.delete()
    return null
  }
  const row = parseUser(user.data())
  return {
    id: user.id,
    googleSub: row.googleSub,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
  }
}

export async function deleteSession(db: Database, token: string | null): Promise<void> {
  if (!token) return
  await sessionRef(db, token).delete()
}

export function countSessions(db: Database): Promise<number> {
  return countDocs(db, 'sessions')
}

import { FieldValue } from 'firebase-admin/firestore'
import type { Database } from './db.ts'
import type { Account, GoogleIdentity } from './identity.ts'
import { countDocs, userRef } from './store.ts'

export type UpsertResult =
  | { ok: true; account: Account }
  | { ok: false; failure: 'unverified_email' }

export async function upsertAccount(db: Database, identity: GoogleIdentity): Promise<UpsertResult> {
  if (!identity.emailVerified || identity.sub === '' || identity.email === '') {
    return { ok: false, failure: 'unverified_email' }
  }
  const subRef = db.collection('googleSubs').doc(identity.sub)
  const id = await db.runTransaction(async (tx) => {
    const known = await tx.get(subRef)
    const existing = known.data()?.userId
    const userId = typeof existing === 'string' ? existing : crypto.randomUUID()
    const profile = {
      googleSub: identity.sub,
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (typeof existing === 'string') {
      tx.set(userRef(db, userId), profile, { merge: true })
    } else {
      tx.create(subRef, { userId })
      tx.create(userRef(db, userId), { ...profile, createdAt: FieldValue.serverTimestamp() })
    }
    return userId
  })
  return {
    ok: true,
    account: {
      id,
      googleSub: identity.sub,
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    },
  }
}

export function countUsers(db: Database): Promise<number> {
  return countDocs(db, 'users')
}

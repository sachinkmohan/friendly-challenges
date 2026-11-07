import type { Database } from './hosted-db.ts'
import type { Account, GoogleIdentity } from './identity.ts'

type AccountRow = {
  id: string
  google_sub: string
  email: string
  display_name: string
  avatar_url: string | null
}

export type UpsertResult =
  | { ok: true; account: Account }
  | { ok: false; failure: 'unverified_email' }

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  }
}

export async function upsertAccount(db: Database, identity: GoogleIdentity): Promise<UpsertResult> {
  if (!identity.emailVerified || identity.sub === '' || identity.email === '') {
    return { ok: false, failure: 'unverified_email' }
  }
  const result = await db.query<AccountRow>(
    `INSERT INTO users (id, google_sub, email, display_name, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (google_sub) DO UPDATE
     SET email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         updated_at = now()
     RETURNING id, google_sub, email, display_name, avatar_url`,
    [crypto.randomUUID(), identity.sub, identity.email, identity.displayName, identity.avatarUrl],
  )
  const row = result.rows[0]
  if (!row) return { ok: false, failure: 'unverified_email' }
  return { ok: true, account: toAccount(row) }
}

export async function countUsers(db: Database): Promise<number> {
  const result = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM users')
  return Number(result.rows[0]?.count ?? 0)
}

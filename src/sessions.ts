import { createHash, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { Account } from './identity.ts'

type AccountRow = {
  id: string
  google_sub: string
  email: string
  display_name: string
  avatar_url: string | null
}

const SESSION_SECONDS = 60 * 60 * 24 * 30

function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

// The cookie holds the secret. The database stores only its hash, so a dump of the table cannot be replayed as a cookie.
function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(db: PGlite, userId: string): Promise<string> {
  const token = newSessionToken()
  await db.query(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`,
    [sessionId(token), userId, String(SESSION_SECONDS)],
  )
  return token
}

export async function accountForSession(db: PGlite, token: string | null): Promise<Account | null> {
  if (!token) return null
  const id = sessionId(token)
  const result = await db.query<AccountRow>(
    `SELECT u.id, u.google_sub, u.email, u.display_name, u.avatar_url
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [id],
  )
  const row = result.rows[0]
  if (!row) {
    await db.query('DELETE FROM sessions WHERE id = $1', [id])
    return null
  }
  return {
    id: row.id,
    googleSub: row.google_sub,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  }
}

export async function deleteSession(db: PGlite, token: string | null): Promise<void> {
  if (!token) return
  await db.query('DELETE FROM sessions WHERE id = $1', [sessionId(token)])
}

export async function countSessions(db: PGlite): Promise<number> {
  const result = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM sessions')
  return Number(result.rows[0]?.count ?? 0)
}

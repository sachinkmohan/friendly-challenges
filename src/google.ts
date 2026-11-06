import type { GoogleIdentity } from './identity.ts'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

export type GoogleConfig = {
  clientId: string
  clientSecret: string
}

export function authorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', input.state)
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

export function parseGoogleUserInfo(body: unknown): GoogleIdentity | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  if (typeof record.sub !== 'string' || record.sub.length === 0) return null
  if (typeof record.email !== 'string' || record.email.length === 0) return null
  const verified = record.email_verified
  const emailVerified = verified === true || verified === 'true'
  const displayName =
    typeof record.name === 'string' && record.name.trim() !== ''
      ? record.name
      : record.email.slice(0, record.email.indexOf('@'))
  const avatarUrl = typeof record.picture === 'string' ? record.picture : null
  return {
    sub: record.sub,
    email: record.email,
    emailVerified,
    displayName,
    avatarUrl,
  }
}

export type ExchangeResult =
  | { ok: true; identity: GoogleIdentity }
  | { ok: false; failure: 'google_rejected' | 'unverified_email' }

export async function exchangeCode(
  config: GoogleConfig,
  input: { code: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeResult> {
  const tokenResponse = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenResponse.ok) return { ok: false, failure: 'google_rejected' }
  const tokenBody: unknown = await tokenResponse.json()
  const accessToken =
    typeof tokenBody === 'object' &&
    tokenBody !== null &&
    typeof (tokenBody as { access_token?: unknown }).access_token === 'string'
      ? (tokenBody as { access_token: string }).access_token
      : null
  if (!accessToken) return { ok: false, failure: 'google_rejected' }

  const profileResponse = await fetchImpl(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!profileResponse.ok) return { ok: false, failure: 'google_rejected' }
  const identity = parseGoogleUserInfo(await profileResponse.json())
  if (!identity) return { ok: false, failure: 'google_rejected' }
  if (!identity.emailVerified) return { ok: false, failure: 'unverified_email' }
  return { ok: true, identity }
}

import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PGlite } from '@electric-sql/pglite'
import { upsertAccount } from './accounts.ts'
import { clearCookie, readCookie, secretsMatch, writeCookie } from './cookies.ts'
import { authorizeUrl, exchangeCode, type GoogleConfig } from './google.ts'
import type { AuthFailure, Viewer } from './identity.ts'
import { renderFailure, renderHome, renderMessage } from './page.ts'
import { accountForSession, createSession, deleteSession } from './sessions.ts'

const SESSION_COOKIE = 'session'
const STATE_COOKIE = 'oauth_state'
const STATE_MAX_AGE = 600
const SESSION_MAX_AGE = 60 * 60 * 24 * 30

export type AppDeps = {
  db: PGlite
  config: GoogleConfig
  fetch?: typeof fetch
}

function requestOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? 'localhost'
  const encrypted = Boolean((req.socket as { encrypted?: boolean }).encrypted)
  return `${encrypted ? 'https' : 'http'}://${host}`
}

function redirectUri(origin: string): string {
  return `${origin}/auth/google/callback`
}

function sendHtml(res: ServerResponse, status: number, body: string, cookies: string[] = []): void {
  const headers: Record<string, string | string[] | number> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  }
  if (cookies.length > 0) headers['Set-Cookie'] = cookies
  res.writeHead(status, headers)
  res.end(body)
}

function sendRedirect(res: ServerResponse, location: string, cookies: string[] = []): void {
  const headers: Record<string, string | string[]> = { Location: location }
  if (cookies.length > 0) headers['Set-Cookie'] = cookies
  res.writeHead(302, headers)
  res.end()
}

async function viewerFrom(req: IncomingMessage, db: PGlite): Promise<Viewer> {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE)
  const account = await accountForSession(db, token)
  if (!account) return { state: 'signed_out' }
  return { state: 'signed_in', account }
}

export function createApp(deps: AppDeps) {
  const fetchImpl = deps.fetch ?? fetch
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = requestOrigin(req)
    const url = new URL(req.url ?? '/', `${origin}/`)
    const path = url.pathname
    const method = req.method ?? 'GET'

    try {
      if (method === 'GET' && path === '/') {
        sendHtml(res, 200, renderHome(await viewerFrom(req, deps.db)))
        return
      }

      if (method === 'GET' && path === '/auth/google') {
        if (deps.config.clientId === '' || deps.config.clientSecret === '') {
          sendHtml(res, 500, renderFailure('missing_client'))
          return
        }
        const state = randomBytes(32).toString('base64url')
        const location = authorizeUrl({
          clientId: deps.config.clientId,
          redirectUri: redirectUri(origin),
          state,
        })
        sendRedirect(res, location, [writeCookie(STATE_COOKIE, state, STATE_MAX_AGE)])
        return
      }

      if (method === 'GET' && path === '/auth/google/callback') {
        const signIn = await finishGoogleSignIn(req, url, origin, deps, fetchImpl)
        if (signIn.kind === 'error') {
          sendHtml(res, signIn.status, renderFailure(signIn.failure), [clearCookie(STATE_COOKIE)])
          return
        }
        sendRedirect(res, '/', [
          clearCookie(STATE_COOKIE),
          writeCookie(SESSION_COOKIE, signIn.token, SESSION_MAX_AGE),
        ])
        return
      }

      if (method === 'POST' && path === '/logout') {
        await deleteSession(deps.db, readCookie(req.headers.cookie, SESSION_COOKIE))
        sendRedirect(res, '/', [clearCookie(SESSION_COOKIE)])
        return
      }

      if (path === '/logout') {
        res.writeHead(405, { Allow: 'POST' })
        res.end()
        return
      }

      sendHtml(res, 404, renderMessage('Not found', 'That page does not exist.'))
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'request failed')
      sendHtml(res, 500, renderMessage('Something went wrong', 'Try that again.'))
    }
  }
}

type SignInResult =
  | { kind: 'ok'; token: string }
  | { kind: 'error'; status: number; failure: AuthFailure }

async function finishGoogleSignIn(
  req: IncomingMessage,
  url: URL,
  origin: string,
  deps: AppDeps,
  fetchImpl: typeof fetch,
): Promise<SignInResult> {
  if (url.searchParams.get('error')) {
    return { kind: 'error', status: 400, failure: 'denied' }
  }
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const saved = readCookie(req.headers.cookie, STATE_COOKIE)
  if (!code || !state || !saved || !secretsMatch(state, saved)) {
    return { kind: 'error', status: 400, failure: 'bad_state' }
  }
  const exchanged = await exchangeCode(
    deps.config,
    { code, redirectUri: redirectUri(origin) },
    fetchImpl,
  )
  if (!exchanged.ok) return { kind: 'error', status: 400, failure: exchanged.failure }
  const savedAccount = await upsertAccount(deps.db, exchanged.identity)
  if (!savedAccount.ok) return { kind: 'error', status: 400, failure: savedAccount.failure }
  const token = await createSession(deps.db, savedAccount.account.id)
  return { kind: 'ok', token }
}

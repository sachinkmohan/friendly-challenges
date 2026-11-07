import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { countUsers, upsertAccount } from '../src/accounts.ts'
import { createApp } from '../src/app.ts'
import { openDatabase } from '../src/db.ts'
import { parseGoogleUserInfo } from '../src/google.ts'
import { accountForSession, countSessions } from '../src/sessions.ts'
import type { PGlite } from '@electric-sql/pglite'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

type Profile = {
  sub: string
  email: string
  email_verified: boolean
  name: string
  picture?: string
}

function googleFetch(profile: () => Profile, seen: { tokenBody: string }) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === TOKEN_URL) {
      seen.tokenBody = String(init?.body ?? '')
      return new Response(JSON.stringify({ access_token: 'token-from-google' }), { status: 200 })
    }
    if (url === USERINFO_URL) {
      const headers = new Headers(init?.headers)
      if (headers.get('authorization') !== 'Bearer token-from-google') {
        return new Response('unauthorized', { status: 401 })
      }
      return new Response(JSON.stringify(profile()), { status: 200 })
    }
    return new Response('unexpected', { status: 500 })
  }) as typeof fetch
}

async function listen(db: PGlite, profile: () => Profile, seen: { tokenBody: string }) {
  const app = createApp({
    db,
    config: { clientId: 'client-id', clientSecret: 'client-secret' },
    fetch: googleFetch(profile, seen),
  })
  const server = createServer((req, res) => {
    void app(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${address.port}` }
}

function cookiesFrom(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const set = headers.getSetCookie?.() ?? []
  return set.map((line) => line.split(';')[0]).join('; ')
}

function cookieValue(header: string, name: string): string {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return ''
}

test('parseGoogleUserInfo reads sub, email, name, and picture', () => {
  const identity = parseGoogleUserInfo({
    sub: 'google-sub-1',
    email: 'ada@example.com',
    email_verified: true,
    name: 'Ada',
    picture: 'https://lh3.googleusercontent.com/a/ada',
  })
  assert.deepEqual(identity, {
    sub: 'google-sub-1',
    email: 'ada@example.com',
    emailVerified: true,
    displayName: 'Ada',
    avatarUrl: 'https://lh3.googleusercontent.com/a/ada',
  })
})

test('the same Google ID updates one account', async () => {
  const db = await openDatabase()
  const first = await upsertAccount(db, {
    sub: 'google-sub-1',
    email: 'ada@example.com',
    emailVerified: true,
    displayName: 'Ada',
    avatarUrl: 'https://lh3.googleusercontent.com/a/ada',
  })
  const second = await upsertAccount(db, {
    sub: 'google-sub-1',
    email: 'ada.lovelace@example.com',
    emailVerified: true,
    displayName: 'Ada Lovelace',
    avatarUrl: null,
  })
  const other = await upsertAccount(db, {
    sub: 'google-sub-2',
    email: 'grace@example.com',
    emailVerified: true,
    displayName: 'Grace',
    avatarUrl: null,
  })
  assert.equal(first.ok && second.ok && other.ok, true)
  if (!first.ok || !second.ok || !other.ok) return
  assert.equal(second.account.id, first.account.id)
  assert.notEqual(other.account.id, first.account.id)
  assert.equal(second.account.email, 'ada.lovelace@example.com')
  assert.equal(second.account.displayName, 'Ada Lovelace')
  assert.equal(second.account.avatarUrl, null)
  assert.equal(await countUsers(db), 2)
  await db.close()
})

test('an unverified email does not create an account', async () => {
  const db = await openDatabase()
  const result = await upsertAccount(db, {
    sub: 'google-sub-1',
    email: 'ada@example.com',
    emailVerified: false,
    displayName: 'Ada',
    avatarUrl: null,
  })
  assert.deepEqual(result, { ok: false, failure: 'unverified_email' })
  assert.equal(await countUsers(db), 0)
  await db.exec(readFileSync(new URL('../migrations/001_accounts.sql', import.meta.url), 'utf8'))
  assert.equal(await countUsers(db), 0)
  await db.close()
})

test('Google sign-in, repeat sign-in, and sign-out', async () => {
  const db = await openDatabase()
  let current: Profile = {
    sub: 'google-sub-1',
    email: 'ada@example.com',
    email_verified: true,
    name: 'Ada',
    picture: 'https://lh3.googleusercontent.com/a/ada',
  }
  const seen = { tokenBody: '' }
  const { server, base } = await listen(db, () => current, seen)
  try {
    const home = await fetch(base)
    assert.equal(home.status, 200)
    assert.match(await home.text(), /Sign in with Google/)

    const start = await fetch(`${base}/auth/google`, { redirect: 'manual' })
    assert.equal(start.status, 302)
    const location = new URL(start.headers.get('location') ?? '')
    assert.equal(location.origin, 'https://accounts.google.com')
    assert.equal(location.pathname, '/o/oauth2/v2/auth')
    assert.equal(location.searchParams.get('client_id'), 'client-id')
    assert.equal(location.searchParams.get('redirect_uri'), `${base}/auth/google/callback`)
    assert.equal(location.searchParams.get('scope'), 'openid email profile')
    assert.equal(location.searchParams.get('response_type'), 'code')
    const state = location.searchParams.get('state')
    assert.ok(state)
    const stateCookie = cookiesFrom(start)
    assert.match(stateCookie, /oauth_state=/)
    const sample = await fetch(`${base}/auth/sample`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'return=/',
    })
    assert.equal(sample.status, 404)

    const bad = await fetch(`${base}/auth/google/callback?code=nope&state=wrong`, {
      redirect: 'manual',
      headers: { cookie: stateCookie },
    })
    assert.equal(bad.status, 400)
    assert.match(await bad.text(), /did not match/)
    assert.equal(await countUsers(db), 0)

    const callback = await fetch(`${base}/auth/google/callback?code=good-code&state=${encodeURIComponent(state)}`, {
      redirect: 'manual',
      headers: { cookie: stateCookie },
    })
    assert.equal(callback.status, 302)
    assert.equal(callback.headers.get('location'), '/')
    assert.match(seen.tokenBody, /code=good-code/)
    assert.match(seen.tokenBody, /client_secret=client-secret/)
    const sessionCookie = cookiesFrom(callback)
    assert.match(sessionCookie, /session=/)

    const signedIn = await fetch(base, { headers: { cookie: sessionCookie } })
    const signedInHtml = await signedIn.text()
    assert.match(signedInHtml, /Ada/)
    assert.match(signedInHtml, /ada@example.com/)
    assert.match(signedInHtml, /https:\/\/lh3.googleusercontent.com\/a\/ada/)
    assert.match(signedInHtml, /Sign out/)
    assert.equal(await countUsers(db), 1)
    assert.equal(await countSessions(db), 1)

    current = {
      sub: 'google-sub-1',
      email: 'ada.lovelace@example.com',
      email_verified: true,
      name: 'Ada Lovelace',
      picture: 'javascript:alert(1)',
    }
    const again = await fetch(`${base}/auth/google`, { redirect: 'manual' })
    const againState = new URL(again.headers.get('location') ?? '').searchParams.get('state')
    const againCookie = cookiesFrom(again)
    const againCallback = await fetch(
      `${base}/auth/google/callback?code=second&state=${encodeURIComponent(againState ?? '')}`,
      { redirect: 'manual', headers: { cookie: againCookie } },
    )
    const nextSession = cookiesFrom(againCallback)
    const updated = await fetch(base, { headers: { cookie: nextSession } })
    const updatedHtml = await updated.text()
    assert.match(updatedHtml, /Ada Lovelace/)
    assert.match(updatedHtml, /ada.lovelace@example.com/)
    assert.doesNotMatch(updatedHtml, /javascript:alert/)
    assert.equal(await countUsers(db), 1)

    const loggedOutToken = cookieValue(nextSession, 'session')
    assert.equal((await accountForSession(db, loggedOutToken))?.displayName, 'Ada Lovelace')
    const logout = await fetch(`${base}/logout`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: nextSession },
    })
    assert.equal(logout.status, 302)
    const cleared = cookiesFrom(logout)
    const after = await fetch(base, { headers: { cookie: cleared } })
    assert.match(await after.text(), /Sign in with Google/)
    assert.equal(await accountForSession(db, decodeURIComponent(loggedOutToken)), null)
    assert.equal(await countUsers(db), 1)
    assert.equal(await countSessions(db), 1)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await db.close()
  }
})

test('missing Google credentials do not start a redirect', async () => {
  const db = await openDatabase()
  const app = createApp({
    db,
    config: { clientId: '', clientSecret: '' },
  })
  const server: Server = createServer((req, res) => {
    void app(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const base = `http://127.0.0.1:${port}`
    const home = await fetch(base)
    const homeHtml = await home.text()
    assert.match(homeHtml, /Try the sample account/)
    assert.match(homeHtml, /shared sample data/)
    assert.doesNotMatch(homeHtml, /Sign in with Google/)
    const response = await fetch(`${base}/auth/google`, { redirect: 'manual' })
    assert.equal(response.status, 500)
    assert.match(await response.text(), /GOOGLE_CLIENT_ID/)
    const started = await fetch(`${base}/auth/sample`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'return=/',
    })
    assert.equal(started.status, 303)
    const cookie = cookiesFrom(started)
    const signedIn = await fetch(base, { headers: { cookie } })
    const signedHtml = await signedIn.text()
    assert.match(signedHtml, /Hello, Sample friend/)
    assert.match(signedHtml, /Sample data/)
    const created = await fetch(`${base}/groups`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=Morning+walk',
    })
    assert.equal(created.status, 303)
    const groupUrl = new URL(created.headers.get('location') ?? '/', base)
    const group = await fetch(groupUrl, { headers: { cookie } })
    const groupHtml = await group.text()
    assert.match(groupHtml, /Morning walk/)
    assert.match(groupHtml, /Sample friend/)
    assert.equal(await countUsers(db), 1)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await db.close()
  }
})

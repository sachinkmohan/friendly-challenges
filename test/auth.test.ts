import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countUsers, upsertAccount } from '../src/accounts.ts'
import { closeDatabase, openTestDatabase } from '../src/db.ts'
import type { IdToken } from '../src/identity.ts'
import { accountForSession, countSessions } from '../src/sessions.ts'
import { closeServer, fakeVerifier, googleToken, listen } from './support/fixtures.ts'

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

function signIn(base: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return fetch(`${base}/auth/firebase`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  })
}

test('the same Google ID updates one account', async () => {
  const db = openTestDatabase()
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
  await closeDatabase(db)
})

test('an unverified email does not create an account', async () => {
  const db = openTestDatabase()
  const result = await upsertAccount(db, {
    sub: 'google-sub-1',
    email: 'ada@example.com',
    emailVerified: false,
    displayName: 'Ada',
    avatarUrl: null,
  })
  assert.deepEqual(result, { ok: false, failure: 'unverified_email' })
  assert.equal(await countUsers(db), 0)
  await closeDatabase(db)
})

test('Firebase sign-in, repeat sign-in, and sign-out', async () => {
  const db = openTestDatabase()
  const tokens = new Map<string, IdToken>([
    [
      'ada-1',
      googleToken('google-sub-1', {
        email: 'ada@example.com',
        email_verified: true,
        name: 'Ada',
        picture: 'https://lh3.googleusercontent.com/a/ada',
      }),
    ],
    [
      'ada-2',
      googleToken('google-sub-1', {
        email: 'ada.lovelace@example.com',
        email_verified: true,
        name: 'Ada Lovelace',
        picture: 'javascript:alert(1)',
      }),
    ],
  ])
  const { server, base } = await listen(db, { verifyIdToken: fakeVerifier(tokens) })
  try {
    const home = await fetch(base)
    assert.equal(home.status, 200)
    const homeHtml = await home.text()
    assert.match(homeHtml, /Sign in with Google/)
    assert.match(homeHtml, /action="\/auth\/firebase"/)
    const config = /data-firebase="([^"]*)"/.exec(homeHtml)?.[1]?.replaceAll('&quot;', '"')
    assert.deepEqual(JSON.parse(config ?? ''), {
      apiKey: 'test-api-key',
      authDomain: 'friendly-test.firebaseapp.com',
      projectId: 'demo-friendly-test',
    })
    assert.match(homeHtml, /https:\/\/www.gstatic.com\/firebasejs\/13.1.0\/firebase-auth.js/)

    const first = await signIn(base, { idToken: 'ada-1', return: '/groups/new' }, { origin: base })
    assert.equal(first.status, 303)
    assert.equal(first.headers.get('location'), '/groups/new')
    const sessionCookie = cookiesFrom(first)
    assert.match(sessionCookie, /session=/)
    assert.equal(await countUsers(db), 1)
    assert.equal(await countSessions(db), 1)

    const signedInHtml = await (await fetch(base, { headers: { cookie: sessionCookie } })).text()
    assert.match(signedInHtml, /Hello, Ada/)
    assert.match(signedInHtml, /ada@example.com/)
    assert.match(signedInHtml, /https:\/\/lh3.googleusercontent.com\/a\/ada/)
    assert.match(signedInHtml, /Sign out/)

    const again = await signIn(base, { idToken: 'ada-2', return: '' })
    assert.equal(again.status, 303)
    assert.equal(again.headers.get('location'), '/')
    const nextSession = cookiesFrom(again)
    const updatedHtml = await (await fetch(base, { headers: { cookie: nextSession } })).text()
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
    const after = await fetch(base, { headers: { cookie: cookiesFrom(logout) } })
    assert.match(await after.text(), /Sign in with Google/)
    assert.equal(await accountForSession(db, loggedOutToken), null)
    assert.equal(await countUsers(db), 1)
    assert.equal(await countSessions(db), 1)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('a sign-in Firebase or Google does not vouch for makes no account and no session', async () => {
  const db = openTestDatabase()
  const ada = { email: 'ada@example.com', email_verified: true, name: 'Ada' }
  const tokens = new Map<string, IdToken>([
    ['ada', googleToken('google-sub-1', ada)],
    ['unverified', googleToken('google-sub-2', { ...ada, email_verified: false })],
    ['password', { ...ada, firebase: { sign_in_provider: 'password', identities: { email: ['ada@example.com'] } } }],
  ])
  const { server, base } = await listen(db, { verifyIdToken: fakeVerifier(tokens) })
  try {
    const forged = await signIn(base, { idToken: 'forged', return: '/' })
    assert.equal(forged.status, 400)
    assert.match(await forged.text(), /not valid or has expired/)

    const empty = await signIn(base, { return: '/' })
    assert.equal(empty.status, 400)
    assert.match(await empty.text(), /not valid or has expired/)

    const password = await signIn(base, { idToken: 'password' })
    assert.equal(password.status, 400)
    assert.match(await password.text(), /Sign in with a Google account/)

    const unverified = await signIn(base, { idToken: 'unverified' })
    assert.equal(unverified.status, 400)
    assert.match(await unverified.text(), /did not confirm the email/)

    const crossSite = await signIn(base, { idToken: 'ada' }, { origin: 'https://evil.example' })
    assert.equal(crossSite.status, 403)
    assert.match(await crossSite.text(), /came from another site/)

    for (const response of [forged, empty, password, unverified, crossSite]) {
      assert.doesNotMatch(cookiesFrom(response), /session=/)
    }
    assert.equal(await countUsers(db), 0)
    assert.equal(await countSessions(db), 0)

    const looked = await fetch(`${base}/auth/firebase`, { redirect: 'manual' })
    assert.equal(looked.status, 405)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('missing Firebase config says what to set instead of a sign-in button', async () => {
  const db = openTestDatabase()
  const { server, base } = await listen(db, { firebase: null })
  try {
    const html = await (await fetch(base)).text()
    assert.match(html, /Sign-in is not configured. Set FIREBASE_API_KEY and FIREBASE_AUTH_DOMAIN./)
    assert.doesNotMatch(html, /data-firebase=/)
    assert.doesNotMatch(html, /Sign in with Google<\/button>/)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

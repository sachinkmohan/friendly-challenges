import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const base = 'http://localhost:3099'
const authEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST
assert.ok(authEmulator, 'Run this under firebase emulators:exec --only firestore,auth.')

const app = spawn(process.execPath, ['--experimental-strip-types', 'src/dev-server.ts'], {
  env: { ...process.env, PORT: '3099' },
  stdio: 'inherit',
})
try {
  for (let tries = 0; !(await fetch(base).then((r) => r.ok, () => false)); tries++) {
    assert.ok(tries < 50, 'The app did not start.')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  // The Auth emulator accepts an unsigned Google ID token, so this stands in for the popup.
  const googleIdToken = JSON.stringify({ sub: 'g-123', email: 'a@example.com', email_verified: true, name: 'A' })
  const idp = await fetch(`http://${authEmulator}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  })
  const { idToken } = (await idp.json()) as { idToken: string }
  assert.ok(idToken, 'The Auth emulator returned no ID token.')

  const signIn = await fetch(`${base}/auth/firebase`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base },
    body: new URLSearchParams({ idToken, return: '/' }),
  })
  assert.equal(signIn.status, 303)
  assert.equal(signIn.headers.get('location'), '/')
  const session = signIn.headers.getSetCookie().find((line) => line.startsWith('session='))?.split(';')[0]
  assert.ok(session, 'No session cookie.')

  const home = await (await fetch(base, { headers: { cookie: session } })).text()
  assert.match(home, /Hello, A</)
  assert.match(home, /a@example.com/)

  const forged = await fetch(`${base}/auth/firebase`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ idToken: `${idToken.slice(0, -4)}AAAA`, return: '/' }),
  })
  assert.equal(forged.status, 400)
  console.log('auth emulator check: 303 to /, session cookie set, home shows "Hello, A" and a@example.com, altered token gets 400')
} finally {
  app.kill()
}

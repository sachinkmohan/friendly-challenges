import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseGroupId } from '../src/groups.ts'
import { renderGroup, renderHome, renderMessage, renderNewChallenge } from '../src/page.ts'

const account = {
  id: '1',
  googleSub: 'sub',
  email: 'ada@example.com',
  displayName: 'Ada',
  avatarUrl: 'https://lh3.googleusercontent.com/a/ada',
}

const signedOut = {
  state: 'signed_out',
  firebase: { apiKey: 'key', authDomain: 'friendly.firebaseapp.com', projectId: 'friendly' },
  origin: 'https://friendlychallenges.netlify.app',
  browser: { inApp: false, os: 'other', iosInstall: null },
} as const

test('every page is the same phone shell, full screen on a phone', () => {
  const groupId = parseGroupId('00000000-0000-4000-8000-000000000001')
  if (!groupId) throw new Error('fixture group id')
  const pages = [
    renderHome(signedOut),
    renderHome({ state: 'signed_in', account, groups: [], heatmaps: [], browser: signedOut.browser }),
    renderNewChallenge(signedOut),
    renderNewChallenge({ state: 'signed_in', account }),
    renderGroup(
      { kind: 'preview', groupId, label: 'Morning run', activeCount: 1, headline: null },
      signedOut,
      'http://127.0.0.1:3000',
    ),
    renderMessage('Not found', 'That page does not exist.'),
  ]
  for (const html of pages) {
    assert.match(html, /class="device"/)
    assert.match(html, /class="phone"/)
    assert.match(html, /class="appbar"/)
    assert.match(html, /class="tabbar"/)
    assert.match(html, /class="card"/)
    assert.match(html, /width: min\(390px, 100%\)/)
    assert.match(html, /height: min\(844px, 100dvh\)/)
    assert.match(html, /min-height: 48px/)
    assert.match(html, /overflow: hidden/)
    assert.match(html, /preventDefault/)
    const phoneRule = html.match(/@media \(max-width: 500px\), \(max-height: 500px\) \{([^@]*?)\n    \}/)?.[1] ?? ''
    assert.match(phoneRule, /html, body, \.stage \{ height: auto; overflow: visible; \}/, 'the document scrolls on a phone, so pull-to-refresh works')
    assert.match(phoneRule, /\.screens \{ overflow: visible; \}/)
    assert.match(phoneRule, /\.appbar \{ position: sticky; top: 0;/)
    assert.match(phoneRule, /\.tabbar \{ position: sticky; bottom: 0; \}/)
    assert.match(phoneRule, /\.device \{ width: 100%; height: auto; padding: 0; border-radius: 0; box-shadow: none; \}/)
    assert.match(phoneRule, /\.indicator \{ display: none; \}/)
    assert.match(html, /<meta name="theme-color" content="#fffdf8">/)
    assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest">/)
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png">/)
    assert.match(html, /navigator\.serviceWorker\.register\('\/sw.js'\)/)
  }
  const preview = pages[4]
  assert.match(preview, /class="screen is-current"/)
  assert.doesNotMatch(preview, /<section[^>]*\sid=/)
})

test('signed-out shell keeps Google sign-in on the phone screens', () => {
  const html = renderHome(signedOut)
  assert.match(html, /Sign in with Google/)
  assert.match(html, /href="#home"/)
  assert.match(html, /href="#account"/)
  assert.match(html, /id="home"/)
  assert.match(html, /id="account"/)
})

test('signed-in shell keeps the account card and sign-out', () => {
  const html = renderHome({ state: 'signed_in', account, groups: [], heatmaps: [], browser: signedOut.browser })
  assert.match(html, /Hello, Ada/)
  assert.match(html, /You are not in a challenge yet/)
  assert.match(html, /href="\/groups\/new"/)
  assert.doesNotMatch(html, /Your group will use this account/)
  assert.match(html, /ada@example.com/)
  assert.match(html, /https:\/\/lh3.googleusercontent.com\/a\/ada/)
  assert.match(html, /action="\/logout"/)
  assert.match(html, /Sign out/)
})

test('home keeps your groups apart from creating a new one', () => {
  const groupId = parseGroupId('00000000-0000-4000-8000-000000000001')
  if (!groupId) throw new Error('fixture group id')
  const html = renderHome({
    state: 'signed_in',
    account,
    groups: [{ groupId, label: '100 Days of Writing', activeCount: 2 }],
    heatmaps: [],
    browser: signedOut.browser,
  })
  const yours = html.indexOf('Your challenges')
  const group = html.indexOf('100 Days of Writing')
  const fresh = html.indexOf('Start something new')
  const create = html.indexOf('href="/groups/new"')
  assert.ok(yours > -1 && yours < group, 'groups sit under a Your challenges label')
  assert.ok(group < fresh && fresh < create, 'creating a group sits in its own later section')
  assert.match(html, /<a href="\/groups\/[^"]+"><span class="group-name">100 Days of Writing<\/span><span class="count">2 active<\/span>/)
  assert.match(html, /<div class="new-group">/)
})

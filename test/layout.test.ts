import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseGroupId } from '../src/groups.ts'
import { renderBadge, renderGroup, renderHome, renderMessage, renderNewChallenge } from '../src/page.ts'

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
    renderBadge(signedOut),
    renderBadge({ state: 'signed_in', badge: { kind: 'initials', initials: 'AD' }, initials: 'AD' }),
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
    assert.match(phoneRule, /\.tabbar \{ position: sticky; bottom: 0;/)
    assert.match(phoneRule, /\.device \{ width: 100%; height: auto; padding: 0; border-radius: 0; box-shadow: none; \}/)
    assert.match(phoneRule, /\.indicator \{ display: none; \}/)
    assert.match(html, /<meta name="theme-color" content="#fffdf8">/)
    assert.match(html, /<meta name="apple-mobile-web-app-title" content="Friendly challenges">/)
    assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest">/)
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png">/)
    assert.match(html, /navigator\.serviceWorker\.register\('\/sw.js'\)/)
  }
  const preview = pages[4]
  assert.match(preview, /class="screen is-current"/)
  assert.doesNotMatch(preview, /<section[^>]*\sid=/)
})

test('every page ships one save lock that shows Saving… and unlocks on back', () => {
  const pages = [
    renderHome(signedOut),
    renderNewChallenge({ state: 'signed_in', account }),
    renderBadge({ state: 'signed_in', badge: { kind: 'initials', initials: 'AD' }, initials: 'AD' }),
  ]
  for (const html of pages) {
    assert.equal(html.split("document.addEventListener('submit'").length - 1, 1)
    assert.equal(html.split("addEventListener('pageshow'").length - 1, 1)
    assert.match(html, /<span class="spinner" aria-hidden="true"><\/span>Saving…/)
    assert.match(html, /form\.matches\('\.sign-in'\)/, 'Google sign-in is left alone')
    assert.match(html, /aria-busy/)
    assert.match(html, /\n    button:disabled \{ opacity: 0\.45; cursor: progress; \}/)
    const motion = html.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n    \}/)?.[1] ?? ''
    assert.match(motion, /\.spinner \{ animation: spin/, 'the spinner turns only when motion is welcome')
    const outside = html.replace(motion, '')
    assert.doesNotMatch(outside, /\.spinner \{[^}]*animation/)
  }
})

test('every page shows a progress bar and dims the tapped link while the next page loads', () => {
  const pages = [
    renderHome(signedOut),
    renderNewChallenge({ state: 'signed_in', account }),
    renderBadge({ state: 'signed_in', badge: { kind: 'initials', initials: 'AD' }, initials: 'AD' }),
    renderMessage('Not found', 'That page does not exist.'),
  ]
  for (const html of pages) {
    const appbar = html.match(/<header class="appbar">([\s\S]*?)<\/header>/)?.[1] ?? ''
    assert.match(appbar, /<div class="nav-progress" aria-hidden="true" hidden><\/div>/, 'the bar starts hidden inside the appbar')
    assert.equal(html.split("document.addEventListener('click'").length - 1, 1)
    assert.match(html, /event\.defaultPrevented/, 'the tab handler already took the tap')
    assert.match(html, /location\.origin/, 'other origins are left alone')
    const pageshow = html.match(/addEventListener\('pageshow'[\s\S]*?\n    \}\)/)?.[0] ?? ''
    assert.match(pageshow, /remove\('is-navigating'\)/, 'coming back clears the dimmed link')
    assert.match(pageshow, /nav-progress/, 'coming back hides the bar')
    assert.match(html, /\n    a\.is-navigating \{ opacity: 0\.6; \}/)
    assert.match(html, /\n    \.nav-progress\[hidden\] \{ display: none; \}/)
    const motion = html.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n    \}/)?.[1] ?? ''
    assert.match(motion, /\.nav-progress::before \{ animation: nav-slide/, 'the bar moves only when motion is welcome')
    const outside = html.replace(motion, '')
    assert.doesNotMatch(outside, /animation: nav-slide|@keyframes nav-slide/)
    assert.match(outside, /\.nav-progress::before \{[^}]*width: 40%/, 'with reduced motion the bar is a still segment')
  }
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

test('the top bar names the page and inner pages get a back arrow', () => {
  const groupId = parseGroupId('00000000-0000-4000-8000-000000000001')
  if (!groupId) throw new Error('fixture group id')
  const tabs = (html: string) => html.match(/<nav class="tabbar"[\s\S]*?<\/nav>/)?.[0] ?? ''

  const home = renderHome(signedOut)
  assert.match(home, /<h1>Friendly challenges<\/h1>/)
  assert.match(home, /<title>Friendly challenges<\/title>/)
  assert.doesNotMatch(home, /class="appbar-back"/)
  assert.match(tabs(home), /class="tab tab-home" href="#home" aria-current="page"/)
  assert.doesNotMatch(tabs(home), /tab-account[^>]*aria-current/)

  const inner = [
    { title: 'New challenge', html: renderNewChallenge(signedOut) },
    { title: 'New challenge', html: renderNewChallenge({ state: 'signed_in', account }) },
    { title: 'Your badge', html: renderBadge(signedOut) },
    { title: 'Your badge', html: renderBadge({ state: 'signed_in', badge: { kind: 'initials', initials: 'AD' }, initials: 'AD' }) },
    { title: 'Not found', html: renderMessage('Not found', 'That page does not exist.') },
    { title: 'Run &amp; &lt;b&gt;', html: renderMessage('Run & <b>', 'x') },
    {
      title: 'Morning run',
      html: renderGroup({ kind: 'preview', groupId, label: 'Morning run', activeCount: 1, headline: null }, signedOut, 'http://127.0.0.1:3000'),
    },
    {
      title: 'Full house',
      html: renderGroup({ kind: 'full', groupId, label: 'Full house', activeCount: 8, headline: null }, signedOut, 'http://127.0.0.1:3000'),
    },
  ]
  const headings = (html: string) => html.match(/<h2>[\s\S]*?<\/h2>/g) ?? []
  for (const { title, html } of inner) {
    assert.match(html, /<a class="appbar-back" href="\/" aria-label="Back to Home"><svg[^>]*aria-hidden="true"/)
    assert.ok(html.includes(`<h1>${title}</h1>`), title)
    assert.ok(html.includes(`<title>${title}</title>`), title)
    assert.ok(!headings(html).some((h) => h === `<h2>${title}</h2>`), 'the title is not repeated under the top bar')
    assert.doesNotMatch(tabs(html), /aria-current/)
    assert.doesNotMatch(html, /<h2>Create a challenge<\/h2>/, 'the old create heading is gone')
  }

  const css = home.match(/\n    h1 \{[^}]*\}/)?.[0] ?? ''
  assert.match(css, /white-space: nowrap/)
  assert.match(css, /overflow: hidden/)
  assert.match(css, /text-overflow: ellipsis/)
  assert.match(css, /min-width: 0/)
  const back = home.match(/\.appbar-back \{[^}]*\}/)?.[0] ?? ''
  assert.match(back, /width: 48px/)
  assert.match(back, /height: 48px/)
  assert.match(home, /grid-template-columns: 48px minmax\(0, 1fr\) 48px/)

  const script = home.match(/function applyScreen\(\) \{\n\s*if \(!document\.getElementById\('home'\)\) return/)
  assert.ok(script, 'applyScreen bails out on pages without the home screen')
})

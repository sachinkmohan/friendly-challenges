import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readBrowser, type Browser } from '../src/browser.ts'
import { closeDatabase, openTestDatabase } from '../src/db.ts'
import { parseGroupId } from '../src/groups.ts'
import { renderGroup, renderHome, renderNewGroup } from '../src/page.ts'
import { closeServer, groupWith, listen, person } from './support/fixtures.ts'

const agents: readonly { name: string; agent: string | undefined; expected: Browser }[] = [
  {
    name: 'Instagram on iPhone',
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 336.0.3.17.106 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 612173000)',
    expected: { inApp: true, os: 'ios' },
  },
  {
    name: 'Instagram on Android',
    agent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240705.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.134 Mobile Safari/537.36 Instagram 339.0.0.30.105 Android (34/14; 420dpi; 1080x2205; Google/google; Pixel 8; shiba; shiba; en_US; 620347000)',
    expected: { inApp: true, os: 'android' },
  },
  {
    name: 'Facebook on iPhone',
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.108;FBBV/617081429;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5.1;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/80]',
    expected: { inApp: true, os: 'ios' },
  },
  {
    name: 'Messenger on Android',
    agent:
      'Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/462.0.0.47.86;]',
    expected: { inApp: true, os: 'android' },
  },
  {
    name: 'WhatsApp on Android',
    agent:
      'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 WhatsApp/2.24.16.78',
    expected: { inApp: true, os: 'android' },
  },
  {
    name: 'WhatsApp on iPhone',
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.16.79',
    expected: { inApp: true, os: 'ios' },
  },
  {
    name: 'LinkedIn on iPhone',
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.6614',
    expected: { inApp: true, os: 'ios' },
  },
  {
    name: 'X on iPhone',
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.48',
    expected: { inApp: true, os: 'ios' },
  },
  {
    name: 'TikTok on Android',
    agent:
      'Mozilla/5.0 (Linux; Android 12; SM-G991B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 trill_2023405030 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/34.5.3 ByteLocale/en BytedanceWebview/d8a21c6',
    expected: { inApp: true, os: 'android' },
  },
  {
    name: 'Snapchat on iPhone, which claims to be Safari',
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.0.0.38 (like Safari/8618.2.12.10.4, panda)',
    expected: { inApp: true, os: 'ios' },
  },
  {
    name: 'Line on iPhone',
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0',
    expected: { inApp: true, os: 'ios' },
  },
  {
    name: 'Safari on iPhone',
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    expected: { inApp: false, os: 'ios' },
  },
  {
    name: 'Chrome on iPhone',
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
    expected: { inApp: false, os: 'ios' },
  },
  {
    name: 'Firefox on iPhone',
    agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/128.0 Mobile/15E148 Safari/605.1.15',
    expected: { inApp: false, os: 'ios' },
  },
  {
    name: 'Chrome on Android',
    agent:
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    expected: { inApp: false, os: 'android' },
  },
  {
    name: 'Samsung Internet on Android',
    agent:
      'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    expected: { inApp: false, os: 'android' },
  },
  {
    name: 'Chrome on a Mac',
    agent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    expected: { inApp: false, os: 'other' },
  },
  { name: 'no user agent', agent: undefined, expected: { inApp: false, os: 'other' } },
]

test('reads in-app browsers and the phone system from the user agent', () => {
  for (const { name, agent, expected } of agents) {
    assert.deepEqual(readBrowser(agent), expected, name)
  }
})

const firebase = { apiKey: 'key', authDomain: 'friendly.firebaseapp.com', projectId: 'friendly' }
const origin = 'https://friendlychallenges.netlify.app'

function signedOut(browser: Browser) {
  return { state: 'signed_out', firebase, origin, browser } as const
}

function card(html: string): string {
  return html.match(/<div class="in-app"[\s\S]*?<\/div>/)?.[0] ?? ''
}

test('an in-app browser on Android gets the invite link and an open-in-browser button', () => {
  const groupId = parseGroupId('00000000-0000-4000-8000-000000000001')
  if (!groupId) throw new Error('fixture group id')
  const html = renderGroup(
    { kind: 'preview', groupId, name: 'Morning run', activeCount: 1, headline: null },
    signedOut({ inApp: true, os: 'android' }),
    origin,
  )
  const shown = card(html)
  assert.match(shown, /^<div class="in-app">/, 'the card is visible')
  assert.match(shown, new RegExp(`value="${origin}/groups/${groupId}"`), 'the field holds the invite link')
  assert.match(shown, /Copy link/)
  assert.match(shown, new RegExp(`href="intent://friendlychallenges.netlify.app/groups/${groupId}#Intent;scheme=https;end"`))
  assert.doesNotMatch(shown, /package=/, 'the default browser opens, not a named one')
  assert.match(html, /<button type="button" class="google secondary">Try Google sign-in anyway<\/button>/)
  assert.ok(html.indexOf('class="in-app"') < html.indexOf('class="google'), 'the card sits above the Google button')
})

test('an in-app browser on iPhone gets steps that do not name Safari', () => {
  const shown = card(renderNewGroup(signedOut({ inApp: true, os: 'ios' })))
  assert.match(shown, /^<div class="in-app">/)
  assert.match(shown, new RegExp(`value="${origin}/groups/new"`))
  assert.match(shown, /Open in browser/)
  assert.doesNotMatch(shown, /Safari|intent:/)
})

test('home in an in-app browser offers the app link', () => {
  const shown = card(renderHome(signedOut({ inApp: true, os: 'other' })))
  assert.match(shown, new RegExp(`value="${origin}/"`))
})

test('a normal browser keeps the plain Google button and a hidden card for when the popup is blocked', () => {
  const html = renderHome(signedOut({ inApp: false, os: 'android' }))
  assert.match(card(html), /^<div class="in-app" hidden>/)
  assert.match(html, /<button type="button" class="google">Sign in with Google<\/button>/)
  assert.match(html, /querySelector\('\.in-app'\)\.hidden = false/, 'a blocked popup reveals the card')
})

test('an invite opened from Instagram shows the card with that invite link', async () => {
  const db = openTestDatabase()
  const { server, base } = await listen(db)
  try {
    const groupId = await groupWith(db, [await person(db, 'Ada')])
    const response = await fetch(`${base}/groups/${groupId}`, { headers: { 'user-agent': agents[0].agent ?? '' } })
    const shown = card(await response.text())
    assert.match(shown, /^<div class="in-app">/)
    assert.match(shown, new RegExp(`value="${base}/groups/${groupId}"`))
    const plain = card(await (await fetch(`${base}/groups/${groupId}`)).text())
    assert.match(plain, /^<div class="in-app" hidden>/)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

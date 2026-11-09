import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { Server } from 'node:http'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { closeServer, cookieFor, listen, person } from './support/fixtures.ts'

let db: Database
let server: Server
let base: string

before(async () => {
  db = openTestDatabase()
  ;({ server, base } = await listen(db))
})

after(async () => {
  await closeServer(server)
  await closeDatabase(db)
})

async function pngSize(path: string): Promise<{ width: number; height: number }> {
  const response = await fetch(`${base}${path}`)
  assert.equal(response.status, 200, path)
  assert.equal(response.headers.get('content-type'), 'image/png', path)
  const png = Buffer.from(await response.arrayBuffer())
  assert.equal(png.subarray(12, 16).toString('latin1'), 'IHDR', path)
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

test('the manifest opens the app full screen at the home page with icons that match their sizes', async () => {
  const response = await fetch(`${base}/manifest.webmanifest`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^application\/manifest\+json/)
  const manifest = (await response.json()) as {
    display: string
    start_url: string
    icons: { src: string; sizes: string; type: string }[]
  }
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.start_url, '/')
  const sizes = manifest.icons.map((icon) => icon.sizes)
  assert.ok(sizes.includes('192x192'))
  assert.ok(sizes.includes('512x512'))
  for (const icon of manifest.icons) {
    const { width, height } = await pngSize(icon.src)
    assert.equal(`${width}x${height}`, icon.sizes, icon.src)
  }
})

test('the apple touch icon is 180 by 180', async () => {
  assert.deepEqual(await pngSize('/apple-touch-icon.png'), { width: 180, height: 180 })
})

test('the service worker is javascript the browser always rechecks', async () => {
  const response = await fetch(`${base}/sw.js`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /javascript/)
  assert.equal(response.headers.get('cache-control'), 'no-cache')
  assert.match(await response.text(), /caches\.match\('\/offline'\)/)
})

test('the offline page says the person is offline', async () => {
  const response = await fetch(`${base}/offline`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/)
  assert.match(await response.text(), /You are offline/)
})

test('install files only answer GET', async () => {
  const response = await fetch(`${base}/manifest.webmanifest`, { method: 'POST' })
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET')
})

const agents = {
  safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  edgeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.2592.86 Mobile/15E148 Safari/605.1.15',
  firefoxIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/128.0 Mobile/15E148 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}

async function home(agent: string, signedIn = true): Promise<{ home: string; account: string }> {
  const headers: Record<string, string> = { 'user-agent': agent }
  if (signedIn) headers.cookie = await cookieFor(db, await person(db, 'Ada'))
  const html = await (await fetch(`${base}/`, { headers })).text()
  const split = html.indexOf('<section id="account"')
  return { home: html.slice(html.indexOf('<section id="home"'), split), account: html.slice(split, html.indexOf('</section>', split)) }
}

function installCard(html: string): string {
  return html.match(/<article class="card install-card" hidden>[\s\S]*?<\/article>/)?.[0] ?? ''
}

function steps(html: string): string[] {
  const list = html.match(/<ol class="install-steps">([\s\S]*?)<\/ol>/)?.[1] ?? ''
  return [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((item) => item[1]!.replace(/<svg[\s\S]*?<\/svg>/g, '[icon]'))
}

test('home on iPhone Safari carries a hidden card with the Safari steps and a Done button', async () => {
  const { home: screen, account } = await home(agents.safari)
  const card = installCard(screen)
  assert.match(card, /<h2>Put Challenges on your Home Screen<\/h2>/)
  assert.deepEqual(steps(card), ['Tap Share [icon]. On iOS 26, tap ⋯ first.', 'Tap Add to Home Screen [icon].', 'Tap Add.'])
  assert.match(card, /You'll sign in once inside the app\./)
  assert.match(card, /<button type="button" class="install-done secondary">Done<\/button>/)
  assert.match(card, /<svg class="install-icon"[^>]*aria-hidden="true"/)
  assert.match(account, /<div class="install-ios" hidden>/)
  assert.deepEqual(steps(account), steps(card), 'the Account tab shows the same steps')
})

test('Chrome and Edge on iPhone get their own Share steps', async () => {
  assert.deepEqual(steps(installCard((await home(agents.chromeIos)).home)), [
    'Tap Share [icon] in the address bar.',
    'Tap Add to Home Screen [icon].',
    'Tap Add.',
  ])
  assert.deepEqual(steps(installCard((await home(agents.edgeIos)).home)), [
    'Tap ⋯, then Share [icon].',
    'Tap Add to Home Screen [icon].',
    'Tap Add.',
  ])
})

test('other iPhone browsers are sent to Safari', async () => {
  const { home: screen, account } = await home(agents.firefoxIos)
  const card = installCard(screen)
  assert.match(card, /Open this page in Safari to install the app\./)
  assert.match(card, /You'll sign in once inside the app\./)
  assert.deepEqual(steps(card), [])
  assert.match(account, /<div class="install-ios" hidden><p class="install-steps">Open this page in Safari to install the app\.<\/p>/)
})

test('Android and desktop get no install card and no iPhone steps', async () => {
  for (const agent of [agents.android, agents.mac]) {
    const { home: screen, account } = await home(agent)
    assert.doesNotMatch(screen, /install-card/)
    assert.doesNotMatch(account, /install-ios|install-steps/)
    assert.match(account, /<div class="install" hidden>/)
    assert.match(account, /<button type="button" class="install-app" hidden>Install app<\/button>/)
  }
})

test('the Account tab keeps a hidden menu hint for when the install dialog is closed', async () => {
  for (const signedIn of [true, false]) {
    const { account } = await home(agents.android, signedIn)
    assert.match(account, /<p class="field-hint install-menu" hidden>Open the browser menu and choose Install app\.<\/p>/)
  }
})

test('signed out, the Account tab has the iPhone steps but home has no card', async () => {
  const { home: screen, account } = await home(agents.safari, false)
  assert.doesNotMatch(screen, /install-card/)
  assert.match(account, /<div class="install-ios" hidden>/)
})

test('the install script hides guidance only after an install and remembers Done', async () => {
  const html = await (await fetch(`${base}/`)).text()
  assert.match(html, /choice\.outcome === 'accepted'/)
  assert.match(html, /localStorage\.setItem\('install-card-done', '1'\)/)
  assert.doesNotMatch(html, /navigator\.standalone === false/)
})

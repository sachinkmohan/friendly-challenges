import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { Server } from 'node:http'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { closeServer, listen } from './support/fixtures.ts'

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

test('the account screen carries a hidden install block', async () => {
  const html = await (await fetch(`${base}/`)).text()
  const account = html.slice(html.indexOf('<section id="account"'))
  assert.match(account, /<div class="install" hidden>/)
  assert.match(account, /<button type="button" class="install-app" hidden>Install app<\/button>/)
  assert.match(account, /<p class="field-hint install-ios" hidden>In Safari, tap Share, then Add to Home Screen\.<\/p>/)
})

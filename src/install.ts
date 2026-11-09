import { crc32, deflateSync } from 'node:zlib'
import type { IosInstall } from './browser.ts'

export type InstallAsset = { readonly contentType: string; readonly body: Buffer | string; readonly cacheControl: string }

const GREEN = [0x2f, 0x7d, 0x4a] as const
const PAPER = '#fffdf8'
export const OFFLINE_PATH = '/offline'

// One check mark for every icon, kept inside the maskable safe zone (the central 80% circle).
const CHECK: readonly (readonly [number, number])[] = [
  [0.28, 0.51],
  [0.42, 0.65],
  [0.72, 0.35],
]
const STROKE_HALF_WIDTH = 0.055

function distanceToSegment(px: number, py: number, a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy)
}

function drawIcon(size: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / size
      const py = (y + 0.5) / size
      let distance = Infinity
      for (let i = 1; i < CHECK.length; i++) {
        distance = Math.min(distance, distanceToSegment(px, py, CHECK[i - 1]!, CHECK[i]!))
      }
      const cover = Math.max(0, Math.min(1, (STROKE_HALF_WIDTH - distance) * size + 0.5))
      const offset = (y * size + x) * 4
      for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(GREEN[c]! + (255 - GREEN[c]!) * cover)
      pixels[offset + 3] = 255
    }
  }
  return encodePng(size, size, pixels)
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const name = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(data, crc32(name)))
  return Buffer.concat([length, name, data, crc])
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const stride = width * 4
  const rows = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const manifest = {
  name: 'Friendly challenges',
  short_name: 'Challenges',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: PAPER,
  theme_color: PAPER,
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

// Pages are no-store and personal, so the worker caches only the offline page.
const serviceWorker = `const CACHE = 'offline-v1'
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('${OFFLINE_PATH}')).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => caches.match('${OFFLINE_PATH}')))
})
`

const icon = (size: number): InstallAsset => ({ contentType: 'image/png', body: drawIcon(size), cacheControl: 'public, max-age=86400' })
const icon512 = icon(512)

export const installAssets: ReadonlyMap<string, InstallAsset> = new Map([
  [
    '/manifest.webmanifest',
    { contentType: 'application/manifest+json', body: JSON.stringify(manifest), cacheControl: 'public, max-age=3600' },
  ],
  ['/icons/icon-192.png', icon(192)],
  ['/icons/icon-512.png', icon512],
  ['/icons/maskable-512.png', icon512],
  ['/apple-touch-icon.png', icon(180)],
  ['/sw.js', { contentType: 'text/javascript; charset=utf-8', body: serviceWorker, cacheControl: 'no-cache' }],
])

export const installHead = `<link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icons/icon-192.png" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="apple-mobile-web-app-title" content="Challenges">`

const iconAttrs = 'class="install-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
const SHARE_ICON = `<svg ${iconAttrs}><path d="M8.5 9.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7.5a2 2 0 0 0-2-2h-1.5"/><path d="M12 14.5V3M8.5 6.5 12 3l3.5 3.5"/></svg>`
const ADD_ICON = `<svg ${iconAttrs}><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>`

const addSteps = [`Tap Add to Home Screen ${ADD_ICON}.`, 'Tap Add.']

const iosInstallSteps: Readonly<Record<IosInstall, readonly string[]>> = {
  safari: [`Tap Share ${SHARE_ICON}. On iOS 26, tap ⋯ first.`, ...addSteps],
  chrome: [`Tap Share ${SHARE_ICON} in the address bar.`, ...addSteps],
  edge: [`Tap ⋯, then Share ${SHARE_ICON}.`, ...addSteps],
  use_safari: [],
}

export function iosSteps(kind: IosInstall): string {
  const steps = iosInstallSteps[kind]
  const body =
    steps.length === 0
      ? '<p class="install-steps">Open this page in Safari to install the app.</p>'
      : `<ol class="install-steps">${steps.map((step) => `<li>${step}</li>`).join('')}</ol>`
  return `${body}
          <p class="field-hint">You'll sign in once inside the app.</p>`
}

export function installPrompt(iosInstall: IosInstall | null): string {
  const ios = iosInstall ? `<div class="install-ios" hidden>${iosSteps(iosInstall)}</div>` : ''
  return `<div class="install" hidden>
          <p class="section-title">Install the app</p>
          ${ios}
          <button type="button" class="install-app" hidden>Install app</button>
          <p class="field-hint install-menu" hidden>Open the browser menu and choose Install app.</p>
        </div>`
}

export function installCard(iosInstall: IosInstall): string {
  return `<article class="card install-card" hidden>
        <h2>Put Challenges on your Home Screen</h2>
        ${iosSteps(iosInstall)}
        <button type="button" class="install-done secondary">Done</button>
      </article>`
}

// iOS never fires beforeinstallprompt, so the server picks the Share steps from the user agent.
// A closed install dialog cannot reopen until Chrome fires the event again, so the menu hint stands in meanwhile.
export const installScript = `if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {})
    if (!matchMedia('(display-mode: standalone)').matches && navigator.standalone !== true) {
      var installEvent = null
      var setHidden = function (selector, hidden) {
        document.querySelectorAll(selector).forEach(function (node) { node.hidden = hidden })
      }
      var hideInstall = function () { setHidden('.install', true) }
      window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault()
        installEvent = event
        setHidden('.install, .install-app', false)
        setHidden('.install-menu', true)
      })
      document.querySelectorAll('.install-app').forEach(function (button) {
        button.addEventListener('click', function () {
          if (!installEvent) return
          var shown = installEvent
          installEvent = null
          shown.prompt()
          shown.userChoice.then(function (choice) {
            if (choice.outcome === 'accepted') return hideInstall()
            setHidden('.install-app', true)
            setHidden('.install-menu', false)
          })
        })
      })
      window.addEventListener('appinstalled', hideInstall)
      document.querySelectorAll('.install-ios').forEach(function (steps) {
        steps.hidden = false
        steps.closest('.install').hidden = false
      })
      var installDone = false
      try { installDone = localStorage.getItem('install-card-done') === '1' } catch (error) {}
      document.querySelectorAll('.install-card').forEach(function (card) {
        card.hidden = installDone
        card.querySelector('.install-done').addEventListener('click', function () {
          card.hidden = true
          try { localStorage.setItem('install-card-done', '1') } catch (error) {}
        })
      })
    }`

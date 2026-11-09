import { crc32, deflateSync } from 'node:zlib'

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

export const installPrompt = `<div class="install" hidden>
          <p class="section-title">Install the app</p>
          <p class="field-hint install-ios" hidden>In Safari, tap Share, then Add to Home Screen.</p>
          <button type="button" class="install-app" hidden>Install app</button>
        </div>`

// iOS Safari never fires beforeinstallprompt, so it gets the Share steps instead. A used prompt cannot show again, so the block hides either way.
export const installScript = `if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {})
    if (!matchMedia('(display-mode: standalone)').matches && navigator.standalone !== true) {
      var installEvent = null
      var reveal = function (selector) {
        document.querySelectorAll(selector).forEach(function (node) { node.hidden = false })
      }
      var hideInstall = function () {
        document.querySelectorAll('.install').forEach(function (block) { block.hidden = true })
      }
      window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault()
        installEvent = event
        reveal('.install, .install-app')
      })
      document.querySelectorAll('.install-app').forEach(function (button) {
        button.addEventListener('click', function () {
          if (!installEvent) return
          var shown = installEvent
          installEvent = null
          shown.prompt()
          shown.userChoice.then(hideInstall)
        })
      })
      window.addEventListener('appinstalled', hideInstall)
      if (navigator.standalone === false) reveal('.install, .install-ios')
    }`

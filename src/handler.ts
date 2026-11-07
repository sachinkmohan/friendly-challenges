import type { IncomingMessage, ServerResponse } from 'node:http'

type App = (req: IncomingMessage, res: ServerResponse) => Promise<void>

let opening: Promise<App> | undefined

export function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return serveRequest(req, res).catch((error: unknown) => {
    console.error(error)
    if (res.headersSent) return
    const message = error instanceof Error ? error.message : 'The page could not be opened.'
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(message)
  })
}

async function serveRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await openOnce()
  await app(req, res)
}

function openOnce() {
  opening ??= openApp().catch((error: unknown) => {
    opening = undefined
    throw error
  })
  return opening
}

async function openApp(): Promise<App> {
  const { openDatabase } = await import('./db.ts')
  const { loadSample } = await import('./sample.ts')
  const { createApp } = await import('./app.ts')
  const db = openDatabase()
  await loadSample(db)
  const port = process.env.PORT ?? '3000'
  const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`
  console.log(`Friendly challenges at ${origin}`)
  return createApp({
    db,
    config: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
  })
}

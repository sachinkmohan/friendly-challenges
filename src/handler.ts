import type { IncomingMessage, ServerResponse } from 'node:http'

const dataDir = process.env.DATA_DIR ?? './data'

let opening: Promise<(req: IncomingMessage, res: ServerResponse) => Promise<void>> | undefined

export function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return serveRequest(req, res).catch((error: unknown) => {
    console.error(error)
    if (res.headersSent) return
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('The page could not be opened.')
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

async function openApp() {
  const { createApp } = await import('./app.ts')
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? ''
  const db =
    databaseUrl !== ''
      ? (await import('./hosted-db.ts')).openPostgres(databaseUrl)
      : process.env.USE_EMBEDDED_DB === '1'
        ? await openLocal()
        : await missingDatabase()
  const port = process.env.PORT ?? '3000'
  const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`
  console.log(`Friendly challenges at ${origin}`)
  console.log(`Google redirect URI: ${origin}/auth/google/callback`)
  return createApp({
    db,
    config: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
  })
}

async function missingDatabase(): Promise<never> {
  throw new Error('The database is not configured.')
}

async function openLocal() {
  const { loadSample, openDatabase } = await import('./db.ts')
  const db = await openDatabase(dataDir)
  await loadSample(db)
  return db
}

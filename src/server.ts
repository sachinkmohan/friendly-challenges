import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createApp } from './app.ts'
import { loadSample, openDatabase } from './db.ts'

const port = Number(process.env.PORT ?? 3000)
const dataDir = process.env.DATA_DIR ?? './data'

const opening = openApp()
void opening.catch((error: unknown) => {
  console.error(error)
})

const server = createServer((req, res) => {
  void serve(req, res)
})

server.listen(port, () => {
  const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`
  console.log(`Friendly challenges at ${origin}`)
  console.log(`Google redirect URI: ${origin}/auth/google/callback`)
})

async function openApp() {
  const db = await openDatabase(dataDir)
  if ((process.env.DATABASE_URL?.trim() ?? '') === '') await loadSample(db)
  return createApp({
    db,
    config: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
  })
}

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = await opening
    await app(req, res)
  } catch (error) {
    console.error(error)
    if (res.headersSent) return
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('The page could not be opened.')
  }
}

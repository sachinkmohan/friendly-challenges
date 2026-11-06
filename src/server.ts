import { createServer } from 'node:http'
import { createApp } from './app.ts'
import { openDatabase } from './db.ts'

const port = Number(process.env.PORT ?? 3000)
const dataDir = process.env.DATA_DIR ?? './data'
const db = await openDatabase(dataDir)
const app = createApp({
  db,
  config: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  },
})

const server = createServer((req, res) => {
  void app(req, res)
})

server.listen(port, '127.0.0.1', () => {
  const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`
  console.log(`Friendly challenges at ${origin}`)
  console.log(`Google redirect URI: ${origin}/auth/google/callback`)
})

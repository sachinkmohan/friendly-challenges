import { createServer } from 'node:http'
import { createApp } from './app.ts'
import { firebaseWebConfig, openDatabase } from './db.ts'
import { loadSample } from './sample.ts'

const parsedPort = Number(process.env.PORT)
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000
const db = openDatabase()
await loadSample(db)
const app = createApp({
  db,
  firebase: firebaseWebConfig(db),
})

const server = createServer((req, res) => {
  void app(req, res).catch((error: unknown) => {
    console.error(error)
    if (res.headersSent) return
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('The page could not be opened.')
  })
})
server.on('error', (error) => {
  console.error(error)
})
server.listen(port)

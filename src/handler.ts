import type { IncomingMessage, ServerResponse } from 'node:http'
import { timeDatabase, timeRequest, timeStep } from './timing.ts'

type App = (req: IncomingMessage, res: ServerResponse) => Promise<void>

let opening: Promise<App> | undefined

export function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return timeRequest(req, res, () =>
    serveRequest(req, res).catch((error: unknown) => {
      console.error(error)
      if (res.headersSent) return
      const message = error instanceof Error ? error.message : 'The page could not be opened.'
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(message)
    }),
  )
}

async function serveRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await timeStep('open', openOnce)
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
  const [{ firebaseWebConfig, openDatabase, usesEmulator }, { loadSample }, { createApp }] = await timeStep(
    'open.import',
    async () => [await import('./db.ts'), await import('./sample.ts'), await import('./app.ts')] as const,
  )
  const db = await timeStep('open.connect', async () => timeDatabase(openDatabase()))
  // The build seeds production (ADR 0007), so only the emulator loads the sample on open.
  if (usesEmulator()) await timeStep('open.sample', () => loadSample(db))
  const port = process.env.PORT ?? '3000'
  const origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`
  console.log(`Friendly challenges at ${origin}`)
  return createApp({
    db,
    firebase: firebaseWebConfig(db),
  })
}

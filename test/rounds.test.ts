import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import { Firestore } from 'firebase-admin/firestore'
import { closeDatabase, openDatabase } from '../src/db.ts'
import { SAMPLE_GROUP_ID } from '../src/sample.ts'
import { createSession } from '../src/sessions.ts'
import { roundsOf, type TimingLine } from '../src/timing.ts'
import { closeServer, person, post } from './support/fixtures.ts'

// The emulator answers in a few milliseconds, so without a fixed delay parallel and sequential RPCs look alike.
const LATENCY_MS = 40
const SAMPLE_ADA = '11111111-1111-4111-8111-111111111111'
const groupPath = `/groups/${SAMPLE_GROUP_ID}`
const project = `demo-test-${crypto.randomUUID()}`
process.env.FIREBASE_PROJECT_ID = project

type Funnel = { request: (...args: unknown[]) => Promise<unknown>; requestStream: (...args: unknown[]) => Promise<unknown> }
const funnel = Firestore.prototype as unknown as Funnel
for (const name of ['request', 'requestStream'] as const) {
  const original = funnel[name]
  funnel[name] = async function (this: unknown, ...args: unknown[]) {
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS))
    return original.apply(this, args)
  }
}
// The app captures the funnel when it opens, so it must load after the delay is in place.
const { serve } = await import('../src/handler.ts')

let server: Server
let base: string
let ada: string
let outsider: string

test.before(async () => {
  const db = openDatabase(project)
  ada = `session=${encodeURIComponent(await createSession(db, SAMPLE_ADA))}`
  outsider = `session=${encodeURIComponent(await createSession(db, (await person(db, 'Lin')).id))}`
  await closeDatabase(db)
  server = createServer((req, res) => {
    void serve(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const warm = await fetch(`${base}${groupPath}`, { headers: { cookie: ada } })
  await warm.text()
})

test.after(async () => {
  await closeServer(server)
})

function capture(t: TestContext): () => TimingLine[] {
  const log = t.mock.method(console, 'log', () => {})
  return () =>
    log.mock.calls.flatMap((call) => {
      const text = call.arguments[0]
      if (typeof text !== 'string' || !text.startsWith('{"event":"request_timing"')) return []
      return [JSON.parse(text) as TimingLine]
    })
}

async function get(path: string, cookie: string | null): Promise<number> {
  const response = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} })
  await response.text()
  return response.status
}

test('rounds counts RPCs that waited on each other, not RPCs that overlapped', () => {
  assert.equal(roundsOf([]), 0)
  assert.equal(roundsOf([{ startMs: 0, ms: 40 }]), 1)
  assert.equal(roundsOf([{ startMs: 0, ms: 40 }, { startMs: 1, ms: 40 }, { startMs: 2, ms: 39 }]), 1)
  assert.equal(roundsOf([{ startMs: 0, ms: 40 }, { startMs: 39, ms: 40 }, { startMs: 80, ms: 5 }]), 3)
  assert.equal(roundsOf([{ startMs: 0, ms: 40 }, { startMs: 0, ms: 10 }, { startMs: 12, ms: 10 }, { startMs: 41, ms: 3 }]), 3)
  assert.equal(roundsOf([{ startMs: 50, ms: 5 }, { startMs: 0, ms: 40 }]), 2)
  assert.equal(roundsOf([{ startMs: 0, ms: null }, { startMs: 100, ms: 5 }]), 1)
})

test('logging a day waits on at most four rounds, and the page it lands on on two', async (t) => {
  const lines = capture(t)
  const posted = await post(base, `${groupPath}/check-in`, ada, 'day=2026-10-03&color=green')
  await posted.text()
  assert.equal(posted.status, 303)
  assert.equal(await get(posted.headers.get('location') ?? groupPath, ada), 200)
  const [line, page] = lines()
  assert.ok(line && page)
  assert.equal(line.status, 303)
  assert.ok(line.rounds <= 4, `check-in rounds ${line.rounds}`)
  assert.ok(line.rpcs.length <= 4, `check-in rpcs ${line.rpcs.length}`)
  assert.ok(line.rpcs.some((rpc) => rpc.name === 'commit' && rpc.tx), 'commit runs in the transaction')
  assert.equal(page.status, 200)
  assert.ok(page.rounds <= 2, `group page rounds ${page.rounds}`)
  assert.ok(page.rpcs.length <= 5, `group page rpcs ${page.rpcs.length}`)
})

test('a signed-out group page reads in one round and an outsider page in two', async (t) => {
  const lines = capture(t)
  assert.equal(await get(groupPath, null), 200)
  assert.equal(await get(groupPath, outsider), 200)
  const [signedOut, other] = lines()
  assert.ok(signedOut && other)
  assert.equal(signedOut.rounds, 1)
  assert.ok(other.rounds <= 2, `outsider rounds ${other.rounds}`)
})

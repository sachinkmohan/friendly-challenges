import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import { closeDatabase, openDatabase } from '../src/db.ts'
import { serve } from '../src/handler.ts'
import { SAMPLE_GROUP_ID } from '../src/sample.ts'
import { createSession } from '../src/sessions.ts'
import { timeRequest, type TimingLine } from '../src/timing.ts'
import { closeServer, post } from './support/fixtures.ts'

const SAMPLE_ADA = '11111111-1111-4111-8111-111111111111'
const groupPath = `/groups/${SAMPLE_GROUP_ID}`
const project = `demo-test-${crypto.randomUUID()}`
process.env.FIREBASE_PROJECT_ID = project

let server: Server
let base: string
let cookie: string

test.before(async () => {
  const db = openDatabase(project)
  cookie = `session=${encodeURIComponent(await createSession(db, SAMPLE_ADA))}`
  await closeDatabase(db)
  server = createServer((req, res) => {
    void serve(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.after(async () => {
  await closeServer(server)
})

function capture(t: TestContext): () => TimingLine[] {
  const log = t.mock.method(console, 'log')
  return () =>
    log.mock.calls.flatMap((call) => {
      const text = call.arguments[0]
      if (typeof text !== 'string' || !text.startsWith('{')) return []
      const line = JSON.parse(text) as TimingLine
      return line.event === 'request_timing' ? [line] : []
    })
}

async function get(path: string): Promise<number> {
  const response = await fetch(`${base}${path}`, { headers: { cookie } })
  await response.text()
  return response.status
}

function assertConsistent(line: TimingLine): void {
  assert.ok(line.dbMs <= line.totalMs, `dbMs ${line.dbMs} within totalMs ${line.totalMs}`)
  for (const rpc of line.rpcs) {
    assert.ok(rpc.ms !== null && rpc.startMs + rpc.ms <= line.totalMs + 1, `${rpc.name} ends within the request`)
  }
}

test('a cold and a warm group page each write one line from the same instance', async (t) => {
  const lines = capture(t)
  assert.equal(await get(groupPath), 200)
  assert.equal(await get(`${groupPath}?from=home`), 200)
  const [cold, warm] = lines()
  assert.equal(lines().length, 2)
  assert.ok(cold && warm)

  assert.equal(cold.cold, true)
  assert.equal(cold.instance.served, 1)
  assert.equal(cold.instance.idleMs, null)
  assert.ok(cold.steps.some((step) => step.name === 'open.sample'), 'cold request opens the sample')

  assert.equal(warm.cold, false)
  assert.equal(warm.instance.id, cold.instance.id)
  assert.equal(warm.instance.served, 2)
  assert.notEqual(warm.instance.idleMs, null)

  for (const line of [cold, warm]) {
    assert.equal(line.method, 'GET')
    assert.equal(line.route, '/groups/:id')
    assert.equal(line.status, 200)
    assert.ok(line.rpcs.length > 0, 'the Firestore funnel is still hooked')
    assertConsistent(line)
  }
})

test('a check-in line shows the session step and the transactional commit', async (t) => {
  const lines = capture(t)
  const response = await post(base, `${groupPath}/check-in`, cookie, 'day=2026-10-03&color=green')
  await response.text()
  const [line] = lines()
  assert.equal(lines().length, 1)
  assert.ok(line)
  assert.equal(line.method, 'POST')
  assert.equal(line.route, '/groups/:id/check-in')
  assert.equal(line.status, response.status)
  assert.ok(line.steps.some((step) => step.name === 'session'), 'session lookup is a step')
  assert.equal(line.status, 303)
  assert.ok(line.rpcs.some((rpc) => rpc.name === 'commit' && rpc.tx), 'commit runs in the transaction')
  assertConsistent(line)
})

test('concurrent requests keep their own RPCs', async (t) => {
  const lines = capture(t)
  await get(groupPath)
  const [sequential] = lines()
  assert.ok(sequential)
  await Promise.all([get(groupPath), get(groupPath)])
  const concurrent = lines().slice(1)
  assert.equal(concurrent.length, 2)
  for (const line of concurrent) {
    assert.equal(line.rpcs.length, sequential.rpcs.length)
    assertConsistent(line)
  }
})

test('a failing request still writes its line and rethrows the same error', async (t) => {
  const lines = capture(t)
  const failure = new Error('boom')
  const req = { method: 'GET', url: '/boom?x=1', headers: { 'x-nf-request-id': 'req-1' } } as unknown as IncomingMessage
  const res = { statusCode: 500 } as ServerResponse
  await assert.rejects(
    timeRequest(req, res, async () => {
      throw failure
    }),
    (error) => error === failure,
  )
  const [line] = lines()
  assert.equal(lines().length, 1)
  assert.equal(line?.requestId, 'req-1')
  assert.equal(line?.route, '/boom')
  assert.equal(line?.status, 500)
})

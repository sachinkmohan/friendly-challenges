// Times one logged day (check-in POST, then the redirect GET) through the real `serve`, against the emulator.
// Every Firestore RPC is delayed by LATENCY_MS to stand in for the production round trip.
// Run: npx firebase emulators:exec --only firestore --project demo-friendly-challenges \
//        "node --experimental-strip-types scripts/bench-log-day.ts"
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Firestore } from 'firebase-admin/firestore'
import type { TimingLine } from '../src/timing.ts'

const LATENCY_MS = Number(process.env.LATENCY_MS ?? '170')
const RUNS = Number(process.env.RUNS ?? '7')
const ADA = '11111111-1111-4111-8111-111111111111'
const GROUP = '44444444-4444-4444-8444-444444444444'
const DAY = '2026-10-03'

process.env.FIREBASE_PROJECT_ID = `demo-bench-${crypto.randomUUID()}`

type Funnel = { request: (...args: unknown[]) => Promise<unknown>; requestStream: (...args: unknown[]) => Promise<unknown> }
const funnel = Firestore.prototype as unknown as Funnel
const pause = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS))
for (const name of ['request', 'requestStream'] as const) {
  const original = funnel[name]
  funnel[name] = async function (this: unknown, ...args: unknown[]) {
    await pause()
    return original.apply(this, args)
  }
}

const lines: TimingLine[] = []
const log = console.log
console.log = (...args: unknown[]) => {
  const text = typeof args[0] === 'string' ? args[0] : ''
  if (text.startsWith('{"event":"request_timing"')) lines.push(JSON.parse(text) as TimingLine)
}

const { serve } = await import('../src/handler.ts')
const { openDatabase } = await import('../src/db.ts')
const { createSession } = await import('../src/sessions.ts')
const { checkInRef, parseCheckIn } = await import('../src/store.ts')

const server = createServer((req, res) => void serve(req, res))
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const page = `${base}/groups/${GROUP}`

const warmup = await fetch(page)
await warmup.text()
const db = openDatabase()
const cookie = `session=${encodeURIComponent(await createSession(db, ADA))}`

type Run = { postMs: number; getMs: number; tapMs: number; postRpcs: number; getRpcs: number; postStatus: number; getStatus: number }
const runs: Run[] = []
for (let i = 0; i < RUNS; i += 1) {
  const color = i % 2 === 0 ? 'red' : 'green'
  const before = lines.length
  const started = performance.now()
  const posted = await fetch(`${page}/check-in`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ day: DAY, color }),
  })
  await posted.text()
  const shown = await fetch(new URL(posted.headers.get('location') ?? page, base), { headers: { cookie } })
  await shown.text()
  const tapMs = performance.now() - started
  const stored = parseCheckIn((await checkInRef(db, GROUP, ADA, DAY).get()).data())
  if (stored.color !== color) throw new Error(`run ${i}: stored ${stored.color}, expected ${color}`)
  const [post, get] = lines.slice(before)
  if (!post || !get) throw new Error(`run ${i}: expected two request_timing lines, got ${lines.length - before}`)
  runs.push({ postMs: post.totalMs, getMs: get.totalMs, tapMs: Math.round(tapMs), postRpcs: post.rpcs.length, getRpcs: get.rpcs.length, postStatus: posted.status, getStatus: shown.status })
}

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted[sorted.length - 1] }
}
const errors = runs.filter((run) => run.postStatus !== 303 || run.getStatus !== 200).length
log(JSON.stringify({
  latencyMs: LATENCY_MS,
  runs: RUNS,
  errors,
  rpcs: { post: stats(runs.map((r) => r.postRpcs)), get: stats(runs.map((r) => r.getRpcs)) },
  ms: { post: stats(runs.map((r) => r.postMs)), get: stats(runs.map((r) => r.getMs)), tap: stats(runs.map((r) => r.tapMs)) },
}))
server.close()
process.exit(errors === 0 ? 0 : 1)

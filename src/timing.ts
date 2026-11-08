import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { finished, type Stream } from 'node:stream'
import type { Database } from './db.ts'

export type TimingLine = {
  readonly event: 'request_timing'
  readonly at: string
  readonly requestId: string | null
  readonly method: string
  readonly route: string
  readonly status: number
  readonly cold: boolean
  readonly instance: {
    readonly id: string
    readonly served: number
    readonly bootMs: number
    readonly ageMs: number
    readonly idleMs: number | null
  }
  readonly totalMs: number
  readonly dbMs: number
  readonly cpuMs: number
  readonly steps: readonly { readonly name: string; readonly startMs: number; readonly ms: number }[]
  readonly rounds: number
  readonly rpcs: readonly {
    readonly name: string
    readonly step: string
    readonly startMs: number
    readonly ms: number | null
    readonly tx: boolean
  }[]
}

type Rpc = { name: string; step: string; start: number; end: number | null; tx: boolean }
type Trace = { start: number; steps: { name: string; start: number; end: number }[]; rpcs: Rpc[] }
type Frame = { readonly trace: Trace; readonly step: string }

// Measured from process start, so Lambda init before our first module shows up in the line.
const bootMs = performance.now()
const instanceId = randomBytes(4).toString('hex')
const frames = new AsyncLocalStorage<Frame>()
let served = 0
let lastEnd: number | null = null

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function routeOf(url: string | undefined): string {
  const path = (url ?? '/').split('?')[0] ?? '/'
  return path
    .split('/')
    .map((segment) => (UUID.test(segment) ? ':id' : segment))
    .join('/')
}

function headerText(value: string | string[] | undefined): string | null {
  const text = Array.isArray(value) ? value[0] : value
  return text ?? null
}

// Parallel RPCs overlap, so summing their durations would overstate database time.
function unionMs(intervals: readonly (readonly [number, number])[]): number {
  let total = 0
  let reach = -Infinity
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (end <= reach) continue
    total += end - Math.max(start, reach)
    reach = end
  }
  return total
}

// The longest chain of RPCs where each started after the one before it ended: the round trips a request waited on in a row.
// Times are rounded to whole milliseconds, so a start up to 1 ms before the previous end still counts as after it.
export function roundsOf(rpcs: readonly { readonly startMs: number; readonly ms: number | null }[]): number {
  const sorted = [...rpcs].sort((a, b) => a.startMs - b.startMs)
  const depths: number[] = []
  for (const [i, rpc] of sorted.entries()) {
    let depth = 1
    for (const [j, before] of sorted.slice(0, i).entries()) {
      if (before.ms !== null && rpc.startMs >= before.startMs + before.ms - 1) depth = Math.max(depth, depths[j]! + 1)
    }
    depths.push(depth)
  }
  return Math.max(0, ...depths)
}

function lineFor(req: IncomingMessage, res: ServerResponse, trace: Trace, at: string, number: number, idleMs: number | null, cpu: NodeJS.CpuUsage): TimingLine {
  const now = performance.now()
  const offset = (time: number) => Math.round(time - trace.start)
  const cpuUsed = process.cpuUsage(cpu)
  const rpcs = trace.rpcs.map((rpc) => ({
    name: rpc.name,
    step: rpc.step,
    startMs: offset(rpc.start),
    ms: rpc.end === null ? null : Math.round(rpc.end - rpc.start),
    tx: rpc.tx,
  }))
  return {
    event: 'request_timing',
    at,
    requestId: headerText(req.headers['x-nf-request-id']),
    method: req.method ?? 'GET',
    route: routeOf(req.url),
    status: res.statusCode,
    cold: number === 1,
    instance: {
      id: instanceId,
      served: number,
      bootMs: Math.round(bootMs),
      ageMs: Math.round(trace.start),
      idleMs: idleMs === null ? null : Math.round(idleMs),
    },
    totalMs: offset(now),
    dbMs: Math.round(unionMs(trace.rpcs.map((rpc) => [rpc.start, rpc.end ?? now]))),
    cpuMs: Math.round((cpuUsed.user + cpuUsed.system) / 1000),
    steps: trace.steps.map((step) => ({ name: step.name, startMs: offset(step.start), ms: Math.round(step.end - step.start) })),
    rounds: roundsOf(rpcs),
    rpcs,
  }
}

export async function timeRequest(req: IncomingMessage, res: ServerResponse, run: () => Promise<void>): Promise<void> {
  served += 1
  const number = served
  const at = new Date().toISOString()
  const cpu = process.cpuUsage()
  const trace: Trace = { start: performance.now(), steps: [], rpcs: [] }
  const idleMs = lastEnd === null ? null : trace.start - lastEnd
  try {
    await frames.run({ trace, step: 'route' }, run)
  } finally {
    try {
      console.log(JSON.stringify(lineFor(req, res, trace, at, number, idleMs, cpu)))
    } catch (error) {
      console.error('request_timing could not be written', error)
    }
    lastEnd = performance.now()
  }
}

export async function timeStep<T>(name: string, run: () => Promise<T>): Promise<T> {
  const frame = frames.getStore()
  if (!frame) return run()
  const start = performance.now()
  try {
    return await frames.run({ trace: frame.trace, step: name }, run)
  } finally {
    frame.trace.steps.push({ name, start, end: performance.now() })
  }
}

type Body = { transaction?: unknown; newTransaction?: unknown } | undefined
type Funnel = {
  request?: (method: string, body: Body, ...rest: unknown[]) => Promise<unknown>
  requestStream?: (method: string, bidirectional: boolean, body: Body, ...rest: unknown[]) => Promise<Stream>
}

const timed = new WeakSet<Database>()

function startRpc(name: string, body: Body): () => void {
  const frame = frames.getStore()
  if (!frame) return () => {}
  const rpc: Rpc = { name, step: frame.step, start: performance.now(), end: null, tx: Boolean(body?.transaction ?? body?.newTransaction) }
  frame.trace.rpcs.push(rpc)
  return () => {
    rpc.end ??= performance.now()
  }
}

// request and requestStream are Firestore's private funnel for every RPC, so one hook sees reads, queries and commits inside transactions too.
export function timeDatabase(db: Database): Database {
  const funnel = db as unknown as Funnel
  const { request, requestStream } = funnel
  if (timed.has(db) || typeof request !== 'function' || typeof requestStream !== 'function') return db
  timed.add(db)
  funnel.request = function (this: unknown, method, body, ...rest) {
    const done = startRpc(method, body)
    return request.call(this, method, body, ...rest).finally(done)
  }
  funnel.requestStream = function (this: unknown, method, bidirectional, body, ...rest) {
    const done = startRpc(method, body)
    return requestStream.call(this, method, bidirectional, body, ...rest).then(
      (stream) => {
        // Resolves once the stream exists; the RPC lasts until the caller has read it. A data listener here would drop documents.
        finished(stream, done)
        return stream
      },
      (error: unknown) => {
        done()
        throw error
      },
    )
  }
  return db
}

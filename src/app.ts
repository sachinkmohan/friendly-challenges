import type { IncomingMessage, ServerResponse } from 'node:http'
import { authFor, type Database } from './db.ts'
import { upsertAccount } from './accounts.ts'
import { readLedger, recordPayment, type PaymentFailure, type PaymentInput } from './balances.ts'
import { clearCookie, readCookie, writeCookie } from './cookies.ts'
import {
  readChallengeHeadline,
  readMemberChallenge,
  saveChallenge,
  saveRhythm,
  startChallenge,
  type ChallengeFailure,
  type ChallengeInput,
  type RhythmInput,
  type StartInput,
} from './challenge.ts'
import { listHeatmaps, utcToday } from './calendar.ts'
import type { IsoDate } from './challenge.ts'
import { listCheckIns, logCheckIn, type CheckInInput } from './checkins.ts'
import { recordDropout, type DropoutFailure, type DropoutInput } from './dropouts.ts'
import { createGroup, joinGroup, listHomeGroups, viewGroup, type GroupId } from './groups.ts'
import { googleIdentity, type Account, type AuthFailure, type FirebaseWebConfig, type IdToken, type Viewer } from './identity.ts'
import {
  groupHref,
  matchGroupPath,
  renderFailure,
  renderGroup,
  renderHome,
  renderMessage,
  renderNewGroup,
  safeReturnPath,
  type ChallengeAttempt,
  type GroupRoute,
} from './page.ts'
import { accountForSession, createSession, deleteSession } from './sessions.ts'

const SESSION_COOKIE = 'session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 30
const FORM_LIMIT_BYTES = 4096

export type AppDeps = {
  db: Database
  firebase: FirebaseWebConfig | null
  verifyIdToken?: (token: string) => Promise<IdToken>
  today?: () => IsoDate
}

function requestOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? 'localhost'
  const forwarded = req.headers['x-forwarded-proto']
  const header = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  const encrypted = Boolean((req.socket as { encrypted?: boolean }).encrypted)
  const proto = header === 'https' || header === 'http' ? header : encrypted ? 'https' : 'http'
  return `${proto}://${host}`
}

function sendHtml(res: ServerResponse, status: number, body: string, cookies: string[] = []): void {
  const headers: Record<string, string | string[] | number> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  }
  if (cookies.length > 0) headers['Set-Cookie'] = cookies
  res.writeHead(status, headers)
  res.end(body)
}

function sendRedirect(res: ServerResponse, location: string, cookies: string[] = [], status = 302): void {
  const headers: Record<string, string | string[]> = { Location: location }
  if (cookies.length > 0) headers['Set-Cookie'] = cookies
  res.writeHead(status, headers)
  res.end()
}

async function viewerFrom(req: IncomingMessage, deps: AppDeps): Promise<Viewer> {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE)
  const account = await accountForSession(deps.db, token)
  if (!account) return { state: 'signed_out', firebase: deps.firebase }
  return { state: 'signed_in', account }
}

function today(deps: AppDeps): IsoDate {
  return (deps.today ?? utcToday)()
}

export function createApp(deps: AppDeps) {
  const verifyIdToken = deps.verifyIdToken ?? ((token: string) => authFor(deps.db).verifyIdToken(token))
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = requestOrigin(req)
    const url = new URL(req.url ?? '/', `${origin}/`)
    const path = url.pathname
    const method = req.method ?? 'GET'

    try {
      if (method === 'GET' && path === '/') {
        const viewer = await viewerFrom(req, deps)
        const home =
          viewer.state === 'signed_out'
            ? renderHome(viewer)
            : renderHome({
                state: 'signed_in',
                account: viewer.account,
                groups: await listHomeGroups(deps.db, viewer.account),
                heatmaps: await listHeatmaps(deps.db, viewer.account, today(deps)),
              })
        sendHtml(res, 200, home)
        return
      }

      const groupRoute = matchGroupPath(path)
      if (groupRoute) {
        await handleGroup(req, res, method, origin, groupRoute, deps)
        return
      }

      if (path === '/auth/firebase') {
        if (method !== 'POST') return rejectMethod(res, 'POST')
        const sentFrom = req.headers.origin
        if (sentFrom !== undefined && sentFrom !== origin) {
          req.resume()
          sendHtml(res, 403, renderFailure('cross_origin'))
          return
        }
        const form = await readForm(req)
        if (!(form instanceof URLSearchParams)) return rejectForm(res, form)
        const signIn = await signInWithIdToken(deps.db, verifyIdToken, form.get('idToken') ?? '')
        if (!signIn.ok) {
          sendHtml(res, 400, renderFailure(signIn.failure))
          return
        }
        sendRedirect(res, safeReturnPath(form.get('return')), [writeCookie(SESSION_COOKIE, signIn.token, SESSION_MAX_AGE)], 303)
        return
      }

      if (method === 'POST' && path === '/logout') {
        await deleteSession(deps.db, readCookie(req.headers.cookie, SESSION_COOKIE))
        sendRedirect(res, '/', [clearCookie(SESSION_COOKIE)])
        return
      }

      if (path === '/logout') {
        res.writeHead(405, { Allow: 'POST' })
        res.end()
        return
      }

      sendHtml(res, 404, renderMessage('Not found', 'That page does not exist.'))
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'request failed')
      sendHtml(res, 500, renderMessage('Something went wrong', 'Try that again.'))
    }
  }
}

function rejectMethod(res: ServerResponse, allow: string): void {
  res.writeHead(405, { Allow: allow })
  res.end()
}

async function handleGroup(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  origin: string,
  route: GroupRoute,
  deps: AppDeps,
): Promise<void> {
  const viewer = await viewerFrom(req, deps)
  if (route.kind === 'new') {
    if (method !== 'GET') return rejectMethod(res, 'GET')
    sendHtml(res, 200, renderNewGroup(viewer))
    return
  }
  if (route.kind === 'create') {
    if (method !== 'POST') return rejectMethod(res, 'POST')
    if (viewer.state === 'signed_out') {
      req.resume()
      sendHtml(res, 401, renderNewGroup(viewer))
      return
    }
    const form = await readForm(req)
    if (!(form instanceof URLSearchParams)) return rejectForm(res, form)
    const created = await createGroup(deps.db, viewer.account, form.get('name') ?? '')
    if (!created.ok) {
      sendHtml(res, 400, renderNewGroup(viewer, created.failure))
      return
    }
    sendRedirect(res, groupHref(created.groupId), [], 303)
    return
  }
  if (route.kind === 'show') {
    if (method !== 'GET') return rejectMethod(res, 'GET')
    if (viewer.state === 'signed_out') {
      await sendGroupPage(res, 200, null, route.groupId, origin, deps)
      return
    }
    await sendMemberPage(res, 200, viewer.account, route.groupId, origin, deps)
    return
  }
  if (route.kind === 'save_challenge' || route.kind === 'start_challenge' || route.kind === 'save_rhythm') {
    await postChallenge(req, res, method, origin, route, viewer, deps)
    return
  }
  if (route.kind === 'log_check_in') {
    await postCheckIn(req, res, method, origin, route.groupId, viewer, deps)
    return
  }
  if (route.kind === 'record_payment') {
    await postPayment(req, res, method, origin, route.groupId, viewer, deps)
    return
  }
  if (route.kind === 'record_dropout') {
    await postDropout(req, res, method, origin, route.groupId, viewer, deps)
    return
  }
  if (method !== 'POST') return rejectMethod(res, 'POST')
  if (viewer.state === 'signed_out') {
    const view = await viewGroup(deps.db, null, route.groupId)
    if (view.kind === 'missing') {
      sendHtml(res, 404, renderMessage('Not found', 'That page does not exist.'))
      return
    }
    await sendGroupPage(res, view.kind === 'full' || view.kind === 'solo' ? 409 : 401, null, route.groupId, origin, deps)
    return
  }
  const joined = await joinGroup(deps.db, viewer.account, route.groupId)
  if (joined.ok) {
    sendRedirect(res, groupHref(joined.groupId), [], 303)
    return
  }
  if (joined.failure === 'group_missing') {
    sendHtml(res, 404, renderMessage('Not found', 'That page does not exist.'))
    return
  }
  await sendGroupPage(res, 409, viewer.account, route.groupId, origin, deps)
}

type ChallengeRoute = Extract<GroupRoute, { kind: 'save_challenge' | 'start_challenge' | 'save_rhythm' }>

function challengeStatus(failure: ChallengeFailure): number {
  if (failure === 'not_member') return 403
  if (failure === 'group_missing') return 404
  if (
    failure === 'frozen' ||
    failure === 'no_challenge' ||
    failure === 'outside_headcount' ||
    failure === 'cause_for_group' ||
    failure === 'rhythm_past_end'
  ) {
    return 409
  }
  return 400
}

function notFound(res: ServerResponse): void {
  sendHtml(res, 404, renderMessage('Not found', 'That page does not exist.'))
}

async function sendGroupPage(
  res: ServerResponse,
  status: number,
  account: Account | null,
  groupId: GroupId,
  origin: string,
  deps: AppDeps,
  attempt?: ChallengeAttempt,
): Promise<void> {
  const view = await viewGroup(deps.db, account, groupId)
  if (view.kind === 'missing') {
    notFound(res)
    return
  }
  if (view.kind === 'members') {
    if (!account) {
      notFound(res)
      return
    }
    await sendMemberPage(res, status, account, groupId, origin, deps, attempt)
    return
  }
  const headline = await readChallengeHeadline(deps.db, groupId)
  const viewer: Viewer = account ? { state: 'signed_in', account } : { state: 'signed_out', firebase: deps.firebase }
  sendHtml(res, status, renderGroup({ ...view, headline }, viewer, origin, attempt))
}

async function sendMemberPage(
  res: ServerResponse,
  status: number,
  account: Account,
  groupId: GroupId,
  origin: string,
  deps: AppDeps,
  attempt?: ChallengeAttempt,
): Promise<void> {
  const viewer: Viewer = { state: 'signed_in', account }
  const view = await viewGroup(deps.db, account, groupId)
  if (view.kind === 'missing') {
    notFound(res)
    return
  }
  if (view.kind !== 'members') {
    const headline = await readChallengeHeadline(deps.db, groupId)
    sendHtml(res, status, renderGroup({ ...view, headline }, viewer, origin, attempt))
    return
  }
  const loaded = await readMemberChallenge(deps.db, account, groupId)
  if (!loaded.ok) {
    const again = await viewGroup(deps.db, account, groupId)
    if (again.kind === 'missing') {
      notFound(res)
      return
    }
    if (again.kind !== 'members') {
      const headline = await readChallengeHeadline(deps.db, groupId)
      sendHtml(res, status, renderGroup({ ...again, headline }, viewer, origin, attempt))
      return
    }
    sendHtml(res, 500, renderMessage('Something went wrong', 'Try that again.'))
    return
  }
  const card = loaded.card
  const checkIns = card.phase === 'active' ? await listCheckIns(deps.db, groupId) : []
  const ledger = card.phase === 'active' ? await readLedger(deps.db, groupId, today(deps)) : null
  sendHtml(res, status, renderGroup({ ...view, challenge: card, checkIns, ledger }, viewer, origin, attempt))
}

async function finishChallenge(
  res: ServerResponse,
  origin: string,
  groupId: GroupId,
  account: Account,
  deps: AppDeps,
  result: { ok: true } | { ok: false; failure: ChallengeFailure },
  drafts: Pick<ChallengeAttempt, 'draft' | 'rhythmDraft' | 'causeDraft'> = {},
  slot: 'failure' | 'startFailure' = 'failure',
): Promise<void> {
  if (result.ok) {
    sendRedirect(res, groupHref(groupId), [], 303)
    return
  }
  if (result.failure === 'group_missing') {
    notFound(res)
    return
  }
  const status = challengeStatus(result.failure)
  const failure: ChallengeAttempt = { [slot]: result.failure }
  const attempt: ChallengeAttempt = status === 409 ? failure : { ...failure, ...drafts }
  if (result.failure === 'not_member') {
    await sendGroupPage(res, status, account, groupId, origin, deps, attempt)
    return
  }
  await sendMemberPage(res, status, account, groupId, origin, deps, attempt)
}

async function postChallenge(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  origin: string,
  route: ChallengeRoute,
  viewer: Viewer,
  deps: AppDeps,
): Promise<void> {
  if (method !== 'POST') return rejectMethod(res, 'POST')
  if (viewer.state === 'signed_out') {
    req.resume()
    await sendGroupPage(res, 401, null, route.groupId, origin, deps)
    return
  }
  const form = await readForm(req)
  if (!(form instanceof URLSearchParams)) return rejectForm(res, form)
  if (route.kind === 'start_challenge') {
    const input: StartInput = { cause: form.get('cause') ?? '' }
    const started = await startChallenge(deps.db, viewer.account, route.groupId, input)
    await finishChallenge(res, origin, route.groupId, viewer.account, deps, started, { causeDraft: input.cause }, 'startFailure')
    return
  }
  if (route.kind === 'save_challenge') {
    const input: ChallengeInput = {
      name: form.get('name') ?? '',
      type: form.get('type') ?? '',
      customLabel: form.get('custom_label') ?? '',
      currency: form.get('currency') ?? '',
      stake: form.get('stake') ?? '',
      startsOn: form.get('starts_on') ?? '',
      endsOn: form.get('ends_on') ?? '',
    }
    const saved = await saveChallenge(deps.db, viewer.account, route.groupId, input)
    await finishChallenge(res, origin, route.groupId, viewer.account, deps, saved, { draft: input })
    return
  }
  const rhythm: RhythmInput = {
    interval: form.get('interval') ?? '',
    anchorOn: form.get('anchor_on') ?? '',
  }
  const saved = await saveRhythm(deps.db, viewer.account, route.groupId, rhythm)
  await finishChallenge(res, origin, route.groupId, viewer.account, deps, saved, { rhythmDraft: rhythm })
}

async function postCheckIn(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  origin: string,
  groupId: GroupId,
  viewer: Viewer,
  deps: AppDeps,
): Promise<void> {
  if (method !== 'POST') return rejectMethod(res, 'POST')
  if (viewer.state === 'signed_out') {
    req.resume()
    await sendGroupPage(res, 401, null, groupId, origin, deps)
    return
  }
  const form = await readForm(req)
  if (!(form instanceof URLSearchParams)) return rejectForm(res, form)
  const input: CheckInInput = { day: form.get('day') ?? '', color: form.get('color') ?? '' }
  const logged = await logCheckIn(deps.db, viewer.account, groupId, input)
  if (logged.ok) {
    sendRedirect(res, groupHref(groupId), [], 303)
    return
  }
  if (logged.failure === 'group_missing') {
    notFound(res)
    return
  }
  if (logged.failure === 'not_member') {
    await sendGroupPage(res, 403, viewer.account, groupId, origin, deps, { checkInFailure: logged.failure })
    return
  }
  await sendMemberPage(res, 400, viewer.account, groupId, origin, deps, {
    checkInFailure: logged.failure,
    checkInDay: input.day,
  })
}

function paymentStatus(failure: PaymentFailure): number {
  if (failure === 'not_member') return 403
  if (failure === 'not_active') return 409
  return 400
}

async function postPayment(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  origin: string,
  groupId: GroupId,
  viewer: Viewer,
  deps: AppDeps,
): Promise<void> {
  if (method !== 'POST') return rejectMethod(res, 'POST')
  if (viewer.state === 'signed_out') {
    req.resume()
    await sendGroupPage(res, 401, null, groupId, origin, deps)
    return
  }
  const form = await readForm(req)
  if (!(form instanceof URLSearchParams)) return rejectForm(res, form)
  const input: PaymentInput = {
    payeeId: form.get('payee') ?? '',
    amount: form.get('amount') ?? '',
    paidOn: form.get('paid_on') ?? '',
    paypalRef: form.get('paypal_ref') ?? '',
  }
  const recorded = await recordPayment(deps.db, viewer.account, groupId, input, today(deps))
  if (recorded.ok) {
    sendRedirect(res, groupHref(groupId), [], 303)
    return
  }
  if (recorded.failure === 'group_missing') {
    notFound(res)
    return
  }
  const attempt: ChallengeAttempt = { paymentFailure: recorded.failure, paymentDraft: input }
  if (recorded.failure === 'not_member') {
    await sendGroupPage(res, 403, viewer.account, groupId, origin, deps, attempt)
    return
  }
  await sendMemberPage(res, paymentStatus(recorded.failure), viewer.account, groupId, origin, deps, attempt)
}

function dropoutStatus(failure: DropoutFailure): number {
  if (failure === 'not_member' || failure === 'not_allowed') return 403
  return 400
}

async function postDropout(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  origin: string,
  groupId: GroupId,
  viewer: Viewer,
  deps: AppDeps,
): Promise<void> {
  if (method !== 'POST') return rejectMethod(res, 'POST')
  if (viewer.state === 'signed_out') {
    req.resume()
    await sendGroupPage(res, 401, null, groupId, origin, deps)
    return
  }
  const form = await readForm(req)
  if (!(form instanceof URLSearchParams)) return rejectForm(res, form)
  const input: DropoutInput = { memberId: form.get('member') ?? '', lastDay: form.get('last_day') ?? '' }
  const recorded = await recordDropout(deps.db, viewer.account, groupId, input, today(deps))
  if (recorded.ok) {
    sendRedirect(res, input.memberId === viewer.account.id ? '/' : groupHref(groupId), [], 303)
    return
  }
  if (recorded.failure === 'group_missing') {
    notFound(res)
    return
  }
  const attempt: ChallengeAttempt = { dropoutFailure: recorded.failure, dropoutDraft: input }
  if (recorded.failure === 'not_member') {
    await sendGroupPage(res, 403, viewer.account, groupId, origin, deps, attempt)
    return
  }
  await sendMemberPage(res, dropoutStatus(recorded.failure), viewer.account, groupId, origin, deps, attempt)
}

function rejectForm(res: ServerResponse, failure: 'too_large' | 'bad_type'): void {
  sendHtml(res, failure === 'too_large' ? 413 : 400, renderMessage('Something went wrong', 'Try that again.'))
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams | 'too_large' | 'bad_type'> {
  const type = req.headers['content-type']
  const media = typeof type === 'string' ? type.split(';')[0]?.trim().toLowerCase() : ''
  if (media !== 'application/x-www-form-urlencoded') return 'bad_type'
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > FORM_LIMIT_BYTES) {
      req.resume()
      return 'too_large'
    }
    chunks.push(buf)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
}

async function signInWithIdToken(
  db: Database,
  verifyIdToken: (token: string) => Promise<IdToken>,
  idToken: string,
): Promise<{ ok: true; token: string } | { ok: false; failure: AuthFailure }> {
  const claims = idToken === '' ? null : await verifyIdToken(idToken).catch(() => null)
  if (!claims) return { ok: false, failure: 'bad_token' }
  const identity = googleIdentity(claims)
  if (!identity) return { ok: false, failure: 'not_google' }
  const saved = await upsertAccount(db, identity)
  if (!saved.ok) return { ok: false, failure: saved.failure }
  return { ok: true, token: await createSession(db, saved.account.id) }
}

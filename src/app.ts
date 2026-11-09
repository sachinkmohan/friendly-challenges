import type { IncomingMessage, ServerResponse } from 'node:http'
import { authFor, type Database } from './db.ts'
import { upsertAccount } from './accounts.ts'
import { recordPayment, type PaymentFailure, type PaymentInput } from './balances.ts'
import { clearCookie, readCookie, writeCookie } from './cookies.ts'
import {
  createChallenge,
  saveChallenge,
  saveRhythm,
  startChallenge,
  type ChallengeFailure,
  type ChallengeInput,
  type CreateChallengeInput,
  type RhythmInput,
} from './challenge.ts'
import { listHeatmaps, utcToday } from './calendar.ts'
import type { IsoDate } from './challenge.ts'
import { logCheckIn, type CheckInInput } from './checkins.ts'
import { recordDropout, type DropoutFailure, type DropoutInput } from './dropouts.ts'
import { deleteGroup, dropGroupName, joinGroup, listHomeGroups, type GroupId } from './groups.ts'
import { loadGroupPage, type GroupPage } from './grouppage.ts'
import { readBrowser } from './browser.ts'
import { googleIdentity, type Account, type AuthFailure, type FirebaseWebConfig, type IdToken, type Viewer } from './identity.ts'
import {
  groupHref,
  matchGroupPath,
  renderFailure,
  renderGroup,
  renderHome,
  renderMessage,
  renderNewChallenge,
  safeReturnPath,
  type ChallengeAttempt,
  type GroupRoute,
} from './page.ts'
import { accountForSession, createSession, deleteSession } from './sessions.ts'
import { checkInToast, takeToast, toastCookie, type Toast, type ToastReceipt } from './toasts.ts'
import { timeStep } from './timing.ts'

const SESSION_COOKIE = 'session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 30
const FORM_LIMIT_BYTES = 4096
const NO_TOAST: ToastReceipt = { text: null, cookies: [] }

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

function sendHtml(res: ServerResponse, status: number, body: string, cookies: readonly string[] = []): void {
  const headers: Record<string, string | string[] | number> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  }
  if (cookies.length > 0) headers['Set-Cookie'] = [...cookies]
  res.writeHead(status, headers)
  res.end(body)
}

function sendRedirect(res: ServerResponse, location: string, cookies: string[] = [], status = 302): void {
  const headers: Record<string, string | string[]> = { Location: location }
  if (cookies.length > 0) headers['Set-Cookie'] = cookies
  res.writeHead(status, headers)
  res.end()
}

function viewerFor(req: IncomingMessage, deps: AppDeps, account: Account | null): Viewer {
  if (!account) {
    return { state: 'signed_out', firebase: deps.firebase, origin: requestOrigin(req), browser: readBrowser(req.headers['user-agent']) }
  }
  return { state: 'signed_in', account }
}

async function viewerFrom(req: IncomingMessage, deps: AppDeps): Promise<Viewer> {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE)
  return viewerFor(req, deps, await timeStep('session', () => accountForSession(deps.db, token)))
}

function today(deps: AppDeps): IsoDate {
  return (deps.today ?? utcToday)()
}

export function createApp(deps: AppDeps) {
  const verifyIdToken = deps.verifyIdToken ?? ((token: string) => authFor(deps.db).then((auth) => auth.verifyIdToken(token)))
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = requestOrigin(req)
    const url = new URL(req.url ?? '/', `${origin}/`)
    const path = url.pathname
    const method = req.method ?? 'GET'

    try {
      if (method === 'GET' && path === '/') {
        const viewer = await viewerFrom(req, deps)
        const toast = takeToast(req.headers.cookie)
        const home =
          viewer.state === 'signed_out'
            ? renderHome(viewer, toast.text)
            : renderHome(
                {
                  state: 'signed_in',
                  account: viewer.account,
                  groups: await listHomeGroups(deps.db, viewer.account),
                  heatmaps: await listHeatmaps(deps.db, viewer.account, today(deps)),
                },
                toast.text,
              )
        sendHtml(res, 200, home, toast.cookies)
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
  if (route.kind === 'show') {
    if (method !== 'GET') return rejectMethod(res, 'GET')
    const toast = takeToast(req.headers.cookie)
    const who = { kind: 'cookie', token: readCookie(req.headers.cookie, SESSION_COOKIE) } as const
    const page = await loadGroupPage(deps.db, who, route.groupId, today(deps))
    sendPage(res, 200, page, viewerFor(req, deps, page.account), origin, undefined, toast)
    return
  }
  const viewer = await viewerFrom(req, deps)
  if (route.kind === 'new') {
    if (method !== 'GET') return rejectMethod(res, 'GET')
    sendHtml(res, 200, renderNewChallenge(viewer))
    return
  }
  if (route.kind === 'create') {
    if (method !== 'POST') return rejectMethod(res, 'POST')
    if (viewer.state === 'signed_out') {
      req.resume()
      sendHtml(res, 401, renderNewChallenge(viewer))
      return
    }
    const form = await readForm(req)
    if (!(form instanceof URLSearchParams)) return rejectForm(res, form)
    const input: CreateChallengeInput = {
      ...challengeInputFrom(form),
      interval: form.get('interval') ?? '',
      solo: form.get('solo') === 'yes',
      cause: form.get('cause') ?? '',
    }
    const created = await createChallenge(deps.db, viewer.account, input)
    if (!created.ok) {
      sendHtml(res, 400, renderNewChallenge(viewer, created.failure, input))
      return
    }
    sendRedirect(res, groupHref(created.groupId), [toastCookie({ kind: 'created', group: created.label })], 303)
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
  if (route.kind === 'delete_group') {
    await postDelete(req, res, method, origin, route.groupId, viewer, deps)
    return
  }
  if (route.kind === 'drop_group_name') {
    await postDropName(req, res, method, origin, route.groupId, viewer, deps)
    return
  }
  if (method !== 'POST') return rejectMethod(res, 'POST')
  if (viewer.state === 'signed_out') {
    const page = await loadGroupPage(deps.db, { kind: 'known', account: null }, route.groupId, today(deps))
    const closed = page.kind === 'outsider' && (page.view.kind === 'full' || page.view.kind === 'solo')
    sendPage(res, closed ? 409 : 401, page, viewer, origin)
    return
  }
  const joined = await joinGroup(deps.db, viewer.account, route.groupId)
  if (joined.ok) {
    sendRedirect(res, groupHref(joined.groupId), [toastCookie({ kind: 'joined', group: joined.label })], 303)
    return
  }
  if (joined.failure === 'group_missing') {
    sendHtml(res, 404, renderMessage('Not found', 'That page does not exist.'))
    return
  }
  await sendGroupPage(res, 409, viewer, route.groupId, origin, deps)
}

type ChallengeRoute = Extract<GroupRoute, { kind: 'save_challenge' | 'start_challenge' | 'save_rhythm' }>

type ChallengeOutcome = { ok: true; toast: Toast } | { ok: false; failure: ChallengeFailure }

function challengeStatus(failure: ChallengeFailure): number {
  if (failure === 'not_member' || failure === 'not_creator') return 403
  if (failure === 'group_missing') return 404
  if (
    failure === 'frozen' ||
    failure === 'no_challenge' ||
    failure === 'outside_headcount' ||
    failure === 'needs_friend' ||
    failure === 'rhythms_missing'
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
  viewer: Viewer,
  groupId: GroupId,
  origin: string,
  deps: AppDeps,
  attempt?: ChallengeAttempt,
): Promise<void> {
  const who = { kind: 'known', account: viewer.state === 'signed_in' ? viewer.account : null } as const
  sendPage(res, status, await loadGroupPage(deps.db, who, groupId, today(deps)), viewer, origin, attempt)
}

function sendPage(
  res: ServerResponse,
  status: number,
  page: GroupPage,
  viewer: Viewer,
  origin: string,
  attempt?: ChallengeAttempt,
  toast: ToastReceipt = NO_TOAST,
): void {
  if (page.kind === 'missing') {
    notFound(res)
    return
  }
  sendHtml(res, status, renderGroup(page.view, viewer, origin, attempt, toast.text), toast.cookies)
}

async function finishChallenge(
  res: ServerResponse,
  origin: string,
  groupId: GroupId,
  account: Account,
  deps: AppDeps,
  result: ChallengeOutcome,
  drafts: Pick<ChallengeAttempt, 'draft' | 'rhythmDraft'> = {},
  slot: 'failure' | 'startFailure' = 'failure',
): Promise<void> {
  if (result.ok) {
    sendRedirect(res, groupHref(groupId), [toastCookie(result.toast)], 303)
    return
  }
  if (result.failure === 'group_missing') {
    notFound(res)
    return
  }
  const status = challengeStatus(result.failure)
  const failure: ChallengeAttempt = { [slot]: result.failure }
  const attempt: ChallengeAttempt = status === 409 ? failure : { ...failure, ...drafts }
  await sendGroupPage(res, status, { state: 'signed_in', account }, groupId, origin, deps, attempt)
}

function challengeInputFrom(form: URLSearchParams): ChallengeInput {
  return {
    name: form.get('name') ?? '',
    type: form.get('type') ?? '',
    customLabel: form.get('custom_label') ?? '',
    currency: form.get('currency') ?? '',
    stake: form.get('stake') ?? '',
    startsOn: form.get('starts_on') ?? '',
    endsOn: form.get('ends_on') ?? '',
  }
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
    await sendGroupPage(res, 401, viewer, route.groupId, origin, deps)
    return
  }
  const form = await readForm(req)
  if (!(form instanceof URLSearchParams)) return rejectForm(res, form)
  if (route.kind === 'start_challenge') {
    const started = await startChallenge(deps.db, viewer.account, route.groupId)
    const result: ChallengeOutcome = started.ok ? { ok: true, toast: { kind: 'started', challenge: started.name } } : started
    await finishChallenge(res, origin, route.groupId, viewer.account, deps, result, {}, 'startFailure')
    return
  }
  if (route.kind === 'save_challenge') {
    const input = challengeInputFrom(form)
    const saved = await saveChallenge(deps.db, viewer.account, route.groupId, input)
    const result: ChallengeOutcome = saved.ok ? { ok: true, toast: { kind: 'terms_saved', challenge: saved.name } } : saved
    await finishChallenge(res, origin, route.groupId, viewer.account, deps, result, { draft: input })
    return
  }
  const rhythm: RhythmInput = { interval: form.get('interval') ?? '' }
  const saved = await saveRhythm(deps.db, viewer.account, route.groupId, rhythm)
  const result: ChallengeOutcome = saved.ok ? { ok: true, toast: { kind: 'rhythm_saved', rhythm: saved.rhythm } } : saved
  await finishChallenge(res, origin, route.groupId, viewer.account, deps, result, { rhythmDraft: rhythm })
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
    await sendGroupPage(res, 401, viewer, groupId, origin, deps)
    return
  }
  const form = await readForm(req)
  if (!(form instanceof URLSearchParams)) return rejectForm(res, form)
  const input: CheckInInput = { day: form.get('day') ?? '', color: form.get('color') ?? '' }
  const logged = await logCheckIn(deps.db, viewer.account, groupId, input, today(deps))
  if (logged.ok) {
    sendRedirect(res, groupHref(groupId), [toastCookie(checkInToast(logged.day, logged.color, logged.previous))], 303)
    return
  }
  if (logged.failure === 'group_missing') {
    notFound(res)
    return
  }
  if (logged.failure === 'not_member') {
    await sendGroupPage(res, 403, viewer, groupId, origin, deps, { checkInFailure: logged.failure })
    return
  }
  await sendGroupPage(res, 400, viewer, groupId, origin, deps, {
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
    await sendGroupPage(res, 401, viewer, groupId, origin, deps)
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
    const toast: Toast = {
      kind: 'paid',
      amountMinor: recorded.amountMinor,
      minorDigits: recorded.minorDigits,
      currency: recorded.currency,
      payee: recorded.payeeName,
    }
    sendRedirect(res, groupHref(groupId), [toastCookie(toast)], 303)
    return
  }
  if (recorded.failure === 'group_missing') {
    notFound(res)
    return
  }
  const attempt: ChallengeAttempt = { paymentFailure: recorded.failure, paymentDraft: input }
  if (recorded.failure === 'not_member') {
    await sendGroupPage(res, 403, viewer, groupId, origin, deps, attempt)
    return
  }
  await sendGroupPage(res, paymentStatus(recorded.failure), viewer, groupId, origin, deps, attempt)
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
    await sendGroupPage(res, 401, viewer, groupId, origin, deps)
    return
  }
  const form = await readForm(req)
  if (!(form instanceof URLSearchParams)) return rejectForm(res, form)
  const input: DropoutInput = { memberId: form.get('member') ?? '', lastDay: form.get('last_day') ?? '' }
  const recorded = await recordDropout(deps.db, viewer.account, groupId, input, today(deps))
  if (recorded.ok) {
    if (input.memberId === viewer.account.id) {
      sendRedirect(res, '/', [toastCookie({ kind: 'left', group: recorded.groupName, lastDay: recorded.lastDay })], 303)
      return
    }
    const toast: Toast = { kind: 'dropped', member: recorded.memberName, lastDay: recorded.lastDay }
    sendRedirect(res, groupHref(groupId), [toastCookie(toast)], 303)
    return
  }
  if (recorded.failure === 'group_missing') {
    notFound(res)
    return
  }
  const attempt: ChallengeAttempt = { dropoutFailure: recorded.failure, dropoutDraft: input }
  if (recorded.failure === 'not_member') {
    await sendGroupPage(res, 403, viewer, groupId, origin, deps, attempt)
    return
  }
  await sendGroupPage(res, dropoutStatus(recorded.failure), viewer, groupId, origin, deps, attempt)
}

async function postDelete(
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
    await sendGroupPage(res, 401, viewer, groupId, origin, deps)
    return
  }
  const form = await readForm(req)
  if (!(form instanceof URLSearchParams)) return rejectForm(res, form)
  const deleted = await deleteGroup(deps.db, viewer.account, groupId, form.get('confirm') === 'yes')
  if (deleted.ok) {
    sendRedirect(res, '/', [toastCookie({ kind: 'deleted', group: deleted.label })], 303)
    return
  }
  if (deleted.failure === 'group_missing') {
    notFound(res)
    return
  }
  const attempt: ChallengeAttempt = { deleteFailure: deleted.failure }
  if (deleted.failure === 'not_member') {
    await sendGroupPage(res, 403, viewer, groupId, origin, deps, attempt)
    return
  }
  await sendGroupPage(res, deleted.failure === 'not_creator' ? 403 : 400, viewer, groupId, origin, deps, attempt)
}

async function postDropName(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  origin: string,
  groupId: GroupId,
  viewer: Viewer,
  deps: AppDeps,
): Promise<void> {
  if (method !== 'POST') return rejectMethod(res, 'POST')
  req.resume()
  if (viewer.state === 'signed_out') {
    await sendGroupPage(res, 401, viewer, groupId, origin, deps)
    return
  }
  const dropped = await dropGroupName(deps.db, viewer.account, groupId)
  if (dropped.ok) {
    sendRedirect(res, groupHref(groupId), [toastCookie({ kind: 'name_dropped', label: dropped.label })], 303)
    return
  }
  if (dropped.failure === 'group_missing') {
    notFound(res)
    return
  }
  const status = dropped.failure === 'no_challenge' ? 409 : 403
  await sendGroupPage(res, status, viewer, groupId, origin, deps, { dropNameFailure: dropped.failure })
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

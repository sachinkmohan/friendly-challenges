import { paymentFailureCopy, type Ledger, type Payment, type PaymentFailure, type PaymentInput } from './balances.ts'
import {
  challengeFailureCopy,
  formatMinor,
  formatStake,
  PRESET_LABELS,
  RHYTHM_LABELS,
  rhythmSlot,
  type ChallengeFailure,
  type ChallengeHeadline,
  type ChallengeInput,
  type ChallengeTerms,
  type ChallengeType,
  type MemberChallengeCard,
  type Rhythm,
  type RhythmInput,
  type RhythmLine,
} from './challenge.ts'
import { DAY_MARK_LABELS, type GroupCalendar, type Heatmap, type MarkedDay } from './calendar.ts'
import { dropoutFailureCopy, type DropoutFailure, type DropoutInput } from './dropouts.ts'
import { CHECK_IN_LABELS, checkInFailureCopy, type CheckIn, type CheckInFailure } from './checkins.ts'
import { parseGroupId, type GroupId, type GroupView, type HomeGroup, type MemberLine } from './groups.ts'
import { authFailureCopy, type Account, type AuthFailure, type FirebaseWebConfig, type Viewer } from './identity.ts'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeAvatar(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    return escapeHtml(parsed.toString())
  } catch {
    return null
  }
}

const homeIcon = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M12 3.2 3 11h2v9h6v-6h2v6h6v-9h2L12 3.2z"/></svg>`
const accountIcon = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2.2-7 5v1h14v-1c0-2.8-3-5-7-5z"/></svg>`

function tabBar(homeHref: string, accountHref: string): string {
  return `<nav class="tabbar" aria-label="Primary">
    <a class="tab tab-home" href="${homeHref}" aria-current="page">${homeIcon}<span>Home</span></a>
    <a class="tab tab-account" href="${accountHref}">${accountIcon}<span>Account</span></a>
  </nav>`
}

const frame = (screens: string, tabs: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Friendly challenges</title>
  <style>
    * { box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body {
      margin: 0;
      min-height: 100dvh;
      background: #cfc6b8;
      color: #1c1915;
      font: 16px/1.45 ui-sans-serif, system-ui, sans-serif;
    }
    .stage {
      height: 100dvh;
      overflow: hidden;
      display: grid;
      place-items: center;
    }
    .device {
      width: min(390px, 100%);
      height: min(844px, 100dvh);
      padding: 10px;
      border-radius: 40px;
      background: #1c1915;
      box-shadow: 0 30px 80px rgba(28, 25, 21, 0.35);
    }
    .phone {
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 32px;
      background: #efeae1;
    }
    .appbar {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 56px;
      background: #fffdf8;
      border-bottom: 1px solid #e7e0d4;
    }
    h1 {
      margin: 0;
      font-size: 17px;
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .screens {
      flex: 1;
      overflow: auto;
      overscroll-behavior: contain;
      overflow-anchor: none;
    }
    .screen { display: none; padding: 16px; }
    .screen.is-current,
    #home:target,
    #account:target,
    .screens:not(:has(.screen:target)):not(:has(.is-current)) #home { display: block; }
    .card {
      background: #fffdf8;
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 1px 2px rgba(28, 25, 21, 0.06), 0 8px 24px rgba(28, 25, 21, 0.05);
    }
    h2 {
      margin: 0 0 8px;
      font-size: 22px;
      font-weight: 650;
      letter-spacing: -0.02em;
      overflow-wrap: anywhere;
    }
    p { margin: 0; color: #5c564c; }
    .card p + p { margin-top: 8px; }
    label {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: 48px;
      margin-top: 16px;
      font-weight: 650;
    }
    input, select {
      display: block;
      width: 100%;
      min-height: 48px;
      margin-top: 8px;
      padding: 0 16px;
      border: 1px solid #e7e0d4;
      border-radius: 14px;
      background: #fffdf8;
      color: inherit;
      font: inherit;
    }
    ul.groups, ul.members, ul.check-ins {
      list-style: none;
      margin: 16px 0 0;
      padding: 0;
    }
    ul.groups li, ul.members li, ul.check-ins li {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      min-height: 48px;
    }
    ul.groups a {
      display: flex;
      align-items: center;
      flex: 1;
      min-height: 48px;
      color: #1c1915;
      font-weight: 650;
      text-decoration: none;
    }
    .count { color: #5c564c; }
    .members time, .rhythm { color: #5c564c; }
    .net.owed { color: #2f7d4a; font-weight: 650; }
    .net.owes { color: #b3392f; font-weight: 650; }
    .net.even { color: #5c564c; }
    .member-name { flex: 1; min-width: 0; }
    .rhythm { flex-basis: 100%; padding-left: 68px; }
    .share { margin-top: 16px; overflow-wrap: anywhere; }
    .share a {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: 48px;
      color: #1c1915;
      font-weight: 650;
    }
    .check-in-colors { display: flex; gap: 12px; }
    .check-in-colors button.green { background: #2f7d4a; }
    .check-in-colors button.red { background: #b3392f; }
    .check-ins-title { margin-top: 24px; font-weight: 650; color: #1c1915; }
    ul.check-ins { margin-top: 8px; }
    .swatch { width: 16px; height: 16px; flex: none; border-radius: 50%; }
    .swatch.green { background: #2f7d4a; }
    .swatch.red { background: #b3392f; }
    .grid-title { margin-top: 24px; font-weight: 650; color: #1c1915; }
    .grid-scroll { margin-top: 8px; overflow-x: auto; }
    table.grid { border-collapse: separate; border-spacing: 3px; }
    table.grid th {
      padding: 0 6px 0 0;
      color: #5c564c;
      font-size: 11px;
      font-weight: 650;
      text-align: left;
      white-space: nowrap;
    }
    table.grid thead th { padding: 0; text-align: center; }
    table.grid tbody th {
      position: sticky;
      left: 0;
      max-width: 88px;
      overflow: hidden;
      text-overflow: ellipsis;
      background: #fffdf8;
    }
    table.grid td { padding: 0; }
    .cell { display: block; width: 14px; height: 14px; border-radius: 3px; }
    .cell.green { background: #2f7d4a; }
    .cell.red { background: #b3392f; }
    .cell.empty { box-shadow: inset 0 0 0 1.5px #8a8378; }
    .cell.blank { background: #efe8dc; }
    .grid-note { margin-top: 8px; }
    .who { display: flex; gap: 12px; align-items: center; }
    .who img, .avatar {
      width: 56px;
      height: 56px;
      flex: none;
      border-radius: 50%;
      object-fit: cover;
      background: #efe8dc;
    }
    .avatar {
      display: grid;
      place-items: center;
      font-size: 22px;
      font-weight: 650;
    }
    .name { font-weight: 650; }
    .email { color: #5c564c; font-size: 14px; overflow-wrap: anywhere; }
    form { margin: 0; }
    a.button, button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 48px;
      margin-top: 16px;
      padding: 0 16px;
      border: 0;
      border-radius: 14px;
      background: #1c1915;
      color: #fffdf8;
      font: inherit;
      font-weight: 650;
      text-decoration: none;
      cursor: pointer;
      touch-action: manipulation;
    }
    a.button:active, button:active { transform: scale(0.98); }
    .sign-in-error { margin-top: 8px; color: #b3392f; }
    .tabbar {
      flex: none;
      display: flex;
      height: calc(64px + env(safe-area-inset-bottom));
      padding-bottom: env(safe-area-inset-bottom);
      background: #fffdf8;
      border-top: 1px solid #e7e0d4;
    }
    .tab {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      min-height: 48px;
      color: #8a8378;
      font-size: 11px;
      font-weight: 650;
      text-decoration: none;
      touch-action: manipulation;
    }
    .phone:not(:has(#account:target)) .tab-home,
    .phone:has(#account:target) .tab-account { color: #1c1915; }
    .tab:active { background: #f6f1e8; }
    .indicator {
      flex: none;
      width: 128px;
      height: 5px;
      margin: 0 auto 8px;
      border-radius: 999px;
      background: #1c1915;
      opacity: 0.35;
    }
    :focus-visible { outline: 2px solid #1c1915; outline-offset: 2px; }
  </style>
</head>
<body>
  <div class="stage">
    <div class="device">
      <div class="phone">
        <header class="appbar">
          <h1>Friendly challenges</h1>
        </header>
        <main class="screens">
          ${screens}
        </main>
        ${tabs}
        <div class="indicator" aria-hidden="true"></div>
      </div>
    </div>
  </div>
  <script>
    function applyScreen() {
      var account = location.hash === '#account'
      document.querySelectorAll('.screen[id]').forEach(function (screen) {
        screen.classList.toggle('is-current', screen.id === (account ? 'account' : 'home'))
      })
      document.querySelectorAll('.tab').forEach(function (tab) {
        var on = account ? tab.classList.contains('tab-account') : tab.classList.contains('tab-home')
        if (on) tab.setAttribute('aria-current', 'page')
        else tab.removeAttribute('aria-current')
      })
      var screens = document.querySelector('.screens')
      if (screens) screens.scrollTop = 0
      window.scrollTo(0, 0)
    }
    document.querySelectorAll('a.tab').forEach(function (tab) {
      tab.addEventListener('click', function (event) {
        var href = tab.getAttribute('href') || ''
        if (href.charAt(0) !== '#') return
        event.preventDefault()
        history.pushState(null, '', href)
        applyScreen()
      })
    })
    window.addEventListener('popstate', applyScreen)
    window.addEventListener('hashchange', applyScreen)
    applyScreen()
  </script>
  <script type="module">
    const forms = document.querySelectorAll('form.sign-in')
    const showError = (form, text) => {
      const error = form.querySelector('.sign-in-error')
      error.textContent = text
      error.hidden = false
    }
    if (forms.length > 0) {
      try {
        const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup, signOut }] = await Promise.all([
          import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js'),
        ])
        const auth = getAuth(initializeApp(JSON.parse(forms[0].dataset.firebase)))
        forms.forEach((form) => {
          form.querySelector('button').addEventListener('click', async () => {
            form.querySelector('.sign-in-error').hidden = true
            const provider = new GoogleAuthProvider()
            provider.setCustomParameters({ prompt: 'select_account' })
            try {
              const result = await signInWithPopup(auth, provider)
              form.elements.idToken.value = await result.user.getIdToken()
              await signOut(auth)
              form.submit()
            } catch {
              showError(form, 'Sign-in did not finish. Try again.')
            }
          })
        })
      } catch {
        forms.forEach((form) => showError(form, 'Google sign-in could not load. Reload the page.'))
      }
    }
  </script>
</body>
</html>
`

function portrait(person: { displayName: string; avatarUrl: string | null }): string {
  const avatar = safeAvatar(person.avatarUrl)
  if (avatar) return `<img src="${avatar}" alt="">`
  const initial = escapeHtml(Array.from(person.displayName.trim())[0] || '?')
  return `<div class="avatar" aria-hidden="true">${initial}</div>`
}

const groupsRoot = '/groups'
const joinSuffix = '/join'
const challengeStartSuffix = '/challenge/start'
const challengeSuffix = '/challenge'
const rhythmSuffix = '/rhythm'
const checkInSuffix = '/check-in'
const paymentSuffix = '/payment'
const dropoutSuffix = '/dropout'

export type HomePage =
  | Extract<Viewer, { state: 'signed_out' }>
  | { state: 'signed_in'; account: Account; groups: readonly HomeGroup[]; heatmaps: readonly Heatmap[] }

export type GroupRoute =
  | { kind: 'new' }
  | { kind: 'create' }
  | { kind: 'show'; groupId: GroupId }
  | { kind: 'join'; groupId: GroupId }
  | { kind: 'save_challenge'; groupId: GroupId }
  | { kind: 'start_challenge'; groupId: GroupId }
  | { kind: 'save_rhythm'; groupId: GroupId }
  | { kind: 'log_check_in'; groupId: GroupId }
  | { kind: 'record_payment'; groupId: GroupId }
  | { kind: 'record_dropout'; groupId: GroupId }

export function groupHref(groupId: GroupId): string {
  return `${groupsRoot}/${groupId}`
}

function activeCountText(count: number): string {
  return `${count} active`
}

function signInControl(firebase: FirebaseWebConfig | null, returnPath: string): string {
  if (!firebase) return '<p>Sign-in is not configured. Set FIREBASE_API_KEY and FIREBASE_AUTH_DOMAIN.</p>'
  return `<form class="sign-in" method="post" action="/auth/firebase" data-firebase="${escapeHtml(JSON.stringify(firebase))}">
      <input type="hidden" name="return" value="${escapeHtml(returnPath)}">
      <input type="hidden" name="idToken">
      <button type="button">Sign in with Google</button>
      <p class="sign-in-error" role="alert" hidden></p>
    </form>`
}

function routeSuffix(
  rest: string,
  suffix: string,
  kind:
    | 'start_challenge'
    | 'save_challenge'
    | 'save_rhythm'
    | 'log_check_in'
    | 'record_payment'
    | 'record_dropout'
    | 'join',
): GroupRoute | null {
  if (!rest.endsWith(suffix) || rest.length <= suffix.length) return null
  const idPart = rest.slice(0, -suffix.length)
  if (idPart.includes('/')) return null
  const groupId = parseGroupId(idPart)
  if (!groupId) return null
  return { kind, groupId }
}

export function matchGroupPath(path: string): GroupRoute | null {
  if (path === `${groupsRoot}/new`) return { kind: 'new' }
  if (path === groupsRoot) return { kind: 'create' }
  if (!path.startsWith(`${groupsRoot}/`)) return null
  const rest = path.slice(groupsRoot.length + 1)
  const suffixed =
    routeSuffix(rest, challengeStartSuffix, 'start_challenge') ??
    routeSuffix(rest, challengeSuffix, 'save_challenge') ??
    routeSuffix(rest, rhythmSuffix, 'save_rhythm') ??
    routeSuffix(rest, checkInSuffix, 'log_check_in') ??
    routeSuffix(rest, paymentSuffix, 'record_payment') ??
    routeSuffix(rest, dropoutSuffix, 'record_dropout') ??
    routeSuffix(rest, joinSuffix, 'join')
  if (suffixed) return suffixed
  if (rest.includes('/')) return null
  const groupId = parseGroupId(rest)
  return groupId ? { kind: 'show', groupId } : null
}

export function safeReturnPath(raw: string | null): string {
  if (!raw) return '/'
  const route = matchGroupPath(raw)
  if (route?.kind === 'new') return `${groupsRoot}/new`
  if (route?.kind === 'show') return groupHref(route.groupId)
  return '/'
}

function homeGroups(groups: readonly HomeGroup[]): string {
  if (groups.length === 0) return '<p>You are not in a group yet.</p>'
  const items = groups
    .map((group) => {
      const href = escapeHtml(groupHref(group.groupId))
      const name = escapeHtml(group.name)
      return `<li><a href="${href}">${name}</a> <span class="count">${activeCountText(group.activeCount)}</span></li>`
    })
    .join('')
  return `<ul class="groups">${items}</ul>`
}

const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''] as const

function dayCell(marked: MarkedDay): string {
  const day = escapeHtml(marked.day)
  const label = escapeHtml(`${marked.day} ${DAY_MARK_LABELS[marked.mark]}`)
  return `<td data-day="${day}" data-mark="${marked.mark}"><span class="cell ${marked.mark}" role="img" aria-label="${label}" title="${label}"></span></td>`
}

function notStartedNote(startsOn: string): string {
  const when = escapeHtml(startsOn)
  return `<p class="grid-note">The first day is <time datetime="${when}">${when}</time>.</p>`
}

function calendarGrid(calendar: GroupCalendar): string {
  const title = '<p class="grid-title">Calendar</p>'
  if (calendar.days.length === 0) return `${title}${notStartedNote(calendar.startsOn)}`
  const head = calendar.days.map((day) => `<th scope="col">${Number(day.slice(8, 10))}</th>`).join('')
  const rows = calendar.rows
    .map((row) => {
      const name = escapeHtml(row.displayName)
      return `<tr data-member="${escapeHtml(row.userId)}"><th scope="row" title="${name}">${name}</th>${row.days.map(dayCell).join('')}</tr>`
    })
    .join('')
  return `${title}<div class="grid-scroll"><table class="grid calendar"><thead><tr><td></td>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
}

function heatmapGrid(heatmap: Heatmap): string {
  const title = `<p class="grid-title">${escapeHtml(heatmap.name)}</p>`
  if (heatmap.weeks.length === 0) return `${title}${notStartedNote(heatmap.startsOn)}`
  const rows = WEEKDAY_LABELS.map((label, weekday) => {
    const cells = heatmap.weeks.map((week) => {
      const marked = week[weekday]
      return marked ? dayCell(marked) : '<td></td>'
    })
    return `<tr data-weekday="${weekday}"><th scope="row">${label}</th>${cells.join('')}</tr>`
  }).join('')
  return `${title}<div class="grid-scroll"><table class="grid heatmap" data-group="${escapeHtml(heatmap.groupId)}"><tbody>${rows}</tbody></table></div>`
}

function signedOutScreens(firebase: FirebaseWebConfig | null): string {
  return `
    <section id="home" class="screen">
      <article class="card">
        <h2>Sign in</h2>
        <p>Sign in with the Google account you will use for your group.</p>
        ${signInControl(firebase, '/')}
      </article>
    </section>
    <section id="account" class="screen">
      <article class="card">
        <h2>Account</h2>
        <p>No account on this device yet. Google sign-in stores one account for this app.</p>
        ${signInControl(firebase, '/')}
      </article>
    </section>
  `
}

function signedInScreens(account: Account, groups: readonly HomeGroup[], heatmaps: readonly Heatmap[]): string {
  const name = escapeHtml(account.displayName)
  const email = escapeHtml(account.email)
  return `
    <section id="home" class="screen">
      <article class="card">
        <h2>Hello, ${name}</h2>
        ${homeGroups(groups)}
        ${heatmaps.map(heatmapGrid).join('')}
        <a class="button" href="${groupsRoot}/new">Create a group</a>
      </article>
    </section>
    <section id="account" class="screen">
      <article class="card">
        <div class="who">
          ${portrait(account)}
          <div>
            <div class="name">${name}</div>
            <div class="email">${email}</div>
          </div>
        </div>
        <form method="post" action="/logout">
          <button type="submit">Sign out</button>
        </form>
      </article>
    </section>
  `
}

export function renderHome(page: HomePage): string {
  const screens = page.state === 'signed_out' ? signedOutScreens(page.firebase) : signedInScreens(page.account, page.groups, page.heatmaps)
  return frame(screens, tabBar('#home', '#account'))
}

function groupCard(body: string): string {
  const screens = `
    <section class="screen is-current">
      <article class="card">
        ${body}
      </article>
    </section>
  `
  return frame(screens, tabBar('/', '/#account'))
}

export function renderNewGroup(viewer: Viewer, error?: 'name_empty' | 'name_too_long'): string {
  if (viewer.state === 'signed_out') {
    return groupCard(`
      <h2>Create a group</h2>
      <p>Sign in to create a group.</p>
      ${signInControl(viewer.firebase, `${groupsRoot}/new`)}
    `)
  }
  const message =
    error === 'name_empty'
      ? '<p>Type a group name.</p>'
      : error === 'name_too_long'
        ? '<p>Use 40 characters or fewer.</p>'
        : ''
  return groupCard(`
    <h2>Create a group</h2>
    ${message}
    <form method="post" action="${groupsRoot}">
      <label for="group-name">Group name</label>
      <input id="group-name" name="name" autocomplete="off" required>
      <button type="submit">Create group</button>
    </form>
  `)
}

type TermValues = {
  name: string
  type: string
  customLabel: string
  currency: string
  stake: string
  startsOn: string
  endsOn: string
}

export type ChallengeAttempt = {
  failure?: ChallengeFailure
  checkInFailure?: CheckInFailure
  paymentFailure?: PaymentFailure
  paymentDraft?: PaymentInput
  dropoutFailure?: DropoutFailure
  dropoutDraft?: DropoutInput
  draft?: ChallengeInput
  rhythmDraft?: RhythmInput
  checkInDay?: string
}

const emptyTerms: TermValues = {
  name: '',
  type: '',
  customLabel: '',
  currency: '',
  stake: '',
  startsOn: '',
  endsOn: '',
}

function typeLabel(type: ChallengeType): string {
  return type.kind === 'custom' ? type.label : PRESET_LABELS[type.preset]
}

function headcountSentence(floor: number, cap: number): string {
  return `A challenge can start when ${floor} to ${cap} people are active.`
}

function failureParagraph(attempt?: ChallengeAttempt): string {
  if (attempt?.failure) return `<p>${escapeHtml(challengeFailureCopy[attempt.failure])}</p>`
  if (attempt?.checkInFailure) return `<p>${escapeHtml(checkInFailureCopy[attempt.checkInFailure])}</p>`
  if (attempt?.paymentFailure) return `<p>${escapeHtml(paymentFailureCopy[attempt.paymentFailure])}</p>`
  if (attempt?.dropoutFailure) return `<p>${escapeHtml(dropoutFailureCopy[attempt.dropoutFailure])}</p>`
  return ''
}

function optionList(items: readonly { value: string; label: string }[], selected: string): string {
  return items
    .map((item) => {
      const current = item.value === selected ? ' selected' : ''
      return `<option value="${escapeHtml(item.value)}"${current}>${escapeHtml(item.label)}</option>`
    })
    .join('')
}

function typeOptions(selected: string): string {
  const items = [
    ...Object.entries(PRESET_LABELS).map(([value, label]) => ({ value, label })),
    { value: 'custom', label: 'Custom' },
  ]
  return optionList(items, selected)
}

function currencyOptions(currencies: readonly string[], selected: string): string {
  return optionList(
    currencies.map((code) => ({ value: code, label: code })),
    selected,
  )
}

function intervalOptions(selected: string): string {
  return optionList(
    Object.entries(RHYTHM_LABELS).map(([value, label]) => ({ value, label })),
    selected,
  )
}

function termsFromStored(terms: ChallengeTerms, minorDigits: number): TermValues {
  return {
    name: terms.name,
    type: terms.type.kind === 'custom' ? 'custom' : terms.type.preset,
    customLabel: terms.type.kind === 'custom' ? terms.type.label : '',
    currency: terms.currency,
    stake: formatStake(terms.stakeMinor, minorDigits),
    startsOn: terms.startsOn,
    endsOn: terms.endsOn,
  }
}

function termsFromDraft(draft: ChallengeInput): TermValues {
  return {
    name: draft.name,
    type: draft.type,
    customLabel: draft.customLabel,
    currency: draft.currency,
    stake: draft.stake,
    startsOn: draft.startsOn,
    endsOn: draft.endsOn,
  }
}

function termsText(terms: ChallengeTerms, minorDigits: number): string {
  const start = escapeHtml(terms.startsOn)
  const end = escapeHtml(terms.endsOn)
  return `<p>${escapeHtml(terms.name)}</p>
    <p>${escapeHtml(typeLabel(terms.type))}</p>
    <p><time datetime="${start}">${start}</time> to <time datetime="${end}">${end}</time></p>
    <p>${escapeHtml(formatStake(terms.stakeMinor, minorDigits))} ${escapeHtml(terms.currency)}</p>`
}

function termsForm(groupId: GroupId, currencies: readonly string[], values: TermValues): string {
  const action = escapeHtml(`${groupHref(groupId)}/challenge`)
  return `<form method="post" action="${action}">
      <label for="challenge-name">Challenge name</label>
      <input id="challenge-name" name="name" value="${escapeHtml(values.name)}" autocomplete="off">
      <label for="challenge-type">Type</label>
      <select id="challenge-type" name="type">${typeOptions(values.type)}</select>
      <label for="challenge-custom">Custom type</label>
      <input id="challenge-custom" name="custom_label" value="${escapeHtml(values.customLabel)}" autocomplete="off">
      <label for="challenge-currency">Currency</label>
      <select id="challenge-currency" name="currency">${currencyOptions(currencies, values.currency)}</select>
      <label for="challenge-stake">Stake per day</label>
      <input id="challenge-stake" name="stake" value="${escapeHtml(values.stake)}" inputmode="decimal" autocomplete="off">
      <label for="challenge-start">Start date</label>
      <input id="challenge-start" name="starts_on" type="date" value="${escapeHtml(values.startsOn)}">
      <label for="challenge-end">End date</label>
      <input id="challenge-end" name="ends_on" type="date" value="${escapeHtml(values.endsOn)}">
      <button type="submit">Save challenge</button>
    </form>`
}

function rhythmText(rhythm: Rhythm): string {
  const when = escapeHtml(rhythm.anchorOn)
  return `<p>${escapeHtml(RHYTHM_LABELS[rhythm.kind])} <time datetime="${when}">${when}</time></p>`
}

function rhythmForm(groupId: GroupId, interval: string, anchor: string): string {
  const action = escapeHtml(`${groupHref(groupId)}/rhythm`)
  return `<form method="post" action="${action}">
      <label for="rhythm-interval">How often you log</label>
      <select id="rhythm-interval" name="interval">${intervalOptions(interval)}</select>
      <label for="rhythm-anchor">Anchor date</label>
      <input id="rhythm-anchor" name="anchor_on" type="date" value="${escapeHtml(anchor)}">
      <button type="submit">Save rhythm</button>
    </form>`
}

function rhythmControl(
  groupId: GroupId,
  challenge: MemberChallengeCard,
  userId: string,
  posted: RhythmInput | undefined,
): string {
  if (challenge.phase === 'unopened') return ''
  const slot = rhythmSlot(challenge.phase, challenge.rhythms, userId)
  if (slot.mode === 'locked') return rhythmText(slot.rhythm)
  const stored = slot.mode === 'open' ? slot.rhythm : null
  return rhythmForm(groupId, posted?.interval ?? stored?.kind ?? '', posted?.anchorOn ?? stored?.anchorOn ?? '')
}

function checkInControl(
  groupId: GroupId,
  challenge: MemberChallengeCard,
  userId: string,
  postedDay: string | undefined,
): string {
  if (challenge.phase !== 'active') return ''
  if (rhythmSlot(challenge.phase, challenge.rhythms, userId).mode !== 'locked') return ''
  const action = escapeHtml(`${groupHref(groupId)}${checkInSuffix}`)
  const start = escapeHtml(challenge.terms.startsOn)
  const end = escapeHtml(challenge.terms.endsOn)
  return `<form method="post" action="${action}">
      <label for="check-in-day">Day to log</label>
      <input id="check-in-day" name="day" type="date" min="${start}" max="${end}" value="${escapeHtml(postedDay ?? '')}" required>
      <div class="check-in-colors">
        <button type="submit" class="green" name="color" value="green">Kept it</button>
        <button type="submit" class="red" name="color" value="red">Missed it</button>
      </div>
    </form>
    <script>
      (function () {
        var input = document.getElementById('check-in-day')
        if (!input || input.value) return
        var now = new Date()
        var pad = function (n) { return String(n).padStart(2, '0') }
        input.value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
      })()
    </script>`
}

function checkInItem(checkIn: CheckIn): string {
  const when = escapeHtml(checkIn.day)
  const label = CHECK_IN_LABELS[checkIn.color]
  return `<li><span class="swatch ${checkIn.color}" aria-hidden="true"></span> <span class="member-name">${escapeHtml(checkIn.displayName)} <time datetime="${when}">${when}</time></span> <span>${label}</span></li>`
}

function checkInList(checkIns: readonly CheckIn[]): string {
  if (checkIns.length === 0) return ''
  return `<p class="check-ins-title">Check-ins</p><ul class="check-ins">${checkIns.map(checkInItem).join('')}</ul>`
}

function money(ledger: Ledger, minor: number): string {
  return `${formatMinor(minor, ledger.minorDigits)} ${ledger.currency}`
}

function netItem(ledger: Ledger, line: Ledger['nets'][number]): string {
  const name = escapeHtml(line.displayName)
  const amount = escapeHtml(money(ledger, Math.abs(line.netMinor)))
  const sign = line.netMinor > 0 ? 'owed' : line.netMinor < 0 ? 'owes' : 'even'
  const text =
    sign === 'owed' ? `is owed ${amount}` : sign === 'owes' ? `owes ${amount}` : 'is even'
  return `<li data-net="${escapeHtml(line.userId)}" data-minor="${line.netMinor}"><span class="member-name">${name}</span> <span class="net ${sign}">${text}</span></li>`
}

function openItem(ledger: Ledger, line: Ledger['open'][number]): string {
  const amount = escapeHtml(money(ledger, line.amountMinor))
  return `<li data-open="${escapeHtml(line.debtorId)}:${escapeHtml(line.creditorId)}" data-minor="${line.amountMinor}">${escapeHtml(line.debtorName)} owes ${escapeHtml(line.creditorName)} ${amount}</li>`
}

function paymentItem(ledger: Ledger, payment: Payment): string {
  const when = escapeHtml(payment.paidOn)
  const ref = payment.paypalRef ? ` <span class="count">PayPal ${escapeHtml(payment.paypalRef)}</span>` : ''
  return `<li><span class="member-name">${escapeHtml(payment.payerName)} paid ${escapeHtml(payment.payeeName)} ${escapeHtml(money(ledger, payment.amountMinor))} <time datetime="${when}">${when}</time></span>${ref}</li>`
}

function paymentForm(groupId: GroupId, ledger: Ledger, userId: string, draft: PaymentInput | undefined): string {
  const others = ledger.people.filter((person) => person.userId !== userId)
  if (others.length === 0) return ''
  const action = escapeHtml(`${groupHref(groupId)}${paymentSuffix}`)
  const payees = optionList(
    others.map((person) => ({ value: person.userId, label: person.displayName })),
    draft?.payeeId ?? '',
  )
  return `<form method="post" action="${action}">
      <p class="grid-title">Record a payment you made</p>
      <p>The app does not send money. Record a payment that already happened.</p>
      <label for="payment-payee">Paid to</label>
      <select id="payment-payee" name="payee">${payees}</select>
      <label for="payment-amount">Amount in ${escapeHtml(ledger.currency)}</label>
      <input id="payment-amount" name="amount" value="${escapeHtml(draft?.amount ?? '')}" inputmode="decimal" autocomplete="off" required>
      <label for="payment-date">Date paid</label>
      <input id="payment-date" name="paid_on" type="date" value="${escapeHtml(draft?.paidOn ?? '')}" required>
      <label for="payment-ref">PayPal reference (optional)</label>
      <input id="payment-ref" name="paypal_ref" value="${escapeHtml(draft?.paypalRef ?? '')}" autocomplete="off">
      <button type="submit">Record payment</button>
    </form>`
}

function balancesSection(groupId: GroupId, ledger: Ledger, userId: string, draft: PaymentInput | undefined): string {
  const nets = `<ul class="check-ins balances">${ledger.nets.map((line) => netItem(ledger, line)).join('')}</ul>`
  const open =
    ledger.open.length === 0
      ? '<p>Nobody owes anyone.</p>'
      : `<ul class="check-ins open-amounts">${ledger.open.map((line) => openItem(ledger, line)).join('')}</ul>`
  const payments =
    ledger.payments.length === 0
      ? ''
      : `<p class="check-ins-title">Payments</p><ul class="check-ins payments">${ledger.payments.map((item) => paymentItem(ledger, item)).join('')}</ul>`
  return `<p class="check-ins-title">Balances</p>${nets}<p class="check-ins-title">Who owes whom</p>${open}${paymentForm(groupId, ledger, userId, draft)}${payments}`
}

function dropoutForm(
  view: Extract<GroupView, { kind: 'members' }>,
  userId: string,
  draft: DropoutInput | undefined,
): string {
  const choices = userId === view.creatorId ? view.members : view.members.filter((member) => member.userId === userId)
  if (choices.length === 0) return ''
  const action = escapeHtml(`${groupHref(view.groupId)}${dropoutSuffix}`)
  const members = optionList(
    choices.map((member) => ({ value: member.userId, label: member.displayName })),
    draft?.memberId ?? '',
  )
  return `<form method="post" action="${action}">
      <p class="grid-title">Leave or record a dropout</p>
      <p>Debts through the last day stay. Days after it owe nothing.</p>
      <label for="dropout-member">Member</label>
      <select id="dropout-member" name="member">${members}</select>
      <label for="dropout-day">Last day</label>
      <input id="dropout-day" name="last_day" type="date" value="${escapeHtml(draft?.lastDay ?? '')}" required>
      <button type="submit">Record dropout</button>
    </form>`
}

function startForm(groupId: GroupId, activeCount: number, floor: number, cap: number): string {
  if (activeCount < floor || activeCount > cap) return ''
  const action = escapeHtml(`${groupHref(groupId)}/challenge/start`)
  return `<form method="post" action="${action}"><button type="submit">Start challenge</button></form>`
}

function memberItem(member: MemberLine, rhythms: readonly RhythmLine[]): string {
  const when = escapeHtml(member.joinedOn)
  const rhythm = rhythms.find((line) => line.userId === member.userId)
  const anchor = rhythm ? escapeHtml(rhythm.anchorOn) : ''
  const logged = rhythm
    ? `<span class="rhythm">${escapeHtml(RHYTHM_LABELS[rhythm.kind])} <time datetime="${anchor}">${anchor}</time></span>`
    : ''
  return `<li>${portrait(member)} <span class="member-name">${escapeHtml(member.displayName)} <time datetime="${when}">${when}</time></span>${logged}</li>`
}

function joinControl(groupId: GroupId, viewer: Viewer): string {
  if (viewer.state === 'signed_out') return signInControl(viewer.firebase, groupHref(groupId))
  const action = escapeHtml(`${groupHref(groupId)}${joinSuffix}`)
  return `<form method="post" action="${action}"><button type="submit">Join group</button></form>`
}

function headlineText(headline: ChallengeHeadline | null): string {
  if (!headline) return ''
  return termsText(headline.terms, headline.minorDigits)
}

export function renderGroup(
  view:
    | (Extract<GroupView, { kind: 'preview' | 'full' }> & { readonly headline: ChallengeHeadline | null })
    | (Extract<GroupView, { kind: 'members' }> & {
        readonly challenge: MemberChallengeCard
        readonly checkIns: readonly CheckIn[]
        readonly ledger: Ledger | null
      }),
  viewer: Viewer,
  origin: string,
  attempt?: ChallengeAttempt,
): string {
  const title = `<h2>${escapeHtml(view.name)}</h2>`
  const count = `<p class="count">${activeCountText(view.activeCount)}</p>`
  const failure = failureParagraph(attempt)
  if (view.kind === 'full') {
    return groupCard(`${title}${count}${failure}${headlineText(view.headline)}<p>This group is full.</p>`)
  }
  if (view.kind === 'preview') {
    return groupCard(`${title}${count}${failure}${headlineText(view.headline)}${joinControl(view.groupId, viewer)}`)
  }
  const challenge = view.challenge
  const range =
    challenge.phase === 'active' ? '' : `<p>${escapeHtml(headcountSentence(challenge.floor, challenge.cap))}</p>`
  const terms =
    challenge.phase === 'active'
      ? termsText(challenge.terms, challenge.minorDigits)
      : termsForm(
          view.groupId,
          challenge.currencies,
          attempt?.draft
            ? termsFromDraft(attempt.draft)
            : challenge.phase === 'draft'
              ? termsFromStored(challenge.terms, challenge.minorDigits)
              : emptyTerms,
        )
  const start =
    challenge.phase === 'draft' ? startForm(view.groupId, view.activeCount, challenge.floor, challenge.cap) : ''
  const userId = viewer.state === 'signed_in' ? viewer.account.id : ''
  const rhythm = rhythmControl(view.groupId, challenge, userId, attempt?.rhythmDraft)
  const checkIn = checkInControl(view.groupId, challenge, userId, attempt?.checkInDay)
  const rhythms = challenge.phase === 'unopened' ? [] : challenge.rhythms
  const share = escapeHtml(`${origin}${groupHref(view.groupId)}`)
  return groupCard(`
    ${title}
    ${count}
    ${failure}
    ${range}
    ${terms}
    ${start}
    ${rhythm}
    ${checkIn}
    <ul class="members">${view.members.map((member) => memberItem(member, rhythms)).join('')}</ul>
    ${view.ledger ? calendarGrid(view.ledger.calendar) : ''}
    ${view.ledger ? balancesSection(view.groupId, view.ledger, userId, attempt?.paymentDraft) : ''}
    ${checkInList(view.checkIns)}
    ${dropoutForm(view, userId, attempt?.dropoutDraft)}
    <p class="share">Share this link to invite someone. <a href="${share}">${share}</a></p>
  `)
}

export function renderFailure(failure: AuthFailure): string {
  return renderMessage('Sign-in did not finish', authFailureCopy[failure])
}

export function renderMessage(title: string, text: string): string {
  const screens = `
    <section class="screen is-current">
      <article class="card">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(text)}</p>
        <a class="button" href="/">Back</a>
      </article>
    </section>
  `
  return frame(screens, tabBar('/', '/#account'))
}

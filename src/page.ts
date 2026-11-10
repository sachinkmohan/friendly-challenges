import {
  paymentFailureCopy,
  type GroupLedger,
  type Standing,
  type Ledger,
  type Payment,
  type PaymentFailure,
  type PaymentInput,
  type SoloLedger,
} from './balances.ts'
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
  type CreateChallengeInput,
  type CreateChallengeResult,
  type MemberChallengeCard,
  type Rhythm,
  type RhythmInput,
  type RhythmLine,
  type StakesGo,
  type StartKind,
  type StartStep,
} from './challenge.ts'
import { CURRENCY_CODES } from './currencies.ts'
import { BADGE_EMOJIS, type Badge, type BadgeEmoji } from './badges.ts'
import { DAY_MARK_LABELS, type GroupCalendar, type Heatmap, type MarkedDay, type RowMember } from './calendar.ts'
import { dropoutFailureCopy, type DropoutFailure, type DropoutInput } from './dropouts.ts'
import { CHECK_IN_LABELS, checkInFailureCopy, type CheckIn, type CheckInFailure } from './checkins.ts'
import { deleteFailureCopy, dropNameFailureCopy, parseGroupId, type DeleteFailure, type DropNameFailure, type GroupId, type GroupView, type HomeGroup, type MemberLine } from './groups.ts'
import type { Browser, Os } from './browser.ts'
import { authFailureCopy, type Account, type AuthFailure, type Viewer } from './identity.ts'
import { installCard, installHead, installPrompt, installScript } from './install.ts'

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

function toastRegion(text: string | null): string {
  if (text === null) return ''
  return `<div class="toast" role="status" aria-live="polite">
          <p>${escapeHtml(text)}</p>
          <button class="toast-close" type="button" aria-label="Dismiss" hidden>&times;</button>
        </div>`
}

const frame = (screens: string, tabs: string, toast: string | null = null) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#fffdf8">
  ${installHead}
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
      position: relative;
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
    ul.groups { margin-top: 8px; }
    ul.groups li + li { margin-top: 8px; }
    ul.groups a {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-height: 56px;
      padding: 0 12px 0 16px;
      border: 1px solid #e7e0d4;
      border-radius: 14px;
      background: #f6f1e8;
      color: #1c1915;
      text-decoration: none;
      touch-action: manipulation;
    }
    ul.groups a:active { background: #efe8dc; }
    .group-name { flex: 1; min-width: 0; font-weight: 650; overflow-wrap: anywhere; }
    .chevron { color: #8a8378; font-size: 22px; line-height: 1; }
    .section-title { margin-top: 16px; font-weight: 650; color: #1c1915; }
    .new-group { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e7e0d4; }
    .new-group .section-title { margin-top: 0; }
    .install { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e7e0d4; }
    .install .section-title { margin-top: 0; }
    .install .field-hint { margin-top: 8px; }
    .install-card { margin-bottom: 16px; }
    .install-steps { margin: 8px 0 0; color: #5c564c; }
    ol.install-steps { padding-left: 22px; }
    .install-steps li + li { margin-top: 4px; }
    .install-steps + .field-hint { margin-top: 8px; }
    .install-icon { vertical-align: middle; margin-top: -3px; color: #1c1915; }
    .new-group a.button { background: #fffdf8; color: #1c1915; box-shadow: inset 0 0 0 1.5px #1c1915; }
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
    .check-in-colors button:disabled { opacity: 0.45; cursor: progress; }
    .check-in-colors button.is-saving { opacity: 1; }
    button.danger { background: #b3392f; }
    label.confirm { gap: 12px; font-weight: 400; }
    label.confirm input { width: 20px; min-height: 20px; margin: 0; flex: none; }
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
    .field-hint { font-size: 14px; line-height: 1.4; }
    .start-steps { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
    .start-steps li { display: flex; gap: 8px; color: #1c1915; }
    .start-steps .mark { flex: none; width: 20px; font-weight: 650; color: #8a8378; }
    .start-steps li[data-done="true"] { color: #5c564c; }
    .start-steps li[data-done="true"] .mark { color: #2f7d4a; }
    #start { scroll-margin-top: 72px; }
    #start .field-hint { margin-top: 8px; }
    .start-error { margin-top: 8px; color: #b3392f; font-weight: 650; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
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
    ul.standings { list-style: none; display: flex; gap: 4px; margin: 12px 0 0; padding: 0; }
    ul.standings li { flex: 1 1 0; min-width: 0; }
    .row-badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      min-width: 0;
      color: #1c1915;
      text-decoration: none;
      touch-action: manipulation;
    }
    .row-badge .avatar { width: 44px; height: 44px; }
    a.row-badge .avatar { box-shadow: inset 0 0 0 2px #1c1915; }
    .badge-emoji { font-size: 24px; line-height: 1; }
    .badge-initials { font-size: 16px; }
    .badge-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 650; }
    .bags { max-width: 100%; font-size: 11px; line-height: 1.2; text-align: center; word-break: break-all; color: #5c564c; }
    .badge-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 16px; }
    .badge-grid button { width: auto; min-height: 52px; margin: 0; padding: 0; background: #f6f1e8; color: #1c1915; font-size: 26px; }
    .badge-grid button[aria-pressed="true"], button.secondary[aria-pressed="true"] { box-shadow: inset 0 0 0 2px #1c1915; background: #efe8dc; }
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
    .in-app { margin-top: 16px; padding: 16px; border-radius: 14px; background: #f6efe2; }
    .in-app p { margin: 0; }
    .in-app .field-hint { margin-top: 8px; }
    .in-app-link {
      display: block;
      width: 100%;
      min-height: 48px;
      margin-top: 12px;
      padding: 0 12px;
      border: 1.5px solid #e7e0d4;
      border-radius: 12px;
      background: #fffdf8;
      color: #1c1915;
      font: inherit;
      font-size: 16px;
    }
    button.secondary { background: #fffdf8; color: #1c1915; box-shadow: inset 0 0 0 1.5px #1c1915; }
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
    .toast {
      position: absolute;
      top: 64px;
      left: 12px;
      right: 12px;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 8px 12px 16px;
      border-radius: 14px;
      background: #1c1915;
      color: #fffdf8;
      font-size: 15px;
      box-shadow: 0 10px 30px rgba(28, 25, 21, 0.3);
    }
    .toast p { flex: 1; margin: 0; color: inherit; }
    .toast-close {
      flex: none;
      width: 32px;
      height: 32px;
      min-height: 0;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
    }
    .toast-close[hidden], .install-app[hidden] { display: none; }
    .toast .toast-close:focus-visible { outline-color: #fffdf8; }
    @media (prefers-reduced-motion: no-preference) {
      .toast { animation: toast-in 200ms ease-out; }
      @keyframes toast-in {
        from { opacity: 0; transform: translateY(-8px); }
      }
    }
    @media (max-width: 500px), (max-height: 500px) {
      html, body, .stage { height: auto; overflow: visible; }
      body { background: #efeae1; }
      .stage { display: block; }
      .device { width: 100%; height: auto; padding: 0; border-radius: 0; box-shadow: none; }
      .phone { height: auto; min-height: 100dvh; overflow: visible; border-radius: 0; }
      .appbar { position: sticky; top: 0; z-index: 1; }
      .toast { position: fixed; }
      .screens { overflow: visible; }
      .tabbar { position: sticky; bottom: 0; height: calc(64px + 88px + env(safe-area-inset-bottom)); padding-bottom: calc(88px + env(safe-area-inset-bottom)); }
      .indicator { display: none; }
    }
  </style>
</head>
<body>
  <div class="stage">
    <div class="device">
      <div class="phone">
        <header class="appbar">
          <h1>Friendly challenges</h1>
        </header>
        ${toastRegion(toast)}
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
    document.querySelectorAll('.toast').forEach(function (toast) {
      var close = toast.querySelector('.toast-close')
      var hide = function () { toast.remove() }
      close.hidden = false
      close.addEventListener('click', hide)
      setTimeout(hide, 4000)
    })
    ${installScript}
  </script>
  <script type="module">
    const forms = document.querySelectorAll('form.sign-in')
    const blockedHere = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported']
    const showError = (form, text) => {
      const error = form.querySelector('.sign-in-error')
      error.textContent = text
      error.hidden = false
    }
    document.querySelectorAll('.in-app').forEach((card) => {
      const field = card.querySelector('.in-app-link')
      const copy = card.querySelector('.copy-link')
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(field.value)
          copy.textContent = 'Copied'
        } catch {
          field.focus()
          field.setSelectionRange(0, field.value.length)
          copy.textContent = 'Press and hold the link to copy it'
        }
      })
    })
    // An installed iOS app has no Safari token in its user agent, so the server took it for an in-app browser.
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) {
      document.querySelectorAll('.in-app').forEach((card) => { card.hidden = true })
      document.querySelectorAll('button.google').forEach((button) => {
        button.classList.remove('secondary')
        button.textContent = 'Sign in with Google'
      })
    }
    if (forms.length > 0) {
      try {
        const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup, signOut }] = await Promise.all([
          import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js'),
        ])
        const auth = getAuth(initializeApp(JSON.parse(forms[0].dataset.firebase)))
        forms.forEach((form) => {
          form.querySelector('button.google').addEventListener('click', async () => {
            form.querySelector('.sign-in-error').hidden = true
            const provider = new GoogleAuthProvider()
            provider.setCustomParameters({ prompt: 'select_account' })
            try {
              const result = await signInWithPopup(auth, provider)
              form.elements.idToken.value = await result.user.getIdToken()
              await signOut(auth)
              form.submit()
            } catch (error) {
              const code = String((error && error.code) || 'unknown')
              console.error(error)
              if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
                showError(form, 'Sign-in did not finish. Try again.')
              } else if (blockedHere.includes(code)) {
                form.querySelector('.in-app').hidden = false
                showError(form, 'This browser blocked the Google sign-in window (' + code + ').')
              } else {
                showError(form, 'Sign-in did not finish (' + code + '). Try again.')
              }
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
const deleteSuffix = '/delete'
const dropNameSuffix = '/drop-name'
export const badgePath = '/badge'

export type HomePage =
  | Extract<Viewer, { state: 'signed_out' }>
  | { state: 'signed_in'; account: Account; groups: readonly HomeGroup[]; heatmaps: readonly Heatmap[]; browser: Browser }

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
  | { kind: 'delete_group'; groupId: GroupId }
  | { kind: 'drop_group_name'; groupId: GroupId }

export function groupHref(groupId: GroupId): string {
  return `${groupsRoot}/${groupId}`
}

function activeCountText(count: number): string {
  return `${count} active`
}

type SignedOut = Extract<Viewer, { state: 'signed_out' }>

function openInBrowserHelp(link: URL, os: Os): string {
  if (os === 'android') {
    const intent = `intent://${link.host}${link.pathname}${link.search}#Intent;scheme=${link.protocol.slice(0, -1)};end`
    return `<a class="button" href="${escapeHtml(intent)}">Open in your browser</a>`
  }
  if (os === 'ios') return '<p class="field-hint">Or tap ⋯ or the share icon, then Open in browser.</p>'
  return '<p class="field-hint">Then paste it into your browser.</p>'
}

function inAppCard(link: URL, browser: Browser): string {
  return `<div class="in-app"${browser.inApp ? '' : ' hidden'}>
        <p><strong>Google sign-in does not work here.</strong> Open this link in your browser to sign in.</p>
        <input class="in-app-link" type="text" readonly value="${escapeHtml(link.href)}" aria-label="Link to this page">
        <button type="button" class="copy-link">Copy link</button>
        ${openInBrowserHelp(link, browser.os)}
      </div>`
}

function signInControl(viewer: SignedOut, returnPath: string): string {
  if (!viewer.firebase) return '<p>Sign-in is not configured. Set FIREBASE_API_KEY and FIREBASE_AUTH_DOMAIN.</p>'
  const link = new URL(returnPath, `${viewer.origin}/`)
  const label = viewer.browser.inApp ? 'Try Google sign-in anyway' : 'Sign in with Google'
  return `<form class="sign-in" method="post" action="/auth/firebase" data-firebase="${escapeHtml(JSON.stringify(viewer.firebase))}">
      <input type="hidden" name="return" value="${escapeHtml(returnPath)}">
      <input type="hidden" name="idToken">
      ${inAppCard(link, viewer.browser)}
      <button type="button" class="google${viewer.browser.inApp ? ' secondary' : ''}">${label}</button>
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
    | 'delete_group'
    | 'drop_group_name'
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
    routeSuffix(rest, deleteSuffix, 'delete_group') ??
    routeSuffix(rest, dropNameSuffix, 'drop_group_name') ??
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
  if (raw === badgePath) return badgePath
  return '/'
}

function homeGroups(groups: readonly HomeGroup[]): string {
  if (groups.length === 0) return '<p>You are not in a challenge yet.</p>'
  const items = groups
    .map((group) => {
      const href = escapeHtml(groupHref(group.groupId))
      const name = escapeHtml(group.label)
      return `<li><a href="${href}"><span class="group-name">${name}</span><span class="count">${activeCountText(group.activeCount)}</span><span class="chevron" aria-hidden="true">›</span></a></li>`
    })
    .join('')
  return `<p class="section-title">Your challenges</p><ul class="groups">${items}</ul>`
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

function badgeCircle(badge: Badge): string {
  if (badge.kind === 'emoji') return `<span class="avatar badge-emoji" aria-hidden="true">${escapeHtml(badge.emoji)}</span>`
  return `<span class="avatar badge-initials" aria-hidden="true">${escapeHtml(badge.initials)}</span>`
}

const STANDING_WORDS = { ahead: 'ahead', behind: 'behind', even: 'even' } as const

function standingLine(standing: Standing): string {
  if (standing.kind === 'even') return '<span class="bags" aria-hidden="true">—</span>'
  const bag = standing.kind === 'ahead' ? '💰' : '💸'
  return `<span class="bags" aria-hidden="true">${bag.repeat(standing.bags)}</span>`
}

// The row never shows amounts: only who is ahead and by roughly how much, in bags.
function rowItem(member: RowMember): string {
  const label = member.standing ? `${member.firstName}, ${STANDING_WORDS[member.standing.kind]}` : member.firstName
  const bags = member.standing ? standingLine(member.standing) : ''
  const kind = member.standing?.kind ?? 'none'
  const body = `${badgeCircle(member.badge)}<span class="badge-name" aria-hidden="true">${escapeHtml(member.firstName)}</span>${bags}`
  const item = member.isViewer
    ? `<a class="row-badge" href="${badgePath}" aria-label="${escapeHtml(`${label}. Change your badge`)}">${body}</a>`
    : `<span class="row-badge" role="img" aria-label="${escapeHtml(label)}">${body}</span>`
  return `<li data-member="${escapeHtml(member.userId)}" data-standing="${kind}">${item}</li>`
}

function standingsRow(heatmap: Heatmap): string {
  if (!heatmap.members) return ''
  const started = heatmap.members.some((member) => member.standing !== null)
  const label = `${started ? 'Standing in' : 'Members of'} ${heatmap.name}`
  return `<ul class="standings" aria-label="${escapeHtml(label)}" data-group="${escapeHtml(heatmap.groupId)}">${heatmap.members.map(rowItem).join('')}</ul>`
}

function heatmapBlock(heatmap: Heatmap): string {
  return `${heatmapGrid(heatmap)}${standingsRow(heatmap)}`
}

function signedOutScreens(viewer: SignedOut): string {
  return `
    <section id="home" class="screen">
      <article class="card">
        <h2>Sign in</h2>
        <p>Sign in with the Google account you will use for your challenges.</p>
        ${signInControl(viewer, '/')}
      </article>
    </section>
    <section id="account" class="screen">
      <article class="card">
        <h2>Account</h2>
        <p>No account on this device yet. Google sign-in stores one account for this app.</p>
        ${signInControl(viewer, '/')}
        ${installPrompt(viewer.browser.iosInstall)}
      </article>
    </section>
  `
}

function signedInScreens(page: Extract<HomePage, { state: 'signed_in' }>): string {
  const { account, groups, heatmaps, browser } = page
  const name = escapeHtml(account.displayName)
  const email = escapeHtml(account.email)
  return `
    <section id="home" class="screen">
      ${browser.iosInstall ? installCard(browser.iosInstall) : ''}
      <article class="card">
        <h2>Hello, ${name}</h2>
        ${homeGroups(groups)}
        ${heatmaps.map(heatmapBlock).join('')}
        <div class="new-group">
          <p class="section-title">Start something new</p>
          <p class="field-hint">Set the terms, then invite up to 4 friends or go solo.</p>
          <a class="button" href="${groupsRoot}/new">Create a challenge</a>
        </div>
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
        ${installPrompt(browser.iosInstall)}
      </article>
    </section>
  `
}

export function renderHome(page: HomePage, toast: string | null = null): string {
  const screens = page.state === 'signed_out' ? signedOutScreens(page) : signedInScreens(page)
  return frame(screens, tabBar('#home', '#account'), toast)
}

function groupCard(body: string, toast: string | null = null): string {
  const screens = `
    <section class="screen is-current">
      <article class="card">
        ${body}
      </article>
    </section>
  `
  return frame(screens, tabBar('/', '/#account'), toast)
}

type CreateChallengeFailure = Extract<CreateChallengeResult, { ok: false }>['failure']

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
  startFailure?: ChallengeFailure
  checkInFailure?: CheckInFailure
  paymentFailure?: PaymentFailure
  paymentDraft?: PaymentInput
  dropoutFailure?: DropoutFailure
  dropoutDraft?: DropoutInput
  deleteFailure?: DeleteFailure
  dropNameFailure?: DropNameFailure
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

function startStepText(step: StartStep, cap: number, missing: readonly string[], start: StartKind | null): string {
  if (step === 'terms_saved') return 'Save the challenge name, type, stake, and dates.'
  if (step === 'rhythms_picked') {
    return missing.length === 0 ? 'Everyone picked a rhythm.' : `Everyone picked a rhythm. Waiting on ${missing.join(', ')}.`
  }
  if (start === 'solo') return 'Just you, as a solo challenge.'
  return `2 to ${cap} people are active.`
}

function failureParagraph(attempt?: ChallengeAttempt): string {
  if (attempt?.failure) return `<p>${escapeHtml(challengeFailureCopy[attempt.failure])}</p>`
  if (attempt?.checkInFailure) return `<p>${escapeHtml(checkInFailureCopy[attempt.checkInFailure])}</p>`
  if (attempt?.paymentFailure) return `<p>${escapeHtml(paymentFailureCopy[attempt.paymentFailure])}</p>`
  if (attempt?.dropoutFailure) return `<p>${escapeHtml(dropoutFailureCopy[attempt.dropoutFailure])}</p>`
  if (attempt?.deleteFailure) return `<p>${escapeHtml(deleteFailureCopy[attempt.deleteFailure])}</p>`
  if (attempt?.dropNameFailure) return `<p>${escapeHtml(dropNameFailureCopy[attempt.dropNameFailure])}</p>`
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

function stakesGoText(stakesGo: StakesGo): string {
  if (stakesGo?.kind !== 'cause') return ''
  return `<p>Missed days are owed to ${escapeHtml(stakesGo.name)}.</p>`
}

function termsText(terms: ChallengeTerms, minorDigits: number, stakesGo: StakesGo): string {
  const start = escapeHtml(terms.startsOn)
  const end = escapeHtml(terms.endsOn)
  return `<p>${escapeHtml(terms.name)}</p>
    <p>${escapeHtml(typeLabel(terms.type))}</p>
    <p><time datetime="${start}">${start}</time> to <time datetime="${end}">${end}</time></p>
    <p>${escapeHtml(formatStake(terms.stakeMinor, minorDigits))} ${escapeHtml(terms.currency)}</p>
    ${stakesGoText(stakesGo)}`
}

function termsFields(currencies: readonly string[], values: TermValues): string {
  return `<label for="challenge-name">Challenge name</label>
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
      <input id="challenge-end" name="ends_on" type="date" value="${escapeHtml(values.endsOn)}">`
}

function termsForm(groupId: GroupId, currencies: readonly string[], values: TermValues): string {
  const action = escapeHtml(`${groupHref(groupId)}/challenge`)
  return `<form method="post" action="${action}">
      ${termsFields(currencies, values)}
      <button type="submit">Save challenge</button>
    </form>`
}

export function renderNewChallenge(viewer: Viewer, failure?: CreateChallengeFailure, draft?: CreateChallengeInput): string {
  if (viewer.state === 'signed_out') {
    return groupCard(`
      <h2>Create a challenge</h2>
      <p>Sign in to create a challenge.</p>
      ${signInControl(viewer, `${groupsRoot}/new`)}
    `)
  }
  const message = failure ? `<p class="start-error" role="alert">${escapeHtml(challengeFailureCopy[failure])}</p>` : ''
  const values = draft ? termsFromDraft(draft) : emptyTerms
  const solo = draft?.solo ? ' checked' : ''
  return groupCard(`
    <h2>Create a challenge</h2>
    <p>Set the terms and how often you log. Invite friends from the challenge page, or make it solo.</p>
    ${message}
    <form method="post" action="${groupsRoot}">
      ${termsFields(CURRENCY_CODES, values)}
      <label for="rhythm-interval">How often you log</label>
      <select id="rhythm-interval" name="interval">${intervalOptions(draft?.interval ?? '')}</select>
      <label class="confirm"><input type="checkbox" id="challenge-solo" name="solo" value="yes"${solo}> Solo: just me, nobody can join</label>
      <div id="cause-field">
        <label for="challenge-cause">Who your missed days are owed to</label>
        <input id="challenge-cause" name="cause" value="${escapeHtml(draft?.cause ?? '')}" autocomplete="off">
        <p class="field-hint">Only for a solo challenge. You pay this cause yourself, outside the app.</p>
      </div>
      <button type="submit">Create challenge</button>
    </form>
    <script>
      (function () {
        var solo = document.getElementById('challenge-solo')
        var cause = document.getElementById('cause-field')
        if (!solo || !cause) return
        var sync = function () { cause.hidden = !solo.checked }
        solo.addEventListener('change', sync)
        sync()
      })()
    </script>
  `)
}

function rhythmText(rhythm: Rhythm): string {
  return `<p>${escapeHtml(RHYTHM_LABELS[rhythm.kind])}</p>`
}

function rhythmForm(groupId: GroupId, interval: string, prompt: string): string {
  const action = escapeHtml(`${groupHref(groupId)}/rhythm`)
  const title = prompt ? `<p class="section-title">${escapeHtml(prompt)}</p>` : ''
  return `<form method="post" action="${action}">
      ${title}
      <label for="rhythm-interval">How often you log</label>
      <select id="rhythm-interval" name="interval">${intervalOptions(interval)}</select>
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
  const prompt = slot.mode === 'first' ? 'Pick your rhythm to start logging' : stored ? '' : 'Pick your rhythm'
  return rhythmForm(groupId, posted?.interval ?? stored?.kind ?? '', prompt)
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
  return `<form class="check-in" method="post" action="${action}">
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
        if (!input) return
        var now = new Date()
        var pad = function (n) { return String(n).padStart(2, '0') }
        var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
        if (today < input.max) input.max = today
        if (!input.value) input.value = today
      })()
      ;(function () {
        var form = document.querySelector('form.check-in')
        if (!form) return
        var buttons = Array.prototype.slice.call(form.querySelectorAll('.check-in-colors button'))
        var labels = buttons.map(function (button) { return button.textContent })
        // A disabled button's value is left out of the post, so the tapped color rides in a hidden field.
        var color = document.createElement('input')
        color.type = 'hidden'
        form.addEventListener('submit', function (event) {
          var tapped = event.submitter
          if (!tapped || buttons.indexOf(tapped) < 0) return
          color.name = tapped.name
          color.value = tapped.value
          form.appendChild(color)
          form.setAttribute('aria-busy', 'true')
          buttons.forEach(function (button) { button.disabled = true })
          tapped.classList.add('is-saving')
          tapped.textContent = 'Saving…'
        })
        window.addEventListener('pageshow', function (event) {
          if (!event.persisted) return
          color.remove()
          form.removeAttribute('aria-busy')
          buttons.forEach(function (button, index) {
            button.disabled = false
            button.classList.remove('is-saving')
            button.textContent = labels[index]
          })
        })
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

function netItem(ledger: GroupLedger, line: GroupLedger['nets'][number]): string {
  const name = escapeHtml(line.displayName)
  const amount = escapeHtml(money(ledger, Math.abs(line.netMinor)))
  const sign = line.netMinor > 0 ? 'owed' : line.netMinor < 0 ? 'owes' : 'even'
  const text =
    sign === 'owed' ? `is owed ${amount}` : sign === 'owes' ? `owes ${amount}` : 'is even'
  return `<li data-net="${escapeHtml(line.userId)}" data-minor="${line.netMinor}"><span class="member-name">${name}</span> <span class="net ${sign}">${text}</span></li>`
}

function openItem(ledger: GroupLedger, line: GroupLedger['open'][number]): string {
  const amount = escapeHtml(money(ledger, line.amountMinor))
  return `<li data-open="${escapeHtml(line.debtorId)}:${escapeHtml(line.creditorId)}" data-minor="${line.amountMinor}">${escapeHtml(line.debtorName)} owes ${escapeHtml(line.creditorName)} ${amount}</li>`
}

function paymentItem(ledger: Ledger, payment: Payment): string {
  const when = escapeHtml(payment.paidOn)
  const refLabel = ledger.kind === 'solo' ? 'Reference' : 'PayPal'
  const ref = payment.paypalRef ? ` <span class="count">${refLabel} ${escapeHtml(payment.paypalRef)}</span>` : ''
  return `<li><span class="member-name">${escapeHtml(payment.payerName)} paid ${escapeHtml(payment.payeeName)} ${escapeHtml(money(ledger, payment.amountMinor))} <time datetime="${when}">${when}</time></span>${ref}</li>`
}

function paymentFields(ledger: Ledger, draft: PaymentInput | undefined, refLabel: string): string {
  return `<label for="payment-amount">Amount in ${escapeHtml(ledger.currency)}</label>
      <input id="payment-amount" name="amount" value="${escapeHtml(draft?.amount ?? '')}" inputmode="decimal" autocomplete="off" required>
      <label for="payment-date">Date paid</label>
      <input id="payment-date" name="paid_on" type="date" value="${escapeHtml(draft?.paidOn ?? '')}" required>
      <label for="payment-ref">${refLabel} (optional)</label>
      <input id="payment-ref" name="paypal_ref" value="${escapeHtml(draft?.paypalRef ?? '')}" autocomplete="off">
      <button type="submit">Record payment</button>`
}

function paymentForm(groupId: GroupId, ledger: GroupLedger, userId: string, draft: PaymentInput | undefined): string {
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
      ${paymentFields(ledger, draft, 'PayPal reference')}
    </form>`
}

function paymentList(ledger: Ledger): string {
  if (ledger.payments.length === 0) return ''
  return `<p class="check-ins-title">Payments</p><ul class="check-ins payments">${ledger.payments.map((item) => paymentItem(ledger, item)).join('')}</ul>`
}

function soloBalances(groupId: GroupId, ledger: SoloLedger, draft: PaymentInput | undefined): string {
  const name = escapeHtml(ledger.member.displayName)
  const cause = escapeHtml(ledger.cause)
  const amount = escapeHtml(money(ledger, Math.abs(ledger.dueMinor)))
  const sign = ledger.dueMinor > 0 ? 'owes' : ledger.dueMinor < 0 ? 'owed' : 'even'
  const text =
    sign === 'owes' ? `owes ${cause} ${amount}` : sign === 'owed' ? `has paid ${cause} ${amount} ahead` : `is even with ${cause}`
  const due = `<ul class="check-ins balances"><li data-due="${ledger.dueMinor}"><span class="member-name">${name}</span> <span class="net ${sign}">${text}</span></li></ul>`
  const action = escapeHtml(`${groupHref(groupId)}${paymentSuffix}`)
  const form = `<form method="post" action="${action}">
      <p class="grid-title">Record a payment you made</p>
      <p>The app does not send money. Record a payment that already happened.</p>
      <p>Paid to ${cause}</p>
      ${paymentFields(ledger, draft, 'Reference')}
    </form>`
  return `<p class="check-ins-title">Balance</p>${due}${form}${paymentList(ledger)}`
}

function groupBalances(groupId: GroupId, ledger: GroupLedger, userId: string, draft: PaymentInput | undefined): string {
  const nets = `<ul class="check-ins balances">${ledger.nets.map((line) => netItem(ledger, line)).join('')}</ul>`
  const open =
    ledger.open.length === 0
      ? '<p>Nobody owes anyone.</p>'
      : `<ul class="check-ins open-amounts">${ledger.open.map((line) => openItem(ledger, line)).join('')}</ul>`
  return `<p class="check-ins-title">Balances</p>${nets}<p class="check-ins-title">Who owes whom</p>${open}${paymentForm(groupId, ledger, userId, draft)}${paymentList(ledger)}`
}

function balancesSection(groupId: GroupId, ledger: Ledger, userId: string, draft: PaymentInput | undefined): string {
  return ledger.kind === 'solo' ? soloBalances(groupId, ledger, draft) : groupBalances(groupId, ledger, userId, draft)
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

function deleteForm(view: Extract<GroupView, { kind: 'members' }>, userId: string): string {
  if (userId !== view.creatorId) return ''
  const action = escapeHtml(`${groupHref(view.groupId)}${deleteSuffix}`)
  return `<form method="post" action="${action}">
      <p class="grid-title">Delete this challenge</p>
      <p>This removes the challenge, every check-in, and every payment for everyone. It cannot be undone.</p>
      <label class="confirm"><input type="checkbox" name="confirm" value="yes" required> Delete it for everyone</label>
      <button type="submit" class="danger">Delete challenge</button>
    </form>`
}

function dropNameForm(view: Extract<GroupView, { kind: 'members' }>, challenge: MemberChallengeCard, userId: string): string {
  if (userId !== view.creatorId || !view.hasGroupName || challenge.phase === 'unopened') return ''
  const action = escapeHtml(`${groupHref(view.groupId)}${dropNameSuffix}`)
  return `<form method="post" action="${action}">
      <p class="field-hint">It still shows the name you first gave it. The challenge is called ${escapeHtml(challenge.terms.name)}.</p>
      <button type="submit" class="secondary">Use the challenge name instead</button>
    </form>`
}

function startForm(groupId: GroupId): string {
  const action = escapeHtml(`${groupHref(groupId)}${challengeStartSuffix}#start`)
  return `<form method="post" action="${action}"><button type="submit">Start challenge</button></form>`
}

function startStepItem(step: StartStep, done: boolean, cap: number, missing: readonly string[], start: StartKind | null): string {
  const mark = done ? '✓' : '○'
  const state = done ? 'Done.' : 'Not done yet.'
  return `<li data-done="${done}"><span class="mark" aria-hidden="true">${mark}</span><span>${escapeHtml(startStepText(step, cap, missing, start))} <span class="sr-only">${state}</span></span></li>`
}

function startSection(
  groupId: GroupId,
  challenge: Exclude<MemberChallengeCard, { phase: 'active' }>,
  creator: Creator,
  missing: readonly string[],
  failure: ChallengeFailure | undefined,
): string {
  const start = challenge.phase === 'draft' ? challenge.start : null
  const steps = challenge.checks.map((check) => startStepItem(check.step, check.done, challenge.cap, missing, start)).join('')
  const ready = challenge.phase === 'draft' && challenge.checks.every((check) => check.done)
  const alert = failure ? `<p class="start-error" role="alert">${escapeHtml(challengeFailureCopy[failure])}</p>` : ''
  const control = !creator.isViewer
    ? `<p class="field-hint">Waiting for ${escapeHtml(creator.name)} to start.</p>`
    : ready
      ? startForm(groupId)
      : '<p class="field-hint">Start challenge appears here once every step above is done.</p>'
  return `<div id="start" role="group" aria-labelledby="start-title">
      <p class="section-title" id="start-title">Before you start</p>
      <ul class="start-steps">${steps}</ul>
      ${alert}
      ${control}
    </div>`
}

function missingNames(members: readonly MemberLine[], missing: readonly string[]): readonly string[] {
  return members.filter((member) => missing.includes(member.userId)).map((member) => member.displayName)
}

type Creator = { readonly isViewer: boolean; readonly name: string }

function termsBlock(
  groupId: GroupId,
  challenge: MemberChallengeCard,
  creator: Creator,
  draft: ChallengeInput | undefined,
): string {
  if (creator.isViewer && challenge.phase !== 'active') {
    const values = draft
      ? termsFromDraft(draft)
      : challenge.phase === 'draft'
        ? termsFromStored(challenge.terms, challenge.minorDigits)
        : emptyTerms
    const solo = challenge.phase === 'draft' ? stakesGoText(challenge.stakesGo) : ''
    return `${solo}${termsForm(groupId, challenge.currencies, values)}`
  }
  if (challenge.phase === 'unopened') return `<p>Waiting for ${escapeHtml(creator.name)} to set the terms.</p>`
  const stakesGo = challenge.stakesGo
  const setBy = creator.isViewer ? '' : `<p class="field-hint">Set by ${escapeHtml(creator.name)}.</p>`
  return `${termsText(challenge.terms, challenge.minorDigits, stakesGo)}${setBy}`
}

function memberItem(member: MemberLine, rhythms: readonly RhythmLine[]): string {
  const when = escapeHtml(member.joinedOn)
  const rhythm = rhythms.find((line) => line.userId === member.userId)
  const logged = rhythm ? `<span class="rhythm">${escapeHtml(RHYTHM_LABELS[rhythm.kind])}</span>` : ''
  return `<li>${portrait(member)} <span class="member-name">${escapeHtml(member.displayName)} <time datetime="${when}">${when}</time></span>${logged}</li>`
}

function joinControl(groupId: GroupId, viewer: Viewer): string {
  if (viewer.state === 'signed_out') return signInControl(viewer, groupHref(groupId))
  const action = escapeHtml(`${groupHref(groupId)}${joinSuffix}`)
  return `<form method="post" action="${action}"><button type="submit">Join challenge</button></form>`
}

function headlineText(headline: ChallengeHeadline | null): string {
  if (!headline) return ''
  return termsText(headline.terms, headline.minorDigits, headline.stakesGo)
}

export function renderGroup(
  view:
    | (Extract<GroupView, { kind: 'preview' | 'full' | 'solo' }> & { readonly headline: ChallengeHeadline | null })
    | (Extract<GroupView, { kind: 'members' }> & {
        readonly challenge: MemberChallengeCard
        readonly checkIns: readonly CheckIn[]
        readonly ledger: Ledger | null
      }),
  viewer: Viewer,
  origin: string,
  attempt?: ChallengeAttempt,
  toast: string | null = null,
): string {
  const title = `<h2>${escapeHtml(view.label)}</h2>`
  const count = `<p class="count">${activeCountText(view.activeCount)}</p>`
  const failure = failureParagraph(attempt)
  if (view.kind === 'full') {
    return groupCard(`${title}${count}${failure}${headlineText(view.headline)}<p>This challenge is full.</p>`, toast)
  }
  if (view.kind === 'solo') {
    return groupCard(
      `${title}${count}${failure}${headlineText(view.headline)}<p>This is a solo challenge, so nobody can join it.</p>`,
      toast,
    )
  }
  if (view.kind === 'preview') {
    return groupCard(`${title}${count}${failure}${headlineText(view.headline)}${joinControl(view.groupId, viewer)}`, toast)
  }
  const challenge = view.challenge
  const userId = viewer.state === 'signed_in' ? viewer.account.id : ''
  const creatorName = view.members.find((member) => member.userId === view.creatorId)?.displayName ?? 'the creator'
  const creator = { isViewer: userId === view.creatorId, name: creatorName }
  const terms = termsBlock(view.groupId, challenge, creator, attempt?.draft)
  const start =
    challenge.phase === 'active'
      ? ''
      : startSection(
          view.groupId,
          challenge,
          creator,
          missingNames(view.members, challenge.missingRhythms),
          attempt?.startFailure,
        )
  const rhythm = rhythmControl(view.groupId, challenge, userId, attempt?.rhythmDraft)
  const checkIn = checkInControl(view.groupId, challenge, userId, attempt?.checkInDay)
  const rhythms = challenge.phase === 'unopened' ? [] : challenge.rhythms
  const share = escapeHtml(`${origin}${groupHref(view.groupId)}`)
  return groupCard(`
    ${title}
    ${count}
    ${dropNameForm(view, challenge, userId)}
    ${failure}
    ${terms}
    ${rhythm}
    ${start}
    ${checkIn}
    <ul class="members">${view.members.map((member) => memberItem(member, rhythms)).join('')}</ul>
    ${view.ledger ? calendarGrid(view.ledger.calendar) : ''}
    ${view.ledger ? balancesSection(view.groupId, view.ledger, userId, attempt?.paymentDraft) : ''}
    ${checkInList(view.checkIns)}
    ${dropoutForm(view, userId, attempt?.dropoutDraft)}
    ${deleteForm(view, userId)}
    <p class="share">Share this link to invite someone. <a href="${share}">${share}</a></p>
  `, toast)
}

export type BadgePage =
  | SignedOut
  | { readonly state: 'signed_in'; readonly badge: Badge; readonly initials: string; readonly failed?: boolean }

export function renderBadge(page: BadgePage): string {
  if (page.state === 'signed_out') {
    return groupCard(`
      <h2>Your badge</h2>
      <p>Sign in to pick your badge.</p>
      ${signInControl(page, badgePath)}
    `)
  }
  const chosen: BadgeEmoji | null = page.badge.kind === 'emoji' ? page.badge.emoji : null
  const message = page.failed ? '<p class="start-error" role="alert">Pick one of the badges below.</p>' : ''
  const buttons = BADGE_EMOJIS.map(
    (emoji) =>
      `<button type="submit" name="emoji" value="${escapeHtml(emoji)}" aria-pressed="${emoji === chosen}">${escapeHtml(emoji)}</button>`,
  ).join('')
  return groupCard(`
    <h2>Your badge</h2>
    <p>Your badge stands for you on every challenge. Only you can change it.</p>
    ${message}
    <form method="post" action="${badgePath}">
      <div class="badge-grid">${buttons}</div>
      <button type="submit" class="secondary" name="emoji" value="initials" aria-pressed="${chosen === null}">Use initials (${escapeHtml(page.initials)})</button>
    </form>
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

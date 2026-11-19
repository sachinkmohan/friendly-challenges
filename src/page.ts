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
  type RhythmInput,
  type RhythmLine,
  type StakesGo,
  type StartKind,
  type StartStep,
} from './challenge.ts'
import { CURRENCY_CODES } from './currencies.ts'
import { BADGE_EMOJIS, type Badge, type BadgeEmoji } from './badges.ts'
import { DAY_MARK_LABELS, type DayLine, type GroupCalendar, type HeatmapWeek, type MarkedDay, type RowMember } from './calendar.ts'
import type { HomeCard, HomeChallenge } from './home.ts'
import type { MemberView, OutsiderView } from './grouppage.ts'
import { dropoutFailureCopy, type DropoutFailure, type DropoutInput } from './dropouts.ts'
import { CHECK_IN_LABELS, checkInFailureCopy, type CheckIn, type CheckInColor, type CheckInFailure } from './checkins.ts'
import { deleteFailureCopy, dropNameFailureCopy, parseGroupId, type DeleteFailure, type DropNameFailure, type GroupId, type GroupView, type MemberLine } from './groups.ts'
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

type PageHead = { readonly kind: 'home' } | { readonly kind: 'inner'; readonly title: string }

const backIcon = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></svg>`

function tabBar(homeHref: string, accountHref: string, homeCurrent: boolean): string {
  return `<nav class="tabbar" aria-label="Primary">
    <a class="tab tab-home" href="${homeHref}"${homeCurrent ? ' aria-current="page"' : ''}>${homeIcon}<span>Home</span></a>
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

const frame = (screens: string, head: PageHead, toast: string | null = null) => {
  const title = head.kind === 'home' ? 'Friendly challenges' : escapeHtml(head.title)
  const back = head.kind === 'inner' ? `<a class="appbar-back" href="/" aria-label="Back to Home">${backIcon}</a>` : ''
  const tabs = head.kind === 'home' ? tabBar('#home', '#account', true) : tabBar('/', '/#account', false)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#fffdf8">
  ${installHead}
  <title>${title}</title>
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
      position: relative;
      flex: none;
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) 48px;
      align-items: center;
      height: 56px;
      background: #fffdf8;
      border-bottom: 1px solid #e7e0d4;
    }
    h1 {
      grid-column: 2;
      min-width: 0;
      margin: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      text-align: center;
      font-size: 17px;
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .appbar-back {
      grid-column: 1;
      grid-row: 1;
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      color: #1c1915;
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
    ul.members, ul.check-ins {
      list-style: none;
      margin: 16px 0 0;
      padding: 0;
    }
    ul.members li, ul.check-ins li {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      min-height: 48px;
    }
    .section-title { margin-top: 16px; font-weight: 650; color: #1c1915; }
    .hello { margin: 4px 4px 12px; }
    .challenge-card { cursor: pointer; }
    .challenge-card + .challenge-card { margin-top: 12px; }
    .challenge-card h3 { margin: 0; font-size: 18px; font-weight: 650; overflow-wrap: anywhere; }
    .card-link { display: block; color: #1c1915; text-decoration: none; }
    .today-status { margin-top: 4px; }
    .today-status.kept { color: #2f7d4a; font-weight: 650; }
    .today-status.missed { color: #b3392f; font-weight: 650; }
    .card-log button { margin-top: 12px; }
    .home-empty { margin: 0 4px; }
    a.button.new-challenge { margin-top: 16px; background: #fffdf8; color: #1c1915; box-shadow: inset 0 0 0 1.5px #1c1915; }
    .install { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e7e0d4; }
    .install .section-title { margin-top: 0; }
    .install .field-hint { margin-top: 8px; }
    .install-card { margin-bottom: 16px; }
    .install-steps { margin: 8px 0 0; color: #5c564c; }
    ol.install-steps { padding-left: 22px; }
    .install-steps li + li { margin-top: 4px; }
    .install-steps + .field-hint { margin-top: 8px; }
    .install-icon { vertical-align: middle; margin-top: -3px; color: #1c1915; }
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
    button:disabled { opacity: 0.45; cursor: progress; }
    button.is-saving { opacity: 1; }
    a.is-navigating { opacity: 0.6; }
    .nav-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; overflow: hidden; }
    .nav-progress[hidden] { display: none; }
    .nav-progress::before { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: #1c1915; }
    .spinner { display: inline-block; width: 1em; height: 1em; margin-right: 8px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; vertical-align: middle; box-sizing: border-box; }
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
    .start-error, .form-error { margin-top: 8px; color: #b3392f; font-weight: 650; }
    .terms-line { font-size: 14px; }
    .today-area { margin-top: 16px; }
    .today-area .today-status { font-size: 18px; font-weight: 650; color: #1c1915; }
    .today-area .today-status.kept { color: #2f7d4a; }
    .today-area .today-status.missed { color: #b3392f; }
    .today-log button { min-height: 64px; font-size: 18px; }
    details.fold > summary, details.change > summary, details.other-day > summary { display: flex; align-items: center; min-height: 48px; cursor: pointer; list-style: none; touch-action: manipulation; }
    details.fold > summary::-webkit-details-marker, details.change > summary::-webkit-details-marker, details.other-day > summary::-webkit-details-marker { display: none; }
    details.change > summary, details.other-day > summary { font-weight: 650; color: #1c1915; text-decoration: underline; text-underline-offset: 3px; }
    details.fold { margin-top: 0; border-top: 1px solid #e7e0d4; }
    .calendar-block + details.fold { margin-top: 16px; }
    details.fold > summary { justify-content: space-between; font-weight: 650; color: #1c1915; }
    details.fold > summary::after { content: '›'; color: #8a8378; font-size: 22px; line-height: 1; transition: transform 150ms; }
    details.fold[open] > summary::after { transform: rotate(90deg); }
    .fold-body { padding-bottom: 16px; }
    .fold-body > :first-child, .fold-body > form:first-child > :first-child { margin-top: 0; }
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
    .bags { max-width: 100%; font-size: clamp(7px, 2.6vw, 10px); line-height: 1.2; letter-spacing: -1px; white-space: nowrap; text-align: center; color: #5c564c; }
    .badge-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 16px; }
    .badge-grid button { width: auto; min-height: 52px; margin: 0; padding: 0; background: #f6f1e8; color: #1c1915; font-size: 26px; }
    .badge-grid button.is-saving { flex-direction: column; gap: 4px; min-width: 0; overflow: hidden; font-size: 11px; white-space: nowrap; }
    .badge-grid button.is-saving .spinner { margin-right: 0; }
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
      .spinner { animation: spin 800ms linear infinite; }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .nav-progress::before { animation: nav-slide 1s ease-in-out infinite; }
      @keyframes nav-slide {
        from { transform: translateX(-100%); }
        to { transform: translateX(250%); }
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
          ${back}
          <h1>${title}</h1>
          <div class="nav-progress" aria-hidden="true" hidden></div>
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
      if (!document.getElementById('home')) return
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
    document.querySelectorAll('[data-days]').forEach(function (box) {
      var now = new Date()
      var pad = function (n) { return String(n).padStart(2, '0') }
      var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
      var lines = box.querySelectorAll('.today[data-day]')
      var match = Array.prototype.some.call(lines, function (line) { return line.getAttribute('data-day') === today })
      if (match) lines.forEach(function (line) { line.hidden = line.getAttribute('data-day') !== today })
    })
    document.querySelectorAll('.challenge-card').forEach(function (card) {
      card.addEventListener('click', function (event) {
        if (event.defaultPrevented || event.target.closest('a, button, form, input, label')) return
        if (String(window.getSelection())) return
        var link = card.querySelector('a.card-link')
        if (event.metaKey || event.ctrlKey) window.open(link.href, '_blank')
        else link.click()
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
    document.addEventListener('submit', function (event) {
      var form = event.target
      if (event.defaultPrevented || !form.matches('form[method=post]') || form.matches('.sign-in')) return
      if (form.getAttribute('aria-busy') === 'true') {
        event.preventDefault()
        return
      }
      var buttons = Array.prototype.filter.call(form.querySelectorAll('button'), function (button) { return button.type === 'submit' })
      var tapped = event.submitter || buttons[0]
      form.setAttribute('aria-busy', 'true')
      if (event.submitter && event.submitter.name) {
        // A disabled button's value is left out of the post, so the tapped button's value rides in a hidden field.
        var carrier = document.createElement('input')
        carrier.type = 'hidden'
        carrier.name = event.submitter.name
        carrier.value = event.submitter.value
        carrier.setAttribute('data-saving-carrier', '')
        form.appendChild(carrier)
      }
      buttons.forEach(function (button) {
        if (button.disabled) return
        button.disabled = true
        button.setAttribute('data-saving-locked', '')
      })
      if (tapped) {
        tapped.setAttribute('data-saving-label', tapped.innerHTML)
        tapped.classList.add('is-saving')
        tapped.innerHTML = '<span class="spinner" aria-hidden="true"></span>Saving…'
      }
    })
    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      var link = event.target.closest && event.target.closest('a[href]')
      if (!link) return
      var target = link.getAttribute('target')
      if ((target && target !== '_self') || link.hasAttribute('download')) return
      var url = new URL(link.href)
      if (url.origin !== location.origin) return
      if (url.pathname === location.pathname && url.search === location.search) return
      document.querySelector('.nav-progress').hidden = false
      link.classList.add('is-navigating')
    })
    window.addEventListener('pageshow', function (event) {
      if (!event.persisted) return
      document.querySelector('.nav-progress').hidden = true
      document.querySelectorAll('a.is-navigating').forEach(function (link) { link.classList.remove('is-navigating') })
      document.querySelectorAll('form[aria-busy]').forEach(function (form) {
        form.querySelectorAll('[data-saving-carrier]').forEach(function (carrier) { carrier.remove() })
        form.removeAttribute('aria-busy')
        form.querySelectorAll('[data-saving-locked]').forEach(function (button) {
          button.disabled = false
          button.removeAttribute('data-saving-locked')
        })
        form.querySelectorAll('[data-saving-label]').forEach(function (button) {
          button.innerHTML = button.getAttribute('data-saving-label')
          button.removeAttribute('data-saving-label')
          button.classList.remove('is-saving')
        })
      })
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
}

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
  | { state: 'signed_in'; account: Account; cards: readonly HomeCard[]; browser: Browser }

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

function heatmapGrid(groupId: GroupId, weeks: readonly HeatmapWeek[]): string {
  if (weeks.length === 0) return ''
  const rows = WEEKDAY_LABELS.map((label, weekday) => {
    const cells = weeks.map((week) => {
      const marked = week[weekday]
      return marked ? dayCell(marked) : '<td></td>'
    })
    return `<tr data-weekday="${weekday}"><th scope="row">${label}</th>${cells.join('')}</tr>`
  }).join('')
  return `<div class="grid-scroll"><table class="grid heatmap" data-group="${escapeHtml(groupId)}"><tbody>${rows}</tbody></table></div>`
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

function standingsRow(card: HomeCard, members: readonly RowMember[] | null): string {
  if (!members) return ''
  const started = members.some((member) => member.standing !== null)
  const label = `${started ? 'Standing in' : 'Members of'} ${card.name}`
  return `<ul class="standings" aria-label="${escapeHtml(label)}" data-group="${escapeHtml(card.groupId)}">${members.map(rowItem).join('')}</ul>`
}

function dayLog(groupId: GroupId, day: string): string {
  const action = escapeHtml(`${groupHref(groupId)}${checkInSuffix}`)
  return `<form class="card-log" method="post" action="${action}">
          <input type="hidden" name="day" value="${escapeHtml(day)}">
          <input type="hidden" name="return" value="/">
          <div class="check-in-colors">
            <button type="submit" class="green" name="color" value="green">Kept it</button>
            <button type="submit" class="red" name="color" value="red">Missed it</button>
          </div>
        </form>`
}

function dayBody(groupId: GroupId, line: DayLine, startsOn: string): string {
  const when = escapeHtml(startsOn)
  if (line.status === 'before_start') return `<p class="today-status">Starts on <time datetime="${when}">${when}</time></p>`
  if (line.status === 'due') return `<p class="today-status">Today is due</p>${dayLog(groupId, line.day)}`
  if (line.status === 'kept') return '<p class="today-status kept">Kept today ✓</p>'
  if (line.status === 'missed') return '<p class="today-status missed">Missed today</p>'
  return ''
}

// Every candidate day is in the page; the screen script shows the one that is today on the phone's clock.
function todayBlock(card: HomeCard, challenge: HomeChallenge): string {
  if (challenge.phase === 'draft') return '<p class="today-status">Not started</p>'
  return challenge.days
    .map((line) => {
      const hidden = line.day === challenge.today ? '' : ' hidden'
      return `<div class="today" data-day="${escapeHtml(line.day)}"${hidden}>${dayBody(card.groupId, line, challenge.startsOn)}</div>`
    })
    .join('')
}

function homeCard(card: HomeCard): string {
  const { challenge } = card
  const body =
    challenge.phase === 'active'
      ? `${heatmapGrid(card.groupId, challenge.weeks)}${standingsRow(card, challenge.members)}`
      : ''
  return `<article class="card challenge-card" data-group="${escapeHtml(card.groupId)}" data-days>
        <h3><a class="card-link" href="${escapeHtml(groupHref(card.groupId))}">${escapeHtml(card.name)}</a></h3>
        ${todayBlock(card, challenge)}
        ${body}
      </article>`
}

function homeCards(cards: readonly HomeCard[]): string {
  if (cards.length === 0) return '<p class="home-empty">You are not in a challenge yet. Make one and invite up to 4 friends, or go solo.</p>'
  return cards.map(homeCard).join('')
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
  const { account, cards, browser } = page
  const name = escapeHtml(account.displayName)
  const email = escapeHtml(account.email)
  return `
    <section id="home" class="screen">
      ${browser.iosInstall ? installCard(browser.iosInstall) : ''}
      <h2 class="hello">Hello, ${name}</h2>
      ${homeCards(cards)}
      <a class="button new-challenge" href="${groupsRoot}/new">Create a challenge</a>
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
  return frame(screens, { kind: 'home' }, toast)
}

function groupCard(title: string, body: string, toast: string | null = null): string {
  const screens = `
    <section class="screen is-current">
      <article class="card">
        ${body}
      </article>
    </section>
  `
  return frame(screens, { kind: 'inner', title }, toast)
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
    return groupCard('New challenge', `
      <p>Sign in to create a challenge.</p>
      ${signInControl(viewer, `${groupsRoot}/new`)}
    `)
  }
  const message = failure ? `<p class="start-error" role="alert">${escapeHtml(challengeFailureCopy[failure])}</p>` : ''
  const values = draft ? termsFromDraft(draft) : emptyTerms
  const solo = draft?.solo ? ' checked' : ''
  return groupCard('New challenge', `
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

type ActiveChallenge = Extract<MemberChallengeCard, { phase: 'active' }>
type SetupChallenge = Exclude<MemberChallengeCard, { phase: 'active' }>

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
  challenge: SetupChallenge,
  userId: string,
  posted: RhythmInput | undefined,
): string {
  if (challenge.phase === 'unopened') return ''
  const stored = challenge.rhythms.find((line) => line.userId === userId)
  return rhythmForm(groupId, posted?.interval ?? stored?.kind ?? '', stored ? '' : 'Pick your rhythm')
}

function checkInControl(groupId: GroupId, challenge: ActiveChallenge, postedDay: string | undefined): string {
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
    </script>`
}

function checkInItem(checkIn: CheckIn): string {
  const when = escapeHtml(checkIn.day)
  const label = CHECK_IN_LABELS[checkIn.color]
  return `<li><span class="swatch ${checkIn.color}" aria-hidden="true"></span> <span class="member-name">${escapeHtml(checkIn.displayName)} <time datetime="${when}">${when}</time></span> <span>${label}</span></li>`
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

function paymentForm(groupId: GroupId, ledger: GroupLedger, userId: string, draft: PaymentInput | undefined, error: string): string {
  const others = ledger.people.filter((person) => person.userId !== userId)
  if (others.length === 0) return error
  const action = escapeHtml(`${groupHref(groupId)}${paymentSuffix}`)
  const payees = optionList(
    others.map((person) => ({ value: person.userId, label: person.displayName })),
    draft?.payeeId ?? '',
  )
  return `<form method="post" action="${action}">
      <p class="grid-title">Record a payment you made</p>
      <p>The app does not send money. Record a payment that already happened.</p>
      ${error}
      <label for="payment-payee">Paid to</label>
      <select id="payment-payee" name="payee">${payees}</select>
      ${paymentFields(ledger, draft, 'PayPal reference')}
    </form>`
}

function paymentList(ledger: Ledger): string {
  if (ledger.payments.length === 0) return ''
  return `<p class="check-ins-title">Payments</p><ul class="check-ins payments">${ledger.payments.map((item) => paymentItem(ledger, item)).join('')}</ul>`
}

function soloBalances(groupId: GroupId, ledger: SoloLedger, draft: PaymentInput | undefined, error: string): string {
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
      ${error}
      ${paymentFields(ledger, draft, 'Reference')}
    </form>`
  return `<p class="check-ins-title">Balance</p>${due}${form}${paymentList(ledger)}`
}

function groupBalances(groupId: GroupId, ledger: GroupLedger, userId: string, draft: PaymentInput | undefined, error: string): string {
  const nets = `<ul class="check-ins balances">${ledger.nets.map((line) => netItem(ledger, line)).join('')}</ul>`
  const open =
    ledger.open.length === 0
      ? '<p>Nobody owes anyone.</p>'
      : `<ul class="check-ins open-amounts">${ledger.open.map((line) => openItem(ledger, line)).join('')}</ul>`
  return `<p class="check-ins-title">Balances</p>${nets}<p class="check-ins-title">Who owes whom</p>${open}${paymentForm(groupId, ledger, userId, draft, error)}${paymentList(ledger)}`
}

function balancesSection(groupId: GroupId, ledger: Ledger, userId: string, draft: PaymentInput | undefined, error: string): string {
  return ledger.kind === 'solo' ? soloBalances(groupId, ledger, draft, error) : groupBalances(groupId, ledger, userId, draft, error)
}

function dropoutForm(
  view: Extract<GroupView, { kind: 'members' }>,
  userId: string,
  draft: DropoutInput | undefined,
  error = '',
): string {
  const choices = userId === view.creatorId ? view.members : view.members.filter((member) => member.userId === userId)
  if (choices.length === 0) return error
  const action = escapeHtml(`${groupHref(view.groupId)}${dropoutSuffix}`)
  const members = optionList(
    choices.map((member) => ({ value: member.userId, label: member.displayName })),
    draft?.memberId ?? '',
  )
  return `<form method="post" action="${action}">
      <p class="grid-title">Leave or record a dropout</p>
      <p>Debts through the last day stay. Days after it owe nothing.</p>
      ${error}
      <label for="dropout-member">Member</label>
      <select id="dropout-member" name="member">${members}</select>
      <label for="dropout-day">Last day</label>
      <input id="dropout-day" name="last_day" type="date" value="${escapeHtml(draft?.lastDay ?? '')}" required>
      <button type="submit">Record dropout</button>
    </form>`
}

function deleteForm(view: Extract<GroupView, { kind: 'members' }>, userId: string, error = ''): string {
  if (userId !== view.creatorId) return error
  const action = escapeHtml(`${groupHref(view.groupId)}${deleteSuffix}`)
  return `<form method="post" action="${action}">
      <p class="grid-title">Delete this challenge</p>
      <p>This removes the challenge, every check-in, and every payment for everyone. It cannot be undone.</p>
      ${error}
      <label class="confirm"><input type="checkbox" name="confirm" value="yes" required> Delete it for everyone</label>
      <button type="submit" class="danger">Delete challenge</button>
    </form>`
}

function dropNameForm(view: Extract<GroupView, { kind: 'members' }>, challenge: MemberChallengeCard, userId: string, error = ''): string {
  if (userId !== view.creatorId || !view.hasGroupName || challenge.phase === 'unopened') return error
  const action = escapeHtml(`${groupHref(view.groupId)}${dropNameSuffix}`)
  return `<form method="post" action="${action}">
      <p class="field-hint">It still shows the name you first gave it. The challenge is called ${escapeHtml(challenge.terms.name)}.</p>
      ${error}
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
  challenge: SetupChallenge,
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
  challenge: SetupChallenge,
  creator: Creator,
  draft: ChallengeInput | undefined,
): string {
  if (creator.isViewer) {
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

function friendlyDate(day: string, withYear = false): string {
  const date = new Date(`${day}T00:00:00Z`)
  const short = `${date.getUTCDate()}\u00a0${MONTHS[date.getUTCMonth()]}`
  return withYear ? `${short}\u00a0${date.getUTCFullYear()}` : short
}

function friendlySpan(startsOn: string, endsOn: string): string {
  const years = startsOn.slice(0, 4) !== endsOn.slice(0, 4)
  return `${friendlyDate(startsOn, years)} – ${friendlyDate(endsOn, years)}`
}

function termsLine(challenge: ActiveChallenge, activeCount: number): string {
  const { terms, stakesGo } = challenge
  const parts = [
    `${formatStake(terms.stakeMinor, challenge.minorDigits)} ${terms.currency} per missed day`,
    friendlySpan(terms.startsOn, terms.endsOn),
    activeCountText(activeCount),
    ...(stakesGo.kind === 'cause' ? [`owed to ${stakesGo.name}`] : []),
  ]
  return `<p class="terms-line">${parts.map(escapeHtml).join(' · ')}</p>`
}

function formError(text: string | undefined): string {
  return text ? `<p class="form-error" role="alert">${escapeHtml(text)}</p>` : ''
}

const COLOR_BUTTONS = {
  green: '<button type="submit" class="green" name="color" value="green">Kept it</button>',
  red: '<button type="submit" class="red" name="color" value="red">Missed it</button>',
} as const

function todayLog(groupId: GroupId, day: string, colors: readonly CheckInColor[]): string {
  const action = escapeHtml(`${groupHref(groupId)}${checkInSuffix}`)
  return `<form class="today-log" method="post" action="${action}">
          <input type="hidden" name="day" value="${escapeHtml(day)}">
          <div class="check-in-colors">${colors.map((color) => COLOR_BUTTONS[color]).join('')}</div>
        </form>`
}

function changeFold(groupId: GroupId, day: string, other: CheckInColor): string {
  return `<details class="change"><summary>Change</summary>${todayLog(groupId, day, [other])}</details>`
}

function todayBody(groupId: GroupId, line: DayLine, challenge: ActiveChallenge): string {
  switch (line.status) {
    case 'before_start':
      return `<p class="today-status">Starts on ${escapeHtml(friendlyDate(challenge.terms.startsOn))}</p>`
    case 'after_end':
      return `<p class="today-status">Ended on ${escapeHtml(friendlyDate(challenge.terms.endsOn))}</p>`
    case 'due':
      return `<p class="today-status">Today is due</p>${todayLog(groupId, line.day, ['green', 'red'])}`
    case 'kept':
      return `<p class="today-status kept">Today: kept ✓</p>${changeFold(groupId, line.day, 'red')}`
    case 'missed':
      return `<p class="today-status missed">Today: missed</p>${changeFold(groupId, line.day, 'green')}`
    case 'not_due':
      return '<p class="today-status">Today is not a logging day for you.</p>'
  }
}

function todaySection(view: MemberView, challenge: ActiveChallenge, userId: string, attempt: ChallengeAttempt | undefined): string {
  const challengeFailure = attempt?.failure ?? attempt?.startFailure
  const error = formError(challengeFailure && challengeFailureCopy[challengeFailure])
  const failed = attempt?.checkInFailure
  const checkInError = formError(failed && checkInFailureCopy[failed])
  if (rhythmSlot('active', challenge.rhythms, userId).mode !== 'locked') {
    const form = rhythmForm(view.groupId, attempt?.rhythmDraft?.interval ?? '', 'Pick your rhythm to start logging')
    return `<section class="today-area">${error}${checkInError}${form}</section>`
  }
  const days = view.days
    .map((line) => {
      const hidden = line.day === view.today ? '' : ' hidden'
      return `<div class="today" data-day="${escapeHtml(line.day)}"${hidden}>${todayBody(view.groupId, line, challenge)}</div>`
    })
    .join('')
  const other = `<details class="other-day"${failed ? ' open' : ''}>
        <summary>Log a different day</summary>
        ${checkInError}
        ${checkInControl(view.groupId, challenge, attempt?.checkInDay)}
      </details>`
  return `<section class="today-area" data-days>${error}${days}${other}</section>`
}

function fold(id: string, title: string, body: string, open: boolean): string {
  return `<details class="fold" id="${id}"${open ? ' open' : ''}>
      <summary>${title}</summary>
      <div class="fold-body">${body}</div>
    </details>`
}

function memberRow(member: MemberLine, rhythms: readonly RhythmLine[]): string {
  const rhythm = rhythms.find((line) => line.userId === member.userId)
  const logged = rhythm ? `<span class="rhythm">${escapeHtml(RHYTHM_LABELS[rhythm.kind])}</span>` : ''
  return `<li data-member="${escapeHtml(member.userId)}">${badgeCircle(member.badge)} <span class="member-name">${escapeHtml(member.displayName)}</span>${logged}</li>`
}

function historyBody(checkIns: readonly CheckIn[]): string {
  if (checkIns.length === 0) return '<p>No check-ins yet.</p>'
  return `<ul class="check-ins">${checkIns.map(checkInItem).join('')}</ul>`
}

function startedPage(view: MemberView, challenge: ActiveChallenge, viewer: Viewer, origin: string, attempt: ChallengeAttempt | undefined, toast: string | null): string {
  const userId = viewer.state === 'signed_in' ? viewer.account.id : ''
  const share = escapeHtml(`${origin}${groupHref(view.groupId)}`)
  const payment = attempt?.paymentFailure
  const dropout = attempt?.dropoutFailure
  const deletion = attempt?.deleteFailure
  const dropName = attempt?.dropNameFailure
  const paymentError = formError(payment && paymentFailureCopy[payment])
  const money = view.ledger ? balancesSection(view.groupId, view.ledger, userId, attempt?.paymentDraft, paymentError) : paymentError
  const members = `<ul class="members">${view.members.map((member) => memberRow(member, challenge.rhythms)).join('')}</ul>
      <p class="share">Share this link to invite someone. <a href="${share}">${share}</a></p>`
  const manage = `${dropNameForm(view, challenge, userId, formError(dropName && dropNameFailureCopy[dropName]))}
      ${dropoutForm(view, userId, attempt?.dropoutDraft, formError(dropout && dropoutFailureCopy[dropout]))}
      ${deleteForm(view, userId, formError(deletion && deleteFailureCopy[deletion]))}`
  return groupCard(view.label, `
    ${termsLine(challenge, view.activeCount)}
    ${todaySection(view, challenge, userId, attempt)}
    <div class="calendar-block">${view.ledger ? calendarGrid(view.ledger.calendar) : ''}</div>
    ${fold('money', 'Money', money, payment !== undefined)}
    ${fold('members', 'Members', members, false)}
    ${fold('history', 'History', historyBody(view.checkIns), false)}
    ${fold('manage', 'Manage', manage, dropout !== undefined || deletion !== undefined || dropName !== undefined)}
  `, toast)
}

export function renderGroup(
  view: (OutsiderView | MemberView),
  viewer: Viewer,
  origin: string,
  attempt?: ChallengeAttempt,
  toast: string | null = null,
): string {
  const count = `<p class="count">${activeCountText(view.activeCount)}</p>`
  const failure = failureParagraph(attempt)
  if (view.kind === 'full') {
    return groupCard(view.label, `${count}${failure}${headlineText(view.headline)}<p>This challenge is full.</p>`, toast)
  }
  if (view.kind === 'solo') {
    return groupCard(
      view.label,
      `${count}${failure}${headlineText(view.headline)}<p>This is a solo challenge, so nobody can join it.</p>`,
      toast,
    )
  }
  if (view.kind === 'preview') {
    return groupCard(view.label, `${count}${failure}${headlineText(view.headline)}${joinControl(view.groupId, viewer)}`, toast)
  }
  const challenge = view.challenge
  if (challenge.phase === 'active') return startedPage(view, challenge, viewer, origin, attempt, toast)
  const userId = viewer.state === 'signed_in' ? viewer.account.id : ''
  const creatorName = view.members.find((member) => member.userId === view.creatorId)?.displayName ?? 'the creator'
  const creator = { isViewer: userId === view.creatorId, name: creatorName }
  const terms = termsBlock(view.groupId, challenge, creator, attempt?.draft)
  const start = startSection(view.groupId, challenge, creator, missingNames(view.members, challenge.missingRhythms), attempt?.startFailure)
  const rhythm = rhythmControl(view.groupId, challenge, userId, attempt?.rhythmDraft)
  const rhythms = challenge.phase === 'unopened' ? [] : challenge.rhythms
  const share = escapeHtml(`${origin}${groupHref(view.groupId)}`)
  return groupCard(view.label, `
    ${count}
    ${dropNameForm(view, challenge, userId)}
    ${failure}
    ${terms}
    ${rhythm}
    ${start}
    <ul class="members">${view.members.map((member) => memberItem(member, rhythms)).join('')}</ul>
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
    return groupCard('Your badge', `
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
  return groupCard('Your badge', `
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
        <p>${escapeHtml(text)}</p>
        <a class="button" href="/">Back</a>
      </article>
    </section>
  `
  return frame(screens, { kind: 'inner', title })
}

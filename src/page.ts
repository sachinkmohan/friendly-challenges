import type { GroupId, GroupView, HomeGroup, NameFailure } from './groups.ts'
import { parseGroupId } from './groups.ts'
import { authFailureCopy, type Account, type AuthFailure, type Viewer } from './identity.ts'

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
    label {
      display: block;
      margin-top: 16px;
      font-weight: 650;
    }
    input {
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
    .groups, .members { list-style: none; margin: 16px 0 0; padding: 0; }
    .groups a {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 48px;
      color: inherit;
      font-weight: 650;
      text-decoration: none;
    }
    .members li { margin-top: 12px; }
    .members li:first-child { margin-top: 0; }
    .count { color: #5c564c; font-size: 14px; font-weight: 650; }
    .share { margin-top: 16px; overflow-wrap: anywhere; }
    .share a { color: inherit; font-weight: 650; }
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
</body>
</html>
`

function portrait(person: { displayName: string; avatarUrl: string | null }): string {
  const avatar = safeAvatar(person.avatarUrl)
  if (avatar) return `<img src="${avatar}" alt="">`
  const initial = escapeHtml(person.displayName.trim().charAt(0) || '?')
  return `<div class="avatar" aria-hidden="true">${initial}</div>`
}

function signedOutScreens(): string {
  return `
    <section id="home" class="screen">
      <article class="card">
        <h2>Sign in</h2>
        <p>Sign in with the Google account you will use for your group.</p>
        <a class="button" href="/auth/google">Sign in with Google</a>
      </article>
    </section>
    <section id="account" class="screen">
      <article class="card">
        <h2>Account</h2>
        <p>No account on this device yet. Google sign-in stores one account for this app.</p>
        <a class="button" href="/auth/google">Sign in with Google</a>
      </article>
    </section>
  `
}

function signedInScreens(account: Account, groups: readonly HomeGroup[]): string {
  const name = escapeHtml(account.displayName)
  const email = escapeHtml(account.email)
  const list =
    groups.length === 0
      ? '<p>You are not in a group yet.</p>'
      : `<ul class="groups">${groups
          .map((group) => {
            const href = escapeHtml(groupHref(group.groupId))
            const label = escapeHtml(group.name)
            const count = escapeHtml(activeCountText(group.activeCount))
            return `<li><a href="${href}">${label}<span class="count">${count}</span></a></li>`
          })
          .join('')}</ul>`
  return `
    <section id="home" class="screen">
      <article class="card">
        <h2>Hello, ${name}</h2>
        ${list}
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

const groupsRoot = '/groups'
const joinSuffix = '/join'

const nameFailureCopy: Record<NameFailure, string> = {
  name_empty: 'Type a group name.',
  name_too_long: 'Use 40 characters or fewer.',
}

export function groupHref(groupId: GroupId): string {
  return `${groupsRoot}/${groupId}`
}

function activeCountText(count: number): string {
  return `${count} active`
}

function googleReturnHref(returnPath: string): string {
  return `/auth/google?return=${encodeURIComponent(returnPath)}`
}

export type GroupRoute =
  | { kind: 'new' }
  | { kind: 'create' }
  | { kind: 'show'; groupId: GroupId }
  | { kind: 'join'; groupId: GroupId }

export function matchGroupPath(path: string): GroupRoute | null {
  if (path === `${groupsRoot}/new`) return { kind: 'new' }
  if (path === groupsRoot) return { kind: 'create' }
  if (!path.startsWith(`${groupsRoot}/`)) return null
  const rest = path.slice(groupsRoot.length + 1)
  if (rest.endsWith(joinSuffix) && rest.length > joinSuffix.length) {
    const groupId = parseGroupId(rest.slice(0, -joinSuffix.length))
    return groupId ? { kind: 'join', groupId } : null
  }
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

export type HomePage =
  | { state: 'signed_out' }
  | { state: 'signed_in'; account: Account; groups: readonly HomeGroup[] }

export function renderHome(page: HomePage): string {
  const screens = page.state === 'signed_out' ? signedOutScreens() : signedInScreens(page.account, page.groups)
  return frame(screens, tabBar('#home', '#account'))
}

export function renderNewGroup(viewer: Viewer, error?: NameFailure): string {
  const card =
    viewer.state === 'signed_out'
      ? `<h2>Create a group</h2>
        <p>Sign in to create a group.</p>
        <a class="button" href="${escapeHtml(googleReturnHref(`${groupsRoot}/new`))}">Sign in with Google</a>`
      : `<h2>Create a group</h2>
        ${error ? `<p>${escapeHtml(nameFailureCopy[error])}</p>` : ''}
        <form method="post" action="${groupsRoot}">
          <label for="group-name">Group name</label>
          <input id="group-name" name="name" autocomplete="off" required>
          <button type="submit">Create group</button>
        </form>`
  return frame(screen(card), tabBar('/', '/#account'))
}

export function renderGroup(
  view: Exclude<GroupView, { kind: 'missing' }>,
  viewer: Viewer,
  origin: string,
): string {
  const name = escapeHtml(view.name)
  const count = escapeHtml(activeCountText(view.activeCount))
  if (view.kind === 'members') {
    const members = view.members
      .map((member) => {
        const label = escapeHtml(member.displayName)
        const joined = escapeHtml(member.joinedOn)
        return `<li class="who">${portrait(member)}<div><div class="name">${label}</div><div class="joined">Joined <time datetime="${joined}">${joined}</time></div></div></li>`
      })
      .join('')
    const share = escapeHtml(`${origin}${groupHref(view.groupId)}`)
    const card = `<h2>${name}</h2>
      <p class="count">${count}</p>
      <p>A challenge can start later when 3 to 5 people are active.</p>
      <ul class="members">${members}</ul>
      <p class="share">Share this link to invite someone. <a href="${share}">${share}</a></p>`
    return frame(screen(card), tabBar('/', '/#account'))
  }
  if (view.kind === 'full') {
    const card = `<h2>${name}</h2><p class="count">${count}</p><p>This group is full.</p>`
    return frame(screen(card), tabBar('/', '/#account'))
  }
  const action =
    viewer.state === 'signed_out'
      ? `<a class="button" href="${escapeHtml(googleReturnHref(groupHref(view.groupId)))}">Sign in with Google</a>`
      : `<form method="post" action="${escapeHtml(`${groupHref(view.groupId)}${joinSuffix}`)}"><button type="submit">Join group</button></form>`
  const card = `<h2>${name}</h2><p class="count">${count}</p>${action}`
  return frame(screen(card), tabBar('/', '/#account'))
}

function screen(card: string): string {
  return `<section class="screen is-current"><article class="card">${card}</article></section>`
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

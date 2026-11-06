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

const frame = (body: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Friendly challenges</title>
  <style>
    body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #f4f1ea; color: #1c1915; }
    main { max-width: 28rem; margin: 12vh auto; padding: 2rem; background: #fffdf8; border: 1px solid #e4ddd0; }
    h1 { font-size: 1.4rem; font-weight: 650; margin: 0 0 0.4rem; }
    p { margin: 0 0 1.25rem; }
    .who { display: flex; gap: 0.9rem; align-items: center; margin-bottom: 1.25rem; }
    img { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; background: #efe8dc; }
    .name { font-weight: 650; }
    .email { color: #5c564c; }
    a.button, button { font: inherit; background: #1c1915; color: #fffdf8; border: 0; padding: 0.55rem 0.9rem; text-decoration: none; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    ${body}
  </main>
</body>
</html>
`

function signedIn(account: Account): string {
  const avatar = safeAvatar(account.avatarUrl)
  const portrait = avatar ? `<img src="${avatar}" alt="">` : ''
  return frame(`
    <h1>Friendly challenges</h1>
    <div class="who">
      ${portrait}
      <div>
        <div class="name">${escapeHtml(account.displayName)}</div>
        <div class="email">${escapeHtml(account.email)}</div>
      </div>
    </div>
    <form method="post" action="/logout">
      <button type="submit">Sign out</button>
    </form>
  `)
}

export function renderHome(viewer: Viewer): string {
  if (viewer.state === 'signed_out') {
    return frame(`
      <h1>Friendly challenges</h1>
      <p>Sign in with the Google account you will use for your group.</p>
      <a class="button" href="/auth/google">Sign in with Google</a>
    `)
  }
  return signedIn(viewer.account)
}

export function renderFailure(failure: AuthFailure): string {
  return renderMessage('Sign-in did not finish', authFailureCopy[failure])
}

export function renderMessage(title: string, text: string): string {
  return frame(`
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(text)}</p>
    <a class="button" href="/">Back</a>
  `)
}

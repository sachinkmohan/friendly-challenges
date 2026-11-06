import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderHome, renderMessage } from '../src/page.ts'

const account = {
  id: '1',
  googleSub: 'sub',
  email: 'ada@example.com',
  displayName: 'Ada',
  avatarUrl: 'https://lh3.googleusercontent.com/a/ada',
}

test('every page is the same phone shell', () => {
  const pages = [
    renderHome({ state: 'signed_out' }),
    renderHome({ state: 'signed_in', account }),
    renderMessage('Not found', 'That page does not exist.'),
  ]
  for (const html of pages) {
    assert.match(html, /class="device"/)
    assert.match(html, /class="phone"/)
    assert.match(html, /class="appbar"/)
    assert.match(html, /class="tabbar"/)
    assert.match(html, /class="card"/)
    assert.match(html, /width: min\(390px, 100%\)/)
    assert.match(html, /height: min\(844px, 100dvh\)/)
    assert.match(html, /min-height: 48px/)
    assert.match(html, /overflow: hidden/)
    assert.match(html, /preventDefault/)
    assert.doesNotMatch(html, /@media/)
    assert.doesNotMatch(html, /rel="manifest"/)
    assert.doesNotMatch(html, /apple-mobile-web-app/)
  }
})

test('signed-out shell keeps Google sign-in on the phone screens', () => {
  const html = renderHome({ state: 'signed_out' })
  assert.match(html, /Sign in with Google/)
  assert.match(html, /href="#home"/)
  assert.match(html, /href="#account"/)
  assert.match(html, /id="home"/)
  assert.match(html, /id="account"/)
})

test('signed-in shell keeps the account card and sign-out', () => {
  const html = renderHome({ state: 'signed_in', account })
  assert.match(html, /Hello, Ada/)
  assert.match(html, /ada@example.com/)
  assert.match(html, /https:\/\/lh3.googleusercontent.com\/a\/ada/)
  assert.match(html, /action="\/logout"/)
  assert.match(html, /Sign out/)
})

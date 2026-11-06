import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { PGlite } from '@electric-sql/pglite'
import { upsertAccount } from '../src/accounts.ts'
import { createApp } from '../src/app.ts'
import { openDatabase } from '../src/db.ts'
import { createSession } from '../src/sessions.ts'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

type Person = { cookie: string; userId: string }

function googleFetch() {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === TOKEN_URL) {
      return new Response(JSON.stringify({ access_token: 'token-from-google' }), { status: 200 })
    }
    if (url === USERINFO_URL) {
      const headers = new Headers(init?.headers)
      if (headers.get('authorization') !== 'Bearer token-from-google') {
        return new Response('unauthorized', { status: 401 })
      }
      return new Response(
        JSON.stringify({
          sub: 'google-return-1',
          email: 'grace@example.com',
          email_verified: true,
          name: 'Grace',
        }),
        { status: 200 },
      )
    }
    return new Response('unexpected', { status: 500 })
  }) as typeof fetch
}

async function sessionFor(db: PGlite, name: string, avatarUrl: string | null = null): Promise<Person> {
  const saved = await upsertAccount(db, {
    sub: `sub-${name}`,
    email: `${name.replaceAll(' ', '-').toLowerCase()}@example.com`,
    emailVerified: true,
    displayName: name,
    avatarUrl,
  })
  if (!saved.ok) throw new Error('account was not saved')
  const token = await createSession(db, saved.account.id)
  return { cookie: `session=${encodeURIComponent(token)}`, userId: saved.account.id }
}

async function listen(db: PGlite, fetchImpl?: typeof fetch) {
  const app = createApp({
    db,
    config: { clientId: 'client-id', clientSecret: 'client-secret' },
    fetch: fetchImpl,
  })
  const server = createServer((req, res) => {
    void app(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${address.port}` }
}

async function close(server: Server, db: PGlite) {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  await db.close()
}

function cookiesFrom(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const set = headers.getSetCookie?.() ?? []
  return set.map((line) => line.split(';')[0]).join('; ')
}

async function countRows(db: PGlite, table: 'groups' | 'memberships'): Promise<number> {
  const result = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)
  return Number(result.rows[0]?.count ?? 0)
}

async function postForm(base: string, path: string, cookie: string | null, body?: string) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
    },
    body,
  })
}

test('the creator is the first member and a second person can join', async () => {
  const db = await openDatabase()
  const ada = await sessionFor(db, 'Ada', 'https://lh3.googleusercontent.com/a/ada')
  const grace = await sessionFor(db, 'Grace', 'javascript:alert(1)')
  const { server, base } = await listen(db)
  try {
    const created = await postForm(base, '/groups', ada.cookie, 'name=++Morning+run++')
    assert.equal(created.status, 303)
    const groupPath = created.headers.get('location')
    assert.ok(groupPath)
    const roster = await fetch(`${base}${groupPath}`, { headers: { cookie: ada.cookie } })
    const rosterHtml = await roster.text()
    assert.match(rosterHtml, /Morning run/)
    assert.match(rosterHtml, /1 active/)
    assert.match(rosterHtml, /Ada/)
    assert.match(rosterHtml, /https:\/\/lh3.googleusercontent.com\/a\/ada/)
    assert.match(rosterHtml, /<time datetime="\d{4}-\d{2}-\d{2}">/)
    assert.match(rosterHtml, /A challenge can start later when 3 to 5 people are active/)
    assert.match(rosterHtml, new RegExp(`${base}${groupPath}`))
    assert.doesNotMatch(rosterHtml, /left_on/)

    const peeked = await fetch(`${base}${groupPath}`, { headers: { cookie: grace.cookie } })
    const peekedHtml = await peeked.text()
    assert.match(peekedHtml, /1 active/)
    assert.doesNotMatch(peekedHtml, /Ada/)
    assert.doesNotMatch(peekedHtml, /<time /)
    assert.match(peekedHtml, /Join group/)

    const before = await countRows(db, 'memberships')
    const looked = await fetch(`${base}${groupPath}/join`, { headers: { cookie: grace.cookie } })
    assert.equal(looked.status, 405)
    assert.equal(await countRows(db, 'memberships'), before)

    const joined = await postForm(base, `${groupPath}/join`, grace.cookie)
    assert.equal(joined.status, 303)
    assert.equal(joined.headers.get('location'), groupPath)
    const again = await postForm(base, `${groupPath}/join`, grace.cookie)
    assert.equal(again.status, 303)
    const dates = await db.query<{ n: number; same: boolean; still_here: boolean }>(
      `SELECT count(*)::int AS n,
              bool_and(joined_on = (now() AT TIME ZONE 'utc')::date) AS same,
              bool_and(left_on IS NULL) AS still_here
       FROM memberships`,
    )
    assert.equal(dates.rows[0]?.n, 2)
    assert.equal(dates.rows[0]?.same, true)
    assert.equal(dates.rows[0]?.still_here, true)
    const both = await (await fetch(`${base}${groupPath}`, { headers: { cookie: ada.cookie } })).text()
    assert.match(both, /2 active/)
    assert.match(both, /Grace/)
    assert.doesNotMatch(both, /javascript:alert/)

    const second = await postForm(base, '/groups', ada.cookie, 'name=Evening+run')
    assert.equal(second.status, 303)
    const home = await (await fetch(base, { headers: { cookie: ada.cookie } })).text()
    assert.match(home, /Morning run/)
    assert.match(home, /Evening run/)
    assert.match(home, /2 active/)
    assert.match(home, /1 active/)
    assert.match(home, /Create a group/)
  } finally {
    await close(server, db)
  }
})

test('a sixth active member is rejected by the database', async () => {
  const db = await openDatabase()
  const people = await Promise.all([0, 1, 2, 3, 4, 5].map((n) => sessionFor(db, `Person ${n}`)))
  const { server, base } = await listen(db)
  try {
    const created = await postForm(base, '/groups', people[0].cookie, 'name=Full')
    const groupPath = created.headers.get('location')
    assert.ok(groupPath)
    for (const person of people.slice(1, 5)) {
      const joined = await postForm(base, `${groupPath}/join`, person.cookie)
      assert.equal(joined.status, 303)
    }
    const refused = await postForm(base, `${groupPath}/join`, people[5].cookie)
    assert.equal(refused.status, 409)
    const html = await refused.text()
    assert.match(html, /This group is full/)
    assert.match(html, /5 active/)
    assert.doesNotMatch(html, /<form/)
    assert.doesNotMatch(html, /Person 0/)
    const looked = await fetch(`${base}${groupPath}`, { headers: { cookie: people[5].cookie } })
    assert.equal(looked.status, 200)
    assert.match(await looked.text(), /This group is full/)
    const stillIn = await (await fetch(`${base}${groupPath}`, { headers: { cookie: people[0].cookie } })).text()
    assert.match(stillIn, /Person 0/)
    assert.match(stillIn, /5 active/)
    const groupId = groupPath.slice('/groups/'.length)
    await assert.rejects(
      db.query(
        `INSERT INTO memberships (group_id, user_id, joined_on)
         VALUES ($1, $2, (now() AT TIME ZONE 'utc')::date)`,
        [groupId, people[5].userId],
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal((error as { code?: string }).code, 'P0001')
        assert.equal(error.message, 'group_full')
        return true
      },
    )
    const anonFull = await postForm(base, `${groupPath}/join`, null)
    assert.equal(anonFull.status, 409)
    const anonFullHtml = await anonFull.text()
    assert.match(anonFullHtml, /This group is full/)
    assert.doesNotMatch(anonFullHtml, /<form/)
    const active = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM memberships WHERE group_id = $1 AND left_on IS NULL`,
      [groupId],
    )
    assert.equal(active.rows[0]?.n, 5)
    const dir = new URL('../db/', import.meta.url)
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(new URL(file, dir), 'utf8'))
    }
    const after = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM memberships WHERE group_id = $1 AND left_on IS NULL`,
      [groupId],
    )
    assert.equal(after.rows[0]?.n, 5)
  } finally {
    await close(server, db)
  }
})

test('a blank or oversized name does not create a group', async () => {
  const db = await openDatabase()
  const ada = await sessionFor(db, 'Ada')
  const { server, base } = await listen(db)
  try {
    const blank = await postForm(base, '/groups', ada.cookie, 'name=+++')
    assert.equal(blank.status, 400)
    assert.match(await blank.text(), /Type a group name/)
    const longName = 'a'.repeat(41)
    const long = await postForm(base, '/groups', ada.cookie, `name=${longName}`)
    assert.equal(long.status, 400)
    assert.match(await long.text(), /40 characters or fewer/)
    const ok = await postForm(base, '/groups', ada.cookie, `name=${'b'.repeat(40)}`)
    assert.equal(ok.status, 303)
    assert.equal(await countRows(db, 'groups'), 1)
    const emoji = '😀'.repeat(40)
    const emojiGroup = await postForm(base, '/groups', ada.cookie, `name=${encodeURIComponent(emoji)}`)
    assert.equal(emojiGroup.status, 303)
    const tooManyEmoji = await postForm(base, '/groups', ada.cookie, `name=${encodeURIComponent('😀'.repeat(41))}`)
    assert.equal(tooManyEmoji.status, 400)
    assert.match(await tooManyEmoji.text(), /40 characters or fewer/)
    await assert.rejects(
      db.query(`INSERT INTO groups (id, name) VALUES ($1::uuid, $2)`, [crypto.randomUUID(), 'c'.repeat(41)]),
    )
    await assert.rejects(
      db.query(`INSERT INTO groups (id, name) VALUES ($1::uuid, $2)`, [crypto.randomUUID(), '   ']),
    )
    assert.equal(await countRows(db, 'groups'), 2)
  } finally {
    await close(server, db)
  }
})

test('a signed-out person cannot create or join', async () => {
  const db = await openDatabase()
  const ada = await sessionFor(db, 'Ada')
  const { server, base } = await listen(db)
  try {
    const created = await postForm(base, '/groups', ada.cookie, 'name=Morning+run')
    const groupPath = created.headers.get('location')
    assert.ok(groupPath)
    const beforeGroups = await countRows(db, 'groups')
    const beforeMembers = await countRows(db, 'memberships')
    const create = await postForm(base, '/groups', null, 'name=Sneaky')
    assert.equal(create.status, 401)
    assert.match(await create.text(), /Sign in to create a group/)
    const join = await postForm(base, `${groupPath}/join`, null)
    assert.equal(join.status, 401)
    const joinHtml = await join.text()
    assert.match(joinHtml, /Sign in with Google/)
    assert.doesNotMatch(joinHtml, /Ada/)
    assert.equal(await countRows(db, 'groups'), beforeGroups)
    assert.equal(await countRows(db, 'memberships'), beforeMembers)
    const getGroups = await fetch(`${base}/groups`)
    assert.equal(getGroups.status, 405)
    assert.equal(getGroups.headers.get('allow'), 'POST')
    const postNew = await postForm(base, '/groups/new', ada.cookie)
    assert.equal(postNew.status, 405)
    assert.equal(postNew.headers.get('allow'), 'GET')
    const postShow = await postForm(base, groupPath, ada.cookie)
    assert.equal(postShow.status, 405)
    assert.equal(postShow.headers.get('allow'), 'GET')
    const missing = await fetch(`${base}/groups/00000000-0000-4000-8000-000000000099`)
    assert.equal(missing.status, 404)
    assert.equal(await countRows(db, 'groups'), beforeGroups)
    assert.equal(await countRows(db, 'memberships'), beforeMembers)
    const page = await fetch(`${base}/groups/new`)
    assert.equal(page.status, 200)
    assert.doesNotMatch(await page.text(), /<form/)
  } finally {
    await close(server, db)
  }
})

test('a signed-out join link comes back to the same group after Google', async () => {
  const db = await openDatabase()
  const ada = await sessionFor(db, 'Ada')
  const { server, base } = await listen(db, googleFetch())
  try {
    const created = await postForm(base, '/groups', ada.cookie, 'name=Morning+run')
    const groupPath = created.headers.get('location')
    assert.ok(groupPath)
    const before = await countRows(db, 'memberships')
    const anon = await fetch(`${base}${groupPath}`)
    assert.equal(anon.status, 200)
    assert.match(await anon.text(), new RegExp(`/auth/google\\?return=${encodeURIComponent(groupPath)}`))
    assert.equal(await countRows(db, 'memberships'), before)

    const start = await fetch(`${base}/auth/google?return=${encodeURIComponent(groupPath)}`, { redirect: 'manual' })
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state')
    const callback = await fetch(
      `${base}/auth/google/callback?code=good-code&state=${encodeURIComponent(state ?? '')}`,
      { redirect: 'manual', headers: { cookie: cookiesFrom(start) } },
    )
    assert.equal(callback.status, 302)
    assert.equal(callback.headers.get('location'), groupPath)

    const hostile = await fetch(`${base}/auth/google?return=https://evil.example`, { redirect: 'manual' })
    const hostileState = new URL(hostile.headers.get('location') ?? '').searchParams.get('state')
    const home = await fetch(
      `${base}/auth/google/callback?code=good-code&state=${encodeURIComponent(hostileState ?? '')}`,
      { redirect: 'manual', headers: { cookie: cookiesFrom(hostile) } },
    )
    assert.equal(home.headers.get('location'), '/')

    const protocolRelative = await fetch(`${base}/auth/google?return=${encodeURIComponent('//evil.example')}`, {
      redirect: 'manual',
    })
    const protocolState = new URL(protocolRelative.headers.get('location') ?? '').searchParams.get('state')
    const protocolHome = await fetch(
      `${base}/auth/google/callback?code=good-code&state=${encodeURIComponent(protocolState ?? '')}`,
      { redirect: 'manual', headers: { cookie: cookiesFrom(protocolRelative) } },
    )
    assert.equal(protocolHome.headers.get('location'), '/')

    const joinReturn = await fetch(`${base}/auth/google?return=${encodeURIComponent(`${groupPath}/join`)}`, {
      redirect: 'manual',
    })
    const joinState = new URL(joinReturn.headers.get('location') ?? '').searchParams.get('state')
    const joinHome = await fetch(
      `${base}/auth/google/callback?code=good-code&state=${encodeURIComponent(joinState ?? '')}`,
      { redirect: 'manual', headers: { cookie: cookiesFrom(joinReturn) } },
    )
    assert.equal(joinHome.headers.get('location'), '/')
  } finally {
    await close(server, db)
  }
})

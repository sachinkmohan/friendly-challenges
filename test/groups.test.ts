import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { test } from 'node:test'
import { upsertAccount } from '../src/accounts.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { countDocs, readGroup, utcToday } from '../src/store.ts'
import { createSession } from '../src/sessions.ts'
import { fakeVerifier, googleToken, listen } from './support/fixtures.ts'

type Person = { cookie: string; userId: string }

async function sessionFor(db: Database, name: string, avatarUrl: string | null = null): Promise<Person> {
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

async function close(server: Server, db: Database) {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  await closeDatabase(db)
}

async function countRows(db: Database, table: 'groups' | 'memberships'): Promise<number> {
  if (table === 'groups') return countDocs(db, 'groups')
  const groups = await db.collection('groups').get()
  return groups.docs.reduce((sum, doc) => sum + Object.keys(doc.data().members ?? {}).length, 0)
}

async function members(db: Database, groupId: string) {
  const group = await readGroup(db, groupId)
  assert.ok(group)
  return Object.values(group.members)
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
  const db = openTestDatabase()
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
    assert.match(rosterHtml, /A challenge can start when 1 to 5 people are active/)
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
    const dates = await members(db, groupPath.slice('/groups/'.length))
    assert.equal(dates.length, 2)
    assert.ok(dates.every((member) => member.joinedOn === utcToday()))
    assert.ok(dates.every((member) => member.leftOn === null))
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
  const db = openTestDatabase()
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
    const anonFull = await postForm(base, `${groupPath}/join`, null)
    assert.equal(anonFull.status, 409)
    const anonFullHtml = await anonFull.text()
    assert.match(anonFullHtml, /This group is full/)
    assert.doesNotMatch(anonFullHtml, /<form/)
    const groupId = groupPath.slice('/groups/'.length)
    assert.equal((await members(db, groupId)).filter((member) => member.leftOn === null).length, 5)
  } finally {
    await close(server, db)
  }
})

test('six people joining at once leave five active members', async () => {
  const db = openTestDatabase()
  const people = await Promise.all([0, 1, 2, 3, 4, 5].map((n) => sessionFor(db, `Racer ${n}`)))
  const { server, base } = await listen(db)
  try {
    const created = await postForm(base, '/groups', people[0].cookie, 'name=Race')
    const groupPath = created.headers.get('location')
    assert.ok(groupPath)
    const joins = await Promise.all(people.slice(1).map((person) => postForm(base, `${groupPath}/join`, person.cookie)))
    assert.deepEqual(
      joins.map((response) => response.status).sort(),
      [303, 303, 303, 303, 409],
    )
    const groupId = groupPath.slice('/groups/'.length)
    assert.equal((await members(db, groupId)).length, 5)
  } finally {
    await close(server, db)
  }
})

test('a blank or oversized name does not create a group', async () => {
  const db = openTestDatabase()
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
    assert.equal(await countRows(db, 'groups'), 2)
  } finally {
    await close(server, db)
  }
})

test('a signed-out person cannot create or join', async () => {
  const db = openTestDatabase()
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
    const newHtml = await page.text()
    assert.doesNotMatch(newHtml, /action="\/groups"/)
    assert.match(newHtml, /name="return" value="\/groups\/new"/)
  } finally {
    await close(server, db)
  }
})

test('a signed-out join link comes back to the same group after Google', async () => {
  const db = openTestDatabase()
  const ada = await sessionFor(db, 'Ada')
  const grace = googleToken('google-return-1', { email: 'grace@example.com', email_verified: true, name: 'Grace' })
  const { server, base } = await listen(db, { verifyIdToken: fakeVerifier(new Map([['grace-token', grace]])) })
  const signIn = (returnPath: string) =>
    postForm(base, '/auth/firebase', null, new URLSearchParams({ idToken: 'grace-token', return: returnPath }).toString())
  try {
    const created = await postForm(base, '/groups', ada.cookie, 'name=Morning+run')
    const groupPath = created.headers.get('location')
    assert.ok(groupPath)
    const before = await countRows(db, 'memberships')
    const anon = await fetch(`${base}${groupPath}`)
    assert.equal(anon.status, 200)
    const anonHtml = await anon.text()
    assert.match(anonHtml, /action="\/auth\/firebase"/)
    assert.match(anonHtml, new RegExp(`name="return" value="${groupPath}"`))
    assert.equal(await countRows(db, 'memberships'), before)

    const back = await signIn(groupPath)
    assert.equal(back.status, 303)
    assert.equal(back.headers.get('location'), groupPath)
    assert.equal((await signIn('https://evil.example')).headers.get('location'), '/')
    assert.equal((await signIn('//evil.example')).headers.get('location'), '/')
    assert.equal((await signIn(`${groupPath}/join`)).headers.get('location'), '/')
  } finally {
    await close(server, db)
  }
})

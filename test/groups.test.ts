import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { test } from 'node:test'
import { upsertAccount } from '../src/accounts.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { countDocs, groupRef, labelOf, readGroup, utcToday } from '../src/store.ts'
import { createSession } from '../src/sessions.ts'
import { saveChallenge, saveRhythm, startChallenge } from '../src/challenge.ts'
import { dropGroupName, joinGroup, parseGroupId } from '../src/groups.ts'
import { closeServer, cookieFor, createForm, fakeVerifier, fixtureTerms, googleToken, groupWith, legacyGroupWith, listen, person } from './support/fixtures.ts'
import { viewGroup } from './support/reads.ts'

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
    const created = await postForm(base, '/groups', ada.cookie, createForm({ name: '  Morning run  ' }))
    assert.equal(created.status, 303)
    const groupPath = created.headers.get('location')
    assert.ok(groupPath)
    const stored = await readGroup(db, groupPath.slice('/groups/'.length))
    assert.ok(stored)
    assert.equal(stored.name, null)
    assert.equal(labelOf(stored), 'Morning run')
    assert.equal(stored.createdBy, ada.userId)
    assert.deepEqual(stored.challenge, {
      name: 'Morning run',
      typeKind: 'no_sugar',
      customLabel: null,
      currency: 'USD',
      stakeMinor: 500,
      startsOn: '2026-11-01',
      endsOn: '2026-11-30',
      cause: null,
      phase: 'draft',
    })
    assert.deepEqual(stored.rhythms, { [ada.userId]: { kind: 'every_day' } })
    const roster = await fetch(`${base}${groupPath}`, { headers: { cookie: ada.cookie } })
    const rosterHtml = await roster.text()
    assert.match(rosterHtml, /Morning run/)
    assert.match(rosterHtml, /1 active/)
    assert.match(rosterHtml, /Ada/)
    assert.match(rosterHtml, /https:\/\/lh3.googleusercontent.com\/a\/ada/)
    assert.match(rosterHtml, /<time datetime="\d{4}-\d{2}-\d{2}">/)
    assert.match(rosterHtml, /Before you start/)
    assert.match(rosterHtml, /<li data-done="true">[^]*?Save the challenge name, type, stake, and dates\. <span class="sr-only">Done\.<\/span>/)
    assert.match(rosterHtml, /<li data-done="true">[^]*?Everyone picked a rhythm\./)
    assert.match(rosterHtml, /<span class="rhythm">Every day<\/span>/)
    assert.match(rosterHtml, /<li data-done="false">[^]*?2 to 5 people are active\. <span class="sr-only">Not done yet\.<\/span>/)
    assert.match(rosterHtml, /Start challenge appears here once every step above is done\./)
    assert.doesNotMatch(rosterHtml, /challenge\/start/)
    assert.match(rosterHtml, new RegExp(`${base}${groupPath}`))
    assert.doesNotMatch(rosterHtml, /left_on/)

    const peeked = await fetch(`${base}${groupPath}`, { headers: { cookie: grace.cookie } })
    const peekedHtml = await peeked.text()
    assert.match(peekedHtml, /1 active/)
    assert.doesNotMatch(peekedHtml, /Ada/)
    assert.doesNotMatch(peekedHtml, /class="members"/)
    assert.match(peekedHtml, /5\.00 USD/)
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

    const second = await postForm(base, '/groups', ada.cookie, createForm({ name: 'Evening run' }))
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
    const created = await postForm(base, '/groups', people[0].cookie, createForm({ name: 'Full' }))
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
    const created = await postForm(base, '/groups', people[0].cookie, createForm({ name: 'Race' }))
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

test('a bad field re-draws the create form with what was typed and creates nothing', async () => {
  const db = openTestDatabase()
  const ada = await sessionFor(db, 'Ada')
  const { server, base } = await listen(db)
  const create = (fields: Record<string, string>) => postForm(base, '/groups', ada.cookie, createForm(fields))
  try {
    const form = await fetch(`${base}/groups/new`, { headers: { cookie: ada.cookie } })
    assert.equal(form.status, 200)
    const formHtml = await form.text()
    assert.match(formHtml, /<form method="post" action="\/groups">/)
    for (const field of ['name', 'type', 'custom_label', 'currency', 'stake', 'starts_on', 'ends_on', 'interval', 'solo', 'cause']) {
      assert.match(formHtml, new RegExp(`name="${field}"`))
    }
    assert.doesNotMatch(formHtml, /id="challenge-solo"[^>]*checked/)

    const blank = await create({ name: '   ', stake: '9.9', custom_label: 'Laps', solo: 'yes', cause: 'Food bank' })
    assert.equal(blank.status, 400)
    const blankHtml = await blank.text()
    assert.match(blankHtml, /Type a challenge name\./)
    assert.match(blankHtml, /name="stake" value="9\.9"/)
    assert.match(blankHtml, /name="custom_label" value="Laps"/)
    assert.match(blankHtml, /name="cause" value="Food bank"/)
    assert.match(blankHtml, /id="challenge-solo" name="solo" value="yes" checked/)
    assert.match(blankHtml, /<option value="every_day" selected>/)

    assert.match(await (await create({ name: 'a'.repeat(41) })).text(), /40 characters or fewer/)
    assert.match(await (await create({ name: '😀'.repeat(41) })).text(), /40 characters or fewer/)
    assert.match(await (await create({ stake: '0' })).text(), /Type a stake above zero\./)
    const weekly = await create({ interval: 'weekly' })
    assert.equal(weekly.status, 400)
    assert.match(await weekly.text(), /Pick how often you log\./)
    const noCause = await create({ solo: 'yes', cause: '  ' })
    assert.equal(noCause.status, 400)
    assert.match(await noCause.text(), /Type who your missed days are owed to\./)
    assert.match(await (await create({ solo: 'yes', cause: 'c'.repeat(41) })).text(), /40 characters or fewer/)
    assert.equal(await countRows(db, 'groups'), 0)

    assert.equal((await create({ name: 'b'.repeat(40) })).status, 303)
    assert.equal((await create({ name: '😀'.repeat(40) })).status, 303)
    assert.equal(await countRows(db, 'groups'), 2)
  } finally {
    await close(server, db)
  }
})

test('Solo stores the cause on the draft, and a cause typed with Solo off is dropped', async () => {
  const db = openTestDatabase()
  const ada = await sessionFor(db, 'Ada')
  const { server, base } = await listen(db)
  const causeOf = async (response: Response) => {
    assert.equal(response.status, 303)
    const group = await readGroup(db, (response.headers.get('location') ?? '').slice('/groups/'.length))
    return group?.challenge?.cause
  }
  try {
    assert.equal(await causeOf(await postForm(base, '/groups', ada.cookie, createForm({ solo: 'yes', cause: '  Food bank  ' }))), 'Food bank')
    assert.equal(await causeOf(await postForm(base, '/groups', ada.cookie, createForm({ cause: 'Food bank' }))), null)
  } finally {
    await close(server, db)
  }
})

test('a signed-out person cannot create or join', async () => {
  const db = openTestDatabase()
  const ada = await sessionFor(db, 'Ada')
  const { server, base } = await listen(db)
  try {
    const created = await postForm(base, '/groups', ada.cookie, createForm())
    const groupPath = created.headers.get('location')
    assert.ok(groupPath)
    const beforeGroups = await countRows(db, 'groups')
    const beforeMembers = await countRows(db, 'memberships')
    const create = await postForm(base, '/groups', null, createForm({ name: 'Sneaky' }))
    assert.equal(create.status, 401)
    assert.match(await create.text(), /Sign in to create a challenge/)
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
    const created = await postForm(base, '/groups', ada.cookie, createForm())
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

test('nobody joins a solo challenge, before or after its start, and a challenge with friends still takes late joiners', async () => {
  const db = openTestDatabase()
  try {
    const [ada, grace, lin, noor] = await Promise.all(['Ada', 'Grace', 'Lin', 'Noor'].map((name) => person(db, name)))
    const solo = await groupWith(db, [ada], 'Alone', { cause: 'Food bank' })
    assert.deepEqual(await joinGroup(db, grace, solo), { ok: false, failure: 'solo' })
    assert.equal((await viewGroup(db, grace, solo)).kind, 'solo')
    assert.deepEqual(await startChallenge(db, ada, solo), { ok: true, name: 'Alone' })
    assert.deepEqual(await joinGroup(db, grace, solo), { ok: false, failure: 'solo' })
    assert.deepEqual(Object.keys((await readGroup(db, solo))?.members ?? {}), [ada.id])
    assert.deepEqual(await joinGroup(db, ada, solo), { ok: true, groupId: solo, label: 'Alone' })
    assert.equal((await viewGroup(db, grace, solo)).kind, 'solo')
    assert.equal((await viewGroup(db, null, solo)).kind, 'solo')
    assert.equal((await viewGroup(db, ada, solo)).kind, 'members')

    const draft = await groupWith(db, [ada], 'Not yet')
    assert.deepEqual(await joinGroup(db, grace, draft), { ok: true, groupId: draft, label: 'Not yet' })

    const group = await groupWith(db, [ada, grace, lin], 'Group')
    for (const who of [grace, lin]) assert.deepEqual(await saveRhythm(db, who, group, { interval: 'every_day' }), { ok: true, rhythm: 'every_day' })
    assert.deepEqual(await startChallenge(db, ada, group), { ok: true, name: 'Group' })
    assert.deepEqual(await joinGroup(db, noor, group), { ok: true, groupId: group, label: 'Group' })
  } finally {
    await closeDatabase(db)
  }
})

test('the join page of a solo challenge says nobody can join it, before and after the start', async () => {
  const db = openTestDatabase()
  const [ada, grace] = await Promise.all(['Ada', 'Grace'].map((name) => person(db, name)))
  const graceCookie = await cookieFor(db, grace)
  const { server, base } = await listen(db)
  try {
    const groupId = await groupWith(db, [ada], 'Alone', { cause: 'Food bank' })
    const groupPath = `/groups/${groupId}`
    const copy = /This is a solo challenge, so nobody can join it\./
    const refused = async () => {
      const looked = await fetch(`${base}${groupPath}`, { headers: { cookie: graceCookie } })
      assert.equal(looked.status, 200)
      const lookedHtml = await looked.text()
      assert.match(lookedHtml, copy)
      assert.match(lookedHtml, /Missed days are owed to Food bank\./)
      assert.doesNotMatch(lookedHtml, /<form/)
      assert.doesNotMatch(lookedHtml, /Ada/)

      const joined = await postForm(base, `${groupPath}/join`, graceCookie)
      assert.equal(joined.status, 409)
      const joinedHtml = await joined.text()
      assert.match(joinedHtml, copy)
      assert.doesNotMatch(joinedHtml, /<form/)

      const anon = await postForm(base, `${groupPath}/join`, null)
      assert.equal(anon.status, 409)
      const anonHtml = await anon.text()
      assert.match(anonHtml, copy)
      assert.doesNotMatch(anonHtml, /<form/)

      const anonLooked = await fetch(`${base}${groupPath}`)
      assert.equal(anonLooked.status, 200)
      assert.match(await anonLooked.text(), copy)
      assert.deepEqual(Object.keys((await readGroup(db, groupId))?.members ?? {}), [ada.id])
    }
    await refused()
    assert.deepEqual(await startChallenge(db, ada, groupId), { ok: true, name: 'Alone' })
    await refused()
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('an old group keeps its name until its creator uses the challenge name instead, before or after the start', async () => {
  const db = openTestDatabase()
  try {
    const [ada, grace, lin] = await Promise.all(['Ada', 'Grace', 'Lin'].map((name) => person(db, name)))
    const groupId = await legacyGroupWith(db, [ada, grace], 'Pantry crew')
    assert.deepEqual(await dropGroupName(db, ada, groupId), { ok: false, failure: 'no_challenge' })
    assert.deepEqual(await saveChallenge(db, ada, groupId, { ...fixtureTerms, name: 'No sweets' }), { ok: true, name: 'No sweets' })
    assert.deepEqual(await joinGroup(db, grace, groupId), { ok: true, groupId, label: 'Pantry crew' })

    assert.deepEqual(await dropGroupName(db, grace, groupId), { ok: false, failure: 'not_creator' })
    assert.deepEqual(await dropGroupName(db, lin, groupId), { ok: false, failure: 'not_member' })
    const missing = parseGroupId('00000000-0000-4000-8000-000000000099')
    if (!missing) throw new Error('id')
    assert.deepEqual(await dropGroupName(db, ada, missing), { ok: false, failure: 'group_missing' })
    assert.equal((await readGroup(db, groupId))?.name, 'Pantry crew')

    assert.deepEqual(await dropGroupName(db, ada, groupId), { ok: true, label: 'No sweets' })
    const dropped = await readGroup(db, groupId)
    assert.ok(dropped)
    assert.equal(dropped.name, null)
    assert.equal(labelOf(dropped), 'No sweets')
    const written = (await groupRef(db, groupId).get()).updateTime
    assert.deepEqual(await dropGroupName(db, ada, groupId), { ok: true, label: 'No sweets' })
    assert.deepEqual((await groupRef(db, groupId).get()).updateTime, written)

    const started = await legacyGroupWith(db, [ada, grace], 'Old pair')
    assert.deepEqual(await saveChallenge(db, ada, started, fixtureTerms), { ok: true, name: 'Morning run' })
    for (const who of [ada, grace]) await saveRhythm(db, who, started, { interval: 'every_day' })
    assert.deepEqual(await startChallenge(db, ada, started), { ok: true, name: 'Morning run' })
    assert.deepEqual(await dropGroupName(db, ada, started), { ok: true, label: 'Morning run' })
    assert.equal((await readGroup(db, started))?.challenge?.phase, 'active')
    assert.equal((await readGroup(db, started))?.name, null)
  } finally {
    await closeDatabase(db)
  }
})

test('only the creator of a named group sees "Use the challenge name instead", and pressing it relabels the page', async () => {
  const db = openTestDatabase()
  const [adaAccount, graceAccount] = await Promise.all(['Ada', 'Grace'].map((name) => person(db, name)))
  const ada = { cookie: await cookieFor(db, adaAccount) }
  const grace = { cookie: await cookieFor(db, graceAccount) }
  const { server, base } = await listen(db)
  const page = async (cookie: string, path: string) => (await fetch(`${base}${path}`, { headers: { cookie } })).text()
  try {
    const groupId = await legacyGroupWith(db, [adaAccount, graceAccount], 'Pantry crew')
    const groupPath = `/groups/${groupId}`
    assert.doesNotMatch(await page(ada.cookie, groupPath), /Use the challenge name instead/)
    assert.deepEqual(await saveChallenge(db, adaAccount, groupId, { ...fixtureTerms, name: 'No sweets' }), { ok: true, name: 'No sweets' })

    const before = await page(ada.cookie, groupPath)
    assert.match(before, /<h2>Pantry crew<\/h2>/)
    assert.match(before, new RegExp(`action="${groupPath}/drop-name"`))
    assert.match(before, /Use the challenge name instead/)
    assert.doesNotMatch(await page(grace.cookie, groupPath), /Use the challenge name instead/)

    const refused = await postForm(base, `${groupPath}/drop-name`, grace.cookie)
    assert.equal(refused.status, 403)
    assert.match(await refused.text(), /Only the person who made the challenge can change its name\./)
    assert.equal((await fetch(`${base}${groupPath}/drop-name`, { headers: { cookie: ada.cookie } })).status, 405)
    assert.equal((await postForm(base, `${groupPath}/drop-name`, null)).status, 401)

    const dropped = await postForm(base, `${groupPath}/drop-name`, ada.cookie)
    assert.equal(dropped.status, 303)
    assert.equal(dropped.headers.get('location'), groupPath)
    const toast = (dropped.headers as Headers & { getSetCookie: () => string[] }).getSetCookie().find((line) => line.startsWith('toast='))
    assert.equal(decodeURIComponent((toast ?? '').split(';')[0]!.slice('toast='.length)), 'Now called No sweets.')
    const after = await page(ada.cookie, groupPath)
    assert.match(after, /<h2>No sweets<\/h2>/)
    assert.doesNotMatch(after, /Use the challenge name instead/)
    assert.match(await page(ada.cookie, '/'), /<span class="group-name">No sweets<\/span>/)
    assert.equal((await postForm(base, `${groupPath}/drop-name`, ada.cookie)).status, 303)

    const fresh = await postForm(base, '/groups', ada.cookie, createForm({ name: 'Evening run' }))
    assert.doesNotMatch(await page(ada.cookie, fresh.headers.get('location') ?? ''), /Use the challenge name instead/)
  } finally {
    await close(server, db)
  }
})

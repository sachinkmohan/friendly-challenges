import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatStake,
  memberIsDue,
  parseIsoDate,
  readChallengeHeadline,
  readMemberChallenge,
  saveChallenge,
  saveRhythm,
  startChallenge,
  type ChallengeInput,
  type ChallengeWindow,
  type MembershipSpan,
  type Rhythm,
  type RhythmKind,
} from '../src/challenge.ts'
import { CURRENCY_CODES } from '../src/currencies.ts'
import { closeDatabase, openTestDatabase, type Database } from '../src/db.ts'
import { joinGroup, parseGroupId, type GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import { safeReturnPath } from '../src/page.ts'
import { activeMemberIds, groupRef, readGroup, utcToday, type ChallengeDoc } from '../src/store.ts'
import { closeServer, cookieFor, groupWith, listen, person, post, setChallengeDates, setLeftOn } from './support/fixtures.ts'

function day(value: string) {
  const parsed = parseIsoDate(value)
  if (!parsed) throw new Error(`date ${value}`)
  return parsed
}

function due(
  kind: RhythmKind | null,
  on: string,
  extras: {
    phase?: 'draft' | 'active'
    starts?: string
    ends?: string
    joined?: string
    left?: string | null
    anchor?: string
    challenge?: null
    span?: null
  } = {},
): boolean {
  const challenge: ChallengeWindow | null =
    extras.challenge === null
      ? null
      : {
          phase: extras.phase ?? 'active',
          startsOn: day(extras.starts ?? '2026-11-01'),
          endsOn: day(extras.ends ?? '2026-11-30'),
        }
  const span: MembershipSpan | null =
    extras.span === null
      ? null
      : { joinedOn: day(extras.joined ?? '2026-11-01'), leftOn: extras.left ? day(extras.left) : null }
  const rhythm: Rhythm | null = kind === null ? null : { kind, anchorOn: day(extras.anchor ?? '2026-11-02') }
  return memberIsDue(challenge, span, rhythm, day(on))
}

function terms(overrides: Partial<ChallengeInput> = {}): ChallengeInput {
  return {
    name: 'No sweets',
    type: 'no_sugar',
    customLabel: '',
    currency: 'USD',
    stake: '5',
    startsOn: '2026-11-01',
    endsOn: '2026-11-30',
    ...overrides,
  }
}

async function challengeOf(db: Database, groupId: GroupId | string): Promise<ChallengeDoc | null> {
  const group = await readGroup(db, groupId)
  assert.ok(group)
  return group.challenge
}

async function stakeOf(db: Database, groupId: GroupId): Promise<number | undefined> {
  return (await challengeOf(db, groupId))?.stakeMinor
}

async function challengeCount(db: Database): Promise<number> {
  const groups = await db.collection('groups').get()
  return groups.docs.filter((doc) => doc.data().challenge !== null).length
}

test('a member is due on the anchor and every step after it', () => {
  assert.equal(due('alternate_days', '2026-11-02'), true)
  assert.equal(due('alternate_days', '2026-11-04'), true)
  assert.equal(due('alternate_days', '2026-11-01'), false)
  assert.equal(due('alternate_days', '2026-11-03'), false)
  assert.equal(due('every_2_days', '2026-11-02'), true)
  assert.equal(due('every_2_days', '2026-11-04'), true)
  assert.equal(due('every_2_days', '2026-11-01'), false)
  assert.equal(due('every_2_days', '2026-11-03'), false)
  assert.equal(due('every_day', '2026-11-02'), true)
  assert.equal(due('every_day', '2026-11-03'), true)
  assert.equal(due('every_3_days', '2026-11-02'), true)
  assert.equal(due('every_3_days', '2026-11-05'), true)
  assert.equal(due('every_3_days', '2026-11-04'), false)
  assert.equal(due('every_day', '2026-10-31', { joined: '2026-11-01', starts: '2026-10-01' }), false)
  assert.equal(due('every_day', '2026-11-04', { left: '2026-11-04' }), true)
  assert.equal(due('every_day', '2026-11-05', { left: '2026-11-04' }), false)
  assert.equal(due('every_day', '2026-11-02', { left: '2026-11-02', joined: '2026-11-02' }), true)
  assert.equal(due('every_day', '2026-11-03', { left: '2026-11-02', joined: '2026-11-02' }), false)
  assert.equal(due('every_day', '2026-11-02', { phase: 'draft' }), false)
  assert.equal(due(null, '2026-11-02'), false)
  assert.equal(due('every_day', '2026-11-02', { challenge: null }), false)
  assert.equal(due('every_day', '2026-11-02', { span: null }), false)
  assert.equal(due('every_2_days', '2026-11-01', { starts: '2026-11-03', anchor: '2026-11-01' }), false)
  assert.equal(due('every_2_days', '2026-11-03', { starts: '2026-11-03', anchor: '2026-11-01' }), true)
  assert.equal(parseIsoDate('2026-02-31'), null)
  assert.equal(parseIsoDate('2026-11-06'), '2026-11-06')
})

test('the stake scales by the currency exponent and an unknown code is rejected', async () => {
  const db = openTestDatabase()
  try {
    const ada = await person(db, 'Ada')
    const outsider = await person(db, 'Grace')
    const groupId = await groupWith(db, [ada])
    const missing = parseGroupId('00000000-0000-4000-8000-000000000099')
    if (!missing) throw new Error('id')
    assert.deepEqual(await saveChallenge(db, ada, missing, terms()), { ok: false, failure: 'group_missing' })
    assert.deepEqual(await saveChallenge(db, outsider, groupId, terms()), { ok: false, failure: 'not_member' })

    const rejected: readonly (readonly [string, string, string])[] = [
      ['USD', '-5', 'stake_not_positive'],
      ['USD', '+5', 'stake_not_positive'],
      ['USD', '1,000', 'stake_not_positive'],
      ['USD', '1.2.3', 'stake_not_positive'],
      ['USD', '5.', 'stake_not_positive'],
      ['USD', '0', 'stake_not_positive'],
      ['USD', '0.00', 'stake_not_positive'],
      ['JPY', '5.0', 'stake_not_positive'],
      ['USD', '5.001', 'stake_not_positive'],
      ['USD', '10000000.01', 'stake_too_large'],
      ['XYZ', '5', 'bad_currency'],
      ['US', '5', 'bad_currency'],
    ]
    for (const [currency, stake, failure] of rejected) {
      assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ currency, stake })), { ok: false, failure })
    }
    assert.equal(await challengeCount(db), 0)

    const usd = await saveChallenge(db, ada, groupId, terms({ currency: 'usd', stake: ' 5 ' }))
    assert.deepEqual(usd, { ok: true })
    assert.equal(await stakeOf(db, groupId), 500)
    const usdCard = await readMemberChallenge(db, ada, groupId)
    assert.equal(usdCard.ok, true)
    if (!usdCard.ok || usdCard.card.phase === 'unopened') throw new Error('draft')
    assert.equal(formatStake(usdCard.card.terms.stakeMinor, usdCard.card.minorDigits), '5.00')
    assert.equal(usdCard.card.terms.currency, 'USD')

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ currency: 'JPY', stake: '5' })), { ok: true })
    assert.equal(await stakeOf(db, groupId), 5)
    const jpyCard = await readMemberChallenge(db, ada, groupId)
    if (!jpyCard.ok || jpyCard.card.phase === 'unopened') throw new Error('draft')
    assert.equal(formatStake(jpyCard.card.terms.stakeMinor, jpyCard.card.minorDigits), '5')

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ currency: 'KWD', stake: '1.500' })), { ok: true })
    assert.equal(await stakeOf(db, groupId), 1500)
    const kwdCard = await readMemberChallenge(db, ada, groupId)
    if (!kwdCard.ok || kwdCard.card.phase === 'unopened') throw new Error('draft')
    assert.equal(formatStake(kwdCard.card.terms.stakeMinor, kwdCard.card.minorDigits), '1.500')

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ currency: 'BHD', stake: '0.005' })), { ok: true })
    assert.equal(await stakeOf(db, groupId), 5)
    const bhdCard = await readMemberChallenge(db, ada, groupId)
    if (!bhdCard.ok || bhdCard.card.phase === 'unopened') throw new Error('draft')
    assert.equal(formatStake(bhdCard.card.terms.stakeMinor, bhdCard.card.minorDigits), '0.005')

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ currency: 'USD', stake: '10000000' })), { ok: true })
    assert.equal(await stakeOf(db, groupId), 1000000000)
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ currency: 'XYZ', stake: '5' })), {
      ok: false,
      failure: 'bad_currency',
    })
    assert.equal(await stakeOf(db, groupId), 1000000000)

    const headline = await readChallengeHeadline(db, groupId)
    assert.equal(headline?.terms.name, 'No sweets')
    assert.equal(headline?.minorDigits, 2)
    assert.equal(CURRENCY_CODES.length, 165)
    for (const code of ['XAU', 'XXX', 'BGN', 'ANG']) {
      assert.equal(CURRENCY_CODES.includes(code), false)
      assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ currency: code })), { ok: false, failure: 'bad_currency' })
    }
  } finally {
    await closeDatabase(db)
  }
})

test('a preset stores a null label and a blank custom label is rejected', async () => {
  const db = openTestDatabase()
  try {
    const ada = await person(db, 'Ada')
    const groupId = await groupWith(db, [ada])
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ type: 'custom', customLabel: '   ' })), {
      ok: false,
      failure: 'custom_label_empty',
    })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ type: 'nope' })), {
      ok: false,
      failure: 'type_missing',
    })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ startsOn: '2026-02-31' })), {
      ok: false,
      failure: 'bad_date',
    })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ endsOn: '2026-10-01' })), {
      ok: false,
      failure: 'ends_before_start',
    })
    assert.equal(await challengeCount(db), 0)

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ type: 'coding', customLabel: 'Nope' })), { ok: true })
    const preset = await challengeOf(db, groupId)
    assert.equal(preset?.typeKind, 'coding')
    assert.equal(preset?.customLabel, null)

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ type: 'custom', customLabel: '  No sugar  ' })), {
      ok: true,
    })
    const custom = await challengeOf(db, groupId)
    assert.equal(custom?.typeKind, 'custom')
    assert.equal(custom?.customLabel, 'No sugar')
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ type: 'custom', customLabel: 'No sugar' })), { ok: true })
    assert.equal(await challengeCount(db), 1)
  } finally {
    await closeDatabase(db)
  }
})

test('two members cannot start, three can, and a second start keeps the challenge active', async () => {
  const db = openTestDatabase()
  try {
    const people = await Promise.all(['Ada', 'Grace', 'Lin', 'Noor', 'Owen', 'Bea'].map((name) => person(db, name)))
    const ada = people[0] as Account
    const groupId = await groupWith(db, people.slice(0, 2))
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true })
    assert.deepEqual(await startChallenge(db, ada, groupId), { ok: false, failure: 'outside_headcount' })
    assert.equal((await challengeOf(db, groupId))?.phase, 'draft')

    const joined = await joinGroup(db, people[2] as Account, groupId)
    assert.equal(joined.ok, true)
    const ready = await readMemberChallenge(db, ada, groupId)
    if (!ready.ok || ready.card.phase !== 'draft') throw new Error('draft')
    assert.equal(ready.card.floor, 3)
    assert.equal(ready.card.cap, 5)

    assert.deepEqual(await startChallenge(db, ada, groupId), { ok: true })
    assert.deepEqual(await startChallenge(db, people[1] as Account, groupId), { ok: true })
    await setLeftOn(db, groupId, (people[2] as Account).id, utcToday())
    assert.deepEqual(await startChallenge(db, ada, groupId), { ok: true })
    assert.equal((await challengeOf(db, groupId))?.phase, 'active')

    const full = await groupWith(db, people.slice(0, 5), 'Full')
    const refused = await joinGroup(db, people[5] as Account, full)
    assert.deepEqual(refused, { ok: false, failure: 'group_full' })

    const early = await groupWith(db, people.slice(0, 2), 'Early')
    assert.deepEqual(await saveChallenge(db, ada, early, terms()), { ok: true })
    assert.deepEqual(await startChallenge(db, ada, early), { ok: false, failure: 'outside_headcount' })
    assert.equal((await challengeOf(db, early))?.phase, 'draft')
  } finally {
    await closeDatabase(db)
  }
})

test('started terms and a stored rhythm stay put unless the write is equal', async () => {
  const db = openTestDatabase()
  try {
    const people = await Promise.all(['Ada', 'Grace', 'Lin'].map((name) => person(db, name)))
    const ada = people[0] as Account
    const grace = people[1] as Account
    const groupId = await groupWith(db, people)
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true })
    assert.deepEqual(await saveRhythm(db, ada, groupId, { interval: 'weekly', anchorOn: '2026-11-02' }), {
      ok: false,
      failure: 'bad_interval',
    })
    assert.deepEqual(await saveRhythm(db, ada, groupId, { interval: 'every_day', anchorOn: '2026-02-31' }), {
      ok: false,
      failure: 'bad_anchor',
    })
    assert.deepEqual(await saveRhythm(db, ada, groupId, { interval: 'every_day', anchorOn: '2026-12-01' }), {
      ok: false,
      failure: 'anchor_after_end',
    })
    assert.deepEqual(await saveRhythm(db, ada, groupId, { interval: 'every_day', anchorOn: '2026-11-20' }), { ok: true })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ endsOn: '2026-11-10' })), {
      ok: false,
      failure: 'anchor_after_end',
    })
    assert.deepEqual(await saveRhythm(db, ada, groupId, { interval: 'alternate_days', anchorOn: '2026-10-01' }), {
      ok: true,
    })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ startsOn: '2026-11-03' })), { ok: true })
    const dated = await readGroup(db, groupId)
    assert.equal(dated?.challenge?.startsOn, '2026-11-03')
    assert.equal(dated?.challenge?.endsOn, '2026-11-30')
    assert.equal(dated?.rhythms[ada.id]?.anchorOn, '2026-10-01')

    await setChallengeDates(db, groupId, '2026-09-01', '2026-09-15')
    assert.deepEqual(await startChallenge(db, ada, groupId), { ok: false, failure: 'rhythm_past_end' })
    const blocked = await challengeOf(db, groupId)
    assert.equal(blocked?.phase, 'draft')
    assert.equal(blocked?.endsOn, '2026-09-15')

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true })
    assert.deepEqual(await startChallenge(db, ada, groupId), { ok: true })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ name: 'Other' })), { ok: false, failure: 'frozen' })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ stake: '6' })), { ok: false, failure: 'frozen' })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ endsOn: '2026-12-31' })), { ok: false, failure: 'frozen' })
    const frozen = await challengeOf(db, groupId)
    assert.equal(frozen?.name, 'No sweets')
    assert.equal(frozen?.stakeMinor, 500)
    assert.equal(frozen?.endsOn, '2026-11-30')

    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_day', anchorOn: '2026-11-02' }), { ok: true })
    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_day', anchorOn: '2026-11-02' }), { ok: true })
    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_3_days', anchorOn: '2026-11-02' }), {
      ok: false,
      failure: 'frozen',
    })
    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_day', anchorOn: '2026-11-03' }), {
      ok: false,
      failure: 'frozen',
    })
    const stored = await readGroup(db, groupId)
    assert.deepEqual(stored?.rhythms[grace.id], { kind: 'every_day', anchorOn: '2026-11-02' })
    assert.equal(stored?.challenge?.phase, 'active')
  } finally {
    await closeDatabase(db)
  }
})

test('a challenge path is not a sign-in return path', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  assert.equal(safeReturnPath(`/groups/${id}`), `/groups/${id}`)
  assert.equal(safeReturnPath('/groups/new'), '/groups/new')
  assert.equal(safeReturnPath(`/groups/${id}/challenge`), '/')
  assert.equal(safeReturnPath(`/groups/${id}/challenge/start`), '/')
  assert.equal(safeReturnPath(`/groups/${id}/rhythm`), '/')
  assert.equal(safeReturnPath(`/groups/${id}/join`), '/')
})

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

function challengeForm(overrides: Record<string, string> = {}): string {
  return form({
    name: 'No sweets',
    type: 'coding',
    custom_label: 'Nope',
    currency: 'USD',
    stake: '5',
    starts_on: '2026-11-01',
    ends_on: '2026-11-30',
    ...overrides,
  })
}

test('the group card saves the stake, starts at three members, and then freezes', async () => {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const grace = await person(db, 'Grace')
  const lin = await person(db, 'Lin')
  const noor = await person(db, 'Noor')
  const owen = await person(db, 'Owen')
  const bea = await person(db, 'Bea')
  const adaCookie = await cookieFor(db, ada)
  const graceCookie = await cookieFor(db, grace)
  const linCookie = await cookieFor(db, lin)
  const beaCookie = await cookieFor(db, bea)
  const { server, base } = await listen(db)
  try {
    const created = await post(base, '/groups', adaCookie, 'name=Morning+run')
    assert.equal(created.status, 303)
    const groupPath = created.headers.get('location')
    assert.ok(groupPath)
    assert.equal(await challengeCount(db), 0)

    for (const path of [`${groupPath}/challenge`, `${groupPath}/challenge/start`, `${groupPath}/rhythm`]) {
      const looked = await fetch(`${base}${path}`)
      assert.equal(looked.status, 405)
      assert.equal(looked.headers.get('allow'), 'POST')
      assert.equal(await looked.text(), '')
    }
    const postShow = await post(base, groupPath, adaCookie)
    assert.equal(postShow.status, 405)
    assert.equal(postShow.headers.get('allow'), 'GET')

    const signedOut = await post(base, `${groupPath}/challenge`, null, challengeForm())
    assert.equal(signedOut.status, 401)
    assert.equal(await challengeCount(db), 0)

    const saved = await post(base, `${groupPath}/challenge`, adaCookie, challengeForm())
    assert.equal(saved.status, 303)
    assert.equal(saved.headers.get('location'), groupPath)
    const groupId = groupPath.slice('/groups/'.length)
    const row = await challengeOf(db, groupId)
    assert.equal(row?.stakeMinor, 500)
    assert.equal(row?.currency, 'USD')
    assert.equal(row?.typeKind, 'coding')
    assert.equal(row?.customLabel, null)
    const memberHtml = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(memberHtml, /No sweets/)
    assert.match(memberHtml, /Coding/)
    assert.match(memberHtml, /value="5\.00"/)
    assert.match(memberHtml, /value="USD"/)
    assert.match(memberHtml, /value="JPY"/)
    assert.match(memberHtml, /value="KWD"/)
    assert.doesNotMatch(memberHtml, /value="XYZ"/)
    assert.match(memberHtml, /name="stake"/)
    assert.match(memberHtml, /A challenge can start when 3 to 5 people are active/)
    assert.doesNotMatch(memberHtml, /challenge\/start/)
    assert.match(memberHtml, /class="screen is-current"/)
    assert.doesNotMatch(memberHtml, /<section[^>]*\sid=/)

    const preview = await (await fetch(`${base}${groupPath}`, { headers: { cookie: graceCookie } })).text()
    assert.match(preview, /5\.00 USD/)
    assert.match(preview, /No sweets/)
    assert.match(preview, /Coding/)
    assert.doesNotMatch(preview, /Ada/)
    assert.match(preview, /Join group/)

    const blank = await post(base, `${groupPath}/challenge`, adaCookie, challengeForm({ name: '', stake: '9.9' }))
    assert.equal(blank.status, 400)
    const blankHtml = await blank.text()
    assert.match(blankHtml, /Type a challenge name/)
    assert.match(blankHtml, /value="9\.9"/)
    assert.equal((await challengeOf(db, groupId))?.stakeMinor, 500)

    const again = await post(base, `${groupPath}/challenge`, adaCookie, challengeForm())
    assert.equal(again.status, 303)
    assert.equal(await challengeCount(db), 1)

    const jpy = await post(base, `${groupPath}/challenge`, adaCookie, challengeForm({ currency: 'JPY', stake: '5' }))
    assert.equal(jpy.status, 303)
    assert.equal((await challengeOf(db, groupId))?.stakeMinor, 5)
    const unknown = await post(base, `${groupPath}/challenge`, adaCookie, challengeForm({ currency: 'XYZ' }))
    assert.equal(unknown.status, 400)
    assert.match(await unknown.text(), /Use a three-letter currency code/)
    assert.equal((await challengeOf(db, groupId))?.stakeMinor, 5)

    assert.equal((await post(base, `${groupPath}/join`, graceCookie)).status, 303)
    const tooSmall = await post(base, `${groupPath}/challenge/start`, adaCookie)
    assert.equal(tooSmall.status, 409)
    assert.match(await tooSmall.text(), /outside the range on this card/)
    assert.equal((await challengeOf(db, groupId))?.phase, 'draft')

    assert.equal((await post(base, `${groupPath}/join`, linCookie)).status, 303)
    const ready = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(ready, /action="[^"]+\/challenge\/start"/)
    const started = await post(base, `${groupPath}/challenge/start`, adaCookie)
    assert.equal(started.status, 303)
    const startedAgain = await post(base, `${groupPath}/challenge/start`, graceCookie)
    assert.equal(startedAgain.status, 303)
    const activeHtml = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(activeHtml, /5 JPY/)
    assert.doesNotMatch(activeHtml, /name="stake"/)
    assert.doesNotMatch(activeHtml, /challenge\/start/)
    assert.match(activeHtml, /name="interval"/)
    assert.match(activeHtml, /aria-describedby="rhythm-anchor-hint"/)
    assert.match(activeHtml, /The first day you log\. Your next days repeat from it at the interval above\./)
    assert.equal(await challengeCount(db), 1)
    assert.equal((await challengeOf(db, groupId))?.phase, 'active')

    const rhythm = await post(
      base,
      `${groupPath}/rhythm`,
      adaCookie,
      form({ interval: 'every_day', anchor_on: '2026-11-02' }),
    )
    assert.equal(rhythm.status, 303)
    const rhythmHtml = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(rhythmHtml, /Every day/)
    assert.match(rhythmHtml, /2026-11-02/)
    assert.doesNotMatch(rhythmHtml, /name="interval"/)
    const changedRhythm = await post(
      base,
      `${groupPath}/rhythm`,
      adaCookie,
      form({ interval: 'every_3_days', anchor_on: '2026-11-02' }),
    )
    assert.equal(changedRhythm.status, 409)
    const changedRhythmHtml = await changedRhythm.text()
    assert.match(changedRhythmHtml, /This challenge has started, so those fields stay as they are/)
    assert.match(changedRhythmHtml, /Every day/)
    assert.doesNotMatch(changedRhythmHtml, /Every 3 days/)
    assert.equal((await readGroup(db, groupId))?.rhythms[ada.id]?.kind, 'every_day')

    const renamed = await post(base, `${groupPath}/challenge`, adaCookie, challengeForm({ name: 'Renamed challenge' }))
    assert.equal(renamed.status, 409)
    const renamedHtml = await renamed.text()
    assert.match(renamedHtml, /No sweets/)
    assert.doesNotMatch(renamedHtml, /Renamed challenge/)
    assert.equal((await challengeOf(db, groupId))?.name, 'No sweets')

    const refused = await post(base, `${groupPath}/challenge`, beaCookie, challengeForm())
    assert.equal(refused.status, 403)
    const missing = await post(
      base,
      '/groups/00000000-0000-4000-8000-000000000099/challenge',
      adaCookie,
      challengeForm(),
    )
    assert.equal(missing.status, 404)

    assert.equal((await post(base, `${groupPath}/join`, await cookieFor(db, noor))).status, 303)
    assert.equal((await post(base, `${groupPath}/join`, await cookieFor(db, owen))).status, 303)
    const full = await fetch(`${base}${groupPath}`, { headers: { cookie: beaCookie } })
    assert.equal(full.status, 200)
    const fullHtml = await full.text()
    assert.match(fullHtml, /This group is full/)
    assert.match(fullHtml, /5 JPY/)
    assert.doesNotMatch(fullHtml, /<form/)
    assert.doesNotMatch(fullHtml, /Ada/)
    const sixth = await post(base, `${groupPath}/join`, beaCookie)
    assert.equal(sixth.status, 409)
    const group = await readGroup(db, groupId)
    assert.ok(group)
    assert.equal(activeMemberIds(group).length, 5)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

const storedTerms = {
  name: 'No sweets',
  typeKind: 'no_sugar',
  customLabel: null,
  currency: 'USD',
  stakeMinor: 500,
  startsOn: '2026-11-01',
  endsOn: '2026-11-30',
}

async function storedChallenge(db: Database, challenge: Record<string, unknown>): Promise<string> {
  const groupId = '00000000-0000-4000-8000-000000000042'
  await groupRef(db, groupId).set({
    name: 'Stored',
    createdBy: 'ada',
    memberIds: ['ada'],
    members: { ada: { joinedOn: '2026-11-01', leftOn: null } },
    challenge,
    rhythms: {},
  })
  return groupId
}

test('a started challenge stored before causes reads as one with no cause, and a draft never carries one', async () => {
  const db = openTestDatabase()
  try {
    const legacy = await storedChallenge(db, { ...storedTerms, phase: 'active' })
    assert.deepEqual((await readGroup(db, legacy))?.challenge, { ...storedTerms, phase: 'active', cause: null })

    const solo = await storedChallenge(db, { ...storedTerms, phase: 'active', cause: 'Food bank' })
    assert.deepEqual((await readGroup(db, solo))?.challenge, { ...storedTerms, phase: 'active', cause: 'Food bank' })

    const draft = await storedChallenge(db, { ...storedTerms, phase: 'draft' })
    assert.deepEqual((await readGroup(db, draft))?.challenge, { ...storedTerms, phase: 'draft' })

    const draftWithCause = await storedChallenge(db, { ...storedTerms, phase: 'draft', cause: 'Food bank' })
    await assert.rejects(readGroup(db, draftWithCause))

    const badCause = await storedChallenge(db, { ...storedTerms, phase: 'active', cause: 7 })
    await assert.rejects(readGroup(db, badCause))
  } finally {
    await closeDatabase(db)
  }
})

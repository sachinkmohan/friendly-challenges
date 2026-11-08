import assert from 'node:assert/strict'
import { FieldPath } from 'firebase-admin/firestore'
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
import { closeServer, cookieFor, groupWith, listen, person, post, setLeftOn } from './support/fixtures.ts'

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
  const rhythm: Rhythm | null = kind === null ? null : { kind }
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

async function pickRhythms(db: Database, groupId: GroupId, people: readonly Account[]): Promise<void> {
  for (const who of people) assert.deepEqual(await saveRhythm(db, who, groupId, { interval: 'every_day' }), { ok: true, rhythm: 'every_day' })
}

async function challengeCount(db: Database): Promise<number> {
  const groups = await db.collection('groups').get()
  return groups.docs.filter((doc) => doc.data().challenge !== null).length
}

test('a member is due on the start date and every step after it', () => {
  assert.equal(due('every_2_days', '2026-11-01'), true)
  assert.equal(due('every_2_days', '2026-11-02'), false)
  assert.equal(due('every_2_days', '2026-11-03'), true)
  assert.equal(due('every_day', '2026-11-01'), true)
  assert.equal(due('every_day', '2026-11-02'), true)
  assert.equal(due('every_3_days', '2026-11-01'), true)
  assert.equal(due('every_3_days', '2026-11-03'), false)
  assert.equal(due('every_3_days', '2026-11-04'), true)
  assert.equal(due('every_2_days', '2026-11-03', { starts: '2026-11-03' }), true)
  assert.equal(due('every_2_days', '2026-11-04', { starts: '2026-11-03' }), false)
  assert.equal(due('every_2_days', '2026-11-05', { starts: '2026-11-03' }), true)
  assert.equal(due('every_2_days', '2026-11-04', { joined: '2026-11-04' }), false)
  assert.equal(due('every_2_days', '2026-11-05', { joined: '2026-11-04' }), true)
  assert.equal(due('every_day', '2026-10-31', { joined: '2026-11-01', starts: '2026-10-01' }), false)
  assert.equal(due('every_day', '2026-11-04', { left: '2026-11-04' }), true)
  assert.equal(due('every_day', '2026-11-05', { left: '2026-11-04' }), false)
  assert.equal(due('every_day', '2026-11-02', { left: '2026-11-02', joined: '2026-11-02' }), true)
  assert.equal(due('every_day', '2026-11-03', { left: '2026-11-02', joined: '2026-11-02' }), false)
  assert.equal(due('every_day', '2026-11-02', { phase: 'draft' }), false)
  assert.equal(due(null, '2026-11-02'), false)
  assert.equal(due('every_day', '2026-11-02', { challenge: null }), false)
  assert.equal(due('every_day', '2026-11-02', { span: null }), false)
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
    assert.deepEqual(usd, { ok: true, name: 'No sweets' })
    assert.equal(await stakeOf(db, groupId), 500)
    const usdCard = await readMemberChallenge(db, ada, groupId)
    assert.equal(usdCard.ok, true)
    if (!usdCard.ok || usdCard.card.phase === 'unopened') throw new Error('draft')
    assert.equal(formatStake(usdCard.card.terms.stakeMinor, usdCard.card.minorDigits), '5.00')
    assert.equal(usdCard.card.terms.currency, 'USD')

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ currency: 'JPY', stake: '5' })), { ok: true, name: 'No sweets' })
    assert.equal(await stakeOf(db, groupId), 5)
    const jpyCard = await readMemberChallenge(db, ada, groupId)
    if (!jpyCard.ok || jpyCard.card.phase === 'unopened') throw new Error('draft')
    assert.equal(formatStake(jpyCard.card.terms.stakeMinor, jpyCard.card.minorDigits), '5')

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ currency: 'KWD', stake: '1.500' })), { ok: true, name: 'No sweets' })
    assert.equal(await stakeOf(db, groupId), 1500)
    const kwdCard = await readMemberChallenge(db, ada, groupId)
    if (!kwdCard.ok || kwdCard.card.phase === 'unopened') throw new Error('draft')
    assert.equal(formatStake(kwdCard.card.terms.stakeMinor, kwdCard.card.minorDigits), '1.500')

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ currency: 'BHD', stake: '0.005' })), { ok: true, name: 'No sweets' })
    assert.equal(await stakeOf(db, groupId), 5)
    const bhdCard = await readMemberChallenge(db, ada, groupId)
    if (!bhdCard.ok || bhdCard.card.phase === 'unopened') throw new Error('draft')
    assert.equal(formatStake(bhdCard.card.terms.stakeMinor, bhdCard.card.minorDigits), '0.005')

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ currency: 'USD', stake: '10000000' })), { ok: true, name: 'No sweets' })
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

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ type: 'coding', customLabel: 'Nope' })), { ok: true, name: 'No sweets' })
    const preset = await challengeOf(db, groupId)
    assert.equal(preset?.typeKind, 'coding')
    assert.equal(preset?.customLabel, null)

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ type: 'custom', customLabel: '  No sugar  ' })), {
      ok: true,
      name: 'No sweets',
    })
    const custom = await challengeOf(db, groupId)
    assert.equal(custom?.typeKind, 'custom')
    assert.equal(custom?.customLabel, 'No sugar')
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ type: 'custom', customLabel: 'No sugar' })), { ok: true, name: 'No sweets' })
    assert.equal(await challengeCount(db), 1)
  } finally {
    await closeDatabase(db)
  }
})

const noCause = { cause: '' }

test('one member starts a solo challenge owed to a cause and two to five start one with no cause', async () => {
  const db = openTestDatabase()
  try {
    const people = await Promise.all(['Ada', 'Grace', 'Lin', 'Noor', 'Owen', 'Bea'].map((name) => person(db, name)))
    const [ada, grace] = people as [Account, Account]
    const solo = await groupWith(db, [ada], 'Alone')
    assert.deepEqual(await saveChallenge(db, ada, solo, terms()), { ok: true, name: 'No sweets' })
    await pickRhythms(db, solo, [ada])
    const soloCard = await readMemberChallenge(db, ada, solo)
    if (!soloCard.ok || soloCard.card.phase !== 'draft') throw new Error('draft')
    assert.equal(soloCard.card.start, 'solo')
    assert.equal(soloCard.card.cap, 5)
    assert.equal((await readChallengeHeadline(db, solo))?.stakesGo, null)

    assert.deepEqual(await startChallenge(db, ada, solo, noCause), { ok: false, failure: 'cause_empty' })
    assert.deepEqual(await startChallenge(db, ada, solo, { cause: '   ' }), { ok: false, failure: 'cause_empty' })
    assert.deepEqual(await startChallenge(db, ada, solo, { cause: 'a'.repeat(41) }), { ok: false, failure: 'cause_too_long' })
    assert.deepEqual(await startChallenge(db, ada, solo, { cause: '😀'.repeat(41) }), { ok: false, failure: 'cause_too_long' })
    assert.equal((await challengeOf(db, solo))?.phase, 'draft')

    assert.deepEqual(await startChallenge(db, ada, solo, { cause: '  Food bank  ' }), { ok: true, name: 'No sweets' })
    assert.deepEqual(await challengeOf(db, solo), {
      name: 'No sweets',
      typeKind: 'no_sugar',
      customLabel: null,
      currency: 'USD',
      stakeMinor: 500,
      startsOn: '2026-11-01',
      endsOn: '2026-11-30',
      phase: 'active',
      cause: 'Food bank',
    })
    assert.deepEqual(await startChallenge(db, ada, solo, { cause: 'Somewhere else' }), { ok: true, name: 'No sweets' })
    assert.deepEqual(await startChallenge(db, ada, solo, noCause), { ok: true, name: 'No sweets' })
    const startedSolo = await readMemberChallenge(db, ada, solo)
    if (!startedSolo.ok || startedSolo.card.phase !== 'active') throw new Error('active')
    assert.deepEqual(startedSolo.card.stakesGo, { kind: 'cause', name: 'Food bank' })
    assert.deepEqual((await readChallengeHeadline(db, solo))?.stakesGo, { kind: 'cause', name: 'Food bank' })

    const longest = await groupWith(db, [ada], 'Longest')
    assert.deepEqual(await saveChallenge(db, ada, longest, terms()), { ok: true, name: 'No sweets' })
    await pickRhythms(db, longest, [ada])
    assert.deepEqual(await startChallenge(db, ada, longest, { cause: '😀'.repeat(40) }), { ok: true, name: 'No sweets' })

    const pair = await groupWith(db, [ada, grace], 'Pair')
    assert.deepEqual(await saveChallenge(db, ada, pair, terms()), { ok: true, name: 'No sweets' })
    await pickRhythms(db, pair, [ada, grace])
    const pairCard = await readMemberChallenge(db, ada, pair)
    if (!pairCard.ok || pairCard.card.phase !== 'draft') throw new Error('draft')
    assert.equal(pairCard.card.start, 'group')
    assert.deepEqual(await startChallenge(db, ada, pair, { cause: 'Food bank' }), { ok: false, failure: 'cause_for_group' })
    assert.equal((await challengeOf(db, pair))?.phase, 'draft')
    assert.deepEqual(await startChallenge(db, ada, pair, { cause: '  ' }), { ok: true, name: 'No sweets' })
    assert.deepEqual(await startChallenge(db, grace, pair, { cause: 'Food bank' }), { ok: false, failure: 'not_creator' })
    const startedPair = await challengeOf(db, pair)
    assert.equal(startedPair?.phase, 'active')
    assert.equal(startedPair?.phase === 'active' ? startedPair.cause : 'draft', null)
    const pairActive = await readMemberChallenge(db, grace, pair)
    if (!pairActive.ok || pairActive.card.phase !== 'active') throw new Error('active')
    assert.deepEqual(pairActive.card.stakesGo, { kind: 'members' })

    const five = await groupWith(db, people.slice(0, 5), 'Five')
    assert.deepEqual(await saveChallenge(db, ada, five, terms()), { ok: true, name: 'No sweets' })
    await pickRhythms(db, five, people.slice(0, 5))
    assert.deepEqual(await joinGroup(db, people[5] as Account, five), { ok: false, failure: 'group_full' })
    assert.deepEqual(await startChallenge(db, ada, five, noCause), { ok: true, name: 'No sweets' })

    const crowded = await groupWith(db, people.slice(0, 5), 'Crowded')
    assert.deepEqual(await saveChallenge(db, ada, crowded, terms()), { ok: true, name: 'No sweets' })
    await groupRef(db, crowded).update(new FieldPath('members', (people[5] as Account).id), { joinedOn: utcToday(), leftOn: null })
    await pickRhythms(db, crowded, people)
    const crowdedCard = await readMemberChallenge(db, ada, crowded)
    if (!crowdedCard.ok || crowdedCard.card.phase !== 'draft') throw new Error('draft')
    assert.equal(crowdedCard.card.start, 'over_cap')
    assert.deepEqual(crowdedCard.card.checks, [
      { step: 'terms_saved', done: true },
      { step: 'rhythms_picked', done: true },
      { step: 'headcount', done: false },
    ])
    assert.deepEqual(await startChallenge(db, ada, crowded, noCause), { ok: false, failure: 'outside_headcount' })
    assert.equal((await challengeOf(db, crowded))?.phase, 'draft')
  } finally {
    await closeDatabase(db)
  }
})

test('only the creator saves the terms and starts the challenge', async () => {
  const db = openTestDatabase()
  try {
    const people = await Promise.all(['Ada', 'Grace'].map((name) => person(db, name)))
    const [ada, grace] = people as [Account, Account]
    const groupId = await groupWith(db, people)
    assert.deepEqual(await saveChallenge(db, grace, groupId, terms()), { ok: false, failure: 'not_creator' })
    assert.equal(await challengeOf(db, groupId), null)
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true, name: 'No sweets' })
    assert.deepEqual(await saveChallenge(db, grace, groupId, terms({ stake: '50' })), { ok: false, failure: 'not_creator' })
    assert.equal(await stakeOf(db, groupId), 500)
    await pickRhythms(db, groupId, people)
    assert.deepEqual(await startChallenge(db, grace, groupId, noCause), { ok: false, failure: 'not_creator' })
    assert.equal((await challengeOf(db, groupId))?.phase, 'draft')
    assert.deepEqual(await startChallenge(db, ada, groupId, noCause), { ok: true, name: 'No sweets' })
    assert.equal((await challengeOf(db, groupId))?.phase, 'active')
  } finally {
    await closeDatabase(db)
  }
})

test('a challenge that started as a group stays one when everyone else drops out', async () => {
  const db = openTestDatabase()
  try {
    const people = await Promise.all(['Ada', 'Grace', 'Lin'].map((name) => person(db, name)))
    const [ada, grace, lin] = people as [Account, Account, Account]
    const groupId = await groupWith(db, people)
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true, name: 'No sweets' })
    await pickRhythms(db, groupId, people)
    assert.deepEqual(await startChallenge(db, ada, groupId, noCause), { ok: true, name: 'No sweets' })
    await setLeftOn(db, groupId, grace.id, utcToday())
    await setLeftOn(db, groupId, lin.id, utcToday())
    assert.deepEqual(await startChallenge(db, ada, groupId, { cause: 'Food bank' }), { ok: true, name: 'No sweets' })
    const card = await readMemberChallenge(db, ada, groupId)
    if (!card.ok || card.card.phase !== 'active') throw new Error('active')
    assert.deepEqual(card.card.stakesGo, { kind: 'members' })
  } finally {
    await closeDatabase(db)
  }
})

test('the start waits until every active member has a rhythm', async () => {
  const db = openTestDatabase()
  try {
    const people = await Promise.all(['Ada', 'Grace', 'Lin'].map((name) => person(db, name)))
    const [ada, grace, lin] = people as [Account, Account, Account]
    const groupId = await groupWith(db, people)
    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_day' }), { ok: false, failure: 'no_challenge' })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true, name: 'No sweets' })
    const missing = async () => {
      const card = await readMemberChallenge(db, grace, groupId)
      if (!card.ok || card.card.phase !== 'draft') throw new Error('draft')
      return {
        picked: card.card.checks.find((check) => check.step === 'rhythms_picked')?.done,
        who: [...card.card.missingRhythms].sort(),
      }
    }
    assert.deepEqual(await missing(), { picked: false, who: [ada.id, grace.id, lin.id].sort() })

    assert.deepEqual(await saveRhythm(db, ada, groupId, { interval: 'every_day' }), { ok: true, rhythm: 'every_day' })
    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_2_days' }), { ok: true, rhythm: 'every_2_days' })
    assert.deepEqual(await missing(), { picked: false, who: [lin.id] })
    assert.deepEqual(await startChallenge(db, ada, groupId, noCause), { ok: false, failure: 'rhythms_missing' })
    assert.equal((await challengeOf(db, groupId))?.phase, 'draft')

    await setLeftOn(db, groupId, lin.id, utcToday())
    assert.deepEqual(await missing(), { picked: true, who: [] })
  } finally {
    await closeDatabase(db)
  }
})

test('started terms stay put, a rhythm changes until the start, and a late joiner picks one after', async () => {
  const db = openTestDatabase()
  try {
    const people = await Promise.all(['Ada', 'Grace', 'Noor'].map((name) => person(db, name)))
    const [ada, grace, noor] = people as [Account, Account, Account]
    const groupId = await groupWith(db, [ada, grace])
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true, name: 'No sweets' })
    for (const interval of ['weekly', 'alternate_days', '']) {
      assert.deepEqual(await saveRhythm(db, ada, groupId, { interval }), { ok: false, failure: 'bad_interval' })
    }
    assert.deepEqual(await saveRhythm(db, ada, groupId, { interval: 'every_3_days' }), { ok: true, rhythm: 'every_3_days' })
    assert.deepEqual(await saveRhythm(db, ada, groupId, { interval: 'every_day' }), { ok: true, rhythm: 'every_day' })
    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_2_days' }), { ok: true, rhythm: 'every_2_days' })
    assert.deepEqual((await readGroup(db, groupId))?.rhythms[ada.id], { kind: 'every_day' })

    assert.deepEqual(await startChallenge(db, ada, groupId, noCause), { ok: true, name: 'No sweets' })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ name: 'Other' })), { ok: false, failure: 'frozen' })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true, name: 'No sweets' })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ stake: '6' })), { ok: false, failure: 'frozen' })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ endsOn: '2026-12-31' })), { ok: false, failure: 'frozen' })
    const frozen = await challengeOf(db, groupId)
    assert.equal(frozen?.name, 'No sweets')
    assert.equal(frozen?.stakeMinor, 500)
    assert.equal(frozen?.endsOn, '2026-11-30')

    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_2_days' }), { ok: true, rhythm: 'every_2_days' })
    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_day' }), { ok: false, failure: 'frozen' })

    assert.deepEqual(await joinGroup(db, noor, groupId), { ok: true, groupId, name: 'Morning run' })
    assert.deepEqual(await saveRhythm(db, noor, groupId, { interval: 'every_3_days' }), { ok: true, rhythm: 'every_3_days' })
    assert.deepEqual(await saveRhythm(db, noor, groupId, { interval: 'every_day' }), { ok: false, failure: 'frozen' })
    const stored = await readGroup(db, groupId)
    assert.deepEqual(stored?.rhythms, {
      [ada.id]: { kind: 'every_day' },
      [grace.id]: { kind: 'every_2_days' },
      [noor.id]: { kind: 'every_3_days' },
    })
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

test('the group card saves the stake, starts with the people who are active, and then freezes', async () => {
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
    const unpicked = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(unpicked, /Pick your rhythm/)
    assert.match(unpicked, /<li data-done="false">[^]*?Everyone picked a rhythm\. Waiting on Ada\./)
    assert.doesNotMatch(unpicked, /challenge\/start#start/)
    assert.doesNotMatch(unpicked, /anchor_on|Anchor date/)
    assert.deepEqual(
      [...unpicked.matchAll(/<option value="(every_[^"]+)"/g)].map((match) => match[1]),
      ['every_day', 'every_2_days', 'every_3_days'],
    )
    assert.equal((await post(base, `${groupPath}/rhythm`, adaCookie, form({ interval: 'every_day' }))).status, 303)
    const memberHtml = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(memberHtml, /<li data-done="true">[^]*?Everyone picked a rhythm\. <span class="sr-only">Done\.<\/span>/)
    assert.doesNotMatch(memberHtml, /Pick your rhythm/)
    assert.match(memberHtml, /No sweets/)
    assert.match(memberHtml, /Coding/)
    assert.match(memberHtml, /value="5\.00"/)
    assert.match(memberHtml, /value="USD"/)
    assert.match(memberHtml, /value="JPY"/)
    assert.match(memberHtml, /value="KWD"/)
    assert.doesNotMatch(memberHtml, /value="XYZ"/)
    assert.match(memberHtml, /name="stake"/)
    assert.match(memberHtml, /<li data-done="true">[^]*?Save the challenge name, type, stake, and dates\. <span class="sr-only">Done\.<\/span>/)
    assert.match(memberHtml, /<li data-done="true">[^]*?1 to 5 people are active\./)
    assert.match(memberHtml, /Invite friends with the link, or start on your own\./)
    assert.match(memberHtml, /<label for="start-cause">Who your missed days are owed to<\/label>/)
    assert.match(memberHtml, /<input id="start-cause" name="cause"/)
    assert.match(memberHtml, /action="[^"]+\/challenge\/start#start"/)
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

    const noCause = await post(base, `${groupPath}/challenge/start`, adaCookie, form({ cause: ' ' }))
    assert.equal(noCause.status, 400)
    assert.match(await noCause.text(), /<p class="start-error" role="alert">Type who your missed days are owed to\.<\/p>/)
    const longCause = await post(base, `${groupPath}/challenge/start`, adaCookie, form({ cause: 'c'.repeat(41) }))
    assert.equal(longCause.status, 400)
    const longCauseHtml = await longCause.text()
    assert.match(longCauseHtml, /Use 40 characters or fewer\./)
    assert.match(longCauseHtml, new RegExp(`name="cause" value="${'c'.repeat(41)}"`))
    assert.equal((await challengeOf(db, groupId))?.phase, 'draft')

    assert.equal((await post(base, `${groupPath}/join`, graceCookie)).status, 303)
    const graceTerms = await post(base, `${groupPath}/challenge`, graceCookie, challengeForm({ stake: '50' }))
    assert.equal(graceTerms.status, 403)
    assert.match(await graceTerms.text(), /Only the person who made the group can change the terms or start the challenge\./)
    assert.equal((await challengeOf(db, groupId))?.stakeMinor, 5)
    const graceStart = await post(base, `${groupPath}/challenge/start`, graceCookie, '')
    assert.equal(graceStart.status, 403)
    assert.equal((await challengeOf(db, groupId))?.phase, 'draft')
    const graceView = await (await fetch(`${base}${groupPath}`, { headers: { cookie: graceCookie } })).text()
    assert.match(graceView, /5 JPY/)
    assert.match(graceView, /Set by Ada\./)
    assert.doesNotMatch(graceView, /name="stake"/)
    assert.match(graceView, /Pick your rhythm/)
    assert.match(graceView, /Everyone picked a rhythm\. Waiting on Grace\./)
    assert.match(graceView, /Waiting for Ada to start\./)
    assert.doesNotMatch(graceView, /challenge\/start/)
    assert.ok(graceView.indexOf('Pick your rhythm') < graceView.indexOf('Before you start'))
    assert.ok(graceView.indexOf('Before you start') < graceView.indexOf('Waiting for Ada to start.'))
    const waitingOnGrace = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(waitingOnGrace, /Waiting on Grace\./)
    assert.doesNotMatch(waitingOnGrace, /challenge\/start#start/)
    assert.equal((await post(base, `${groupPath}/rhythm`, graceCookie, form({ interval: 'every_2_days' }))).status, 303)
    const gracePicked = await (await fetch(`${base}${groupPath}`, { headers: { cookie: graceCookie } })).text()
    assert.match(gracePicked, /<li data-done="true">[^]*?Everyone picked a rhythm\./)
    assert.match(gracePicked, /Waiting for Ada to start\./)
    assert.doesNotMatch(gracePicked, /challenge\/start/)
    const pairHtml = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(pairHtml, /action="[^"]+\/challenge\/start#start"/)
    assert.doesNotMatch(pairHtml, /name="cause"/)
    assert.doesNotMatch(pairHtml, /start on your own/)
    const staleSolo = await post(base, `${groupPath}/challenge/start`, adaCookie, form({ cause: 'Food bank' }))
    assert.equal(staleSolo.status, 409)
    const staleSoloHtml = await staleSolo.text()
    assert.match(staleSoloHtml, /Someone else joined, so this is a group challenge now and needs no cause\. Press Start again\./)
    assert.doesNotMatch(staleSoloHtml, /name="cause"/)
    assert.equal((await challengeOf(db, groupId))?.phase, 'draft')

    assert.equal((await post(base, `${groupPath}/join`, linCookie)).status, 303)
    const waitingOnLin = await post(base, `${groupPath}/challenge/start`, adaCookie, '')
    assert.equal(waitingOnLin.status, 409)
    const waitingOnLinHtml = await waitingOnLin.text()
    assert.match(waitingOnLinHtml, /Everyone needs to pick a rhythm before the challenge starts\./)
    assert.match(waitingOnLinHtml, /Everyone picked a rhythm\. Waiting on Lin\./)
    assert.equal((await challengeOf(db, groupId))?.phase, 'draft')
    assert.equal((await post(base, `${groupPath}/rhythm`, linCookie, form({ interval: 'every_3_days' }))).status, 303)
    const ready = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(ready, /action="[^"]+\/challenge\/start#start"/)
    const started = await post(base, `${groupPath}/challenge/start`, adaCookie, '')
    assert.equal(started.status, 303)
    const startedAgain = await post(base, `${groupPath}/challenge/start`, adaCookie, '')
    assert.equal(startedAgain.status, 303)
    const activeHtml = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(activeHtml, /5 JPY/)
    assert.doesNotMatch(activeHtml, /name="stake"/)
    assert.doesNotMatch(activeHtml, /challenge\/start/)
    assert.doesNotMatch(activeHtml, /owed to/)
    assert.doesNotMatch(activeHtml, /name="interval"/)
    assert.match(activeHtml, /Kept it/)
    assert.equal(await challengeCount(db), 1)
    assert.equal((await challengeOf(db, groupId))?.phase, 'active')

    const noorCookie = await cookieFor(db, noor)
    assert.equal((await post(base, `${groupPath}/join`, noorCookie)).status, 303)
    const lateHtml = await (await fetch(`${base}${groupPath}`, { headers: { cookie: noorCookie } })).text()
    assert.match(lateHtml, /Pick your rhythm to start logging/)
    assert.match(lateHtml, /name="interval"/)
    assert.doesNotMatch(lateHtml, /name="color"/)
    assert.equal((await post(base, `${groupPath}/rhythm`, noorCookie, form({ interval: 'every_day' }))).status, 303)
    const rhythmHtml = await (await fetch(`${base}${groupPath}`, { headers: { cookie: noorCookie } })).text()
    assert.match(rhythmHtml, /Every day/)
    assert.match(rhythmHtml, /Kept it/)
    assert.doesNotMatch(rhythmHtml, /name="interval"/)
    const changedRhythm = await post(base, `${groupPath}/rhythm`, noorCookie, form({ interval: 'every_2_days' }))
    assert.equal(changedRhythm.status, 409)
    assert.match(await changedRhythm.text(), /This challenge has started, so those fields stay as they are/)
    assert.equal((await readGroup(db, groupId))?.rhythms[noor.id]?.kind, 'every_day')

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

async function storedChallenge(
  db: Database,
  challenge: Record<string, unknown>,
  rhythms: Record<string, unknown> = {},
): Promise<string> {
  const groupId = '00000000-0000-4000-8000-000000000042'
  await groupRef(db, groupId).set({
    name: 'Stored',
    createdBy: 'ada',
    memberIds: ['ada'],
    members: { ada: { joinedOn: '2026-11-01', leftOn: null } },
    challenge,
    rhythms,
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

test('a member on their own starts a solo challenge and the card names the cause', async () => {
  const db = openTestDatabase()
  const ada = await person(db, 'Ada')
  const adaCookie = await cookieFor(db, ada)
  const { server, base } = await listen(db)
  try {
    const groupId = await groupWith(db, [ada], 'Alone')
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true, name: 'No sweets' })
    await pickRhythms(db, groupId, [ada])
    const groupPath = `/groups/${groupId}`
    const started = await post(base, `${groupPath}/challenge/start`, adaCookie, form({ cause: 'Food & Shelter' }))
    assert.equal(started.status, 303)
    assert.equal(started.headers.get('location'), groupPath)
    const stored = await challengeOf(db, groupId)
    assert.equal(stored?.phase === 'active' ? stored.cause : 'draft', 'Food & Shelter')
    const html = await (await fetch(`${base}${groupPath}`, { headers: { cookie: adaCookie } })).text()
    assert.match(html, /<p>Missed days are owed to Food &amp; Shelter\.<\/p>/)
    assert.doesNotMatch(html, /challenge\/start/)
    assert.doesNotMatch(html, /Before you start/)
  } finally {
    await closeServer(server)
    await closeDatabase(db)
  }
})

test('a rhythm stored with an anchor reads as just its kind', async () => {
  const db = openTestDatabase()
  try {
    const rhythms = { ada: { kind: 'every_2_days', anchorOn: '2026-11-02' } }
    const groupId = await storedChallenge(db, { ...storedTerms, phase: 'draft' }, rhythms)
    assert.deepEqual((await readGroup(db, groupId))?.rhythms, { ada: { kind: 'every_2_days' } })
  } finally {
    await closeDatabase(db)
  }
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { upsertAccount } from '../src/accounts.ts'
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
import { openDatabase } from '../src/db.ts'
import { createGroup, joinGroup, parseGroupId, type GroupId } from '../src/groups.ts'
import type { Account } from '../src/identity.ts'
import type { PGlite } from '@electric-sql/pglite'

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

async function person(db: PGlite, name: string): Promise<Account> {
  const saved = await upsertAccount(db, {
    sub: `sub-${name}`,
    email: `${name.replaceAll(' ', '-').toLowerCase()}@example.com`,
    emailVerified: true,
    displayName: name,
    avatarUrl: null,
  })
  if (!saved.ok) throw new Error('account')
  return saved.account
}

async function groupWith(db: PGlite, people: readonly Account[], name = 'Morning run'): Promise<GroupId> {
  const created = await createGroup(db, people[0] as Account, name)
  if (!created.ok) throw new Error(created.failure)
  for (const member of people.slice(1)) {
    const joined = await joinGroup(db, member, created.groupId)
    if (!joined.ok) throw new Error(joined.failure)
  }
  return created.groupId
}

async function stakeOf(db: PGlite, groupId: GroupId): Promise<number> {
  const result = await db.query<{ stake_minor: number | string }>(
    `SELECT stake_minor FROM challenges WHERE group_id = $1`,
    [groupId],
  )
  assert.equal(result.rows.length, 1)
  return Number(result.rows[0]?.stake_minor)
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
  const db = await openDatabase()
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
    const none = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM challenges`)
    assert.equal(Number(none.rows[0]?.n), 0)

    await assert.rejects(
      db.query(
        `INSERT INTO challenges (
           group_id, name, type_kind, custom_label, currency, stake_minor, starts_on, ends_on, phase
         ) VALUES ($1, 'Bounds', 'coding', NULL, 'USD', 0, '2026-11-01', '2026-11-30', 'draft')`,
        [groupId],
      ),
    )
    await assert.rejects(
      db.query(
        `INSERT INTO challenges (
           group_id, name, type_kind, custom_label, currency, stake_minor, starts_on, ends_on, phase
         ) VALUES ($1, 'Bounds', 'coding', NULL, 'USD', 1000000001, '2026-11-01', '2026-11-30', 'draft')`,
        [groupId],
      ),
    )

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
    const codes = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM currency_codes`)
    assert.equal(Number(codes.rows[0]?.n), 165)
    const absent = await db.query(`SELECT code FROM currency_codes WHERE code IN ('XAU', 'XXX', 'BGN', 'ANG')`)
    assert.equal(absent.rows.length, 0)
  } finally {
    await db.close()
  }
})

test('a preset stores a null label and a blank custom label is rejected', async () => {
  const db = await openDatabase()
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
    const none = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM challenges`)
    assert.equal(Number(none.rows[0]?.n), 0)

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ type: 'coding', customLabel: 'Nope' })), { ok: true })
    const preset = await db.query<{ type_kind: string; custom_label: string | null }>(
      `SELECT type_kind, custom_label FROM challenges WHERE group_id = $1`,
      [groupId],
    )
    assert.equal(preset.rows[0]?.type_kind, 'coding')
    assert.equal(preset.rows[0]?.custom_label, null)

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ type: 'custom', customLabel: '  No sugar  ' })), {
      ok: true,
    })
    const custom = await db.query<{ type_kind: string; custom_label: string | null }>(
      `SELECT type_kind, custom_label FROM challenges WHERE group_id = $1`,
      [groupId],
    )
    assert.equal(custom.rows[0]?.type_kind, 'custom')
    assert.equal(custom.rows[0]?.custom_label, 'No sugar')
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ type: 'custom', customLabel: 'No sugar' })), { ok: true })
    const rows = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM challenges`)
    assert.equal(Number(rows.rows[0]?.n), 1)
  } finally {
    await db.close()
  }
})

test('two members cannot start, three can, and a second start leaves one active row', async () => {
  const db = await openDatabase()
  try {
    const people = await Promise.all(['Ada', 'Grace', 'Lin', 'Noor', 'Owen', 'Bea'].map((name) => person(db, name)))
    const ada = people[0] as Account
    const groupId = await groupWith(db, people.slice(0, 2))
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true })
    assert.deepEqual(await startChallenge(db, ada, groupId), { ok: false, failure: 'outside_headcount' })
    const stillDraft = await db.query<{ phase: string }>(`SELECT phase FROM challenges WHERE group_id = $1`, [groupId])
    assert.equal(stillDraft.rows[0]?.phase, 'draft')

    const joined = await joinGroup(db, people[2] as Account, groupId)
    assert.equal(joined.ok, true)
    await db.exec(
      `CREATE OR REPLACE FUNCTION challenge_member_floor() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 4 $$`,
    )
    try {
      assert.deepEqual(await startChallenge(db, ada, groupId), { ok: false, failure: 'outside_headcount' })
      const raised = await readMemberChallenge(db, ada, groupId)
      if (!raised.ok || raised.card.phase !== 'draft') throw new Error('draft')
      assert.equal(raised.card.floor, 4)
      assert.equal(raised.card.cap, 5)
    } finally {
      await db.exec(
        `CREATE OR REPLACE FUNCTION challenge_member_floor() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$`,
      )
    }

    assert.deepEqual(await startChallenge(db, ada, groupId), { ok: true })
    assert.deepEqual(await startChallenge(db, people[1] as Account, groupId), { ok: true })
    await db.query(`UPDATE memberships SET left_on = joined_on WHERE group_id = $1 AND user_id = $2`, [
      groupId,
      people[2]?.id,
    ])
    assert.deepEqual(await startChallenge(db, ada, groupId), { ok: true })
    const active = await db.query<{ phase: string }>(`SELECT phase FROM challenges WHERE group_id = $1`, [groupId])
    assert.equal(active.rows.length, 1)
    assert.equal(active.rows[0]?.phase, 'active')

    const full = await groupWith(db, people.slice(0, 5), 'Full')
    const refused = await joinGroup(db, people[5] as Account, full)
    assert.deepEqual(refused, { ok: false, failure: 'group_full' })
    await assert.rejects(
      db.query(
        `INSERT INTO memberships (group_id, user_id, joined_on) VALUES ($1, $2, (now() AT TIME ZONE 'utc')::date)`,
        [full, people[5]?.id],
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal((error as { code?: string }).code, 'P0001')
        assert.equal(error.message, 'group_full')
        return true
      },
    )
    const early = await groupWith(db, people.slice(0, 2), 'Early')
    await assert.rejects(
      db.query(
        `INSERT INTO challenges (
           group_id, name, type_kind, custom_label, currency, stake_minor, starts_on, ends_on, phase
         ) VALUES ($1, 'Early', 'writing', NULL, 'USD', 100, '2026-11-01', '2026-11-30', 'active')`,
        [early],
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal((error as { code?: string }).code, 'P0001')
        assert.equal(error.message, 'outside_headcount')
        return true
      },
    )
  } finally {
    await db.close()
  }
})

test('started terms and a stored rhythm stay put unless the write is equal', async () => {
  const db = await openDatabase()
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
    const dates = await db.query<{ starts_on: string; ends_on: string; anchor_on: string }>(
      `SELECT to_char(c.starts_on, 'YYYY-MM-DD') AS starts_on,
              to_char(c.ends_on, 'YYYY-MM-DD') AS ends_on,
              to_char(r.anchor_on, 'YYYY-MM-DD') AS anchor_on
       FROM challenges c
       JOIN logging_rhythms r ON r.group_id = c.group_id
       WHERE c.group_id = $1`,
      [groupId],
    )
    assert.equal(dates.rows[0]?.starts_on, '2026-11-03')
    assert.equal(dates.rows[0]?.ends_on, '2026-11-30')
    assert.equal(dates.rows[0]?.anchor_on, '2026-10-01')

    await db.exec(`ALTER TABLE challenges DISABLE TRIGGER USER`)
    await db.query(`UPDATE challenges SET starts_on = '2026-09-01', ends_on = '2026-09-15' WHERE group_id = $1`, [groupId])
    await db.exec(`ALTER TABLE challenges ENABLE TRIGGER USER`)
    assert.deepEqual(await startChallenge(db, ada, groupId), { ok: false, failure: 'rhythm_past_end' })
    const blocked = await db.query<{ phase: string; ends_on: string }>(
      `SELECT phase, to_char(ends_on, 'YYYY-MM-DD') AS ends_on FROM challenges WHERE group_id = $1`,
      [groupId],
    )
    assert.equal(blocked.rows[0]?.phase, 'draft')
    assert.equal(blocked.rows[0]?.ends_on, '2026-09-15')

    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true })
    assert.deepEqual(await startChallenge(db, ada, groupId), { ok: true })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms({ name: 'Other' })), { ok: false, failure: 'frozen' })
    assert.deepEqual(await saveChallenge(db, ada, groupId, terms()), { ok: true })
    const name = await db.query<{ name: string }>(`SELECT name FROM challenges WHERE group_id = $1`, [groupId])
    assert.equal(name.rows[0]?.name, 'No sweets')
    await assert.rejects(db.query(`UPDATE challenges SET name = 'Hacked' WHERE group_id = $1`, [groupId]), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal((error as { code?: string }).code, 'P0001')
      assert.equal(error.message, 'frozen')
      return true
    })
    const equal = await db.query<{ name: string }>(
      `UPDATE challenges SET name = name WHERE group_id = $1 RETURNING name`,
      [groupId],
    )
    assert.equal(equal.rows[0]?.name, 'No sweets')

    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_day', anchorOn: '2026-11-02' }), { ok: true })
    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_day', anchorOn: '2026-11-02' }), { ok: true })
    assert.deepEqual(await saveRhythm(db, grace, groupId, { interval: 'every_3_days', anchorOn: '2026-11-02' }), {
      ok: false,
      failure: 'frozen',
    })
    const graceRhythm = await db.query<{ kind: string }>(
      `SELECT kind FROM logging_rhythms WHERE group_id = $1 AND user_id = $2`,
      [groupId, grace.id],
    )
    assert.equal(graceRhythm.rows[0]?.kind, 'every_day')
    await assert.rejects(
      db.query(`UPDATE logging_rhythms SET kind = 'every_3_days' WHERE group_id = $1 AND user_id = $2`, [groupId, grace.id]),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal((error as { code?: string }).code, 'P0001')
        assert.equal(error.message, 'frozen')
        return true
      },
    )
    const sameRhythm = await db.query<{ kind: string }>(
      `UPDATE logging_rhythms SET kind = kind WHERE group_id = $1 AND user_id = $2 RETURNING kind`,
      [groupId, grace.id],
    )
    assert.equal(sameRhythm.rows[0]?.kind, 'every_day')

    const phase = await db.query<{ phase: string }>(`SELECT phase FROM challenges WHERE group_id = $1`, [groupId])
    assert.equal(phase.rows[0]?.phase, 'active')
  } finally {
    await db.close()
  }
})

test('replaying the challenge schema keeps memberships and corrects currency exponents', async () => {
  const db = await openDatabase()
  try {
    const people = await Promise.all([0, 1, 2, 3, 4].map((n) => person(db, `Person ${n}`)))
    const groupId = await groupWith(db, people)
    assert.deepEqual(await saveChallenge(db, people[0] as Account, groupId, terms()), { ok: true })
    await db.query(`UPDATE currency_codes SET minor_digits = 0 WHERE code = 'USD'`)
    await db.query(`INSERT INTO currency_codes (code, minor_digits) VALUES ('ZZZ', 2)`)
    await db.exec(readFileSync(new URL('../db/003_challenge.sql', import.meta.url), 'utf8'))
    const members = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM memberships WHERE group_id = $1 AND left_on IS NULL`,
      [groupId],
    )
    assert.equal(Number(members.rows[0]?.n), 5)
    const usd = await db.query<{ minor_digits: number }>(`SELECT minor_digits FROM currency_codes WHERE code = 'USD'`)
    assert.equal(Number(usd.rows[0]?.minor_digits), 2)
    const zzz = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM currency_codes WHERE code = 'ZZZ'`)
    assert.equal(Number(zzz.rows[0]?.n), 1)
    const challenge = await db.query<{ name: string }>(`SELECT name FROM challenges WHERE group_id = $1`, [groupId])
    assert.equal(challenge.rows.length, 1)
    assert.equal(challenge.rows[0]?.name, 'No sweets')
    const codes = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM currency_codes`)
    assert.equal(Number(codes.rows[0]?.n), 166)
  } finally {
    await db.close()
  }
})

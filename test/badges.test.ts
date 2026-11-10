import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BADGE_EMOJIS, badgeOf, firstNameOf, initialsOf, parseBadgeEmoji } from '../src/badges.ts'

test('initials take the first letters of the first and last words', () => {
  assert.equal(initialsOf('John Doe'), 'JD')
  assert.equal(initialsOf('ada maria lovelace'), 'AL')
})

test('a single word gives its first two letters', () => {
  assert.equal(initialsOf('Madonna'), 'MA')
  assert.equal(initialsOf('Q'), 'Q')
})

test('extra spaces do not change the initials or the first name', () => {
  assert.equal(initialsOf('  John   Doe  '), 'JD')
  assert.equal(firstNameOf('  John   Doe  '), 'John')
})

test('accented and emoji names keep whole letters', () => {
  assert.equal(initialsOf('élodie Ørsted'), 'ÉØ')
  assert.equal(initialsOf('😀x'), '😀X')
  assert.equal(firstNameOf('Élodie Ørsted'), 'Élodie')
})

test('the first name is the first word', () => {
  assert.equal(firstNameOf('John Doe'), 'John')
  assert.equal(firstNameOf('Ada Maria Lovelace'), 'Ada')
  assert.equal(firstNameOf('Madonna'), 'Madonna')
})

test('only an emoji from the list is a badge, and no badge shows initials', () => {
  assert.equal(parseBadgeEmoji(BADGE_EMOJIS[0]), BADGE_EMOJIS[0])
  assert.equal(parseBadgeEmoji('💰'), null)
  assert.equal(parseBadgeEmoji(7), null)
  assert.equal(parseBadgeEmoji(undefined), null)
  assert.deepEqual(badgeOf({ displayName: 'John Doe', badgeEmoji: null }), { kind: 'initials', initials: 'JD' })
  assert.deepEqual(badgeOf({ displayName: 'John Doe', badgeEmoji: '🦊' }), { kind: 'emoji', emoji: '🦊' })
})

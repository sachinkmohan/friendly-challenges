import type { Database } from './db.ts'

// 💰 and 💸 stay off the list: they draw a member's standing next to the badge.
export const BADGE_EMOJIS = [
  '😀', '😎', '🤓', '🥳', '😺', '🐶', '🦊', '🐼', '🐨', '🐯',
  '🦁', '🐸', '🐵', '🐧', '🦉', '🐢', '🐙', '🦄', '🐝', '🌻',
  '🌵', '🍀', '🍉', '🍕', '🍩', '⚽', '🏀', '🎸', '🚀', '⭐',
] as const

export type BadgeEmoji = (typeof BADGE_EMOJIS)[number]

export type Badge = { readonly kind: 'emoji'; readonly emoji: BadgeEmoji } | { readonly kind: 'initials'; readonly initials: string }

export function parseBadgeEmoji(raw: unknown): BadgeEmoji | null {
  return typeof raw === 'string' && (BADGE_EMOJIS as readonly string[]).includes(raw) ? (raw as BadgeEmoji) : null
}

function wordsOf(displayName: string): readonly string[] {
  return displayName.trim().split(/\s+/).filter((word) => word !== '')
}

function firstLetter(word: string | undefined): string {
  return Array.from(word ?? '')[0] ?? ''
}

export function initialsOf(displayName: string): string {
  const words = wordsOf(displayName)
  const initials =
    words.length === 1 ? Array.from(words[0] ?? '').slice(0, 2).join('') : firstLetter(words[0]) + firstLetter(words.at(-1))
  return initials === '' ? '?' : initials.toUpperCase()
}

export function firstNameOf(displayName: string): string {
  return wordsOf(displayName)[0] ?? ''
}

export function badgeOf(user: { readonly displayName: string; readonly badgeEmoji: BadgeEmoji | null }): Badge {
  if (user.badgeEmoji !== null) return { kind: 'emoji', emoji: user.badgeEmoji }
  return { kind: 'initials', initials: initialsOf(user.displayName) }
}

// Sign-in merges the Google profile into the user doc, so a badge set here survives the next sign-in.
export async function setBadge(db: Database, accountId: string, emoji: BadgeEmoji | null): Promise<void> {
  await db.collection('users').doc(accountId).update({ badgeEmoji: emoji })
}

import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore'
import type { Database } from './db.ts'
import type { GroupId } from './groups.ts'

// Firestore layout.
//   users/{userId}            UserDoc
//   googleSubs/{sub}          { userId }, one per Google `sub`, so a repeat sign-in finds the same user
//   sessions/{sha256(token)}  SessionDoc
//   groups/{groupId}          GroupDoc, the group, its members, the challenge, and every rhythm
//   groups/{groupId}/checkIns/{userId}_{day}  CheckInDoc
//   groups/{groupId}/payments/{paymentId}     PaymentDoc
// Every rule that spans members, the challenge, or rhythms reads and writes the one group document in a transaction.

export type Day = string

export type UserDoc = {
  readonly googleSub: string
  readonly email: string
  readonly displayName: string
  readonly avatarUrl: string | null
}

export type MemberDoc = {
  readonly joinedOn: Day
  readonly leftOn: Day | null
}

export type ChallengeDoc = {
  readonly name: string
  readonly typeKind: string
  readonly customLabel: string | null
  readonly currency: string
  readonly stakeMinor: number
  readonly startsOn: Day
  readonly endsOn: Day
  readonly phase: 'draft' | 'active'
}

export type RhythmDoc = {
  readonly kind: string
  readonly anchorOn: Day
}

export type GroupDoc = {
  readonly name: string
  readonly createdBy: string
  readonly memberIds: readonly string[]
  readonly members: { readonly [userId: string]: MemberDoc }
  readonly challenge: ChallengeDoc | null
  readonly rhythms: { readonly [userId: string]: RhythmDoc }
}

export type CheckInDoc = {
  readonly userId: string
  readonly day: Day
  readonly color: string
}

export type PaymentDoc = {
  readonly payerId: string
  readonly payeeId: string
  readonly amountMinor: number
  readonly currency: string
  readonly paidOn: Day
  readonly paypalRef: string | null
}

export const ACTIVE_MEMBER_CAP = 5
export const CHALLENGE_MEMBER_FLOOR = 3

const DAY = /^\d{4}-\d{2}-\d{2}$/

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(what)
  return value as Record<string, unknown>
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(what)
  return value
}

function day(value: unknown, what: string): Day {
  if (typeof value !== 'string' || !DAY.test(value)) throw new Error(what)
  return value
}

function nullable<T>(value: unknown, read: (value: unknown) => T): T | null {
  return value === null || value === undefined ? null : read(value)
}

function parseMember(raw: unknown): MemberDoc {
  const row = record(raw, 'member')
  return { joinedOn: day(row.joinedOn, 'member joined'), leftOn: nullable(row.leftOn, (v) => day(v, 'member left')) }
}

function parseChallenge(raw: unknown): ChallengeDoc {
  const row = record(raw, 'challenge')
  if (row.phase !== 'draft' && row.phase !== 'active') throw new Error('challenge phase')
  if (typeof row.stakeMinor !== 'number' || !Number.isInteger(row.stakeMinor)) throw new Error('challenge stake')
  return {
    name: text(row.name, 'challenge name'),
    typeKind: text(row.typeKind, 'challenge type'),
    customLabel: nullable(row.customLabel, (v) => text(v, 'challenge label')),
    currency: text(row.currency, 'challenge currency'),
    stakeMinor: row.stakeMinor,
    startsOn: day(row.startsOn, 'challenge start'),
    endsOn: day(row.endsOn, 'challenge end'),
    phase: row.phase,
  }
}

function parseRhythm(raw: unknown): RhythmDoc {
  const row = record(raw, 'rhythm')
  return { kind: text(row.kind, 'rhythm kind'), anchorOn: day(row.anchorOn, 'rhythm anchor') }
}

function parseMap<T>(raw: unknown, read: (value: unknown) => T, what: string): { [key: string]: T } {
  const row = record(raw ?? {}, what)
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, read(value)]))
}

export function parseGroup(raw: unknown): GroupDoc {
  const row = record(raw, 'group')
  if (!Array.isArray(row.memberIds)) throw new Error('group member ids')
  return {
    name: text(row.name, 'group name'),
    createdBy: text(row.createdBy, 'group creator'),
    memberIds: row.memberIds.map((id) => text(id, 'group member id')),
    members: parseMap(row.members, parseMember, 'group members'),
    challenge: nullable(row.challenge, parseChallenge),
    rhythms: parseMap(row.rhythms, parseRhythm, 'group rhythms'),
  }
}

export function parseUser(raw: unknown): UserDoc {
  const row = record(raw, 'user')
  return {
    googleSub: text(row.googleSub, 'user sub'),
    email: text(row.email, 'user email'),
    displayName: text(row.displayName, 'user name'),
    avatarUrl: nullable(row.avatarUrl, (v) => text(v, 'user avatar')),
  }
}

export function parseCheckIn(raw: unknown): CheckInDoc {
  const row = record(raw, 'check-in')
  return { userId: text(row.userId, 'check-in user'), day: day(row.day, 'check-in day'), color: text(row.color, 'check-in color') }
}

export function parsePayment(raw: unknown): PaymentDoc {
  const row = record(raw, 'payment')
  if (typeof row.amountMinor !== 'number' || !Number.isSafeInteger(row.amountMinor)) throw new Error('payment amount')
  return {
    payerId: text(row.payerId, 'payment payer'),
    payeeId: text(row.payeeId, 'payment payee'),
    amountMinor: row.amountMinor,
    currency: text(row.currency, 'payment currency'),
    paidOn: day(row.paidOn, 'payment day'),
    paypalRef: nullable(row.paypalRef, (v) => text(v, 'payment reference')),
  }
}

export function isActive(member: MemberDoc): boolean {
  return member.leftOn === null
}

export function activeMemberIds(group: GroupDoc): string[] {
  return Object.entries(group.members)
    .filter(([, member]) => isActive(member))
    .map(([userId]) => userId)
}

export function groupRef(db: Database, groupId: GroupId | string): DocumentReference {
  return db.collection('groups').doc(groupId)
}

export function userRef(db: Database, userId: string): DocumentReference {
  return db.collection('users').doc(userId)
}

export function checkInRef(db: Database, groupId: GroupId | string, userId: string, on: Day): DocumentReference {
  return groupRef(db, groupId).collection('checkIns').doc(`${userId}_${on}`)
}

function groupFrom(snapshot: DocumentSnapshot): GroupDoc | null {
  return snapshot.exists ? parseGroup(snapshot.data()) : null
}

export async function readGroup(db: Database, groupId: GroupId | string, tx?: Transaction): Promise<GroupDoc | null> {
  const ref = groupRef(db, groupId)
  return groupFrom(tx ? await tx.get(ref) : await ref.get())
}

export async function readUsers(db: Database, userIds: readonly string[]): Promise<Map<string, UserDoc>> {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return new Map()
  const snapshots = await db.getAll(...unique.map((id) => userRef(db, id)))
  const users = new Map<string, UserDoc>()
  for (const snapshot of snapshots) {
    if (snapshot.exists) users.set(snapshot.id, parseUser(snapshot.data()))
  }
  return users
}

export async function readCheckIns(db: Database, groupId: GroupId | string): Promise<CheckInDoc[]> {
  const snapshot = await groupRef(db, groupId).collection('checkIns').get()
  return snapshot.docs.map((doc) => parseCheckIn(doc.data()))
}

export async function readPayments(db: Database, groupId: GroupId | string): Promise<PaymentDoc[]> {
  const snapshot = await groupRef(db, groupId).collection('payments').get()
  return snapshot.docs.map((doc) => parsePayment(doc.data()))
}

export async function countDocs(db: Database, collection: string): Promise<number> {
  const snapshot = await db.collection(collection).count().get()
  return snapshot.data().count
}

export function utcToday(): Day {
  return new Date().toISOString().slice(0, 10)
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

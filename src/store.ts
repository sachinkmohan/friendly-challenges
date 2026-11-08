import { Timestamp, type DocumentReference, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore'
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

type TermsFields = {
  readonly name: string
  readonly typeKind: string
  readonly customLabel: string | null
  readonly currency: string
  readonly stakeMinor: number
  readonly startsOn: Day
  readonly endsOn: Day
}

export type ChallengeDoc =
  | (TermsFields & { readonly phase: 'draft' })
  | (TermsFields & { readonly phase: 'active'; readonly cause: string | null })

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

export type Payee = { readonly kind: 'member'; readonly userId: string } | { readonly kind: 'cause' }

export type PaymentDoc = {
  readonly payerId: string
  readonly payee: Payee
  readonly amountMinor: number
  readonly currency: string
  readonly paidOn: Day
  readonly paypalRef: string | null
  readonly createdAt: Timestamp
}

export type PaymentRow = PaymentDoc & { readonly id: string }

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

function fail(what: string): never {
  throw new Error(what)
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
  const terms: TermsFields = {
    name: text(row.name, 'challenge name'),
    typeKind: text(row.typeKind, 'challenge type'),
    customLabel: nullable(row.customLabel, (v) => text(v, 'challenge label')),
    currency: text(row.currency, 'challenge currency'),
    stakeMinor: row.stakeMinor,
    startsOn: day(row.startsOn, 'challenge start'),
    endsOn: day(row.endsOn, 'challenge end'),
  }
  const cause = nullable(row.cause, (v) => text(v, 'challenge cause'))
  if (row.phase === 'draft') return cause === null ? { ...terms, phase: 'draft' } : fail('challenge cause')
  return { ...terms, phase: 'active', cause }
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

// On disk a null payeeId is the challenge's cause, so payments written before causes read unchanged.
function parsePayee(raw: unknown): Payee {
  if (raw === null) return { kind: 'cause' }
  return { kind: 'member', userId: text(raw, 'payment payee') }
}

export function parsePayment(raw: unknown): PaymentDoc {
  const row = record(raw, 'payment')
  if (typeof row.amountMinor !== 'number' || !Number.isSafeInteger(row.amountMinor)) throw new Error('payment amount')
  return {
    payerId: text(row.payerId, 'payment payer'),
    payee: parsePayee(row.payeeId),
    amountMinor: row.amountMinor,
    currency: text(row.currency, 'payment currency'),
    paidOn: day(row.paidOn, 'payment day'),
    paypalRef: nullable(row.paypalRef, (v) => text(v, 'payment reference')),
    createdAt: row.createdAt instanceof Timestamp ? row.createdAt : fail('payment created'),
  }
}

export function paymentData(payment: PaymentDoc): { readonly [field: string]: unknown } {
  const { payee, ...rest } = payment
  return { ...rest, payeeId: payee.kind === 'member' ? payee.userId : null }
}

export function isActive(member: MemberDoc): boolean {
  return member.leftOn === null
}

// Map keys come from user input on some paths, so only own keys count, never `constructor` and the like.
function own<T>(map: { readonly [key: string]: T }, key: string): T | null {
  return Object.hasOwn(map, key) ? map[key]! : null
}

export function memberOf(group: GroupDoc, userId: string): MemberDoc | null {
  return own(group.members, userId)
}

export function rhythmOf(group: GroupDoc, userId: string): RhythmDoc | null {
  return own(group.rhythms, userId)
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

export function paymentRef(db: Database, groupId: GroupId | string, paymentId: string): DocumentReference {
  return groupRef(db, groupId).collection('payments').doc(paymentId)
}

export async function readPayments(db: Database, groupId: GroupId | string): Promise<PaymentRow[]> {
  const snapshot = await groupRef(db, groupId).collection('payments').get()
  return snapshot.docs.map((doc) => ({ id: doc.id, ...parsePayment(doc.data()) }))
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

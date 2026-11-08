import { ledgerFrom, paymentUserIds, type Ledger } from './balances.ts'
import { challengeHeadlineFrom, memberChallengeFrom, type ChallengeHeadline, type IsoDate, type MemberChallengeCard } from './challenge.ts'
import { checkInsFrom, type CheckIn } from './checkins.ts'
import type { Database } from './db.ts'
import { groupViewFrom, type GroupId, type GroupView } from './groups.ts'
import type { Account } from './identity.ts'
import { claimSession, settleSession } from './sessions.ts'
import { activeMemberIds, readCheckIns, readGroup, readPayments, readUsers, type CheckInDoc, type GroupDoc, type PaymentRow, type UserDoc } from './store.ts'
import { timeStep } from './timing.ts'

/** A GET knows only the session cookie; a POST that failed has already looked up its account. */
export type PageViewer =
  | { readonly kind: 'cookie'; readonly token: string | null }
  | { readonly kind: 'known'; readonly account: Account | null }

export type OutsiderView = Extract<GroupView, { kind: 'preview' | 'full' | 'solo' }> & {
  readonly headline: ChallengeHeadline | null
}

export type MemberView = Extract<GroupView, { kind: 'members' }> & {
  readonly challenge: MemberChallengeCard
  readonly checkIns: readonly CheckIn[]
  readonly ledger: Ledger | null
}

/** Every section of one group page, built from one read of the group document. */
export type GroupPage =
  | { readonly kind: 'missing'; readonly account: Account | null }
  | { readonly kind: 'outsider'; readonly account: Account | null; readonly view: OutsiderView }
  | { readonly kind: 'member'; readonly account: Account; readonly view: MemberView }

type Activity =
  | { readonly read: false }
  | { readonly read: true; readonly checkIns: readonly CheckInDoc[]; readonly payments: readonly PaymentRow[] }

type GroupData = {
  readonly groupId: GroupId
  readonly group: GroupDoc
  readonly users: ReadonlyMap<string, UserDoc>
  readonly card: MemberChallengeCard | null
  readonly activity: Activity
}

// Every read waits only on the round before it: the session and the group first, then everything the group names.
// A new section adds its read to the second Promise.all, never an await of its own.
export async function loadGroupPage(db: Database, who: PageViewer, groupId: GroupId, today: IsoDate): Promise<GroupPage> {
  const [claim, group] = await Promise.all([
    who.kind === 'cookie' ? timeStep('session', () => claimSession(db, who.token)) : null,
    timeStep('page.group', () => readGroup(db, groupId)),
  ])
  const viewerId = who.kind === 'known' ? (who.account?.id ?? null) : (claim?.userId ?? null)
  const member = group !== null && viewerId !== null && activeMemberIds(group).includes(viewerId)
  const card = member ? memberChallengeFrom(group) : null
  const active = card?.phase === 'active'
  // Every user a member page names is a key of group.members: check-ins and payments are refused from anyone else.
  const asked = [...(claim ? [claim.userId] : []), ...(member ? Object.keys(group.members) : [])]
  const [users, checkIns, payments] = await timeStep('page.reads', () =>
    Promise.all([
      readUsers(db, asked),
      active ? readCheckIns(db, groupId) : null,
      active ? readPayments(db, groupId) : null,
    ]),
  )
  const activity: Activity = checkIns && payments ? { read: true, checkIns, payments } : { read: false }
  const known = new Set(asked)
  const strays = activity.read
    ? [...activity.checkIns.map((row) => row.userId), ...paymentUserIds(activity.payments)].filter((id) => !known.has(id))
    : []
  const [account, strayUsers] = await Promise.all([
    who.kind === 'known' ? who.account : claim ? settleSession(db, claim, users) : null,
    readUsers(db, strays),
  ])
  if (!group) return { kind: 'missing', account }
  const allUsers = strayUsers.size === 0 ? users : new Map([...users, ...strayUsers])
  return pageFrom({ groupId, group, users: allUsers, card, activity }, account, today)
}

function pageFrom(data: GroupData, account: Account | null, today: IsoDate): Exclude<GroupPage, { kind: 'missing' }> {
  const view = groupViewFrom(data.groupId, data.group, account?.id ?? null, data.users)
  if (view.kind !== 'members') return { kind: 'outsider', account, view: { ...view, headline: challengeHeadlineFrom(data.group) } }
  if (!account || !data.card) throw new Error('member page')
  const checkIns = data.activity.read ? checkInsFrom(data.activity.checkIns, data.users) : []
  const ledger = data.activity.read ? ledgerFrom(data.group, data.activity, data.users, today) : null
  return { kind: 'member', account, view: { ...view, challenge: data.card, checkIns, ledger } }
}

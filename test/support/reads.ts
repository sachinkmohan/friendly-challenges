import { ledgerFrom, paymentUserIds, type Ledger } from '../../src/balances.ts'
import { challengeHeadlineFrom, memberChallengeFrom, type ChallengeHeadline, type IsoDate, type MemberChallengeCard } from '../../src/challenge.ts'
import { checkInsFrom, type CheckIn } from '../../src/checkins.ts'
import type { Database } from '../../src/db.ts'
import { groupViewFrom, type GroupId, type GroupView } from '../../src/groups.ts'
import type { Account } from '../../src/identity.ts'
import { activeMemberIds, readCheckIns, readGroup, readPayments, readUsers, type UserDoc } from '../../src/store.ts'

export type ReadChallengeResult =
  | { readonly ok: false; readonly failure: 'group_missing' | 'not_member' }
  | { readonly ok: true; readonly card: MemberChallengeCard }

export async function viewGroup(db: Database, account: Account | null, groupId: GroupId): Promise<GroupView> {
  const group = await readGroup(db, groupId)
  if (!group) return { kind: 'missing' }
  const active = activeMemberIds(group)
  const users = account && active.includes(account.id) ? await readUsers(db, active) : new Map<string, UserDoc>()
  return groupViewFrom(groupId, group, account?.id ?? null, users)
}

export async function readChallengeHeadline(db: Database, groupId: GroupId): Promise<ChallengeHeadline | null> {
  const group = await readGroup(db, groupId)
  return group ? challengeHeadlineFrom(group) : null
}

export async function readMemberChallenge(db: Database, account: Account, groupId: GroupId): Promise<ReadChallengeResult> {
  const group = await readGroup(db, groupId)
  if (!group) return { ok: false, failure: 'group_missing' }
  if (!activeMemberIds(group).includes(account.id)) return { ok: false, failure: 'not_member' }
  return { ok: true, card: memberChallengeFrom(group) }
}

export async function listCheckIns(db: Database, groupId: GroupId): Promise<readonly CheckIn[]> {
  const checkIns = await readCheckIns(db, groupId)
  return checkInsFrom(checkIns, await readUsers(db, checkIns.map((item) => item.userId)))
}

export async function readLedger(db: Database, groupId: GroupId, today: IsoDate): Promise<Ledger | null> {
  const group = await readGroup(db, groupId)
  if (!group) return null
  const [checkIns, payments] = await Promise.all([readCheckIns(db, groupId), readPayments(db, groupId)])
  const users = await readUsers(db, [...Object.keys(group.members), ...paymentUserIds(payments)])
  return ledgerFrom(group, { checkIns, payments }, users, today)
}

export type SetupStepRead = { readonly done: boolean; readonly open: boolean; readonly note: string; readonly html: string }

/** One row of the checklist a challenge shows before it starts, or null when the page has no such row. */
export function setupStep(html: string, id: 'terms' | 'rhythm' | 'invite' | 'everyone'): SetupStepRead | null {
  const from = html.indexOf(`<details class="fold step" id="step-${id}"`)
  if (from < 0) return null
  const ends = [html.indexOf('<details class="fold', from + 1), html.indexOf('<div id="start">', from)].filter((at) => at > 0)
  const row = html.slice(from, Math.min(...ends))
  const head = row.slice(0, row.indexOf('>') + 1)
  return {
    done: head.includes('data-done="true"'),
    open: head.endsWith(' open>'),
    note: /<span class="fold-note">([^<]*)<\/span>/.exec(row)?.[1] ?? '',
    html: row,
  }
}

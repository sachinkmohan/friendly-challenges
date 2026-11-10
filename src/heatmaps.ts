import { badgeOf, firstNameOf } from './badges.ts'
import { calendarDebts, membersFrom, settle, standingsFrom } from './balances.ts'
import { buildCalendar, weeksOf, type CalendarMember, type GroupCalendar, type Heatmap, type RowMember } from './calendar.ts'
import { spanFrom, stakesGoFrom, windowFrom, type IsoDate } from './challenge.ts'
import type { Database } from './db.ts'
import { parseGroupId } from './groups.ts'
import type { Account } from './identity.ts'
import { compare, labelOf, memberOf, parseGroup, readCheckIns, readUsers, type ChallengeDoc, type UserDoc } from './store.ts'

// Standing counts every membership, so a member who left still moves the others, but only active members get a badge.
function rowMembers(
  challenge: ChallengeDoc,
  calendar: GroupCalendar,
  members: readonly CalendarMember[],
  users: ReadonlyMap<string, UserDoc>,
  viewerId: string,
  started: boolean,
): readonly RowMember[] | null {
  if (stakesGoFrom(challenge).kind === 'cause') return null
  const people = members.map((member) => ({ userId: member.userId, displayName: member.displayName }))
  const nets = settle(people, calendarDebts(calendar, challenge.stakeMinor, members), []).nets
  const netOf = new Map(nets.map((line) => [line.userId, line.netMinor]))
  const standings = standingsFrom(nets)
  return members
    .filter((member) => member.span.leftOn === null)
    .sort((a, b) => (netOf.get(b.userId) ?? 0) - (netOf.get(a.userId) ?? 0))
    .map((member): RowMember => {
      const user = users.get(member.userId)
      if (!user) throw new Error('row member')
      return {
        userId: member.userId,
        firstName: firstNameOf(user.displayName),
        badge: badgeOf(user),
        isViewer: member.userId === viewerId,
        standing: started ? (standings.get(member.userId) ?? { kind: 'even' }) : null,
      }
    })
}

export async function listHeatmaps(db: Database, account: Account, today: IsoDate): Promise<readonly Heatmap[]> {
  const snapshot = await db.collection('groups').where('memberIds', 'array-contains', account.id).get()
  const heatmaps = await Promise.all(
    snapshot.docs.map(async (doc): Promise<Heatmap | null> => {
      const group = parseGroup(doc.data())
      const span = spanFrom(memberOf(group, account.id))
      const window = windowFrom(group.challenge)
      if (!span || span.leftOn !== null || window?.phase !== 'active' || !group.challenge) return null
      const groupId = parseGroupId(doc.id)
      if (!groupId) throw new Error('heatmap group')
      const [checkIns, users] = await Promise.all([readCheckIns(db, groupId), readUsers(db, Object.keys(group.members))])
      const members = membersFrom(group, checkIns, users)
      const calendar = buildCalendar({ window, today }, members)
      const mine = calendar.rows.find((row) => row.userId === account.id)
      return {
        groupId,
        name: labelOf(group),
        startsOn: window.startsOn,
        weeks: weeksOf(mine?.days ?? []),
        members: rowMembers(group.challenge, calendar, members, users, account.id, today >= window.startsOn),
      }
    }),
  )
  return heatmaps
    .filter((heatmap) => heatmap !== null)
    .sort((a, b) => compare(a.name, b.name) || compare(a.groupId, b.groupId))
}

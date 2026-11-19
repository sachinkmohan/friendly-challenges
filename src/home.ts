import { badgeOf, firstNameOf } from './badges.ts'
import { calendarDebts, membersFrom, settle, standingsFrom } from './balances.ts'
import {
  aroundToday,
  buildCalendar,
  weeksOf,
  type CalendarMember,
  type DayLine,
  type GroupCalendar,
  type HeatmapWeek,
  type RowMember,
} from './calendar.ts'
import { stakesGoFrom, windowFrom, type IsoDate } from './challenge.ts'
import type { Database } from './db.ts'
import { parseGroupId, type GroupId } from './groups.ts'
import type { Account } from './identity.ts'
import { activeMemberIds, compare, labelOf, parseGroup, readCheckIns, readUsers, type ChallengeDoc, type UserDoc } from './store.ts'

// members is null for a solo challenge, whose stakes go to a cause.
export type HomeChallenge =
  | { readonly phase: 'draft' }
  | {
      readonly phase: 'active'
      readonly startsOn: IsoDate
      readonly weeks: readonly HeatmapWeek[]
      readonly members: readonly RowMember[] | null
      readonly today: IsoDate
      readonly days: readonly DayLine[]
    }

export type HomeCard = { readonly groupId: GroupId; readonly name: string; readonly challenge: HomeChallenge }

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

export async function listHomeCards(db: Database, account: Account, today: IsoDate): Promise<readonly HomeCard[]> {
  const snapshot = await db.collection('groups').where('memberIds', 'array-contains', account.id).get()
  const cards = await Promise.all(
    snapshot.docs.map(async (doc): Promise<HomeCard | null> => {
      const group = parseGroup(doc.data())
      if (!activeMemberIds(group).includes(account.id)) return null
      const groupId = parseGroupId(doc.id)
      if (!groupId) throw new Error('home group')
      const name = labelOf(group)
      const window = windowFrom(group.challenge)
      if (window?.phase !== 'active' || !group.challenge) {
        return { groupId, name, challenge: { phase: 'draft' } }
      }
      const [checkIns, users] = await Promise.all([readCheckIns(db, groupId), readUsers(db, Object.keys(group.members))])
      const members = membersFrom(group, checkIns, users)
      const calendar = buildCalendar({ window, today }, members)
      const mine = calendar.rows.find((row) => row.userId === account.id)
      const viewer = members.find((member) => member.userId === account.id)
      return {
        groupId,
        name,
        challenge: {
          phase: 'active',
          startsOn: window.startsOn,
          weeks: weeksOf(mine?.days ?? []),
          members: rowMembers(group.challenge, calendar, members, users, account.id, today >= window.startsOn),
          today,
          days: viewer ? aroundToday(window, viewer, today) : [],
        },
      }
    }),
  )
  return cards.filter((card) => card !== null).sort((a, b) => compare(a.name, b.name) || compare(a.groupId, b.groupId))
}

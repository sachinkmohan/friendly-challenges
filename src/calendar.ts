import type { PGlite } from '@electric-sql/pglite'
import {
  isRhythmKind,
  memberIsDue,
  parseIsoDate,
  type ChallengeWindow,
  type IsoDate,
  type MembershipSpan,
  type Rhythm,
  type RhythmLine,
} from './challenge.ts'
import { isColor, type CheckIn, type CheckInColor } from './checkins.ts'
import { parseGroupId, type GroupId, type MemberLine } from './groups.ts'
import type { Account } from './identity.ts'

export const DAY_MARK_LABELS = {
  green: 'Kept it',
  red: 'Missed it',
  empty: 'Not logged yet',
  blank: 'Not a logging day',
} as const

export type DayMark = keyof typeof DAY_MARK_LABELS

export type MarkedDay = { readonly day: IsoDate; readonly mark: DayMark }

export type CalendarRow = {
  readonly userId: string
  readonly displayName: string
  readonly days: readonly MarkedDay[]
}

export type GroupCalendar = {
  readonly startsOn: IsoDate
  readonly days: readonly IsoDate[]
  readonly rows: readonly CalendarRow[]
}

export type HeatmapWeek = readonly (MarkedDay | null)[]

export type Heatmap = {
  readonly groupId: GroupId
  readonly name: string
  readonly startsOn: IsoDate
  readonly weeks: readonly HeatmapWeek[]
}

export type CalendarSpan = {
  readonly window: ChallengeWindow
  readonly today: IsoDate
}

export type CalendarMember = {
  readonly userId: string
  readonly displayName: string
  readonly span: MembershipSpan
  readonly rhythm: Rhythm | null
  readonly colors: ReadonlyMap<IsoDate, CheckInColor>
}

const MS_PER_DAY = 86_400_000

function utcDate(day: IsoDate): Date {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const date = Number(day.slice(8, 10))
  const utc = new Date(Date.UTC(year, month - 1, date))
  utc.setUTCFullYear(year, month - 1, date)
  return utc
}

function isoFrom(utc: Date): IsoDate {
  const year = String(utc.getUTCFullYear()).padStart(4, '0')
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0')
  const date = String(utc.getUTCDate()).padStart(2, '0')
  const parsed = parseIsoDate(`${year}-${month}-${date}`)
  if (!parsed) throw new Error('date')
  return parsed
}

function addDays(day: IsoDate, count: number): IsoDate {
  return isoFrom(new Date(utcDate(day).getTime() + count * MS_PER_DAY))
}

export function utcToday(now: Date = new Date()): IsoDate {
  return isoFrom(now)
}

function calendarDays({ window, today }: CalendarSpan): readonly IsoDate[] {
  const last = today < window.endsOn ? today : window.endsOn
  const days: IsoDate[] = []
  for (let day = window.startsOn; day <= last; day = addDays(day, 1)) days.push(day)
  return days
}

function markDay({ due, color, day, today }: {
  readonly due: boolean
  readonly color: CheckInColor | undefined
  readonly day: IsoDate
  readonly today: IsoDate
}): DayMark {
  if (!due) return 'blank'
  if (color) return color
  return day < today ? 'red' : 'empty'
}

function markMember(span: CalendarSpan, days: readonly IsoDate[], member: CalendarMember): CalendarRow {
  return {
    userId: member.userId,
    displayName: member.displayName,
    days: days.map((day) => ({
      day,
      mark: markDay({
        due: memberIsDue(span.window, member.span, member.rhythm, day),
        color: member.colors.get(day),
        day,
        today: span.today,
      }),
    })),
  }
}

export function buildCalendar(span: CalendarSpan, members: readonly CalendarMember[]): GroupCalendar {
  const days = calendarDays(span)
  return { startsOn: span.window.startsOn, days, rows: members.map((member) => markMember(span, days, member)) }
}

export function weeksOf(days: readonly MarkedDay[]): readonly HeatmapWeek[] {
  const first = days[0]
  if (!first) return []
  const weeks: (MarkedDay | null)[][] = []
  let week: (MarkedDay | null)[] = Array.from({ length: utcDate(first.day).getUTCDay() }, () => null)
  for (const day of days) {
    week.push(day)
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length > 0) weeks.push([...week, ...Array.from({ length: 7 - week.length }, () => null)])
  return weeks
}

function colorsByDay(checkIns: readonly CheckIn[], userId: string): ReadonlyMap<IsoDate, CheckInColor> {
  return new Map(checkIns.filter((item) => item.userId === userId).map((item) => [item.day, item.color]))
}

export function groupCalendar(input: {
  readonly window: ChallengeWindow
  readonly today: IsoDate
  readonly members: readonly MemberLine[]
  readonly rhythms: readonly RhythmLine[]
  readonly checkIns: readonly CheckIn[]
}): GroupCalendar {
  const members = input.members.map((member): CalendarMember => {
    const joinedOn = parseIsoDate(member.joinedOn)
    if (!joinedOn) throw new Error('member date')
    const line = input.rhythms.find((item) => item.userId === member.userId)
    return {
      userId: member.userId,
      displayName: member.displayName,
      span: { joinedOn, leftOn: null },
      rhythm: line ? { kind: line.kind, anchorOn: line.anchorOn } : null,
      colors: colorsByDay(input.checkIns, member.userId),
    }
  })
  return buildCalendar({ window: input.window, today: input.today }, members)
}

type HeatmapRow = {
  group_id: string
  name: string
  starts_on: string
  ends_on: string
  joined_on: string
  kind: string | null
  anchor_on: string | null
}

function dateFrom(value: unknown): IsoDate {
  const parsed = typeof value === 'string' ? parseIsoDate(value) : null
  if (!parsed) throw new Error('date')
  return parsed
}

export async function listHeatmaps(db: PGlite, account: Account, today: IsoDate): Promise<readonly Heatmap[]> {
  const groups = await db.query<HeatmapRow>(
    `SELECT g.id::text AS group_id,
            g.name,
            to_char(c.starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(c.ends_on, 'YYYY-MM-DD') AS ends_on,
            to_char(m.joined_on, 'YYYY-MM-DD') AS joined_on,
            r.kind,
            to_char(r.anchor_on, 'YYYY-MM-DD') AS anchor_on
     FROM memberships m
     JOIN groups g ON g.id = m.group_id
     JOIN challenges c ON c.group_id = m.group_id AND c.phase = 'active'
     LEFT JOIN logging_rhythms r ON r.group_id = m.group_id AND r.user_id = m.user_id
     WHERE m.user_id = $1::uuid AND m.left_on IS NULL
     ORDER BY g.name, g.id`,
    [account.id],
  )
  const checkIns = await db.query<{ group_id: string; day: string; color: string }>(
    `SELECT k.group_id::text AS group_id, to_char(k.day, 'YYYY-MM-DD') AS day, k.color
     FROM check_ins k
     JOIN memberships m ON m.group_id = k.group_id AND m.user_id = k.user_id AND m.left_on IS NULL
     WHERE k.user_id = $1::uuid`,
    [account.id],
  )
  return groups.rows.map((row) => {
    const groupId = parseGroupId(row.group_id)
    if (!groupId || typeof row.name !== 'string') throw new Error('heatmap group')
    if (row.kind !== null && !isRhythmKind(row.kind)) throw new Error('rhythm')
    const rhythm: Rhythm | null = row.kind === null ? null : { kind: row.kind, anchorOn: dateFrom(row.anchor_on) }
    const colors = new Map<IsoDate, CheckInColor>()
    for (const item of checkIns.rows) {
      if (item.group_id !== row.group_id) continue
      if (!isColor(item.color)) throw new Error('check-in color')
      colors.set(dateFrom(item.day), item.color)
    }
    const window: ChallengeWindow = { phase: 'active', startsOn: dateFrom(row.starts_on), endsOn: dateFrom(row.ends_on) }
    const calendar = buildCalendar({ window, today }, [
      {
        userId: account.id,
        displayName: account.displayName,
        span: { joinedOn: dateFrom(row.joined_on), leftOn: null },
        rhythm,
        colors,
      },
    ])
    return { groupId, name: row.name, startsOn: window.startsOn, weeks: weeksOf(calendar.rows[0]?.days ?? []) }
  })
}

import type { Badge } from './badges.ts'
import type { Standing } from './balances.ts'
import {
  memberIsDue,
  parseIsoDate,
  type ChallengeWindow,
  type IsoDate,
  type MembershipSpan,
  type Rhythm,
} from './challenge.ts'
import type { CheckInColor } from './checkins.ts'
import type { GroupId } from './groups.ts'

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

// standing is null until the challenge's first day.
export type RowMember = {
  readonly userId: string
  readonly firstName: string
  readonly badge: Badge
  readonly isViewer: boolean
  readonly standing: Standing | null
}

// members is null for a solo challenge, whose stakes go to a cause.
export type Heatmap = {
  readonly groupId: GroupId
  readonly name: string
  readonly startsOn: IsoDate
  readonly weeks: readonly HeatmapWeek[]
  readonly members: readonly RowMember[] | null
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

import { formatMinor, RHYTHM_LABELS, type CurrencyCode, type IsoDate, type RhythmKind } from './challenge.ts'
import type { CheckInColor } from './checkins.ts'
import { clearCookie, readCookie, writeCookie } from './cookies.ts'

const TOAST_COOKIE = 'toast'
const TOAST_MAX_AGE = 60
const TOAST_TEXT_MAX = 200

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export type Toast =
  | { readonly kind: 'logged'; readonly day: IsoDate; readonly color: CheckInColor }
  | { readonly kind: 'changed'; readonly day: IsoDate; readonly from: CheckInColor; readonly to: CheckInColor }
  | {
      readonly kind: 'paid'
      readonly amountMinor: number
      readonly minorDigits: number
      readonly currency: CurrencyCode
      readonly payee: string
    }
  | { readonly kind: 'created'; readonly group: string }
  | { readonly kind: 'joined'; readonly group: string }
  | { readonly kind: 'terms_saved'; readonly challenge: string }
  | { readonly kind: 'rhythm_saved'; readonly rhythm: RhythmKind }
  | { readonly kind: 'started'; readonly challenge: string }
  | { readonly kind: 'left'; readonly group: string; readonly lastDay: IsoDate }
  | { readonly kind: 'dropped'; readonly member: string; readonly lastDay: IsoDate }
  | { readonly kind: 'deleted'; readonly group: string }

export type ToastReceipt = {
  readonly text: string | null
  readonly cookies: readonly string[]
}

function shortDate(day: IsoDate): string {
  const date = new Date(`${day}T00:00:00Z`)
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

function rhythmPhrase(rhythm: RhythmKind): string {
  const label = RHYTHM_LABELS[rhythm]
  return label.charAt(0).toLowerCase() + label.slice(1)
}

export function checkInToast(day: IsoDate, color: CheckInColor, previous: CheckInColor | null): Toast {
  if (previous === null || previous === color) return { kind: 'logged', day, color }
  return { kind: 'changed', day, from: previous, to: color }
}

export function toastText(toast: Toast): string {
  switch (toast.kind) {
    case 'logged':
      return `Logged ${shortDate(toast.day)} as ${toast.color}.`
    case 'changed':
      return `Changed ${shortDate(toast.day)} from ${toast.from} to ${toast.to}.`
    case 'paid':
      return `Recorded ${formatMinor(toast.amountMinor, toast.minorDigits)} ${toast.currency} paid to ${toast.payee}.`
    case 'created':
      return `Created ${toast.group}.`
    case 'joined':
      return `Joined ${toast.group}.`
    case 'terms_saved':
      return `Saved the terms for ${toast.challenge}.`
    case 'rhythm_saved':
      return `You now log ${rhythmPhrase(toast.rhythm)}.`
    case 'started':
      return `Started ${toast.challenge}.`
    case 'left':
      return `You left ${toast.group}. Your last day is ${shortDate(toast.lastDay)}.`
    case 'dropped':
      return `Recorded ${toast.member}'s last day as ${shortDate(toast.lastDay)}.`
    case 'deleted':
      return `Deleted ${toast.group}.`
  }
}

export function toastCookie(toast: Toast): string {
  return writeCookie(TOAST_COOKIE, toastText(toast), TOAST_MAX_AGE)
}

export function takeToast(cookieHeader: string | undefined): ToastReceipt {
  const text = readCookie(cookieHeader, TOAST_COOKIE)
  if (text === null) return { text: null, cookies: [] }
  const shown = text !== '' && text.length <= TOAST_TEXT_MAX ? text : null
  return { text: shown, cookies: [clearCookie(TOAST_COOKIE)] }
}

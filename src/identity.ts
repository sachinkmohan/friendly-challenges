import type { Browser } from './browser.ts'

export type GoogleIdentity = {
  sub: string
  email: string
  emailVerified: boolean
  displayName: string
  avatarUrl: string | null
}

export type Account = {
  id: string
  googleSub: string
  email: string
  displayName: string
  avatarUrl: string | null
}

export type FirebaseWebConfig = {
  apiKey: string
  authDomain: string
  projectId: string
}

export type Viewer =
  | { state: 'signed_out'; firebase: FirebaseWebConfig | null; origin: string; browser: Browser }
  | { state: 'signed_in'; account: Account }

export type IdToken = {
  email?: string
  email_verified?: boolean
  name?: unknown
  picture?: string
  firebase: { sign_in_provider: string; identities: Record<string, unknown> }
}

export function googleIdentity(token: IdToken): GoogleIdentity | null {
  if (token.firebase.sign_in_provider !== 'google.com') return null
  const subs = token.firebase.identities['google.com']
  const sub = Array.isArray(subs) ? subs[0] : undefined
  if (typeof sub !== 'string' || sub === '') return null
  const email = token.email ?? ''
  const displayName =
    typeof token.name === 'string' && token.name.trim() !== '' ? token.name : email.slice(0, email.indexOf('@'))
  return {
    sub,
    email,
    emailVerified: token.email_verified === true,
    displayName,
    avatarUrl: typeof token.picture === 'string' ? token.picture : null,
  }
}

export type AuthFailure = 'cross_origin' | 'bad_token' | 'not_google' | 'unverified_email'

export const authFailureCopy: Record<AuthFailure, string> = {
  cross_origin: 'This sign-in came from another site.',
  bad_token: 'The sign-in was not valid or has expired. Try again.',
  not_google: 'Sign in with a Google account.',
  unverified_email: 'Google did not confirm the email on this account.',
}

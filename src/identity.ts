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

export type Viewer =
  | { state: 'signed_out' }
  | { state: 'signed_in'; account: Account }

export type AuthFailure =
  | 'missing_client'
  | 'denied'
  | 'bad_state'
  | 'google_rejected'
  | 'unverified_email'

export const authFailureCopy: Record<AuthFailure, string> = {
  missing_client:
    'Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
  denied: 'Google did not grant access.',
  bad_state: 'This sign-in attempt did not match the one this browser started. Try again.',
  google_rejected: 'Google did not accept the sign-in code.',
  unverified_email: 'Google did not confirm the email on this account.',
}

# 0002: We will sign in with Google

- **Status:** accepted
- **Date:** 2026-11-06

## Context

New threads keep asking how a person becomes a member. The product asked for Google login and one user row per Google ID. The app records who owes whom and does not send PayPal transfers. Sign-in is in [the open pull request](https://github.com/sachinkmohan/friendly-challenges/pull/1).

## Decision

We will sign in with Google and no other method. The account key is the Google `sub` claim. The row also stores the email, the display name, and the avatar URL. The same `sub` updates that row. A session cookie is separate from the account. Sign-out deletes the session and leaves the account. An email Google has not confirmed is rejected. Revisit if a member must join without a Google account.

## Consequences

Next agent proposes the Google callback and the `sub` key, not a password table. Email can change and the person still matches on `sub`. The app needs a Google OAuth client and a registered redirect URI. PayPal stays outside the app. Revisit if sign-in must work for someone without Google.

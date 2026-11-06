# Sign in with Google

A member is a person who joins a group. Google sign-in is the only way to open an account. The account key is the Google `sub` claim, and the row also stores the email, the display name, and the avatar URL. The same `sub` updates that row. A session cookie is separate from the account. Sign-out deletes the session and leaves the account. An email Google has not confirmed is rejected.

## Status

Accepted

## Consequences

The app needs a Google OAuth client and a registered redirect URI. Email can change, and the person still matches on `sub`. PayPal transfers stay outside the app.

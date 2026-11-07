# 0006: We will sign in through Firebase Authentication

- **Status:** accepted
- **Date:** 2026-11-07

## Context

[0002](0002-sign-in-with-google.md) chose Google sign-in through the app's own OAuth client. That client needs a redirect URI registered for every host, and the product found that setup painful. The data already lives in Firebase ([0005](0005-use-firestore.md)). Firebase Authentication can run the Google flow with no client of our own.

## Decision

We will sign in through Firebase Authentication, with Google as the only provider. The browser opens the Google popup with the Firebase JS SDK and posts the Firebase ID token to `POST /auth/firebase`. The server checks the token with `firebase-admin` on the app that holds the database. It accepts only `google.com` as the sign-in provider and a confirmed email. The account key is still the Google `sub`, read from the token's Google identity, so existing accounts keep matching. The server then sets its own session cookie. The Firebase client signs out right away. A post whose `Origin` is another site is refused. Revisit if sign-in must work without JavaScript.

## Consequences

Next agent proposes the Firebase popup and `/auth/firebase`, not an OAuth callback. There is no OAuth client and no redirect URI. Each host's domain goes in **Authentication > Settings > Authorized domains**. The server needs `FIREBASE_API_KEY` and `FIREBASE_AUTH_DOMAIN` to draw the button. Sign-in needs JavaScript and a popup. Tests swap the token verifier for a fake. `npm run check:auth` runs the real verifier against the Auth emulator. Revisit if sign-in must work without JavaScript or without Google.

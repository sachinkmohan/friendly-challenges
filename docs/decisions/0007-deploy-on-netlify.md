# 0007: We will deploy on Netlify as one function

- **Status:** accepted
- **Date:** 2026-11-07

## Context

The app is one Node HTTP server that renders every page. After the move to Firestore ([0005](0005-use-firestore.md)), the product chose Netlify as the host. We then sketched Firebase Hosting with Cloud Functions, because the product had shipped apps there before. That sketch was dropped. Firebase Hosting forwards only a cookie named `__session` to a function, and this app sets more than one cookie. Cloud Functions also reads the request body before the app sees it, and it needs the paid Blaze plan. The product chose to stay on Netlify, and no Firebase Hosting code was kept.

The first Netlify deploys failed twice. The build failed with `5 NOT_FOUND` because the Firebase project had no `(default)` Firestore database yet. Then every page crashed after the switch to Firebase Authentication ([0006](0006-sign-in-through-firebase-authentication.md)). `firebase-admin/auth` loads `jwks-rsa` 4, which loads the ESM-only `jose` 6 with `require()`. Netlify's function runtime runs a Node.js too old for that. `NODE_VERSION` in `netlify.toml` changes only the build, and setting `AWS_LAMBDA_JS_RUNTIME=nodejs22.x` did not fix it.

## Decision

We will deploy on Netlify. `netlify.toml` sends every path to the function in `netlify/functions/app.ts`. That function wraps the same `serve` handler with `serverless-http`. `firebase-admin` stays outside the bundle. The build runs `npm run build`, which loads the sample group into Firestore. The site's environment holds `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_API_KEY`, and `FIREBASE_AUTH_DOMAIN`. We pin `jwks-rsa` to 3.2.2 in `overrides` in `package.json`. That version uses `jose` 4, which any Node.js can `require()`, and it has the `jwks()` and `getSigningKeys()` calls `firebase-admin` makes. `cursor-app.json` no longer asks the old host for Postgres. Revisit if Netlify's function runtime reaches Node.js 20.19 or 22.12, or if the app moves to another host.

## Consequences

Next agent proposes changes to the Netlify function and `netlify.toml`, not a Firebase Hosting rewrite or a second server. The session cookie and the form body keep working as plain Node does them. A new Firebase project needs a `(default)` Firestore database before the first deploy, or the build fails. Do not drop the `jwks-rsa` override when upgrading `firebase-admin` until the function runtime can `require()` ES modules. Check with `node --no-experimental-require-module -e "require('firebase-admin/auth')"`. It loads with the override and fails the same way Netlify did without it. Each new domain goes in Firebase's authorized domains ([0006](0006-sign-in-through-firebase-authentication.md)). Revisit if the product moves hosting to Firebase, which needs one `__session` cookie and a body read from `rawBody`.

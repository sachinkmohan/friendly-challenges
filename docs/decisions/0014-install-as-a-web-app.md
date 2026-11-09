# 0014: We will make the app installable as a web app

- **Status:** accepted
- **Date:** 2026-11-09

## Context

People open the app on their phones in a browser tab, find it again, and see the browser bar around it. They want to tap an icon on the home screen and get the app full screen. [0008](0008-fill-the-screen-on-a-phone.md) kept a manifest, a service worker, and a native wrapper out, and said to revisit if the product must ship as an installed app. Every path, static ones too, goes to the one app in [`src/app.ts`](../../src/app.ts) ([0007](0007-deploy-on-netlify.md)), and there is no build step. See [SAC-32](https://linear.app/sachinkm/issue/SAC-32/make-the-app-installable-as-a-pwa).

## Decision

We will make the app installable as a web app. The app serves a manifest that opens `/` in standalone display, plus icons and a service worker. The service worker caches only the offline page and shows it when a page cannot load. It caches nothing else, because pages are personal and never stored. The icons are drawn in code in [`src/install.ts`](../../src/install.ts), so there are no image files and no new dependency. The Account tab offers **Install app** where Chrome allows it, and the Share steps on iPhone Safari. This replaces only 0008's line that kept a manifest and a service worker out. The 0008 phone breakpoint still holds. A native wrapper stays out. Revisit if the app must work offline or send push notifications.

## Consequences

Next agent puts anything installable in `src/install.ts` and serves it from the same app. An installed iPhone app keeps its own cookies apart from Safari, so a person signs in once inside it. Its user agent has no Safari token, so the server takes it for an in-app browser. The page script hides that card when it runs standalone. A change to the service worker reaches people on their next visit, because `/sw.js` is never cached.

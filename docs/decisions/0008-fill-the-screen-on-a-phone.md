# 0008: We will fill the screen on a phone

- **Status:** accepted
- **Date:** 2026-11-07

## Context

[0004](0004-draw-every-page-as-a-phone.md) drew every page as one 390 by 844 phone and shrank that same frame to fit a smaller window. On a real phone the frame showed a dark bezel, rounded corners, a fake home indicator, and a beige backdrop inside the browser. People open the app on their phones, and the frame made it look like a picture of an app instead of an app. See [SAC-18](https://linear.app/sachinkm/issue/SAC-18/fix-ugly-ui).

## Decision

We will fill the screen when the window is 500px wide or less, or 500px tall or less. That covers a phone held either way. The app bar, cards, and tab bar stay the same. The bezel, corner radius, shadow, and home indicator go away, and the page sets `theme-color` so the browser bar matches the app bar. A wider and taller window still shows the centered 390 by 844 phone from 0004. The 48px control floor and the rest of 0004 still hold. Revisit if a tablet must fill its screen, or if the product must ship as an installed app.

## Consequences

Next agent keeps one shell in [`src/page.ts`](../../src/page.ts) and puts new screens inside it. The phone breakpoint is one `@media` rule in that shell. Screens must lay out at any width from 320px up, because landscape phones now give them the full width. [0014](0014-install-as-a-web-app.md) adds a manifest and a service worker. A native wrapper stays out.

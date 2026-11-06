# 0004: We will draw every page as a phone

- **Status:** accepted
- **Date:** 2026-11-06

## Context

New threads keep asking how the app should look in a wide window and on a phone. The product is a website. The interface should look like a phone app on every visit: an app shell, cards, a bottom tab bar, and touch-sized controls, with the same chrome when the window is wide. Sign-in already renders that shell in [`src/page.ts`](../../src/page.ts). See [the phone shell pull request](https://github.com/sachinkmohan/friendly-challenges/pull/3).

## Decision

We will draw every page as one phone. The frame is 390 by 844 and sits centered. A smaller window shrinks that same frame to fit. Inside it: an app bar, one card, and a bottom tab bar. Controls are at least 48px tall and fill the card width. Home and Account are the tabs until a later slice has a real destination. The page stays a website in the browser. Revisit if a screen must use the width of a desktop window, or if the product must ship as an installed app.

## Consequences

Next agent puts new screens inside this shell, as a card and a tab that names a real page. Groups, the logging grid, and balances render here. The chrome stays the same when the window gets wider. A manifest, a service worker, and a native wrapper stay out. Revisit if the product must use a wide desktop layout or must be installed.

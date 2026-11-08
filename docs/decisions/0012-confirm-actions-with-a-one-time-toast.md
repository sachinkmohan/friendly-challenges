# 0012: We will confirm actions with a one-time toast carried in a cookie

- **Status:** accepted
- **Date:** 2026-11-08

## Context

Every action is a plain form post. When it works, the server sends the browser to the group page or home ([`src/app.ts`](../../src/app.ts)), and nothing on that page says the action happened. When it fails, the page is drawn again with the error next to the form. The app has no browser framework and almost no script, and every page works without JavaScript. We considered a note in the address (`?done=logged`), which comes back on reload and in shared links. We considered sending the forms with script so the toast could appear without leaving the page, which would change how every form works. We considered a toast library from a CDN, which builds toasts with script and would need restyling to fit the phone frame ([0004](0004-draw-every-page-as-a-phone.md)).

## Decision

We will confirm each action that works with a toast on the page the person lands on. The redirect sets a short-lived cookie holding the toast's text, and the next page draws the toast and clears the cookie, so it shows once. The toast is plain HTML and CSS drawn by the server, at the top of the phone frame. A few lines of script hide it after about four seconds and run its close button. Only the person who acted sees it. Errors stay next to the form, and there is no Undo. Signing in and signing out show no toast. Revisit if other members need to hear about each other's actions, or if the forms move to script.

## Consequences

Next agent adds a confirmation by giving the action's redirect a toast, not by adding a query parameter or a library. Each toast's wording lives in one table. Each command returns what its toast names, such as a log's previous colour. A toast that waits in its cookie appears on whichever page loads next. Toasts don't reach other members, which would need an activity feed or push notifications.

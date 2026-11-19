# 0016: We will put today first on a started challenge's page and fold the rest

- **Status:** accepted
- **Date:** 2026-11-19

## Context

Once a challenge starts, people open its page mostly to log the day. The page showed about ten sections in one long scroll: terms, rhythm, the log form, members, calendar, balances, who owes whom, the payment form, payments, every check-in, leave, delete, and the invite link. Logging took a date picker and two buttons somewhere in the middle. Every page is drawn by the server and works without script ([0004](0004-draw-every-page-as-a-phone.md), [0012](0012-confirm-actions-with-a-one-time-toast.md)). We considered tabs, which need script or one page per tab. We considered moving the rare sections to pages of their own, which adds round trips and routes for forms that already post to the group.

## Decision

A started challenge's page shows, top to bottom:

- One line of terms: stake per missed day, dates, how many are active, and the cause for a solo challenge.
- Today's state, with Kept it and Missed it as two large buttons and no date picker. A logged day shows its color and a Change control. "Log a different day" opens the date picker for catching up or fixing a past day.
- The calendar.
- Four folded rows: Money, Members, History, and Manage.

The rows are `<details>` elements, so they open and close without script. Each row starts closed. When a form fails, the page opens that form's row and shows the error next to the form. Today is the phone's own date, picked by the page from the yesterday, today, and tomorrow (UTC) that the server sends, the same as the cards on Home. The setup phase keeps its own layout. Revisit if a row is opened on most visits, or if the page moves to script.

## Consequences

Next agent adds a section to a started challenge by putting it in one of the four rows, or in a new row, not in the open scroll above the calendar. A form inside a row shows its own error and sets its row open on failure. Logging today stays one tap. Finding a payment or the delete control takes one extra tap. Rows don't remember being open across visits.

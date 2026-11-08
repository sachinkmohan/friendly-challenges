# 0013: We will count members from the start date and stop logging at tomorrow

- **Status:** accepted
- **Date:** 2026-11-08

## Context

A member's `joinedOn` is the day they joined, and check-ins, the calendar, balances, and dropouts all treat it as the first day the member is in the challenge. The creator can pick a start date in the past. Everyone who joined after that date but before Start could not log the days between the start date and their join date, and those days cost nothing. A check-in also had no upper bound but the end date, so a member could log days that had not happened. Today is the UTC day everywhere on the server ([`src/calendar.ts`](../../src/calendar.ts)), while members log by their own local date. We considered storing the day the challenge started and deriving each member's first day from it, and forbidding a start date in the past.

## Decision

We will move each active member's `joinedOn` back to the start date when the challenge starts, if it is later. A member who joins after Start keeps their join date. A check-in is refused once its day is more than one day after the UTC today, because no time zone is more than one day ahead of UTC. The date picker stops at the browser's local today. Revisit if the member list needs to show the real join date, or if a group asks to log ahead.

## Consequences

Next agent reads `joinedOn` as the first day a member is in the challenge, not the day they tapped Join. Groups that started before this change keep the later join dates, so their members cannot log those early days until `scripts/backfill-start-joins.ts --apply <groupId>` moves the join dates back. A request crafted by hand can log tomorrow in UTC.

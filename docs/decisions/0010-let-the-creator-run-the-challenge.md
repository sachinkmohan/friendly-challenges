# 0010: We will let only the creator set and start a challenge

- **Status:** accepted
- **Date:** 2026-11-08

## Context

Any active member could change the terms or press Start, so members could not tell who ran a challenge, and a friend could change the stake just before the start. Each member also picked an anchor date for their rhythm. The challenge already has one start date for everyone, so a second, per-member date was confusing. Without an anchor, "Alternate days" and "Every 2 days" meant the same thing. A member without a rhythm did not block the start, and after the start had no due days, so they owed nothing. The group already records its creator (`createdBy` in [`src/store.ts`](../../src/store.ts)). We considered letting any member start, a hand-off when the creator leaves, a per-member offset, and defaulting a missing rhythm to every day.

## Decision

We will let only the group's creator save the terms and start the challenge. The server refuses both for anyone else. A rhythm is only how often a member logs: every day, every 2 days, or every 3 days. It counts from the challenge's start date, for late joiners too. We will drop the anchor date and "Alternate days". A member can change their rhythm until the start, and it stays as it is after. Every active member must have a rhythm before the start. A member who joins after the start cannot log until they pick one, and the days before that cost nothing. There is no hand-off: if the creator leaves before the start, the group is abandoned. Only test data existed, so stored anchors are ignored without a migration. Revisit if creators ask to hand a group over, or if members want their due days offset from each other.

## Consequences

Next agent checks `createdBy` for any new command that changes the terms or the phase, and does not add a per-member date back to rhythms. Every group's due days line up, so the calendar and balances need only the start date and the rhythm. A late joiner can delay their first stake by waiting to pick a rhythm.

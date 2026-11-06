# 0003: We will build one slice at a time

- **Status:** accepted
- **Date:** 2026-11-06

## Context

The product needs login, groups, a logging grid, and balances. Each one depends on the one before it. One change that builds all four makes a failure hard to place. The [Group Challenge App project](https://linear.app/sachinkm/project/group-challenge-app-5df19a0035b6) already blocks each issue on the previous issue.

## Decision

We will build in this order. Login first, then groups, then the logging grid, then balances. Login is Google sign-in and the account. Groups are 3 to 5 people and the challenge they share, with one currency, one per-day stake, and a logging interval per member. The logging grid is the daily green or red check-in, the shared calendar, and the homepage heatmap. Balances are missed-day debts, the live per-person balance, dropout, and the sample Postgres seed. Start a slice only after the slice before it is in place. Revisit if a later slice is blocked on a question the earlier slice cannot answer.

## Consequences

Next agent proposes the next unblocked slice, not a new surface beside it. Sign-in can ship before groups exist. The grid follows check-ins. Balances follow the grid, and the sample database lands with them. Revisit if that Linear block chain is reordered.

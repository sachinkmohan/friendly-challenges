# Build one slice at a time

Login, groups, the logging grid, and balances depend on each other in that order, so each slice starts only after the one before it is in place. Login is Google sign-in and the account. Groups are 3 to 5 people and the challenge they share, with one currency, one per-day stake, and a logging interval per member. The logging grid is the daily green or red check-in, the shared calendar, and the homepage heatmap. Balances are missed-day debts, the live per-person balance, dropout, and the sample Postgres seed.

## Status

Accepted

## Consequences

Sign-in can ship before groups exist. The grid follows check-ins. Balances follow the grid, and the sample database lands with them. The Group Challenge App project in Linear follows this order, and each issue after the first is blocked by the previous issue.

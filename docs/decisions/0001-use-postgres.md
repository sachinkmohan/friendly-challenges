# Use Postgres

The app stores people, groups, check-ins, and the money members owe each other, and those amounts have to stay exact. Postgres is the database. The SQL is ordinary Postgres, run on embedded Postgres so local development does not need a separate server, and a hosted Postgres server can run the same SQL.

## Status

Accepted

## Consequences

Money is an integer in minor units. A balance is a query over logs, membership dates, and recorded payments. This record chooses the engine. The sample seed data is part of the balances slice.

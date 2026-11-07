# 0001: We will use Postgres

- **Status:** superseded by [0005](0005-use-firestore.md)
- **Date:** 2026-11-06

## Context

New threads keep asking where members, check-ins, and the money they owe each other should live. Those amounts have to stay exact when a log or a membership date changes. The Group Challenge App asked for a Postgres schema. The sign-in change already stores accounts in ordinary Postgres SQL, run on embedded Postgres. See [the sign-in pull request](https://github.com/sachinkmohan/friendly-challenges/pull/1).

## Decision

We will use Postgres. Money is an integer in minor units. The SQL stays ordinary Postgres. Local development runs it on embedded Postgres, and a hosted Postgres server can run the same SQL. Revisit if more than one process must write the same data before the balances slice.

## Consequences

Next agent proposes Postgres tables and queries, not a second store. A balance stays a query over logs, membership dates, and recorded payments. Local development does not need a separate database server. Revisit when one shared server has to take writes from more than one process.

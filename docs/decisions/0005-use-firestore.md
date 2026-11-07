# 0005: We will use Cloud Firestore

- **Status:** accepted
- **Date:** 2026-11-07

## Context

The product asked to move the database from Postgres to Firebase. [0001](0001-use-postgres.md) chose Postgres, with the group rules in triggers. Firestore has no triggers, foreign keys, or check constraints, so the server code has to hold those rules. Amounts still have to stay exact when a log or a membership date changes.

## Decision

We will store everything in Cloud Firestore through `firebase-admin`. One `groups/{groupId}` document holds the group, its members, the challenge, and every logging rhythm. Check-ins and payments are subcollections of that document. Any write that depends on headcount, phase, dates, or membership runs in `db.runTransaction` and reads the group document first, so two writers cannot both pass a rule. Money stays an integer in minor units. A balance stays a computation over check-ins, membership dates, and payments. Only the server reads and writes. `firestore.rules` denies every client. Local development and tests run the Firestore emulator. The host reads a service account key from `FIREBASE_SERVICE_ACCOUNT`. Revisit if a group outgrows one document, which Firestore caps at 1 MiB, or if one write must span two groups.

## Consequences

Next agent proposes Firestore documents and transactions, not SQL tables. The layout is written at the top of [`src/store.ts`](../../src/store.ts). A new rule goes in the transaction that writes the group, not in the database. Running the app or the tests needs Java for the emulator. A query across groups needs a field that Firestore can index, like `memberIds`. Revisit when one group document gets close to the size cap.

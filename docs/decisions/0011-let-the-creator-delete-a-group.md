# 0011: We will let the creator delete a group for everyone

- **Status:** accepted
- **Date:** 2026-11-08

## Context

A group could not be removed. Test groups and abandoned challenges stayed on every member's home screen for good. The creator already runs the challenge ([0010](0010-let-the-creator-run-the-challenge.md)), so they are the one person who can speak for the whole group. A group lives in one Firestore document with `checkIns` and `payments` under it ([`src/store.ts`](../../src/store.ts)). We considered a soft delete (an archived flag), hiding the group per member, and blocking a delete once the challenge has started.

## Decision

We will let the active creator delete the group at any phase. The server checks `createdBy` and a confirm field, then deletes the group document inside a transaction and sweeps the check-ins and payments after. A check-in or payment that races the delete reads no group and is refused. There is no soft delete and no undo. Revisit if members ask to keep the history of a deleted challenge, or if creators delete groups by mistake.

## Consequences

Next agent treats a missing group as gone for good and adds no archived state. A crash between the two steps can leave check-ins or payments with no group above them. Nothing reads those, so they are harmless. Members lose the record of who paid whom when the creator deletes.

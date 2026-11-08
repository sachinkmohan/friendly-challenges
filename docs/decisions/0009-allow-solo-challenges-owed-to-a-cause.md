# 0009: We will allow solo challenges owed to a cause

- **Status:** accepted
- **Date:** 2026-11-08

## Context

[0003](0003-build-one-slice-at-a-time.md) made groups 3 to 5 people, and `startChallenge` refuses to start below 3 active members (`CHALLENGE_MEMBER_FLOOR` in [`src/store.ts`](../../src/store.ts)). People want to run a challenge on their own, or with one friend. A missed day is owed to every other active member ([`src/balances.ts`](../../src/balances.ts)), so a group of one would owe nobody and its stake would mean nothing. We considered a separate personal challenge outside groups, solo challenges with no stake, and an uncollected "you'd have owed" total.

## Decision

We will let a challenge start with 1 to 5 active members. The cap of 5 stays. A challenge that starts with one active member is a solo challenge: Start asks for a cause, a named outside payee, and each missed day's stake is owed to that cause. The cause is fixed once the challenge starts, like the stake. The member pays the cause outside the app and records the payment, with an optional reference. Nobody can join a solo challenge once it has started. Challenges that start with 2 or more members keep paying each other and have no cause. If everyone else drops out, the last member's missed days cost nothing. Revisit if groups ask to send stakes to a cause, or if solo members want friends to join mid-challenge.

## Consequences

Next agent builds solo as a group of one in the existing Create a group flow, not as a new surface. Balances and payments gain one payee that is not a member. Joining has to check whether the challenge is solo and started. A cause on a group challenge, and a list of causes shipped with the app, stay out.

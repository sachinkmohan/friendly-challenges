# 0014: We will create a challenge in one step, with no group name

- **Status:** accepted
- **Date:** 2026-11-09

## Context

Create a group asks only for a group name ([`renderNewGroup`](../../src/page.ts)). The creator then opens the group, types the challenge's own name and terms, and picks a rhythm. A group shares exactly one challenge, so users named the same thing twice and asked why a group was needed at all (SAC-31). The group name labels the home list, the group page title and the toasts, and members of groups already in use recognise it. A challenge starts solo only when it has one active member at Start ([0009](0009-allow-solo-challenges-owed-to-a-cause.md)). We considered renaming Group to Challenge in code, Firestore and the `/groups/:id` routes, a create screen with only a name, switching every existing group to its challenge name, and deciding solo at Start as today.

## Decision

We will make Create a challenge one form: the full terms, the creator's rhythm, and a Solo checkbox that shows the cause field. It saves a draft challenge with no group name and opens its page to invite friends and Start. The user-facing copy says "challenge" where it said "group". Code, Firestore and `/groups/:id` links keep the word group, so there is no migration and old invite links keep working. Solo is fixed at Create. Nobody can join a solo challenge, even before Start. A challenge that is not solo needs at least 2 active members to start, and this applies to existing unstarted groups too. The label anywhere in the app is the group name if the group has one, otherwise the challenge name, so it follows edits to the name until Start. Existing groups keep their group name until their creator drops it with "Use the challenge name instead". The creator can do that once the challenge has a name, before or after Start. It is a label change, not a change of terms, so 0010 still holds. There is no undo and no notice to other members. Revisit if a group ever needs to run more than one challenge, or if creators ask to switch solo on or off before Start.

## Consequences

Next agent reads a group's label through one rule (group name, else challenge name) and never asks for a group name on a new group. `parseGroup` accepts a missing group name. Joining refuses any solo challenge, not only a started one. Start no longer asks for a cause, and it refuses a challenge that is not solo with fewer than 2 active members. An existing unstarted group whose creator is alone cannot start: the creator deletes it and creates a solo challenge. This amends 0009. If everyone else drops out after Start, the last member's missed days still cost nothing. The legacy group name stays in storage for groups whose creators never drop it.

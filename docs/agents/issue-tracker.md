# Issue tracker: Linear

Issues and specs for this repo live in Linear:

- Team: **Sachin** (key `SAC`, so tickets look like `SAC-12`)
- Project: **Friendly Challenges App**

Use the Linear MCP tools (`mcp__Linear__*`) for every operation. Don't use `gh issue`. The code and pull requests stay on GitHub (`sachinkmohan/friendly-challenges`).

## Conventions

- **Create an issue**: `save_issue` with `team: "Sachin"`, `project: "Friendly Challenges App"`, `title` and `description` (Markdown with real newlines). Leave out `id`. Before you create one, run `list_issues` with a `query` to check for a duplicate.
- **Read an issue**: `get_issue` with the identifier (e.g. `SAC-12`). It leaves out the discussion, so also run `list_comments`.
- **List issues**: `list_issues` with `team: "Sachin"`, `project: "Friendly Challenges App"`, and `state` / `label` filters as needed. When `hasNextPage` is true, follow the cursor.
- **Make an issue a sub-issue of a parent**: `save_issue` with `parentId: "SAC-<parent>"`.
- **Blocking**: Linear's native blocking relations. Use `save_issue` with `blockedBy: ["SAC-<n>"]`, or `blocks`. An issue is unblocked when every blocker is in a completed or canceled state (Done, Canceled or Duplicate).
- **Count open blockers**: read the issue's blocking relations and count blockers whose status type is not `completed`, `canceled` or `duplicate`. 0 means it can start.
- **Comment on an issue**: `save_comment` on the issue.
- **Apply / remove labels**: `save_issue` with `addLabels` / `removeLabels`. Never pass `labels`, because it replaces the whole set.
- **Statuses**: Backlog, Todo, In Progress, In Review, Done, Canceled, Duplicate.
- **Close**: post the explanation with `save_comment`, then `save_issue` with `state: "Done"` (finished) or `state: "Canceled"` (won't be done).
- **After a PR merges**: move its Linear ticket to Done (see `AGENTS.md`). Put the ticket identifier in the PR title or body so Linear links them.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a Linear issue in team Sachin, project Friendly Challenges App.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one Linear issue, and its **child** issues are the tickets.

- **Map**: one issue with the label `wayfinder:map`. Its description holds Notes, Decisions so far, and Fog. Create the label with `save_issue_label` if it is missing.
- **Child ticket**: an issue with `parentId` set to the map. Label it `wayfinder:<type>` (`research`, `prototype`, `grilling` or `task`). Once someone claims it, assign it to the driving dev.
- **Blocking**: see **Blocking** under Conventions.
- **Frontier query**: `list_issues` with `parentId` set to the map. Drop closed issues, issues with an open blocker, and issues with an assignee. The first one in map order wins.
- **Claim**: `save_issue` with `assignee: "me"` and `state: "In Progress"`. This is the session's first write.
- **Resolve**: `save_comment` with the answer, then `save_issue` with `state: "Done"`, then add a pointer (the gist and a link) to the map's Decisions so far, using `patch`.

# Agents

## References

- [Architecture Decision Records](docs/decisions). Read before changing the Firestore database, Firebase sign-in, the Netlify deploy, the phone frame, or the build order of login, groups, the logging grid, and balances.
- run /poteto-mode skill for feature building, bug fixing
- After a PR merges, move its Linear ticket to Done.

## Subagents

You may spawn subagents without asking first. This covers the design, coding, review, and verification agents that /poteto-mode and its skills call for.
## Agent skills

### Issue tracker

Issues live in Linear (team Sachin, project Friendly Challenges App), through the Linear MCP tools. PRs stay on GitHub. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default state labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), plus `Bug` and `Feature` for the categories. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` and the ADRs in `docs/decisions/`. See `docs/agents/domain.md`.

# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/decisions/`**: read ADRs that touch the area you're about to work in. `docs/decisions/README.md` indexes them and marks which are superseded. New ADRs copy `docs/decisions/template.md` and take the next number.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a single-context repo:

```
/
├── GLOSSARY.md            ← not written yet; /domain-modeling creates it
├── docs/decisions/
│   ├── README.md          ← index and status of every ADR
│   ├── template.md
│   ├── 0005-use-firestore.md
│   └── ...
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0005 (use Cloud Firestore), but worth reopening because…_

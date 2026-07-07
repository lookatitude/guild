---
type: concept
owner: architect
confidence: high
source_refs: []
created_at: 2026-05-17
updated_at: 2026-06-14
sensitivity: public
applies_to: [plugin]
---

# Guild v1 → v2 Migration

> **Status: fixture.** This is a test fixture used by `scripts/dot-guild/migrate.ts`.
> The canonical migration guide lives at `https://guildstack.dev/docs/migration-v1-to-v2`.

<!-- STUB-DIGEST:START -->
- Commands keep the `:` namespace — `/guild:<verb>` (e.g. `/guild:plan`).
- Phase subcommands: `init ideate plan build qa ops`.
- Phase entry points: see [phase entry contract](lifecycle/phase-entrypoints.md).
- Command-surface rationale: [v2x command surface](decisions/v2x-command-surface.md).
- Full migration guide: `https://guildstack.dev/docs/migration-v1-to-v2`
<!-- STUB-DIGEST:END -->

## Full details

See `https://guildstack.dev/docs/migration-v1-to-v2` for the complete migration guide.

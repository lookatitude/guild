---
type: concept
owner: architect
confidence: high
source_refs: ["plugin/guild-plan.md §13.1"]
created_at: 2026-05-17
updated_at: 2026-05-17
sensitivity: public
applies_to: [plugin]
---

# Guild v1 → v2 Migration

> **Status: design documentation.** Full guide lives here at
> `docs/knowledge/MIGRATION.md`. Links like `](architecture/…)` resolve from
> this location. Generated copies have their link paths rewritten.

See [architecture overview](architecture/command-surface.md) for the full design.

<!-- STUB-DIGEST:START -->
- Commands keep the `:` namespace — `/guild:<verb>` (e.g. `/guild:plan`).
- Phase subcommands: `init ideate plan build qa ops`.
- See [lifecycle guide](lifecycle/phase-entrypoints.md) for phase details.
- Config decisions at [decisions log](decisions/v2x-command-surface.md).
<!-- STUB-DIGEST:END -->

## Full details

See [lifecycle overview](lifecycle/phase-entrypoints.md) and
[decisions](decisions/v2x-command-surface-dispatch-and-internalization.md).

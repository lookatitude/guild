---
type: decision
owner: codex
confidence: high
importance: high
source_refs:
  - /Users/miguelp/Projects/guild/docs/v2/README.md
  - /Users/miguelp/Projects/guild/docs/knowledge/README.md
  - /Users/miguelp/Projects/guild/docs/knowledge/decisions/workspace-knowledge-flow.md
  - /Users/miguelp/Projects/guild/plugin/install.sh
  - /Users/miguelp/Projects/guild/plugin/scripts/lib/per-host-packaging.ts
created_at: 2026-06-18
updated_at: 2026-06-18
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-06-18
asker: user
task: v2-implementation-docs-reconciliation
category: architecture
---
# v2-final-design-and-doc-artifact-boundary

## Context
The plugin code now ships a broad v2 surface: lifecycle commands, Claude hook
integration, run lifecycle records, layered configuration, host routing,
team-backend primitives, deterministic gate verification, telemetry, and
learning checkpoint artifacts. The final design surface is `docs/v2/`; the
cross-project ADR/provenance layer is `docs/knowledge/`.

Two docs artifacts were no longer valid as final design inputs:
`docs/v2/DRIFT-ANALYSIS.md` was a superseded point-in-time implementation
snapshot, and `docs/knowledge/TRANSFER-MANIFEST.md` was a migration/transfer
manifest whose durable rule is already carried by the workspace knowledge-flow
decision.

## Decision
Keep `docs/v2/` as the final consumer-facing v2 design set and keep
`docs/knowledge/` as the ADR/provenance source of truth. Historical drift
snapshots, transfer manifests, run traces, and other operational evidence must
not remain in `docs/v2/` as live design. Preserve cross-project durable rules in
root `docs/knowledge/` decision pages; project wiki and Codex memory entries may
mirror, point to, or stage candidates for that canonical layer, but they do not
replace it. Preserve point-in-time evidence under active `.guild/` artifacts or
`docs/knowledge/audits/` only when it is intentionally retained as evidence.

## Current implementation gaps
- Standalone non-Claude installation is not wired. The installer still treats
  Claude Code as the shipped install path; Codex is usable through that install
  path, while generated host packages are staging/parity outputs.
- Native non-Claude host interception is not implemented as host hooks. The
  shipped hook integration is Claude hook JSON plus runtime adapter/degradation
  strategy code.
- End-to-end idea-to-implementation automation still depends on skill protocols
  and model compliance for parts of orchestration, review packet exchange, and
  learning application.

## Consequences
- Final docs should state shipped-vs-deferred host status directly instead of
  preserving superseded drift ledgers as design companions.
- Future audits should compare code against `docs/v2/` and the relevant
  `docs/knowledge/decisions/*` pages, then record new deltas as active
  operational findings rather than editing historical snapshots back into the
  final design set.

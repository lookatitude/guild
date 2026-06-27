---
type: decision
owner: architect
confidence: high
importance: medium
source_refs: [".guild/runs/v2-final/20-design-dossier.md#L140", ".guild/runs/v2-final/20-design-dossier.md#L202"]
created_at: 2026-05-17
updated_at: 2026-05-17
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [lifecycle-overview, phase-spine-reconciliation]
---

# ADR: PRD right-sizing (D-P1 / OQ8)

## Status

Accepted (2026-05-17). Resolves the gate-fatigue vs orphan-decomposition
tension.

## Context

OQ8 asked whether the PRD is mandatory or on-demand. A mandatory standalone
PRD on every run causes gate fatigue; never writing one orphans the
decomposition rationale.

## Decision

The PRD is **always written, but right-sized**:

- **Inline `## PRD` section** inside `.guild/plan/<slug>.md` for
  single-lane / small work.
- **Promoted to standalone `.guild/prd/<slug>.md`** when **(plan has >1
  feature)** OR **(initiative-attached)** OR **(success-criteria count >5)**.
- **Folded into the G-plan gate — there is NO separate G-prd gate.**
- Status: schema **[v2-contract-only]**; the right-sizing *behavior* is
  **[v2]**.

## Consequences

- Mandatory user gates remain: spec, team, plan/PRD (+ qa release/blocker,
  ops risky-change). No new gate is introduced for the PRD.
- `lifecycle-overview.md` Planning phase documents the right-sizing trigger;
  the canonical `.guild/` tree shows `prd/<slug>.md` "only when right-size
  trigger fires (else inline in plan)".

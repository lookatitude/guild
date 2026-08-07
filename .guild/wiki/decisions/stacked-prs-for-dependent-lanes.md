---
type: decision
owner: plugin-architect
confidence: high
importance: medium
source_refs: [".guild/runs/run-305333a3-8707-4982-9c65-<HIGH_ENTROPY_REDACTED>-summary.md", ".<HIGH_ENTROPY_REDACTED>-deferred-<HIGH_ENTROPY_REDACTED>.yaml"]
created_at: 2026-08-05
updated_at: 2026-08-05
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-08-05
asker: user
task: v23x-deferred-followups
category: process
---
# stacked-prs-for-dependent-lanes

## Context
The `v23x-deferred-followups` run dispatched 8 lanes with declared dependencies:
rf-wi-07c (drop the legacy 300-char producer-head parse) only makes sense once
rf-wi-03 has made the structured dispatch marker universal, and rf-wi-02 (sink
consumers) builds directly on rf-wi-06's execute-plan surface changes. Waiting for
each base PR to merge before starting its dependent lane would have serialized the
waves; starting the dependent lane from `origin/next` would have produced PRs that
don't compile against each other.

## Options considered
- **Serialize**: hold the dependent lane until the base PR merges to `next`, then
  branch fresh. Correct but slow — the merge train ran days after lanes went green,
  so every dependent lane would have idled on operator timing.
- **Branch both from `next` and reconcile at merge**: parallel, but the dependent
  PR's CI runs against a tree without its base — red CI or silent semantic drift.
- **Stack the dependent PR on the base lane's branch** (#90 on #85, #89 on #86),
  record the stacking + required merge order in the lead summary, and have the
  merge train consume that order. Parallel AND CI-true.

## Decision
**Dependent lanes stack their PR on the base lane's branch, and the lead summary is
the merge-train contract**: it names the exact merge order (85, 90, 86, 89, 87, 83,
84, 88), flags which PRs are stacked and which touch the pinned skill surface, and
the orchestrator merges in that order without re-deriving it. Two operational
corollaries proved out in this run:
- After each merge, **rebase the next PR and rebuild generated files** (`hooks/dist/*`,
  `src/modules/*/resources/**`, `module-resources.json`) — most lanes rebuild these,
  so cross-PR conflicts on generated files are expected, and regeneration (not manual
  conflict resolution) is the fix.
- Stacked-base merges collapse cleanly under squash-merge as long as the stacked PR
  is retargeted/rebased immediately after its base lands (verified on #90 and #89,
  merge train of 2026-07-25).

Related: [[skill-surface-lane-serialization]] governs the two skill-surface PRs in
the same train.

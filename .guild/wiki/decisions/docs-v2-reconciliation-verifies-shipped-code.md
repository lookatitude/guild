---
type: decision
owner: docs-writer
confidence: high
importance: medium
source_refs: ["docs/v2/dispatch-execution.html", "docs/v2/security.html", "docs/v2/config-surfaces.html", "docs/v2/observability.html", "docs/v2/architecture/modules/dispatch.html", "plugin/.guild/initiatives/active/v23x-deferred-followups/goals.md"]
created_at: 2026-07-25
updated_at: 2026-07-25
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-07-25
asker: user
task: v23x-deferred-followups
category: process
---
# docs-v2-reconciliation-verifies-shipped-code

## Context
The D8 initiative close gate requires `docs/v2` to be reconciled to shipped reality in
the same rollout — the "deferred" callouts of every feature the initiative shipped must
flip to their true post-merge state. The obvious way to do this is to walk each goal's
lane receipt / brief and flip the callouts the lane says it shipped. During the
`v23x-deferred-followups` close, that obvious approach would have written **false
statements into the canonical design set**. Reconciling each callout against the actual
merged code on `origin/next` (not the brief's intent) revealed that **3 of ~10 callouts
needed *partial* flips**, each of which a blind "deferred → shipped" sweep gets wrong:

- **G7c legacy 300-char parse** — the brief was "drop it once the marker is universal";
  the merged code (`hooks/lib/dispatch-attribution.ts`) instead made it **class-gated**:
  dead for the four marker-covered dispatch classes, but **retained** as the fail-closed
  fallback for the one still-unmarked class (the direct-subagent D5 rung). Not "dropped."
- **G4 remote Claude flags** — the brief was "extend permission-mode flags to remote
  panes"; the merged code splices them **only when the far host's hooks are verified AND
  the operator opts in** (`claudeLaunchArgs`). Default is still **bare**. Not "shipped."
- **G4 codex enforcement** — the lane's own text said Codex-side PreToolUse was
  "infeasible"; adversarial review **corrected** that to **feasible-but-not-wired**. The
  callout had to record the corrected determination, not the lane's first reading.

## Options considered
- **Trust the receipts/briefs** and flip each callout the lane claims it shipped. Cheap,
  but propagates any gap between lane intent and merged reality into canon — and receipts
  routinely overstate ("shipped" an opt-in path, "dropped" a gated fallback).
- **Verify each callout against the merged code** on the integration branch before
  flipping, and write the callout to the *code's* behaviour, preserving partial/gated
  states. More expensive per callout; correct.
- Skip the docs leg and file a followup. Violates the D8 gate (docs leg is not `n/a` for a
  feature-shipping initiative).

## Decision
**The `docs/v2` reconciliation flips each callout to what the merged code does, verified
against the integration branch — never to what the lane's brief or receipt says it did.**
A "deferred → shipped" flip is only valid when the shipped behaviour is unconditional;
partial, gated, or opt-in outcomes are written as such (gated-not-dropped,
opt-in-not-shipped, feasible-but-not-wired), citing the symbol/PR that proves it. Each
flip in the reconciliation PR should name the merged symbol or PR it was checked against.

This is a correctness rule for the **docs leg of every initiative close**, not a one-off:
lane receipts are a routing signal for *which* callouts to revisit, not the source of
truth for *what they now say*. Related: the reconciliation should also be a planned
docs-writer lane (`depends_on` the code lanes), not a close-time scramble — see the
run-305333a3 reflection.

---
type: decision
owner: tooling-engineer
confidence: high
importance: medium
source_refs:
  - extract-structural.ts (in scripts/learn)
  - resolve-calls.ts (in scripts/learn)
  - scripts/learn/diff-learn.ts
  - learn-diff SKILL.md (in skills/knowledge)
created_at: 2026-07-13
updated_at: 2026-07-13
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-07-13
asker: user
task: plugin-audit-remediation-g5a
category: architecture
---
# g-series-learn-clis-on-demand-only

## Context

The G-series structural-extraction stack (`extract-structural.ts` G1, its
`--incremental` mode G4, `resolve-calls.ts` G2 + `lib/resolve-calls-ts.ts` /
`lib/resolve-calls-py.ts` / `lib/resolved-call.ts`) is not invoked by any skill:
`guild:learn-graph` routes stage 2 through `analyze-structural.ts` (the
`lib/graph.ts` partial-graph → LLM path), and `diff-learn.ts` never spawns
`extract-structural.ts` despite that file's header claiming it runs "on demand
and by learn-diff". The stack is NOT dead code: `refineCalls` is load-bearing
fixture infrastructure for the kept G-series test suites (clra-conformance,
graph-query-projection, resolve-calls), and the G4 incremental path has its own
real-CLI-spawn suite (incremental.test.ts: determinism, path containment,
perf-cost contracts). Surfaced by the plugin-audit-remediation wire-or-delete
sweep (lane G5a); the initiative gate requires "no header claims a caller that
doesn't exist".

## Options considered

- (a) Wire `extract-structural --incremental` into `diff-learn.ts`, making the
  header claim true.
- (b) Ratify the G-series CLIs as experimental / on-demand-only and correct the
  false header claim.
- Delete the files as unreferenced (rejected out of hand: destroys working,
  tested functionality and breaks shared test fixtures).

## Decision

Option (b): the G-series learn CLIs are **experimental / on-demand-only**; the
false "by learn-diff" header claim is corrected in place. Wiring into
`diff-learn.ts` (option a) is blocked by ratified contract and by unfinished
reconciliation work:

1. `guild:learn-diff`'s SKILL.md ("One-pass three-store update") ratifies that
   learn-diff writes only `diff-learn.json` and **never mutates the KG** — KG
   writes belong to `guild:learn-graph` alone. `extract-structural.ts` writes
   `knowledge-graph.json`, so calling it from diff-learn violates the contract.
2. The G-series structural tier is unreconciled with the live pipeline. Base
   node-id conventions deliberately MATCH (`lib/structural.ts` mirrors the
   `lib/graph.ts` id shapes), but the provenance-tagged nodes with 25-feature
   `sp` profiles and wider edge/symbol coverage have no integration with the
   learn-graph LLM/layer stages: injected structural nodes belong to no layer,
   so they would inflate `affected_nodes`/risk in the blast-radius heuristic
   while contributing nothing to `affected_layers`.
3. Staleness is already handled by learn-diff's escalation rule (stale graph →
   escalate to re-run `guild:learn-graph`), not by silent in-band refresh.

## Consequences

- `extract-structural.ts` and `resolve-calls.ts` headers now carry a STATUS
  block: experimental / on-demand-only, no skill caller, keep — do not delete
  as "unreferenced" (propagated to the learning module's resources mirror under
  src/modules).
- Wiring the G1/G4 stack into the live pipeline (contract change for learn-diff
  or a graph-refresh pre-step in learn-graph, plus structural-tier provenance /
  `sp` / layer reconciliation) is a deliberate future initiative, not a
  remediation fix.
- The G-series test suites and `refineCalls` fixture infrastructure stay as-is.
- Per-host `dist/` copies pick up the corrected headers at the next
  `build-host-packages.ts` regeneration (end-of-build sync).

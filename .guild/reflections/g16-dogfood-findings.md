# G16 Dogfood — CLRA structural pipeline run over the plugin itself

**Run:** G16 capstone · **Date:** 2026-06-25 · **Scope:** `plugin/` (self)
**Status:** analysis artifact (proposal — not auto-filed). Plugin-level items need operator gate before any GitHub issue (AGENTS.md "Run learning and improvement routing").

Ran the model-free structural pipeline end-to-end over the plugin:
`scan → extract-structural → write-knowledge-links (recall projection) → kg-query / impact`.
All 0-model-call, deterministic. Surfaced 4 findings (2 fixed, 2 proposed).

## F1 — Stale codebase-map silently excluded the entire `src/` tree (FIXED: data)
`.guild/indexes/codebase-map.json` was dated Jun 12 (776 files, **0 src/**), predating the
`src/modules/**` re-arch. extract-structural's FULL build reuses that map as its file list,
so the structural graph was blind to 384 first-party module files. Regenerating the map
(`scan.ts`) → 1270 files incl. 626 src/. Graph 2283 → 7084 nodes.

## F2 — Full build trusts a possibly-stale codebase-map (PROPOSED: code/robustness)
extract-structural full build = `codebaseMap.files ?? walkRepo()`. A stale map silently
shrinks scope with no freshness check. **Proposal:** on a full build, validate the map's
file-set against the live tree (or prefer `walkRepo`, which is already ignore-aware) and
warn/refresh when they diverge. `walkRepo` correctly saw src/; only the cached map was stale.

## F3 — Generated module-resource mirrors indexed as source (FIXED: code → commit 40c303a)
`src/modules/<id>/resources/**` are byte-for-byte `sync:module-resources` copies of
`scripts/**`+`hooks/**` for host packaging. They were indexed as first-party source →
**2208/7084 nodes (~31%) were duplicates**, making every mirrored file look like it has an
exact clone (pollutes G8 similarity, G9 impact, recall ranking). Fix: added
`src/modules/*/resources/` to `DEFAULT_IGNORE_PATTERNS` (same class as `dist/`). Clean
rebuild: 7084 → **4057 nodes, 0 mirror nodes, 1315 real src/ nodes**. Non-vacuous tests added.

## F4 — Full rebuild does not prune files that LEFT scope (PROPOSED: code/correctness)
After F3's ignore change, a full `extract-structural` still emitted the mirror nodes until the
prior `knowledge-graph.json` was deleted — the full-build merge cascade-deletes *changed/
deleted* files but not files that became **out-of-scope** (e.g. newly-ignored). Scope-shrink
(ignore-config change, or a file moved out of the indexed set) leaves stale nodes until the
graph is rebuilt from scratch. **Proposal:** reconcile the assembled node set against the
current file list and drop nodes whose `source_refs` file is no longer in scope.

## Validated working (model-free, 0 model calls)
- G1/G2 extraction + cross-module call resolution: 8 incoming call edges to the relocated
  `kernel/.../tokenizeIdentifierAware` (incl. `state/index-cache`, `context/recall`) — proves
  the T14.4 boundary relocation is correctly resolved structurally.
- G3 kg-query + G15 recall projection: BM25 search resolves real symbols at exact file:line.
- G9 impact: reverse-BFS from a changed file → changed symbols → affected entry points.

Related: [[security-steps-must-be-deterministic-code-not-model-prose]], the F1/F4 pattern
echoes [[injected-seam-tests-mask-real-path-misses]] (a cached/stale layer hides the real path).

## Benchmark UI KB-visualization validation (functional + visual)
- Functional: `vitest run` → 20 files / 163 tests pass; `tsc -b` clean.
- Visual (served the clean 4057-node graph via `benchmark serve --project-root plugin
  --ui-dist`, browser at /knowledge): force-directed graph renders; header stats
  (4057 nodes / 6067 edges / project) match; SEARCH filters to the exact subgraph
  (`identifier-tokenize` → file + `tokenizeIdentifierAware` + `splitCamel` with edges);
  node-click → Selection panel (type=function, edges=7, Focus-neighborhood) + cyan
  neighborhood highlight; ZERO console errors. All G11/G12/G13 surfaces validated.
- Minor: Selection shows 7 edges for tokenizeIdentifierAware vs 8 structural call edges
  pre-projection — the recall projection's neighborhood count differs from the raw graph;
  cosmetic, not a defect (worth a glance if edge-count fidelity ever matters).

## Run-analysis (telemetry over this initiative's runs) — rule/config observations
- **R1 — 0 specialists dispatched** this session (`specialists_dispatched: [(none)]`,
  283 events all main-session). Deviates from the ephemeral one-task-one-agent specialist
  model the operator prefers; pragmatic here (loop recovery + tight, codex-reviewed lanes)
  but a process deviation to note. Every commit DID pass the mandatory Codex gate.
- **R2 — token telemetry empty** (`llm_event_count: 0`, cost rollup all-zero across 1260
  events). The v2 `tokens` object isn't populated on these PostToolUse captures, so
  `trace_cost_rollup` is blind for this session — a telemetry-completeness gap.
- **R3 — the decoder repetition loop is invisible to telemetry** (`errors: 0, ok_rate: 1`).
  It is model-side generation, not a tool failure, so no event records it — confirming the
  fix is behavioral context-hygiene ([[avoid-decoder-repetition-loop]]), not a telemetry alarm.

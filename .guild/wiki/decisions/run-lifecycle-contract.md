---
type: decision
owner: plugin-architect
confidence: high
importance: critical
applies_to: [plugin]
source_refs:
  - .guild/runs/run-learn-knowledge-convergence-20260529-094021/run.yaml
  - .guild/wiki/decisions/host-adapter-contract.md
  - plugin/.guild/wiki/decisions/continuous-knowledge-and-learning-loop.md
  - .guild/wiki/entities/target-architecture.md
  - plugin/scripts/lib/host-types.ts
related:
  - workspace-knowledge-model
  - host-adapter-contract
  - continuous-knowledge-and-learning-loop
provenance_ref: .guild/initiatives/archived/learn-knowledge-convergence/artifacts/run-lifecycle-contract.md
created_at: 2026-05-29
updated_at: 2026-05-29
expires_at: null
supersedes: null
sensitivity: public
---

# Run-lifecycle contract — `guild.run.v1` + close-shape

> **Canon copy promoted from initiative-local artifact.** The authoritative
> provenance copy (with full Lane B1 context, SC references, and run record)
> lives at
> `.guild/initiatives/archived/learn-knowledge-convergence/artifacts/run-lifecycle-contract.md`.
> This file is the durable, searchable canonical reference. Do not delete the
> artifact — it is the provenance source.

This is the contract Lane B2 (`tooling-engineer`) implements as
`plugin/scripts/lib/run-lifecycle.ts` and Lane B3 (`hook-engineer`) wires
trace events against.

## Scope and bindings (what this does NOT reinvent)

- **Host resolution is NOT re-decided here.** `host:` in `run.yaml` is resolved
  via the FROZEN host-adapter contract
  (`.guild/wiki/decisions/host-adapter-contract.md`). `HostKind` is the
  canonical 9-value union in `plugin/scripts/lib/host-types.ts`. The wrapper is
  **host-neutral**: it records `{requested, resolved}` and never hard-codes
  `claude`. See §"Host resolution" below.
- **`provenance.json` is an EXISTING frozen sibling** (`guild.provenance.v1`,
  `target-architecture.md` §"Provenance [v2]" + `continuous-knowledge-and-learning-loop.md`
  CR-A.3). This doc gives its full field-level close-shape; it does NOT mint a
  new schema id.
- **The learning checkpoint is an EXISTING frozen sibling**
  (`guild.learning_checkpoint.v1`). Run-close *emits a final one*; it does not
  redefine its shape — bound by pointer to `continuous-knowledge-and-learning-loop.md` CR-C.
- **The terminal trace event is the FROZEN `guild.trace_event.v1`**
  (`target-architecture.md` line 108). `closeRun` appends one; it does not
  redefine the trace schema.
- **`guild.run.v1` is a NEW self-versioned sibling** (joins the
  `target-architecture.md` §"Sibling-schema registry"). It is the start-manifest
  the learn-knowledge-convergence brief §156 proposes. This doc is its canonical
  field spec. Registered in `contract-map.md §B` row 13 (a locked v2 sibling;
  promoted from §B-post by cleanup-consolidation SC-12).
- **Serialization format is NOT re-decided here.** `run.yaml` is **YAML**
  (a human-reviewed lifecycle manifest — category 3) and `provenance.json` is
  **JSON** (machine-only derived state — category 4); both are exactly the
  boundary-based choices fixed by
  [`communication-format-policy.md`](../../../../.guild/wiki/decisions/communication-format-policy.md)
  §"The policy — format by artifact category", not a per-file preference. Note
  that **`run.yaml.started_at`** (§1 field table) is the field the policy's
  §"OD-4 discriminator" reads as the post-effective-date enforcement boundary
  for runtime receipts — the discriminator names this exact field, so the field
  is load-bearing beyond this contract; it must not be renamed without amending
  the policy page.

---

## 1. `run.yaml` — the `guild.run.v1` start manifest

Written **once at run-start** by `startRun(opts)`, before any real work, at
`.guild/runs/<run-id>/run.yaml`. Generalized from the dogfooded sample at
`.guild/runs/run-learn-knowledge-convergence-20260529-094021/run.yaml`.

`run.yaml` is the **start** record (open state + entry facts). `provenance.json`
is the **close** record (§2). They are siblings, never merged.

### Field table

Legend: **R** required at start · **O** optional · **A** appended/mutated during
the run (start writes the initial value; the wrapper or hooks may append).

| Field | Type | R/O/A | Semantics |
|---|---|---|---|
| `schema_version` | const `"guild.run.v1"` | R | Schema discriminator. Lenient readers ignore unknown sibling fields. |
| `run_id` | string | R | The run identity. Format: `run-<slug>-<UTC-compact>` for initiative-attached/named runs (e.g. `run-learn-knowledge-convergence-20260529-094021`) **or** `run-<uuidv4>` for unnamed one-offs (matches existing `run-2b531201-…`). `startRun` generates it; it is also written to `.guild/runs/current-run-id` (sentinel lives at `.guild/runs/current-run-id` — FU-B3-1: an earlier `.guild/current-run-id` divergence was corrected to match the existing hook/script ecosystem). |
| `command` | string | R | The entrypoint token, e.g. `/guild:learn`, `/guild:status`. One of the §435 command list. |
| `arguments` | map<string, scalar\|string> | R (may be `{}`) | The resolved invocation args (brief_ref, rigor, auto_approve, review, host, initiative, sub-verb, flags). Free-shape map; readers treat unknown keys leniently. |
| `cwd` | string (abs path) | R | Absolute working directory at entry. Load-bearing for workspace vs project detection and for the bash-cwd-drift guard. |
| `target_kind` | enum | R | One of `regular_project \| workspace \| existing_guild_project \| new_or_sparse_project \| mixed_or_uncertain` (the SC-A detection classes). For commands that don't detect (e.g. `/guild:status`), set the best-known value or `existing_guild_project`. |
| `workspace` | object | R | Workspace identity block (below). **Runtime-computed** at run-start by workspace detection and written into this run record — these are **not** `settings.json` config keys (the only workspace config key is `workspace.mode`, per the `WorkspaceBlock` in `read-guild-config.ts`). Always present; `is_workspace:false` for a non-workspace (lone) project. |
| `workspace.is_workspace` | bool | R | Runtime-derived at run-start by walking up for a `.guild/workspace.json` with `is_workspace:true` (`config-cmd.ts:578-599`; written by `run-trace.ts:372`). True at a multi-repo root. |
| `workspace.root` | string (abs path) | R | The workspace (or project) root, resolved at run-start. |
| `workspace.sub_guilds` | string[] | O | Child sub-guild names when `is_workspace`, resolved at run-start. Names only — full records stay in `.guild/workspace.json` (query-not-copy, §SC-D). |
| `project` | string | R | Human label, e.g. `guild (workspace root)` or a lone project name. |
| `host` | object | R | Host-resolution block — see §"Host resolution". |
| `host.requested` | string | R | The requested host (`auto` or an explicit `HostKind`). |
| `host.resolved` | `HostKind` | R | The resolved host from the host-adapter contract. Never assumed `claude`. |
| `host.capabilities_ref` | string | O | Path/pointer to the `guild.host_capabilities.v1` advertisement used to resolve, if one was emitted. |
| `model_tier_policy` | string | R | Human-readable tier-policy descriptor (e.g. `rigor=deep profile (loops/caps/review per §4.3)`). The structured tier map lives in `settings.json models:`; this is a provenance label. |
| `started_at` | string (RFC3339 UTC) | R | Run start timestamp. **Injected by caller** (clock seam — no `Date.now()` hard-coding; see §4 implementation seams). |
| `ignore_policy` | string | R | The ignore-rule descriptor in force (e.g. `workspace .gitignore + .guild share-policy allow-list`). |
| `scan_policy` | string | R | The scan posture for this run (e.g. `n/a (planning/ideation run — no scan)`, `cheap-map`, `deep-graph (cost-confirmed)`). |
| `initiative_attachment` | string \| `null` | R | **Non-negotiable #5 carrier.** The attached initiative slug, or `null` for a one-off. This is a *recorded field only* — see §3: writing it MUST NOT create any `.guild/initiatives/` directory. |
| `phase` | enum \| `null` | A | Current lifecycle phase (`detect \| init \| ideate \| plan \| build \| qa \| ops \| learn \| reflect \| status \| maintenance \| null`). Start writes the entry phase; the wrapper updates as phases transition. |
| `gates` | map<gate-id, gate-record> | A | Per-gate posture + outcome. Each record: `{posture, codex_review, outcome?}`. Appended as gates resolve. |
| `status` | enum | A | `open \| closed \| resumable \| failed`. Start writes `open`; `closeRun` sets `closed` (or `failed`); an intentionally-left-open run stays `resumable`. |
| `run_class` | enum | R | `full \| lightweight`. `lightweight` = the OQ6 status-run variant (§5): writes ONLY `run.yaml` + `provenance.json` to `.guild/runs/`, never wiki/decisions/indexes. `full` = a normal lifecycle run. Default `full`. |
| `phases_log` | phase-entry[] | A | Append-only timeline of phase transitions. Each entry: `{phase, proposed?, detected_from?, deliverable?, gate?, at}` (free-shape, lenient). The replay backbone for SC-F. |

### Canonical example (generalized; matches the dogfooded sample)

```yaml
schema_version: guild.run.v1
run_id: run-<slug>-<UTC-compact>          # or run-<uuidv4> for unnamed one-offs
command: /guild:learn
arguments:
  rigor: deep
  host: auto
  initiative: null                         # one-off — no attachment
cwd: /abs/path/to/cwd
target_kind: workspace
workspace:
  is_workspace: true
  root: /abs/path/to/root
  sub_guilds: [benchmark, plugin, website]
project: guild (workspace root)
host:
  requested: auto
  resolved: claude                         # resolved via host-adapter contract — NOT assumed
  capabilities_ref: .guild/runs/<run-id>/host-capabilities.yaml   # optional
model_tier_policy: rigor=deep profile
started_at: 2026-05-29T08:40:21Z           # caller-injected (clock seam)
ignore_policy: workspace .gitignore + .guild share-policy allow-list
scan_policy: cheap-map
initiative_attachment: null                # null ⇒ ZERO initiative dir created (NN#5)
phase: learn
run_class: full
gates: {}
status: open
phases_log:
  - phase: detect
    proposed: learn
    at: 2026-05-29T08:40:21Z
```

---

## 2. `provenance.json` — the `guild.provenance.v1` close-shape

Written **once at run-close** by `closeRun(run-id)` at
`.guild/runs/<run-id>/provenance.json`. This is the EXISTING frozen sibling
`guild.provenance.v1` (do not mint a new id). The architecture defines it as
"the per-run source record of which tasks/agents/skills/decisions/features a run
touched … the fact source the LearningCheckpoint reads to emit the knowledge-links
edge batch." This section fills in the field-level close-shape so B2 can write it
and B3 can wire trace events into it.

**N1 retention (bound by pointer, `continuous-knowledge-and-learning-loop.md`
CR-A.3):** one-off runs retained **90d**; initiative-attached runs retained
**until archive**. The wrapper records `retention_class` so the GC can act.

### Field table

| Field | Type | R/O | Semantics |
|---|---|---|---|
| `schema_version` | const `"guild.provenance.v1"` | R | Schema discriminator (EXISTING sibling). |
| `run_id` | string | R | Mirrors `run.yaml.run_id`. The join key across `run.yaml`, `logs/v1.4-events.jsonl`, `learning/*`, and `knowledge-links.json`. |
| `command` | string | R | Mirrored from `run.yaml` (so provenance is self-contained for the benchmark's on-disk read — NN#9). |
| `initiative` | string \| `null` | R | Mirrors `run.yaml.initiative_attachment`. `null` for one-off. |
| `retention_class` | enum | R | `one-off-90d \| until-archive` (N1). |
| `started_at` | string (RFC3339 UTC) | R | Mirrored from `run.yaml` (caller-injected). |
| `closed_at` | string (RFC3339 UTC) | R | Close timestamp (caller-injected clock seam). |
| `status` | enum | R | Terminal status: `closed \| failed \| resumable`. |
| `run_class` | enum | R | Mirrored `full \| lightweight`. The benchmark uses this to weight metrics. |
| `terminal_trace_event` | object | R | Reference to the terminal `guild.trace_event.v1` (FROZEN) emitted at close. `{event_id, event_name: "run_closed", at, log_ref: ".guild/runs/<run-id>/logs/v1.4-events.jsonl", line?}`. The trace itself stays in the jsonl; this is a *pointer*, not a copy. |
| `final_learning_checkpoint` | string \| `null` | R | Path to the final `guild.learning_checkpoint.v1` for this run (`.guild/runs/<run-id>/learning/reflection-<run-id>.yaml`) or `null` if the all-`none` no-op produced none. **Lightweight runs: always `null`** (status never harvests). |
| `gates` | map<gate-id, {posture, outcome, codex_review}> | R (may be `{}`) | Gate outcomes snapshot (final state of `run.yaml.gates`). |
| `touched` | object | R | The "what this run touched" fact block — the LearningCheckpoint/knowledge-links source. All sub-arrays default `[]`. |
| `touched.tasks` | string[] | R | Task-ids (lane task-ids) this run executed. |
| `touched.agents` | string[] | R | Specialist/agent names dispatched. |
| `touched.skills` | string[] | R | Skill names invoked. |
| `touched.decisions` | string[] | R | Decision-candidate refs emitted (paths under `.guild/wiki/decisions/` or candidate paths). **Refs only — never decision bodies** (NN#1: no auto-promotion). |
| `touched.features` | string[] | O | Feature/component labels touched (from the label taxonomy). |
| `touched.files` | string[] | O | Changed-file paths (the VCS-confirmed diff set), for blast-radius/coverage. |
| `touched.runs` | string[] | O | Other run-ids this run references (e.g. resumed-from). |
| `coverage` | object | O | **SC-G + SC-F feed.** File-coverage / skipped summary *pointers* (not inline). `{scanned_count, skipped_count, skipped_files_ref: ".guild/runs/<run-id>/learn/skipped-files.json"}`. Present only on learn-class runs. |
| `artifacts` | map | O | Pointers to the run's durable outputs: `{spec?, plan?, team?, review?, verify?, summary?}` (paths). Mirrors the existing `provenance.json` shape (see `run-2b531201`). |
| `self_build` | bool | O | True for Guild self-build runs (existing field; preserved). |
| `benchmark_eligible` | bool | R | Whether this run's on-disk artifacts are complete enough to import (NN#9 / SC-F). The benchmark reads this off disk. |

### Canonical example

```json
{
  "schema_version": "guild.provenance.v1",
  "run_id": "run-<slug>-<UTC-compact>",
  "command": "/guild:learn",
  "initiative": null,
  "retention_class": "one-off-90d",
  "started_at": "2026-05-29T08:40:21Z",
  "closed_at": "2026-05-29T09:12:04Z",
  "status": "closed",
  "run_class": "full",
  "terminal_trace_event": {
    "event_id": "evt-...",
    "event_name": "run_closed",
    "at": "2026-05-29T09:12:04Z",
    "log_ref": ".guild/runs/run-.../logs/v1.4-events.jsonl"
  },
  "final_learning_checkpoint": ".guild/runs/run-.../learning/reflection-run-....yaml",
  "gates": {},
  "touched": {
    "tasks": [], "agents": [], "skills": ["guild:learn-map"],
    "decisions": [], "features": [], "files": [], "runs": []
  },
  "coverage": {
    "scanned_count": 412, "skipped_count": 37,
    "skipped_files_ref": ".guild/runs/run-.../learn/skipped-files.json"
  },
  "artifacts": {},
  "benchmark_eligible": true
}
```

---

## 3. Non-negotiable #5 invariant — `startRun` creates ZERO initiative dir

**Spelled out for B2:** `startRun(opts)` MUST NOT create, touch, or stat-then-mkdir
any path under `.guild/initiatives/`. Initiative attachment is recorded **only**
as the scalar `run.yaml.initiative_attachment` field (and mirrored to
`provenance.json.initiative`).

- If `opts.initiative` is `null`/absent → `initiative_attachment: null`. The run
  is a one-off with **zero initiative side-effect** (NN#5).
- If `opts.initiative` is a slug → record the slug **as a reference**. The
  directory `.guild/initiatives/active/<slug>/` is created/owned by the
  `/guild:initiative new` path **only** — never as a side-effect of `startRun`.
- Implementation guard: `startRun` writes exactly three paths —
  `.guild/runs/<run-id>/run.yaml`, `.guild/runs/current-run-id`, and the empty
  `.guild/runs/<run-id>/logs/` dir. Nothing else. A test MUST assert that after
  `startRun({initiative: "foo"})` no `.guild/initiatives/foo/` exists.

---

## 4. Host-neutral interface — `startRun` / `closeRun` (B2 implements)

TypeScript **interface only, no bodies**. B2 implements
`plugin/scripts/lib/run-lifecycle.ts` against exactly this. Clock + fs are
injected seams (no `Date.now()`, no direct global `fs`) so B2's unit tests are
deterministic.

```typescript
import type { HostKind } from "./host-types";

/** Injected seams so the lib is pure + testable (no Date.now, no global fs). */
export interface RunLifecycleEnv {
  /** Returns the run's clock value as an RFC3339 UTC string. */
  now(): string;
  /** Minimal fs surface the wrapper needs; a real-fs adapter is the default. */
  fs: {
    mkdirp(absPath: string): void;
    writeFile(absPath: string, contents: string): void;
    readFile(absPath: string): string | null;
    exists(absPath: string): boolean;
  };
  /**
   * Resolves the host via the host-adapter contract — NEVER Claude-pinned.
   * Returns the requested + resolved HostKind and an optional capabilities ref.
   * B2 wires this to the existing host-router / write-host-capability path;
   * the wrapper only consumes the result.
   */
  resolveHost(requested: string): {
    requested: string;
    resolved: HostKind;
    capabilities_ref?: string;
  };
}

export type TargetKind =
  | "regular_project"
  | "workspace"
  | "existing_guild_project"
  | "new_or_sparse_project"
  | "mixed_or_uncertain";

export type RunClass = "full" | "lightweight";

export interface StartRunOpts {
  /** Entry command token, e.g. "/guild:learn". */
  command: string;
  /** Resolved invocation arguments (free-shape). */
  arguments: Record<string, string | number | boolean | null>;
  /** Absolute cwd at entry. */
  cwd: string;
  /** Absolute project/workspace root (for the .guild/ write base). */
  root: string;
  /** Detected target shape (SC-A classes). */
  target_kind: TargetKind;
  /** Workspace identity (is_workspace + sub_guild names, by reference). */
  workspace: {
    is_workspace: boolean;
    root: string;
    sub_guilds?: string[];
  };
  /** Human project label. */
  project: string;
  /** Requested host (e.g. "auto" or an explicit HostKind). Resolution is delegated. */
  host_requested: string;
  /** Human-readable tier-policy descriptor. */
  model_tier_policy: string;
  /** Ignore-rule descriptor in force. */
  ignore_policy: string;
  /** Scan posture for this run. */
  scan_policy: string;
  /**
   * Initiative slug to RECORD, or null for a one-off.
   * NN#5: recording a slug MUST NOT create any .guild/initiatives/ dir.
   */
  initiative: string | null;
  /** Entry phase, or null. */
  phase?: string | null;
  /** "full" (default) or "lightweight" (OQ6 status variant — §5). */
  run_class?: RunClass;
}

/** What closeRun records into provenance.json (caller assembles touched-facts). */
export interface CloseRunOpts {
  /** Terminal status. */
  status: "closed" | "failed" | "resumable";
  /** The "what this run touched" fact block (defaults to empty arrays). */
  touched?: Partial<{
    tasks: string[]; agents: string[]; skills: string[];
    decisions: string[]; features: string[]; files: string[]; runs: string[];
  }>;
  /** File-coverage / skipped-summary pointers (learn-class runs). */
  coverage?: {
    scanned_count: number;
    skipped_count: number;
    skipped_files_ref: string;
  };
  /** Path to the final learning checkpoint, or null (lightweight ⇒ always null). */
  final_learning_checkpoint?: string | null;
  /** Durable-artifact pointers (spec/plan/team/review/verify/summary). */
  artifacts?: Record<string, string>;
  /** Final gate outcomes snapshot. */
  gates?: Record<string, { posture: string; outcome: string; codex_review: string }>;
}

export interface RunLifecycle {
  /**
   * Writes run.yaml + current-run-id + logs/ dir, emits the `run_started`
   * trace event (via B3's hook leg), and returns the run-id.
   * MUST NOT create any .guild/initiatives/ directory (NN#5).
   */
  startRun(opts: StartRunOpts): string; // returns run_id

  /**
   * Writes provenance.json (guild.provenance.v1), appends the terminal
   * `run_closed` guild.trace_event.v1, and references the final learning
   * checkpoint. Dual-writes metadata.json for back-compat (§6).
   * Sets run.yaml.status accordingly. NN#7: every close writes provenance.
   */
  closeRun(runId: string, opts: CloseRunOpts): void;
}

/** Factory the entrypoints call; env defaults to a real-fs + system-clock impl. */
export declare function createRunLifecycle(env: RunLifecycleEnv): RunLifecycle;
```

### Host resolution (consume the contract, never re-decide)

`startRun` calls `env.resolveHost(opts.host_requested)`. That function is B2's
thin binding to the EXISTING host-adapter path (`host-router.ts` /
`write-host-capability.ts`); the wrapper records `{requested, resolved,
capabilities_ref}` verbatim into `run.yaml.host`. The wrapper contains **no**
`if (host === "claude")` branch — host-specific behavior lives behind the
adapter, per the host-adapter contract's "one contract, many renderers" rule.

---

## 5. OQ6 lightweight-status-run variant

`/guild:status` ALWAYS records (OQ6 LOCKED = always-record) but as a
`run_class: "lightweight"` run:

- **Writes ONLY** to `.guild/runs/<run-id>/`: `run.yaml` (with
  `run_class: lightweight`) at start, `provenance.json` at close.
- **NEVER writes** to `.guild/wiki/`, `.guild/wiki/decisions/`, `.guild/indexes/`,
  `.guild/reflections/`, or `.guild/initiatives/`. The "status never mutates
  project knowledge" contract holds — only a replay trace is added.
- `final_learning_checkpoint` is **always `null`** for lightweight runs (status
  runs no harvest). B2's `closeRun` MUST short-circuit any learning-checkpoint
  emission when `run.yaml.run_class === "lightweight"`.
- **Rollback switch:** gated behind `settings.json record_status_runs` (default
  `true`). When `false`, `/guild:status` reverts to its historical pure-read
  behavior (no run written). B3 owns the wiring; B2's config reader surfaces the
  key.

This is the reconciliation for the spec's "status-mutation" risk: a historically
read-only command now leaves a trace, but provably touches no durable store.

---

## 6. `metadata.json` dual-write compat shim + reader-migration path

The run-start wrapper is a blast-radius change (every entrypoint). It lands
**additively, never as a hard cutover**.

**Migration ladder (additive at each step):**

1. **Dual-write (this initiative).** `startRun` writes `run.yaml` (the new
   target) AND a `metadata.json` containing the **subset** of legacy fields
   existing readers expect (`run_id`, `initiative`, `spec`, `plan`, `team`,
   `backend`, `started_at`, `self_build` — the shape seen in
   `run-2b531201/provenance.json`-adjacent metadata). `closeRun` keeps
   `metadata.json` in sync at close. No reader breaks.
2. **Reader migration.** Downstream readers (telemetry, benchmark import,
   `/guild:status`, registry builder) migrate to read `run.yaml` /
   `provenance.json` first, falling back to `metadata.json` only when `run.yaml`
   is absent (old runs). Each reader migration is an independent, additive PR.
3. **Shim retirement.** Once all readers prefer `run.yaml` and a deprecation
   window passes, `startRun` stops writing `metadata.json`. Out of scope for
   this initiative — flagged as a followup.

**Reader rule (canonical):** prefer `run.yaml` → fall back to `metadata.json` →
treat absence as a pre-wrapper legacy run. Never assume `metadata.json` is the
source of truth going forward.

---

## 7. What B3 (hook-engineer) consumes from this shape

- `startRun` emits `run_started` (FROZEN `guild.trace_event.v1`) at entrypoint;
  B3 owns the emit + the `capture-telemetry` integration.
- `closeRun` appends the terminal `run_closed` `guild.trace_event.v1`;
  `provenance.json.terminal_trace_event` is the *pointer* B3's writer fills in.
- The skipped-files writer (SC-G) targets
  `.guild/runs/<run-id>/learn/skipped-files.json`; `provenance.json.coverage`
  carries the *pointer* + counts only (the body is B3's writer's output).
- The lightweight-status gate (`record_status_runs`) is B3's wiring; this doc
  fixes the contract (`run_class: lightweight` ⇒ runs/-only, no checkpoint).

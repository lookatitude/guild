---
type: adr
id: ADR-003
slug: host-repo-vs-fresh-fixture
phase: P3
spec: .guild/spec/benchmark-factory.md
plan: .guild/plan/benchmark-factory-p3.md
design: benchmark/plans/p3-runner-architecture.md
status: accepted
owner: architect
decided_at: 2026-04-26
supersedes: []
superseded_by: []
---

# ADR-003 — Where the runner executes `claude`: fresh-fixture clone per run vs. operator's host repo

## Status

**Accepted** — 2026-04-26.

This ADR pins the working-directory model the P3 runner uses to invoke
`claude`. It is decided now so that backend (T2) and security (T6) work
against a fixed surface, and so that later phases (P4 reflections) cannot
silently re-litigate it.

## Context

The P3 runner shells out to the `claude` CLI to execute a Case end-to-end
and captures the resulting `.guild/` tree as the run's artifacts (per
`01-architecture.md §3` and `adr-001-runner-ui-boundary.md §Decision`).
The choice of *where* `claude` is executed determines:

- whether each run starts from a deterministic, identical baseline (R2 +
  the determinism gate in `01-architecture.md §3`);
- whether the operator's working tree can be contaminated or clobbered by
  a run (single-operator NFR — `01-architecture.md §5`);
- whether the captured `.guild/` tree is a *full* tree or a *diff* against
  a baseline (and therefore how complex the capture step is);
- the security blast radius if a Case prompt induces `claude` to write
  outside `.guild/` (security threat-models — forward ref
  `security-review.md`);
- disk + speed cost per run (1h-capped runs are already slow; copy
  overhead must not double them).

`01-architecture.md §1` already names this trade in the runner box without
choosing. The `T1-architect` lane in `.guild/plan/benchmark-factory-p3.md`
explicitly calls out host-repo vs. fresh-fixture as the most ADR-worthy
P3 decision. This document closes it.

## Drivers

Drivers are pulled from the spec (§Audience, §Constraints, §Non-goals,
§Risks) and `01-architecture.md` (R2, R4). Each is named so options score
against it explicitly, not against vibes.

| ID  | Driver                                                                                              | Source                                      | Why it matters                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Determinism — identical baseline state per run.**                                                  | spec §Constraints; `01-architecture.md §3`  | Comparable baseline ↔ candidate runs require identical starting state. Drift in starting state contaminates score deltas (R2).               |
| D2  | **Operator working-tree safety — runs never clobber the host repo.**                                 | spec §Audience (single operator); §NFR      | The operator routinely has WIP in their repo. A run that writes to the operator's `.guild/` (or beyond it) destroys real work.               |
| D3  | **R4 fixture-vs-real conformance — one capture pipeline for both fixture and real `.guild/` trees.**  | `01-architecture.md §R4`                    | The importer schema is single-source-of-truth. Two execution modes that produce different shapes re-introduce the divergence R4 controls.    |
| D4  | **Disk + speed cost per run.**                                                                       | spec §NFR (1h cap); §Audience               | Runs are wall-clock-expensive already. Copy overhead per run must not meaningfully extend runtime or pile up disk.                            |
| D5  | **Simplicity-first — fewest code paths in `runner.ts`.**                                             | spec §Non-goals; `guild:principles`         | Two execution modes = two capture pipelines, two security surfaces, two test paths. Each adds cost backend pays in T2 and qa pays in P3 evals. |
| D6  | **Security blast radius — what can the subprocess damage if it misbehaves?**                         | spec §Constraints (no network); §Risks      | A Case's prompt is operator-supplied but the model's behaviour is non-deterministic. The cwd it sees defines what it can write to.            |

## Options

### Option A — Fresh-fixture clone per run

Per run, the runner creates a working directory by recursively copying a
**fixture-baseline** directory (a git-tracked, version-pinned tree
containing a minimal repo + a clean `.guild/` skeleton) into
`runs/<id>/_workspace/`. The subprocess executes with `cwd: _workspace/`.
After exit, the runner copies `_workspace/.guild/` into
`runs/<id>/artifacts/.guild/`. The `_workspace` directory is then deleted
(operator can opt to retain via a future `--keep-workspace` flag — backend
implementation detail).

The fixture-baseline is checked into the benchmark repo at
`benchmark/fixtures/runner-baseline/` (final path is backend's call in T2;
the *shape* — a directory backend can `fs.cp` from — is locked here).
Updating it is a deliberate, version-controlled act, never a side effect
of a run.

### Option B — Host-repo with pre/post diff

The runner executes `claude` with `cwd:` set to the operator's host repo
(typically `process.cwd()`). Pre-run, it snapshots a hash list of every
file under the host repo's `.guild/`. Post-run, it diffs the new state
against the snapshot and copies the additions/changes into
`runs/<id>/artifacts/.guild/`. The host repo's `.guild/` is left mutated
by the run.

### Option C — Hybrid (fresh-fixture default, `--host-repo` opt-in)

Identical to Option A by default, but exposes a `--host-repo` flag that
swaps in Option B's behaviour for power-user "demo against this very repo"
flows. Both code paths must be maintained.

## Decision

**We choose Option A — fresh-fixture clone per run.**

Concrete commitments locked by this decision:

1. **`runs/<id>/_workspace/` is the only `cwd` the subprocess ever sees.**
   The operator's host repo is never the subprocess's working directory in
   v1. Backend's T2 implementation sets `cwd: workspaceDir` unconditionally.
2. **The fixture-baseline path is committed to the repo** at a single
   location (backend confirms exact path under `benchmark/fixtures/`). The
   runner refuses to start if the path is missing or unreadable. Updating
   the baseline is a deliberate PR, not a side effect of any run.
3. **Capture is `fs.cp({recursive: true, dereference: false})` of the
   post-run `_workspace/.guild/` tree** into
   `runs/<id>/artifacts/.guild/`. No diffing. No watching. The directory
   the subprocess produced is the directory the benchmark stores. Symlink
   handling is forward-referenced to `security-review.md` (T6); the
   architect's default is `dereference: false` so symlinks stay symlinks
   for security to inspect.
4. **`_workspace/` is cleaned up after capture** by default. A future
   `--keep-workspace` flag (backend's call) can suppress cleanup for
   debugging without changing the capture contract.
5. **Path-resolution rules are non-negotiable.** Every captured
   destination is computed via `path.resolve(artifactsRoot, …rel)` and
   verified to be under `artifactsRoot` before write. See
   `p3-runner-architecture.md §Artifact-capture protocol` for the full
   sequence and the security-review forward reference.
6. **No `--host-repo` flag in P3.** Option C is not implemented. If a
   later phase has a justified use case for executing in the host repo
   (e.g., an interactive demo mode), it triggers ADR-004 *Supersedes
   ADR-003's "no host-repo flag"*.

## Option scoring

Each driver scored 1 (poor) to 5 (excellent). Weights reflect the
driver's relative importance per the spec; the math is auditable.

| Driver                                              | Weight | A — fresh-fixture clone | B — host-repo + diff | C — hybrid (A default + opt-in B) | Notes                                                                                                                                                      |
| --------------------------------------------------- | -----: | ----------------------: | -------------------: | --------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1 — Determinism (identical baseline)**           |     5  | **5**                   | **2**                | **5** (when default-A path used)  | A wins decisively. B's baseline drifts because every prior run mutates it. C only wins when the default A path is taken — the opt-in B path inherits B's score. |
| **D2 — Operator working-tree safety**               |     5  | **5**                   | **1**                | **3**                             | A wins decisively. B is unsafe by construction. C exposes the unsafe path behind a flag — still a foot-gun.                                                |
| **D3 — R4 fixture-vs-real conformance**             |     4  | **4**                   | **3**                | **3**                             | A wins. The fresh-fixture tree's post-run shape is a direct exemplar for what `artifact-importer.ts` accepts; one schema, one shape. C splits the contract. |
| **D4 — Disk + speed cost**                          |     2  | **3**                   | **5**                | **3**                             | B wins on D4. Copying a small fixture per run costs O(seconds) on a sub-1h run — not load-bearing against D1/D2. Acceptable trade.                          |
| **D5 — Simplicity (fewest code paths)**             |     3  | **5**                   | **4**                | **2**                             | A wins. C maintains both pipelines + the flag plumbing; strictly worse than A on simplicity. B is a single path but with diffing logic.                     |
| **D6 — Security blast radius**                      |     4  | **5**                   | **2**                | **3**                             | A wins. The fresh `_workspace/` is the entire writable surface; security can lock down with a dedicated tmpfs mount later. B exposes the host's whole tree.  |
| **Weighted total**                                  |    —   | **(5·5)+(5·5)+(4·4)+(2·3)+(3·5)+(4·5) = 87** | **(5·2)+(5·1)+(4·3)+(2·5)+(3·4)+(4·2) = 57** | **(5·5)+(5·3)+(4·3)+(2·3)+(3·2)+(4·3) = 76** | A wins **87 vs. B 57 vs. C 76**. Decisive on D1 + D2 + D6 (the three highest-weight drivers).                                                              |

A wins **87 vs. 57 (B) vs. 76 (C)**. The decisive drivers are
**D1 (determinism), D2 (operator safety), and D6 (security blast radius)**.
B loses on all three by enough to swamp its D4 advantage. C is *strictly*
worse than A on D5 (two code paths) and only ties or loses elsewhere — it
fails the simplicity-first test by adding complexity for a use case that
does not yet exist.

## Consequences

### Positive

- **Every run starts from byte-identical state.** Determinism filtering
  in `compare.ts` (R2 mitigation) is meaningful — the only differences
  between two runs of the same Case are model + plugin + non-determinism.
- **Operator's working tree is sacrosanct.** A run can fail in any way it
  likes; the operator's WIP is untouched. This matters in particular when
  developing the runner itself, since the obvious test is "run the runner
  on this repo" — Option A makes that safe.
- **One capture pipeline.** `fs.cp` of the post-run `_workspace/.guild/`
  tree is a single function. No pre/post diffing. No watcher. The
  artifact importer (P1) and the runner (P3) consume/produce the *same*
  shape because the runner's output is exactly what the importer expects
  to find on disk — R4 closes naturally.
- **Security gets a single, narrow surface to threat-model.** The runner's
  writable area is `runs/<id>/_workspace/` plus `runs/<id>/artifacts/`,
  both under the benchmark's runs directory. Security review (T6)
  threat-models one cwd, one capture step, one cleanup. (Forward ref:
  `security-review.md`.)
- **Future flexibility is preserved.** If a later phase needs host-repo
  execution, ADR-004 supersedes this decision and the affected change is
  one new code path — not a rewrite.

### Negative — accepted trade

- **Per-run copy cost.** Each run pays the cost of one `fs.cp` of the
  fixture-baseline before it can start. For a baseline a few MB in size
  on local disk, this is sub-second; for a future heavier baseline the
  cost grows linearly. Mitigated by: keeping the baseline minimal (it is
  *not* a full Guild monorepo — only what a Case under benchmark needs);
  document the size budget in `benchmark/README.md`.
- **Disk turnover for `_workspace/`.** Cleanup deletes the workspace
  per run; on systems with slow `fs.rm` this adds latency. Mitigated by:
  cleanup is async-best-effort, failure to clean does not fail the run
  (only logged), and the workspace lives under `runs/<id>/_workspace/`
  so it is captured by the same `runs/<id>/` lifecycle the operator
  already manages.
- **Fixture-baseline maintenance cost.** Updating the baseline is a
  deliberate act (PR, code review). This is a *feature*, not a cost — it
  prevents silent baseline drift — but it does mean operators cannot
  change the baseline mid-run. Documented in `02-case-suite.md` (T5
  technical-writer flesh-out).
- **No "demo against this repo" mode in v1.** Operators who want to
  benchmark Guild's own repo cannot point the runner at it directly.
  Workaround: copy the relevant fixture from the host repo into
  `benchmark/fixtures/` and benchmark *that*. If demand for true
  host-repo mode emerges, ADR-004 supersedes.

### Negative — rejected trade-off (kept in for the audit trail)

- We considered **Option C — hybrid**. Rejected because (i) it is
  *strictly* worse than A on D5 (simplicity-first) since both pipelines
  must be maintained, (ii) the use case it serves (host-repo demo) does
  not exist in P3 success criteria, and (iii) any escape hatch flag tends
  to become the path users actually pick — flags compound. If a real use
  case lands, ADR-004 adds the flag with a real driver behind it.

### Forward implications (locked by this ADR)

- **P3 backend lane (T2)** — implements the fresh-fixture flow per
  `p3-runner-architecture.md §Artifact-capture protocol`. No host-repo
  code path.
- **P3 security lane (T6)** — threat-models the workspace + capture
  surface defined here. Likely to add: explicit allowlist of writable
  paths within `_workspace/`, refusal of symlinks pointing outside
  `_workspace/`, refusal of out-of-tree captures even if `path.resolve`
  resolves them. Architect defers those rules to T6.
- **P3 qa lane** — writes the runner-level test that asserts
  (a) `_workspace/` is created from the fixture-baseline before
  subprocess spawn, (b) `_workspace/.guild/` lands intact at
  `artifacts/.guild/`, (c) `_workspace/` is gone after a successful run,
  (d) host repo's `.guild/` is unmodified after any run.
- **Future phases** — the `_workspace` model is reusable for
  reflection-applied runs in P4 (the same fresh-fixture is replayed
  twice — baseline and reflection-applied — yielding comparable runs by
  construction).

## Alternatives considered (and why they lost)

- **Option B — host-repo with pre/post diff.** Lost on D1 + D2 + D6 by
  enough to swamp its D4 win. Weighted total 57 vs. A's 87.
- **Option C — hybrid.** Strictly dominated by A on D5; ties or loses
  elsewhere; serves no extant use case. Weighted total 76 vs. A's 87.
- **Run inside an isolated git-worktree of the host repo.** Worktrees
  share the object store with the host; a `git gc` or worktree-aware
  command in the subprocess could touch the host's git state. Rejected
  for the same D2/D6 reasons as B without B's D4 advantage.
- **Run inside a container (Docker / Podman).** Adds a runtime
  dependency the spec forbids implicitly (single-binary-on-PATH only —
  spec §Constraints). Out of scope. If security-review (T6) wants
  containerisation later, that triggers a dedicated ADR.

## Verification

This ADR is **accepted**, which means downstream lanes treat it as a
fixed contract. `verify-done` for P3 will check:

- ADR-003 file exists at `benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md`.
- Sections present: Context, Drivers, Options, Decision, Consequences,
  Status (this document supplies all six plus an Option scoring table and
  Alternatives considered).
- Status is `accepted` and decision is unambiguous.
- The decision is referenced by `p3-runner-architecture.md §Artifact-capture
  protocol` (it is — see that section's "Mode" sub-section and the
  Cross-references list).

## References

- `.guild/spec/benchmark-factory.md` — drivers D1–D6 trace to §Audience,
  §Constraints, §Non-goals, §Risks.
- `.guild/plan/benchmark-factory-p3.md` — T1-architect lane scope names
  this ADR as the most ADR-worthy P3 candidate.
- `benchmark/plans/01-architecture.md §1` — runner box, deferred-ADR
  marker for cwd choice.
- `benchmark/plans/01-architecture.md §3` — data-flow table; this ADR
  determines what produces `runs/<id>/artifacts/.guild/`.
- `benchmark/plans/01-architecture.md §R2` — determinism risk; D1 above.
- `benchmark/plans/01-architecture.md §R4` — fixture-vs-real risk; D3 above.
- `benchmark/plans/adr-001-runner-ui-boundary.md §Decision` — what the
  server reads is what this ADR's chosen capture writes.
- `benchmark/plans/p3-runner-architecture.md` — the multi-component
  design that operationalises this decision.
- `benchmark/plans/security-review.md` — T6 forward reference; security
  threat-models the workspace + capture surface.
- `guild-plan.md §10.3` — decision-routing rule (this ADR is the
  significant-architectural-decision capture for the runner cwd choice).

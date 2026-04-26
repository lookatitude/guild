---
type: adr
id: ADR-005
slug: learning-loop-orchestrator
phase: P4
spec: .guild/spec/benchmark-factory.md
plan: .guild/plan/benchmark-factory-p4.md
design: benchmark/plans/p4-learning-loop-architecture.md
status: accepted
owner: architect
decided_at: 2026-04-26
supersedes: []
superseded_by: []
---

# ADR-005 — Learning-loop orchestrator: two-stage CLI vs. interactive pause vs. server-side endpoint

## Status

**Accepted** — 2026-04-26.

This ADR pins the orchestrator pattern the P4 learning loop uses to
bridge a baseline run, an operator-applied reflection, and a candidate
run. It is the headline P4 architectural decision; it is decided now
so that backend (T2), security (T6), frontend (T3), and technical-
writer (T5) all work against a fixed pattern. `p4-learning-loop-
architecture.md §3` contains the operational detail; this ADR is the
*decision capture*.

## Context

Spec §Success P4 requires that "for `demo-context-drift-evolve`, the
runner can execute a baseline run, surface the `guild:reflect`
proposal, apply it, and execute a candidate run. The comparison view
shows whether the score moved … A documented runbook explains how to
run this loop manually."

The autoresearch pattern (`karpathy/autoresearch program.md`, §3)
treats this as a keep/discard cycle: run → propose → apply → re-run →
diff → keep-or-discard. Three concrete patterns can deliver the cycle
in v1:

- **Option A — Two-stage CLI.** `loop --start` runs the baseline + emits a manifest naming available proposals + exits 0. Operator commits the chosen change. `loop --continue --apply <id>` runs the candidate + writes the reflection-annotated comparison + exits 0.
- **Option B — Interactive pause.** `loop` runs the baseline, then drops into an interactive prompt asking the operator to apply a proposal, blocks the terminal until the operator hits Enter, then runs the candidate.
- **Option C — Server-side endpoint.** New `POST /api/loops` route + `GET /api/loops/:id` + `POST /api/loops/:id/apply` + `GET /api/loops/:id/comparison`. ComparePage gets new state for "show me proposals + apply button + comparison". UI does the orchestration.

The "documented runbook" wording in the spec is not neutral — it
explicitly frames the loop as something the operator drives manually,
not something the system auto-applies. All three options can satisfy
that wording, but they trade off on operator-time fit, testability,
implementation cost, and entanglement with other lanes.

The choice also locks a shape that propagates to:

- **`benchmark/src/loop.ts`** (new file in T2-backend) — the orchestrator's implementation surface area.
- **CLI subcommand argv** — operator-visible interface, hard to change without breakage.
- **`runs/<baseline-id>/loop-manifest.json`** (new artifact) — file-on-disk seam under Option A; not needed under Option B; replaced by server state under Option C.
- **`server.ts` route table** — unchanged under A, unchanged under B, gains 4 routes under C.
- **ComparePage** — gets the small additions T3-frontend was already planning under all three options; under C it would also need a "proposals + apply" surface, expanding T3's scope.

## Drivers

Drivers are pulled from spec (§Success P4, §Audience, §Non-goals,
§Constraints), `01-architecture.md` (R5 frontend gap), and
`.guild/plan/benchmark-factory-p4.md` (Cost discipline, T3 scope).
Each is named so options score against it explicitly, not against
vibes.

| ID  | Driver                                                                                                  | Source                                                          | Why it matters                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Spec literalism — "documented runbook explains how to run this loop manually."**                       | spec §Success P4                                                | The chosen pattern must be explainable as a runbook (sequential operator commands), not as a UI walkthrough. A pattern that *requires* the UI works against this.    |
| D2  | **Operator-time fit — the apply step takes hours of human work.**                                        | spec §Audience (single operator); autoresearch §3                | The operator reads the proposal, edits source, gets review, commits. That can be a multi-hour session across days. A pattern that blocks a terminal during that wait is unusable. |
| D3  | **Testability via `--dry-run` + mocked spawn.**                                                          | `.guild/plan/benchmark-factory-p4.md` Cost discipline §1; qa T4 | Every code path in the loop must be reachable without burning `claude` tokens. CI never executes `claude`; verification is on mocked filesystems and stubbed spawn.   |
| D4  | **Implementation cost — backend, security, frontend lanes stay narrow.**                                 | `.guild/plan/benchmark-factory-p4.md` lane scopes               | P4 is the final phase; lane creep here cascades. New server routes mean new server tests, new auth surface, new UI flows. Each lane's scope is intentionally thin.    |
| D5  | **Manifest as resumable forensic artifact.**                                                              | `01-architecture.md §3` filesystem-only NFR; spec §Constraints  | A multi-day loop must be resumable across reboots, terminal closures, machine moves. The forensic record (which proposals were available? which was chosen?) must survive. |
| D6  | **Lane entanglement — does the choice expand T3-frontend's scope?**                                      | `.guild/plan/benchmark-factory-p4.md` T3 scope; R5 (frontend gap) | T3-frontend is "narrow lane" by plan design — small additions to ComparePage. A pattern that demands a full proposal-selection UI surface re-opens R5 (frontend gap). |

## Options

### Option A — Two-stage CLI (recommended)

```
$ npm run benchmark -- loop --start --case demo-context-drift-evolve
⇒ runs baseline (calls runner.ts unchanged)
⇒ emits runs/<baseline-id>/loop-manifest.json
⇒ prints proposal-id list + manifest path
⇒ exits 0

$ git checkout -b reflect-experiment-001
$ <operator hand-edits per chosen proposal>
$ git commit -am "apply reflection: <description>"

$ npm run benchmark -- loop --continue \
    --baseline-run-id <baseline-id> \
    --apply <proposal-id>
⇒ validates manifest (state, proposal_id, plugin_ref delta, case_slug, schema_version)
⇒ runs candidate (calls runner.ts unchanged)
⇒ writes comparison.json with reflection_applied annotation
⇒ updates manifest.state = "completed"
⇒ exits 0
```

Plus `loop --status --baseline-run-id <id>` (read-only manifest
inspection) and `--dry-run` on both subcommands (resolves the plan
without spawning).

**Implementation surface.** New `benchmark/src/loop.ts` (one file,
~200–300 lines including manifest validation + dry-run formatting +
proposal enumeration). Edits to `benchmark/src/cli.ts` (one new
subcommand with three actions). Edits to `benchmark/src/types.ts`
(new types pinned by `p4-learning-loop-architecture.md §3.4 + §4.2`).
Edits to `benchmark/src/compare.ts` (one new optional field on
`comparison.json`). No new server routes. No new UI pages.

**Operator-side cost.** Operator must remember to come back and run
`--continue`. Mitigated by: (a) `--status` exposes the manifest in
human-readable form so the operator can quickly check what they were
mid-way through; (b) the manifest is a real file the operator can
re-discover via `ls runs/`; (c) the CLI's `--start` output explicitly
prints the `--continue` invocation the operator should run next.

### Option B — Interactive pause

```
$ npm run benchmark -- loop --case demo-context-drift-evolve
Baseline run complete. Available proposals:
  1. 2026-04-26-context-fanout — Add per-task context bundle to delegate fan-out
  2. 2026-04-26-explicit-gates — Stronger gate-pass acceptance message
Apply proposal? [number / skip]: 1
Apply the proposal manually, then press Enter to continue (or 'abort' to discard): _
[…operator hand-edits source over the next 4 hours, then hits Enter…]
[…candidate run executes…]
Comparison: guild_score +2.3 (kept). Per-component:
  outcome      +1.2  delegation +0.8   gates +0.4
  evidence     -0.1  loop_resp  +0.0   eff   -0.0
```

**Implementation surface.** New `benchmark/src/loop.ts` (similar size
to A, plus `readline` interactive prompts plus signal handling for
the operator hitting Ctrl-C mid-pause). Same edits to `cli.ts`,
`types.ts`, `compare.ts` as A.

**Operator-side cost.** Operator's terminal is blocked for hours.
Cannot run `loop` in tmux + walk away (well, *can*, but the tmux
session must stay healthy for the duration). Cannot script the loop
end-to-end for unattended runs. CI cannot reach the interactive code
path without stubbing `readline` (testability cost on D3).

**Manifest.** Not needed by the runtime path (the loop is one
process); but for D5 (forensic record) we would still need to write a
manifest at baseline-end so a post-mortem can answer "which proposals
were available?". Even Option B benefits from the manifest, weakening
its perceived "no manifest to manage" advantage.

### Option C — Server-side `POST /api/loops`

```
POST /api/loops { case_slug }                                       → 202 + { loop_id, location }
GET  /api/loops/:id                                                 → manifest + proposals
POST /api/loops/:id/apply { proposal_id, plugin_ref_after }         → 202
GET  /api/loops/:id/comparison                                      → comparison.json
```

ComparePage (or a new LoopPage) fetches the manifest, renders an "apply
button" per proposal, accepts the operator's `plugin_ref_after`
(probably from a small text input — they paste the post-apply commit
SHA), then polls for the candidate run + comparison.

**Implementation surface.** Four new server routes + their handlers +
their tests. Plus the same `loop.ts` work A needs, restructured as a
library the route handlers call. Plus a new UI page (or a major
expansion of ComparePage) with a proposal list + apply UI + polling.
T3-frontend's "narrow lane" becomes "implement a multi-step UI flow".

**Operator-side cost.** Best UX of the three when the loop completes
quickly; degrades when the apply step takes hours (the UI session must
stay open or the operator must re-find the loop via the API). Adds
new auth surface — even bound to `127.0.0.1`, a new write endpoint
(`POST /api/loops/:id/apply`) is a write surface that can be hit by
any local process. Spec §Constraints "no auth" is satisfied only as
long as the local-only assumption holds.

## Decision

**We choose Option A — two-stage CLI.**

Concrete commitments locked by this decision:

1. **Two distinct CLI invocations** (`loop --start`, then `loop --continue`) bridged by a file-on-disk manifest at `runs/<baseline-run-id>/loop-manifest.json`. No interactive prompt. No long-lived process.
2. **No new HTTP routes in v1.** The existing `GET /api/comparisons/:baseline/:candidate` endpoint serves the reflection-annotated `comparison.json` (with the new optional `reflection_applied` field) unchanged. `POST /api/loops` is explicitly out of scope.
3. **`loop --status --baseline-run-id <id>`** is the third action — read-only manifest inspection in human-readable form. Useful when the operator returns to a loop they started days ago.
4. **`--dry-run` is the default verification path** for both `--start` and `--continue`, matching `.guild/plan/benchmark-factory-p4.md` Cost discipline §1. CI never burns tokens.
5. **The loop never writes plugin source.** The apply step is operator-driven, version-controlled, and reviewable by humans before the candidate runs. Security T6 threat-models the file-write surface; the architecture pins the boundary.
6. **`benchmark/src/loop.ts` is the only new source file.** No new server routes, no new UI pages, no new specialist. Backend (T2) implements; the existing runner.ts + compare.ts + server.ts are reused unchanged (compare.ts gains one optional emit; runner.ts gains one optional env-var read for `auth_identity_hash`).
7. **If a real demand for a server-side or UI-driven loop emerges in v1.x, ADR-006 supersedes this decision.** Architect's default: do not preempt; ship the simplest pattern that satisfies the spec.

## Option scoring

Each driver scored 1 (poor) to 5 (excellent). Weights reflect each
driver's importance per spec / plan; the math is auditable.

| Driver                                                                            | Weight | A — two-stage CLI | B — interactive pause | C — server-side endpoint | Notes                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | -----: | ----------------: | --------------------: | -----------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1 — Spec literalism (manual runbook)**                                         |     5  | **5**             | **4**                 | **2**                    | A reads as a clean two-line runbook. B requires explaining the interactive pause + signal handling. C requires explaining UI state machine + polling — that is *not* a "manual runbook".                                                                                            |
| **D2 — Operator-time fit (apply takes hours)**                                    |     5  | **5**             | **1**                 | **5**                    | A and C cleanly handle the multi-hour pause (operator returns days later). B blocks a terminal for the whole window — fundamental flaw.                                                                                                                                            |
| **D3 — Testability via `--dry-run` + mocked spawn**                              |     4  | **5**             | **2**                 | **3**                    | A has two clean entry points; mocked spawn covers both, manifest validation tests cover the seam. B requires stubbing `readline` + signal handling for Ctrl-C tests. C requires HTTP-level integration tests on top.                                                               |
| **D4 — Implementation cost (lanes stay narrow)**                                  |     4  | **5**             | **5**                 | **2**                    | A and B both add a single new file (`loop.ts`) plus modest edits. C adds 4 server routes + handlers + tests + a UI page (or a ComparePage expansion). T3-frontend goes from "narrow lane" to "implement a state-machine UI".                                                       |
| **D5 — Manifest as resumable forensic artifact**                                  |     3  | **5**             | **2**                 | **4**                    | A makes the manifest the seam; resume across reboots is the *primary* design property. B can write a manifest forensically but the runtime path doesn't depend on it; manifest can drift from truth. C uses server state but on a single-machine local server, restart loses session. |
| **D6 — Lane entanglement (T3-frontend stays narrow)**                            |     3  | **5**             | **5**                 | **2**                    | A and B leave T3 at small ComparePage additions (badge + plugin-ref delta + keep/discard). C re-opens R5 (frontend gap) — a real proposal-selection UI is a meaningful new surface.                                                                                                |
| **Weighted total**                                                                |    —   | **(5·5)+(5·5)+(5·4)+(5·4)+(5·3)+(5·3) = 122** | **(4·5)+(1·5)+(2·4)+(5·4)+(2·3)+(5·3) = 76** | **(2·5)+(5·5)+(3·4)+(2·4)+(4·3)+(2·3) = 78** | A wins **122 vs B 76 vs C 78**. A wins on five of six drivers, ties C on D2 (the only place A doesn't win solo), and decisively wins D1 + D6.                                          |

A wins **122 vs. 76 (B) vs. 78 (C)**. The decisive drivers are
**D1 (spec literalism)**, **D2 (operator-time fit — B's fatal flaw)**,
and **D6 (lane entanglement — C's fatal flaw)**. C's only meaningful
win is on D2 (where it ties A); on every other dimension that matters
to v1, C trades correctness for UX polish that the spec did not ask
for.

## Consequences

### Positive

- **The runbook is self-explanatory.** Two `npm run benchmark -- loop` commands plus the operator's normal git flow. No new mental model. A new operator who has never seen the loop can read `06-learning-loop.md` and execute it without context transfer.
- **The apply step takes as long as it needs to.** Operator can pause the loop for hours, days, even cross-machine — the manifest is durable. This matches how a reflection actually gets applied in practice (read, think, propose to teammates, commit, push, review, merge, *then* candidate-run).
- **Every code path is reachable via `--dry-run` + mocked spawn.** qa T4's loop-orchestration unit tests can hit baseline-emit, manifest-validation-pass, manifest-validation-reject, candidate-emit, and comparator-annotation without ever spawning `claude`. CI gate is meaningful.
- **No new server routes.** `server.ts` from P2 is unchanged. `adr-001-runner-ui-boundary.md` Option A's "thin read layer over the filesystem" property holds — the loop's outputs flow through the same pipes.
- **T3-frontend stays narrow.** Three small ComparePage additions (badge + plugin-ref delta + keep/discard) is the entire UI scope. R5 (frontend gap) does not re-open.
- **The manifest is the forensic artifact.** A post-mortem six months later can answer "given baseline X, what proposals existed and which one was applied?" by reading one file. Filesystem-only NFR (`01-architecture.md §5`) is satisfied — the loop adds one file per baseline; no DB.
- **Future flexibility is preserved.** If a server-side or UI-driven loop becomes valuable later, ADR-006 supersedes this decision and the affected change is one new file (`server.ts` route handlers calling into `loop.ts`) — not a rewrite. `loop.ts` is structured as a library so route handlers can call its functions directly.

### Negative — accepted trade

- **Operator must remember to come back.** The two-stage CLI requires the operator to issue `--continue` themselves; there is no automatic re-trigger. Mitigated by: (i) `--start` prints the exact `--continue` invocation; (ii) `--status` exposes the manifest state when they return; (iii) baseline runs are durable forensic artifacts — even months later, the operator can re-run `--continue`.
- **Operator must remember to commit before `--continue`.** The plugin_ref-delta validation check (manifest §4.3 rule 3) catches the obvious case (operator forgot to commit), but error messages must be clear enough to point at the fix. Backend's T2 acceptance criterion includes that error message.
- **No real-time progress visualisation in the UI during the loop.** ComparePage shows the result, not the process. Acceptable: the spec's "documented runbook" framing assumes the operator drives manually; if real-time visualisation becomes valuable, ADR-006 adds an SSE channel.
- **Manifest is plain JSON — tamperable by anyone with write access to `runs/`.** Architect's runtime checks (manifest §4.3) catch the obvious cases (state, proposal_id, plugin_ref_before delta). Sophisticated tampering is forward-referenced to security T6 §ii. Single-operator NFR (spec §Audience) bounds the realistic threat model.
- **`--apply` requires the operator to know the proposal_id string.** Mitigated by `--start`'s output (which prints all proposal_ids) and `--status` (which re-prints them). Tab-completion is out of scope.

### Negative — rejected trade-off (kept in for the audit trail)

- **We considered Option B (interactive pause)** and rejected it on D2 alone — the apply step is too long to block a terminal for. The other drivers cement the rejection.
- **We considered Option C (server-side endpoint)** and rejected it on D4 + D6. Building a UI flow for a single-operator loop that takes hours-to-days per cycle does not earn its implementation cost; the spec explicitly framed the loop as a manual runbook.
- **We considered a hybrid (server endpoint thin-wrapping `loop.ts` for future use, but CLI-driven by default)** and rejected it for v1 on simplicity-first grounds. `loop.ts` is library-shaped, so the future hybrid is a small addition (route handlers calling `loop.ts` functions) — not a rewrite. We do not preempt.
- **We considered making the apply step automated** (the loop itself parses the proposal and applies it). Rejected — proposals are operator-followed instructions, the operator's git history is the audit trail, and an auto-applier would foreclose the human review the autoresearch pattern depends on.
- **We considered a "wizard" CLI mode** (`loop --wizard` walks the operator through baseline → apply → candidate with prompts at each step). Rejected — same blocking-terminal problem as Option B, plus extra UI affordances that nobody asked for.

### Forward implications (locked by this ADR)

- **P4 backend lane (T2)** — implements `benchmark/src/loop.ts` per `p4-learning-loop-architecture.md §3 + §4`. CLI subcommand `loop` with three actions (`--start`, `--continue`, `--status`) plus `--dry-run` on the first two. Comparator emit-time check for the manifest co-location. `auth_identity_hash` env-var read in runner.ts.
- **P4 security lane (T6)** — threat-models the new surfaces named in `p4-learning-loop-architecture.md §6` (file-write, manifest tampering, `auth_identity_hash`). Pins the runtime mitigations. May recommend ADR-006 if v1-blocking issues arise (e.g., manifest signing).
- **P4 frontend lane (T3)** — extends ComparePage with three small additions (badge + plugin-ref delta + keep/discard badge). No new pages. `recharts` + React still cover the surface.
- **P4 qa lane (T4)** — pins all five test layers from `.guild/plan/benchmark-factory-p4.md` T4 scope. The mocked-spawn tests are the meaningful CI gate.
- **P4 technical-writer lane (T5)** — flesh-out `06-learning-loop.md` from the P1 stub citing this ADR + the architecture doc. Add "Loop walk-through" subsection to `benchmark/README.md`. Update `00-index.md`.

## Alternatives considered (and why they lost)

- **Option B — interactive pause.** Lost on D2 (operator-time fit) decisively; loses on D3 (testability) for the readline + signal-handling stubs; ties on D4. Total 76 vs A's 122.
- **Option C — server-side endpoint.** Lost on D1 (spec literalism), D4 (implementation cost), and D6 (lane entanglement). Wins D2 (ties A). Total 78 vs A's 122.
- **Hybrid (CLI default + server thin-wrap).** Strictly worse than A on D4 (more code to maintain immediately); the same future flexibility is achievable later because `loop.ts` is library-shaped from day one. Out of v1.
- **Auto-apply mode (`loop` parses proposal + edits source).** Forecloses human review the autoresearch pattern depends on; introduces a "loop edits plugin source" surface that contradicts the architectural boundary in `p4-learning-loop-architecture.md §6.1`. Rejected on first principles.
- **Wizard CLI (`loop --wizard`).** Same blocking-terminal flaw as B plus extra UI scope. Rejected.

## Verification

This ADR is **accepted**, which means downstream lanes treat it as a
fixed contract. `verify-done` for P4 will check:

- ADR-005 file exists at `benchmark/plans/adr-005-learning-loop-orchestrator.md`.
- Sections present: Status, Context, Drivers, Options, Decision, Option scoring, Consequences, Alternatives considered, References.
- Status is `accepted` and the decision is unambiguous (Option A, two-stage CLI).
- The decision is referenced by `p4-learning-loop-architecture.md` (it is — §1 Where this document sits row, §3.1 Decision callout, §3.2 scoring summary, §7 Cross-references).
- Backend's `loop.ts` implementation (T2) matches the §Decision shape: two CLI subcommands, no new server routes, manifest at the pinned path.

## References

- `.guild/spec/benchmark-factory.md §Success P4` — the loop the spec demands and the "documented runbook" framing that drives D1.
- `.guild/plan/benchmark-factory-p4.md` — T1-architect lane scope names this ADR as the most ADR-worthy P4 candidate; T2-backend / T3-frontend / T4-qa / T5-tw / T6-security scopes assume Option A.
- `benchmark/plans/p4-learning-loop-architecture.md` — the multi-component design that operationalises this decision (§3 orchestrator, §4 manifest, §5 keep/discard rule, §6 security surfaces).
- `benchmark/plans/adr-001-runner-ui-boundary.md §Decision` — the server JSON shape this ADR explicitly does not extend (no new routes in v1).
- `benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md §Decision` — the cwd model both runs in the loop reuse unchanged.
- `benchmark/plans/adr-004-runner-process-group-signaling.md §Decision` — the signal-escalation contract both runs in the loop inherit.
- `benchmark/plans/p3-runner-architecture.md §3` — the artifact-capture protocol the loop reads reflections from (§4.4 of the architecture doc).
- `benchmark/plans/01-architecture.md §2` — the `Reflection` node this ADR closes; §6 open question about reflection-applied metadata is closed by `p4-learning-loop-architecture.md §3.4 + §4`.
- `karpathy/autoresearch program.md §3` — the keep/discard pattern this ADR applies to Guild itself.
- `guild-plan.md §10.3` — decision-routing rule. This ADR is the significant-architectural-decision capture for the P4 loop orchestrator.

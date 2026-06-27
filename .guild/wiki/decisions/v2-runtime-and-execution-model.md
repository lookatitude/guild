---
type: decision
owner: architect
confidence: high
importance: high
source_refs:
  - plugin/.guild/wiki/entities/runtime-execution-model.md                            # T2-4 brief — G-1..7, §4 approach, §5 ADR-RE-1..6, §6 cross-topic
  - plugin/.guild/wiki/decisions/v2x-command-surface-dispatch-and-internalization.md  # D5 agent_mode dispatch ladder (bound by pointer, not replaced)
  - plugin/.guild/wiki/decisions/cost-aware-tiering-and-lean-context.md               # tier ladder §1/§2, §task§agent lifecycle §6, guild.handoff.v2 §5 (bound by pointer)
  - .guild/wiki/decisions/guild-boundary-config-and-tracking.md                # CR-D .guild/ ownership map + atomic-write/.lock + closed-key config
  - plugin/.guild/wiki/decisions/config-surface-settings-json.md                      # closed-key settings.json reject regime (new defaults.* land here)
  - .guild/wiki/entities/target-architecture.md                            # frozen guild.handoff_receipt.v1; sibling-schema registry (new siblings land here)
  - .guild/wiki/_archive/v2-design/implementation-plans/contract-map.md                                 # contract registry — the three new schemas register here (lead registers after)
created_at: 2026-05-26
updated_at: 2026-05-26
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [cost-aware-tiering-and-lean-context, v2x-command-surface-dispatch-and-internalization, guild-boundary-config-and-tracking, config-surface-settings-json, continuous-knowledge-and-learning-loop, target-architecture, command-surface]
---

# ADR: v2 runtime & execution model — run-state checkpointing, lane retry, structured heartbeat, the `TeamBackend` seam, host-capability routing, and the multi-wave run manifest

## Status

Accepted (operator-ratified 2026-05-26; v2.0-full-scope program). Binding for implementation. This ADR
resolves the six decisions ADR-RE-1..6 surfaced by the foundational research
brief [`research/runtime-execution-model.md`](../entities/runtime-execution-model.md)
(T2-4 Runtime/Execution, the layer that underpins Track 3 cross-host). It is a
**decision record**: it does not write hook scripts, the launcher, config
schema, command files, or migration prose — each decision is handed to its
owning dev-team agent (`hook-engineer`, `tooling-engineer`, `docs-writer`).

It is **additive to the frozen v2 contract set**. It introduces **three new
self-versioned siblings** (`guild.run_state.v1`, `guild.run_manifest.v1`,
`guild.host_capability.v1` — bodies frozen in §"New contracts" below), **one
additive optional key** on the team/lane schema (`retry:`, under the
lenient-reader rule — no `schema_version` bump), and **new closed-key
`settings.json` additions** under the existing reject regime. No frozen
`guild.*.v1` field set changes.

It **composes with — never replaces** — the D5 `agent_mode` dispatch ladder
([`v2x-command-surface…` §D5](v2x-command-surface-dispatch-and-internalization.md))
and the cost-aware tiering / §task§agent lifecycle / `guild.handoff.v2` envelope
([`cost-aware-tiering-and-lean-context.md`](cost-aware-tiering-and-lean-context.md)).
Both are bound **by pointer** throughout; their canonical bodies are not
re-spelled here. See §"Composition with existing decisions".

> **Track 3 gate (read first).** ADR-RE-5 (host-capability manifest +
> per-task host routing) is **the single decision that unblocks ALL of Track 3
> (cross-host)**. The `RemoteTeamBackend` seam (ADR-RE-4) cannot route work to a
> remote host until that host's capabilities are discoverable; the `null`
> `codex`/`gemini` slots in the cost ADR's `models.tiers` map cannot be filled
> without it; and cross-host security (manifest authentication, tool-permission
> intersection, autonomy propagation) has nothing to attach to. **Until ADR-RE-5
> ships, Track 3 is design-blocked.** Flagged again in §"Cross-topic
> dependencies" and in the handoff.

## Context

Guild's execution model today (brief §2) is a single-session, in-memory
orchestration: the D5 ladder picks a backend at session start; the §task§agent
lifecycle spawns one ephemeral agent per lane; `guild.handoff.v2` envelopes
flow back to a lean lead; hooks (`TaskCreated`/`TaskCompleted`/`TeammateIdle`)
coordinate. This is sufficient for a single `/guild:build` invocation that
completes inside one live session. It is **not** sufficient for the T2-4 target:
**multi-wave programs spanning minutes-to-hours across multiple
`/guild:build` invocations**, on a host that may crash, reboot, or drop the
network mid-run.

The brief quantifies seven gaps (§3). Four are execution-durability gaps that
make long programs fragile, and three are seam gaps that block Track 3:

- **G-1 (CRITICAL):** no resumability — a crashed session loses the run; there
  is no checkpoint of DAG execution state, no replay path. `session.json`
  records pane IDs (`guild.tmux_team.v1`) but **not execution progress**.
- **G-7:** DAG completion state lives only in the orchestrator's context;
  cold-start re-derivation is O(n) over all receipts.
- **G-2:** no orchestrator-level retry/backoff; `TeammateIdle` nudges but a
  failed lane requires manual operator action.
- **G-3:** stall detection is a 10-min `mtime` heuristic on a log agents must
  voluntarily touch — a truly hung agent may never write it.
- **G-5:** the `team` backend is hard-coupled to tmux (`new-session` /
  `split-window` / `send-keys` called directly); no portable abstraction.
- **G-4 / G-6:** no cross-host capability/routing protocol (T3 blocker), and no
  durable multi-wave state machine relating one wave's run to the next.

The brief's recommended posture (§4) is decisive and we adopt it:
**file-system checkpointing, not a durable-execution engine.** Temporal /
Restate / LangGraph give "resume exactly where it left off" by journaling every
step to an external service — but they add an infrastructure dependency that is
**incompatible with Guild's zero-infra plugin model** (brief §4.1; Zylos 2026;
Kai Waehner 2025). We take the *pattern* (checkpoint after each completed step,
reconstruct on restart — DBOS-style, reuse existing filesystem infrastructure)
without the *service*. For cross-host capability negotiation we take the
*shape* of A2A "Agent Cards" / ACNBP capability advertisement (brief §1.2;
arxiv 2506.13590; arxiv 2505.02279) as a **static local manifest**, not a live
negotiation protocol.

All new state lands under the established `.guild/runs/<run-id>/` (and a new
`.guild/programs/<slug>/`) layout so the existing telemetry hooks index it and
the CR-D ownership map governs it (brief §6 Observability).

## Decision

### ADR-RE-1 — Run-state checkpoint schema + resume protocol (resolves G-1, G-7)

**Decision.** Define `run-state.json` (`guild.run_state.v1`, body in §"New
contracts") at `.guild/runs/<run-id>/run-state.json`, the in-flight checkpoint
of DAG execution state. The `TaskCompleted` hook **already fires at the right
moment** (brief §4.1) — it is extended to persist lane state after each lane
terminates; dispatch writes the `in_progress` transition. Writes are
**atomic** (write-temp-then-`rename`) under the existing `.guild/.lock` +
atomic-write discipline established by CR-D
([`guild-boundary-config-and-tracking.md`](../../../../.guild/wiki/decisions/guild-boundary-config-and-tracking.md)) —
this ADR reuses that rule, it does not invent a new one.

**Resume protocol.** `/guild:resume` reads `run-state.json` to reconstruct
orchestrator context **without re-reading every receipt** (kills the G-7 O(n)
cold start): lanes marked `done` are skipped; `pending`/`in_progress`/`failed`
lanes are re-dispatched honoring `depends_on` gating; the lean lead rehydrates
from `run-state` + the last-N `guild.handoff.v2` envelopes (cost ADR §4
compaction discipline — full transcripts stay in `.guild/runs/`, never enter
lead context). `run-state.json` is **derived/rebuildable** (regenerable by
scanning receipts) and is **never the system of record** — it is a speed cache
for resume, mirroring the `initiatives-registry.yaml` "deletable with zero data
loss" posture in CR-D.

**Relationship to `provenance.json`.** `run-state.json` is the *in-flight*
checkpoint (live, per-lane, rebuildable). `guild.provenance.v1`
(CR-D, written **once at run close**) is the *terminal* continuity record. They
compose along the same axis as `guild.handoff.v2` → `guild.handoff_receipt.v1`:
live checkpoint → durable close record. They do not compete; run-state is
deleted/superseded once provenance lands.

### ADR-RE-2 — Lane-level retry policy with bounded backoff (resolves G-2)

**Decision.** Add an **additive optional** `retry:` block to the `team.yaml`
lane schema (lenient-reader rule — additive optional key, **no
`schema_version` bump**, [`contract-map.md §C`](../../../../.guild/wiki/_archive/v2-design/implementation-plans/contract-map.md)):

```jsonc
"retry": {
  "max_attempts": 1,                  // default 1 = NO retry (back-compat, zero behavior change)
  "backoff": "immediate|linear|exponential",  // default "exponential"
  "base_delay_ms": 1000               // base for linear/exponential
}
```

On a lane terminating with `status: failed` (or no receipt + dead heartbeat,
ADR-RE-3), the `TaskCompleted` hook + orchestrator check the retry budget in
`run-state.lanes[id].attempt` **before** marking the lane `dead`. A retry
re-dispatches **the same agent spec + the same context bundle** plus a
`retry_context` annotation (a compact summary of the prior failure) so the
agent does not repeat the same mistake blind.

**Two mandatory compositions (binding):**

1. **Security — always-ask is unconditional across retries.** A retry MUST NOT
   silently re-run a destructive or network operation. The **always-ask hard
   set** (`guild.autonomy_contract.v1`) applies to a retried attempt exactly as
   to the first; operator re-approval is required per attempt (brief §6
   Security). Bound by pointer to the autonomy contract / always-ask hard set;
   enforcement detail is the security ADR's, not re-spelled here.
2. **Tiering — a retry feeds the auto-score.** A prior-attempt escalation is
   already a `+1` **sticky** signal in the cost ADR's complexity rubric
   ([`cost-aware-tiering-and-lean-context.md §2`](cost-aware-tiering-and-lean-context.md)).
   A retried lane therefore may auto-bump tier (e.g. `mid`→`powerful`) on the
   next attempt — this is the intended, already-specified behavior; this ADR
   only wires the retry trigger into it.

### ADR-RE-3 — Structured heartbeat protocol (replaces the mtime heuristic; resolves G-3)

**Decision.** Replace the `mtime` heuristic in `teammate-idle.ts` with a
**structured JSON heartbeat**: the agent writes
`.guild/runs/<run-id>/in-progress/<specialist>.json` —
`{ timestamp, step, pct_complete, last_action }` — on each significant action.
`teammate-idle.ts` parses the heartbeat (`timestamp` vs now) instead of the log
file's `mtime`. Stale threshold becomes configurable
`defaults.heartbeat_timeout_ms` (default `600000` = 10 min, preserving today's
threshold). **Backward-compat:** fall back to `mtime` if the JSON is absent
(no hard cutover).

**Scope boundary (do not conflate with O-3).** This heartbeat governs
**liveness / stall detection only**. It is **not** the deferred "anomalously
short output" *quality-escalation* heuristic, which the cost ADR **explicitly
deferred** (`cost-aware-tiering-and-lean-context.md` O-3 → DEFER, tune-after-build).
Liveness (am I alive?) and escalation (is my output good enough?) are distinct
signals; this ADR resolves the first and leaves the second deferred exactly as
locked. The heartbeat path lives under `.guild/runs/<run-id>/` so
`capture-telemetry.ts` can index it without a new top-level path (brief §6
Observability).

### ADR-RE-4 — `TeamBackend` abstraction (resolves G-5; establishes the T3 seam)

**Decision.** Extract a `TeamBackend` interface in `agent-team-launcher.ts`
that abstracts the lifecycle operations the launcher performs, decoupling the
D5 ladder from tmux specifics:

```
interface TeamBackend {
  spawn(taskSpec): TeammateHandle      // create a worker for a task at its tier
  sendTask(handle, taskSpec): void     // inject work (tmux: send-keys)
  readState(handle): BackendState      // observe progress (tmux: capture-pane)
  dismiss(handle): void                // terminate one worker (§task§agent dismiss)
  teardown(): void                     // tear the team down
}
```

Two implementations ship:
- **`TmuxTeamBackend`** — current behavior, **unchanged**. Carries
  `guild.tmux_team.v1` (`session.json`) as its backend-specific state; preserves
  one-team-per-session, collision-refuse (not clobber), and the
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env gate exactly as the D5 ADR locks.
- **`InProcessTeamBackend`** — dispatch via the Agent tool, **no tmux**, for CI
  / no-tmux hosts (the brief's daemon/in-process model, §4.4).

**Composition (binding).** The D5 ladder **picks the mode** (`team | agent |
subagent | auto`); ADR-RE-4 is the **implementation seam under it** — the ladder
resolves the mode, then instantiates the matching `TeamBackend`. The
§task§agent lifecycle (`cost-aware-tiering-and-lean-context.md §6`) **maps onto
the interface**: spawn→`spawn`, work→`sendTask`/`readState`, dismiss→`dismiss`.
The interface is the **explicit, named seam for `RemoteTeamBackend`** (Track 3
cross-host) — which is why ADR-RE-5 must land alongside it.

### ADR-RE-5 — Host-capability manifest + per-task host routing (resolves G-4) — **TRACK 3 BLOCKER**

**Decision.** Define `guild.host_capability.v1` (body in §"New contracts") — a
**static local manifest**, Guild's lightweight A2A/ACNBP analog (brief §1.2,
§4.5) with **no external service**. Each host writes
`.guild/hosts/<host-id>/capability.json` declaring `host_kind`,
`agent_api_version`, `supported_tiers[]`, the concrete `tier_models` bindings,
`supported_backends[]` (which `TeamBackend` kinds it offers), `tool_permissions[]`,
and `egress` posture. At session start the orchestrator loads the manifests for
all participating hosts and uses them — **in addition to** the D5 ladder and the
cost-ADR tier ladder — as a **third, orthogonal routing axis**: *mode* (D5) ×
*tier* (cost ADR §2) × **host (this ADR)**.

**Why this is the Track 3 gate.** Cross-host execution needs, at minimum:
(a) capability **advertisement/discovery** across `claude|codex|gemini` hosts —
this manifest is it; (b) per-task **host routing** distinct from tier selection —
this manifest feeds it; (c) the **adapter seam that fills the `null`
`codex`/`gemini` slots** in `models.tiers`
([`cost-aware-tiering-and-lean-context.md §1`](cost-aware-tiering-and-lean-context.md))
— `tier_models` is exactly that fill; and (d) the data
`RemoteTeamBackend` (ADR-RE-4) needs to know what a remote host *can do* before
delegating to it. **No part of Track 3 can proceed without ADR-RE-5.** It is the
gate, explicitly.

**Security is a hand-off, not resolved here (binding).** The manifest
introduces a **new trust boundary** (brief §6 Security). The following are
**delegated to the security ADR** and listed as open questions, NOT decided
here: manifest **authentication / signing** (anti-spoof of advertised
capability); **tool-permission intersection** (a cross-host task receives the
intersection of both hosts' permitted tools, never the union); **autonomy +
always-ask propagation** across the host boundary; and **no secrets** in
`capability.json`. This ADR defines the *carrier*; security defines the *trust*.

### ADR-RE-6 — Multi-wave run manifest (resolves G-6)

**Decision.** Introduce `run-manifest.json` (`guild.run_manifest.v1`, body in
§"New contracts") tracking the multi-wave **program** lifecycle: `program_id`,
`plan_slug`, ordered `waves[]` each `{ wave_index, run_id, status, started_at,
completed_at, handoff_summary }`, `current_wave`, and program `status`.
`/guild:resume` and `/guild:status` read it; the orchestrator updates it at wave
**start**, and `TaskCompleted` (at the last lane of a wave) updates it at wave
**completion**.

**Path — deliberate deviation from the brief (decision point).** The brief
(§4.6, ADR-RE-6) proposes `.guild/runs/<slug>/manifest.json`. We instead place
it at **`.guild/programs/<slug>/manifest.json`**. Rationale: CR-D's ownership
map uses a **flat `runs/<run-id>/`** namespace; a slug-scoped dir *inside*
`runs/` would collide ambiguously with run-id dirs (is `<slug>` a run or a
program?). A multi-wave program is conceptually distinct from a single run, so
it gets its own top-level prefix. `waves[].run_id` points back into the existing
flat `runs/<run-id>/` (whose `run-state.json` holds that wave's lane-level
checkpoint). This is a **deviation flagged for the CR-D owner** (see open
questions) — the ownership-map row must be added there, not here.

**Two-level resume (the clean hierarchy).** `run-manifest.json` is *cross-wave*
(program scope); `run-state.json` (ADR-RE-1) is *within-wave* (DAG/lane scope).
Resume is therefore two-level: program-level (which wave is next, from the
manifest) → run-level (which lanes remain in that wave, from that wave's
`run-state.json`). One-off (non-program) runs have **no** manifest
(`program_id: null` in `run-state`); the G4 opt-in invariant and zero-cost
one-off posture (CR-D VC-O5) are untouched — a single run never mints a program
manifest.

## New contracts (for the lead to register — bodies frozen here)

These three siblings are **additive, post-v2** (the [`contract-map.md §B-post`](../../../../.guild/wiki/_archive/v2-design/implementation-plans/contract-map.md)
pattern set by `guild.workspace.v1` / `guild.handoff.v2`). They do **not**
change the locked frozen/sibling counts or the §G predicate.
*(SC-12 context, 2026-05-30: the locked baseline is now 13-frozen + 14-sibling /
§G 27-path — it was 13 + 12 / 25 when this ADR was written; SC-12 promoted
`guild.run.v1` + `guild.harvest_candidates.v1` into the locked set. The three
siblings in this ADR remain post-v2 / additive and outside that locked set.)*
**This ADR is their single canonical body**; skills/scripts bind them by
pointer and never re-spell them. **The team lead registers the contract-map
rows + target-architecture sibling-registry rows + CR-D ownership-map rows
after** — this ADR does not touch those files.

| # | Contract | schema_version | Status | Canonical body | `.guild/` path | Realizing / consuming |
|---|---|---|---|---|---|---|
| 1 | RunState | `guild.run_state.v1` | `[post-v2]` | this ADR §ADR-RE-1 | `.guild/runs/<run-id>/run-state.json` | `TaskCompleted` hook (writer), dispatch (in_progress write), `/guild:resume` + `/guild:status` (readers); rebuildable from receipts |
| 2 | RunManifest | `guild.run_manifest.v1` | `[post-v2]` | this ADR §ADR-RE-6 | `.guild/programs/<slug>/manifest.json` | orchestrator (wave-start write), `TaskCompleted` (wave-complete write), `/guild:resume` + `/guild:status` (readers) |
| 3 | HostCapability | `guild.host_capability.v1` | `[post-v2]` | this ADR §ADR-RE-5 | `.guild/hosts/<host-id>/capability.json` | host bootstrap (writer), orchestrator host-routing (reader); **T3 cluster discovery seam**; security ADR (trust/auth — separate) |

**Canonical bodies:**

```jsonc
// guild.run_state.v1 — in-flight DAG execution checkpoint (ADR-RE-1)
{
  "schema_version": "guild.run_state.v1",   // self-versioned; lenient-reader
  "run_id": "auth-revamp-20260526-1431",    // required; the run this checkpoint tracks
  "plan_slug": "auth-revamp",                // required; plan/spec slug
  "program_id": "auth-revamp",               // optional; null for one-off (links run_manifest)
  "wave_index": 0,                           // required; which wave (0-based)
  "lanes": {                                 // required; DAG lane state keyed by task-id
    "backend-api-001": {
      "status": "pending|in_progress|done|failed|dead|skipped", // required
      "tier": "cheap|mid|powerful",          // resolved tier (cost ADR §2)
      "attempt": 1,                          // current attempt (ADR-RE-2)
      "depends_on": ["architect-001"],       // gating mirror of the plan lane
      "receipt_ref": null,                   // pointer to handoff receipt; null until done
      "updated_at": "2026-05-26T14:42:11Z"
    }
  },
  "last_checkpoint_at": "2026-05-26T14:42:11Z" // required; atomic-write stamp
}
```

```jsonc
// guild.run_manifest.v1 — multi-wave program state machine (ADR-RE-6)
{
  "schema_version": "guild.run_manifest.v1",
  "program_id": "auth-revamp",               // required; stable across waves
  "plan_slug": "auth-revamp",                // required
  "status": "active|paused|completed|failed",// required; program lifecycle
  "current_wave": 1,                          // required; index into waves[]
  "waves": [                                  // required; ordered wave records
    {
      "wave_index": 0,                        // required
      "run_id": "auth-revamp-20260526-1431",  // required; run that executed the wave
      "status": "pending|in_progress|completed|failed", // required
      "started_at": "2026-05-26T14:31:00Z",
      "completed_at": "2026-05-26T14:58:00Z",
      "handoff_summary": "<= ~100 token wave-boundary outcome"  // prose ONLY here, capped
    }
  ],
  "updated_at": "2026-05-26T14:58:00Z"
}
```

```jsonc
// guild.host_capability.v1 — static local host manifest (ADR-RE-5) — T3 discovery seam
{
  "schema_version": "guild.host_capability.v1",
  "host_id": "claude-local-mbp",             // required; stable host identifier
  "host_kind": "claude|codex|gemini",        // required; host family → models.tiers key
  "agent_api_version": "1",                   // required; agent-dispatch API this host speaks
  "supported_tiers": ["cheap","mid","powerful"], // required; tiers this host can serve
  "tier_models": {                            // required; concrete tier→model bindings —
    "cheap": "haiku", "mid": "sonnet", "powerful": "opus"  // FILLS the null codex/gemini slots (cost ADR §1)
  },
  "supported_backends": ["tmux","in-process","remote"], // required; TeamBackend kinds (ADR-RE-4)
  "tool_permissions": ["Read","Edit","Bash","WebFetch"], // required; tools this host can GRANT
  "egress": "always-ask|allow|deny",          // required; network posture (security ADR enforces)
  "advertised_at": "2026-05-26T14:30:00Z"      // required; manifest freshness
  // SECURITY (T5 — security ADR owns, NOT decided here): signature/auth (anti-spoof),
  // cross-host tool-permission INTERSECTION, autonomy/always-ask propagation, no-secrets.
}
```

**Not new contracts (noted for completeness):** the `retry:` block (ADR-RE-2)
is an **additive optional key** on the existing team/lane schema (no
`schema_version` bump); the heartbeat record (ADR-RE-3) is a lightweight
operational artifact under `runs/<run-id>/in-progress/` — see open question OQ-4
on whether it warrants its own `schema_version`.

## New config keys (closed-key `settings.json`, under the existing reject regime)

All land under the closed-key regime of
[`config-surface-settings-json.md`](config-surface-settings-json.md) (unknown
keys rejected at intake; documented in `_help`; scaffolded by
`/guild config init`). **Defaults preserve current behavior** (no retry; today's
10-min stall threshold):

| Key | Allowed values | Default | Meaning |
|---|---|---|---|
| `defaults.retry.max_attempts` | int ≥ 1 | `1` | Default lane retry budget (1 = no retry). ADR-RE-2. |
| `defaults.retry.backoff` | `immediate\|linear\|exponential` | `exponential` | Backoff strategy. ADR-RE-2. |
| `defaults.heartbeat_timeout_ms` | int > 0 | `600000` | Stall threshold for the structured heartbeat. ADR-RE-3. |
| `defaults.resume.enabled` | bool | `true` | Write `run-state.json` checkpoints for resume. ADR-RE-1. |

(Per-lane `retry:` in `team.yaml` overrides `defaults.retry.*`, mirroring the
established `--rigor`/per-lane override precedence of the cost ADR.)

## Composition with existing decisions (bound by pointer — not replaced)

- **D5 `agent_mode` ladder** ([`v2x-command-surface… §D5`](v2x-command-surface-dispatch-and-internalization.md)):
  picks the **mode**; ADR-RE-4 is the implementation seam beneath it; ADR-RE-5
  adds **host** as an orthogonal third routing axis (mode × tier × host).
  one-team-per-session, collision-refuse, and the experimental env gate are
  preserved verbatim by `TmuxTeamBackend`.
- **Cost-aware tiering + §task§agent + `guild.handoff.v2`**
  ([`cost-aware-tiering-and-lean-context.md`](cost-aware-tiering-and-lean-context.md)):
  tier (§2) is recorded per-lane in `run-state`; the §task§agent lifecycle (§6)
  maps onto the `TeamBackend` interface; retry feeds the §2 sticky `+1`
  escalation signal; `run-state`/heartbeat **never enter lean-lead context** —
  the §4 compaction-not-summarization discipline stands; `tier_models` in the
  host manifest fills the §1 `null` host slots. This ADR adds **durability and a
  host axis around** that model; it changes none of its frozen surfaces.
- **CR-D** ([`guild-boundary-config-and-tracking.md`](../../../../.guild/wiki/decisions/guild-boundary-config-and-tracking.md)):
  all new paths sit under `.guild/`; atomic-write + `.lock` rules are **reused,
  not reinvented**; `run-state`/`run-manifest` are derived/rebuildable
  (deletable with zero data loss), `run-state` composing with the terminal
  `guild.provenance.v1` close record.

## Cross-topic dependencies

- **Track 3 (cross-host) — BLOCKED until ADR-RE-5.** ADR-RE-4 (`TeamBackend`)
  is the direct seam for `RemoteTeamBackend`; ADR-RE-5 (capability manifest) is
  the cluster discovery protocol and the fill for the `null` `codex`/`gemini`
  tier slots; ADR-RE-6 (run-manifest) must be reachable across hosts (shared FS
  or a sync protocol — **T3 to define**). The three together are the T3 launch
  surface; ADR-RE-5 is the keystone.
- **Security (T5) — hand-offs, not decided here.** Manifest auth/signing;
  cross-host tool-permission **intersection** (not union); autonomy +
  always-ask propagation across hosts; no-secrets in `capability.json`; and
  retry **must not** auto-re-run destructive/network ops without per-attempt
  operator re-approval (always-ask is unconditional). Listed as open questions
  for the security ADR.
- **Observability (existing).** `run-state.json`, the heartbeat, and the
  run-manifest all write under `.guild/runs/<run-id>/` (or
  `.guild/programs/<slug>/`) so `capture-telemetry.ts` (PostToolUse/SubagentStop)
  indexes them with no new top-level path (brief §6).

## Validation criteria

- **VC-RE-1 (resume):** kill a session mid-wave; `/guild:resume` reconstructs
  context from `run-state.json` + last-N envelopes (not a full receipt re-read),
  skips `done` lanes, re-dispatches `pending`/`failed` honoring `depends_on`;
  the run completes correctly. `run-state.json` deleted mid-run is regenerable
  from receipts with no answer change (rebuildable invariant).
- **VC-RE-2 (retry):** a lane failing under `max_attempts: 2` is re-dispatched
  with `retry_context`; `attempt` increments in `run-state`; a destructive/
  network op on retry still surfaces the always-ask prompt; budget exhaustion
  marks the lane `dead`, not silently looping; `max_attempts: 1` (default) shows
  byte-identical no-retry behavior.
- **VC-RE-3 (heartbeat):** `teammate-idle.ts` flags a stalled agent from a stale
  structured heartbeat at `heartbeat_timeout_ms`; falls back to `mtime` when the
  JSON is absent; the O-3 short-output escalation heuristic remains **not**
  implemented (deferred).
- **VC-RE-4 (TeamBackend):** the same dispatch runs on `TmuxTeamBackend`
  (unchanged tmux behavior — one-team/session, collision-refuse, env gate) and
  `InProcessTeamBackend` (no tmux, CI); D5 selects which; the §task§agent
  spawn→work→dismiss maps onto the interface.
- **VC-RE-5 (host routing — T3 gate):** with ≥2 host manifests present, a task
  routes to a host whose `supported_tiers`/`tool_permissions`/`supported_backends`
  satisfy it; `tier_models` resolves a host's concrete model per tier; a missing
  capability excludes the host. (Security checks tracked separately in the
  security ADR.)
- **VC-RE-6 (multi-wave):** a 2-wave program produces a `run-manifest.json` with
  both wave records; `/guild:status` reports the current wave; `/guild:resume`
  resumes at the next pending wave then the next pending lane (two-level); a
  one-off run produces **no** manifest (`program_id: null`).

## Open items / open questions (for the lead + adjacent ADR owners)

- **OQ-1 (lead — contract registration):** register the three siblings in
  [`contract-map.md §B-post`](../../../../.guild/wiki/_archive/v2-design/implementation-plans/contract-map.md) + the
  `target-architecture.md` sibling-schema registry. (Lead said "I register
  after" — flagged, not done here.)
- **OQ-2 (CR-D owner — ownership map):** add ownership rows for
  `runs/<run-id>/run-state.json`, `runs/<run-id>/in-progress/<specialist>.json`,
  `programs/<slug>/manifest.json`, and `hosts/<host-id>/capability.json`. Note
  the **new top-level `.guild/programs/` and `.guild/hosts/` prefixes** (ADR-RE-6
  path deviation from the brief, and ADR-RE-5). Out of this ADR's scope.
- **OQ-3 (security ADR — T5):** decide manifest authentication/signing,
  cross-host tool-permission intersection, autonomy/always-ask propagation,
  no-secrets enforcement, and the retry always-ask invariant. ADR-RE-5 defines
  the carrier; security defines the trust.
- **OQ-4 (schema scope):** does the heartbeat record warrant its own
  `guild.heartbeat.v1` sibling, or stay an unversioned operational artifact?
  Recommendation: unversioned for now (simplicity-first); promote only if a
  cross-host or telemetry consumer needs a stable contract.
- **OQ-5 (T3 — deferred by design):** how does `run-manifest.json` stay
  consistent across hosts (shared FS vs sync protocol)? Explicitly **T3 scope**,
  not resolved here.

## Consequences

- Long multi-wave programs become **resumable** with zero infrastructure: a
  crash loses at most the in-flight lane, not the run (G-1/G-7 closed) — the
  durable-execution guarantee approximated by filesystem checkpointing, no
  Temporal/Restate dependency (brief §4.1).
- Lane failures get a **bounded, operator-safe retry** (G-2) that respects the
  always-ask hard set and feeds the existing tier-escalation signal — no new
  autonomy surface.
- Stall detection becomes **structured and reliable** (G-3) without touching the
  deferred quality-escalation heuristic.
- The launcher is **decoupled from tmux** (G-5), and the `TeamBackend` interface
  + host-capability manifest together form the **complete, explicit Track 3
  seam** — with ADR-RE-5 named as the gate that unblocks it.
- Three additive siblings + one additive key + four config keys; **no frozen
  contract changes, no count changes, zero-config behavior preserved**
  (`retry.max_attempts: 1`, today's stall threshold, no manifest for one-off
  runs).

---
name: guild-review-broker
description: Host-agnostic broker for cross-family adversarial review — one host drafts an artifact, a DIFFERENT host family critiques it (STRONG independence). Generalizes `guild:codex-review`; engaged by `review: cross` or `--review=cross` at the Guild gates G-spec/G-plan/G-lane/G-diagnose. Selects a reviewer host of a different family than the author, dispatches via its adapter, consumes the FROZEN `review_result.v1`, and loops to a satisfaction verdict (cap → force-pass/extend-cap/rework). v2.0 transport is co-located filesystem (`.guild/runs/<run-id>/review/`); remote HTTP/MCP pull is a post-v2 seam, not built. TRIGGER on "run a cross-family review", "broker an adversarial review", "review=cross", "pick a different host to critique this", "engage the review broker". DO NOT TRIGGER for: local same-host review (`review: local`/`off`), Guild's internal loops L1–L4 (`guild:loop-clarify`/`guild:loop-plan-review`/`guild:loop-implement`), two-stage handoff review (`guild:review`), or skill evolution (`guild:evolve-skill`).
when_to_use: Engaged at any Guild lifecycle gate (G-spec / G-plan / G-lane / G-diagnose) when `review: cross` is set in `.guild/settings.json` or `--review=cross` is passed on `/guild`. The v2.0 lifecycle entry-point for cross-family adversarial review — supersedes `guild:codex-review`, which survives only as the internal Codex adapter the broker dispatches to. Also callable directly for a one-off cross-host critique of any artifact.
type: meta
---

# guild:review-broker

The host-agnostic abstraction over **cross-family adversarial review**: one host
drafts an artifact, a *different* host family critiques it, so the critique is
genuinely independent rather than a model grading its own homework. Implements
the **D-BR cluster** decided in
`docs/knowledge/decisions/v2-review-broker-and-artifact-bus.md` and sits in the
T2 meta tier (`guild-plan.md §5`). Engaged by `review: cross` /
`--review=cross`; runs at the lifecycle gates defined in `guild-plan.md §8`.

This skill is the **generalization of `guild:codex-review`**. Where
`codex-review` hard-wired Claude-author → Codex-reviewer, the broker is
host-agnostic: it resolves *which* host authored the artifact and *which*
different-family host should review it, then dispatches through that host's
adapter. `guild:codex-review` is **deprecated as a lifecycle entry-point** — see
[Relationship to codex-review](#relationship-to-codex-review).

## STRONG independence rule

The reviewer host **MUST** be a different family from the author host. This is
the whole point of the broker — a same-family review is a self-review and the
adversarial contract is broken.

- Author = Claude, `host: auto` → reviewer = Codex (via the Codex adapter).
- Author = Codex → reviewer = Claude.
- Resolution precedence for the reviewer: explicit `host:` pin (when it names a
  *different* family than the author) > `auto` (pick any available different
  family) > built-in default.

**Degradation (never hard-block):** if no different-family reviewer is
available (only one host installed/authenticated), emit to stdout

```
warn: review-broker degraded — no cross-family reviewer available (gate: <gate>)
```

and return `status: "skipped"`. The lifecycle continues without cross-family
review, exactly as `codex-review` skips when Codex is absent. Graceful
degradation is mandated by the ADR; do not stall the run.

## Transport — v2.0 is filesystem-canonical, co-located

Both hosts run on the **same filesystem**. The broker speaks to the reviewer
host purely through files under `.guild/runs/<run-id>/review/<gate>/`:

1. The broker writes a **review packet** — the artifact + adversarial
   instructions + (rounds 2+) the prior round trail.
2. The reviewer host reads the packet from the shared filesystem.
3. The reviewer host writes back a **`review_result.v1`** JSON envelope.
4. The broker reads the result, checks the verdict, and loops or terminates.

The cross-host **dispatch + packet/result FS contract** is owned by the
transport layer **RE-4 / RE-5** (built this wave by impl-runtime-backend) —
**bind by pointer, do not re-implement here.** This skill owns the *broker
logic* (author/reviewer resolution, the round loop, sentinel detection,
escalation); RE-4/RE-5 own *how the packet reaches the reviewer and the result
comes back*. Where a remote transport is NOT CONFIGURED (cross_host disabled /
no endpoint set), the broker falls back to the Codex-adapter dispatch path (the
`codex:codex-rescue` mechanism from `guild:codex-review`) for Claude-authored
artifacts.

### Post-v2 seam (bind by pointer, DO NOT build)

A **remote** reviewer host — one on another machine pulling the packet over
HTTP/MCP — is a documented future seam. The packet/result schema is
transport-agnostic by design precisely so a remote-pull adapter can slot in
later behind the same broker. **Do not build the remote path in v2.0.** Bind the
seam by pointer to the ADR; ship only the co-located FS path.

## `review_result.v1` — FROZEN, bind by pointer

The structured envelope every reviewer host returns. It is a **frozen schema**:
consume it by pointer, **never redefine it inline** in this skill or in any
prompt. Canonical definition lives with the ADR + the RE-4/RE-5 transport
contract. The broker reads (consume-only) at minimum:

- `schema_version` — must be `review_result.v1`.
- `verdict` — `satisfied` | `issues`.
- `findings[]` — structured issues when `verdict: issues`.
- `round` — the round this result answers.
- `reviewer_host` — the host family that produced the critique (used to assert
  it differs from the author).

If a result fails to parse as `review_result.v1`, treat the round as
non-terminated, log it to the trail, and continue (or escalate at cap).

## Gates

Same load-bearing lifecycle artifacts as `codex-review`, now host-generalized
(`guild-plan.md §8`):

| Gate | When invoked | Artifact reviewed |
|---|---|---|
| **G-spec** | After `guild:brainstorm` writes `.guild/spec/<slug>.md`, before `guild:team-compose` | The spec |
| **G-plan** | After `guild:plan` writes `.guild/plan/<slug>.md`, before the user-approval gate | The plan |
| **G-lane** | After each lane's handoff receipt is written, before the next lane dispatches | The lane receipt |
| **G-diagnose** | After `guild:fix`/`guild:diagnose` writes a diagnosis/fix plan, before the approval gate | The diagnosis |

## Input shape

```typescript
type ReviewBrokerInput = {
  gate: "G-spec" | "G-plan" | "G-diagnose" | `G-lane:${string}`;
  artifact_path: string;          // repo-relative path to the artifact under review
  run_id: string;                 // .guild/runs/<run-id>/ scope
  author_host: "claude" | "codex" | string;   // host family that produced the artifact
  reviewer_host?: "claude" | "codex" | "auto"; // explicit pin; default "auto"
  cap?: number;                   // round cap; resolves via codex_cap (default 5, max 10)
  prior_trail_path?: string;      // prior round trail (rounds 2+)
};
```

## Output shape

```typescript
type ReviewBrokerOutput = {
  status: "satisfied" | "skipped" | "cap_hit" | "force_passed" | "extended" | "rework";
  gate: string;
  author_host: string;
  reviewer_host: string;          // asserted != author_host family on success
  rounds: number;                 // total rounds executed
  trail_path: string;             // .guild/runs/<run-id>/review/<gate>/trail.md
  satisfied_at_round?: number;    // present when status="satisfied"
};
```

## Round loop

For each round (1-indexed, up to the resolved cap):

1. Resolve author/reviewer hosts; assert reviewer family ≠ author family (else
   degrade → `skipped`).
2. Write the review packet to `.guild/runs/<run-id>/review/<gate>/packet-<round>.md`
   (artifact + adversarial instructions + prior trail on rounds 2+).
3. Dispatch to the reviewer host via its adapter (RE-4/RE-5 transport; Codex
   adapter = the `codex:codex-rescue` path that works today).
4. Read back `review_result.v1` from
   `.guild/runs/<run-id>/review/<gate>/result-<round>.json`.
5. Append the round to the trail `.guild/runs/<run-id>/review/<gate>/trail.md`.
6. Emit a round telemetry event (see [Telemetry](#telemetry)).
7. `verdict: satisfied` → return `status: "satisfied"`. Round == cap → escalate.
   Otherwise continue, passing the trail forward.

## Termination

A round terminates the loop when the reviewer returns
`review_result.v1.verdict == "satisfied"`. For host adapters that emit a textual
critique rather than a parsed envelope (today's Codex adapter), the satisfaction
sentinel is `## SATISFIED` on its own trimmed line, exactly once, with no
unresolved findings after it — identical to the `codex-review` contract. A
malformed termination (sentinel inline / repeated / followed by open findings)
is treated as non-terminated; continue or escalate at cap.

## Cap handling

On round `cap + 1`, halt and surface three options via `AskUserQuestion`
(`header: "Review broker"`, `multiSelect: false`) — verbatim labels matching the
loop/codex-review convention:

```
[force-pass]   Proceed without cross-family sign-off. The trail remains for audit.
[extend-cap N] Continue for N more rounds (N = 1–5).
[rework]       Return to the prior lifecycle step and revise the artifact.
```

Wait for an explicit choice before proceeding. Cap resolves: `--codex-cap=N` >
`.guild/settings.json` `codex_cap` > default `5`; max `10` (clamped with a
warning).

## Relationship to codex-review

`guild:codex-review` is **DEPRECATED as a lifecycle entry-point** per the D-BR
cluster — but **NOT deleted**. It survives as the **internal Codex adapter** the
broker dispatches to whenever the resolved reviewer host is Codex. The split:

- **`guild:review-broker`** — host-agnostic front door. New lifecycle wiring and
  `--review=cross` route here. Owns author/reviewer resolution + the round loop.
- **`guild:codex-review`** — the Codex-specific adapter beneath the broker (the
  `codex:codex-rescue` dispatch, the `## SATISFIED` sentinel, the
  `codex-review-round` telemetry). Still callable directly for a Codex-only
  one-off, but no longer the canonical lifecycle gate.

Do not edit `skills/meta/codex-review/` from this skill's scope; its description
retune (deprecation marker + de-trigger on `--review=cross`) is a followup for a
separate skill-author pass.

## Telemetry

Emit one round event per round to the run's JSONL audit log via the shared
`scripts/emit-loop-event.ts` helper. The broker round-event type is owned by the
benchmark JSONL schema (bind by pointer; do not append rows directly). Until a
dedicated `review_broker_round` type is registered, reuse the Codex adapter's
`codex_review_round` event when the reviewer host is Codex, tagging the
`reviewer_host`. (Registering the broker event type is a cross-cutting followup
for eval-engineer.)

## Anti-patterns

- **Same-family review.** Author and reviewer share a host family — that is a
  self-review, not adversarial. Always assert reviewer family ≠ author family.
- **Redefining `review_result.v1` inline.** It is frozen; bind by pointer.
  Inventing fields forks the schema and breaks downstream consumers.
- **Building the remote HTTP/MCP transport.** Out of scope for v2.0 — co-located
  FS only. The remote seam is bound by pointer, not built.
- **Hard-blocking when no cross-family reviewer exists.** Degrade to `skipped`
  with a warn; never stall the lifecycle on a missing host.
- **Re-implementing the RE-4/RE-5 transport here.** The broker owns logic, not
  the packet/result wire contract.
- **Routing new lifecycle gates at `guild:codex-review`.** That is the deprecated
  entry-point; target `guild:review-broker`.

## Handoff receipt

Per `guild-plan.md §8.2`: `gate`, `author_host`, `reviewer_host`, `rounds`,
`status`, `trail_path`, and `evidence:` (packet/result paths + JSONL round
events). On `status: "rework"` the broker returns control to the prior lifecycle
step; on `satisfied` / `force_passed` it clears the gate.

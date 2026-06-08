---
name: guild-review-broker
description: Host-agnostic broker for cross-family adversarial review — one host drafts an artifact, a DIFFERENT host family critiques it (STRONG independence). Generalizes `guild:codex-review`; engaged by `review: cross` / `--review=cross` at the seven Guild gates G-init/G-spec/G-plan/G-lane/G-quality/G-operations/G-diagnose. Picks a different-family reviewer, dispatches via its adapter, consumes the FROZEN `review_result.v1`, and applies the SHA-256 checksum-bound 5-condition gate-pass before looping to a satisfaction verdict (cap → force-pass/extend-cap/rework). v2.0 transport is co-located filesystem; remote pull is a post-v2 seam. TRIGGER on "run a cross-family review", "broker an adversarial review", "review=cross", "pick a different host to critique this", "engage the review broker". DO NOT TRIGGER for: local same-host review (`review: local`/`off`), Guild's internal loops L1–L4 (`guild:loop-*`), two-stage handoff review (`guild:review`), or skill evolution (`guild:evolve-skill`).
when_to_use: Engaged at any Guild lifecycle gate (G-init / G-spec / G-plan / G-lane / G-quality / G-operations / G-diagnose) when `review: cross` is set in `.guild/settings.json` or `--review=cross` is passed on `/guild`. The v2.0 lifecycle entry-point for cross-family adversarial review — supersedes `guild:codex-review`, which survives only as the internal Codex adapter the broker dispatches to. Also callable directly for a one-off cross-host critique of any artifact.
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

**Degradation (never hard-block, never a clean skip when review is required):**
if no different-family reviewer is available (only one host
installed/authenticated, a same-family pin, or a non-selectable provider), emit
to stdout

```
warn: review-broker degraded — no cross-family reviewer (gate: <gate>); using WEAK same-host review
```

and **degrade to the WEAK same-host path** — a fresh-context same-host subagent
reviews, stamped `independence: weak` and recorded (`docs/v2/09-adversarial-review.md
§Sentinel hardening`: "cross-host unavailable → degrade to weak-independence
same-host; never hard-block"). The weak review **still runs and is still gated**
by the 5-condition rule — it relaxes *who* reviews, never *whether* the gate
holds.

**`skipped` is NOT a degradation route.** A `status: "skipped"` is resolved
**only** when `review_required == false` (policy did not require review:
`review=local`/`off`, risk below threshold, config off). When review **is**
required (`review=cross` / `risk≥high` / config) but cross-host is
unavailable/refused, the broker takes the weak same-host path above — it does
**not** resolve `skipped`. Letting a required review clean-skip the gate is a
gate-bypass; the only honest no-reviewer outcome under a required review is a
recorded weak review (or, for `authorHost: unknown`, a recorded `degraded-local`
that the gate evaluates — never a clean pass).

## Provider resolution — input from the resolved settings (Unit 4)

Before resolving author/reviewer hosts, the broker takes a **provider-resolver
input** computed from the run's resolved settings (the `review` projection of
`.guild/settings.json`, produced by the settings resolver — `scripts/lib/settings-resolver.ts`).
The detection + ranking is a pure library, `scripts/lib/provider-detect.ts`,
which picks **WHO** reviews — never **HOW** they communicate. The packet/result/
trail contract below is unchanged by provider choice (see
[Communication contract is provider-invariant](#communication-contract-is-provider-invariant)).

The resolver exposes three calls the broker consumes (consume-only — do not
re-implement detection in a prompt):

- `detectProviders({ cwd, host })` → `{ authorHost, providers[] }`. Tiered
  detection (OD-6): a provider is `detected` when its CLI is on PATH and a light
  version/auth probe passes, **or** a `.guild/hosts/**/capability.json` declares
  it. A provider is `selectable` for cross-review **only when a real adapter
  exists**: `codex-plugin` (the `codex:codex-rescue` reference adapter) and
  `codex-cli` (when authed) are selectable; `gemini-cli` / `pi` / `antigravity`
  are **detect-only** (NOT selectable) until their adapters ship.
- `recommendProvider(detection, review)` → `{ recommended, reason }`. **AC-7:**
  a **Claude author with `codex-plugin` available recommends `codex-plugin`** for
  `provider=auto`. `provider=auto` **re-detects every run (OD-5)** and never
  persists — persisting a provider is an explicit `config set
  review.adversarial.provider …` action only; run provenance (U6) records what
  was recommended + selected.
- `selectReviewer(detection, review)` → `{ provider, status, reason }`. This is
  the **AC-8 false-signoff guard** (see next section). The different-family
  ranker prefers a **native plugin adapter over an authed CLI** (`codex-plugin` >
  `codex-cli`).

### AC-8 — same-family review NEVER satisfies `review=cross`

`selectReviewer` enforces the STRONG-independence rule as a **hard predicate**, so
a same-family reviewer can never be returned as a sign-off:

`selectReviewer` returns **WHO** may review (a provider-detect output); the
**broker** then decides what to *do* with that under the gate's
`review_required`. The two are separate — the table is the WHO; the mapping
below is the broker action.

| Situation | `selectReviewer.status` | `provider` |
|---|---|---|
| Selectable different-family reviewer available | `selected` | that provider |
| `authorHost === "unknown"` (cannot prove independence) | `degraded-local` | `null` (**never selected**) |
| Operator pins a **same-family** provider | `degraded-local` | `null` (cross-host refused — self-review) |
| Operator pins a **non-selectable** provider (no adapter yet) | `degraded-local` | `null` (no silent substitution) |
| Only same-family / detect-only reviewers present | `degraded-local` | `null` (weak/local, labelled, NOT adversarial) |
| No cross-host reviewer + `review=cross` | `degraded-local` | `null` (weak same-host floor — reason given) |
| `review=local` / `review=off` (review_required==false) | `skipped` | `null` |

There is **no code path** that returns `selected` with a same-family provider,
and **no code path** that returns `selected` when `authorHost === "unknown"`.

**Broker action by status (closes the gate-bypass — SK-9):**

- `selected` → run the cross-host **STRONG** review.
- `degraded-local` → run the **WEAK same-host** review (fresh-context subagent,
  `independence: weak`, recorded) **and gate it by the 5-condition rule**. This
  is the required-review-but-no-cross-host floor: review still happens, it is
  never up-converted to a clean pass.
- `skipped` → **only** when `review_required == false`; this is the lone clean
  gate-skip. A required review (`review=cross` / `risk≥high` / config) **never**
  resolves `skipped` — it takes the `degraded-local` weak path above. (This is
  why every required-review row in the table now maps to `degraded-local`, not
  `skipped`: a required review with no cross-host reviewer must degrade to a
  recorded weak review, never vanish into a clean skip.)

The broker MUST treat a `degraded-local` result as a real weak review subject to
the gate, and a `skipped` result as a no-review clean pass that is **legal only
under `review_required == false`** — never up-convert either to a STRONG pass.

> **Security note.** The `authorHost: "unknown"` guard closes the hole where
> `reviewer.family !== "unknown"` would be vacuously true for any provider,
> yielding a `selected` verdict with zero actual independence guarantee. An unknown
> author family is a real, safe value — it forces degradation rather than guessing.

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

## Communication contract is provider-invariant (AC-9)

Provider choice picks **WHO** reviews; it does **NOT** fork **HOW** reviewers
communicate. **Every** provider — `codex-plugin`, `codex-cli`, and any
future different-family adapter — uses the **same** broker contract, UNCHANGED by
Unit 4:

- packet: `.guild/runs/<run-id>/review/<gate>/packet-<round>.md`
- result: `.guild/runs/<run-id>/review/<gate>/result-<round>.json` (`review_result.v1`)
- trail: `.guild/runs/<run-id>/review/<gate>/trail.md`

`scripts/lib/provider-detect.ts` deliberately returns only `{ provider, status,
reason }` — it carries **no** transport/comms field. The broker remains the
single owner of the packet/result/trail contract; host chat, `SendMessage`, or
pane text stay optional decoration. Do not add a per-provider communication path.

## `review_result.v1` — FROZEN, bind by pointer

The structured envelope every reviewer host returns. It is a **frozen schema**:
consume it by pointer, **never redefine it inline** in this skill or in any
prompt. Canonical definition lives with the ADR + the RE-4/RE-5 transport
contract. The broker reads (consume-only) at minimum:

- `schema_version` — must be `review_result.v1`.
- `verdict` — `satisfied` | `issues`.
- `findings[]` — structured issues when `verdict: issues`. The
  `blocking_findings` subset (severity-blocking) drives gate-pass condition 5.
- `round` — the round this result answers.
- `reviewer_host` — the host family that produced the critique (used to assert
  it differs from the author).
- `packet_id` — the id of the packet this result answers (gate-pass condition 2;
  must equal the packet the broker issued for the round).
- `artifact_sha256_reviewed` — the SHA-256 of the artifact bytes the reviewer
  actually read (gate-pass condition 3; computed after secret-scrubbing — see
  [Gate-pass rule](#gate-pass-rule-checksum-bound-sk-9)).

If a result fails to parse as `review_result.v1`, treat the round as
non-terminated, log it to the trail, and continue (or escalate at cap).

## Gates

The broker addresses a **fixed seven-gate set** (`docs/v2/09-adversarial-review.md
§The gates`), each firing inside its own producer skill at that phase's review
boundary (`docs/v2/09 §Gate ownership`). Only **G-lane** is command-visible
(it fires per-lane during `build`); the other six are **skill-internal**. The
`G-spec / G-plan / G-lane` names are compatibility aliases for the v2 phase-named
gates (`G-ideation` / `G-planning` / `G-development`).

| Gate | Producer skill + wiring | Artifact reviewed | Reviewer focus |
|---|---|---|---|
| **G-init** | `guild:init` — after the init artifact / wiki diff, before phase close | init artifact / wiki diff | missing context, unsupported facts, stale knowledge |
| **G-spec** | `guild:brainstorm` — after `.guild/spec/<slug>.md`, before `guild:team-compose` | The spec | missing criteria, ambiguity, weak assumptions, untestable claims |
| **G-plan** | `guild:plan` — after `.guild/plan/<slug>.md`, before the user-approval gate | The plan | lane-contract defects, unhandled dependencies, vague done criteria |
| **G-lane** | `guild:execute-plan` — after each lane receipt, before the next lane dispatches (**command-visible**) | The lane receipt | missing evidence, incomplete scope, unresolved risk |
| **G-quality** | `guild:quality` — after the quality report, before phase close | quality report | E2E gaps, release risk, weak coverage |
| **G-operations** | `guild:operations` — after the ops record / runbook, before phase close | ops record / runbook | blast radius, rollback, observability gaps |
| **G-diagnose** | `guild:fix` / `guild:diagnose` — after the diagnosis/fix plan, before the approval gate | The diagnosis | weak self-fix plan, unsafe edit proposal, missing evidence |

Each producer skill wires the broker at its own review boundary by invoking
`guild-review-broker` with the matching `gate=` value — exactly the pattern the
spec/plan/lane/diagnose producers use. **The review *shape* differs per gate** —
some gates pair the cross-host broker with an in-phase advisory panel, others are
broker-only:

| Gate | Cross-host broker gate | In-phase advisory panel (security + architect) |
|---|---|---|
| G-init | ✅ broker-only | ❌ none — Init's review is the broker gate over the init record / wiki diff |
| G-spec / G-plan / G-lane / G-diagnose | ✅ | ❌ (lifecycle producer gates) |
| G-quality | ✅ | ✅ `qa-test-strategy` producer vs `[security, architect]` |
| G-operations | ✅ | ✅ `[security, architect]` challengers |

Where an advisory panel exists (Quality, Operations) it is **distinct from** this
gate-level cross-host broker review (`docs/v2/09 §Loop control`) — the two
compose, they do not replace one another. **G-init has no advisory panel** — its
review is the cross-host broker gate alone. This table is the broker-side gate
registry; each gate's actual review shape is as shown.

## Gate-pass rule (checksum-bound, SK-9)

The broker writes the AC-9 `review/<gate>/` packet/result/trail set (above);
**this section adds the integrity binding** that makes the gate-pass
checksum-bound (`docs/v2/09 §Gate-pass rule`). The result binds to the reviewed
artifact by **SHA-256**, computed over the artifact bytes **after
secret-scrubbing** (the same SHA-256 that serves as the cross-host cache key on
the artifact bus).

A gate **passes iff all five conditions hold**:

1. the `review_result` **parses** as `review_result.v1`, AND
2. `result.packet_id` **matches** the packet id the broker issued for the round, AND
3. `result.artifact_sha256_reviewed == sha256(current artifact bytes)` (recomputed
   now, post-scrub), AND
4. (`result.verdict == "satisfied"`) **OR** a human **`force_pass`**, AND
5. **no blocking findings remain** (`blocking_findings` empty).

`status: "skipped"` passes the gate **only** when `review_required == false` (the
policy did not require review). It is **never** an up-conversion of a
`degraded-local` / cap-hit / unsatisfied result — those are exactly what they say
(`docs/v2/09 §AC-8`).

**Artifact-changed-mid-review → reject + restart.** If the artifact's bytes
changed during the round, condition 3 fails (the recomputed SHA-256 will not
match `artifact_sha256_reviewed`): **reject the result and restart the round**
against the new bytes — do not pass a verdict that critiqued stale content. This
is the same checksum-mismatch rule the sentinel-hardening table enforces.

**The weak path obeys the identical rule.** A same-host fresh-context review
(other host unavailable) is stamped `independence: weak` and recorded, but it
passes the gate **only** by satisfying the same five conditions — weak
independence relaxes *who* may review, never *whether* the checksum/blocker gate
holds.

Compute the SHA-256 with `sha256(<scrubbed-artifact-bytes>)`; the broker records
both `artifact_sha256_reviewed` (from the result) and the recomputed current
hash in the trail so a reviewer-vs-current mismatch is auditable.

## Input shape

```typescript
type ReviewBrokerInput = {
  gate: "G-init" | "G-spec" | "G-plan" | "G-quality" | "G-operations" | "G-diagnose" | `G-lane:${string}`;
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
  reviewer_host: string;          // == author_host family ONLY on the weak path (independence:"weak")
  independence: "strong" | "weak";// "weak" whenever the same-host degraded path ran (recorded)
  rounds: number;                 // total rounds executed
  trail_path: string;             // .guild/runs/<run-id>/review/<gate>/trail.md
  satisfied_at_round?: number;    // present when status="satisfied"
};
```

`status: "skipped"` is emitted **only** when `review_required == false` (step 0
of the round loop). A required review that found no cross-host reviewer returns a
normal gate outcome (`satisfied` / `rework` / `cap_hit` / …) with
`independence: "weak"` — it is never reported as `skipped`.

## Codex-skip sentinel gate-read (FU-E)

As the canonical lifecycle front door, the broker runs the **same FU-E
codex-skip sentinel check** at the START of every gate that
`guild:codex-review` documents — read it by pointer, do not re-specify it here:
see `skills/meta/codex-review/SKILL.md` § "Codex-skip sentinel gate-read". Read
`.guild/codex-skip-streak.json` (schema `guild.codex_skip_streak.v1`); when
`blocked: true`, honor `codex_skip_enforcement` from `.guild/settings.json`
(**default `warn` = surface loudly and proceed; opt-in `block` = hard-refuse**).
The sentinel is hook-maintained (`hooks/maybe-reflect.ts`); trust the `blocked`
flag rather than recomputing the streak, and let a `codex_review: RAN`
reflection (`guild:reflect`) clear it. This applies regardless of the resolved
reviewer host — the discipline is about *whether* adversarial review is
overdue, not which family runs it.

## Round loop

For each round (1-indexed, up to the resolved cap):

0. **Resolve `review_required`** from policy (`review=cross` / `risk≥high` /
   config). If `review_required == false`, resolve `status: "skipped"` and pass
   the gate **without** entering the round loop — this is the **only** clean
   skip. Everything below runs only when review IS required.
1. **Read the codex-skip sentinel** (see § above); under `block` enforcement
   with `blocked: true`, halt before resolving hosts.
2. Resolve author/reviewer hosts; assert reviewer family ≠ author family. **No
   cross-host reviewer (else-branch) → degrade to the WEAK same-host path**
   (`independence: weak`, recorded) — **never `skipped`** (review is required;
   `skipped` is reserved for step 0). The weak review runs the same packet/result
   round and is gated identically below.
3. Write the review packet to `.guild/runs/<run-id>/review/<gate>/packet-<round>.md`
   (artifact + adversarial instructions + prior trail on rounds 2+), recording
   the `packet_id` and the artifact's post-scrub SHA-256.
4. Dispatch to the reviewer host via its adapter (RE-4/RE-5 transport; Codex
   adapter = the `codex:codex-rescue` path that works today).
5. Read back `review_result.v1` from
   `.guild/runs/<run-id>/review/<gate>/result-<round>.json`.
6. Append the round to the trail `.guild/runs/<run-id>/review/<gate>/trail.md`
   (including `artifact_sha256_reviewed` and the recomputed current hash).
7. Emit a round telemetry event (see [Telemetry](#telemetry)).
8. Apply the **5-condition checksum-bound gate-pass** (see
   [Gate-pass rule](#gate-pass-rule-checksum-bound-sk-9)): all five hold →
   return `status: "satisfied"`. **Checksum mismatch (condition 3 fails) → reject
   the result and restart the round** against the current bytes (does not consume
   the cap). Blockers / unsatisfied with checksum OK → rework; round == cap →
   escalate. Otherwise continue, passing the trail forward.

## Termination

A round terminates the loop when `review_result.v1.verdict == "satisfied"`
**and the full 5-condition checksum-bound gate-pass holds** (see
[Gate-pass rule](#gate-pass-rule-checksum-bound-sk-9)) — a `satisfied` verdict
whose `artifact_sha256_reviewed` no longer matches the current artifact is
**not** a termination (it critiqued stale bytes): reject and restart the round.
**Textual-adapter outputs are normalized into `review_result.v1` BEFORE
gate-pass — a bare textual critique never passes the gate.** Some host adapters
(today's Codex adapter) emit a textual critique terminated by the `## SATISFIED`
sentinel (on its own trimmed line, exactly once, with no unresolved findings
after it) rather than a structured envelope directly. That text is **not** fed to
the gate-pass as-is: the adapter **wraps it into a `review_result.v1` envelope**
— `verdict` from the sentinel, `blocking_findings` from any open findings,
`packet_id` from the issued packet, and `artifact_sha256_reviewed` from the bytes
it read — and the **5-condition gate-pass evaluates that envelope** (`:255`).
Conditions 1+2 (parses + `packet_id` match) and 3 (sha256) therefore always apply;
a textual critique that cannot be normalized into a valid envelope (no parseable
sentinel, missing `packet_id`/sha256) is an **envelope-missing malformed
termination → one schema-repair retry** (`§Sentinel hardening`: "envelope missing
→ mark malformed; one schema-repair retry"), and if it still fails it is
non-terminated — continue or escalate at cap. There is **no path** where a bare
textual critique alone clears the checksum-bound gate. Other malformed
terminations (sentinel inline / repeated / followed by open findings) are likewise
non-terminated.

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
warning). `--codex-cap=N` is a **supported power-user flag** (parsed by the
`--codex-cap=` case in `scripts/read-guild-config.ts`'s arg-parse switch) — **kept in
v2** alongside `--loops` / `--loop-cap`, not deleted or folded into `--rigor`.

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
- **Hard-blocking when no cross-family reviewer exists.** Degrade to the **WEAK
  same-host** review (`independence: weak`, recorded) with a warn; never stall the
  lifecycle on a missing host.
- **Clean-skipping a *required* review.** `status: "skipped"` is legal **only**
  when `review_required == false`. A required review with no cross-host reviewer
  must degrade to the weak same-host path and be gated — never resolve `skipped`
  (that is a silent gate-bypass).
- **Re-implementing the RE-4/RE-5 transport here.** The broker owns logic, not
  the packet/result wire contract.
- **Routing new lifecycle gates at `guild:codex-review`.** That is the deprecated
  entry-point; target `guild:review-broker`.

## Handoff receipt

Per `guild-plan.md §8.2`: `gate`, `author_host`, `reviewer_host`, `rounds`,
`status`, `trail_path`, and `evidence:` (packet/result paths + JSONL round
events). On `status: "rework"` the broker returns control to the prior lifecycle
step; on `satisfied` / `force_passed` it clears the gate.

---
name: guild-codex-review
description: "DEPRECATED lifecycle entry-point (D-BR-A) — now the internal Codex adapter invoked BY `guild:review-broker`, never called directly from Guild lifecycle gates. Route `--review=cross` / `review: cross` to `guild:review-broker`. Survives as the Codex-specific adapter: dispatches `codex:codex-rescue` against an artifact, loops until `## SATISFIED` on its own line (cap=5 rounds, `--codex-cap=N`), writes trail to `.guild/runs/<run-id>/codex-review/<gate>.md`, skips gracefully when `codex --version` fails. TRIGGER on: \"invoke the Codex adapter\", \"codex adapter for gate\", \"dispatch codex adversarial review\", \"run Codex critique on artifact\", \"one-off Codex gate review\". DO NOT TRIGGER for: `--review=cross` lifecycle entry (→ `guild:review-broker`), Guild internal loops L1–L4, skill evolution."
when_to_use: "Invoked by `guild:review-broker` as the internal Codex adapter whenever the resolved reviewer host is Codex. Still callable directly for a one-off Codex-only artifact critique. DEPRECATED as a direct lifecycle gate — route `--review=cross` and all G-spec/G-plan/G-lane/G-diagnose triggers to `guild:review-broker`. Emits `codex_review_round` events to the v1.4 JSONL audit log."
type: meta
---

# guild:codex-review

> **⚠️ DEPRECATED as a lifecycle entry-point (ADR D-BR-A,
> the v2-review-broker-and-artifact-bus ADR).**
> This skill is now the **internal Codex adapter** invoked by
> `guild:review-broker`. All lifecycle gate wiring (`--review=cross`,
> `review: cross`) routes through the broker. Direct invocation is
> permitted only for one-off Codex-only artifact critiques that bypass the
> broker intentionally. New lifecycle gates **must not** call this skill
> directly.

The Codex-specific adapter beneath `guild:review-broker`. Dispatches
`codex:codex-rescue`, manages the `## SATISFIED` sentinel loop, and writes
the per-gate trail. The broker owns author/reviewer resolution; this
adapter owns the Codex dispatch mechanism.

Previously shipped as a first-class user-facing lifecycle gate. That role
is superseded by `guild:review-broker` (host-agnostic, bidirectional,
structured `review_result.v1`). This skill's sentinel + trail + telemetry
mechanics are unchanged — the broker relies on them.

## Gates

Three gates, one per load-bearing lifecycle artifact:

| Gate | When invoked | Artifact reviewed |
|---|---|---|
| **G-spec** | After `guild:brainstorm` writes `.guild/spec/<slug>.md`, before `guild:team-compose` | The spec file |
| **G-plan** | After `guild:plan` writes `.guild/plan/<slug>.md`, before the user-approval gate | The plan file |
| **G-lane** | After each lane's handoff receipt is written, before the next lane dispatches | The lane's handoff receipt |
| **G-diagnose** | After `guild:diagnose` writes a diagnosis/fix plan, before the user approval gate | The diagnosis report |

## Input shape

```typescript
type CodexReviewInput = {
  gate: "G-spec" | "G-plan" | "G-diagnose" | `G-lane:${string}`;  // which gate is firing
  artifact_path: string;                              // repo-relative path to the artifact
  run_id: string;                                     // .guild/runs/<run-id>/ scope
  codex_cap?: number;                                 // rounds cap; default 5, max 10
  prior_trail_path?: string;                          // path to prior round trail (rounds 2+)
};
```

## Availability check

> **Alignment with provider detection (Unit 4).** This adapter is the **Codex
> ADAPTER beneath the broker**, not the lifecycle front door — `--review=cross`
> routes through `guild:review-broker`, which calls `scripts/lib/provider-detect.ts`
> to decide WHO reviews. That detection models two Codex providers: `codex-plugin`
> (this `codex:codex-rescue` adapter — `selectable` when detected) and `codex-cli`
> (`selectable` when authed). The availability check below is the **same probe
> contract** provider-detect uses for the codex family: `codex --version` exits 0
> **AND** usable auth exists (stored `~/.codex/auth.json` **or** `OPENAI_API_KEY`).
> Per OD-6, a detected-but-unauthed codex is **not selectable** for a cross gate;
> per AC-8, the broker also refuses Codex entirely when the **author** host is
> Codex (same-family self-review). When invoked directly as a one-off, this
> adapter still applies its own availability check below and skips gracefully.

Before dispatching Codex, check availability:

```bash
codex --version >/dev/null 2>&1
```

If this fails (non-zero exit, or command not found), emit to stdout:

```
warn: codex-review skipped — codex plugin not installed (gate: <gate>)
```

And return immediately with `status: "skipped"`. Do **not** hard-block the lifecycle — the run continues without adversarial review.

If `codex --version` exits 0, also verify that usable auth exists before dispatching:

```bash
# (a) codex login path — present and non-empty
AUTH_FILE="${CODEX_HOME:-$HOME/.codex}/auth.json"
[ -s "$AUTH_FILE" ] && AUTH_OK=1

# (b) legacy env-var path
[ -n "$OPENAI_API_KEY" ] && AUTH_OK=1
```

**Codex is available iff `codex --version` exits 0 AND `AUTH_OK` is set** (either path). If `codex --version` succeeds but neither auth path is satisfied, emit:

```
warn: codex-review skipped — codex not authenticated (gate: <gate>)
```

And return `status: "skipped"`.

> **Known false-negative (codex ≥0.x stored-creds auth).** Gating availability on
> `OPENAI_API_KEY` alone produces a false negative for any codex version that
> authenticates via `codex login` (stored in `~/.codex/auth.json`). The
> `OPENAI_API_KEY` env var is never set in that flow, so a check that only
> tests the env var will incorrectly report codex as unavailable even when it
> is fully authenticated and reachable. Always check BOTH paths (a) and (b)
> above. Do not reintroduce an env-var-only gate.

## Codex-skip sentinel gate-read (FU-E enforcement)

This is the **consuming half** of the FU-E codex-skip discipline contract. The Stop hook `hooks/maybe-reflect.ts` *writes* the sentinel; this skill *reads* it. The full loop: skip → sentinel + non-zero Stop exit (hook) → gate surfaces/refuses (here) → install codex or a `codex_review: RAN` reflection clears it (`guild:reflect`).

**At the START of every gate** (before the availability check, before round 1), read the sentinel:

```bash
cat .guild/codex-skip-streak.json 2>/dev/null   # absent ⇒ no block, proceed normally
```

Parse it as `schema_version: guild.codex_skip_streak.v1` with fields `streak`, `threshold`, `blocked`, `updated_at`, `reason`, `clear_by`. **Only act when `blocked == true`** (a malformed/unparseable file ⇒ treat as no block and proceed; never let a bad sentinel stall the lifecycle). The hook maintains this file; **trust it** — do not recompute the streak here (that is the hook's job, walking the reflection trail newest-first).

Enforcement is **CONFIGURABLE via `.guild/settings.json` key `codex_skip_enforcement`** and **DEFAULTS TO NON-BLOCKING**:

| `codex_skip_enforcement` | Behavior when `blocked: true` |
|---|---|
| `warn` (default, or key absent) | **SURFACE loudly, then PROCEED.** Print the block to stdout and continue the gate normally. |
| `block` (opt-in) | **HARD-REFUSE.** Halt this gate and do not run the review/proceed until the sentinel clears or the operator explicitly overrides. |

### `warn` (default — do NOT brick the operator's workflow)

Print, then continue into the normal availability check / round loop:

```
warn: codex-skip discipline OVERDUE (gate: <gate>)
  codex adversarial review skipped on <streak> consecutive self-build reflections
  (threshold <threshold>; sentinel updated <updated_at>).
  Codex review is overdue. To resolve:
    1. install + authenticate codex (`codex --version` exits 0, then run `codex login` OR set OPENAI_API_KEY) so this gate runs, OR
    2. record a reflection with `codex_review: RAN` (a real review breaks the streak), OR
    3. delete .guild/codex-skip-streak.json after an explicit operator override, OR
    4. set `codex_skip_enforcement: block` in .guild/settings.json to hard-enforce.
  Proceeding (enforcement: warn).
```

### `block` (opt-in hard-refuse)

Halt the gate and surface via `AskUserQuestion` (`header: "Codex-skip discipline"`, `multiSelect: false`) — do not silently proceed:

```
Codex adversarial review is BLOCKED at gate <gate> (codex_skip_enforcement: block).
<streak> consecutive self-build reflections skipped codex review (threshold <threshold>).
  [run-codex]  Install/authenticate codex now and run the gate review (clears via a RAN reflection).
  [override]   Operator override — delete .guild/codex-skip-streak.json and proceed this once.
  [rework]     Return to the prior lifecycle step.
```

Wait for an explicit choice. Do **not** proceed to the round loop while `blocked: true` under `block` enforcement unless the operator chooses `override`.

### How the sentinel clears

The sentinel is **hook-maintained**, so the durable clear is to make the hook recompute `streak < threshold`:

- **A `codex_review: RAN` reflection** (written by `guild:reflect` after codex actually runs) breaks the consecutive-skip streak; the next Stop-hook evaluation computes `streak = 0` and does not re-arm. This is the canonical clear.
- When this gate **successfully runs** codex review (`status: "satisfied"` / `force_passed`) and `blocked: true`, delete the stale sentinel as the gate-side acknowledgement that review just happened: `rm -f .guild/codex-skip-streak.json`. The authoritative reset still comes from the next `RAN` reflection — this deletion just stops the *current* gate from re-warning after a real review this turn.
- An explicit operator `override` (or manual `rm`) clears it unconditionally.

Coordinate with the hook semantics: the hook counts **consecutive** skips and re-derives the streak every Stop, so the gate-read trusts the hook-maintained `blocked` flag rather than maintaining its own counter.

> **NOTE (config schema):** `codex_skip_enforcement` (`warn` | `block`, default `warn`) is **registered** in the config schema as a security-sensitive closed key — `config-schema.ts` declares it in `SECURITY_ENUM_OVERRIDES` (`enum_values: ["warn", "block"]`, `most_restrictive: "block"`), `config-defaults.ts` defaults it to `warn`, and `guild:config` validates the closed enum (an out-of-range value is rejected). See the Guild docs site → `https://guildstack.dev/docs/configuration`.

## Dispatch

For each round (1-indexed, up to `codex_cap`):

1. Read the artifact at `artifact_path`.
2. Build the adversarial prompt (see `## Adversarial prompt`).
3. Dispatch: `Agent({ subagent_type: "codex:codex-rescue", prompt: <adversarial_prompt> })`.
4. Parse Codex's response for the sentinel `## SATISFIED` on its own line (exact match, trimmed).
5. Append round result to trail file `.guild/runs/<run-id>/codex-review/<gate>.md`.
6. Emit `codex_review_round` event to `.guild/runs/<run-id>/logs/v1.4-events.jsonl` (see `## Telemetry`).
7. If sentinel found → return `status: "satisfied"`.
8. **If the round produced NO VERDICT → return `status: "no_verdict"` immediately.**
   A verdict-less round is NOT an unsatisfied round, and must never be counted
   as one. Recognize it when the dispatch returned no reviewable response at
   all — the provider refused the request, the subagent errored, or the
   response contains neither the sentinel nor any findings. Do not consume
   another round against a systematic refusal, and never let it fall through to
   step 10.
   **Provider refusals are the common case and have a known cause:** a prompt
   that enumerates attack constructions while reviewing security or scoping
   code can trip a provider's cyber-risk classifier (observed twice while
   reviewing an MCP data-scoping guard: *"This content was flagged for possible
   cybersecurity risk"*). The remedy is to re-issue the SAME review request
   described in product terms — what the component does and must not do —
   rather than as an attack catalogue. Record the refusal in the trail, then
   retry once with the reframed prompt; that retry counts as the same round.
9. If round equals `codex_cap` → escalate (see `## Cap handling`).
10. Otherwise → continue to next round, passing prior trail as context.

**Terminal-disposition rule.** `satisfied` is the ONLY status that means Codex
reviewed the artifact and raised nothing. Every other terminal status means the
gate did not clear, and they are not interchangeable: `cap_hit` asserts that
substantive review happened and kept finding issues; `skipped` asserts Codex was
unavailable; `no_verdict` asserts the review never produced a judgement. Never
report a verdict-less round as `cap_hit` or `satisfied` — a caller reading
`cap_hit` will believe the artifact was scrutinized N times.

## Adversarial prompt

Round 1:
```
You are an adversarial reviewer. Read the artifact below and find any:
- Missing success criteria or acceptance tests
- Scope ambiguities that would allow a specialist to misinterpret the work
- Security or autonomy-policy gaps
- Untestable or unmeasurable claims
- Dependencies or risks not surfaced

If you find no issues, emit ONLY the line: ## SATISFIED

If you find issues, list them as bullets. Do NOT emit ## SATISFIED unless
you are genuinely satisfied that the artifact is production-ready.

Artifact (<gate>):
<artifact content>
```

Rounds 2+: prepend the prior Q&A trail before the artifact so Codex sees what was already raised and addressed.

## Termination sentinel

`## SATISFIED` must appear **exactly once** as a standalone trimmed line in Codex's response. The sentinel is not valid if:
- It appears inline (e.g., `See ## SATISFIED above`)
- It appears more than once
- The response also contains unresolved questions after the sentinel

If the sentinel is malformed (multiple occurrences or unresolved questions follow it), treat the round as non-terminated and continue.

## Cap handling

On round `codex_cap + 1`, halt the loop and surface to the user with three options:

```
Codex adversarial review reached round cap (<codex_cap>) for gate <gate>.
Codex has not emitted ## SATISFIED. Options:
  [force-pass]   Proceed without Codex sign-off. The trail remains for audit.
  [extend-cap N] Continue for N more rounds (N = 1–5).
  [rework]       Return to the prior lifecycle step and revise the artifact.
```

Wait for an explicit user choice before proceeding.

## Output shape

```typescript
type CodexReviewOutput = {
  status: "satisfied" | "skipped" | "cap_hit" | "no_verdict" | "force_passed" | "extended" | "rework";
  gate: string;
  rounds: number;               // total rounds executed
  trail_path: string;           // .guild/runs/<run-id>/codex-review/<gate>.md
  satisfied_at_round?: number;  // present when status="satisfied"
};
```

## Trail format

`.guild/runs/<run-id>/codex-review/<gate>.md`:

```markdown
---
gate: G-spec
run_id: <run-id>
artifact: .guild/spec/<slug>.md
started_at: <ISO-8601>
final_status: satisfied
rounds: 2
---

## Round 1

**Codex response:**
<response text>

---

## Round 2

**Codex response:**
## SATISFIED
```

**`final_status:` is the trail-completeness field** read by the SC11 validator
`scripts/verify-codex-review-trail.ts` (per
`.guild/wiki/standards/codex-adversarial-review.md`). It is the **persisted**
disposition and is **distinct** from the in-memory `status` of the output shape.
The validator accepts **exactly two clean terminal values** — write one of these:

| in-memory `status` | trail `final_status:` |
|---|---|
| `satisfied` / `force_passed` *with a real sign-off* | `satisfied` |
| `skipped` (codex unavailable / unauthenticated) | `skipped-codex-unavailable` |

A gate that ends **without** a clean disposition (`cap_hit`, or a `force_passed`
operator override **without** Codex sign-off) writes that terminal value verbatim
and **deliberately fails** the completeness validator — it is an audit exception
that must be resolved, not papered over. When the availability check skips the
gate (returns `status: "skipped"`), still write the trail with
`final_status: skipped-codex-unavailable` so the per-gate trail exists and
validates.

## Telemetry

Emit one `codex_review_round` event per round to
`.guild/runs/<run-id>/logs/v1.4-events.jsonl` via the shared helper:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/emit-loop-event.ts \
  --event codex_review_round \
  --gate <G-spec|G-plan|G-diagnose|G-lane:lane-id> \
  --round <N> \
  --terminated <satisfied|false> \
  [--run-id <run-id>] [--cwd <repo-root>]
```

Use `--terminated satisfied` on the final round when `## SATISFIED` is emitted
or the user force-passes. Use `--terminated false` for non-final rounds. The
`codex_review_round` event type is defined in the v1.4-jsonl-schema spec (§12) in the separate guild-benchmark repo; do not append these rows directly.

## Config resolution

`codex_cap` resolves in this order (first wins):

1. `--codex-cap=N` CLI flag — **a supported power-user flag**, parsed by the `--codex-cap=` case in `scripts/read-guild-config.ts`'s arg-parse switch; clamped to `[1,10]`. It is **kept in v2** (not deleted/folded into `--rigor`), alongside its siblings `--loops` / `--loop-cap`.
2. `.guild/settings.json` key `codex_cap`
3. Default: `5`

Maximum: `10`. Values above 10 are clamped to 10 with a warning.

---
name: guild-codex-review
description: Adversarial Codex review gate for Guild lifecycle artifacts. Dispatches `codex:codex-rescue` at Guild gates — G-spec (after brainstorm, before team-compose), G-plan (after plan, before user-approval), G-lane (after each lane receipt), and G-diagnose (diagnosis/fix plans). Loops until Codex emits `## SATISFIED` on its own line, cap = 5 rounds per gate (configurable via `--codex-cap=N`). Writes trail to `.guild/runs/<run-id>/codex-review/<gate>.md`. Gracefully skips if `codex --version` fails. TRIGGER on `--review=cross` flag in `/guild`, "run codex adversarial review", "adversarial review the spec/plan/lane", "codex gate G-spec/G-plan/G-lane", "codex review diagnose plan". DO NOT TRIGGER for: internal Guild adversarial loops (L1–L4, owned by `guild:loop-clarify`, `guild:loop-plan-review`, `guild:loop-implement`), direct skill evolution (`guild:evolve-skill`), or any run where `--review=cross` flag is absent.
when_to_use: Invoked by brainstorm/plan/execute-plan skills when `codex_review: true` is set in the run context. Called at the three lifecycle gates. Also callable directly for one-off artifact review. Emits `codex_review_round` events to the v1.4 JSONL audit log.
type: meta
---

# guild:codex-review

Brings Codex adversarial review into the `/guild` lifecycle as a first-class user-facing feature. Available to any plugin user who has `codex-plugin` installed. Graceful degradation when Codex is unavailable.

Implements the discipline previously documented as dev-only in `CLAUDE.md`. Now ships as a meta-skill so any `/guild` run can opt in via `--review=cross`.

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

Before dispatching Codex, check availability:

```bash
codex --version >/dev/null 2>&1
```

If this fails (non-zero exit, or command not found), emit to stdout:

```
warn: codex-review skipped — codex plugin not installed (gate: <gate>)
```

And return immediately with `status: "skipped"`. Do **not** hard-block the lifecycle — the run continues without adversarial review.

## Dispatch

For each round (1-indexed, up to `codex_cap`):

1. Read the artifact at `artifact_path`.
2. Build the adversarial prompt (see `## Adversarial prompt`).
3. Dispatch: `Agent({ subagent_type: "codex:codex-rescue", prompt: <adversarial_prompt> })`.
4. Parse Codex's response for the sentinel `## SATISFIED` on its own line (exact match, trimmed).
5. Append round result to trail file `.guild/runs/<run-id>/codex-review/<gate>.md`.
6. Emit `codex_review_round` event to `.guild/runs/<run-id>/logs/v1.4-events.jsonl` (see `## Telemetry`).
7. If sentinel found → return `status: "satisfied"`.
8. If round equals `codex_cap` → escalate (see `## Cap handling`).
9. Otherwise → continue to next round, passing prior trail as context.

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
  status: "satisfied" | "skipped" | "cap_hit" | "force_passed" | "extended" | "rework";
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
status: satisfied  # or: cap_hit | force_passed | skipped
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

## Telemetry

Emit one `codex_review_round` event per round to
`.guild/runs/<run-id>/logs/v1.4-events.jsonl` via the shared helper:

```bash
npx tsx scripts/emit-loop-event.ts \
  --event codex_review_round \
  --gate <G-spec|G-plan|G-diagnose|G-lane:lane-id> \
  --round <N> \
  --terminated <satisfied|false> \
  [--run-id <run-id>] [--cwd <repo-root>]
```

Use `--terminated satisfied` on the final round when `## SATISFIED` is emitted
or the user force-passes. Use `--terminated false` for non-final rounds. The
`codex_review_round` event type is defined in
`guild-benchmark/plans/v1.4-jsonl-schema.md §12`; do not append these rows directly.

## Config resolution

`codex_cap` resolves in this order (first wins):

1. `--codex-cap=N` CLI flag
2. `.guild/config.yml` key `codex_cap`
3. Default: `5`

Maximum: `10`. Values above 10 are clamped to 10 with a warning.

---
type: plan
phase: P4
status: P4 — current
owner: technical-writer
updated_at: 2026-04-26
upstream:
  - benchmark/plans/p4-learning-loop-architecture.md
  - benchmark/plans/adr-005-learning-loop-orchestrator.md
  - benchmark/plans/security-review-p4.md
---

# 06 — Learning loop

## Status: P4 — current

This document is the operator-facing reference for the learning-loop validation that ships in P4. The architectural contract is `benchmark/plans/p4-learning-loop-architecture.md`; the orchestrator pattern decision is captured in `benchmark/plans/adr-005-learning-loop-orchestrator.md`; the threat model is `benchmark/plans/security-review-p4.md` (15 findings — 12 P4-required, 3 deferred-with-reason). This file does not restate those documents; it cites them and adds the operator runbook prose plus the security caveats addressed to technical-writer in `security-review-p4.md §1–§4` (R1–R9).

## When to use the loop

The loop is the autoresearch keep/discard signal applied to Guild itself: run a baseline against a fixed case, surface a `guild:reflect` proposal, apply it manually, run a candidate at the new `plugin_ref`, and let `compare.ts` decide whether the change moved the `guild_score` enough to keep. The keep/discard rule is locked in `p4-learning-loop-architecture.md §5`. Use the loop when validating a candidate plugin commit before merging, when comparing two reflection proposals against the same baseline, or when answering "did this change move the score?" with first-hand evidence. The targeted case is `demo-context-drift-evolve` (`02-case-suite.md`); the loop generalises to any case with `learning_loop:` defaults or a per-case override.

The loop calls `runner.ts` twice (baseline, then candidate) — both runs are fresh-fixture clones per ADR-003, both inherit the process-group signal escalation locked in ADR-004, and both honour the 1h cap from spec §Constraints. The loop adds one new artifact (`runs/<baseline-run-id>/loop-manifest.json`) and one new optional block on the existing `comparison.json` (`reflection_applied`). No new HTTP routes (`adr-005-learning-loop-orchestrator.md §Decision` commitment 2). No new UI pages — ComparePage gets the small additions T3-frontend implements.

## Two-stage CLI walk-through

Five operator steps. The two CLI invocations are bridged by `runs/<baseline-run-id>/loop-manifest.json` and the operator's git history. Both invocations honour `--dry-run`; CI never burns tokens.

### Step 1 — Baseline + emit manifest

Run the baseline against the chosen case. The loop calls `runner.ts` exactly once and exits 0; the manifest is written with `state: "awaiting-apply"`.

```
npm run benchmark -- loop --start --case demo-context-drift-evolve [--dry-run]
```

The runner produces `runs/<baseline-run-id>/{run.json, events.ndjson, score.json, artifacts/.guild/}` (the standard P3 layout). The loop additionally writes `runs/<baseline-run-id>/loop-manifest.json` listing every proposal under `runs/<baseline-run-id>/artifacts/.guild/reflections/*.md` (`p4-learning-loop-architecture.md §4.4` discovery rule). The manifest is mode `0o600` (`security-review-p4.md F2.3`). The CLI prints the exact `--continue` invocation the operator should run next; you can re-print this any time via Step 2.

`--dry-run` resolves the plan (baseline argv, manifest path, expected reflections directory) and exits 0 without spawning.

### Step 2 — Review proposals

Read the manifest (and the proposal bodies it indexes) before applying anything. `loop --status` is read-only.

```
npm run benchmark -- loop --status --baseline-run-id <baseline-run-id>
```

Output prints `state`, `case_slug`, `plugin_ref_before`, `started_at`, every entry in `available_proposals[]`, and (per `security-review-p4.md F1.1` mitigation M1) the proposal body byte-for-byte from the source `.md` file. A `WARNING:` banner (`security-review-p4.md F1.2` mitigation M3) flags any proposal whose body references a high-trust subtree (`hooks/`, `commands/`, `.claude/settings*.json`, `.mcp.json`, `mcp-servers/`).

### Step 3 — Apply manually (operator-owned)

This step is **operator-driven**, not loop-driven. The loop never writes plugin source (`adr-005-learning-loop-orchestrator.md §Decision` commitment 5; `p4-learning-loop-architecture.md §6.1` boundary). Read the proposal as if it were an untrusted PR (`security-review-p4.md §1` R1):

1. Create a topic branch (`git checkout -b reflect-experiment-<slug>`).
2. Edit the plugin source per the proposal body. The manifest's `source_path` is **advisory only** (`p4-learning-loop-architecture.md §6.1`) — review the full commit diff against the proposal's intent, not just `source_path`.
3. Commit cleanly so `git rev-parse HEAD` advances. The loop's runtime check at `--continue` rejects the candidate run if the host repo's `HEAD` still equals `manifest.plugin_ref_before` (`p4-learning-loop-architecture.md §4.3` rule 3).

### Step 4 — Candidate + emit comparison

Re-invoke the loop with the chosen proposal. The loop validates the manifest (`p4-learning-loop-architecture.md §4.3` rules 1–5 plus `security-review-p4.md F2.1 / F2.2` `proposal_id` regex and `baseline_run_id` cross-check), spawns the candidate via `runner.ts`, calls `compare.ts` with the manifest in scope, and updates `manifest.state = "completed"` after the candidate finishes (atomic rename per `security-review-p4.md F1.6` mitigation M14).

```
npm run benchmark -- loop --continue \
  --baseline-run-id <baseline-run-id> \
  --apply <proposal-id> [--dry-run]
```

The candidate is an ordinary P3 run. Exit codes follow `03-runner.md §Status mapping`: `0` (pass), `1` (fail), `124` (timeout), `2` (errored / runtime error / lock contention). The "kept" outcome is **not** an exit code — the operator reads `comparison.reflection_applied.kept` from the comparison file (Step 5).

### Step 5 — Read the outcome

When `--continue` succeeds, the comparison is at `runs/_compare/<baseline-run-id>__<candidate-run-id>.json` with the `reflection_applied` block populated (`p4-learning-loop-architecture.md §3.4`). The boolean `comparison.reflection_applied.kept` is the keep/discard verdict. ComparePage in the UI renders the keep/discard badge alongside (not in place of) the per-component delta table (`security-review-p4.md F4.1` Q19). See `§Reading the comparison output` below for the JSON shape.

## Reflection-applied metadata + UI annotation

The `reflection_applied` field is **optional** on `comparison.json`. It is emitted only when the comparator was invoked with a manifest in scope (i.e., the loop drove the comparison) and both runs share the matched manifest's `baseline_run_id` and `applied_proposal.candidate_run_id` (`p4-learning-loop-architecture.md §3.3`). When absent, `comparison.json` is byte-identical-shape to P1/P3 — backward-compatible (`schema_version` stays `1`).

The schema is locked in `p4-learning-loop-architecture.md §3.4`. Field cross-walk:

| Field                                              | Meaning                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `reflection_applied.proposal_id`                   | File basename of the applied proposal (matches `runs/<baseline-id>/artifacts/.guild/reflections/<id>.md`). |
| `reflection_applied.source_path`                   | Advisory path the proposal declared as its target (operator-supplied via `--apply`). |
| `reflection_applied.applied_at`                    | ISO-8601 timestamp of the `loop --continue` invocation.                          |
| `reflection_applied.plugin_ref_before`             | Host repo `HEAD` captured at `loop --start` (`manifest.plugin_ref_before`).      |
| `reflection_applied.plugin_ref_after`              | Host repo `HEAD` captured at `loop --continue` (post-apply commit).              |
| `reflection_applied.kept`                          | Keep/discard verdict (boolean), computed server-side per `§5` rule.              |
| `reflection_applied.delta_summary.guild_score_delta` | Signed aggregate; positive == improvement.                                     |
| `reflection_applied.delta_summary.worst_component_delta` | Signed; the most-negative per-component delta among `COMPONENT_KEYS`.      |
| `reflection_applied.delta_summary.worst_component` | Which component key produced `worst_component_delta` (e.g. `loop_response`).    |

`delta_summary` deliberately uses `worst_component_delta` + `worst_component` (per architect §3.4 + backend's schema decision). The full per-component map remains the source of truth at `comparison.per_component_delta`.

ComparePage renders three small additions when `reflection_applied` is present (`p4-learning-loop-architecture.md §1` row "this document"; T3-frontend lane):

- A reflection badge naming `proposal_id` and `source_path`.
- A plugin-ref delta of the form `<plugin_ref_before> → <plugin_ref_after>`.
- A keep/discard badge driven off `kept` (green "kept" / muted "discarded"), rendered **adjacent to** (not in place of) the per-component delta table (`security-review-p4.md F4.1` Q19).

Frontend never re-derives `kept` — the boolean is computed by `compare.ts` and surfaced verbatim.

## Keep/discard rule + threshold tuning

The rule is locked in `p4-learning-loop-architecture.md §5.1`. Reproduced here for ease of reference (cite the architect doc for the worked examples and the rationale):

```
A reflection is KEPT when:
  comparison.guild_score_delta.delta >= keep_threshold
  AND for all k in COMPONENT_KEYS:
    comparison.per_component_delta[k].delta >= regression_threshold

Otherwise it is DISCARDED.

Defaults:
  keep_threshold        =  2.0   (weighted points; positive == improvement)
  regression_threshold  = -1.0   (per-component, signed; any single component falling more than 1.0 disqualifies)
```

The boundary semantics are inclusive (`>=`, not `>`) on both sides — a comparison with exactly `+2.0` score delta and exactly `-1.0` worst component delta is `kept` (`p4-learning-loop-architecture.md §5.2` worked examples row "Boundary"). `COMPONENT_KEYS` is the canonical list from `benchmark/src/types.ts`: `outcome, delegation, gates, evidence, loop_response, efficiency`.

### Per-case override

Each case YAML may declare an optional `learning_loop:` block to override the defaults (`p4-learning-loop-architecture.md §5.3`):

```yaml
# benchmark/cases/<slug>.yaml — optional block
learning_loop:
  keep_threshold: 2.0          # default; weighted points; positive == improvement
  regression_threshold: -1.0   # default; per-component, signed; any single component below this disqualifies
```

Both fields are optional inside the block; absent fields fall back to defaults. The block itself is optional; absent block means defaults apply (no migration required for existing case YAMLs). Validation at case-load time: `keep_threshold` must be finite and `> 0`; `regression_threshold` must be finite and `< 0` — a zero or wrong-signed value is a case-load error, not a silent fall-through.

## Operator caveats

These are the runbook items addressed to technical-writer in `security-review-p4.md §route: technical-writer` (R1–R9). Each ties to a specific finding so the operator has the threat model in scope when reading the caveat.

### R1 — Reviewing proposals before apply (`security-review-p4.md F1.1`)

Read the proposal body in full before applying. Apply on a topic branch. Request human review. Treat the apply step as if reviewing an untrusted PR — proposal bodies are `claude` subprocess output influenced by an operator-authored case prompt, and the *applied* commit lands in the host repo's git history (where teammates pull it). Fresh-fixture isolation bounds the candidate-run damage; it does not undo a malicious source-tree commit. `loop --status` prints the proposal body byte-for-byte; do not skip reading it.

### R2 — High-trust path callout (`security-review-p4.md F1.2`)

A proposal's manifest `source_path` is advisory. The body may instruct edits to high-trust subtrees that execute on every Claude Code session start or `/guild` invocation:

- `hooks/` — runs at session events.
- `commands/` — runs on `/guild` and `/guild:*` invocations.
- `.claude/settings*.json` — settings the harness loads.
- `.mcp.json` — MCP server registry.
- `mcp-servers/` — MCP server source.

Verify the **full commit diff** against the proposal's intent, not just `source_path`. `loop --status` emits a `WARNING:` banner when a proposal body references one of these subtrees (best-effort grep, not AST-level enforcement).

### R3 — Sandbox `HOME` for untrusted proposals (`security-review-p4.md F1.4`)

The runner forwards `HOME` to the candidate subprocess so `claude` can read `~/.claude/credentials.json` for auth. An applied proposal that adds a skill body reading `~/.aws/credentials` or `~/.ssh/id_rsa` has the same filesystem reach as the operator. P3's stream Transform redactor (`security-review.md F4.2`) catches obvious token shapes in stdout/stderr/`events.ndjson`, but a proposal-injected skill can format-encode credentials to evade pattern matching.

When applying a proposal you did not author yourself, run the candidate with a sandbox `HOME`:

```
HOME=/tmp/sandbox-claude-home npm run benchmark -- loop --continue \
  --baseline-run-id <baseline-run-id> \
  --apply <proposal-id>
```

Same pattern as `03-runner.md §Operator caveats — Operator auth identity` and `security-review.md` R4 / F4.3.

### R4 — Recovering from a bad apply (`security-review-p4.md F1.5`)

If `loop --continue` produces a candidate run that times out repeatedly, OR your normal `/guild` invocations hang after applying a proposal, the apply edit broke the host plugin. Recovery:

```
git revert HEAD          # revert the applied commit
# restart your Claude Code session
```

Then re-run the loop (or pick a different proposal). The loop does not fix host-plugin lockups; the operator does. The candidate run itself is bounded by the 1h cap (`p3-runner-architecture.md §2.6` + `adr-004 §Decision §5`), but the operator's daily `/guild` workflow is not.

### R5 — Manifest file mode + single-user host (`security-review-p4.md F2.3`)

`loop --start` and `loop --continue` write the manifest with mode `0o600` (owner read/write only). The runner re-applies `chmod 0o600` after each write to defend against umask interference. Operate on a single-user host (consistent with spec §Audience); shared / multi-user dev hosts widen the threat model and are out of v1 scope.

If a stale single-flight lock at `<manifest>.lock` blocks `loop --continue` (the previous invocation crashed without releasing the sentinel), confirm no `loop` process is running, then `rm <manifest>.lock` and re-invoke (`security-review-p4.md F1.6` mitigation M7; backend follow-up route to T5 — recovery noted in T2 receipt).

### R6 — Computing `auth_identity_hash` (`security-review-p4.md F3.2`)

`GUILD_BENCHMARK_AUTH_HINT` MUST be a SHA-256 hex digest, exactly 64 lowercase hex characters (`^[a-f0-9]{64}$`). Compute it like this:

```
echo -n "<my-identity-token>" | sha256sum | awk '{print $1}'
```

The `-n` flag matters — it suppresses the trailing newline so the digest is bit-deterministic. On macOS without `sha256sum`, use `shasum -a 256`. Do **not** pass the identity-token directly: the runner stores the env value verbatim, so a non-hex value would either land in `run.json` literally (if it accidentally matched the regex) or trigger the validation reject path.

### R7 — What "identity-token" should mean (`security-review-p4.md F3.2`)

The runner does not prescribe what `<my-identity-token>` is. The operator chooses — a per-developer random UUID committed to a private notes file, a hash of a work email, a stable handle, anything that lets the operator correlate runs by identity later. The contract is that the value is opaque (not a credential) and stable across runs the operator wants to correlate.

What it should **NOT** contain:

- Real credentials (`sk-...`, `Bearer ...`, OAuth tokens, AWS keys). The runner rejects values matching credential-shaped regexes; a clean SHA-256 hex value of a real credential would still leak the *fact* of which credential it hashes if the hash is ever paired with an attacker-controlled rainbow-table lookup.
- Personally-identifying material the operator does not want in routinely-shared artifacts (`run.json` ships in bug reports, in the deferred public website export).
- Live session tokens. The hash is forensic-only; it is not used for auth or authz.

### R8 — `auth_identity_hash` is forensic-only (`security-review-p4.md F3.3`)

The hash field does not authenticate runs and does not authorise anything. An operator-equivalent attacker (someone with shell access on the host) can set a different `GUILD_BENCHMARK_AUTH_HINT` to mis-attribute. The threat is bounded by the single-operator scope (spec §Audience); the field is documented at this boundary, not stronger. Do not use the hash field for downstream attribution decisions that need cryptographic guarantees.

### R9 — `kept` is a hint, not a verdict (`security-review-p4.md F4.1`)

The keep/discard rule is intentionally simple — two criteria, six tracked components. A proposal *can* be designed to clear `keep_threshold` by exactly the threshold while regressing on something Guild's six components don't measure (latency under load, host resource consumption, downstream user trust). Do not trust the aggregate alone:

- Review per-component deltas, especially for proposals that suspiciously hit the threshold exactly.
- Treat a `kept: true` annotation as a hint, not a verdict — you remain the human-in-the-loop reviewer.
- ComparePage renders the per-component delta table alongside the keep/discard badge precisely so the operator can see the full picture.

This is the load-bearing mitigation for the threshold-gaming surface; backend does not add code-level "untracked-metric guards" in v1 (`security-review-p4.md F4.1` mitigation; runbook is the primary mitigation per architect §5.4 guidance).

## Reading the comparison output

The reflection-annotated `comparison.json` is served by the existing `GET /api/comparisons/:baseline/:candidate` endpoint (`adr-005-learning-loop-orchestrator.md §Decision` commitment 2 — no new routes). Sample shape with `reflection_applied` populated:

```json
{
  "schema_version": 1,
  "baseline": { "...": "TrialSetSummary" },
  "candidate": { "...": "TrialSetSummary" },
  "status": "ok",
  "excluded_runs": [],
  "per_component_delta": {
    "outcome":        { "baseline": 28.0, "candidate": 30.0, "delta":  2.0 },
    "delegation":     { "baseline": 18.0, "candidate": 18.4, "delta":  0.4 },
    "gates":          { "baseline": 17.5, "candidate": 17.5, "delta":  0.0 },
    "evidence":       { "baseline": 13.0, "candidate": 13.5, "delta":  0.5 },
    "loop_response":  { "baseline":  8.0, "candidate":  8.6, "delta":  0.6 },
    "efficiency":     { "baseline":  4.5, "candidate":  4.0, "delta": -0.5 }
  },
  "guild_score_delta": { "baseline": 89.0, "candidate": 92.0, "delta": 3.0 },
  "reflection_applied": {
    "proposal_id":       "2026-04-26-context-fanout",
    "source_path":       "agents/architect.md",
    "applied_at":        "2026-04-26T22:14:00Z",
    "plugin_ref_before": "4cb92d9ba6dcdbf16233bfc973acaaedf28d8695",
    "plugin_ref_after":  "1a2b3c4d5e6f7890abcdef1234567890abcdef12",
    "kept":              true,
    "delta_summary": {
      "guild_score_delta":     3.0,
      "worst_component_delta": -0.5,
      "worst_component":       "efficiency"
    }
  },
  "generated_at": "2026-04-26T23:00:00Z"
}
```

Reading this:

- `reflection_applied.kept` is the keep/discard verdict (here: `true`, per the rule — score delta `+3.0 >= 2.0` and worst component delta `-0.5 >= -1.0`).
- `delta_summary.worst_component` names the most-negative per-component delta key (here: `efficiency` at `-0.5`); the full map is in `per_component_delta`.
- `plugin_ref_before` and `plugin_ref_after` are the host repo `HEAD` values captured at `--start` and `--continue` respectively. They MUST differ (rule 3 of the manifest validation; `p4-learning-loop-architecture.md §4.3`).

When `reflection_applied` is absent, treat the comparison as a non-loop comparison — render the existing per-component delta table verbatim and skip the reflection panel.

## References

- `benchmark/plans/p4-learning-loop-architecture.md` — multi-component design (§3 orchestrator shape, §3.4 reflection-applied schema, §4 manifest schema, §5 keep/discard rule, §6 security surfaces, §7 cross-references).
- `benchmark/plans/adr-005-learning-loop-orchestrator.md` — the orchestrator-pattern decision (Option A — two-stage CLI; A 122 vs B 76 vs C 78); §Decision commitments 1–7.
- `benchmark/plans/security-review-p4.md` — 15 findings (5 High · 6 Medium · 4 Low); 12 P4-required, 3 deferred-with-reason; R1–R9 routed to this document.
- `benchmark/plans/04-metrics.md §Comparison delta semantics` — the underlying delta semantics the keep/discard rule operates on; the P4 cross-link about `reflection_applied` lives there.
- `benchmark/plans/03-runner.md` — Mode 2 runner the loop calls twice per cycle; `--dry-run` ergonomic, `GUILD_BENCHMARK_LIVE=1` opt-in, and `auth_identity_hash` env handling carry forward from P3.
- `benchmark/plans/01-architecture.md §2` — the `Reflection` node this loop closes.
- `benchmark/plans/02-case-suite.md` — the `demo-context-drift-evolve` case the loop targets; `learning_loop:` per-case override block defined here.
- `benchmark/README.md §Loop walk-through (P4)` — the operator-facing five-step quick reference.
- `karpathy/autoresearch program.md` — the keep/discard pattern this loop applies to Guild itself.

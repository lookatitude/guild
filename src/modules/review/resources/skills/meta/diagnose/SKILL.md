---
name: guild-diagnose
description: Diagnose Guild plugin failures from recent .guild/runs telemetry, optional operator context, hook/audit-log evidence, and run artifacts; write a diagnosis report and fix plan; require explicit user approval before applying edits. TRIGGER for /guild:fix, "diagnose this Guild run", "why did /guild fail", "Guild hooks are not firing", "audit log is empty", "agent-team stalled", "self-fix Guild". DO NOT TRIGGER for auditing plugin script trust (/guild:audit), reviewing user application code (security specialist), normal /guild task review (guild-review), or evolving a skill based on accumulated reflections (guild:evolve-skill).
when_to_use: Explicit /guild:fix command or direct user request to diagnose/self-fix Guild plugin behavior.
type: meta
---

# guild:diagnose

Diagnoses Guild's own runtime failures and creates a gated self-fix path. This
skill is allowed to inspect repository files and `.guild/` state, but it must
not edit anything until the user approves a concrete fix plan.

## Inputs

Accept a raw argument string from `/guild:fix`:

- A run id, e.g. `run-2026-05-01-a62fc657`.
- Free-text operator context, e.g. `"PostToolUse audit log is empty"`.
- `--review=cross` to request Codex adversarial review of the diagnosis/fix
  plan.

If no run id is supplied, inspect the most recent `.guild/runs/*` directories.
If no context is supplied, infer symptoms from telemetry gaps and error rows.

## Read Scope

Read only the smallest useful set first:

1. `.guild/runs/current-run-id`, if present.
2. The requested run directory, or the latest 3 `.guild/runs/*` directories by
   mtime.
3. For each inspected run, read if present:
   - `metadata.json`
   - `events.ndjson`
   - `logs/v1.4-events.jsonl`
   - `logs/summary.md`
   - `review.md`, `verify.md`, `assumptions.md`
   - `handoffs/*.md`
   - `codex-review/*.md`
   - captured subprocess logs under benchmark artifacts when the run is a
     benchmark import (`_subprocess.stdout.log`, `_subprocess.stderr.log`)
4. Relevant plugin surfaces only after evidence points there:
   - `hooks/hooks.json`
   - hook handlers under `hooks/`
   - command files under `commands/`
   - meta-skills under `skills/meta/`
   - scripts under `scripts/`

Do not bulk-read unrelated project source. Do not inspect credentials or files
outside the repo and `.guild/` state.

## Diagnosis Workflow

1. **Normalize arguments.** Separate run id candidates, free-text context, and
   flags. A run id matches `run-*` or an existing `.guild/runs/<id>` directory.
2. **Collect evidence.** Summarize event counts, last timestamps, hook names,
   tool-call events, loop events, error rows, missing expected files, and recent
   failed verification/review findings.
3. **Classify failure.** Use the first matching category:
   - `telemetry-scope` — events from multiple invocations share one run id, or
     `current-run-id` is missing/stale.
   - `hook-registration` — bootstrap appears but expected hook handlers do not
     write `events.ndjson` or `logs/v1.4-events.jsonl`.
   - `audit-log-gap` — v1.3 `events.ndjson` exists but v1.4 JSONL is absent, or
     Pre/Post tool pairing sidecar is orphaned.
   - `loop-telemetry-gap` — loops ran but `loop_round_start` /
     `loop_round_end` rows are missing or unpaired.
   - `agent-team-stall` — task-created/task-completed/teammate-idle evidence
     shows blocked ownership or missing handoff receipt.
   - `codex-review-gap` — `--review=cross` / `codex_review` requested but trail
     is missing, invalid, or explicitly skipped.
   - `verification-failure` — `verify.md` failed for unmet success criteria.
   - `unknown` — evidence is insufficient; list the missing evidence.
4. **Root cause.** State the most likely cause, confidence (`high` / `medium` /
   `low`), and exact evidence paths.
5. **Fix plan.** Propose the smallest fix. Each fix item must include:
   - files to edit
   - intended behavior change
   - risk/blast radius
   - validation command
   - rollback note

## Adversarial review — G-diagnose (broker)

G-diagnose is a **skill-internal gate** (`docs/v2/09-adversarial-review.md §Gate
ownership`): it fires here inside the `fix`/`diagnose` flow at the
diagnosis→approval boundary. Wire the **review broker** at this boundary,
**not** `guild:codex-review` directly: the broker is the host-agnostic front
door, and `guild:codex-review` survives only as the internal Codex adapter the
broker dispatches to (`docs/v2/09 §The review broker`).

If `--review=cross` is present, or project config resolves `codex_review: true`,
review the diagnosis and fix plan before asking the user to approve edits.

Config resolution:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/read-guild-config.ts [--cwd <repo-root>] [raw /guild:fix flags]
```

When `codex_review` resolves true the G-diagnose review is **required**, so the
broker obeys the SK-9 gate-pass rule (`skills/meta/review-broker/SKILL.md
§"Gate-pass rule"`): a required review **never clean-`skipped`s**.

1. Invoke `guild-review-broker` on the diagnosis report path:
   `gate=G-diagnose artifact_path=<report-path> run_id=<diagnose-run-id> author_host=<run author host>`.
2. The broker resolves the reviewer host. When a **different-family** reviewer is
   reachable, the review is STRONG. When **no cross-host reviewer** is available
   (Codex absent / same-family / non-selectable), the broker **degrades to the
   WEAK same-host path** — a fresh-context same-host subagent reviews,
   `independence: weak`, recorded, and **still gated by the 5 conditions**. It
   does **not** resolve `status: "skipped"`: a required review that found no
   cross-host reviewer is a recorded weak review, never a clean skip (that would
   be the gate-bypass killed in SK-9). `skipped` happens **only** when review is
   not required (no `--review=cross` and config off → `review_required == false`).
   `author_host` is the host that produced the diagnosis (resolved from the
   run-start preflight snapshot; `claude` on a Claude-hosted run).
3. If the broker returns `status: "rework"`, revise the fix plan before the user
   approval gate. On `"satisfied"` (STRONG or WEAK) or `"force_passed"`, proceed
   to the approval gate normally; a true `"skipped"` only occurs when review was
   not required.

Adversarial review is advisory for diagnosis. The user approval gate remains
required whether the broker is satisfied (STRONG or WEAK), force-passed, or — when
review was not required — skipped.

## Report

Write the diagnosis report before any edits:

```text
.guild/diagnose/<timestamp>-<slug>.md
```

Use this structure:

```markdown
# Guild Diagnose — <timestamp>

## Input
- args:
- selected_run_ids:
- operator_context:
- codex_review:

## Evidence
- files_read:
- event_counts:
- missing_expected_artifacts:
- errors:

## Diagnosis
- category:
- confidence:
- root_cause:
- evidence:

## Fix Plan
1. ...

## Approval Gate
status: pending
```

## User Approval Gate

Before any edit, show the report path and the fix plan, then ask:

```text
Apply this Guild self-fix plan? [approve / edit-plan / diagnose-only / abort]
```

Allowed responses:

- `approve` — apply only the listed edits.
- `edit-plan` — revise the plan, update the report, and ask again.
- `diagnose-only` — stop after writing the report; no edits.
- `abort` — stop without edits; leave the report as the audit trail.

Do not treat silence, ambiguous replies, or Codex approval as user approval.

## Applying Fixes

When approved:

1. Edit only files listed in the approved plan.
2. Preserve unrelated user/team changes in the working tree.
3. Run the validation commands listed in the plan when practical.
4. Update the report's `Approval Gate` section to `approved` and append:
   - files changed
   - checks run
   - results
   - residual gaps

If an edit would touch high-trust surfaces (`hooks/`, `commands/`,
`.claude-plugin/plugin.json`, `mcp-servers/`), call that out in the approval
prompt.

## Output

Return a concise summary:

```text
/guild:fix — <diagnose-only | fixed | aborted>
Report: .guild/diagnose/<timestamp>-<slug>.md
Diagnosis: <category> (<confidence>)
Root cause: <one sentence>
Changed files: <list or none>
Checks: <list>
Residual gaps: <list or none>
```

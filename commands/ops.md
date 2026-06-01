---
name: ops
description: "Operations — full guild:operations skill [v2]: five runbook classes (release / monitoring / incident / rollback / maintenance) selected by the positional [runbook] else by surfaced detection (always confirmed, overridable), under a split autonomy posture + four non-negotiable safety rails (incident/rollback never autonomous; first run always interactive; always-ask hard set unconditional; mandatory pre-flight dry-run); devops-* producer vs security+architect G-operations challenger; consumes Quality, feeds the D8 release leg"
argument-hint: "[runbook]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:ops — phase: Operations `[v2]`

The **Operations** phase entrypoint — the full `guild:operations` skill
`[v2]` (promoted from the v1 reserved notice). Five runbook classes —
release / monitoring / incident / rollback / maintenance — selected by the
positional `[runbook]` else by **surfaced detection (always confirmed,
overridable)**, under a split autonomy posture + **four non-negotiable
safety rails**: incident/rollback never autonomous; first run always
interactive; the always-ask hard set is unconditional; a pre-flight dry-run
is mandatory. Producer `devops-*` vs `security+architect` G-operations
challenger. Consumes Quality, feeds the D8 release leg.

Promotion behaviour is canonical in `architecture/command-surface.md §3.1`
(Operations `[v2]` row) — bound by pointer, not re-spelled. Verb↔phase edge:
`§6` (D-14: `/guild:ops` → Operations; node id `OPS`). Phase concept
binding: `lifecycle/phase-entrypoints.md` · `lifecycle/lifecycle-overview.md`.

## Contract binding (by pointer — never re-spelled)

Before producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract** — bound by pointer through
`docs/knowledge/implementation/contract-map.md §A` row 6 →
`architecture/target-architecture.md §"phase_entry contract"`. The Operations
record is the frozen `guild.ops.v1` contract — bound by pointer to
`contract-map.md §A` row 8 → `target-architecture.md §639–705` (safety_rails
§667–672); by class it also writes `guild.incident.v1` (`contract-map.md §A`
row 9) / `guild.release.v1` (`contract-map.md §A` row 10, D8 join §731–745).
Not re-spelled.

## Usage

```
/guild:ops
/guild:ops release
```

All six global flags + `--dry-run` apply (`command-surface.md §4`, by
pointer). The mandatory pre-flight dry-run is a safety rail, independent of
`--dry-run`.

## Args & local flags

- Args: `[runbook]` (one of: release / monitoring / incident / rollback /
  maintenance; else surfaced detection)
- Local flags: —

## Gates (default)

- Risky / destructive **I always** (a `release`, destructive, `incident`, or
  `rollback` action always prompts even under `--auto-approve=all` and even
  inside an `approved:true` autonomous runbook; `MIGRATION.md §6`, by
  pointer)
- **G-operations** review **A**

## Output artifact

`.guild/runs/<run-id>/ops/<run-id>.md` (frozen `guild.ops.v1`; +
`guild.incident.v1` / `guild.release.v1` records by class).

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the operations skill is invoked — and before run-trace start — run
the preflight (`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`):

1. Call `runStartPreflight({ cwd, flags? })` — resolves the 7-source
   inheritance chain + validates + probes tmux + detects providers
   (full chain: see `/guild:guild §Run-start preflight`).
2. If `needsTmuxPrompt`: show `tmuxPrompt.question`; on YES run
   `config-cmd.ts <...tmuxPrompt.persistCommand> --cwd <cwd>` (U2 HARD-SET);
   on NO continue with the resolved backend.
3. Pass `result.snapshot` to `startRun` (U6 writes the resolved-settings
   snapshot; all later phases read it back via `readResolvedSettingsSnapshot`).
4. Proceed to run-trace start.

## Run recording

Before the operations skill is invoked, start a run (SC-B, §435):

```bash
node plugin/hooks/dist/run-trace.js start \
  --command=/guild:ops \
  --cwd "$(pwd)"
# If --initiative=<id> was supplied by the user, add: --initiative=<id>
```

`run-class` default (`full`). Records the run before the mandatory pre-flight
dry-run so the complete session — runbook class selection, dry-run, and
all safety-rail gates — is replayable from the entrypoint. `--initiative`
forwarded only when user-supplied explicitly (NN#5). The four non-negotiable
safety rails (incident/rollback never autonomous; first run always
interactive; always-ask hard set; mandatory dry-run) are unaffected by
run recording — they fire independently.

## Dispatch

Resolve `guild.phase_entry.v1` (pointer above), then drive the Operations
phase by invoking:

1. **`guild:operations`** (`skills/guild:guild-operations`) — the full `[v2]`
   skill: confirm the runbook class (positional `[runbook]` ∈ {release,
   monitoring, incident, rollback, maintenance} else surfaced detection,
   overridable), run the **mandatory pre-flight dry-run**, then ExecuteRunbook
   under the split autonomy posture + the advisory G-operations challenger
   trail. Consumes Quality, feeds the D8 release leg.

Input gate: for a release-class runbook, a Quality record
(`.guild/runs/<run-id>/quality/<run-id>.md`); other classes may run without
one.
Output gate: `.guild/runs/<run-id>/ops/<run-id>.md` (frozen `guild.ops.v1`;
+ `guild.incident.v1` / `guild.release.v1` by class).
Confirmation gates (from **Gates**): risky / destructive **I always** (a
release, destructive, incident, or rollback action always prompts even under
`--auto-approve=all`) · G-operations review **A**. Four non-negotiable safety
rails: incident/rollback never autonomous · first run always interactive ·
always-ask hard set unconditional · mandatory pre-flight dry-run.

Thin phase entrypoint — phase logic and `.guild/` writes live in the
`guild:operations` skill set.

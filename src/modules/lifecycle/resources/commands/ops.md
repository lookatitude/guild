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

This is the Operations phase entrypoint `[v2]`. Verb↔phase edge:
`/guild:ops` → Operations (node id `OPS`). Phase concept binding:
`lifecycle/phase-entrypoints.md` · `lifecycle/lifecycle-overview.md`.

## Contract binding

Before producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract**. The Operations record is the frozen
`guild.ops.v1` contract (safety_rails included); by class it also writes
`guild.incident.v1` and `guild.release.v1` (D8 join).
Full contract detail: [https://guildstack.dev/docs](https://guildstack.dev/docs).

## Usage

```
/guild:ops
/guild:ops release
```

All five global flags + `--dry-run` apply. The mandatory pre-flight dry-run
is a safety rail, independent of `--dry-run`.

## Args & local flags

- Args: `[runbook]` (one of: release / monitoring / incident / rollback /
  maintenance; else surfaced detection)
- Local flags: —

## Gates (default)

- Risky / destructive **I always** (a `release`, destructive, `incident`, or
  `rollback` action always prompts even under `--auto-approve=all` and even
  inside an `approved:true` autonomous runbook)
- **G-operations** review **A**

## Output artifact

`.guild/runs/<run-id>/ops/<run-id>.md` (frozen `guild.ops.v1`),
`guild.incident.v1` / `guild.release.v1` records by class,
`review/ops/*` (G-operations broker trail).

PCR-Operations must-exist floor: `.guild/runs/<run-id>/ops/<run-id>.md`,
`guild.release.v1` evidence (release class), conditional `guild.incident.v1`
evidence (incident class), `review/ops/*`. Binding:
`docs/v2/lifecycle.html §Host-portable phase contract`. Ref: DRIFT-ANALYSIS
CMD-011.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the operations skill is invoked — and before run-trace start — the run-trace CLI runs this preflight for you — you do **not**
call `runStartPreflight` yourself.

Since wave 2, `run-trace.js start` (below) is the **sole caller** of
`runStartPreflight` (`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`): on `start` the CLI resolves the 7-source
inheritance chain, validates closed keys, probes tmux, detects providers, and
writes `.guild/runs/<id>/resolved-settings.json` (+ a compact `settings_ref` in
`run.yaml`) automatically before the run opens. If this command needs the
resolved config — e.g. the dispatch backend `effective.agent_mode` — read the
snapshot back with `readResolvedSettingsSnapshot(runId, { cwd })`; never
re-resolve.

## Run recording

Before the operations skill is invoked, start a run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js start \
  --command=/guild:ops \
  --cwd "$(pwd)"
# If --initiative=<id> was supplied by the user, add: --initiative=<id>
```

Immediately after, record this command's phase token into run-state
(T0, G-PHASE-COMPOSE; idempotent — best-effort, non-throwing, never blocks
the lifecycle; `start` writes `current-run-id` synchronously so `phase`
resolves the open run):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js phase \
  --phase=ops \
  --cwd "$(pwd)"
```

`run-class` default (`full`). Records the run before the mandatory pre-flight
dry-run so the complete session — runbook class selection, dry-run, and
all safety-rail gates — is replayable from the entrypoint. `--initiative`
forwarded only when user-supplied explicitly (NN#5). The four non-negotiable
safety rails (incident/rollback never autonomous; first run always
interactive; always-ask hard set; mandatory dry-run) are unaffected by
run recording — they fire independently.

## Team decision gate (blocking — team-contracts §4/§5)

Before this phase dispatches **any** participant — worker, advisor, challenger,
or local/cross-host reviewer — a **persisted** team decision must authorize it.
An advisory label is never a bypass, and Guild never auto-approves.

1. **Present the proposal** and let the user answer in the decision vocabulary
   — `approve · add · remove · substitute · edit_dependencies · restructure`
   (the four edit verbs record a `restructure`, never an approve). The review
   prints the proposed team, each participant's necessity rationale, excluded
   roles, obligation coverage, and per-kind gate coverage:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/team-decide.ts review \
  --proposal .guild/runs/<run-id>/team-plan/ops.proposal.v<n>.yaml
```

2. **Restructure loop** — idempotent: each pass produces a NEW proposal version
   (parent hash chained, prior versions preserved) and returns to `pending`; it
   never edits approved bytes and never approves anything:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/team-decide.ts restructure \
  --proposal <parent-proposal> --edits <edits.json> \
  --decided-by user --channel interactive_prompt
```

   It prints the user's edits, the **coverage impact** (obligations that lost
   their last owner), and any edit already satisfied by the parent. It exits
   non-zero on an uncited roster change or a re-introduced cap key — a
   specialist can never be dropped silently.

3. **Gate the dispatch** — run this and **STOP on a non-zero exit**. It reads
   the PERSISTED decision trail under `.guild/runs/<run-id>/team-plan/`; an
   in-memory or agent-asserted approval is never accepted:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/team-decide.ts gate \
  --proposal <proposal> --cwd "$(pwd)"
```

Exit `0` authorizes dispatch and prints the final approved team plus the
backend scheduling waves. Exit `3` **BLOCKS** — no persisted decision, a
restructure rather than an approval, a tampered artifact, or a stale /
hash-mismatched decision after any change to a participant, obligation,
dependency, tier/purpose, capability scope, backend, wave structure,
concurrency, cost posture, or review independence. Renewed user approval is
required; never proceed past a refusal.

Backend capacity shapes **waves**, never the roster: if the backend cannot run
the approved team at once, propose waves or another backend and ask. Never drop
a role to fit a host UI or backend.

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

---
name: plan
description: "Planning — team-compose + PRD + per-specialist lane plan + autonomy contract. Backend (agent_mode/tmux) is resolved once at intake from the run-start preflight snapshot — not selected per-phase."
argument-hint: "[--team-size=N]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:plan — phase: Planning

The **Planning** phase entrypoint. Composes the team, writes the PRD and the
per-specialist lane plan, and authors the additive optional per-lane autonomy
contract. **Team composition is a sub-step strictly inside this command**
(its own approval gate); there is no standalone team command in v2 — inspect
via `/guild:status`, edit via the `[edit]` response at the plan/team approval
gate, raise the cap with `--team-size=N`.

Verb↔phase edge: `/guild:plan` → Planning. Phase concept binding:
`lifecycle/phase-entrypoints.md` · `lifecycle/lifecycle-overview.md`.

## Contract binding

Before producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract**. The additive optional per-lane
`autonomy_contract` is authored here and approved at the **existing** plan
gate — **no new gate**. The Tier-2 `defaults:` config folded at intake
is controlled by `P1-config-001` — see `/guild:config` for the schema.

## Usage

```
/guild:plan
/guild:plan --team-size=8
```

All five global flags + `--dry-run` apply. The `--rigor` profile expansion
(`rigorProfile()` in `scripts/read-guild-config.ts`) decides the L2 loop:
`standard` (the default) and `deep` both expand to a `loops` set containing
`plan`; only `quick` turns it off.

## Args & local flags

- Args: — (no positional)
- Local flags:
  - `--team-size=N` — cap-6 override; `>6` prints a cap warning.

## Gates (default)

- Team-approval **I**
- Plan/PRD-approval **I**
- G-planning review **A**

## Output artifact

`.guild/team/<slug>.<phase>.yaml` + `.guild/team/<slug>.current` pointer,
the PRD (**right-sized** — inline `## PRD` section in `.guild/plan/<slug>.md`
by default; promoted to a standalone `.guild/prd/<slug>.md` only when a
right-size trigger fires: **>1 feature** OR **initiative-attached** OR
**success-criteria count >5** — ADR `decisions/prd-right-sizing.md`, folded
into the plan/PRD gate, no separate G-prd gate), `.guild/plan/<slug>.md`,
per-lane autonomy-contract policy (the additive `autonomy_contract` block
authored inside the plan), `.guild/runs/<run-id>/review/plan/*` (G-planning
broker trail).

PCR-Planning must-exist floor: `.guild/team/<slug>.<phase>.yaml`,
`.guild/plan/<slug>.md` (carrying the inline `## PRD` section **or** a
pointer to the promoted standalone `.guild/prd/<slug>.md` — the standalone
file is conditional on the right-size triggers above, per the lifecycle
PCR note), the per-lane autonomy-contract policy,
`.guild/runs/<run-id>/review/plan/*`. Binding:
`docs/v2/lifecycle.html §Host-portable phase contract`. Ref: DRIFT-ANALYSIS
CMD-004.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before team-compose begins — and before run-trace start — the run-trace CLI runs this preflight for you — you do **not**
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

**Backend selection is phase-wide, not phase-local.** The `agent_mode`
(subagent / agent / team) resolved at intake is locked in the snapshot and
consumed by all phases. `team-compose` and `execute-plan` read the locked-in
`snapshot.effective.agent_mode` via `readResolvedSettingsSnapshot(runId,
{ cwd })` — they do not re-resolve or re-select the backend.

## Run recording

Before team-compose begins, start a run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js start \
  --command=/guild:plan \
  --cwd "$(pwd)"
# If --initiative=<id> was supplied by the user, add: --initiative=<id>
```

Immediately after, record this command's phase token into run-state
(T0, G-PHASE-COMPOSE; idempotent — best-effort, non-throwing, never blocks
the lifecycle; `start` writes `current-run-id` synchronously so `phase`
resolves the open run):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js phase \
  --phase=plan \
  --cwd "$(pwd)"
```

`run-class` default (`full`). Records the run before the team-approval gate
so the complete session — team compose, plan, and all review loops — is
replayable from the entrypoint. `--initiative` forwarded only when
user-supplied (NN#5).

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
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/team-decide.ts review \
  --proposal .guild/runs/<run-id>/team-plan/plan.proposal.v<n>.yaml
```

2. **Restructure loop** — idempotent: each pass produces a NEW proposal version
   (parent hash chained, prior versions preserved) and returns to `pending`; it
   never edits approved bytes and never approves anything:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/team-decide.ts restructure \
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
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/team-decide.ts gate \
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

Resolve `guild.phase_entry.v1` (pointer above), then drive the Planning phase
by invoking, in order:

1. **`guild:team-compose`** (`skills/meta/team-compose`) — the team-compose
   sub-step (its own approval gate); writes `.guild/team/<slug>.<phase>.yaml`
   + the `.guild/team/<slug>.current` phase pointer.
2. **`guild:plan`** (`skills/meta/plan`) — turns the approved spec + team into
   the right-sized PRD and per-specialist lane plan with the additive
   per-lane autonomy contract; writes `.guild/plan/<slug>.md` with an inline
   `## PRD` section, promoted to a standalone `.guild/prd/<slug>.md` only
   when a right-size trigger fires (>1 feature / initiative-attached /
   success-criteria >5 — `decisions/prd-right-sizing.md`).
3. **`guild:loop-plan-review`** — **when the resolved `loops` include `plan`**
   (true under `--rigor=standard`, the default, and `--rigor=deep`; off only
   under `--rigor=quick` / an explicit `--loops` excluding `plan`): the L2
   architect↔security plan-defect loop runs AFTER `guild:plan` writes the
   plan and BEFORE the plan-approval gate.

Input gate: an approved `.guild/spec/<slug>.md`.
Output gate: the **Output artifact** set above is written; the plan carries
`approved:` per the gate outcome.
Confirmation gates (from **Gates**): team-approval **I** · plan/PRD-approval
**I** · G-planning review **A**.

Thin phase entrypoint — phase logic and `.guild/` writes live in the phase
skill set.

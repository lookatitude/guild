---
name: guild
description: "Top-level Guild entry. Runs the 7-step lifecycle: brainstorm → team-compose → plan → context-assemble → execute-plan → review → verify-done. Per guild-plan.md §13.1."
argument-hint: "[brief]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill
---

# /guild — Top-level task entry point

This command runs the full Guild task lifecycle (guild-plan.md §13.1). It delegates every
step to the appropriate T2 meta-skill. No logic is implemented here; all state lives in
`.guild/` and is managed by the skills.

Invoke with an optional initial brief:

```
/guild "build a REST API for user authentication"
/guild        ← guild-brainstorm will prompt you interactively
```

---

## Phase flow

The 7 phases run in strict order. Each phase is a `Skill` tool invocation. The command
passes outputs from earlier phases as inputs to later ones.

### Phase 1 — Brainstorm (`guild-brainstorm`)

**Input:** `$ARGUMENTS` (the brief, if supplied); empty string if not provided.
**Output:** `.guild/spec/<slug>.md` — the approved task spec.

Invoke the skill:

```
Skill: guild-brainstorm
args: $ARGUMENTS
```

`guild-brainstorm` conducts a Socratic clarification session, captures the goal,
success criteria, non-goals, constraints, and autonomy policy, then writes the spec
file. If `$ARGUMENTS` is non-empty it is used as the initial brief; otherwise the
skill asks the user for the task description interactively.

**User confirmation point →** see §User confirmation points below.

---

### Phase 2 — Team compose (`guild-team-compose`)

**Gate:** `.guild/spec/<slug>.md` must exist (written by Phase 1).
**Input:** path to the spec file.
**Output:** `.guild/team/<slug>.yaml` — the resolved specialist team.

Invoke the skill:

```
Skill: guild-team-compose
args: spec=.guild/spec/<slug>.md
```

`guild-team-compose` matches spec domains against the 13 specialists, presents
matched specialists plus any gaps (with auto-create / skip / substitute / from-scratch
options), and writes the team YAML with per-specialist scope and `depends-on:` edges.
The team is capped at 6 specialists; default recommendation is 3–4.

**User confirmation point →** see §User confirmation points below.

---

### Phase 3 — Plan (`guild-plan`)

**Gate:** `.guild/team/<slug>.yaml` must exist (written by Phase 2).
**Input:** spec path + team path.
**Output:** `.guild/plan/<slug>.md` — the per-specialist lane plan.

Invoke the skill:

```
Skill: guild-plan
args: spec=.guild/spec/<slug>.md team=.guild/team/<slug>.yaml
```

`guild-plan` produces a plan with one lane per specialist, each carrying its task
description, input/output artifacts, and `depends-on:` references. The plan includes
the autonomy contract (what Guild may do unattended, what requires confirmation, what
is forbidden). When approved, the plan file is updated with `approved: true`.

**User confirmation point →** see §User confirmation points below.

---

### Phase 4 — Context assemble (`guild-context-assemble`)

**Gate:** `.guild/plan/<slug>.md` must exist AND contain `approved: true`.
**Input:** plan path + team path.
**Output:** `.guild/context/<run-id>/<specialist>-<task-id>.md` for each specialist.

Invoke the skill:

```
Skill: guild-context-assemble
args: plan=.guild/plan/<slug>.md team=.guild/team/<slug>.yaml
```

`guild-context-assemble` builds a three-layer context bundle (universal ~400 tokens +
role-dependent ~800–1500 tokens + task-dependent ~800–1500 tokens) for every
specialist. Target total: ~3k tokens; hard cap 6k. Bundles are written before any
specialist is dispatched.

---

### Phase 5 — Execute plan (`guild-execute-plan`)

**Gate:** Context bundles must exist for all specialists (written by Phase 4).
**Input:** plan path + team path + run-id.
**Output:** `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` per specialist
           and `.guild/runs/<run-id>/assumptions.md`.

Invoke the skill:

```
Skill: guild-execute-plan
args: plan=.guild/plan/<slug>.md team=.guild/team/<slug>.yaml run-id=<run-id>
```

`guild-execute-plan` dispatches specialists via the Agent tool (subagent backend by
default; agent-team backend is opt-in per guild-plan.md §7.3). It observes parallelism
rules: Architect runs first when present; Backend → QA; DevOps → QA; content and
commercial specialists run in parallel with engineering when they only need the spec.
Each specialist writes a handoff receipt with changed files, evidence, assumptions, and
open risks.

---

### Phase 6 — Review (`guild-review`)

**Gate:** `.guild/runs/<run-id>/handoffs/*.md` AND `.guild/runs/<run-id>/assumptions.md`
          must exist (written by Phase 5).
**Input:** run-id.
**Output:** `.guild/runs/<run-id>/review.md`.

Invoke the skill:

```
Skill: guild-review
args: run-id=<run-id>
```

`guild-review` runs a 2-stage review consuming the handoff receipts: first spec
alignment (did each specialist deliver what the plan required?), then output quality
(evidence present, scope respected, no out-of-scope changes). The review summary
is written to `review.md`.

---

### Phase 7 — Verify done (`guild-verify-done`)

**Gate:** `.guild/runs/<run-id>/review.md` must exist (written by Phase 6).
**Input:** run-id.
**Output:** `.guild/runs/<run-id>/verify.md` — pass/fail + run summary.

Invoke the skill:

```
Skill: guild-verify-done
args: run-id=<run-id>
```

`guild-verify-done` checks tests, verifies scope (every file change traces to a plan
task), and confirms each success criterion from the spec is met with evidence. The
result is a structured pass/fail report in `verify.md`.

---

## Resumption rules

If `/guild` is invoked when a previous run is in progress, detect the furthest phase
already completed and resume from the next pending phase. Do **not** re-run a phase
whose output file already exists unless the user explicitly requests it.

Detection order (check each file in sequence; start from the first that is absent):

| Missing file | Resume from |
|---|---|
| `.guild/spec/<slug>.md` | Phase 1 — guild-brainstorm |
| `.guild/team/<slug>.yaml` | Phase 2 — guild-team-compose |
| `.guild/plan/<slug>.md` (or `approved: true` absent) | Phase 3 — guild-plan |
| `.guild/context/<run-id>/` (directory empty or absent) | Phase 4 — guild-context-assemble |
| `.guild/runs/<run-id>/handoffs/*.md` or `assumptions.md` absent | Phase 5 — guild-execute-plan |
| `.guild/runs/<run-id>/review.md` absent | Phase 6 — guild-review |
| `.guild/runs/<run-id>/verify.md` absent | Phase 7 — guild-verify-done |
| `verify.md` exists | Run complete — show summary |

When resuming, announce the detected state to the user:

```
Detected existing run <run-id> for spec <slug>.
Spec and team approved. Plan is approved. Resuming at Phase 4 (context-assemble).
```

**Slug resolution:** when resuming, resolve `<slug>` by listing `.guild/spec/` and
selecting the most recently modified spec file (or prompt the user if more than one
spec exists with no active run-id).

**Forced re-run:** if the user passes `--restart` as the first word of `$ARGUMENTS`,
clear the existing run state and start from Phase 1. Confirm with the user before
clearing.

---

## User confirmation points

There are three mandatory confirmation gates. The command must pause and wait for an
explicit user response before proceeding past each gate. Do not dispatch the next phase
without confirmation.

### Gate 1 — Spec approval (after Phase 1)

After `guild-brainstorm` writes `.guild/spec/<slug>.md`:

1. Display the spec contents (or a summary if longer than ~50 lines).
2. Ask the user:
   ```
   Spec saved to .guild/spec/<slug>.md.
   Approve spec to proceed to team composition? [approve / edit / abort]
   ```
3. Responses:
   - **approve** — proceed to Phase 2.
   - **edit** — re-invoke `guild-brainstorm` with the current spec as context so the
     user can revise it. Loop until approved or aborted.
   - **abort** — stop the run. Leave the spec file in place for future resumption.

### Gate 2 — Team approval (after Phase 2)

After `guild-team-compose` writes `.guild/team/<slug>.yaml`:

1. Display the resolved team (specialists, scope lines, gap decisions).
2. Ask the user:
   ```
   Team saved to .guild/team/<slug>.yaml.
   Approve team to proceed to planning? [approve / edit / abort]
   ```
3. Responses:
   - **approve** — proceed to Phase 3.
   - **edit** — the user may invoke `/guild:team edit` to adjust the team, or provide
     inline edits. Re-display after edits and prompt again.
   - **abort** — stop the run. Spec and team files remain for resumption.

### Gate 3 — Plan approval (after Phase 3)

After `guild-plan` writes `.guild/plan/<slug>.md`:

1. Display the plan (specialist lanes, autonomy contract, success criteria).
2. Ask the user:
   ```
   Plan saved to .guild/plan/<slug>.md.
   Approve plan to begin execution? [approve / edit / abort]
   ```
3. Responses:
   - **approve** — `guild-plan` updates the plan file with `approved: true`; proceed to
     Phase 4.
   - **edit** — re-invoke `guild-plan` with the existing plan as context. Loop until
     approved or aborted.
   - **abort** — stop. All files remain for resumption.

**No confirmation gates exist after Phase 3.** Phases 4–7 run autonomously per the
approved plan and autonomy contract. Specialists may still ask medium/high-significance
questions mid-execution via `guild-decisions`; those are surfaced as they arise, not
batched here.

---

## Output

After `guild-verify-done` completes, read `.guild/runs/<run-id>/verify.md` and return
a final summary to the user in this format:

```
Guild run <run-id> — <PASS | FAIL>

Task: <spec title from slug>
Specialists dispatched: <list>
Files changed: <count>
Success criteria met: <n>/<total>

<one-paragraph summary from verify.md>

Full report: .guild/runs/<run-id>/verify.md
Review:      .guild/runs/<run-id>/review.md
Handoffs:    .guild/runs/<run-id>/handoffs/
Assumptions: .guild/runs/<run-id>/assumptions.md
```

If the run result is **FAIL**, list the first failing criterion and the evidence gap
that caused it, so the user knows what to address.

If `guild-verify-done` reports a partial pass (some criteria met, some not), surface
the unmet criteria explicitly and suggest next steps (e.g., re-invoke a specific
specialist lane, escalate via `/guild:evolve`).

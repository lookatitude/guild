---
name: guild-team
description: "Team operations — propose a new team, show the current team, or edit it. Per guild-plan.md §13.1. Dispatches to guild-team-compose skill. `edit --allow-larger` lifts the 6-specialist cap from §7.2."
argument-hint: "propose | show | edit [--allow-larger]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Skill
---

# /guild:team — Team operations

This command is the user-facing entry point for Guild's team management layer (guild-plan.md §13.1 and §7).
It is a thin dispatcher: all state management and logic live in the underlying skills.
No writes to `.guild/` are made by this command directly.

---

## Usage

```
/guild:team propose
/guild:team show
/guild:team edit
/guild:team edit --allow-larger
```

**Examples:**

```
# Propose a team for the current spec (must have a spec file first)
/guild:team propose

# Show the current team roster for the active task
/guild:team show

# Interactively edit the current team (respects 6-specialist cap)
/guild:team edit

# Edit team and explicitly lift the 6-specialist cap (§7.2 override)
/guild:team edit --allow-larger
```

Subcommand dispatch table (guild-plan.md §13.1):

| Subcommand | Dispatched skill       | Flag             |
|------------|------------------------|------------------|
| `propose`  | `guild-team-compose`   | —                |
| `show`     | *(reads team YAML directly)* | —          |
| `edit`     | `guild-team-compose`   | `--allow-larger` |

---

## Subcommand: propose

**Plan reference:** guild-plan.md §13.1 row `/guild:team propose` · §7.1 (team-compose workflow).

**Dispatched skill:** `guild-team-compose`

**When to use:** after `guild-brainstorm` has produced a spec file and the user is ready to compose the specialist team. If no spec exists, this subcommand refuses and routes the user to `guild-brainstorm` first.

**Pre-flight check:**

Before dispatching, verify that a spec file exists:

1. Determine the active `<slug>` (most recently modified file under `.guild/spec/`, or ask the user if multiple exist with no clear active run).
2. Check for `.guild/spec/<slug>.md`.
3. If the file does **not** exist, print the following refusal and stop:

```
No spec file found. Run /guild-brainstorm first to produce a spec.

  /guild-brainstorm        ← interactive spec creation
  /guild "your brief"     ← supply an initial brief directly

Once the spec is approved and saved to .guild/spec/<slug>.md,
re-run /guild:team propose to compose the team.
```

Do not invoke any skill. Do not write any files.

**Dispatch pattern:**

If `.guild/spec/<slug>.md` exists, invoke:

```
Skill: guild-team-compose
args: spec=.guild/spec/<slug>.md
```

**Expected outputs from the skill:**

- `.guild/team/<slug>.yaml` — resolved specialist team with per-specialist scope, dependency edges, and backend choice.
- A summary presented to the user: matched specialists, gap decisions, and any implied specialists (Architect for multi-component builds, Security for auth/secrets, QA whenever Backend is present — per §7.2).

---

## Subcommand: show

**Plan reference:** guild-plan.md §13.1 row `/guild:team show` · §7 (team state in `.guild/team/`).

**When to use:** inspect the current resolved team for the active task at any point in the lifecycle.

**No skill dispatch.** This subcommand reads the team YAML directly and pretty-prints it to the session.

**Procedure:**

1. Determine the active `<slug>` (most recently modified file under `.guild/team/`, or ask if ambiguous).
2. Read `.guild/team/<slug>.yaml`.
3. If the file does not exist:

```
No team file found for the active task.

Run /guild:team propose to compose a team from the current spec,
or /guild to start a full lifecycle run.
```

4. If the file exists, pretty-print it in the following format:

```
Team for: <slug>
Backend:  <subagent | agent-team>

Specialists (<n> total):
  1. <role>
     Scope:       <scope summary>
     Depends-on:  <comma-separated list, or "—">

  2. <role>
     ...

Dependencies graph:
  <any depends-on edges listed compactly, e.g. "qa → backend, devops">

Notes:
  <any notes or gap-fill decisions recorded in the YAML>
```

Render all specialists, their scope lines, and dependency edges. Do not summarize or truncate.

---

## Subcommand: edit

**Plan reference:** guild-plan.md §13.1 row `/guild:team edit` · §7.1 (D option: compose from scratch) · §7.2 (cap-6 rule, `--allow-larger` override).

**Dispatched skill:** `guild-team-compose`

**When to use:** after a team has already been proposed, to add or remove specialists, adjust scope per specialist, flip the execution backend choice, or resolve team coverage gaps. This is also the entry point for Gate 2 "edit" responses during the `/guild` lifecycle (see `guild.md` §Gate 2).

**Pre-flight check:**

1. Determine the active `<slug>`.
2. Check for `.guild/team/<slug>.yaml`. If absent, suggest `/guild:team propose` first and stop.

**Cap-6 gating:**

Parse `$ARGUMENTS` for `--allow-larger`. Apply the following rule **before** dispatching:

> If the proposed edit would result in a team exceeding 6 specialists AND `--allow-larger` is **not** present in `$ARGUMENTS`, refuse with:

```
Cap-6 rule (guild-plan.md §7.2): a team cannot exceed 6 specialists without an
explicit override. The proposed edit would bring the team to <n> specialists.

To proceed, re-run with the override flag:

  /guild:team edit --allow-larger

Read the Cap-6 rationale section below before overriding.
```

> If `--allow-larger` **is** present and the team would exceed 6, emit this warning before proceeding:

```
WARNING: --allow-larger is set. Proceeding with <n> specialists.
Context fragmentation risk (§7.2): coherence degrades above 6 specialists.
Team overhead is only justified when the task has genuinely independent lanes.
Confirm you have reviewed the cap-6 rationale before continuing.
```

Then invoke:

```
Skill: guild-team-compose
args: spec=.guild/spec/<slug>.md team=.guild/team/<slug>.yaml [allow-larger=true]
```

Pass `allow-larger=true` only when `--allow-larger` is present.

**Interactive editing flow inside the skill:**

`guild-team-compose` handles the interactive session. The user may:

- **Add a specialist** — the skill checks the running count against the cap before accepting.
- **Remove a specialist** — the skill updates `depends-on:` edges for affected members.
- **Adjust scope** — the skill updates the `scope:` field for the named specialist.
- **Flip backend choice** — toggle between `subagent` (default) and `agent-team` (opt-in, requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, per §7.3).

After each change, `guild-team-compose` re-writes `.guild/team/<slug>.yaml` and presents the updated roster for user confirmation.

---

## Cap-6 rationale (§7.2)

Guild imposes a hard cap of 6 specialists per task run. The rationale is two-fold:

**Context fragmentation.** Each specialist receives a context bundle of ~3k tokens (hard cap 6k). Above 6 specialists, the orchestrator must track 6+ parallel lanes, each with their own state, handoff receipts, and assumption logs. The coordination overhead grows faster than the task coverage benefit — coherence degrades and inter-specialist assumption conflicts multiply.

**Team overhead justification.** The recommended default is 3–4 specialists. Six is the ceiling, not the norm. A team larger than 6 is only justified when the task has genuinely independent lanes that cannot be handled by one specialist's scope expansion. If in doubt, split the task into two sequential `/guild` runs rather than widening the team.

**The `--allow-larger` escape hatch** is available for the rare case where independent lane count genuinely exceeds 6. Using it does not disable safety checks — `guild-team-compose` will warn at each step that coherence risk is elevated. Prefer task decomposition over team expansion.

---

## Unknown subcommand

If `$ARGUMENTS` does not begin with `propose`, `show`, or `edit`, print the following usage help and take no further action:

```
Unknown subcommand: "<the text supplied>"

Usage:
  /guild:team propose             Propose a team from the current spec
  /guild:team show                Show the current team roster
  /guild:team edit                Interactively edit the current team
  /guild:team edit --allow-larger Edit and lift the 6-specialist cap (§7.2)

Notes:
  • propose requires a spec at .guild/spec/<slug>.md — run /guild-brainstorm first if absent.
  • edit --allow-larger emits a context-fragmentation warning before proceeding.
  • show reads .guild/team/<slug>.yaml directly (no skill dispatch).

Dispatches to: guild-team-compose
See guild-plan.md §13.1, §7.1, §7.2, §7.3.
```

Do not invoke any skill. Do not write any files.

---
name: goal
description: "Planning - create or inspect P.O.V.E.R. goals and host-portable task groups from an approved spec. Uses host-native /goal when available, /guild:goal as the portable surface, and guild.task_group.v1 as the fallback when goals are unavailable."
argument-hint: "[new|list|show|from-spec] [slug]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Skill, AskUserQuestion
---

# /guild:goal - P.O.V.E.R. goal and task-group surface

Creates or inspects planning goals. A goal is P.O.V.E.R.-structured:
Problem, Outcome, Validation, Execution, Risks. The command is a Planning
surface, not an implementation shortcut: it can draft goals or task groups, but
Build still requires the approved plan gate.

When the host supports a native `/goal` command, Guild maps the same
`guild.goal.v1` body to the host-native surface. `/guild:goal` remains the
portable Guild surface across hosts. When goal support is unavailable or
inappropriate, Planning emits `guild.task_group.v1`: ordered verifiable tasks
with dependencies, validation, owner/team, project scope, and acceptance
criteria traceability.

## Usage

```
/guild:goal from-spec <slug>
/guild:goal new <slug>
/guild:goal list
/guild:goal show <goal-id>
```

## Args & local flags

- `from-spec <slug>` - read `.guild/spec/<slug>.md` or a `guild.define.v1`
  source and draft goals/task groups for approval.
- `new <slug>` - create a manually authored P.O.V.E.R. goal draft.
- `list` - list goals/task groups known to the current plan or initiative.
- `show <goal-id>` - show one goal or task group and its traceability.

All global flags apply. `--dry-run` prints the proposed goal/task artifacts and
writes nothing.

## Gates

- Goal/task approval **I**
- Plan approval **I** before Build
- Initiative attach/create **I** when the broad-work trigger fires

Broad-work trigger: multi-project work, two or more goals, more than six tasks,
or expected multi-session delivery. The trigger proposes an initiative; it never
silently attaches.

## Output artifact

One of:

- `guild.goal.v1` - P.O.V.E.R. goal preserving acceptance-criteria ids.
- `guild.task_group.v1` - ordered fallback task group preserving dependencies,
  validation, team ownership, project scope, and acceptance-criteria ids.

The artifacts feed `/guild:plan`; they do not bypass team composition,
plan-review, or plan approval.

## Dispatch

Resolve the active Planning phase and current spec/define artifact, then:

1. Validate the source spec or `guild.define.v1` acceptance criteria.
2. Emit `guild.goal.v1` when a goal surface is available.
3. Emit `guild.task_group.v1` when the host lacks goal support or fallback is
   requested.
4. Preserve acceptance-criteria ids for plan, build receipt, QA, and release
   traceability.
5. Ask for approval before `/guild:plan` or `/guild:build`.

Thin planning surface - schema validation lives in
`plugin/src/modules/evals/workflows/goal-task-schema.ts`; plan writing remains
owned by `/guild:plan`.

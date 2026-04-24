# tests/shadow — Shadow-mode cross-cutting fixtures

## Purpose

These fixtures and harness tests target the **shadow mode** implemented by
`scripts/shadow-mode.ts` (guild-plan.md §11.2 step 7). They test whether a
proposed skill's trigger behavior diverges from historical routing as recorded
in trace files.

Shadow mode is **diagnostic and never blocks** — it always exits 0, even when
divergence is high or no historical data exists. These fixtures verify that
contract is upheld across three key scenarios.

## Schema reference

Historical trace files are NDJSON where each line is a JSON object
(`TraceEvent`). The fields consumed by `shadow-mode.ts` are:

| field | type | purpose |
|---|---|---|
| `event` | string | `"UserPromptSubmit"` lines carry the prompt |
| `prompt` | string | The user's raw input (present on UserPromptSubmit events) |
| `specialist` | string | Which specialist handled the event (PostToolUse / SubagentStop) |
| `ts` | string | ISO-8601 timestamp (not used for trigger logic) |
| `ok` | boolean | Whether the event succeeded |
| `ms` | number | Duration in milliseconds |

The proposed skill file is a Markdown file with YAML front-matter containing
at minimum `name:` and `description:` fields. The `description:` field must
include TRIGGER / DO NOT TRIGGER clauses for the heuristic to produce
meaningful results.

Example proposed skill front-matter:

```markdown
---
name: specialist-a
description: TRIGGER for task-write and tool-write requests. DO NOT TRIGGER for specialist-b tasks.
---
```

## Fixture inventory

| Directory | Events | Intent | Expected outcome |
|---|---|---|---|
| `fixtures/historical-agreement/` | 10 | Proposed skill fires identically to historical routing | 0% divergence |
| `fixtures/historical-divergence/` | 10 | Proposed skill fires differently on 3/10 cases | 30% divergence |
| `fixtures/historical-empty/` | 0 | No historical data at all | "no historical data" diagnostic, exit 0 |

## Harness test file

`harness.test.ts` — invokes `scripts/shadow-mode.ts` via `npx tsx` against
each of the three fixture directories and asserts the expected divergence rate
and exit code. A synthetic proposed-skill file is written to the tmp directory
for each test.

## Important constraints

- Shadow mode **always exits 0**. The harness verifies this invariant for all
  three scenarios, including the divergence case.
- The `historical-empty` fixture verifies that zero-event directories are
  handled gracefully and produce a report stating no data was found.
- Fake names (`specialist-a`, `tool-write`, `task-write`, etc.) are used
  throughout to prevent accidental matches against real Guild components.

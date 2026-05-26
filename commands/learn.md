---
name: learn
description: "Understand-everything — owns ALL codebase-understanding capabilities. Sub-verbs: map (CodebaseMap + architecture overview), graph (deep KnowledgeGraph), onboard (guided tour), diff (change analysis), explain (file/module deep-dive). One command, one implementation — same learn-* skills as init --learn. Dispatches to guild:learn-map / learn-graph / learn-onboard / learn-diff / learn-explain."
argument-hint: "<map|graph|onboard|diff|explain> [target] [--rigor=quick|standard|deep]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:learn — understand-everything (`<map|graph|onboard|diff|explain>`)

<!-- §13.1 ADR row: D3 — NEW command, owns understand-everything. Sub-verbs are
     positional ARGUMENTS (D1); never separate files or namespaces. Same learn-*
     skills as `/guild:init --learn` — one implementation, two triggers. -->

The single entry-point for **all codebase-understanding capabilities**. A thin
dispatcher over the `learn-*` skill family (`guild:learn-map`, `learn-graph`,
`learn-onboard`, `learn-diff`, `learn-explain`). The first positional argument
selects the sub-verb; none of the sub-verbs are separate command files or
namespaces (D1).

**One implementation, two triggers (D3):** the pipeline this command runs is
byte-identical to what `/guild:init --learn` and `defaults.auto_learn: true`
invoke. There is no separate codebase-understanding engine.

Canonical surface: `architecture/command-surface.md §1` (sub-verbs as
positional ARGUMENTS) + `docs/knowledge/decisions/
v2x-command-surface-dispatch-and-internalization.md` D3.

---

## Sub-verbs

| Sub-verb | What it does | Skill | Output artifact |
|---|---|---|---|
| `map` | CodebaseMap + architecture overview (cheap-scan tier; fast) | `guild:learn-map` | `.guild/indexes/codebase-map.json`, `wiki/concepts/architecture-map.md` |
| `graph` | Deep semantic KnowledgeGraph (full NLP/heuristic parse; slow) | `guild:learn-graph` | `.guild/indexes/knowledge-graph.json` |
| `onboard` | Guided 5–15 step learning tour through architecture + key concepts | `guild:learn-onboard` | `.guild/indexes/onboarding-tour.md` |
| `diff` | Change analysis — what changed, blast-radius, dependents impacted | `guild:learn-diff` | `.guild/runs/<run-id>/learn/diff-<ts>.md` |
| `explain` | Deep-dive explanation of a file, module, symbol, or concept | `guild:learn-explain` | printed explanation (no file by default) |

---

## Usage

```
/guild:learn map
/guild:learn graph
/guild:learn graph --rigor=deep
/guild:learn onboard
/guild:learn diff
/guild:learn diff src/auth/
/guild:learn explain src/billing/invoice.ts
/guild:learn explain "how does the auth flow work"
```

All five global flags + `--dry-run` apply (`command-surface.md §4`, by
pointer). `--rigor=deep` runs the highest-fidelity graph/analysis pass.

---

## Args & local flags

- Args: `<map|graph|onboard|diff|explain>` — **required** first positional;
  selects the sub-verb. Unknown value ⇒ print usage help, invoke no skill.
- `[target]` — optional second positional; interpreted by each skill:
  - `diff`: a path, commit ref, or branch (defaults to HEAD vs previous).
  - `explain`: a file path, symbol name, or free-text concept.
  - `map` / `graph` / `onboard`: ignored (always whole-repo).
- Local flags: — (no sub-verb-specific local flags beyond global set)

---

## Gates

- `graph` confirmation **I** (deep graph is slow; surface estimated duration
  before starting, confirm or `[skip]`).
- All other sub-verbs: **A** / **R** (fast enough not to gate).

---

## Output artifacts

| Sub-verb | Primary artifact | Overwritten? |
|---|---|---|
| `map` | `.guild/indexes/codebase-map.json` + `wiki/concepts/architecture-map.md` | idempotent (incremental) |
| `graph` | `.guild/indexes/knowledge-graph.json` | idempotent (full rebuild) |
| `onboard` | `.guild/indexes/onboarding-tour.md` | idempotent |
| `diff` | `.guild/runs/<run-id>/learn/diff-<ts>.md` | one per invocation |
| `explain` | prints to console; `--save` writes `.guild/runs/<run-id>/learn/explain-<ts>.md` | — |

---

## Dispatch

Parse `$ARGUMENTS`. The first token must be one of `map`, `graph`, `onboard`,
`diff`, `explain`; all further tokens are forwarded as `args` to the skill.

```
map     → Skill: guild:learn-map     args: $REMAINING_ARGS
graph   → Skill: guild:learn-graph   args: $REMAINING_ARGS
onboard → Skill: guild:learn-onboard args: $REMAINING_ARGS
diff    → Skill: guild:learn-diff    args: $REMAINING_ARGS
explain → Skill: guild:learn-explain args: $REMAINING_ARGS
```

Unknown or absent sub-verb ⇒ print usage help and stop; invoke no skill,
write no files:

```
Usage:
  /guild:learn map                       CodebaseMap + architecture overview
  /guild:learn graph [--rigor=deep]      Deep semantic KnowledgeGraph (slow)
  /guild:learn onboard                   Guided architecture tour
  /guild:learn diff [path|ref]           Change analysis + blast-radius
  /guild:learn explain <path|concept>    Deep-dive explanation
```

All skill logic and `.guild/` writes live in the `learn-*` skill bodies
(clean-room re-authored from the former `understand-engine` /
`understand-onboard` per D4). This command file only dispatches.

---

## Relation to `/guild:init --learn` and `defaults.auto_learn`

This command and `init --learn` / `defaults.auto_learn: true` share **one
implementation** (D3). When Init's full pipeline fires, it calls these same
`learn-*` skills in a sub-set order determined by the init context:

1. `guild:learn-map` (CodebaseMap + architecture stub)
2. `guild:learn-graph` (deep KnowledgeGraph)
3. `guild:learn-onboard` (onboarding tour)

`/guild:learn diff` and `/guild:learn explain` are not called by Init (they
are change-analysis and query-time skills, not bootstrap artifacts). The
`/guild:learn` command can call all five sub-verbs at user discretion.

---

## followups

- `skill-author`: author the `learn-*` family (`guild:learn-map`,
  `learn-graph`, `learn-onboard`, `learn-diff`, `learn-explain`) as
  clean-room re-implementations of the former `understand-engine` /
  `understand-onboard` concepts (D3/D4). One implementation; this command
  dispatches to them; `init --learn` also dispatches to them.
- `docs-writer`: update `architecture/command-surface.md §5.1` with the
  bare-`/guild:guild` spike result (see OPEN VERIFICATION in the D1 ADR).

---
name: evolve
description: "Self-maintenance — run the evolve pipeline on one skill/instance. --auto runs unattended (promotion gate still respected). --to-template=vN is the lazy template-migration trigger (id required). Dispatches to guild:evolve-skill."
argument-hint: "[<id>] [--auto] [--to-template=vN]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:evolve — self-maintenance (Guild-on-Guild)

Kicks off skill evolution. Maps to skill `guild:evolve-skill`.

Canonical surface: `architecture/command-surface.md §3.5` (evolve row + the
canonical grammar block). Migration semantics bound by pointer to
`command-surface.md §3.5` + `decisions/templates-and-migration.md` — not
re-spelled.

## Canonical grammar (verbatim — `command-surface.md §3.5`)

```
/guild:evolve [<id>] [--auto] [--to-template=vN]
```

- **`<id>` (positional, optional)** — the skill or evolvable instance to
  evolve. This is the **same single positional** the legacy `[skill]` form
  named; it is **widened, not duplicated** — `<id>` covers a base skill name
  and an instance id. Omitted ⇒ evolve-skill picks the next eligible target
  from the reflection backlog (unchanged).
- **`--auto`** — run the promotion pipeline unattended; the promotion gate
  is still respected (gate criteria must pass, no regression), unchanged.
- **`--to-template=vN`** — the **lazy template-migration trigger** (`[v2]`).
  With it set, `<id>` is **required** and the run is a template-migration
  evolve to template version `vN` rather than a reflection-driven tune. `vN`
  is the integer template version. Clean-slate grammar: space-separated, no
  colon namespace, value-form `--to-template=vN`.

## Gates

Promotion gate **I** (manual) / **A** (`--auto`, gate-respected). Never
auto-edits a skill without passing the promotion gate; rejected attempts are
archived, not deleted.

## Output

`.guild/evolve/<run-id>/**`, version bump on promote.

## Run recording

Before the evolve-skill is invoked, start a run (SC-B, §435):

```bash
node ${CLAUDE_PLUGIN_ROOT}/hooks/dist/run-trace.js start \
  --command=/guild:evolve \
  --cwd "$(pwd)"
```

`run-class` default (`full`). Records the run before the promotion gate so
the complete session — shadow evaluation, promotion decision, and any
template-migration steps — is replayable from the entrypoint. Writes to
`.guild/evolve/` — not `.guild/initiatives/` (NN#5 unaffected). No
`--initiative` flag.

## Dispatch

```
Skill: guild:evolve-skill
args: $ARGUMENTS
```

If `--to-template=vN` is set without `<id>`, reject (id required for a
template-migration evolve). Pipeline logic and `.guild/` writes live in the
`guild:evolve-skill` skill.

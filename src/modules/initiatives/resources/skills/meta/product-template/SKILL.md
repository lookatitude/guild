---
name: guild-product-template
description: Product-loop TEMPLATE producer — seeds a product idea from a named `guild.template.v1` (cli-tool, web-app, …) into a VALID `guild.explore.v1` + `guild.define.v1` skeleton pair, so the product loop starts from a proven contract. Resolves the template by id, instantiates via the `scripts/instantiate-template.ts` producer (reuses the LW3-1 instantiator + W1 validators, fails closed), and writes the skeletons under `.guild/`. TRIGGER when a product-loop idea matches a known archetype and the operator wants to scaffold from a template ("start from the CLI template", "scaffold a web-app product", "use the <id> template", "seed explore/define from a template"). Seeds artifacts only (refine via guild:product-explore / guild:product-define); never plans, builds, or edits runtime permission/skill/agent files (AC37 no-self-edit). DO NOT TRIGGER for engineering/maintenance prompts, idea exploration with no template (guild:product-explore), PRD authoring (guild:product-define), team composition, or code edits.
when_to_use: Inside the product loop, when a vague idea maps to a known product archetype and the operator wants a template-seeded explore/define skeleton rather than authoring from scratch. Runs before — or as the seed for — guild:product-explore / guild:product-define. Skip it when there is no matching template (fall straight through to guild:product-explore).
type: meta
---

# guild:product-template

A **product-loop seeding step**. When a product idea matches a known archetype (a CLI tool,
a web app, …), this skill instantiates the matching **`guild.template.v1`** into a valid
**`guild.explore.v1` + `guild.define.v1`** skeleton pair, so `guild:product-explore` and
`guild:product-define` refine a real, typed contract instead of a blank page.

It **seeds artifacts only**. It does NOT author the final PRD, plan lanes, compose a team,
or build. It NEVER edits a runtime permission, skill, or agent file (AC37 no-self-edit) —
it writes only under the run's `.guild/explore/` and `.guild/define/` artifact dirs.

## When to use it
- A product-loop idea maps to a known product archetype and the operator wants to scaffold
  from a template ("start from the CLI template", "scaffold a web-app product", "use the
  `<id>` template").

## When NOT to use it
- No matching template exists → fall through to `guild:product-explore` (author from scratch).
- Engineering / maintenance prompts (bug fix, plan-this-feature, PR review, refactor, deploy).
- Writing the PRD / acceptance criteria → `guild:product-define`.
- Planning lanes, composing a team, or editing code / runtime files.

## Available templates
The product templates live at **`${CLAUDE_PLUGIN_ROOT}/templates/products/<id>.template.json`**
(each a `guild.template.v1`). Discover the set with:

```
ls "${CLAUDE_PLUGIN_ROOT}/templates/products/"
```

Each template carries the AC37 field set — `specialists`, `context_questions`,
`artifact_skeletons{explore,define}`, `default_checks`, `docs_expectations`, `release_gates`.
The `artifact_skeletons` are the seeds this skill instantiates.

## How to produce (deterministic — run the producer, do not hand-author)
Instantiation is **deterministic code, not prose** — always run the producer CLI; never
reconstruct the explore/define JSON by hand. The CLI reuses the LW3-1 instantiator and
re-validates the result with the W1 validators, failing closed (non-zero exit) on an invalid
template or a skeleton that would not pass `validateExploreV1` / `validateDefineV1`:

```
# write .guild/explore/<slug>.json + .guild/define/<slug>.json (slug defaults to the template id)
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/instantiate-template.ts" <template-id> --slug=<slug> --cwd="$PWD"

# or preview the pair without writing:
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/instantiate-template.ts" <template-id> --stdout
```

- `<template-id>` — a stable id (e.g. `cli-tool`, `web-app`), OR an explicit path to a
  `*.template.json` file.
- `--slug=<slug>` — output basename (default: the template id). Must be a single safe
  filename segment — the CLI rejects path separators / `..` (no traversal).
- `--out-dir=<dir>` — the `.guild` artifact root (default: `<cwd>/.guild`). The CLI writes
  ONLY `<out-dir>/explore/` + `<out-dir>/define/`. By positive containment it FAILS CLOSED
  if the resolved target (after following any symlink) lands ANYWHERE inside the plugin tree
  except its own `.guild` dir — so instantiation can never edit a runtime permission/skill/
  agent file (AC37). Point it only at a `.guild` artifact root (default), or any path outside
  the plugin.
- `--stdout` — print the `{explore, define}` pair to stdout and write nothing.

If the command exits non-zero, the template is invalid or the produced skeleton failed W1
validation — **do not** patch the JSON by hand; fix the template (`templates/products/…`) or
choose a different one, then re-run. A clean run guarantees both artifacts pass their W1
validators.

## Output contract
- `.guild/explore/<slug>.json` — a valid `guild.explore.v1` (passes `validateExploreV1`).
- `.guild/define/<slug>.json` — a valid `guild.define.v1` (passes `validateDefineV1`).

Both are **seeds**: they are deliberately generic (the template's archetype defaults). Hand
them to `guild:product-explore` to pressure-test the idea's specifics, then to
`guild:product-define` to harden the PRD. The schema sources are
`${CLAUDE_PLUGIN_ROOT}/scripts/lib/{explore,define,template}-schema.ts`.

## Hard rules
- Never edit a runtime permission, skill, or agent file — instantiation is side-effect-free
  except for the `.guild/explore/` + `.guild/define/` artifacts (AC37 no-self-edit).
- Never hand-author the artifacts to "fix" a failing producer run — fail closed and fix the
  template instead.
- This skill seeds; it does not plan, build, or release.

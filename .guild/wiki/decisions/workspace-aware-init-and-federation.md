---
type: decision
owner: architect
confidence: high
importance: high
source_refs:
  - .guild/spec/workspace-aware-init-and-federated-guild.md
  - .guild/plan/workspace-aware-init-and-federated-guild.md
  - docs/knowledge/decisions/guild-boundary-config-and-tracking.md   # CR-D .guild/ ownership map
  - docs/knowledge/implementation/contract-map.md
  - plugin/mcp-servers/guild-memory   # cwd / GUILD_MEMORY_WIKI_ROOT per-query override
created_at: 2026-05-26
updated_at: 2026-05-26
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [guild-boundary-config-and-tracking, config-surface-settings-json, command-clean-slate, continuous-knowledge-and-learning-loop, codebase-understanding, command-surface]
---

# ADR: Workspace-aware Init + federated `.guild/` (query sub-guilds, never duplicate)

## Status

Accepted (2026-05-26). Binding. This ADR is the **single canonical body** for
the `guild.workspace.v1` contract; the contract map (§A) and every skill/script
lane bind it **by pointer** and never re-spell the schema (the same
anti-respell discipline as `learn-map` / `init`). Additive to the frozen v2
contract set — one new self-versioned manifest, one new CR-D ownership-map row,
behavior branches inside existing `init` / `learn` / `wiki` skills. Regular
(non-workspace) repos are unaffected.

Inputs: `.guild/spec/workspace-aware-init-and-federated-guild.md` (SC-1..SC-8,
the three G-spec-locked decisions), `.guild/plan/...` PINNED CONTRACT block
(the schema reproduced verbatim below), CR-D (`.guild/` ownership map +
boundary discipline DH-3), the existing `guild-memory` MCP `cwd` /
`GUILD_MEMORY_WIKI_ROOT` per-query override.

## Context

A **workspace** is a repo that contains other repos / `.guild/` roots inside
it (a monorepo-of-repos / multi-package umbrella). This Guild repo is the
motivating case: `plugin/.guild/wiki/` is a full sub-guild, while the umbrella
root `.guild/` has `runs/` + `spec/` but **no wiki**, and `docs/knowledge/`
holds the cross-cutting workspace knowledge.

Running `/guild:init` or `/guild` from such a root today does the wrong thing
either way: it tries to onboard the whole tree as **one** repo, or it dumps
state into a rootless `.guild/` that duplicates or ignores the real sub-guilds.
There was no notion of "this repo references its sub-projects' memory" — only
"this repo *has* memory." A monolithic root wiki built over the union of all
sub-repos both wastes scan cost and creates a second, drifting copy of
knowledge each sub-guild already owns canonically.

The locked architecture already gives us the mechanism we need without a new
store: the `guild-memory` MCP accepts a per-call `cwd` override (and the
`GUILD_MEMORY_WIKI_ROOT` env var) to point BM25 recall at any `.guild/wiki/`.
So "query a sub-guild" is already possible — what was missing was the
**registry** of which sub-guilds exist and the **recipe** for fanning out
across them.

## Decision

### Federation model — query, don't duplicate

A workspace `.guild/` **federates** to its sub-projects' `.guild/`: it
**references and queries** them rather than **duplicating** their memory and
wiki. Each `.guild/` stays an independent, self-contained memory+wiki; the
workspace `.guild/` carries only (a) a federation **registry** of the
sub-guilds and (b) the **query recipe** for recalling from any of them. No
sub-guild knowledge is ever copied up into the workspace `.guild/`.

Concretely:

- **Detect at Init.** Init classifies the target `regular` or `workspace`. The
  classification signal (which children matched, by which rule) is recorded and
  **surfaced** to the operator — never silent, always overridable.
- **Write a manifest, not a monolith.** On a workspace, Init writes the
  `guild.workspace.v1` manifest (`.guild/workspace.json`) enumerating each
  sub-guild and a top-level `query_recipe`. It does **not** build a root wiki
  over the union of sub-repos.
- **Query fans out.** Workspace-level recall (`/guild:wiki query`,
  `context-assemble`'s kg-query step) iterates the registered sub-guilds via
  the existing `guild-memory` `cwd` override, merges the hits, and **tags each
  hit with its source sub-guild**. A query naming one sub-guild scopes to it.
  Fan-out is read-only recall, never a copy-up.
- **Learn checks children first.** `learn-map` (and Init's cheap-scan) checks
  immediate children for sub-projects / `.guild/` folders before scanning. On a
  workspace it registers/links sub-guilds instead of deep-scanning the union as
  one blob; per-sub-repo learn is delegated/offered, never forced.
- **The manifest self-documents federation.** The `query_recipe` block carries
  inline instructions (the exact `wiki_search` call with a `cwd` override) so
  any reader or agent knows how to reach a sub-guild without external context.

### Detection rule (canonical)

Classify `workspace` **iff ≥1 immediate child directory contains `.git/` OR
`.guild/`.** A child with `.git/` is a sub-project not yet guild-onboarded; a
child with `.guild/` is already a sub-guild. Plain directories (e.g. `docs/`)
match neither and are ignored — correct. Detection is a bounded `.git`/`.guild`
stat over **immediate children only** — no content scan to decide kind. The
`workspace.mode` setting overrides the rule: `on` forces workspace, `off`
forces regular, `auto` (default) applies the rule. Detection by `.git` **or**
`.guild/` presence keys on filesystem presence, **not** `.gitmodules` — these
are independent gitignored repos, not git submodules.

### The `guild.workspace.v1` manifest (canonical schema body)

Path: `<workspace-root>/.guild/workspace.json`. Written by `init`; `shared`
git policy; **not** plugin-static. Bind by pointer in skills/scripts — never
re-spell. This is the single source of truth for the schema:

```jsonc
{
  "schema_version": "guild.workspace.v1",
  "is_workspace": true,
  "detected_at": "<ISO8601>",
  "detection": {
    "depth": 1,                 // FIXED at 1 — no nesting, no knob (D-OQ1)
    "rule": "immediate child has .git/ OR .guild/",
    "mode": "auto"              // settings.json workspace.mode: auto | on | off
  },
  "root_wiki": false,           // D-OQ2 hybrid: true iff workspace root itself has scannable top-level code
  "sub_guilds": [
    {
      "name": "plugin",
      "path": "plugin",               // relative to workspace root
      "kind": "sub-guild",            // "sub-guild" (has .guild/) | "sub-project" (has .git, no .guild/ yet)
      "remote": "github.com/lookatitude/guild",   // best-effort from .git/config; null if none
      "has_wiki": true,               // <path>/.guild/wiki/ exists
      "has_indexes": true,            // <path>/.guild/indexes/ exists
      "last_seen_commit": null        // best-effort HEAD of the sub-repo; null if not a git repo
    }
  ],
  "query_recipe": {
    "mechanism": "guild-memory MCP wiki_search/wiki_get/wiki_list with per-call cwd override (or GUILD_MEMORY_WIKI_ROOT=<path>/.guild/wiki)",
    "fan_out": "iterate sub_guilds where has_wiki; merge results, tag each hit with sub_guild.name",
    "example": "wiki_search({ query: '<q>', cwd: 'plugin' })"
  }
}
```

**Settings key.** `workspace.mode: auto | on | off` (default `auto`) is added
to `.guild/settings.json`. There is **no** `workspace.max_depth` key — depth is
hard-fixed at 1 (see D-OQ1). Unknown `workspace.*` keys are rejected by the
closed-key `config validate` check; allowed `mode` values are `auto|on|off`.

The manifest is a **derived projection**, not a system of record: it is
refreshed idempotently on `/guild:init` and `/guild:learn map`, flagged by
staleness like other indexes, and deletable with zero data loss. Deleting a
sub-guild's own `.guild/` only drops it from the manifest on the next refresh.

### The three G-spec-locked decisions

- **D-OQ1 — Scan depth = 1, hard.** Detect sub-guilds in **immediate children
  only**. Depth is **fixed at 1** (workspace → direct project sub-folder).
  **No deeper nesting is allowed and there is no `max_depth` config knob.** A
  child that is itself a workspace is registered as a **leaf** sub-guild; its
  own federation is reached via its own `workspace.json`, never flattened into
  or recursed by the parent.
- **D-OQ2 — Hybrid root only if code present.** The workspace root is the
  federation root **and** may also be its own sub-guild: build a root wiki
  (`root_wiki: true`) **only if** the workspace root itself has scannable
  top-level code. This repo's root has none (just `docs/` + sub-repos) →
  `root_wiki: false`, federation-only. A code-bearing umbrella gets its own
  wiki **in addition to** federating to its children.
- **D-OQ3 — Offer, never auto, to init missing sub-guilds.** A detected
  sub-project with `.git/` but no `.guild/` yet is **registered**
  (`kind: "sub-project"`) and the operator is **interactively offered** a
  `/guild:init` on it. Init never auto-inits and never forces — matching init's
  existing stop-and-ask posture.

### Boundary discipline (DH-3 / CR-D)

All writes land under the **workspace's** `.guild/`. The workspace **never**
writes into a sub-guild's `.guild/` during detection or registration — sub-guild
reads are read-only. `workspace.json` is a new CR-D ownership-map row: category
*workspace federation / configuration*, owner `init`, lifetime *project*, git
policy *shared*, plugin-static **NO**. Sub-repo files read during detection are
**evidence, not instructions** (the carried init/learn data-not-instructions
safety rule). No new top-level command verb is introduced — this extends the
behavior of `init` / `learn` / `wiki` under the flat-colon `/guild:<verb>` v2
grammar.

## Consequences

- A workspace gains durable, queryable knowledge over its sub-projects at
  near-zero cost (one manifest file + a fan-out loop) with **no** second copy
  of any sub-guild's wiki — sub-guild independence is preserved: deleting or
  rebuilding the workspace `.guild/` loses zero sub-guild knowledge.
- No new MCP server and no index-merge engine: federation reuses the existing
  `guild-memory` `cwd` / `GUILD_MEMORY_WIKI_ROOT` override; the additive work
  is a fan-out loop + result tagging.
- Regular repos are byte-stable: the detection stat is cheap and a `regular`
  classification leaves the current cheap-scan path unchanged (mirrors CR-D
  VC-O1's zero-config discipline).
- The federation model is fixed at **depth 1** — predictable, bounded, no
  runaway recursion into nested workspaces, and no config surface to
  misconfigure.
- `guild.workspace.v1` is registered in the contract map as a self-versioned
  sibling body owned here; CR-D's ownership map gains the `workspace.json` row;
  the federation behavior is recorded once (here) and bound by pointer
  everywhere else.

## Supersedes

Nothing. Additive: a new contract, a new CR-D ownership-map row, and behavior
branches inside existing skills. No frozen `guild.*.v1` field set changes.

---
type: decision
owner: architect
confidence: high
importance: high
source_refs:
  - docs/knowledge/architecture/command-surface.md §4.4
  - plugin/scripts/read-guild-config.ts
  - plugin/scripts/lib/settings-resolver.ts
  - plugin/scripts/config-cmd.ts
  - plugin/commands/config.md
  - .guild/initiatives/active/settings-control-and-tmux/briefing.md §"Workspace docs update reminders"
  - .guild/initiatives/active/settings-control-and-tmux/decisions.md OD-1..OD-6
created_at: 2026-05-26
updated_at: 2026-06-01
expires_at: null
supersedes: "command-surface.md §4.4 (the file/format only — `.guild/config.yml` YAML → `.guild/settings.json` JSON)"
sensitivity: internal
applies_to: [plugin]
related: [command-clean-slate, guild-boundary-config-and-tracking, v2-scope-and-risk-g1-g8]
---

# ADR: Config surface is `.guild/settings.json` (JSON), superseding `.guild/config.yml` (YAML)

## Status

Accepted (2026-05-26, operator decision). Amends — does not re-open — the v2
config schema: the **key set, defaults, precedence ladder, and closed-key
reject rules are unchanged**; only the **file name and serialization format**
change (`.guild/config.yml` YAML → `.guild/settings.json` JSON).

## Context

v2 (`command-surface.md §4.4`, `command-clean-slate`) froze a single project
config file `.guild/config.yml` (YAML) carrying Tier-1 keys + an optional
closed-key `defaults:` block, with a single-file precedence ladder
`CLI flag > --rigor profile > config > built-in default` (later extended to the
7-source workspace/project inheritance chain by the settings-control-and-tmux
amendment below).

The operator requested (2026-05-26): a single JSON config file holding **every**
option, scaffolded at project init **or** via a dedicated command, that the
plugin reads while CLI flags still override it. They explicitly chose
"`settings.json` replaces `config.yml`" over keeping YAML or running two files.

## Decision

**`.guild/settings.json` (JSON) is the single canonical config surface,
replacing `.guild/config.yml` (YAML).**

- The **schema is unchanged**: the same Tier-1 keys + the same closed-key
  `defaults:` block (`command-surface.md §4.4` remains the canonical key-set
  reference); the precedence ladder is the **7-source chain**
  `built-in < workspace < workspace-local < project < project-local < rigor <
  CLI` (canonical in `command-surface.md §4.4`; CLI still wins); the same
  reject rules (unknown `defaults.*` rejected;
  `defaults.wiki.autopromote: true` rejected always; `defaults.adversarial:
  off` rejected for Guild self-build).
- **Serialization** moves YAML → JSON. JSON has no comments, so the scaffold
  embeds a top-level `"_help"` block (key → allowed values + one-line
  description); keys prefixed `_` are annotations the reader ignores.
- **`config.yml` runtime reader removed in v2.0.** This ADR originally
  specified a deprecated back-compat shim (read `config.yml` once, warn, then
  let `settings.json` take over). **That shim was removed in v2.0** (cleanup-
  consolidation W2b) — `config.yml` is never read at runtime. To convert a v1
  `config.yml`, run the on-open converter `/guild:migrate`.
- **Authoring surface**: `/guild config <init|show|validate>` (clean-slate v2
  grammar) — `init` scaffolds `settings.json` with every key=default + the
  `_help` block; `show` prints the resolved config; `validate` runs the
  closed-key checks. `/guild init` scaffolds it at bootstrap if absent
  (idempotent — never clobbers operator config).
  `scripts/read-guild-config.ts` is the single source of truth for the schema,
  defaults, scaffold content, and reject rules (so the three sub-verbs never
  drift).

## Rationale

- Operator preference for JSON + a scaffolding command with self-documenting
  defaults (discoverability — every option visible in one file with `_help`).
- `JSON.parse` is built-in and exact, retiring the hand-rolled flat-YAML
  parser on the primary read path.
- The flags-or-config requirement is already satisfied by the unchanged
  precedence ladder — no behavioral change, only file + format.

## Consequences

- `command-surface.md §4.4` carries a supersession banner pointing here; its
  heading/opening name `settings.json` (JSON) as the file; the documented
  key-set + defaults stand verbatim for the file/format migration (the
  precedence ladder was later extended to the 7-source inheritance chain by the
  settings-control-and-tmux amendment below).
- `MIGRATION.md §3` documents the YAML→JSON surface change. The originally-planned
  one-time `config.yml` back-compat shim was **removed in v2.0** (cleanup-consolidation
  W2b) — `config.yml` is never read at runtime; conversion is via the on-open
  converter / `/guild:migrate`.
- The `settings.json`/`project.yaml` identity-vs-behavior split is unchanged —
  behavior now lives in `settings.json` (e.g. `defaults.wiki.share_mode`).
- No change to any frozen `guild.*.v1` contract — config is not a versioned
  sibling; this is a plugin-config surface, not a schema contract.
- **Post-amendment (2026-05-26):** the closed `defaults:` key set gains a
  documented exception via
  [`v2x-command-surface-dispatch-and-internalization`](v2x-command-surface-dispatch-and-internalization.md)
  — `defaults.auto_learn` (bool, default `false`) is added under `defaults:`,
  `agent_mode` (enum, Tier-1) is added as a top-level key, and
  `defaults.agent_team` is **hard-removed in v2.0** (rejected as an unknown
  key, no warn-once window — see `v2x-command-surface-dispatch-and-internalization`
  D5 reconciliation). Reject rules here are unchanged; only the key set grows.

## Supersedes

The "**ONE config file `.guild/config.yml`**" framing in
`command-surface.md §4.4` — **file and format only**. The other §4.4 elements
(keys, defaults, reject rules, the identity/behavior split) are carried forward
unchanged; the precedence ladder was subsequently extended to the 7-source
inheritance chain by the settings-control-and-tmux amendment below.

---

## Amendment — settings-control-and-tmux initiative (2026-06-01)

### Workspace inheritance (OD-2 — shipped)

The resolver now implements a **7-source inheritance chain** (5 settings
files/profile layers between `built-in` and `CLI`) across workspace and project
settings:

```
built-in
  < workspace .guild/settings.json
  < workspace .guild/settings.local.json
  < project .guild/settings.json
  < project .guild/settings.local.json
  < rigor-profile expansion
  < CLI flags
```

Implementation: `plugin/scripts/lib/settings-resolver.ts` — all runtime
consumers (`workspace/detect.ts`, `lib/run-lifecycle.ts`,
`agent-team-launcher.ts`, `score-tier.ts`) now call `resolveSettings()` instead
of reading `.guild/settings.json` directly. A per-key **source map** tags every
resolved key with its layer: `builtin | workspace | workspace-local | project |
project-local | rigor | cli`.

**Non-inheritable keys:** `workspace.mode` (root-detection-only — a child's
workspace detection applies only to itself — **unconditional**).
`initiative_default` is **conditionally** non-inheriting: it inherits
workspace→child **only when the workspace's `initiative_default` names an
initiative that is `scope:workspace`** (resolved by `initiativeIsWorkspaceScoped`
— registry lookup, then fallback to the initiative's `initiative.yaml`);
otherwise a child resolves its own `initiative_default` or the built-in `null`,
avoiding silently attaching child runs to a project-scoped parent initiative.
*(This is OD-1's "inherit only when workspace-scoped" exception — shipped in
FU-3. The id is validated against path traversal before any file I/O, and the
lookup fails closed to non-inheriting on any invalid/missing/malformed input.)*

**All other keys inherit:** `agent_mode`, `rigor`, `loops`, `loop_cap`,
`codex_cap`, `review`, `providers`, `models`, `security`, `secrets_policy`,
`mcp`, `defaults.team`, `defaults.quality`, `defaults.index`,
`defaults.cross_host`, `record_status_runs`, etc.

For a workspace root command, the workspace layer and the project layer are the
same file. A child project with no `settings.json` inherits every inheritable
key from the workspace root; a child project with a partial `settings.json`
overrides only the keys it sets (deep-merge, not replace).

### `config set/show` subcommand additions (U2 — shipped)

`plugin/scripts/config-cmd.ts` extends the config surface:

```bash
# Write a key at the given scope (workspace | project | local)
npx tsx scripts/config-cmd.ts set <key> <value> --scope workspace|project|local [--cwd <path>]

# Show every resolved key annotated with its source layer
npx tsx scripts/config-cmd.ts show --sources [--cwd <path>]

# Validate the effective resolved config
npx tsx scripts/config-cmd.ts validate --effective [--cwd <path>] [--self-build]
```

`config set` behavior:
- `--scope workspace` writes the workspace-root `.guild/settings.json`, never a
  child's file. This is a **HARD-SET write** (always-asks under auto-approve).
- `--scope project` writes `<cwd>/.guild/settings.json`.
- `--scope local` writes `<cwd>/.guild/settings.local.json`.
- Scoped writes use read-modify-write with dotted key-path set (never clobbers
  unrelated keys, never clobbers `_help` annotations).
- Throws on malformed JSON rather than clobbering.
- Validates every dotted path segment against the closed key set (unknown paths
  are rejected before any write).

`config show --sources` renders the normalized view (briefing §5) — every
resolved key labeled with its source layer — mapped onto the current schema
keys. This is the display shape only; no schema migration (OD-4 minimal-churn).

The shipped `config-cmd.ts` subcommand set is exactly `set | show | validate`.
A `config providers detect` subcommand is a **planned followup — NOT in this
rollout**: the provider-detection library
(`plugin/scripts/lib/provider-detect.ts`, U4) ships and is called by the
run-start preflight (U3), but no standalone `config providers detect` CLI is
wired.

**Precedence wording for rigor-derived keys.** When `rigor` is set from a
non-builtin layer, the keys it expands (`loops`, `loop_cap`, `review`) are
tagged with source `"rigor"` in the source map, not the underlying key's prior
source. An explicit per-layer override of `loops` or `review` beats the rigor
expansion (the key is explicitly set and `wasExplicitlySet()` returns true).
Stated precisely: the effective precedence for `loops`/`loop_cap`/`review` is
`CLI > explicit-key-in-project-local > explicit-key-in-project > explicit-key-in-workspace-local > explicit-key-in-workspace > rigor-expansion > builtin`.

### Review-provider settings

The `review.adversarial.provider` value is supported as `auto` (re-detects
every run — OD-5) or an explicit provider id (set via `config set
review.adversarial.provider <id> --scope workspace`). The `auto` value never
silently persists the recommended provider; the selected provider is recorded
only in run provenance (`resolved-settings.json`). See the canonical provider
detection and selection rules in
`docs/knowledge/adversarial-review/cross-host-review-and-loop-control.md`.

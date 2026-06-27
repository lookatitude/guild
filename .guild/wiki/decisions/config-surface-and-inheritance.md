---
type: decision
owner: architect
confidence: high
importance: high
source_refs:
  - .guild/initiatives/active/init-config-goal/init-config-goal.md §"Settings layer vocabulary"
  - .guild/initiatives/active/init-config-goal/init-config-goal.md §"Inheritance matrix"
  - .guild/initiatives/active/init-config-goal/init-config-goal.md §O lines 96-118
  - .guild/initiatives/active/init-config-goal/init-config-goal.md §E steps 3,5,8,9
  - plugin/src/modules/config/workflows/settings-reader.ts (resolveSettings, discoverWorkspace, deepMerge)
  - plugin/src/modules/config/workflows/settings-resolver.ts (R-TRACE wrapper)
  - plugin/src/modules/config/workflows/config-defaults.ts (DEFAULTS, NON_INHERITABLE_KEYS)
  - plugin/src/modules/config/workflows/init-scaffold-manifest.ts (L1 — this run)
  - plugin/src/modules/config/workflows/host-open-preflight.ts (L1 — this run)
  - .guild/runs/run-8202a843-08f3-4700-b316-61ddc25c5730/handoffs/plugin-architect-L0.md (app/connector OPEN blockers)
created_at: 2026-06-26
updated_at: 2026-06-26
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [config-surface-settings-json, cost-aware-tiering-and-lean-context, command-clean-slate]
---

# ADR: Config surface — scaffold manifest, host-open preflight, and settings inheritance

## Status

Accepted (2026-06-26, lane L1 of init-config-goal, run-8202a843). This ADR is the
contract that lanes **L2** (init/repair/detection implementation), **L3** (host
adapters), and **L4** (config UI metadata) bind to. It does **not** re-open the
key set, defaults, or closed-key reject rules pinned by
[config-surface-settings-json] — it adds the **startup, scaffold, and inheritance**
contracts around that surface.

**Scope (post-L0):** CLI/agents-file native surfaces only. `claude-code-app`,
`claude-code-web`, `codex-app`, `claude-ai-connector` are OPEN blockers
(manual/enqueue-only, no installed plugin package → no native config API); the
preflight contract marks them `action:"blocked"` and never claims a native surface.

## Context

There is one physical `.guild/settings.json` per Guild root, but its **logical
source label depends on the session `cwd`** (a root session vs a child session
read the same files at different layers). Init, host-open init, and repair must
not drift in what they scaffold. Host adapters must never own merge or file-write
logic. These three problems share one resolver/detection/scaffold spine, pinned
below.

## Decision 1 — Resolution precedence (single ladder, all hosts)

The full resolution precedence is **lowest → highest** wins:

```
builtin < workspace < workspace-local < project < project-local < rigor < CLI
```

- `builtin` — canonical `DEFAULTS` (config-defaults.ts).
- `workspace` / `workspace-local` — the ancestor workspace root's
  `.guild/settings.json` / `.guild/settings.local.json`, **only when `cwd` is a child**.
- `project` / `project-local` — the session root's own
  `.guild/settings.json` / `.guild/settings.local.json`.
- `rigor` — the rigor-profile expansion.
- `CLI` — flags passed to `resolveSettings({ flags })`; always win.

This ladder is already implemented in `resolveSettings` (settings-reader.ts) and
emitted as `guild.trace.config_resolution.v1`. L2 preserves it; it does not
re-derive it.

## Decision 2 — `cwd`-relative source-label rule

The physical file → logical layer mapping is determined by **where the session
started**, via `discoverWorkspace(cwd)` (walk UP, **exclusive of cwd**, for the
nearest ancestor `.guild/workspace.json` with `is_workspace:true`):

| Session start | ancestor workspace found? | Root `.guild/settings.json` label | This repo's `.guild/settings.json` label |
|---|---|---|---|
| **Workspace root** (`cwd/.guild/workspace.json`, is_workspace:true) | no (walk is exclusive of cwd) | — | `project` |
| **Workspace child** (under an ancestor workspace root) | yes | `workspace` | `project` (overrides inherited) |
| **Single project** | no | — | `project` |

`settings.local.json` follows the same physical rule: ancestor → `workspace-local`,
this repo → `project-local`. The `sources` map reports the dotted key path
(`workspace.mode`, `models.tiers.mid.claude-code-cli`) labeled with the **winning**
layer. **A root session's own values report as `project`, never `workspace`** —
the `workspace` label exists only for values a child *inherits* from an ancestor.

**§E8 contract:** the resolver MUST consider `cwd` and ancestors so that a session
started **at** a workspace root loads that root's `settings.json` as `project`
(its `discoverWorkspace` returns null because the walk is exclusive of cwd), and a
child session loads the ancestor as `workspace`. The current `discoverWorkspace`
already satisfies this; any L2 patch must preserve the exclusive-of-cwd walk.

## Decision 3 — Adapter-never-owns-merge / never-writes invariant

Host adapters (L3) **render controls and collect intent only**. They MUST NOT:
- merge settings layers,
- read/parse settings files directly for resolution,
- write `.guild/settings*.json` (no `fs` mutators, `child_process`, shell
  redirection, `mv/cp/rm/touch/sed -i`, symlink/hardlink mutation).

The **only** write path is the plugin config API (config reconcile/sync/repair +
scoped `config set` / `config role`), which owns validation, provenance,
never-clobber, the `.guild/settings.lock` advisory lock + pre-read-hash
conflict-retry, and atomic temp-then-rename. Resolution is read only through
`resolveSettings({ cwd })`. (Spec §O line 105, V10; enforced by spy/deny tests.)

## Decision 4 — Inheritance / merge semantics

Merge algorithm across layers: **scalars replace; arrays replace wholesale; plain
objects deep-merge field-by-field; prototype-poison keys (`__proto__`,
`prototype`, `constructor`) are rejected** by the existing safe-object guard
(`deepMerge`). A child object field overrides only that field; omitted child
fields inherit from lower layers. Non-inheritable keys (`NON_INHERITABLE_KEYS`):

- `workspace.mode` — **never** inherits (child/root detection only).
- `initiative_default` — inherits **only** when the named initiative is
  workspace-scoped (registry `scope: workspace` or `initiative.yaml`
  `scope: workspace`); invalid/missing/malformed scope **fails closed** to
  non-inheritance.

Security/secrets/MCP keys inherit with normal merge, then **validate / fail-closed**
where security-sensitive. Default child UI write scope is `project`; `workspace`/
`local` require explicit scope. (Full per-key table: spec §"Inheritance matrix".)

## Decision 5 — Versioned init scaffold manifest (single scaffold contract)

`plugin/src/modules/config/workflows/init-scaffold-manifest.ts` (re-exported at the
spec path `plugin/scripts/lib/init-scaffold-manifest.ts`) is the **one** scaffold
contract. `schema_version = "guild.init_scaffold.v1"`. It exports three arrays of
`ScaffoldEntry { path, kind, source, clobber, repair_required, version?, expected_hash?, description? }`:

- `singleProject` — complete single-project scaffold (the must-exist floor).
- `workspaceRoot` — complete workspace-root scaffold = floor + workspace extras
  (`workspace.json`, `workspace-knowledge/`, `indexes/initiatives-registry.yaml`).
- `repairRequired` — the mode-independent required floor (entries whose absence
  marks any install `installed_needs_repair`). Mode-specific required sets come
  from `requiredEntriesFor(mode)`; `scaffoldFor(mode)` returns the full set.

`/guild:init`, host-open init, and repair all consume this manifest (no second
list). **No-clobber:** `clobber:"never"` is never overwritten once present;
`clobber:"reconcile-only"` (`.guild/settings.json`) changes only via config
reconcile/scoped-write. Repair classifies an existing copy `already_present` only
when content matches `expected_hash` or embedded `schema_version`, else
`skipped_user_modified` (manual review); an entry with neither marker is treated
as user-authored and never overwritten. `.gitignore` is owned by the
gitignore-policy merge path, not by a scaffold entry.

## Decision 6 — Host-open preflight contract (structured data, no UI)

`plugin/src/modules/config/workflows/host-open-preflight.ts` pins the types +
signatures (bodies are L2). Both functions are **pure, read-only, crash-free, and
return structured data only** — they never render UI or write files.

- `detectGuildState(cwd) → GuildStateResult` (`schema_version
  "guild.guild_state.v1"`): `state ∈ {not_installed, single_project,
  workspace_root, workspace_child, installed_needs_repair}` + `projectRoot`,
  `workspaceRoot`, `checkedRequired`, `evidence[]`, and `problem` (non-null only
  for repair: `{problem: "malformed_workspace_json" | "missing_required_manifest_entry",
  path}`). **Never** a silent single-project fallback on malformed/incomplete;
  **never** a crash (V1).
- `hostOpenPreflight(cwd, host) → HostOpenPreflightResult` (`schema_version
  "guild.host_open_preflight.v1"`): runs detection, then maps state →
  `action ∈ {proceed, offer_init, offer_repair, blocked}` with
  `lifecycle_available`, centralized `advisory` (copy from init-config-copy.ts),
  `init_prompt` (InitPromptData with `root_kind`/`child_git_repos`/`branches`),
  `repair_hint`, and an optional `cache_fingerprint`. Hosts ∉ `CLI_NATIVE_HOSTS`
  (the 4 app/connector platforms) → `action:"blocked"`,
  `advisory.code:"host_unsupported"` (L0 OPEN blocker — no false-native path).

## Consequences

- L2 implements `detectGuildState` / `hostOpenPreflight` bodies and
  `initializeGuild` / `repairGuildInstall` against the manifest; it preserves the
  precedence ladder, the exclusive-of-cwd workspace walk, and the merge/fail-closed
  rules verbatim.
- L3 adapters consume `HostOpenPreflightResult` and `CONFIG_UI_METADATA`, render
  natively, and route every write through the plugin config API — no merge, no
  direct file writes.
- L4 keeps `CONFIG_UI_METADATA` in lockstep with `CONFIG_SCHEMA`; safety class →
  confirmation strength may only be raised, never lowered.
- Adding/removing a required scaffold entry is a manifest edit (single place) that
  flows to init, repair, and detection together — scaffold drift is structurally
  prevented.

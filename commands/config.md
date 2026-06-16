---
name: config
description: "Manage the project config surface .guild/settings.json — the single JSON file holding every Guild option (rigor, review/adversarial, host, agent_mode/tmux dispatch ladder, auto-approve gates, loops, quality budgets, wiki). `config init` (= `reconcile sync`) scaffolds it fully-documented and never-clobbers on re-run; `config reconcile check|sync|repair` reconciles `.guild/settings.json` against the typed config-schema SoT (provenance-aware, never overwrites user values, security keys fail closed); `config show` prints the resolved config; `config show --sources` annotates each key with its inheritance layer; `config set` performs a scoped hard-set write; `config validate` / `config validate --effective` runs closed-key checks on the raw or post-inheritance resolved config; `config providers detect` probes available cross-review providers and prints a detection table; `config update-mcp-hashes` re-pins the SHA-256 MCP tool-description hashes (D-MCP). CLI flags always override settings.json (7-source precedence: builtin < workspace < workspace-local < project < project-local < rigor < CLI). Full schema: https://guildstack.dev/docs/configuration"
argument-hint: "<init|set|show|validate|providers|update-mcp-hashes|reconcile> [reconcile: <check|sync|repair>] [--cwd <repo-root>] [--force]"
allowed-tools: Read, Write, Bash
---

# /guild:config — project config surface (`.guild/settings.json`)

`.guild/settings.json` is the single v2 config file. It carries every Guild
option; **CLI flags always override it** (full 7-source precedence ladder,
lowest to highest: `builtin < workspace < workspace-local < project <
project-local < rigor < CLI`).
It replaces the v1
`.guild/config.yml`; **the runtime `config.yml` reader was removed in v2.0** —
`config.yml` is never read at runtime. To convert an old `config.yml`, run
`/guild:migrate`. The schema is closed-key: unknown `defaults.*` keys are
rejected so a typo surfaces.

The sub-verb is the first positional argument.

## `init` — scaffold `.guild/settings.json` (= `reconcile sync`)

**`config init` is now a wrapper around `reconcile sync`** (P1-L9). It materializes the
config with **every** key set to its schema default plus a self-documenting `_help` block,
but goes through the reconciler so it is **never-clobber + provenance-aware**: on a FRESH
repo the output is **byte-identical** to the legacy scaffold (golden-tested, default==today);
on a repo that already has `.guild/settings.json` it **fills only missing keys**, never
overwrites a user-set value, and records provenance + a `last_reconciled_at` timestamp.

```bash
# config init == reconcile sync (never-clobber; fills missing keys to defaults)
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts reconcile sync --cwd "$(pwd)"
```

Steps:
1. Ensure `.guild/` exists.
2. Run `config-cmd.ts reconcile sync` — it writes/updates `.guild/settings.json`,
   filling missing keys to their defaults **without clobbering** any user-set value
   (no `--force` needed; the never-clobber guard replaces it), and stamps provenance +
   `last_reconciled_at`. On a fresh repo this equals the old `--scaffold` output byte-for-byte.
3. If a legacy `.guild/config.yml` is present, tell the operator to run
   `/guild:migrate` to convert it to `settings.json` — `config.yml` is **not**
   read at runtime in v2 (the back-compat reader was removed in v2.0).

(The other reconcile modes — `check` / `repair` — are documented under `## reconcile` below.)

## `set` — scoped hard-set write

Write a single key (including dotted sub-key paths) to the correct settings file
for the named scope. Refuses unknown keys and invalid values. Preserves the
existing `_help` block and all unrelated keys (read-modify-write). Prints
exactly what it wrote and to which file.

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts set <key> <value> --scope workspace|project|local [--cwd <p>]
```

**Scope semantics and inheritance:**

| `--scope` | Target file | When to use |
|---|---|---|
| `workspace` | workspace-root `.guild/settings.json` | Keys that should cascade to all child projects via the 7-source chain (OD-2). Workspace root is discovered by walking up from `--cwd` to the nearest ancestor with `.guild/workspace.json` (`is_workspace: true`). Most keys inherit; `workspace.mode` and `initiative_default` do **not** inherit workspace→child (non-inheritable keys — see inheritance note below). |
| `project` | `<cwd>/.guild/settings.json` | Keys specific to this project only. |
| `local` | `<cwd>/.guild/settings.local.json` | Local developer overrides (gitignored). |

Inheritance chain (lowest to highest precedence):
```
builtin < workspace < workspace-local < project < project-local < rigor < CLI
```
(`rigor` is the `--rigor` profile expansion step between project-local and CLI;
these are the exact `Source` enum values from `scripts/lib/settings-resolver.ts`.)

A workspace-scoped key (`--scope workspace`) cascades to all child projects unless
a child explicitly overrides it. Child files always win over workspace files for
the same key.

**Non-inheritable keys.** Inheritance from workspace→child is restricted for two keys:
- `workspace.mode` — root workspace detection only; never inherits
  (unconditional). A child cannot mutate the parent manifest by setting this key.
- `initiative_default` — inherits workspace→child **only when the workspace's
  `initiative_default` names an initiative that is `scope:workspace`** (resolved
  by `initiativeIsWorkspaceScoped`: registry lookup, then fallback to the
  initiative's `initiative.yaml`). Otherwise it is stripped, so a child resolves
  its own `initiative_default` or the built-in `null` and child runs are never
  silently attached to a project-scoped parent initiative. The id is validated
  against path traversal before any file I/O; the lookup fails closed to
  non-inheriting on any invalid/missing/malformed input.

All other keys in the closed key-set inherit normally down the chain.

**Dotted key paths** are supported for nested settings:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts set defaults.team.size 5 --scope project --cwd /path/to/project
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts set defaults.wiki.share_mode private --scope workspace
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts set agent_mode team --scope workspace --cwd /path/to/child
```

The `set` command validates the key against the closed key-set before writing.
Unknown top-level keys and unknown `defaults.*` sub-keys are **rejected** with
a clear error message (OD-4 minimal-churn: no new keys, only known keys allowed).

## `show` — print the resolved config

Resolve the full 7-source chain (`builtin < workspace < workspace-local <
project < project-local < rigor < CLI`) and print the merged JSON (what
Guild will actually use this run):

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/read-guild-config.ts [--cwd <repo-root>] [flags…]
```

### `show --sources` — annotate each key with its inheritance layer (AC-3)

Print each effective key with its resolved value AND the layer it came from
(builtin / workspace / workspace-local / project / project-local / rigor / cli):

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts show --sources [--cwd <p>]
```

Example output:
```
agent_mode = team  [workspace]
rigor = standard  [builtin]
review = cross  [project-local]
loops = spec,plan  [rigor]
```

This gives full inheritance transparency: you can see which layer is winning for
each key. Use this to debug unexpected setting values across a workspace
hierarchy.

## `validate` — closed-key check

Read `.guild/settings.json` and report pass / violations (unknown `defaults.*`
key; `defaults.wiki.autopromote: true`; `defaults.adversarial: off` for
self-build with `--self-build`). Exits non-zero on a violation.

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/read-guild-config.ts --validate [--cwd <repo-root>] [--self-build]
```

### `validate --effective` — validate the POST-INHERITANCE resolved config

Resolve the full 7-source chain (builtin + workspace + workspace-local + project + project-local + rigor + CLI) and validate
the **merged result** against closed-key rules. This catches violations that only
appear after inheritance — for example, a workspace settings file that sets
`defaults.wiki.autopromote: true` will cause a violation in every child project,
even if the child file itself is clean.

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts validate --effective [--cwd <p>] [--self-build]
```

Exits 0 on a clean resolved config; exits non-zero listing all violations.

## `providers detect` — probe available cross-review providers

Probe every known review provider, print a human-readable detection table, and
show which provider would be recommended for `review=cross`. READ-ONLY — no
settings file is written.

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts providers detect [--cwd <p>]
```

Note: `providers detect` is a two-token form — `providers` is the subcommand
group and `detect` is its sub-verb.

**Output includes:**

- Author host family (resolved from the `host` key in the layered config).
- Review mode currently in effect (`review.mode`).
- A table with one row per known provider:

  | Column | Meaning |
  |---|---|
  | `PROVIDER` | Stable provider id (`codex-plugin`, `codex-cli`, `gemini-cli`, `pi`, `antigravity`). |
  | `KIND` | Reachability class: `host`, `plugin-adapter`, or `cli`. |
  | `FAMILY` | Host family used for the cross-independence check. |
  | `DETECTED` | `yes` if the provider's CLI is on PATH + version probe passed, or a `.guild/hosts/**/capability.json` manifest declares it, or (for plugin-adapters) the native plugin is installed. |
  | `AUTHED` | `yes` if the provider's auth probe passed (codex stored-auth or `OPENAI_API_KEY`; equivalent per provider). |
  | `SELECTABLE` | `yes` only when a real cross-review adapter exists AND detection + auth requirements are met. `gemini-cli`, `pi`, `antigravity` are detect-only (selectable=no) until their adapters ship. |
  | `DETAIL` | Human-readable probe findings. |

- The recommended cross-review provider + reason (re-detected fresh each call; never reads persisted state).

**Example output:**

```
[config-cmd] providers detect
  author host family : claude
  review.mode        : cross

  PROVIDER           KIND             FAMILY       DETECTED  AUTHED  SELECTABLE  DETAIL
  ────────────────── ──────────────── ──────────── ───────── ─────── ─────────── ────────────────────────────────────────
  claude             host             claude       yes       no      no          current author host
  codex-plugin       plugin-adapter   codex        yes       yes     yes         native plugin adapter 'codex-plugin' installed; authed
  codex-cli          cli              codex        no        no      no          not detected; adapter present but not yet usable (detection/auth incomplete)
  gemini-cli         cli              gemini       no        no      no          not detected; detect-only (no adapter yet — not selectable)
  ...

  recommended cross-review : codex-plugin
  reason : claude author prefers the native Codex plugin adapter (codex:codex-rescue); recommended 'codex-plugin' — highest-ranked selectable codex-family reviewer
```

**Exit codes:**

| Exit code | Meaning |
|---|---|
| `0` | Detection ran successfully (even if no selectable provider was found). |
| `2` | `--cwd` does not exist or is not a directory. |

**Relationship to run-start detection:** `runStartPreflight` (U3) performs the
same detection automatically at run-start and records results in
`.guild/runs/<id>/resolved-settings.json`. `providers detect` is the
operator-facing CLI surface to inspect provider state on demand.

## `update-mcp-hashes` — re-pin MCP tool-description hashes (D-MCP)

The operator-facing **re-pin path** for MCP description pinning
(`docs/v2/11-security.md §D-MCP`): compute the SHA-256 of each MCP tool's
description string and write the `{tool-name → hash}` map into
`mcp.tool_description_hashes` in the target settings file. The PreToolUse
hook (`hooks/pre-tool-use.ts` → `hooks/lib/security/mcp-hash-pin.ts`)
compares the pinned hashes at tool-call time; a drifted description warns
and gates on approval. Run this after a deliberate MCP server upgrade to
accept the new descriptions.

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts update-mcp-hashes \
  --tools <json-file> --scope workspace|project|local [--cwd <p>]
```

- `--tools <json-file>` — a JSON object `{ "<tool-name>": "<description>", … }`
  (tool names in the Claude Code `mcp__server__tool` form). Pass `-` (or omit
  the flag) to read the map from stdin.
- `--scope` — required; same scope semantics as `config set` (workspace /
  project / local target file).
- **Merge semantics:** hashes for tools NOT present in the input are
  preserved; the input's tools are (re-)pinned. The write is a
  read-modify-write that preserves `_help` and all unrelated keys, and fails
  closed on a malformed existing file.
- Like `config set`, this is a HARD-SET settings write — it always asks under
  any `auto_approve` posture.

Exit codes: `0` success (prints scope, file, and the per-tool hash prefixes);
`1` bad input / IO error; `2` bad `--cwd`.

## `reconcile <check|sync|repair>` — materialize config against the typed schema (P1-L9)

Reconciles `.guild/settings.json` against the typed config-schema SoT. **Never clobbers a
user-set value** (provenance-gated: only `default`/`reconciled` values are writable); records
per-key provenance + a `last_reconciled_at` timestamp. The mode is a required positional:

- **`check`** — report drift only; writes **nothing** (read-only diagnostic).
- **`sync`** — fill **missing** keys to their schema default (provenance → `reconciled`); keep
  every user value. This is what **`config init`** runs (byte-identical to the legacy scaffold
  on a fresh repo). Run on install / update / `init`.
- **`repair`** — additionally coerce a **malformed** `default`/`reconciled` value back to a
  schema-valid one; still never clobbers a valid user choice. **Security-sensitive keys fail
  closed** — a malformed `security.*` value is coerced to its most-restrictive value or held,
  never silently weakened to the permissive default.

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts reconcile <check|sync|repair> --cwd "$(pwd)"
```

Exit codes: `0` success; `1` bad input / IO error; `2` bad `--cwd`.

## Notes

- **Schema is closed-key.** Only keys present in the built-in `DEFAULTS` shape
  are writable via `config set`. Unknown keys are rejected before any write.
- **`config set` is a HARD-SET write.** It always asks under any `auto_approve`
  posture (writing settings files is always operator-confirmed).
- **`_help` and unrelated keys are preserved.** `config set` is a read-modify-write
  that only touches the named key path — it never clobbers other keys.
- **No schema changes from OD-4.** The normalized view (`show --sources`) maps
  display onto current keys without any flattening. A v2.1 behaviour-group
  flatten (`execution`/`loops`/`review`/`team`/…) is deferred as a followup.
- Every flag has a `settings.json` equivalent; you can drive Guild entirely by
  flags, entirely by `settings.json`, or any mix (flags win).

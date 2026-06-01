---
name: config
description: "Manage the project config surface .guild/settings.json — the single JSON file holding every Guild option (rigor, review/adversarial, host, agent_mode/tmux dispatch ladder, auto-approve gates, loops, quality budgets, wiki). `config init` scaffolds it fully-documented; `config show` prints the resolved config; `config show --sources` annotates each key with its inheritance layer; `config set` performs a scoped hard-set write; `config validate` / `config validate --effective` runs closed-key checks on the raw or post-inheritance resolved config. CLI flags always override settings.json (7-source precedence: builtin < workspace < workspace-local < project < project-local < rigor < CLI). Canonical schema: architecture/command-surface.md §4.4."
argument-hint: "<init|set|show|validate> [--cwd <repo-root>] [--force]"
allowed-tools: Read, Write, Bash
---

# /guild:config — project config surface (`.guild/settings.json`)

`.guild/settings.json` is the single v2 config file. It carries every Guild
option; **CLI flags always override it** (full 7-source precedence ladder,
lowest to highest: `builtin < workspace < workspace-local < project <
project-local < rigor < CLI`; `architecture/command-surface.md §4.3/§4.4`).
It replaces the v1
`.guild/config.yml`; **the runtime `config.yml` reader was removed in v2.0** —
`config.yml` is never read at runtime. To convert an old `config.yml`, run
`/guild:migrate`. The schema is closed-key: unknown `defaults.*` keys are
rejected so a typo surfaces.

The sub-verb is the first positional argument.

## `init` — scaffold `.guild/settings.json`

Generate the config with **every** key set to its default plus a self-documenting
`_help` block (allowed values per key). Do not clobber an existing file unless
`--force`.

```bash
# only write if absent (idempotent); use --force to overwrite
test -f .guild/settings.json && [ "$1" != "--force" ] && echo "exists; pass --force to overwrite" || \
  npx tsx scripts/read-guild-config.ts --scaffold > .guild/settings.json
```

Steps:
1. Ensure `.guild/` exists.
2. If `.guild/settings.json` exists and `--force` was not passed, print its path
   and stop (never silently overwrite operator config).
3. Otherwise run `npx tsx scripts/read-guild-config.ts --scaffold` and write the
   output to `.guild/settings.json`.
4. If a legacy `.guild/config.yml` is present, tell the operator to run
   `/guild:migrate` to convert it to `settings.json` — `config.yml` is **not**
   read at runtime in v2 (the back-compat reader was removed in v2.0).

## `set` — scoped hard-set write

Write a single key (including dotted sub-key paths) to the correct settings file
for the named scope. Refuses unknown keys and invalid values. Preserves the
existing `_help` block and all unrelated keys (read-modify-write). Prints
exactly what it wrote and to which file.

```bash
npx tsx scripts/config-cmd.ts set <key> <value> --scope workspace|project|local [--cwd <p>]
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

**Non-inheritable keys.** Two keys do NOT inherit workspace→child:
- `workspace.mode` — root workspace detection only; a child cannot mutate the
  parent manifest by setting this key.
- `initiative_default` — does not inherit workspace→child, unconditionally. It is
  stripped by `NON_INHERITABLE_KEYS` in the resolver regardless of scope; child
  runs are never silently attached to a parent workspace's initiative.

All other keys in the closed key-set inherit normally down the chain.

**Dotted key paths** are supported for nested settings:

```bash
npx tsx scripts/config-cmd.ts set defaults.team.size 5 --scope project --cwd /path/to/project
npx tsx scripts/config-cmd.ts set defaults.wiki.share_mode private --scope workspace
npx tsx scripts/config-cmd.ts set agent_mode team --scope workspace --cwd /path/to/child
```

The `set` command validates the key against the closed key-set before writing.
Unknown top-level keys and unknown `defaults.*` sub-keys are **rejected** with
a clear error message (OD-4 minimal-churn: no new keys, only known keys allowed).

## `show` — print the resolved config

Resolve the full 7-source chain (`builtin < workspace < workspace-local <
project < project-local < rigor < CLI`) and print the merged JSON (what
Guild will actually use this run):

```bash
npx tsx scripts/read-guild-config.ts [--cwd <repo-root>] [flags…]
```

### `show --sources` — annotate each key with its inheritance layer (AC-3)

Print each effective key with its resolved value AND the layer it came from
(builtin / workspace / workspace-local / project / project-local / rigor / cli):

```bash
npx tsx scripts/config-cmd.ts show --sources [--cwd <p>]
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
npx tsx scripts/read-guild-config.ts --validate [--cwd <repo-root>] [--self-build]
```

### `validate --effective` — validate the POST-INHERITANCE resolved config

Resolve the full 7-source chain (builtin + workspace + workspace-local + project + project-local + rigor + CLI) and validate
the **merged result** against closed-key rules. This catches violations that only
appear after inheritance — for example, a workspace settings file that sets
`defaults.wiki.autopromote: true` will cause a violation in every child project,
even if the child file itself is clean.

```bash
npx tsx scripts/config-cmd.ts validate --effective [--cwd <p>] [--self-build]
```

Exits 0 on a clean resolved config; exits non-zero listing all violations.

## `providers detect` — planned followup (not shipped)

**Not implemented in the shipped `config-cmd.ts`.** The `config-cmd.ts` script
accepts only `set`, `show`, and `validate` sub-verbs. Running
`/guild:config providers detect` will error.

Provider detection is already performed automatically at run-start by
`runStartPreflight` (U3 — `scripts/lib/runstart-preflight.ts`); the detected
providers and recommended reviewer are recorded in
`.guild/runs/<id>/resolved-settings.json`. A standalone `/guild:config providers
detect` CLI path is a planned followup for U4+.

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

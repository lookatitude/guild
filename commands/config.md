---
name: config
description: "Manage the project config surface .guild/settings.json — the single JSON file holding every Guild option (rigor, review/adversarial, host, agent_team/tmux, auto-approve gates, loops, quality budgets, wiki). `config init` scaffolds it fully-documented; `config show` prints the resolved config; `config validate` runs the closed-key checks. CLI flags always override settings.json (precedence: CLI flag > --rigor profile > settings.json > built-in). Canonical schema: architecture/command-surface.md §4.4."
argument-hint: "<init|show|validate> [--cwd <repo-root>] [--force]"
allowed-tools: Read, Write, Bash
---

# /guild:config — project config surface (`.guild/settings.json`)

`.guild/settings.json` is the single v2 config file. It carries every Guild
option; **CLI flags always override it** (precedence ladder
`CLI flag > --rigor profile > settings.json > built-in default`,
`architecture/command-surface.md §4.3/§4.4`). It replaces the v1
`.guild/config.yml` (a back-compat shim still reads an old config.yml until you
migrate). The schema is closed-key: unknown `defaults.*` keys are rejected so a
typo surfaces.

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
4. If a legacy `.guild/config.yml` is present, tell the operator their values
   were migrated into the new file (the resolver's shim handles the read) and
   that `config.yml` is now ignored once `settings.json` exists.

## `show` — print the resolved config

Resolve built-in defaults < `settings.json` < any flags and print the merged
JSON (what Guild will actually use this run):

```bash
npx tsx scripts/read-guild-config.ts [--cwd <repo-root>] [flags…]
```

## `validate` — closed-key check

Read `.guild/settings.json` and report pass / violations (unknown `defaults.*`
key; `defaults.wiki.autopromote: true`; `defaults.adversarial: off` for
self-build with `--self-build`). Exits non-zero on a violation.

```bash
npx tsx scripts/read-guild-config.ts --validate [--cwd <repo-root>] [--self-build]
```

## Notes

- This command implements no config logic itself — `scripts/read-guild-config.ts`
  is the single source of truth for the schema, defaults, scaffold content, and
  the closed-key reject rules (so `init`/`show`/`validate` never drift).
- Every flag has a `settings.json` equivalent; you can drive Guild entirely by
  flags, entirely by `settings.json`, or any mix (flags win).

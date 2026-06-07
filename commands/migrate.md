---
name: migrate
description: "v1→v2 .guild converter — detect, snapshot, and convert a v1 .guild/ directory to v2 layout. Default mode is dry-run (safe: prints plan, writes nothing). Dispatches to the migrate-guild.ts CLI."
argument-hint: "[--root=<path>] [--mode=migrate|dry-run|skip] [--workspace]"
allowed-tools: Read, Write, Bash
---

# /guild:migrate — v1→v2 .guild converter

Detects, snapshots, and converts a v1 `.guild/` directory to the v2 layout.

Canonical surface: `architecture/command-surface.md §2` (maintenance-verb list)
and `§3.5` (the `/guild migrate` self-maintenance table row).

## Usage

```
/guild:migrate                          dry-run scan of cwd (default, safe)
/guild:migrate --mode=migrate           in-place v1→v2 conversion (snapshot first)
/guild:migrate --root=/path/to/repo     target an explicit repo root
/guild:migrate --mode=dry-run           explicit dry-run (same as default)
/guild:migrate --mode=skip              detect + log intent; no snapshot, no convert
/guild:migrate --workspace              fan-out over all child repos in a workspace
```

## Args

- `--root=<path>` — path to the repo root containing `.guild/`. Defaults to cwd.
- `--mode=migrate|dry-run|skip` — conversion mode (default `dry-run`).
  - `dry-run` — detect + print the conversion plan + write the report only; NO mutation. **Safe default.**
  - `migrate` — snapshot `.guild/` → convert to v2 layout → write report. The snapshot is sha256-verified before conversion proceeds; a verify-abort exits non-zero and leaves `.guild/` untouched.
  - `skip` — detect + report intent; no snapshot, no conversion.
- `--workspace` — treat `--root` as a workspace root; fan-out per child `.guild/` (SC-5, depth fixed at 1).

## Gates

- `dry-run` and `skip` modes: **R** (read-only; never mutate).
- `migrate` mode: **I** — always confirm before writing. The snapshot verify-abort is a hard non-zero exit; no partial-write is possible.

## Output

Stdout summary per child (workspace mode) or single root:

```
classification=v1 action=migrated
  snapshot: .guild-snapshots/v1-2026-05-30T12:34:56Z (42 file(s), verified)
  converted: 12 artifact(s) rewritten to v2 schema
```

No `.guild/` artifacts are written in `dry-run` or `skip` mode.

## Run recording

Before the converter is invoked, start a lightweight run (SC-B, §435):

```bash
node ${CLAUDE_PLUGIN_ROOT}/hooks/dist/run-trace.js start \
  --command=/guild:migrate \
  --run-class=lightweight \
  --cwd "$(pwd)"
```

`run-class=lightweight`: migrate is a one-shot idempotent tool, analogous to audit.
No `--initiative` flag (NN#5).

## Dispatch

Invoke the migrate-guild CLI directly:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/dot-guild/migrate-guild.ts \
  [--root=<path>] [--mode=migrate|dry-run|skip] [--workspace]
```

`CLAUDE_PLUGIN_ROOT` resolves to the plugin install root (the directory that
contains this `commands/` folder). Default mode is `dry-run` — the command is
always safe to run without arguments.

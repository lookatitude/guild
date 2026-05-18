---
name: guild status
description: "Orchestrator — read current run state, furthest phase, next gate, blockers. Read-only; never writes."
argument-hint: "[--no-index]"
allowed-tools: Read, Grep, Glob, Bash, Skill
---

# /guild status — lifecycle helper (read-only)

Reads the active run state: current run, furthest phase, next gate, and
blockers. **No phase** — acts on the active run. Read-only **R**, writes no
file.

Canonical surface: `architecture/command-surface.md §3.2` (status row) +
`§2` (3-daily tier). Also surfaces the active team (the v1 team-show path).

## Args & local flags

- Args: — (no positional)
- `--no-index` — per-invocation bypass of the optional read-through cache,
  forcing a one-shot filesystem scan (Invariant FS-CANONICAL, by pointer
  `command-surface.md §5.3`). The filesystem stays canonical; the index is
  never authoritative and never required.

## Gates

None — **R** (read-only).

## Output

Prints state (no file written).

## Dispatch

Thin orchestrator-read entrypoint. Resolve run state by filesystem scan
(or the optional `.guild/index.sqlite` read-through cache unless
`--no-index`), then print furthest phase, next pending gate, blockers, and
the active team. No `.guild/` writes.

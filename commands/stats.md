---
name: stats
description: "Self-maintenance — show usage + telemetry dashboard. Pure read; never writes. --rebuild-index drops + rebuilds the optional cache; --no-index forces a one-shot filesystem scan."
argument-hint: "[--rebuild-index] [--no-index]"
allowed-tools: Read, Grep, Glob, Bash, Skill
---

# /guild:stats — self-maintenance (Guild-on-Guild)

Prints the usage / telemetry dashboard. Telemetry read — **R**, never
writes.

Canonical surface: `architecture/command-surface.md §3.5` (stats row).

## Args & local flags

- Args: — (no positional)
- `--rebuild-index` — drops + rebuilds the optional read-through cache.
- `--no-index` — forces a one-shot filesystem scan (Invariant FS-CANONICAL,
  by pointer `command-surface.md §5.3`). The filesystem stays canonical; the
  index is never authoritative and never required.

## Gates

None — **R** (read-only; never writes telemetry).

## Output

Prints the dashboard (task count, completion rate, flip counts, top skills,
top-requested specialists, open reflection backlog, audit-drift summary). No
file written. `--rebuild-index` only rebuilds the optional cache, not
telemetry data.

## Dispatch

Thin telemetry-read entrypoint. Read `.guild/runs/**` (or the optional
`.guild/index.sqlite` read-through cache; `--rebuild-index` /
`--no-index` control the cache only) and print the dashboard. No `.guild/`
data writes.

---
name: audit
description: "Self-maintenance — static security audit of installed Guild scripts (SHA-256 hashes, network/filesystem flags) + the static boundary-check section. Read-only static analysis. Dispatches to guild:audit."
argument-hint: ""
allowed-tools: Read, Grep, Glob, Bash, Skill
---

# /guild:audit — self-maintenance (Guild-on-Guild)

Static security audit of installed Guild scripts. Maps to skill
`guild:audit`. **R** static analysis — includes the static
**boundary-check** section.

Canonical surface: `architecture/command-surface.md §3.5` (audit row + the
boundary-check description).

## Gates

None — **R** (static analysis only).

## Output

`.guild/audit/<date>.md`, including the **boundary-check** section: it scans
for any Guild-owned-file signature (frontmatter `type:`, a
`schema_version: guild.*` marker, or a `task_run`-declared artifact kind)
written **outside** the consuming repo's `.guild/` (including any runtime
write into the plugin install dir) and flags each as a boundary violation.
This is the static belt to the PreToolUse guard's runtime suspenders; both
reuse existing surfaces and add **no new gate**.

## Dispatch

```
Skill: guild:audit
args: $ARGUMENTS
```

SHA-256 hashes every hook/tooling/MCP file, flags network/egress calls and
filesystem writes outside `.guild/`, runs the static boundary-check, and
writes the dated report. Audit logic and `.guild/` writes live in the
`guild:audit` skill.

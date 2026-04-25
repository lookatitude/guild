---
name: guild-audit
description: "Security audit of installed Guild scripts — SHA-256 hash every file, flag network/filesystem access patterns, and record results. Per guild-plan.md §13.1 and §15.1 #12."
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Skill
---

# /guild:audit — Security audit

This command is the user-facing entry point for Guild's security audit (guild-plan.md §13.1).
It is a thin dispatcher: all static analysis, hash computation, and report authoring
live in the `guild-audit` skill. No writes outside `.guild/audit/` are made by this command directly.

---

## Usage

```
/guild:audit
```

No arguments. The audit always covers the full set of installed Guild files in the current plugin tree.

**Dispatch pattern:**

Invoke the skill with no arguments:

```
Skill: guild-audit
args: (none)
```

---

## What it audits

The `guild-audit` skill performs static analysis over every file in the plugin tree:

| Scope | What is checked |
|-------|----------------|
| `skills/` | SHA-256 hash of each skill file; network access markers (`fetch`, `curl`, `http`, `WebFetch`); filesystem write markers (`Write`, `Edit`, `Bash` with write flags) |
| `commands/` | SHA-256 hash of each command file; unexpected `allowed-tools` entries |
| `agents/` | SHA-256 hash of each agent definition; `isolation:` field present; no `allowed-tools` that would grant web access unless `researcher` role |
| `hooks/` | SHA-256 hash of each hook script; egress markers (outbound network calls, exfiltration patterns) |
| `scripts/` | SHA-256 hash; shell scripts scanned for `curl`/`wget`/`fetch`; JS/TS scanned for `fetch`/`http` |
| `.claude-plugin/plugin.json` | Hash + structural validation (no extra `commands`, `skills`, or `agents` beyond the registered list) |

For each file, the skill records:

- `sha256` — the file's current SHA-256 hash.
- `source` — file path relative to the repo root.
- `network_access` — `true | false | suspicious` (flagged if network markers found outside expected files).
- `fs_write` — `true | false` (flagged if write markers found outside skills that legitimately write state).
- `notes` — any anomalies detected.

---

## Trust boundary

Per guild-plan.md §15.1 #12:

> **Privacy + egress.** Meta-skills are restricted to the filesystem; only the `researcher` specialist
> has web access by default. `/guild:audit` surfaces script hashes.

The audit enforces this boundary by flagging any skill, command, or hook that:

1. Makes outbound network calls (any `fetch`, `curl`, `WebFetch`, `WebSearch` marker) but is **not** the `researcher` specialist or a skill explicitly listed as network-capable in `plugin.json`.
2. Writes to paths outside `.guild/` without the write being traceable to a documented state-management operation.
3. Has a SHA-256 hash that differs from the last recorded audit report — indicating the file was modified outside the normal evolution pipeline.

Drift detection compares the new report against `.guild/audit/<previous-date>.md`. Files with
hash changes are flagged as `CHANGED` and listed prominently at the top of the report.

The audit is **read-only static analysis** — it does not execute scripts or make network calls itself.

---

## Output

The `guild-audit` skill writes a dated report to:

```
.guild/audit/<YYYY-MM-DD>.md
```

The report format:

```
# Guild Security Audit — <YYYY-MM-DD>

## Summary
  Files audited:      <n>
  Hash changes:       <n>  (vs previous audit <prev-date> or "first audit")
  Network flags:      <n>
  Filesystem flags:   <n>
  Anomalies:          <n>

## Hash changes since last audit
  <file-path>   <old-hash>  →  <new-hash>
  ...
  (none)  ← when no changes

## Network access flags
  <file-path>   pattern="<matched text>"   verdict=<expected|unexpected>
  ...

## Filesystem write flags
  <file-path>   pattern="<matched text>"   verdict=<expected|unexpected>
  ...

## Full file manifest
  <file-path>   sha256=<hash>   network=<true|false>   fs_write=<true|false>
  ...
```

After the skill returns, surface the summary line to the session:

```
/guild:audit — done
Report: .guild/audit/<YYYY-MM-DD>.md
Files audited: <n> | Hash changes: <n> | Network flags: <n> | Anomalies: <n>
```

If anomalies are found, list them inline so the user can decide whether to investigate
without having to open the report file.

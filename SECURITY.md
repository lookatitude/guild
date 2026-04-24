# Security policy

Guild ships scripts and hooks that run inside your Claude Code session.
This document explains the trust model and how we handle security.

## Trust model

### What Guild executes

- **Hook scripts** under `hooks/` run on every Claude Code
  `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `SubagentStop`,
  `Stop`, `TaskCreated`, `TaskCompleted`, and `TeammateIdle` event.
  See [hooks/hooks.json](hooks/hooks.json) for the full wiring and
  `docs/architecture.md` for each event's purpose.
- **Tooling scripts** under `scripts/` run only when invoked by a skill
  or by `/guild:evolve`, `/guild:rollback`, etc. They are not auto-run.
- **MCP servers** under `mcp-servers/` run as long-lived stdio subprocesses
  when Claude Code loads the plugin. Both are **read-only** — verified
  mechanically (no `writeFile` / `appendFile` calls in `src/`).
- **Skills** are Markdown with YAML frontmatter. They contain no
  executable code; they are interpreted by Claude, not by the shell.
- **Agents** are similarly Markdown definitions, not executable code.

### What Guild does NOT do

- No network access is made by default. Only the `researcher` shipping
  specialist (`agents/researcher.md`) declares `WebFetch` / `WebSearch`
  in its `tools:` frontmatter. All meta-skills are filesystem-only per
  `guild-plan.md §15.1 #12`.
- No credentials are read, stored, or transmitted.
- No data is sent to telemetry endpoints. `.guild/runs/` and
  `.guild/wiki/` are **project-local** and never leave your machine.
- No auto-updates. Version changes flow through the standard
  `/plugin update guild@guild` path under your explicit control.

### The `/guild:audit` command

Guild ships a built-in security audit at
[commands/guild-audit.md](commands/guild-audit.md) that delegates to
[skills/meta/audit/SKILL.md](skills/meta/audit/SKILL.md). Run it
whenever you install or update a Guild fork:

```text
/guild:audit
```

It produces a static report at `.guild/audit/<YYYY-MM-DD>.md`
enumerating every hook, script, and MCP server with:

- SHA-256 hash (changes flag upstream drift)
- Lines of code
- Any network-call evidence (`fetch`, `http`, `WebFetch`)
- Any filesystem write outside `.guild/runs/` / `.guild/evolve/`
- Declared `tools:` / `allowed-tools:` scope

## Install only from trusted sources

Echoing Anthropic's standard guidance: **install Guild only from
sources you trust.** Forks from third parties may have modified
hooks, skills, or MCP servers that behave differently from the
upstream release. Before installing a non-canonical Guild:

1. Clone it locally.
2. Run `/guild:audit` against the cloned copy.
3. Compare its hashes to the upstream release tags at
   [github.com/lookatitude/guild](https://github.com/lookatitude/guild).
4. Look for any hook script that writes outside `.guild/` or any
   specialist declaring `WebFetch` / `WebSearch` beyond `researcher`.

Unknown network access from a non-researcher specialist is a red flag;
it is not present in the upstream release.

## Reporting a vulnerability

If you find a security-relevant issue in Guild, please do **not** open
a public GitHub issue. Instead:

- Email: `security@lookatitude.com` with `[Guild security]` in the
  subject.
- Include: the affected file, a minimal reproducer, Claude Code version,
  and the output of `/guild:audit` at the affected commit if possible.

We'll acknowledge receipt within 3 business days and aim to ship a fix
or mitigation within 14 days of confirmation.

## Known risk categories (from `guild-plan.md §15.2`)

These are mitigations that ship in v1. Any future contribution that
weakens one of them should be explicitly called out in its PR.

| Risk | Mitigation |
|---|---|
| Cross-group trigger collisions | Pushy `TRIGGER` / `DO NOT TRIGGER` blocks + boundary evals under `tests/boundary/` |
| Stop hook fires on non-task sessions → spurious reflections | Heuristic gate in `hooks/maybe-reflect.ts` (≥1 specialist + ≥1 edit + no error) |
| Evolution loop overfits to its own evals | Versioned skill snapshots + held-out evals + shadow-mode |
| Arbitrary code in installed skills | `/guild:audit` (this command) + the trust-source guidance above |
| Meta-skills gaining network access | `§15.1 #12` policy: meta-skills are filesystem-restricted by convention; any change must be flagged and justified |

## Version support

We support the current major release (`1.x`). Security fixes are
backported one minor version. Pre-release tags (`-beta<N>`) receive
fixes only through the next pre-release; we do not backport to older
pre-releases.

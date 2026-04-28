# Migration: v1.3 → v1.4

This guide covers what changes for operators moving from Guild v1.3 to v1.4.0. The user-visible behaviour of `/guild "<brief>"` with no flags set is byte-for-byte identical to v1.3 (per success criterion SC8). Adversarial loops, auto-approve, the loop iteration cap, audit-log retention, and the status-line are **opt-in** — set an env var or pass a CLI flag to enable them. Three v1.4 surfaces are **always-on** infrastructure that is invisible to v1.3 behaviour but cannot be disabled in v1.4.0:

- The expanded `commands/guild.md` `allowed-tools` list (additive — v1.3 tools preserved verbatim).
- The new hook handlers (`PreToolUse`, `PreCompact`, widened `PostToolUse`) — these only emit telemetry; they do not change dispatch behaviour.
- The JSONL audit log at `.guild/runs/<run-id>/logs/v1.4-events.jsonl` — written when hooks fire, never read by the runtime.

The matrix below distinguishes the three rows.

## At-a-glance

| Area | v1.3 | v1.4 (default) | v1.4 (opted in) |
|---|---|---|---|
| Adversarial loops | absent | absent | enabled per `--loops` value |
| Loop iteration cap | n/a | `16` (when loops opt in) | overridable via `--loop-cap` / `GUILD_LOOP_CAP` |
| Auto-approve | absent | absent | enabled per `--auto-approve` value |
| JSONL audit log | absent | written when hooks fire | same — always written when hooks register |
| Audit-log retention | n/a | `unlimited` | byte cap via `GUILD_LOG_RETENTION` |
| Status-line | absent | absent | enabled per `GUILD_STATUSLINE` / `--statusline` |
| `commands/guild.md` `allowed-tools` | 8 tools | 12 tools (additive) | same |
| Hook handlers | `PostToolUse` (narrow matcher) | `PreToolUse` + `PreCompact` + widened `PostToolUse` | same |

## `commands/guild.md` — `allowed-tools` is additive

The slash command's `allowed-tools` frontmatter gains four entries; v1.3's eight entries are preserved verbatim.

| Version | `allowed-tools` value |
|---|---|
| v1.3 | `Read, Write, Edit, Grep, Glob, Bash, Agent, Skill` |
| v1.4 | `Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList` |

The four new tools are only invoked when loops are active or when an escalation prompt fires. With default flags (`GUILD_LOOPS=none`), the four new tools sit unused — the v1.3 free-text gate path remains the runtime behaviour.

No action required on upgrade. Operators with custom forks of `commands/guild.md` should rebase their `allowed-tools` line onto the v1.4 value.

## New environment variables

All five v1.4 environment variables are opt-in. Defaults preserve v1.3 behaviour where v1.3 had behaviour, and emit no output where v1.3 had no behaviour.

| Env var | Default | What the default means | Accepted values |
|---|---|---|---|
| `GUILD_LOOPS` | `none` | No adversarial loops fire. Specialists run as in v1.3. | `none`, `spec`, `plan`, `implementation`, `all`, or a comma-list subset of `{spec, plan, implementation}` (e.g. `plan,implementation`). |
| `GUILD_LOOP_CAP` | `16` | Per-lane iteration cap, applied **only** when loops are active. Resets at phase boundaries. | Positive integer in `[1, 256]`. |
| `GUILD_AUTO_APPROVE` | `none` | No gates auto-approve; the operator approves spec/plan/implementation manually as in v1.3. | `none`, `spec-and-plan`, `implementation`, `all`. |
| `GUILD_LOG_RETENTION` | `unlimited` | The audit log is never trimmed; archives accumulate. | Positive integer suffixed with `MB` or `GB` (e.g. `500MB`, `2GB`), or the literal `unlimited`. |
| `GUILD_STATUSLINE` | `0` | The status-line script emits no output. See `docs/status-line.md` to wire it in. | `0` (off), `1` (on). Empty string is treated as `0`. |

The "default" semantics differ per variable. `none` and `0` are **disabled-state** defaults — Guild does nothing extra. `16` is the **active value** the loop driver uses *if* loops opt in. `unlimited` keeps the audit trail complete.

### Invalid values

Both `--loops` and `GUILD_LOOPS` reject invalid values with exit code `2`. The full emitted stderr line has the form:

```
error: --loops value '<raw>' is invalid; --loops must be one of none|spec|plan|implementation|all or a comma-list of {spec,plan,implementation}
```

`<raw>` is the offending value. To grep your logs for any rejection, match on the constant suffix (everything after `is invalid; `):

```
--loops must be one of none|spec|plan|implementation|all or a comma-list of {spec,plan,implementation}
```

`GUILD_LOG_RETENTION` rejects invalid values with exit code `2`. The full emitted line:

```
error: GUILD_LOG_RETENTION value '<raw>' is invalid; GUILD_LOG_RETENTION must be a positive integer suffixed with MB|GB, or the literal "unlimited"
```

Constant suffix for grepping:

```
GUILD_LOG_RETENTION must be a positive integer suffixed with MB|GB, or the literal "unlimited"
```

## New CLI flags

Each new env var (except `GUILD_LOG_RETENTION`) has a CLI flag mirror. CLI values override env values; env values override defaults.

| CLI flag | Mirrors env | Default | Notes |
|---|---|---|---|
| `--loops=<value>` | `GUILD_LOOPS` | `none` | Same grammar as the env var. Single keyword OR comma-list. |
| `--loop-cap=<N>` | `GUILD_LOOP_CAP` | `16` | Positive integer in `[1, 256]`. |
| `--auto-approve=<tier>` | `GUILD_AUTO_APPROVE` | `none` | Same value set as the env var. |
| `--statusline` | `GUILD_STATUSLINE` | off | Bare `--statusline` is opt-in (`true`); `--statusline=0` / `--statusline=1` are explicit. `--statusline=yes` exits `2`. |

`GUILD_LOG_RETENTION` has no CLI flag in v1.4.0 — set it via the environment.

The flags are **global**: they may appear before the subcommand on the command line.

## Opting into adversarial loops

The `--loops` flag selects which adversarial loop layers fire. v1.4 ships three layers, each independently opt-in:

| Layer | Trigger value | Wraps |
|---|---|---|
| F-1 | `spec` | `guild:brainstorm` (architect ↔ researcher) |
| F-2 | `plan` | `guild:plan` (architect ↔ security) |
| F-3 | `implementation` | `guild:execute-plan` (per-lane review) |

The keyword `all` enables all three layers; a comma-list (e.g. `--loops=plan,implementation`) enables a chosen subset; `none` (the default) keeps every layer off.

Each loop layer **wraps** the existing v1.3 skill — it does not replace it.

### Single-keyword forms

```bash
/guild --loops=none "<brief>"            # default; no loops fire
/guild --loops=spec "<brief>"            # F-1 only
/guild --loops=plan "<brief>"            # F-2 only
/guild --loops=implementation "<brief>"  # F-3 only
/guild --loops=all "<brief>"             # F-1 + F-2 + F-3 all fire
```

### Comma-list form

The comma-list form selects a subset of `{spec, plan, implementation}`. Order does not matter; duplicates are deduplicated. No spaces.

```bash
/guild --loops=plan,implementation "<brief>"
/guild --loops=spec,implementation "<brief>"
```

`none` and `all` are single-keyword forms only — neither may appear inside a comma-list. Mixing rejects with exit `2` and the verbatim stderr line above.

### Cap and reset boundaries

When a loop fires, it iterates until the termination contract is met or the cap is hit. The default cap is `16` per lane; counters reset at phase transitions. Override via `--loop-cap=<N>` or `GUILD_LOOP_CAP=<N>`.

A separate restart cap of `3` per lane per task limits how many times a lane re-enters from a security-driven restart. The restart cap is not currently configurable.

## New audit-log channel

v1.4 adds a structured JSONL audit log alongside the existing v1.3 telemetry channel.

| Channel | Path | Format | Source |
|---|---|---|---|
| v1.3 (continues) | `.guild/runs/<run-id>/events.ndjson` | Newline-delimited JSON, v1.3 schema | `capture-telemetry.js` PostToolUse handler |
| v1.4 (new) | `.guild/runs/<run-id>/logs/v1.4-events.jsonl` | Newline-delimited JSON, v1.4 schema (12 event types) | `post-tool-use.js` + `pre-tool-use.js` + `pre-compact.js` handlers |

Both channels coexist. The v1.3 file remains the source for existing scoring and reflection consumers; v1.4 consumers read the new file. Nothing reads-then-rewrites either file.

### Where rotated archives land

When an archive rotation occurs, the archived file lands at:

```
.guild/runs/<run-id>/logs/archive/v1.4-events.<N>.jsonl.gz
```

`<N>` is the rotation index, increasing monotonically. The live log is recreated empty. Archive deletion is **not** automatic in v1.4 — `GUILD_LOG_RETENTION` is advisory: when the retained byte footprint exceeds the cap, the runner emits stderr warnings but does not delete archives.

### Hooks register additively

`hooks/hooks.json` registers two new hook events (`PreToolUse` with matcher `*`, `PreCompact`) and widens the `PostToolUse` matcher from v1.3's `Agent|Task|Write|Edit|Bash|Skill` to `*`. The existing v1.3 `capture-telemetry.js` handler stays in the `PostToolUse` block alongside the new `post-tool-use.js` handler. Older Claude Code hosts that do not dispatch `PreToolUse` or `PreCompact` skip silently.

## What v1.3 operators must do at upgrade

| You currently rely on… | Action on upgrade |
|---|---|
| Default `/guild` lifecycle, no flags | None. v1.3 surface is preserved byte-for-byte. |
| Custom fork of `commands/guild.md` | Rebase `allowed-tools` onto the v1.4 line above. |
| Reading `.guild/runs/<run-id>/events.ndjson` | None. The file is still written by `capture-telemetry.js`. |
| Custom shell aliases for `/guild` invocations | None — the new flags are global and additive. |
| Status-line wiring | Optional. See `docs/status-line.md` to wire the new script. |

## Quick reference — opting into v1.4 features

| Goal | Command |
|---|---|
| Run with all loop layers active | `/guild --loops=all "<brief>"` |
| Run with plan + implementation loops, cap 8 | `/guild --loops=plan,implementation --loop-cap=8 "<brief>"` |
| Run with auto-approve through implementation | `/guild --auto-approve=implementation "<brief>"` |
| Cap audit-log footprint at 500 MB | `GUILD_LOG_RETENTION=500MB /guild "<brief>"` |
| Enable the status-line | `GUILD_STATUSLINE=1 /guild "<brief>"` (then wire `~/.claude/settings.json` per `docs/status-line.md`) |

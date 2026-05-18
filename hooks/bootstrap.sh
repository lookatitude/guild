#!/usr/bin/env bash
# hooks/bootstrap.sh
#
# Event:   SessionStart
# Purpose: Injects a short Guild status block and command list into the session.
#          Does not assume a skill can be forcibly invoked; /guild loads the full workflow.
#          (§13.2: "does not assume a skill can be forcibly invoked; /guild loads the full workflow")
#
# Stdin:   JSON — Claude Code SessionStart hook payload (may be empty / ignored).
# Stdout:  1-screen Guild status block (Claude Code displays this at session start).
# Stderr:  Error messages on failure.
# Exit:    Always 0 — non-interactive.

set -euo pipefail

# ── Resolve plugin root ────────────────────────────────────────────────────
# hooks/ lives inside the plugin; plugin.json is one level up.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_JSON="${PLUGIN_ROOT}/.claude-plugin/plugin.json"

# ── Failure guard: validate CLAUDE_PLUGIN_ROOT ────────────────────────────
# If CLAUDE_PLUGIN_ROOT is set but invalid, reset it to our resolved path so
# downstream hooks that export ${CLAUDE_PLUGIN_ROOT} don't silently fail.
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]] && [[ ! -d "${CLAUDE_PLUGIN_ROOT}" ]]; then
  echo "[Guild] warn: CLAUDE_PLUGIN_ROOT (${CLAUDE_PLUGIN_ROOT}) is not a directory; resetting to resolved plugin root." >&2
  export CLAUDE_PLUGIN_ROOT="${PLUGIN_ROOT}"
elif [[ -z "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  export CLAUDE_PLUGIN_ROOT="${PLUGIN_ROOT}"
fi

# If plugin.json is missing the install is broken — emit a diagnostic and
# print a minimal banner so the session doesn't appear blank.
if [[ ! -f "${PLUGIN_JSON}" ]]; then
  cat <<BROKEN
[Guild] ERROR: plugin.json not found at ${PLUGIN_JSON}
  The Guild plugin directory may be wrong or incomplete.
  Fix: check ~/.claude/settings.json enabledPlugins path and re-open Claude Code.
  Plugin root resolved to: ${PLUGIN_ROOT}
BROKEN
  exit 0
fi

# ── Read Guild version from plugin.json ────────────────────────────────────
GUILD_VERSION="(unknown)"
if command -v python3 &>/dev/null && [[ -f "${PLUGIN_JSON}" ]]; then
  GUILD_VERSION="$(python3 -c "
import json, sys
try:
  d = json.load(open('${PLUGIN_JSON}'))
  print(d.get('version', '(unknown)'))
except Exception as e:
  print('(unknown)')
" 2>/dev/null || echo "(unknown)")"
fi

# ── Print status block ─────────────────────────────────────────────────────
cat <<STATUS
┌─────────────────────────────────────────────────────────────────┐
│  Guild ${GUILD_VERSION} — self-evolving specialist teams for Claude Code   │
├─────────────────────────────────────────────────────────────────┤
│  Commands (daily tier — full surface via /guild status)         │
│                                                                 │
│    /guild [brief]      run from the right phase, auto-detected  │
│    /guild status       where am I, what's next, resume hint     │
│    /guild wiki <ingest|query|lint>   project knowledge          │
│                                                                 │
│  First run on a new repo → /guild proposes /guild init          │
│  Guild v2 dropped the ':' namespace — every command is now      │
│  /guild <subcommand>  (full v1→v2 map: MIGRATION.md).           │
│                                                                 │
│  Optional MCP servers (pre-bundled; no install needed):         │
│    guild-memory       BM25 wiki search                          │
│    guild-telemetry    Trace query over .guild/runs/             │
├─────────────────────────────────────────────────────────────────┤
│  Plan & architecture: guild-plan.md (start at §1 or §13.2)     │
│  Docs: docs/architecture.md, docs/specialist-roster.md          │
└─────────────────────────────────────────────────────────────────┘
STATUS

exit 0

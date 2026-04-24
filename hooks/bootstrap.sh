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
│  Available commands                                             │
│                                                                 │
│    /guild              Full workflow: brainstorm → team →       │
│                        plan → execute → review → reflect        │
│    /guild:wiki         Manage the project knowledge wiki        │
│    /guild:team         Compose or inspect the specialist team   │
│                                                                 │
│  Forthcoming (P6):                                              │
│    /guild:evolve       Skill self-improvement pipeline          │
│    /guild:rollback     Roll back a skill to a prior version     │
│    /guild:audit        Surface plugin script hashes             │
│    /guild:stats        Task + telemetry summary                 │
├─────────────────────────────────────────────────────────────────┤
│  Plan & architecture: guild-plan.md (start at §1 or §13.2)     │
└─────────────────────────────────────────────────────────────────┘
STATUS

exit 0

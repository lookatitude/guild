#!/usr/bin/env bash
# hooks/bootstrap.sh
#
# Event:   SessionStart
# Purpose: Injects a short Guild status block and command list into the session.
#          Does not assume a skill can be forcibly invoked; /guild loads the full workflow.
#          (§13.2: "does not assume a skill can be forcibly invoked; /guild loads the full workflow")
#
# Stdin:   JSON — host SessionStart hook payload (may be empty / ignored).
# Stdout:  1-screen Guild status block (hosts with SessionStart support display this).
# Stderr:  Error messages on failure.
# Exit:    Always 0 — non-interactive.

set -euo pipefail

# ── Resolve plugin root ────────────────────────────────────────────────────
# hooks/ lives inside the plugin; plugin.json is one level up.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_JSON="${PLUGIN_ROOT}/.claude-plugin/plugin.json"

# ── Failure guard: validate plugin-root environment ───────────────────────
# GUILD_PLUGIN_ROOT is Guild's host-neutral variable. Claude Code still injects
# CLAUDE_PLUGIN_ROOT, so keep it as a compatibility alias for Claude hooks.
ROOT_FROM_ENV="${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
if [[ -n "${ROOT_FROM_ENV}" ]] && [[ ! -d "${ROOT_FROM_ENV}" ]]; then
  echo "[Guild] warn: plugin root env (${ROOT_FROM_ENV}) is not a directory; resetting to resolved plugin root." >&2
  export GUILD_PLUGIN_ROOT="${PLUGIN_ROOT}"
elif [[ -z "${ROOT_FROM_ENV}" ]]; then
  export GUILD_PLUGIN_ROOT="${PLUGIN_ROOT}"
else
  export GUILD_PLUGIN_ROOT="${ROOT_FROM_ENV}"
fi
export CLAUDE_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${GUILD_PLUGIN_ROOT}}"

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

# ── Self-check: scripts runtime deps present (issue #14) ──────────────────
# Compiled hooks bundle js-yaml, but the tsx scripts under scripts/ resolve it
# from scripts/node_modules at runtime. Surface a one-line actionable warning
# instead of letting every script die with a resolution stack trace.
if [[ -f "${GUILD_PLUGIN_ROOT}/scripts/package.json" ]] \
  && { [[ ! -d "${GUILD_PLUGIN_ROOT}/scripts/node_modules/js-yaml" ]] \
    || [[ ! -d "${GUILD_PLUGIN_ROOT}/scripts/node_modules/argparse" ]]; }; then
  echo "[Guild] warn: scripts runtime deps missing — run: npm install --prefix \"${GUILD_PLUGIN_ROOT}/scripts\" --omit=dev" >&2
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

# ── Write host-capability manifest (RE-5, idempotent) ─────────────────────
# Ensures .guild/hosts/<host-id>/capability.json exists before the cross-host
# router (RE-4) needs it. The script is atomic (temp-then-rename) and never
# deletes or replaces a fresh same-session file — true idempotent at write time.
# Failure is non-fatal: the router reads a degraded/absent manifest gracefully.
_WRITE_CAPABILITY="${PLUGIN_ROOT}/scripts/write-host-capability.ts"
if [[ -f "${_WRITE_CAPABILITY}" ]] && command -v npx &>/dev/null; then
  npx --yes tsx "${_WRITE_CAPABILITY}" \
    --cwd "${PWD}" \
    --source "session-start" >/dev/null 2>&1 || true
fi

# ── Print status block ─────────────────────────────────────────────────────
cat <<STATUS
┌─────────────────────────────────────────────────────────────────┐
│  Guild ${GUILD_VERSION} — self-evolving specialist teams for AI hosts      │
├─────────────────────────────────────────────────────────────────┤
│  Commands (daily tier — full surface via /guild:status)         │
│                                                                 │
│    /guild:guild [brief]  run from the right phase, auto-detected│
│    /guild:status       where am I, what's next, resume hint     │
│    /guild:wiki <ingest|query|lint>   project knowledge          │
│                                                                 │
│  First run on a new repo → /guild:guild proposes /guild:init    │
│  Guild v2 keeps the ':' namespace and drops the redundant       │
│  'guild' prefix — commands are /guild:<verb>                    │
│  (full map: MIGRATION.md).                                      │
│                                                                 │
│  Optional MCP servers (pre-bundled; no install needed):         │
│    guild-memory       BM25 wiki search                          │
│    guild-telemetry    Trace query over .guild/runs/             │
├─────────────────────────────────────────────────────────────────┤
│  Plan & architecture: guild-plan.md (start at §1 or §13.2)     │
│  Docs: the Guild docs site · docs/specialist-roster.md          │
└─────────────────────────────────────────────────────────────────┘
STATUS

# ── FU-E: self-build context detection + codex-review enforcement banner ──
# Self-build = working on the Guild plugin itself. Detected when the cwd has
# a plugin/CLAUDE.md whose orientation banner matches. In self-build sessions
# Codex adversarial review is "implicitly always-on" — but two consecutive
# self-build reflections (docs-clean-up + share-dot-guild) named codex-review
# skipping as a discipline gap. This panel makes the rule visible at every
# session start so the orchestrator can't silently skip it.
if [[ -f "${PWD}/plugin/CLAUDE.md" ]] && grep -q "Guild — repo orientation" "${PWD}/plugin/CLAUDE.md" 2>/dev/null; then
  # Detect codex availability — binary on PATH AND usable auth exists.
  # Usable auth = (a) non-empty auth.json at ${CODEX_HOME:-$HOME/.codex}/auth.json,
  #               OR (b) non-empty OPENAI_API_KEY.
  # (Mirrors the pane-adapter preflight: same shared detection contract.)
  CODEX_OK=0
  if command -v codex >/dev/null 2>&1 && codex --version >/dev/null 2>&1; then
    _auth_file="${CODEX_HOME:-$HOME/.codex}/auth.json"
    if [[ -s "${_auth_file}" || -n "${OPENAI_API_KEY:-}" ]]; then
      CODEX_OK=1
    fi
  fi

  if [[ "${CODEX_OK}" == "1" ]]; then
    cat <<'SELFBUILD_OK'
┌─────────────────────────────────────────────────────────────────┐
│  ⚠  SELF-BUILD DETECTED  ⚠                                       │
│                                                                 │
│  You are working on the Guild plugin itself. Codex adversarial  │
│  review is IMPLICITLY ALWAYS-ON for every G-spec / G-plan /     │
│  G-lane gate (plugin/CLAUDE.md §"Codex adversarial review").    │
│                                                                 │
│  ✓ codex CLI + auth detected (codex login or OPENAI_API_KEY).   │
│    Invoke at every gate via `guild:codex-review` or              │
│    `Agent({subagent_type: "codex:codex-rescue", …})`.           │
│                                                                 │
│  Skipping a gate is a discipline gap. Each reflection records   │
│  `codex_review: RAN` or `SKIPPED`; 3 consecutive SKIPPED trips  │
│  a blocking sentinel + non-zero Stop-hook exit (FU-E).          │
└─────────────────────────────────────────────────────────────────┘
SELFBUILD_OK
  else
    cat <<'SELFBUILD_FAIL'
┌─────────────────────────────────────────────────────────────────┐
│  ⚠  SELF-BUILD DETECTED — CODEX UNAVAILABLE  ⚠                   │
│                                                                 │
│  You are working on the Guild plugin itself. Codex adversarial  │
│  review is IMPLICITLY ALWAYS-ON for every G-spec / G-plan /     │
│  G-lane gate — but codex isn't reachable here.                  │
│                                                                 │
│  Missing one or more of:                                        │
│    □ `codex` binary on PATH (run `codex --version`)             │
│    □ codex login session (<CODEX_HOME>/auth.json) OR non-empty  │
│      OPENAI_API_KEY                                             │
│                                                                 │
│  Required discipline when codex is unavailable: emit            │
│    `warn: codex-review skipped — codex plugin not installed`    │
│  AT EACH GATE before proceeding. Every reflection MUST record   │
│  the skip as frontmatter `codex_review: SKIPPED` (a real        │
│  review records `codex_review: RAN`). After 3 consecutive       │
│  SKIPPED reflections, the Stop hook (maybe-reflect.ts) writes   │
│  a blocking sentinel `.guild/codex-skip-streak.json` AND exits  │
│  non-zero with a loud DISCIPLINE banner — the next G-gate must  │
│  refuse until codex runs or the streak is cleared.              │
│                                                                 │
│  Followup ref: FU-E in share-dot-guild closeout                 │
│  (.guild/initiatives/archived/share-dot-guild/release/).        │
└─────────────────────────────────────────────────────────────────┘
SELFBUILD_FAIL
  fi

  # ── FU-3: docs-hygiene lifecycle hook surface ─────────────────────────────
  # Parse the last hygiene scan if present and show flag totals. The scan is
  # not run here (it costs ~2s); operator invokes it explicitly via
  # `npx tsx plugin/scripts/docs-hygiene/scan.ts` or `/guild:wiki lint`. The
  # standing display turns the scan into a continuous-feedback hook without
  # adding wall-clock cost to every session start.
  SCAN_FILE="${PWD}/plugin/scripts/docs-hygiene/.last-scan.md"
  if [[ -f "${SCAN_FILE}" ]]; then
    # Extract counts from the scan output's summary markdown table.
    # Table shape: "| <Label> | <count> |". Use awk to take the 3rd pipe column
    # so labels like "Drift markers (v1/single-repo)" don't pollute the match.
    parse_count() {
      awk -F'|' -v label="$1" '
        index($0, label) && NF >= 3 {
          gsub(/[[:space:]]/, "", $3);
          if ($3 ~ /^[0-9]+$/) { print $3; exit }
        }
      ' "${SCAN_FILE}"
    }
    DRIFT=$(parse_count "Drift markers")
    PROGRESS=$(parse_count "Progress messaging")
    DREL=$(parse_count "Dangling related")
    DSRC=$(parse_count "Dangling source_refs")
    MISS=$(parse_count "Missing importance")
    SEC=$(parse_count "Secrets grep")
    : "${DRIFT:=0}" "${PROGRESS:=0}" "${DREL:=0}" "${DSRC:=0}" "${MISS:=0}" "${SEC:=0}"
    TOTAL=$(( ${DRIFT:-0} + ${PROGRESS:-0} + ${DREL:-0} + ${DSRC:-0} + ${MISS:-0} + ${SEC:-0} )) 2>/dev/null || TOTAL="?"
    SCAN_AGE_DAYS=$(( ( $(date +%s) - $(stat -f %m "${SCAN_FILE}" 2>/dev/null || stat -c %Y "${SCAN_FILE}" 2>/dev/null || echo 0) ) / 86400 ))
    # Show panel only if scan is stale (>1 day) or there are flags worth surfacing.
    if [[ "${TOTAL}" != "0" && "${TOTAL}" != "?" ]] || [[ "${SCAN_AGE_DAYS}" -gt 1 ]]; then
      printf "┌─────────────────────────────────────────────────────────────────┐\n"
      printf "│  📋  docs-hygiene status (last scan: %2dd ago)                    │\n" "${SCAN_AGE_DAYS}"
      printf "│  drift:%3d  progress-msg:%3d  dangling-related:%3d              │\n" "${DRIFT:-0}" "${PROGRESS:-0}" "${DREL:-0}"
      printf "│  dangling-source-refs:%3d  missing-importance:%3d  secrets:%3d  │\n" "${DSRC:-0}" "${MISS:-0}" "${SEC:-0}"
      printf "│  Re-scan:   npx tsx plugin/scripts/docs-hygiene/scan.ts         │\n"
      printf "│  Lint mode: /guild:wiki lint                                    │\n"
      printf "└─────────────────────────────────────────────────────────────────┘\n"
    fi
  else
    cat <<'NOSCAN'
┌─────────────────────────────────────────────────────────────────┐
│  📋  docs-hygiene status: no scan on record                      │
│                                                                 │
│  Run once to seed the standing display:                         │
│    npx tsx plugin/scripts/docs-hygiene/scan.ts                  │
│                                                                 │
│  See: docs/knowledge/decisions/                                 │
│       knowledge-base-hygiene-and-grading.md                     │
└─────────────────────────────────────────────────────────────────┘
NOSCAN
  fi
fi

exit 0

#!/usr/bin/env bash
# hooks/check-skill-coverage.sh
#
# Event:   UserPromptSubmit
# Purpose: Lightly nudges when the user prompt references a domain that has
#          no shipped skill or specialist. Runs on every prompt — kept brief
#          and non-blocking.
#
# Heuristic: grep the prompt text for keywords that map to domains without a
#   shipped specialist. Flag at most once per session (uses a per-session
#   lock file under /tmp to avoid chatty repeated nudges).
#
# Shipped specialists (guild-plan.md §3): Architect, Researcher, Backend,
#   DevOps, QA, Mobile, Security, Copywriter, Technical Writer, Social Media,
#   SEO, Marketing, Sales.
# Gaps as of P5: no Frontend specialist, no Data/Analytics specialist,
#   no ML/AI-engineering specialist.
#
# Stdin:   JSON — Claude Code UserPromptSubmit hook payload.
# Stdout:  Either empty (no nudge needed) or a 1-line nudge.
# Stderr:  Error messages.
# Exit:    Always 0 — never blocks the prompt.

set -uo pipefail

# Read the prompt text from stdin payload (field: "prompt")
PAYLOAD="$(cat)"
PROMPT_TEXT=""
if command -v python3 &>/dev/null; then
  PROMPT_TEXT="$(python3 -c "
import json, sys
try:
  d = json.loads('''${PAYLOAD//\'/\'\\\'\'}''')
  print(d.get('prompt', ''))
except Exception:
  print('')
" 2>/dev/null || echo "")"
else
  # Fallback: treat raw stdin as text
  PROMPT_TEXT="${PAYLOAD}"
fi

# Lower-case for case-insensitive matching
PROMPT_LOWER="$(echo "${PROMPT_TEXT}" | tr '[:upper:]' '[:lower:]')"

# ── Session-level nudge lock ───────────────────────────────────────────────
SESSION_ID=""
if command -v python3 &>/dev/null; then
  SESSION_ID="$(python3 -c "
import json, sys
try:
  d = json.loads('''${PAYLOAD//\'/\'\\\'\'}''')
  print(d.get('session_id', ''))
except Exception:
  print('')
" 2>/dev/null || echo "")"
fi

LOCK_FILE="/tmp/guild-skill-nudge-${SESSION_ID:-unknown}"

# If we've already nudged this session, skip
if [[ -f "${LOCK_FILE}" ]]; then
  exit 0
fi

# ── Keyword → gap mapping ─────────────────────────────────────────────────
# Only flag domains with NO current specialist.
NUDGE_DOMAIN=""

if echo "${PROMPT_LOWER}" | grep -qE '\bfrontend\b|\bui component\b|\breact\b|\bvue\b|\bangular\b|\bsvelte\b|\bcss\b|\bstylesheet\b'; then
  NUDGE_DOMAIN="frontend / UI engineering"
fi

if [[ -z "${NUDGE_DOMAIN}" ]]; then
  if echo "${PROMPT_LOWER}" | grep -qE '\bdata analytics\b|\bdata pipeline\b|\bdata warehouse\b|\bspark\b|\bdbt\b|\bairflow\b|\betl\b|\bdashboard analytics\b'; then
    NUDGE_DOMAIN="data / analytics engineering"
  fi
fi

if [[ -z "${NUDGE_DOMAIN}" ]]; then
  if echo "${PROMPT_LOWER}" | grep -qE '\bml engineering\b|\bmodel training\b|\bpytorch\b|\btensorflow\b|\bneural network\b|\bml pipeline\b|\bmlops\b'; then
    NUDGE_DOMAIN="ML / AI engineering"
  fi
fi

# ── Emit nudge (once per session) ─────────────────────────────────────────
if [[ -n "${NUDGE_DOMAIN}" ]]; then
  touch "${LOCK_FILE}" 2>/dev/null || true
  echo "[Guild] No specialist covers \"${NUDGE_DOMAIN}\" yet. The closest available specialists are Architect and Backend. Use /guild to compose a team — or propose a new specialist via /guild:team."
fi

exit 0

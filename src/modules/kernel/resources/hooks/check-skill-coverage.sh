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

# Clean up stale session locks (>7 days old) — prevents /tmp accretion
# on long-running machines where /tmp isn't cleared automatically.
find /tmp -maxdepth 1 -name 'guild-skill-nudge-*' -mtime +7 -delete 2>/dev/null || true

# Read stdin into a temp file so python3 can parse it safely without any
# shell interpolation. This avoids the fragile ${PAYLOAD//\'/\'\\\'\'} substitution
# that breaks on JSON payloads containing single quotes, backslashes, or newlines.
PAYLOAD_FILE="$(mktemp /tmp/guild-nudge-payload.XXXXXX)"
cat > "${PAYLOAD_FILE}"
trap 'rm -f "${PAYLOAD_FILE}"' EXIT

PROMPT_TEXT=""
SESSION_ID=""
if command -v python3 &>/dev/null; then
  IFS=$'\t' read -r PROMPT_TEXT SESSION_ID < <(python3 - "${PAYLOAD_FILE}" <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1], "r", encoding="utf-8", errors="replace") as f:
        d = json.load(f)
    prompt = d.get("prompt", "") or ""
    session = d.get("session_id", "") or ""
    # Output as two tab-separated values on one line for bash read.
    # Spaces must stay inside the prompt field.
    print(prompt.replace("\n", " ").replace("\t", " ") + "\t" + session)
except Exception:
    print("\t")
PYEOF
) 2>/dev/null || true
else
  # python3 unavailable: treat raw file as prompt text (best effort)
  PROMPT_TEXT="$(cat "${PAYLOAD_FILE}")"
fi

LOCK_FILE="/tmp/guild-skill-nudge-${SESSION_ID:-unknown}"

# If we've already nudged this session, skip
if [[ -f "${LOCK_FILE}" ]]; then
  exit 0
fi

# Lower-case for case-insensitive matching
PROMPT_LOWER="$(echo "${PROMPT_TEXT}" | tr '[:upper:]' '[:lower:]')"

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
  echo "[Guild] No specialist covers \"${NUDGE_DOMAIN}\" yet. The closest available specialists are Architect and Backend. Use /guild:guild to compose a team — or propose a new specialist via /guild:plan (team is composed as a plan sub-step)."
fi

exit 0

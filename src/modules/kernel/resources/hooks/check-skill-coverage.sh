#!/usr/bin/env bash
# hooks/check-skill-coverage.sh
#
# Event:   UserPromptSubmit
# Purpose: TWO responsibilities, in priority order.
#
#          1. The LIFECYCLE GATE (issue #59 / oir-wi-59). This hook used to be
#             an advisory nudge only, which is precisely the gap the forensic
#             run exploited: with an active run past build-start, nothing
#             detected "this session stopped routing work through skills" and
#             34.7h of ad-hoc Bash/Edit ran with no review or verify gate.
#             The detection is deterministic code in hooks/lib/lifecycle-gate.ts
#             (run liveness, past-build-start, ad-hoc counting against the real
#             v1.4 trace, fire-once, overrides) and runs as
#             hooks/dist/lifecycle-gate.js. When it fires it prints the
#             UserPromptSubmit block envelope, which must be this hook's ONLY
#             stdout (mixing it with the plain-text nudge below would corrupt
#             the JSON), so the gate short-circuits the rest of the script.
#
#          2. The original domain-coverage nudge: lightly nudges when the user
#             prompt references a domain that has no shipped specialist
#             TEMPLATE. Runs on every prompt — kept brief and non-blocking.
#
# Heuristic: grep the prompt text for keywords that map to a domain, then
#   check WHETHER that domain is covered by looking for the matching template
#   filename under templates/specialists/*.md AT RUNTIME — never a hardcoded
#   "as of <date>" gap snapshot, which is exactly what went stale here before
#   (a Frontend template shipped and the nudge kept claiming "no specialist
#   covers frontend" for every react/css/vue prompt). Flag at most once per
#   session (uses a per-session lock file under /tmp to avoid chatty repeated
#   nudges).
#
# Roster model (v2): the plugin ships 2 machinery agents (advisor, developer)
#   plus 15 domain specialist TYPE TEMPLATES under templates/specialists/*.md
#   (architect, backend, copywriter, devops, doc-writer, frontend, marketing,
#   mobile, qa, researcher, sales, security, seo, social-media,
#   technical-writer), minted into a project's .guild/agents/ on demand by
#   guild:team-compose. See plugin/AGENTS.md.
#
# Stdin:   JSON — Claude Code UserPromptSubmit hook payload.
# Stdout:  Either empty, the lifecycle-gate block envelope (JSON), or a 1-line
#          domain nudge — never more than one of the three.
# Stderr:  Error messages + the gate body when the gate fires.
# Exit:    Always 0 — the block, when there is one, travels in the JSON
#          envelope, not in the exit code.

set -uo pipefail

# ── Resolve the specialist-templates dir (same plugin-root convention as
#    bootstrap.sh) so the "is this domain covered" check reads the REAL
#    shipped templates instead of a hardcoded snapshot. ──────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT_FALLBACK="$(cd "${SCRIPT_DIR}/.." && pwd)"
GUILD_PLUGIN_ROOT_RESOLVED="${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT_FALLBACK}}}"
SPECIALIST_TEMPLATES_DIR="${GUILD_PLUGIN_ROOT_RESOLVED}/templates/specialists"

# domain_covered <template-basename-without-.md>
# True (exit 0) iff templates/specialists/<name>.md exists — i.e. the domain
# has a shipped specialist template today. A single fs check per candidate
# domain keeps this hook fast (no directory listing / no subshells needed).
domain_covered() {
  [[ -f "${SPECIALIST_TEMPLATES_DIR}/$1.md" ]]
}

# Clean up stale session locks (>7 days old) — prevents /tmp accretion
# on long-running machines where /tmp isn't cleared automatically.
find /tmp -maxdepth 1 -name 'guild-skill-nudge-*' -mtime +7 -delete 2>/dev/null || true

# Read stdin into a temp file so python3 can parse it safely without any
# shell interpolation. This avoids the fragile ${PAYLOAD//\'/\'\\\'\'} substitution
# that breaks on JSON payloads containing single quotes, backslashes, or newlines.
PAYLOAD_FILE="$(mktemp /tmp/guild-nudge-payload.XXXXXX)"
cat > "${PAYLOAD_FILE}"
trap 'rm -f "${PAYLOAD_FILE}"' EXIT

# ── 1. LIFECYCLE GATE (issue #59) ─────────────────────────────────────────
# Delegated to the bundled hook so the detection stays real deterministic
# code over the v1.4 trace rather than shell heuristics. Runs BEFORE the
# per-session nudge lock is consulted — the domain nudge fires at most once
# per session, and the gate must not be silenced for the rest of a session
# just because that nudge already went out.
#
# Degrades to silence if node or the bundle is unavailable (a source-only
# checkout, or a host without node): the gate is enforcement, but a missing
# runtime must never wedge every prompt in the session.
#
# Resolved off GUILD_PLUGIN_ROOT_RESOLVED (same convention as
# SPECIALIST_TEMPLATES_DIR above), which defaults to this script's own parent —
# so in a normal install it IS `${SCRIPT_DIR}/dist/lifecycle-gate.js`.
LIFECYCLE_GATE_BUNDLE="${GUILD_PLUGIN_ROOT_RESOLVED}/hooks/dist/lifecycle-gate.js"
if command -v node &>/dev/null && [[ -f "${LIFECYCLE_GATE_BUNDLE}" ]]; then
  # stderr is deliberately NOT redirected — the gate writes its body there too,
  # so it stays visible on hosts that do not surface the JSON `reason`.
  GATE_OUTPUT="$(node "${LIFECYCLE_GATE_BUNDLE}" < "${PAYLOAD_FILE}" || true)"
  # Only a COMPLETE, well-formed envelope short-circuits. A crash message, a
  # stray warning, or concatenated/partial JSON must never be forwarded as if
  # it were a hook decision, and must never silently suppress the domain nudge
  # below — a prefix test cannot tell those apart, so the whole payload is
  # parsed and its exact shape checked.
  #
  # Validated with NODE, not python3: node is already proven present (we just
  # ran the bundle with it), whereas python3 is optional on this path. Gating
  # the check on python3 would silently DISABLE the gate on a node-only host —
  # discarding a perfectly valid block envelope.
  if [[ -n "${GATE_OUTPUT}" ]]; then
    if printf '%s' "${GATE_OUTPUT}" | node -e '
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let d;
  try { d = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { process.exit(1); }
  if (d === null || typeof d !== "object" || Array.isArray(d)) process.exit(1);
  const keys = Object.keys(d).sort().join(",");
  if (keys === "decision,reason" && d.decision === "block" && typeof d.reason === "string") {
    process.exit(0);
  }
  if (keys === "hookSpecificOutput") {
    const h = d.hookSpecificOutput;
    if (h !== null && typeof h === "object" && !Array.isArray(h)
        && Object.keys(h).sort().join(",") === "additionalContext,hookEventName"
        && h.hookEventName === "UserPromptSubmit"
        && typeof h.additionalContext === "string") {
      process.exit(0);
    }
  }
  process.exit(1);
});
'; then
      # The envelope must be this hook's ONLY stdout — emit it and stop.
      printf '%s\n' "${GATE_OUTPUT}"
      exit 0
    fi
    printf 'warn: [check-skill-coverage] ignoring unrecognized lifecycle-gate output\n' >&2
  fi
fi

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

# ── Keyword → domain mapping, gated on runtime template coverage ──────────
# The keyword→domain association is inherently hand-authored (there is no way
# to derive "react implies frontend" from a filename); what must NEVER be
# hand-authored again is the COVERED/GAP verdict — that is now `domain_covered`
# checking the real templates/specialists/ directory, so a shipped template
# always silences its nudge without a script edit.
NUDGE_DOMAIN=""

if ! domain_covered "frontend" \
  && echo "${PROMPT_LOWER}" | grep -qE '\bfrontend\b|\bui component\b|\breact\b|\bvue\b|\bangular\b|\bsvelte\b|\bcss\b|\bstylesheet\b'; then
  NUDGE_DOMAIN="frontend / UI engineering"
fi

if [[ -z "${NUDGE_DOMAIN}" ]] && ! domain_covered "data-analytics"; then
  if echo "${PROMPT_LOWER}" | grep -qE '\bdata analytics\b|\bdata pipeline\b|\bdata warehouse\b|\bspark\b|\bdbt\b|\bairflow\b|\betl\b|\bdashboard analytics\b'; then
    NUDGE_DOMAIN="data / analytics engineering"
  fi
fi

if [[ -z "${NUDGE_DOMAIN}" ]] && ! domain_covered "ml-ai-engineering"; then
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

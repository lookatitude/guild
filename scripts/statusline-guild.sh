#!/usr/bin/env bash
# scripts/statusline-guild.sh
#
# Outputs a single-line status string for the operator's status-line
# integration: `phase | round | cap | loops-mode | restart-count`.
#
# Per architect's audit (`benchmark/plans/v1.4-claude-plugin-surface-audit.md`
# §"Status-line integration"), this script is opt-in via either:
#   - `--statusline` CLI flag passed through Guild's runner, or
#   - `GUILD_STATUSLINE=1` env var.
# Default: off (no opt-in → no output beyond a "phase: unknown" sentinel).
#
# Inputs (env-driven primary; stdin secondary per Claude Code convention):
#   stdin: Claude Code passes a JSON `input_json` blob on stdin describing
#          the active session. The script reads it but does NOT depend on
#          its fields — env vars take precedence. Stdin is drained
#          non-blockingly (read with timeout 0) so missing input is fine.
#   GUILD_RUN_ID  — primary. Resolves <runDir> = <cwd>/.guild/runs/<run-id>
#                   (or <runDir> via GUILD_RUN_DIR if set).
#   GUILD_RUN_DIR — optional override for the absolute run dir path.
#   GUILD_PHASE   — optional; when set, included verbatim. Otherwise the
#                   script reports "unknown".
#   GUILD_LOOPS   — optional; loops-mode (none|spec|plan|implementation|all
#                   or a comma-list). When unset → "none".
#   GUILD_LOOP_CAP — optional; numeric cap. When unset → "16" (architect
#                    default per v1.4-config.ts §DEFAULT_LOOP_CAP).
#   GUILD_LANE_ID — optional; when set, the per-lane counter block is
#                   used to derive `round` + `restart-count`. When unset,
#                   the script reports the global L1/L2 counters.
#
# The script MUST fall through gracefully when GUILD_RUN_ID is unset:
# it prints "phase: unknown | round: 0 | cap: 16 | loops: none | restarts: 0"
# and exits 0. No stderr noise, no panic.
#
# Exit codes:
#   0 — always (status-line scripts must not bubble failures up).

set -u

# Drain stdin per Claude Code convention. Claude Code passes a JSON
# `input_json` blob on stdin describing the active session. We don't
# parse it today — env vars are the primary input — but reading
# prevents Claude Code from blocking on a closed pipe. Best-effort:
# if stdin is a tty (interactive run), skip; otherwise consume up to
# 32KB. Failure to read is swallowed (status-line scripts must
# never bubble errors).
input_json=""
if [[ ! -t 0 ]]; then
  # head -c reads up to N bytes then closes; portable across
  # macOS/Linux. Errors swallowed.
  input_json="$(head -c 32768 2>/dev/null || true)"
fi
# `input_json` is intentionally unused below; future enhancement.
: "${input_json:-}"

phase="${GUILD_PHASE:-unknown}"
loops_mode="${GUILD_LOOPS:-none}"
cap="${GUILD_LOOP_CAP:-16}"
round=0
restart_count=0

run_id="${GUILD_RUN_ID:-}"
run_dir="${GUILD_RUN_DIR:-}"
cwd="${GUILD_CWD:-$(pwd)}"
lane_id="${GUILD_LANE_ID:-}"

if [[ -z "$run_id" ]]; then
  # Per audit §"Status-line integration" (line 267): GUILD_RUN_ID unset
  # → output the literal "phase: unknown" string only. No additional fields.
  printf 'phase: unknown\n'
  exit 0
fi

if [[ -z "$run_dir" ]]; then
  run_dir="${cwd}/.guild/runs/${run_id}"
fi
counters_file="${run_dir}/counters.json"

if [[ ! -f "$counters_file" ]]; then
  # Per audit §"Status-line integration" (lines 272-273): GUILD_RUN_ID
  # set but counters.json missing → output "phase: <run-id> (initialising)".
  printf 'phase: %s (initialising)\n' "$run_id"
  exit 0
fi

# counters.json present: derive round + restart_count.
# Parse counters.json without external deps (no jq required). The
# schema (T3a §"Per-lane counters — isolation contract"):
#   { "schema_version":1, "run_id":..., "counters": {
#       "l1_round": <int>, "l2_round": <int>,
#       "<lane>": {"L3_round":..,"L4_round":..,"security_round":..,"restart_count":..}
#   }}
#
# We use Node (always available — required by the plugin) for safe
# JSON parsing. Bash regex on JSON is fragile; Node is the
# single-line escape-hatch.
if command -v node >/dev/null 2>&1; then
  output=$(GUILD_LANE_ID="$lane_id" node -e '
    const fs = require("node:fs");
    try {
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const counters = (c && c.counters) || {};
      const lane = process.env.GUILD_LANE_ID || "";
      let round = 0, restart = 0;
      if (lane && counters[lane] && typeof counters[lane] === "object") {
        const block = counters[lane];
        const l3 = Number(block.L3_round) || 0;
        const l4 = Number(block.L4_round) || 0;
        const sec = Number(block.security_round) || 0;
        round = Math.max(l3, l4, sec);
        restart = Number(block.restart_count) || 0;
      } else {
        const l1 = Number(counters.l1_round) || 0;
        const l2 = Number(counters.l2_round) || 0;
        round = Math.max(l1, l2);
      }
      process.stdout.write(round + " " + restart);
    } catch (e) {
      process.stdout.write("0 0");
    }
  ' "$counters_file" 2>/dev/null) || output="0 0"
  round="${output%% *}"
  restart_count="${output##* }"
fi

printf 'phase: %s | round: %s | cap: %s | loops: %s | restarts: %s\n' \
  "$phase" "$round" "$cap" "$loops_mode" "$restart_count"

exit 0

#!/usr/bin/env bash
#
# Guild installer
#
#   curl -fsSL https://guildstack.dev/install.sh | bash
#
# or, if the domain is unavailable, the same script served from the repo:
#
#   curl -fsSL https://raw.githubusercontent.com/lookatitude/guild/main/install.sh | bash
#
# Canonical source: install.sh at the root of the plugin repo
# (github.com/lookatitude/guild); website/public/install.sh is a
# byte-identical served copy (enforced by tests/dot-guild/install-sh-equivalence.test.ts).
#
# Installs the Guild plugin into the AI coding hosts found on this machine.
# Today that means Claude Code (the shipped host). Codex works with Guild
# through a Claude Code install (cross-host execution and review); Gemini CLI
# and Pi adapters are planned. The script never uses sudo, never edits shell
# profiles, and only runs the host's own plugin commands.
#
# Options (pass after `bash -s --`):
#   --dry-run    print what would run without running it
#   --project    install with --scope project (current directory) instead of user scope
#
# Environment:
#   GUILD_MARKETPLACE   override the marketplace source (default: lookatitude/guild)
#
set -euo pipefail

MARKETPLACE="${GUILD_MARKETPLACE:-lookatitude/guild}"
PLUGIN_SPEC="guild@guild"
DRY_RUN=0
SCOPE_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --project) SCOPE_ARGS=(--scope project) ;;
    -h|--help)
      cat <<'HELP'
Guild installer

  curl -fsSL https://guildstack.dev/install.sh | bash

or, if the domain is unavailable, the same script served from the repo:

  curl -fsSL https://raw.githubusercontent.com/lookatitude/guild/main/install.sh | bash

Installs the Guild plugin into the AI coding hosts found on this machine
(Claude Code today; Codex works through a Claude Code install; Gemini CLI
and Pi adapters are planned). Never uses sudo or edits shell profiles.

Options (pass after `bash -s --`):
  --dry-run    print what would run without running it
  --project    install with --scope project (current directory)

Environment:
  GUILD_MARKETPLACE   override the marketplace source (default: lookatitude/guild)
HELP
      exit 0
      ;;
    *)
      printf 'guild-install: unknown option: %s\n' "$arg" >&2
      exit 1
      ;;
  esac
done

say()  { printf '\033[36m[guild]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[guild]\033[0m %s\n' "$*" >&2; }

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "would run: $*"
  else
    say "running: $*"
    "$@"
  fi
}

found_any=0
installed_any=0

# ── Claude Code — the shipped host ──────────────────────────────────────────
if command -v claude >/dev/null 2>&1; then
  found_any=1
  say "Claude Code detected ($(command -v claude))"
  run claude plugin marketplace add "$MARKETPLACE"
  run claude plugin marketplace update guild
  if [ ${#SCOPE_ARGS[@]} -gt 0 ]; then
    run claude plugin install "$PLUGIN_SPEC" "${SCOPE_ARGS[@]}"
  else
    run claude plugin install "$PLUGIN_SPEC"
  fi
  installed_any=1
  say ""
  say "Guild installed into Claude Code."
  say "RESTART Claude Code now — plugins load at session start, so Guild"
  say "stays invisible until your next session. Then run:"
  say ""
  say '    /guild:guild "your task"'
  say ""
fi

# ── Codex — works WITH Guild via a Claude Code install ──────────────────────
if command -v codex >/dev/null 2>&1; then
  found_any=1
  if [ "$installed_any" -eq 1 ]; then
    say "Codex detected — Guild can use it from your Claude Code install:"
    say "  cross-AI review:    /guild:guild \"task\" --review=cross"
    say "  Codex execution:    --host codex"
  else
    warn "Codex detected, but Guild has no standalone Codex package yet."
    warn "Guild drives Codex (execution + cross-AI review) from a Claude Code"
    warn "install. Install Claude Code first, then re-run this script:"
    warn ""
    warn "    curl -fsSL https://claude.ai/install.sh | bash"
    warn ""
  fi
fi

# ── Gemini CLI / Pi — planned hosts ─────────────────────────────────────────
for host in gemini pi; do
  if command -v "$host" >/dev/null 2>&1; then
    found_any=1
    warn "$host detected — the Guild adapter for this host is planned but not"
    warn "shipped yet. Today Guild runs on Claude Code (with Codex as a"
    warn "cross-AI reviewer/executor). Watch https://guildstack.dev for updates."
  fi
done

# ── No supported host at all ────────────────────────────────────────────────
if [ "$found_any" -eq 0 ]; then
  warn "No supported AI coding host found on PATH (looked for: claude, codex, gemini, pi)."
  warn ""
  warn "Guild runs inside Claude Code. Install it first:"
  warn ""
  warn "    curl -fsSL https://claude.ai/install.sh | bash      # macOS / Linux / WSL"
  warn ""
  warn "then re-run this script:"
  warn ""
  warn "    curl -fsSL https://guildstack.dev/install.sh | bash"
  warn ""
  warn "or, if the domain is unavailable:"
  warn ""
  warn "    curl -fsSL https://raw.githubusercontent.com/lookatitude/guild/main/install.sh | bash"
  exit 1
fi

if [ "$installed_any" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
  exit 1
fi

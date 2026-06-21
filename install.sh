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
# The script never uses sudo, never edits shell profiles, and only runs the
# host's own plugin commands or prints/renders the universal AGENTS.md package.
#
# Options (pass after `bash -s --`):
#   --dry-run    print what would run without running it
#   --host HOST  install only one host (claude-code-cli, codex-cli, pi-cli, antigravity-cli, agents-file, app/connector ids)
#   --project    install with --scope project (current directory) instead of user scope
#
# Environment:
#   GUILD_MARKETPLACE   override the Claude marketplace source (default: lookatitude/guild)
#   GUILD_SOURCE_REPO   override source repo for agents-file render fallback
#
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
else
  SCRIPT_DIR="$(pwd)"
fi

MARKETPLACE="${GUILD_MARKETPLACE:-lookatitude/guild}"
SOURCE_REPO="${GUILD_SOURCE_REPO:-https://github.com/lookatitude/guild.git}"
PLUGIN_SPEC="guild@guild"
DRY_RUN=0
HOST="auto"
SCOPE_ARGS=()

while [ "$#" -gt 0 ]; do
  arg="$1"
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --host)
      if [ "$#" -lt 2 ]; then
        printf 'guild-install: --host requires a value\n' >&2
        exit 1
      fi
      HOST="$2"
      shift
      ;;
    --host=*) HOST="${arg#--host=}" ;;
    --project) SCOPE_ARGS=(--scope project) ;;
    -h|--help)
      cat <<'HELP'
Guild installer

  curl -fsSL https://guildstack.dev/install.sh | bash

or, if the domain is unavailable, the same script served from the repo:

  curl -fsSL https://raw.githubusercontent.com/lookatitude/guild/main/install.sh | bash

Installs the Guild plugin into the AI coding hosts found on this machine.
Never uses sudo or edits shell profiles.

Options (pass after `bash -s --`):
  --dry-run    print what would run without running it
  --host HOST  install only one host (claude-code-cli, codex-cli, pi-cli, antigravity-cli, agents-file, app/connector ids)
  --project    install with --scope project (current directory)

Environment:
  GUILD_MARKETPLACE   override the Claude marketplace source (default: lookatitude/guild)
  GUILD_SOURCE_REPO   override source repo for agents-file render fallback
HELP
      exit 0
      ;;
    *)
      printf 'guild-install: unknown option: %s\n' "$arg" >&2
      exit 1
      ;;
  esac
  shift
done

case "$HOST" in
  auto|"") HOST="auto" ;;
  claude|claude-code|claude-code-cli) HOST="claude-code-cli" ;;
  codex|codex-cli|codex-plugin) HOST="codex-cli" ;;
  pi|pi-cli) HOST="pi-cli" ;;
  antigravity|antigravity-cli|antigravity-2|agy) HOST="antigravity-cli" ;;
  agents|agents-file|.agents) HOST="agents-file" ;;
  claude-code-app|claude-code-desktop|claude-code-web|codex-app|claude-ai-connector) HOST="$HOST" ;;
  *)
    printf 'guild-install: unsupported --host %s (supported: claude-code-cli, codex-cli, pi-cli, antigravity-cli, agents-file, claude-code-app, claude-code-web, codex-app, claude-ai-connector)\n' "$HOST" >&2
    exit 1
    ;;
esac

if [ "$HOST" = "claude-code-desktop" ]; then
  HOST="claude-code-app"
fi

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

run_allow_fail() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "would run: $* || true"
  else
    say "running: $*"
    "$@" || warn "continuing after non-fatal command failure: $*"
  fi
}

RENDERED_DIST=""

render_host_packages() {
  generated_at="$1"
  if [ -f "$SCRIPT_DIR/scripts/build-host-packages.ts" ]; then
    if [ "$SCRIPT_DIR" = "$(pwd)" ]; then
      run npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at "$generated_at"
      RENDERED_DIST="dist"
    else
      run npx tsx "$SCRIPT_DIR/scripts/build-host-packages.ts" --root "$SCRIPT_DIR" --out "$SCRIPT_DIR/dist" --generated-at "$generated_at"
      RENDERED_DIST="$SCRIPT_DIR/dist"
    fi
    return
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    say "would run: git clone --depth 1 $SOURCE_REPO <tmpdir>"
    say "would run: npx tsx scripts/build-host-packages.ts --root <tmpdir> --out dist --generated-at $generated_at"
    RENDERED_DIST="dist"
    return
  fi

  tmpdir="$(mktemp -d)"
  cleanup() { rm -rf "$tmpdir"; }
  trap cleanup EXIT
  git clone --depth 1 "$SOURCE_REPO" "$tmpdir"
  out_dir="$(pwd)/dist"
  (cd "$tmpdir" && npx tsx scripts/build-host-packages.ts --root . --out "$out_dir" --generated-at "$generated_at")
  RENDERED_DIST="$out_dir"
}

found_any=0
installed_any=0

# ── Claude Code — the shipped host ──────────────────────────────────────────
if [ "$HOST" = "auto" ] || [ "$HOST" = "claude-code-cli" ]; then
if command -v claude >/dev/null 2>&1 || { [ "$DRY_RUN" -eq 1 ] && [ "$HOST" = "claude-code-cli" ]; }; then
  found_any=1
  if command -v claude >/dev/null 2>&1; then
    say "Claude Code detected ($(command -v claude))"
  else
    say "Claude Code selected (dry-run; claude binary not required for planning)"
  fi
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
  say "Package wrapper: CLAUDE.md imports AGENTS.md via @AGENTS.md."
  say "RESTART Claude Code now — plugins load at session start, so Guild"
  say "stays invisible until your next session. Then run:"
  say ""
  say '    /guild:guild "your task"'
  say ""
fi
fi

# ── Codex CLI — standalone plugin target ────────────────────────────────────
if [ "$HOST" = "auto" ] || [ "$HOST" = "codex-cli" ]; then
if command -v codex >/dev/null 2>&1 || { [ "$DRY_RUN" -eq 1 ] && [ "$HOST" = "codex-cli" ]; }; then
  found_any=1
  if command -v codex >/dev/null 2>&1; then
    say "Codex CLI detected ($(command -v codex))"
  else
    say "Codex CLI selected (dry-run; codex binary not required for planning)"
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    GENERATED_AT="<generated-at>"
  else
    GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi
  render_host_packages "$GENERATED_AT"
  CODEX_MARKETPLACE_PATH="$RENDERED_DIST/codex-marketplace"
  run_allow_fail codex plugin marketplace remove guild
  run codex plugin marketplace add "$CODEX_MARKETPLACE_PATH"
  run codex plugin add "$PLUGIN_SPEC"
  installed_any=1
  say ""
  say "Guild installed into Codex CLI."
  say "Package bootstrap: AGENTS.md plus .agents/skills/guild."
  say "Use the bundled guild-run wrapper for structured Guild runs:"
  say ""
  say "    guild-run --host codex --prompt \"your task\""
  say ""
fi
fi

# ── Pi CLI — standalone package/bootstrap target ─────────────────────────────
if [ "$HOST" = "auto" ] || [ "$HOST" = "pi-cli" ]; then
if command -v pi >/dev/null 2>&1 || { [ "$DRY_RUN" -eq 1 ] && [ "$HOST" = "pi-cli" ]; }; then
  found_any=1
  if command -v pi >/dev/null 2>&1; then
    say "Pi CLI detected ($(command -v pi))"
  else
    say "Pi CLI selected (dry-run; pi binary not required for planning)"
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    GENERATED_AT="<generated-at>"
  else
    GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi
  render_host_packages "$GENERATED_AT"
  PI_PACKAGE_PATH="$RENDERED_DIST/pi"
  run pi install "$PI_PACKAGE_PATH"
  installed_any=1
  say ""
  say "Guild package prepared for Pi CLI."
  say "Package bootstrap: AGENTS.md plus .agents/skills/guild and pi-manifest.json."
  say "Unsupported hooks and MCP are surfaced as Guild degradation receipts; memory falls back through .guild filesystem/BM25."
  say "Use the bundled guild-run wrapper for structured Guild runs:"
  say ""
  say "    guild-run --host pi --prompt \"your task\""
  say ""
fi
fi

# ── Antigravity CLI — standalone package/bootstrap target ────────────────────
if [ "$HOST" = "auto" ] || [ "$HOST" = "antigravity-cli" ]; then
if command -v agy >/dev/null 2>&1 || { [ "$DRY_RUN" -eq 1 ] && [ "$HOST" = "antigravity-cli" ]; }; then
  found_any=1
  if command -v agy >/dev/null 2>&1; then
    say "Antigravity CLI detected ($(command -v agy))"
  else
    say "Antigravity CLI selected (dry-run; agy binary not required for planning)"
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    GENERATED_AT="<generated-at>"
  else
    GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi
  render_host_packages "$GENERATED_AT"
  ANTIGRAVITY_PACKAGE_PATH="$RENDERED_DIST/antigravity"
  run agy plugin validate "$ANTIGRAVITY_PACKAGE_PATH"
  run agy plugin install "$ANTIGRAVITY_PACKAGE_PATH"
  installed_any=1
  say ""
  say "Guild package prepared for Antigravity CLI."
  say "Package bootstrap: AGENTS.md plus .agents/skills/guild and antigravity-manifest.json."
  say "Unsupported hooks and MCP are surfaced as Guild degradation receipts; memory falls back through .guild filesystem/BM25."
  say "Use the bundled guild-run wrapper for structured Guild runs:"
  say ""
  say "    guild-run --host antigravity --prompt \"your task\""
  say ""
fi
fi

# ── App/web/connector targets — not CLI package installs ────────────────────
case "$HOST" in
  claude-code-app|claude-code-web|codex-app|claude-ai-connector)
    found_any=1
    warn "$HOST is an app/connector target, not a CLI package install target."
    warn "Guild will not install a CLI package into this surface."
    warn "Use the connector/app bootstrap contract: AGENTS.md instructions, .guild file-bus artifacts,"
    warn "and explicit app/connector approval or egress gates. For local plugin execution install one of:"
    warn "  --host claude-code-cli"
    warn "  --host codex-cli"
    warn "  --host pi-cli"
    warn "  --host antigravity-cli"
    exit 0
    ;;
esac

# ── Universal AGENTS.md package target ──────────────────────────────────────
if [ "$HOST" = "agents-file" ]; then
  found_any=1
  say "Universal AGENTS.md package target selected."
  if [ "$DRY_RUN" -eq 1 ]; then
    GENERATED_AT="<generated-at>"
  else
    GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi
  render_host_packages "$GENERATED_AT"
  installed_any=1
  say ""
  say "Universal AGENTS.md package rendered at:"
  say "  dist/agents/AGENTS.md"
  say "  dist/agents/.agents/skills/guild"
  say "Copy this package into an AGENTS.md-consuming project or workspace."
  say ""
fi

# ── No supported host at all ────────────────────────────────────────────────
if [ "$found_any" -eq 0 ]; then
  warn "No supported AI coding host found on PATH (looked for: claude, codex, pi, agy)."
  warn ""
  warn "Install Claude Code or Codex CLI first, or render the universal package:"
  warn ""
  warn "    curl -fsSL https://claude.ai/install.sh | bash      # macOS / Linux / WSL"
  warn "    curl -fsSL https://guildstack.dev/install.sh | bash -s -- --host agents-file"
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

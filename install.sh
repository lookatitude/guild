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
# Multi-host support (verified-multi-host-support L4; ADR §1/§3.3/§8):
#   - Host packages are rendered ONCE, then installed into every selected host
#     (no per-host rebuild).
#   - --hosts a,b,c installs a comma-separated set; --host X stays single-select.
#   - Bare auto-detect installs every supported host found on PATH (+ IDE project
#     markers), but writing Guild payload to MORE THAN ONE host requires explicit
#     consent — --yes, or an interactive y/N on a TTY. It NEVER silently
#     multi-writes (AC-INS-3, security S-M3).
#   - App/connector surfaces (claude-code-app, claude-code-web, codex-app,
#     claude-ai-connector) are RECOGNIZED and clearly REFUSED with a specific
#     exit code — never a false-native install path (AC-INS-5).
#
# Options (pass after `bash -s --`):
#   --dry-run       print what would run without running it
#   --host HOST     install one host (single-select; unchanged legacy behavior)
#   --hosts A,B,C   install a comma-separated set of hosts (multi-select)
#   --yes, -y       consent to a multi-host write without an interactive prompt
#   --project       install with --scope project (current directory) instead of user scope
#   --channel C     stable (main, default) | beta (next) — clone-fallback ref selector
#
# Supported host ids (16 = 5 keep + 4 refuse + 4 new-CLI + 3 new-IDE; ADR §1.1):
#   keep/CLI+file : claude-code-cli codex-cli pi-cli antigravity-cli agents-file
#   new-CLI       : cursor github-copilot opencode rovo-dev
#   new-IDE       : kiro qoder trae        (bind the agents-file package; ADR §3.1)
#   refuse (app)  : claude-code-app claude-code-web codex-app claude-ai-connector
#
# Exit codes:
#   0  success (install or dry-run completed)
#   1  usage error / no supported host found
#   2  unknown or unsupported --host / --hosts id
#   3  consent required — a multi-host (>1) write with neither --yes nor a TTY
#   4  app/connector surface refused (AC-INS-5)
#
# Environment:
#   GUILD_SOURCE_REPO   override source repo for render fallback when install.sh is run without a checkout
#
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
else
  SCRIPT_DIR="$(pwd)"
fi

SOURCE_REPO="${GUILD_SOURCE_REPO:-https://github.com/lookatitude/guild.git}"
# Release channel → git ref for the clone fallback (release-discipline rule 8):
#   stable → main (the released channel; marketplace default)
#   beta   → next (the integration channel; features land here first)
# GUILD_SOURCE_REF overrides both for an arbitrary ref.
CHANNEL="${GUILD_CHANNEL:-stable}"
SOURCE_REF="${GUILD_SOURCE_REF:-}"
# --update: re-render + reinstall every host with a receipt under ~/.guild/receipts
UPDATE_MODE=0
PLUGIN_SPEC="guild@guild"
DRY_RUN=0
ASSUME_YES=0
SCOPE_PROJECT=0
# Whitespace-separated list of requested host ids (canonicalized during parse).
# Empty ⇒ bare auto-detect mode.
REQUESTED_HOSTS=""

say()  { printf '\033[36m[guild]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[guild]\033[0m %s\n' "$*" >&2; }

usage() {
  cat <<'HELP'
Guild installer

  curl -fsSL https://guildstack.dev/install.sh | bash

or, if the domain is unavailable, the same script served from the repo:

  curl -fsSL https://raw.githubusercontent.com/lookatitude/guild/main/install.sh | bash

Installs the Guild plugin into the AI coding hosts found on this machine.
Never uses sudo or edits shell profiles.

Options (pass after `bash -s --`):
  --dry-run       print what would run without running it
  --host HOST     install one host (single-select)
  --hosts A,B,C   install a comma-separated set of hosts (multi-select)
  --yes, -y       consent to a multi-host write without an interactive prompt
  --project       install with --scope project (current directory)
  --channel C     release channel for the no-checkout clone fallback:
                  stable (main — released versions, default) or
                  beta (next — integration builds ahead of release)
  --update        re-render + reinstall every host recorded under
                  ~/.guild/receipts (each install writes a receipt); channel
                  comes from the receipts unless --channel overrides

Bare auto-detect installs every supported host found on PATH (+ IDE project
markers). Writing to MORE THAN ONE host needs --yes or an interactive y/N;
it never silently multi-writes.

Supported host ids:
  claude-code-cli codex-cli pi-cli antigravity-cli agents-file
  cursor github-copilot opencode rovo-dev
  kiro qoder trae
  claude-code-app claude-code-web codex-app claude-ai-connector  (recognized, refused)

Environment:
  GUILD_SOURCE_REPO   override source repo for render fallback when install.sh is run without a checkout
  GUILD_CHANNEL       stable | beta — same as --channel
  GUILD_SOURCE_REF    exact git ref for the clone fallback (overrides the channel mapping)
HELP
}

# ── Host id normalization ───────────────────────────────────────────────────
# Map a user-supplied token (with common aliases) to a canonical host id, or
# return non-zero for an unknown id. Echoes the canonical id on success.
normalize_host() {
  case "$1" in
    claude|claude-code|claude-code-cli)                 printf 'claude-code-cli' ;;
    codex|codex-cli|codex-plugin)                       printf 'codex-cli' ;;
    pi|pi-cli)                                          printf 'pi-cli' ;;
    antigravity|antigravity-cli|antigravity-2|agy)      printf 'antigravity-cli' ;;
    agents|agents-file|.agents)                         printf 'agents-file' ;;
    cursor|cursor-agent)                                printf 'cursor' ;;
    github-copilot|copilot|gh-copilot)                  printf 'github-copilot' ;;
    opencode)                                           printf 'opencode' ;;
    rovo-dev|rovodev|rovo)                              printf 'rovo-dev' ;;
    kiro)                                               printf 'kiro' ;;
    qoder)                                              printf 'qoder' ;;
    trae|trae-cn)                                       printf 'trae' ;;
    claude-code-desktop)                                printf 'claude-code-app' ;;
    claude-code-app|claude-code-web|codex-app|claude-ai-connector) printf '%s' "$1" ;;
    *) return 1 ;;
  esac
}

# True for the four app/connector surfaces Guild recognizes but refuses (ADR §1.1).
is_refuse_host() {
  case "$1" in
    claude-code-app|claude-code-web|codex-app|claude-ai-connector) return 0 ;;
    *) return 1 ;;
  esac
}

# ── Argument parsing ─────────────────────────────────────────────────────────
while [ "$#" -gt 0 ]; do
  arg="$1"
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --project) SCOPE_PROJECT=1 ;;
    --host)
      if [ "$#" -lt 2 ]; then
        printf 'guild-install: --host requires a value\n' >&2
        exit 1
      fi
      REQUESTED_HOSTS="$REQUESTED_HOSTS $2"
      shift
      ;;
    --host=*) REQUESTED_HOSTS="$REQUESTED_HOSTS ${arg#--host=}" ;;
    --hosts)
      if [ "$#" -lt 2 ]; then
        printf 'guild-install: --hosts requires a comma-separated value\n' >&2
        exit 1
      fi
      REQUESTED_HOSTS="$REQUESTED_HOSTS $(printf '%s' "$2" | tr ',' ' ')"
      shift
      ;;
    --hosts=*) REQUESTED_HOSTS="$REQUESTED_HOSTS $(printf '%s' "${arg#--hosts=}" | tr ',' ' ')" ;;
    --channel)
      if [ "$#" -lt 2 ]; then
        printf 'guild-install: --channel requires a value (stable|beta)\n' >&2
        exit 1
      fi
      CHANNEL="$2"
      shift
      ;;
    --channel=*) CHANNEL="${arg#--channel=}" ;;
    --update) UPDATE_MODE=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      printf 'guild-install: unknown option: %s\n' "$arg" >&2
      exit 1
      ;;
  esac
  shift
done

# ── Channel → source ref resolution ──────────────────────────────────────────
case "$CHANNEL" in
  stable) : "${SOURCE_REF:=main}" ;;
  beta|next) CHANNEL="beta"; : "${SOURCE_REF:=next}" ;;
  *)
    printf 'guild-install: unknown --channel: %s (expected stable|beta)\n' "$CHANNEL" >&2
    exit 1
    ;;
esac

# ── Update mode: hosts + channel come from the install receipts (G1-ALL) ────
if [ "$UPDATE_MODE" -eq 1 ]; then
  RECEIPTS_GLOB="${GUILD_RECEIPTS_DIR:-$HOME/.guild/receipts}"
  if [ ! -d "$RECEIPTS_GLOB" ] || [ -z "$(ls "$RECEIPTS_GLOB"/*.json 2>/dev/null)" ]; then
    printf 'guild-install: --update found no install receipts under %s\n' "$RECEIPTS_GLOB" >&2
    printf '  Receipts are written by installs from this version onward; run a normal install once first.\n' >&2
    exit 1
  fi
  receipt_channels=""
  for rf in "$RECEIPTS_GLOB"/*.json; do
    rh="$(sed -n 's/^[[:space:]]*"host":[[:space:]]*"\([^"]*\)".*$/\1/p' "$rf" | head -1)"
    rc="$(sed -n 's/^[[:space:]]*"channel":[[:space:]]*"\([^"]*\)".*$/\1/p' "$rf" | head -1)"
    [ -n "$rh" ] && REQUESTED_HOSTS="$REQUESTED_HOSTS $rh"
    [ -n "$rc" ] && receipt_channels="$receipt_channels $rc"
  done
  # Explicit --channel/GUILD_CHANNEL wins; otherwise adopt the receipts' channel
  # (uniform), refusing a silent pick on a mixed set.
  if [ -z "${GUILD_CHANNEL:-}" ] && [ "$CHANNEL" = "stable" ]; then
    uniq_channels="$(printf '%s\n' $receipt_channels | sort -u)"
    if [ "$(printf '%s\n' "$uniq_channels" | grep -c .)" -gt 1 ]; then
      printf 'guild-install: --update receipts span multiple channels (%s) — pass --channel explicitly\n' "$(printf '%s' "$uniq_channels" | tr '\n' ' ')" >&2
      exit 1
    fi
    case "$uniq_channels" in
      beta) CHANNEL="beta"; SOURCE_REF="next" ;;
    esac
  fi
  say "update mode: re-installing hosts:$REQUESTED_HOSTS (channel: $CHANNEL)"
fi

# ── Host detection (bare auto-detect mode) ───────────────────────────────────
# PATH probe of CLI-host binaries only (ADR §3.3); IDE hosts have no bin and are
# reached by their project marker below. agents-file has no bin/marker — it is
# an explicit-only universal target, never auto-detected.
detect_hosts() {
  detected=""
  command -v claude       >/dev/null 2>&1 && detected="$detected claude-code-cli"
  command -v codex        >/dev/null 2>&1 && detected="$detected codex-cli"
  command -v pi           >/dev/null 2>&1 && detected="$detected pi-cli"
  command -v agy          >/dev/null 2>&1 && detected="$detected antigravity-cli"
  command -v cursor-agent >/dev/null 2>&1 && detected="$detected cursor"
  command -v gh           >/dev/null 2>&1 && detected="$detected github-copilot"
  command -v opencode     >/dev/null 2>&1 && detected="$detected opencode"
  command -v acli         >/dev/null 2>&1 && detected="$detected rovo-dev"
  # Additive IDE project-marker probe against the current project root (ADR §3.3).
  [ -d "$(pwd)/.kiro" ]  && detected="$detected kiro"
  [ -d "$(pwd)/.qoder" ] && detected="$detected qoder"
  [ -d "$(pwd)/.trae" ]  && detected="$detected trae"
  printf '%s' "${detected# }"
}

AUTO_DETECT=0
if [ -z "${REQUESTED_HOSTS// /}" ]; then
  AUTO_DETECT=1
  RESOLVED_HOSTS="$(detect_hosts)"
  if [ -z "$RESOLVED_HOSTS" ]; then
    warn "No supported AI coding host found on PATH (looked for: claude, codex, pi, agy, cursor-agent, gh, opencode, acli)."
    warn "No IDE project marker found either (.kiro/ .qoder/ .trae/)."
    warn ""
    warn "Install a supported host first, or render the universal package:"
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
else
  # Explicit --host/--hosts: normalize + validate every requested id up front.
  RESOLVED_HOSTS=""
  for h in $REQUESTED_HOSTS; do
    if canon="$(normalize_host "$h")"; then
      # De-duplicate while preserving first-seen order.
      case " $RESOLVED_HOSTS " in
        *" $canon "*) ;;
        *) RESOLVED_HOSTS="$RESOLVED_HOSTS $canon" ;;
      esac
    else
      printf 'guild-install: unsupported host: %s\n' "$h" >&2
      printf 'guild-install: supported: claude-code-cli codex-cli pi-cli antigravity-cli agents-file cursor github-copilot opencode rovo-dev kiro qoder trae claude-code-app claude-code-web codex-app claude-ai-connector\n' >&2
      exit 2
    fi
  done
  RESOLVED_HOSTS="${RESOLVED_HOSTS# }"
fi

# ── App/connector refusal (AC-INS-5) ─────────────────────────────────────────
# A recognized-but-unsupported surface anywhere in the resolved set is refused
# LOUDLY with a specific exit code, before any render or install. Fail closed —
# a mixed request (installable + refuse) is refused as a whole rather than doing
# a partial, surprising multi-write. Auto-detect never yields these (no bin/marker).
REFUSED=""
for h in $RESOLVED_HOSTS; do
  if is_refuse_host "$h"; then
    REFUSED="$REFUSED $h"
  fi
done
if [ -n "${REFUSED# }" ]; then
  for h in ${REFUSED# }; do
    warn "$h is an app/connector surface, not a CLI package install target."
  done
  warn "Guild will NOT install a CLI package into an app/connector surface."
  warn "Use the connector/app bootstrap contract: AGENTS.md instructions, .guild file-bus artifacts,"
  warn "and explicit app/connector approval or egress gates. For local plugin execution install one of:"
  warn "  --host claude-code-cli"
  warn "  --host codex-cli"
  warn "  --host pi-cli"
  warn "  --host antigravity-cli"
  exit 4
fi

# ── Consent gate for multi-host writes (AC-INS-3, security S-M3) ──────────────
# Count the write-set (all resolved hosts are payload writes at this point —
# refuse hosts already exited). Writing to more than one host requires explicit
# consent: --yes, or an interactive y/N when stdin is a TTY. Enforced identically
# in dry-run and real mode so the negative control is testable without a real
# install; a single host is never gated (legacy --host behavior unchanged).
HOST_COUNT=0
for h in $RESOLVED_HOSTS; do HOST_COUNT=$((HOST_COUNT + 1)); done

if [ "$HOST_COUNT" -gt 1 ]; then
  if [ "$AUTO_DETECT" -eq 1 ]; then
    say "Auto-detected $HOST_COUNT supported hosts:$RESOLVED_HOSTS"
  else
    say "Selected $HOST_COUNT hosts:$RESOLVED_HOSTS"
  fi
  if [ "$ASSUME_YES" -eq 1 ]; then
    say "Consent: --yes supplied — proceeding with the multi-host write."
  elif [ -t 0 ]; then
    printf '\033[33m[guild]\033[0m Install Guild into these %d hosts?%s [y/N] ' "$HOST_COUNT" "$RESOLVED_HOSTS" >&2
    read -r reply || reply=""
    case "$reply" in
      y|Y|yes|YES) say "Consent: confirmed — proceeding with the multi-host write." ;;
      *) warn "Aborted — multi-host write not confirmed."; exit 3 ;;
    esac
  else
    warn "Refusing to write Guild payload to $HOST_COUNT hosts without consent."
    warn "Re-run with --yes to confirm the multi-host write, or select a single --host."
    warn "  hosts:$RESOLVED_HOSTS"
    exit 3
  fi
fi

# ── Command runners (honor --dry-run) ────────────────────────────────────────
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

abs_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$(pwd)" "$1" ;;
  esac
}

# ── Build once: render every host package a single time (ADR §8 step 3) ───────
RENDERED_DIST=""
RENDERED=0

# Materialize the scripts/ runtime dependency closure (js-yaml et al.) in the
# render source root so build-host-packages.ts can vendor it into every host
# package. A fresh clone ships no node_modules; without this the render
# fails closed (issue #14).
ensure_script_runtime_deps() {
  deps_root="$1/scripts"
  [ -f "$deps_root/package.json" ] || return 0
  # Full render closure — must match SCRIPT_RUNTIME_DEPENDENCIES in
  # scripts/build-host-packages.ts, or a partial install skips the repair path.
  [ -d "$deps_root/node_modules/js-yaml" ] && [ -d "$deps_root/node_modules/argparse" ] && return 0
  if [ -f "$deps_root/package-lock.json" ]; then
    run npm ci --prefix "$deps_root" --omit=dev --no-audit --no-fund
  else
    run npm install --prefix "$deps_root" --omit=dev --no-audit --no-fund
  fi
}

render_host_packages_once() {
  [ "$RENDERED" -eq 1 ] && return
  RENDERED=1

  if [ "$DRY_RUN" -eq 1 ]; then
    generated_at="<generated-at>"
  else
    generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fi

  if [ -f "$SCRIPT_DIR/scripts/build-host-packages.ts" ]; then
    # Running from a checkout: the working tree IS the source — the channel
    # selector only governs the no-checkout clone fallback below.
    if [ "$CHANNEL" != "stable" ]; then
      say "note: --channel $CHANNEL ignored — installing from the local checkout at $SCRIPT_DIR (check out the 'next' branch there to test beta)"
    fi
    SOURCE_COMMIT="$(git -C "$SCRIPT_DIR" rev-parse HEAD 2>/dev/null || true)"
    ensure_script_runtime_deps "$SCRIPT_DIR"
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
    say "would run: git clone --depth 1 --branch $SOURCE_REF $SOURCE_REPO <tmpdir>   # channel: $CHANNEL"
    say "would run: npx tsx scripts/build-host-packages.ts --root <tmpdir> --out dist --generated-at $generated_at"
    RENDERED_DIST="dist"
    return
  fi

  tmpdir="$(mktemp -d)"
  cleanup() { rm -rf "$tmpdir"; }
  trap cleanup EXIT
  say "channel: $CHANNEL (ref: $SOURCE_REF)"
  git clone --depth 1 --branch "$SOURCE_REF" "$SOURCE_REPO" "$tmpdir"
  SOURCE_COMMIT="$(git -C "$tmpdir" rev-parse HEAD 2>/dev/null || true)"
  ensure_script_runtime_deps "$tmpdir"
  out_dir="$(pwd)/dist"
  (cd "$tmpdir" && npx tsx scripts/build-host-packages.ts --root . --out "$out_dir" --generated-at "$generated_at")
  RENDERED_DIST="$out_dir"
}

# ── Install receipts (guild.install_receipt.v1) ──────────────────────────────
# One JSON receipt per installed host at ~/.guild/receipts/<host>.json, plus a
# copy inside package-style installs so guild-run / the update-check hook can
# resolve the channel without the machine registry. Receipts are what make
# `install.sh --update` and channel-aware staleness checks possible (G1-ALL).
RECEIPTS_DIR="${GUILD_RECEIPTS_DIR:-$HOME/.guild/receipts}"
SOURCE_COMMIT=""

plugin_version_from() {
  # $1 = dir containing .claude-plugin/plugin.json
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*$/\1/p' \
    "$1/.claude-plugin/plugin.json" 2>/dev/null | head -1
}

write_receipt() {
  # $1 = host id, $2 = optional package dir to drop a copy into
  [ "$DRY_RUN" -eq 1 ] && return 0
  host_id="$1"; pkg_dir="${2:-}"
  version="$(plugin_version_from "$SCRIPT_DIR")"
  [ -z "$version" ] && [ -n "$RENDERED_DIST" ] && version="$(plugin_version_from "$RENDERED_DIST/claude-code" 2>/dev/null)"
  installed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  receipt=$(printf '{\n  "schema_version": "guild.install_receipt.v1",\n  "host": "%s",\n  "channel": "%s",\n  "ref": "%s",\n  "commit": %s,\n  "version": "%s",\n  "installed_at": "%s"\n}\n' \
    "$host_id" "$CHANNEL" "$SOURCE_REF" \
    "$([ -n "$SOURCE_COMMIT" ] && printf '"%s"' "$SOURCE_COMMIT" || printf 'null')" \
    "${version:-unknown}" "$installed_at")
  mkdir -p "$RECEIPTS_DIR"
  printf '%s' "$receipt" > "$RECEIPTS_DIR/$host_id.json"
  if [ -n "$pkg_dir" ] && [ -d "$pkg_dir" ]; then
    printf '%s' "$receipt" > "$pkg_dir/guild-install-receipt.json"
  fi
}

# ── Per-host install (from the single pre-rendered dist tree) ─────────────────
installed_any=0

install_claude_code_cli() {
  say "Claude Code — $1"
  CLAUDE_MARKETPLACE_PATH="$RENDERED_DIST/claude-code"
  run claude plugin validate "$CLAUDE_MARKETPLACE_PATH"
  run claude plugin marketplace add "$CLAUDE_MARKETPLACE_PATH"
  run claude plugin marketplace update guild
  if [ "$SCOPE_PROJECT" -eq 1 ]; then
    run claude plugin install "$PLUGIN_SPEC" --scope project
  else
    run claude plugin install "$PLUGIN_SPEC"
  fi
  installed_any=1
  write_receipt claude-code-cli
  say ""
  say "Guild installed into Claude Code."
  say "Package wrapper: CLAUDE.md imports AGENTS.md via @AGENTS.md."
  say "RESTART Claude Code now — plugins load at session start. Then run:"
  say '    /guild:guild "your task"'
  say ""
}

install_codex_cli() {
  say "Codex CLI — $1"
  CODEX_MARKETPLACE_PATH="$(abs_path "$RENDERED_DIST/codex-marketplace")"
  CODEX_MARKETPLACE_MANIFEST="$(abs_path "$CODEX_MARKETPLACE_PATH/.agents/plugins/marketplace.json")"
  run_allow_fail codex plugin marketplace remove guild
  run codex plugin marketplace add "$CODEX_MARKETPLACE_PATH"
  run codex plugin add "$PLUGIN_SPEC"
  installed_any=1
  write_receipt codex-cli "$CODEX_MARKETPLACE_PATH"
  say ""
  say "Guild installed into Codex CLI."
  say "Package bootstrap: AGENTS.md plus .agents/skills/guild."
  say "Codex App local plugin link:"
  say "    codex://plugins/guild?marketplacePath=$CODEX_MARKETPLACE_MANIFEST"
  say "After installing/enabling Guild in Codex App, try /guild:status."
  say "If the app slash parser rejects /guild before hooks run, invoke the Guild plugin or bundled guild skill explicitly."
  say "Use the bundled guild-run wrapper for structured Guild runs:"
  say "    guild-run --host codex --prompt \"your task\""
  say ""
}

install_pi_cli() {
  say "Pi CLI — $1"
  PI_PACKAGE_PATH="$RENDERED_DIST/pi"
  run pi install "$PI_PACKAGE_PATH"
  installed_any=1
  write_receipt pi-cli "$PI_PACKAGE_PATH"
  say ""
  say "Guild package prepared for Pi CLI."
  say "Package bootstrap: AGENTS.md plus .agents/skills/guild and pi-manifest.json."
  say "Unsupported hooks and MCP are surfaced as Guild degradation receipts; memory falls back through .guild filesystem/BM25."
  say "Use the bundled guild-run wrapper for structured Guild runs:"
  say "    guild-run --host pi --prompt \"your task\""
  say ""
}

install_antigravity_cli() {
  say "Antigravity CLI — $1"
  ANTIGRAVITY_PACKAGE_PATH="$RENDERED_DIST/antigravity"
  run agy plugin validate "$ANTIGRAVITY_PACKAGE_PATH"
  run agy plugin install "$ANTIGRAVITY_PACKAGE_PATH"
  installed_any=1
  write_receipt antigravity-cli "$ANTIGRAVITY_PACKAGE_PATH"
  say ""
  say "Guild package prepared for Antigravity CLI."
  say "Package bootstrap: AGENTS.md plus .agents/skills/guild, plugin.json, and antigravity-manifest.json."
  say "Unsupported hooks and MCP are surfaced as Guild degradation receipts; memory falls back through .guild filesystem/BM25."
  say "Use the bundled guild-run wrapper for structured Guild runs:"
  say "    guild-run --host antigravity --prompt \"your task\""
  say ""
}

install_agents_file() {
  say "Universal AGENTS.md package — $1"
  installed_any=1
  write_receipt agents-file "$RENDERED_DIST/agents"
  say ""
  say "Universal AGENTS.md package rendered at:"
  say "  $RENDERED_DIST/agents/AGENTS.md"
  say "  $RENDERED_DIST/agents/.agents/skills/guild"
  say "Copy this package into an AGENTS.md-consuming project or workspace."
  say ""
}

# New-CLI hosts (cursor/github-copilot/opencode/rovo-dev): installability "target",
# no native plugin manager — the package tree is the deliverable, bootstrapped via
# the bundled guild-run wrapper (ADR §4/AC-BOOT-1). Package tree = dist/<id>.
install_new_cli() {
  host="$1"; mode="$2"
  say "$host (new-CLI) — $mode"
  NEW_CLI_PATH="$RENDERED_DIST/$host"
  if [ "$DRY_RUN" -eq 1 ]; then
    say "would prepare package tree: $NEW_CLI_PATH"
    say "would wire launcher: $NEW_CLI_PATH/bin/guild-run --host $host"
  else
    if [ ! -d "$NEW_CLI_PATH" ]; then
      warn "expected rendered package tree missing: $NEW_CLI_PATH"
      return 1
    fi
    say "Package tree prepared: $NEW_CLI_PATH"
  fi
  installed_any=1
  write_receipt "$host" "$NEW_CLI_PATH"
  say ""
  say "Guild package prepared for $host."
  say "Package bootstrap: AGENTS.md plus .agents/skills/guild and $host-manifest.json (installability: target)."
  say "This host has no native plugin manager — bootstrap through the bundled guild-run wrapper:"
  say "    $NEW_CLI_PATH/bin/guild-run --host $host --prompt \"your task\""
  say ""
}

# New-IDE hosts (kiro/qoder/trae): file surface, adapter_binding "agents-file"
# (ADR §3.1) — they REUSE the universal agents-file package (dist/agents), never a
# per-host tree. The editor reads root AGENTS.md; the marker dir is detection only.
install_new_ide() {
  host="$1"; mode="$2"
  case "$host" in
    kiro)  marker=".kiro" ;;
    qoder) marker=".qoder" ;;
    trae)  marker=".trae" ;;
    *)     marker="" ;;
  esac
  say "$host (new-IDE, agents-file binding) — $mode"
  IDE_PATH="$RENDERED_DIST/agents"
  if [ "$DRY_RUN" -eq 0 ] && [ ! -d "$IDE_PATH" ]; then
    warn "expected rendered agents-file package missing: $IDE_PATH"
    return 1
  fi
  installed_any=1
  write_receipt "$host" "$IDE_PATH"
  say ""
  say "Guild package for $host is the universal AGENTS.md package (adapter_binding: agents-file):"
  say "  $IDE_PATH/AGENTS.md"
  say "  $IDE_PATH/.agents/skills/guild"
  say "Copy it into your $host project root (marker: $marker/). $host reads root AGENTS.md."
  say ""
}

dispatch_host() {
  host="$1"
  if [ "$DRY_RUN" -eq 1 ]; then mode="dry-run"; else mode="install"; fi
  case "$host" in
    claude-code-cli)  install_claude_code_cli "$mode" ;;
    codex-cli)        install_codex_cli "$mode" ;;
    pi-cli)           install_pi_cli "$mode" ;;
    antigravity-cli)  install_antigravity_cli "$mode" ;;
    agents-file)      install_agents_file "$mode" ;;
    cursor|github-copilot|opencode|rovo-dev) install_new_cli "$host" "$mode" ;;
    kiro|qoder|trae)  install_new_ide "$host" "$mode" ;;
    *)
      warn "internal: no install path for host $host"
      return 1
      ;;
  esac
}

# ── Render once, then install every resolved host ────────────────────────────
render_host_packages_once

for host in $RESOLVED_HOSTS; do
  dispatch_host "$host"
done

if [ "$installed_any" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
  exit 1
fi

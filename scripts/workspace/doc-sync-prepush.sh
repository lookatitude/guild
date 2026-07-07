#!/usr/bin/env bash
# scripts/workspace/doc-sync-prepush.sh
#
# Optional doc-sync check hook for pre-push.
#
# DO NOT modify .githooks/pre-push (which enforces no-direct-main push).
# Instead, append a call to this script from your pre-push hook, or wire it
# as a separate hook via a hook manager (e.g. husky, lefthook).
#
# CROSS-REPO SETUP (Finding #1): The check diffs BOTH repos:
#   - Plugin repo: for commands/** and user_facing skill changes.
#   - Root (workspace) repo: for docs/knowledge/** changes.
# This script auto-discovers both from the workspace layout:
#   - Plugin repo = <this-script's-repo-root>  (the plugin git repo)
#   - Root repo   = parent directory if .guild/workspace.json exists there
#                   (the umbrella workspace); else falls back to plugin repo.
#
# Usage (manual):
#   bash scripts/workspace/doc-sync-prepush.sh [--strict]
#
# To add to an existing pre-push hook, append:
#   bash "$(git rev-parse --show-toplevel)/scripts/workspace/doc-sync-prepush.sh"
#
# Options:
#   --strict   Exit non-zero when flagged (blocks the push). Default: warn only.
#
# Local invocation example:
#   bash scripts/workspace/doc-sync-prepush.sh --strict
#
# CI (PR range) invocation example:
#   npx tsx scripts/workspace/check-doc-sync.ts \
#     --plugin-repo ./plugin --root-repo . \
#     --plugin-range origin/main...HEAD \
#     --root-range origin/main...HEAD \
#     --strict
#
# The check is warn-not-block by default (per Rule 2 spec: R2 = advisory until
# the root→website generation pipeline lands).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Plugin repo = git root of the repo that contains this script
PLUGIN_REPO="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null || echo "${SCRIPT_DIR}/../..")"

# Root repo = parent of plugin if workspace.json exists there; else same as plugin
PARENT_OF_PLUGIN="$(cd "${PLUGIN_REPO}/.." && pwd)"
if [[ -f "${PARENT_OF_PLUGIN}/.guild/workspace.json" ]]; then
  ROOT_REPO="${PARENT_OF_PLUGIN}"
else
  ROOT_REPO="${PLUGIN_REPO}"
fi

STRICT_FLAG=""
for arg in "$@"; do
  if [[ "$arg" == "--strict" ]]; then
    STRICT_FLAG="--strict"
  fi
done

exec npx tsx "${SCRIPT_DIR}/check-doc-sync.ts" \
  --plugin-repo "${PLUGIN_REPO}" \
  --root-repo "${ROOT_REPO}" \
  --plugin-range "origin/main...HEAD" \
  --root-range "origin/main...HEAD" \
  ${STRICT_FLAG}

#!/usr/bin/env bash
set -euo pipefail
cat <<'FIRST' <<'SECOND'
just a banner
FIRST
node "${CLAUDE_PLUGIN_ROOT}/hooks/dist/ensure-storage-layout.js"
SECOND
mkdir -p "$PWD/.guild/wiki"

#!/usr/bin/env bash
set -euo pipefail
node "${CLAUDE_PLUGIN_ROOT}/hooks/dist/ensure-storage-layout.js" --cwd "$PWD"
mkdir -p "$PWD/.guild/wiki"

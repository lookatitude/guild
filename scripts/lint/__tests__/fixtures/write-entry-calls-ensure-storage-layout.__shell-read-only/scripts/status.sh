#!/usr/bin/env bash
# D4: reads .guild only; it isn't a writer, so it isn't in scope.
set -euo pipefail
cat "$PWD/.guild/guild.yaml" 2>/dev/null || true

---
type: standard
owner: plugin-engineer
confidence: high
importance: medium
source_refs:
  - plugin/hooks/check-skill-coverage.sh
  - plugin/hooks/bootstrap.sh
created_at: 2026-05-02
updated_at: 2026-05-02
sensitivity: internal
---
# Standard: Shell Hook JSON Parsing

## Rule

Shell hooks that receive structured JSON on stdin MUST use the temp-file +
python3 pattern. Do NOT interpolate JSON payloads into bash variables.

## Why

Bash variable interpolation breaks silently on JSON payloads that contain:

- Single quotes (breaks `${VAR//\'/\'\\\'\'}` substitution)
- Backslash sequences (escape interpretation corrupts values)
- Newlines (IFS word-splitting discards or merges lines)
- Unicode characters (locale-dependent mangling)

All of these appear in real Claude Code hook payloads (e.g., user prompts with
apostrophes, code snippets with backslashes). Failures are silent — the
substitution produces garbage rather than an error, so tests on simple payloads
pass while production use breaks.

The `set -u` flag (used in Guild hooks) also triggers unbound-variable errors
when a variable that was supposed to be set by the interpolation is empty due
to parse failure, as happened with `PROMPT_LOWER` in `check-skill-coverage.sh`.

## Correct pattern

```bash
PAYLOAD_FILE="$(mktemp /tmp/guild-hook-payload.XXXXXX)"
cat > "${PAYLOAD_FILE}"
trap 'rm -f "${PAYLOAD_FILE}"' EXIT

FIELD_A=""
FIELD_B=""
if command -v python3 &>/dev/null; then
  IFS=$'\t' read -r FIELD_A FIELD_B < <(python3 - "${PAYLOAD_FILE}" <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1], "r", encoding="utf-8", errors="replace") as f:
        d = json.load(f)
    a = d.get("field_a", "") or ""
    b = d.get("field_b", "") or ""
    print(a.replace("\n", " ").replace("\t", " ") + "\t" + b)
except Exception:
    print("\t")
PYEOF
) 2>/dev/null || true
else
  # python3 unavailable: best-effort fallback
  FIELD_A="$(cat "${PAYLOAD_FILE}")"
fi
```

Key points:
- `mktemp` creates the temp file before `cat` reads stdin (never pipe stdin
  directly to python3 via `<(python3 ...)` — process substitution races with
  stdin closure).
- `trap ... EXIT` cleans up the temp file even on early exit.
- The python3 heredoc opens the file by path, not by stdin — safe for any
  payload content.
- Tab-separated output + `IFS=$'\t' read -r` extracts multiple fields without
  word-splitting on spaces inside field values.
- `errors="replace"` in `open()` prevents python3 from crashing on malformed
  UTF-8.
- The `|| true` after the process substitution ensures `set -e` hooks don't
  abort if python3 exits non-zero.

## Where this standard applies

Any bash script under `hooks/` that reads JSON from stdin (Claude Code hook
events: `UserPromptSubmit`, `PostToolUse`, `SubagentStop`, `PreToolUse`, etc.).
Also applies to scripts under `scripts/` that parse JSON from stdin.

## Reference implementation

`hooks/check-skill-coverage.sh` — the current implementation of this pattern.

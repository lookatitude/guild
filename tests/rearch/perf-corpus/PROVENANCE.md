# perf-corpus — Provenance and Scrub Proof

## Purpose

Sanitized-real JSONL event logs used by R-PERF to measure p95 latency baselines
over representative run sizes. These files are read-only reference data and are
never used as live run state.

## Corpus files

| File | Source run | Lines | Run type |
|---|---|---|---|
| run-small-636.jsonl | run-learn-knowledge-convergence-20260529-094021 | 636 | learn/knowledge pass |
| run-medium-942.jsonl | run-85d27757-f47b-4ccd-adaf-f91c749a4e8f | 942 | v2 gap-closure build run |
| run-large-1784.jsonl | run-universal-host-plugin-architecture-20260617-152632 | 1784 | universal-host P2 Wave 3 |

## Scrub proof

Each file was scrubbed in two passes before commit:

**Pass 1 — operator-path redaction (matching scripts/dot-guild/scrub.ts patterns):**
- `/Users/<name>/Projects/<repo>` → `<workspace-root>`
- `~/.claude/projects/-Users-<name>-Projects-<repo>` → `<operator-memory-root>`

**Pass 2 — additional home-path patterns (belt-and-suspenders):**
- `/Users/<name>/.claude` → `<operator-home>/.claude`
- `/Users/<name>/.codex` → `<operator-home>/.codex`
- Bare `/Users/<name>` (not followed by /Projects/) → `<operator-home>`

**Residual audit:** after the final scrub pass, grep checks for real home paths,
email addresses, OpenAI key shapes, bearer tokens, and known operator identity
strings returned no matches.

**No secrets found:** no API keys, bearer tokens, real home paths, operator
email addresses, or known operator identity strings were detected in any corpus
file.

## Anti-vacuity check

The corpus files contain real event shapes (tool_call, PostToolUse,
UserPromptSubmit, run_started) that the perf harness parses and processes.
The R-PERF rail verifies the corpus is non-empty before measuring.

## Source runs (workspace root)

All three source runs live under the umbrella workspace `.guild/runs/` at
`/Users/<name>/Projects/guild/.guild/runs/`. They are gitignored project-state
and were never committed. The corpus files here are the scrubbed extracts.

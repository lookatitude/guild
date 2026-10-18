# run-analysis — `/guild:maintain analyze <...>`

The analyze sub-verb is a thin route to ONE compiled CLI. Every invocation below
is the complete command: plain Node on the shipped bundle, never tsx, never a
print-only alias, never this assembler re-deriving analysis in prose. The CLI is
the only writer; this chapter only teaches its argv and authority boundaries.

## Invocations (C-CLI)

```bash
node "$GUILD_PLUGIN_ROOT/runtime/scripts/run-analysis.js" run analyze <run-id> --cwd <root>
node "$GUILD_PLUGIN_ROOT/runtime/scripts/run-analysis.js" run compare <run-id> <run-id...> --cwd <root>
node "$GUILD_PLUGIN_ROOT/runtime/scripts/run-analysis.js" initiative analyze <initiative-id> --cwd <root>
node "$GUILD_PLUGIN_ROOT/runtime/scripts/run-analysis.js" independent-runs analyze <group-id> --cwd <root>
node "$GUILD_PLUGIN_ROOT/runtime/scripts/run-analysis.js" artifact inspect <run|comparison> <id> --cwd <root>
node "$GUILD_PLUGIN_ROOT/runtime/scripts/run-analysis.js" recommendation decide <source-id> <rec> <accept|reject> --expected-analysis-id <analysis-id> --expected-input-hash <sha256> --cwd <root>
node "$GUILD_PLUGIN_ROOT/runtime/scripts/run-analysis.js" recommendation status <source-id> <rec> <status> --cwd <root>
```

Public token order maps 1:1 onto the CLI: `analyze run <id>` → `run analyze <id>`,
`analyze compare <id> <id...>` → `run compare`, `analyze initiative <id>` →
`initiative analyze`, `analyze independent <id>` → `independent-runs analyze`,
`analyze inspect run|comparison <id>` → `artifact inspect`, and the two
`analyze recommendation ...` forms pass through unchanged. Forward the user's
tokens into the argv positions verbatim; flags are closed — anything the table
above does not name is the parser's to refuse, never this assembler's to guess.

## Exit codes and status output

- `0` — valid success, **including** `inspect` diagnostic states: the JSON result
  carries `state: current | stale | missing | unsupported` (a missing or stale
  artifact is a successful diagnosis, not an error). Analyze prints
  `{ ok, analysis_id, eligible, written }`; compare prints
  `{ ok, comparison_id, run_ids, written }`.
- `1` — operational refusal: unsafe id, `inspect` `state: refused`, and
  `expected_context_changed` on a conditional decide whose expected identity or
  current input no longer matches. Report the CLI's own JSON/stderr verbatim.
- `2` — usage: unknown or duplicate flag, missing flag value, or an incomplete
  `--expected-analysis-id` / `--expected-input-hash` pair (they travel together).

## Authority boundaries

- **Inspection is read-only.** `artifact inspect` creates no directory, queue,
  lock, journal, sidecar, or index; run it freely to answer freshness questions.
- **Analyze/compare write derived artifacts only** — `.guild/analysis/**` and a
  recommendation feed under `.guild/recommendations/**`. For `run analyze`, a
  current canonical artifact is reused (`cache: hit`, `written: null`); only a
  stale or malformed one regenerates. `run compare`, `initiative analyze`, and
  `independent-runs analyze` are aggregate commands: each run writes its
  constituent analyses and the comparison, and they return comparison output
  (`comparison_id`, `run_ids`), never a cache status. Nothing else in the run
  tree is touched.
- **Recommendation decisions are explicitly gated and never auto-filed.** A
  browser- or UI-originated accept MUST carry both `--expected-*` flags (stale
  context returns `expected_context_changed` and writes nothing). An accept
  records by scope: a project recommendation queues a proposal
  (`status: queued`, `effect: project_proposal_queued`); a plugin recommendation
  writes a sanitized draft at `.guild/recommendations/drafts/<id>.md`
  (`status: accepted`, `effect: plugin_draft_written`). Neither ever files an
  issue, mutates a capability, or writes the wiki. Status
  transitions (`filed | implemented | superseded`) are operator CLI authority
  only and are recorded to the activity journal.

Decisions about whether to ACT on a recommendation stay with the operator and
the normal gates; this route only records them.

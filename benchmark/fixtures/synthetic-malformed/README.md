# synthetic-malformed/

Intentionally incomplete fixture — only `run.json` is present. Both
`events.ndjson` and `.guild/` are absent on purpose.

The artifact-importer must parse `run.json` cleanly, then surface
`partial: true` with `missing_artifacts: ["events.ndjson",
"artifacts/.guild"]` (per `01-architecture.md` §4 cross-cutting note).
The scorer must still produce a `Score` (never throw) and propagate
`partial: true` to `score.json`.

A separate test (`tests/artifact-importer.test.ts`) exercises the
"events.ndjson with one invalid line" path against a temp directory —
that case is excluded here so this fixture stays loadable.

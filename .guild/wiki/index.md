# Guild Wiki Index

## decisions

- [universal-host-p2-p3-wave-sequencing](decisions/universal-host-p2-p3-wave-sequencing.md) - 2026-06-17 - Finish ADR steps 12-19 as 3 sequential waves; defer the step-15 `.claude-plugin`→`dist/` install-channel flip until after v2.0.0 ships.
- [guild-diagnose-self-fix-command](decisions/guild-diagnose-self-fix-command.md) - 2026-05-02 - `/guild:diagnose` is the self-fix dogfooding command with a user gate.
- [codex-review-user-facing-opt-in](decisions/codex-review-user-facing-opt-in.md) - 2026-05-02 - `--codex-review` is a documented opt-in feature with graceful skip.
- [run-scoped-telemetry-and-loop-events](decisions/run-scoped-telemetry-and-loop-events.md) - 2026-05-02 - Telemetry is scoped per `/guild` invocation and loop events are emitted at real round boundaries.
- [benchmark-import-and-fixture-artifact-policy](decisions/benchmark-import-and-fixture-artifact-policy.md) - 2026-05-02 - Benchmark imports arbitrary Guild runs and versions synthetic `.guild` fixture artifacts.
- [archived-phase-gates-remain-historical](decisions/archived-phase-gates-remain-historical.md) - 2026-05-02 - Archived gate/audit records keep historical counts; active docs carry current truth.
- [emit-loop-event-self-contained](decisions/emit-loop-event-self-contained.md) - 2026-05-02 - `emit-loop-event.ts` must be self-contained; benchmark import fails silently and writes to the wrong path.
- [two-audit-schemas](decisions/two-audit-schemas.md) - 2026-05-02 - Plugin `events.ndjson` and benchmark `logs/v1.4-events.jsonl` are separate schemas; never cross them.

## standards

- [shell-hook-json-parsing](standards/shell-hook-json-parsing.md) - 2026-05-02 - Shell hooks must use temp-file + python3 for JSON parsing; bash variable interpolation breaks silently.


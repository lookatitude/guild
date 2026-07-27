# Guild Wiki Index

## decisions

- [task-cell-runtime-contract](decisions/task-cell-runtime-contract.md) - 2026-07-14 - Every lifecycle step emits a code-owned TaskCell (fan-out conditional: lead_only/plus_one/plus_many); three-layer specialist identity (type→profile→ephemeral instance, never reused); immutable terminal attempts; lifecycle-bearing backend replaces the launch()-only seam. Freeze record for the task-cell-runtime initiative.
- [g-series-learn-clis-on-demand-only](decisions/g-series-learn-clis-on-demand-only.md) - 2026-07-13 - The G-series learn CLIs (extract-structural G1/G4, resolve-calls G2) are experimental/on-demand-only; learn-diff never calls them (KG-no-mutation contract) — false header claim corrected, files kept as tested test-fixture infrastructure.
- [v2-final-design-and-doc-artifact-boundary](decisions/v2-final-design-and-doc-artifact-boundary.md) - 2026-06-18 - Keep `docs/v2/` as final design, `docs/knowledge/` as ADR/provenance, and remove historical drift/transfer/run artifacts from final docs while tracking live host/install gaps separately.
- [telemetry-anchors-to-repo-root-not-cwd](decisions/telemetry-anchors-to-repo-root-not-cwd.md) - 2026-06-17 - Telemetry/run-state writes must resolve the repo root via guild-root.ts (not process cwd) so a sub-dir cwd can't create a nested `.guild/`; audit `nested-guild` stays the backstop.
- [universal-host-p2-p3-wave-sequencing](decisions/universal-host-p2-p3-wave-sequencing.md) - 2026-06-17 - Finish ADR steps 12-19 as 3 sequential waves; defer the step-15 `.claude-plugin`→`dist/` install-channel flip until after v2.0.0 ships.
- [guild-diagnose-self-fix-command](decisions/guild-diagnose-self-fix-command.md) - 2026-05-02 - `/guild:diagnose` is the self-fix dogfooding command with a user gate.
- [codex-review-user-facing-opt-in](decisions/codex-review-user-facing-opt-in.md) - 2026-05-02 - `--codex-review` is a documented opt-in feature with graceful skip.
- [run-scoped-telemetry-and-loop-events](decisions/run-scoped-telemetry-and-loop-events.md) - 2026-05-02 - Telemetry is scoped per `/guild` invocation and loop events are emitted at real round boundaries.
- [benchmark-import-and-fixture-artifact-policy](decisions/benchmark-import-and-fixture-artifact-policy.md) - 2026-05-02 - Benchmark imports arbitrary Guild runs and versions synthetic `.guild` fixture artifacts.
- [archived-phase-gates-remain-historical](decisions/archived-phase-gates-remain-historical.md) - 2026-05-02 - Archived gate/audit records keep historical counts; active docs carry current truth.
- [emit-loop-event-self-contained](decisions/emit-loop-event-self-contained.md) - 2026-05-02 - `emit-loop-event.ts` must be self-contained; benchmark import fails silently and writes to the wrong path.
- [two-audit-schemas](decisions/two-audit-schemas.md) - 2026-05-02 - Plugin `events.ndjson` and benchmark `logs/v1.4-events.jsonl` are separate schemas; never cross them.
- [wave3-producer-skill-additive](decisions/wave3-producer-skill-additive.md) - 2026-06-17 - Accept the LW3-5 producer skill as a ratified additive new live skill; skills/** additive-only, .claude-plugin/+commands/ stay strict byte-identical.

## standards

- [host-distribution-matrix](standards/host-distribution-matrix.md) - 2026-07-25 - How a released version reaches each of the 16 registry hosts: what each host supports vs what Guild wires, per-host install/version/publish/update/staleness rows with V/S/U evidence marking. Key finding: Codex already has full Claude-parity git-marketplace distribution (verified: `codex plugin marketplace add lookatitude/guild --ref main` installs 2.3.2 today) — install.sh registers a LOCAL path instead, freezing it. Same gap for pi and antigravity.
- [release-discipline](standards/release-discipline.md) - 2026-07-12 - Branch-backed channels (stable=main, beta=next), next-first PR flow, release/vX.Y.Z cut from next, automated tag+Release, sync-back; the numbered ruleset cited by pre-push, release.yml, and branch-policy.yml.
- [shell-hook-json-parsing](standards/shell-hook-json-parsing.md) - 2026-05-02 - Shell hooks must use temp-file + python3 for JSON parsing; bash variable interpolation breaks silently.

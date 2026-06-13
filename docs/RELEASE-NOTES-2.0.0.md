# Guild v2.0.0

## [2.0.0] — UNRELEASED (release/v2.0.0)

Guild v2 — the full redesign: one state machine, six phases, specialist
teams, durable knowledge, adversarial review, and a v1→v2 migrator. The
canonical design set is `docs/v2/` in the workspace repo (18 docs,
3-tier-audited 2026-06-11: coverage / completeness / code-conformance all
adversarially gated).

### Added

- **Single-verb lifecycle**: `/guild:guild [brief]` plus phase commands
  `init ideate plan build qa ops`, with `--rigor=quick|standard|deep`
  profile expansion, 5 global flags, universal `--dry-run`.
- **Specialist teams**: per-phase team composition (G-team gate, cap 6),
  cost-tiered routing (`cheap|mid|powerful`), ephemeral per-task agents,
  tmux team backend with liveness (tier-scaled idle timeouts,
  heartbeats, failed→dead reaping).
- **Knowledge & memory**: `.guild/wiki/` canonical store with BM25 recall,
  importance grading, ingest similarity + injection probes, harvest →
  reflect promotion path; `guild-memory` + `guild-telemetry` MCP servers.
- **Adversarial review**: the cross-family review broker at seven gates
  (G-init/G-spec/G-plan/G-lane/G-quality/G-operations/G-diagnose) with
  STRONG/WEAK independence stamps, sentinel loops, checksum-bound
  5-condition gate-pass; `--review=local|cross|off`.
- **Quality & Operations phases**: computed release predicate (DI-2),
  runbook classes + safety rails (DI-3), PASS-only `qa` auto-approve token.
- **Initiatives** (opt-in): durable goals owning progress across runs,
  4-axis status, D-gates with release evidence.
- **Security**: capability AND-mask in PreToolUse, forced
  bypassPermissions deny under autonomy modes, 3-stage secrets scrubbing
  (incl. handoffs + provenance), trust-tier recall wrappers, fail-closed
  ingest probe, MCP capability declarations + description pinning,
  append-only security-events log, adversarial eval fixtures.
- **Observability**: `guild.run.v1`/`guild.provenance.v1` run records,
  v1.4 trace events, `/guild:status`, `/guild:stats`, `/guild:dashboard`
  (benchmark UI against the live project), `/guild:audit`.
- **v1→v2 migrator**: `/guild:migrate` (detect → snapshot → convert;
  dry-run default; `--workspace` fan-out) + SessionStart v1 detection +
  gated wiki importance backfill (`--accept-grades`).
- **Codebase understanding**: `learn` pipeline (7-stage script→LLM),
  codebase map, lazy knowledge graph, refresh classifier.
- **Installer**: repo-hosted `install.sh` (host-detecting; primary
  `guildstack.dev/install.sh`, fallback raw.githubusercontent — domain-
  independent by design).

### Changed

- Commands renamed: `/guild:guild-x` → `/guild:x` (namespace stays;
  redundant prefix dropped); `guild-diagnose` → `fix`; team-compose
  folded into `plan`. Full map: `MIGRATION.md §2`.
- Config: `config.yml` → `.guild/settings.json` (closed keys, 7-source
  inheritance, `--validate` hard-rejects unknown keys).
- Run records: `metadata.json` → `run.yaml` + `provenance.json` (the
  dual-write shim shipped during migration and is retired).

### Removed

- v1 command names (removed names print a redirect and exit non-zero —
  no executing shims; redirect stubs deleted in this release).
- `defaults.agent_team` config alias (`agent_mode` is sole authority).
- `config.yml` back-compat read shim (the migrator converts it instead).

### Deferred to v2.x

The honest deferral list (33 design deferrals + carried followups +
known issues) is maintained in the workspace closeout register:
`.guild/audits/gap-run-20260611/release/v2-closeout-register.md §2` and
is embedded verbatim in the v2.0.0 release-PR body
(`docs/RELEASE-NOTES-2.0.0.md`). Headlines: composite recall scoring +
labels taxonomy, initiative ledger automation + enum validator, FDC
degradation-signal trace emitters, trace replay tools, per-host
packaging beyond Claude Code (Codex standalone, Gemini, Pi), KB
snapshot/rollback (defense layer 5), SQLite state projections.

---

# Deferred to v2.x — the honest list

Every item below is an honest, design-fixed deferral; none breaks a core flow (init → ideate → plan → build → qa → ops, migrate, wiki, review, dashboard) during operator testing — the v2-gap-closure run (G-1..G-19, CLOSED 2026-06-10) already retagged every shipped-claim to match code. One-line phrasings ready for the release notes:

### Lifecycle (docs/v2/03)
1. **Init resume-repair station** — init classifies greenfield vs brownfield only; the validate-and-repair station for existing `.guild/` lands in v2.x. *(03-lifecycle.md §Phase contracts + §Resume-repair)*
2. **Init staging → G-init-promote gate** — the `.guild/init/staging/` dir + interactive promote-gate automation is contract-frozen, unbuilt; the candidates-only invariant is carried by `guild:decisions`/`guild:wiki-ingest` today. *(03-lifecycle.md §Init staging, `[v2-contract-only]`)*
3. **Ideation knowledge-binding + min-build spec** — running ideate without an init wiki surfaces the gap and asks; the resolver-built minimal baseline (`grounded_in: init_minimal`) is v2.x. *(03-lifecycle.md §A min-build spec)*
4. **Init offers a first initiative** — the opt-in "create an initiative?" final step of init is design-fixed, not yet made by the shipped init skill. *(06-initiatives.md §Opt-in posture)*

### Knowledge & memory (docs/v2/05)
5. **Wiki label taxonomy** — `project.yaml → label_taxonomy`, wiki frontmatter `labels:`, the 9-value `concern` enum, and the wiki-lint label-coverage check are ratified, not built (the graph-side `component`/`domain` labels DO ship). *(05-knowledge-memory.md §Label Schema split)*
6. **Composite recall scoring** — shipped recall is BM25-only; the relevance × recency × importance formula is the v2.x target. *(05-knowledge-memory.md §Recall scoring)*
7. **Importance-at-ingest grading + ≥3 recall gate** — the `models.importanceGate` config key ships; the write-time 1–5 scorer and the recall.ts gate enforcement do not. *(05-knowledge-memory.md §Importance-at-ingest)*
8. **Tombstone invalidation** — checksum staleness ships; tombstone-never-delete semantics for superseded decisions/deleted artifacts are v2.x. *(05-knowledge-memory.md §Invalidation)*
9. **Typed `learning_candidate` shape** — the shipped harvest queue is `guild.harvest_candidates.v1`; the refined 7-value typed candidate shape is v2.x. *(05-knowledge-memory.md §Candidate queue)*

### Initiatives (docs/v2/06)
10. **`guild.initiative.v1` validator + manifest migration** — the manifest contract is frozen; no code writes/validates it yet, and real manifests carry legacy axis vocabulary (the v2.x adoption step). *(06-initiatives.md §Registry & directory, `[v2-contract-only]`)*
11. **Definition-ledger machinery** — entries are manual capture against the frozen `definition_item` shape; the automation is v2.x. *(06-initiatives.md §Definition ledger)*
12. **`activity.jsonl` frozen event schema** — manual-capture appends ship; a frozen event schema is v2.x. *(06-initiatives.md §Directory)*
13. **Auto-driven release/docs work-item population** — `release/` + `docs-sync/` dirs are scaffolded; auto-population is the deferred automation (manual capture satisfies the D8 gate in v2). *(06-initiatives.md §D8)*
14. **Retention enforcement** — `retention_class` is recorded per run; the 90-day/until-archive cleanup job is a v2.x Operations-maintenance-runbook candidate. *(06-initiatives.md §Per-run provenance)*
15. **Initiatives-registry rollup builder** — `initiatives-registry.yaml` ships with consumers but is hand-maintained; the rebuild/derive script is v2.x. *(06-initiatives.md §Derived rollup)*
16. **D8 close-gate automation** — the three-part close contract is frozen and satisfied by manual capture; the automation is v2.x. *(06-initiatives.md §The D8 close gate)*

### Dispatch & execution (docs/v2/08)
17. **FDC degradation trace rows** — `coordination.parallelism`/`backend_rung`, `dispatch.deferred`, the `feature_degraded` trace row, `degraded_retrieval: fs_bm25`, `tier_degraded`, and per-surface `degraded_reason` trace rows have no emitter yet (primary-artifact signals + `dispatch_rung` on security events DO ship). *(08-dispatch-execution.md §Degradation signal table)*
18. **Codex-cloud routing + `guild.cloud_task_packet.v1`** — contract-only; never the router default, reachable only behind the human-approved `cloud_opt_in` egress checkpoint. *(08-dispatch-execution.md §Host routing; 07 §Host roster)*
19. **Mixed-host tmux sibling coordination contracts** — the two sibling contracts for mixed Claude+Codex tmux teams are frozen, unbuilt. *(08-dispatch-execution.md §Mixed-host teams)*
20. **Full-class telemetry redirect** — the full-class export redirect is v2.x; the partial path ships. *(08-dispatch-execution.md:482)*
21. **Reserved lane-schema field** — reserved in the contract, no reader ships. *(08-dispatch-execution.md:497)*
22. **`guild.run_manifest.v1` multi-wave program state** — dormant forward-prep (schema + writer-CLI + reader exist, neither wired); promoted only when multi-wave dispatch ships. *(08-dispatch-execution.md §Contract table; drift ledger ARCH-8)*

### Adversarial review (docs/v2/09)
23. **Owner↔architect implementation loop** — a v2.x candidate loop, not a shipped layer. *(09-adversarial-review.md:150)*
24. **`guild.advisory.v1` record writer** — advisory-panel outcome persistence is contract-frozen; the panel skills don't write the record yet. *(09-adversarial-review.md §Advisory records)*
25. **Cloud-reviewer consent egress gate** — the dedicated pre-dispatch consent event + gate for cloud reviewers is v2.x (the always-ask checkpoint covers it today). *(09-adversarial-review.md §Cloud-reviewer consent)*

### Hosts & distribution (docs/v2/07, 15)
26. **Host adapters beyond Claude Code + Codex CLI** — Gemini CLI, Pi, Antigravity are detect-only; Claude Code Web and Claude.ai connector are design targets; Codex app is contract-only. *(07-host-adversarial-adaptability.md §Host roster)*
27. **Per-host packaging surfaces** — `.codex-plugin/plugin.json`, Gemini TOML, Pi package manifest renderers are not shipped. *(15-distribution.md §Per-host packaging)*

### Security (docs/v2/11)
28. **KB snapshot & rollback (defense Layer 5)** — the knowledge-base snapshot/rollback layer of the 6-layer injection-defense model is specced, deferred. *(11-security.md §KB snapshot & rollback)*

### Observability (docs/v2/04, 12)
29. **SQLite `run_state`/`spans`/`files_touched` projections** — none of the three tables ships; the run sentinel folds into `run_state` when it lands. *(12-observability.md §Projections; 04 §run sentinel)*
30. **Replay-facing run-dir completion** — specified, not yet emitted. *(12-observability.md §The run directory)*
31. **`trace_replay_timeline` + `trace_context_replay` MCP tools** — contract frozen; guild-telemetry ships only the 4 `trace_*` query tools. *(12-observability.md §Replay & diagnosis; gap-closure G-2 doc-truth close)*
32. **Execution replay + counterfactual trace auditing** — deferred to a later track (needs structured payloads + sandbox isolation + deterministic seeding). *(12-observability.md §Replay modes)*

### Carried forward-work followups (drift-remediation §8 — each with a named promotion trigger)
33. **multi-wave-program-wiring** — wire `run_manifest` writer+reader together when multi-wave dispatch ships. *(COMPLETENESS-LEDGER.md §8)*
34. **heartbeat-write-side** — agent-side heartbeat emission if tmux pane-alive liveness proves insufficient. *(ledger §8 / ARCH-9)*
35. **W2-A1 isolation-capability_set** — becomes live only when hosts advertise `capability_set.isolation`. *(ledger §8)*
36. **W3-shared-lib tier + D-RECALL-perf + resolves-from-open-questions-array** — hygiene/perf/minor-derivation followups, explicitly accepted with rationale. *(ledger §8)*

### Resolved + open backlog
37. **`--loops` / `--loop-cap` / `--codex-cap` flag status — RESOLVED (kept as power-user flags).** The 2026-06-06 "removed-but-still-parsed" contradiction was dispositioned (R-001, 2026-06-07): the flags are **intentionally supported** power-user flags (`--rigor` + `.guild/settings.json` is the recommended path). The shipped parser correctly parses + clamps them (`read-guild-config.ts`), and the root source-of-truth docs (`command-surface.md` §4.1, `MIGRATION.md`) now say **"Supported (power-user flag)"** — code and root docs agree. Residual (doc-only, no code): the website pages still echoing "deleted/config-only" are re-reconciled to "supported" as part of item 39 (website second pass). *( `.guild/initiatives/active/website-content-from-docs/FINDINGS-plugin-flag-removal-incomplete.md` §2026-06-07)*
38. **Architect ADR backlog** — author ADRs from the provenance stubs in `docs/knowledge/decisions/` (research-backlog open decisions). *(TODO.md §Other open followups; roadmap T1-7)*
39. **website-content-from-docs second pass** — marketing/landing + examples + use-cases + full social repackaging (AC-3/AC-4) deferred by OD-6; initiative stays **open**. *(initiative.yaml `second_pass`)*
40. **website-v2 visual followups** — richer redesign of the 5 remaining diagrams + lifecycle-SVG polish; non-blocking, carried on the paused initiative. *(website-v2/PAUSED-followups.md)*
41. **Live remote-team ssh validation** — `RemoteTeamBackend` command construction is unit-tested via injected `RunFn`; real-hardware ssh validation remains. *(post-v2-roadmap.md §Out-of-scope deferrals, residual note)*

### Initiative disposition summary (asked by the audit brief)
- **drift-remediation** — close AT release (MC-7).
- **v2-canonical-design** — close AT release (MC-8).
- **guild-dashboard** — stays open through the release runbook; closes when WI-5 (push + D8 evidence) completes (OPS-6/7).
- **website-v2** — close during post-release ops (D8 release evidence already exists: site live, deploy run 26514291971); transfer item 40 to backlog (OPS-9).
- **website-content-from-docs** — stays open for the deferred second pass (item 39).

---

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

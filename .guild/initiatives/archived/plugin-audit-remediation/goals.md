# plugin-audit-remediation — goals (G1–G9)

> **CLOSED 2026-07-14.** All 9 goals executed (3 waves, 17 lanes; PR #27), docs
> reconciled (PR #28 + umbrella `docs/v2`), and shipped in **v2.2.0** (tag `v2.2.0`;
> release/v2.2.0 → main PR #31, synced back PR #32). D8 close gate PASS
> (exec✓ release✓ docs✓). Six audit-followup items also landed post-merge
> (PRs #29, #30 + umbrella #4 + website #13). Archived.

Source: full-plugin implementation audit 2026-07-12 (umbrella
`.guild/artifacts/audits/plugin-implementation-audit-2026-07-12.md` + `.digest.txt` — the digest
carries every finding with file:line evidence and verifier verdicts). 47 confirmed serious
findings, ~175 medium/low. Status: **proposed / not started** (operator directive).

Each goal is individually shippable with its own validation gate. All file paths relative to
`plugin/` unless noted.

---

## G1 — CI activation (do first)

The gates exist; they don't run — and two are red today.

- Wire the tests/ jest suite into CI (`rearch-rails.yml` step or new workflow): at minimum
  `tests/universal-host`, `tests/dot-guild`, plus scripts/, hooks/, hooks/agent-team/, mcp-server
  suites (quarantine env-gated/live suites explicitly).
- Re-ratify the live-surface drift-guard baselines (`p2-w3-sc6`, `p2-w2-sc5` pin `4833f69`,
  pre-v2.0.0). Prefer deriving the baseline from the latest release tag so releases re-anchor.
- Fix `clra-gate.yml:46` anti-skip meta-guard: greps dead path
  `understand/__tests__/clra-conformance.test.ts` → `scripts/learn/__tests__/…`, and make a
  missing file a hard failure. Single env var for both the jest pattern and the guard path.
- Re-seed the 2 drifted `skill-src/skill-registry.json` entries (review-broker, execute-plan —
  missed the GUILD_PLUGIN_ROOT sweep) via the `extractSkillV1` oracle; drift gate to green.
  (Wire-or-retire decision for skill-src overall lives in G5.)
- Move the never-run drift scripts into CI: `check-roster-consistency`, `sync-migration --check`,
  skill-render-equivalence.
- **Gate:** clean-checkout `npm test` green across all six jest projects in CI; SC-W2-2 green;
  deliberately re-drifting one registry entry fails CI (anti-vacuity).

## G2 — Live-path runtime fixes

Shipped behavior that is wrong now:

- `hooks/maybe-reflect.ts`: (a) run-id must use `lib/run-trace.resolveRunIdForTrace` (env →
  sentinels) — today auto-reflection never fires on sentinel-driven runs; (b) self-build detection
  greps `plugin/CLAUDE.md` for a banner that moved to AGENTS.md 2026-06-21 (also kills
  `bootstrap.sh:115` codex/docs-hygiene panels) — use one shared predicate; pin with a test.
- Run close semantics: `run-trace-close` on Stop closes multi-turn runs after turn 1
  (`hooks/hooks.json:78`). Close on true end-of-run, not per-turn Stop.
- `scripts/learn/validate-graph.ts`: version-dispatch (route v2 graphs through validateGraphV2 or
  refuse without `--force`); make k-stage-staleness tier-aware so a lost v2 tier reports stale.
- `mcp-servers/guild-memory`: read `updated_at` (fallback `updated`); category from directory
  segment (frontmatter `category:` is a topic taxonomy on decision pages); parse inline
  `source_refs` arrays (use the shared frontmatter module — see G9); regenerate fixtures from the
  real producers.
- Skill-token mismatch: `commands/qa.md`/`ops.md` + AGENTS.md dispatch to `guild:quality` /
  `guild:operations` — nonexistent; real tokens `guild:guild-quality` / `guild:guild-operations`
  (rename dirs or fix the 13 cross-references — pick one).
- `write-task-run.ts:352`: initiative id emitted in the trace `phase` field — plumb real phase.
- `v1.4-log-validator.ts`: teach it the actual canonical-file population (hook-mirror lines +
  guild.trace.* lines) or stop routing those shapes into the canonical file.
- Atomic writes: shared `atomicWrite` (same-dir temp + rename) replacing os.tmpdir()+renameSync
  (EXDEV crash) in write-run-manifest, write-task-run, workspace writers.
- `check-skill-coverage.sh`: kill the false "no frontend specialist" nudge; derive the gap list
  from `agents/` (G9).
- `KNOWN_TIERS` in description-optimizer + evolve-loop omits knowledge/guild-operations/
  guild-quality — enumerate `skills/` from the filesystem.
- PostToolUse double-logging into the canonical file (capture-telemetry + post-tool-use) —
  single writer or dedupe.
- **Gate:** each fix lands with a regression test on the REAL path (dist bundle where hooks are
  concerned — rebuild hooks/dist and grep the dist to verify); codex adversarial review per lane.

## G3 — Lifecycle wiring

- `/guild:initiative`: the referenced "initiative skill set" does not exist — author it (or a
  deterministic close-gate CLI à la verify-gate-pass) so `close` consumes `d8CloseGate` +
  `populateReleaseDocsWorkItems` output as code, not prose. Fix the dangling
  `initiatives/initiative-and-phase-workflows.md` pointer in commands/initiative.md.
- Evolve read/write split: skill-dir resolution must check consuming-repo `.guild/skills/<slug>/`
  first (post-promote instance), plugin tree as fallback; align evolve-skill step 1 with step 9.
  Also decide `--to-template=vN` + no-arg backlog modes (implement or remove from commands/evolve.md).
- Run-start preflight snapshot: `runStartPreflight → resolved-settings.json →
  readResolvedSettingsSnapshot` has zero production callers while a dozen command docs +
  `/guild:resume` assume it — wire it into run-trace start (or excise the machinery + prose).
- `context-assemble` recall contract: document the real ProtectedChunk output + topScore skip
  rule (or add per-chunk score/path aliases to the CLI); sweep the same phrasing in learn-map,
  learn-knowledge, learn-graph.
- LearningCheckpoint → learn-harvest routing exists only as prose claims in two skills — wire or
  reword.
- **Gate:** `/guild:initiative close` on a fixture initiative produces a deterministic D8 verdict;
  evolve on a promoted skill snapshots the live instance; a sentinel-driven run yields a
  resolved-settings.json.

## G4 — Multi-host honesty + packaging closure

- The 7 hosts with `dispatch_selectable: true` but no HostKind/adapter/probe/wrapper row (cursor,
  github-copilot, opencode, rovo-dev, kiro, qoder, trae): flip honest OR build the generic
  registry-driven wrapped-CLI PaneAdapter (preferred; pairs with G9). Contract test: every
  dispatch_selectable row resolves through parseHostKind→resolveAdapter.
- Packaging closure: ship `hooks/dist/run-trace.js` (every phase command invokes it) and
  `templates/` in generated packages; render `SKILL.src.md → SKILL.md` (or fix the AGENTS.md
  bootstrap pointer); remap Pi/Antigravity/wrapped-CLI manifest `./commands`/`./skills` paths
  through `agents_skill_root`.
- Extend `verify-host-packages` to path-resolution checks (every source_path/glob/bootstrap
  pointer resolves inside the package tree) — would have caught 4 confirmed findings.
- Unify capability truths: derive Phase-1 HOST_CAPABILITY_ROWS (pi/antigravity divergence) and
  manifest `_provenance` from HOST_REGISTRY_ROWS.
- RemoteTeamBackend: tmux-wrap remote spawn (fixes teardown matchability) or gate behind a
  short-command-only contract; delete or wire the unread inbox channel.
- D5 "agent" rung: launcher actually constructs InProcessTeamBackend/SerialBackend (or rewrite
  execute-plan/dispatch.md to the real `{backend,reason,slug}` signal).
- Router: exclude POLICY-rejected hosts from TE-02 degrade ranking.
- `install.sh` detect table: verify/generate from the host-registry detection SoT (gh/acli
  false positives).
- **Gate:** verify-host-packages path-resolution pass green; a package-installed tree can run a
  phase command's run-trace invocation end-to-end; selectability == reachability by contract test.

## G5 — Wire-or-delete sweep (the unwired shelf)

Explicit decision per item — wire it to a real path, or delete code+tests+mirrors. Never keep
green-tested unreachable code with false wiring claims. Itemized in the audit digest; headline:

- init cluster (init-guild/staging-gate/resume-repair/offer-initiative, 78KB), evolve-loop.ts,
  analyze-runs.ts (§11.1 trigger), stamp-recall-importance.ts, oq11-gate-check.ts (wire per
  "security steps are code" — into guild.md preamble or pre-tool-use), artifact-bus-cli,
  registry-rollup, v1.4-summary-md-regen, knowledge-links-traverse, heartbeat-write-side,
  retention.ts.
- promote-upstream.ts (Rule-3 staging), workspace-impact-detector surface, installer-contract
  receipts, dashboard-projector (813 lines) vs the shipped dashboard command, prompt-intake,
  run-learning-classifier (R11), task-assignment reader (wire the pointer into buildPrompt or
  delete channel+env exports), G-series learn CLIs (extract-structural/graph-artifact/graph-query
  + unregistered config keys `defaults.share_structural_graph`, `models.entryPoints` — register
  or drop), classify-wiki-pages, kb-snapshot, sqlite-projections, failure-ingestion,
  telemetry-redirect, trace-replay, guild-artifact-paths (R6 rule currently prose-only),
  autonomy-presets, runtime-adapters, isolation-capability-set + lane-reserved-field,
  zero-importer scripts/lib shims, `models.shortOutputThreshold`, skill-src pipeline (extend to
  full corpus + CI gate, or retire — ties to G1).
- docs-hygiene pair memory-check.ts + docs-code-audit.ts: broken defaults, operator-machine
  hardcodes, vacuous checks — fix or pull from shipped module resources.
- **Gate:** G9's reachability rail green (no shipped CLI/>5KB lib without a non-test importer);
  no header claims a caller that doesn't exist (spot-grep).

## G6 — Shipped contract index + agent de-self-build

- `guild-quality`/`guild-operations` (and 9 core/meta skills) resolve contracts "by pointer,
  never re-spelled" to contract-map.md / target-architecture.md / lifecycle-overview.md — none
  ship. Ship a machine-readable contract index (schemas/ manifest) or inline frozen field tables;
  docs/v2 references in shipped skills become guildstack.dev URLs or shipped files.
- All 17 product agents cite `.claude/agents/_shared/handoff-contract.md` + dev-team ownership
  facts — replace with the shipped guild.handoff.v2 reference; drop self-build bullets. Also:
  retire the stale T1/T5 tier vocabulary; fix researcher/seo tool allowlists vs their skills'
  evidence contracts; reconcile templates/agents/AGENT.template.md with the shipped agent shape.
- Wiki-write bypasses: 3 specialist skills write canonical wiki paths directly — route through
  the wiki-ingest gate.
- **Gate:** grep proves no shipped skill/agent references a non-shipped repo path; boundary evals
  (runner from G1/G9) still pass.

## G7 — Docs/prose sweep

- `bootstrap.sh` banner: guild-plan.md, MIGRATION.md, docs/knowledge pointers — all dead; source
  entry points from real targets.
- CONTRIBUTING: "no build step" for hooks (the repo's #1 footgun), 5-vs-6 jest projects, 106
  skills, /ultrareview — rewrite; document hooks `npm run build` requirement.
- AGENTS.md + CONTRIBUTING: add `src/modules/` (SoT layer), dist/ bundles, sync scripts, and a
  dev-team owner for src/modules; fix dispatch-table skill tokens + team-file naming.
- README: v2 phase-detection narrative, full command table, real .guild v2 tree, env-var table
  (drop GUILD_BENCHMARK_LIVE, fix GUILD_LOOP_CAP), knowledge-tier count, doc-writer double-count.
- SECURITY.md: current major 2.x; add PreToolUse/PreCompact to the hook list.
- ~100 comments citing retired `docs/knowledge/decisions/*` → retarget to wiki/docs/v2 (sweep
  unanchored, per the pervasive-doc-drift lesson); relocate the one orphan file in
  plugin docs/knowledge/ (9 inbound refs) then delete the dir.
- plugin.json homepage → guildstack.dev (all 9 rendered manifests inherit).
- Host-neutral plugin description ("a plugin for Claude Code" ships verbatim to 9 non-Claude
  manifests) + single description source (marketplace renderer hardcodes a second blob).
- **Gate:** docs-count rail (counts derived from guild.inventory.json); zero dead doc pointers in
  shipped hooks/commands/skills (link-check script).

## G8 — Repo hygiene

- Delete: `scripts/.guild/` (16MB), `.guild-smoke-ephemeral/`, `generated/support-matrix.json`,
  `.gemini/`, `.claude/worktrees/`, stale `.claude/agents/_shared/AUDIT.md`, vestigial .gitkeeps,
  `scripts/docs-hygiene/.last-scan.md`.
- Untrack: `.guild/index.sqlite`, `.guild/runs/current-run-id`, the committed one-off
  `.guild/context/run-host-adapter-reconcile-20260621/` + `.guild/diagnose/*` (operator paths).
- Fix `.gitignore` allow-list semantics (re-deny `.guild/*` then re-include named subdirs) or
  extend audit.ts coverage beyond runs/; resolve the run-state.json share-set-vs-gitignore
  contradiction (one contract, then enforce).
- Commit the golden full-learn fixture (`hooks/__tests__/fixtures/golden-full-learn-run/.guild`)
  with gitignore re-include + FIXTURE_EXEMPT entry — hooks suite currently unreproducible from a
  fresh clone.
- Harden `hooks/lib/guild-root.ts`: prefer .git anchors over bare .guild dirs (stops the
  scripts/.guild attractor re-forming); host-smoke defaults to os.tmpdir() + cleanup.
- dot-guild audit: tracked-tree mode for CI + full untracked-inclusive scan in build:verify so
  each environment proves what it can.
- **Gate:** local `npx tsx scripts/dot-guild/audit.ts` exits 0; fresh-clone hooks suite green;
  a new run leaves the working tree clean.

## G9 — Generalization rails (durable prevention)

- Registry-driven hosts end-to-end: PaneAdapters, NEW_CLI_HOST_IDS, probes, models.tiers,
  `_provenance`, install.sh detection — all derived from HOST_REGISTRY_ROWS; collapse the 3
  host-id namespaces onto HostId + one alias table (incl. hooks KNOWN_HOST_KINDS mirror).
- One run-context resolver (resolveRunIdForTrace) for all hooks + agent-team handlers.
- One run-event reader (v1.4-first, ndjson fallback) for shadow-mode, trace-summarize,
  maybe-reflect, recall-stats.
- Filesystem/inventory-derived enumerations: skill tiers, specialist rosters (5 hand-maintained
  copies), coverage-nudge gaps, doc counts, hooks build entrypoint manifest (also closes the
  packaging blind spot), AGENTS.md dispatch table.
- Reachability rail (CI): shipped CLI / >5KB lib with no non-test importer fails.
- One wiki frontmatter contract module (ingest/lint/query + guild-memory); one workspace
  classifier; collapse settings-reader's duplicated parse bodies; single knowledge-links.json
  read/write helper (schema_version/version drift); shared trigger-clause parser; evals.json
  single schema + presence rail; build the paired-eval runner (activates tests/trigger +
  tests/boundary fixtures).
- **Gate:** adding a fictional host row lights up dispatch+packaging+config with zero code edits
  (then revert); rails wired into CI from G1.

---

## Execution record (2026-07-13)

All nine goals executed in three waves (17 dev-team lanes + 3 codex adversarial review rounds; 8 codex
findings fixed pre-commit). Commits f5718f9/16d4ca1 (W1: G1+G2), 03ba735/c4d51e3 (W2: G3+G4),
f252524/8322a04 + test-alignment (W3: G5–G9). PR #27 → next. Website mirrors: PRs #11 (install.sh), #12
(gitignore hardening).

**Descopes / follow-ups recorded:**
- `/guild:evolve` `--to-template=vN` + no-arg backlog modes: removed, not implemented (G3b).
- surface_manifest rollout: advisor + developer only; 15 specialist templates deferred (R-DECL scan
  conversion is eval-engineer infra) (G6).
- G-series incremental extraction lane (extract-structural --incremental via learn-diff): descoped, chip
  filed (G5a).
- sync-migration ship/no-ship packaging flag: real gap documented in migrations manifest (G5b).
- host-open-detection combined fixture coverage lost with init-cluster deletion (G5b).
- R-REACH residual advisory findings: cloud-consent-gate, cloud-task-packet, sync-migration (wire-or-retire
  backlog; rail advisory until one clean cycle).
- knowledge-links.json carries stale edges to deleted files (derived index; rebuilds on next learn run —
  codex W3 MINOR, accepted).
- Out-of-repo-scope: benchmark/ nested-guild fixture flags; umbrella docs/v2-final scrub-uncovered pages;
  benchmark main↔release reconciliation.

**Close gate status:** exec leg done; docs leg = umbrella docs/v2 reconciliation lane in flight; release
leg = rides the operator-driven next→main release cut (branch-policy: main accepts release/vX.Y.Z PRs only).

# Guild — repo orientation

Guild is a cross-host plugin that ships 4 machinery agents (advisor, context-manager,
developer, team-lead),
15 domain specialist type templates (minted into a project's `.guild/agents/` on
demand by team composition), and 76 skills — 17 of them indexed — across a
brainstorm-plan-execute-review-verify-reflect spine, a categorized wiki with decision
capture, and a self-evolution loop with shadow-mode gating.

This `AGENTS.md` file is the canonical host-neutral instruction file. Claude Code
loads `CLAUDE.md`, but `CLAUDE.md` must only import this file; all durable
directions belong here so Codex, Pi, Antigravity, and AGENTS.md-consuming hosts
read the same guidance.

For full architecture and design documentation see **https://guildstack.dev/docs**.

## Where things live

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — plugin + marketplace manifests.
- `skills/` — the skill tree. `.claude-plugin/plugin.json` indexes exactly the 17
  assembler directories (KTD59); everything else ships off-index. An assembler is a
  three-stage folder: `SKILL.md` (frontmatter always, body on match) + `references/`
  (L3 chapters, on demand) + `scripts/` (compiled, never prompt text). The 58
  specialist starter recipes and the dashboard launcher live under
  `skills/playbooks/` as copy-on-mint feedstock (KTD13/KTD20), never indexed.
  The former `core/` and `fallback/` tiers are gone: `principles` folded into
  `using-guild`, and `tdd` / `systematic-debug` / `worktrees` / `finish-branch`
  are now chapters of the assembler that invokes them.
- `agents/*.md` — the 4 machinery agents (`advisor`, `context-manager`,
  `developer`, `team-lead`), the only
  host-registered agents the plugin ships. Populated and authored.
- `templates/specialists/*.md` — the 15 domain specialist type templates
  (`guild.specialist_template.v1`; architect … sales, incl. `doc-writer`),
  read-only feedstock minted into a project's `.guild/agents/` by
  `roster-resolve.ts mint` during team composition.
- `commands/*.md` — the v2 flat-token command surface (`/guild:<verb>`; the `:` plugin
  namespace stays — Claude Code requires it — v2 only drops the redundant `guild-` prefix;
  sub-verbs are positional arguments, never separate files or namespaces).
- `hooks/hooks.json` — native Claude Code hooks; the `.ts` sources compile to the
  committed esbuild bundles under `hooks/dist/` (+ `hooks/agent-team/dist/`) the
  host actually runs (`cd hooks && npm run build` after any hook edit — source
  edits are a no-op until rebuilt). Other hosts consume equivalent behavior
  through host adapters and graceful fallback.
- `src/modules/<module>/` — the module source-of-truth layer. Each module owns its
  `workflows/` code plus a `resources/` mirror that generated host packages copy
  from; `scripts/lib/*` are thin re-export shims over these workflows. The
  module-resource sync (`syncModuleResources`) + drift gates keep the live surface,
  the `resources/` mirror, and the per-host `dist/` copies byte-identical. **Edit
  the live source (`scripts/lib`, `src/modules/*/workflows`, `hooks/*.ts`); never
  hand-edit a `resources/` or `dist/` mirror** — run the sync + host-package build
  to propagate.
- `scripts/`, `mcp-servers/` — evolve loop, telemetry, optional MCP servers.
- `dist/` — committed per-host packages (`claude-code`, `codex`, `pi`, …) rendered
  by `scripts/build-host-packages.ts`; regenerated, never hand-edited.
- `tests/` — skill evals and wiki-lint fixtures.
- `templates/{skills,agents,products}/` — authoring + product scaffolds
  (`templates/specialists/` is the 15 specialist type templates, described above).
- `docs/` — RETIRED as a docs set: holds only a static redirect page to
  `https://guildstack.dev/docs` plus the logo asset. The public docs are generated
  from the umbrella's `docs/v2/` + the website; reference knowledge lives in
  `.guild/wiki/`. Apart from `README.md`, `CONTRIBUTING.md`, and `CHANGELOG.md`,
  no documentation lives in this repo.

Generated project-local Guild artifacts do **not** live in the plugin install
tree. Any agent, skill, tool, memory page, graph, initiative, run record, or
reflection created by Guild for a consuming project is written under that
project's `.guild/` directory.

v1→v2 migration guide: `https://guildstack.dev/docs/migration-v1-to-v2`

## v2 phase → skill dispatch

The 6 phase commands (plus the `learn` command) are thin entrypoints; each
invokes its producer skill(s) in order. The invoked skills are model-invoked,
never user-typed. This is the one-place wiring reference — each command's
`## Dispatch` section is canonical, this table is the index.

| Phase verb | Skill(s) invoked, in order | Output artifact |
|---|---|---|
| `/guild:init` | `guild:init` (cheap by default: wiki + brownfield cheap-scan CodebaseMap + architecture-map stub) — full `learn-*` pipeline runs ONLY under `--learn` / `defaults.auto_learn` | `.guild/init/<slug>.md`, `.guild/wiki/**`, `codebase-map.json` + `architecture-map.md` stub |
| `/guild:ideate` | `guild:brainstorm` (standard+deep: wrapped by `guild:loop-clarify`) | `.guild/spec/<slug>.md` |
| `/guild:plan` | `guild:team-compose` → `guild:plan` (deep: + `guild:loop-plan-review`) | `.guild/team/<slug>.<phase>.yaml` (resolved via `resolveTeamFile`; legacy `<slug>.yaml` read-only), `.guild/prd/<slug>.md`, `.guild/plan/<slug>.md` |
| `/guild:build` | per lane: `guild:context-assemble` → `guild:execute-plan` → `guild:review` (deep: + `guild:loop-implement`) | handoff receipts, `assumptions.md`, `review.md` |
| `/guild:qa` | `guild:guild-quality` | `.guild/runs/<run-id>/quality/<run-id>.md` |
| `/guild:ops` | `guild:guild-operations` | `.guild/runs/<run-id>/ops/<run-id>.md` |
| `/guild:learn` | the `learn-*` family — `guild:learn-map` / `learn-graph` / `learn-onboard` / `learn-diff` / `learn-explain` | deep knowledge-graph + onboarding / diff / explain artifacts (lazy, gated) |

## Dev team (`.guild/agents/`)

The plugin is built by 10 dev-team agents, each owning a scoped slice. **These — not the
product specialists — are the team for any self-build work.** They are project-local,
hash-bound definitions under `.guild/agents/`, not host-registered agent names. Compose
the exact `guild.project_definition_ref.v1` from the committed adoption manifest and
dispatch only through a transport that declares definition injection; a transport that
cannot carry the ref refuses before launch. Agents never commit themselves.

| Changed path / concern | Dev-team definition |
|---|---|
| `scripts/`, `src/modules/**` (module SoT + sync scripts + drift gates), `mcp-servers/`, `.mcp.json` | `tooling-engineer` |
| `hooks/` (hooks.json + hook scripts) | `hook-engineer` |
| `commands/` | `command-builder` |
| `skills/**` (bodies + per-skill evals.json) | `skill-author` |
| `agents/*.md` (machinery agents) + `templates/specialists/*.md` (type templates) | `specialist-agent-writer` |
| `tests/` (cross-cutting evals/fixtures) | `eval-engineer` |
| `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, repo-root/plugin `CLAUDE.md` | `docs-writer` |
| `.claude-plugin/*`, manifests, ADRs, phase-gate integration | `plugin-architect` |
| Harvest research/ideation provenance → recallable canonical pages (self-build only) | `research-digester` |
| Pre-commit leak audits + scrub-policy review on share-policy-extension initiatives | `security-auditor` |

Route by the path being changed; when a task spans several, dispatch the matching
specialists in parallel (worktree-isolated) per `guild:execute-plan`.

## Project-local state

Runtime artifacts live under `.guild/` at the consuming repo's root (never committed by
Guild itself). Guild has exactly two state levels: an umbrella workspace root and
its immediate sub-project roots. Each level has its own `AGENTS.md` and `.guild/`.
There is no third nested Guild level. Every host with the Guild plugin must
discover the active root, load settings/workspace manifests/local capability
files from that root's `.guild/`, and use workspace federation to read
sub-project `AGENTS.md` and `.guild/` contents when operating from the umbrella
workspace. The workspace reads sub-project state in place; it never replicates
sub-project agents, skills, tools, wiki pages, initiatives, or runs.

Use absolute paths for writes when operating in this umbrella workspace.

All project-created Guild state lives in the active root's `.guild/`:

```
.guild/
├── guild.yaml                 # root identity: workspace or project
├── settings.json              # project/workspace behavior
├── workspace.json             # workspace federation manifest, workspace roots only
├── workspace/                 # workspace metadata, workspace roots only
├── agents/*.md                # project/workspace-created specialists (files = source of truth, D4)
├── agents/registry.yaml       # DERIVED index of agents/*.md — generated by scripts/roster-resolve.ts, never hand-edited
├── skills/<name>/SKILL.md     # project/workspace-created skills (files = source of truth, D4)
├── skills/registry.yaml       # DERIVED index of skills/*/SKILL.md — generated by scripts/roster-resolve.ts, never hand-edited
├── workflows/registry.yaml    # reusable workflows
├── loops/registry.yaml        # custom review/build/learning loops
├── wiki/                      # synthesized knowledge, decisions, standards
├── knowledge/                 # graph, indexes, sources, promotion candidates
├── memory/                    # summaries, lessons, recall index
├── initiatives/               # initiative registry, active, archived
├── teams/registry.yaml        # reusable team definitions
├── artifacts/                 # reports, audits, handoffs, generated outputs
├── raw/                       # immutable source inputs + checksums
├── indexes/                   # codebase map and compatibility indexes
├── runs/                      # run traces and shareable run-summary subset
├── spec/                      # approved specs
├── plan/                      # per-task plans
├── team/                      # resolved specialist teams, legacy path
├── context/                   # per-run specialist context bundles
├── reflections/               # proposed learnings and improvements
├── evolve/                    # shadow-mode eval runs and reports
└── skill-versions/            # rollback snapshots
```

The benchmark consumes these artifacts. Keep them structured, deterministic, and
safe to share in a team repository when policy allows it.

Each run directory must be self-contained enough for replay and analysis:

- phase order and active initiative/spec/plan identifiers;
- team composition, each agent's role, host, phase, task id, and dispatch order;
- prompts, responses, tool calls, tool results, operator steering, approvals,
  rejections, and manual interventions;
- handoff receipts, review packets/results, trace events, degradation receipts,
  and final verification state.

Before any run record is shared, committed, exported, or used in benchmark
fixtures, scrub PII and sensitive content: API keys, passwords, tokens, session
cookies, private keys, credit-card/payment data, auth headers, customer/user
identifiers, private absolute paths when policy requires, and any configured
redaction pattern. Redaction must preserve structure so the run remains useful
for replay and learning.

The wiki read path uses a lazy SQLite read-through cache (`index: "auto"`, default);
disable with `index: "off"`. See `https://guildstack.dev/docs/configuration`
(`defaults.index.*`).

## Branch + PR discipline (mandatory) — the next/main channel model

Branches are distribution channels (marketplace installs track a git ref):
**`main` = stable** (default installs), **`next` = beta/integration**
(`claude plugin marketplace add lookatitude/guild@next`, `install.sh --channel beta`).
Every merge to a channel branch ships to its followers immediately, so both are
PR-only, and `main` only ever receives **release PRs**. Canonical ruleset:
`.guild/wiki/standards/release-discipline.md`.

**The beta channel must be legible from the manifest** (gap-audit B5, decision
cap-loc-D12). `next` carries a **prerelease identifier** on the next target
version — `MAJOR.MINOR.PATCH-beta.N` (e.g. `2.7.0-beta.1`). Under the current
short-path release flow, the reviewed merge and stable tag retain that beta
manifest as provenance; the bare stable identity is the CI-derived tag and
GitHub Release. Under SemVer §11 a prerelease sorts below the same triple, so
`2.5.0-beta.1` is correctly ahead of `2.4.0` and behind the CI-derived
`v2.5.0`. A later release-App hardening follow-up may restore a generated
bare-version metadata commit without changing the one-PR operator flow.

Day-to-day workflow (features, fixes, docs — everything non-release):
1. Branch from `next`: `git checkout -b feature/<short-slug> origin/next`.
2. Commit + push the branch.
3. Open a PR **targeting `next`**: `gh pr create --base next`.
4. Merge via the PR (squash or merge per case). The work is now on the beta
   channel for testing; it reaches stable only with the next release.

Release workflow (operator-driven, when `next` is ready):
1. Confirm `next` carries exact `MAJOR.MINOR.PATCH-beta.N`, the applicable
   hash-bound release evidence under
   `.guild/artifacts/release/vMAJOR.MINOR.PATCH/`, green CI, reconciled
   `docs/v2`, and a curated PR body suitable as release notes. Exact v2.7.0 has
   a separately named, GitHub-OIDC-attested provenance-only basis that
   explicitly does not establish conformance authority; it is mechanically
   unavailable to later versions.
2. Open the release PR from the repository's exact `next` branch to `main`.
   `branch-policy.yml` rejects every other head branch and all forks.
3. Merge the PR using GitHub's **Create a merge commit** method. Squash and
   rebase merges are invalid because the evidence-bound `next` source commit
   must remain an ancestor of the merged `main` commit. CI also requires the
   merged tree to equal the exact reviewed `next` tree, re-runs
   promotion evidence, verifies any required release-basis OIDC identity, and
   derives the bare stable tag
   from the reviewed beta manifest, tags the exact merge commit with the
   built-in repository token, and publishes the PR body as the GitHub Release.
   CI does not commit or push to either protected branch.
4. Verify the workflow, tag, GitHub Release, and that the peeled tag equals the
   merged `main` commit. The next release gate treats that immutable tag as the
   published stable version while `main` retains its reviewed candidate
   identifier. A re-run accepts an existing tag only when it already
   points to that exact merge commit, then creates a missing Release if needed.

There is no operator release branch, App credential, environment gate, or
manual sync-back in the current short path. The dedicated release App and
post-merge bare-version metadata convergence remain a non-blocking hardening
follow-up. See `.guild/wiki/standards/release-discipline.md`.

**Mechanical enforcement.** `branch-policy.yml` rejects any PR into `main` whose
head is not the same-repository exact `next` branch; the repo-checked-in `pre-push` hook at
`.githooks/pre-push` refuses direct pushes to `main` AND `next`. Wire it once
per clone:

```bash
git config core.hooksPath .githooks
```

Bypass for emergencies (channel bootstrap, force-push recovery): `GUILD_ALLOW_PUSH_MAIN=1 git push origin <branch>` — logs a loud warning.

## Continuous knowledge — discipline

Guild has a built-in self-evolution loop. For Guild's own development, the discipline is:

1. **Decision capture (real-time).** When the user redirects the work on a non-trivial
   choice, invoke `guild:decisions` to write `.guild/wiki/decisions/<slug>.md`, update
   `.guild/wiki/index.md`, append to `.guild/wiki/log.md`.
2. **Reflection after major work.** After a release, phase, or non-trivial task, invoke
   `guild:reflect` against the run summary; output to `.guild/reflections/<slug>.md`.
3. **Promotion on user gate.** Reflections are *proposals*. The user reviews;
   `guild:wiki-ingest` lands sourced knowledge; `guild:evolve-skill` lands skill body
   changes via shadow-mode. Nothing auto-promotes.

The wiki for the Guild repo lives at `.guild/wiki/` (start at `index.md`). Read it before
making decisions that touch the same surface — prior choices are recorded with their
rationale.

Host-global memories such as Codex app memory or Claude `MEMORY.md` are not canonical
Guild state. Durable Guild memory is project/workspace `.guild/` state.

## Run learning and improvement routing

After a non-trivial run, analyze the sanitized run record for learnings and route each
proposed improvement to exactly one level:

- **Workspace/project level** — project-specific knowledge, agents, skills, tools,
  settings, plans, standards, or team conventions. These can be shared with the team
  through the repo's `.guild/` tree after the normal review gate.
- **Plugin level** — broken Guild flows, missing host-adapter behavior, unsafe defaults,
  portability defects, bad docs, or reusable improvements that belong in the Guild plugin
  itself.

Plugin-level findings must become an analysis artifact first. Do not file or share
anything automatically. **The routing and filing are deterministic code, not
judgement**: write the findings as `RunLearningFinding[]` JSON and run
`scripts/feedback-triage.ts triage` (classifies project-vs-plugin via
`run-learning-classifier.ts`; writes sanitized issue drafts under
`.guild/feedback/<run-id>/`, redacting private paths/tokens/emails), then ask the
user per draft; only `feedback-triage.ts file --approve "<operator>"` can reach
`gh issue create` (repo `lookatitude/guild`). Denials are recorded;
non-interactive sessions never file. `guild:reflect` §Feedback routing and
`guild:diagnose` §Upstream escalation carry the step-by-step.

## Layout laws (architecture revision 20 — KTD1–KTD70)

Source of truth for the cut: `.guild/artifacts/reports/plugin-layout-implementation-plan.html`
(operator-locked, rev 20). The lines below are the grep target every reshape lane
(T02–T17) asserts against; each is a rule, not a style note. Numbers are lint-fail.
The runnable form is `scripts/lint/layout-laws.ts` (`npm run lint:layout` in `scripts/`).
Where a line here and the source plan disagree, the source plan wins.

- **KTD1.** Twelve domains. Public API is twelve index.ts. Adapters and src/runtime are not a 13th domain.
- **KTD2.** Flat src/surfaces/ is the only authoring home for commands, skills, playbooks, agents, templates, hooks.
- **KTD3.** Two D-MCP ids (wiki | trace), one runtime/guild-mcp.js. No union of wiki+runs.
- **KTD4.** Host maps live in src/adapters/ + adapter.lock.json. Domains must not import a host family adapter.
- **KTD5.** Per-cell inferred rungs. Unverified rungs fail closed, never guessed. Live-host verification of unverified rungs is out of this cut.
- **KTD6.** Three planes: Bun author (P1), CI compile on next and main (P2), Node on the user path (P3).
- **KTD7.** Compile outputs are committed (runtime/guild-mcp.js, hooks/dist/). Users run node.
- **KTD8.** Pattern lock: a new host-visible skill is an assembler or it is a playbook. Playbooks are not in plugin.json skills.
- **KTD9.** No dual-home mirrors. Git history is the archive. No shipping plugin/_archive/.
- **KTD10.** No Bun on the user PATH. Runtime fail-closed if compile outputs are missing.
- **KTD11.** Test runner is bun test. Spawn path is compiled Node, not npx tsx.
- **KTD12.** Capability coverage replaces file-count identity. Every command token and skill body maps to remaining command, remaining assembler, named chapter/playbook, hook policy, or domain function.
- **KTD13.** Specialist recipes are not host skills. Starter feedstock is src/surfaces/playbooks/specialists/, copy-on-mint (KTD20); templates stay at src/surfaces/templates/specialists/. Neither is in plugin.json skills.
- **KTD14.** Dropped command filenames are print-only aliases on next, deleted after one stable cut.
- **KTD15.** .guild/ is durable truth only (plus KTD16 projection). Caches, sqlite, catalogs, temp, eager empty dirs leave. Production path.join(cwd, ".guild" only inside state storage + storage-v2. Init floor: guild.yaml + scoped config.
- **KTD16.** Plugin↔benchmark artifact paths stay stable this cut (run JSONL, .guild/analysis/**, .guild/recommendations/**). Full runtime-out waits for a benchmark-aligned cut.
- **KTD17.** One inner work loop (recall → research-on-miss → implement → verify → harvest). Outer scenarios are class graphs (KTD40), not a sixth command.
- **KTD18.** One evolve gate, two homes. Live files stay latest-only. Plugin self-build candidates land under plugin .guild/evolve/; promotion is a human commit into src/surfaces/** (machinery) or src/ (KTD63). Project RSI writes only that project's .guild/, never the install dir. No skill-versions/ trees. Permissions stay proposal-only (D5).
- **KTD19.** Three tiers, two envelopes; the orchestrator is ignorant of task specifics. /guild is the T0 session. Each TaskCell has a Team Lead. Specialists report only via handoff.v2; Team Lead reports only goal_status.v1 (last 5 + rolling summary). Isolation is structural: specialists never message the orchestrator or each other.
- **KTD20.** Specialist implementation is project state. team-compose mint byte-copies into .guild/agents/<role>.md plus starter playbooks into the project definition tree; dispatch and context-assemble resolve project-first. Plugin RSI never treats starter playbooks as the live specialist body. Amends KTD13: the 58 recipes leave the host glob and the execution path after mint.
- **KTD21.** TaskCell ADR is Accepted for this initiative. U-TIER implements its operations. Three-tier isolation (KTD19) is an additional invariant on that runtime, not a substitute for it.
- **KTD22.** Durable config is policy. Host and models are session-bound (guild.session_binding.v1 on the run). Initiatives do not store inventory. Unknown host does not default to Claude. Session rebind is the default (supersedes model-routing M2/M3 off-by-default for this cut).
- **KTD23.** Existing roots upgrade on activation of this cwd. Versioned steps, journal outside .guild, dirty durable blocks, no disk scan, no auto-commit. Future layout fails closed. User knowledge is preserved on ambiguous scope. v1 converter is a step.
- **KTD24.** Instruction rank: hooks > done_when > project AGENTS.md > playbook > skill body > using-guild. Commands ≤40 lines. Closed failure enum.
- **KTD25.** Three-stage disclosure. Fold principles into using-guild. Prefix 2%/1500. Catalog ≤8k. Per-skill description ≤350 tokens.
- **KTD26.** Parents see citations, not sources. Lane bundle ≤1200 tokens (working-set ≤400; glossary hits ≤200 of the 1200). Tool results into T1/T0 ≤2000 tokens + pointer. Compaction rehydrates from disk.
- **KTD27.** One import direction, one folder shape. Domain index is the API. Adapters map, they do not own truth. Workflows tree dies. Tests colocated. Skill scripts compile; they are not prompt text. Host tools / MCP / domain functions / scripts are distinct and must not be mixed.
- **KTD28.** Closed adapter rungs with stated missing behavior. Projection-only host packages. No-spawn → lead_only. Unprojected tools never given to an isolated worker.
- **KTD29.** One JS graph. Marker-read start when current (50ms). Indexes lazy. after_edit ≤250ms. No per-host JS bundle.
- **KTD30.** done_when oracles. Progress ledger on disk. Default 4 instances/run. Assignment host from session binding.
- **KTD31.** Prompt dialect composed at session bind (host family + model family). plugin < workspace < project extensions. using-guild append-only from project. .guild present ⇒ Guild bootstrap always. Plugin missing fails closed. Composed prompt is runtime-only.
- **KTD32.** Context files are latest-only. Evolve replaces the wrong span. Decision + reasoning are guild.decision.v1 wiki pages (or candidates), recalled on demand. Changelog / “Update (date):” in a prompt-loaded file is a lint fail.
- **KTD33.** Auto-harvest on methodology repeat, operator redirect ≥3 (T0 routes a correction; same agent/topic this run), and new features. End-of-cycle harvest also runs. Project playbooks/skills auto span-replace. Plugin machinery stays human.
- **KTD34.** Scratch is OS temp via GuildStorage.temporary(). Deleted on close. Research/experiment working files never land in durable .guild. No hardcoded /tmp in domain code. Scratch is not a wiki page.
- **KTD35.** Wiki auto-promotes harvest decisions on this cwd. ≥0.80 in-place supersede. Injection/secrets/lint refuse. T0 reports; no auto-commit. Specialists never Write wiki. Parent/sibling/child never auto-written. wiki-ingest remains for init-staging, external URLs, manual. Umbrella docs/website human (sibling plan). wiki.autopromote default on; false is candidates-only.
- **KTD36.** Preserve-and-fold 29 modules → 12 domains. Coverage domains[] bijection. No silent module deletion.
- **KTD37.** Harvest is a security-gated write, not a markdown dump. scrubbedWrite + D-PROBE + injection-guard. D-RECALL still wraps recall. Redirect playbook replace is a template. Security events are mandatory.
- **KTD38.** Harvest is observable on the existing JSONL. Additive structured events: harvest, redirect, CAS, curator. No third plugin↔benchmark log. Wiki bodies stay out of the JSONL.
- **KTD39.** Harvest is resumable and reversible. Journal on the run. maintain wiki revert. Two T0 sessions do not share a harvest journal; they CAS the wiki.
- **KTD40.** Five classes: product · research · debug · ops · init. Experiment ⊂ research. No new L1 command. Loop-taxonomy families are stations inside the graphs.
- **KTD41.** Intake classifies the class (plus typed verb / --class=). other/low-confidence asks T0. Cursor on the run. change_class is T0-confirmed; same run only with no in-flight cells.
- **KTD42.** Next step is a closed decision on a data graph. T0 routes. Overlay skip/reorder only. Cannot drop D5, product QA-before-release, ops first-run interactive, or D8. Cannot add a class.
- **KTD43.** One promotion law. Checkpoint classifies and may enqueue harvest. Harvest is the only auto writer (decisions + project spans). Reflect/evolve for everything else. Checkpoint does not Write wiki.
- **KTD44.** One workflow runtime. Graphs execute. Station ids live on nodes. Authored loops/workflows registries are not SoT.
- **KTD45.** Specialist on-disk bundle ≤6k (Universal + Role + Task + Terms, D-RECALL). T1/T0 see ≤1200 citations. Never copy the 6k upward. Full glossary never always-on.
- **KTD46.** Bare /guild is T0. No verb → intake. Typed verbs bind class.
- **KTD47.** Ingested blobs = GuildStorage.definition("sources/<id>"). Not .guild/raw. Wiki ingest of citing pages stays human.
- **KTD48.** Compact history replaces skill-versions/. Shadow/rollback reads inverse spans. Upgrade deletes leftover version trees.
- **KTD49.** guild.research_packet.v1 on the run. Working files OS temp. Distilled decision may auto-promote. Class bind via intake, --class=, or /guild research.
- **KTD50.** refreshTouched = card + incremental BM25 + touched v1 links. Never graph, recall projection, validate-graph on v2, tour, or full learn.
- **KTD51.** Product intent = goal.v1. Cell roll-up = goal_status.v1. Spec/plan are lifecycle documents. Define is feedstock. Work-items are D8. Team compose per-phase; per-goal is a slice.
- **KTD52.** Adversarial wrappers are L3 invoked by stations, not required graph nodes. Overlay/rigor may skip. Product qa is the one review gate (KTD58).
- **KTD53.** Harvest supersede of a pinned decision → replan. No silent spec rewrite. No pin → no replan.
- **KTD54.** Concern enum = shipped DEFAULT_CONCERN_ENUM. CR-A N3 rewritten. Labels inert until authored. Harvest does not stamp labels. Checkpoint is 5-way (KTD57); reflect covers former unused columns.
- **KTD55.** Roster mint is class-scoped. Harvest writes this cwd only (workspace wiki iff T0 is the workspace root).
- **KTD56.** One authored graph per class. Overlay .guild/graphs/. Upgrade deletes leftover registry YAML as authored truth.
- **KTD57.** Checkpoint is a domain function. Verdict: none | decision | playbook_span | skill_def | reflect. Not a catalog skill.
- **KTD58.** One review gate: product qa → broker. Team Lead ≠ own reviewer. Loop-round on KTD16 JSONL. Self-build adversarial is plugin CI.
- **KTD59.** Closed indexed list of 17 assemblers. L3 and machinery stay off glob.
- **KTD60.** Compile pins MCP hashes with the binary. No separate ritual.
- **KTD61.** Budget is enforced. advisorRounds + optional token/usd caps. Exhaustion blocks the cell. D-PROBE and inner verify do not decrement.
- **KTD62.** Team compose is per-phase (shipped files stay). Per-goal is a roster slice of already-minted profiles, not a second mint.
- **KTD63.** Hook/adapter/learn_script/domain_ts evolve through the human gate. Auto-path never writes them.
- **KTD64.** Explicit learn Stage-2 is extract-structural.ts. refreshTouched still must not run Stage-2.
- **KTD65.** Umbrella docs/ and docs/v2/ and website/ are a sibling workspace plan. This initiative’s D8 is plugin-local (README, AGENTS.md, using-guild, command help). Record docs/v2: n/a.
- **KTD66.** Plugin produces inventory + KTD16 traces (including next_need / harvest / evolve-candidate). status dashboard launcher stays. UI product is the benchmark plan. No source import.
- **KTD67.** Recall backend bm25 | hybrid. Embeddings are cache only. Missing model fails open to BM25.
- **KTD68.** Critic is the advisor machinery agent. Product qa is still the one review gate. No new model family.
- **KTD69.** /guild research and /guild debug are sub-verbs that bind class. 13 command files. Print-only aliases on next.
- **KTD70.** Every Guild root has guild.glossary.v1 at .guild/wiki/glossary.md. context-manager attaches matching terms (capped). Not a host skill. Full file never in the always-on prefix.


## Codex adversarial review

Codex adversarial review runs at three gates — G-spec, G-plan, and G-lane — via the
`guild:codex-review` meta-skill (`skills/meta/codex-review/SKILL.md`).

| Gate | When |
|---|---|
| **G-spec** | After `guild:brainstorm` writes `.guild/spec/<slug>.md`, before `guild:team-compose`. |
| **G-plan** | After `guild:plan` writes `.guild/plan/<slug>.md`, before the user-approval gate. |
| **G-lane** | After EACH lane's handoff receipt is written, before the next lane dispatches. |

Mechanism: dispatch via `Agent({ subagent_type: "codex:codex-rescue", ... })` with an
adversarial prompt + the artifact + (rounds 2+) the prior Q&A trail. Loop until Codex
emits `## SATISFIED` on a line by itself. Round cap **5** (configurable via
`--codex-cap=N` or `.guild/settings.json` key `codex_cap`).

**As Guild's own dev discipline:** For self-build sessions, `--review=cross` is
implicitly always-on.

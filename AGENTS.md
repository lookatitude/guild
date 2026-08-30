# Guild — repo orientation

Guild is a cross-host plugin that ships 3 machinery agents (advisor, context-manager,
developer),
15 domain specialist type templates (minted into a project's `.guild/agents/` on
demand by team composition), and 111 skills across a
brainstorm-plan-execute-review-verify-reflect spine, a categorized wiki with decision
capture, and a self-evolution loop with shadow-mode gating.

This `AGENTS.md` file is the canonical host-neutral instruction file. Claude Code
loads `CLAUDE.md`, but `CLAUDE.md` must only import this file; all durable
directions belong here so Codex, Pi, Antigravity, and AGENTS.md-consuming hosts
read the same guidance.

For full architecture and design documentation see **https://guildstack.dev/docs**.

## Where things live

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — plugin + marketplace manifests.
- `skills/{core,meta,knowledge,specialists,guild-operations,guild-quality}/` — skill taxonomy.
  The former `fallback/` tier no longer exists — its skills were promoted into `meta/`
  (`tdd`, `systematic-debug`, `worktrees`, `finish-branch`) or folded into `guild:review`.
- `agents/*.md` — the 3 machinery agents (`advisor`, `context-manager`,
  `developer`), the only
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
1. Confirm `next` carries exact `MAJOR.MINOR.PATCH-beta.N`, hash-bound release
   evidence under `.guild/artifacts/release/vMAJOR.MINOR.PATCH/`, green CI,
   reconciled `docs/v2`, and a curated PR body suitable as release notes.
2. Open the release PR from the repository's exact `next` branch to `main`.
   `branch-policy.yml` rejects every other head branch and all forks.
3. Merge the PR. CI re-runs promotion evidence, derives the bare stable tag
   from the reviewed beta manifest, tags the exact merge commit with the
   built-in repository token, and publishes the PR body as the GitHub Release.
   CI does not commit or push to either protected branch.
4. Verify the workflow, tag, GitHub Release, and that the peeled tag equals the
   merged `main` commit. A re-run accepts an existing tag only when it already
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

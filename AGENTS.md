# Guild — repo orientation

Guild is a cross-host plugin that ships 17 registered agents (14 product specialists
plus advisor, developer, and doc-writer) and 110 skills across a
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
- `agents/*.md` — 17 registered agents: 14 product specialists plus `advisor`, `developer`,
  and `doc-writer` (promoted to first-class in v2.0). Populated and authored.
- `commands/*.md` — the v2 flat-token command surface (`/guild:<verb>`; the `:` plugin
  namespace stays — Claude Code requires it — v2 only drops the redundant `guild-` prefix;
  sub-verbs are positional arguments, never separate files or namespaces).
- `hooks/hooks.json` — native Claude Code hooks; other hosts consume equivalent
  behavior through host adapters and graceful fallback.
- `scripts/`, `mcp-servers/` — evolve loop, telemetry, optional MCP servers.
- `tests/` — skill evals and wiki-lint fixtures.
- `templates/{skills,agents}/` — authoring scaffolds.
- `docs/` — user-facing docs, diagrams, and assets.

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
| `/guild:plan` | `guild:team-compose` → `guild:plan` (deep: + `guild:loop-plan-review`) | `.guild/team/<slug>.yaml`, `.guild/prd/<slug>.md`, `.guild/plan/<slug>.md` |
| `/guild:build` | per lane: `guild:context-assemble` → `guild:execute-plan` → `guild:review` (deep: + `guild:loop-implement`) | handoff receipts, `assumptions.md`, `review.md` |
| `/guild:qa` | `guild:quality` | `.guild/runs/<run-id>/quality/<run-id>.md` |
| `/guild:ops` | `guild:operations` | `.guild/runs/<run-id>/ops/<run-id>.md` |
| `/guild:learn` | the `learn-*` family — `guild:learn-map` / `learn-graph` / `learn-onboard` / `learn-diff` / `learn-explain` | deep knowledge-graph + onboarding / diff / explain artifacts (lazy, gated) |

## Dev team (`.claude/agents/`)

The plugin is built by 10 dev-team agents, each owning a scoped slice. **These — not the
product specialists — are the team for any self-build work.** Dispatch each via the Agent
tool with `subagent_type: <agent-name>` (never `general-purpose`); agents never commit
themselves. They live in `.claude/agents/`.

| Changed path / concern | Dev-team agent (`subagent_type`) |
|---|---|
| `scripts/`, `mcp-servers/`, `.mcp.json` | `tooling-engineer` |
| `hooks/` (hooks.json + hook scripts) | `hook-engineer` |
| `commands/` | `command-builder` |
| `skills/**` (bodies + per-skill evals.json) | `skill-author` |
| `agents/*.md` (the 17 registered agents) | `specialist-agent-writer` |
| `tests/` (cross-cutting evals/fixtures) | `eval-engineer` |
| `docs/`, repo-root/plugin `CLAUDE.md` | `docs-writer` |
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
├── settings.json              # project/workspace behavior
├── workspace.json             # workspace federation manifest, when present
├── agents/                    # project-created agents/specialists
├── skills/                    # project-created skills/tools/workflows
├── tools/                     # project-created tool wrappers/adapters
├── raw/                       # immutable source inputs + checksums
├── wiki/                      # synthesized memory, decisions, standards
├── indexes/                   # codebase map, knowledge graph, links, sqlite index
├── initiatives/               # initiative registries and phase progress
├── spec/                      # approved specs
├── plan/                      # per-task plans
├── team/                      # resolved specialist teams
├── context/                   # per-run specialist context bundles
├── runs/                      # run traces, handoffs, prompts, responses, tool logs
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

## Branch + PR discipline (mandatory)

**No direct commits to `main` going forward.** Every change — fix-packs, polish rounds,
single-line edits — lands through a feature/release branch and a pull request.

Workflow:
1. Branch from `main`: `git checkout -b release/<version>` or `feature/<short-slug>`.
2. Commit + push the branch.
3. Open a PR (`gh pr create`) targeting `main`.
4. Merge via the PR (squash or merge per case).

**Mechanical enforcement.** A repo-checked-in `pre-push` hook at `.githooks/pre-push`
refuses direct push to `main`. Wire it once per clone:

```bash
git config core.hooksPath .githooks
```

Bypass for emergencies (force-push recovery from a slip): `GUILD_ALLOW_PUSH_MAIN=1 git push origin main` — logs a loud warning.

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
anything automatically. Ask the user for permission, then file a GitHub issue in the
plugin repository only after approval, using the sanitized analysis and linking the
relevant run artifacts.

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

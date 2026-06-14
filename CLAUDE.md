# Guild — repo orientation

Guild is a Claude Code plugin that ships 17 registered agents (14 product specialists
plus advisor, developer, and doc-writer) and 106 skills across a
brainstorm-plan-execute-review-verify-reflect spine, a categorized wiki with decision
capture, and a self-evolution loop with shadow-mode gating.

For full architecture and design documentation see **https://guildstack.dev/docs**.

## Where things live

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — plugin + marketplace manifests.
- `skills/{core,meta,knowledge,specialists,guild-operations,guild-quality}/` — 106-skill taxonomy.
  The former `fallback/` tier no longer exists — its skills were promoted into `meta/`
  (`tdd`, `systematic-debug`, `worktrees`, `finish-branch`) or folded into `guild:review`.
- `agents/*.md` — 17 registered agents: 14 product specialists plus `advisor`, `developer`,
  and `doc-writer` (promoted to first-class in v2.0). Populated and authored.
- `commands/*.md` — the v2 flat-token command surface (`/guild:<verb>`; the `:` plugin
  namespace stays — Claude Code requires it — v2 only drops the redundant `guild-` prefix;
  sub-verbs are positional arguments, never separate files or namespaces; filenames are the
  source of truth). Bare `/guild:guild [brief]` · 6 phase (init ideate plan build qa ops) ·
  `learn` · status/resume/wiki/config/initiative · maintenance (fix evolve rollback stats
  audit migrate). **Skills are model-invoked, never `/`-typed**: the command is
  `/guild:<token>`, the skill is `guild:<token>` — distinct surfaces that share a stem.
  v1→v2 migration: `https://guildstack.dev/docs/migration-v1-to-v2`
- `hooks/hooks.json` — native Claude Code hooks.
- `scripts/`, `mcp-servers/` — evolve loop, telemetry, optional MCP servers. Two newer
  script families:
  - `scripts/docs-hygiene/` — `scan.ts` (drift / progress-messaging / dangling refs /
    missing-`importance:` / secrets) + `memory-check.ts` (memory-vs-reality).
  - `scripts/dot-guild/` — `scrub.ts` (per-policy operator-path + tilde-Claude-path +
    secrets redaction) + `audit.ts` (`scrub --dry-run` + per-repo report) + `migrate.ts`
    (sha256-verified mover).
- `tests/` — skill evals and wiki-lint fixtures.
- `templates/{skills,agents}/` — authoring scaffolds.
- `docs/` — user-facing docs, diagrams, and assets.

## v2 phase → skill dispatch

The 6 phase commands (plus the `learn` command) are thin entrypoints; each invokes its
producer skill(s) in order. The invoked skills are model-invoked, never user-typed.
This is the one-place wiring reference — each command's `## Dispatch` section is
canonical, this table is the index.

| Phase verb | Skill(s) invoked, in order | Output artifact |
|---|---|---|
| `/guild:init` | `guild:init` (cheap by default: wiki + brownfield cheap-scan CodebaseMap + architecture-map stub) — full `learn-*` pipeline runs ONLY under `--learn` / `defaults.auto_learn` | `.guild/init/<slug>.md`, `.guild/wiki/**`, `codebase-map.json` + `architecture-map.md` stub |
| `/guild:ideate` | `guild:brainstorm` (standard+deep: wrapped by `guild:loop-clarify`) | `.guild/spec/<slug>.md` |
| `/guild:plan` | `guild:team-compose` → `guild:plan` (deep: + `guild:loop-plan-review`) | `.guild/team/<slug>.yaml`, `.guild/prd/<slug>.md`, `.guild/plan/<slug>.md` |
| `/guild:build` | per lane: `guild:context-assemble` → `guild:execute-plan` → `guild:review` (deep: + `guild:loop-implement`) | handoff receipts, `assumptions.md`, `review.md` |
| `/guild:qa` | `guild:quality` | `.guild/runs/<run-id>/quality/<run-id>.md` |
| `/guild:ops` | `guild:operations` | `.guild/runs/<run-id>/ops/<run-id>.md` |
| `/guild:learn` | the `learn-*` family — `guild:learn-map` / `learn-graph` / `learn-onboard` / `learn-diff` / `learn-explain` | deep knowledge-graph + onboarding / diff / explain artifacts (lazy, gated) |

Skill bodies live at `skills/meta/{init,brainstorm,team-compose,plan,context-assemble,execute-plan,review}/`,
the `learn-*` family, and `skills/{guild-quality,guild-operations}/`.

## Dev team (`.claude/agents/`)

The plugin is built by 10 dev-team agents, each owning a scoped slice. **These — not the
17 product specialists — are the team for any self-build work** (the product specialists
build *user* products). Dispatch each via the Agent tool with `subagent_type: <agent-name>`
(never `general-purpose`); agents never commit themselves. They live in `.claude/agents/`
(canonical: `plugin/.claude/agents/`; mirrored to the workspace root so they are
dispatchable when developing from there).

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
Guild itself). The Guild repo itself uses `.guild/` for its own self-build knowledge —
gitignored, but durable across sessions.

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
   `.guild/wiki/index.md`, append to `.guild/wiki/log.md`. Significance threshold per
   `skills/meta/decisions/SKILL.md` — medium/high persists; low stays in run transcript.
2. **Reflection after major work.** After a release, phase, or non-trivial task, invoke
   `guild:reflect` against the run summary; output to `.guild/reflections/<slug>.md`. The
   Stop hook only fires after `/guild` lifecycle, not after dev-team agent work — so this
   is **manual** for self-build sessions.
3. **Promotion on user gate.** Reflections are *proposals*. The user reviews;
   `guild:wiki-ingest` lands sourced knowledge; `guild:evolve-skill` lands skill body
   changes via shadow-mode. Nothing auto-promotes.

The wiki for the Guild repo lives at `.guild/wiki/` (start at `index.md`). Read it before
making decisions that touch the same surface — prior choices are recorded with their
rationale.

For cross-tree truths (operator preferences that survive *outside* this working directory),
use auto-memory at `~/.claude/projects/.../memory/`. The wiki is repo-scoped; memory is
operator-scoped.

## Backend default — the `agent_mode` dispatch ladder

`agent_mode: team | agent | subagent | auto` (`.guild/settings.json`, default `auto`)
governs the execution backend for every `/guild` lifecycle run. See
`https://guildstack.dev/docs/architecture` for the full ladder and configuration options.

**On `auto`, resolve in order:**

1. **Inside tmux** (`$TMUX` set) → **TEAM** in-session: a new window in the current
   session, one pane per specialist, `select-window`ed so the panes are immediately visible.
2. **tmux installed** (but not currently inside one) → **TEAM** in a fresh detached
   session, then attaches your terminal to it.
3. **No tmux, host supports independent agents** → **AGENT** — `InProcessTeamBackend`:
   the orchestrator consumes a declarative `dispatchPlan`; each specialist is dispatched as
   an independent Agent-tool call, no tmux required.
4. **Else** → **SUBAGENT** (fallback): `guild:execute-plan` dispatches specialists via the
   Agent tool; no tmux required (CI, fresh installs).

**`defaults.agent_team` is hard-removed in v2.0**: rejected by `--validate`, stripped by
resolve mode. Migrate via `/guild:migrate`.

Remote cross-host SSH dispatch is gated by `defaults.cross_host` (`.guild/settings.json`).
See `https://guildstack.dev/docs/configuration` (`defaults.cross_host.*`).

## Model tiering + §task§agent lifecycle

> Normative detail on tiering: `https://guildstack.dev/docs/cost-and-tiering`

Three stable tiers: `cheap` (haiku) for read/summarize/classify; `mid` (sonnet, default
task-agent tier) for draft/reason/plan/extract; `powerful` (opus) for architecture,
security review, graph schema. The tier→model map is host-agnostic in `settings.json`
(`models.tiers`).

The orchestrator scores each lane from deterministic signals (work-type verb, blast-radius,
security sensitivity, prior escalation), maps to a tier, and prints the score + resolved
tier. Precedence: `--model-tier=cheap|mid|powerful` CLI flag > per-lane plan override
(`model_tier:`) > `settings.json models:` block > built-in default.

**§task§agent lifecycle (ephemeral, one-per-task).** Spawn a new agent for each task at
its resolved tier with task-scoped context pulled from the knowledge base (recall-before-read;
6k hard cap) → work → extract learnings into `guild.handoff.v2` → terminate. The lead
accumulates only compact `guild.handoff.v2` envelopes, not full transcripts.

Full config reference: `https://guildstack.dev/docs/configuration`.

## Codex adversarial review

Codex adversarial review runs at three gates — G-spec, G-plan, and G-lane — via the
`guild:codex-review` meta-skill (`skills/meta/codex-review/SKILL.md`). Available to all
plugin users via `--review=cross` on `/guild`, or persistently via `.guild/settings.json`
(`review: cross`).

| Gate | When |
|---|---|
| **G-spec** | After `guild:brainstorm` writes `.guild/spec/<slug>.md`, before `guild:team-compose`. |
| **G-plan** | After `guild:plan` writes `.guild/plan/<slug>.md`, before the user-approval gate. |
| **G-lane** | After EACH lane's handoff receipt is written, before the next lane dispatches (or before `guild:review` for the final lane). |

Mechanism: dispatch via `Agent({ subagent_type: "codex:codex-rescue", ... })` with an
adversarial prompt + the artifact + (rounds 2+) the prior Q&A trail. Loop until Codex
emits `## SATISFIED` on a line by itself. Round cap **5** (configurable via `--codex-cap=N`
or `.guild/settings.json` key `codex_cap`); on round 6, surface to user with 3 options
(force-pass / extend-cap / rework). Trail under `.guild/runs/<run-id>/codex-review/<gate>.md`.

If Codex is unavailable, the gate emits `warn: codex-review skipped — codex plugin not
installed` and proceeds.

**As Guild's own dev discipline:** For self-build sessions, `--review=cross` is implicitly
always-on — treat every G-spec/G-plan/G-lane gate as if `codex_review: true` is set.

Full discipline at `.guild/wiki/standards/codex-adversarial-review.md`; decision rationale
at `.guild/wiki/decisions/codex-adversarial-review-loop.md`.

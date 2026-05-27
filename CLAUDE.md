# Guild — repo orientation

Guild is a Claude Code plugin that ships a team of 14 domain specialists plus a brainstorm-plan-execute-review-verify-reflect spine, a categorized wiki with decision capture, and a self-evolution loop with shadow-mode gating.

**Single source of truth: `guild-plan.md`.** Read it before making design decisions. Do not duplicate it here.

## Where things live

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — plugin + marketplace manifests.
- `skills/{core,meta,knowledge,fallback,specialists}/` — 5-tier skill taxonomy (`guild-plan.md §5`).
- `agents/*.md` — 14 shipping specialists (`guild-plan.md §6` + `frontend` graduated 2026-04-26 via §12). Populated and authored.
- `commands/*.md` — the v2 **flat-token** command surface (`/guild:<verb>`; the `:` plugin namespace stays — Claude Code requires it — v2 only drops the redundant `guild-` command prefix; sub-verbs are positional ARGUMENTS, never separate files or namespaces; filenames are the source of truth — D1): bare `/guild:guild [brief]` · 6 phase (init ideate plan build qa ops) · `learn` (NEW — owns understand-everything, D3) · `status` `resume` `wiki` `config` `initiative` · maintenance (fix evolve rollback stats audit) · the 6 v1→v2 sunset redirect stubs. **Skills are model-invoked, never `/`-typed** (D2): the command is `/guild:<token>`, the skill is `guild:<token>` — distinct surfaces that share a stem (`plan`/`init`/`audit` collisions are intentional). Canonical: architecture/command-surface.md §2; flat-token + de-listing + dispatch ladder: `docs/knowledge/decisions/v2x-command-surface-dispatch-and-internalization.md`; v1→v2: MIGRATION.md.
- `hooks/hooks.json` — native Claude Code hooks (`guild-plan.md §13.2`).
- `scripts/`, `mcp-servers/` — evolve loop, telemetry, optional MCP servers (`guild-plan.md §13.3`).
- `tests/` — skill evals and wiki-lint fixtures.
- `templates/{skills,agents}/` — authoring scaffolds.
- `docs/phase-gates/` — phase-by-phase integration logs.
- `benchmark/` — sibling autoresearch-pattern benchmark factory; v1.1 ships 2026-04-27.

## v2 phase → skill dispatch

The 6 phase commands (plus the NEW `learn` command) are thin entrypoints; each
invokes its producer skill(s) in order. The invoked skills are **model-invoked,
never user-typed** (D2). This is the one-place wiring reference — each command's
`## Dispatch` section is canonical, this table is the index. (`--rigor=deep`
wrappers in parens; no skill is re-spelled here.)

| Phase verb | Skill(s) invoked, in order | Output artifact |
|---|---|---|
| `/guild:init` | `guild:init` (cheap by default: wiki + brownfield cheap-scan CodebaseMap + architecture-map stub) — full `learn-*` pipeline runs ONLY under `--learn` / `defaults.auto_learn` (D3) | `.guild/init/<slug>.md`, `.guild/wiki/**`, `codebase-map.json` + `architecture-map.md` stub |
| `/guild:ideate` | `guild:brainstorm` (deep: wrapped by `guild:loop-clarify`) | `.guild/spec/<slug>.md` |
| `/guild:plan` | `guild:team-compose` → `guild:plan` (deep: + `guild:loop-plan-review`) | `.guild/team/<slug>.yaml`, `.guild/prd/<slug>.md`, `.guild/plan/<slug>.md` |
| `/guild:build` | per lane: `guild:context-assemble` → `guild:execute-plan` → `guild:review` (deep: + `guild:loop-implement`) | handoff receipts, `assumptions.md`, `review.md` |
| `/guild:qa` | `guild:quality` | `.guild/runs/<run-id>/quality/<run-id>.md` |
| `/guild:ops` | `guild:operations` | `.guild/runs/<run-id>/ops/<run-id>.md` |
| `/guild:learn` (NEW) | the `learn-*` family — `guild:learn-map` / `learn-graph` / `learn-onboard` / `learn-diff` / `learn-explain` (D3/D4; one implementation, two triggers — same pipeline as `init --learn`) | deep knowledge-graph + onboarding / diff / explain artifacts (lazy, gated) |

Skill bodies live at `skills/meta/{init,brainstorm,team-compose,plan,context-assemble,execute-plan,review}/`, the `learn-*` family (clean-room re-authored from the former `skills/knowledge/understand-engine/` per D4 — exact file granularity is skill-author's call), and `skills/{guild-quality,guild-operations}/`. Verb↔phase edge: `architecture/command-surface.md §6` (D-14), corrected to flat-token / sub-verbs-as-arguments by D1. Note: the Init-phase skill's frontmatter `name:` is `init` (namespaced `guild:init`).

## Dev team (`.claude/agents/`)

The plugin is built by 8 dev-team agents, each owning a scoped slice. **These — not the 14 `guild:` product specialists — are the team for any self-build work** (the product specialists build *user* products). Dispatch each via the Agent tool with `subagent_type: <agent-name>` (never `general-purpose`); agents never commit themselves. They live in `.claude/agents/` (canonical: `plugin/.claude/agents/`; mirrored to the workspace root so they are dispatchable when developing from there).

| Changed path | Dev-team agent (`subagent_type`) |
|---|---|
| `scripts/`, `mcp-servers/`, `.mcp.json` | `tooling-engineer` |
| `hooks/` (hooks.json + hook scripts) | `hook-engineer` |
| `commands/` | `command-builder` |
| `skills/**` (bodies + per-skill evals.json) | `skill-author` |
| `agents/*.md` (the 14 shipping specialists) | `specialist-agent-writer` |
| `tests/` (cross-cutting evals/fixtures) | `eval-engineer` |
| `docs/`, repo-root/plugin `CLAUDE.md` | `docs-writer` |
| `.claude-plugin/*`, manifests, ADRs, phase-gate integration | `plugin-architect` |

Route by the path being changed; when a task spans several, dispatch the matching specialists in parallel (worktree-isolated) per `guild:execute-plan`.

## Project-local state

Runtime artifacts live under `.guild/` at the consuming repo's root (never committed by Guild itself). Layout in `guild-plan.md §4`. The Guild repo itself uses `.guild/` for its own self-build knowledge — gitignored, but durable across sessions.

The wiki read path uses a lazy SQLite read-through cache (`index: "auto"`, default); disable with `index: "off"`. See the Guild docs site → `https://lookatitude.github.io/guild-website/docs/configuration` (`defaults.index.*`).

## Branch + PR discipline (mandatory)

**No direct commits to `main` going forward.** Every change — fix-packs, polish rounds, single-line edits — lands through a feature/release branch and a pull request.

Workflow:
1. Branch from `main`: `git checkout -b release/<version>` or `feature/<short-slug>`.
2. Commit + push the branch.
3. Open a PR (`gh pr create`) targeting `main`.
4. Merge via the PR (squash or merge per case).

**Mechanical enforcement.** A repo-checked-in `pre-push` hook at `.githooks/pre-push` refuses direct push to `main`. Wire it once per clone:

```bash
git config core.hooksPath .githooks
```

Bypass for emergencies (force-push recovery from a slip): `GUILD_ALLOW_PUSH_MAIN=1 git push origin main` — logs a loud warning.

Rationale: PRs give an explicit review surface, attach CI/checks, document the change in the GitHub timeline, and keep `main` unilaterally mutable only via the PR mechanism. v1.1 was force-pushed back to revert a direct-to-main slip and re-routed through `release/v1.1.0` PR — the rule applies retroactively from that point. Codified in `.guild/wiki/standards/release-discipline.md` rule 6.

## Continuous knowledge — discipline

Guild has a built-in self-evolution loop (`guild-plan.md §10`, `§11`). For Guild's own development, the discipline is:

1. **Decision capture (real-time).** When the user redirects the work on a non-trivial choice, invoke `guild:decisions` to write `.guild/wiki/decisions/<slug>.md`, update `.guild/wiki/index.md`, append to `.guild/wiki/log.md`. Significance threshold per `skills/meta/decisions/SKILL.md` — medium/high persists; low stays in run transcript.
2. **Reflection after major work.** After a release, phase, or non-trivial task, invoke `guild:reflect` against the run summary; output to `.guild/reflections/<slug>.md`. The Stop hook only fires after `/guild` lifecycle, not after dev-team agent work — so this is **manual** for self-build sessions.
3. **Promotion on user gate.** Reflections are *proposals*. The user reviews; `guild:wiki-ingest` lands sourced knowledge; `guild:evolve-skill` lands skill body changes via shadow-mode. Nothing auto-promotes.

The wiki for the Guild repo lives at `.guild/wiki/` (start at `index.md`). Read it before making decisions that touch the same surface — prior choices are recorded with their rationale. Backfill landed 2026-04-27 covering nine v1.1 decisions, two standards, one recipe, and the v1.1 reflection.

For cross-tree truths (operator preferences that survive *outside* this working directory), use auto-memory at `~/.claude/projects/.../memory/`. The wiki is repo-scoped; memory is operator-scoped.

## Backend default — the `agent_mode` dispatch ladder

`agent_mode: team | agent | subagent | auto` (`.guild/settings.json`, default `auto`) governs the execution backend for every `/guild` lifecycle run. It **supersedes** the old binary `defaults.agent_team` and resolves the prior `guild-plan.md §7.3` (subagent-default) ↔ this file (agent-team-default) contradiction in favor of one deterministic ladder (ADR D5: `docs/knowledge/decisions/v2x-command-surface-dispatch-and-internalization.md`).

**On `auto`, resolve in order — team and independent agents are PRIMARY; subagent is the documented last resort:**

1. **Inside tmux** (`$TMUX` set) → **TEAM** in-session: a new window in the current session (`tmux new-window -n guild-<slug>`), one pane per specialist, `select-window`ed so the panes are immediately visible. Never splits or kills the currently-active pane/window.
2. **tmux installed** (but not currently inside one) → **TEAM** in a fresh **detached session**, then attaches your terminal to it.
3. **No tmux, but the host (`claude` | `codex`) supports independent agents from the main session** → **AGENT** — `InProcessTeamBackend` (implemented): the orchestrator consumes a declarative `dispatchPlan`; each specialist is dispatched as an independent Agent-tool call, no tmux required.
4. **Else** → **SUBAGENT** (fallback): `guild:execute-plan` dispatches specialists via the Agent tool; no tmux required (CI, fresh installs).

An explicit `agent_mode` value other than `auto` **pins** the backend, subject to availability — pinning `team` on a tmux-less host is rejected/warned (owner: `tooling-engineer`). `defaults.agent_team` is read as a **deprecated warn-once alias** for one minor (`true → team`, `false → subagent`, absent → `auto`), then removed at v2.1.0.

Remote cross-host SSH dispatch is gated by `defaults.cross_host` (`.guild/settings.json`) and declared per-team via `host:` in `team.yaml`. See the Guild docs site → `https://lookatitude.github.io/guild-website/docs/configuration` (`defaults.cross_host.*`).

**§7.3 hard invariants preserved in every mode:** one team per session; a team-window collision (in-session, window already named `guild-<slug>`) or a session-name collision (new-session) makes the launcher **refuse to clobber** and print how to switch to or kill the existing team; the pre-flight env gate `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (checked by `scripts/agent-team-launcher.ts`) stays in force for team spawn — absent, the launcher refuses. The launcher owns the tmux strategy and these gates.

This satisfies the §7.3 user-approval requirement for the agent-team backend — the operator's instruction (2026-04-27) approves agent-team as the durable default whenever tmux is present on this machine, now expressed as the `auto` ladder above. Full rationale + options scored: `.guild/wiki/decisions/agent-team-default-when-tmux-available.md` (subsumed by D5); subsumes the v1.0 task-scoped approval at `.guild/wiki/decisions/agent-team-via-tmux.md`.

## Model tiering + §task§agent lifecycle

> **Canonical ADR: `docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md`**
> (§1 tier ladder · §2 auto-score · §3 advisor · §4 lean lead + recall · §5
> handoff schema · §6 lifecycle · §8 learn tiering · §10 config keys). This
> section is an orientation note; all normative detail lives in that ADR.

**Tier ladder (host-agnostic).** Three stable tiers: `cheap` (haiku) for
read/summarize/classify; `mid` (sonnet, default task-agent tier) for
draft/reason/plan/extract; `powerful` (opus) for architecture, security
review, graph schema. The tier→model map is host-agnostic in
`settings.json` (`models.tiers`) so Codex/Gemini adapters slot in later as
config + an adapter. This is **orthogonal to the D5 `agent_mode` dispatch
ladder** — tiering picks the model, D5 picks the backend; they compose and
never conflict.

**Auto-score.** The orchestrator scores each lane from deterministic
signals (work-type verb, blast-radius, security sensitivity, prior
escalation), maps the score to a tier, and prints the score + resolved
tier. Precedence: `--model-tier=cheap|mid|powerful` CLI flag > per-lane
plan override (`model_tier:`) > `settings.json models:` block > built-in
default.

**Advisor escalation.** A low-tier agent emitting `status: "escalate"` in
its `guild.handoff.v2` envelope gets one `powerful` advisor answer for
that sub-question (the advisor sees draft + question only, never raw file
context), then continues — no wholesale re-run. Advisor consults are
capped per lane (`models.advisorRounds`, default `2`).

**§task§agent lifecycle (ephemeral, one-per-task).** Spawn a new agent for
each task at its resolved tier with task-scoped context pulled from the
knowledge base (recall-before-read; 6k hard cap unchanged) → work →
extract learnings into `guild.handoff.v2` → terminate. No agent is shared
across tasks; no agent is left idle. The lead accumulates only compact
`guild.handoff.v2` envelopes, not full transcripts.

**`guild.handoff.v2` envelope.** The lightweight in-flight dispatch return
schema (`schema_version: guild.handoff.v2`). It is a **new self-versioned
sibling** of the frozen `guild.handoff_receipt.v1` (the review/verify
receipt — unchanged). On completion the handoff envelope composes into the
frozen receipt; the two do not compete.

**Zero-config stable.** An absent `models:` block ⇒ current v2 behavior
except cheaper `learn-*` (the built-in tier-map biases cheap). Scaffold
and inspect the block with `/guild:config init` / `/guild:config show`.
O-3 short-output advisor floors land in `models.shortOutputThreshold` after
running `npx tsx benchmark/src/calibrate-o3-cli.ts` — nothing auto-writes
this key. Full config reference: Guild docs site → `https://lookatitude.github.io/guild-website/docs/configuration`.

## Codex adversarial review

Codex adversarial review runs at three gates — G-spec, G-plan, and G-lane — via the `guild:codex-review` meta-skill (`skills/meta/codex-review/SKILL.md`). It is available to all plugin users via `--review=cross` on `/guild`, or persistently via `.guild/settings.json` (`review: cross`).

| Gate | When |
|---|---|
| **G-spec** | After `guild:brainstorm` writes `.guild/spec/<slug>.md`, before `guild:team-compose`. |
| **G-plan** | After `guild:plan` writes `.guild/plan/<slug>.md`, before the user-approval gate. |
| **G-lane** | After EACH lane's handoff receipt is written, before the next lane dispatches (or before `guild:review` for the final lane). |

Mechanism: dispatch via `Agent({ subagent_type: "codex:codex-rescue", ... })` with an adversarial prompt + the artifact + (rounds 2+) the prior Q&A trail. Loop until Codex emits `## SATISFIED` on a line by itself. Round cap **5** (configurable via `--codex-cap=N` or `.guild/settings.json` key `codex_cap`); on round 6, surface to user with 3 options (force-pass / extend-cap / rework). Trail under `.guild/runs/<run-id>/codex-review/<gate>.md`.

If Codex is unavailable (`codex --version` fails or dispatch returns "not authenticated"), the gate emits `warn: codex-review skipped — codex plugin not installed` and proceeds. Don't hard-block on Codex outages.

**As Guild's own dev discipline:** For self-build sessions (developing the Guild plugin itself via the `/guild` lifecycle), `--review=cross` is implicitly always-on — treat every G-spec/G-plan/G-lane gate as if `codex_review: true` is set, regardless of CLI flags or config. This is the dev discipline documented previously as "dev-only"; the implementation is now the same `guild:codex-review` skill.

Full discipline at `.guild/wiki/standards/codex-adversarial-review.md`; decision rationale at `.guild/wiki/decisions/codex-adversarial-review-loop.md`.

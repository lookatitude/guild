# Guild — repo orientation

Guild is a Claude Code plugin that ships a team of 14 domain specialists plus a brainstorm-plan-execute-review-verify-reflect spine, a categorized wiki with decision capture, and a self-evolution loop with shadow-mode gating.

**Single source of truth: `guild-plan.md`.** Read it before making design decisions. Do not duplicate it here.

## Where things live

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — plugin + marketplace manifests.
- `skills/{core,meta,knowledge,fallback,specialists}/` — 5-tier skill taxonomy (`guild-plan.md §5`).
- `agents/*.md` — 14 shipping specialists (`guild-plan.md §6` + `frontend` graduated 2026-04-26 via §12). Populated and authored.
- `commands/*.md` — the v2 command surface: 3 daily (/guild [brief], /guild status, /guild wiki) · 6 phase (init ideate plan build qa ops) · helpers (status resume) · maintenance (fix evolve rollback stats audit) · initiative (opt-in). Canonical: architecture/command-surface.md §2; v1→v2: MIGRATION.md.
- `hooks/hooks.json` — native Claude Code hooks (`guild-plan.md §13.2`).
- `scripts/`, `mcp-servers/` — evolve loop, telemetry, optional MCP servers (`guild-plan.md §13.3`).
- `tests/` — skill evals and wiki-lint fixtures.
- `templates/{skills,agents}/` — authoring scaffolds.
- `docs/phase-gates/` — phase-by-phase integration logs.
- `benchmark/` — sibling autoresearch-pattern benchmark factory; v1.1 ships 2026-04-27.

## v2 phase → skill dispatch

The 6 phase commands are thin entrypoints; each invokes its producer skill(s)
in order. This is the one-place wiring reference — each command's `## Dispatch`
section is canonical, this table is the index. (`--rigor=deep` wrappers in
parens; no skill is re-spelled here.)

| Phase verb | Skill(s) invoked, in order | Output artifact |
|---|---|---|
| `/guild init` | `guild:init` → `guild:understand-engine` (brownfield cheap-scan tier only) | `.guild/init/<slug>.md`, `.guild/wiki/**`, `codebase-map.json` + `architecture-map.md` stub |
| `/guild ideate` | `guild:brainstorm` (deep: wrapped by `guild:loop-clarify`) | `.guild/spec/<slug>.md` |
| `/guild plan` | `guild:team-compose` → `guild:plan` (deep: + `guild:loop-plan-review`) | `.guild/team/<slug>.yaml`, `.guild/prd/<slug>.md`, `.guild/plan/<slug>.md` |
| `/guild build` | per lane: `guild:context-assemble` → `guild:execute-plan` → `guild:review` (deep: + `guild:loop-implement`) | handoff receipts, `assumptions.md`, `review.md` |
| `/guild qa` | `guild:quality` | `.guild/runs/<run-id>/quality/<run-id>.md` |
| `/guild ops` | `guild:operations` | `.guild/runs/<run-id>/ops/<run-id>.md` |

Skill bodies live at `skills/meta/{init,brainstorm,team-compose,plan,context-assemble,execute-plan,review}/`, `skills/knowledge/understand-engine/`, and `skills/{guild-quality,guild-operations}/`. Verb↔phase edge: `architecture/command-surface.md §6` (D-14). Note: the Init-phase skill's frontmatter `name:` is `init` (namespaced `guild:init`).

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

## Backend default — agent-team when tmux is available

When composing a team for any `/guild` lifecycle run, default `team.yaml`'s `backend:` field to `agent-team` whenever `which tmux` succeeds — **whether or not** the orchestrator is already inside a tmux session. Fall back to `backend: subagent` only on tmux-less machines (CI, fresh installs), where `guild:execute-plan` dispatches specialists via the Agent tool and no tmux is required.

The launcher (`scripts/agent-team-launcher.ts`) picks its tmux strategy from `$TMUX`:

- **`$TMUX` unset** (plain shell): creates a fresh **detached session** with one pane per specialist, then attaches your terminal to it.
- **`$TMUX` set** (already inside tmux): spawns the team **in the current session** as a new window (`tmux new-window -n guild-<slug>`), builds one pane per specialist by splitting that window, then `select-window`s it so the panes are immediately visible. It never splits or disturbs your currently-active pane and never kills an existing pane/window. The earlier "exit tmux and re-run from a plain shell" workaround is retired — the in-session window is the path now.

The one-team-per-session rule (§7.3) is preserved in both modes: a team-window collision (in-session, window already named `guild-<slug>`) or a session-name collision (new-session) makes the launcher refuse to clobber and print how to switch to or kill the existing team.

This satisfies the §7.3 user-approval requirement for the agent-team backend — the user's instruction (2026-04-27) explicitly approves agent-team as the durable default for all future Guild work on this operator's machine, not just one task.

The pre-flight env-var gate `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (checked by `scripts/agent-team-launcher.ts`) remains in force. Operators must set it for agent-team to spawn; absent, the launcher refuses.

Full rationale + options scored: `.guild/wiki/decisions/agent-team-default-when-tmux-available.md`. Subsumes the v1.0 task-scoped approval at `.guild/wiki/decisions/agent-team-via-tmux.md`.

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

# Guild — repo orientation

Guild is a Claude Code plugin that ships a team of 14 domain specialists plus a brainstorm-plan-execute-review-verify-reflect spine, a categorized wiki with decision capture, and a self-evolution loop with shadow-mode gating.

**Single source of truth: `guild-plan.md`.** Read it before making design decisions. Do not duplicate it here.

## Where things live

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — plugin + marketplace manifests.
- `skills/{core,meta,knowledge,fallback,specialists}/` — 5-tier skill taxonomy (`guild-plan.md §5`).
- `agents/*.md` — 14 shipping specialists (`guild-plan.md §6` + `frontend` graduated 2026-04-26 via §12). Populated and authored.
- `commands/*.md` — 7 slash commands (`guild-plan.md §13.1`).
- `hooks/hooks.json` — native Claude Code hooks (`guild-plan.md §13.2`).
- `scripts/`, `mcp-servers/` — evolve loop, telemetry, optional MCP servers (`guild-plan.md §13.3`).
- `tests/` — skill evals and wiki-lint fixtures.
- `templates/{skills,agents}/` — authoring scaffolds.
- `docs/phase-gates/` — phase-by-phase integration logs.
- `benchmark/` — sibling autoresearch-pattern benchmark factory; v1.1 ships 2026-04-27.

## Dev team (`.claude/agents/`)

The plugin is built by 8 dev-team agents, each owning a scoped slice: `plugin-architect`, `skill-author`, `specialist-agent-writer`, `command-builder`, `hook-engineer`, `tooling-engineer`, `docs-writer`, `eval-engineer`. Dispatch through the main session; agents never commit themselves.

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

## Codex adversarial review — dev-only discipline

When developing the Guild plugin via the `/guild` lifecycle, every gate that produces a load-bearing artifact runs an adversarial Codex review loop before the lifecycle advances:

| Gate | When |
|---|---|
| **G-spec** | After `guild:brainstorm` writes `.guild/spec/<slug>.md`, before `guild:team-compose`. |
| **G-plan** | After `guild:plan` writes `.guild/plan/<slug>.md`, before the user-approval gate. |
| **G-lane** | After EACH lane's handoff receipt is written, before the next lane dispatches (or before `guild:review` for the final lane). |

Mechanism: dispatch via `Agent({ subagent_type: "codex:rescue", ... })` with an adversarial prompt + the artifact + (rounds 2+) the prior Q&A trail. Loop until Codex emits `## SATISFIED` on a line by itself. Round cap **5**; on round 6, surface to user with 3 options (force-pass / extend-cap / rework). Trail under `.guild/runs/<run-id>/codex-review/<gate>.md`.

If Codex is unavailable (`codex --version` fails or dispatch returns "not authenticated"), the gate prints `warn: codex-adversarial-review skipped — codex unavailable.` and proceeds. Don't hard-block on Codex outages.

Full discipline at `.guild/wiki/standards/codex-adversarial-review.md`; decision rationale at `.guild/wiki/decisions/codex-adversarial-review-loop.md`. **Dev-only** — does NOT ship in the plugin distribution. Guild's lifecycle skills (`brainstorm`, `plan`, `execute-plan`) deliberately don't know about Codex; the discipline is layered at the orchestrator-instruction level (this section + the wiki standard) so consumers of Guild never acquire a Codex auth dependency.

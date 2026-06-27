---
type: decision
owner: architect
confidence: high
importance: critical
source_refs:
  - docs/knowledge/architecture/command-surface.md §1
  - docs/knowledge/architecture/command-surface.md §6
  - guild-plan.md §7.3
  - plugin/CLAUDE.md
  - plugin/scripts/agent-team-launcher.ts
  - plugin/scripts/read-guild-config.ts
created_at: 2026-05-26
updated_at: 2026-05-26
expires_at: null
supersedes: "command-surface.md §6 (the D-14 verb-context framing — flat-token correction) + command-surface.md §1 (the misleading frontmatter-name framing) + guild-plan.md §7.3 (the subagent-as-production-default backend rule)"
sensitivity: internal
applies_to: [plugin]
related: [config-surface-settings-json, command-clean-slate, concept-integration, guild-boundary-config-and-tracking, v2-scope-and-risk-g1-g8]
---

# ADR: v2.x command surface (flat-token), skill de-listing, `/guild:learn` + auto_learn, full skill internalization, and the dispatch ladder

## Status

**Accepted** (2026-05-26, operator decision — design only). This ADR is a
**decision record**; it does not write command files, skill bodies, config
schema, agent definitions, or migration prose. It records five LOCKED operator
decisions (D1–D5) and hands each to its owning dev-team agent for
implementation. It follows the precedent set by
[`config-surface-settings-json`](config-surface-settings-json.md) — an
operator-locked ADR that amends a settling surface without re-opening it.

Every command in the v2 surface this ADR describes is colon-form
**`/guild:<verb>`** — the `:` plugin namespace is a Claude Code requirement
(confirmed by the bare-`/guild` spike recorded in D1). v2 drops only the
**redundant `guild-` command prefix** (v1 `/guild:guild-wiki` → v2
`/guild:wiki`), never the colon. The "colon-drop" framing in
[`command-clean-slate`](command-clean-slate.md) is corrected to this
prefix-drop framing by D1 below.

## Context

Five surfaces had drifted or were under-specified against Claude Code's actual
plugin-command mechanics and against the operator's intent for an own-it,
zero-dependency Guild:

1. **Command grammar mechanics.** `command-surface.md §1` froze a clean-slate
   *space* grammar (`/guild <verb>`) — itself a mechanical error — and the
   surrounding docs and some skill frontmatter implied a verb could carry
   spaces or that sub-verbs might become their own command files / namespaces.
   Claude Code plugin commands are **flat** and **always colon-namespaced** —
   the user-typed token is `/<plugin>:<token>`, `:` is the reserved
   plugin↔token separator, and the token is derived from the command file's
   path/filename. There is no space-form command and nested namespaces are not
   representable. (Verified empirically — see the D1 bare-`/guild` spike result.)

2. **Command-vs-skill conflation.** Every Guild skill (`guild-plan.md §5`,
   tiers T1–T5) is **model-invoked**; none is a user-typed `/`-command. The
   docs did not state a clean command→owned-skills map, leaving the impression
   that, e.g., `guild:plan` (the skill) and `/guild:plan` (the command) were
   the same surface. Three tokens collide by name (`plan`, `init`, `audit`)
   between the command layer and the skill layer.

3. **"Understand everything" was unowned.** The borrowed
   `understand-engine` / `understand-onboard` capabilities had no first-class
   Guild command and were entangled with `/guild:init`'s cost (deep scans at
   bootstrap).

4. **Borrowed-skill dependency + attribution debt.** `guild-plan.md §5` framed
   methodology skills as a **forked "fallback" tier** carrying MIT
   `LICENSE-attribution.md` files and "forked from" blockquotes, with
   redundant superpowers review forks (`request-review` / `receive-review` /
   `verify-claim`) sitting beside Guild-native `review` / `verify-done`.

5. **A live backend-default contradiction.** `guild-plan.md §7.3` and
   `skills/meta/execute-plan` declare **subagent** the production default;
   `plugin/CLAUDE.md` ("Backend default — agent-team when tmux is available")
   declares **agent-team** the durable default whenever `which tmux` succeeds.
   Both are checked in. A run cannot honor both.

The operator locked decisions resolving all five. This ADR records them; it
does not re-litigate them.

## Decision

### D1 — Command surface is flat-token only

Claude Code plugin commands are **flat** `/<plugin>:<token>`. There are **no
nested command namespaces**: `/guild:x:y` is not representable and a
`-x-y`-style filename is **not** a namespace — `:` is reserved as the
plugin↔token separator, and command subdirectories collapse into the token.
The user-typed token is **derived from the command file's path/filename**, so
**filenames are the source of truth**. A command's frontmatter `name:` carrying
spaces (e.g. `name: guild init`) is **dead metadata** — it does not produce a
two-word command and must be normalized away.

- **Canonical user palette (these commands only; sub-verbs are ARGUMENTS, never
  separate files or namespaces):**
  `/guild:guild` (bare entry — there is no bare `/guild`, see the spike result
  below), `init`, `ideate`, `plan`, `build`, `qa`, `ops`,
  **`learn` (NEW — D3)**, `status`, `resume`, `wiki`, `initiative`, `config`,
  `evolve`, `rollback`, `stats`, `audit`, `fix`, **`migrate` (NEW — v2.0)** — the **6 v1→v2 sunset
  redirect stubs** (`guild-wiki`, `guild-evolve`, `guild-rollback`,
  `guild-stats`, `guild-audit`, `guild-diagnose`) were print-only redirects
  and are **deleted in v2.0 (this release)** (MIGRATION.md §5).
- **Sub-verbs are positional arguments.** `wiki <ingest|query|lint>`,
  `initiative <new|status|…|close>`, `config <init|show|validate>`,
  `learn <map|graph|onboard|diff|explain>` are **one command file each** whose
  first positional selects the sub-verb. They are never separate command files
  and never separate namespaces.
- **VERIFICATION RESULT (resolved 2026-05-26 — bare-`/guild` spike,
  `command-builder`):** Claude Code commands are **always colon-namespaced** —
  a bare `/guild` is **not** a command. The bare plugin name is not itself an
  entrypoint; a `guild.md` token file is required, so the bare entry is
  **`/guild:guild`**. This also settles the broader grammar: every command is
  **`/guild:<verb>`** (the `:` namespace is retained — a Claude Code plugin
  requirement), and v2 drops only the **redundant `guild-` command prefix**
  (v1 `/guild:guild-wiki` → v2 `/guild:wiki`). The earlier "space grammar" /
  "colon-drop" framing was a mechanical error and is corrected everywhere. The
  result is recorded back into `command-surface.md §1` (supersession banner) and
  `MIGRATION.md` (§1/§2).
- **Normalizations required:** (a) filenames are the source of truth — rename
  any file whose name does not equal its intended token; (b) **remove the
  misleading `name: guild <verb>` spaces** from command frontmatter; (c)
  **resolve the command↔skill token collisions** (`plan`, `init`, `audit`) by
  making the namespacing explicit — the command is `/guild:<token>`, the skill
  is `guild:<token>` (model-invoked); they are different surfaces that happen to
  share a stem, and the docs must state this rather than imply identity.

This **supersedes** the verb-context framing in `command-surface.md §6` (D-14)
and the frontmatter-name implication around `command-surface.md §1` insofar as
either suggested multi-word verbs or sub-verb command files; the clean-slate
tiered-palette intent of `command-clean-slate` is **carried forward unchanged**
— with its "colon-drop" framing corrected to colon-form `/guild:<verb>`
(prefix-drop) per the spike result above.

### D2 — Skills are de-listed (model-invoked, never `/`-typed)

Every Guild skill — meta / knowledge / core / fallback / specialist — is
**model-invoked**, NOT a user `/`-typed command. Each skill maps to a command,
to the lifecycle, or to a specialist. The canonical **command → owned-skills**
map:

| Command | Owned skill(s) (model-invoked) |
|---|---|
| `ideate` | `brainstorm`, `loop-clarify` |
| `plan` | `team-compose`, `plan`, `loop-plan-review`, `create-specialist` (gap auto-create only — see note) |
| `build` | `context-assemble`, `execute-plan`, `review`, `loop-implement`, `codex-review`, `dispatching-parallel-agents` |
| `qa` | `guild-quality` |
| `ops` | `guild-operations` |
| `learn` (NEW) | the `learn-*` family (D3) |
| `wiki` | `wiki-ingest`, `wiki-query`, `wiki-lint` |
| `evolve` | `evolve-skill`, `writing-skills` |
| `rollback` | `rollback-skill` |
| `audit` | `audit` |
| `fix` | `diagnose` |
| (auto-fired internals — no command) | `verify-done`, `reflect`, `decisions`, `principles` |

- **`create-specialist` stays INTERNAL.** It is never a user command; it is
  reached only via `plan`'s gap auto-create path (team-compose option A,
  `guild-plan.md §7.1`). Noted here so no one promotes it to the palette.
- The command↔skill name collisions (`plan`, `init`, `audit`) from D1 are the
  visible artifact of this de-listing: the same stem names a command **and** a
  model-invoked skill, and the two are distinct surfaces.

### D3 — `/guild:learn` (NEW) + the `auto_learn` trigger

A NEW `/guild:learn <map|graph|onboard|diff|explain>` command **owns ALL
understand-everything capabilities** (the codebase map, the deep knowledge
graph, onboarding guide, diff/change analysis, and file/module explanation).
It is one command file; the first positional selects the sub-verb (D1).

- **`/guild:init` stays cheap by default** — wiki + inventory (the brownfield
  cheap-scan CodebaseMap + architecture-map stub), exactly as today.
- **Init runs the FULL learn pipeline ONLY when** `defaults.auto_learn: true`
  (settings.json) **OR** a `--learn` flag is passed. The `--learn` flag **folds
  in today's `--deep-scan`** (one trigger name going forward).
- **One implementation, two triggers.** The full pipeline `init --learn` runs
  is the **same `learn-*` skills** `/guild:learn` invokes — there is no second
  codebase-understanding implementation.
- **New closed config key `defaults.auto_learn`** (bool, default `false`).
  **Precedence:** `CLI flag (--learn) > settings.json (defaults.auto_learn) >
  built-in default (false)` — consistent with the
  [config-surface](config-surface-settings-json.md) ladder.

### D4 — Full internalization (own it, zero dependency)

Every borrowed skill is **re-authored CLEAN-ROOM from the concept** (not edited
forks), so each is Guild-native in **name AND behavior**, with **zero runtime
or conceptual dependency** on `superpowers` or `understand-anything`.

- **Clean-room concept-borrowing is not a derivative work**, so:
  **REMOVE** the `LICENSE-attribution.md` files and the "forked from"
  blockquotes, and **claim Guild copyright** (optionally a courtesy
  "inspired by" line). Files to remove are enumerated under Implementation
  hand-off → `skill-author`.
- **FOLD the redundant superpowers review forks.** `request-review`,
  `receive-review`, and `verify-claim` are **folded into Guild-native `review`
  and `verify-done`** — no duplicate skills survive.
- **Eliminate the "fallback fork" tier framing.** The methodology skills
  (`tdd`, `systematic-debug`, `worktrees`, `finish-branch`) become **first-class
  Guild skills**, not a separate `skills/fallback/` "fork" tier. (`guild-plan.md
  §5`'s T4 "FORK / attribution preserved" framing is superseded.)
- **Wire learning + these skills into Guild's loops at all levels:** memory /
  recall (wiki + knowledge-links per
  [`guild-boundary-config-and-tracking`](guild-boundary-config-and-tracking.md)
  and CR-A in [`concept-integration`](concept-integration.md)),
  skill-evolution (`evolve` / shadow / flip-gate), and agent-evolution
  (`create-specialist` / DH-3).

**Borrowed → Guild-native rename / fold table** (the normative migration list
for `skill-author`):

| Borrowed source | Current Guild path | Action | Guild-native target | Attribution file to remove |
|---|---|---|---|---|
| `superpowers:test-driven-development` | `skills/fallback/tdd/` | re-author clean-room, promote out of fallback | `guild:tdd` (first-class) | `skills/fallback/tdd/LICENSE-attribution.md` |
| `superpowers:systematic-debugging` | `skills/fallback/systematic-debug/` | re-author clean-room, promote out of fallback | `guild:systematic-debug` (first-class) | `skills/fallback/systematic-debug/LICENSE-attribution.md` |
| `superpowers:using-git-worktrees` | `skills/fallback/worktrees/` | re-author clean-room, promote out of fallback | `guild:worktrees` (first-class) | `skills/fallback/worktrees/LICENSE-attribution.md` |
| `superpowers:finishing-a-branch` | `skills/fallback/finish-branch/` | re-author clean-room, promote out of fallback | `guild:finish-branch` (first-class) | `skills/fallback/finish-branch/LICENSE-attribution.md` |
| `superpowers:requesting-code-review` | `skills/fallback/request-review/` | **FOLD** into Guild-native review | `guild:review` (absorbs) | `skills/fallback/request-review/LICENSE-attribution.md` |
| `superpowers:receiving-code-review` | `skills/fallback/receive-review/` | **FOLD** into Guild-native review | `guild:review` (absorbs) | `skills/fallback/receive-review/LICENSE-attribution.md` |
| `superpowers:verifying-claims` | `skills/fallback/verify-claim/` | **FOLD** into Guild-native verify-done | `guild:verify-done` (absorbs) | `skills/fallback/verify-claim/LICENSE-attribution.md` |
| `understand-anything` engine | `skills/knowledge/understand-engine/` | re-author clean-room as the `learn-*` family (D3) | `guild:learn-map` / `learn-graph` / `learn-diff` / `learn-explain` | `skills/knowledge/understand-engine/LICENSE-attribution.md` |
| `understand-anything` onboarding | `skills/knowledge/understand-onboard/` | re-author clean-room as a `learn-*` member | `guild:learn-onboard` | `skills/knowledge/understand-onboard/LICENSE-attribution.md` |
| (superpowers parallel-dispatch concept) | `skills/meta/dispatching-parallel-agents/` | re-author clean-room (already meta) | `guild:dispatching-parallel-agents` | `skills/meta/dispatching-parallel-agents/LICENSE-attribution.md` |
| (superpowers writing-skills concept) | `skills/meta/writing-skills/` | re-author clean-room (already meta) | `guild:writing-skills` | `skills/meta/writing-skills/LICENSE-attribution.md` |

> The exact mapping of the five `learn` sub-verbs (`map|graph|onboard|diff|
> explain`) onto skill files (one skill per sub-verb vs. a shared engine skill
> with sub-verb routing) is a `skill-author` authoring choice, constrained only
> by D3's "one implementation, two triggers" rule. The table fixes the
> rename/fold *obligations*, not the file granularity.

### D5 — Dispatch ladder (supersedes the §7.3 subagent-default)

A NEW settings key **`agent_mode: team | agent | subagent | auto`** (default
`auto`) governs execution backend, **superseding the binary `defaults.agent_team`**
and resolving the `guild-plan.md §7.3` ↔ `plugin/CLAUDE.md` contradiction.

At run-start intake, `runStartPreflight` resolves `agent_mode` from the 7-source
settings chain and freezes it in the resolved-settings snapshot
(`snapshot.effective.agent_mode`); phases read the frozen value and do not
re-resolve. **If `auto`, resolve in order:**

1. **Inside tmux** (`$TMUX` set) → **TEAM** in-session (new window in the
   current session, per the shipped in-session fix in
   `scripts/agent-team-launcher.ts`).
2. **tmux installed** (but not currently inside one) → **TEAM** in a new
   detached session.
3. **No tmux, but the host (`claude` | `codex`) supports independent agents
   from the main session** → **AGENT** (independent, no tmux).
4. **Else** → **SUBAGENT** (fallback).

**Independent and team agents are PRIMARY; subagent is the documented last
resort.** An explicit `agent_mode` value other than `auto` pins the backend
(subject to availability — pinning `team` on a tmux-less host is rejected /
warned, owner: `tooling-engineer`).

This **supersedes `guild-plan.md §7.3`**'s "subagents remain the production
default" rule and the §7.3 backend-default table's `Default? = Yes` on the
subagent row. The §7.3 **hard invariants are preserved**: one team per session;
collision-refuse (window or session name) rather than clobber; the
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` pre-flight env gate stays in force for
team spawn. **Ripple surfaces** that must change in lockstep: `execute-plan`
(reads `agent_mode`, no longer assumes subagent), `team-compose` (backend
choice now reads the ladder, not a binary), the `dispatching-parallel-agents`
skill, `agent-team-launcher.ts` gating, and `CLAUDE.md` (the "Backend default —
agent-team when tmux is available" section is **replaced** by the ladder; the
contradiction is resolved in favor of this ladder).

## Settings schema deltas

Two **new closed keys** under the `defaults:` block (closed-key reject rules
from [config-surface](config-surface-settings-json.md) apply — unknown keys
rejected, this is human-authored config):

| Key | Type | Default | Meaning | Precedence |
|---|---|---|---|---|
| `defaults.auto_learn` | bool | `false` | When true, `/guild:init` runs the full `learn-*` pipeline at bootstrap. | `--learn` CLI flag > `settings.json` > built-in(false) |
| `agent_mode` | enum `team\|agent\|subagent\|auto` | `auto` | Execution-backend selection / dispatch-ladder mode (D5). | CLI flag (if added) > `settings.json` > built-in(auto) |

**`agent_mode` replaces `defaults.agent_team`** (the old binary): the boolean
"agent-team yes/no" collapses into the four-valued ladder. Migration mapping:
`agent_team: true → agent_mode: team`; `agent_team: false → agent_mode:
subagent`; absent → `agent_mode: auto`. **`defaults.agent_team` is
hard-removed in v2.0 (this release)**: rejected as an unknown key by
`--validate`, stripped by resolve mode, and the `.guild/config.yml` runtime
reader is gone. There is no warn-once window — migrate via `/guild:migrate`.

`read-guild-config.ts` remains the single source of truth for the schema,
defaults, scaffold `_help` text, and reject rules for both new keys.

## Rationale

- **D1** records a hard mechanical constraint of Claude Code (flat tokens,
  reserved `:`, filename-derived tokens) — not a preference; the surface must
  match the platform or commands silently fail to register.
- **D2** is the honest statement of what already ships: skills are
  model-invoked. Writing the command→skill map down kills the recurring "is
  `plan` a command or a skill?" confusion and makes the `plan`/`init`/`audit`
  collisions intentional rather than accidental.
- **D3** keeps Init cheap (the operator's standing preference — bootstrap must
  be fast) while giving "understand everything" a real home and a single
  implementation, gated two ways.
- **D4** delivers the operator's "own it, zero dependency" mandate: clean-room
  concept-borrowing removes the legal-attribution surface and the conceptual
  dependency in one move, and folding the duplicate review/verify forks removes
  drift between three near-identical skills.
- **D5** resolves a checked-in contradiction (two defaults) with a single
  deterministic ladder that makes the strongest available backend primary and
  documents subagent as the fallback — matching how the operator actually runs
  Guild (tmux present → teams).

## Consequences

- `command-surface.md §1`/`§6` carry supersession banners pointing here for the
  flat-token correction and the de-listed command→skill map; the tiered-palette
  intent is otherwise unchanged (the grammar is colon-form `/guild:<verb>` — the
  `:` namespace is retained, per the spike).
- `guild-plan.md §5` (T4 fork/attribution framing) and `§7.3` (subagent
  default) are superseded; `guild-plan.md` stays the frozen v1 record and gains
  conceptual `supersedes:` pointers (recorded in prose only — this ADR does not
  edit `guild-plan.md`).
- `plugin/CLAUDE.md`'s "Backend default — agent-team when tmux is available"
  section is replaced by the D5 ladder (owner: `docs-writer`).
- `MIGRATION.md` documents: `--deep-scan → --learn`; `agent_team → agent_mode`;
  the new `/guild:learn` command; the de-listing clarification; the removal
  of the attribution files (no user-facing behavior change); and the removal
  of `--codex-review` (replaced by `--review=cross`).
- The 6 sunset redirect stubs are **deleted in v2.0 (this release)**; there is
  no v2.1 deprecation window. The `migrate` maintenance verb is added (v2.0).
- No frozen `guild.*.v1` field contract changes — this is plugin command/skill/
  config surface, not a versioned schema sibling.
- **VERIFICATION CLOSED (D1, bare `/guild`)** — the spike resolved it: a bare
  `/guild` is not a command, the entry is `/guild:guild`, and the surface is
  colon-form `/guild:<verb>` (the `:` namespace is retained; v2 drops only the
  redundant `guild-` prefix). No open items remain before the surface is frozen.

## Implementation hand-off

This ADR is a decision record. The implementation is owned per dev-team agent
(route by `plugin/CLAUDE.md` Dev-team table):

| Owner (`subagent_type`) | Scope from this ADR |
|---|---|
| `command-builder` | Command files / palette / sub-verb argument routing (D1, D2); the NEW `/guild:learn` command file and `--learn` flag wiring (D3); remove `name:`-with-spaces frontmatter and resolve filename↔token (D1); the **bare-`/guild` spike (D1, now resolved — see the D1 verification result)**. *(superseded: this row originally said "keep the 6 sunset stubs"; cleanup-consolidation **deleted all 7 removed v1 command files in v2.0** — the 6 redirect stubs (`guild-wiki/evolve/rollback/stats/audit/diagnose`) + `guild-team` (removed outright) — with no v2.1 sunset window.)* |
| `skill-author` | Clean-room re-author + rename/fold per the D4 table; remove the enumerated `LICENSE-attribution.md` files + "forked from" blockquotes + claim Guild copyright; author the `learn-*` family as one implementation (D3); fold `request-review`/`receive-review`/`verify-claim` into `review`/`verify-done` (D4); wire into memory/recall + evolve + create-specialist loops. |
| `tooling-engineer` | `read-guild-config.ts` — add closed keys `defaults.auto_learn` + `agent_mode`, scaffold `_help` + reject rules (Settings deltas); `agent-team-launcher.ts` — implement the D5 ladder, pin/availability checks, preserve one-team-per-session + collision-refuse + the experimental env gate. *(superseded: this row originally said "deprecate-alias `defaults.agent_team`"; cleanup-consolidation **removed the alias in v2.0** — `defaults.agent_team` is now REJECTED as an unknown key by `--validate` and stripped in resolve mode; there is no warn-once alias, and backend selection is the Tier-1 `agent_mode` key.)* |
| `specialist-agent-writer` | Any agent-definition touch arising from D4's create-specialist/DH-3 wiring (agent-evolution hooks); no command/skill edits. |
| `docs-writer` | `CLAUDE.md` (replace the agent-team-default section with the D5 ladder; add the command→skill map note) and `MIGRATION.md` (`--deep-scan→--learn`, `agent_team→agent_mode`, `/guild:learn`, attribution-file removal). |

## Supersedes

- `command-surface.md §6` (D-14) — the verb-context framing, corrected to
  flat-token / sub-verbs-as-arguments. The map's phase→verb edges stand.
- `command-surface.md §1` — only the implication that a command verb could be
  multi-word or that sub-verbs are separate command files, **and** the
  "no-colon / space grammar" ruling (#1), which the spike corrected: the
  grammar is colon-form `/guild:<verb>` (the `:` namespace is retained; v2 drops
  the redundant `guild-` prefix). The clean-slate tiered-palette intent stands.
- `guild-plan.md §5` — the T4 "FORK / MIT attribution preserved" fallback-tier
  framing (D4).
- `guild-plan.md §7.3` — "subagents remain the production default"; the §7.3
  hard invariants (one-team-per-session, collision-refuse, the experimental env
  gate) are carried forward.
- `defaults.agent_team` (binary) — replaced by `agent_mode` (D5).

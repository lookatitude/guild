---
name: guild
description: "Bare Guild entry — smart phase detection. /guild:guild [brief] inspects .guild/ state and surfaces the proposed lifecycle phase (init · ideate · plan · build · qa · ops), always confirmed never silent. Named phase verbs, nouns (wiki, initiative), and maintenance verbs (evolve, rollback, stats, audit, fix) are separate commands. Canonical: architecture/command-surface.md §1/§5.1; v1→v2: MIGRATION.md."
argument-hint: "[brief] [--rigor=quick|standard|deep] [--auto-approve[=spec,plan,build,all]] [--review=local|cross|off] [--host=claude|codex|auto] [--initiative=<id>|new] [--dry-run]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:guild — bare entry (smart phase detection)

`/guild:guild [brief]` with no phase verb runs **phase detection** — an
orchestrator behavior (not a skill) that inspects `.guild/` state for the
active slug and **surfaces the proposed next phase, always confirmed, never
silent** (`architecture/command-surface.md §5.1`). Named phases
(`/guild:init|ideate|plan|build|qa|ops`), nouns (`/guild:wiki`,
`/guild:initiative`), and maintenance verbs
(`/guild:evolve|rollback|stats|audit|fix`) are their own commands; this file
only does detection + delegation. No lifecycle logic is re-spelled here —
each phase command owns its phase; all state lives in `.guild/`.

```
/guild:guild "build a REST API for user auth"   ← detect + propose a phase
/guild:guild                                     ← detect from .guild/ state alone
```

## Phase detection (the §5.1 table)

Inspect `.guild/` for the active slug and propose exactly one phase:

| Detected state | Proposed phase |
|---|---|
| no `.guild/wiki/` or no `.guild/init/<slug>.md` | `init` |
| init exists, no `.guild/spec/<slug>.md` | `ideate` |
| spec exists, no approved `.guild/plan/<slug>.md` | `plan` |
| plan approved, run not complete | `build` |
| build complete, no `.guild/runs/<run-id>/quality/<run-id>.md` | `qa` (surfaced as an option, never silently skipped) |
| explicit ops phrasing ("incident", "rollback", "monitor") | `ops` |

**Determinism caveat.** The deterministic CI/script contract is the
**explicit phase verb** (`/guild:qa`, `/guild:ops`, …) — those resolve from
artifact presence alone with no NL inference. The natural-language cues
(last two rows) are a convenience layer only: they **always surface and
confirm** the proposed phase and never override an explicit verb. Scripts
and CI must name the phase explicitly.

**Quality is never silently skipped.** When `build` receipts exist and
`.guild/runs/<run-id>/quality/<run-id>.md` is absent, bare `/guild:guild`
**surfaces `/guild:qa` as the proposed next phase** (confirm / pick-phase /
explain) — Quality stays opt-in but is always offered, never bypassed.

## Surfaced confirmation (never silent)

Detection is always surfaced and gated:

```
Detected: spec exists and is approved; no approved plan.
Proposed phase → /guild:plan
Brief carried forward: "add OAuth login"
Proceed? [proceed / pick-phase / explain]
```

- **proceed** — delegate to the proposed phase command (e.g. invoke
  `/guild:plan`'s contract).
- **pick-phase** — list the canonical phase verbs and run the chosen one.
- **explain** — print which `.guild/` artifacts drove the detection, then
  re-prompt.

Resumption is the same mechanism: the first absent artifact in the table
order is the resume point. Restart is `/guild:resume --restart` (the v1
`--restart` first-word positional is removed).

## Flags

The five surviving global flags (`command-surface.md §4.2`):
`--rigor=quick|standard|deep` (the profile knob — expands loops/caps/review
depth per §4.3), `--auto-approve[=spec,plan,build,all]` (opt-in autonomy;
destructive/network/spend STILL ask even with `all`), `--review=local|cross|off`,
`--host=claude|codex|auto`, `--initiative=<id>|new`, plus universal
`--dry-run`. Resolution precedence: **CLI flag > `--rigor` profile >
`.guild/settings.json` `defaults:` > built-in default**
(`command-surface.md §4.3`/§4.4).

**Deleted tuning flags (v1 → v2).** `--loops`, `--loop-cap`, `--codex-cap`
are **removed from the CLI** — folded into `--rigor` profiles and still
power-user-configurable in `.guild/settings.json` (`loops:`/`loop_cap:`/
`codex_cap:` keys). `--codex-review` is **replaced** by `--review=cross`.
A user never types `--loops` again — they type one of three `--rigor`
words. The full v1→v2 flag map is `MIGRATION.md §3`; the closed-key
`defaults:` config schema is `command-surface.md §4.4` (cited, not
re-spelled).

---

## Non-interactive / CI behaviour (OQ11)

This contract wires the OQ11 non-interactive hard-fail into the bare-`/guild:guild`
entry path (`decisions/command-clean-slate.md #7`; `MIGRATION.md §7` CI
ergonomics note; `architecture/command-surface.md §5.1`/§5.4). It introduces
**no new gate** — it reuses the existing gate machinery's non-interactive
branch.

**Trigger (all of):** an interactive gate is reached **AND** the context is
non-interactive (CI / no TTY) **AND** no `--auto-approve=` covers that gate
**AND** no explicit named phase verb was given (this bare `/guild:guild` NL-detect
path).

**Behaviour:** Guild **HARD-FAILS — exits non-zero — with the actionable
message below. It NEVER implicitly grants autonomy** (never silently
proceeds, never auto-satisfies a soft gate; the hard-fail happens *before*
any gated action). The deterministic CI contract is the **explicit-verb
path**, not bare-`/guild:guild` NL detection (`command-surface.md §5.1`: scripts
and CI must name the phase explicitly). The always-ask hard set
(destructive / network / spend) is orthogonal and never relaxed by this path
or by `--auto-approve`.

Actionable message (printed, then exit non-zero):

```
error: interactive gate '<gate>' reached in a non-interactive context
       (no TTY) with no --auto-approve covering it and no explicit phase verb.

Guild will not implicitly grant autonomy. Fix — name the phase and
pre-approve the soft gate explicitly, e.g.:

  /guild:build --auto-approve=spec,plan,build
  /guild:qa
  /guild:ops <runbook>

(bare /guild:guild NL phase-detection is interactive by design and is never the
 deterministic CI contract — command-surface.md §5.1.)

exit: non-zero  ·  no gate auto-satisfied  ·  no gated action taken
```

The runtime negative-trace tests for this behaviour (hard-fail trace +
no-implicit-grant trace) are registered to the P7C deferred-runtime-test
register, owner `P7C-gate-001` (`phases/P0-oq11-noninteractive.md §4`).

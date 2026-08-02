---
name: guild
description: "Bare Guild entry — smart phase detection. /guild:guild [brief] inspects .guild/ state and surfaces the proposed lifecycle phase (init · ideate · plan · build · qa · ops), always confirmed never silent. Named phase verbs, nouns (wiki, initiative), maintenance verbs (evolve, rollback, stats, audit, fix), and observability (dashboard) are separate commands. v1→v2: https://guildstack.dev/docs/migration-v1-to-v2"
argument-hint: "[brief] [--rigor=quick|standard|deep] [--auto-approve[=spec,plan,build,qa,all]] [--review=local|cross|off] [--host=claude|codex|auto] [--initiative=<id>|new] [--model-tier=cheap|mid|powerful] [--dry-run]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:guild — bare entry (smart phase detection)

`/guild:guild [brief]` with no phase verb runs **phase detection** — an
orchestrator behavior (not a skill) that inspects `.guild/` state for the
active slug and **surfaces the proposed next phase, always confirmed, never
silent**. Named phases
(`/guild:init|ideate|plan|build|qa|ops`), nouns (`/guild:wiki`,
`/guild:initiative`), maintenance verbs
(`/guild:evolve|rollback|stats|audit|fix`), and the observability surface
(`/guild:dashboard` — the local runs/knowledge web dashboard, WI-3) are
their own commands; this file only does detection + delegation. No lifecycle logic is re-spelled here —
each phase command owns its phase; all state lives in `.guild/`.

```
/guild:guild "build a REST API for user auth"   ← detect + propose a phase
/guild:guild                                     ← detect from .guild/ state alone
```

## Run-start preflight (settings-control-and-tmux U3/U6)

Before run-trace start — and before any `.guild/` state inspection — the
run-trace CLI runs the preflight for you. This is the phase-wide intake step for
every `/guild:*` lifecycle command (briefing §10;
`scripts/lib/runstart-preflight.ts`).

Since wave 2, `run-trace.js start` is the **sole caller** of
`runStartPreflight` — no command calls it itself. On `start` the CLI:

1. **Resolves settings** by walking the full 7-source inheritance chain:
   `builtin < workspace < workspace-local < project < project-local < rigor < CLI`
   (the exact `Source` enum values; `rigor` is the `--rigor` profile-expansion
   step between project-local and CLI) and validates closed keys.
2. **Resolves the backend deterministically** (tmux probe + provider detection);
   the interactive tmux-persist prompt (OD-3) is handled at config time, not
   per command — a run inherits the effective `agent_mode` without prompting.
3. **Writes the snapshot** — `.guild/runs/<id>/resolved-settings.json` + a
   compact `settings_ref` in `run.yaml` (`resolved_at_ref` stamped to the
   run-id at write time) — before the run opens.

All later phases read the snapshot via `readResolvedSettingsSnapshot(runId,
{ cwd })` rather than re-resolving. In this workspace, root `agent_mode:
"team"` is inherited by all child projects, so tmux never needs prompting on a
child run.

## Run recording

Before reading `.guild/` state, start a run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js start \
  --command=/guild:guild \
  --cwd "$(pwd)"
# If --initiative=<id> was supplied by the user, add: --initiative=<id>
```

`run-class` default (`full`). The run is recorded before detection so the
complete session — including the phase-detection decision and any user
gates — is replayable from the entrypoint. `--initiative` is forwarded only
when the user supplied it explicitly; it is never synthesised (NN#5).

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

## Team decision gate (blocking — team-contracts §4/§5)

`/guild:guild` routes; it never dispatches on its own. The phase command it
delegates to owns the gate, and that gate is **not optional**: before any
phase dispatches a participant — worker, advisor, challenger, or local /
cross-host reviewer — a PERSISTED `guild.team_decision.v1` approve must
authorize it (`scripts/team-decide.ts gate`, non-zero exit ⇒ stop). Guild
never auto-approves, `--auto-approve` does not cover team approval, and a
stale or hash-mismatched decision fails closed and needs renewed user
approval. See the delegated phase command's *Team decision gate* section.

## Flags

The five surviving global flags:
`--rigor=quick|standard|deep` (the profile knob — expands loops/caps/review
depth), `--auto-approve[=spec,plan,build,qa,all]` (opt-in autonomy; `qa` auto-passes a RELEASE-READY verdict only;
destructive/network/spend STILL ask even with `all`), `--review=local|cross|off`,
`--host=claude|codex|auto`, `--initiative=<id>|new`, plus universal
`--dry-run`. Resolution precedence (full 7-source chain, lowest to highest):
`builtin < workspace < workspace-local < project < project-local < rigor < CLI`
(`config.md` inheritance chain; `rigor` is the `--rigor` profile expansion
step between project-local and CLI).

**`--model-tier=cheap|mid|powerful`** — top-precedence tiering override.
Forces every specialist lane dispatched in this run to the given model tier,
overriding per-lane `model_tier:` plan entries and the `settings.json
models:` block. Precedence: `--model-tier` > per-lane plan override >
`models:` block > built-in default. Tiering is orthogonal to the
`agent_mode` backend ladder — they compose, never replace each other. Full
tier semantics: `docs/v2/config-surfaces.html §5`. Ref: DRIFT-ANALYSIS
CMD-008.

**Tuning flags (v1 → v2).** `--loops`, `--loop-cap`, `--codex-cap` are
**retained** — the CLI still accepts all three (the arg-parse switch in
`read-guild-config.ts` handles their `--loops`/`--loop-cap`/`--codex-cap`
cases), and they're also settable in `.guild/settings.json`
(`loops:`/`loop_cap:`/`codex_cap:` keys) as the persistent form. The
`--rigor` profiles set all three in bulk, so most users reach for one of
three `--rigor` words instead of the individual flags. The v1 per-host
review flag is **replaced** by `--review=cross`. Full v1→v2 flag map:
[https://guildstack.dev/docs/migration-v1-to-v2](https://guildstack.dev/docs/migration-v1-to-v2).
The closed-key `defaults:` config schema is in `/guild:config` and
`https://guildstack.dev/docs/configuration`.

---

## Non-interactive / CI behaviour (OQ11)

This contract wires the OQ11 non-interactive hard-fail into the bare-`/guild:guild`
entry path (`decisions/command-clean-slate.md #7`). It introduces **no new
gate** — it reuses the existing gate machinery's non-interactive branch, and the
predicate itself is **deterministic code**, not model prose: whenever an
interactive gate is about to be reached in this bare-entry path, run

```
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/oq11-gate-check.ts \
  --gate=<gate> [--interactive|--non-interactive] \
  [--auto-approve=<gate,gate,...>|all] [--named-phase]
```

(same invocation pattern as the run-start preflight's `config-cmd.ts` call above).
The CLI prints a `{hard_fail, exit_code, autonomy_granted}` JSON result on stdout;
when `hard_fail` is true it also prints the actionable message below to stderr and
exits non-zero. **Trust the CLI's verdict — never re-derive the predicate in
prose.** Its trigger (all of: an interactive gate is reached, the context is
non-interactive, no `--auto-approve=` covers that gate, no explicit named phase
verb was given — this bare `/guild:guild` NL-detect path) and its
`autonomy_granted` output are the single source of truth for whether this path may
proceed.

**Behaviour on hard-fail:** Guild **HARD-FAILS — exits non-zero — with the
actionable message below. It NEVER implicitly grants autonomy** (never silently
proceeds, never auto-satisfies a soft gate; the hard-fail happens *before*
any gated action). The deterministic CI contract is the **explicit-verb
path**, not bare-`/guild:guild` NL detection (`command-surface.md §5.1`: scripts
and CI must name the phase explicitly). The always-ask hard set
(destructive / network / spend) is orthogonal and never relaxed by this path
or by `--auto-approve`.

Actionable message (CLI-emitted, then exit non-zero):

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

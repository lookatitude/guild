---
name: guild-initiative
description: Implements every /guild:initiative sub-verb — new|status|list|resume|update|archive|restore|close — over .guild/initiatives/{active,archived}/<id>/**. new authors initiative.yaml + the definition ledger behind the definition-ready gate; status/list are read-only; resume re-enters the next work item; update amends the ledger (--add-goal); archive/restore move active/<->archived without the release path; close is gated by the deterministic D8 gate — it MUST run scripts/initiative-gate.ts close-check and refuse to close on a non-zero exit, never re-deriving release/docs/exec resolution in prose. TRIGGER for "/guild:initiative new|status|list|resume|update|archive|restore|close", "create a durable initiative", "attach this to an initiative", "is this initiative ready to close", "what work items are open". DO NOT TRIGGER for a one-off /guild:guild run (opt-in attachment only), phase-command work (guild:plan, guild:execute-plan), decision capture (guild:decisions), or wiki ingestion (guild:wiki-ingest).
when_to_use: Invoked by commands/initiative.md's Dispatch section for every /guild:initiative invocation, after the run-start preflight and run recording have completed. Also the target of the opt-in attachment prompt /guild:guild raises when a brief carries a durable-goal signal.
type: meta
---

# guild:initiative

Implements the full `/guild:initiative` sub-verb surface — the opt-in
durable-goal container (commands/initiative.md). `new|status|resume|update|close`
are the primary user-facing lifecycle sub-verbs; `list|archive|restore` are
operational sub-verbs on the same noun. All `.guild/initiatives/**` reads and
writes live here — the command entrypoint is a thin dispatcher.

Canonical schema + gate references: `docs/v2/initiatives.html` §Registry &
directory, §Definition ledger, §The D8 close gate. Field-level contracts:
`scripts/lib/initiative.ts` (`guild.initiative.v1` validator, the four status
axes, `deriveInitiativeStatus`, the definition ledger, `d8CloseGate`),
`scripts/lib/initiative-workitems.ts` (`WorkItem` + `populateReleaseDocsWorkItems`),
`scripts/lib/initiative-activity.ts` (`guild.initiative_activity.v1` append log).

## Directory shape

```
.guild/initiatives/
├── registry.yaml
├── active/<id>/
│   ├── initiative.yaml        # guild.initiative.v1 — id, title, the 4 status axes, goal, evidence
│   ├── definition-ledger.md   # DefinitionItem rows (goal/outcome/scope/non_goal/acceptance/constraint/risk/assumption/open_question)
│   ├── activity.jsonl         # guild.initiative_activity.v1, one row per event (initiative-activity.ts appendActivity)
│   ├── work-items/            # WorkItem rows (initiative-workitems.ts)
│   └── release/, docs/        # release evidence + docs-sync reconciliation records (D8 legs)
└── archived/<id>/             # same shape; a closed OR operationally-archived initiative
```

## Sub-verbs

| Sub-verb | Drives | Gate | Output |
|---|---|---|---|
| `new` | create a durable goal container | definition-ready gate **I** | `active/<id>/initiative.yaml`, `definition-ledger.md` |
| `status` | read progress / work-items / release / doc-sync | **R** (read-only) | prints derived state |
| `list` | list active initiatives (default) w/ cross-cut rollup; `--archived` shows all | **R** (read-only) | prints state |
| `resume` | re-enter at the next open work-item | next gate **I** | continues initiative runs |
| `update` | amend the definition-ledger (`--add-goal "…"`) | ledger-change confirm **I** | updated ledger |
| `archive` | move `active/<id>/` → `archived/<id>/`, operational (no close-gate release path) | archive confirm **I** | dir move |
| `restore` | move `archived/<id>/` → `active/<id>/`, operational | restore confirm **I** | dir move |
| `close` | requires the D8 close gate (release evidence + doc-sync reconciliation) | release-readiness + doc-sync gate **I** | `active/<id>/` → `archived/<id>/` |

## `new` — create + the definition-ready gate

1. Resolve `<id>` (explicit arg, or slugify the supplied title). Refuse if
   `active/<id>/` or `archived/<id>/` already exists.
2. Write `active/<id>/initiative.yaml` (`guild.initiative.v1` shape —
   `validateInitiativeManifest` from `scripts/lib/initiative.ts` MUST pass
   before the file is considered written) with `definition_status: incomplete`
   until the ledger below says otherwise.
3. Draft `definition-ledger.md` `DefinitionItem` rows for the seven planning-
   contract fields (goal, outcome, scope, non_goal, acceptance, constraint,
   risk) plus any open assumptions — reuse `guild:brainstorm`'s Socratic
   question flow when the brief is thin rather than inventing answers.
4. **Definition-ready gate (I):** an initiative may not proceed past `new`
   while `blockingUnresolved(items)` (scripts/lib/initiative.ts) is non-empty
   — i.e. any `blocking: true` item still `needs_definition`. Surface each
   blocking item as a question; do not silently mark it `assumed`.
5. Append a `created` row to `activity.jsonl` via `appendActivity`
   (`initiative-activity.ts`) — never hand-roll the JSONL line.

## `status` / `list` — read-only

Both sub-verbs are **R** (no writes). Read `initiative.yaml`,
`definition-ledger.md`, `work-items/`, and `activity.jsonl`; call
`deriveInitiativeStatus(axes, facts)` (never hand-derive the human-facing
status from the four axes in prose) to print the furthest-progressed
`DerivedStatus`. `list` defaults to `active/` only; `--archived` includes
`archived/` too. `status` additionally prints the D8 leg summary — invoke
`initiative-gate.ts close-check` (§Close, below) even outside a close attempt
so `status` shows exactly which leg(s) block close today.

For `list`'s cross-cut rollup (which run(s) touched each initiative), delegate
to `scripts/registry-rollup.ts` — the deterministic projection of
`initiatives/{active,archived}/*/initiative.yaml` + `runs/**/provenance.json`
(never hand-derive `run_ids`/`last_run_id` from a manual runs/ walk):

```
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/registry-rollup.ts \
  --guild-dir <cwd>/.guild --json
```

Read `run_ids`/`last_run_id` per initiative from its JSON `initiatives[]` output
for the rollup column; this call is **read-only** (`--json`, no `--write`), so it
stays inside `list`'s **R** contract — it does not persist
`.guild/indexes/initiatives-registry.yaml` as a side effect of a status/list
query. (An explicit `--write` run of the same CLI is available as a standalone
maintenance step for operators who want the derived index cached to disk; that
is not part of this sub-verb.)

## `resume`

Read `work-items/` for the lowest-id item whose `status` is `ready` or
`in_progress` with all `depends_on` `done`; hand off to `guild:execute-plan`
for that item's scope. Gate **I** at the next work-item boundary (confirm
before re-entering, in case the operator wants to redirect first).

## `update`

`--add-goal "…"` appends a new `DefinitionItem` (`category: goal`) to the
ledger via the same validated-append path as `new`; re-run
`deriveInitiativeStatus` afterward since a fresh unresolved blocking item can
move `ready` back to `defining`. Gate **I** (confirm the ledger change before
writing).

## `archive` / `restore`

Pure directory moves (`active/<id>/` ⇄ `archived/<id>/`) — **operational**,
they do **not** run the D8 close gate and do **not** touch `release_status`/
`documentation_status`. Use `close` (below) for the gated release path;
`archive` is for shelving an initiative without claiming it shipped. Append
an `archived` / a `note` row to `activity.jsonl` recording which path was
used. Gate **I** (confirm before the move — it changes where `status`/`list`
look by default).

## `close` — the D8 close gate (deterministic, never re-derived in prose)

**This is the fix for the 2026-07-12 audit finding (G3):** `close` previously
had no reachable implementation of the D8 gate. It now MUST invoke the
deterministic CLI and consume its verdict — the same discipline
`guild:review-broker` applies to its 5-condition gate-pass check.

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/initiative-gate.ts close-check \
  --initiative <id> \
  --root "$(pwd)" \
  --exec-verified=<true only after confirming verify.md PASS for every contributing run>
```

The script reads `active|archived/<id>/initiative.yaml`, maps the three D8
axes (mapping known legacy manifest spellings onto the frozen enum — see the
script's own header — and treating anything unrecognized as **unresolved**,
never guessed toward "resolved"), calls the real `d8CloseGate`
(`scripts/lib/initiative.ts` — this skill NEVER re-implements the three-leg
check), and prints `{ pass, result: { canClose, legs, blockers }, warnings }`
to stdout. **Exit 0 = pass, exit 1 = fail (unmet criteria), exit 2 = usage/
read error.**

**Refuse to close on any non-zero exit.** On exit `1`, do not move
`active/<id>/` → `archived/<id>/` — instead:

1. Print `result.blockers` to the operator verbatim (do not paraphrase which
   leg failed).
2. Run the companion sub-command to populate the concrete work the operator
   still owes:

   ```bash
   npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/initiative-gate.ts docs-workitems \
     --initiative <id> --root "$(pwd)" --exec-verified=<same value as above>
   ```

   This calls the real `populateReleaseDocsWorkItems` and prints the
   release/docs `WorkItem[]` still needed to clear D8 (empty when both legs
   are already resolved). Write any returned items into `work-items/` (each
   validated with `validateWorkItem` before it is persisted) rather than
   inventing acceptance criteria by hand.
3. Leave the initiative in `active/` and append a `note` activity row citing
   the blockers.

On exit `0`, proceed with the close: move `active/<id>/` → `archived/<id>/`,
append a `closed` activity row, and record the release evidence refs already
present in `initiative.yaml`. On exit `2` (a usage/manifest-read error — e.g.
no `initiative.yaml` found for `<id>`), treat it as a hard stop and surface
the stderr message; do not attempt to interpret a read failure as either a
pass or a fail.

**`--exec-verified` is supplied by the caller, never invented.** The gate
function's own contract (`d8CloseGate`'s doc comment) is explicit: "the
sub-verb supplies the run evidence." Before passing `--exec-verified=true`,
independently confirm `verify.md` PASS for every run this initiative's
`execution_status: done` claims contributed — the same verify-the-claim
discipline `guild:verify-done` applies before any completion language.

## Opt-in attachment binding

A one-off `/guild:guild` run does **not** create an initiative. Attachment is
explicit only: (a) the user runs `/guild:initiative …` directly, (b)
`--initiative=<id|new>` is passed to a phase command, or (c) the brief carries
a durable-goal signal — in which case `/guild:guild` *asks* "attach to an
initiative? [new / existing / one-off]" rather than auto-attaching.

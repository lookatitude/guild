---
name: learn
description: "Understand-everything — smart full learn-all when no sub-verb is given (detects target shape, starts a run, runs the full learn pipeline, updates indexes, emits knowledge candidates, leaves replayable evidence). With a sub-verb: map (CodebaseMap + architecture overview), graph (deep KnowledgeGraph), onboard (guided tour), diff (change analysis), explain (file/module deep-dive). One command, one implementation — same learn-* skills as init --learn. Dispatches to guild:learn (no-arg smart mode) or guild:learn-map / learn-graph / learn-onboard / learn-diff / learn-explain."
argument-hint: "[map|graph|onboard|diff|explain] [target] [--rigor=quick|standard|deep]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:learn — understand-everything

<!-- §13.1 ADR row: D3 — NEW command, owns understand-everything. Sub-verbs are
     positional ARGUMENTS (D1); never separate files or namespaces. Same learn-*
     skills as `/guild:init --learn` — one implementation, two triggers.
     learn-knowledge-convergence SC-A: no-arg form → smart full learn-all, NOT
     usage-stop. Mirrors /guild:guild §5.1 surfaced-confirm pattern. -->

The single entry-point for **all codebase-understanding capabilities**. A thin
dispatcher over the `learn-*` skill family (`guild:learn-map`, `learn-graph`,
`learn-onboard`, `learn-diff`, `learn-explain`) AND the smart full learn-all path.

**One implementation, two triggers (D3):** the pipeline this command runs is
byte-identical to what `/guild:init --learn` and `defaults.auto_learn: true`
invoke. There is no separate codebase-understanding engine.

Sub-verbs are positional ARGUMENTS (D3 — one implementation, two triggers).
Full command reference: [https://guildstack.dev/docs](https://guildstack.dev/docs).

---

## Usage

```
/guild:learn                              smart full learn-all (detect + confirm + pipeline)
/guild:learn map                          CodebaseMap + architecture overview only
/guild:learn graph                        Deep semantic KnowledgeGraph only
/guild:learn graph --rigor=deep           Deep graph, highest fidelity
/guild:learn knowledge                    Deep multi-modal knowledge tier (topics + wiki/diagram index + cross-modal links)
/guild:learn onboard                      Guided architecture tour only
/guild:learn diff                         Change analysis vs HEAD only
/guild:learn diff src/auth/               Change analysis scoped to path
/guild:learn explain src/billing/invoice.ts
/guild:learn explain "how does the auth flow work"
```

All five global flags + `--dry-run` apply. `--rigor=deep` runs the highest-fidelity graph/analysis pass.

---

## No-arg form — smart full learn-all

`/guild:learn` with no sub-verb triggers the **smart full learn-all path**.
This is the core correction from the brief (learn-knowledge-convergence §"Core
Correction"): absent arguments mean "learn this workspace or project completely,"
NOT "missing argument, print usage, stop."

### What the no-arg form does

1. **Start a run** (SC-B, §435) — before detection or any scanning:

   ```bash
   node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js start \
     --command=/guild:learn \
     --cwd "$(pwd)"
   ```

   Records command, args, cwd, host, workspace/project identity, tier policy,
   ignore and scan policy, and gates. No `--run-class` override (default
   `full`). No `--initiative` flag (learn runs are not initiative-attached by
   default; NN#5 — no `.guild/initiatives/` directory created).

2. **Detect target shape.** Classify the target into one of:
   - `regular_project`
   - `workspace`
   - `existing_guild_project`
   - `new_or_sparse_project`
   - `mixed_or_uncertain`

3. **Surface detection — always confirmed, never silent (§5.1 pattern).** Mirror the bare `/guild:guild` surfaced-confirm contract:

   ```
   Detected: existing_guild_project — .guild/ present, wiki populated.
   Proposed action → full learn-all (map → graph → onboard → knowledge candidates)
   Proceed? [proceed / pick-subverb / explain]
   ```

   - **proceed** — run the full learn pipeline.
   - **pick-subverb** — list the sub-verb options; run the one chosen.
   - **explain** — print which artifacts and heuristics drove the classification, then re-prompt.

   For `mixed_or_uncertain`, ask one targeted clarifying question before proceeding.

4. **Run the full learn pipeline.** Delegates to `guild:learn` skill in smart-learn mode (A1's skill logic). The pipeline order is:
   - cheap map (`guild:learn-map`)
   - deep graph (`guild:learn-graph`) — see cost gate below
   - domains / flows / components / labels derivation
   - `knowledge-links.json` build or refresh
   - onboarding tour (`guild:learn-onboard`)
   - durable knowledge candidates extraction
   - decision candidates, open questions, risks, standards, patterns, anti-patterns
   - derived indexes update
   - provenance write
   - learning checkpoint emission
   - reflection candidates emission
   - run close with replayable evidence

5. **Workspace vs regular project.** For `workspace`, the pipeline checks child repos first — it does NOT scan all sub-repos as one monolithic codebase. Workspace flow follows the brief §"Workspace Full Learn" contract (auto fan-out per OQ2, aggregate cost estimate surfaced before child scans, `--dry-run` prints the fan-out plan without scanning).

### Cost gate (OQ1 — no hidden cost non-negotiable)

Deep-graph on large repos surfaces a cost estimate and asks before running. It never auto-runs silently:

```
Deep graph estimated: ~N files, ~M tokens, ~$X at current tier.
Proceed with deep graph? [proceed / skip-graph / explain]
```

- **proceed** — run deep graph.
- **skip-graph** — run the rest of the pipeline without graph (graph can be run separately via `/guild:learn graph`).
- **explain** — show file/cost breakdown, then re-prompt.

---

## Sub-verbs (scoped, unchanged behavior)

| Sub-verb | What it does | Skill | Output artifact |
|---|---|---|---|
| `map` | CodebaseMap + architecture overview (cheap-scan tier; fast) | `guild:learn-map` | `.guild/indexes/codebase-map.json`, `wiki/concepts/architecture-map.md` |
| `graph` | Deep semantic KnowledgeGraph (full NLP/heuristic parse; slow) | `guild:learn-graph` | `.guild/indexes/knowledge-graph.json` |
| `knowledge` | Deep multi-modal knowledge tier (K1–K6): topic→subtopic taxonomy + classified/labeled `wiki_page` nodes + cross-modal `evidenced_by` edges (`guild.knowledge_graph.v2`); lazy + cost-gated, slow | `guild:learn-knowledge` | `.guild/indexes/knowledge-graph.json` (v2) + `.guild/indexes/knowledge-links.json` + `wiki/concepts/*` candidates |
| `onboard` | Guided 5–15 step learning tour through architecture + key concepts | `guild:learn-onboard` | `.guild/indexes/onboarding-tour.md` |
| `diff` | Change analysis — what changed, blast-radius, dependents impacted | `guild:learn-diff` | `.guild/runs/<run-id>/learn/diff-<ts>.md` |
| `explain` | Deep-dive explanation of a file, module, symbol, or concept | `guild:learn-explain` | printed explanation (no file by default) |

The `knowledge` tier consumes the structural `knowledge-graph.json` and enriches
it into `guild.knowledge_graph.v2` — topic taxonomy, classified `wiki_page` /
`diagram` nodes, and cross-modal `evidenced_by` edges. Architecture details:
[https://guildstack.dev/docs/architecture](https://guildstack.dev/docs/architecture).
Same one-implementation/two-triggers contract (D3): the tier runs identically
under `/guild:learn knowledge`, full `/guild:learn`, and `/guild:init --learn`.

---

## Args & local flags

- Args: `[map|graph|knowledge|onboard|diff|explain]` — **optional** first positional.
  - **Absent** → smart full learn-all (detection + confirmation + full pipeline). See above.
  - **Present** → scoped sub-verb; unknown value ⇒ print usage help, invoke no skill.
- `[target]` — optional second positional; interpreted by each skill:
  - `diff`: a path, commit ref, or branch (defaults to HEAD vs previous).
  - `explain`: a file path, symbol name, or free-text concept.
  - `map` / `graph` / `knowledge` / `onboard`: ignored (always whole-repo).
- Local flags: — (no sub-verb-specific local flags beyond global set)

---

## Gates

- **No-arg (smart full learn-all):** detection surface + confirmation **before** any scan (never silent, §5.1 pattern). Deep-graph cost estimate + confirm (OQ1 non-negotiable).
- `graph` sub-verb: cost estimate + confirmation **I** (deep graph is slow; surface estimated duration before starting, confirm or `[skip]`).
- `knowledge` sub-verb: lazy + cost-gated **I** (SC-15) — a **deterministic** cost gate (a tooling script the skill calls, not model-prose) fires **before** the deep knowledge pass: it surfaces a `models.knowledge.{maxFiles:3000, maxTokens:1_000_000, batchSize:20}` estimate and aborts/escalates past those bounds. Never a silent multi-hour run.
- All other sub-verbs: **A** / **R** (fast enough not to gate).

---

## Output artifacts

| Path | Produced by |
|---|---|
| `.guild/runs/<run-id>/run.yaml` | run start (every invocation) |
| `.guild/runs/<run-id>/provenance.json` | run close (every invocation) |
| `.guild/runs/<run-id>/learn/skipped-files.json` | learn scan (every full or map pass) |
| `.guild/indexes/codebase-map.json` | `map` / full pipeline |
| `wiki/concepts/architecture-map.md` | `map` / full pipeline |
| `.guild/indexes/knowledge-graph.json` | `graph` (v1 structural) / `knowledge` (enriches to v2) / full pipeline |
| `.guild/indexes/knowledge-links.json` | `knowledge` / full pipeline |
| `wiki/concepts/*` (knowledge-node candidates, human-gated) | `knowledge` / full pipeline |
| `.guild/indexes/onboarding-tour.md` | `onboard` / full pipeline |
| `.guild/runs/<run-id>/learn/diff-<ts>.md` | `diff` |
| `.guild/runs/<run-id>/learn/explain-<ts>.md` | `explain --save` only |

Sub-verb artifacts are idempotent (incremental or full rebuild per sub-verb).
Full pipeline artifacts are idempotent. `diff` and `explain` produce one file
per invocation.

---

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the learn-* pipeline runs — and before run-trace start — the run-trace CLI runs this preflight for you — you do **not**
call `runStartPreflight` yourself.

Since wave 2, `run-trace.js start` (below) is the **sole caller** of
`runStartPreflight` (`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`): on `start` the CLI resolves the 7-source
inheritance chain, validates closed keys, probes tmux, detects providers, and
writes `.guild/runs/<id>/resolved-settings.json` (+ a compact `settings_ref` in
`run.yaml`) automatically before the run opens. If this command needs the
resolved config — e.g. the dispatch backend `effective.agent_mode` — read the
snapshot back with `readResolvedSettingsSnapshot(runId, { cwd })`; never
re-resolve.

## Run recording (sub-verb forms)

For explicit sub-verb invocations, start a run before the skill is called
(SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js start \
  --command=/guild:learn \
  --cwd "$(pwd)"
```

`run-class` default (`full`) for all sub-verbs. No `--initiative` flag
(NN#5). The no-arg form's run-start is described in "No-arg form — smart full
learn-all" above — one call, not two; the dispatch branch determines which
path runs, not whether a run is started.

## Dispatch

Parse `$ARGUMENTS`. If the first token is one of `map`, `graph`, `knowledge`,
`onboard`, `diff`, `explain` — start a run (see above), then route to the
corresponding scoped sub-verb. All further tokens are forwarded as `args` to
the skill.

```
(absent)   → run-trace.js start; detect target; surface + confirm; Skill: guild:learn (smart-learn mode)
map        → run-trace.js start; Skill: guild:learn-map       args: $REMAINING_ARGS
graph      → run-trace.js start; Skill: guild:learn-graph     args: $REMAINING_ARGS
knowledge  → run-trace.js start; Skill: guild:learn-knowledge args: $REMAINING_ARGS
onboard    → run-trace.js start; Skill: guild:learn-onboard   args: $REMAINING_ARGS
diff       → run-trace.js start; Skill: guild:learn-diff      args: $REMAINING_ARGS
explain    → run-trace.js start; Skill: guild:learn-explain   args: $REMAINING_ARGS
```

Unknown sub-verb ⇒ print usage help and stop; invoke no skill, write no files:

```
Usage:
  /guild:learn                           Smart full learn-all (detect + confirm + pipeline)
  /guild:learn map                       CodebaseMap + architecture overview
  /guild:learn graph [--rigor=deep]      Deep semantic KnowledgeGraph (slow)
  /guild:learn knowledge                 Deep multi-modal knowledge tier (topics + wiki/diagram + cross-modal)
  /guild:learn onboard                   Guided architecture tour
  /guild:learn diff [path|ref]           Change analysis + blast-radius
  /guild:learn explain <path|concept>    Deep-dive explanation
```

All skill logic and `.guild/` writes live in the `learn-*` skill bodies and the
`guild:learn` smart-learn skill (A1's skill logic; clean-room re-authored from the
former `learn-engine` / `understand-onboard` per D4). This command file only
dispatches.

---

## Relation to `/guild:init --learn` and `defaults.auto_learn`

This command and `init --learn` / `defaults.auto_learn: true` share **one
implementation** (D3). When Init's full pipeline fires, it calls these same
`learn-*` skills in a sub-set order determined by the init context:

1. `guild:learn-map` (CodebaseMap + architecture stub)
2. `guild:learn-graph` (deep KnowledgeGraph)
3. `guild:learn-knowledge` (knowledge tier — K1–K6; lazy + cost-gated)
4. `guild:learn-onboard` (onboarding tour)

The `knowledge` tier honors the **one-implementation/two-triggers** contract
(SC-8): the same shared K1–K6 entrypoint runs byte-identically under
`/guild:learn knowledge`, the full no-arg `/guild:learn`, and `init --learn` /
`defaults.auto_learn`. It stays **lazy + cost-gated** in all three (not auto-run
by plain `init`).

`/guild:learn diff` and `/guild:learn explain` are not called by Init (they
are change-analysis and query-time skills, not bootstrap artifacts). The
`/guild:learn` command can call all six sub-verbs at user discretion. The
no-arg smart full learn-all runs all phases plus knowledge candidate
extraction, which Init's scoped pipeline does not do.

---

## followups

- `skill-author` (A1): author the smart full learn-all logic in the `guild:learn`
  skill body (the no-arg delegation target). The command dispatches to it — the
  detection classifier, workspace fan-out, skipped-files sink integration, and
  knowledge candidate extraction all live in the skill, not here.
- `skill-author`: author the `learn-*` family (`guild:learn-map`,
  `learn-graph`, `learn-onboard`, `learn-diff`, `learn-explain`) as
  clean-room re-implementations of the former `learn-engine` /
  `understand-onboard` concepts (D3/D4). One implementation; this command
  dispatches to them; `init --learn` also dispatches to them.
- `skill-author` (`learn-knowledge-tier` L6): author the `guild:learn-knowledge`
  skill body (`plugin/skills/knowledge/learn-knowledge/SKILL.md`) running the
  shared K1–K6 entrypoint (SC-8 byte-identical across the three triggers), the
  cost gate (SC-15), and per-K-stage staleness (SC-14). This command's
  `knowledge` dispatch row above is the docs-side cross-ref (L10); L6 owns the
  canonical skill name/path — reconcile if it differs.
- `docs-writer`: update the bare-`/guild:guild` surfaced-confirm documentation
  with the spike result (see OPEN VERIFICATION in the D1 ADR).

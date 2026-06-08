---
name: guild-learning-checkpoint
description: The per-phase LearningCheckpoint classifier — `guild.learning_checkpoint.v1`. At the EXISTING review boundary of each lifecycle phase (the 7-phase enum), reads the artifacts the phase ALREADY produced (receipt / review / provenance) and emits a deterministic verdict over a fixed 12-target enum + one knowledge-links edge-batch. A CLASSIFICATION verdict, not an analysis pass: no fresh scan, no new prompt, no new gate. Each target stays `none` unless its signature fired this phase, so the all-`none` no-op is the common case. Non-`none` verdicts route ONLY to the existing `.guild/reflections/<run-id>.md` human-gated queue. TRIGGER on "run the per-phase learning checkpoint", "classify learnings for this phase", "emit the 12-target learning verdict", "did this phase produce any learnings", "learning checkpoint for <phase>". DO NOT TRIGGER for: once-at-Stop reflection (`guild:reflect`), wiki promotion (`guild:wiki-ingest` / `guild:decisions`), or a fresh scan / graph rebuild (`guild:learn-*`).
when_to_use: Fires at step 7.5 — the review boundary of each lifecycle phase — invoked by the phase emit hook (HK-03, `hooks/`) which serializes the verdict and routes non-`none` entries. Automatic + advisory: rides the existing boundary, adds no new user gate and asks no new prompt. Also callable directly to classify a single phase's already-written artifacts.
type: meta
---

# guild:learning-checkpoint

Implements `guild-plan.md §11` (self-evolution pipeline) and the per-phase
learning loop of `docs/v2/05-knowledge-memory.md §"The per-phase
LearningCheckpoint"`. The schema, the 12-target enum, the per-target signature
table, the closed edge-type set, and the three invariants are **frozen** in the
contract `.guild/initiatives/active/drift-remediation/contracts/learning-checkpoint.v1.md`
and its canonical ADR
`docs/knowledge/decisions/continuous-knowledge-and-learning-loop.md §CR-C`.
**Bind both by pointer; on any conflict the ADR wins. Never re-spell the frozen
signature table inline** — this skill owns the *classification discipline*, not a
duplicate of the table.

This skill replaces the old once-at-Stop 3-signal pattern with a **per-phase**,
**phase-attributed** verdict over 12 targets. It is a sibling of — not a
replacement for — `guild:reflect`: the checkpoint **emits** non-`none` verdicts
*into* `.guild/reflections/<run-id>.md`; `guild:reflect` is the once-at-Stop
consumer of that same queue. The two compose; they never both own the same write.

## What this is (and is not)

- It is a **classification verdict, not an analysis pass.** It reads facts
  **already present** in the phase's receipt / review / `provenance.json` and
  classifies them. It runs **no fresh scan, no extra evidence-gathering, no new
  prompt** (`docs/v2/05 §The per-phase LearningCheckpoint`).
- It is **conservative by design.** Each of the 12 targets stays `none` **unless
  its deterministic signature fired this phase.** Absence ⇒ `none`. The
  all-`none` result is the **common, near-zero-token no-op** and verdict rates
  are deterministic across implementers (same artifacts → same verdict).
- It is **advisory, no new gate.** It rides the existing review boundary and adds
  no user gate. Non-`none` verdicts only *route* to the existing human-gated
  pipeline — they never promote anything themselves.

## Input — the phase's already-written artifacts

No fresh scan. Read only what the phase that just closed already produced:

- the phase's **handoff receipt(s)** (`.guild/runs/<run-id>/handoffs/*.md`, the
  embedded `guild.handoff.v2` block) and/or **review trail**
  (`.guild/runs/<run-id>/review/<gate>/`),
- the run's **`provenance.json`**,
- the **changed-files set** for the phase (already recorded),
- the phase's persisted labels / index state when a signature references them
  (read-only).

If a signature's source artifact is absent, that target is `none` — do not go
hunting for the fact.

## The 12-target classifier (signatures bound by pointer)

Apply the **per-target deterministic signature predicate** from
`contracts/learning-checkpoint.v1.md §2` (canonical: ADR §CR-C). For **each** of
the 12 targets, emit `none` **unless** that target's signature fired *this
phase*, in which case emit its terminal verdict form. **All 12 keys are always
present**, each set to a terminal verdict; all-`none` is valid and common.

The 12 targets group into one loop fired per phase (three formerly-separate
loops unified — `docs/v2/05`):

- **Knowledge loop:** `memory · wiki · knowledge_graph · domain_model` **plus**
  the `knowledge_links_batch` edge-batch.
- **Factory loop:** `agent_def · skill_def · agent_template · skill_template`.
- **Ops loop:** `config · task_tracking · workflow_rules · review_policy`.

The terminal verdict *forms* (e.g. `candidate:<ref>`, `refresh:<classifier-state>`,
`re-derive`, `proposal:<agent>`, `systemic-proposal`, `proposal:<key>`,
`update:<work-item>`, `proposal:<rule>`, `proposal:<gate>`) are fixed per target
in the contract table — read them there, do not invent new forms.

**Classification rule (the discipline, not the table):** read the signature off
the already-written artifact; if the machine-checkable fact is present, emit the
target's verdict form citing the artifact (`evidence_ref`); otherwise `none`.
The `{agent,skill}_template` columns specifically require the **CR-B
one-vs-template classifier** to have returned **systemic** (≥3-distinct + same
machine-checkable signature) this phase — a single-instance proposal is
`agent_def` / `skill_def`, never the template target.

### Worked examples (illustrative — the contract table is authoritative)

- Development phase, a receipt's `followups:` named a recurring skill gap AND a
  per-instance `guild:reflect` proposal for that skill crossed threshold this
  phase → `skill_def: proposal:<skill>`; the other 11 targets `none`.
- Quality phase, the `releasegate` recorded a BLOCK overridden with an
  owner-accepted risk → `review_policy: proposal:G-quality`; all others `none`.
- Init phase, nothing changed beyond the wiki diff already captured as a
  candidate by `wiki-ingest` → `wiki: candidate:<ref>`, `memory` possibly
  `candidate:<ref>`; the remaining targets `none`.

## Output — the verdict block (serialized by the hook)

This skill produces the `guild.learning_checkpoint.v1` **verdict content** for one
phase; the **emit hook (HK-03)** serializes it to disk and routes it. The
on-disk shape, path (`.guild/runs/<run-id>/learning/<phase>-<run-id>.yaml`), the
required-key set, and the closed edge-type enum are all **bound by pointer** to
`contracts/learning-checkpoint.v1.md §1` and `§3` — never re-spelled here. The
verdict carries:

- `phase` (the closed 7-enum), `run_id`, `observed[]` (short facts already in the
  artifacts), the `decisions` map with **all 12 keys** at terminal verdicts,
  `knowledge_links_batch[]` (append-only edges, `type` ∈ the closed 9-edge set —
  **emitted `[]` this wave; edge population is a Wave-2 deferral**, see the scope
  note below), `routed_to` (`.guild/reflections/<run-id>.md`), and `evidence_ref`.

### Integration seam with the emit hook (HK-03) — LOCKED

Per `contracts/learning-checkpoint.v1.md §5`, hook-engineer owns **emit + wiring**
and this skill owns **classify**. **Locked boundary:** this classifier returns the
12-key `decisions` verdict block (pure logic, no file I/O, never touches the
reflections queue); the emit hook
(`hooks/emit-learning-checkpoint.ts` → `writeCheckpoint`) serializes the
`learning/<phase>-<run-id>.yaml` envelope, appends every non-`none` verdict to
`reflections/<run-id>.md`, and **writes the record even on the all-`none` no-op**
(VC-K4: `phases-run == checkpoints`).

### How a phase skill fires the checkpoint (step 7.5)

There is **no per-phase Claude hook event**, so the checkpoint is **invoked by the
phase skill** at its step-7.5 review boundary (after the advisory/broker review,
before phase close). The canonical call — wired identically in all six phase
skills, varying only `phase` + `evidence_ref`:

1. **Classify** (this skill): read the phase's already-written artifacts and
   produce the 12-key `decisions` verdict. Write it as a JSON map (e.g.
   `{"memory":"none","wiki":"candidate:…", …}`, all 12 keys) to
   `.guild/runs/<run-id>/learning/<phase>-verdict.json`. The all-`none` map is the
   common case.
2. **Emit** (hooks' CLI): pass that verdict to the emitter, which writes the
   checkpoint YAML (always — even all-`none`) and routes non-`none` to reflections:

   ```bash
   GUILD_RUN_ID=<run-id> GUILD_PHASE=<phase> \
     GUILD_EVIDENCE_REF=<phase-artifact-path> GUILD_CWD=<guild-root> \
     GUILD_CHECKPOINT_VERDICT=.guild/runs/<run-id>/learning/<phase>-verdict.json \
     npx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/emit-learning-checkpoint.ts
   ```

   `GUILD_PHASE` ∈ the closed 7-enum (`init | ideation | planning | development |
   quality | operations | reflection`). Omitting `GUILD_CHECKPOINT_VERDICT`
   defaults to all-`none` (a safe no-op record). It is **advisory** — it asks no
   prompt and introduces **no new gate**; the phase proceeds regardless of the
   verdict.

> **Scope this wave — decisions-only (the `knowledge_links_batch` is deferred to
> Wave 2).** The classifier emits the **12-target `decisions` verdict** this
> wave; the `knowledge_links_batch` is emitted as **`[]`** (contract-valid —
> `contracts/learning-checkpoint.v1.md §1` allows an empty batch). The emit CLI
> is intentionally **decisions-only** (no `GUILD_CHECKPOINT_LINKS` env this wave).
> Populating the edge-batch into `knowledge-links.json` is a sub-feature of the
> connected-knowledge model and is a tracked **v2.x / Wave-2 follow-up** — it is
> a documented deferral, **not** a silent gap. When it lands, the classifier's
> edge output threads through an added CLI input and `writeCheckpoint`'s existing
> `knowledgeLinksBatch` opt.

The per-phase `GUILD_PHASE` mapping for the six phase producer skills:

| Phase skill | `GUILD_PHASE` | typical `GUILD_EVIDENCE_REF` |
|---|---|---|
| `guild:init` | `init` | the Init record / wiki-diff path |
| `guild:brainstorm` | `ideation` | `.guild/spec/<slug>.md` |
| `guild:plan` | `planning` | `.guild/plan/<slug>.md` |
| `guild:execute-plan` / `guild:review` | `development` | the lane receipts / `review.md` |
| `guild:quality` | `quality` | the quality report path |
| `guild:operations` | `operations` | the ops record / runbook path |

The `reflection` enum value is **not** emitted as a per-phase checkpoint by a
producer skill — it is the once-at-Stop `guild:reflect` path. At run close, HK-09
(`run-trace-close`) **locates** the terminal checkpoint (prefers
`learning/reflection-<run-id>.yaml` if present, else the latest phase checkpoint)
and sets `provenance.final_learning_checkpoint` to its path. HK-09 **does not emit
a new checkpoint** — it points provenance at an existing one.

## The three invariants no verdict may cross

Bound by pointer to `contracts/learning-checkpoint.v1.md §4` / ADR §CR-C:

1. **No new promotion path.** Every non-`none` verdict only *routes* to the
   existing `.guild/reflections/<run-id>.md` queue → the existing human-gated
   evolve / decisions / wiki-ingest pipeline.
2. **Never auto-promotes to the wiki.** Agents emit candidates only; humans
   promote.
3. **No verdict touches permission / sandbox / runtime policy** (the D5 carve-out
   is intact — no checkpoint verdict may alter it).

## Validation (VC-K4 / VC-K7) — bound by pointer

- **VC-K4:** every phase that ran has exactly one checkpoint whose `decisions`
  carries all 12 keys at terminal verdicts; every non-`none` verdict has a
  matching `reflections/<run-id>.md` entry (`phases-run == checkpoints`).
- **VC-K7 (G3 safety):** deleting all `learning/` dirs + `knowledge-links.json`
  changes no filesystem-reproducible answer; no checkpoint auto-promotes to wiki;
  no permission / sandbox / runtime policy is touched.

Full anchors in `contracts/learning-checkpoint.v1.md §6`.

## Anti-patterns

- **Fresh scanning.** The checkpoint never re-reads the codebase or re-runs a
  learn pass — it classifies facts already in the receipt / review / provenance.
- **Re-spelling the frozen signature table.** It is canonical in the contract /
  ADR; bind by pointer. Inventing verdict forms or signatures forks the schema.
- **Emitting < 12 keys, or a non-terminal verdict.** All 12 targets are always
  present with a terminal verdict; partial maps fail VC-K4.
- **Auto-promoting a non-`none` verdict.** Routing to `reflections/` is the only
  move — never write to the wiki, never alter policy.
- **Owning file I/O.** Serialization + the reflections append belong to the emit
  hook (HK-03); this skill classifies.
- **Confusing it with `guild:reflect`.** Reflect is the once-at-Stop consumer of
  the reflections queue; the checkpoint is the per-phase emitter into it.

## Handoff

This skill's output is the per-phase verdict block consumed by the emit hook.
Per `guild-plan.md §8.2`, the handoff lists: `phase`, `run_id`, the count of
non-`none` verdicts (and which targets), `knowledge_links_batch` edge count, and
`evidence_ref`. On an all-`none` result, the handoff records the no-op explicitly
(checkpoint ran, zero learnings) so VC-K4's `phases-run == checkpoints` holds.

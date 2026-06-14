---
name: guild-learning-checkpoint
description: The per-phase LearningCheckpoint classifier — `guild.learning_checkpoint.v1`. At the EXISTING review boundary of each lifecycle phase (the 7-phase enum), reads the artifacts the phase ALREADY produced (receipt / review / provenance) and emits a deterministic verdict over a fixed 12-target enum + one knowledge-links edge-batch. A CLASSIFICATION verdict, not an analysis pass: no fresh scan, no new prompt, no new gate. Each target stays `none` unless its signature fired this phase, so the all-`none` no-op is the common case. Non-`none` verdicts route ONLY to the existing `.guild/reflections/<run-id>.md` human-gated queue. TRIGGER on "run the per-phase learning checkpoint", "classify learnings for this phase", "emit the 12-target learning verdict", "did this phase produce any learnings", "learning checkpoint for <phase>". DO NOT TRIGGER for: once-at-Stop reflection (`guild:reflect`), wiki promotion (`guild:wiki-ingest` / `guild:decisions`), or a fresh scan / graph rebuild (`guild:learn-*`).
when_to_use: Fires at step 7.5 — the review boundary of each lifecycle phase — invoked by the phase emit hook (HK-03, `hooks/`) which serializes the verdict and routes non-`none` entries. Automatic + advisory: rides the existing boundary, adds no new user gate and asks no new prompt. Also callable directly to classify a single phase's already-written artifacts.
type: meta
---

# guild:learning-checkpoint

Implements the self-evolution pipeline's per-phase
learning loop (the per-phase LearningCheckpoint). The schema, the 12-target enum, the per-target signature
table, the closed edge-type set, and the three invariants are **frozen** in the
contract `.guild/initiatives/active/drift-remediation/contracts/learning-checkpoint.v1.md`
and its canonical ADR (the continuous-knowledge-and-learning-loop §CR-C).
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
  prompt** (see §The per-phase LearningCheckpoint).
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

The 12 targets group into one loop fired per phase (three formerly-separate loops unified):

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
  `knowledge_links_batch[]` (append-only edges, `type` ∈ the closed 9-edge set,
  nodes in work/decision space — derived per-phase; see `## The edge-batch`),
  `routed_to` (`.guild/reflections/<run-id>.md`), and `evidence_ref`.

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
   produce **two outputs** — (a) the 12-key `decisions` verdict, written as a JSON
   map (e.g. `{"memory":"none","wiki":"candidate:…", …}`, all 12 keys) to
   `.guild/runs/<run-id>/learning/<phase>-verdict.json`; and (b) the
   **`knowledge_links_batch`** — a JSON array of `{from, to, type, run_id}` edges
   (see `## The edge-batch` below) written to
   `.guild/runs/<run-id>/learning/<phase>-links.json`. The all-`none` verdict +
   empty-edge-array case is the common one.
2. **Emit** (hooks' CLI): pass both files to the emitter, which writes the
   checkpoint YAML (always — even all-`none`), routes non-`none` to reflections,
   and appends the edges to `knowledge-links.json`:

   ```bash
   GUILD_RUN_ID=<run-id> GUILD_PHASE=<phase> \
     GUILD_EVIDENCE_REF=<phase-artifact-path> GUILD_CWD=<guild-root> \
     GUILD_CHECKPOINT_VERDICT=.guild/runs/<run-id>/learning/<phase>-verdict.json \
     GUILD_CHECKPOINT_LINKS=.guild/runs/<run-id>/learning/<phase>-links.json \
     npx tsx ${CLAUDE_PLUGIN_ROOT}/hooks/emit-learning-checkpoint.ts
   ```

   `GUILD_PHASE` ∈ the closed 7-enum (`init | ideation | planning | development |
   quality | operations | reflection`). Omitting `GUILD_CHECKPOINT_VERDICT`
   defaults to all-`none`; omitting `GUILD_CHECKPOINT_LINKS` defaults to an empty
   batch — both safe no-ops. It is **advisory** — it asks no prompt and introduces
   **no new gate**; the phase proceeds regardless of the verdict.

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

## The edge-batch (`knowledge_links_batch`)

Each phase contributes the append-only edges it learned, into the derived
`.guild/indexes/knowledge-links.json` (`guild.knowledge_links.v1`). The classifier
**produces** the edges; the emit hook **serializes them and performs the
checkpoint's incremental append**. The checkpoint is **one of three append/rebuild
producers** of that index — see the writer model below; it is **not** the sole
writer.

**Derivation — same conservative rule as the decisions verdict.** Edges are read
off the **already-written phase artifacts** (no fresh scan) and are emitted
**only for non-`none` verdicts that name a work/decision node**. All-`none` ⇒
empty batch. So the batch is **naturally sparse** — most phases contribute few or
zero edges.

**Two hard constraints (both load-bearing):**

1. **Edge `type` ∈ the CLOSED 9 only** — `decided_by · used_for · produced ·
   touches · supersedes · learned_from · constrains · opens_question · resolves`
   (`contracts/learning-checkpoint.v1.md §3`). **Not** the extended-6
   (`serves_goal / excludes / references / emits_candidate / verified_by /
   has_review`) — those belong to `scripts/knowledge-links-builder.ts`'s full
   rebuild, not the per-phase checkpoint.
2. **Node space = work/decision ONLY** — id prefixes `task:`, `run:`, `decision:`,
   `skill:`, `agent:`, `feature:` (the `classifyNodeKindExtended` convention). The
   checkpoint **never** emits `wiki:` / `file:` / `domain:` / `component:` nodes —
   those are KnowledgeGraph / wiki node-space (the builder's `collectWikiEdges`
   owns them). This holds the **node-space-separation invariant** (§"Node-space separation"): the checkpoint edge-layer and the code/wiki graph must not overlap.

**Verdict → edge mapping (conservative; emit only when the verdict names a
work/decision node):**

| Non-`none` verdict | Edge contributed |
|---|---|
| `memory` / `wiki: candidate:<ref>` | `decision:<ref> learned_from run:<run-id>` |
| `skill_def: proposal:<skill>` | `skill:<skill> learned_from run:<run-id>` |
| `agent_def: proposal:<agent>` | `agent:<agent> learned_from run:<run-id>` |
| `task_tracking: update:<work-item>` | `run:<run-id> produced task:<work-item>` |
| a decision captured this phase (receipt links task↔decision) | `task:<id> decided_by decision:<slug>` |
| `config` / `workflow_rules` / `review_policy` / `knowledge_graph` / `domain_model` | **no edge** (target is not a work/decision node — the decisions verdict still records it) |

**Channel.** The classifier writes the edge array to
`.guild/runs/<run-id>/learning/<phase>-links.json`; the emit hook reads it via
`GUILD_CHECKPOINT_LINKS`, serializes it into the checkpoint YAML
`knowledge_links_batch`, and appends it to
`.guild/indexes/knowledge-links.json` — **append-only, deduped on
`{from, to, type}`, never auto-promoted** (VC-K7). The classifier writes no index
file itself.

**Writer model — one rebuildable projection, THREE producers (NOT a single
writer).** `.guild/indexes/knowledge-links.json` (`guild.knowledge_links.v1`) is a
**DERIVED, rebuildable projection** (DI-6 / NN#8: *derived, deletable,
filesystem-canonical, absence ⇒ re-scan; deleting it loses no source truth*). It
has **three producers**, split by role
(`contracts/wave2-d-edge-batch-writer-model.md`):

| Producer | Role |
|---|---|
| `scripts/knowledge-links-builder.ts` | **CANONICAL full rebuild** — re-derives the entire edge set from the canonical fact sources (provenance, wiki, raw, handoffs, decisions, open-questions). Authoritative; overwrites. |
| `hooks/emit-learning-checkpoint.ts` (this checkpoint) | **incremental append-only** — appends the phase's batch between rebuilds so edges are live immediately. |
| `scripts/understand/lib/domain.ts` | **incremental append-only** — stage-5 initial domain/component batch at learn/init. |

The checkpoint is **one incremental append-only producer, not the sole writer.**
The model is sound **iff every appended edge is re-derivable by the builder** —
then a full rebuild reconstructs the appends and the overwrite loses no truth
(NN#8).

> **Known limitation — `decided_by` / `supersedes` / `resolves` are
> ephemeral-until-W3.** The builder currently re-derives **6 of the closed 9**
> edge types (`used_for · produced · touches · learned_from · constrains ·
> opens_question`) — those checkpoint appends are clobber-safe. The other **3**
> (`decided_by`, `supersedes`, `resolves`) are **not yet emitted by the builder**,
> so a checkpoint append of those types **vanishes on the next full rebuild**
> (NN#8 not yet satisfied for them). The facts are re-derivable in principle
> (`decided_by ⇐ provenance.touched.decisions`, `supersedes ⇐ wiki frontmatter`,
> `resolves ⇐ provenance + open-questions`); the **W3 builder extension** adds
> that re-derivation so all 9 survive a rebuild. Until then, treat those 3 as
> live-but-ephemeral — do not rely on them persisting across a rebuild.

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
The handoff lists: `phase`, `run_id`, the count of
non-`none` verdicts (and which targets), `knowledge_links_batch` edge count, and
`evidence_ref`. On an all-`none` result, the handoff records the no-op explicitly
(checkpoint ran, zero learnings) so VC-K4's `phases-run == checkpoints` holds.

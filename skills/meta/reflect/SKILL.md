---
name: guild-reflect
description: Post-task reflection. Consumes a compact run summary (from scripts/trace-summarize.ts), handoff receipts, and verify.md, and emits proposals to .guild/reflections/<run-id>.md. Proposals cover (a) skill-improvement candidates (a skill triggered wrong N times, or body needs a new section), (b) missing-specialist candidates (gap repeated >=3 runs), (c) context-bundle issues (over 3k tokens, summarization hit), (d) followups not addressed. Does NOT write to .guild/wiki/ — that is wiki-ingest / decisions territory. TRIGGER for "reflect on this run", "what did we learn", "run post-task reflection", "capture lessons from the specialist outputs", "any skill gaps in this run". DO NOT TRIGGER for wiki ingest (guild:wiki-ingest owns), capturing a decision (guild:decisions), any mid-task reflection (only fires post-verify-done), or promoting a reflection to the wiki.
when_to_use: Final step of /guild lifecycle after guild:verify-done passes. Invoked automatically by hooks/maybe-reflect.ts Stop hook when the heuristic gate (>=1 specialist dispatched + >=1 file edited + no error) clears.
type: meta
---

# guild:reflect

Implements `guild-plan.md §11` (self-evolution pipeline) and the reflect-specific half of `§10.5.1` (memory write path). Runs last in the `/guild` lifecycle, after `guild:verify-done` writes `verify.md` with pass status. Gated by `hooks/maybe-reflect.ts` per `§13.2`: the Stop hook only fires this skill when the run actually did meaningful work (at least one specialist dispatched, at least one file edited, no hard error). Skills that triggered but no-oped do not earn a reflection.

This skill is a **proposer**, not a writer. Per `§10.5.1`, durable memory lives under `.guild/wiki/` and only `guild:wiki-ingest` and `guild:decisions` are allowed to promote content there. This skill writes a single proposal file per run and stops.

## Input

Three sources, all already materialized under `.guild/runs/<run-id>/` by the time this skill fires:

1. `.guild/runs/<run-id>/summary.md` — the compact run summary produced by `scripts/trace-summarize.ts` from `events.ndjson`. Contains frontmatter (`run_id`, `started_at`, `ended_at`, `duration_ms`, `event_count`, `specialists_dispatched`, `tools_used`, `files_touched_count`, `errors`, `ok_rate`) plus body sections (Timeline, Specialist activity, Notable events, Reflection hints). Reflect reads this instead of the raw event log so it stays grep-able. **P6 enrichment planned:** `capture-telemetry.ts` does not yet emit per-skill trigger counts or context-bundle sizes, so those signals come from handoff receipts (§8.2 `followups:` / `assumptions:`) and from the verify.md report — not from summary.md today. When P6 extends the telemetry schema, this skill's routing will prefer the richer summary fields.
2. `.guild/runs/<run-id>/handoffs/*.md` — per-specialist handoff receipts per `§8.2`. Provides `changed_files`, `assumptions`, `evidence`, and `followups`. Followups are the richest signal for proposal categories below.
3. `.guild/runs/<run-id>/verify.md` — from `guild:verify-done`. Confirms the run actually passed (reflect never fires on a failed run, by the hook gate, but re-check the overall status line defensively) and carries the non-blocking followups that the verify step forwarded.

## Proposal categories

Walk the inputs once and classify every observation into one of four buckets. Empty buckets are omitted from the output.

1. **Skill improvement.** A handoff receipt's `followups:` explicitly names a skill gap (e.g., "guild:context-assemble missed the wiki/decisions/ page"), OR an `assumptions:` entry flags a skill behavior that surprised the specialist, OR the same skill shows up in ≥ 2 followups across the run's receipts. Evidence for a proposal is the verbatim followup/assumption line naming the skill. Record the skill name, the failure mode, and a quote. **P6 enrichment:** once `summary.md` carries per-skill trigger counts, reflect can additionally catch trigger/no-op mismatches by comparing against each skill's `should_trigger` / `should_not_trigger` evals.

2. **Missing specialist.** A recurring gap across unrelated tasks — the *same* kind of work kept getting handled by a generalist lane or rejected as out-of-scope. Per `§11.1`, the threshold is >=3 runs; this skill only logs the candidate for the current run, it does not aggregate across runs (see Aggregation rule). For P5, record the proposed role name and the evidence; the actual specialist creation is `guild:create-specialist` in P6.

3. **Context bundle issue.** `guild:context-assemble` hit the 6k token cap, or summarization was invoked mid-run, or a specialist's followup flagged missing context. Record the affected specialist/bundle pair and which wiki pages (if any) were dropped.

4. **Followup backlog.** Every entry from the union of handoff `followups:` that verify-done carried forward as "non-blocking" and that does not already appear as a new task in `.guild/runs/`. Record `<specialist>/<taskid>` pairs so `/guild:stats` can show them grouped by owner.

## Output

Exactly one file per run:

```
.guild/reflections/<run-id>.md
```

Frontmatter:

```yaml
---
run_id: <id>
date: <YYYY-MM-DD>
task_slug: <slug>
proposals:
  skill_improvement: [<skill-name>, ...]
  missing_specialist: [<proposed-role>, ...]
  context_issues: [<specialist>/<bundle>, ...]
  followup_backlog: [<specialist>/<taskid>, ...]
significance: low | medium | high
---
```

Body: one `##` section per non-empty category. Each section lists the proposal(s) with a one-paragraph rationale and a verbatim evidence snippet (summary row, followup line, or verify.md excerpt). Empty categories are omitted entirely — do not emit "No findings" sections, the frontmatter already records that via empty lists.

## Significance threshold

Per `§15.2` ("evolution loop overfits" risk), not every reflection deserves attention.

- **low** — zero non-empty categories, or only one followup-backlog entry. Stays in `.guild/reflections/` as an audit record, not surfaced in `/guild:stats` by default.
- **medium** — at least one skill-improvement or context-bundle issue, or >=3 followup-backlog entries. Surfaces in `/guild:stats` (P6) and is a candidate input to `guild:evolve-skill` (P6).
- **high** — a missing-specialist proposal, or a skill-improvement proposal with evidence from >=2 earlier reflections (cross-referenced by name; reflect does not aggregate but it may cite). Forces a `/guild:stats` surface.

Tier the reflection before writing the frontmatter so the significance field is consistent with the body.

## Aggregation rule

Reflect writes exactly ONE reflection per run and never modifies prior reflections. Cross-run aggregation — "the same skill has been named in three reflections, open an evolve task" — is `/guild:evolve`'s job per `§11.1`. The automatic threshold there is >=3 reflections for a single skill; that counter is computed by walking `.guild/reflections/*.md` frontmatter `proposals.skill_improvement`, and reflect's job is to fill that frontmatter correctly so evolve can count.

If you notice a pattern worth aggregating, emit the per-run evidence and stop. Do not pre-emptively collapse into a single cross-run proposal.

## Non-destructive rule

This skill NEVER writes to `.guild/wiki/`, NEVER edits an existing skill or agent file, NEVER creates a new task under `.guild/runs/`, and NEVER mutates a handoff receipt or `verify.md`. Output is limited to `.guild/reflections/<run-id>.md`. Promotion of any proposal into durable memory is `guild:wiki-ingest`'s job (for sourced knowledge) or `guild:decisions`'s job (for team decisions). Skill/agent edits are `guild:evolve-skill` / `guild:create-specialist` in P6. If you find yourself wanting to fix a skill inline, stop — write the proposal and let evolve pick it up.

## Handoff

Emit a `handoff` block naming the reflection path so the orchestrator can hand off to `/guild:stats` (P6) or `/guild:evolve` (P6). Payload fields:

- `run_id` — carried forward from the inputs.
- `reflection_path` — absolute path to `.guild/reflections/<run-id>.md`.
- `significance` — `low` / `medium` / `high`, matching the frontmatter.
- `proposal_counts` — a `{skill_improvement: N, missing_specialist: N, context_issues: N, followup_backlog: N}` summary so `/guild:stats` can render without re-parsing.

For P5 this is a forward reference: `/guild:stats` and `/guild:evolve` land in P6. If neither is installed, stop after writing the reflection and return its path to the user.

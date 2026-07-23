---
name: guild-reflect
description: Post-task reflection. Consumes a compact run summary (from scripts/trace-summarize.ts), handoff receipts, and verify.md, and emits proposals to .guild/reflections/<run-id>.md. Proposals cover (a) skill-improvement candidates (a skill triggered wrong N times, or body needs a new section), (b) missing-specialist candidates (gap repeated >=3 runs), (c) context-bundle issues (over 3k tokens, summarization hit), (d) followups not addressed. Does NOT write to .guild/wiki/ — that is wiki-ingest / decisions territory. TRIGGER for "reflect on this run", "what did we learn", "run post-task reflection", "capture lessons from the specialist outputs", "any skill gaps in this run". DO NOT TRIGGER for wiki ingest (guild:wiki-ingest owns), capturing a decision (guild:decisions), any mid-task reflection (only fires post-verify-done), or promoting a reflection to the wiki.
when_to_use: Final step of Guild lifecycle after guild:verify-done passes. Invoked automatically by hooks/maybe-reflect.ts Stop hook when the heuristic gate (>=1 specialist dispatched + >=1 file edited + no error) clears.
type: meta
---

# guild:reflect

Implements the self-evolution pipeline's reflect step and the memory write path's proposal side. Runs last in the `/guild` lifecycle, after `guild:verify-done` writes `verify.md` with pass status. Gated by `hooks/maybe-reflect.ts`: the Stop hook only fires this skill when the run actually did meaningful work (at least one specialist dispatched, at least one file edited, no hard error). Skills that triggered but no-oped do not earn a reflection.

This skill is a **proposer**, not a writer. Durable memory lives under `.guild/wiki/` and only `guild:wiki-ingest` and `guild:decisions` are allowed to promote content there. This skill writes a single proposal file per run and stops.

## Input

Four sources, all materialized under `.guild/runs/<run-id>/` by the time this skill fires. Sources 1–3 are the original; source 4 is the preferred upstream when present:

1. `.guild/runs/<run-id>/summary.md` — the compact run summary produced by `scripts/trace-summarize.ts` from `events.ndjson`. Contains frontmatter (`run_id`, `started_at`, `ended_at`, `duration_ms`, `event_count`, `specialists_dispatched`, `dispatched_lanes`, `dispatch_receipts`, `tools_used`, `files_touched_count`, `errors`, `ok_rate`, and the dispatch-integrity sink counts `backend_degradations` / `tier_violations` / `untiered_dispatches`) plus body sections (Timeline, Specialist activity, Notable events, **Sink audit**, Reflection hints). The **Sink audit** section is the consumer of the run's `logs/backend-degradation.jsonl` + `logs/tier-dispatch.jsonl` sinks: a non-zero `backend_degradations` / `tier_violations` / `untiered_dispatches` means a lane ran on a downgraded backend or dispatched un-tiered — treat each as a skill-improvement or followup-backlog proposal (§Proposal categories) with the Sink audit block as the verbatim evidence, so a dispatch-dirty run is surfaced automatically rather than staying auditable-by-path. Reflect reads this instead of the raw event log so it stays grep-able. **P6 enrichment planned:** `capture-telemetry.ts` does not yet emit per-skill trigger counts or context-bundle sizes, so those signals come from handoff receipts (§8.2 `followups:` / `assumptions:`) and from the verify.md report — not from summary.md today. When P6 extends the telemetry schema, this skill's routing will prefer the richer summary fields.
2. `.guild/runs/<run-id>/handoffs/*.md` — per-specialist handoff receipts per `§8.2`. Provides `changed_files`, `assumptions`, `evidence`, and `followups`. Followups are the richest signal for proposal categories below. When a receipt is consumed, the embedded ```` ```guild.handoff.v2 ```` JSON block is the machine truth a consumer reads; the `guild.handoff_receipt.v1` YAML frontmatter is human-review context only (see §"Handoff contract" of the communication format policy). Read these §8.2 fields from that one embedded envelope — a frontmatter-only receipt with no embedded v2 block is not a valid machine receipt.
3. `.guild/runs/<run-id>/verify.md` — from `guild:verify-done`. Confirms the run actually passed (reflect never fires on a failed run, by the hook gate, but re-check the overall status line defensively) and carries the non-blocking followups that the verify step forwarded.
4. `.guild/runs/<run-id>/learn/harvest-candidates.json` — **preferred upstream when present** (SC-C from learn-knowledge-convergence). Written by `guild:learn-harvest` when it is explicitly invoked at a phase boundary or run close (not auto-routed by `LearningCheckpoint`, which only routes verdicts to the reflections queue). When this file exists, populate proposal categories directly from its `reflection_candidates` array rather than re-extracting from the raw handoffs — `harvest-candidates.json` already carries structured `category`, `description`, `evidence_quote`, `source_refs`, and `significance` per entry. Source 2 (raw handoffs) is used as fallback when `harvest-candidates.json` is absent or predates this contract.

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
codex_review: RAN | SKIPPED   # REQUIRED on self-build runs — see § Codex-review marker
---
```

Body: one `##` section per non-empty category. Each section lists the proposal(s) with a one-paragraph rationale and a verbatim evidence snippet (summary row, followup line, or verify.md excerpt). Empty categories are omitted entirely — do not emit "No findings" sections, the frontmatter already records that via empty lists.

## Significance threshold

Per `§15.2` ("evolution loop overfits" risk), not every reflection deserves attention.

- **low** — zero non-empty categories, or only one followup-backlog entry. Stays in `.guild/reflections/` as an audit record, not surfaced in `/guild:stats` by default.
- **medium** — at least one skill-improvement or context-bundle issue, or >=3 followup-backlog entries. Surfaces in `/guild:stats` (P6) and is a candidate input to `guild:evolve-skill` (P6).
- **high** — a missing-specialist proposal, or a skill-improvement proposal with evidence from >=2 earlier reflections (cross-referenced by name; reflect does not aggregate but it may cite). Forces a `/guild:stats` surface.

Tier the reflection before writing the frontmatter so the significance field is consistent with the body.

## Codex-review marker (self-build runs)

Implements the reflect half of the FU-E codex-skip discipline contract (`plugin/CLAUDE.md` §"Codex adversarial review"; self-evolution gate). On **self-build runs** (developing the Guild plugin itself — `plugin/CLAUDE.md` is present), every reflection's frontmatter MUST carry a canonical machine-readable field:

```yaml
codex_review: RAN        # codex adversarial review actually ran at this run's gates
# or
codex_review: SKIPPED    # codex was unavailable / unused at the run's gates
```

Rules:

- **Always emit it on self-build runs.** Omitting the field is a silent skip — the `hooks/maybe-reflect.ts` Stop-hook guard treats a reflection that records no codex run as a *skip*, but prose-only reflections that lack the field count as **zero** signal, so the consecutive-skip streak never advances and the guard never arms. Emitting the canonical field is the reliable path the hook prefers (it has legacy `proposals.skill_improvement: [guild:codex-review]` and body-comment `<!-- codex_review: SKIPPED -->` fallbacks, but the frontmatter field is authoritative).
- **`RAN`** — emit when `guild:codex-review` / `guild:review-broker` actually executed and reached a verdict at one or more of this run's G-gates (G-spec / G-plan / G-lane / G-diagnose). A `RAN` reflection **breaks the consecutive-skip streak** — this is how the discipline self-clears (see below).
- **`SKIPPED`** — emit when codex was unavailable (`codex --version` failed / not authenticated), the gate emitted its `warn: codex-review skipped …` line, or no adversarial review ran at any gate. The hook counts consecutive `SKIPPED` reflections; at ≥ 3 it writes the blocking sentinel `.guild/codex-skip-streak.json` and exits non-zero.

**How the streak clears.** The hook counts the streak of *consecutive most-recent* reflections (newest first by mtime) that record a skip; the first reflection that does **not** record a skip ends the run. So a single reflection with `codex_review: RAN` at the top of the trail breaks the streak — the next Stop-hook evaluation computes `streak = 0` and does not re-arm. This is the canonical clear path: run codex, then a `RAN` reflection resets the discipline. (The stale sentinel file is consumed/cleared by the gate-read side in `guild:codex-review` — reflect's only job is to write the honest `RAN`/`SKIPPED` field; it never touches `.guild/codex-skip-streak.json`.)

On **non-self-build runs** (consuming repos), the field is optional — the guard only arms in self-build context — but emitting it is harmless and recommended for forward consistency.

## Aggregation rule

Reflect writes exactly ONE reflection per run and never modifies prior reflections. Cross-run aggregation — "the same skill has been named in three reflections, open an evolve task" — is `/guild:evolve`'s job per `§11.1`. The automatic threshold there is >=3 reflections for a single skill; that counter is computed by walking `.guild/reflections/*.md` frontmatter `proposals.skill_improvement`, and reflect's job is to fill that frontmatter correctly so evolve can count.

If you notice a pattern worth aggregating, emit the per-run evidence and stop. Do not pre-emptively collapse into a single cross-run proposal.

After this reflection is written, run the deterministic cross-run aggregator so the
§11.1 threshold is counted by tooling, not recalled in-context:

```
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/analyze-runs.ts --cwd <repo-root>
```

It reads every `.guild/reflections/*.md`'s `proposals.skill_improvement` /
`proposals.missing_specialist` frontmatter plus handoff `status: escalate`
receipts, and writes `.guild/evolve/analyze-runs-latest.md` (PROPOSAL-ONLY —
never mutates a skill/agent, never writes to `.guild/wiki/`). Name that path in
the handoff so `/guild:evolve`'s threshold read has a fresh aggregate to
consume.

## Non-destructive rule

This skill NEVER writes to `.guild/wiki/`, NEVER edits an existing skill or agent file, NEVER creates a new task under `.guild/runs/`, and NEVER mutates a handoff receipt or `verify.md`. Output is limited to `.guild/reflections/<run-id>.md` plus the feedback-routing artifacts under `.guild/feedback/<run-id>/` (findings.json + triage output — see §Feedback routing; still nothing durable, nothing external without the operator gate). Promotion of any proposal into durable memory is `guild:wiki-ingest`'s job (for sourced knowledge) or `guild:decisions`'s job (for team decisions). Skill/agent edits are `guild:evolve-skill` / `guild:create-specialist` in P6. If you find yourself wanting to fix a skill inline, stop — write the proposal and let evolve pick it up.

## Feedback routing — project vs plugin (deterministic, consent-gated)

After the reflection is written, route any finding that smells like a **Guild plugin defect** (broken flow, host-adapter gap, unsafe default, portability bug — vs project-local knowledge) through the deterministic feedback pipeline. Never eyeball the routing and never file anything yourself:

1. Write the candidate findings as a `RunLearningFinding[]` JSON array to `.guild/feedback/<run-id>/findings.json` (fields: `id`, `summary`, `details?`, `evidence_refs?`, `affected_artifacts?`, `proposed_change?` — cite the artifact paths you actually saw; the paths drive classification).
2. Run the classifier: `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/feedback-triage.ts triage --run-id <run-id> --findings .guild/feedback/<run-id>/findings.json`. It classifies each finding (`workspace_project | plugin | mixed | ambiguous`, code not prose), and for plugin/mixed writes a **sanitized** issue draft (private paths/tokens/emails redacted by the run-export redaction stack) to `.guild/feedback/<run-id>/<finding-id>.draft.md`. Nothing leaves the machine.
3. `workspace_project` findings → the normal project learning gate (wiki-ingest / decisions). `ambiguous` → surface to the operator as triage questions.
4. For each plugin/mixed draft: **ASK THE OPERATOR** — show the draft path + title and ask whether Guild may file it as a GitHub issue (it contains no user-specific information; say so). On an explicit yes: `… feedback-triage.ts file --run-id <run-id> --finding <id> --approve "<operator>"`. On no: `--deny [reason]` (recorded). **Non-interactive session ⇒ never file** — leave the drafts pending and name them in the handoff.

The CLI is the consent choke-point: it structurally refuses to reach `gh issue create` without the explicit `--approve`, so a missed ask cannot leak.

## Handoff

Emit a `handoff` block naming the reflection path so the orchestrator can hand off to `/guild:stats` (P6) or `/guild:evolve` (P6). Payload fields:

- `run_id` — carried forward from the inputs.
- `reflection_path` — absolute path to `.guild/reflections/<run-id>.md`.
- `significance` — `low` / `medium` / `high`, matching the frontmatter.
- `proposal_counts` — a `{skill_improvement: N, missing_specialist: N, context_issues: N, followup_backlog: N}` summary so `/guild:stats` can render without re-parsing.
- `pending_plugin_feedback` — finding ids with sanitized drafts awaiting the operator's file/deny decision (empty when none; never auto-filed).

For P5 this is a forward reference: `/guild:stats` and `/guild:evolve` land in P6. If neither is installed, stop after writing the reflection and return its path to the user.

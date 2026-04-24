---
name: architect-tradeoff-matrix
description: Scores 2–4 architecture options across named axes (cost, complexity, performance, ops burden, time-to-ship, reversibility, etc.) and surfaces a recommendation. Output: markdown table with per-cell rationale plus a final pick. Pulled by the `architect` specialist. TRIGGER: "compare these architecture options", "pick between X and Y", "which is better: monolith or split service", "score these approaches", "give me a tradeoff matrix for X vs Y", "which option should we choose". DO NOT TRIGGER for: greenfield design with no options yet (use `architect-systems-design`), locking in a final decision as a durable record (use `architect-adr-writer`), comparing libraries or vendors at the research level (researcher-comparison-table), API vs API shape choices inside one design (backend-api-contract), DB engine selection at vendor level (researcher-comparison-table).
when_to_use: The parent `architect` specialist pulls this skill when two or more viable architecture options exist and the team needs a structured comparison before choosing. Also fires on explicit user request.
type: specialist
---

# architect-tradeoff-matrix

Implements `guild-plan.md §6.1` (architect · tradeoff-matrix) under `§6.4` engineering principles: evidence is the matrix itself — every cell carries a reason a reviewer can challenge.

## What you do

Reduce a fuzzy "which of these should we do?" to a scannable table, with axes chosen for *this* decision (not a generic template), cells filled with short rationales (not bare letter grades), and a recommendation whose weakness is named out loud.

- Pick 3–6 axes that matter for this specific call — cost, complexity, p95 latency, reversibility, team familiarity, blast radius, time-to-ship, vendor lock-in, ops burden.
- Score each cell (e.g. low/med/high, 1–5, or relative) and attach a one-clause reason. Scores without reasons are cargo cult.
- State the weighting explicitly if axes aren't equal — "we're weighting reversibility 2× because this is hard to undo."
- End with a recommendation and the single strongest argument *against* it, so the reviewer sees you looked.

## Output shape

A markdown fragment (usually returned inline to the architect, may be persisted at `.guild/runs/<run-id>/tradeoffs/<slug>.md` if the run tracks artifacts):

1. **Options** — 2–4 named options, one-line summary each.
2. **Matrix** — markdown table: rows = options, columns = axes, cells = score + reason.
3. **Weighting** — explicit weights per axis if non-uniform.
4. **Recommendation** — named option + 2–3 sentence rationale.
5. **Strongest counter** — the best argument against the recommendation.

## Anti-patterns

- Single-option "analysis" — a matrix with one row is a justification, not a comparison.
- Scoring without named criteria — "option B is better" with no axes is opinion, not evidence.
- Hiding tradeoffs — every option has a downside; if yours is all green, your axes are wrong.
- Generic axes — reusing the same 5 columns across every decision washes out the signal specific to this call.
- Ranking by vibes — if you can't say why option A scored "high" on cost, delete the row and think again.

## Handoff

Return the matrix to the invoking `architect` specialist. If the recommendation is non-trivial, the architect typically chains into `architect-adr-writer` to make the decision durable. This skill does not itself dispatch other agents.

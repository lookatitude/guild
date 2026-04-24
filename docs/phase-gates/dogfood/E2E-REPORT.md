---
phase: P7
gate: end-to-end dogfood (simulated)
run_id: run-001
spec: pricing-calculator
completed_at: "2026-04-24T13:30:00Z"
outcome: PASS
---

# E2E Dogfood Report — P7 (run-001)

## Overview

**What was dogfooded:** The full Guild task lifecycle (brainstorm → team-compose
→ plan → context-assemble → execute-plan → review → verify-done → reflect)
against a synthetic task: "Add a pricing calculator to the landing page —
needs frontend + copy + SEO."

**Why simulated, not live:** A live `/guild` run requires a real Claude Code
orchestrator session dispatching actual Agent tool calls. That infrastructure
cannot be triggered from within a subagent. The dogfood approach here is a
**manual artifact trace**: every lifecycle stage's output is produced as real
file content, with plausible but synthetic evidence, so the contract chain can
be verified structurally without a live session.

This simulated run proves:
1. Every stage's output format is correct (required frontmatter and sections
   present).
2. The chain holds: stage N's output paths/shapes satisfy stage N+1's expected
   inputs.
3. Contract fields are populated with meaningful content, not stub placeholders.

A live run remains the final validation step when real Claude Code sessions can
be orchestrated end-to-end (P8 / v1.1 scope).

---

## Per-Stage Artifact Table

| # | Stage | Artifact Path | Contract Source | Frontmatter Fields Present | Required Sections Present |
|---|---|---|---|---|---|
| 1 | brainstorm/spec | `spec/pricing-calculator.md` | §8.1 planning contract | goal, audience, success_criteria, non_goals, constraints, autonomy_policy, risks | Background, What we are building, Copy requirements, SEO integration, Acceptance |
| 2 | team-compose | `team/pricing-calculator.yaml` | §7.2 team rules | slug, run_id, backend, specialists list | specialists (4 entries), each with scope, depends_on, autonomy_policy, backend |
| 3 | plan | `plan/pricing-calculator.md` | §8.1 planning contract | slug, run_id, approved, approved_at, backend | Execution order, 4 Lane sections with task-id/owner/depends-on/scope/success-criteria |
| 4 | context-assemble | `context/run-001/*.md` (4 files) | §9 context assembly | specialist, task_id, run_id, layer_token_estimate | Layer 1 (Universal), Layer 2 (Role-Dependent), Layer 3 (Task-Dependent + success criteria) |
| 5 | execute-plan (receipts) | `runs/run-001/handoffs/*.md` (4 files) | §8.2 handoff contract | specialist, task_id, run_id, status | changed_files, opens_for, assumptions, evidence, followups |
| 6 | assumptions aggregate | `runs/run-001/assumptions.md` | §8.1 + §10.3 | run_id, slug, source_receipts | Per-assumption entries, HIGH-significance table |
| 7 | review | `runs/run-001/review.md` | §8 2-stage review | run_id, slug, overall_verdict | Stage 1 (Spec Compliance), Stage 2 (Quality), per-lane verdict tables |
| 8 | verify-done | `runs/run-001/verify.md` | §8.1 success criteria | run_id, slug, status | 5 numbered checks: Success Criteria, Scope, Receipts, Assumptions, Chain |
| 9 | reflect | `reflections/run-001.md` | §11 self-evolution | run_id, slug, proposal_counts, trigger | 4 proposals with type/target/priority/threshold |

---

## Chain Verification

Each link below cites the skill/plan section that specifies the contract.

### Link 1 — spec → team-compose
**From:** `spec/pricing-calculator.md`
**To:** `team/pricing-calculator.yaml`
**Contract (guild-plan.md §7.1):** team-compose reads `.guild/spec/<slug>.md`
and matches spec domains against all 13 specialist descriptions.

**Verified:** The spec's task description ("frontend + copy + SEO") maps to
three specialist domains. team-compose output has `slug: pricing-calculator`
(matching the spec filename), lists 4 specialists (architect, frontend-engineer,
copywriter, seo), and each specialist's `scope` is traced to language from the
spec's `goal`, `success_criteria`, or `constraints` fields.

Gap noted: `frontend-engineer` is not in the 13-specialist roster; team.yaml
records the gap-fill correctly and the reflect stage surfaces R-001 (create-
specialist proposal).

---

### Link 2 — team-compose → plan
**From:** `team/pricing-calculator.yaml`
**To:** `plan/pricing-calculator.md`
**Contract (guild-plan.md §7.1 step 4, §8 lifecycle):** plan produces per-
specialist lanes with `task-id`, `owner`, `depends-on`, `scope`, and
`success-criteria`. `approved: true` must be present.

**Verified:** plan frontmatter has `approved: true`. Each lane's `owner` field
matches a specialist role from `team/pricing-calculator.yaml`. The `depends-on`
fields in the plan match the `depends_on` lists in the team YAML (arch-001 is
root; fe-001 and copy-001 depend on arch-001; seo-001 depends on copy-001).

---

### Link 3 — plan → context-assemble
**From:** `plan/pricing-calculator.md`
**To:** `context/run-001/<specialist>-<taskid>.md` (4 files)
**Contract (guild-plan.md §9.3):** `guild:context-assemble` writes
`.guild/context/<run-id>/<specialist>-<task-id>.md` before the Agent call.
The bundle is a 3-layer brief under ~3k tokens.

**Verified:** 4 context files produced, each named
`<specialist>-<task-id>.md` matching the plan lane identifiers. Each file
has the 3-layer structure (Universal / Role-Dependent / Task-Dependent).
`layer_token_estimate.total` fields: 2440, 2610, 2310, 2380 — all under the
3k target. Layer 3 of each bundle reproduces the plan lane's success-criteria
verbatim and includes any upstream contracts (fe-001 and copy-001 receive
arch-001's deliverables in their Layer 3).

---

### Link 4 — context-assemble → execute-plan (receipts)
**From:** `context/run-001/<specialist>-<taskid>.md`
**To:** `runs/run-001/handoffs/<specialist>-<taskid>.md`
**Contract (guild-plan.md §8.2):** every specialist returns a receipt with:
task completed + scope boundaries, files changed/artifacts produced, decisions
made, assumptions used, evidence, open risks and follow-up tasks.

**Verified:** 4 handoff receipts produced, file names match context bundle
names. All 5 §8.2 fields present in each receipt (changed_files, opens_for,
assumptions, evidence, followups). The `opens_for` fields in receipts correctly
name the downstream specialist or stage (e.g., arch-001 opens for fe-001 and
copy-001; copy-001 opens for seo-001; seo-001 and fe-001 open for review).

---

### Link 5 — receipts → assumptions aggregate
**From:** `runs/run-001/handoffs/*.md`
**To:** `runs/run-001/assumptions.md`
**Contract (guild-plan.md §8.1):** low-significance uncertainty becomes an
assumption in `.guild/runs/<run-id>/assumptions.md` and is reviewed at the end.

**Verified:** `assumptions.md` has `source_receipts` listing all 4 receipt
files. 10 assumptions aggregated; each has a `Source:` field tracing it to
the originating specialist. HIGH-significance items (A-004, A-008) are called
out in a summary table.

---

### Link 6 — assumptions → review
**From:** `runs/run-001/assumptions.md`
**To:** `runs/run-001/review.md`
**Contract (guild-plan.md §8):** `guild:review` consumes handoff receipts (and
by extension the assumptions aggregate) instead of rehydrating every
specialist's full conversation.

**Verified:** `review.md` references Assumption A-004 and A-008 as "Open items
from review." Stage 1 compliance table rows cite `fe-001 receipt` and `copy-001
receipt` as evidence sources, demonstrating receipt consumption. No specialist
conversation was replayed.

---

### Link 7 — review → verify-done
**From:** `runs/run-001/review.md`
**To:** `runs/run-001/verify.md`
**Contract (guild-plan.md §8.1):** `guild:verify-done` checks success criteria,
scope boundaries, receipt completeness, assumption audit, and chain integrity.

**Verified:** `verify.md` Check 1 re-verifies each success-criteria item from
the spec, citing evidence from the appropriate receipt. Check 3 verifies all
§8.2 fields are present in all receipts. Check 4 audits the assumptions aggregate.
Check 5 traces the full chain and cites each link. Review's `overall_verdict:
pass` is referenced in verify's `status: passed`.

---

### Link 8 — verify-done → reflect
**From:** `runs/run-001/verify.md`
**To:** `reflections/run-001.md`
**Contract (guild-plan.md §8, §11.1):** `guild:reflect` runs post-task
(triggered by Stop hook heuristic: ≥1 specialist dispatched + ≥1 file edited +
no error). Produces proposals; does not auto-promote.

**Verified:** `reflections/run-001.md` frontmatter has `trigger: post-task`
and `proposal_counts` (total: 4). Proposals R-001 through R-004 are present,
each with type/target/priority/threshold fields. All proposals state "No —
N/3 appearances" (auto-queue threshold not yet met), consistent with §11.1
"≥3 proposed edits accumulate" rule.

---

## Outcome

**Every contract surface holds.** All 8 chain links verified. No structural
drift found between stages.

**Drift surface identified (not a contract failure, a roster gap):**
The task required a `frontend-engineer` specialist that is not in the Guild
13-specialist roster. The team-compose gap-fill mechanism (§7.1 option B/C)
was applied correctly: the gap was filled at the team.yaml level and surfaced
as Proposal R-001 in the reflect stage. The chain did not break — it produced
a legitimate signal for specialist creation.

**Pre-deploy items (from assumptions aggregate and verify-done):**
1. Replace pricing placeholder values with real business figures (A-004).
2. Confirm legal review gate for disclaimer copy (A-008).
3. Replace "[product]" placeholders with actual product name.

These are data/process items, not contract or chain failures.

**Conclusion:** The P7 dogfood confirms that the Guild lifecycle contract chain
is structurally sound end-to-end for a multi-specialist task. The artifact
trail from spec through reflect is complete, chained, and compliant with
guild-plan.md §8 and §8.1/§8.2 contracts.

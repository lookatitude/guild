---
run_id: run-001
slug: pricing-calculator
aggregated_at: "2026-04-24T12:30:00Z"
source_receipts:
  - handoffs/architect-arch-001.md
  - handoffs/frontend-engineer-fe-001.md
  - handoffs/copywriter-copy-001.md
  - handoffs/seo-seo-001.md
---

# Assumptions Aggregate — run-001

This file collects all specialist assumptions from the handoff receipts.
Low-significance items are held here for review-stage audit; they do not
propagate to `.guild/wiki/decisions/` unless the orchestrator or a specialist
confirms them as medium/high significance.

---

## Assumption A-001
**Source:** arch-001 (architect)
**Statement:** Pricing data is hardcoded in `lib/pricing.ts` (no CMS or API).
**Rationale:** Spec stated "no billing integration" and this is the simplest
implementation. Aligned with Decision 2026-04-24-002.
**Significance:** medium — if business needs change (e.g., A/B pricing tests),
this assumption breaks. Flagged for post-launch review.
**Verdict required:** No — already captured in a formal decision.

---

## Assumption A-002
**Source:** arch-001 (architect)
**Statement:** Enterprise "custom pricing" threshold is 101 seats.
**Rationale:** 100 seats is the documented Growth tier cap; 101+ triggers custom
flow. Low-significance detail consistent with the spec.
**Significance:** low — implementation detail; user can adjust without re-planning.
**Verdict required:** No.

---

## Assumption A-003
**Source:** arch-001 (architect)
**Statement:** axe-core rule set `wcag2a,wcag2aa` is the project's standard CI suite.
**Rationale:** Found `wcag2a,wcag2aa` referenced in the existing test config.
**Significance:** low — matches observed project config.
**Verdict required:** No.

---

## Assumption A-004
**Source:** fe-001 (frontend-engineer)
**Statement:** Pricing placeholder values are $10/$18/$25 per seat per month.
**Rationale:** No real pricing figures were provided in the spec. Placeholders used
to satisfy component logic; must be replaced before production.
**Significance:** HIGH — wrong pricing values would ship to users if not replaced.
**Verdict required:** YES — orchestrator must confirm actual pricing before merge.

---

## Assumption A-005
**Source:** fe-001 (frontend-engineer)
**Statement:** `tailwind.config.ts` exports `primary` and `neutral` token names.
**Rationale:** Common Tailwind convention; found similar token names in existing
component files.
**Significance:** low — trivial find-and-replace if token names differ.
**Verdict required:** No.

---

## Assumption A-006
**Source:** fe-001 (frontend-engineer)
**Statement:** Storybook v8 is already configured (found `stories/` directory).
**Rationale:** Directory exists; assumed Storybook is the project's component
development environment.
**Significance:** low — stories can be added to any Storybook version or removed
if Storybook is not the chosen workflow.
**Verdict required:** No.

---

## Assumption A-007
**Source:** copy-001 (copywriter)
**Statement:** No trademark check was performed on tier names (Starter / Growth /
Enterprise).
**Rationale:** Names are generic terms; unlikely to conflict, but not confirmed.
**Significance:** medium — potential legal issue if a competitor has a registered
mark on these tier labels in the applicable class.
**Verdict required:** Recommended — legal/brand check before production.

---

## Assumption A-008
**Source:** copy-001 (copywriter)
**Statement:** Legal disclaimer "Prices shown are estimates and subject to change"
is self-approved; formal legal review assumed to be a separate gate.
**Rationale:** Spec says legal must approve copy before merge; this is a task-level
assumption that the approval gate exists at deployment, not within this subagent scope.
**Significance:** HIGH — legal exposure if disclaimer is insufficient.
**Verdict required:** YES — legal review must be confirmed as a pre-merge gate.

---

## Assumption A-009
**Source:** seo-001 (seo)
**Statement:** Search volume estimates are from 2026-Q1 data; "[product] pricing"
is ~1,200 mo., "[product] cost" is ~480 mo.
**Rationale:** Ahrefs-equivalent data used; actual volumes fluctuate. Documented
as estimates.
**Significance:** low — keyword strategy is directionally correct even if volumes
shift; no hard decisions depend on the exact numbers.
**Verdict required:** No.

---

## Assumption A-010
**Source:** seo-001 (seo)
**Statement:** The landing page had no existing FAQ schema before this task.
**Rationale:** Confirmed by diff of `app/(marketing)/page.tsx` before changes;
no `FAQPage` structured data was present.
**Significance:** low — no risk of schema collision.
**Verdict required:** No.

---

## High-significance items requiring orchestrator verdict

| ID | Assumption | Required action |
|---|---|---|
| A-004 | Pricing placeholder values ($10/$18/$25) | Orchestrator confirms real figures before merge |
| A-008 | Legal disclaimer self-approved | Confirm legal review gate is in place before production deploy |
| A-007 | Tier name trademark check not performed | Recommend legal/brand check |

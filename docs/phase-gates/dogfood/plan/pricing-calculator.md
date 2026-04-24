---
slug: pricing-calculator
run_id: run-001
approved: true
approved_at: "2026-04-24T09:15:00Z"
approved_by: orchestrator
specialist_count: 4
backend: subagent
---

# Plan — Pricing Calculator (run-001)

## Execution order

```
arch-001 (architect)
  ├── copy-001 (copywriter)   ← unblocked when arch-001 delivers tier structure
  │     └── seo-001 (seo)    ← unblocked when copy-001 delivers approved copy
  └── fe-001  (frontend-engineer) ← unblocked when arch-001 delivers component spec
```

Architect runs first. Frontend-engineer and copywriter run in parallel once
arch-001 is done. SEO runs after copywriter.

---

## Lane: arch-001 — Architect

| Field | Value |
|---|---|
| task-id | arch-001 |
| owner | architect |
| depends-on | — |
| scope | Design component tree; define TypeScript interfaces; specify lib/pricing.ts signature; write "client component / no SSR fetch" ADR; define axe-core acceptance contract |
| success-criteria | Component spec doc produced. TypeScript interfaces defined and exported from a single spec file. ADR committed to docs/. axe-core acceptance contract specified (list of rules + pass threshold). No implementation code written. |

### Deliverables
- `docs/phase-gates/dogfood/plan/arch/component-spec.md`
- `docs/phase-gates/dogfood/plan/arch/pricing-interfaces.ts` (interfaces only, no impl)
- `docs/phase-gates/dogfood/plan/arch/adr-pricing-client-component.md`

---

## Lane: fe-001 — Frontend Engineer

| Field | Value |
|---|---|
| task-id | fe-001 |
| owner | frontend-engineer |
| depends-on | arch-001 |
| scope | Implement PricingCalculator component tree per arch-001 spec. Wire lib/pricing.ts. Apply Tailwind tokens. Integrate into landing page. Run axe-core (0 critical) and Lighthouse (LCP < 2.5 s, CLS < 0.1). |
| success-criteria | All components render in Storybook. Landing page renders calculator below tier table. axe-core: 0 critical violations. Lighthouse: LCP < 2.5 s, CLS < 0.1. Component bundle ≤ 8 kB gzip. Unit tests for lib/pricing.ts pass (100 % branch coverage on calculation logic). |

### Deliverables
- `components/pricing/PricingCalculator.tsx` (and sub-components)
- `lib/pricing.ts` + `lib/pricing.test.ts`
- Updated `app/(marketing)/page.tsx` (landing page integration)
- Axe-core scan output (in handoff receipt evidence)
- Lighthouse score output (in handoff receipt evidence)

---

## Lane: copy-001 — Copywriter

| Field | Value |
|---|---|
| task-id | copy-001 |
| owner | copywriter |
| depends-on | arch-001 |
| scope | Write tier headlines, tier descriptions, seat helper text, CTA labels per tier, legal disclaimer. Follow voice guide. |
| success-criteria | Copy deck covers every component slot identified in arch-001 spec. Each tier description ≤ 60 words. Legal disclaimer present. No superlatives. Voice guide compliance confirmed by self-review. |

### Deliverables
- `docs/copy/pricing-calculator-copy-deck.md` — structured by component slot

---

## Lane: seo-001 — SEO Specialist

| Field | Value |
|---|---|
| task-id | seo-001 |
| owner | seo |
| depends-on | copy-001 |
| scope | Keyword research (3–5 mid-funnel terms). Update title tag and meta description. Author FAQ JSON-LD (top 3 pricing questions). Validate structured data. |
| success-criteria | Keyword rationale documented with estimated monthly search volume. Title tag updated and within 60 characters. Meta description updated and within 160 characters. FAQ JSON-LD validates without errors in structured-data testing. Primary keyword present in both title and meta. |

### Deliverables
- `docs/seo/pricing-calculator-keyword-research.md`
- Updated `app/(marketing)/page.tsx` `<Head>` metadata (or Next.js metadata export)
- `components/pricing/PricingFaqSchema.tsx` — JSON-LD component

---

## Assumptions captured pre-plan

1. A `frontend-engineer` specialist is not in the current Guild roster (13
   shipped specialists do not include a dedicated frontend role). The copywriter
   and architect cover the majority; the frontend lane is labelled
   `frontend-engineer` as a gap-fill. This assumption is flagged for the
   reflect stage.
2. The landing page is a Next.js 14 App Router project with Tailwind; no
   confirmation received — treated as a constraint from the spec.
3. "Pricing values" (actual dollar amounts) are not defined in this task scope;
   the calculator uses placeholder values for demonstration purposes.

---

## Out-of-scope (confirmed non-goals)

- Stripe or live billing integration
- Admin tier-editing UI
- Currency localisation
- A/B testing harness

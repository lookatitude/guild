---
specialist: frontend-engineer
task_id: fe-001
run_id: run-001
assembled_at: "2026-04-24T10:00:00Z"
layer_token_estimate:
  universal: 390
  role_dependent: 980
  task_dependent: 1240
  total: 2610
---

# Context Bundle — frontend-engineer · fe-001

## Layer 1: Universal (guild:principles + project overview + goals)

### Guild Principles (mandatory prelude)
1. Think before doing — state assumptions, surface ambiguity, present tradeoffs.
2. Simplicity first — minimum artifact, no speculative scope.
3. Surgical changes — every line traces to the request; match existing style.
4. Goal-driven execution — verifiable success criteria; loop until met.
5. Evidence over claims — a test, diff, metric, screenshot, or review — not assertion.

### Project Overview
B2B SaaS landing page built with Next.js 14 (App Router), TypeScript strict,
Tailwind CSS. The pricing calculator is a new self-contained section added
below the existing static tier table.

### Goals
- Calculator renders correctly on desktop and mobile (≥ 375 px viewport).
- Real-time price update (no page reload) when tier or seat count changes.
- LCP < 2.5 s, CLS < 0.1 maintained after the new section ships.
- axe-core: 0 critical violations.

---

## Layer 2: Role-Dependent (coding standards + products)

### Coding Standards
- TypeScript strict; no `any`.
- React: hooks only; `"use client"` at smallest interactive subtree.
- Tailwind: design tokens from `tailwind.config.ts`; no arbitrary values.
- Component subtree bundle ≤ 8 kB gzip.
- Unit tests with Vitest; axe-core integration test via `@axe-core/react`.

### Landing Page Product Context
- File: `app/(marketing)/page.tsx` — primary marketing landing page.
- Existing sections (do not modify): hero, feature grid, social proof, tier
  comparison table, final CTA.
- Insert point: new `<PricingCalculator />` section immediately below
  `<TierComparisonTable />`.

---

## Layer 3: Task-Dependent (specialist lane + upstream contracts from arch-001)

### Your Lane (fe-001)
Implement the pricing calculator per the architect's component spec. Wire
`lib/pricing.ts` for real-time computation. Integrate into landing page.
Run axe-core and Lighthouse scans.

### Upstream Contract from arch-001
The architect delivered:
- Component tree: `PricingCalculator` > `TierSelector` + `SeatInput` +
  `PriceDisplay` + `CallToAction`.
- Interfaces: `PricingTier`, `PricingConfig`, `PriceBreakdown` (see
  `docs/phase-gates/dogfood/plan/arch/pricing-interfaces.ts`).
- lib/pricing.ts signature:
  ```typescript
  export function calculatePrice(tier: PricingTier, seats: number): PriceBreakdown;
  ```
- Axe-core contract: run `axe-core` rules set `wcag2a,wcag2aa`; 0 critical
  violations required.

### Active decisions
- Decision 2026-04-24-001: Section below tier table (not modal/overlay).
- Decision 2026-04-24-002: Pricing hardcoded in lib/pricing.ts; no API call.
- Decision 2026-04-24-003: Enterprise tier shows "Custom pricing — book a
  demo" when seats > 100; no numeric estimate rendered.

### Success criteria for fe-001
- All components render in Storybook stories.
- Landing page shows calculator below tier table.
- axe-core: 0 critical violations (scan output in handoff receipt).
- Lighthouse: LCP < 2.5 s, CLS < 0.1 (scores in handoff receipt).
- Component bundle ≤ 8 kB gzip (bundle analysis output in receipt).
- lib/pricing.ts unit tests pass with 100 % branch coverage.

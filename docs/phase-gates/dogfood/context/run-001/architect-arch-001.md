---
specialist: architect
task_id: arch-001
run_id: run-001
assembled_at: "2026-04-24T09:20:00Z"
layer_token_estimate:
  universal: 390
  role_dependent: 950
  task_dependent: 1100
  total: 2440
---

# Context Bundle — architect · arch-001

## Layer 1: Universal (guild:principles + project overview + goals)

### Guild Principles (mandatory prelude)
1. Think before doing — state assumptions, surface ambiguity, present tradeoffs.
2. Simplicity first — minimum artifact, no speculative scope.
3. Surgical changes — every line traces to the request; match existing style.
4. Goal-driven execution — verifiable success criteria; loop until met.
5. Evidence over claims — a test, diff, metric, screenshot, or review — not assertion.

### Project Overview
Guild is a Claude Code plugin providing self-composing specialist agent teams.
The landing page is the primary acquisition surface. The product is a B2B SaaS
platform targeting startup and SMB segments.

### Project Goals
- Reduce top-of-funnel friction by enabling self-service cost estimation.
- Maintain sub-2.5 s LCP and < 0.1 CLS on the landing page.
- Keep accessibility at 0 critical axe-core violations.

---

## Layer 2: Role-Dependent (coding standards + architecture concepts)

### Coding Standards (excerpt)
- TypeScript strict mode; no `any`.
- React: functional components + hooks only; no class components.
- Next.js 14 App Router conventions: server components by default, `"use
  client"` only at the leaf that needs browser APIs or interactivity.
- File naming: PascalCase for components, camelCase for utilities.
- Tailwind: use design tokens from `tailwind.config.ts`; no arbitrary values
  unless tokens are absent.
- Bundle budget: new component subtrees ≤ 8 kB gzip.

### Relevant Architectural Concepts
- **Client-component boundary** — mark `"use client"` at the smallest subtree
  that requires interactivity to minimise SSR overhead.
- **Pure utility pattern** — pricing calculation logic must live in a framework-
  agnostic `lib/pricing.ts` so it can be unit-tested without React.
- **Accessibility contract** — axe-core enforced in CI; architect specifies
  the rule set and pass threshold in the component spec.

---

## Layer 3: Task-Dependent (specialist lane from plan + upstream contracts)

### Your Lane (arch-001)
Design the pricing calculator component tree. Produce:
1. Component spec doc — names, props, responsibilities, directory layout.
2. TypeScript interfaces: `PricingTier`, `PricingConfig`, `PriceBreakdown`.
3. `lib/pricing.ts` function signature (no implementation).
4. ADR: "Why client component with no SSR fetch."
5. Axe-core acceptance contract: which rules, pass threshold (0 critical),
   how frontend-engineer runs the scan.

**No implementation code.** Scope ends at spec + interfaces + ADR.

### Upstream contracts (none — arch-001 is the root dependency)

### Active decisions touching this domain
- Decision 2026-04-24-001: Calculator is a standalone section inserted below
  the existing tier table, not a modal or overlay (avoids z-index and focus-
  trap complexity).
- Decision 2026-04-24-002: Pricing data is hardcoded in `lib/pricing.ts` for
  this iteration (no CMS or API fetch). Reduces complexity; revisit in P2.

### Success criteria for arch-001
- Component spec doc produced and covers all four sub-components.
- TypeScript interfaces exported from a single spec file.
- ADR committed to docs/.
- Axe-core acceptance contract specified.
- No implementation code written.

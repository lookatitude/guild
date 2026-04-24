---
goal: >
  Add an interactive pricing calculator to the product landing page so visitors
  can self-serve an estimated monthly cost before booking a demo, reducing
  friction in the top-of-funnel conversion flow.
audience: >
  Prospective B2B customers (startup and SMB segment) who land on the product
  homepage and want to understand cost before committing to a sales call.
success_criteria:
  - Calculator renders correctly on desktop and mobile (≥ 375 px viewport).
  - Visitor can select a tier (Starter / Growth / Enterprise) and adjust seat
    count; estimated price updates in real time (no page reload).
  - Page load regression: LCP and CLS remain within existing Lighthouse budget
    (LCP < 2.5 s, CLS < 0.1).
  - Copy clearly conveys value differentiators per tier without legal risk.
  - Title tag, meta description, and structured-data (FAQ schema) updated to
    reflect the new pricing section.
  - Accessibility: calculator passes axe-core with 0 critical violations.
non_goals:
  - Live billing integration or Stripe checkout (out of scope for this phase).
  - Admin UI for editing pricing tiers (hardcoded per this iteration).
  - Localisation / currency conversion beyond USD.
  - A/B variant testing (can be layered on by marketing post-launch).
constraints:
  - Stack: React + TypeScript; Tailwind CSS; Next.js 14 (App Router).
  - Brand: colours, fonts, and tone must follow existing design tokens and
    voice guide.
  - Legal: pricing copy must be reviewed/approved by copywriter before merge;
    no implied guarantees.
  - SEO: structured-data changes must not break existing rich results.
  - Timeline: ship within 2-week sprint.
autonomy_policy:
  may_do_without_asking:
    - Choose component structure within the established /components/pricing/
      directory convention.
    - Add/adjust Tailwind utility classes consistent with existing design tokens.
    - Select and wire up accessible HTML patterns (e.g., role="group" on
      input clusters).
    - Update meta description if current one is below 120 characters.
  requires_confirmation:
    - Any change to the existing pricing tiers or pricing values shown.
    - Naming or branding language that departs from the approved voice guide.
    - Adding a new npm dependency with > 5 kB gzip footprint.
    - Any structured-data schema not already in use on the page.
  forbidden:
    - Committing any Stripe or payment-API keys.
    - Removing or substantially altering existing landing-page sections.
    - Deploying to production without QA sign-off.
risks:
  - Pricing copy could create implicit commitments; mitigation: copywriter
    review gate before merge.
  - Bundle size increase from calculator logic could hurt LCP; mitigation:
    architect scopes to < 8 kB gzip for the component subtree.
  - SEO structured-data errors can demote rich results; mitigation: seo
    specialist validates JSON-LD with Google's Rich Results Test equivalent.
  - Accessibility regressions if form controls are poorly labelled; mitigation:
    architect includes axe-core scan in acceptance criteria.
---

# Pricing Calculator — Landing Page

## Background

The product currently shows static pricing cards with a CTA to "Book a demo."
Conversion data shows that 60 % of visitors who reach the pricing section do
not proceed to the demo form. User interviews surfaced a recurring theme: "I
just want to know roughly what it will cost before I talk to anyone."

An interactive calculator directly addresses this drop-off by letting visitors
explore costs without any sales interaction.

## What we are building

A self-contained pricing calculator section inserted below the existing tier
comparison table on the landing page. The calculator consists of:

1. **Tier selector** — radio group or segmented control: Starter / Growth /
   Enterprise (with brief differentiator per tier).
2. **Seat slider / input** — adjustable from 1 to 500 seats; Enterprise unlocks
   a "custom" label above 100.
3. **Real-time price estimate** — live-calculated monthly total displayed
   prominently, with a per-seat breakdown.
4. **CTA** — "Start free trial" (Starter) or "Book a demo" (Growth /
   Enterprise); wired to existing conversion paths.

## Copy requirements

Each tier headline and description follows the approved voice guide: confident,
specific, no superlatives. Legal must not read as a binding quote — a
"Prices shown are estimates and subject to change" disclaimer is required.

## SEO integration

The pricing section will carry an FAQ schema block answering the three most
common pricing questions surfaced by keyword research (§ seo lane). The page
title and meta description are to be updated to include "pricing" for
mid-funnel keyword capture.

## Frontend architecture

The calculator is a client component (`"use client"`) with no server-side data
fetch at render time. Pricing logic lives in a pure TypeScript utility
(`lib/pricing.ts`) with unit tests. The component tree stays under `.guild/`'s
8 kB gzip budget for incremental page weight.

## Acceptance

The task is done when all items in `success_criteria` above are verifiably met
and the specialist handoff receipts are complete.

---
specialist: seo
task_id: seo-001
run_id: run-001
assembled_at: "2026-04-24T11:30:00Z"
layer_token_estimate:
  universal: 390
  role_dependent: 910
  task_dependent: 1080
  total: 2380
---

# Context Bundle — seo · seo-001

## Layer 1: Universal (guild:principles + project overview + goals)

### Guild Principles (mandatory prelude)
1. Think before doing — state assumptions, surface ambiguity, present tradeoffs.
2. Simplicity first — minimum artifact, no speculative scope.
3. Surgical changes — every line traces to the request; match existing style.
4. Goal-driven execution — verifiable success criteria; loop until met.
5. Evidence over claims — data citation (search volume, structured-data test
   result, current ranking), not assertion.

### Project Overview
B2B SaaS product. Landing page is the primary acquisition surface. Adding a
pricing calculator section — an opportunity to capture mid-funnel keyword
traffic from users searching "[product] pricing" and "[product] cost".

### Goals
- Capture mid-funnel organic traffic with pricing-intent keywords.
- Maintain existing rich-result eligibility.
- Title and meta description updated to reflect new pricing section.

---

## Layer 2: Role-Dependent (SEO rules + branding)

### SEO Rules (excerpt from standards/seo-rules.md)
- Title tag: primary keyword near the front; 50–60 characters.
- Meta description: 140–160 characters; include CTA phrase.
- Structured data: use JSON-LD in a `<script>` tag, not microdata.
- FAQ schema: `FAQPage` type; questions must match copy on page.
- Do not duplicate FAQ questions already answered in existing structured data.
- Validate with Google Rich Results Test equivalent before shipping.

### Branding
- Product name must appear in title and meta exactly as trademarked.
- Pricing claims in structured data must use the same disclaimer wording
  approved by copywriter.

---

## Layer 3: Task-Dependent (specialist lane + upstream contracts from copy-001)

### Your Lane (seo-001)
1. Research 3–5 mid-funnel pricing keywords.
2. Update page title tag and meta description.
3. Author FAQ JSON-LD for the top 3 pricing questions.
4. Validate structured data (error-free).

### Upstream Contract from copy-001
Approved copy deck available at `docs/copy/pricing-calculator-copy-deck.md`.
- Tier names confirmed: Starter / Growth / Enterprise.
- Legal disclaimer wording confirmed (use verbatim in FAQ schema answers
  where pricing figures are mentioned).
- CTA language confirmed (use for meta description CTA phrase).

### Active decisions
- Decision 2026-04-24-006: FAQ schema covers three questions:
  (1) "How is pricing calculated?" (2) "Is there a free trial?"
  (3) "What is included in the Enterprise plan?"
- Decision 2026-04-24-007: Primary keyword target is "[product] pricing"
  (estimated 1,200 monthly searches); secondary is "[product] cost"
  (estimated 480 monthly searches).

### Success criteria for seo-001
- Keyword rationale doc includes estimated monthly search volumes.
- Title tag updated, ≤ 60 chars, contains primary keyword.
- Meta description updated, 140–160 chars, contains primary keyword and CTA.
- FAQ JSON-LD valid — structured-data test output included in handoff receipt.
- No existing rich-result markup removed.

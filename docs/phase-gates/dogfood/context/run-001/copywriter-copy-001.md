---
specialist: copywriter
task_id: copy-001
run_id: run-001
assembled_at: "2026-04-24T10:00:00Z"
layer_token_estimate:
  universal: 390
  role_dependent: 870
  task_dependent: 1050
  total: 2310
---

# Context Bundle — copywriter · copy-001

## Layer 1: Universal (guild:principles + project overview + goals)

### Guild Principles (mandatory prelude)
1. Think before doing — state assumptions, surface ambiguity, present tradeoffs.
2. Simplicity first — minimum artifact, no speculative scope.
3. Surgical changes — every line traces to the request; match existing style.
4. Goal-driven execution — verifiable success criteria; loop until met.
5. Evidence over claims — a sample the user can scan, not "it reads well."

### Project Overview
B2B SaaS product, startup/SMB audience. The pricing calculator section needs
copy that helps visitors self-qualify and feel confident proceeding to sign-up
or demo booking.

### Goals
- Copy conveys value differentiators per tier clearly.
- No legally risky implied commitments.
- CTA copy matches the conversion path for each tier.

---

## Layer 2: Role-Dependent (writing voice + branding)

### Writing Voice (excerpt from standards/writing-voice.md)
- Tone: confident, direct, specific. Avoid hedging and superlatives.
- Sentence length: short to medium. Active voice preferred.
- Audience: technical decision-makers and founders; no need to define
  SaaS basics.
- Numbers: use specific figures where available; avoid "many" or "lots".

### Branding (excerpt from standards/branding.md)
- Product name: always capitalised as per trademark registration.
- Colour palette: not relevant to copy; noted for design handoff.
- Legal constraint: pricing copy must include disclaimer that prices are
  estimates and subject to change.

### Product Context — Pricing Tiers
Three tiers: Starter / Growth / Enterprise. Key differentiators:
- Starter: up to 10 seats, core features, community support.
- Growth: up to 100 seats, advanced features, email support.
- Enterprise: 100+ seats, full feature set, dedicated success manager, SLA.

---

## Layer 3: Task-Dependent (specialist lane + upstream contracts from arch-001)

### Your Lane (copy-001)
Write all copy for the pricing calculator component slots identified in
the architect's spec:
1. Tier headline (≤ 8 words each).
2. Tier description (≤ 60 words each).
3. Seat input helper text (≤ 15 words).
4. CTA label per tier (≤ 5 words).
5. Legal disclaimer (≤ 25 words).

### Upstream Contract from arch-001
Component slots requiring copy:
- `TierSelector`: headline + short description per tier.
- `SeatInput`: helper text below input.
- `CallToAction`: button label per tier.
- `PriceDisplay`: optional "from" prefix text (if used).
- Footer of calculator block: legal disclaimer.

### Active decisions
- Decision 2026-04-24-004: CTA for Starter tier is "Start free trial" (not
  "Book a demo") because Starter is self-serve.
- Decision 2026-04-24-005: Legal disclaimer is displayed as small print
  below the price display, not hidden in a tooltip.

### Success criteria for copy-001
- Copy deck covers every component slot.
- Each tier description ≤ 60 words.
- Legal disclaimer present and accurate.
- No superlatives (check: "best", "fastest", "most powerful" must be absent).
- Voice guide compliance — self-review checklist completed and documented
  in handoff receipt.

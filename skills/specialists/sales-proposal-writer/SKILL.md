---
name: sales-proposal-writer
description: Writes sales proposals — scope, deliverables, pricing, terms, assumptions, decision criteria, and clear next steps. Pulled by the `sales` specialist. TRIGGER: "write a proposal for <account>", "draft the SOW / proposal for the Acme deal", "build the pricing + scope proposal", "write the renewal / expansion proposal", "draft the decision-criteria summary in the proposal", "put together the commercial proposal for <prospect>". DO NOT TRIGGER for: cold outreach before qualification (use `sales-cold-outreach`), discovery framework (use `sales-discovery-framework`), post-proposal follow-up cadence (use `sales-follow-up-sequence`), technical API documentation or integration guide (use `technical-writer-api-docs` / `technical-writer-tutorial`), contract redlines and MSA terms (legal, not this skill), launch or campaign planning (marketing group).
when_to_use: The parent `sales` specialist pulls this skill when the task is producing a written proposal a qualified buyer will read to make a purchase decision. Also fires on explicit user request.
type: specialist
---

# sales-proposal-writer

Implements `guild-plan.md §6.3` (sales · proposal-writer) under `§6.4` commercial principles: hypothesis-first (what decision criteria does this buyer use, and do we address each?), success = proposal acceptance rate and cycle-time, evidence = win/loss notes tied to proposal content — not page count.

## What you do

Produce a proposal the buyer can forward to procurement and a skeptical exec without needing a verbal translation. Proposals are decision documents, not brochures. Every section earns its place by answering a question the buyer will actually ask.

- Pull discovery notes — pain, impact, decision criteria, timeline, decision-maker map. Skip this and the proposal is generic.
- Open with the buyer's business outcome, in their words — not the vendor's product pitch.
- Scope: bounded deliverables, explicit assumptions, explicit exclusions. Ambiguity here becomes implementation pain later.
- Pricing: clear structure (seats / usage / fixed / tiered), what's included, what's not, payment terms, term length.
- Decision criteria mirror: restate the buyer's criteria from discovery and show how each is met.
- Risks / mitigations: be honest about integration risk, change-management risk, ramp. Procurement respects this.
- Next steps: named people, named dates, named signatures. A proposal without a close path drifts.
- Appendices for depth (SLAs, security, technical architecture) — for dense technical content, hand off to `technical-writer` group.

## Output shape

A markdown file at `.guild/runs/<run-id>/sales/proposal-<slug>.md` with sections:

1. **Executive summary** — buyer outcome, proposed approach, price, term — one page.
2. **Context** — what we heard in discovery (buyer's own framing).
3. **Scope** — deliverables, assumptions, exclusions.
4. **Pricing + terms** — structure, totals, payment, term length.
5. **Decision criteria** — their criteria → our response.
6. **Risks + mitigations** — top 3–5.
7. **Timeline** — kickoff → milestones → value realization.
8. **Next steps** — who signs what by when.
9. **Appendices** — security, SLAs, integrations (or hand off to technical-writer).

## Anti-patterns

- Jargon-heavy language the buyer won't repeat internally — kills internal selling.
- Vague deliverables ("strategic partnership") — procurement rejects, or worse, accepts and scope-creeps.
- Missing decision criteria mirror — buyer thinks we didn't listen.
- No pricing clarity — "contact us" belongs on a website, not a proposal.
- Silent on risk — reads as naive or dishonest to a senior buyer.
- 40-page novels — exec buyers read the first page and the price. Put the executive summary first.
- Missing next-step close — proposal becomes a reference document, not a decision prompt.

## Handoff

Return the proposal path to the invoking `sales` specialist. Downstream, send-and-review hands to `sales-follow-up-sequence`; dense technical appendices (integration architecture, API coverage, security whitepaper) hand to `technical-writer-api-docs` / `technical-writer-user-manual`; internal legal review is out of scope for this skill. If the proposal exposes a positioning or pricing gap, flag back to `marketing-positioning`. This skill does not dispatch.

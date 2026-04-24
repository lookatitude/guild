---
name: security-threat-modeling
description: Runs a STRIDE-style threat model on a component — assets, entry points, trust boundaries, threats, mitigations — with each threat anchored to an owner and a ticket. Output: `threat-model.md` with the full asset / boundary / threat table. Pulled by the `security` specialist. TRIGGER: "threat-model the new X", "STRIDE analysis of the X service", "run a threat model on X", "identify the attack surface of X", "what are the security threats to X", "map trust boundaries for X". DO NOT TRIGGER for: scanning dependencies for CVEs (use `security-dependency-audit`), auditing an auth flow (use `security-auth-flow-review`), scanning repo for secrets (use `security-secrets-scan`), general architecture design (architect-systems-design), incident response playbook (devops-incident-runbook), compliance checklist only.
when_to_use: The parent `security` specialist pulls this skill when the task requires a structured threat model of a component, service, or feature. Also fires on explicit user request.
type: specialist
---

# security-threat-modeling

Implements `guild-plan.md §6.1` (security · threat-modeling) under `§6.4` engineering principles: the threat model is evidence that risk was reasoned about; each threat exits the doc as a ticket with an owner, not a line item in a PDF.

## What you do

Structure a threat model that ends in commitments, not observations. STRIDE (Spoofing, Tampering, Repudiation, Info-disclosure, DoS, Elevation) is the default lens; switch to LINDDUN or PASTA if the context demands (privacy-heavy, attacker-driven).

- Enumerate assets by value: PII, money, credentials, service availability — rank them.
- Map entry points: every endpoint, queue, file upload, admin console, background job, SDK call.
- Draw trust boundaries explicitly: data crossing a boundary is the first place to attack.
- Walk STRIDE per entry point; record threat · likelihood · impact · existing control · gap.
- For each unmitigated threat, assign an owner and open a ticket referenced in the doc.
- Revisit triggers: when the feature changes, when a new dependency ships, quarterly.

## Output shape

A markdown file `threat-model.md`:

1. **Scope** — component(s) in scope, explicit out-of-scope.
2. **Assets** — data / capability / service with value ranking.
3. **Entry points** — every external-facing surface.
4. **Trust boundaries** — diagram or list, with what crosses each.
5. **Threats** — STRIDE table: threat · likelihood · impact · control · owner · ticket.
6. **Mitigation plan** — prioritized list with owners and dates.
7. **Review cadence** — when this gets re-examined.

## Anti-patterns

- Generic checklist with no asset context — reads the same for every service.
- No asset valuation — every threat looks equally important, nothing ships.
- No follow-through: threats logged but no tickets — the doc rots on a wiki.
- Rubber-stamp STRIDE with "N/A" on every row — model exists on paper, not in practice.
- Missing trust boundaries — internal == external is the most common pre-breach mistake.
- One-shot mentality — no plan for re-review when the component evolves.

## Handoff

Return the threat-model path to the invoking `security` specialist. Surfaced gaps typically chain into `security-dependency-audit`, `security-auth-flow-review`, or `security-secrets-scan`; implementation of mitigations is handed to the owning service specialist. This skill does not dispatch.

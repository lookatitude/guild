---
type: decision
owner: architect
confidence: high
importance: high
source_refs: [".guild/runs/v2-final/20-design-dossier.md#L141-L142", ".guild/runs/v2-final/20-design-dossier.md#L200", ".guild/runs/v2-final/DECISIONS-LOCKED.md#L40"]
created_at: 2026-05-17
updated_at: 2026-05-17
expires_at: null
supersedes: null
superseded_by: ["di1-di6-contracts"]
sensitivity: internal
applies_to: [plugin]
related: [lifecycle-overview, phase-entrypoints, command-clean-slate]
---

# ADR: Quality / Operations asymmetry (D-Q1 / OQ6)

> **SUPERSEDED — 2026-05-17 (DI promotion).** The asymmetry this ADR records
> is **resolved**: both Quality and Operations are now full first-class
> `[v2]` skills. Per `DECISIONS-LOCKED.md` **DI-2** (Quality promoted from
> verify-done-extended/gap-report-only to a full `guild:quality` skill —
> E2E/smoke/a11y/perf/integration auto-select + execute; no more v2.x banner)
> and **DI-3** (Operations promoted from reserved `[v2-contract-only]` notice
> to a full `guild:operations` skill — release/monitoring/incident/rollback/
> maintenance runbooks, split autonomy; no longer reserved). The
> Quality-has-a-fallback / Operations-has-no-fallback asymmetry no longer
> exists — neither phase is a fallback. See
> [`di1-di6-contracts.md`](di1-di6-contracts.md) for the binding superseding
> contract. The decision text below is retained as the immutable ADR record
> of the pre-DI state.

## Status

Superseded by [`di1-di6-contracts.md`](di1-di6-contracts.md) (2026-05-17, DI
promotion). Originally Accepted (2026-05-17): the asymmetry between the
Quality and Operations phases in v2 was **intentional and documented** — that
premise no longer holds after DI-2/DI-3 promoted both to full `[v2]` skills.

## Context

G2 defers full first-class Quality/Operations skills to v2.x. But the two
phases need different v2 treatments: Quality has a usable fallback
(`verify-done`); Operations does not.

## Decision

- **Quality — `/guild qa` ships [v2].** Backed by the `verify-done`
  **extended profile = gap-reporting only** (no E2E *invocation* in v2; full
  E2E execution is the v2.x `guild:quality` skill). Output and
  `lifecycle-overview.md` carry an explicit v2.x banner. (OQ6: gap-reporting
  only — honest partial, avoids phantom-phase trust loss.)
- **Operations — `/guild ops` reserved [v2-contract-only].** Prints an honest
  v2.x notice and routes to `guild:decisions` / `guild:wiki-ingest` manual
  capture. **No fallback skill.** The asymmetry vs Quality (Quality has a
  gap-report fallback, Operations does not) is intentional and documented.
- Verb is **`ops`** per the U2 OVERRIDE, never `ship`.

## Consequences

- Mandatory gates add: qa release/blocker, ops risky-change.
- `lifecycle-overview.md` documents both the v2.x banner (Quality) and the
  reserved-notice-with-no-fallback (Operations), and states the asymmetry is
  deliberate so reviewers do not file it as a gap.

> The Consequences above describe a pre-DI state superseded by the DI
> promotion: `lifecycle-overview.md` now documents Quality and Operations
> as symmetric full `[v2]` skills (no v2.x banner, no reserved-notice).
> The mandatory qa-release/ops-risky-change gates persist; only the
> deferral framing was removed. See `## Changelog` below for the
> dated history.

## Changelog

- **2026-05-17 — v2 — DI adv-r1 fix (diagrams/decisions).** Marked
  `Superseded` by [`di1-di6-contracts.md`](di1-di6-contracts.md);
  added `superseded_by` frontmatter, top supersession banner, and a
  pre-DI-state note on Consequences. DI-2/DI-3 (per
  `.guild/runs/v2-final/DECISIONS-LOCKED.md`) promote Quality and Operations
  to full first-class `[v2]` skills, resolving the asymmetry this ADR
  recorded. Decision text retained per append-only ADR history.

---
type: decision
status: accepted
owner: plugin-architect
confidence: high
importance: medium
applies_to: [plugin]
decision_id: v3fu-W2-host-event
initiative: v3-followups
source_refs:
  - "plugin src/adapters/host-event-normalizer.ts:48 (guild.normalized_host_event.v1)"
  - "plugin src/domains/distribution/result-contracts-v2.ts (legacy validator registry)"
  - "plugin .guild/artifacts/reports/v3-legacy-G09.html row 4"
created_at: 2026-10-18
updated_at: 2026-10-18
expires_at: null
sensitivity: internal
---

# Supersession: `guild.host_event.v1` -> `guild.normalized_host_event.v1`

The live host-event path normalizes through the adapter boundary into
`guild.normalized_host_event.v1` (src/adapters/host-event-normalizer.ts); the
legacy `guild.host_event.v1` id survives only as a validator-registry entry
with no producer. This page formalizes the supersession-in-fact (G09 row
host_event): the legacy id is retired vocabulary. Docs listing current wire
schemas must name `guild.normalized_host_event.v1`; the legacy validator stays
only as a fail-closed normalizer for archived records.

---
type: decision
status: accepted
owner: plugin-architect
confidence: high
importance: medium
applies_to: [plugin]
decision_id: v3fu-W2-install-channel
initiative: v3-followups
source_refs:
  - "plugin install.sh:544 (renders dist on demand via build-host-packages)"
  - "plugin .claude-plugin/marketplace.json (source './' — authored root)"
  - "plugin .guild/artifacts/reports/v3-legacy-G07.html row 1"
created_at: 2026-10-18
updated_at: 2026-10-18
expires_at: null
sensitivity: internal
---

# Supersession: the v2 "flip marketplace to committed dist" never shipped

The v2 plan to repoint `.claude-plugin/marketplace.json` at a committed
`dist/` tree is formally superseded. The live install-channel model is: the
native marketplace installs from the authored root (`source: './'`), and
`install.sh` renders per-host `dist/` packages on demand
(`build-host-packages --out dist`); `dist/` is NOT committed. The flip is not
pending work — the projection model (KTD28) replaced it. G07 row 1 recorded
the supersession-in-fact; this page is the ratified record.

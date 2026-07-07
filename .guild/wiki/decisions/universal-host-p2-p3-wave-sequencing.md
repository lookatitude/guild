---
type: decision
owner: user
confidence: high
source_refs: ["<HIGH_ENTROPY_REDACTED>-host-plugin-architecture.md"]
created_at: 2026-06-17
updated_at: 2026-06-17
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-06-17
asker: user
task: universal-host-p2
category: architecture
---
# universal-host-p2-p3-wave-sequencing

## Context
With P0+P1 of the universal-host-plugin-architecture initiative closed (steps 1–11,
verify PASS), the operator directed "plan and finish P2 and P3" — ADR migration steps
12–19. That is a large, multi-subsystem program touching every dev-team agent and
including a high-risk package cutover (step 15 retires the committed `.claude-plugin`
canonical package in favor of the generated `dist/` tree). v2.0.0 is currently HELD on
`release/v2.0.0` for operator acceptance testing, and the operator's local plugin is a
**live symlink** to this working tree — so retiring the canonical package mid-hold would
destabilize both the held release and the live install. How to sequence + when to cut over?

## Options considered
- A: 3 waves — W1 steps 12–14 (additive product-<HIGH_ENTROPY_REDACTED>), W2 steps 15–17
  (generation cutover core), W3 steps 18–19 (templates/dashboard + installer/docs).
- B: 2 waves — W1 = 12–14+18 (additive subsystems), W2 = 15–17+19 (cutover + installer).
- C: strict ADR numeric order as one program.
- Cutover timing: (i) defer step-15 channel flip until after v2.0.0 ships; (ii) cut over now.

## Decision
**A (3 waves)** + **cutover timing (i) DEFER** (operator, 2026-06-17). Finish 12–19 as three
sequential Guild build runs — each its own spec→plan→build→review→verify. Step 15's
`.claude-plugin`→`dist/` install-channel flip is **deferred until after v2.0.0 ships to main
from the held release**: Wave 2 builds the source-plus-transformer pipeline and proves `dist/`
parity but keeps `.claude-plugin` as the installed canonical; the channel flip is a
post-v2.0.0 follow-up.

## Consequences
- Wave 1 (steps 12–14) starts now: product-loop intake classifier + explore/define
  contracts; workspace dependency-graph + impact detector; host-aware config aliases +
  per-host config rendering. All additive / behavior-preserving — no install-channel change.
- Wave 2 (15–17) and Wave 3 (18–19) follow as their own runs; Wave 2 stops short of the
  channel flip (parity-proven `dist/`, canonical unchanged) per the deferral.
- The initiative stays `execution_status: active` until the full ADR Definition-of-done
  (37 ACs). Self-build discipline holds: codex G-lane per lane, agents never commit (lead
  gates + commits on `release/v2.0.0`), never to `main`.

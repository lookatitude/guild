---
type: decision
owner: user
confidence: high
source_refs: [".<HIGH_ENTROPY_REDACTED>-host-p2-wave3.md", ".guild/runs/run-universal-host-plugin-architecture-20260617-<HIGH_ENTROPY_REDACTED>-6.md"]
created_at: 2026-06-17
updated_at: 2026-06-17
expires_at: null
supersedes: null
sensitivity: public
date: 2026-06-17
asker: eval-engineer
task: universal-host-p2-wave3 (LW3-5 / LW3-6)
category: architecture
---
# wave3-producer-skill-additive

## Context
LW3-6 (the authoritative eval lane) surfaced a spec-internal contradiction rather than rubber-stamping
it: LW3-5's product-loop template producer (commit `3221180`) added a NEW live skill —
`skills/meta/product-template/SKILL.md` + `evals.json` — directly under the install surface. SC-W3-6's
literal wording required live `skills/**` to stay **byte-identical**, and the addition turned the
existing SC-W2-5 empty-set live-surface guard RED. The producer **CLI** (`scripts/instantiate-template.ts`)
is not part of the byte-frozen surface; only the two skill files were the violation. `.claude-plugin/**`
and `commands/**` were clean. This matters because v2.0.0 is HELD and the local plugin is a live symlink
to the working tree, so a new live skill appears immediately in the operator's install.

## Options considered
- A: **Accept** the producer skill as an intended Wave-3 additive deliverable — amend SC-W3-6 (skills
  additive-only, not byte-frozen) + extend the SC-W2-5 guard's skills allowlist to
  `skills/meta/product-template/**`.
- B: **Defer** the live skill to the post-v2.0.0 cutover bundle — keep only the committed producer CLI,
  revert the two skill files, restoring strict `skills/**` byte-identity.
- C: Land the skill **source** under the Wave-2 `skill-src/` registry now, defer rendering into live
  `skills/` until the cutover.

## Decision
**Option A (accept as additive)** — operator decision 2026-06-17. The product-template producer skill is a
ratified Wave-3 deliverable. Live-surface policy is refined: `.claude-plugin/**` + `commands/**` stay
STRICT byte-identical (the cutover + F-5 freeze, zero delta); live `skills/**` is **additive-only** — a
new skill is permitted, no existing skill may change. The allowlist is scoped to exactly
`skills/meta/product-template/**`.

## Consequences
- SC-W3-6 spec wording amended (frozen-except-ratified-additions); the original literal "skills/**
  byte-identical" is superseded.
- SC-W2-5 guard (`tests/universal-host/p2-w2-sc5-live-surface-guard.test.ts`) updated: name-status diff
  permits only an ADDED file under the allowlist (M/D/rename or a non-allowlisted new skill still FAILs);
  resolved-skill-set A/B compares `cur − allowlisted-addition` to the pinned pre-Wave-2 set. Stays
  anti-vacuous; `.claude-plugin/`+`commands/` remain strict.
- SC-W3-6 guard (`p2-w3-sc6-live-surface-guard.test.ts`) encodes the same allowlist (exactly the two
  files), anti-vacuous, pinned pre-Wave-3 baseline.
- LW3-7b's ADR "zero live-surface mutation" stamp is qualified: zero for `.claude-plugin/`+`commands/`;
  additive-only (one ratified new skill) for `skills/**`.
- Resolves the open `questions/LW3-6.md`.

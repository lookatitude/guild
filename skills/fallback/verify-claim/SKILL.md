---
name: guild-verify-claim
description: Use before emitting ANY completion or success language for a specialist lane — performs an independent VCS-diff to verify the work actually exists on disk before a handoff receipt is trusted into review. The Guild fallback that engineering/ops specialists load when their T5 skill does not yet cover pre-completion verification. TRIGGER on "this is done", "I've finished", "the lane is complete", "ready to hand off", "tests pass", or any success claim made before an independent diff has been taken. DO NOT TRIGGER for final task-close gating (that is `guild:verify-done`), two-stage handoff review (`guild:review`), or mid-implementation debugging (`guild:systematic-debug`).
when_to_use: Before any completion/success statement and before a handoff receipt is trusted into `guild:review`. Replaces `superpowers:verification-before-completion`.
type: fallback
---

> **Fallback skill** — forked from `superpowers:verification-before-completion` v5.0.7 §8 (MIT, © 2025 Jesse Vincent). Guild-native adaptation, **zero runtime dependency** on superpowers. See `LICENSE-attribution.md`.

# Verify the Claim

## Overview

A completion claim is a hypothesis until an **independent VCS diff** confirms it. The failure mode this skill exists to catch: a specialist writes "done — all changes applied" while the working tree holds nothing, a partial edit, or changes in the wrong path. The receipt is then trusted into `guild:review` and the gap surfaces a lane later, far from its origin.

**Core principle:** No success language before an independent diff. The diff is the evidence; the claim is not.

**Announce at start:** "I'm using the guild-verify-claim skill to verify this before claiming completion."

## When to run

Run **before** writing any of: "done", "complete", "finished", "ready to hand off", "tests pass", or emitting a handoff receipt into `guild:review`.

## Procedure

### 1. Take an independent diff

Do not trust your own running narrative of what you changed. Read the actual tree:

```bash
git status --porcelain          # every modified/added/untracked path
git diff --stat HEAD            # scope of staged + unstaged change
git diff HEAD -- <expected-paths>   # the change is where the lane scoped it
```

### 2. Cross-check against the lane scope

For every file the lane's `scope` named, confirm a corresponding diff hunk exists. For every diff hunk, confirm it traces to the lane scope — an out-of-scope edit is a finding, not a pass.

### 3. Run the spec's defined checks

If the spec defined tests or a build, run them and capture the actual exit status — never infer pass from "it should pass".

### 4. Gate the claim

- **Diff present, in-scope, checks green** → completion language is now evidence-backed; proceed to the handoff receipt.
- **Empty diff, partial diff, wrong path, or red checks** → do **not** claim completion. Report the gap with the diff output as evidence and continue the work.

## Red flags

**Never:**
- Write "done" before reading `git status` / `git diff` in this turn.
- Trust a handoff receipt into `guild:review` without an independent diff behind it.
- Infer test results from intent instead of an actual run.

**Always:**
- Treat the VCS diff as the single source of truth for what changed.
- Map every scoped file ↔ every diff hunk both directions before passing.

## Self-evolution

This skill is self-evolvable for body, clarity, and examples under the **same promotion gate and the same permission carve-out as any Guild skill** (`guild:evolve-skill` — `guild-plan.md §11.2`). There is **no special pipeline** for it; it is an ordinary fallback-tier skill.

## Integration

**Pairs with:**
- **guild:verify-done** — the final task-close gate; verify-claim is the per-claim precondition that keeps an unverified receipt from ever reaching it.
- **guild:review** — verify-claim runs before a handoff receipt is trusted into the two-stage review so review evaluates a real change set.

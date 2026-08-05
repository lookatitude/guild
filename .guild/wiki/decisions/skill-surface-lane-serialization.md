---
type: decision
owner: plugin-architect
confidence: high
importance: medium
source_refs: [".guild/runs/run-305333a3-8707-4982-9c65-<HIGH_ENTROPY_REDACTED>-summary.md", "tests/universal-host/live-surface-anchor.ts", "scripts/lib/skill-source-transform.ts"]
created_at: 2026-08-05
updated_at: 2026-08-05
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-08-05
asker: user
task: v23x-deferred-followups
category: process
---
# skill-surface-lane-serialization

## Context
`skills/**` and `commands/**` are a **pinned surface**: any change must, in the same
commit, re-extract `skill-src/skill-registry.json` (`extractSkillV1`), verify
byte-identical round-trips (`<HIGH_ENTROPY_REDACTED>`), and re-ratify the
`RATIFIED_TREES` tree-hashes in `tests/universal-host/live-surface-anchor.ts`. The
pins are whole-tree hashes — they cover the entire surface, not just the files a
lane touched. In the `v23x-deferred-followups` run, rf-wi-06 (execute-plan surface)
and rf-wi-02 (sink consumers) both needed surface edits.

## Options considered
- **Let surface lanes run concurrently** and fix pins at merge. Broken by
  construction: each lane ratifies tree-hashes from its own worktree, so whichever
  merges second carries pins that no longer match the merged tree — guard goes red
  on `next` after a green-CI merge.
- **Fold all surface work into one lane.** Avoids the collision but couples
  unrelated goals (G6 and G2) into one oversized lane with one receipt.
- **Serialize surface lanes and stack their PRs**: at most one skill-surface lane
  live at a time; the second surface lane branches from the first's branch, so its
  pins are computed over a tree that already contains the first's changes.

## Decision
**At most ONE lane touching `skills/**` or `commands/**` may be live at a time, and
skill-surface PRs merge consecutively.** In this run rf-wi-06 ran alone on the
surface (any wave slot, but nothing surface-touching concurrent), rf-wi-02 stacked
on it (#89 on #86), and the merge train placed #86 → #89 back-to-back with an
explicit rule: **if anything else merges between two surface PRs, the later one
re-ratifies its pins from the merged tree before merging** (pin re-ratification on
#89 was verified from the merged worktree, 2026-07-25). Non-surface (code-only)
lanes are unaffected and parallelize freely.

This is the standing pattern for any future run whose plan contains more than one
skill-surface lane — the serialization is a property of the whole-tree pins, not of
this initiative. Related: [[stacked-prs-for-dependent-lanes]] (the stacking + merge
train mechanics), [[wave3-producer-skill-additive]] (the additive-surface
ratification precedent).

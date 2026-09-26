---
name: guild-rollback-skill
description: Rolls a skill, playbook, profile, or glossary span back by restoring the inverse span recorded in compact history (KTD48). Span-scoped, never a whole-file rewrite — a span that drifted since the delta landed is blocked_confirm, not a silent restore. Walks n entries back, newest first (default 1). Re-runs the restored skill's eval suite to confirm it still passes against the current repo. TRIGGER for "roll back guild:<skill>", "revert the last evolve of <skill>", "undo yesterday's tune on brainstorm", "walk guild:<skill> back two steps". DO NOT TRIGGER for: evolving forward (guild:evolve owns), creating a new specialist (guild:create-specialist), deleting a skill (never supported), auditing scripts (guild:audit), reverting a harvest wiki write (wiki-revert.md), or reviewing a run (guild:review).
when_to_use: Explicit /guild:maintain rollback <skill> [n] — walks n entries back (default 1). Also fires when a recently-promoted edit shows regressions post-promote and the user asks to revert.
type: meta
---

# guild:rollback-skill

Rollback is the INVERSE SPAN, applied.

Every applied `guild.evolve_delta.v1` records, in compact history, the region bytes as
they stood, the region bytes it wrote, and the sha256 of each. Rolling one back is
replacing the current region with the recorded inverse. The old design kept a full copy
of the body in a per-version tree under durable `.guild/` and restored the copy; compact
history replaced that tree (KTD48), because a whole-file restore also reverts every edit
that landed after the copy was taken, and nobody asked for those to go.

Compact history lives in the runtime storage class through `GuildStorage`, off the repo.
There is no version tree, and nothing in this flow creates one.

## Input

1. **Key** — the rollback key: a skill slug, a playbook basename, a profile role. It
   must have compact history; a target that was never evolved has nothing to roll back
   and the flow stops there.
2. **Steps-back count `n`** — optional integer, default `1`. Walks `n` entries back,
   newest first. `n` past the oldest entry stops and surfaces the available depth.

## Walk the stack

Delegates to `scripts/rollback-walker.ts`. Without `--apply` it writes nothing:

```
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/rollback-walker.ts --skill <key> --steps <n> --cwd <repo-root>
```

It prints the recorded deltas newest-first (entry id, timestamp, target, span, proposer)
and a `proposed_rollback:` block naming each span and its `after_hash`. Show that to the
user before applying anything.

Re-run with `--apply` to restore. The walk stops at the FIRST blocked step.

## Three outcomes per entry

| Verdict | What it means | What to do |
|---|---|---|
| `restored` | the region still hashed to `after_hash`, so the recorded inverse still describes it | report the path and the span |
| `blocked_confirm` | the span drifted after the delta landed, or the anchor is gone, or the file is gone | STOP. Surface the question verbatim. Restoring would discard whatever changed |
| `noop` | no history, or `n` was 0 | nothing to do |

A blocked step blocks everything older than it too. History is a stack: restoring entry
k−1 while entry k is still applied leaves the file in a state no entry describes.

A restored entry is POPPED from history. The retired design "snapshotted rollbacks as new
versions", which made the stack grow on undo and made a second rollback re-apply what the
first one removed.

## Post-rollback verify

After a restore, re-run the target's own eval suite (`should_trigger` /
`should_not_trigger` from the restored `evals.json`) against the current repo. The
restored text passed its evals when it was live, but the repo may have drifted: an
adjacent specialist may have changed its `DO NOT TRIGGER` clause, a referenced path may
have moved, a delegated skill may have been renamed.

1. **All evals pass** — the rollback is clean.
2. **Failures that look like repo drift** — surface the failing cases and the drift
   hypothesis, then offer either (a) keep the rollback and patch the drift in a follow-up
   evolve, or (b) re-apply the delta forward.
3. **Failures unrelated to drift** — surface them verbatim. Either the older text was
   always wrong against these cases (a lesson for the promotion gate) or the evals
   themselves have drifted and need editing before the rollback is trustworthy.

The verify is part of the flow, not an optional check.

## Handoff

Payload fields:

- `key` — what was rolled back.
- `requested` / `restored` — steps asked for, spans actually restored.
- `entries` — per entry: `entry_id`, `path`, `span`, `status`, and `question` on a block.
- `post_rollback_verify` — `passed`, `drift_suspected`, or `failed_unrelated`, with the
  failing cases and drift hypothesis on anything but `passed`.

On drift or unrelated failure the handoff flags the target for a follow-up evolve with
the restored text as baseline. Rollback surfaces and hands off; it does not chase drift.

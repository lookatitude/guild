---
type: decision
owner: tooling-engineer
confidence: high
importance: medium
source_refs: ["plugin/scripts/dot-guild/audit.ts", "<HIGH_ENTROPY_REDACTED>-redirect.ts", "<HIGH_ENTROPY_REDACTED>-root.ts", ".gitignore"]
created_at: 2026-06-17
updated_at: 2026-06-17
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-06-17
asker: user
task: universal-host-p2-wave1-closeout
category: architecture
---
# telemetry-anchors-to-repo-root-not-cwd

## Context
The share-dot-guild audit (`scripts/dot-guild/audit.ts`) flagged a stray nested
`scripts/.guild/` (16 MB, untracked, `hosts/` + 21 `runs/`) that violated the
one-`.guild`-per-repo invariant. Root cause = **cwd-drift**: when a script/test is run
with `cwd=plugin/scripts/` (e.g. `cd scripts && npx jest`, or a `tsx` invocation from that
dir), the telemetry/run-state write side resolves its `.guild` target **relative to the
process cwd** and accretes a SECOND `.guild/` under `scripts/`. It even captured a copy of
a live run id. The `.gitignore` note claims `hooks/lib/guild-root.ts` "walks up to the
nearest `.git/.guild` so hooks never create nested `.guild`" — that holds for the HOOK path,
but **direct `tsx`/`jest` invocations bypass the hook entry** and default to cwd. (See also
the operator-memory lesson "Bash cwd drift in multi-repo".)

## Options considered
- Convention-only: always run scripts/tests from the repo root or pass an absolute `--cwd`
  (relies on discipline; the nested `.guild/` will keep recurring).
- Make the telemetry/run-state write side resolve the repo root via the SAME `guild-root.ts`
  walk the hooks use, regardless of process cwd — so a non-hook entry can't create a nested
  `.guild/`.
- Add a CI guard only (audit already catches it post-hoc, but does not prevent creation).

## Decision
**Anchor every `.guild/` write to the resolved repo root, not the process cwd.** The
telemetry write side (and any run-state writer reachable from a bare `tsx`/`jest` run) must
route through `guild-root.ts` (walk up to the nearest `.git`/`.guild`) before writing —
identical to the hook path — so a nested `.guild/` can never be created from a sub-directory
cwd. Keep the audit `nested-guild` check as the backstop. (Immediate instance was deleted;
this records the durable fix so it does not recur.)

## Consequences
- Fix owner: tooling-engineer (telemetry write side) with hook-engineer review of the shared
  `guild-root.ts` contract. Acceptance: from `cwd=plugin/scripts/`, run the test suite, then
  assert NO `scripts/.guild/` is created and `audit.ts` stays at zero actionable flags
  (anti-vacuity: also prove the writer still emits to `plugin/.guild/` correctly).
- Until landed, run scripts/tests from the repo root (or pass an absolute `--cwd`); if a
  `scripts/.guild/` reappears it is a disposable, untracked leftover — `rm -rf` it.
- No behavior change to the canonical `plugin/.guild/` state; this only prevents a duplicate.

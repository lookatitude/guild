---
schema_version: guild.handoff_receipt.v1
task_id: W4-W5-tooling-completion
run_id: run-20260811-010758-run-identity-and-dispatch
specialist: tooling-engineer
instance_id: W4-W5-tooling-completion.a1.i-b07d8cedc4ee
attempt: 1
written_at: 2026-08-11T17:12:00Z
---

## changed_files

Authoritative machine receipt (full per-file detail):
`.guild/runs/run-20260811-010758-run-identity-and-dispatch/task-cells/W4-W5-tooling-<HIGH_ENTROPY_REDACTED>-W5-tooling-completion.a1.i-<HIGH_ENTROPY_REDACTED>.json`

Remediation pass (review loop-back, four Important blockers):
- `scripts/agent-team-launcher.ts` — frozen `snapshot.dispatch` consumption (blocker 1): `<HIGH_ENTROPY_REDACTED>` + `<HIGH_ENTROPY_REDACTED>`; `resolveAgentMode` takes the frozen decision and skips every ambient probe when present; legacy no-`--agent-mode` path honors a frozen non-tmux backend.
- `skills/meta/execute-plan/SKILL.md` (+ generated mirror via sync) — backend authority re-anchored to `snapshot.dispatch.backend`; cmux-first bullet no longer an ambient interim path.
- `hooks/run-trace-close.ts` (+ rebuilt `hooks/dist/**`) — `<HIGH_ENTROPY_REDACTED>` (blocker 2): atomic temp+rename provenance recovery before the active-work refusal.
- `src/modules/lifecycle/workflows/run-record-validate.ts` + `src/modules/lifecycle/module.manifest.json` — canonical receipt validation (blocker 3): exactly one strict-valid `guild.handoff.v2` fence + all five §8.2 sections; lifecycle now depends on distribution.
- `scripts/__tests__/agent-team-launcher.test.ts`, `launcher-preflight-no-poison.test.ts`, `pane-dispatch-trace.test.ts` — ambient host/cmux identity scrubbed in spawn helpers (blocker 4).
- New tests: `scripts/__tests__/frozen-dispatch-authority.test.ts`; recovery + installed-bundle controls in `hooks/__tests__/run-trace-close-active-guard.test.ts`; envelope controls in `scripts/__tests__/run-record-validate.test.ts`.
- Mirrors re-synced: 705 resources across 31 modules, `--check` clean.

## opens_for

- Team lead: acceptance of the remediation; decide the installed-bundle hotpatch (backup prepared; SHA changed — see followups).
- Fresh independent plugin-architect review (cross-family) of all four blocker fixes.

## assumptions

- The frozen `snapshot.dispatch` block is authoritative wherever present; only legacy snapshots without it fall back to the ambient ladder (back-compat pinned by test).
- Recovery scope is exactly the reviewed race class (terminal provenance + open run.yaml + active work); a closed run.yaml is never blindly reopened.
- The comms-format-lint hook ENOENT on every write in this worktree session is harness noise (misresolved plugin root), not a lint verdict.

## evidence

- Neutral env, 10 suites: 424/424. Reviewer's exact 9-suite matrix under `GUILD_HOST=codex-cli GUILD_HOST_ID=codex-cli`: 420/420 (416 prior + 4 new W5 envelope controls). Hostile ambient (`CMUX_WORKSPACE_ID` + codex): 94/94.
- Hooks: `npm run build` clean; close/recovery/dist-binding suites 44/44 (incl. rebuilt-bundle recovery control).
- Live control: the rebuilt bundle recovered THIS run's real contradiction (provenance closed→resumable, audited; close still refused while this lane is in_progress).
- `sync-module-resources` wrote/checked 705 resources across 31 modules.

## followups

- LIVE CMUX PROOF PENDING (initiative close): no live cmux session; visible non-focus-stealing surfaces pinned only by isolation tests + frozen snapshot.
- docs/v2 D8 reconciliation, remote real-run pre-spawn ordering, `guild.trace.dispatch.v1` cmux enum revision — open, other lanes/initiative close.
- Installed close-bundle hotpatch: worktree bundle SHA changed after the recovery fix; backup taken, hotpatch deferred to lead review.

```guild.handoff.v2
{
  "schema_version": "guild.handoff.v2",
  "task_id": "W4-W5-tooling-completion",
  "tier": "powerful",
  "status": "done",
  "summary": "Review loop-back complete: frozen snapshot.dispatch is authoritative on the launcher path (ambient CMUX/tmux changes cannot alter it; execute-plan skill re-anchored); premature-close provenance recovery runs atomically before the active-work refusal and recovered this run's real contradiction; W5 share eligibility requires the canonical receipt wrapper with one strict-valid guild.handoff.v2 envelope and all five sections; launcher fixtures scrub ambient host identity — matrix 420/420 under a Codex-shaped env, 424/424 neutral. No commit; run left open for fresh review.",
  "artifacts": [
    "scripts/agent-team-launcher.ts:1500",
    "hooks/run-trace-close.ts:96",
    "src/modules/lifecycle/workflows/run-record-validate.ts:96",
    "skills/meta/execute-plan/SKILL.md:334",
    "scripts/__tests__/frozen-dispatch-authority.test.ts:1",
    "hooks/__tests__/run-trace-close-active-guard.test.ts:200"
  ],
  "issues": [],
  "learnings": [
    "A frozen intake decision is only real once the executable path consumes it — writing the snapshot without rewiring the consumer leaves the invariant decorative.",
    "Guards that return early must reconcile contradictory durable state first, or they preserve it forever."
  ]
}
```

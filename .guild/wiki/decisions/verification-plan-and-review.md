---
type: decision
owner: architect
confidence: medium
importance: medium
source_refs: ["plugin/.guild/architecture-research-2026-05-10/architecture/17-verification-plan-and-review.md"]
created_at: 2026-05-16
updated_at: 2026-05-16
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [current-project-implementation-plan, review-checklist]
---

<!-- followup: architect to author ADRs from this provenance stub -->

# Verification Plan And Review

> **v2 note (2026-05-17):** This is a frozen v1 verification-draft record. Any
> `/guild:`-colon command spellings below (e.g. `/guild:init`,
> `/guild:initiative`, `/guild:run replay`) are dead v1 history — the v2
> clean-slate grammar uses space-separated phase verbs (e.g. `/guild init`).
> See [command-clean-slate.md](command-clean-slate.md) for the canonical v2
> command surface. The colon refs here are kept verbatim as historical
> provenance and are NOT normative.

Status: verification draft

## Purpose

This document records how the workflow architecture should be verified and what the independent verifier found.

## Verification Scope

The design must cover:

- project initialization for new, existing, and already-initialized projects
- project wiki and memory seeding
- initiative new/list/status/resume/update/archive/restore/close
- cross-session initiative state
- phase workflows from ideation through docs sync
- tmux, subagent, advisory, and adversarial routing
- cross-host adversarial review and loop termination
- run recording and replay
- observability and trace model
- skill, specialist, and tool evolution from replay
- current repo implementation changes
- migration and backward compatibility
- safety, privacy, and destructive-action controls

## Step Checklist

| Step | Required Verification |
|---|---|
| `/guild:init` detection | New/existing/resume paths are distinct and safe. |
| New project interview | Product and technical base knowledge are captured. |
| Existing project reverse engineering | Inferred facts are confidence-tagged and human-confirmed. |
| Scaffold | Required folders exist and user-authored state is not overwritten. |
| Initiative registry | Multiple active initiatives can coexist and archived state is searchable. |
| Session intake | Ambiguous initiative matching asks instead of guessing. |
| Ideation | Advisory loop produces initiative, not spec too early. |
| Breakdown | Initiative decomposes into specs/features/work items. |
| Team routing | Backend choice honors tmux/subagent/single-agent constraints. |
| Context assembly | Bundles include project, initiative, role, and task slices. |
| Execution | Handoffs, evidence, assumptions, and work item updates are recorded. |
| Review/verify | Run completion does not falsely close initiative. |
| Release/docs | Closure blocked until release/docs status is resolved. |
| Cross-host review | Review packet, checksum, read-only reviewer, and fallback are defined. |
| Loop termination | Malformed output, fake sentinels, cap hits, and scope drift are handled. |
| Replay | Evidence/context/diagnostic/shadow/execution modes have mutation boundaries. |
| Evolution | Shadow replay gates skill/tool changes before promotion. |
| Current repo changes | Commands, skills, scripts, schemas, hooks, tests, and compatibility are listed. |
| Privacy/security | Raw traces, secrets, and destructive actions are controlled. |

## Independent Review Findings: Initial Checklist

The independent verifier inspected the research pack, `guild-plan.md`, commands, skills, hooks, scripts, and plugin manifest. Key constraints to preserve:

1. Current `/guild` is run-centric and has three approval gates. New design must extend it rather than bypassing spec/team/plan/context/execute/review/verify.
2. `.guild/` is currently ignored in this repo. Sharing wiki/initiatives via git needs explicit consumer-repo `share_mode` policy and ignore exceptions.
3. [Pre-ship state, resolved by settings-control-and-tmux] The backend was previously subagent-default; the design was required to separate the defaults. Shipped model: D5 ladder resolves at run-start (team/tmux primary when available); see `team-and-routing/tools-and-mcp.md §tmux Agent Teams`.
4. `scripts/agent-team-launcher.ts` is Claude-specific and not a provider-neutral team runtime yet.
5. Current Codex review is Claude-originated, Codex-only, sentinel-based, and skipped if unavailable. Review broker is a migration, not current behavior.
6. Hooks are non-blocking; security guarantees cannot rely only on hooks.
7. Context bundles are authoritative briefs, not security boundaries.
8. Repo docs/surfaces disagree on 13 vs 14 specialists and need reconciliation.
9. New specialist creation has same-session availability constraints in Claude.
10. Later implementation must avoid overwriting dirty worktree changes and follow branch/PR discipline.

## Changes Applied From Initial Checklist

| Finding | Applied In |
|---|---|
| Preserve current `/guild` run spine. | `11-workflow-operating-model.md`, `16-current-project-implementation-plan.md`. |
| Add explicit share mode. | `12-project-initialization-workflows.md`, `16-current-project-implementation-plan.md`. |
| Separate product default from operator tmux preference. | `11-workflow-operating-model.md`, `13-initiative-and-phase-workflows.md`. |
| Mark tmux launcher Claude-specific. | `16-current-project-implementation-plan.md`. |
| Add review broker migration and structured envelopes. | `15-cross-host-review-and-loop-control.md`. |
| Avoid relying on hooks for security. | `14-run-replay-and-evolution-workflows.md`, `16-current-project-implementation-plan.md`. |
| Add initiative context without treating it as security boundary. | `11-workflow-operating-model.md`, `13-initiative-and-phase-workflows.md`. |
| Reconcile 13 vs 14 specialists. | `16-current-project-implementation-plan.md`. |
| Document same-session specialist constraint. | `16-current-project-implementation-plan.md`. |
| Keep implementation as future branch/PR work. | `16-current-project-implementation-plan.md`. |

## Independent Review Findings: Draft Review

The verifier found blocking issues after the first draft:

1. Initiative paths conflicted between the old direct initiative directory form and the active/archive directory form.
2. Command naming used space subcommands despite the current repo's colon-style command surface.
3. The init scaffold omitted existing run-spine directories `spec/`, `team/`, and `plan/`.
4. Share modes did not include parent unignore rules for consumer repos that ignore `.guild/`.
5. Review routing YAML reused duplicate keys.
6. `skipped` review status was allowed to pass even when review may be mandatory.
7. Tmux fallback semantics conflicted with current execute-plan behavior after `backend: agent-team` approval.
8. Telemetry privacy assumed digest-only prompts, but current telemetry records `UserPromptSubmit` prompt text.
9. `run.yaml`/`metadata.json` authority needed a compatibility period.
10. Session intake did not account for stale `current-run-id` or incomplete prior runs.
11. Reverse-engineered wiki pages were written before human confirmation.
12. Review loops lacked finding novelty/scope-drift tracking.
13. Review packets lacked redaction/sensitivity policy.

## Changes Applied From Draft Review

| Finding | Applied Fix |
|---|---|
| Path conflict | Canonical path is `.guild/initiatives/active/<id>` and `.guild/initiatives/archived/<id>`. |
| Command naming | New commands use `/guild:init`, `/guild:initiative`, and `/guild:run replay`. |
| Missing run-spine dirs | Init scaffold includes `spec/`, `team/`, and `plan/`. |
| Share-mode gitignore | Added parent unignore rules for hybrid mode. |
| Duplicate review routing keys | Changed review routing to `routes: []`. |
| Skipped review pass | `skipped` only passes when review is not required. |
| Tmux fallback conflict | Distinguished pre-plan fallback from post-approval backend failure. |
| Telemetry privacy mismatch | Added prompt redaction/hash migration requirement. |
| Run manifest compatibility | `run.yaml` target manifest coexists with `metadata.json` during migration. |
| Stale run intake | Added intake rule to detect incomplete/stale runs before prompt classification. |
| Premature wiki promotion | Existing-project pages stage under `.guild/init/staging/` before promotion. |
| Finding drift | Added finding memory with first-seen/status/scope. |
| Review packet sensitivity | Added allowed/excluded paths and redaction policy. |

## Independent Review Findings: Final Focused Pass

The verifier reran a focused pass after the draft-review fixes and found five remaining consistency issues:

1. Ideation entry-point docs still used mixed non-colon placeholder command names.
2. Research file `22-initiative-centric-cross-session-state.md` still had two stale direct initiative path refs.
3. Ideation file `09-project-initialization-initiatives-and-run-replay.md` still listed the active/archived layout as an open question.
4. Hybrid sharing claimed compact run summaries are shared but did not unignore run summary/review/verify files.
5. Review skipped semantics used a different required-review field name than the config.

## Final Changes Applied

| Finding | Applied Fix |
|---|---|
| Mixed command style | Converted ideation entry points to colon-style proposed commands. |
| Stale research paths | Updated stale initiative refs to `.guild/initiatives/active/<id>`. |
| Resolved open question | Replaced active/archived layout question with archive indexing/search question. |
| Hybrid run summaries | Added unignore rules for run `summary.md`, `review.md`, and `verify.md`. |
| Review config name mismatch | Standardized skipped-review condition to `review.review_required`. |

No additional verifier pass was run after these final narrow fixes.

## Changelog

- 2026-05-17 — v2 — adv-r2 textual fixes. Added this `## Changelog` block to
  satisfy G7 for an evolved frozen-v1 record (the inline "v2 note" banner
  added under F8 documents the substantive annotation; `supersedes:`
  frontmatter preserved). Body content is frozen v1 history, unchanged.

---
type: concept
owner: architect
confidence: high
importance: medium
source_refs: []  # consolidated from plugin/docs/v2/ (711f227); supersedes: field below preserves the lineage
created_at: 2026-05-16
updated_at: 2026-05-17
expires_at: null
supersedes: "docs/v2/edge-cases.md"
sensitivity: public
applies_to: [plugin]
related: [architecture-overview, cross-host-review-and-loop-control]
---

# Edge Cases and Advisory Defaults

This file captures failure modes that should shape v2 implementation and review.

## Backend and tmux

| Edge case | Handling |
|---|---|
| `tmux` missing | Use `subagent`; record fallback in team file. |
| Already inside tmux | Do not launch nested agent-team; tell operator to rerun from a plain shell if agent-team is required. |
| Env var missing | Refuse agent-team launch; use subagent only if the user accepts changed semantics. |
| Agent-team session name collision | Dry-run first, then relaunch with explicit session name. |
| Teammate exits without receipt | `TaskCompleted` hook blocks completion; lane is incomplete. |

## Command Migration (clean-slate break)

| Edge case | Handling |
|---|---|
| User invokes a removed `/guild:guild-*` v1 command | Refuse and point to the exact `/guild:<verb>` replacement and `MIGRATION.md`. The `:` plugin namespace **stays** (Claude Code requires it); v2 dropped only the redundant `guild-` command prefix, and the v1→v2 redirect stubs were deleted in v2.0 (no silent aliasing). |
| User types `/guild ship` (legacy spelling) | Map to `/guild ops` and tell the user the Operations verb is `ops`; do not run silently under the old token. |
| User passes a genuinely removed flag (`--codex-review`, `--restart` as a first word, `--allow-larger`) | Map/print the replacement: `--review={local\|cross\|off}`, `/guild resume --restart`, `--team-size=N`; reference `MIGRATION.md`. **Note:** `--loops`/`--loop-cap`/`--codex-cap` are **not** removed — they are accepted as power-user flags (parsed at the `read-guild-config.ts` arg-parse switch for `--loops`/`--loop-cap`/`--codex-cap`); `--rigor={quick\|standard\|deep}` + `.guild/settings.json` is the recommended path. |
| `/guild [brief]` whose first token collides with a reserved phase/noun/maintenance token | Treat as that subcommand (reserved set is closed); a quoted/free-text brief is the linear lens. Always surface and gate the detection — never silent. |
| `/guild` reaches an interactive gate in a non-interactive/CI context | Hard-fail with an actionable message ("interactive gate reached in non-interactive context; pass `--auto-approve=…` or name a phase"); never assume autonomy. |

## Initiative Attachment (opt-in)

| Edge case | Handling |
|---|---|
| No durable-goal signal | Default `one_off`; no initiative directory; run lives at `.guild/runs/<run-id>/`. Never auto-attach. |
| Durable-goal signal present | Ask `[new / existing / one-off]` before team-compose; never silently auto-attach. |
| `--initiative <id>` names a missing initiative | Ask the user (do not fabricate the initiative); offer create-new or one-off. |
| Attachment probe ambiguous | Default `one_off`; ask only if `--initiative <id>` was given but not found. |
| Initiative "done" claimed before close gates | Run may verify a task/work-item but must not claim the initiative complete until exec + release + docs close gates pass. Close-gate contract frozen `[v2]`; automation `[v2.x]`. |

## task_run and Host Degrade

| Edge case | Handling |
|---|---|
| `task_run` `schema_version` ≠ `guild.task_run.v1` | Reject the dispatch; do not coerce. Schema is frozen; an unrecognized version is a contract error, not a fallback. |
| `task_run` missing a required field | Refuse dispatch with the offending field; the orchestrator must rewrite a valid contract — never partially dispatch. |
| Requested host's `capability_set` does not satisfy requirements | Router picks the first satisfying adapter; if none satisfies, **degrade** to the nearest available adapter and record degradation + weak-independence in the receipt. |
| Cross-host reviewer host unavailable | Fall back to a same-host fresh-context subagent; mark the review **weak (recorded)**, never silently strong. |
| Artifact changed during review (sha256 mismatch) | Reject the result, restart the review round (cap applies; force-pass is human-only). |
| Codex adapter unavailable | Continue on the available host; do not hard-block. Codex-cloud paths are `[v2-contract-only]`; mixed-tmux co-execution is `[v2]`. |
| `host.requested == codex-local` and Codex absent | `probe()` returns `available:false`; router degrades to the first satisfying adapter (normally `claude-code`); record `degraded: true` + `independence: weak` (if the lane needed cross-host) in the canonical receipt. Warn, never hard-block — Guild builds and runs end-to-end with Codex entirely absent. |
| `codex-local` review request with Codex absent | Degrade to a same-host fresh-context subagent stamped `independence: weak` in the review trail (identical to the cross-host broker rule). |
| Codex-pane telemetry fidelity gap (no shared hook bus) | Each adapter normalizes its own events to `guild.trace_event.v1` with its `host`; gaps are recorded, never faked. Degraded telemetry is acceptable (v2-EPP-1b); not a v2 blocker. |
| Lane needs `needs_pr:true` but cloud not opted in | `codex-cloud.probe()` returns `available:true` ONLY when `consent.cloud_opt_in == true` for the run; with no opt-in cloud is not an available adapter, so the lane **degrades** (records degradation) rather than silently going to cloud. The router rule itself is unchanged. |
| Building a `cloud_task_packet` (off-box egress) | Egress is a destructive/network-class action → the **always-ask hard set fires** regardless of `--auto-approve`; the human sees the `included_artifacts` list + sha256s before egress. `consent.cloud_opt_in` MUST be explicit human-approved per run. `[v2-contract-only]`. |

## Mixed-host tmux teams (`[v2]`)

| Edge case | Handling |
|---|---|
| `tmux` missing | Fall back to host-native subagents; record the capability gap. |
| Already inside tmux (`$TMUX` set) | Refuse the nested team; route to host subagents or ask for a plain-shell rerun. The existing team-level preflight is reused verbatim, host-neutral, no relaxation. |
| Pane provider binary missing on PATH | Per-pane provider preflight fails **before spawn**; the lane is not started; surfaced. |
| Teammate pane exits before handoff | Orchestrator sees a missing heartbeat / stale `status/<lane>.yaml` → marks the lane blocked/failed; never a silent completion. (Staleness threshold reuses the existing `.guild/.lock` stale-age constant — a tuning constant, not a contract.) |
| Approval surfaces in an inactive pane | Written to `approvals/<id>.yaml` (`guild.approval_request.v1`); the orchestrator surfaces it to the user; the lane blocks. |
| Two panes write the same handoff path | Single-writer `.guild/.lock` + ownership rule → ownership-violation event; the second write is rejected. |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` scoping | Set as a **per-Claude-pane** precondition (asserted by the Claude pane adapter only when a Claude pane participates), never as a team-level precondition. A pure Codex+Codex team never sets it. |
| tmux failure of any kind | Degrade to host-native subagents; tmux is a supervisor, not a security boundary — the security boundary stays host permissions + worktree + the always-ask hard set, unchanged. |
| Manual user edit inside `.guild/runs/` | Artifact-validity check catches invalid artifacts; the resume-ladder rebuilds. |

## Quality + Operations phases (`[v2]`)

| Edge case | Handling |
|---|---|
| Auto-select picks the wrong check class set | Selection is surfaced + overridable before execution (`[proceed] / [edit-selection] / [explain-signals]`); never silent. `edit-selection` records `override: user`. |
| Applicable check class has no discoverable harness | Record `gap: <class> applicable but no harness found` — not a silent skip, not a pass. The honest successor to the old "gap-report only" behavior, scoped to missing-harness only. |
| Check class exceeds wall-clock budget | Record `inconclusive: budget exhausted`; never silently pass. Budget is configurable via the canonical `defaults.quality.budget` block defined once in [`command-surface.md`](command-surface.md) §4.4 (cited by pointer, numbers not re-spelled). |
| Quality recommends BLOCK, user runs `/guild ops release` | `release` / `rollback` classes refuse with route-back unless a human `force_pass` with rationale. `monitoring` / `maintenance` / `incident` may proceed (an incident does not wait for a clean Quality report). |
| `--auto-approve=all` (or `=qa`) reaches a Quality BLOCK→release override | NOT auto-passed — a release override on failing evidence stays human-gated (release is high-consequence; same family as the always-ask hard set). RELEASE-READY recommendations ARE auto-passed under `--auto-approve=qa` or `=all` — the token set is `[spec,plan,build,qa,all]` (the `qa` token is PASS-only; there is no `ops` token). A printed asymmetry, not a hidden mode. |
| Runbook drift (content ≠ `approved:true` ref) | `runbook.drift_detected: true` → forces INTERACTIVE regardless of prior approval. Approval is for the *approved content*, not the runbook name. |
| `incident`/`rollback` class with an autonomous posture requested | Refuse the posture: these classes are NEVER autonomous (the taxonomy table is the contract). Run interactive; record the refused request. |
| First-ever run of any runbook with an autonomous posture requested | Refuse: the first run is ALWAYS interactive (autonomy is earned per-runbook after ≥1 clean interactive run + human approval). |
| `op_class_allowlist` includes destructive/network/spend | Reject the runbook/lane at plan-validate — a contract error, not a fallback (`op_class_allowlist ⊆ closed-enum AND ∩ hard-set = ∅, else exit 2`; canonical in `target-architecture.md` §`autonomy_policy`). The hard set is unreachable by allowlist by construction. |
| Hard-set step inside an `approved:true` autonomous runbook | Still prompts inline (`autonomy: prompted_inline`) regardless of `--auto-approve` / approval — identical to Development's hard rule. |
| `/guild qa` with no passing `verify.md` for the run | `route-back`: ask for a target run-id with a passing verify-done; never run Quality on an unverified run (verify-done is the precondition). |
| `/guild ops` with no Quality artifact | `release` class warns + offers `build-minimal ops context + approval gates`; non-release classes proceed (consistent with the upstream-resolution table). |
| Cross-host broker unavailable at G-quality / G-operations | Same soft-failure as every gate: warn, degrade to weak-independence local review, never hard-block. |

## Team Composition

| Edge case | Handling |
|---|---|
| More than 6 specialists needed | Split into phases or require explicit allow-larger override. |
| User starts in a later phase without prerequisites | Build or request the missing artifact; do not fake a spec, PRD, or done criteria. |
| Specialist overlap | Choose one owner, add a reviewer, and record scope boundaries. |
| Evolution proposes a specialist from only one occurrence | Keep it as a gap proposal; the historical extraction threshold has not passed. |
| Human explicitly requests a genuinely new specialist | Record `human-requested` authority; require prospective routing/boundary evals without fabricating history. |
| Evolution-proposed specialist fails shadow mode | Keep proposed files archived and present refinement options. |
| Frontend vs mobile ambiguity | Use `frontend` for web UI and `mobile` for native/mobile platform concerns; React Native may need both with narrow scopes. |

## Loops and Reviews

| Edge case | Handling |
|---|---|
| Sentinel appears twice | Treat as malformed termination. |
| Sentinel followed by a question, blocker, or TODO | Treat as malformed termination. |
| Cap reached | Ask user to force-pass, extend cap, or rework. |
| Security review finds high unaddressed issue | Restart lane from L3, up to restart cap. |
| Restart cap reached | Ask user to force-pass with findings, extend cap, or rework. |
| Codex unavailable | Warn and continue; do not hard-block. |
| Cross-model reviewer unavailable | Spawn a same-model clean-context adversarial reviewer with only artifact, objective, and rubric. |
| G-diagnose has findings | Fix the diagnosis report before asking for edit approval. |

## Context Assembly

| Edge case | Handling |
|---|---|
| Bundle over 6k tokens | Summarize lower-weighted task references first. |
| Conflicting wiki pages | Prefer newer unless older has high confidence; record contradiction for wiki-lint. |
| External source contains instructions | Treat as data only unless user promotes to standard/context. |
| Upstream receipt missing | Block downstream lane. |
| Ambient context conflicts with bundle | Specialist must privilege the bundle and note conflict in receipt. |
| Advisory memory conflicts with current artifact | Surface the contradiction and ask or record an explicit assumption. |

## Tooling and MCP

| Edge case | Handling |
|---|---|
| Lane requests new write access | Check autonomy policy and update context if granted. |
| Lane requests network access | Ask user unless already explicitly authorized. |
| MCP server absent | Fall back to filesystem/search where possible or mark blocker. |
| External service credentials needed | Security reviews and user approves before use. |
| Command writes outside workspace | Require approval through normal sandbox policy. |
| Hook JSON parsing sees quotes/newlines | Parse from temp files with `python3`; avoid bash variable interpolation. |

## Knowledge and Evolution

| Edge case | Handling |
|---|---|
| Trivial question answered by user | Keep in run transcript; do not write decision. |
| Medium/high design choice | Capture through `guild:decisions`. |
| Existing product knowledge is stale | Init phase refreshes wiki pages and marks old claims superseded or low-confidence. |
| Reflection proposes live skill edit | Queue proposal; do not auto-promote. |
| Skill edit improves aggregate but regresses case | Block unless user explicitly approves regression. |
| Rollback requested | Snapshot rollback as a new version, no destructive deletion. |
| Archived phase-gate docs conflict with active docs | Treat archived gates as historical evidence; current skills, commands, and active docs carry product truth. |

## Guild-Owned-File Boundary & Templates (`[v2]`)

| Edge case | Handling |
|---|---|
| Guild-owned file written outside `.guild/` (signature carried) | A Write/Edit whose **content carries a Guild-owned-file signature** (frontmatter `type:`, a `schema_version: guild.*` marker, or a `task_run`-declared artifact kind) that resolves outside the consuming repo's `.guild/` (including the plugin install dir) → the **PreToolUse guard surfaces the existing always-ask sandbox approval prompt**. No new gate — it reuses the existing approval channel. Never a silent block, never a silent write. |
| Task-required edit of a non-`.guild/` project file | Carries **no** Guild-owned-file signature → passes untouched (no false-positive on legitimate task work). Guild may read/modify project files only when a task explicitly requires it. |
| Runtime write attempted into the plugin install dir | Refused: `plugin/templates/{skills,agents}/*.template.md`, `plugin/skills/**`, `plugin/agents/*.md` are static read-only plugin state. Project instances/overrides go to `.guild/{skills,agents}/`. `/guild audit` boundary-check flags any planted file; a clean run reports zero. |
| `create-specialist` / `evolve-skill` about to write plugin state | Retarget to the consuming repo's `.guild/{agents,skills}/` with `derived_from_template: guild.{skill,agent}_template.vN` stamped at draft. Writing plugin state at runtime is a v2 defect, not a fallback. |
| Skill/agent instance missing `derived_from_template` | Treated as a conformance gap — flagged by the template conformance scan, not auto-fixed. Every instance must trace to its canonical read-only base. |
| Template version mismatch — instance `vN` under template `vN+1` (additive) | **No migration.** Lenient-reader rule: a `vN` instance stays valid under a `vN+1` **additive** template (new optional heading). A conformance report records the non-conformance note only; the instance is not mutated. |
| Template version mismatch — breaking change (renamed/removed required heading) | Per-instance migration is required but **lazy + gated**: it runs only when the instance is next evolved or explicitly selected (`/guild evolve <id> --to-template=vN`), through the existing `guild:evolve-skill` paired-eval + shadow gate. Never a bulk find-replace; never auto-applied. |
| Systemic-vs-specific classifier fires on a single bad skill | Does **not** trigger a template change. Systemic requires ALL of: ≥3 distinct skills/agents (or ≥2 in one run) + the same machine-checkable defect signature + explicit user approval at the interactive template-change gate. A lone deficient skill → per-instance evolve only (false-systemic guard). |
| Template change proposed without the human gate | Refused. The interactive template-change gate is the only interactive gate a template version bump introduces; a template version bump cannot proceed without it (consistent with "agents emit candidates; only humans promote"). |
| LearningCheckpoint verdict tries to touch permission/sandbox/runtime policy | Rejected by construction — no checkpoint verdict may touch the D5 carve-out, and no checkpoint auto-promotes to wiki. The 12-target enum has no such target; verdicts only route to the existing human-gated reflections→promotion pipeline. |

## Codebase Understanding

| Edge case | Handling |
|---|---|
| Stale knowledge graph (graph commit ≠ HEAD) | Mark stale; refresh gated by user or reflection trigger; never silently auto-rebuild mid-task. |
| Huge repo | Inventory and summarize by directory first; ask before deep-scanning vendored/generated trees. |
| Repo file contains injection text | Store as quarantined evidence with `source_refs`; never executed; never treated as instruction. |
| Graph contradicts wiki | Prefer the wiki (canonical) unless the graph has higher-confidence direct evidence; record contradiction for wiki-lint. |
| Graph absent when a lane needs it | Build a minimal scoped graph for the lane or mark a blocker; do not fabricate structure. |
| Ephemeral git worktree | Write **every** durable Guild-owned class (the knowledge graph, `knowledge-links.json`, `provenance.json`, per-phase `learning/`, `initiatives-registry.yaml`, project skill/agent instances, reflections) to the main repo root's `.guild/`, **never** the worktree, so none is lost on cleanup. The rule is general, not graph-only. |
| Asked to depend on the understand-anything plugin at runtime | Refuse; the engine is Guild-owned/forked under MIT attribution and is never a runtime dependency. Governed by **v2-EPP-1 (G6-amended)** — the verbatim policy is reproduced below this table. |

The verbatim `v2-EPP-1 (G6-amended)` policy that governs the row above
(reproduced byte-for-byte from
[`research/25`](../../../../.guild/wiki/_archive/v2-design/sources/25-external-plugin-internalization-policy.md), not
paraphrased):

> **v2-EPP-1 (G6-amended):** Codex (`openai-codex`) is the **sole permitted
> external runtime plugin**. It serves as a **co-equal host adapter**
> (originate / execute / review runs via the neutral `task_run` contract)
> *plus* the rescue, stop-time-review, and CLI-runtime carve-out surfaces.
> There is **no fixed surface-count ceiling** on Codex. The external-plugin
> **exclusivity** rule is unchanged: understand-anything, superpowers, and all
> other third-party capabilities are forked/internalized under MIT attribution
> and are **never runtime dependencies**.

## Concurrency and Resumption

| Edge case | Handling |
|---|---|
| Second `/guild` invocation while a run is active in the same repo | The single-writer advisory lock `.guild/.lock` (holds `run-id` + `pid` + `started-at` + `heartbeat-at`, acquired at Session Intake) is held. Surface "another run is active" with the standard resume / abort / force-takeover prompt — surfaced, never silent. Never silently block; never silently overwrite. |
| Stale lock (`.guild/.lock` holder `pid` not a live process, **OR** `now - heartbeat-at` exceeds `lock.stale_after_minutes` in `.guild/settings.json`, default 30 min — canonical predicate in [`target-architecture.md`](../../../../.guild/wiki/entities/target-architecture.md) Persistence §) | Treat the lock as stale and offer **force-takeover** (acquire the lock for the new run); never auto-steal without surfacing. |
| `/guild resume` reaches an invalid or truncated artifact | An artifact is **invalid** unless (schema/frontmatter parses) AND (required frontmatter fields present) AND (where applicable, the `approved:` flag check passes). On invalid/missing, resume rebuilds from the first invalid/missing step (existing resume-ladder behavior) — never builds on a corrupt upstream. |
| Write interrupted mid-flush | Atomic writes (write temp file then `rename()`) are mandatory for all `.guild/` artifacts, so a reader never sees a half-written file; an interrupted write leaves the prior valid file or nothing, never a truncated artifact. |

The advisory-lock filename, the validity definition, and the atomic-write
rule are specified once in `target-architecture.md` (Persistence discipline);
this table only states the failure handling.

## Advisory Defaults

- Prefer smaller teams, sharper scopes, and explicit dependencies.
- Prefer evidence-bearing artifacts over chat summaries.
- Prefer subagent when agent-team preconditions are incomplete.
- The execution backend is settings-resolved at run-start intake per the D5 ladder (team/tmux primary whenever the tmux preflight conditions hold), resolved once and frozen in the run's resolved-settings snapshot; the preflight prompts to persist `agent_mode: "team"` when tmux is available and `agent_mode != "team"`.
- Prefer concise skills over broad skills.
- Prefer adding a `DO NOT TRIGGER` boundary over relying on vague routing judgment.
- Prefer recording uncertainty as assumptions instead of inventing facts.

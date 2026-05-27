---
name: guild-execute-plan
description: For each specialist lane in the plan: invoke `guild:context-assemble` to build the bundle, auto-score the lane to its lowest viable model tier (dispatched via the Agent `model` param; honors `--model-tier` and per-lane pins), then dispatch each lane via the agent_mode-resolved backend (team / tmux primary; in-process Agent() dispatch for no-tmux hosts; subagent last resort) as an ephemeral one-agent-per-task §task§agent (spawn → work → extract learnings → dismiss). Runs the advisor escalation protocol when a low-tier agent emits `escalate`. Parallelize lanes when `depends-on:` allows. Collect per-lane handoff receipts at `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md`. TRIGGER: "execute the plan", "run the lanes", "start specialist work", "dispatch the team", "dispatch each lane at its tier", "escalate this to the advisor". DO NOT TRIGGER for: explaining the plan (guild:plan owns that), reviewing results (guild:review), writing more tests.
when_to_use: Fifth step of Guild lifecycle, after plan approved and per-specialist context bundles staged.
type: meta
---

# guild:execute-plan

Implements `guild-plan.md §8` (task lifecycle — execute step). Runs after `guild:plan` has produced an approved `.guild/plan/<slug>.md` and before `guild:review`. Dispatches every specialist lane per the DAG encoded by the lanes' `depends-on:` edges, and gathers one handoff receipt per lane into a single run directory `guild:review` consumes verbatim.

## Input

Three things, all required:

1. `.guild/plan/<slug>.md` — the approved per-specialist lane plan. Must have frontmatter `approved: true`; if approval is missing, refuse to dispatch and loop back to `guild:plan`'s approval gate.
2. `.guild/team/<slug>.yaml` — the resolved team from `guild:team-compose`. Authoritative for the execution backend (`subagent` vs `agent-team`) and per-specialist agent-definition paths.
3. `.guild/runs/<run-id>/` — a new run directory created at execute-start. `<run-id>` is a timestamp or run slug owned by this skill; every context bundle, handoff receipt, and assumption log roots under it.

Do not re-derive lanes from chat or from the spec. The plan is the single source of truth for what gets dispatched.

## Per-lane flow

Four strict phases per lane. A lane does not advance until the previous phase has produced its artifact:

1. **Context bundle.** Invoke `guild:context-assemble` for the lane; it writes `.guild/context/<run-id>/<specialist>-<task-id>.md` per §9.3. Read back the bundle's handoff receipt to confirm `bundle_path`, `token_estimate`, `layers_included`. A missing bundle blocks the dispatch — do not paper over with chat context.
2. **Tier resolution.** Auto-score the lane and resolve its tier per `## Tier resolution` — print the score + chosen tier (never silent). The resolved tier becomes the Agent `model` param at dispatch.
3. **Dispatch.** Spawn an **ephemeral one-agent-per-task** agent (see `## §task§agent lifecycle`) at the resolved tier, using the backend selected in `team.yaml`, passing the bundle path as the primary task brief. Before spawning, inject capability-scope env vars (`## Capability-scope env injection`) **and the canonical handoff protocol block** (`dispatch.md §"Handoff protocol"`) verbatim into the agent's prompt — substitute `<RECEIPT_PATH>` and `<TASK_ID>` for this lane before sending. The agent escalates via `## Advisor escalation` if it hits something above its tier. Routing rules, backend mechanics, env injection, and handoff protocol injection: `dispatch.md`.
4. **Receipt.** Confirm the agent wrote its handoff receipt to `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` per §8.2, then **extract its `learnings[]` and dismiss the agent** (lifecycle below). A missing or malformed receipt (no `evidence:` field, no `files changed`) → treat the lane as errored, record the failure in the run log, and do not mark it complete.

A specialist dispatched without a bundle violates the context contract (§9); one that completes without a receipt violates the handoff contract (§8.2). Either condition blocks `guild:review`.

## Tier resolution

Implements the cost-aware-tiering ADR (`docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md §2`). Each lane is dispatched at the **lowest viable tier** — the default biases cheap; a `powerful` invocation must be justified by the score, an explicit override, or an advisor request.

1. **Auto-score (deterministic, via `scripts/score-tier.ts`).** Invoke the pure, LLM-free scorer — `npx tsx scripts/score-tier.ts --signals '<json>' --cwd <repo-root> [--model-tier <pin>]` → `{score, tier, model}` — passing the lane's signals (work-type verb read/summarize=0, draft/extract=+1, architect/review/schema=+2; blast-radius / file count; presence of an upstream `depends-on:` contract; security/correctness sensitivity; prior-attempt escalation on this lane +1, sticky for the run). The scorer is deterministic and costs **zero tokens** (a script call, not an LLM judgment) — so the dispatch trace is reproducible (SC-5). It applies steps 2–4 below internally and returns `score`+`tier`+`model` in one call. The plan's `complexity_score`/`tier` are the authoring estimate; the scorer confirms or supersedes them.
2. **Map score → tier** via the band cutoffs `models.thresholds` (default `{mid:1, powerful:3}`): `0 → cheap`, `1–2 → mid`, `≥3 → powerful`.
3. **Apply the precedence ladder (normative):** `--model-tier=` CLI escape hatch > per-lane plan `tier:` pin > `settings.json` `models.tiers`/`models.thresholds` > built-in default. A `--model-tier` value pins **every** lane in the run; a per-lane plan `tier:` pin overrides the auto-score for that one lane.
4. **Resolve tier → model** through the host-agnostic `models.tiers` map (ADR §1/§10 — bound by pointer; within Claude `cheap=haiku`, `mid=sonnet`, `powerful=opus`). Within Claude this binds directly to the Agent tool `model:` param at dispatch.
5. **Print + record.** Surface the dispatch line (`lane <task-id> · score N · tier <tier> · model <model>`) and write the score + resolved tier into the run record under `.guild/runs/<run-id>/` (never silent — spec Risk). When `models.enabled: false`, skip scoring and dispatch at the backend default.

Config keys (`models.enabled`, `models.tiers`, `models.scoreWeights`, `models.thresholds`, …) are the closed-key `settings.json` `models:` block (ADR §10 — bound by pointer, never re-spelled).

## Advisor escalation

Implements ADR §3. When a low-tier agent hits something above its tier it gets **one powerful sub-answer for that sub-question only**, then continues — it is **not** re-run wholesale on the expensive model.

1. **Trigger.** Any of three conditions independently triggers an advisor escalation:
   - **`status: "escalate"`** — the agent emits `status: "escalate"` + an `escalate_reason` in its `guild.handoff.v2` envelope (in-flight dispatch envelope — canonical body at `docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md §5`, bound by pointer; distinct from and never superseding the frozen `guild.handoff_receipt.v1`).
   - **Uncertainty markers** — the agent's output contains a phrase from `models.escalationMarkers` (e.g. "I'm not sure", "unclear", "cannot determine").
   - **Anomalously short output** (O-3; enabled by D-OBS-3 — bound by pointer at `docs/knowledge/decisions/v2-observability-and-replay.md §D-OBS-3`) — the lane's output-token count falls below `models.shortOutputThreshold[task_type][tier]` in `settings.json`. **This trigger activates only when the threshold key exists** for the `(task_type, tier)` bucket; when absent, the trigger is silent and only the two deterministic triggers above govern. The benchmark analyzer derives and writes the threshold after ≥30 samples per bucket; the coordinator **reads `settings.json` only — no JSONL scanning at dispatch**.
2. **Advisor answers the sub-question only.** Spawn a `powerful` **advisor** agent that sees the **draft + the question + a compact critique instruction (~50 tokens)** and **never the raw file context** — this is what keeps the expensive call cheap.
3. **Fold + continue.** The advisor returns via the same `guild.handoff.v2` envelope; the original cheap agent continues with the advisor's answer folded in. No wholesale re-run.
4. **Round cap.** `models.advisorRounds` (default `2`) caps advisor consults per lane — mirrors the `codex_cap`/`loop_cap` discipline. On exhaustion, record the lane `inconclusive: advisor budget exhausted` rather than silently escalating cost.
5. **Trail.** Record the escalation trail (trigger, sub-question, advisor tier, result ref, round count) in the run record under `.guild/runs/<run-id>/` alongside the dispatch trace, so SC-6 is verifiable.

Review/critic work folds into this advisor pass + the existing `guild:review`/`qa` lanes — there is **no standalone reviewer agent type** (ADR O-1 resolution).

## Capability-scope env injection

Implements the dispatch-side of the v2 security ADR (`docs/knowledge/decisions/v2-security-and-untrusted-content.md` — bound by pointer). Before spawning each lane's ephemeral agent, populate two env vars so the PreToolUse hook (`hooks/lib/security/enforce.ts`) can enforce tool-level isolation:

- **`GUILD_CAPABILITY_SCOPE`** — Set to `JSON.stringify(lane.capability_scope)` where `lane.capability_scope` is the string array from `team.yaml` for this specialist. **Absent field ⇒ omit the env var entirely** (enforcement does not engage; current behaviour unchanged — no breaking change for existing team.yaml files without the field).
- **`GUILD_AUTONOMY_CONTRACT`** — Set to a JSON string array of tool-permission rules derived from the plan lane's `autonomy-policy` `may act without asking` entries. These must be in Claude Code's permission-rule grammar (same syntax as `capability_scope` — e.g. `"Bash"`, `"Write"`, `"Read(*)"` — see `hooks/lib/security/enforce.ts` for rule syntax). **Omit when no machine-readable rules can be derived** from the natural-language entries (absent ⇒ no additional AND-masking).

Both env vars are set **only on the spawned lane agent**, never on the orchestrator process. Enforcement only engages when `GUILD_CAPABILITY_SCOPE` is present — an absent or empty var is a clean fall-through; orchestrator and non-Guild sessions are never affected.

Full env injection detail and backend-specific wiring: `dispatch.md §"Capability-scope env injection"`.

## §task§agent lifecycle

Implements ADR §6 (D3). The **default execution unit is an ephemeral per-task agent** — one agent per task, never shared across tasks, never left idle. This is **orthogonal to** (composes with, never replaces) the D5 `agent_mode` backend ladder: D5 picks the *backend* (team / agent / subagent), this fixes the *lifecycle* (ephemeral, per-task) on whichever backend D5 selected. Visible-pane teams remain opt-in.

**Single-channel handoff protocol.** Every agent in this lifecycle writes its `guild.handoff.v2` receipt file as its final action — never to chat. The canonical protocol block is injected verbatim into every brief at dispatch (step 3 of `## Per-lane flow`); full rules and the injection block: `dispatch.md §"Handoff protocol"`.

Sequence **spawn → work → extract → dismiss**:

1. **Spawn.** Dispatch creates a **new** agent for the task at its resolved tier (`## Tier resolution`) with its pulled task-scoped context (`guild:context-assemble`). Two concurrent tasks get two **distinct** agents — never shared (SC-8).
2. **Work.** The agent executes, escalating via `## Advisor escalation` if it hits something above its tier.
3. **Extract.** On completion the agent extracts **learnings** into its `guild.handoff.v2` envelope (`learnings[]`); the coordinator lands them in the run record (`.guild/runs/<run-id>/`) and, where the gated reflection policy applies, into gated reflections (`.guild/reflections/` via `guild:reflect`). Learnings are **candidates only** — no auto-promotion (promotion stays with `guild:wiki-ingest`/`guild:decisions`).
4. **Dismiss.** The agent **terminates**. No idle agents persist; the next task is a **new** agent. This is why the default is an ephemeral per-task agent and not a long-lived worker pool.

## Backend + routing (summary)

The backend is **not** chosen here — it is chosen at `guild:team-compose` time and mirrored into `team.yaml`. This skill reads and honors that choice. Three invariants you enforce at dispatch — full detail (backend table, launcher invocation, self-build routing table, parallelism rules) in `dispatch.md`:

- **Honor the `agent_mode`-resolved backend; team is primary under tmux.** The backend recorded in `team.yaml` comes from the `agent_mode` ladder (ADR D5) — under tmux that is `agent-team` (one **visible pane per specialist**); for no-tmux hosts supporting independent agents, `in-process` dispatch (launcher returns `dispatchPlan: AgentDispatchDescriptor[]`; execute-plan issues one `Agent()` per descriptor — full flow in `dispatch.md §"In-process dispatchPlan consumption"`); `subagent` is the last resort. Whatever the backend, dispatch each lane to its **named specialist agent** — `subagent_type: <name>` (`backend`, `qa`, `devops`, `architect`, …) for subagents, the teammate spawned from that same agent definition for teams — **never `general-purpose`**, which discards the named agent's persona, scoped skills, tool permissions, and TRIGGER/DO-NOT-TRIGGER boundaries (a defect). The name is the lane's `owner_role`, resolved against `team.yaml`'s agent-definition paths. The **§task§agent lifecycle and tiering are orthogonal to the backend choice**: the named agent is spawned ephemerally per task at its resolved tier (Agent `model:` param), regardless of whether D5 selected team / agent / subagent.
- **Self-build uses the dev-team, not the product specialists.** When the target repo IS the Guild plugin itself, `team.yaml` is composed from the dev-team agents under `.claude/agents/`, routed by changed path (full roster + path table in `dispatch.md`; see also `CLAUDE.md §"Dev team"`). The 14 `guild:` product specialists build *user* products; they are NOT the self-build team.
- **`agent-team` needs explicit user approval + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.** If either is missing, refuse and surface the blocker — never silently fall back to subagents (that would change execution semantics out from under the plan).

Parallelism follows the DAG, not authoring order; scheduling rules and worktree isolation live in `dispatch.md`.

## Codex adversarial review per lane (when `codex_review: true`)

If the run context has `codex_review: true`, invoke `guild:codex-review` after each lane's receipt is confirmed and before the next lane dispatches (or before `guild:review` for the final lane):

```
Skill: guild-codex-review
args: gate=G-lane:<task-id> artifact_path=.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md run_id=<run-id>
```

Substitute `<task-id>` with the lane's task-id (e.g. `T2-backend`); run per-lane in series after the receipt is confirmed. On `status: "rework"`, the lane re-executes — clear its receipt and re-dispatch the specialist with Codex's findings as added context; the re-run counts against `counters.json` key `restart:<lane>` (shared with the L3/L4 cap). On `"satisfied"`, `"skipped"`, or `"force_passed"`, advance normally.

## Receipt collection

This skill does not author receipts — it confirms each exists at `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md`, is readable, and carries the §8.2 fields (scope, files changed, decisions, assumptions, evidence, risks, follow-ups). `guild:review` and `guild:verify-done` read these receipts instead of rehydrating full conversations (§8.2), so receipt integrity is load-bearing.

**Single-channel invariant.** The receipt file is the **authoritative handoff source across all backends** (team / in-process / subagent). The lead never reads handoff content from chat text or SendMessage body — it reads the file. A missing or malformed receipt is an errored lane regardless of what the agent said in chat. Full protocol: `dispatch.md §"Handoff protocol"`.

**Lean-lead intake (ADR §4/§5).** The coordinator dispatches **by pointer** and **never absorbs full specialist transcripts** — it consumes only the compact `guild.handoff.v2` envelope each agent emits (canonical body at ADR §5, bound by pointer). The agent's terminal `guild.handoff.v2` envelope is the input from which the durable `guild.handoff_receipt.v1` is produced for review/verify — the two compose (in-flight envelope → durable receipt), they do not compete. When `models.structuredOutputRequired` is `true`, a return that is not a valid `guild.handoff.v2` envelope (or over-runs the `summary` cap) is a dispatch defect: treat the lane as errored. Full transcripts remain in `.guild/runs/` for audit; they never enter lead context. The lead holds last-N envelopes in full + a rolling summary of older work (`guild:context-assemble §"Lead context"` — bound by pointer).

**Assumption aggregation.** Before the stop condition, aggregate every receipt's `assumptions:` list into `.guild/runs/<run-id>/assumptions.md` (one section per specialist, verbatim). If no lane reported assumptions, still create the file empty (header only) so `guild:verify-done` can tell "no assumptions" from "aggregation skipped" — it is the single handoff verify-done reads for its check #5.

## Stop condition

Execution is complete when every lane has a non-error receipt under `handoffs/`:

- receipt count equals lane count in the plan;
- every receipt has a populated `evidence:` field (§8.2 — never "looks good");
- no receipt is blocked/errored without a matching error record in the run log.

If any lane errored, halt and surface the failure to the user rather than forwarding to `guild:review` — review cannot compensate for a missing receipt. If every lane is clean, hand off to `guild:review`.

## Handoff

Once the stop condition is met, hand off to `guild:review` with:

- `run_id` — the run directory name.
- `handoffs_dir` — absolute path to `.guild/runs/<run-id>/handoffs/`.
- `plan_path` — the approved plan (`.guild/plan/<slug>.md`).
- `lane_count` — number of receipts collected.
- `backend` — the backend used (`subagent` or `agent-team`), mirrored from `team.yaml`.
- `tier_trace` — per-lane `{task-id, complexity_score, tier, model}` as dispatched (the surfaced scores).
- `escalations` — count of advisor consults across the run + any `inconclusive: advisor budget exhausted` lanes.

`guild:review` runs its 2-stage per-task review (spec-conformance then quality) against the receipts in `handoffs_dir`. Do not run review yourself — it is a separate skill with its own responsibilities.

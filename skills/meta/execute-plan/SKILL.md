---
name: guild-execute-plan
description: For each specialist lane in the plan: invoke `guild:context-assemble` to build the bundle, auto-score the lane to its lowest viable model tier (dispatched via the Agent `model` param; honors `--model-tier` and per-lane pins), then dispatch each lane via the agent_mode-resolved backend (team / tmux primary; in-process Agent() dispatch for no-tmux hosts; subagent last resort) as an ephemeral one-agent-per-task §task§agent (spawn → work → extract learnings → dismiss). Runs the advisor escalation protocol when a low-tier agent emits `escalate`. Parallelize lanes when `depends-on:` allows. Collect per-lane handoff receipts at `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md`. TRIGGER: "execute the plan", "run the lanes", "start specialist work", "dispatch the team", "dispatch each lane at its tier", "escalate this to the advisor". DO NOT TRIGGER for: explaining the plan (guild:plan owns that), reviewing results (guild:review), writing more tests.
when_to_use: Fifth step of Guild lifecycle, after plan approved and per-specialist context bundles staged.
type: meta
---

# guild:execute-plan

Implements the task lifecycle execute step. Runs after `guild:plan` has produced an approved `.guild/plan/<slug>.md` and before `guild:review`. Dispatches every specialist lane per the DAG encoded by the lanes' `depends-on:` edges, and gathers one handoff receipt per lane into a single run directory `guild:review` consumes verbatim.

## Input

Four things, all required:

1. `.guild/plan/<slug>.md` — the approved per-specialist lane plan. Must have frontmatter `approved: true`; if approval is missing, refuse to dispatch and loop back to `guild:plan`'s approval gate.
2. The resolved per-phase team file from `guild:team-compose` — **resolved via `resolveTeamFile(guildRoot, slug, readActivePhase(cwd))`** (`scripts/lib/team-file.ts`) → `.guild/team/<slug>.<phase>.yaml` (current) or the legacy `.guild/team/<slug>.yaml` (read-only back-compat). **Pass the resolved per-phase path onward to the launcher** (`## Backend + routing`); a `null` return → request a phase-composition pass (loop back to `guild:team-compose`), never fabricate a path; a legacy hit → emit the one-line deprecation notice once per run (*"single-file team.yaml is legacy; re-compose to adopt per-phase teams"*). Authoritative for **team composition**: the specialist roster, per-specialist scope/dependencies/tiers, and agent-definition paths. **Not** the backend authority — the execution backend is resolved at command intake (`runStartPreflight`) and read from the run's resolved-settings snapshot (`snapshot.effective.agent_mode`, see `## Backend + routing (summary)`).
3. The run's **resolved-settings snapshot** — `.guild/runs/<run-id>/resolved-settings.json`, read via `readResolvedSettingsSnapshot` (`scripts/lib/run-lifecycle.ts`). Authoritative for the execution backend (`snapshot.effective.agent_mode`) and the detected/recommended/selected review providers (`snapshot.providers`).
4. `.guild/runs/<run-id>/` — a new run directory created at execute-start. `<run-id>` is a timestamp or run slug owned by this skill; every context bundle, handoff receipt, and assumption log roots under it.

Do not re-derive lanes from chat or from the spec. The plan is the single source of truth for what gets dispatched.

## Per-lane flow

Four strict phases per lane. A lane does not advance until the previous phase has produced its artifact:

1. **Context bundle.** Invoke `guild:context-assemble` for the lane; it writes `.guild/context/<run-id>/<specialist>-<task-id>.md` per §9.3. Read back the bundle's handoff receipt to confirm `bundle_path`, `token_estimate`, `layers_included`. A missing bundle blocks the dispatch — do not paper over with chat context.
2. **Tier resolution.** Auto-score the lane and resolve its tier per `## Tier resolution` — print the score + chosen tier (never silent). The resolved tier becomes the Agent `model` param at dispatch.
3. **Dispatch.** **First write the lane's `guild.task_run.v1` descriptor** (TE-01 — see `## Task-run descriptor + routing persistence`); then spawn an **ephemeral one-agent-per-task** agent (see `## §task§agent lifecycle`) at the resolved tier, using the snapshot-resolved backend (`snapshot.effective.agent_mode`), passing the bundle path as the primary task brief. Before spawning, inject capability-scope env vars (`## Capability-scope env injection`) **and the canonical handoff protocol block** (`dispatch.md §"Handoff protocol"`) verbatim into the agent's prompt — substitute `<RECEIPT_PATH>` and `<TASK_ID>` for this lane before sending. The agent escalates via `## Advisor escalation` if it hits something above its tier. Routing rules, backend mechanics, env injection, and handoff protocol injection: `dispatch.md`.
4. **Receipt.** Confirm the agent wrote its handoff receipt to `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` per §8.2, **populate the receipt `host` block (`selected` / `degraded` / `independence`) from the lane's routing decision** (TE-03 — see `## Task-run descriptor + routing persistence`), then **extract its `learnings[]` and dismiss the agent** (lifecycle below). A missing or malformed receipt (no `evidence:` field, no `files changed`) → treat the lane as **FAILED**: record the failure in the run log and route it into `## Lane retry + dead-lettering` (retry up to `defaults.retry.max_attempts`, then checkpoint as dead) rather than immediately halting the run.

A specialist dispatched without a bundle violates the context contract (§9); one that completes without a receipt violates the handoff contract (§8.2). Either condition blocks `guild:review`.

## Task-run descriptor + routing persistence (TE-01 / TE-03)

The snapshot-resolved backend selects **how** a lane is dispatched, but the
**subagent / in-process (non-tmux) path runs through this skill** — the
tmux/team launcher (`scripts/agent-team-launcher.ts`) covers only the team
backend. So on the model-driven path the task-run write and routing persistence
are done **here**, per lane.

> **Ownership guard — do these ONLY when `snapshot.effective.agent_mode ∈
> {`subagent`, `agent`}`** (the model-driven path; `agent` is the D5 **in-process**
> rung — use the enum value, not the concept name). The resolved
> `snapshot.effective.agent_mode` enum is `team | agent | subagent | auto`
> (`scripts/lib/settings-resolver.ts`) — there is **no** `in-process` value; the
> in-process backend's value is **`agent`**. When `agent_mode` resolves to `team`
> (tmux/agent-team) **or** a remote backend, the **launcher owns the TE-01
> task_run write + the routing-decision persistence**
> (`scripts/agent-team-launcher.ts`, EDIT-2/3) — this skill **MUST NOT** also
> write them, or the lane double-writes its `task_run.yaml` / receipt `host`
> block. The two backends partition the work cleanly: launcher = team + remote;
> this skill = `subagent` + `agent` (in-process). Test the snapshot's
> `agent_mode` value against `{subagent, agent}` before the writer call below;
> skip it on `team`/remote. (`auto` is resolved to a concrete value at intake, so
> the snapshot never carries `auto` here.)

**TE-01 — write the `guild.task_run.v1` descriptor BEFORE each dispatch attempt
(model-driven path only — see the ownership guard above).** After tier
resolution and before spawning, invoke the writer CLI (one file per attempt; a
re-dispatch overwrites — the writer handles it):

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/write-task-run.ts \
  --cwd <repo-root> --run-id <run-id> --task-id <task-id> \
  --specialist <owner-role> \
  --context-bundle .guild/context/<run-id>/<specialist>-<task-id>.md \
  --depends-on <id,id,...> \
  --max-tokens <scored-budget> --max-turns <scored-turns> \
  [--needs-pr] [--needs-parallel] [--needs-network] \
  [--phase <phase>] \
  --isolation <worktree|none> --host-requested <kind>
```

It writes `.guild/runs/<run-id>/task-runs/<task-id>.yaml` (top-level
`task_run:` wrapper, `context_bundle`, `host.capability_requirements`). Derive
`--max-tokens`/`--max-turns` from the lane's **scored tier** (step 2 — not a flat
default) and the `--needs-*`/`--isolation`/`--host-requested` flags from the
lane's `team.yaml` `host:` block + scope. `--phase <phase>` (default `execute`)
sets the lifecycle phase stamped into the `guild.trace.dispatch.v1` event — it is
a real, caller-supplied phase, not derived from `--initiative-id`. Lanes running
mid-`/guild:build` should pass `--phase execute` explicitly (or the phase they
are actually in, e.g. `review` for a review-loop lane) rather than relying on
the default. The written
`host.capability_requirements` is the **same object** the router reads as
`LaneRequest.capabilityRequirements` in `route()` — writer→router round-trip
identity.

**TE-03 — persist the routing decision into the receipt `host` block** (model-driven
path only — same ownership guard; on team/remote the launcher persists it). When the
lane's handoff receipt is written, populate its `host` block from the
`RoutingDecision` (`route()` return / launcher-surfaced) — `selected`
(`RoutingDecision.host`), `degraded` (`RoutingDecision.degraded`), and
`independence` (`"strong" | "weak"`), with values **equal to** the decision (and
mirrored into run-state `LaneState.host` by the dispatch path).

**Single-host independence rule (state it, never leave implicit).** On the
single-host subagent path with no cross-host routing, set
`selected: <local host>`, `degraded: false`, and **`independence: "weak"` whenever
the reviewer shares the producer's host family** (the common no-cross-host case —
a same-host review is weak independence, exactly as the review broker stamps it).
`independence: "strong"` requires a genuinely different reviewer host family. A
single-host run is therefore `weak`, recorded — never silently `strong`.

## Tier resolution

Implements the cost-aware-tiering ADR (§2). Each lane is dispatched at the **lowest viable tier** — the default biases cheap; a `powerful` invocation must be justified by the score, an explicit override, or an advisor request.

1. **Auto-score (deterministic, via `scripts/score-tier.ts`).** Invoke the pure, LLM-free scorer — `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/score-tier.ts --signals '<json>' --cwd <repo-root> [--model-tier <pin>]` → `{score, tier, model}` — passing the lane's signals (work-type verb read/summarize=0, draft/extract=+1, architect/review/schema=+2; blast-radius / file count; presence of an upstream `depends-on:` contract; security/correctness sensitivity; prior-attempt escalation on this lane +1, sticky for the run). The scorer is deterministic and costs **zero tokens** (a script call, not an LLM judgment) — so the dispatch trace is reproducible (SC-5). It applies steps 2–4 below internally and returns `score`+`tier`+`model` in one call. The plan's `complexity_score`/`tier` are the authoring estimate; the scorer confirms or supersedes them.
2. **Map score → tier** via the band cutoffs `models.thresholds` (default `{mid:1, powerful:3}`): `0 → cheap`, `1–2 → mid`, `≥3 → powerful`.
3. **Apply the precedence ladder (normative):** `--model-tier=` CLI escape hatch > per-lane plan `tier:` pin > `settings.json` `models.tiers`/`models.thresholds` > built-in default. A `--model-tier` value pins **every** lane in the run; a per-lane plan `tier:` pin overrides the auto-score for that one lane.
4. **Resolve tier → model** through the host-agnostic `models.tiers` map (ADR §1/§10 — bound by pointer; within Claude `cheap=haiku`, `mid=sonnet`, `powerful=opus`). Within Claude this binds directly to the Agent tool `model:` param at dispatch.
5. **Print + record.** Surface the dispatch line (`lane <task-id> · score N · tier <tier> · model <model>`) and write the score + resolved tier into the run record under `.guild/runs/<run-id>/` (never silent — spec Risk). When `models.enabled: false`, skip scoring and dispatch at the backend default.
6. **Persist the re-scored tier into `team.yaml` (ARCH-6 Part 2 / W2-A3).** After auto-scoring a lane, write the scored tier back into the resolved per-phase `team.yaml`'s matching specialist entry via the **concurrent-safe writeback helper** — so the team-backend launcher's `tier ?? default_tier` (tooling's ARCH-6 Part 1) consumes the **re-scored** tier and tmux panes route at the per-lane score, not just the roster `default_tier`:

   ```ts
   import { writeBackScoredTier } from "../scripts/lib/write-back-scored-tier";
   const result = writeBackScoredTier(resolvedTeamYamlPath, lane.owner, scoredTier);
   if (!result.ok) console.warn(result.message);  // non-fatal — degrades to default_tier, observably
   ```

   The helper is **lock-based** (`O_EXCL` lock on `<team.yaml>.scoring.lock`, atomic temp+rename, idempotent, **never throws**, releases the lock even on error), so parallel lanes completing at the same instant cannot clobber the generated team-shape artifact — this is why a raw inline hand-edit was wrong and this helper is right. `result.ok` is the success check; on `false`, surface `result.message` as a warning — a writeback failure is **non-fatal**: the lane still dispatches and the team backend simply routes that specialist at `default_tier` (observable degradation, never silent, never a hard stop).

   The two backend paths now both honor the score: the **model-driven path** (subagent / `agent` in-process) applies the re-scored tier directly via the Agent `model:` param at dispatch; the **team-backend path** (tmux panes) reads the just-written `tier:` from `team.yaml`. `resolvedTeamYamlPath` is the path resolved via `resolveTeamFile` (the per-phase file). Skip the writeback when `models.enabled: false` (no scoring ran).

Config keys (`models.enabled`, `models.tiers`, `models.scoreWeights`, `models.thresholds`, …) are the closed-key `settings.json` `models:` block (ADR §10 — bound by pointer, never re-spelled).

## Advisor escalation

Implements ADR §3. When a low-tier agent hits something above its tier it gets **one powerful sub-answer for that sub-question only**, then continues — it is **not** re-run wholesale on the expensive model.

1. **Trigger.** Any of three conditions independently triggers an advisor escalation:
   - **`status: "escalate"`** — the agent emits `status: "escalate"` + an `escalate_reason` in its `guild.handoff.v2` envelope (in-flight dispatch envelope — canonical body at cost-aware-tiering ADR §5, bound by pointer; distinct from and never superseding the frozen `guild.handoff_receipt.v1`).
   - **Uncertainty markers** — the agent's output contains a phrase from `models.escalationMarkers` (e.g. "I'm not sure", "unclear", "cannot determine").
   - **Anomalously short output** (O-3; enabled by D-OBS-3 — the lane's output-token count falls below `models.shortOutputThreshold[task_type][tier]` in `settings.json`. **This trigger activates only when the threshold key exists** for the `(task_type, tier)` bucket; when absent, the trigger is silent and only the two deterministic triggers above govern. The benchmark analyzer derives and writes the threshold after ≥30 samples per bucket; the coordinator **reads `settings.json` only — no JSONL scanning at dispatch**.
2. **Advisor answers the sub-question only.** Spawn a `powerful` **advisor** agent that sees the **draft + the question + a compact critique instruction (~50 tokens)** and **never the raw file context** — this is what keeps the expensive call cheap. **Route the advisor to the resolved advisory substrate (universal-host C1).** Read the per-run advisory role from the snapshot — `snapshot.roles.advisory.substrate` (`RoleResolutionSet`, recorded by `runStartPreflight`) — and dispatch the advisor on that host. The DEFAULT Claude+Codex box resolves `advisory = claude` (the local advisor), so this is **byte-identical to today** on a default box; a box whose advisory role resolved to a different substrate routes the consult there. Never re-resolve the substrate here or guess from the host name — consume the snapshot's `roles.advisory` (capability-matrix-driven at preflight).
3. **Fold + continue.** The advisor returns via the same `guild.handoff.v2` envelope; the original cheap agent continues with the advisor's answer folded in. No wholesale re-run.
4. **Round cap.** `models.advisorRounds` (default `2`) caps advisor consults per lane — mirrors the `codex_cap`/`loop_cap` discipline. On exhaustion, record the lane `inconclusive: advisor budget exhausted` rather than silently escalating cost.
5. **Trail.** Record the escalation trail (trigger, sub-question, advisor tier, result ref, round count) in the run record under `.guild/runs/<run-id>/` alongside the dispatch trace, so SC-6 is verifiable. **When the escalation is persisted as a durable `guild.advisory.v1` AdvisoryRecord** (`scripts/lib/advisory-record.ts` `makeAdvisoryRecord`), **stamp the C1 `substrate` field from the resolved advisory role** — pass `advisorySubstrateFromRoles(snapshot.roles)` (`scripts/lib/role-resolver.ts`) as the `substrate:` input so the record carries `substrate == roles.advisory`:

   ```ts
   import { advisorySubstrateFromRoles } from "../scripts/lib/role-resolver";
   const rec = makeAdvisoryRecord({
     /* …id, recorded_at, phase, backend, question, advisors, … */
     substrate: advisorySubstrateFromRoles(snapshot.roles),  // C1: routed advisory host
   });
   ```

   `advisorySubstrateFromRoles` returns `undefined` when the role's substrate is absent/unknown — and an **absent `substrate` means the default local advisor (`"claude"`)** per advisory-record back-compat, so a default Claude box records `substrate: "claude"` (equivalently absent). This is the C1 routing change L8 deferred to this call-site (SC-5): advisory advice now ROUTES to and is RECORDED with the resolved substrate, not just resolved in preflight.

Review/critic work folds into this advisor pass + the existing `guild:review`/`qa` lanes — there is **no standalone reviewer agent type** (ADR O-1 resolution).

## Capability-scope env injection

Implements the dispatch-side of the v2 security ADR (bound by pointer). This is a **real orchestrator step, not aspirational scoping**: the scope IS published for the lane, the PreToolUse hook (`hooks/lib/security/enforce.ts`) reads it, and an out-of-scope tool call is **blocked**.

**Two delivery channels — env fast-path + file backstop (write BOTH).** The enforce hook resolves the lane's scope by reading the env var first (fast-path) and **falling back to a per-task scope file** when the env is absent. Because Agent-env propagation to the spawned hook is **not guaranteed on the subagent / in-process path**, the orchestrator MUST write the scope file too — it is the **backend-uniform** enforcement mechanism (env alone may not reach the hook there; the file always does). Write both; either one present ⇒ enforcement engages.

First, the **env vars**, injected **on the spawned lane agent only** (never the orchestrator process):

- **`GUILD_CAPABILITY_SCOPE`** = `JSON.stringify(lane.capability_scope)` — the string array read from `team.yaml` for this specialist. **If the lane has no `capability_scope` field ⇒ DO NOT set the env var** (additive no-scoping — byte-identical to current behaviour; no breaking change for team.yaml files without the field).
- **`GUILD_AUTONOMY_CONTRACT`** = a JSON string array of tool-permission rules derived from the plan lane's `autonomy-policy` `may act without asking` entries, in Claude Code permission-rule grammar (e.g. `"Bash"`, `"Write"`, `"Read(*)"` — syntax per `hooks/lib/security/enforce.ts`). **Omit when no machine-readable rules can be derived** (absent ⇒ no additional AND-masking).

**Per-backend injection (concrete, code-backed):**

- **Subagent / in-process (`agent`) — model-driven path, this skill spawns via `Agent()`:** **write the scope file, then** set the env vars in the spawn `env` map at call time:

  ```ts
  // (1) FILE BACKSTOP — write before the spawn (backend-uniform; the file path the hook reads).
  if (lane.capability_scope) {
    const scopeDir = path.join(runDir, "scope");          // runDir = .guild/runs/<run-id>
    fs.mkdirSync(scopeDir, { recursive: true });
    fs.writeFileSync(
      path.join(scopeDir, `${lane.taskId}.json`),         // hook reads runs/<run-id>/scope/<task-id>.json
      JSON.stringify({ capability_scope: lane.capability_scope, autonomy_contract: autonomyRules ?? null }),
    );
  }
  // (2) ENV — inject on the spawn env. GUILD_RUN_ID + GUILD_TASK_ID are REQUIRED for the hook to
  //     locate the scope file (it resolves the path from these); GUILD_CAPABILITY_SCOPE is the fast-path.
  const env = { ...descriptorEnv };                       // carries GUILD_RUN_ID (in-process: descriptor.env)
  env.GUILD_RUN_ID = runId;
  env.GUILD_TASK_ID = lane.taskId;                        // ← without this the file backstop is unlocatable
  if (lane.capability_scope) env.GUILD_CAPABILITY_SCOPE = JSON.stringify(lane.capability_scope);
  if (autonomyRules?.length)  env.GUILD_AUTONOMY_CONTRACT = JSON.stringify(autonomyRules);
  // (3) SPAWN — subagent_type is DEFINITION-SOURCE-RESOLVED (dispatch.md hard
  //     constraint). Domain specialists are project instances: the host has no
  //     registered agent under their name, so they dispatch as the host-generic
  //     type with GUILD_AGENT_DEFINITION + the adoption prompt. Both carriers are
  //     UNCONDITIONAL for a project specialist and ALWAYS present on the
  //     descriptor (composeInProcessDispatch keys them on definition_source ===
  //     "project" alone, and throws if the lane has no definition path — #58). A
  //     PreToolUse dispatch-integrity guard DENIES any general-purpose Agent
  //     dispatch that claims a specialist persona without GUILD_AGENT_DEFINITION,
  //     so a persona-stripped call can no longer masquerade as a real lane. Only
  //     a SHIPPED machinery/dev-team agent dispatches by bare name.
  const subagentType =
    lane.definition_source === "project" ? GENERIC_SUBAGENT_TYPE /* + definition env/prompt from the descriptor */
                                         : lane.owner;
  Agent({ subagent_type: subagentType, model: resolvedModel, prompt, env });
  ```

  **Absent `capability_scope` ⇒ write no file AND set no `GUILD_CAPABILITY_SCOPE`** (additive no-scoping; byte-identical to current). Still set `GUILD_RUN_ID`/`GUILD_TASK_ID` (they're harmless run-context, not scope) — but with no file and no scope env, the hook's `scope === null` clean fall-through applies. Omit each scope env key / the `autonomy_contract` value whose source field is absent — never set an empty/`"undefined"` value. The scope file is keyed by the lane's **task-id**, matching the hook's read path `.guild/runs/<run-id>/scope/<task-id>.json` (`hooks/pre-tool-use.ts` — it resolves that path from `GUILD_RUN_ID` + `GUILD_TASK_ID`).
- **Team / tmux (`team`) and remote:** the **launcher** (`scripts/agent-team-launcher.ts`) writes the **same scope file** + does the per-pane env injection (tooling-owned) — this skill does not touch pane env/file. Same path, same JSON shape; one contract across backends.

Enforcement engages when **either** the env var **or** the scope file is present — both absent is a clean fall-through; the orchestrator and non-Guild sessions are never affected. Full backend-specific wiring: `dispatch.md §"Capability-scope env injection"` and `dispatch.md §"In-process dispatchPlan consumption"`.

## §task§agent lifecycle

Implements ADR §6 (D3). The **default execution unit is an ephemeral per-task agent** — one agent per task, never shared across tasks, never left idle. This is **orthogonal to** (composes with, never replaces) the D5 `agent_mode` backend ladder: D5 picks the *backend* (team / agent / subagent), this fixes the *lifecycle* (ephemeral, per-task) on whichever backend D5 selected. The backend itself is settings-resolved at run-start intake (`runStartPreflight` → the resolved-settings snapshot) per the D5 ladder — team/tmux is **primary whenever tmux is available**, not opt-in; subagent is the fallback for CI / no-tmux hosts.

**Single-channel handoff protocol.** Every agent in this lifecycle writes its receipt file as its final action — a `guild.handoff_receipt.v1` wrapper embedding exactly one `guild.handoff.v2` block — never to chat. The canonical protocol block is injected verbatim into every brief at dispatch (step 3 of `## Per-lane flow`); full rules, the frozen field set (schema by pointer), and the injection block: `dispatch.md §"Handoff protocol"`.

Sequence **spawn → work → extract → dismiss**:

1. **Spawn.** Dispatch creates a **new** agent for the task at its resolved tier (`## Tier resolution`) with its pulled task-scoped context (`guild:context-assemble`). Two concurrent tasks get two **distinct** agents — never shared (SC-8).
2. **Work.** The agent executes, escalating via `## Advisor escalation` if it hits something above its tier.
3. **Extract.** On completion the agent extracts **learnings** into its `guild.handoff.v2` envelope (`learnings[]`); the coordinator lands them in the run record (`.guild/runs/<run-id>/`) and, where the gated reflection policy applies, into gated reflections (`.guild/reflections/` via `guild:reflect`). Learnings are **candidates only** — no auto-promotion (promotion stays with `guild:wiki-ingest`/`guild:decisions`).
4. **Dismiss.** The agent **terminates**. No idle agents persist; the next task is a **new** agent. This is why the default is an ephemeral per-task agent and not a long-lived worker pool.

## Backend + routing (summary)

The backend is **not** chosen here, and it is **not** chosen at `guild:team-compose` either. It is resolved **once at command intake** by `runStartPreflight` (U3) per the D5 `agent_mode` ladder, and frozen in the run's resolved-settings snapshot (U6 writes `.guild/runs/<run-id>/resolved-settings.json`). **`execute-plan` reads that snapshot via `readResolvedSettingsSnapshot` (`scripts/lib/run-lifecycle.ts`) and acts on `snapshot.effective.agent_mode` and `snapshot.providers`** — it does NOT re-resolve settings or re-run the preflight. `team.yaml` is authoritative for the **team composition** (which specialists, their scope, dependencies, tiers, agent-definition paths), **not** for the backend selection — the backend authority is the resolved snapshot. Mid-run config edits do not silently change execution behavior because the snapshot is fixed at intake. Three invariants you enforce at dispatch — full detail (backend table, launcher invocation, self-build routing table, parallelism rules) in `dispatch.md`:

- **cmux-first dispatch — checked before tmux, top of the `team` rung (interim manual path until W4 lands).** When `CMUX_WORKSPACE_ID` is present in the environment — checked ONCE at dispatch setup, then held constant for the whole run (the resolved-settings snapshot does **not** yet carry a cmux field; snapshot-frozen resolution and the `agent_mode` enum value are the queued **code half**, initiative `run-identity-and-dispatch` W4 — until it lands this rung is the ADR-sanctioned manual orchestration path and the one place the environment is read) — dispatch each lane as a **visible cmux terminal surface in the caller's workspace** instead of a tmux pane: one surface per lane via `cmux new-pane` / `cmux new-surface --focus false` (or the host-current equivalent) — **never** a focus-stealing verb; set each lane's own sidebar status/progress (`set-status` / `set-progress`) as it advances, a per-lane signal, never shared/aggregate. Lanes still write their handoff to `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` per the single-channel protocol (`## §task§agent lifecycle` below) — the surface is a dispatch/visibility mechanism, never a second handoff channel. The lead arms a **per-lane completion watcher** on each lane's own handoff file — never one watcher shared across lanes, since a finished lane must be actionable immediately, not sit behind whatever lane a shared watcher happens to be polling next. Once a lane's receipt is accepted, **reap its surface** — do not let finished surfaces linger. **The lead does all commits — lanes dispatched via cmux never commit their own work**, the same invariant as every other backend. **Launcher-owned obligations transfer to the lead.** Dispatching via cmux surfaces bypasses the tmux agent-team launcher, so the lead explicitly assumes what the launcher otherwise owns: (a) the team-mode task-run persistence under `.guild/runs/<run-id>/` (the lead writes the dispatch records the launcher would have); (b) capability-scope enforcement — if the launcher's scope-file backstop cannot be applied to a raw surface, the lead records a **degradation receipt** for the lost enforcement (host-capability loss discipline) instead of silently dropping it; (c) the agent-bus lifecycle events (orchestrator-emitted, as on the model-driven backends — see `## Receipt collection`). A lead that cannot honor these obligations MUST fall back to the tmux launcher rung rather than dispatch unaccountable surfaces. When `CMUX_WORKSPACE_ID` is absent, this rung does not apply; fall through to tmux visible panes (the existing rung below is unchanged). *Evidence: umbrella `.guild/wiki/decisions/cmux-first-dispatch.md` (merged ADR); initiative `run-identity-and-dispatch` work-item W4 — the `agent_mode` code enum is the queued code half of that ADR, this bullet is its behavioral half.*
- **Dispatch-verification — confirm pickup, never assume it (task-store rung only).** This clause governs the `agent-team` task-store signal path (`TaskCreate` + owner-assignment into tmux panes); the cmux rung above never uses `TaskCreate` — it dispatches by `cmux send` + read-screen monitoring per the ADR, so pickup there is direct by construction. After `TaskCreate` + owner-assignment, the lead **MUST verify pickup within a bounded timeout** (default **60s**; honor a project-configured dispatch-pickup timeout when the config surface provides one — never the 10-minute `heartbeat_timeout_ms`, which governs mid-run liveness, not dispatch). **Pickup means the teammate CLAIMED the task**: the task status set by the owning teammate, or pane read-screen evidence it echoed/acted on the task-id — a status change from any other writer does not count. **On no-pickup, fall back to direct injection** (`tmux send-keys` to the teammate's own pane) carrying the same brief **including the task-id and a claim-first instruction** — the teammate claims the task before working, so a late-arriving task-store delivery of an already-claimed task is an idempotent no-op (no double-work). **Record the fallback** in the run's dispatch trace (which lane, pickup-verification failure, direct injection used). Never assume a `TaskCreate` reaching the task store means it reached the pane. *(Codification note: the 2026-06-14 run applied this fallback ad hoc; this clause makes it mandatory, bounded, and verified. In paired evals the OLD body is sample-ambiguous on this case — one A sample chose the fallback, another kept waiting — which is exactly why the clause pins it.)* *Evidence: reflection `run-2026-06-14T21-06-12-400Z` — `TaskCreate` reached only 2 of 4 teammates and `SendMessage`-by-name failed for the other 2, with no verification step to catch it before the run stalled (that run predates the runs-directory canonicalization — its run-id shape predates the current `run-<yyyymmdd-hhmmss>-<slug>` convention).*
- **Honor the snapshot-resolved backend; team is primary under tmux (cmux surfaces are checked first, when present — see the cmux-first bullet above).** The backend comes from `snapshot.effective.agent_mode` (resolved at intake via the D5 ladder, ADR D5) — under `team`, when cmux is absent, that is `agent-team` (one **visible pane per specialist**); for no-tmux/no-cmux hosts supporting independent agents, `in-process` dispatch (launcher returns `dispatchPlan: GuildDispatchDescriptor[]`; execute-plan issues one `Agent()` per descriptor — full flow in `dispatch.md §"In-process dispatchPlan consumption"`); `subagent` is the last resort. Whatever the backend, dispatch each lane AS its **named specialist role**, resolved against `team.yaml`'s `definition:` + `definition_source:` fields: a **shipped** specialist dispatches by name (`subagent_type: <name>` for subagents; the teammate spawned from that definition for teams) — bare `general-purpose` for a shipped specialist discards its persona, scoped skills, tool permissions, and TRIGGER/DO-NOT-TRIGGER boundaries (a defect); a **project-local** specialist (`definition_source: project`, `.guild/agents/<name>.md`) has no host-registered agent to name, so the backend dispatches the host-generic type with the definition-adoption instruction embedded in the lane prompt at the specialist's own tier (first-class, not degraded — full rule in `dispatch.md`). The **§task§agent lifecycle and tiering are orthogonal to the backend choice**: the named agent is spawned ephemerally per task at its resolved tier (Agent `model:` param), regardless of whether D5 selected team / agent / subagent.
- **Self-build uses the dev-team, not the product specialists.** When the target repo IS the Guild plugin itself, `team.yaml` is composed from the dev-team agents under `.claude/agents/`, routed by changed path (full roster + path table in `dispatch.md`; see also `CLAUDE.md §"Dev team"`). The 15 domain specialist roles (minted from templates/specialists/) build *user* products; they are NOT the self-build team.
- **`agent-team` needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` — there is no separate dispatch-time approval gate.** The backend is simply the resolved snapshot value (`snapshot.effective.agent_mode`); the only operator prompt is the **per-run tmux-enablement preflight prompt** at intake (`runStartPreflight` → `needsTmuxPrompt`, which persists `agent_mode: team` on yes), not a blocker raised here at dispatch. At dispatch, the one hard gate is the env var: if the snapshot resolves `agent-team` and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is absent, refuse and surface the blocker — never silently fall back to subagents (that would change execution semantics out from under the plan).

Parallelism follows the DAG, not authoring order; scheduling rules and worktree isolation live in `dispatch.md` — except the spine-lane verify checkpoint below, which this skill owns directly.

## Spine-lane verify checkpoint (mandatory, overrides the inline-shortcut fast path)

A **spine lane** is any lane that one or more *other* lanes list in their `depends-on:` — `architect` is the common case (`dispatch.md §"Architect first when present"`), but any lane with downstream dependents qualifies. When the plan declares a spine lane, insert a **mandatory verify checkpoint after the spine lane's receipt lands and BEFORE any dependent lane fans out** — even under `--auto-approve=all` / `--rigor=deep --auto-approve=all`. `## Inline shortcut under high autonomy` above does **not** exempt a spine lane from this checkpoint: that section's own condition #3 ("no cross-lane contract handoff") already excludes it — a spine lane's dependents are, by definition, pulling a contract from its receipt.

This checkpoint is **NOT** a repeat of receipt-shape validation (which already runs for every lane) and **NOT** a substitute for G-lane review (which also runs). Its differential content is **dependent-contract verification** — the verify-the-claim discipline applied at the fan-out boundary:

1. **Enumerate the consumed contract.** From the plan, collect what each dependent lane's brief actually pulls from the spine (files, interfaces, schema names, decisions its `scope` references).
2. **Independently verify each consumed item** against the spine's receipt claims: the artifact exists on disk, and a spot-read confirms it matches what the receipt says it is (never trust the receipt's `evidence:` text alone — open the artifact). Field-presence checking is the ordinary receipt gate, not this one.
3. **Ordering is fixed:** receipt-shape validation → `## Lane retry + dead-lettering` (if malformed/missing) → G-lane review (per policy; always-on for self-build) → **this spine checkpoint** → fan-out. A **replacement receipt** produced by a retry or a G-lane rework **re-enters this checkpoint** before any dependent dispatches — a passed checkpoint never survives a receipt swap.
4. On a failed verification, hold every dependent, route the spine lane back per step 3's chain, and record the failure. Record the checkpoint's pass/fail in the dispatch trace alongside the spine lane's tier/score line.

A corrupted spine poisons every downstream lane's provenance — the cost of this checkpoint is one lane's worth of verification against the alternative of re-running an entire fan-out.

*Evidence: reflection `run-learn-knowledge-convergence-20260529-094021` — the same run this checkpoint and `## Hard-set gate deferral under high autonomy` both trace to.*

## Adversarial review per lane — G-lane (broker, when policy fires)

G-lane is the **only command-visible gate** (adversarial-review spec §Gate ownership): it fires per-lane here during `build`, so `build`'s skill set owns the review step. Wire the **review broker** at the lane-receipt boundary, **not** `guild:codex-review` directly: the broker is the host-agnostic front door, and `guild:codex-review` survives only as the internal Codex adapter the broker dispatches to (adversarial-review spec §The review broker).

After each lane's receipt is confirmed and before the next lane dispatches (or before `guild:review` for the final lane), invoke `guild:review-broker`:

```
Skill: guild-review-broker
args: gate=G-lane:<task-id> artifact_path=.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md run_id=<run-id> author_host=<run author host>
```

Because the gate id is **per-lane** (`G-lane:<task-id>`, matching the frozen `G-lane:${string}` union), the broker's AC-9 review trail for the lane lands in a **per-lane subdirectory** — `.guild/runs/<run-id>/review/G-lane:<task-id>/` (packet / result / trail). This is the declared trail path; `build.md`'s AC-9 root declaration MUST read identically (`review/G-lane:<task-id>/`, not the lane-collapsed `review/G-lane/`) so the declared path equals the actual write path.

Substitute `<task-id>` with the lane's task-id (e.g. `T2-backend`); run per-lane in series after the receipt is confirmed. The broker is **policy-gated** (adversarial-review spec §The review broker): it fires only when `risk ≥ high`, `review: cross` / `--review=cross` is set, or project config requires it — otherwise it resolves `status: "skipped"` and the lane advances with no reviewer. Self-build runs treat cross-host review as always-on. `author_host` is the host that produced the receipt (resolved from the run-start preflight snapshot; `claude` on a Claude-hosted run). On `status: "rework"`, the lane re-executes — clear its receipt and re-dispatch the specialist with the findings as added context; the re-run counts against `counters.json` key `restart:<lane>` (shared with the L3/L4 cap). On `"satisfied"`, `"skipped"`, or `"force_passed"`, advance normally.

## Receipt collection

This skill does not author receipts — it confirms each exists at `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md`, is readable, and carries the §8.2 fields (scope, files changed, decisions, assumptions, evidence, risks, follow-ups). `guild:review` and `guild:verify-done` read these receipts instead of rehydrating full conversations (§8.2), so receipt integrity is load-bearing.

**Single-channel invariant.** The receipt file is the **authoritative handoff source across all backends** (team / in-process / subagent). The lead never reads handoff content from chat text or SendMessage body — it reads the file. A missing or malformed receipt is an errored lane regardless of what the agent said in chat. Full protocol: `dispatch.md §"Handoff protocol"`.

**Agent-bus event log (SK-5 — concept #4, the single-channel coordination substrate).** Beyond the per-lane receipt, the dispatch path emits **inter-lane lifecycle events** (lane dispatched, lane completed, lane errored/retried) to the canonical agent-bus event log `.guild/runs/<run-id>/agent-bus/events.ndjson` (the host-neutral channel for events / approvals / questions / heartbeats; FDC-4, **critical**). This is a **PCR-Development must-exist artifact** (`build.md` output floor), so the dispatch path MUST produce it:

- **Team backend:** the agent-team lifecycle hooks (`TaskCreated` / `TaskCompleted` / `TeammateIdle`, hook-engineer-owned) emit the bus events.
- **Model-driven (subagent / in-process `agent`):** there are no agent-team hooks, so **the orchestrator emits the bus event itself** at each lane boundary — append one event per lane-dispatched / lane-completed transition. Use the tooling bus-emit helper (atomic temp-write + rename + the `.guild/.lock` single-writer lock — concurrent lanes must not tear the log); never hand-append without the atomic-rename discipline.

The receipt remains the **truth** (single-channel handoff); the bus event log is the **event stream** a `resume`/replay reads to reconstruct lane timing without host memory — they compose, the bus never substitutes for the receipt. *(The bus-emit helper + the team-backend hook emission are tooling/hook-owned; this skill states the seam + the model-driven orchestrator's emit obligation so the must-exist artifact is actually produced.)*

**Lean-lead intake (ADR §4/§5).** The coordinator dispatches **by pointer** and **never absorbs full specialist transcripts** — it consumes only the compact `guild.handoff.v2` block each agent emits (canonical body at ADR §5, bound by pointer). The agent's terminal receipt is a durable `guild.handoff_receipt.v1` wrapper that **embeds** exactly one `guild.handoff.v2` block for review/verify — the v1 frontmatter is human-review context and the single embedded v2 block is the machine truth; the two compose (wrapper includes block), they do not compete. Schema detail is bound by pointer to `dispatch.md §"Handoff protocol"`, never re-spelled here. When `models.structuredOutputRequired` is `true`, a return that is not a valid `guild.handoff.v2` envelope (or over-runs the `summary` cap) is a dispatch defect: treat the lane as errored. Full transcripts remain in `.guild/runs/` for audit; they never enter lead context. The lead holds last-N envelopes in full + a rolling summary of older work (`guild:context-assemble §"Lead context"` — bound by pointer).

**Assumption aggregation.** Before the stop condition, aggregate every receipt's `assumptions:` list into `.guild/runs/<run-id>/assumptions.md` (one section per specialist, verbatim). If no lane reported assumptions, still create the file empty (header only) so `guild:verify-done` can tell "no assumptions" from "aggregation skipped" — it is the single handoff verify-done reads for its check #5.

## Emit the companion `guild.team_result.v1` (ADDITIVE, FAIL-SOFT — G6b-2b)

After all lanes are dispatched and their handoff receipts collected (`## Receipt collection`), ALSO emit a typed `guild.team_result.v1` as a **companion** to the run. This ADDS a typed artifact; it changes **nothing** in the dispatch logic above. The receipts under `handoffs/` stay the **AUTHORITATIVE** handoff truth; the team_result is the machine-typed mirror pairing the dispatched instances to the `guild.team_plan.v1` (roster + advisory panel) `guild:team-compose` emitted at compose time.

Emit via `writeTeamResult` (`src/modules/teams/workflows/station-signals.ts`) to `.guild/runs/<run-id>/team-result/<station>.json`, where `<station>` is the active phase token (the same token that named the companion team_plan):

- **`team_plan_ref`** → the companion team_plan path from `guild:team-compose` step 5's emit, `.guild/runs/<run-id>/team-plan/<station>.json` — forwarded through `guild:plan`'s handoff as `team_plan_path`. If NO team_plan was emitted (team-compose skipped/failed its fail-soft emit, so no `team_plan_path` was forwarded), **skip the team_result emit too** with a logged note.
- **`lanes[]`** — ONE entry per dispatched lane: `role` (the lane owner), the **FRESH per-instance `instance_id`** (G2 D3 — DISTINCT per lane, derived from the lane's fresh runtime identity, e.g. its `task_run_id`+`attempt`, never a reused role name; `validateTeamResultV1` **REJECTS a duplicate `instance_id`**, which is exactly what proves "fresh identities + typed results"), `handoff_ref` (pointer to the lane's receipt under `handoffs/`, `null` until submitted), and `acceptance_ref` (`null` until accepted).
- **FAIL-SOFT.** `writeTeamResult` is fail-**closed** on an invalid result (it throws rather than persist a bad artifact); wrap the call so any throw records a one-line degradation note and **CONTINUES** — the receipts are authoritative, so a missing/failed team_result never blocks `guild:review`.

The fresh, distinct `instance_id`s recorded here are the typed proof that each lane ran as its own runtime identity — the team_result is the mirror `guild:review`/benchmark can read without rehydrating full transcripts. (Contract: `guild.team_result.v1` in `src/modules/teams/workflows/station-composer.ts`; writer + run-tree path in `station-signals.ts`.)

## Inline shortcut under high autonomy (`--rigor=deep --auto-approve=all`)

When the run posture is `--rigor=deep --auto-approve=all` AND the operator is
**not** engaged for per-gate confirmation, the orchestrator MAY inline the
per-lane chain (`guild:context-assemble → dispatch → guild:review`) instead
of invoking each sub-skill formally. This shortcut emerged organically across
three self-build runs (`docs-clean-up`, `share-dot-guild`,
`cross-platform-compatibility`) and is now codified — it is **not** a defect.

### When inline IS valid

All three conditions must hold:

1. **Posture allows it.** `--auto-approve=all` set on the run, OR
   `defaults.auto_approve: all` in `.guild/settings.json`. The autonomy
   contract is genuinely high — no per-gate confirmation expected.
2. **Lane corpus is small.** The lane's input fits the orchestrator's
   working set without a structured bundle — see
   `guild:context-assemble §"Mandatory-invocation threshold"` for the cap.
   When the cap is crossed, formal `guild:context-assemble` is **mandatory**
   regardless of posture.
3. **No cross-lane contract handoff.** The lane has no upstream
   `depends-on:` requiring a verbatim contract pull from a sibling lane's
   handoff receipt. Cross-lane contracts demand a bundle for reproducibility.

### When inline is FORBIDDEN

Any of these conditions forces the formal sub-skill chain:

- Operator is **engaged for per-gate confirmation** (`--auto-approve` unset
  or value `risky-only`/`destructive-only`). Each gate must surface for
  approval — inlining bypasses the approval surface.
- **Lane corpus exceeds the threshold** in
  `guild:context-assemble §"Mandatory-invocation threshold"`.
- **Upstream `depends-on:` contract** must be threaded into the lane
  (`guild:context-assemble §"Role mapping" / §"Task-dependent layer"`).
- A **regression-prone area** — the lane touches an L1/L2 loop, the
  promotion gate, or another single-point-of-failure surface where the
  bundle's `source_paths` are part of the audit trail.

### Audit trail when inlining

Even under the inline shortcut, the run record MUST capture equivalent
evidence:

- `.guild/runs/<run-id>/dispatch-trace.md` — what lanes were dispatched,
  at which tier, against which bundle equivalent (the orchestrator's
  inlined working set, file-listed).
- `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` — receipt
  required as usual.
- Reflection notes that inlining was used and **why** (which conditions
  qualified). This is exactly how `run-b6337cbc` recorded the inlining;
  the pattern is now the contract.

### Why this clarification exists

Three consecutive reflections named `guild:execute-plan` in
`proposals.skill_improvement` (`run-2b531201`, `run-0c8ae3ca`,
`run-b6337cbc-cross-platform`). Each one observed the orchestrator
satisfying the per-lane chain by inline action under
`--auto-approve=all` rather than formal sub-skill dispatch. The pattern
worked every time; the §11.1 ≥3-reflection trigger fired on what was
actually an **under-specification** of valid orchestrator behavior, not a
defect.

### Expiry (issue #57 — the shortcut is a budget, not a standing posture)

The forensic finding behind issue #57: a 39-hour self-build session used
this shortcut to justify doing **909 Bash / 136 Edit / 52 Write operations
itself** across 8 un-re-anchored compactions, instead of dispatching lane
work by pointer — the orchestrator/team-lead/executor separation
collapsed into one session. `## Mid-run scope expansion` below inherits
the same budget (absorbing an operator mandate inline does not reset it).

The inline shortcut is valid only up to a hard, codified budget. It
**expires** — and the orchestrator MUST re-enter the formal sub-skill
chain (`guild:context-assemble → dispatch → guild:review`, or
`guild:resume` if picking a run back up) — on whichever of these happens
first:

1. **N direct lead Edit/Write operations.** `N` =
   `.guild/settings.json` `defaults.lean_lead.hands_on_edit_threshold`
   (default **8**; `defaults.lean_lead.enabled: false` disables the guard
   entirely), read tolerantly straight off `settings.json` the same way
   `defaults.resume.enabled` is (`hooks/lib/run-state.ts readResumeEnabled`).
   **Known gap:** this key is not yet wired through `guild:config`'s
   validate/set/resolve surfaces (`scripts/lib/core/config-cli.ts`,
   `scripts/config-cmd.ts`, `src/modules/config/workflows/settings-reader.ts`)
   — those files are outside this lane's scope — so `guild:config set` and
   `guild:config validate` do not yet recognize it; only a direct hand-edit
   of `settings.json` takes effect. Follow-up: register it as a proper
   config-schema surface. Counted from the tool-call trace, not
   self-reported — see enforcement below.
2. **Any compaction boundary.** This is a DISJUNCTION with #1, not a
   fresh N-edit allowance — `hooks/session-reanchor.ts` (gap G1, oir-wi-00)
   already re-injects the lean-lead contract (dispatch by pointer, don't
   absorb lane work) into the fresh post-compaction context, so continuing
   to edit inline past that point is ALREADY a fresh violation on its own,
   independent of N. The first direct lead Edit/Write after a compaction
   is the trigger, not the Nth.

**Enforcement lives in code, not prose.** `hooks/lean-lead-guard.ts` (a
Stop hook — it observes every turn end) is registered globally, so it ALSO
fires inside every dispatched specialist's own pane/subagent session, not
just the lead's. It first checks THIS INVOCATION's own environment — a
`GUILD_TASK_ID` or `GUILD_LANE_ID` set means the calling process IS a
dispatched lane worker, not the lead, and the guard stays silent and never
touches the shared per-run fire-once state (a lane worker's own Stop hook
must never consume or perturb the ONE advisory meant for the lead). Once
confirmed to be the lead's own session, it counts direct lead Edit/Write
`tool_call` trace events since the most recent `PreCompact` trace event
(identified by the ABSENCE of `lane_id` — real production dispatch
backends thread `GUILD_TASK_ID` into a lane worker's own environment,
which `post-tool-use.ts` stamps onto `lane_id`, so a lane worker's own
tool calls always carry one), and cross-references the count against
`run-state.json`'s open (`pending`/`in_progress`) lanes. Crossing the
threshold — or, post-compaction, the FIRST such edit at all — while lanes
are open surfaces a loud advisory (`hookSpecificOutput.additionalContext`)
naming the count, the threshold, and the open-lane count, and pointing
back at `guild:execute-plan` / `guild:resume`. It never denies a tool call
and never forces a specific corrective action — a solo one-off task or a
run with no dispatched lanes has nothing this guard needs to protect —
see `hooks/lib/lean-lead-guard.ts` header for the full zero-noise gating
(disabled, overridden, no open lanes, under threshold, already fired this
cycle) and for the honest caveat that Stop's `additionalContext` does
still cost the lead one more turn to read it, unlike a bare stderr log.
An operator who wants this specific
crossing dismissed sets `GUILD_LEAN_LEAD_OVERRIDE=1` for the session.

## Hard-set gate deferral under high autonomy (sibling to the inline shortcut above)

Sibling clause to `## Inline shortcut under high autonomy` above — that section governs when the *sub-skill chain* can be inlined; this one governs what happens when a lane, inlined or not, **hits an always-ask / hard-set gate** while running under high autonomy (`--auto-approve=all` / `defaults.auto_approve: all`).

**Do not stop the whole lane on a hard-set gate.** An always-ask gate (a destructive action, a credential, a policy the operator must personally confirm — anything the autonomy contract marks as never-auto-approved) still cannot be silently skipped, but the lane around it does not have to halt either:

1. **Split the work.** Partition the lane's remaining scope into the part that is safely completable without the gated action, and the part that requires it.
2. **Apply the safe part.** Execute (and, on completion, let the lead commit per the usual commit discipline) everything that does not depend on the gated action.
3. **Emit a complete contract artifact for the gated part** at the deterministic run-local path `.guild/runs/<run-id>/deferrals/<task-id>-<gate-slug>.md` (`guild.deferral_contract.v1`): for a **file gate**, the exact file and the literal proposed content/diff (not a description); for a **non-file gate** (credential, network egress, spend, destructive op), the exact action and parameters the operator would execute; plus **why it's gated** (which autonomy-policy rule fired). Complete enough to apply in **one pass**.
4. **Record the deferral with an explicit disposition.** In the lane's receipt `followups:`, the deferral entry is marked **`blocking: true` whenever the gated half is spec- or plan-required** — `guild:review` and `guild:verify-done` MUST then treat it as a blocker (never "merely deferred"); only genuinely optional work may carry a non-blocking disposition. A lane receipt is not "complete" by omitting required work into a deferral — the deferral defers *approval*, not *accountability*.
5. **The artifact is a proposal, never an authorization.** Neither the lane, the lead, nor any later consumer applies the deferred action without a **fresh operator confirmation** — auto-applying a deferral artifact is a hard-gate bypass, exactly what this clause exists to prevent.

This keeps a high-autonomy run moving on everything it's actually allowed to do, instead of stalling the entire lane — and everything downstream of it — on one gated sub-task.

*Evidence: reflection `run-learn-knowledge-convergence-20260529-094021` — three-run provenance: the run itself plus its `A2` and `F1` lanes, all landing this split-and-defer pattern with zero rework once the operator applied the deferred artifact.*

## Mid-run scope expansion (operator-mandate absorption)

Two consecutive self-build initiatives (`docs-clean-up`, `share-dot-guild`)
landed a new operator mandate **mid-run** — at a soft gate (CQ answer
broader than the option set), at the SC-7 risk gate (Decision M added
after audit), or even **post-commit** (the "one `.guild/` per repo root"
policy that emerged after SC-10). In both cases the run absorbed the
expansion cleanly without restarting the lifecycle. This section codifies
the absorption pattern so future orchestrators recognize and execute it
deterministically.

Absorbing an expansion **inline** (step 3 below) still draws against the
same inline-shortcut budget as `## Inline shortcut under high autonomy →
### Expiry` — a broadened mandate is not a reset. If the budget has
already expired (or expires mid-absorption), formalize the remaining
absorption work as dispatched lanes rather than continuing to patch it in
directly.

### Detection signals

A mid-run scope expansion is in play when **all** of these hold:

- The mandate arrives in operator chat *between* gates (not in the
  original spec/plan).
- It is broader than the surfaced option set for the active gate (e.g.
  operator answers a 2-option question with a 3rd option that's a policy
  extension).
- It does not invalidate the work already completed — it extends or
  re-scopes ongoing/upcoming lanes.

If the mandate **invalidates** completed work (e.g. "redo the previous
lane with X"), this is **not** scope expansion — it's a re-dispatch
request; halt and surface to the operator before proceeding.

### Absorption protocol (5 steps, in order)

1. **Lock the new decision.** Append a new decision row to the active
   initiative's `decisions.md` with a freshly-allocated ID
   (e.g. `D-SHR-5` after `D-SHR-1..4`) and verbatim quote the operator's
   mandate. Cite the gate / chat point where it landed. Decisions are
   immutable once locked — do not edit prior ones, only add.

2. **Update the controlling ADR.** Author a new `## Decision <Letter>`
   section in the relevant ADR with the policy in full (rationale +
   enforcement mechanism + scope). Maintain the cross-reference between
   the initiative-scoped decision ID (D-SHR-5) and the ADR-scoped letter
   (Decision M).

3. **Apply inline to in-flight work.** Identify which lanes are
   affected; for each, decide:
   - **Already-complete lane** → audit its output against the new rule;
     if it conforms, no rework; if not, apply a surgical patch (do not
     re-dispatch the lane unless the operator requests).
   - **In-flight lane** → inject the new rule into the lane's autonomy
     policy (the next handoff receipt must show compliance).
   - **Not-yet-dispatched lane** → update the lane's scope in the plan
     before its Wave dispatches.

4. **Log to activity.jsonl.** Append a `policy_clarification` event
   (mirror the existing event types in `share-dot-guild`'s log):
   ```json
   {"ts":"…","event":"policy_clarification","id":"<initiative>",
    "trigger":"operator","clarification":"<verbatim>",
    "absorption":[...what was patched...],"verified":"<how>"}
   ```
   This makes the expansion auditable in `/guild:stats` and surfaces
   in the reflection.

5. **Carry forward in verify.md.** The verify-done writeup
   (`.guild/runs/<run-id>/verify.md`) must include the mid-run mandate
   in its "Assumptions reviewed" or a dedicated "Mid-run policy
   expansions" section, so the closeout reflects the actual rule set
   the run shipped — not just the original plan.

### What absorption is NOT

- **Not** a re-spec. The original spec stays as-is; the new decision
  *extends* it, doesn't supersede it.
- **Not** silent. Every step above leaves an artifact (decision row,
  ADR section, activity entry, verify.md note). An orchestrator that
  "just applied the patch" without these is producing un-auditable runs.
- **Not** an excuse to skip gates. If the new mandate changes what
  the *next* gate should ask, update the gate questions; never proceed
  past a gate that hasn't yet seen the new rule.

### Why this is in `execute-plan` and not `guild:plan`

`guild:plan` writes the original lane plan at planning time, before
operator-mandate-at-gate is possible. `execute-plan` is the orchestrator
that actually sees the mandate land mid-run; the absorption protocol
must live where the orchestrator can reach it. If a mandate lands
*before* the first lane dispatches, prefer re-running `guild:plan` with
the new constraint — absorption is for after Wave 1 has begun.

## Lane liveness sweep (backend-agnostic watchdog)

While lanes are in flight — parallel waves, or any wait on a lane's receipt — sweep liveness **each poll cycle** with the deterministic report tool; never eyeball heartbeat files or infer a stall from chat silence:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/check-lane-liveness.ts --run-dir <abs path to .guild/runs/<run-id>>
```

It reads `run-state.json` (lenient — receipts-only when absent), the structured `in-progress/*.json` heartbeats, and `handoffs/*.md` receipts, and prints a per-lane report `{ lane, status, receipt_present, heartbeat_age_ms, stalled }` (stall threshold `GUILD_HEARTBEAT_TIMEOUT_MS`, default 600000; exit 0 always — it is a report, not a gate). This is the Rung-2/3 (subagent / in-process `agent`) watchdog complement to the team backend's pane-alive + `TeammateIdle` checks — same heartbeat records, one sweep across backends. On `stalled: true` for a lane:

1. **Nudge once.** Re-prompt the lane's agent (or its pane) referencing its last heartbeat `step`, and record the nudge in the dispatch trace.
2. **Still stalled on the next sweep** → treat the lane as FAILED and route it into `## Lane retry + dead-lettering` (retry up to `defaults.retry.max_attempts`, then the `mark-lane-dead.ts` funnel). Never leave a stalled lane spinning silently past two consecutive stalled sweeps.

## Lane retry + dead-lettering (R-016)

Implements the per-lane resilience contract (v2 runtime and execution model ADR §retry/§resume). Read the policy from the run's **resolved settings** (`readResolvedSettingsSnapshot` / `read-guild-config.ts` — never hard-code): `defaults.retry.max_attempts` (int ≥ 1, default **1** = no retry), `defaults.retry.backoff` (`immediate | linear | exponential`, default `exponential`), `defaults.resume.enabled` (bool, default **true**).

A lane is **FAILED** when its receipt is missing/malformed (step 4) or the agent returns an error status. On failure:

1. **Retry up to `max_attempts`.** Re-issue the lane's `Agent()` — a **fresh** ephemeral agent, same bundle + resolved tier — up to `defaults.retry.max_attempts` **total** attempts (attempt 1 + retries). Between attempts, pace per `defaults.retry.backoff` and fold **backoff guidance** into the retry brief (e.g. `prior attempt <n> failed: <last-error>; address it before proceeding`). With the default `max_attempts: 1` this is a **no-op** — one attempt, no retry — so default behavior is unchanged (transparent).
2. **A passing receipt before exhaustion** → the lane is clean; continue normally and record the retry count in the dispatch trace.
3. **On exhaustion** (all `max_attempts` attempts FAILED), mark the lane **dead via the bridge CLI** so the in-process / subagent path writes the **same checkpoint the SSH path does** — the single writer is hooks' `markLaneDead`:

   ```
   npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/mark-lane-dead.ts <runDir> <laneId> \
     --attempts N [--last-error "..."] [--run-id <run-id>] \
     [--plan-slug <slug>] [--wave-index <n>] [--cwd <repo-root>]
   ```

   `<runDir>` = `.guild/runs/<run-id>/`; `<laneId>` = the lane's `task-id`; `--attempts N` = total attempts made; `${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}` = the plugin install root (the dir containing `scripts/`). This funnels to `markLaneDead` (`hooks/lib/run-state.ts`) → run-state `dead` + `resume.json` (the CLI writes the resume checkpoint **only when `defaults.resume.enabled` is true** — it reads that key tolerantly itself), so a later `/guild:resume` re-enters the dead lane from its checkpoint. **Do not write run-state directly** — the CLI is the only sanctioned funnel (parity with the SSH `runWithRetry` `onExhausted` path; both converge on `markLaneDead` for identical run-state + resume semantics).

A dead lane is **not** a clean receipt — see `## Stop condition`.

## Resuming dead lanes (R-016)

The READ/re-enter half of dead-lettering (the WRITE half is `## Lane retry + dead-lettering`). When `/guild:resume` continues a run, **before** it locates the next pending gate it re-enters any checkpointed dead lane so a transient failure doesn't strand the run. (`/guild:resume`'s command `## Dispatch` invokes this section before gate location.)

1. **List resumable dead lanes** via the read-side bridge CLI (the mirror of `mark-lane-dead.ts`) — the `--json` flag is **required** for parseable output (without it the CLI prints a human table):
   ```
   npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/resume-lanes.ts <runDir> --json
   ```
   It scans `<runDir>/lanes/*/resume.json`, applies the **`guild.lane_resume.v1`** schema-version guard (skips foreign/older versions), honors `defaults.resume.enabled`, joins each lane's `tier` from run-state, sorts by `lane_id`, and writes a **bare JSON array** (one object per resumable dead lane) to stdout:
   ```json
   [{ "lane_id": "...", "run_id": "...", "attempts": N, "last_attempt_at": "...", "last_error": "...", "resumable_at": "...", "tier": "mid" }, …]
   ```
   **Consume the array directly — it is NOT wrapped in an object.** It is already version-guarded + `resume.enabled`-filtered + `lane_id`-sorted CLI-side. `tier` is present when run-state carried it (absent otherwise — default skill-side); `bundle_path` is **not** in the output — recover it skill-side (step 2). **An empty array `[]` ⇒ no resumable lanes ⇒ exactly today's resume behavior** (proceed straight to the next gate). `<runDir>` = `.guild/runs/<run-id>/`; an optional `--cwd <repo-root>` overrides the repo root for the `resume.enabled` read; `${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}` = the plugin install root.
2. **Re-enter each resumable dead lane** through the normal dispatch path: spawn a **fresh** ephemeral `Agent()` against the lane's bundle, folding `last_error` in as backoff guidance. Use the entry's `tier` when present (else recover from run-state `lanes[<lane_id>].tier`, `hooks/lib/run-state.ts`); **recover/rebuild `bundle_path`** skill-side (the lane's `.guild/context/<run-id>/<specialist>-<task-id>.md`, or rebuild via `guild:context-assemble` if the bundle file is gone). This **resets the lane from `dead` back into `## Lane retry + dead-lettering`** — operator-initiated resume grants a **fresh retry budget** (`defaults.retry.max_attempts` again); the prior `attempts` count is preserved in the checkpoint for audit but does **not** subtract from the resumed budget (otherwise a lane already at `max_attempts` would re-dead immediately). Re-entry follows the same `## Per-lane flow` (bundle → tier → dispatch → receipt) as a first dispatch; a lane that re-fails past `max_attempts` on the resumed run is re-marked dead via the same `mark-lane-dead.ts` funnel.
3. **Then continue** to the next pending gate as today.

Gated + graceful: the whole step is a no-op when `resume-lanes.ts` emits an empty list (no checkpoints written, or `defaults.resume.enabled: false`). This closes the R-016 write↔read symmetry — `## Lane retry + dead-lettering` WRITES dead-lane checkpoints; this section READS + re-enters them.

## Stop condition

Execution is complete when every lane has a non-error receipt under `handoffs/`:

- receipt count equals lane count in the plan;
- every receipt has a populated `evidence:` field (§8.2 — never "looks good");
- no receipt is blocked/errored without a matching error record in the run log.

If a lane FAILED, it first goes through `## Lane retry + dead-lettering`; a lane still failing after `defaults.retry.max_attempts` is marked **dead** (checkpointed for `/guild:resume`). Halt and surface any dead lane(s) to the user — name each dead lane, its attempt count, and that `/guild:resume` will re-enter it from its checkpoint — rather than forwarding to `guild:review` (review cannot compensate for a missing receipt). If every lane is clean, hand off to `guild:review`.

## Handoff

Once the stop condition is met, hand off to `guild:review` with:

- `run_id` — the run directory name.
- `handoffs_dir` — absolute path to `.guild/runs/<run-id>/handoffs/`.
- `plan_path` — the approved plan (`.guild/plan/<slug>.md`).
- `lane_count` — number of receipts collected.
- `backend` — the backend used (`subagent` or `agent-team`), read from the run's resolved-settings snapshot (`snapshot.effective.agent_mode`), not from `team.yaml`.
- `tier_trace` — per-lane `{task-id, complexity_score, tier, model}` as dispatched (the surfaced scores).
- `escalations` — count of advisor consults across the run + any `inconclusive: advisor budget exhausted` lanes.
- `team_result_path` — the companion `guild.team_result.v1` emitted at `.guild/runs/<run-id>/team-result/<station>.json` (or the fail-soft skip note), the typed mirror of the dispatched instances against the composed team_plan.

`guild:review` runs its 2-stage per-task review (spec-conformance then quality) against the receipts in `handoffs_dir`. Do not run review yourself — it is a separate skill with its own responsibilities.

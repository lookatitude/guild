# Backend choice, routing & parallelism

Detail for `guild:execute-plan`'s `## Backend + routing (summary)` and parallelism scheduling.

## Backend choice

Guild supports three execution backends. The choice is **resolved by the `agent_mode` ladder** (ADR D5; `CLAUDE.md §"Backend default"`) **once at run-start intake** by `runStartPreflight` (U3), frozen in the run's resolved-settings snapshot (U6). `guild:execute-plan` **reads it from the snapshot** (`readResolvedSettingsSnapshot` → `snapshot.effective.agent_mode`) and honors it — it never re-picks, and it does not read the backend from `team.yaml` (whose top-level `backend` is only a mirror for audit; `team.yaml` is composition-only). **Team is primary whenever tmux (or cmux) is present; subagent is the fallback, not the default.** Within `team`, a cmux surface is checked **before** a tmux pane whenever `CMUX_WORKSPACE_ID` is present in the environment — full cmux-first mechanics: `SKILL.md §"Backend + routing (summary)"`.

| Backend | Selected when (`agent_mode` resolves to…) | Tradeoff |
|---|---|---|
| **cmux surfaces (rung 0 of `team`)** | `team` — `auto`/explicit `team` pin **and** `CMUX_WORKSPACE_ID` present in the environment, checked once at dispatch setup (the resolved-settings snapshot carries no cmux field until W4 lands — see `SKILL.md`). One **visible cmux surface per specialist** in the caller's workspace, checked BEFORE tmux. | Full mechanics (surface creation, per-lane watcher, reap, lead-only commits): `SKILL.md §"Backend + routing (summary)"`. |
| **Agent teams (tmux panes)** | `team` — `auto` + tmux available (the common case on a dev machine) **or** an explicit `team` pin, **and `CMUX_WORKSPACE_ID` absent**. One **visible pane per specialist**. | Experimental; requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; one team per session; no nested teams; higher token cost. **PRIMARY under tmux when cmux is absent.** |
| **In-process / Independent agents** | `agent` — D5 rung 3: host supports independent agents, no tmux, no cmux. `InProcessTeamBackend.launch()` returns `ok:true` with `dispatchPlan: GuildDispatchDescriptor[]` (one descriptor per specialist: `name / subagentType / model=null / env / prompt`); `orchestratorPaneId: null`, `teammatePaneIds: {}`. `guild:execute-plan` issues one `Agent()` call per descriptor in `result.dispatchPlan`, applying tier + model at dispatch (`model: null` from backend — tiering is orthogonal; execute-plan scores and resolves). (ADR §RE-4 / VC-RE-4.) | No tmux; fully implemented (VC-RE-4). Declarative plan from launcher → `Agent()` calls in execute-plan. Not a fallback stub. |
| **Subagents via Agent tool** | `subagent` — the **fallback**: no tmux + no cmux + no independent-agent support (CI, fresh installs), or an explicit `subagent` pin. | Lower cost, simplest cleanup; runs in the background, only the final artifact returns. The documented last resort. |

**Refuse-don't-fallback is ENFORCED at runtime (#56).** The rule below is no longer prose the orchestrator self-enforces. A **PreToolUse backend-degradation detector** (`hooks/pre-tool-use.ts` → `evaluateBackendDegradation`, `hooks/lib/backend-degradation.ts`) inspects every Guild specialist-lane dispatch issued through the in-session `Agent` tool and compares it against the run's resolved-settings snapshot. It mirrors the two authorities that between them decide the team substrate: the cmux rung is the **skill-driven** path above (`CMUX_WORKSPACE_ID`, checked first — it bypasses the launcher entirely), and the tmux rungs come from `scripts/agent-team-launcher.ts resolveBackend`, which has no cmux handling and resolves `auto` via `$TMUX` **before** the `tmux -V` probe while gating an explicit `team` pin on the probe alone.

| Snapshot `agent_mode` | Team substrate | Outcome |
|---|---|---|
| `team` | available | **DENIED.** The run committed to panes/surfaces, they are possible, and the lane went in-session anyway — the exact ~26h collapse #56 documents. Downgrade **consciously** instead: `GUILD_ALLOW_BACKEND_DEGRADE=1` allows it and still records the receipt. |
| `auto` | available | **DENIED.** The snapshot stores the *configured* mode verbatim; the D5 ladder then resolves `auto` + a substrate to `team`, so the effective backend is team and this is the same degradation. |
| `team` | unavailable | **Recorded, not blocked** — `agent-team-launcher.ts` downgrades this case itself with a stderr warning, so the detector only removes the silence. |
| `auto` | unavailable | **Untouched** — the ladder resolves to `agent`/`subagent`, where `Agent` dispatch is the designed path. |

**A DENY additionally requires STRUCTURED lane evidence** — a producer-set carrier in the dispatch's own `env` map (`GUILD_DISPATCH_PRODUCER` / `GUILD_SPECIALIST` / `GUILD_TASK_ID` / `GUILD_AGENT_DEFINITION` — set by `composeInProcessDispatch` on the descriptor rungs, and by this skill itself on the direct `subagent` rung; see `## Producer marker (line-1 + env)`). An env map is composed by whoever issues the dispatch and is structurally out of reach of quoted text. Every PROMPT-derived signal — the canonical handoff block and `#58`'s line-1 adoption marker (the legacy 300-char role-anchor / dispatch-prose parse was deleted once the marker reached every dispatch class, issue #91) — grades `lane_evidence: "prompt_only"` and is **recorded, never blocked**, because a prompt that merely *quotes* a live brief is text-identical to the brief itself. The deny message carries the **substrate-appropriate** remedy: the tmux launcher for tmux, and the cmux-surface rung (which bypasses that launcher) when `CMUX_WORKSPACE_ID` is set.

**Every non-pass decision writes a `guild.backend_degradation.v1` receipt to `.guild/runs/<run-id>/logs/backend-degradation.jsonl`** (plus a `guild.security_event.v1` audit twin at `logs/security-events.jsonl`), carrying the reason code, the lane-evidence tier, the snapshot `agent_mode`, the substrate kind, the attempted `subagent_type`, and — when a team backend was actually reachable — `effective_backend` — a durable, greppable record of the downgrade. It is a **dedicated sink**, deliberately not `logs/v1.4-events.jsonl`, whose event vocabulary is frozen and validated. *Followup (not yet wired): `guild:verify-done` and `guild:reflect` do not read this sink yet — a degradation is auditable by path today, not surfaced automatically.*

The detector never touches a non-Guild `Agent` call, a learn-lane generic fan-out, an `agent`/`subagent`-mode run, a helper spawned from inside a lane that already got its pane, or a stale `current-run-id` sentinel from a long-finished run (liveness is proved only by artifacts that **lead-side** hook activity cannot write: the start-stamped snapshot, handoff receipts, and the `in-progress/` lane heartbeats — which `post-tool-use.ts` writes, but only from a process carrying both `GUILD_RUN_ID` and `GUILD_SPECIALIST`, i.e. from inside a lane. A dispatch that names the run in its own descriptor env is trusted identity outright.)

Two hard constraints:

- **`agent-team` requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.** When the snapshot resolves the backend to `agent-team` (the ladder resolved to `team`) and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is not set, **refuse to dispatch and surface the blocker** rather than silently falling back to subagents — falling back would change execution semantics out from under the plan. Invoke `scripts/agent-team-launcher.ts` (below) — it owns the ladder resolution, the env gate, and the tmux strategy. (The tmux **enablement** prompt is not raised here at dispatch — `runStartPreflight` owns it at intake, and it fires **per-run** while tmux is available && effective `agent_mode != "team"` (`needsTmuxPrompt`); a **yes** persists `agent_mode: team` so future runs stop prompting, a **no** persists nothing and may prompt again next run. It is **not** a one-time "durable approval".)
- **Always dispatch the lane AS its named specialist role**, resolved against `team.yaml`'s `definition:` + `definition_source:` fields (written by team-compose from the roster-resolve JSON). Two cases:
  - **Shipped agent** (`definition_source: shipped` — `agents/<name>.md`): the host registered the definition at session start — dispatch by name. The self-build dev team is no longer in this class; it is project-local under `.guild/agents/` and follows the ref-carriage path below.
  - **Project specialist** (`definition_source: project` — `.guild/agents/<name>.md`, minted from a shipped template by team-compose or created via guild:create-specialist): the host has NO registered agent under this name — `subagent_type: <name>` cannot resolve, in any session. The backend dispatches it as the host-generic subagent type **with the definition carried in the lane prompt** (`composeInProcessDispatch` sets `definitionPath` + env `GUILD_AGENT_DEFINITION`; `buildPrompt` embeds the definition-adoption + project-skill-loading instruction) at the specialist's own tier. This is the correct first-class path — do NOT "fix" it back to a bare name, and do NOT strip the definition instruction (a generic dispatch **without** the definition is the defect).
    - **The definition carriers are UNCONDITIONAL and ENFORCED (#58).** For a project specialist, `GUILD_AGENT_DEFINITION` + the definition-adoption prompt prefix are set on **every** dispatch — `composeInProcessDispatch` keys them on `definition_source === "project"` alone and **throws** if the lane has no `definition` path (fail-closed: it will not emit a persona-stripped generic descriptor). On the host side, a **PreToolUse dispatch-integrity guard** (`hooks/pre-tool-use.ts` → `runDispatchIntegrityGuard`) **denies** any `Agent` dispatch that, inside an active Guild run, claims a specialist persona (adoption prompt, or `GUILD_SPECIALIST`+`GUILD_TASK_ID`) yet is `subagent_type: "general-purpose"` **without** a matching `GUILD_AGENT_DEFINITION`. So the intended dispatch and a persona-stripped one are no longer byte-identical — the defective call is now blocked with a loud message, never silently run. The guard is scoped tightly: it never touches a non-Guild `Agent` call, a shipped agent dispatched by name, or a legitimately-generic learn/fan-out lane (no adoption signature).
    - **Attribution on the dispatch trace (#58).** The `Agent` dispatch's `tool_call` event carries `attribution_specialist` (the resolved role, from the dispatch's own `GUILD_SPECIALIST` / `GUILD_AGENT_DEFINITION` / adoption prompt — `hooks/lib/dispatch-attribution.ts`). A post-hoc audit can therefore tell a real `devops` lane from a bare generic agent even though both dispatch as `general-purpose`.

### In-process dispatchPlan consumption

When the snapshot-resolved backend is `in-process` (D5 `agent` rung — §RE-4 / VC-RE-4 of the runtime and execution model ADR), invoke the launcher the same way as the team backend (`## Agent-team launcher` below) but with `--agent-mode=agent` (or `--agent-mode=auto` when the ladder itself should decide) instead of relying on `team.yaml`'s `backend:` key — pass `--run-id <the run's own run-id>` so the descriptors' `GUILD_RUN_ID` matches the run directory `guild:execute-plan` already created (Input 4), or omit it only for a standalone `--dry-run` preview:

```
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/agent-team-launcher.ts --team <resolved-team-path> --cwd <repo-root> --agent-mode=agent --run-id <run-id>
```

The process prints exactly one JSON line to stdout and exits 0:

```json
{
  "backend": "agent",
  "reason": "<D5 ladder reason string>",
  "slug": "<team slug>",
  "ok": true,
  "dispatchPlan": [ { "name": "...", "subagentType": "...", "model": null, "env": { "GUILD_RUN_ID": "...", "GUILD_SPECIALIST": "...", "GUILD_TASK_ID": "..." }, "prompt": "...", "definitionPath": null } ],
  "orchestratorPaneId": null,
  "teammatePaneIds": {},
  "notes": [ "..." ]
}
```

The launcher (`InProcessTeamBackend.launch()`, constructed by the launcher's D5 ladder — it is NOT a stub the launcher merely signals about) returns this `ok:true` + declarative `dispatchPlan: GuildDispatchDescriptor[]` shape — one descriptor per specialist. A `TeamBackend` is a plain TypeScript class; it **cannot** call the Agent tool. `guild:execute-plan` reads `signal.dispatchPlan` from the parsed stdout and issues the Agent tool calls itself:

1. **For each descriptor in `signal.dispatchPlan`** (in DAG order per `## Parallelism rules`):
   - Resolve tier + model via tier resolution (`model: null` from backend — tiering is orthogonal to backend choice; execute-plan scores and resolves).
   - Inject capability-scope env vars (`GUILD_CAPABILITY_SCOPE` / `GUILD_AUTONOMY_CONTRACT`) onto the descriptor's `env` map. The descriptor already carries `GUILD_RUN_ID` from the launcher; execute-plan layers the capability-scope vars on top at dispatch (same injection path as subagent — `env` param on `Agent()`).
   - Issue: `Agent({ subagent_type: descriptor.subagentType, model: <resolved>, prompt: descriptor.prompt, env: { ...descriptor.env, GUILD_CAPABILITY_SCOPE: "...", GUILD_AUTONOMY_CONTRACT: "..." } })`. Omit capability-scope keys whose source field is absent.
2. **No tmux** — `orchestratorPaneId: null`, `teammatePaneIds: {}`. The orchestrator stays in-process and never gets a descriptor (only specialists do, mirroring `RemoteTeamBackend §CH-4`).
3. **Named specialist role, resolved by definition source.** For a shipped specialist, `descriptor.subagentType` is the lane's `owner_role` (bare name from `team.yaml`). For a project-local specialist (`definition_source: project`), the launcher sets `subagentType` to the host-generic type and `descriptor.definitionPath` to `.guild/agents/<name>.md` — issue the `Agent()` call as-is; the prompt already carries the definition-adoption instruction. Same invariant as all other backends (see the hard constraint above).

`dryRun: true` on `InProcessTeamBackend` is semantically a no-op (no subprocess is suppressed — the plan is purely declarative); the launcher annotates a note and returns the same `dispatchPlan` so execute-plan can display the planned `Agent()` call strings.

## Producer marker (line-1 + env)

Every Guild-produced dispatch carries a **structured producer marker** in two halves — an unforgeable **env** carrier and its **prompt line-1** twin. The marker is what lets the PreToolUse guards and the run trace tell a real Guild lane from an arbitrary `Agent` call, and a producer-composed lane from a hand-rolled or persona-stripped one. Canonical constants: `scripts/lib/core/contracts/team-backend.ts` (`DISPATCH_PRODUCER_ENV` = `GUILD_DISPATCH_PRODUCER`, `DISPATCH_PRODUCER_TOKEN` = `guild.dispatch.v1`); the parser that reads it: `hooks/lib/dispatch-attribution.ts`.

**Env half** — set on the dispatch's own `env` map (out of reach of quoted prose, so it is the only carrier a guard may BLOCK on):

| Key | Value | When |
|---|---|---|
| `GUILD_DISPATCH_PRODUCER` | `guild.dispatch.v1` — **emit v1**; the parsers accept any `guild.dispatch.v<N>` (forward-compatible by design) but nothing else | **always** |
| `GUILD_SPECIALIST` | the lane's `owner_role` | **always** |
| `GUILD_RUN_ID` / `GUILD_TASK_ID` | the run-id / the lane's `task_id` | **always** |
| `GUILD_AGENT_DEFINITION` | the specialist's **team-file `definition`** path (`.guild/agents/<name>.md`) — read it, never rebuild it from the role name | project specialist only (`definition_source: project`) — unconditional there (#58) |
| `GUILD_TIER` | the resolved tier (scored `tier:` wins over the authoring `default_tier:`) | when a tier resolved — **omit rather than fabricate** |
| `GUILD_TIER_SCORE` | the raw numeric score, stringified | when a real score exists (`0` is a real score) — audit-only, never gated on |

**Prompt half** — exactly ONE marker on the prompt's **first line**, `\n`-terminated, with nothing before it, chosen by definition source:

| Dispatch class | Line 1 |
|---|---|
| Project specialist (`definition_source: project`) | `GUILD_AGENT_DEFINITION=<team-file definition path>` — carries the role via its path AND is the #58 **machine** adoption proof |
| Shipped specialist / machinery / orchestrator | `GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=<owner_role>` |

**The marker is machine proof, NOT the thing that makes the agent adopt its persona.** A project specialist dispatches as the host-generic type, so the prompt must ALSO carry the human-readable definition-adoption instruction (`read it FIRST and adopt it fully` + the project-skill load step) exactly as `buildPrompt` emits it. A dispatch with the line-1 marker but no adoption instruction satisfies the guard while running as a generic agent — syntactically compliant, functionally persona-stripped. Both, always.

**`definition_source` and `definition` are TEAM fields, not lane fields.** The plan lane carries `owner`; join it to the team file's `specialists[]` by `name` and fail closed when there is no match, or when a `project` specialist carries no `definition` — the same fail-closed rule `composeInProcessDispatch` enforces in code by throwing. Never synthesize `.guild/agents/<owner>.md` as a substitute for the authoritative path.

The producer-marker line is parsed **whole or not at all**: a malformed token, a value that is not `guild.dispatch.v<N>`, an out-of-bound role, or a duplicate `role=` rejects the entire line rather than yielding a partial guess. The VERSION is forward-compatible — `^guild\.dispatch\.v\d+$` in both `hooks/lib/dispatch-attribution.ts` and `hooks/lib/backend-degradation.ts`, so a future `v2` parses — but producers emit `v1` until the schema actually changes. So emit it verbatim — single spaces, no trailing punctuation, no wrapping backticks, no second `role=`.

**Who stamps it, per class:**

| Class | Stamped by |
|---|---|
| **Team / tmux panes**, **cmux surfaces**, **remote** | `paneCommand` / `buildPrompt` (launcher-side, in code) |
| **In-process** (`result.dispatchPlan`) | `composeInProcessDispatch` + `buildPrompt` — already on `descriptor.env` and `descriptor.prompt`. Issue the descriptor **as-is** (layer only the resolved `model` and the scope/run env keys); do **not** rebuild the prompt or the `subagentType` — a reconstructed prompt drops the teammate identity, lane scope, context-bundle pointer, read-ack gate, and wait instruction `buildPrompt` emitted |
| **Subagent** (direct `Agent()`, the D5 fallback rung) | **`guild:execute-plan` itself** — this is the ONE class with no launcher descriptor (`agent-team-launcher.ts` returns a bare `{backend, reason, slug}` signal for `resolvedMode !== "team"` and hands the whole `Agent()` construction back to the skill), so the skill IS the producer here. Construct both halves — plus the project-class adoption instruction — per `SKILL.md §"Capability-scope env injection"` steps (0)/(2b)/(2c)/(2d). This construction applies **only** to this rung. |

**Identity consistency is checked, not assumed.** Every role-bearing carrier present on one dispatch — `GUILD_SPECIALIST`, the `GUILD_AGENT_DEFINITION` path's role, and the line-1 `role=` — must name the **same** role; disagreement is read as orchestrator drift (the lane would adopt the wrong persona) and fails the dispatch-integrity guard. Derive all three from the single `owner_role` value, never from three separate lookups.

**Marker on every re-dispatch, not just the first.** A retry (`## Lane retry + dead-lettering`), a resumed dead lane, and a nudge-replacement spawn are each a **new** `Agent()` call and each needs its own marker — an unmarked retry re-opens the exact gap the marker closes.

## Tier → Agent `model` param

The lane's resolved tier (`guild:execute-plan §"Tier resolution"`; ADR §2) maps to a model through the host-agnostic `models.tiers` map (ADR §1/§10 — bound by pointer, never re-spelled). Within Claude:

| Tier | Claude `model` | Typical work |
|---|---|---|
| `cheap` | `haiku` | read, summarize, classify, tag |
| `mid` | `sonnet` | draft, reason, plan, extract relationships |
| `powerful` | `opus` | architecture, security review, advisor pass |

**Wiring.** For the subagent backend, pass the resolved model on the Agent tool: `Agent({ subagent_type: <definition-source-resolved>, model: <resolved-model>, ... })` — `<definition-source-resolved>` is the shipped specialist's bare name, or the host-generic type for a **project** specialist (the hard constraint above; never a bare project name). For agent-team teammates, the resolved model is set on the spawned teammate definition. The `model` param is the **only** tiering lever — tiering does not change `subagent_type` (the named agent is unchanged) and is orthogonal to the backend D5 selected. A `null` host slot in `models.tiers` means "this host has no model for this tier — fall through to the selected host's mapping" (the Codex seam is config + an adapter later; it is `null` now).

**Precedence at dispatch** (normative, ADR §2/§10): `--model-tier=` (pins every lane in the run) > per-lane plan `tier:` pin > `settings.json` `models.tiers`/`models.thresholds` > built-in default. Scoring is deterministic, so a dispatch trace is reproducible; the score + resolved tier + model are printed and recorded in the run record.

**The `model` param is ENFORCED at runtime (#60).** The "REQUIRED on every dispatch, defaults cheap, powerful must be justified" rule above is no longer prose the orchestrator self-enforces — it drifted silently after the first `/compact` in the forensic run, where an `opus` orchestrator dropped the `model` key from all 48 post-compaction dispatches and every cheap/mid lane silently inherited `opus`. A **PreToolUse tier guard** (`hooks/pre-tool-use.ts` → `evaluateTierDispatch`, `hooks/lib/tier-dispatch.ts`) now inspects every Guild specialist-lane `Agent` dispatch inside an active, fresh run:

| Dispatch | Lane evidence | Outcome |
|---|---|---|
| No explicit `model` param (`missing_model`) | structured | **DENIED.** The lane would inherit the dispatching process's model. The deny message quotes the tier contract (`cheap=haiku`, `mid=sonnet`, `powerful=opus`) and the deterministic remedy (run `scripts/score-tier.ts`, then dispatch with the resolved `model`). Downgrade **consciously** instead: `GUILD_ALLOW_UNTIERED_DISPATCH=1` allows it and still records the receipt. This is the ONE blockable case — it needs no tier map, only "did the dispatch carry a `model` key?". |
| No explicit `model` param | prompt-only | **Recorded, not blocked** — a lane recognised from prompt text alone is text-identical to an audit prompt quoting a live brief (same evidence tiering as #56). |
| `model` present, `GUILD_TIER=<t>` declared, model ≠ the run's `<t>` model (`tier_model_mismatch`) | any | **Recorded, NOT blocked.** The hook can read only the project-local `settings.json`, not the full multi-layer effective map `guild:execute-plan` resolves against (workspace/local/CLI layers + the frozen run snapshot, whose `effective` block carries no `models.tiers`). A "mismatch" may therefore be a legitimate inherited remap, so denying it would risk a false positive — it is surfaced loudly on stderr + in the receipt instead. Directional model-identity keeps a qualified version pin from being defeated by a moving alias. |
| `model` present, tier absent / unmapped / custom model | any | **PASS** — recorded, never gated (`scored_compliant` when a valid `GUILD_TIER` matches, else `model_present` / `tier_unverifiable`). |

**Only STRUCTURED lane evidence may BLOCK, and only for `missing_model`** — the block requires a producer-set carrier in the dispatch's own `env` map (`GUILD_SPECIALIST` / `GUILD_TASK_ID` / `GUILD_AGENT_DEFINITION`), out of reach of quoted text. Unlike the #56 backend guard, this guard is **not lead-only**: the tier contract binds the DISPATCH, so a helper spawned from inside a lane with no `model` param is gated too (it inherits its parent lane's model just as silently). Where `guild:execute-plan` carries `GUILD_TIER`/`GUILD_TIER_SCORE` on the dispatch env, the guard verifies the dispatched model is **consistent with the declared tier** (`scored_compliant`) — it does **not** certify the score→tier banding or that a `powerful` choice was justified (a per-lane pin or advisor request legitimately overrides the score, so `GUILD_TIER_SCORE` is recorded for audit, never used to reject a tier). When the carrier is absent, the deny message points at the documented `score-tier.ts` step; a malformed carrier records `tier_unverifiable`.

**Every Guild-lane dispatch decision writes a `guild.tier_dispatch.v1` receipt to `.guild/runs/<run-id>/logs/tier-dispatch.jsonl`** — the compliant dispatches included, so "48 dispatches, 0 tiered" is answerable post-hoc. Each receipt carries `{task_id, specialist, score?, tier?, model|MISSING, decision, reason, lane_evidence}` plus the verbatim `dispatch_line` (`lane <task-id> · score N · tier <tier> · model <model>`), turning SKILL.md §"Tier resolution" step 5's "never silent" print-mandate into a checkable run-record entry. The receipt records the **PreToolUse tier-gate decision** — `decision: pass` / `ok: true` means the tier gate raised no objection, NOT that the tool call executed (a sibling guard or capability enforcement may still block the same call). Only a genuine untiered violation (`reason: missing_model`) also writes a `guild.security_event.v1` audit twin (`tier_dispatch_untiered`) at `logs/security-events.jsonl` — a `tier_unverifiable` / `tier_model_mismatch` record carries an explicit model and is not "untiered". Free-text `detail` and config-derived model values are redacted/bounded before the receipt lands. It is a **dedicated sink**, deliberately not `logs/v1.4-events.jsonl` (whose event vocabulary is frozen and validated). *`guild:verify-done` and `guild:reflect` can audit this sink to detect un-scored dispatches post-hoc — wiring them to read it automatically is a followup owned by other lanes; a stale run is auditable by path today.*

## §task§agent lifecycle at dispatch

Every lane is dispatched as an **ephemeral one-agent-per-task** agent (ADR §6) — spawn → work → extract → dismiss — on whatever backend the run snapshot resolves (`snapshot.effective.agent_mode`). Concurrent lanes get **distinct** agents (never shared, SC-8); on receipt the agent's `learnings[]` are extracted and the agent terminates (no idle agents persist). This lifecycle is orthogonal to the backend table above: it applies identically whether the backend is team, agent, or subagent. Caches are model-specific, so a tier switch uses a separate agent process — which the per-task lifecycle gives for free (ADR §9).

The agent's **final action** in this lifecycle is writing its receipt file — see `## Handoff protocol` below for the single-channel protocol that every brief carries.

## Brief shape by tier (G-12 / SC-7)

The lane's **resolved tier decides the SHAPE of the task brief**, not just the model.
Frontier models perform best when given the outcome and the verification and left to
choose the method; cheap models perform best when every step is spelled out. Select
the shape from the lane's resolved tier (after scoring + pins — the same tier that
drives the `model` param above):

| Resolved tier | Brief shape |
|---|---|
| `powerful` — or any lane whose resolved model the operator pinned as a frontier model (per-lane plan `tier:`/`model_tier:` pin or `--model-tier=powerful`) | **GOAL-MODE brief** (template A below): desired end-state + constraints + the exact verification, method left open. Do NOT decompose into numbered steps. |
| `mid` | **Current default shape — unchanged.** The lane brief as composed today (scope, success-criteria, context bundle, autonomy policy). Neither template below applies. |
| `cheap` | **Prescriptive checklist brief** (template B below): an explicit numbered step list; no open-ended method choices. |

Whatever the shape, **the canonical handoff-protocol block (`## Handoff protocol`
below) is injected verbatim into every brief for ALL tiers** — the brief shape varies,
the receipt protocol never does.

### Template A — GOAL-MODE brief (powerful / operator-pinned frontier lanes)

Use verbatim, substituting the `<...>` placeholders. Four sections, in this order —
do not add a step-by-step plan section:

````
GOAL
<The desired end-state, stated as an outcome — what must be TRUE when this lane is
done, not how to get there. Include the artifact(s) that must exist and the behavior
they must exhibit.>

CONSTRAINTS
<Boundaries and invariants: file-ownership scope (write ONLY these paths), frozen
contracts/schemas that must not change, behavior that must stay byte-identical,
security/closed-key regimes, anything the plan's autonomy-policy forbids.>

VERIFY
<The exact command(s) or check(s) that prove the goal is met — e.g. the test command
to run and the expected result ("cd <dir> && npx jest --silent — ALL green, including
pre-existing tests"). The lane must run this itself before writing its receipt.>

FREEDOM
<Method is left open: choose your own decomposition, ordering, and implementation
approach within CONSTRAINTS. If you deviate from any assumption stated in the plan,
or discover the goal is better met another way, do it — and report every such
deviation in the receipt's `notes`/`assumptions` so the lead can audit the path
taken.>
````

### Template B — prescriptive checklist brief (cheap lanes)

Use verbatim, substituting the `<...>` placeholders. Every step is concrete and
self-contained; no step may require an open-ended judgment call:

````
TASK
<one-sentence task statement>

STEPS (do these in order, exactly):
1. <concrete action — exact file path + exact change>
2. <concrete action>
3. <...>
N. Run: <exact verification command> — expect: <exact expected output/result>.
N+1. Write your handoff receipt (protocol block below).

RULES
- Do ONLY the steps above. If a step cannot be completed exactly as written, STOP
  and emit `status: "escalate"` in your receipt with the blocking step number —
  do not improvise a workaround.
- Touch no file outside the paths named in the steps.
````

Mid-tier lanes keep the existing default brief composition documented in
`guild:execute-plan` — this section intentionally specifies no template for them.

## Handoff protocol (canonical — inject verbatim into every agent brief)

**Implements the agent-reliability plan §3 Track R (R1/R2/R3/R5) + A1/A3. Fixes flaws F1 (idle without handoff), F2 (dual-channel envelope), F4 (output-cap failure), F6 (cwd/path ambiguity).**

The file-based handoff design is correct; this section makes it **enforced and single-channel on every backend**. Every §task§agent writes its receipt — a `guild.handoff_receipt.v1` Markdown wrapper embedding exactly ONE fenced `guild.handoff.v2` JSON block — to a receipt file as its final action — never to chat, never to SendMessage body. The lead reads receipt files (deterministic); SendMessage is a liveness ping only.

### Protocol rules (normative)

- **R1 — Receipt file is the single source of truth, every backend.** Every §task§agent — whether dispatched via agent-team (tmux pane), in-process Agent(), or subagent — writes its receipt to `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` as its **final action**: a `guild.handoff_receipt.v1` Markdown wrapper that **embeds exactly ONE** fenced ```` ```guild.handoff.v2 ```` JSON block. The envelope schema is the `guild.handoff.v2` contract (bound by pointer — never re-spelled here). One format, one location, always. When the lead consumes a receipt, that single embedded `guild.handoff.v2` JSON block is the machine truth a consumer reads; the `guild.handoff_receipt.v1` YAML frontmatter is human-review context only (see §"Handoff contract" of the communication format policy). A frontmatter-only receipt with no embedded v2 block is not a valid machine receipt, and a receipt carrying two or more `guild.handoff.v2` blocks is rejected as a duplicate-block defect.
- **R2 — SendMessage is a one-line pointer; pasting the envelope is forbidden.** In team/pane mode: after the receipt file is written, send exactly one line via SendMessage: `done · <task-id> · status:<done|blocked|escalate> · receipt:<absolute-path>`. Nothing else. **Pasting the envelope text into chat or into the SendMessage body is explicitly forbidden** — this is the dual-channel defect (F2): two copies in two shapes, neither authoritative. The lead never reads handoff content from chat.
- **R3 — The lead reads receipt files; it never parses chat.** The orchestrator collects handoffs by reading receipt files (deterministic). SendMessage is a liveness signal; the lead checks the file, not the message body. This removes the "did it send the envelope?" non-determinism (F1).

### Canonical prompt injection block (R5)

**Copy the block below verbatim into every agent's prompt before dispatch.** Substitute `<RECEIPT_PATH>` and `<TASK_ID>` with the values for this lane. Do **not** paraphrase or rewrite it per-brief — per-brief rewording is the root cause of F1/F2 and must not recur.

````
---
HANDOFF PROTOCOL (mandatory — single channel, strict fenced-JSON)

Your final action is writing your handoff receipt to the receipt file.
Receipt path (absolute): <RECEIPT_PATH>

THE ENVELOPE IS JSON INSIDE THE FENCED BLOCK — NOT YAML FRONTMATTER.
A frontmatter-only receipt (--- schema_version: guild.handoff.v2 ...) is REJECTED by
the validator. There is exactly ONE accepted shape, shown below.

THE RECEIPT IS A guild.handoff_receipt.v1 MARKDOWN WRAPPER (human-review context)
that EMBEDS EXACTLY ONE fenced ```guild.handoff.v2``` JSON block (the machine
contract). Standard: the communication format policy §"Handoff contract". Three hard rules, checked by validator + lint enforcement:
  1. The embedded JSON block is the machine truth — NOT the YAML frontmatter.
  2. EXACTLY ONE such block. Zero blocks (frontmatter-only) is REJECTED by the
     validator; two or more guild.handoff.v2 blocks is REJECTED as a
     duplicate-block defect (lint-enforced in U5b).
  3. Frontmatter-only is invalid — the wrapper without the embedded block is not
     a valid machine receipt.

Write the receipt file with ALL THREE parts, in this order:

PART A — guild.handoff_receipt.v1 YAML frontmatter wrapper (the frozen v1 field
set — human/review metadata only; bind by pointer, do NOT invent fields —
see the target-architecture §"handoff_receipt contract" and the communication format policy §"Handoff contract"):

---
schema_version: guild.handoff_receipt.v1
task_id: <TASK_ID>
... (remaining frozen guild.handoff_receipt.v1 frontmatter fields) ...
---

PART B — five §8.2 sections as "## <name>" headings (human review contract):

## changed_files
## opens_for
## assumptions
## evidence
## followups

PART C — exactly ONE fenced block tagged guild.handoff.v2 containing JSON.
Substitute EVERY <...> placeholder with a concrete value — never emit a
pipe-delimited choice string ("cheap|mid|powerful") into the real receipt; the
validator requires ONE exact tier and ONE exact terminal status:

```guild.handoff.v2
{
  "schema_version": "guild.handoff.v2",
  "task_id": "<TASK_ID>",
  "tier": "<TIER: cheap|mid|powerful — pick exactly one>",
  "status": "<STATUS: done|blocked|escalate — pick exactly one>",
  "summary": "<= 600 chars>",
  "artifacts": ["path:line-range"],
  "issues": [],
  "learnings": ["optional"],
  "escalate_reason": "<required ONLY when status==escalate; omit otherwise>"
}
```

Allowed top-level JSON keys (strict — validator rejects any other key):
  schema_version, task_id, tier, status, summary, artifacts, issues,
  escalate_reason, learnings, notes.

STEP 1 — Write the receipt FILE via the Write tool at the absolute path above.
STEP 2 — Send exactly ONE SendMessage to team-lead:
            done · <TASK_ID> · status:<done|blocked|escalate> · receipt:<RECEIPT_PATH>
          Nothing else. NEVER paste the envelope or receipt body into chat.
          (Subagent/in-process mode: skip this step — writing the file is your final action.)
STEP 3 — No further action. The lead reads the FILE, not chat.

OUTPUT-CAP GUARD: Large artifacts (SVGs, generated source files, long configs) must be written
via the Write tool in structural sections — never emitted as one inline response. Budget:
≤500 lines per write call; for larger files use multiple calls (scaffold → fill sections →
close). Emitting a large file inline and hitting the 32k output-token cap writes nothing and
is an unrecoverable total lane loss.

ABSOLUTE-PATH RULE: All cross-repo and umbrella paths — in this brief and in your output
artifacts — are absolute. Never assume a relative path resolves correctly across worktrees or
repo boundaries.
---
````

### Orchestrator injection mechanics

Before spawning each lane's agent, substitute the orchestrator-known placeholders in the canonical block:

- `<RECEIPT_PATH>` → absolute path: `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md`
- `<TASK_ID>` → the lane's `task_id` from the plan

The remaining placeholders are **agent-supplied at receipt-write time** — the orchestrator does NOT pre-fill them because their values are only known after the agent works: `<TIER>` (the lane's resolved tier — one of cheap/mid/powerful), `<STATUS>` (the terminal disposition — one of done/blocked/escalate), `<summary>`, `artifacts`, and `<escalate_reason>` (only when status==escalate). The prompt's PART C explicitly instructs the agent to substitute every `<...>` with a concrete value and never emit a pipe-delimited choice string.

Then inject:

| Backend | Injection point |
|---|---|
| **Subagent** (`Agent()`) | Append verbatim block to the end of the `prompt` passed to `Agent()`. The producer marker still owns line 1 (`## Producer marker (line-1 + env)`) — appending never displaces it. |
| **cmux surface** (rung 0 of `team`) | Same injection timing as the agent-team row — include the block in the surface's initial prompt before the task brief; mechanics: `SKILL.md §"Backend + routing (summary)"`. |
| **Agent-team** (tmux pane) | Include block in the pane's initial system prompt; the launcher injects it at pane spawn before the task brief. |
| **In-process** (`result.dispatchPlan`) | Append to each descriptor's `prompt` in `dispatchPlan`, same as subagent. |

**Prompt-cache prefix discipline (shared-before-specific, G-19).** Provider prompt
caches key on identical leading bytes, so brief assembly orders **shared content
first, per-lane content last**: the agent definition (system prompt) and any
run-constant preamble lead; the bundle follows its own layer order (Universal —
byte-identical run-wide — then role-shared, then task-specific; see
`context-assemble` §Output); the per-lane substitutions (`<RECEIPT_PATH>`,
`<TASK_ID>`) and the task brief sit as late as the structure allows. Never
interleave a lane-specific value into run-constant or role-constant text — one
early differing byte forfeits the cached prefix for everything after it. The
**one sanctioned exception is the line-1 producer marker** (`## Producer marker
(line-1 + env)`): it is per-lane and it must stay first, because its whole value
comes from occupying a fixed producer-owned position the lane's appended text
cannot forge. It is a single short line, and every other backend already pays the
same cost — parity with `buildPrompt`, not a regression.

The block must appear in every brief without modification. If you find yourself rewriting it per-brief, that is the F1/F2 drift pattern recurring — stop and use the canonical block verbatim.

## Self-build dev-team routing

When the target repo IS the Guild plugin itself (self-build), `team.yaml` is composed from the **dev-team definitions under `.guild/agents/`**, each carrying the exact `guild.project_definition_ref.v1` committed by `.guild/adoption-manifest.json`. The 15 domain specialist roles build *user* products; they are NOT the self-build team. Route by changed path:

| Changed path | Dev-team definition |
|---|---|
| `scripts/`, `mcp-servers/`, `.mcp.json` | `tooling-engineer` |
| `hooks/` | `hook-engineer` |
| `commands/` | `command-builder` |
| `skills/**` | `skill-author` |
| `agents/*.md` (machinery agents) + `templates/specialists/*.md` (type templates) | `specialist-agent-writer` |
| `tests/` | `eval-engineer` |
| `docs/`, `CLAUDE.md` | `docs-writer` |
| manifests / ADRs / phase-gate integration | `plugin-architect` |

## Agent-team launcher

When the snapshot-resolved backend is `agent-team` (the D5 ladder resolved `agent_mode` to `team` at intake; team is primary whenever tmux is present — not an opt-in), invoke `scripts/agent-team-launcher.ts` to spawn the tmux session — one pane for the orchestrator plus one pane per specialist, with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` exported in each pane. The launcher is the canonical entry point for the agent-team backend; it writes a session manifest to `.guild/runs/<run-id>/agent-team/session.json` and refuses to spawn nested teams per §7.3. Run it once per execute-plan invocation:

```
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/agent-team-launcher.ts --team <resolved-team-path> --cwd <repo-root>
```

`<resolved-team-path>` is the **`resolveTeamFile(guildRoot, slug, readActivePhase(cwd))`** result (`scripts/lib/team-file.ts`) — the per-phase `.guild/team/<slug>.<phase>.yaml` (or legacy `.guild/team/<slug>.yaml` on back-compat). **Never reconstruct `.guild/team/<slug>.yaml` here** — pass the resolved path the input step (`## Input`) already computed. The launcher's `slugFromTeamPath` tolerates the `<slug>.<phase>.yaml` basename. Pass `--dry-run` first to preview the tmux commands without spawning the session; use `--session-name` when a name collision would otherwise block launch.

## Capability-scope env injection

Implements the dispatch-side of the v2 security policy (bound by pointer). The Wave-3 PreToolUse hook (`hooks/lib/security/enforce.ts`) reads `GUILD_CAPABILITY_SCOPE` and `GUILD_AUTONOMY_CONTRACT` from the spawned agent's environment to gate tool calls. This section specifies exactly how and when to populate them.

### When to inject

Inject **before spawning** each lane's ephemeral agent, once per lane per run. The orchestrator process itself never receives these vars.

### `GUILD_CAPABILITY_SCOPE`

Source: the lane specialist's `capability_scope:` field in `team.yaml`.

```
env["GUILD_CAPABILITY_SCOPE"] = JSON.stringify(team.specialists[lane.owner].capability_scope)
```

- **Field absent** (no `capability_scope:` key in the specialist block) → **do not set** the env var. Enforcement does not engage; the hook falls through cleanly. No breaking change for existing `team.yaml` files.
- **Field present, empty array** → set `GUILD_CAPABILITY_SCOPE=[]`. Enforcement engages with an empty allow-set — every tool call is out-of-scope (fail-closed). Only do this intentionally for a fully sandboxed read-only role; the default tables in `team-compose/SKILL.md §"Capability scope defaults"` are safe starting points.
- **Value is a JSON string array** of Claude Code permission-rule strings (e.g. `["Read","Write","Edit","Bash"]`). Rule syntax reference: `hooks/lib/security/enforce.ts` (bound by pointer — not re-spelled here).

### `GUILD_AUTONOMY_CONTRACT`

Source: the lane's `autonomy-policy` in the approved plan file (`.guild/plan/<slug>.md`).

The plan's `autonomy-policy` is natural language ("may act without asking: …"; "forbidden: …"). To populate `GUILD_AUTONOMY_CONTRACT`:

1. Extract the `may act without asking:` bullet(s) for the lane.
2. If the entries reference specific files or operations that map to Claude Code tool-permission rules (e.g. "create new files under `services/pricing/`" → `"Write(services/pricing/*)"`, "run the test suite" → `"Bash(npm test*)"`) — serialise those as a JSON string array and set `GUILD_AUTONOMY_CONTRACT`.
3. **If no machine-readable rules can be derived** from the natural-language entries → **do not set** `GUILD_AUTONOMY_CONTRACT`. Absent ⇒ no additional AND-masking; `GUILD_CAPABILITY_SCOPE` alone governs.

`GUILD_AUTONOMY_CONTRACT` is an AND-mask over `GUILD_CAPABILITY_SCOPE` — it can only narrow, never widen. When present, a tool call must match both the capability scope and the autonomy contract to be permitted.

### Backend-specific wiring

| Backend | Injection method |
|---|---|
| **subagent** (Agent tool) | Pass via the Agent tool's `env` parameter: `Agent({ subagent_type: <name>, env: { GUILD_CAPABILITY_SCOPE: "...", GUILD_AUTONOMY_CONTRACT: "..." }, ... })`. Omit keys whose source field is absent. |
| **cmux surface** (rung 0 of `team`) | Same as agent-team: set vars in the surface's environment (or its native env-injection call) before attaching Claude Code, before the task brief. |
| **agent-team** (tmux panes) | Export vars in the pane environment before attaching Claude Code: `tmux send-keys -t <pane> 'export GUILD_CAPABILITY_SCOPE='"'"'[...]'"'"'' Enter` — the launcher script (`scripts/agent-team-launcher.ts`) is responsible for this injection. |
| **in-process / independent agents** | Same `env` param path as subagent: execute-plan passes `GUILD_CAPABILITY_SCOPE` / `GUILD_AUTONOMY_CONTRACT` (when their source fields are present) on each `Agent()` call issued from `result.dispatchPlan`. The descriptor already carries `GUILD_RUN_ID` from the launcher; execute-plan layers the capability-scope vars on top at dispatch. Omit keys whose source field is absent. |

### Trace + audit

Record the injected values alongside the lane's tier trace in the run record (`.guild/runs/<run-id>/` — the same record that holds the dispatch line). This makes the effective allow-set verifiable in audit and reproducible across re-runs (SC-5).

## Parallelism rules

Read the DAG encoded by each lane's `depends-on:` and schedule dispatches accordingly:

- **Architect first when present.** If a lane is owned by `architect`, it is typically a common dependency — most downstream lanes list its `task-id` in `depends-on`. Dispatch architect before any lane that depends on it, and hold the dependents until architect's receipt is written.
- **Backend → QA.** QA's integration work depends on backend deliverables. Never dispatch QA before backend's receipt is present.
- **DevOps → QA.** Staging hookup must precede QA's regression run.
- **Content and commercial in parallel with engineering** when the lane only depends on the spec. A copywriter lane with `depends-on: []` dispatches at run-start alongside architect; it does not wait for engineering.
- **Worktree isolation.** When dispatching two or more lanes in parallel, run each in its own git worktree so file edits cannot collide. The specialist's subagent is responsible for worktree entry/exit; `guild:execute-plan` only needs to confirm the worktree was distinct before marking a lane dispatched. Serial lanes may share the main worktree.

The schedule is a function of the DAG, not of authoring order. Lanes with empty `depends-on:` are eligible at run-start; every other lane becomes eligible the moment every task-id it lists has a completed receipt — **except when the completed lane is a spine lane** (one or more other lanes depend on it): its dependents additionally wait on the mandatory spine-lane verify checkpoint (`SKILL.md §"Spine-lane verify checkpoint"`) before becoming eligible.

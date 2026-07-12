# Backend choice, routing & parallelism

Detail for `guild:execute-plan`'s `## Backend + routing (summary)` and parallelism scheduling.

## Backend choice

Guild supports three execution backends. The choice is **resolved by the `agent_mode` ladder** (ADR D5; `CLAUDE.md §"Backend default"`) **once at run-start intake** by `runStartPreflight` (U3), frozen in the run's resolved-settings snapshot (U6). `guild:execute-plan` **reads it from the snapshot** (`readResolvedSettingsSnapshot` → `snapshot.effective.agent_mode`) and honors it — it never re-picks, and it does not read the backend from `team.yaml` (whose top-level `backend` is only a mirror for audit; `team.yaml` is composition-only). **Team/agent is primary whenever tmux is present; subagent is the fallback, not the default.**

| Backend | Selected when (`agent_mode` resolves to…) | Tradeoff |
|---|---|---|
| **Agent teams (tmux panes)** | `team` — `auto` + tmux available (the common case on a dev machine) **or** an explicit `team` pin. One **visible pane per specialist**. | Experimental; requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; one team per session; no nested teams; higher token cost. **PRIMARY under tmux.** |
| **In-process / Independent agents** | `agent` — D5 rung 3: host supports independent agents, no tmux. `InProcessTeamBackend.launch()` returns `ok:true` with `dispatchPlan: GuildDispatchDescriptor[]` (one descriptor per specialist: `name / subagentType / model=null / env / prompt`); `orchestratorPaneId: null`, `teammatePaneIds: {}`. `guild:execute-plan` issues one `Agent()` call per descriptor in `result.dispatchPlan`, applying tier + model at dispatch (`model: null` from backend — tiering is orthogonal; execute-plan scores and resolves). (ADR §RE-4 / VC-RE-4.) | No tmux; fully implemented (VC-RE-4). Declarative plan from launcher → `Agent()` calls in execute-plan. Not a fallback stub. |
| **Subagents via Agent tool** | `subagent` — the **fallback**: no tmux + no independent-agent support (CI, fresh installs), or an explicit `subagent` pin. | Lower cost, simplest cleanup; runs in the background, only the final artifact returns. The documented last resort. |

Two hard constraints:

- **`agent-team` requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.** When the snapshot resolves the backend to `agent-team` (the ladder resolved to `team`) and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is not set, **refuse to dispatch and surface the blocker** rather than silently falling back to subagents — falling back would change execution semantics out from under the plan. Invoke `scripts/agent-team-launcher.ts` (below) — it owns the ladder resolution, the env gate, and the tmux strategy. (The tmux **enablement** prompt is not raised here at dispatch — `runStartPreflight` owns it at intake, and it fires **per-run** while tmux is available && effective `agent_mode != "team"` (`needsTmuxPrompt`); a **yes** persists `agent_mode: team` so future runs stop prompting, a **no** persists nothing and may prompt again next run. It is **not** a one-time "durable approval".)
- **Always dispatch the lane AS its named specialist role**, resolved against `team.yaml`'s `definition:` + `definition_source:` fields (written by team-compose from the roster-resolve JSON). Two cases:
  - **Shipped agent** (`definition_source: shipped` — `agents/<name>.md`, or `.claude/agents/<name>.md` for self-build): the host registered the definition at session start — dispatch by name (`subagent_type: <name>` for subagents; the teammate spawned from that definition for teams). Dispatching a shipped agent as bare `general-purpose` discards its persona, scoped skills, tool permissions, and TRIGGER/DO-NOT-TRIGGER boundaries and is a defect. *(After the machinery-vs-template-library ADR the shipped set is the machinery pair `advisor`/`developer` — every DOMAIN specialist lane arrives as a project instance below.)*
  - **Project specialist** (`definition_source: project` — `.guild/agents/<name>.md`, minted from a shipped template by team-compose or created via guild:create-specialist): the host has NO registered agent under this name — `subagent_type: <name>` cannot resolve, in any session. The backend dispatches it as the host-generic subagent type **with the definition carried in the lane prompt** (`composeInProcessDispatch` sets `definitionPath` + env `GUILD_AGENT_DEFINITION`; `buildPrompt` embeds the definition-adoption + project-skill-loading instruction) at the specialist's own tier. This is the correct first-class path — do NOT "fix" it back to a bare name, and do NOT strip the definition instruction (a generic dispatch **without** the definition is the defect).

### In-process dispatchPlan consumption

When the snapshot-resolved backend is `in-process` (D5 `agent` rung — §RE-4 / VC-RE-4 of the runtime and execution model ADR), the launcher (`InProcessTeamBackend.launch()`) returns `ok:true` with a declarative `dispatchPlan: GuildDispatchDescriptor[]` — one descriptor per specialist. A `TeamBackend` is a plain TypeScript class; it **cannot** call the Agent tool. `guild:execute-plan` consumes `result.dispatchPlan` and issues the Agent tool calls itself:

1. **For each descriptor in `result.dispatchPlan`** (in DAG order per `## Parallelism rules`):
   - Resolve tier + model via tier resolution (`model: null` from backend — tiering is orthogonal to backend choice; execute-plan scores and resolves).
   - Inject capability-scope env vars (`GUILD_CAPABILITY_SCOPE` / `GUILD_AUTONOMY_CONTRACT`) onto the descriptor's `env` map. The descriptor already carries `GUILD_RUN_ID` from the launcher; execute-plan layers the capability-scope vars on top at dispatch (same injection path as subagent — `env` param on `Agent()`).
   - Issue: `Agent({ subagent_type: descriptor.subagentType, model: <resolved>, prompt: descriptor.prompt, env: { ...descriptor.env, GUILD_CAPABILITY_SCOPE: "...", GUILD_AUTONOMY_CONTRACT: "..." } })`. Omit capability-scope keys whose source field is absent.
2. **No tmux** — `orchestratorPaneId: null`, `teammatePaneIds: {}`. The orchestrator stays in-process and never gets a descriptor (only specialists do, mirroring `RemoteTeamBackend §CH-4`).
3. **Named specialist role, resolved by definition source.** For a shipped specialist, `descriptor.subagentType` is the lane's `owner_role` (bare name from `team.yaml`). For a project-local specialist (`definition_source: project`), the launcher sets `subagentType` to the host-generic type and `descriptor.definitionPath` to `.guild/agents/<name>.md` — issue the `Agent()` call as-is; the prompt already carries the definition-adoption instruction. Same invariant as all other backends (see the hard constraint above).

`dryRun: true` on `InProcessTeamBackend` is semantically a no-op (no subprocess is suppressed — the plan is purely declarative); the launcher annotates a note and returns the same `dispatchPlan` so execute-plan can display the planned `Agent()` call strings.

## Tier → Agent `model` param

The lane's resolved tier (`guild:execute-plan §"Tier resolution"`; ADR §2) maps to a model through the host-agnostic `models.tiers` map (ADR §1/§10 — bound by pointer, never re-spelled). Within Claude:

| Tier | Claude `model` | Typical work |
|---|---|---|
| `cheap` | `haiku` | read, summarize, classify, tag |
| `mid` | `sonnet` | draft, reason, plan, extract relationships |
| `powerful` | `opus` | architecture, security review, advisor pass |

**Wiring.** For the subagent backend, pass the resolved model on the Agent tool: `Agent({ subagent_type: <owner_role>, model: <resolved-model>, ... })`. For agent-team teammates, the resolved model is set on the spawned teammate definition. The `model` param is the **only** tiering lever — tiering does not change `subagent_type` (the named agent is unchanged) and is orthogonal to the backend D5 selected. A `null` host slot in `models.tiers` means "this host has no model for this tier — fall through to the selected host's mapping" (the Codex seam is config + an adapter later; it is `null` now).

**Precedence at dispatch** (normative, ADR §2/§10): `--model-tier=` (pins every lane in the run) > per-lane plan `tier:` pin > `settings.json` `models.tiers`/`models.thresholds` > built-in default. Scoring is deterministic, so a dispatch trace is reproducible; the score + resolved tier + model are printed and recorded in the run record.

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
| **Subagent** (`Agent()`) | Append verbatim block to the end of the `prompt` passed to `Agent()`. |
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
early differing byte forfeits the cached prefix for everything after it.

The block must appear in every brief without modification. If you find yourself rewriting it per-brief, that is the F1/F2 drift pattern recurring — stop and use the canonical block verbatim.

## Self-build dev-team routing

When the target repo IS the Guild plugin itself (self-build), `team.yaml` is composed from the **dev-team agents under `.claude/agents/`** — `plugin-architect, skill-author, specialist-agent-writer, command-builder, hook-engineer, tooling-engineer, docs-writer, eval-engineer` — each owning a plugin path-slice (see `CLAUDE.md §"Dev team"`). The 14 `guild:` product specialists build *user* products; they are NOT the self-build team. Route by changed path:

| Changed path | Dev-team `subagent_type` |
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
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/agent-team-launcher.ts --team <resolved-team-path> --cwd <repo-root>
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

The schedule is a function of the DAG, not of authoring order. Lanes with empty `depends-on:` are eligible at run-start; every other lane becomes eligible the moment every task-id it lists has a completed receipt.

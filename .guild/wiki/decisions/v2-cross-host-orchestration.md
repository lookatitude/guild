---
type: decision
owner: architect
confidence: medium
importance: high
source_refs:
  - docs/knowledge/research/capability-routing.md                  # D-CR-1..6, gaps G-A..G-F, §5 routing policy
  - docs/knowledge/research/tmux-cross-host.md                     # CH-1..6, gaps CH-G1..G6, §4 mixed-host launcher design
  - docs/knowledge/decisions/v2-runtime-and-execution-model.md     # ADR-RE-4 TeamBackend seam, ADR-RE-5 host-capability manifest (bound by pointer)
  - docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md # §1 tier ladder + null codex/gemini slots, §2 auto-score, §5 guild.handoff.v2 (bound by pointer)
  - docs/knowledge/decisions/v2x-command-surface-dispatch-and-internalization.md # D5 agent_mode dispatch ladder (bound by pointer)
  - docs/knowledge/decisions/guild-boundary-config-and-tracking.md # CR-D .guild/ ownership map + atomic-write/.lock
  - docs/knowledge/decisions/config-surface-settings-json.md       # closed-key settings.json reject regime (new defaults.* land here)
created_at: 2026-05-26
updated_at: 2026-05-26
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [v2-runtime-and-execution-model, cost-aware-tiering-and-lean-context, v2x-command-surface-dispatch-and-internalization, guild-boundary-config-and-tracking, v2-security-and-untrusted-content, v2-observability-and-replay, capability-routing, tmux-cross-host]
---

# ADR: v2 cross-host orchestration — capability routing + mixed-host tmux team composition

## Status

**Accepted (operator-ratified 2026-05-26; v2.0-full-scope program).**

This ADR consolidates the two Track-3 research briefs —
[`research/capability-routing.md`](../research/capability-routing.md) (decisions
D-CR-1..6) and [`research/tmux-cross-host.md`](../research/tmux-cross-host.md)
(decisions CH-1..6) — into one coherent cross-host decision set. It is the
**policy + launcher layer that sits on top of the Track-3 gate** opened by the
ratified runtime ADR: ADR-RE-4 (`TeamBackend` seam) and **ADR-RE-5**
(`guild.host_capability.v1` static manifest), which the runtime ADR flags as
"the single decision that unblocks ALL of Track 3." Both are bound **by pointer**
here ([`v2-runtime-and-execution-model.md`](v2-runtime-and-execution-model.md));
their canonical bodies are not re-spelled.

It is a **decision record**: it does not write the launcher, the adapters, the
routing function, config schema, or migration prose — each decision is handed to
its owning dev-team agent (`tooling-engineer`, `skill-author`, `hook-engineer`,
`docs-writer`). It is **additive to the frozen v2 contract set**: it introduces
**two proposed new siblings** (`guild.task_assignment.v1`,
`guild.approval_request.v1` — carriers for the artifact-bus task + approval
channels), **one additive optional extension** to `guild.tmux_team.v1`
(`host_kind` + `adapter_version` per pane, lenient-reader, no `schema_version`
bump), and **new closed-key `settings.json` additions**. No frozen
`guild.*.v1` field set changes.

> **Dependency gate (read first).** Both **ADR-RE-4** (`TeamBackend` interface
> *extracted* from the launcher) and **ADR-RE-5** (`guild.host_capability.v1`
> *written* by a host bootstrap) must land before CR-1 / CH-1 / CH-2 can be
> implemented. Until the interface exists and at least one host writes its
> manifest, `host:` in `team.yaml` is an unvalidated raw string and the routing
> function has no manifests to read (briefs `capability-routing §7`,
> `tmux-cross-host §6`). This ADR is design-blocked on those two, not on itself.

## Context

The runtime ADR froze two seams but left the **policy between them unwired**
(`capability-routing §1`):

- The **cost-aware tiering ADR** defines a host-agnostic `cheap | mid | powerful`
  ladder whose `models.tiers` map carries `"codex": null, "gemini": null` for
  every tier — a deliberate seam, "no model assigned yet; look up at runtime"
  ([`cost-aware-tiering-and-lean-context.md §1`](cost-aware-tiering-and-lean-context.md)).
- **ADR-RE-5** defines `guild.host_capability.v1` — a static local manifest at
  `.guild/hosts/<host-id>/capability.json` declaring `host_kind`,
  `supported_tiers`, `tier_models`, `supported_backends`, `tool_permissions`,
  `egress` — but **no routing policy** turns those manifests into a concrete
  `(host, model)` choice for a task (`capability-routing §1`, gap **G-A**).
- Guild's launcher (`plugin/scripts/agent-team-launcher.ts`) is **Claude-only**:
  hardcoded `claude` binary per pane, hardcoded `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
  env gate, uniform `TaskCreated`-referencing prompt shape, and a `session.json`
  that records pane IDs but **not per-pane `host_kind`** (`tmux-cross-host §2`,
  gaps **CH-G1..G3, G6**).

The briefs survey the state of the art and converge on a posture this ADR adopts:
**one-shot upfront capability routing** (RouteLLM / cascade hybrid;
`capability-routing §2.1`, §5.1) on the policy side, and **tmux as a neutral
supervisor with per-host adapters as CLI translators** (CLI Agent Orchestrator,
NTM; `tmux-cross-host §1.1`, §4.1) on the execution side. Cross-host coordination
is **file-based only** — Codex CLI exposes no agent-team event bus equivalent to
Claude Code's, so the shared `.guild/runs/<run-id>/` artifact bus is the sole
coordination channel (`tmux-cross-host §1.3`, §4.3). No daemon, no IPC, no
external negotiation service — consistent with Guild's zero-infra plugin model.

## Local by default — when does a remote agent run?

**Default: everything runs on the local host.** Cross-host is strictly opt-in;
`defaults.cross_host.enabled: false` (the default) means single-host behaviour,
byte-identical, **no SSH ever**. A specialist runs on a *remote* host only when
**all** of these hold — otherwise the lane stays local (or falls back to Claude
per `fallback_to_claude`):

1. **`defaults.cross_host.enabled: true`** (or `GUILD_CROSS_HOST_ENABLED=1`) — the master switch.
2. **The specialist is routed to a remote host** — via `team.yaml` `host:` and/or the capability-routing function (CR-1), and that host is not the local host.
3. **An endpoint exists** for that host in `defaults.cross_host.hosts.<id>` (`address`[, `user`, `port`, `login_shell`]). No endpoint ⇒ refuse (surface, never partial-dispatch).
4. **The pre-dispatch capability probe passes** — before spawning anything, `RemoteTeamBackend` SSHes in and checks the host actually has the brand CLI (`claude`/`codex`/`pi`/`agy`) **and** `tmux`. Missing ⇒ **fail-fast with a clear message, zero panes spawned** (`team-backend.ts` `RemoteTransport.probe` + `launch()` Phase 1.5). The probe is login-shell-wrapped when `login_shell` is set, so a brand off the non-interactive PATH (codex/linuxbrew, agy/~/.local/bin) still resolves.

So the operator's mental model is simple: **local unless I explicitly enable
cross-host AND point a specialist at a configured, capable remote host.** The
probe means Guild never *tries* to use a remote tool that isn't installed — it
checks first.

## Decision

The decision set has two clusters: **A. Capability routing** (the policy that
chooses `(host, tier, model)`) and **B. Mixed-host tmux composition** (the
launcher + adapters + coordination that executes the choice). They compose: A
produces the routing decision; B is the backend that realizes it.

---

### Cluster A — Capability routing

#### CR-1 — Routing decision function (consolidates D-CR-1; resolves G-A)

Define the deterministic three-axis compose function that the cost ADR + RE-5
left unwired. The axes are *mode* (D5 ladder: `team | agent | subagent | auto`)
× *tier* (cost ADR §2 auto-scorer output) × **host** (RE-5 manifest). Given a
`task_spec` (with tier already resolved by the cost auto-scorer) and the
`manifest_set` loaded from `.guild/hosts/*/capability.json`
(`capability-routing §5.1`):

```
1. FILTER manifests: keep hosts where
     host.supported_tiers ∋ task.tier
     AND host.supported_backends ∋ required_backend_kind
     AND manifest.advertised_at > now - staleness_ttl     # CR-5
2. RANK by work-type → host affinity                       # CR-4
3. TOOL pre-check: intersect task.required_tools with
     host.tool_permissions; reject host on gap             # CR-2
4. RESOLVE model via merge precedence (null-slot fill):
     settings.json models.tiers[tier][host_kind]
       → host.tier_models[tier]
       → built-in default (null ⇒ claude fallback)
5. SELECT primary = top-ranked; build fallback_chain       # CR-3
6. LOG {task_id, tier, primary_host, model, fallback_chain,
        affinity_score} → run-state.lanes[id].routing_decision
```

This is **one-shot upfront routing**: route once, escalate via the existing
cost-ADR auto-score retry path if the lane fails (`capability-routing §5.1`). The
function MUST be synchronous and cheap (**< 5 ms, no network call** —
`capability-routing §8`). The step-4 merge **is** the "adapter fill" that makes
the `null` codex/gemini slots operational (see "Null-slot fill" below). Owned by
`tooling-engineer`.

#### CR-2 — Capability pre-check policy (consolidates D-CR-2; resolves G-B)

A task declares `required_tools`, `required_backend`, and `required_tier`. The
router rejects a host **before** routing whenever the host's manifest does not
cover those requirements. This is the **pre-routing** capability check — it runs
*before* the security ADR's enforcement fires, so a task is never dispatched to a
host that will then fail the security-ADR tool-permission intersection
(`capability-routing §4 G-B`, §6). **Binding boundary:** this ADR defines the
pre-check (does the host *advertise* the capability?); the **security ADR owns
the trust intersection** (a cross-host task receives the *intersection* of both
hosts' permitted tools, never the union) and manifest anti-spoof. Pre-check ≠
trust enforcement. Owned by `tooling-engineer`.

#### CR-3 — Fallback chain (consolidates D-CR-3; resolves G-C)

A ranked fallback chain, ordered by decreasing preference
(`capability-routing §5.2`):

1. **Same tier, different host** (e.g. claude sonnet → codex mid).
2. **Same host, next-cheapest tier with capability** — escalation only; **never
   downgrade tier silently**.
3. **Cross-host, next-cheapest tier.**
4. **Claude-only fallback** (always present on the current host; last resort).

Fallback fires on: manifest absent or stale; provider auth failure (`codex
--version` fails); host rate-limit / outage (429/503 from the adapter). The
**no-silent-downgrade** rule is normative — a tier drop requires an explicit
escalation signal, never an automatic quality regression. Owned by
`tooling-engineer`.

#### CR-4 — Work-type ↔ host affinity map (consolidates D-CR-4; resolves G-D)

The formal soft-signal ranking input to CR-1 step 2 (`capability-routing §3.3`):

| Work type | Primary host affinity | Reason |
|---|---|---|
| Interactive lifecycle / hooks | claude | Hooks are Claude Code-specific. |
| Adversarial / independent review | cross-host (codex or gemini) | Independence from the creator host. |
| Background implementation task | codex-cloud if `cloud_tasks: true` | Detached headless execution. |
| Parallel local lanes (tmux available) | claude tmux team | Native backend. |
| Graph/semantic extraction (cheap) | claude haiku or codex cheap | Tier cheapness wins. |

Affinity is a **soft signal** — overridden by capability-probe failure (CR-2) or
budget-cap hit (CR-6). It re-ranks; it never hard-selects. Owned by
`tooling-engineer` (policy table) + `skill-author` (dispatch-skill wiring).

#### CR-5 — Manifest freshness policy (consolidates D-CR-5; resolves G-F)

`guild.host_capability.v1` carries `advertised_at` but RE-5 defines no TTL.
Default TTL **`3600s`** (1 hour), config key `defaults.capability_manifest_ttl_s`.
Re-probe trigger: session start (lazy) + first routing miss. The re-probe
mechanism is the **`guild doctor`** command (recommended in research #17), which
re-writes `.guild/hosts/<host-id>/capability.json` in place
(`capability-routing §5.3`). A stale manifest excludes the host from CR-1 step 1.
TTL is a mitigation, not a prevention, for silent provider capability drift
(`capability-routing §8`). Owned by `tooling-engineer` (`guild doctor`) +
`docs-writer` (config key).

#### CR-6 — Budget enforcement deferred to v2.1 (consolidates D-CR-6; resolves G-E)

Cross-host per-run cost-cap enforcement (ParetoBandit pattern) requires
per-provider cost tables that differ across `claude | codex | gemini` and are not
yet available. **Defer the cap to v2.1.** For v2.0, record actual spend now via
the existing telemetry stub (`capture-telemetry.ts`) so the data exists when the
cap lands (`capability-routing §5.4`). Tracked as open item `oc-budget-cap`.
Owned by `tooling-engineer` (telemetry stub).

---

### Cluster B — Mixed-host tmux composition

#### CH-1 — Mixed-host `TmuxTeamBackend` with per-pane adapter dispatch (resolves CH-G1)

Extend `agent-team-launcher.ts` (the `TmuxTeamBackend` implementation under
ADR-RE-4) to read a per-specialist `host:` field from `team.yaml` and resolve a
`PaneAdapter` from the `guild.host_capability.v1` manifest for that specialist's
host (default: orchestrator host when `host:` is omitted). Replace the monolithic
`paneCommand()` with `adapter.command(spec)` + `adapter.env(spec)`
(`tmux-cross-host §4.2`, CH-1). **Dep:** ADR-RE-4 extracted first; ADR-RE-5
written by host bootstrap. Owned by `tooling-engineer`.

#### CH-2 — `PaneAdapter` interface + `ClaudePaneAdapter` / `CodexPaneAdapter` (resolves CH-G2)

Define a provider-neutral `PaneAdapter` seam (`tmux-cross-host §4.1`):

```ts
interface PaneAdapter {
  preflight(): { ok: boolean; message: string }   // binary/credential check before spawn
  command(spec: PaneSpec): string                  // shell command for the pane
  env(spec: PaneSpec): Record<string, string>      // env vars for the pane
  expectedOutputs(): ("heartbeat" | "handoff_receipt" | "approval_request")[]
}
```

Ship two implementations, registered in an `ADAPTERS` map keyed by `host_kind`:
- **`ClaudePaneAdapter`** — emits `claude '<prompt>'`; injects
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` + `GUILD_RUN_ID`; preflight `claude
  --version`.
- **`CodexPaneAdapter`** — emits `codex exec '<prompt>'`; checks `OPENAI_API_KEY`
  present (refuses to spawn if absent); injects `GUILD_RUN_ID`; **does NOT**
  inject the Claude team env gate; preflight `codex --version`.

Future hosts (Gemini, …) add one adapter file, no launcher-core change
(`tmux-cross-host §5 CH-2`). Owned by `tooling-engineer`.

#### CH-3 — Artifact-bus-only coordination for mixed teams (resolves CH-G6 + CH-G4 task side)

**Prohibit a cross-host agent-team event bus.** Codex panes cannot join Claude
Code's `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` bus or consume `TaskCreated/
TaskCompleted` hooks (`tmux-cross-host §1.3`, CH-G6). All inter-pane coordination
flows through the shared FS artifact bus under `.guild/runs/<run-id>/`
(`tmux-cross-host §4.3`):

```
.guild/runs/<run-id>/
  tasks/<specialist>.json          # orchestrator assigns work   → guild.task_assignment.v1 (new, below)
  in-progress/<specialist>.json    # structured heartbeat        → ADR-RE-3 (existing)
  handoffs/<specialist>-<task>.md  # specialist publishes on done → guild.handoff_receipt.v1 (frozen)
  approvals/<specialist>.json      # approval escalation         → guild.approval_request.v1 (new, below)
  logs/events.jsonl                # append-only event log (all hosts write)
```

Each host's context bundle explicitly instructs the specialist to read its task
from `tasks/<name>.json` and write heartbeat + handoff to the agreed paths.
Owned by `skill-author` (context-assemble + orchestrator skills) + `tooling-engineer`
(launcher writes `tasks/`).

#### CH-4 — Orchestrator host owns interactive approval UX (resolves CH-G4)

The orchestrator pane is **always the starting host** (the CLI the operator
invoked Guild from). A specialist pane (any CLI brand) that hits the always-ask
hard set writes `approvals/<specialist>.json` and pauses. The orchestrator polls
the approvals directory at the `heartbeat_timeout_ms` cadence and surfaces blocked
approvals to the operator in its own interactive UI; the decision is written to
`approvals/<specialist>-ack.json`, and the specialist unblocks on detecting the
ack (`tmux-cross-host §4.4`, CH-4). This preserves the
`guild.autonomy_contract.v1` always-ask hard set across host boundaries **without
a shared event bus**. **Binding boundary:** this ADR defines the *UX flow*; the
**security ADR owns the trust model** (autonomy + always-ask propagation across
hosts, no secrets in `approvals/*.json`). Owned by `skill-author` (orchestrator
skill) + `hook-engineer` (TeammateIdle / ack-poll wiring).

#### CH-5 — `guild.tmux_team.v1` per-pane `host_kind` extension (resolves CH-G3)

Extend `session.json` (`guild.tmux_team.v1`) with **additive optional** fields
`host_kind` and `adapter_version` per pane entry (`tmux-cross-host §4.5`, CH-5):

```jsonc
{ "specialist": "security", "pane_id": "%4",
  "host_kind": "codex",        // NEW: from guild.host_capability.v1
  "adapter_version": "1" }     // NEW: PaneAdapter version used at spawn
```

The **lenient-reader rule** applies — existing readers ignore unknown fields;
**no `schema_version` bump** (same pattern as `retry:` in ADR-RE-2). Resume
(`/guild:resume`) and telemetry (`capture-telemetry.ts`) read `host_kind` from
the manifest rather than re-inferring it. Owned by `tooling-engineer`.

#### CH-6 — Fail-fast preflight before any pane spawns (resolves the partial-spawn failure mode)

Before opening **any** pane in a mixed-host team, the launcher runs every
specialist's `PaneAdapter.preflight()`. If any fails, the launcher **aborts with
a specific error naming the failing specialist + host + missing dependency — zero
panes opened** (fail-fast, not partial-spawn). `ClaudePaneAdapter` checks `claude
--version`; `CodexPaneAdapter` checks `codex --version` AND non-empty
`OPENAI_API_KEY` (`tmux-cross-host §5 CH-6`). Owned by `tooling-engineer`.

## Null codex/gemini tier-slot fill (the seam this ADR operationalizes)

The cost ADR's built-in tier map leaves codex/gemini `null` at every tier
([`cost-aware-tiering-and-lean-context.md §1`](cost-aware-tiering-and-lean-context.md));
`null` means "no model assigned yet; look up from the host's manifest at
runtime." **CR-1 step 4 is the fill**, with this merge precedence
(`capability-routing §3.2`):

```
explicit settings.json models.tiers[tier][host_kind]   (operator override)
  → guild.host_capability.v1 tier_models[tier]          (RE-5 manifest fill)
  → built-in default                                    (null ⇒ claude fallback)
```

Example: a `codex` host manifest carrying
`"tier_models": { "cheap": "gpt-4o-mini", "mid": "gpt-4o", "powerful": "o3" }`
fills the `null` codex column at routing time. This is exactly the
"config + adapter, not a redesign" seam the cost ADR designed and the runtime
ADR (ADR-RE-5) named as one of the four things Track 3 needs. Gemini fills the
same way once a Gemini manifest + adapter exist (CH-2 extension point).

## New contracts (proposed — for the lead to register if approved)

These follow the additive `[post-v2]` sibling pattern
([`contract-map.md §B-post`](../implementation/contract-map.md)). **This ADR is
their single canonical body**; skills/scripts bind by pointer. **The team lead
registers contract-map + target-architecture sibling-registry + CR-D
ownership-map rows after approval** — this ADR does not touch those files. The
two new siblings are flagged **proposed**, mirroring runtime-ADR OQ-4's posture
on whether an operational artifact warrants a formal `schema_version` (see
open questions OQ-CH-2).

| # | Contract | schema_version | Status | Canonical body | `.guild/` path | Realizing / consuming |
|---|---|---|---|---|---|---|
| 1 | TaskAssignment | `guild.task_assignment.v1` | `[proposed]` | this ADR §CH-3 | `.guild/runs/<run-id>/tasks/<specialist>.json` | launcher/orchestrator (writer), specialist pane (reader) — CH-3 work-assignment channel |
| 2 | ApprovalRequest | `guild.approval_request.v1` | `[proposed]` | this ADR §CH-4 | `.guild/runs/<run-id>/approvals/<specialist>.json` (+ `-ack.json`) | specialist pane (writer/escalation), orchestrator (reader/ack) — CH-4 approval UX; **security ADR owns trust/no-secrets** |

**Additive extension (NOT a new sibling):** `guild.tmux_team.v1` gains optional
`host_kind` + `adapter_version` per pane (CH-5) — additive optional key under the
lenient-reader rule, **no `schema_version` bump** (same class as `retry:` in
ADR-RE-2).

**Not contracts:** the `PaneAdapter` interface (CH-2) is a TypeScript seam in the
launcher, not a wire schema; `logs/events.jsonl` (CH-3) is an append-only
operational log under the existing `.guild/runs/` telemetry path.

**Canonical bodies (proposed):**

```jsonc
// guild.task_assignment.v1 — orchestrator → specialist work assignment (CH-3)
{
  "schema_version": "guild.task_assignment.v1",  // self-versioned; lenient-reader
  "task_id": "security-auth-001",                 // required
  "specialist": "security",                       // required; pane owner
  "host_kind": "codex",                           // required; resolved host (CR-1)
  "tier": "powerful",                             // required; resolved tier (cost ADR §2)
  "scope": "audit the auth flow",                 // required; one-line work scope
  "context_bundle_ref": ".guild/runs/<id>/bundles/security.md", // required; pulled context (cost ADR §4)
  "depends_on": ["architect-001"],                // required (may be []); DAG gating
  "assigned_at": "2026-05-26T14:31:00Z"           // required
}
```

```jsonc
// guild.approval_request.v1 — cross-host always-ask escalation (CH-4)
{
  "schema_version": "guild.approval_request.v1", // self-versioned; lenient-reader
  "task_id": "security-auth-001",                 // required
  "specialist": "security",                       // required; requesting pane
  "host_kind": "codex",                           // required; requesting host
  "operation": "Bash: rm -rf build/",             // required; the always-ask op (NO secrets — security ADR)
  "reason": "destructive op in always-ask hard set", // required
  "requested_at": "2026-05-26T14:42:00Z"          // required
  // ack written to approvals/<specialist>-ack.json: { task_id, decision: "approve|deny", acked_at }
}
```

## New config keys (closed-key `settings.json`, existing reject regime)

All land under the closed-key regime
([`config-surface-settings-json.md`](config-surface-settings-json.md)); unknown
keys rejected at intake, documented in `_help`, scaffolded by `/guild config
init`. Defaults preserve current single-host behavior.

| Key | Allowed values | Default | Meaning |
|---|---|---|---|
| `defaults.capability_manifest_ttl_s` | int > 0 | `3600` | Manifest staleness TTL (CR-5). |
| `defaults.cross_host.enabled` | bool | `false` | Master toggle for mixed-host routing/teams (off ⇒ Claude-only behavior, byte-identical to today). |
| `defaults.cross_host.fallback_to_claude` | bool | `true` | Enable the level-4 Claude-only fallback (CR-3). |

(Per-specialist `host:` in `team.yaml` selects the host; the routing function
CR-1 resolves the model. Precedence mirrors the established ladder: explicit
config/override → manifest → built-in default.)

## Composition with existing decisions (bound by pointer — not replaced)

- **ADR-RE-4 / ADR-RE-5** ([`v2-runtime-and-execution-model.md`](v2-runtime-and-execution-model.md)):
  the `TeamBackend` seam and the `guild.host_capability.v1` carrier. This ADR is
  the **policy + launcher layer above them** — CR-1 reads the manifest; CH-1/CH-2
  extend `TmuxTeamBackend`; `RemoteTeamBackend` (the named cross-host backend)
  consumes CR-1's routing decision. **Both RE-4 and RE-5 are hard blockers.**
- **Cost-aware tiering + `guild.handoff.v2`** ([`cost-aware-tiering-and-lean-context.md`](cost-aware-tiering-and-lean-context.md)):
  the auto-scorer (§2) produces the tier CR-1 consumes; `tier_models` fills the
  `null` host slots (§1); specialist returns remain `guild.handoff.v2` envelopes
  flowing to a lean lead (§5) — `tasks/`/`approvals/` artifacts **never enter
  lean-lead context**, the §4 compaction discipline stands.
- **D5 `agent_mode` ladder** ([`v2x-command-surface-dispatch-and-internalization.md`](v2x-command-surface-dispatch-and-internalization.md)):
  picks the *mode*; CR-1 adds *host* as the orthogonal third axis (mode × tier ×
  host). `TmuxTeamBackend` preserves one-team-per-session, collision-refuse, and
  the env gate verbatim for Claude panes.
- **CR-D** ([`guild-boundary-config-and-tracking.md`](guild-boundary-config-and-tracking.md)):
  all new paths sit under `.guild/runs/<run-id>/`; atomic-write + `.lock` rules
  are reused, not reinvented; `tasks/`/`approvals/` are rebuildable operational
  artifacts.

## Cross-topic dependencies

- **Runtime (RE-4/RE-5) — hard blockers.** No part of Cluster A or B can be
  implemented until the `TeamBackend` interface is extracted and a host writes
  `guild.host_capability.v1`. Stated again here because it is the gate.
- **Security (T5) — hand-offs, not decided here.** Manifest authentication /
  anti-spoof of `host_kind`; cross-host tool-permission **intersection** (CR-2
  pre-checks advertisement; security enforces trust — *intersection, never
  union*); autonomy + always-ask propagation across hosts (CH-4 defines the UX,
  security the trust); **no secrets** in `tasks/` or `approvals/*.json`. Bound to
  [`v2-security-and-untrusted-content.md`](v2-security-and-untrusted-content.md).
- **Observability (existing).** All artifact-bus paths sit under
  `.guild/runs/<run-id>/`; `capture-telemetry.ts` indexes them with no new
  top-level path; `host_kind` in `session.json` (CH-5) lets `guild-telemetry`
  correlate events by CLI brand for mixed-team diagnostics
  ([`v2-observability-and-replay.md`](v2-observability-and-replay.md)).

## Validation criteria

- **VC-CR-1 (routing):** with ≥2 host manifests present, CR-1 routes a task to a
  host whose `supported_tiers` / `tool_permissions` / `supported_backends`
  satisfy it; the resolved model comes from the merge precedence; the decision is
  logged to `run-state.lanes[id].routing_decision`. The function returns in
  < 5 ms with no network call.
- **VC-CR-2 (null-slot fill):** a `codex` manifest with `tier_models` resolves a
  concrete model for a `mid` task that the built-in map leaves `null`; an
  explicit `settings.json` override beats the manifest.
- **VC-CR-3 (fallback):** a stale/absent manifest or `codex --version` failure
  triggers the ranked fallback; tier is **never** downgraded without an
  escalation signal.
- **VC-CR-5 (freshness):** a manifest older than `capability_manifest_ttl_s` is
  excluded from CR-1 step 1; `guild doctor` re-probe re-writes it and re-admits
  the host.
- **VC-CH-1/2 (mixed launcher):** a `team.yaml` with one `claude-local` and one
  `codex-local` specialist spawns each pane via its resolved adapter; the Codex
  pane runs `codex exec` with `OPENAI_API_KEY` set and **without** the Claude env
  gate.
- **VC-CH-3 (artifact bus):** the Codex pane reads `tasks/<name>.json`, writes a
  heartbeat + handoff, and emits no cross-host agent-team event; the orchestrator
  reconstructs progress from FS artifacts only.
- **VC-CH-4 (approval UX):** a Codex pane hitting the always-ask hard set writes
  `approvals/<name>.json` and pauses; the orchestrator surfaces it, writes
  `-ack.json`, and the pane unblocks — no secrets appear in either file.
- **VC-CH-5 (manifest):** `session.json` records `host_kind` + `adapter_version`
  per pane; an old reader ignoring the new fields still parses it (lenient
  reader).
- **VC-CH-6 (preflight):** a team with a missing `codex` binary or unset
  `OPENAI_API_KEY` aborts before any pane opens, naming the failing specialist +
  host + dependency.

## Open items / open questions

- **OQ-CR-1 (budget cap → v2.1):** cross-host per-run cost-cap enforcement is
  deferred (CR-6); only the telemetry spend-stub ships in v2.0. Tracked as
  `oc-budget-cap`.
- **OQ-CR-2 (probe stubs for CI):** capability probes for Codex cloud
  (`cloud_tasks: maybe`) and Gemini cannot run reliably from CLI today; adapters
  may need a mock/stub mode for CI (`capability-routing §8`).
- **OQ-CH-2 (schema scope of new siblings):** do `guild.task_assignment.v1` and
  `guild.approval_request.v1` warrant formal `schema_version` siblings, or stay
  unversioned operational artifacts like the heartbeat (runtime-ADR OQ-4)?
  Recommendation: version them — they cross the host boundary and a Codex pane
  must parse them, so a stable contract is worth more here than for the
  same-host heartbeat. Lead/security to confirm.
- **OQ-CH-3 (lead — contract + ownership registration):** if approved, register
  the two siblings in `contract-map.md §B-post` + the `target-architecture.md`
  sibling registry, and add CR-D ownership rows for `runs/<run-id>/tasks/`,
  `runs/<run-id>/approvals/`, and the `guild.tmux_team.v1` `host_kind` extension.
  Out of this ADR's scope.
- **OQ-SEC (security ADR — T5):** manifest auth/anti-spoof, cross-host
  tool-permission intersection, always-ask/autonomy propagation, no-secrets
  enforcement on `tasks/` + `approvals/`. CR-2/CH-4 define carriers + UX; security
  owns the trust model.
- **OQ-T3 (run-manifest cross-host consistency):** how `run-manifest.json`
  (ADR-RE-6) stays consistent across hosts (shared FS vs sync protocol) remains
  T3 scope, inherited from runtime-ADR OQ-5 — not resolved here.

## Consequences

- The `null` codex/gemini tier slots become **operational** via CR-1's merge
  precedence — the cost ADR's "config + adapter, not a redesign" seam is realized
  without changing any frozen surface.
- Cross-host teams run on **tmux as a neutral supervisor** with per-host adapters;
  adding Gemini is one adapter file (CH-2), not a launcher rewrite.
- Coordination is **file-based only** — no cross-host event bus, no daemon, no
  external service; the zero-infra plugin model holds.
- Routing is **deterministic, cheap, and logged**; fallback is ranked with **no
  silent tier downgrade**; preflight is **fail-fast** (zero partial-spawn).
- Two proposed additive siblings + one additive optional key + three config keys;
  **no frozen contract changes, no count changes**; `cross_host.enabled: false`
  default keeps single-host behavior byte-identical to today.
- The decision set is **design-blocked on RE-4 + RE-5** and **hands trust to the
  security ADR** — both stated as binding gates, not hidden assumptions.

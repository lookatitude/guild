---
type: decision
owner: architect
confidence: high
importance: high
source_refs:
  - .guild/wiki/research/cross-host-review-broker.md          # D-BR-1..6
  - .guild/wiki/research/artifact-bus.md                      # AB-1..6
  - plugin/.guild/wiki/decisions/v2-runtime-and-execution-model.md   # ADR-RE-5 host_capability.v1; RE-1/RE-6 run-state/run-manifest
  - plugin/.guild/wiki/decisions/cost-aware-tiering-and-lean-context.md  # guild.handoff.v2 §5
  - plugin/.guild/wiki/decisions/v2-security-and-untrusted-content.md    # packet egress / cross-host trust
  - plugin/.guild/wiki/entities/cross-host-review-and-loop-control.md  # FROZEN review_packet.v1 / review_result.v1 + D-16
created_at: 2026-05-26
updated_at: 2026-05-26
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related:
  - artifact-bus
  - cross-host-review-broker
  - v2-runtime-and-execution-model
  - cost-aware-tiering-and-lean-context
  - v2-security-and-untrusted-content
  - v2-observability-and-replay
  - guild-boundary-config-and-tracking
  - adversarial-review
topic: review-broker-and-artifact-bus
program: T3 (v2.0 full-scope)
---

# ADR: v2 cross-host coordination — the filesystem artifact bus & the review broker (consolidated AB + BR)

## Status

**Accepted (operator-ratified 2026-05-26; v2.0-full-scope program).**

Consolidates the two Track-3 briefs
[`artifact-bus.md`](../../../../.guild/wiki/research/artifact-bus.md) (AB-1..6) and
[`cross-host-review-broker.md`](../../../../.guild/wiki/research/cross-host-review-broker.md)
(D-BR-1..6) into ONE decision set. They are filed as one ADR because they
describe **two layers of a single coordination substrate**: how agents —
possibly cross-host — *publish and consume* artifacts (the bus), and how
cross-host *adversarial review* is dispatched over that same substrate (the
broker). Resolving them apart would split the cross-host transport story
across two documents and risk the two layers contradicting each other on the
v2.0 transport posture (they nearly did — see §"Reconciliation: one transport
story"). This ADR LISTS new schemas in §"New contracts"; contract-map
registration is consolidated by the lead afterward.

## Context

Guild agents coordinate today entirely through the filesystem: ephemeral
§task§agents emit `guild.handoff.v2` in-flight envelopes, durable
`guild.handoff_receipt.v1` receipts land under `.guild/runs/<run-id>/handoffs/`,
and the v2 runtime ADR ratified `guild.run_state.v1` / `guild.run_manifest.v1` /
`guild.host_capability.v1` as the DAG/program/host substrate. Cross-host
adversarial review rides the FROZEN `guild.review_packet.v1` /
`guild.review_result.v1` schemas and the D-16 broker policy.

Two gaps remain before Track 3 (cross-host execution) can ship:

1. **No structured publish/consume.** Downstream agents are hand-pointed to
   artifact paths by the orchestrator; there is no topic-addressed discovery,
   no content-addressed dedup, and the only event log (`events.jsonl`) is
   telemetry, not a pub/sub carrier (`artifact-bus.md §3`, G-A/G-E).
2. **No bidirectional review dispatch.** `guild:codex-review` is a one-way,
   prose-sentinel, Claude-origin→Codex adapter; the D-16 policy
   (capability-routed, checksum-bound, structured-envelope, bidirectional) lives
   in documentation but not in a skill (`cross-host-review-broker.md §3`,
   G-1..G-6).

**Frozen contracts are bound by pointer, never re-spelled** (lenient-reader
rule, `di1-di6-contracts.md §"Lenient-reader rule (shared invariant #12)"`;
contract index `implementation/contract-map.md`). New data is an additive
optional key or a registered self-versioned sibling — never a frozen-field
change. The **zero-infra / no-new-server constraint (DH-3 / G3)** is hard: the
bus is a directory layout + an append-only log + atomic-rename; the broker is a
skill. **Neither introduces a daemon, a socket, or an HTTP server in v2.0.**

### Resolving the word "broker" (why the two briefs do not conflict)

The two briefs use "broker" in opposite senses; the apparent contradiction is
nominal, not substantive:

- The **artifact bus** is explicitly *broker-free* in the **message-daemon**
  sense (`artifact-bus.md §1.1`/§4): the blackboard's control shell is the
  orchestrator + the `TaskCompleted` hook, not a separate process.
- The **review broker** (`cross-host-review-broker.md` D-BR-1) is a *logical
  policy/dispatch skill* (`guild:review-broker`), not a process. It selects a
  reviewer host and owns the gate-pass rule.

They **compose**: review packets and results ARE artifacts published on the
bus; the review broker is a specialized publisher/consumer of the
`review/*` topic. One substrate, two layers, zero servers.

### Traceability — source decisions → consolidated decisions

| Consolidated | Source | Note |
|---|---|---|
| **D-COORD-0** | new (umbrella) | filesystem blackboard is the one substrate; "review-broker" = skill, "bus no-broker" = no daemon; the two layers compose |
| **D-BUS-1** | AB-1 + AB-6 | `bus/log.jsonl` pub log + `<type>/<scope>/<resource>` topic namespace (publish = append) |
| **D-BUS-2** | AB-2 | subscriber registry + `TaskCompleted` topic fan-out |
| **D-BUS-3** | AB-3 | CAS index; SHA-256 = address + integrity + cross-host cache key |
| **D-BUS-4** | AB-5 | partial NDJSON streaming, atomically promoted on close |
| **D-XHOST** | AB-4 **+ D-BR-2** | **merge** — ONE cross-host transport posture: filesystem-canonical v2.0; HTTP/MCP remote pull is a deferred `[post-v2]` seam |
| **D-BR-A** | D-BR-1 | `guild:review-broker` skill = the missing D-16 abstraction; `guild:codex-review` demoted to internal adapter |
| **D-BR-B** | D-BR-3 | RE-5 bootstrap = the broker's capability probe (minimal `host_capability.v1` write) |
| **D-BR-C** | D-BR-4 | Claude-reviewer adapter via `Agent({ subagent_type: "claude", isolation: "worktree" })` |
| **D-BR-D** | D-BR-5 | structured `review_result.v1` YAML primary; prose `## SATISFIED` legacy fallback (Codex only) |
| **D-BR-E** | D-BR-6 | cloud-reviewer consent = hard always-ask packet-egress checkpoint; local review exempt + cost estimate |

## Decision

### D-COORD-0 — One filesystem blackboard; two composing layers; zero servers

The coordination substrate is the `.guild/` filesystem (blackboard topology,
`artifact-bus.md §1.1`). The **artifact bus** is the publish/consume layer; the
**review broker** is a policy consumer that rides it. Both obey CR-D atomic-write
+ `.guild/.lock` discipline
([`guild-boundary-config-and-tracking.md`](../../../../.guild/wiki/decisions/guild-boundary-config-and-tracking.md))
and add **no daemon, socket, or HTTP server** (DH-3 / G3). All new paths sit
under `.guild/runs/<run-id>/bus/` (local, gitignored, derived/rebuildable from
receipts + the existing review trail).

### Group 1 — The artifact bus (publish / consume substrate)

#### D-BUS-1 (← AB-1, AB-6) — `bus/log.jsonl` is the canonical pub mechanism; topic = `<type>/<scope>/<resource>`

Publish = append one NDJSON entry to `.guild/runs/<run-id>/bus/log.jsonl`. This
log is **distinct from `events.jsonl`** telemetry (resolves G-E): different
schema, different owner, different reader. Telemetry consumers read
`events.jsonl` (the relocated `guild.trace_event.v2` writer); artifact
subscribers read `bus/log.jsonl`. The bus appender MAY emit one `bus.event` span
into telemetry for tracing, but the two logs never merge. Topics follow the
A2A-shaped `<type>/<scope>/<resource>` triple
(`handoff/backend/T2`, `status/qa/T3`, `context/architect/T1`,
`review/G-plan/pkt-7`); types are `handoff | status | context | review |
approval | heartbeat`. All specialist agents and the orchestrator are
publishers; only the orchestrator and hooks are **push** subscribers.

#### D-BUS-2 (← AB-2) — subscriber registry + `TaskCompleted` topic fan-out

The orchestrator registers downstream consumers at run start under
`bus/subscribers/<subscriber-id>.yaml` (topic globs + a `callback: hook | poll |
webhook-url`). After each bus-log append, the **`TaskCompleted` hook** scans the
registry, filters by topic glob, and fires the callback. `callback: poll` lets a
subscriber tail the log itself (no push). `callback: webhook-url` is the
cross-host push path — **deferred to the D-XHOST remote seam**, not active in
v2.0.

#### D-BUS-3 (← AB-3) — CAS artifact index; SHA-256 is address + integrity + cache key

Every published artifact is content-addressed at
`bus/cas/<sha256[0:2]>/<sha256>.meta.yaml` (idempotent write — skip if present).
The SHA-256 is simultaneously the **content address**, the **tamper-detection
token** (readers verify before consuming), and the **cross-host cache key** (a
host that already holds the hash skips the transfer). CAS dedup: two lanes
emitting an identical context bundle write one CAS entry referenced by two bus
entries. Garbage-collection (ref-count at run close) is deferred to
implementation.

#### D-BUS-4 (← AB-5) — partial streaming, atomically promoted on close

Large artifacts (context bundles, review trails) may stream: writer appends
NDJSON chunks to `bus/partial/<artifact-id>.jsonl`, emits an `artifact.streaming`
bus entry per chunk (with byte offset), and on close atomically renames to the
final path, computes the full-file SHA-256, and emits `artifact.closed`.
Downstream agents may read partial offsets without waiting for the full artifact
(the A2A `TaskArtifactUpdateEvent` pattern). Streaming **complements** — never
replaces — the atomic-write discipline for small/complete artifacts.

#### D-XHOST (← AB-4 + D-BR-2) — ONE cross-host transport posture

**v2.0 is filesystem-canonical, full stop.** In v2.0 all participating hosts
(Claude + Codex) are **co-located** — they share one `.guild/` tree — so the bus
log, CAS, and review packets/results are exchanged on the shared filesystem with
**no transport at all**. For genuinely remote (separate-machine) hosts, the
defined-but-deferred seam is HTTP pull against an `artifact_endpoint` advertised
in `guild.host_capability.v1` (remote host checks local CAS by SHA-256 → cache
miss → `GET artifact_endpoint?sha256=<hash>` → verify hash → write to local CAS
→ append a local `bus/log.jsonl` entry). This seam is **`[post-v2]`,
contract-only**: the two additive fields are defined now (see §"New contracts"),
null/unused in v2.0. MCP is an alternative future carrier for the same seam.
**This section defines the *carrier*, not the *trust*** — see §"Reconciliation".

### Group 2 — The review broker (cross-host adversarial review over the bus)

#### D-BR-A (← D-BR-1) — `guild:review-broker` is the new abstraction; `guild:codex-review` becomes an internal adapter

Author a new skill `guild:review-broker` implementing the D-16 policy
([`cross-host-review-and-loop-control.md`](../entities/cross-host-review-and-loop-control.md)):
policy gate → capability probe → reviewer selection (creator_host ≠
reviewer_host ⇒ STRONG; same-host ⇒ WEAK, stamped) → `review_packet.v1` build +
redaction → adapter dispatch → `review_result.v1` parse → checksum-bound
gate-pass → cap/escalation → trail + telemetry. All lifecycle gates invoke
`guild:review-broker`, never `guild:codex-review` directly; `guild:codex-review`
is **demoted to an internal Codex adapter**. Backward-compatible: runs without
the broker skill fall back to the legacy `guild:codex-review` path (Claude-origin
only). Review packets/results are published as `review/<gate>/<pkt-id>` bus
artifacts (D-BUS-1) and CAS-indexed (D-BUS-3) — **no frozen-field change**.

#### D-BR-B (← D-BR-3) — RE-5 bootstrap is the broker's capability probe

The broker's reviewer-selection step is the **minimum
`guild.host_capability.v1` implementation** for v2.0. At session start the broker
(or `guild:init`) probes `codex --version` and Claude subagent availability and
writes `.guild/hosts/<host-id>/capability.json` for each. The broker reads all
manifests, builds a routing table keyed by `host_kind`, and never re-probes
mid-run (session-scoped cache). Full RE-5 (`tier_models` fill,
`RemoteTeamBackend` routing) remains a separate Track-3 deliverable; this probe
is the minimal slice that unblocks review. Bound by pointer to ADR-RE-5 — the
schema is NOT re-spelled here.

#### D-BR-C (← D-BR-4) — Claude-reviewer adapter via `Agent({ subagent_type: "claude" })`

When Codex is the creator, the Claude reviewer dispatches via
`Agent({ subagent_type: "claude", isolation: "worktree", ... })` — the existing
Guild dispatch primitive, no CLI invocation, no MCP call. The `worktree`
isolation gives read-only artifact access without ambient project context
(independence requirement). The prompt instructs the reviewer to return a fenced
`review_result.v1` YAML block and nothing else.

#### D-BR-D (← D-BR-5) — structured `review_result.v1` primary; prose sentinel is legacy fallback

Both adapters are prompted to return `review_result.v1` YAML — the authoritative
output (eliminates sentinel-injection from artifact content, enables checksum
binding + machine-readable independence stamping). Prose `## SATISFIED` detection
survives **only as a Codex-adapter fallback** for backward compat; the Claude
adapter has **no** prose fallback (non-YAML ⇒ `status: malformed`, one
schema-repair retry, then sentinel-hardening per the frozen doc).

#### D-BR-E (← D-BR-6) — cloud-reviewer consent is a hard always-ask packet-egress checkpoint; local review exempt

Any dispatch to a cloud reviewer (`codex-cloud`, future `gemini-cloud`) is a
**blocking always-ask consent checkpoint that fires regardless of
`--auto-approve`** — it exports `.guild/` artifacts past the filesystem boundary
(destructive/network-class). The prompt names gate, artifact path, and host;
absent consent the broker degrades to the local/weak path and records the
downgrade. This realizes — does not change — the frozen
`cross-host-review-and-loop-control.md` rule ("building the off-box review packet
for a cloud reviewer is itself a packet-egress always-ask checkpoint"). **Local**
cross-host review (both hosts local) is NOT a consent gate but emits a
`review_cost_estimate` informational event before dispatch (G-5 cost visibility).

## Reconciliation: one transport story, and the security hand-off

**The transport tension is resolved by D-XHOST.** AB-4 (HTTP pull) and D-BR-2
("filesystem only; MCP is future") superficially conflict. They are unified:
**v2.0 = filesystem-canonical for both bus artifacts and review packets** (hosts
co-located, shared `.guild/`); the HTTP `artifact_endpoint` (AB-4) and MCP
(D-BR-2's future path) are the **same** `[post-v2]` remote-host seam, additive
and unused in v2.0. There is exactly one cross-host carrier decision, not two.

**Security / trust is delegated, not decided here — bound by pointer to
[`v2-security-and-untrusted-content.md`](v2-security-and-untrusted-content.md)
and ADR-RE-5's security hand-off.** This ADR defines the carrier; the security
ADR owns the trust. The following are explicitly delegated and flagged as
cross-checks for the security lane (none decided here):

- **Packet/artifact egress scrubbing.** D-SECRETS runs a fail-closed scrubber
  over durable `.guild/` writes (handoff, provenance, wiki, review). **Cross-check
  to flag:** that enumeration must be confirmed to cover the **new bus surfaces**
  — `bus/log.jsonl`, `bus/cas/**`, `bus/partial/**`, and any review packet built
  for egress — and the CAS SHA-256 must be computed **after** scrubbing (the
  content address is of the scrubbed bytes). Today's security ADR does not name
  `bus/` explicitly.
- **`artifact_endpoint` / `artifact_auth` trust.** No secrets in the endpoint URL
  (RE-5 no-secrets + `artifact-bus.md §4.6/§7`); the `artifact_auth` scheme,
  signing, and anti-spoof are the security ADR's, exactly as ADR-RE-5 delegates
  `capability.json` auth.
- **Cross-host tool-permission INTERSECTION + capability scope.** A remote
  artifact pull is a network op; the cross-host task receives the **intersection**
  of both hosts' permitted tools (ADR-RE-5 delegation), and a cheap-tier agent
  performing egress is high-blast-radius → escalates per D-CAP's cost-tier
  interaction. **Flag for security cross-check.**
- **Webhook push (D-BUS-2 `callback: webhook-url`)** is part of the deferred
  remote seam; its auth is the same security delegation and it is inert in v2.0.

No contradiction with the security ADR is introduced; three additive
cross-checks are surfaced for the security lane (see §"Open questions").

## New contracts (listing only — lead registers in contract-map §B-post)

Three new self-versioned siblings + two additive-optional fields. All are
**post-v2 additive** (the `contract-map.md §B-post` pattern set by
`guild.workspace.v1` / `guild.handoff.v2` / `guild.security_event.v1`). They do
**not** change the locked frozen/sibling = §G-path counts or the §G mechanical
predicate. *(SC-12 context, 2026-05-30: the locked baseline was
**13-frozen / 12-sibling = 25-path** when this ADR was written; SC-12 promoted
`guild.run.v1` + `guild.harvest_candidates.v1` into the locked set, so the
current baseline is **13-frozen / 14-sibling = 27-path**. The three siblings in
this ADR are unaffected — still additive, still post-v2.)* **This ADR is the single canonical body for the three new
siblings**; skills/scripts bind them by pointer and never re-spell them. The lead
registers the contract-map rows + target-architecture sibling-registry rows +
CR-D ownership-map rows afterward — this ADR touches none of those files.

| # | Contract | schema_version | Status | Canonical body | `.guild/` path | Realizing / consuming |
|---|---|---|---|---|---|---|
| 1 | BusEvent | `guild.bus_event.v1` | `[v2]` shipped | this ADR §D-BUS-1 (below) | `.guild/runs/<run-id>/bus/log.jsonl` (NDJSON) | specialist agents + orchestrator (publishers); `TaskCompleted` hook + poll subscribers (readers) |
| 2 | CasMeta | `guild.cas_meta.v1` | `[v2]` shipped | this ADR §D-BUS-3 (below) | `.guild/runs/<run-id>/bus/cas/<sha256[0:2]>/<sha256>.meta.yaml` | publishers (idempotent write); integrity verify + cross-host cache (readers) |
| 3 | BusSubscriber | `guild.bus_subscriber.v1` | `[v2]` shipped | this ADR §D-BUS-2 (below) | `.guild/runs/<run-id>/bus/subscribers/<subscriber-id>.yaml` | orchestrator (writer); `TaskCompleted` hook (reader/fan-out) |

**Canonical bodies (frozen here for registration):**

```jsonc
// guild.bus_event.v1 — one NDJSON line in bus/log.jsonl (D-BUS-1, D-BUS-4)
{
  "schema_version": "guild.bus_event.v1",   // self-versioned; lenient-reader
  "seq": 42,                                  // monotonic, per-run, writer-stamped
  "topic": "handoff/backend/T2",              // <type>/<scope>/<resource>
  "event": "artifact.published",              // published | streaming | closed | retracted
  "artifact_id": "handoff:backend:T2:run-...",
  "sha256": "abc123...",                       // CAS key; null while streaming
  "path": ".guild/runs/<run-id>/handoffs/backend-T2.md",
  "byte_offset": null,                         // set on artifact.streaming chunks
  "publisher": { "host_id": "claude-local", "role": "backend" },
  "ts": "2026-05-26T12:00:00Z"
}
```

```yaml
# guild.cas_meta.v1 — content-addressed artifact header (D-BUS-3)
schema_version: guild.cas_meta.v1
sha256: "abc123..."          # == file name; content address + integrity token
type: handoff                # handoff | status | context | review | approval | heartbeat
topic: handoff/backend/T2
run_id: run-20260526-1431
writer: { host_id: claude-local, role: backend }
path: ".guild/runs/<run-id>/handoffs/backend-T2.md"
created_at: "2026-05-26T12:00:00Z"
ref_count: 1                 # GC hint (deferred to implementation)
```

```yaml
# guild.bus_subscriber.v1 — subscription registration (D-BUS-2)
schema_version: guild.bus_subscriber.v1
subscriber_id: orchestrator-T3-gate
host_id: claude-local
topics: ["handoff/backend/*", "handoff/qa/*"]
callback: hook               # hook | poll | webhook-url ([post-v2] remote only)
created_at: "2026-05-26T12:00:00Z"
```

**Additive changes that are NOT new contracts** (no `schema_version` bump;
lenient-reader rule — listed so the lead has the full registration picture):

- `guild.host_capability.v1` gains two **additive-optional** fields —
  `artifact_endpoint` (string URL | null) and `artifact_auth` (string scheme
  name) — for the D-XHOST `[post-v2]` remote seam. Bound by pointer to
  [`v2-runtime-and-execution-model.md §ADR-RE-5`](v2-runtime-and-execution-model.md);
  null/absent in v2.0 ⇒ byte-identical to current behavior. **No
  `schema_version` bump** (`artifact-bus.md §4.6` "lenient-reader-safe").

## Bound contracts (by pointer — not re-spelled)

| Contract | Canonical body pointer | Touched by |
|---|---|---|
| `guild.review_packet.v1` (FROZEN) | [`cross-host-review-and-loop-control.md §"ReviewPacket"`](../entities/cross-host-review-and-loop-control.md) | D-BR-A (published as `review/*` bus artifact; fields unchanged) |
| `guild.review_result.v1` (FROZEN) | [`cross-host-review-and-loop-control.md §"ReviewResult"`](../entities/cross-host-review-and-loop-control.md) | D-BR-A, D-BR-C, D-BR-D (parsed; fields unchanged) |
| `guild.host_capability.v1` | [`v2-runtime-and-execution-model.md §ADR-RE-5`](v2-runtime-and-execution-model.md) | D-BR-B (probe/bootstrap), D-XHOST (two additive-optional fields) |
| `guild.run_state.v1` | [`v2-runtime-and-execution-model.md §ADR-RE-1`](v2-runtime-and-execution-model.md) | orthogonal — DAG/lane checkpoint vs bus publication record (no overlap) |
| `guild.run_manifest.v1` | [`v2-runtime-and-execution-model.md §ADR-RE-6`](v2-runtime-and-execution-model.md) | multi-wave: per-wave `bus/log.jsonl`; program-level `bus_log_refs[]` for replay |
| `guild.handoff.v2` | [`cost-aware-tiering-and-lean-context.md §5`](cost-aware-tiering-and-lean-context.md) | unchanged — bus entry appended AFTER the envelope is emitted + receipt written |
| `guild.handoff_receipt.v1` (FROZEN) | `architecture/target-architecture.md §"Frozen-Contract Registry"` | unchanged — bus entry records receipt path + SHA-256; CAS indexes it |
| `guild.security_event.v1` | [`v2-security-and-untrusted-content.md §D-AUDIT`](v2-security-and-untrusted-content.md) | egress/consent decisions on the remote seam emit security events |
| `guild.trace_event.v2` / `events.jsonl` | [`v2-observability-and-replay.md`](../../../../.guild/wiki/decisions/v2-observability-and-replay.md) | distinct from `bus/log.jsonl`; optional `bus.event` span only |
| CR-D atomic-write + `.lock` | [`guild-boundary-config-and-tracking.md`](../../../../.guild/wiki/decisions/guild-boundary-config-and-tracking.md) | reused for CAS/subscriber writes; `bus/log.jsonl` `O_APPEND` ≤ PIPE_BUF, else temp-rename |

## Consequences

- **Cross-host coordination is filesystem-canonical and server-free.** A
  co-located Claude+Codex run needs no transport at all; remote hosts get one
  defined-but-deferred CAS-pull seam. DH-3 / G3 hold.
- **One transport decision, not two.** D-XHOST removes the AB-4 ↔ D-BR-2
  ambiguity; there is a single `[post-v2]` remote carrier.
- **Pub/sub without conflating telemetry.** `bus/log.jsonl` is a distinct
  append-only carrier; `events.jsonl` stays pure telemetry (G-E closed).
- **CAS gives dedup + integrity + cross-host cache from one SHA-256.** No
  separate checksum step; identical bundles stored once.
- **Bidirectional, structured, checksum-bound review ships** (G-1..G-6 closed)
  while `guild:codex-review` keeps working as a legacy fallback.
- **New surfaces for other lanes (flagged, not authored here):** `skill-author`
  (the `guild:review-broker` skill + Claude adapter); `tooling-engineer` /
  `hook-engineer` (the CAS writer, bus appender, `TaskCompleted` fan-out, the
  RE-5 probe, the `review_cost_estimate` / egress security events); the security
  lane (the three cross-checks above + `artifact_auth`); `eval-engineer`
  (`bus_event` ordering, CAS dedup, checksum-mismatch, malformed-envelope evals).
- **Counts unchanged.** Three post-v2 siblings + two additive-optional fields
  leave the locked frozen / sibling / §G path predicate untouched (baseline at
  authoring: 13-frozen / 12-sibling / 25-path; SC-12 later moved it to 13-frozen
  / 14-sibling / 27-path — see the SC-12 note above).

## Validation criteria

- **VC-BUS-1 (log separation):** every run produces a well-formed
  `bus/log.jsonl` (or an empty valid file) distinct from `events.jsonl`; no entry
  appears in both; topics parse as `<type>/<scope>/<resource>`.
- **VC-BUS-2 (CAS dedup + integrity):** two lanes emitting an identical bundle
  produce one `cas/**` entry referenced by two bus entries; a reader rejects a
  file whose SHA-256 ≠ the CAS key.
- **VC-BUS-3 (fan-out):** a subscriber registered for `handoff/backend/*` is
  fired by `TaskCompleted` on a `handoff/backend/T2` publish and NOT on
  `handoff/qa/T3`.
- **VC-BUS-4 (streaming):** a streamed artifact is readable at intermediate
  offsets and, on close, is atomically promoted with a matching `artifact.closed`
  SHA-256.
- **VC-XHOST-1 (v2.0 filesystem-only):** with both hosts local, a full
  cross-host review completes with **zero** HTTP/MCP calls; `artifact_endpoint`
  is null and unused.
- **VC-BR-1 (bidirectional STRONG):** a Codex-created artifact reviewed by Claude
  (D-BR-C) and a Claude-created artifact reviewed by Codex both stamp
  `independence: STRONG` and obey the frozen checksum-bound gate-pass.
- **VC-BR-2 (structured-first):** a non-YAML Claude review response is marked
  `status: malformed` (no prose fallback); a Codex prose `## SATISFIED` still
  parses via the legacy path.
- **VC-BR-3 (cloud consent):** a `codex-cloud` reviewer dispatch is hard-blocked
  on the always-ask checkpoint under `--auto-approve` and degrades to the local
  weak path on refusal, recording the downgrade; a local cross-host review emits
  exactly one `review_cost_estimate` event and no consent gate.
- **VC-SEC-XCHECK (delegated):** the security lane confirms the D-SECRETS scrubber
  covers `bus/`, `bus/cas/**`, `bus/partial/**`, and egress review packets, with
  CAS hashing after scrub. (Owned by the security ADR — listed here as the
  binding cross-check.)

## Open questions (for the lead + adjacent ADR owners)

1. **Contract-map registration (lead).** Register `guild.bus_event.v1`,
   `guild.cas_meta.v1`, `guild.bus_subscriber.v1` in `contract-map.md §B-post`;
   add the CR-D ownership-map rows for `.guild/runs/<run-id>/bus/**` and the
   target-architecture sibling-registry rows. Not touched by this ADR.
2. **Security ADR cross-check (security lane).** Confirm D-SECRETS scrubber
   coverage of the new `bus/` surfaces + the CAS-hash-after-scrub ordering, and
   own the `artifact_auth` scheme + cross-host tool-permission intersection for
   the `[post-v2]` remote seam (§"Reconciliation").
3. **Path-spelling discrepancy (flag).** `artifact-bus.md §2.1` shows
   `reviews/<gate-id>/packet.yaml` while the FROZEN
   `cross-host-review-and-loop-control.md` uses `review/packets/<pkt-id>.yaml`
   (singular `review/`, `pkt-id`-keyed). **The frozen path wins**; the bus brief's
   `reviews/` is informal. The lead should confirm no skill binds the informal
   spelling.
4. **`bus_event.seq` scope (implementation).** Per-run monotonic is assumed;
   multi-wave programs need either per-wave reset + wave-tagged logs (the
   `artifact-bus.md §7` rotation) or a program-global counter — defer to the bus
   implementation guide.
5. **SQLite migration trigger (deferred).** If `bus/log.jsonl` exceeds ~50k
   entries in a wave, migrate behind the same `bus/log` abstraction
   (`artifact-bus.md §7`) — no consumer API change; not a v2.0 concern.

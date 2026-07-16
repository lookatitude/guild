---
type: decision
owner: architect
confidence: high
importance: high
source_refs: [".guild/runs/v2-final/DECISIONS-LOCKED.md#L43-L52", ".guild/runs/v2-final/61-di-dossier-delta.md#L25-L295", ".guild/runs/v2-final/70-di-writeA-receipt.md#L53-L106"]
created_at: 2026-05-17
updated_at: 2026-05-17
expires_at: null
supersedes: "the dossier `[v2.x]` tags on DI-1/DI-2/DI-3/DI-5/DI-6 (`.guild/runs/v2-final/20-design-dossier.md` §4); the qaops-doc abbreviated `autonomy_contract` field list (superseded by the CR-1 canonical shape)"
sensitivity: internal
applies_to: [plugin]
related: [autonomy-locking-validity, target-architecture, command-clean-slate, quality-operations-asymmetry, lifecycle-overview, codex-openai-adapter, claude-code-adapter, data-model]
---

# ADR: DI-1 .. DI-6 contract promotions (deferred-items → v2)

## Status

Accepted (2026-05-17). Records the user-directed Deferred-items promotion
(`DECISIONS-LOCKED.md`, "Deferred-items promotion 2026-05-17 — supersedes the
G2 deferrals") and the Lead-Architect reconciliation
(`.guild/runs/v2-final/61-di-dossier-delta.md`). User decisions are LOCKED —
HOW-only debate, no WHETHER. No frozen schema field-name changes; every new
datum is either an additive optional key under the lenient-reader rule or a
self-versioned sibling artifact. **NEEDS-USER from the DI review: none** —
every OPEN-QUESTION was decidable within LOCKED + G5 + the qaops safety rails;
ESCALATE-1 is an internal-consistency decision ratified here, not escalated.

## Context

The user directed that ALL deferred `[v2.x]` items be addressed and shipped
implementation-ready (still ideation, no code). Six items (DI-1..DI-6) plus
two cross-ref-hygiene fixes (F-4, F-5) were promoted. The three step-60 DI
design docs (qaops / host / contracts) were reconciled into one conflict-free
delta (step 61) before this ADR. This page is the durable ADR-lite record of
the *contract decisions*; the canonical schema bodies live in
`architecture/target-architecture.md` (Cluster A, lands first) and are cited
here by pointer (shared invariant #4 — never re-spell frozen/sibling field
names).

## Decision

### DI-1 — per-lane `autonomy_contract` → `[v2]`

Additive optional key on frozen `guild.task_run.v1`; pure monotone-narrowing
AND-mask over the fixed 3-level enum (**Invariant AC-1**:
`allowed(O,L) == enum_allows(O) AND contract_allows(O,L) AND NOT hard_set(O)`).
Closed `op_class_allowlist` enum (`read_repo | write_assigned_scope |
run_nondestructive_shell | run_tests | git_local_readonly | git_local_commit |
package_read`) — a hard-set class in any allowlist is **rejected at
plan-validate** by one deterministic validator
(`⊆ closed-enum AND ∩ hard-set = ∅, else exit 2`), one rule two callers
(Development lane + Operations runbook). `write_scope` AND-masks
`task_run.permissions.write` (deny > allow; out-of-scope ⇒ always-ask, never a
silent block). `spend_ceiling.max_tokens` enforced (hard-stop);
`max_usd_advisory` **warns-only in v2** (logged + prompted at
`warn_at_fraction`, never hard-enforced — no pricing oracle, OQ-Cx2;
hard-`$` enforcement is `[v2.x]`). (Field renamed from `max_usd` on
2026-05-17; canonical shape lives in `target-architecture.md`.) `escalation.max_grants` default `2`; `0` =
no-mid-run-widening (hard-fail to a `/guild status` pause, surfaced never
silent, OQ-Cx5). Reset to the plan contract on re-dispatch (the plan is the
approved record; `[widen-lane]` grants are per-attempt audited run-state
deltas, never written back to the immutable plan, OQ-Cx6). `runbook_approved`
/ `approved_ref` are an **additive Operations-only extension**, not promoted
into the universal closed schema. **No `schema_version` bump**; independent
`contract_version: guild.autonomy_contract.v1` sibling marker. **No new
gate** — authored in `/guild plan`, approved at the existing G-plan gate,
collapsed-by-default rendering, mid-run escalation reuses the always-ask
channel.
*Status tag: `[v2]`. Canonical shape: `target-architecture.md`
§`autonomy_policy` (CR-1) — cited by pointer, see also
[autonomy-locking-validity](autonomy-locking-validity.md).*

### DI-2 — full Quality phase skill `guild:quality` → `[v2]`

Promoted from verify-done-extended / gap-report-only to a full skill:
auto-selects E2E / smoke / a11y / perf / integration from CodebaseMap + plan
signals; surfaced + overridable matrix (never silent); executes discovered
harnesses under the run sandbox + wall-clock budgets (the canonical
`defaults.quality.budget` block — `per_class_minutes` / `total_minutes` — is
defined once in [`../architecture/command-surface.md`](../entities/command-surface.md)
§4.4 and cited here by pointer, not re-spelled; OQ-3);
`qa-test-strategy` producer vs the composer-derived `G-quality` advisory panel (`security` baseline + `architect` gated on `multi_component`).
Frozen contract `guild.quality.v1`, path UNCHANGED
`.guild/runs/<run-id>/quality/<run-id>.md`. **Net new mandatory gates on the
default path = 0** (opt-in entry, never auto-entered); release/blocker gate
**I**, `G-quality` review **A**. **OQ-1 ratified:** under
`--auto-approve=all` a Quality **BLOCK→release override stays human-gated**
(release-risk family, same as the always-ask hard set); RELEASE-READY
recommendations ARE auto-passed **only under `--auto-approve=all`** — the
frozen `--auto-approve` token set is `[spec,plan,build,all]`; there is no
`qa`/`ops` token — a printed asymmetry, never a hidden mode.
*Status tag: `[v2]` (the prior `[v2.x]` banner is removed).*

### DI-3 — full Operations phase skill `guild:operations` → `[v2]`

Promoted from reserved-notice to a full skill: 5 runbook classes
(release / monitoring / incident / rollback / maintenance);
`devops-*` producer vs the composer-derived `G-operations` advisory panel (`security` baseline + `architect` gated on `multi_component`);
consumes Quality, feeds the D8 release leg. **Split autonomy posture under
FOUR non-negotiable safety rails (shared invariant #13):** (1) no class
autonomous for an unproven runbook; (2) first run of ANY runbook ALWAYS
interactive; (3) `incident`+`rollback` NEVER autonomous regardless of
approval; (4) the always-ask hard set is unconditional even inside an
`approved:true` runbook even under `--auto-approve=all`; plus a mandatory
pre-flight dry-run. `monitoring`+`maintenance` MAY be autonomous only after an
`approved:true`, unchanged, low-blast-radius runbook (the literal DI-3
mandate, OQ-2). Runbook-approval ledger =
`.guild/wiki/standards/runbooks/<name>.md` (durable, wiki-canonical, promoted
via `guild:decisions`, OQ-4), referenced by `autonomy_contract.approved_ref`.
Frozen contracts `guild.ops.v1` (path UNCHANGED
`.guild/runs/<run-id>/ops/<run-id>.md`), `guild.incident.v1`,
`guild.release.v1`. Runbook approval lowers the **soft** gate ONLY — never the
hard set. D8 close-gate contract stays frozen `[v2]`, automation `[v2.x]`
(unchanged).
*Status tag: `[v2]` (the prior reserved / `[v2-contract-only]` banner is
removed).*

**Ratified decision (2026-05-17) — wiki is the runbook-approval trust root
(G-2).** The product owner explicitly ratifies that runbook approval lives at
`.guild/wiki/standards/runbooks/<name>.md` and is promoted via
`guild:decisions`. Wiki integrity is therefore **deliberately load-bearing**
for autonomous monitoring/maintenance: a runbook is only autonomy-eligible
once it is `approved:true` in that wiki ledger, so the wiki — not run-scoped
state — is the durable trust anchor for autonomous production operations. This
is a conscious, bounded choice: it reuses the existing
`guild:decisions`-promotion trust path, and the blast radius of a bad approved
runbook stays bounded because the always-ask hard set still fires on **every**
destructive/network step inside an approved runbook (safety rail #4,
unconditional under `--auto-approve=all`). Option B (a dedicated
`.guild/runbooks/` tree outside the wiki) and option C (mandatory second-human
co-sign) were considered and **not** adopted.

### DI-4 — Codex execution: local `[v2]`, cloud `[v2-contract-only]`

**Local (`[v2]`):** `codex-local` realizes the frozen five-method
`host_adapter` symmetrically (probe / capabilities / dispatch / collect /
normalize_trace); originate + execute + review via frozen `guild.task_run.v1`;
STRONG cross-host independence for the reviewer; degrade-not-block when Codex
is absent. **Zero frozen-field change** — `dispatch_handle`, Codex session
ref, `pane_adapter_output` are adapter-internal returns already implied by the
frozen signatures; the originating host is **derived** (`trace_event.host` on
the first `state_transition`; `review_packet.creator_host` on the first gate)
— **no `originator_host` field is added**. The deterministic router rule does
NOT change.
**Cloud (`[v2-contract-only]`):** fully specified, UNBUILT in v2. Sibling
`guild.cloud_task_packet.v1` (references frozen ids by ref, never re-spells).
Redacted / minimized packet only (ignored `.guild/` excluded, secrets hashed,
untrusted content quarantined per research/20); per-run `consent.cloud_opt_in`
MUST be explicit human-approved; **never router-default** —
`codex-cloud.probe()` returns `available:true` only when `cloud_opt_in==true`,
so a `needs_pr:true` lane *degrades* (records degradation) rather than silently
going to cloud (CR-8). Building a `cloud_task_packet` is a
destructive/network-class action → the **packet-egress always-ask
checkpoint** fires regardless of `--auto-approve`. The cloud *contract* is
`[v2-contract-only]`; the cloud *build* is `[v2.x]`.

### DI-5 — mixed-host tmux teams → `[v2]`

Provider-neutral pane model: tmux-as-supervisor (a supervisor, **not** a
security boundary) + per-provider pane adapters; two symmetric configs
(Claude-orchestrator + Codex teammate panes, and vice-versa); the starting
host stays orchestrator; artifact-bus coordination (status / handoffs /
approvals / events on the canonical `.guild/` tree) — **never a shared chat**;
degrade-to-host-native-subagents on any tmux failure. Existing tmux preflight
reused verbatim, team-level, host-neutral (tmux present; `$TMUX` unset → refuse
nested). The backend is resolved once at run-start by `runStartPreflight` and
frozen in the resolved-settings snapshot; the tmux-enablement decision is the
per-run preflight prompt (`needsTmuxPrompt = tmux available && effective
agent_mode != "team"`), not a dispatch-time approval on every team launch. The
ONLY change:
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is scoped from a team-level
precondition to a **per-Claude-pane precondition**, asserted only when a
Claude pane participates (CR-7); a pure Codex+Codex team never sets it. Per-pane
provider preflight (binary on PATH before spawn). Sibling schemas
`guild.tmux_team.v1`, `guild.lane_status.v1`, `guild.approval_request.v1`
(own `schema_version`; reference frozen lane/task ids by ref). Preflight +
approval gates UNCHANGED; always-ask hard set + autonomy policy applied
per-pane via that pane's adapter.
*Status tag: **`[v2]`** — the dossier's `[v2.x]` for mixed-tmux is a
documented supersession (CR-5; `DECISIONS-LOCKED.md` DI-5 post-dossier
"supersedes the G2 deferrals"), not a LOCKED tension and not an `ESCALATE`.*

### DI-6 — optional SQLite read-through index → `[v2]`

`.guild/index.sqlite`: optional, fully-rebuildable, deletable read-through
cache for `/guild status` / `resume` / initiative status / telemetry rollups.
**Invariant DI6-1:** the filesystem stays CANONICAL — absence of the index
yields an identical filesystem-scan result; uncertain ⇒ filesystem-scan +
async re-index (correctness over speed, OQ-Cx3). **Invariant DI6-2
(verbatim):** *the plugin↔benchmark contract is and remains the canonical
`logs/v1.4-events.jsonl` (frozen `guild.trace_event.v1`); the benchmark
imports the JSONL, never the SQLite; the index is a plugin-local query
convenience explicitly outside the telemetry-split boundary; the plugin builds
and runs with the index absent and with the benchmark absent, independently.*
Lazy-built only past measured slowness (≥250 ms, the literal G3 trigger);
`index: auto` default (OQ-Cx4), `off` is a one-key opt-out; gitignored;
**no MCP, no embeddings** (G3 spirit retained). Sibling `guild.index.v1`
(`meta()` row marker; never frozen, never a contract). **No gate** — pure
read-through, never on the write path, never required. Every caller is wired
to `query()`, never to `index_read()` directly — there is no code path where
the index is required (the fallback contract is mechanical: config off /
absent / version-mismatch → scan; stale / uncertain → scan + async re-index;
else validated fast index read).
*Status tag: `[v2]`.*

### Cross-ref hygiene F-4 / F-5

- **F-4 (gate-name cross-ref):** the phase-level adversarial slot at the
  Operations boundary is named **`G-operations`** everywhere; `G-ops` is the
  stale token. Canonical broker gate set:
  **`G-spec, G-plan, G-lane, G-init, G-quality, G-operations`**. Applied in
  this cluster to the D-12 mermaid (see the diagram receipt); prose owners
  apply it to `lifecycle-overview.md` / `cross-host-review-and-loop-control.md`.
- **F-5 (stale frozen-v1 comment):** every doc comment implying
  `guild.task_run.v1` is strict / rejects unknown keys (or "v2 ships only the
  fixed 3-level policy, mini-schema deferred") is replaced by the §0
  lenient-reader rule + the DI-1 promotion. Recorded as an accepted
  HOW-resolution in [autonomy-locking-validity](autonomy-locking-validity.md)
  (this cluster's F-5 owner).

## Lenient-reader rule (shared invariant #12 — ESCALATE-1, ratified internal)

Every frozen `guild.*.v1` contract uses **lenient-ignore-unknown** reader
semantics: a `v1` reader MUST ignore keys it does not recognize and MUST NOT
reject an artifact for containing additive optional keys. Adding an additive,
optional, backward-compatible key to a frozen `guild.*.v1` contract therefore
**does NOT require a `schema_version` bump**; a bump is reserved for a breaking
change (renamed / removed / retyped field, or a changed required-field set).
This generalizes the already-ratified `guild.trace_event.v1` forward-compat
posture to all `guild.*.v1` contracts. **RATIFIED here as an
internal-consistency decision; NOT escalated to the user.** It is the
mechanism that makes the DI-1 additive `autonomy_contract` key legal with no
frozen-schema change.

## Status-tag rule (binding)

`[v2.x]` applies ONLY to the Codex-cloud *build* and explicitly-named future
extensions (hard-`$` spend-ceiling enforcement, content-hash staleness
watermark, replay). The Codex-cloud *contract* is `[v2-contract-only]`.
Everything in DI-1, DI-2, DI-3, DI-5, DI-6 (and DI-4-local) is `[v2]`. Writers
never upgrade/downgrade an assigned tag.

## Consequences

- The canonical `autonomy_contract` schema body + binding rules are stated
  **once** in `architecture/target-architecture.md` §`autonomy_policy`
  (Cluster A, lands first); `command-surface.md §5.2`, the Operations doc body
  in `lifecycle-overview.md`, and this ADR + `autonomy-locking-validity.md`
  cite it by pointer and never re-spell it.
- Six self-versioned sibling artifacts (`autonomy_contract.v1`, `index.v1`,
  `cloud_task_packet.v1`, `tmux_team.v1`, `lane_status.v1`,
  `approval_request.v1`) are registered in `target-architecture.md` Artifact
  Model; intentionally NOT frozen.
- Zero frozen-field change in DI-1..DI-6: one additive optional `task_run`
  key under the lenient-reader rule; six sibling schemas;
  `originator_host` derived, never added.
- Four diagrams carry the DI deltas (single owner, Cluster E): D-12
  (banners `[v2]` + `G-ops`→`G-operations`), D-17 (cloud opt-in / egress
  swimlane), new D-19 mixed-host tmux team, new
  `observability/diagrams/01-sqlite-read-through-index` query-fallback flow.

## Changelog

- 2026-05-17 — v2 — DI promotion (Cluster E): ADR-lite authored recording the
  DI-1..DI-6 promotions (6 sibling schemas; status tags `[v2]` vs cloud
  `[v2-contract-only]`; the §0 lenient-reader rule; the four non-negotiable
  Operations safety rails; SQLite filesystem-canonical Invariants
  DI6-1/DI6-2); `supersedes:` the dossier `[v2.x]` tags and the qaops-doc
  abbreviated `autonomy_contract` field list; registered in
  `decisions/README.md`. — supersedes: the dossier `[v2.x]` tags on
  DI-1/DI-2/DI-3/DI-5/DI-6; the qaops abbreviated `autonomy_contract` shape
- 2026-05-17 — v2 — DI adv-r1 fix (text/tokens/embeds): the DI-2 OQ-1 line
  now states RELEASE-READY recommendations are auto-passed ONLY under
  `--auto-approve=all` (the frozen token set is `[spec,plan,build,all]`; no
  `qa`/`ops` token) instead of the uninvokable "containing `qa`/`all`". No
  contract shape changed. `supersedes:` preserved.
- 2026-05-17 — v2 — final-audit gap closure (G-1/G-2/G-3 + data-model
  DB-label): G-2 — added the ratified-decision paragraph under DI-3 making
  the wiki (`.guild/wiki/standards/runbooks/<name>.md`) the explicitly
  ratified, deliberately load-bearing runbook-approval trust root (bounded by
  the unconditional always-ask hard set, safety rail #4). G-3 — updated the
  DI-1 `spend_ceiling` pointer text to the renamed `max_usd_advisory`
  (canonical shape stays in `target-architecture.md`; pointer-only update, no
  re-spelled schema). `supersedes:` preserved.

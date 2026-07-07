---
type: decision
owner: architect
confidence: high
importance: high
source_refs: [".guild/runs/v2-final/DECISIONS-LOCKED.md#L18", ".guild/runs/v2-final/50-final-audit.md#L71-L73", ".guild/runs/v2-final/50-final-audit.md#L85-L123", ".guild/runs/v2-final/20-design-dossier.md#L290-L326"]
created_at: 2026-05-17
updated_at: 2026-05-17
expires_at: null
supersedes: ".guild/runs/v2-final/50-final-audit.md#G-A ([v2.x] per-lane mini-schema deferral — promoted to [v2] by the 2026-05-17 DI-1 addendum below)"
sensitivity: internal
applies_to: [plugin]
related: [target-architecture, lifecycle-overview, phase-entrypoints, command-clean-slate]
---

# ADR: Autonomy semantics, concurrency lock, artifact validity (G-A / G-B / G-C)

## Status

Accepted (2026-05-17). Closes the three referenced-but-unspecified behaviors
flagged by the final independent seam audit
(`.guild/runs/v2-final/50-final-audit.md` F-1/F-2/F-3, gaps G-A/G-B/G-C). User
decisions are LOCKED — HOW-only debate. No frozen schema field name changes;
only added semantics.

## Context

The seam audit found the v2 design coherent and ship-ready but with three
behaviors needed for v2 scope that were not documented (nor documented as
v2.x deferrals): the *content/meaning* of the autonomy contract behind the
frozen `task_run.autonomy_policy` enum; the concurrency model for
filesystem-only `.guild/` persistence (G3); and the definition of an
"invalid" artifact for `/guild resume`.

## Decision

- **G-A — Fixed 3-level autonomy enum (option 2), mini-schema deferred.**
  `task_run.autonomy_policy` ships in v2 with **fixed built-in meaning per
  level**: `interactive` (G5 default — spec/team/plan each gated, no lane
  without a gate pass), `autonomous_after_plan_approval` (after plan approval,
  lanes run unattended within plan scope, no per-step prompts), `auto_approve`
  (opt-in via `--auto-approve`; soft phase gates auto-passed and printed). The
  **immutable always-ask hard set** — destructive ops, network access, spend —
  ALWAYS prompts regardless of level or `--auto-approve`. The richer per-lane
  `autonomy_contract` mini-schema (op-class allowlist + per-lane write scope +
  per-lane spend ceiling) is shipped **`[v2]`** as an additive optional key on
  frozen `guild.task_run.v1` (no `schema_version` bump — see the 2026-05-17
  DI-1 addendum below). Field name unchanged (frozen).
- **G-B — Advisory lock file (option 1), `[v2]`.** One advisory lock per repo
  `.guild/` at **`.guild/.lock`** holding `run-id` + `pid` + `started-at`,
  acquired at Session Intake / phase entry. A second concurrent `/guild`
  invocation surfaces "another run is active" with the standard
  resume / abort / force-takeover prompt (G5: surfaced, never silent — never a
  silent block, never a silent overwrite). Stale-lock detection (holder `pid`
  gone or `started-at` past an age threshold) offers force-takeover.
- **G-C — Validity definition + atomic writes (option 1), `[v2]`.** An
  artifact is **valid** iff (schema/frontmatter parses) AND (required
  frontmatter fields present) AND (where applicable, the `approved:` flag
  check passes); anything else is **invalid**. All `.guild/` artifact writes
  are **atomic**: write a temp file then `rename()` into place. `/guild
  resume` treats a present-but-invalid artifact as missing and rebuilds from
  the first invalid/missing step (existing resume-ladder behavior).

## [v2] vs [v2.x] split

> **Superseded for `autonomy_contract` by the 2026-05-17 DI-1 addendum below.**
> The per-lane mini-schema was promoted from `[v2.x]` (deferred) to `[v2]`
> (ships now). The split below is retained as the original audit record; read
> the addendum for the binding current state.

- `[v2]` (ships now): the fixed 3-level autonomy semantics + always-ask hard
  set; the `.guild/.lock` advisory-lock concurrency model; the validity
  definition + atomic temp-then-rename write rule; **and (per the DI-1
  addendum) the per-lane `autonomy_contract` mini-schema** as an additive
  optional key on frozen `guild.task_run.v1` (no `schema_version` bump).
- `[v2.x]` (designed, deferred): *no longer includes `autonomy_contract`.*
  Only explicitly-named future extensions remain `[v2.x]` (hard-`$` spend
  ceiling enforcement, content-hash staleness watermark, replay). Each adds
  granularity without changing the frozen `autonomy_policy` field.

## Consequences

- Canonical wording is stated **once** in
  `architecture/target-architecture.md` (autonomy 3-level semantics +
  Persistence discipline: atomic writes, validity, single-writer lock); the
  lifecycle/command docs cross-reference it. Same level names, same lock
  filename (`.guild/.lock`), same validity definition across all five docs.
- `command-surface.md` §5.2 carries the 3-level table at the plan-approval
  gate; §5.3 carries the "another run is active" prompt and the validity-keyed
  resume ladder. `lifecycle-overview.md` Resumption and
  `phase-entrypoints.md` upstream-resolution carry the lock + validity checks.
  `edge-cases.md` adds the Concurrency and Resumption failure rows.
- Filesystem-only persistence (G3) is unchanged; this only adds write
  discipline and a single-writer guard on top of it.

## Addendum — 2026-05-17 — DI-1 promotion + lenient-reader ratification (HOW-resolution, F-5)

**Status: Accepted (2026-05-17).** This addendum records two HOW-resolutions
that supersede the original `[v2.x]` posture for `autonomy_contract`. Both are
internal-consistency decisions ratified within LOCKED + G5 + the qaops safety
rails — **NOT escalated to the user** (no genuine product/scope/risk call
remained; see `.guild/runs/v2-final/61-di-dossier-delta.md` §0 and NEEDS-USER:
none).

1. **DI-1 promotion — per-lane `autonomy_contract` is `[v2]`.** Per the
   user-directed Deferred-items promotion (`DECISIONS-LOCKED.md`,
   "Deferred-items promotion 2026-05-17"), the richer `autonomy_contract`
   mini-schema (closed op-class allowlist + per-lane `write_scope` +
   `spend_ceiling` + `network_policy` + `escalation`) **ships in v2**, layered
   on top of the fixed 3-level enum. The 3-level enum stays the coarse
   default; the contract is the per-lane refinement and is a **pure
   monotone-narrowing AND-mask** (Invariant AC-1:
   `allowed(O,L) == enum_allows(O) AND contract_allows(O,L) AND NOT hard_set(O)`).
   It is an **additive optional key** on frozen `guild.task_run.v1` — **no
   `schema_version` bump** — carrying its own independent
   `contract_version: guild.autonomy_contract.v1` sibling marker. The
   always-ask hard set (destructive / network / spend) is unchanged and
   remains unconditional. No new gate: the contract is authored in
   `/guild plan` and approved at the existing G-plan gate. The canonical
   schema shape and binding rules are stated **once** in
   `architecture/target-architecture.md` §`autonomy_policy` (CR-1) and the
   companion ADR-lite [di1-di6-contracts](di1-di6-contracts.md); this ADR
   only records the `[v2.x]`→`[v2]` status transition for the audit trail.

2. **§0 lenient-reader rule — ratified (shared invariant #12).** Every frozen
   `guild.*.v1` contract uses **lenient-ignore-unknown** reader semantics: a
   `v1` reader MUST ignore keys it does not recognize and MUST NOT reject an
   artifact for containing additive optional keys. Adding an additive,
   optional, backward-compatible key to a frozen `guild.*.v1` contract
   therefore **does NOT require a `schema_version` bump**; a bump is reserved
   for a breaking change (renamed / removed / retyped field, or a changed
   required-field set). This generalizes the already-ratified
   `guild.trace_event.v1` forward-compat posture (`observability/data-model.md`)
   to all `guild.*.v1` contracts. This is the **F-5 HOW-resolution**: it
   replaces every stale doc comment implying `guild.task_run.v1` is strict /
   rejects unknown keys, and is what makes the DI-1 additive key legal without
   a frozen-schema change.

**Net effect on the [v2] vs [v2.x] split:** `autonomy_contract` moves to
`[v2]`. `[v2.x]` now scopes only the Codex-cloud *build* and explicitly-named
future extensions (hard-`$` ceiling enforcement, content-hash watermark,
replay). No frozen-field change anywhere in DI-1..DI-6.

## Changelog

- 2026-05-17 — v2 — DI promotion (Cluster E): moved `autonomy_contract`
  `[v2.x]`→`[v2]` in the G-A decision and the `[v2] vs [v2.x]` split; added
  the DI-1-promotion + §0 lenient-reader-rule ADR addendum (F-5
  HOW-resolution); set `supersedes:` to the prior `[v2.x]` mini-schema
  deferral. ADR-lite shape preserved. — supersedes: the prior `[v2.x]`
  per-lane mini-schema deferral (`50-final-audit.md` G-A)

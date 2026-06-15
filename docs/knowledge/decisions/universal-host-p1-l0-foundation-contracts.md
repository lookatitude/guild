---
type: adr-addendum
slug: universal-host-p1-l0-foundation-contracts
parent_adr: docs/knowledge/decisions/universal-host-plugin-architecture.md
initiative: universal-host-plugin-architecture
phase: P1 (steps 6–11)
lane: P1-L0 (FOUNDATION)
spec: .guild/spec/universal-host-p1.md
plan: .guild/plan/universal-host-p1.md
status: gated (G-spec round-2 SATISFIED; G-plan codex 3 rounds + operator-approved); ships the contracts every P1 lane consumes
created_at: 2026-06-15
owner: plugin-architect (self-build dev-team)
---

# ADR-addendum — Universal Host P1-L0 Foundation Contracts

This addendum records the **design-time contracts** P1-L0 ships under
`plugin/scripts/lib/` — the four models (registry / role / config / permission) plus
the four G-plan-carried contracts (C1–C4). It binds the parent ADR's §Capability
Matrix, §Host Role Model, §config reconcile, and §permissions to concrete, validated
TypeScript types + fixtures so every downstream lane (L6–L11, Lsec, Ltest) builds
against a frozen surface with **no further design questions**.

**Running-code discipline (the P1 headline):** every contract here is authored so a
downstream change is classifiable as *behavior-preserving* (zero-delta, A/B-proven)
or *deliberate* (golden/contract-tested, **default == today**, migration noted). L0
itself touches no running code — it adds types + one **additive, back-compatible**
schema field (C1).

## Modules shipped (design-time SoT)

| Module | Delivers | Consumed by |
|---|---|---|
| `host-registry-schema.ts` | `guild.host_registry.v1` — host identity + detection + the **three independent capability columns**; 5 rows | L7 (unify), L6 (renderers), L8, L11 |
| `role-model-schema.ts` | `guild.role_resolution.v1` — `host`/`advisory`/`adversarial` + `resolveRoles()` reference | L8 (resolver+wiring), Ltest SC-5 |
| `config-reconcile-contract.ts` | config-field schema + `check\|sync\|repair` + never-clobber predicate | L9 (impl), Lsec, Ltest SC-6 |
| `permission-policy-schema.ts` | `host_mode`×`guild_gates` + **orthogonality predicate** + 4 safety rails + C2 resolver | L10 (policy), Lsec, Ltest SC-7 |
| `adapter-fallback-ladders.ts` | C3 rung table + `resolveRung()` + degradation receipt | L11 (adapters), Ltest SC-8 |
| `routing-ab-contract.ts` | C4 `canonicalJSON()` + `deepEqualCanonical()` over the two surfaces | L7 A/B, Ltest SC-4 |
| `advisory-record.ts` (additive edit) | C1 `substrate` field | L8 (routing), Ltest SC-5 |
| `tests/universal-host/fixtures/permissions-baseline-golden.json` + `…orthogonality-violation.json` | C2 fixtures | Ltest SC-7 |

## (a) Registry schema + independent capability columns

The parent ADR's "routing uses booleans, not host names" is extended: the single
detect-only flag (`ProviderSpec.hasAdapter`, `provider-detect.ts:188/204`) is **split
into three independent columns**, because it conflated three orthogonal facts:

- `installability: native | target | none` — can a package be **installed**.
- `result_adapter: boolean` — does a cross-review / **result** adapter exist (↔ `hasAdapter`).
- `dispatch_selectable: boolean` — can a lane be **dispatched/selected** here.

Independence matters: a host can be dispatch-selectable without a result_adapter (a
lane runs there but there is no cross-review path back), and installable-as-`target`
without being either. The `guild.host_registry.v1` entry embeds the P0
`guild.host_capabilities.v1` row whole (no duplication). Five rows ship: `claude`
(verified, native/false/true), `codex` (target/true/true), and `.agents` / `pi` /
`antigravity` (all `target`, `result_adapter:false`, INFERRED — `provenance:"inferred"`),
matching today's reality that **only codex is a selectable cross reviewer**.

**Host-id namespace divergence (followup for L7).** The contract id namespace is
`claude | codex | .agents | pi | antigravity` (C1/C3 enum, honored verbatim incl. the
leading dot on `.agents`). The legacy `HostKind` union (`host-types.ts`) uses
`antigravity-2` and a 9-host surface set and has no `.agents` (a file package target,
not a HostKind). L7 owns mapping legacy `HostKind` ↔ registry `HostId` during the
behavior-preserving unification.

## (b) Role model

Three roles resolve from the matrix, never the host name:
`host` = strongest installable + dispatch_selectable; `advisory` = strongest
dispatch_selectable (defaults to the host substrate = today's local advisor);
`adversarial` = strongest `result_adapter` substrate of a **different family** ⇒
`strong`, same-family ⇒ `weak` (the existing `independence` signal,
`host-router.ts:200`). **Default Claude+Codex ⇒ host=claude, advisory=claude(strong),
adversarial=codex(strong) — byte-identical to today.** L8 wires the resolver into
preflight + execute-plan + review-broker; this module is the contract it must match.

## (c) Config schema + reconcile contract

A typed field registry (key/type/default/scope/`security_sensitive`) is the SoT.
Three modes: `check` (report only), `sync` (fill missing → default), `repair` (also
coerce malformed → default). The **never-clobber invariant** is a single predicate,
`mayReconcileWrite(current)`: a field with provenance `"user"` is **never** rewritten
by any mode for any key — security keys included (Lsec depends on this). `config init`
becomes `reconcile sync`; on a fresh repo it must equal today's `config init` output
(golden `config-init-baseline.json`, captured + asserted in L9).

## (d) Permission model — `host_mode ⊥ guild_gates`

The load-bearing invariant (parent ADR ~1348/1602): `host_mode` governs host
tool/edit/sandbox autonomy; `guild_gates` governs Guild lifecycle gates; they are
**independent**. Encoded as `gateRequired(host_mode, guild_gates, gate_type)` which
**ignores `host_mode` entirely** — a gate is skippable only when `guild_gates`
explicitly permits that gate type (`gatesPermittedToSkip`, conservatively at most
`{plan, qa}`; never the safety-critical set). The 4 ops safety rails are hard,
host_mode-independent predicates (`evaluateSafetyRails`): (1) incident/rollback
(ops/destructive) never autonomous; (2) first run interactive; (3) always-ask hard set
unconditional; (4) mandatory pre-flight dry-run.

## The four carried contracts (C1–C4)

- **C1 — advisory substrate.** `AdvisoryRecord` gains an **optional, back-compatible**
  `substrate` field (`claude|codex|.agents|pi|antigravity`, absent ⇒ default `claude`).
  `backend` (dispatch mechanism) is **unchanged, not overloaded**. Pre-P1 records still
  validate; existing factory output is byte-identical (field included only when
  supplied). Routing (populate from `roles.advisory`) is L8. Receipt field:
  `advisory: { substrate, record_ref, confidence }`.
- **C2 — permissions baseline-golden.** Verified defaults `auto_approve=[]`
  (read-guild-config.ts:409 / settings-resolver:265) + `bypass_permissions_policy="audit"`
  (:446 / :303). The golden = 36 cells (6 phases × 6 gate-types), **every cell**
  `{host_mode:"ask", guild_gates:"ask", bypass:"audit"}`, generated by
  `resolveBaselineGolden()` and emitted as a fixture. The orthogonality-violation
  fixture proves `bypass_all` + `guild_gates:"ask"` on a `release` gate ⇒ gate
  **required** (proven across **all** host_modes).
- **C3 — per-host fallback ladders.** The exact 4-surface × 5-host rung table
  (`native > wrapped > bridged > emulated > degraded`), `.agents`/pi/antigravity
  INFERRED; `resolveRung()` emits a degradation receipt; an unknown host degrades + records.
- **C4 — routing A/B (CLOSED at G-spec).** `RoutingDecision` (`host-router.ts:186`,
  `route()` 433–595) + `SelectResult` (`provider-detect.ts:130`, `selectReviewer()`
  424–536), serialized via `canonicalJSON` (recursively sorted keys) and compared
  `deepEqualCanonical`. L7's SC-4 A/B snapshots both pre/post-registry for Claude+Codex.

## Verification (TDD posture)

Every module ships a `validate*()` returning `{valid, errors}` (never throws). At
authoring, all modules typecheck clean (`tsc --strict`) and a 24-assertion smoke pass
is green: registry rows valid, default role resolution == today, solo-claude
adversarial degrades, ladder complete + unknown-host degrade, canonical compare
key-order-independent, advisory back-compat (old record valid, new substrate valid,
bad substrate rejected), and never-clobber holds. The two fixtures are generated from
the reference resolvers (not hand-authored) so they cannot drift from the predicate.
Ltest turns each contract into RED→GREEN tests against these surfaces.

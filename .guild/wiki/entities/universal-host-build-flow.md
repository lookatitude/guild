---
type: concept
owner: docs-writer
confidence: high
importance: high
applies_to: [plugin]
source_refs:
  - plugin/scripts/build-inventory.ts
  - plugin/guild.inventory.json
  - plugin/scripts/build-host-packages.ts
  - plugin/src/modules/README.md
  - plugin/src/modules/*/module.manifest.json
  - plugin/scripts/package.json
  - plugin/scripts/lib/inventory-schema.ts
  - plugin/scripts/lib/host-capabilities-schema.ts
  - plugin/scripts/lib/parity-contract.ts
  - plugin/scripts/lib/equivalence-contract.ts
  - plugin/scripts/lib/result-contracts.ts
  - plugin/scripts/lib/guild-run-wrapper.ts
  - plugin/scripts/lib/result-normalizer.ts
  - plugin/scripts/lib/per-host-packaging.ts
  - plugin/scripts/lib/host-registry-schema.ts
  - plugin/scripts/lib/host-registry.ts
  - plugin/scripts/lib/host-id-namespace.ts
  - plugin/scripts/lib/role-model-schema.ts
  - plugin/scripts/lib/role-resolver.ts
  - plugin/scripts/lib/runstart-preflight.ts
  - plugin/scripts/lib/config-schema.ts
  - plugin/scripts/lib/config-reconcile.ts
  - plugin/scripts/lib/config-reconcile-contract.ts
  - plugin/scripts/lib/permission-policy-schema.ts
  - plugin/scripts/lib/permission-policy.ts
  - plugin/scripts/lib/adapter-fallback-ladders.ts
  - plugin/scripts/lib/runtime-adapters.ts
  - plugin/scripts/lib/routing-ab-contract.ts
  - plugin/scripts/lib/advisory-record.ts
  - plugin/skills/meta/using-guild/SKILL.src.md
  - plugin/hooks/using-guild-bootstrap.ts
  - plugin/hooks/lib/guild-hook-event.ts
  - plugin/tests/universal-host/
related:
  - guild-inventory-and-parity-contracts
  - universal-host-plugin-architecture
created_at: 2026-06-15
updated_at: 2026-06-23
sensitivity: public
---

# Universal-host build flow (P0 + P1 + P2-W1 + P2-W2 + P2-W3 + module reorg)

How Guild turns its single source tree into per-host packages, and how it negotiates
host capabilities, roles, config, permissions, and runtime adapters at run time. This
documents the universal-host migration (ADR
[universal-host-plugin-architecture](../../../../.guild/wiki/decisions/universal-host-plugin-architecture.md))
in two shipped slices:

- **P0 (migration steps 1–5)** — the package + bootstrap surface for **Claude and Codex
  only**, with **no business-logic change**. (The ADR migration plan's "Phase 1 should
  not touch business logic" prose; the rest of this section was originally titled
  *Phase 1*.)
- **P1 (migration steps 6–11)** — broadens the generator to **five hosts**, collapses
  the scattered host/provider/capability knowledge into **one registry**, resolves
  `host`/`advisory`/`adversarial` **roles** per run, centralizes **config** behind a
  typed schema + reconciler, models **permissions** as `host_mode ⊥ guild_gates`, and
  fills the **runtime-adapter** surfaces. Unlike P0, **P1 touches running orchestration
  code** — every such change is either behavior-preserving (zero-delta, A/B-proven) or a
  deliberate, golden/contract-tested change whose default reproduces today's behavior.
  See [§P1 — capability-negotiated run surface](#p1--capability-negotiated-run-surface).

> **Generated-tree boundary — read this first.** The generator writes to
> `plugin/dist/` and `install.sh` now renders that tree before invoking host CLIs.
> The generated packages are therefore the installer input for Claude, Codex, Pi,
> Antigravity, and the universal `.agents` file target. Module resources under
> `plugin/src/modules/*/resources` are the body-file source of truth; top-level
> `commands/`, `skills/`, `agents/`, `hooks/`, `scripts/`, `mcp-servers/`, and
> `.claude-plugin/` files are generated compatibility mirrors checked by
> `npm run check:module-source-of-truth`.

## The flow

```
            build-inventory.ts                build-host-packages.ts        dist/claude-code/**
 source  ───────────────────►  guild.inventory.json  ───────────────────►  dist/codex/**
 tree      (scan + assert)      (guild.inventory.v1)    (render + gate)       dist/codex-marketplace/**
                                                                              dist/agents/**   (P1)
                                                                              dist/pi/**       (P1)
                                                                              dist/antigravity/** (P1)
                                                                                   │
                                       guild-run wrapper + result normalizers  ◄───┘
                                                          │
                                          using-guild bootstrap (SessionStart)
```

One inventory → **five host package targets plus the Codex marketplace wrapper**
→ a per-host run wrapper → automatic bootstrap. Each stage is a discrete,
verifiable artifact. At run time the
[host registry](#p1--capability-negotiated-run-surface) negotiates which
capabilities each host actually has and degrades minimum-loss where it falls
short.

### 1 · Inventory — `guild.inventory.v1`

`plugin/scripts/build-inventory.ts` deterministically scans the source tree and
emits `plugin/guild.inventory.json` — the single, host-neutral description of every
Guild surface. It conforms to `guild.inventory.v1` (8 id-keyed categories;
schema + validator in `plugin/scripts/lib/inventory-schema.ts`). As generated
today it carries 20 commands, 110 skills, 17 agents, 18 hook bindings, 2 MCP
servers, 231 scripts, the 6-entry result-contract registry, and the full `docs/`
tree (scanned recursively, id = repo-relative path; currently 2 docs in the plugin
repo). The build asserts **coverage** (SC-7a) as it goes: a surface present in
the repo but missing from the inventory fails the build.

The inventory is also the ownership substrate for the module reorganization.
`plugin/src/modules/*/module.manifest.json` maps every live command, skill,
agent, hook, MCP server, and script id to exactly one module. The stable
host-facing paths remain top-level; many `scripts/**` paths are now
compatibility shims into `src/modules/**`.

### 2 · Generator — `npm run build:hosts`

`plugin/scripts/build-host-packages.ts` (run via `npm run build:hosts`, i.e.
`npx tsx build-host-packages.ts`) renders **all package trees** from that one
inventory and writes them under `plugin/dist/` (renderers in
`plugin/scripts/lib/per-host-packaging.ts`):

- **`dist/claude-code/**`** (P0) — the full installed tree: `.claude-plugin/plugin.json`,
  `commands/`, `skills/`, `agents/`, `hooks/` (`hooks.json` + `bootstrap.sh` +
  scripts), `.mcp.json`, `scripts/`, `mcp-servers/`, and `bin/guild-run`.
- **`dist/codex/**`** (P0) — `.codex-plugin/plugin.json`, `.agents/skills/guild/**` (which
  exposes the `using-guild` bootstrap on Codex), `scripts/`, `mcp-servers/`, and
  `bin/guild-run`.
- **`dist/codex-marketplace/**`** — a local Codex marketplace root wrapping the
  generated Codex plugin tree under `plugins/guild/`.
- **`dist/agents/**`, `dist/pi/**`, `dist/antigravity/**`** (P1, migration step 6) — each
  exposes the `using-guild` bootstrap under `.agents/skills/guild/meta/using-guild/` and
  carries its own `bin/guild-run` wrapper, `scripts/`, and `mcp-servers/`. `.agents` is
  the universal AGENTS.md file-package target; Pi and Antigravity have generated
  renderer output. **Gemini stays dropped (decision D10).** These
  three ship with **INFERRED** capability rows and `installability: target` until a live
  host install is proven — the same posture P0 used for Codex.

The build is **self-gating**: before it reports success it runs the L0 contracts
in-process and prints
`build:hosts: gates PASS (SC-2 equivalence + SC-7b subset).` —

- **SC-2 (full-tree equivalence)** — the generated Claude tree is compared,
  surface by surface, against the committed canonical package; the comparison is
  non-vacuous (it renders a fresh tree and requires every expected surface). Any
  drift fails the build.
- **SC-7b (subset)** — no generated package may reference a command / skill /
  agent / MCP / script / hook id or `schema_version` absent from the inventory.

A non-zero exit means the gates did not pass; the build never silently ships a
drifted package. The run is deterministic and idempotent (re-running reproduces
byte-identical `dist/`). The default `npm run verify:host-packages` rail also
checks live compatibility resources against module resources before rendering
and passes `--check-claude-install`, which means top-level compatibility files
stay mirrors and committed `.claude-plugin` compatibility metadata is checked
against the generated module/inventory render on every generated-package
verification run.

Because script entrypoints can now be shims into module-owned implementations,
every generated package that bundles `scripts/` also bundles `src/` and the
package-local script runtime dependency closure (`js-yaml`, `argparse`,
`esprima`, `sprintf-js`). The Claude package test executes a generated compiled
hook from the installed tree to prove the packaged resolver can find
`scripts/node_modules/js-yaml` without relying on the source checkout.

> **Scope:** P0 targeted **Claude + Codex** only; **P1 added `.agents`, Pi, and
> Antigravity** (migration step 6), so `build:hosts` now emits **five host
> package targets plus the Codex marketplace wrapper** from one inventory
> (SC-1). Gemini remains dropped (decision D10). Each new package passes
> the same SC-2 parity gate against the inventory; their capability rows are INFERRED
> with `installability: target` until live-host-verified.

### 3 · Wrapper — `guild-run <host>`

`plugin/scripts/lib/guild-run-wrapper.ts` backs the generated `bin/guild-run`. The
host-neutral **wrapper path** (`bin/guild-run`) is **emitted in all five trees** (P0 SC-5 /
P1 SC-3 — confirmed on disk); it injects the bootstrap context + resolved config and
captures receipts so a CLI host can run the Guild lifecycle where native plugin features
are thin. The wrapper **runtime** (`planWrapperInvocation`), however, only resolves a launch
shape for hosts with a `HOST_CAPABILITY_ROWS` entry — today **Claude and Codex only**; it
**deliberately throws for `.agents`/Pi/Antigravity** rather than guessing a launch shape.
Their runtime launch is **deferred to live-host availability** (the L6 follow-up: add
`HOST_BINARY` + capability rows once verified on-box). So: wrapper *path* for five hosts,
proven wrapper *runtime* for two.

### 4 · Normalizers — the two contracts that exist

`plugin/scripts/lib/result-normalizer.ts` adapts host output into Guild result
schemas with a **validate → bounded-repair → fail-closed** ladder. Phase 1 targets
exactly the **two result contracts that exist today** —
`guild.handoff.v2` (strict) and `review_result.v1` (lenient) — via the registry in
`plugin/scripts/lib/result-contracts.ts`. The other four contracts named in the ADR
have no producer yet and are deliberately **not** designed (premature churn); a
result whose `schema_version` is not a Phase-1 target fails closed rather than being
accepted as prose (SC-6).

### 5 · Bootstrap — `using-guild` (automatic invocation)

`plugin/skills/meta/using-guild/SKILL.src.md` is the concise meta-skill that teaches
a host *when* to engage Guild and *where* the command menu lives (it does not dump
every command). On Claude it is injected at session start by
`plugin/hooks/using-guild-bootstrap.ts`, which emits
`hookSpecificOutput.additionalContext` carrying the skill source — so a prompt like
"review this plan adversarially" loads the relevant Guild skill **without** the user
typing `/guild` (SC-4). This SessionStart injection is a **deliberate, golden-tested
format change** (not a zero-delta refactor); the legacy `bootstrap.sh` banner is
preserved alongside it. All 18 `hooks.json` command paths quote
`${CLAUDE_PLUGIN_ROOT}` so a plugin-root path containing spaces does not
word-split (space-safe launch verified).

The hook layer underneath is normalized by `GuildHookEvent`
(`plugin/hooks/lib/guild-hook-event.ts`): the five in-scope Claude hooks were
refactored onto one shared emitter with **byte-for-byte preserved runtime behaviour**
(SC-8 zero-delta), separate from the deliberate SessionStart change above.

## P1 — capability-negotiated run surface

P0 made the **package** surface generated and testable. P1 (migration steps 6–11) makes
the **run** surface capability-negotiated: one registry of host facts, roles resolved per
run, config reconciled without clobbering, permissions orthogonal to gates, and runtime
adapters that degrade minimum-loss. The design-time contracts behind all of this are in
the ADR-addendum `plugin/docs/knowledge/decisions/universal-host-p1-l0-foundation-contracts.md`
(P1-L0 foundation contracts); the modules below are their implementation.

### 6 · Host registry — `guild.host_registry.v1` (the single host SoT)

`plugin/scripts/lib/host-registry.ts` (schema in `host-registry-schema.ts`) is now the
**only** source of host identity, detection, and capabilities. `host-router.ts`,
`team-backend.ts`, and `provider-detect.ts` route through it. The old single detect-only
flag (`ProviderSpec.hasAdapter`) is **split into three independent columns**, because it
conflated three orthogonal facts:

- `installability: native | target | none` — can a package be **installed**.
- `result_adapter: boolean` — does a cross-review / **result** adapter exist.
- `dispatch_selectable: boolean` — can a lane be **dispatched/selected** here.

Five rows ship: `claude` (verified — native/false/true), `codex` (target/true/true), and
`.agents` / `pi` / `antigravity` (all `target`, `result_adapter:false`,
`provenance: "inferred"`) — matching today's reality that **only Codex is a selectable
cross-reviewer**. `host-id-namespace.ts` is the single importable contract mapping the
legacy `HostKind` union (9 surfaces, `antigravity-2`, `gemini`, claude-* variants) to the
registry's `HostId` namespace (`claude|codex|.agents|pi|antigravity`); the family collapse
is byte-aligned with the existing `resolveAuthorHost()`, so this is **behavior-preserving**.

**Zero-delta proof (SC-4):** routing for Claude/Codex is **byte-identical** pre/post-registry.
`routing-ab-contract.ts` serializes `RoutingDecision` (from `route()`) and `SelectResult`
(from `selectReviewer()`) via canonical-JSON (recursively sorted keys) and compares them
deep-equal; the A/B snapshot passed 214/214.

### 7 · Role resolver — host / advisory / adversarial (resolver + preflight shipped)

`plugin/scripts/lib/role-resolver.ts` (contract in `role-model-schema.ts`) resolves three
roles **from the capability matrix, never the host name**: `host` = strongest installable +
dispatch-selectable; `advisory` = strongest dispatch-selectable (defaults to the host
substrate = today's local advisor); `adversarial` = strongest `result_adapter` substrate of
a **different family** (same-family ⇒ weak independence). What **shipped in P1** is the
resolver itself plus its **preflight** wiring: `runstart-preflight.ts` computes the roles
and records them (additively) in the run-start snapshot, and the C1 advisory-substrate
helper stamps the resolved substrate onto the `AdvisoryRecord`. The **`execute-plan` advisory
call-site and the `review-broker` reviewer-selection skill bodies now consume the resolved
roles** (skill-author follow-up landed): `execute-plan` routes the advisor to
`snapshot.roles.advisory.substrate` and stamps the C1 `substrate` via
`advisorySubstrateFromRoles`, and `review-broker` selects the reviewer from
`snapshot.roles.adversarial.substrate`. So advisory advice is **routed AND recorded** at the
live call-site, not just routable. SC-5's evidence: the resolver matches the L0 reference
(6/6) with a clean 60-test preflight regression, and the wiring is codex-G-lane SATISFIED;
default == today.

**Advisory substrate (contract C1, additive):** `advisory-record.ts` gains an optional,
back-compatible `substrate` field (`claude|codex|.agents|pi|antigravity`, absent ⇒ `claude`);
`backend` (the dispatch *mechanism*) is unchanged, not overloaded. The handoff field shape
is `advisory: { substrate, record_ref, confidence }`. **Default Claude+Codex resolution ==
today** (host=claude, advisory=claude/strong, adversarial=codex/strong).

### 8 · Config schema + reconciler — `check | sync | repair` (never clobbers)

`plugin/scripts/lib/config-schema.ts` is the typed field-registry SoT (key/type/default/
scope/`security_sensitive`); `config-reconcile.ts` (contract in `config-reconcile-contract.ts`)
runs three modes on install / update / `/guild init`: `check` (report only), `sync` (fill
missing → default), `repair` (also coerce malformed → default). The **never-clobber
invariant** is a single predicate — a field with provenance `"user"` is **never** rewritten
by any mode for any key, security keys included — with provenance + a last-reconciled
timestamp recorded. `config init` becomes a wrapper around `reconcile sync`; on a fresh
repo it produces config **byte-identical** to the pre-P1 `config init` output (golden
`fixtures/config-init-baseline.json`, default==today).

### 9 · Permission policy — `host_mode ⊥ guild_gates` (orthogonality invariant)

`plugin/scripts/lib/permission-policy.ts` (schema in `permission-policy-schema.ts`) models
`host_mode` (`ask|accept_edits|auto|bypass_all|read_only`) and `guild_gates`
(`ask|auto-safe|ask-on-block|never-auto`) per lifecycle phase, mapped to each host's native
autonomy flags via the registry. The **load-bearing invariant**: `gateRequired()` **ignores
`host_mode` entirely** — a host bypass/YOLO mode **cannot** skip any Guild-layer gate; a gate
is skippable only when `guild_gates` explicitly permits that gate type (conservatively at
most `{plan, qa}`, never the safety-critical set). The 4 ops safety rails are hard,
`host_mode`-independent predicates: incident/rollback never autonomous; first run interactive;
the always-ask hard set unconditional; mandatory pre-flight dry-run.

**Baseline golden (SC-7):** today's effective behavior (`auto_approve=[]`,
`bypass_permissions_policy="audit"`) is captured as a **36-cell golden** (6 phases × 6
gate-types), **every cell** `{host_mode:"ask", guild_gates:"ask", bypass:"audit"}`. The new
per-phase default resolver reproduces all 36 cells byte-for-byte; an orthogonality-violation
fixture proves `bypass_all` + `guild_gates:"ask"` on a `release` gate still requires the gate
(across **all** host_modes). This model carries an independent **security sign-off**
(full attack matrix — no bypass path found).

### 10 · Runtime adapters — minimum-loss fallback ladders

`plugin/scripts/lib/runtime-adapters.ts` (rung table in `adapter-fallback-ladders.ts`) fills
the four adapter surfaces behind the registry, each with a `native > wrapped > bridged >
emulated > degraded` ladder and a degradation receipt naming the chosen rung:

- **interaction** — native prompts/`AskUserQuestion` → wrapped CLI prompt → bridged file-bus → degraded (assume-default + record).
- **session continuity** — native session id/resume → wrapped run-dir state → emulated re-bootstrap from receipts.
- **semantic tool-map** — native tool names → bridged Guild→host name map → emulated shell equivalents.
- **browser** — native browser tool → bridged MCP/devtools → degraded (skip + record "no browser substrate").

The exact per-host rungs come from the registry's capability columns; new-host rungs are
INFERRED until live-verified. An unknown host degrades and records rather than claiming a
capability.

## Verification status (P0 + P1)

P0's eight build lanes and P1's build lanes (L0, L6–L11, Ltest) all landed and passed their
Codex adversarial G-lane; the security lane (Lsec) is a reviewer, not a Codex-gated build
lane, and produced an independent **security sign-off** of the permission/bypass/gate model.
Reconciled against artifacts on disk:

### P1 (run `run-2026-06-15T03-14-57-320Z`)

- `npm run build:hosts` emits **all five** host trees under `dist/` (`claude-code`, `codex`,
  `agents`, `pi`, `antigravity`), each with `bin/guild-run` and the `using-guild` bootstrap
  (SC-1/SC-2/SC-3 confirmed on disk).
- `plugin/tests/universal-host/` — **13 suites / 226 tests, all green** (per the done-gate
  `verify.md`), real-path (no injected-seam shortcuts), covering SC-1…SC-9.
- SC-4 routing A/B byte-identical for Claude/Codex (214/214); SC-9 no running-code
  regression across the existing hook/dispatch/gate/preflight suites.
- The committed `plugin/.claude-plugin/` is **untouched** after a build — writes go to
  `dist/` (+ `guild.inventory.json`) only.

### P0 (run `run-2026-06-14T21-06-12-400Z`)

All eight P0 build lanes landed and passed their Codex adversarial gate. Reconciled
against artifacts on disk while writing this page:

- `npm run build:hosts` → exit 0, `gates PASS (SC-2 equivalence + SC-7b subset)`,
  idempotent.
- The committed `plugin/.claude-plugin/` is **untouched** after a build — writes go
  to `dist/` (+ `guild.inventory.json`) only.
- L6 cross-cutting suite `plugin/tests/universal-host/` — **88 tests, 5 suites,
  all green**, real-path (no injected-seam shortcuts). (Includes the FU-6 SC-4
  delivery-path block that spawns the real SessionStart injector.)

## What stays deferred after P1 (P2 / P3)

P1 lands ADR migration steps 6, 7, **8 (fully)**, 9, 10, and 11 — step 8 = resolver +
preflight + the `execute-plan` / `review-broker` consumer wiring, which **landed** (the
skill-body follow-up is closed; SC-5 is FULL). The following remain **out of scope** for
later phases — none is implied by anything above:

- **Live-host install proof** for `.agents` / Pi / Antigravity / Codex — the local
  `npm run verify:installer-live` rail now executes the installer against real host
  binaries with temporary `HOME`/`XDG_*` directories. This proves the installed CLIs
  accept the generated local package paths on the verifier machine. The target rows
  still remain `installability: target` until broader real-user bootstrap acceptance
  is recorded; their `result_adapter`, session, and interaction rungs flip to verified
  only on a real install + bootstrap.
- **New-host wrapper runtime** (`planWrapperInvocation` launch shape for `.agents`/Pi/
  Antigravity) — the generated-package smoke is now covered by
  `npm run verify:host-packages`, including `.agents` through the `agents-file`
  capability row. This is package/runtime proof only, not live host acceptance.
- **Removing no-longer-needed compatibility mirrors** — still a host-format cleanup.
  The installer already consumes generated `dist/*` packages and body files are
  module-sourced, but top-level mirrors remain because current host renderers and
  compatibility checks still load those paths.
- **Product-loop intake classifier + explore/define artifact contracts** — ADR step 12 (P2).
- **Workspace product map / dependency graph / impact detector** — ADR step 13 (P2).
- **Host-aware config aliases + per-host config rendering** — ADR step 14 (P2).
- **Contract-driven test-matrix generation + QA traceability** — ADR step 17 (P2).
- **Product templates, autonomy presets, workspace dashboard views** — ADR step 18 (P2).
- **Multi-host installer + website docs revisit** — ADR step 19 (P3).

Carried (non-blocking) follow-ups from the P1 run, for the next plan:

- **Role-resolver consumer wiring (skill bodies): ✅ DONE (skill-author).** `execute-plan`
  now routes the advisor to `snapshot.roles.advisory.substrate` + stamps the C1 `substrate`
  via `advisorySubstrateFromRoles`, and `review-broker` selects the reviewer from
  `snapshot.roles.adversarial.substrate` (HostId→provider mapped). Default Claude+Codex ==
  today; codex G-lane SATISFIED. SC-5 is now FULL (advisory advice routed + recorded).
- **Lsec MUST-on-wiring (load-bearing):** when a live dispatcher (orchestrator /
  `guild-run.ts` / `team-backend`) wires `host_mode`, it must feed `resolveLaunchMode` only
  and keep `guildGateRequired` the **sole** Guild-gate authority — never pass `host_mode`
  into the gate decision. (The contract enforces this; the live wiring is the follow-up.)
- **Codex `--dangerously-bypass-approvals-and-sandbox`** launch flag is INFERRED off-box —
  live-verify on the Codex host.
- **`commands/*.md` `config init` → `reconcile sync`** doc/command rewire (command-builder).

## Follow-up status (P0 closeout)

Post-run disposition of every follow-up surfaced during the P0 build
(run `run-2026-06-14T21-06-12-400Z`):

- ✅ **`dist/` git posture** — `/dist/` is gitignored (anchored to the repo root so
  it does not catch the tracked `hooks/dist/`). Generated package output is not
  committed; `guild.inventory.json` plus `src/modules/*/resources` provide the
  checked source inputs.
- ✅ **`hooks.json` `${CLAUDE_PLUGIN_ROOT}` quoting** — all 18 command paths quoted
  (space-safe), JSON valid, spaced-path launch verified. (Was: only L5b's command.)
- ✅ **Full `docs/` inventory** — the generator now scans the full `docs/` tree
  recursively (still a non-enforced coverage surface, not a package input).
- ✅ **SC-4 delivery assertion** — the SC-4 suite now binds the auto-invocation
  simulator to the real L5b SessionStart injector end-to-end.
- ⏳ **Codex capability rows carry `// INFERRED` values** (permission / launch /
  session / interaction) authored off-box. They must be confirmed on a live Codex
  host before being relied on; Codex `package.installable` is `false` with
  `installability: "target"` and flips to verified only when a real Codex install +
  bootstrap is proven (**SC-3 — the one open follow-up, gated on live-host
  availability**).

## P2 Wave 1 — product loop + workspace portfolio + host-aware config rendering (migration steps 12–14)

P2 broadens beyond the *package/run* surface into the **product + workspace** surface. **Wave 1**
(run `…20260617-002835`, 10 lanes, each Codex-G-lane gated; `verify-done` PASS SC-W1-1..9; full
`scripts/` suite green in-band 126/3856) landed the three **additive, behavior-preserving**
subsystems of ADR steps 12–14 — **no install-channel change** (the step-15 `.claude-plugin`→`dist/`
cutover is deferred until after v2.0.0 ships; wiki decision `universal-host-p2-p3-wave-sequencing`):

- **Step 12 — product-loop intake (AC30/31/32).** A deterministic `classifyIntake` + shipped
  `intakeRouteTarget` are wired into the **no-slash `using-guild` entry** as a precision-floored
  router (decides on `intake`, never a raw score; non-product prompts fall straight through — a
  router on the existing entry, not a new gate). It routes a vague product prompt →
  `guild:product-explore` → `guild:product-define`, which emit fail-closed `guild.explore.v1` /
  `guild.define.v1` artifacts; every define acceptance-criterion carries a stable id traceable
  plan → build receipt → QA → release gate (`define-traceability.ts`).
- **Step 13 — workspace portfolio (AC33/34/35).** `guild.dependency_graph.v1` +
  `workspace-impact-detector.ts` compute the **transitive** affected-child set **before** planning,
  referencing children by id/path/reason only — with a **physical** child-`.guild/wiki` read-deny
  (AC33 isolation, not a byte-count), symlink-safe child-write rejection (AC34), and root-PASS =
  AND-over-affected-children-or-reviewed-exception (AC35).
- **Step 14 — host-aware config (AC14/23).** The config schema gains additive optional
  `roles`/`host_profiles` keys + a `local` scope (single-SoT `host-profiles-validate.ts` enforced on
  BOTH `--validate` and the resolve path). `config-render.ts` renders the resolved config into each
  of the 5 host-native shapes via the host-registry capability rows, **failing closed** so a
  `local`-scope or secret value (models AND the `auto_approve`/`security` permission feeders) is
  withheld from a shared host output. `config role <role> <host_id> --scope …` writes the correct
  scoped JSON (never-clobber); `config show --sources` annotates the phase-permission block layers;
  `config show --render` previews the 5 host shapes.

> The **one** intentional default-output change in this wave is the config-init scaffold golden
> re-baseline (the additive `roles`/`host_profiles` keys), plugin-architect-signed and A/B-gated;
> with the keys absent, runtime resolution is byte-identical to pre-P2.

## P2 Wave 2 — the generation core: source→host rendering pipeline (migration steps 15–17)

Wave 2 builds the **source-plus-transformer pipeline** that lets skills + commands be authored from a
**host-neutral structured source** and rendered into the Claude shape — with a **drift/parity gate**
proving the rendered output matches the committed package — **without flipping the install channel**
(run `…20260617-042249`, 8 lanes, each Codex-G-lane gated; `tests/universal-host` 408/408 green).

- **Step 15 — skill pipeline (🟨 shipped; cutover deferred).** `skill-src/skill-registry.json`
  (`guild.skill_src.v1`: structured `{id,name,description,when_to_use,type,body}` per skill) +
  `scripts/lib/skill-source-transform.ts` render the Claude `SKILL.md` from the structured entry —
  **byte-identical** to the 5 committed invocation-driving skills (review-broker, execute-plan,
  systematic-debug, tdd, verify-done; `using-guild` excluded as P0-co-located). A genuine non-identity
  transform (JSON → frontmatter+body), NOT a verbatim copy.
- **Step 16 — command registry (✅ shipped).** `command-src/command-registry.json` (`guild.command.v1`)
  + `scripts/lib/command-registry.ts` render byte-identical `commands/*.md` across the full corpus.
- **Step 17 — contract test-matrix (✅ shipped).** `scripts/lib/define-test-matrix.ts` maps each
  `guild.define.v1` acceptance-criterion id → covering test(s), flags uncovered ACs + orphan tests,
  building on `define-schema`/`define-traceability` (Wave-1).

> **Deferred-cutover safety net (SC-W2-5).** Sources live OUTSIDE the live surface (`skill-src/`,
> `command-src/`); transformers render to temp/staging ONLY; the committed `skills/**/SKILL.md` +
> `commands/*.md` + `.claude-plugin/**` stay **byte-identical** (an empty-set git guard vs the
> hard-pinned pre-Wave-2 baseline + a build-inventory resolved-entry A/B that compares the pre-Wave-2
> tree vs current). That guard now protects the generated `dist/*` installer
> channel and the top-level compatibility mirrors. Remaining work is host-format
> cleanup for mirrors that no installed host needs directly.

## P2 Wave 3 — product templates, autonomy presets, dashboard, installer contract (migration steps 18–19)

Wave 3 lands the **last codeable-before-v2.0.0** subsystems of ADR migration steps 18 and 19 —
all **additive and behavior-preserving** (run `…20260617-152632`; `tests/universal-host` green).
The live install surface stays byte-identical: **no new or changed `commands/*.md`**, and the only
`skills/**` delta is the ratified producer skill below. Four subsystems plus a docs reconcile —
stamped in the ADR
([universal-host-plugin-architecture](../../../../.guild/wiki/decisions/universal-host-plugin-architecture.md), steps
18 and 19):

- **Product templates + producer (step 18 / AC37).** A `guild.template.v1` set
  (`plugin/templates/products/*.template.json`; schema + fail-closed validator + pure instantiator
  in `scripts/lib/template-schema.ts`) carries the AC37 field set — `specialists`,
  `context_questions`, `artifact_skeletons{explore,define}`, `default_checks`, `docs_expectations`,
  `release_gates`. The **ratified additive producer skill** `guild:product-template`
  (`skills/meta/product-template/`) seeds a product idea from a named template into a valid
  `guild.explore.v1` + `guild.define.v1` pair via the deterministic `scripts/instantiate-template.ts`
  producer, which re-validates with the Wave-1 validators and is AC37-contained — it writes only
  `.guild/` artifacts, never a runtime permission/skill/agent file. This producer skill is the
  **one** additive `skills/**` delta this wave (ratified; the forbidden-list bars only new *command*
  files, not an additive skill).
- **Autonomy presets (step 18 / AC21).** `scripts/lib/autonomy-presets.ts` defines the named presets
  `conservative` / `standard` / `bypass`, each expanding to a `host_mode` + an **explicit per-gate
  `guild_gates` slice ONLY** — `auto_approve` is not preset-writable (the coarse bypass axis is
  closed). The AC21 invariant holds: every protected gate (plan, qa, release, ops, security,
  destructive) stays non-auto unless `guild_gates` explicitly names it, and the always-ask hard set
  can never be granted autonomy; the `bypass` preset raises only **host** autonomy and never lifts a
  Guild gate (the `host_mode ⊥ guild_gates` orthogonality from §9, reused verbatim). Selecting a
  preset never clobbers user values and fails closed on security keys; the default (no preset) is
  **byte-identical** to today.
- **Workspace dashboard projector (step 18 / AC36 + AC33).** `scripts/lib/dashboard-projector.ts` is
  a **read-only** `guild.dashboard.v1` projection over `.guild/` state surfacing **all six** AC36
  sections: active initiatives, child-project health, stale knowledge, lane progress,
  acceptance-criteria status, and QA/release readiness. It is surfaced via an existing path — **no
  new `commands/*.md`** (a `/guild:dashboard` command file is deferred) — and honours AC33 isolation:
  it performs no write and never reads or copies a child repo's `.guild/wiki` content.
- **Installer contract + per-host receipt (step 19).** `scripts/lib/installer-contract.ts`
  defines the `guild.install_receipt.v1` schema + a per-host installer plan/contract (install +
  update/reconcile step descriptions + the receipt each host emits or records:
  bootstrap-context / resolved-config / permission-mode / result-normalization).
  The current rails cover dry-run installer paths, fixture-backed non-dry-run
  execution, and isolated live-binary execution for installed host CLIs.

> **Current cutover note.** The installer channel has flipped to generated
> `dist/*` packages and module resources now source generated package bodies.
> Compatibility mirrors remain in the repo for host package formats that still
> expect top-level paths; they are checked against module resources instead of
> treated as independent sources.

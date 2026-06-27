---
type: decision
owner: architect
confidence: high
importance: critical
applies_to: [plugin]
source_refs:
  - docs/knowledge/decisions/universal-host-plugin-architecture.md
  - .guild/spec/universal-host-p0.md
  - .guild/plan/universal-host-p0.md
  - plugin/.claude-plugin/plugin.json
  - plugin/.mcp.json
  - plugin/hooks/hooks.json
  - plugin/hooks/lib/handoff-v2.ts
  - plugin/scripts/verify-gate-pass.ts
  - plugin/scripts/lib/per-host-packaging.ts
  - plugin/scripts/lib/inventory-schema.ts
  - plugin/scripts/lib/host-capabilities-schema.ts
  - plugin/scripts/lib/result-contracts.ts
  - plugin/scripts/lib/parity-contract.ts
  - plugin/scripts/lib/equivalence-contract.ts
  - plugin/src/modules/distribution/workflows/build-inventory.ts
  - plugin/src/modules/distribution/workflows/inventory-schema.ts
  - plugin/src/modules/distribution/workflows/parity-contract.ts
  - plugin/src/modules/distribution/workflows/equivalence-contract.ts
  - plugin/src/modules/*/module.manifest.json
related:
  - universal-host-plugin-architecture
  - host-adapter-contract
  - communication-format-policy
  - feature-degradation-contracts
created_at: 2026-06-14
updated_at: 2026-06-21
expires_at: null
supersedes: null
sensitivity: public
---

# ADR: Guild Inventory + Parity/Equivalence Contracts (universal-host P0 · L0)

**Status:** IMPLEMENTED (load-bearing shapes now have module-owned
implementations plus stable compatibility shims). Parent SoT:
[universal-host-plugin-architecture](universal-host-plugin-architecture.md).

This ADR is the **foundation** of universal-host Phase 1. It pins the precise
schemas and contracts that every other lane consumes, so L1–L6 can build with no
further design questions and can write failing tests directly against these
definitions. It does **not** introduce runtime behavior — it is schema + contract
authoring only (spec constraint D8: no business-logic change).

The stable import/CLI surface for these contracts remains under
`plugin/scripts/**` for compatibility, but the module-owned implementations now
live under `plugin/src/modules/distribution/workflows/**` and related
`src/modules/**` folders. This document is the rationale and human-readable
specification; the module implementations plus their `scripts/**` shims are the
executable truth.

---

## 1. Decision summary

| # | Contract | Module | Consumed by |
|---|---|---|---|
| (a) | `guild.inventory.v1` — one neutral, id-keyed inventory of all eight surface categories | `inventory-schema.ts` | L1 (emit), L2 (render-from), L6 (validate) |
| (b) | `guild.host_capabilities.v1` + the Claude & Codex rows | `host-capabilities-schema.ts` | L2, L3, L6 |
| (c) | Two-sided parity contract (SC-7): coverage + subset | `parity-contract.ts` | L1, L2, L6 |
| (d) | Claude full-tree equivalence contract (SC-2) | `equivalence-contract.ts` | L2, L6 |
| (e) | Result-contract registry: exists vs deferred | `result-contracts.ts` | L3, L6 |

---

## 2. `guild.inventory.v1` — the neutral core inventory

One generated document describes every Guild surface **once**, host-neutrally.
Host packages are rendered **from** it; it is the source of truth, not any one
host's package format (parent ADR Non-Goal: "Do not preserve Claude file formats
as canonical for every host").

**Shape** (full types in `inventory-schema.ts`):

```
guild.inventory.v1 {
  schema_version: "guild.inventory.v1"
  generated_at:   <ISO 8601, caller-supplied — render metadata, excluded from SC-2>
  plugin_version: <semver>
  manifest:       { name, version, description, homepage?, repository?, author?, license?, keywords? }
  commands[]   · skills[]    · agents[]   · hooks[]
  mcp_servers[]· scripts[]   · schemas[]  · docs[]
}
```

Every entry carries a shared base `{ id, source_path }`:

- **`id`** — stable, host-neutral, **unique within its category**. This is the
  identity the parity contract keys on.
- **`source_path`** — bare repo-relative (POSIX), no `./` prefix. Renderers
  copy/transform **from** here.

Per-category extras: `skill.tier`, `skill.description`, `hook.event` (+`matcher?`),
`mcp.transport`/`command`/`args`/`url`/`read_only`, `script.kind` (`cli|lib`),
`schema.status` (`exists|deferred`)/`validator_kind`, `command.description`,
`agent.description`, `doc.title`.

**Invariants the validator enforces** (`validateInventoryV1`, strict — unknown
top-level keys rejected):

1. `schema_version` exactly `"guild.inventory.v1"`.
2. `generated_at`, `plugin_version` non-empty; `manifest.{name,version}` non-empty.
3. **Every** category list is present (may be empty). A *missing* list is an
   error — this is what makes coverage (SC-7a) enforceable: you cannot silently
   drop a whole category.
4. `id` unique within each category; `source_path` non-empty and not `./`-prefixed
   — **except** a `schemas[]` entry with `status:"deferred"` may carry
   `source_path:""` (it has no producer file yet). This lets L1 emit
   `inventory.schemas[]` straight from the result-contracts registry and still
   pass validation; an `exists` schema with an empty path is still rejected.
5. `hooks[].event`, `mcp_servers[].transport ∈ {stdio,http}`,
   `schemas[].status ∈ {exists,deferred}` required where applicable.

The `INVENTORY_CATEGORIES` list is **closed**: adding a category is a
schema-version bump (the coverage contract iterates exactly these keys).

> **Reality note that shaped the schema.** The live `.claude-plugin/plugin.json`
> declares only `name, version, description, homepage, repository, author,
> license, keywords, skills[], commands[], agents[]`. **MCP lives in `.mcp.json`;
> hooks live in `hooks/hooks.json`** — neither is inline in plugin.json. The
> inventory therefore models MCP and hooks as first-class neutral categories
> sourced from their real files, not as manifest sub-fields.

---

## 3. `guild.host_capabilities.v1` — capability rows

"Routing uses these booleans, not assumptions" (parent ADR). Every host
advertises a normalized row; routing/degradation read the row, never the host
**name**. The TS interface (`host-capabilities-schema.ts`) mirrors the parent
ADR §Capability Matrix YAML field-for-field — with one deliberate widening:
`HooksCaps` models **all ten** events the live `hooks/hooks.json` binds
(`session_start, user_prompt_submit, pre_tool_use, post_tool_use, stop,
pre_compact, subagent_stop, task_created, task_completed, teammate_idle`), not
just the five the parent-ADR YAML sampled, so L5/L6 never guess how an event is
advertised or degraded.

- **`CLAUDE_CAPABILITIES`** — transcribed **verbatim** from the parent ADR
  (authoritative); hooks set true for all ten live events.
- **Codex `package.installable`** is **`false`** (the honest *machine* state —
  routing consumes the boolean, not a comment) with a machine-readable
  **`installability: "target"`** recording that the renderer exists but is
  dormant (`per-host-packaging.ts`). Both flip to `true`/`"verified"` only when
  **SC-3** proves a real Codex install + bootstrap. Claude is
  `installable:true / installability:"verified"`.
- **`CODEX_CAPABILITIES`** — authored from **verified** plugin facts plus
  Codex-CLI knowledge. Verified-from-source values (from
  `per-host-packaging.ts`'s render-or-degrade behavior): `native_skills:false`,
  `native_agents:false`, `slash_commands:false` (commands → workflow
  descriptors), native hooks all `false` (Codex hook taxonomy differs → degrades
  through the HookEmitter, parent ADR Surface 3), `mcp.stdio:true / http:false`.
  Values **not** verified on a live Codex box are tagged `// INFERRED` in the
  module (the permission/launch/session/interaction rows). **L2/L3 must confirm
  the INFERRED values on the real host before relying on them**; per AC20 an
  unconfirmed mode is *omitted* from `launch_modes` rather than guessed, so its
  absence reads as "degrade and record", never as a false capability claim.

The validator (`validateHostCapabilitiesV1`) checks the discriminator, the
identity strings, presence of all 16 capability blocks, every `tools.*` strength
∈ `{native,bridge,emulated,none}`, **all ten `hooks.*` events present-and-boolean**
(so a probed partial row fails rather than silently under-advertising), and the
`package.installability` enum + `installable` boolean.

---

## 4. Two-sided parity contract (SC-7)

SC-7 has **two independent sides; both must hold** (`parity-contract.ts`):

### (a) Coverage — `discovery == inventory`

The set of surfaces **discovered by scanning the live repo** equals the set in
`guild.inventory.v1`, per category, keyed by `id`.

- A real surface in **neither** inventory nor package is the silent-drop failure
  this side catches: discovery finds it, inventory lacks it → **FAIL**
  (`missing_from_inventory`).
- A phantom (inventory has an id the repo no longer has) → **FAIL**
  (`phantom_in_inventory`).

**Discovery rules** (`DISCOVERY_RULES`) are the binding id-derivation spec — L1
(builder) and L6 (scan) MUST apply the identical rule or coverage reports false
mismatches:

| Category | Glob / source | id rule | Enforced (SC-7a fixture) |
|---|---|---|---|
| commands | `commands/*.md` | basename −`.md` | ✅ |
| agents | `agents/*.md` | basename −`.md` | ✅ |
| skills | `skills/**/SKILL.md`, `SKILL.src.md` | frontmatter `name:` (dedupe src+generated by name) | ✅ |
| hooks | parse `hooks/hooks.json` | `<event>:<script-basename>` per binding | ✅ |
| mcp_servers | parse `.mcp.json` | each `mcpServers` key | ✅ |
| scripts | `scripts/**/*.ts` (excl. `__tests__`, `*.test.ts`) | path −`.ts` | ✅ |
| schemas | curated `result-contracts.ts` registry | `wire_schema_version` | registry, not glob |
| docs | `docs/**/*.md` (full tree; FU-5) | repo-rel path −`.md` | not a fixture cat |

`COVERAGE_ENFORCED_CATEGORIES` = commands, agents, skills, hooks, mcp_servers,
scripts. **L6 must add an unmapped surface in each and require failure.**

**Anti-vacuity guard:** `checkCoverage` FAILS if any enforced category is absent
from the supplied discovery scan — a caller passing `{}` (or omitting
`hooks`/`scripts`) cannot receive `ok:true` while real surfaces go unchecked.

### (b) Subset — `package ⊆ inventory`

No host package references a command id, skill id, agent id, **mcp_server id,
script id, hook id**, or `schema_version` absent from the inventory (all six
first-class categories a real package can reference — `.mcp.json` and
`hooks.json` are not exempt). Every `PackageReferences` category is **required**
(pass `[]` when none) so a sparse extractor cannot silently skip a category and
pass vacuously. A package hand-edited (or mis-rendered) to point at a
non-inventoried surface → **FAIL**. Generated packages are never hand-edited;
this side is the guard.

Together: **`discovery == inventory ⊇ package`**. The combined gate is
`checkParity(discovered, packages, inventory)`.

> **Wire-string trap this side catches.** The inventory's `schemas[]` ids are the
> valid `schema_version` set. A package that references `guild.review_result.v1`
> (the *prose* label) fails subset, because the real inventory id is
> `review_result.v1` (no `guild.` prefix — see §6). The smoke test confirms this
> rejection.

---

## 5. Claude full-tree equivalence contract (SC-2)

The generated Claude artifact (`dist/claude-code/**`) must be **equivalent** to
the committed Claude package across the **full installed tree**, **or** every
delta is an enumerated intentional exclusion. Comparing only plugin.json +
skills/ would pass *vacuously*; the contract spans **seven logical surfaces**
(`equivalence-contract.ts`, `LogicalPackage`):

`manifest` · `commands` · `skills` · `agents` · `hooks_json` · `bootstrap_sh` ·
`mcp_json` · `script_refs`.

**Equivalence ≠ byte-identity.** It is content equivalence after canonical
normalization:

- **JSON**: `normalizeJson` recursively sorts object keys, strips
  `PROVENANCE_FIELDS` (`_rendered_at`, `_source_version`, `generated_at`), and
  sorts the manifest path-arrays (`skills`/`commands`/`agents`).
- **Text**: `normalizeText` normalizes CRLF, strips trailing whitespace, collapses
  trailing blank lines.

The check (`checkClaudeEquivalence`) reports, per surface: present-in-committed/
missing-in-generated, content-differs, and present-in-generated/no-counterpart.
`surfaces_compared` is returned as the **non-vacuity evidence** (must be all 7).

**Anti-vacuity floor:** the check takes an optional third arg `ExpectedSurfaces`
— the id/ref set each surface MUST contain, derived from the inventory by the
caller (L2/L6). Supplied, it turns SC-2 from "compare whatever was loaded" into
"prove the full tree was loaded **and** matches": a snapshot that misloaded
(omitted) a command/skill/agent/script fails the floor instead of passing
vacuously. **A real SC-2 gate MUST pass this floor.**

**`INTENTIONAL_EXCLUSIONS` (closed set)** — any delta NOT listed is a failure:

1. **`hooks_json.SessionStart` using-guild `additionalContext` injection** — L5b
   deliberately changes SessionStart from bootstrap.sh plain-stdout banners to
   `hookSpecificOutput.additionalContext`. Verified by the **L5b golden test**,
   not by this equivalence check (spec SC-8). The caller masks this injection
   before comparing `hooks_json`.
2. **Render-provenance fields** — normalized out, never compared.
3. **Manifest glob ordering** — generated path-arrays are canonically ordered;
   order is not semantic, so it is sorted before compare.

---

## 6. Result-contract registry (item e) — exists vs deferred

`result-contracts.ts` is a **registry, not a redefinition**: it re-exports the
existing validators by reference and marks the rest deferred. This is **L3's
closed target set** — Phase-1 normalizers target exactly the `exists` contracts.

**EXISTS (Phase-1 normalizer targets):**

| Wire `schema_version` | Validator | Kind | Source (verified) |
|---|---|---|---|
| `guild.handoff.v2` | `validateHandoffV2` | strict (rejects unknown keys) | `plugin/hooks/lib/handoff-v2.ts` |
| `review_result.v1` | `parseReviewResult` | lenient (consume-only reader) | `plugin/scripts/verify-gate-pass.ts` |

**DEFERRED (no producer — do NOT design ahead; premature churn):**
`guild.phase_result.v1`, `guild.permission_receipt.v1`, `guild.host_event.v1`,
`guild.qa_result.v1`.

### Two verified corrections (load-bearing — change downstream targets)

1. **Wire-string prefix is inconsistent.** `handoff` carries the `guild.` prefix
   (`guild.handoff.v2`); `review_result` does **not** (`review_result.v1`). The
   parent-ADR/spec prose tables loosely write `guild.review_result.v1`, but
   `parseReviewResult` accepts **only** the bare `review_result.v1`. Normalizers
   and fixtures MUST target the real string (`wire_schema_version`) or they
   mis-key and fail silently. `PHASE1_NORMALIZER_TARGETS` and
   `CONTRACT_VALIDATORS` are keyed on the real strings.
2. **Lenient-reader path.** It is `plugin/scripts/verify-gate-pass.ts`, **not**
   `scripts/lib/` as some spec prose says.

L3 normalizers dispatch through `CONTRACT_VALIDATORS`; a wire string absent from
that map is, by definition, not a Phase-1 target — the normalizer **fails
closed** ("explicit schema error rather than silently accepting prose", parent
ADR §Result contracts).

---

## 7. Consumption map (why each shape is precise)

- **L1** `build-inventory.ts` → emits `plugin/guild.inventory.json` conforming to
  §2; its coverage assertion is `checkCoverage` (SC-7a).
- **L2** `build-host-packages.ts` → renders Claude full-tree + Codex from the
  inventory; `checkClaudeEquivalence` (SC-2) is its target, `checkSubset` (SC-7b)
  its guard; reads the §3 rows.
- **L3** wrapper + normalizers → targets exactly the §6 `exists` set via
  `CONTRACT_VALIDATORS`; fails closed otherwise.
- **L4/L5/L6** consume the schemas + contracts; L6 turns every predicate above
  into failing-then-passing tests (the modules are already smoke-tested to make
  that turnkey).

---

## 8. Verification performed at authoring time

- All five modules typecheck clean (`tsc --noEmit --strict`, exit 0).
- Smoke tests confirm: empty inventory valid / missing-category invalid; both
  capability rows validate; `PHASE1_NORMALIZER_TARGETS = {guild.handoff.v2,
  review_result.v1}`; coverage fails on an unmapped command and passes when
  equal; subset **rejects** `guild.review_result.v1` and accepts the real string;
  equivalence strips provenance, sorts manifest arrays, compares 7 surfaces, and
  fails on command-content drift.
- Existing `handoff-v2` test suite still green (40/40) — changes are additive.
- **Codex G-lane adversarial review (round 1)** returned 6 defects, all fixed:
  (1) deferred schemas now allowed empty `source_path` so L1 can emit from the
  registry; (2) coverage fails when an enforced category isn't scanned
  (anti-vacuity); (3) subset extended to mcp_servers/scripts/hooks; (4) SC-2
  `ExpectedSurfaces` floor added; (5) all ten live hook events modeled;
  (6) Codex `installable` re-annotated as Phase-1 target, not verified. Re-typecheck
  clean + each fix smoke-tested. Trail:
  `.guild/runs/<run-id>/codex-review/G-lane-plugin-architect.md`.

---

## 9. Open confirmations (autonomy = ask)

Surfaced to the orchestrator; downstream may proceed on the PROPOSED shapes:

1. **Inventory `id` conventions** (§2) — confirm the per-category id rules,
   especially skills keyed by frontmatter `name:` (with SKILL.src.md/SKILL.md
   dedupe) and scripts keyed by path−`.ts`.
2. **Codex INFERRED capability values** (§3) — the permission/launch/session/
   interaction rows are inferred; L2/L3 confirm on a live Codex box.
3. **Docs coverage scope** (§4) — RESOLVED (FU-5): the generator now inventories
   the full `docs/**/*.md` tree (id = repo-relative path). Still non-enforced: docs
   are a coverage/curation surface, not a load-bearing package input.

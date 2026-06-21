---
type: handoff
run: run-rearch-w1-20260621
lane: W1-TOOL
specialist: tooling-engineer
phase: build
created_at: 2026-06-21
status: complete
---

# LANE W1-TOOL — shared/ single-source floor (M9, behavior-neutral)

Established `scripts/lib/shared/` as the single canonical home for four
duplicated concerns. Every consumer was repointed and every verbatim/keep-in-sync
copy deleted. Each unit carries a **parity guard** (canonical output == frozen
reference on a sample), an **anti-vacuity control** (a deliberately divergent
variant that MUST diverge — proving the parity check has teeth), and a
**single-impl grep assertion** (exactly one source file *defines* the concern).

**HARD constraints honored:** behavior-neutral; no git commits (lead commits);
zero live-surface delta — only `scripts/lib/**`, `scripts/understand/**`,
`scripts/dot-guild/**`, `mcp-servers/**`, and `scripts/__tests__/**` (test
guards) changed. No `.claude-plugin/`, `commands/`, `skills/`, `agents/`,
`hooks.json`, or any public-entrypoint path was touched. No verbatim copy had
diverged from its canonical — all four collapsed cleanly (no STOP).

> ⚠️ **Note on authoritative design docs:** the prompt referenced
> `.<HIGH_ENTROPY_REDACTED>-rearchitecture/{target-architecture.md,
> audit-findings.md,public-entrypoints.txt}`. **These files do not exist** — the
> only active initiative on disk is `docs-clean-up`. I proceeded from the fully
> specified unit list in the lane prompt + spawn-w1.sh. The public-entrypoints
> constraint was satisfied conservatively: every file the prompt told me to keep
> at its path stayed there with an unchanged export surface (re-exports preserve
> it). Lead should confirm there is no separate entrypoints manifest I couldn't
> see.

## New canonical modules (`scripts/lib/shared/`)

| Module | Exports | Replaces |
|---|---|---|
| `bm25.ts` | `TOKEN_RE`, `tokenize`, `bm25Score` | guild-memory copy + ingest-similarity verbatim copy |
| `graph-scoring.ts` | `<HIGH_ENTROPY_REDACTED>`, `confidenceBonus`, `termMatchScore`, `scoreNode`, `<HIGH_ENTROPY_REDACTED>`, `PROXIMITY_WEIGHT` | kg-query copy + recall `scoreKgNode` inline copy |
| `share-set.ts` | `SHARED_SCRUBBED_NAMES`, `isHandoffFile`, `isPayloadFile`, `inShareSet` | scrub copy + audit keep-in-sync mirror |
| `safe-object.ts` | `PROTO_POISON_KEYS`, `isProtoPoisonKey` | 3× identical `PROTO_POISON_KEYS` |

---

## Unit 1 — BM25 → `<HIGH_ENTROPY_REDACTED>.ts`

- **Canonical move:** algorithm moved out of `mcp-servers/guild-memory/src/bm25.ts`
  into `shared/bm25.ts` (verbatim — k1=1.5, b=0.75, IDF +0.5, tokenize alphanum
  len>1 lowercase).
- **Re-export:** `mcp-servers/guild-memory/src/bm25.ts` is now a thin
  `export { TOKEN_RE, tokenize, bm25Score } from "../../..<HIGH_ENTROPY_REDACTED>"`.
  Its `./bm25` import path (used by `index.ts` and the scripts/guild-memory tests)
  is unchanged.
- **Repointed:** `scripts/lib/recall.ts` import → `./shared/bm25`.
- **Deleted dup:** the verbatim `TOKEN_RE`/`tokenize`/`bm25Score` in
  `scripts/lib/ingest-similarity.ts` — replaced by
  `export { tokenize, bm25Score } from "./shared/bm25"` (its public surface, used
  by `ingest-similarity.test.ts`, is preserved).
- **Guard:** `scripts/__tests__/bm25-parity.test.ts` — parity vs frozen
  reference, anti-vacuity control (k1=2.0 diverges), single-impl (1 definer).
- **guild-memory `dist/index.js`:** intentionally **not rebuilt**. It is the
  committed/shipped runtime artifact (`.mcp.json` → `dist/index.js`); esbuild
  `--bundle` had already inlined the byte-identical BM25, so leaving it gives
  **zero live-surface delta**. A future `npm run build` in guild-memory re-inlines
  `shared/bm25` and is behavior-identical. Confirmed no test rebuilds/diffs
  guild-memory dist (W2 R-DIST scopes `hooks/` only).
- **Side note:** the pre-existing parity assertion inside `ingest-similarity.test.ts`
  (ingest's vs guild-memory's bm25) is now trivially-true (both resolve to shared)
  but still passes; the real anti-vacuous guard is the new `bm25-parity.test.ts`.

## Unit 2 — KG scorer → `<HIGH_ENTROPY_REDACTED>-scoring.ts`

- **Canonical move:** `<HIGH_ENTROPY_REDACTED>`, `confidenceBonus`, `scoreNode`,
  `<HIGH_ENTROPY_REDACTED>`, `PROXIMITY_WEIGHT` moved verbatim out of
  `<HIGH_ENTROPY_REDACTED>-query.ts`. The shared term-match loop is factored into
  a new `termMatchScore` primitive; `scoreNode` calls it (behavior identical).
- **Re-export:** `kg-query.ts` re-exports the four helpers from shared and uses
  `scoreNode`/`<HIGH_ENTROPY_REDACTED>` in `main()`. `kg-query.ts` stays at its path;
  its export surface (consumed by `kg-query-ranking.test.ts`) is unchanged.
- **Repointed:** `scripts/lib/recall.ts` — its inline `scoreKgNode` (an exact
  copy of kg-query's term-match loop) is deleted; the KG branch now calls the
  shared `termMatchScore`. recall's KG branch intentionally ranks on term-match
  only (no <HIGH_ENTROPY_REDACTED>) — that contract is preserved exactly.
- **Guard:** `scripts/__tests__/graph-scoring-parity.test.ts` — parity for all
  four helpers + termMatchScore vs frozen reference across 6 nodes × 6 term-sets,
  anti-vacuity control (exact-match weight 6 diverges), single-impl (1 definer
  each for scoreNode / <HIGH_ENTROPY_REDACTED> / termMatchScore).

## Unit 3 — scrub share-set → `<HIGH_ENTROPY_REDACTED>-set.ts`

- **Canonical move:** `SHARED_SCRUBBED_NAMES` + `isHandoffFile` + `isPayloadFile`
  + `inShareSet` moved out of `scripts/dot-guild/scrub.ts`.
- **Repointed:** `scrub.ts` imports `{ inShareSet, isPayloadFile }`; `audit.ts`
  imports `{ inShareSet }`.
- **Deleted dup:** `audit.ts`'s explicit keep-in-sync mirror
  (`SCRUB_SHARED_NAMES` + `inScrubShareSet`) — it was byte-for-byte equivalent to
  scrub's. `SCRUB_COVERAGE_EXEMPT_NAMES` (audit-only concern) stays. Report
  output strings left untouched (behavior-neutral).
- **Guard:** `scripts/__tests__/share-set-parity.test.ts` — parity across 14
  run-relative paths × both flag states, anti-vacuity control
  (payloads-always-shared diverges), single-impl (1 `inShareSet` definer; asserts
  no `inScrubShareSet`/`SCRUB_SHARED_NAMES` re-spelling remains).

## Unit 4 — proto-poison keys → `<HIGH_ENTROPY_REDACTED>-object.ts`

- **Canonical move:** the `new Set(["__proto__","prototype","constructor"])`
  collapsed from THREE identical copies into `safe-object.ts` (+ a convenience
  `isProtoPoisonKey`).
- **Repointed (files stay at their paths):** `scripts/read-guild-config.ts`,
  `<HIGH_ENTROPY_REDACTED>-resolver.ts`, `scripts/config-cmd.ts` all
  `import { PROTO_POISON_KEYS } from ".../shared/safe-object"`.
- **Guard:** `scripts/__tests__/safe-object-parity.test.ts` — parity (blocks the
  3 dangerous keys, over-blocks no benign key), anti-vacuity control (a set
  missing `constructor` diverges), single-impl (1 `new Set([...__proto__...])`
  definer).

---

## Verification

**Baselines (pre-change) green**, then **post-change green** for every affected
suite, run IN-BAND:

| Suite | Runner | Result |
|---|---|---|
| `bm25-parity` (new) | scripts jest | PASS |
| `graph-scoring-parity` (new) | scripts jest | PASS |
| `share-set-parity` (new) | scripts jest | PASS |
| `safe-object-parity` (new) | scripts jest | PASS |
| `ingest-similarity`, `recall*` | scripts jest | PASS (177) |
| `kg-query-ranking`, `recall*` | scripts jest | PASS (148) |
| `read-guild-config*`, `settings-resolver`, `config-cmd` | scripts jest | PASS (330) |
| `dot-guild/{scrub,scrub-coverage,nested-guild,gitignore-policy}` | tests jest | PASS (45) |
| guild-memory (`__tests__`) | guild-memory jest | PASS (13) |
| **Full `scripts/__tests__` suite** | scripts jest | PASS — 155 suites (1 unrelated skipped), 4274 tests, 0 fail |

**tsx runtime smoke** (the real CLI runtime, beyond ts-jest): `kg-query.ts`,
`ingest-similarity.ts`, `scrub.ts --dry-run`, `config-cmd.ts`,
`read-guild-config.ts` all resolve the new `shared/` imports and run.

**Stale-reference sweep:** no `scoreKgNode`, `inScrubShareSet`, or
`SCRUB_SHARED_NAMES` definitions remain (only comments + the parity tests).
Single-impl confirmed repo-wide: 1 definer each for `bm25Score`, `scoreNode` /
`<HIGH_ENTROPY_REDACTED>`, `inShareSet`, `PROTO_POISON_KEYS`.

No cycles introduced: `safe-object.ts` and `bm25.ts` are leaves; `share-set.ts`
imports only `node:path`; `graph-scoring.ts` imports only types from
`<HIGH_ENTROPY_REDACTED>`.

## For the lead (commit)

Changed (production source): `scripts/lib/shared/{bm25,graph-scoring,share-set,safe-object}.ts`
(new), `mcp-servers/guild-memory/src/bm25.ts`, `scripts/lib/{recall,ingest-similarity,settings-resolver}.ts`,
`<HIGH_ENTROPY_REDACTED>-query.ts`, `scripts/dot-guild/{scrub,audit}.ts`,
`scripts/{read-guild-config,config-cmd}.ts`.
New tests: `scripts/__tests__/{bm25,graph-scoring,share-set,safe-object}-parity.test.ts`.
Not rebuilt (intentional, zero-delta): `mcp-servers/guild-memory/dist/index.js`.

# Handoff — eval-engineer, WAVE 2 (enforcement rails — HARDENED)

- **Run:** run-rearch-w1-20260621
- **Branch:** arch/plugin-rearchitecture
- **Lane:** W2-EVAL (harden the first-pass rails after codex G-lane found 4 must-fixes)
- **Scope respected:** edited only `tests/rearch/**`. **No production source touched.** No git commit (lead commits).
- **W1 status:** production extraction already committed (94e7535); tree clean except `tests/rearch/`.

## TL;DR

All 4 rails hardened so each **DETECTS a planted control** then **passes clean** on the real
tree. 32/32 anti-vacuity proofs pass.

```
cd tests
npx tsx rearch/run-all.ts --prove   # 32 planted-control proofs → EXIT 0
npx tsx rearch/run-all.ts           # real tree → EXIT 1 (R-DIST catches a REAL W1 defect — see followups)
```

| Rail | Mode (after) | Real-tree | Planted control trips? |
|---|---|---|---|
| R-DUP | STRICT | GREEN | yes |
| R-DEP | **STRICT** (layering) | GREEN | yes |
| R-VAC | ADVISORY | GREEN (66 backlog findings) | yes |
| R-DIST | STRICT | RED — real W1 defect | yes |

---

## 1. R-DUP — real duplicate detection, test-scope excluded, canonical-survives

**Hardened (codex fix #1)**
- Replaced signature-only `hits > max` with real duplicate semantics: match scope is
  **non-test source only** (`*.test.ts` + `/__tests__/` excluded via `isTestPath`); the
  canonical `scripts/lib/shared/**` file must be the surviving hit. RED if a concern is in
  >1 non-test source file OR the canonical home is missing from the hits.
- Killed the old false positives (`graph-scoring-parity.test.ts`, `safe-object-parity.test.ts`
  restate signatures for parity — no longer counted).
- Re-pointed the brittle `scrub-share-set` signature: W1 reflowed the single-line literal to
  multi-line (old substring matched 0 files → false RED). Now matches the stable canonical
  API `export function inShareSet(`.

**Planted-control proof:** `export const __DUP_PROBE__ = 1` in TWO source files → TRIPS;
removed from one → CLEAN; single hit that is NOT the canonical file → RED; canonical +
a `*.test.ts` both carrying it → CLEAN (test scope excluded).

**Clean pass:** GREEN, 0 findings — all 4 concerns single-source on their shared home.

## 2. R-VAC — zero-assertion detection added (advisory)

**Hardened (codex fix #2)**
- Kept rule 1 (guard-titled test needs `// @control:`). Added rule 2: ANY `it()`/`test()`
  with ZERO assertions is flagged regardless of title. `countAssertions` (expect/assert/
  assert.*/proveAssert/.should/expectTypeOf) is counted **per-test-body** (`extractTestBodies`
  brace-matches each callback and strips the title-string arg so `it("call expect() first")`
  can't false-match). Exempt: `// @asserts-in-helper`; skipped/todo not counted.

**Planted-control proof:** an assertion-free `it()` body → FLAGGED; an `expect()`-bearing
test → not flagged; one empty test among asserting ones → caught (per-body); `// @asserts-in-helper`
→ exempt.

**Clean pass:** rail GREEN (advisory, never blocks); surfaces **66 backlog findings** on the
real tree (guard/control gaps + zero-assertion tests). W2b burn-down for test owners.

## 3. R-DIST — import-canonicality scan added (+ kept dist byte-compare)

**Hardened (codex fix #3)**
- Kept temp-dir esbuild byte-compare (NEVER mutates tracked files — builds to `os.tmpdir()`
  + `rmSync`).
- Added import canonicality: each `scripts/lib/shared/**` basename is canonical; a consumer
  importing that concern from a path resolving OUTSIDE the floor is flagged — UNLESS the
  target is a **pure re-export shim** of the floor (`isReExportShim`: all relative specs
  resolve into shared/, no local `function`/`class`/`const =`). Real shim case correctly
  passed: `mcp-servers/guild-memory/src/bm25.ts` re-exports canonical bm25.

**Planted-control proof:** import `"../dup/bm25"` (non-canonical copy) → TRIPS;
import `"../lib/shared/bm25"` (canonical) → PASSES; import a re-export shim of the floor →
PASSES; import a target with a LOCAL `bm25Score` body → TRIPS even with a resolver.

**Clean pass / real finding:** canonicality GREEN (0 findings, 248 files). Dist byte-compare
RED on `run-trace.js` — rail working correctly, see followups.

## 4. R-DEP — STRICT layering + type-only exception

**Hardened (codex fix #4)**
- Promoted layering floor to **STRICT** (`pass:false` on a runtime upward import from a
  `scripts/lib/shared/**` module). Added the type-only exception: `import type`/`export type`
  and fully-inline-typed clauses `{ type A, type B }` are allowed (zero runtime coupling); a
  MIXED clause `{ type A, runtimeB }` still flags. Circularity (`madge`) stays an advisory
  sub-check, skipped until installed.

**Verification (the exact case codex named):**
- `graph-scoring.ts` `import type { GraphNode, GraphEdge } from "../..<HIGH_ENTROPY_REDACTED>"`
  → **PASSES** (type-only, proven).
- A RUNTIME value import of the SAME path
  (`import { validateGraph } from "../..<HIGH_ENTROPY_REDACTED>"`) → **FAILS** (planted
  control — proves the exception keys on the keyword, not the path).

**Clean pass:** GREEN, 0 findings — all 4 floor modules clean.

---

## followups: (W1 owners — NOT fixed here; production source is W1's lane)

- **[blocker → hook-engineer / tooling-engineer] R-DIST RED: `hooks/dist/run-trace.js` is a
  STALE committed bundle.** A fresh esbuild differs from the committed bundle — W1's
  `<HIGH_ENTROPY_REDACTED>-object.ts` extraction moved where `PROTO_POISON_KEYS` is emitted,
  but the committed `run-trace.js` predates the rebuild (commit 94e7535 did not rebuild
  hooks dist). Fix: `npm run build` in `hooks/`, commit regenerated `dist/run-trace.js`.
  This is exactly the divergence R-DIST exists to catch. Determinism note: the rail is
  deterministic for a fixed committed bundle (consistently RED across 4 runs on the
  as-committed bundle); an earlier transient GREEN was only because a stray `npm run build`
  had rebuilt the working-tree file mid-session — I restored it to HEAD so the tree is clean.

- **[advisory → test owners] R-VAC 66-finding backlog** — guard tests missing `// @control:`
  links + zero-assertion tests (several are mermaid/doc-string table placeholders in
  `cross-link.test.ts`, `convert.test.ts`, or parameterized titles asserting via a shared
  helper). Annotate genuine exemptions `// @asserts-in-helper`; add controls/assertions to
  the rest before promoting R-VAC to strict in W2b.

- **[advisory → tooling-engineer] `madge` not installed** — R-DEP circularity sub-check
  skipped. Add `madge` devDependency to activate
  `npx madge --circular --extensions ts scripts mcp-servers` (must report 0).

## evidence:
- `cd tests && npx tsx rearch/run-all.ts --prove` → EXIT 0, **32/32 proofs pass** ("All rails proved non-vacuous ✓").
- `cd tests && npx tsx rearch/run-all.ts` → EXIT 1; R-DUP GREEN(0), R-DEP GREEN(0), R-VAC GREEN(66 advisory), R-DIST RED(1 = real run-trace.js staleness).
- `git status` clean except `tests/rearch/` (restored `hooks/dist/run-trace.js` to HEAD).
- No commits (lead commits).

## files:
- <HIGH_ENTROPY_REDACTED>-dup.ts
- <HIGH_ENTROPY_REDACTED>-vac.ts
- <HIGH_ENTROPY_REDACTED>-dist.ts
- <HIGH_ENTROPY_REDACTED>-dep.ts
- <HIGH_ENTROPY_REDACTED>-all.ts
- <HIGH_ENTROPY_REDACTED>.md

LANE W2-EVAL DONE.

```guild.handoff.v2
{
  "schema_version": "guild.handoff.v2",
  "task_id": "W2",
  "tier": "mid",
  "status": "done",
  "summary": "Wave 2 — authored and hardened the enforcement-rails suite (rearch architecture rails), each with an anti-vacuity control proving the rail is non-vacuous. W1 production extraction already committed (94e7535); tree clean except tests/rearch/. Not committed (lead commits).",
  "artifacts": [
    ".guild/runs/run-rearch-w1-20260621/handoffs/eval-engineer-W2.md"
  ],
  "issues": []
}
```

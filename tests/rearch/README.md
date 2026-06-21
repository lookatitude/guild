# `tests/rearch/` — re-architecture enforcement rails (Wave 2)

Runnable checks that enforce the §4 enforcement rails of the plugin re-architecture.
They are **standalone `tsx` scripts**, not jest tests — they shell out to `git` /
`esbuild` and walk the whole plugin tree, which jest's ts-jest module mapping would only
get in the way of. Each rail is **anti-vacuous**: it carries a `--prove` mode that runs
its detector against a known-bad synthetic input and asserts the detector trips. A rail
whose `--prove` fails is itself broken and must not be trusted green.

## Run

```bash
cd tests
npx tsx rearch/run-all.ts           # run every rail; exits non-zero iff a STRICT rail is RED
npx tsx rearch/run-all.ts --prove   # anti-vacuity self-test of every rail
npx tsx rearch/r-dup.ts             # one rail
npx tsx rearch/r-dup.ts --prove     # prove one rail can fail
```

## Rails

| Rail | Mode | What it enforces | Today |
|---|---|---|---|
| **R-DUP** | STRICT | Each of 4 consolidated concerns lives in EXACTLY the canonical `scripts/lib/shared/` file. Real duplicate detection: match scope is non-test source only (`*.test.ts` + `/__tests__/` excluded — parity tests legitimately restate a signature); RED if a concern appears in >1 non-test source file OR the canonical home is not the surviving hit. | GREEN (post-W1, single-source) |
| **R-DEP** | **STRICT** (layering) / advisory (circularity) | `scripts/lib/shared/` is the dependency FLOOR — modules there must not RUNTIME-import upward. `import type {…}` / `export type {…}` / fully-inline-typed clauses `{ type A }` are an explicit allowed exception (zero runtime coupling). `madge --circular` is the advisory sub-check (skipped until `madge` installed). | GREEN (4 floor modules clean) |
| **R-VAC** | ADVISORY | (1) a guard-named test must carry a `// @control: <link>`; (2) **NEW** — every individual `it()`/`test()` must contain ≥1 assertion (expect/assert/proveAssert/.should), counted per-test-body, or be marked `// @asserts-in-helper`. | 66 findings (backlog) |
| **R-DIST** | STRICT | (1) committed `hooks/dist/**` + `hooks/agent-team/dist/**` bundles are byte-identical to a fresh `esbuild` (temp-dir build — never mutates tracked files); (2) **NEW** — import canonicality: a consumer must not import a shared concern from a non-canonical duplicate path. A pure re-export shim that points at the canonical floor is allowed. | GREEN (15 in sync, canonicality clean) |

**Strict** rails (R-DUP, R-DIST, R-DEP layering) set a non-zero exit when red. The
**advisory** rail (R-VAC) reports findings as W2 backlog but never blocks; R-DEP's
circularity sub-check is also advisory and never blocks on its own.

## Wiring (for the lead, post-W1)

W1 is merged and all three strict rails (R-DUP, R-DIST, R-DEP layering) are GREEN on the
real tree — wire `npx tsx rearch/run-all.ts` into CI as a blocking step. R-VAC stays
advisory until its 66-finding backlog (guard/control links + zero-assertion tests) is
burned down; promote it to strict in W2b after.

## devDependencies note

- **R-DEP** wants `madge` (not yet installed). Add to the umbrella/root tool deps, then the
  circularity check activates automatically (`npx madge --circular --extensions ts scripts mcp-servers`).
- **R-DIST** uses `esbuild`, already a `hooks/` devDependency.
- Everything else uses `tsx` (already present in `tests/`, `scripts/`, `hooks/`).

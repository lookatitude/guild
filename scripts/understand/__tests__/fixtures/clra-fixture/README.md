# CLRA shared fixture + oracle

The **shared test fixture** for the *Codebase Learning & Recall Acceleration*
initiative (`G14`). A small, realistic, multi-language mini-codebase with
**hand-labeled ground truth** in [`clra-fixture.expected.json`](./clra-fixture.expected.json).
Every goal's validation gate (G1, G3, G8, G9, …) asserts its extraction/query
output against this one oracle, so the gates stay consistent and non-vacuous.

> **One shared fixture.** G1 may carry a tiny local fixture during development;
> this is the canonical shared one. Lanes migrate to it — don't fork it.

## Layout

```
clra-fixture/
├── src/                 TypeScript mirror
│   ├── a.ts             entry point (main); cross-file + intra-file calls; clone pair
│   ├── b.ts             utility module; a DEAD function (unusedHelper)
│   └── shapes.ts        Circle extends Shape implements Drawable
├── py/                  Python mirror of the same shapes
│   ├── a.py             entry point (main); calls; clone pair
│   ├── b.py             utility module; a DEAD function (unused_helper)
│   └── shapes.py        Circle(Shape)   (no interfaces in Python)
└── clra-fixture.expected.json   the oracle
```

## Oracle format (`clra-fixture.expected.json`)

All ids follow the LOCKED node-id convention from
`understand/lib/graph.ts`: **`<type>:<relpath>[:<name>]`**, where `relpath` is
**relative to this fixture root** (e.g. `function:src/a.ts:main`,
`file:src/b.ts`, `class:src/shapes.ts:Circle`).

| Section | Shape | Meaning |
|---|---|---|
| `files` | `string[]` of `file:<relpath>` | every source file in the fixture |
| `calls` | `{ from, to, cross_file }[]` | known call edges (function→function). `cross_file` is `true` when caller and callee live in different files |
| `imports` | `{ importer, source, symbols[] }[]` | `importer` is a `file:` id; `source` is the module specifier as written; `symbols` are the imported names |
| `inherits` | `{ child, parent }[]` | class inheritance edges (`extends` / `class Child(Parent)`) |
| `implements` | `{ class, interface }[]` | interface implementation edges (TS-only) |
| `deadCode` | `string[]` of `function:` ids | functions with **zero callers that are not entry points** |
| `entryPoints` | `string[]` of `function:` ids | program entry points (excluded from dead-code) |
| `clonePairs` | `[idA, idB][]` | near-duplicate function pairs (for similarity / G8) |

### Scope rules (read before asserting)

- **Dead-code is module-level functions only.** Class methods (e.g. `Shape.area`,
  `Circle.draw`) are intentionally **out of scope** for `deadCode`. A dead-code
  gate must compare against `function:` nodes, filtering out methods — matching
  the oracle's scope. This keeps the gate well-defined without requiring
  method-dispatch resolution.
- **`calls` covers function→function edges**, not method-dispatch calls
  (`c.draw()`); those need type resolution (G2) and are deliberately excluded so
  the oracle stays deterministic and resolver-independent.
- **`implements` is TS-only.** Python has no interfaces, so `py/shapes.py` mirrors
  only the `inherits` edge.
- **Interfaces** (`Drawable`) are `class:<relpath>:<Name>` ids by convention even
  though they are `interface` declarations in source.

### How a gate consumes the oracle

```ts
const oracle = JSON.parse(fs.readFileSync(".../clra-fixture.expected.json", "utf8"));
// G3 example:
const dead = kgDeadCode(graph).filter(isFunctionNode);
expect(new Set(dead)).toEqual(new Set(oracle.deadCode));
```

The conformance suite ([`../../clra-conformance.test.ts`](../../clra-conformance.test.ts))
proves the oracle is **self-consistent** — every labeled id resolves to a real
fixture symbol (grounded in the repo extractor `analyzeSource`), dead functions
truly have no callers, and `cross_file` flags are accurate — with anti-vacuity
tests that confirm a broken oracle entry is caught.

## SQLite-optional parity

Every CLRA feature must answer **identically** with the SQLite index cache
`off` (the source of truth) and `on` (acceleration). Gates assert this with the
parity harness ([`../../../lib/parity-harness.ts`](../../../lib/parity-harness.ts)):

```ts
import { runBothIndexModes } from "../lib/parity-harness";
const outcome = runBothIndexModes((ctx) => myStructuralQuery(ctx.config), {
  overrides: { kg_node_threshold: 0 }, // ensure the projection engages on small graphs
});
expect(outcome.identical).toBe(true);
expect(outcome.ranBoth).toBe(true);   // neither mode silently skipped
```

`ctx.config` is an `IndexBlock` with `enabled` forced to match the mode; pass it
to `ensure*Index()` so the `on` run uses the SQLite projection and the `off` run
falls back to the canonical JSON.

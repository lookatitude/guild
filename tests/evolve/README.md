# tests/evolve — Evolve pipeline cross-cutting fixtures

## Purpose

These fixtures and harness tests target the **evolve pipeline** implemented by
`scripts/flip-report.ts` (guild-plan.md §11.2 step 6). They provide held-out
regression scenarios that **the per-script fixtures under `scripts/fixtures/`
do not cover** — specifically, the boundary between promote-eligible and
reject-eligible grading outcomes, and malformed-input handling.

The risk addressed is guild-plan.md §15.2 row 4: "Evolution loop overfits to
its own evals." Held-out fixtures with realistic but fake task/tool/specialist
names catch regressions that only appear when the full promote/reject decision
is exercised end-to-end.

## Schema reference

All grading fixtures match the schema consumed by `scripts/flip-report.ts`:

```json
{
  "current":  [{ "case_id": string, "passed": boolean, "ms": number, "tokens": number }],
  "proposed": [{ "case_id": string, "passed": boolean, "ms": number, "tokens": number }]
}
```

The script reads the fixture from:

```
<cwd>/.guild/evolve/<run-id>/grading.json
```

and writes a flip report to:

```
<cwd>/.guild/evolve/<run-id>/flip-report.md
```

## Fixture inventory

| File | Intent | Expected outcome |
|---|---|---|
| `fixtures/regression-heavy.json` | ≥5 P→F regressions + 2 F→P fixes | Reject (regressions > fixes) |
| `fixtures/pure-fixes.json` | 0 regressions + ≥5 F→P fixes | Promote |
| `fixtures/neutral.json` | 0 flips, tokens reduced >10% | Promote (efficiency win) |
| `fixtures/malformed.json` | Missing `proposed` key | Exit 1 (bad input) |

## Harness test file

`harness.test.ts` — invokes `scripts/flip-report.ts` via `npx tsx` against
each fixture and asserts the expected outcome. Each test writes grading.json
into a temporary directory (OS tmpdir) so runs are isolated and idempotent.

## P7+ integration

In Phase 7 the promote/reject decision will be codified as a structured verdict
field in the flip report front-matter. The harness tests here are designed to
assert on that verdict field once it is added — the test bodies already check
the content shape that a verdict field would need to satisfy.

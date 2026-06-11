# Knowledge-tier fixture corpus (L0f)

Frozen, deterministic mini-corpus for the `guild.knowledge_graph.v2` knowledge tier.
This is the **TDD contract** every K-lane (L1–L5, L8, L11) and the per-SC evals (L9)
go red→green against. Tiny and deterministic — no wall-clock, no network, no random.

## Layout

| Path | Role |
|---|---|
| `index.md` | Karpathy-shaped wiki index (5 `[[wikilinks]]`) |
| `docs/{overview,ingestion,validation,storage,concepts}.md` | 5 content pages (6 md total) |
| `docs/ingestion.md` | holds the **1** fenced ` ```mermaid ` block (`#mermaid-0`) + 2 cross-page wikilinks |
| `src/{ingest,validate,store}.ts` | 3 code files with doc-comments (claims/entities/concepts) |
| `diagrams/architecture.svg` | the 1 `.svg` (`#svg`; element ids `ingest-box`/`validate-box`/`store-box`) |
| `expected-output.json` | **per-SC assertion contract** — load this, assert the named section |
| `expected-graph.v2.json` | all-valid v2 graph projection; passes `validateGraphV2({repoRoot: <thisDir>})` |
| `bad-nodes.json` | negative fixtures (validator-rejected + wiki-lint-flagged + bad subgraphs) |

## How a K-lane test loads it

```ts
import * as path from "path";
const FIX = path.join(__dirname, "../understand/__tests__/fixtures/knowledge");
const expected = require(path.join(FIX, "expected-output.json"));
// repoRoot for validateGraphV2 / anchor resolution is FIX itself.
```

Anchors resolve **against this directory** (it is the corpus repo root). Pass `FIX` as
`repoRoot` to `validateGraphV2`.

## Determinism caveat (read before asserting exact ids)

- **Assert exactly:** `wiki_page:<relpath>`, `diagram:<anchor>`, `entity:<normalized-name>`,
  code `file:`/`function:` ids, all `related` edges, the `subtopic_of` tree shape, anchors.
- **Assert structure (not the hash):** `topic:` ids hash the cluster member-set; `claim:`/`concept:`
  ids hash LLM-extracted text. Reproducible only if the stage extracts the pinned member-set/text.
  For LLM stages assert counts / depth / ordering / link-by-anchor-pair, not the hashed id.

See `expected-output.json._determinism_caveat` and `.notes_for_lane_owners` for the per-lane split.

## Seeded relationships (the SC anchors)

- **claim→code `evidenced_by`** (SC-4/5): `claim:docs/ingestion.md#ingestion:0ee19523` →
  `function:src/validate.ts:validateEvent` (1 hop; target anchor `src/validate.ts#L16-L20`).
- **topic→diagram `evidenced_by`** (SC-3/7): `topic:79c825b8` (Ingestion) → `diagram:docs/ingestion.md#mermaid-0`.
- **≥3-deep `subtopic_of` branch** (SC-2): Event Pipeline → Ingestion → Source Adapters → Webhook Adapter (depth 3; ≤ maxDepth 8, root fan-out 3 ≤ 12).
- **high/low importance sibling pair** (SC-13): under root, Ingestion (0.85, high) vs Validation (0.45, low).
- **semantic domain ≠ top-level dir** (SC-5): `domain:event-ingestion` "Event Ingestion" (dirs are `docs`/`diagrams`/`src`); topics `79c825b8`,`2c7639cd` `belongs_to_domain`.
- **wiki 1:1** (SC-3): 6 pages → 6 `wiki_page` nodes; 8 `[[wikilinks]]` → 8 `related` edges; every page has non-null `category`+`importance`+`labels[]`.
- **bad-node fixtures** (SC-6/L8): out-of-enum `category` + topic missing `importance_score` (validator-rejected); `wiki_page` missing string `importance` (wiki-lint-flagged).

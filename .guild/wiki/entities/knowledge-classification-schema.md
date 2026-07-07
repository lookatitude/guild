---
type: concept
owner: architect
confidence: high
importance: high
source_refs: ["plugin/scripts/understand/lib/schema.ts", "plugin/.guild/wiki/entities/codebase-understanding.md"]
created_at: 2026-06-12
updated_at: 2026-06-12
expires_at: null
sensitivity: public
applies_to: [plugin]
related: [codebase-understanding, contract-map, knowledge-and-advisory, memory-and-knowledge, target-architecture, v2-index, knowledge-graph-v2-schema-boundary]
---

# Knowledge Classification + Labeling Schema (`guild.knowledge_graph.v2`)

**Status: implementation-ready `[v2]`.** The frozen, versioned **metadata
contract carried on every v2 knowledge node** (`topic`, `concept`, `claim`,
`entity`, `wiki_page`, `diagram`). It is the SC-6 contract of the
`learn-knowledge-tier` initiative, read by **two consumers**: `kg-query`
recall-ranking (SC-13) and the `wiki-lint` knowledge-node check (SC-6).

The contract is **defined in code** —
[`plugin/scripts/understand/lib/schema.ts`](../../../plugin/scripts/understand/lib/schema.ts)
(`NODE_CATEGORIES`, `KNOWLEDGE_CONFIG_DEFAULTS`, the `GraphNode` interface, and
`validateGraphV2`). This page is the human-readable companion; **the validator
is the source of truth.** Field names and enum members are cited from
`schema.ts`, never re-spelled with edits. The closed node/edge sets and the
v1-read/v2-write boundary live in
[`codebase-understanding.md`](codebase-understanding.md) §"The knowledge tier"
and in the contract-map row
[`implementation/contract-map.md`](../../../../.guild/wiki/_archive/v2-design/implementation-plans/contract-map.md) §B-post;
the durable WHY (and the D-4 determinism contract this schema's consumers bind
to) is ADR
[`../decisions/knowledge-graph-v2-schema-boundary.md`](../../../../.guild/wiki/decisions/knowledge-graph-v2-schema-boundary.md).

## Why a separate contract

The v1 `KnowledgeGraph` (`guild.knowledge_graph.v1`) carried only
`type` / `name` / `source_refs` / `confidence` on its nodes. The knowledge tier
adds a **classification + labeling axis** so a topic graph is precise and
rankable during recall, lintable for hygiene, and renderable in the benchmark
UI. These fields are what make a knowledge node *discoverable by meaning* rather
than only by id/name.

## The metadata fields

Carried on knowledge nodes (`topic` / `concept` / `claim` / `entity` /
`wiki_page` / `diagram` — `KNOWLEDGE_NODE_TYPES_V2` in `schema.ts`). The
validator's enforcement column states what `validateGraphV2` actually rejects.

| Field | Type | Required on | Meaning | Validator enforcement |
|---|---|---|---|---|
| `category` | closed enum (see below) | **all** knowledge nodes | The single primary classification of the node. | Missing → node **dropped**; out-of-enum → node **dropped** (SC-6). |
| `importance` | `high` \| `medium` \| `low` | **`wiki_page`** (K2-assigned) | Human-facing importance label. | Not validator-gated; `wiki-lint` flags a **`wiki_page`** missing it (SC-6 lint half) — see the per-type matrix below. |
| `importance_score` | number `0–1` | **`topic` nodes** | The numeric importance that drives the taxonomy threshold filter. | Missing on a `topic` → node **dropped**; `< minTopicImportance` (default `0.4`) → node **dropped / folded into parent** (SC-2). |
| `confidence` | `high` \| `medium` \| `low` | all nodes (frozen field) | Extraction/judgment confidence on the node itself. | Defaulted to `low` if absent (v1 auto-fix ladder, inherited by v2). |
| `labels[]` | `string[]` | `wiki_page` (K2-assigned) | Free-form, model-assigned classification tags (default `[]`); `wiki_page` only. | Not gated; consumed by render. |
| `topic_path` | `string[]` | `topic` nodes | Root→node slug chain locating the topic in the taxonomy. | Not gated as a field; the `subtopic_of` tree it mirrors **is** gated (acyclic, depth ≤ `maxDepth`, fan-out ≤ `maxBranching`). |

### Per-node-type field matrix (the importance-field contract)

**Different knowledge node types carry different importance fields.** This is the
canonical contract the L8 `wiki-lint` code conforms to — stated here so the lint
and the doc never drift, and so no contributor re-introduces the
"all-six-types" confusion (linting a `claim`/`concept`/`entity`/`diagram` for a
missing `importance` is a **false positive** — they carry `confidence`, not
`importance`).

| Node type | `category` (closed enum) | Importance field | `confidence` | `topic_path` | `labels[]` | Missing-`importance` lint? |
|---|---|---|---|---|---|---|
| `topic` | required (validator) | **`importance_score`** — numeric `0–1`, K4-assigned, **validator-enforced** (missing → node dropped; `< minTopicImportance` → folded) | enum | yes | where assigned | n/a — validator-gated, not linted |
| `wiki_page` | required (validator) | **`importance`** — string `high\|medium\|low`, K2-assigned, **NOT** validator-enforced | enum | — | where assigned | **YES — `wiki-lint` checks `wiki_page`** |
| `claim` | required (validator) | — (uses `confidence`) | enum | — | where assigned | **No** (false positive if linted) |
| `concept` | required (validator) | — (uses `confidence`) | enum | — | where assigned | **No** |
| `entity` | required (validator) | — (uses `confidence`) | enum | — | where assigned | **No** |
| `diagram` | required (validator) | — (uses `confidence`) | enum | — | where assigned | **No** |

`category` is required and **validator-enforced on all six** (out-of-enum →
node dropped). `topic_path` is carried only on `topic` nodes; `labels[]` is
assigned only on `wiki_page` nodes (K2 classification — see §"Field provenance"
below). The **only** node type subject to the missing-`importance` lint is
`wiki_page`.

### `importance` (label) vs `importance_score` (numeric) — do not conflate

These are **two distinct fields** (per the `schema.ts` `GraphNode` comment):

- `importance` is a **display label** (`high|medium|low`) for the UI and
  `wiki-lint`.
- `importance_score` is the **numeric `0–1`** field that drives the
  `minTopicImportance` threshold fold (SC-2). A `topic` below the threshold is
  **never emitted** — it is folded into its parent. Only `topic` nodes are
  required to carry it.

### `confidence` is an enum at the node level

The spec's SC-6 shorthand writes "`confidence` (0–1)"; the **frozen** node
contract keeps `confidence` as the `high|medium|low` enum (the v1 `CONFIDENCE`
set, unchanged in v2). The **numeric `0–1`** confidence lives on **edges**:
LLM-judged `relates_to` / `evidenced_by` edges carry `weight` and must clear
`relMinConf` (default `0.5`). `kg-query` ranking maps the node enum to a numeric
rank factor — the exact mapping is owned by L11 (see TODO below).

## The `category` closed enum

Frozen in `schema.ts` `NODE_CATEGORIES`. `validateGraphV2` **rejects any value
not in this set** on a knowledge node. Grouped as the source defines them:

- **Code structure** — `function`, `class`, `module`, `config`, `endpoint`,
  `pipeline`, `schema`
- **Knowledge** — `concept`, `fact`, `claim`, `principle`, `definition`,
  `example`
- **Documentation** — `guide`, `tutorial`, `reference`, `overview`,
  `changelog`, `architecture`
- **Organizational** — `decision`, `standard`, `recipe`, `checklist`
- **Content** — `component`, `domain`, `diagram`, `index`, `note`

To add a category, edit `NODE_CATEGORIES` in `schema.ts` (the closed set is a
deliberate gate — a new value is a code change + a re-validated graph, not a
free-text addition).

## Relationship to the wiki `labels:` axis (distinct, not the same schema)

Guild has **two** classification axes; they are related but **must not be
conflated**:

| Axis | Where | Closed by | Purpose |
|---|---|---|---|
| Knowledge-node `category` + `labels[]` | `KnowledgeGraph` nodes (`.guild/indexes/knowledge-graph.json`) | `NODE_CATEGORIES` (frozen in `schema.ts`) | Classify **derived graph nodes** for recall-ranking + lint + render. |
| Wiki-page `labels:` frontmatter (`domain` / `feature` / `component` / `concern` / `status` / `relevance`) | Canonical `.guild/wiki/` pages | `.guild/project.yaml → label_taxonomy:` (project-scoped, human-gated) | Classify **canonical wiki pages** for advisory-agent retrieval. |

The canonical wiki `labels:` axis is defined in
[`../knowledge-memory/memory-and-knowledge.md`](memory-and-knowledge.md)
and
[`../knowledge-memory/knowledge-and-advisory.md`](knowledge-and-advisory.md).
A `wiki_page` knowledge node is a **derived projection** of a canonical wiki
page; its node `category`/`importance`/`labels[]` are computed by K2
(wiki/KB index) and do **not** overwrite the page's canonical `labels:`
frontmatter (the wiki stays canonical, the graph is the derived index).

## The two consumers

### `kg-query` recall-ranking (SC-13, lane L11)

`kg-query` extends scoring beyond name/id/`source_refs` to use **importance +
confidence + topic proximity**, within the existing graph retrieval sub-budget
(1200 tokens, unchanged — see
[`knowledge-and-advisory.md`](knowledge-and-advisory.md)
§"Graph-retrieval budget sub-policy"). The shipped formula
(`kg-query.ts`, deterministic — no LLM):

```
finalScore = termScore × (1 + importanceMultiplier) + confidenceBonus + proximityBonus
```

- **`importanceMultiplier` ∈ [0,1]** — numeric `importance_score` (clamped)
  **takes precedence**; else the string `importance` maps `high→0.8`,
  `medium→0.4`, `low→0.1`; else `0`. Multiplicative: `importance_score=1` ⇒ 2×.
- **`confidenceBonus`** — additive tie-breaker: `high→+0.3`, `medium→+0.1`,
  `low`/undef `→+0` (never overrides a substantial importance gap).
- **`proximityBonus`** — a matched `topic` lifts its `subtopic_of` parent by
  `childScore × 0.1` (MAX per parent; topic-source → topic-target only).
- **No term match ⇒ score `0`** — importance cannot surface a node with no
  semantic relevance. So a high-importance topic outranks a low-importance
  sibling **only among nodes the query already matched**.

This same recall order (`importance_score` desc → `confidence` bonus desc →
`id` asc) sorts the nodes in the `knowledge-recall.json` projection
(`sortNodesByRecall`).

### `wiki-lint` knowledge-node check (SC-6, lane L8)

`wiki-lint` flags two distinct conditions (the lint half of SC-6; the validator
half is `validateGraphV2` rejecting at write time):

- a **`wiki_page`** node **missing `importance`** (string label) — **only**
  `wiki_page` is checked; `claim`/`concept`/`entity`/`diagram` carry
  `confidence`, not `importance`, so linting them for missing `importance` is a
  false positive (see the per-type matrix);
- **any** knowledge node carrying an **out-of-enum `category`** (all six types
  are validator- and lint-checked for `category`).

## Configuration

Thresholds that interact with this schema live in `models.knowledge.*`
(`KNOWLEDGE_CONFIG_DEFAULTS` in `schema.ts`; overridable in `settings.json`,
bound by pointer to the cost-aware-tiering ADR §10):

- `minTopicImportance` (default `0.4`) — `importance_score` fold threshold.
- `relMinConf` (default `0.5`) — minimum edge confidence for LLM-judged
  `relates_to` / `evidenced_by`.
- `maxDepth` (`8`) / `maxBranching` (`12`) — the `topic_path` / `subtopic_of`
  tree bounds.

## Field provenance (reconciled against shipped code, 2026-06-12)

- **`labels[]`** is **free-form**, model-assigned, on **`wiki_page` nodes only**
  — the K2 `classifyPage` seam returns `{category, importance, labels[]}`
  (default `[]`). It is **not** a project-scoped closed set, and `OQ-4` resolved
  to a fresh K2 classifier (not a `classify-proposal.ts` reuse). No other node
  type carries the classification `labels[]` (diagram nodes carry a separate
  `svg_labels` field — raw SVG text, not classification labels).
- **`topic_path`** is the **slugified parent chain** root→leaf
  (`taxonomy-build.ts` `deriveTopicPath` → `slugifyTopicName` per segment),
  carried on `topic` nodes only. It is a **display/locator** field — it is
  **not** the heading-slug anchor form `validateGraphV2` resolves (anchors live
  in `source_refs`), so the two need not match.
- **`importance_score`** is set by K4 (`taxonomy-build`) on topics; **string
  `importance`** is set by K2 on `wiki_page`; the per-type contract above is
  mirrored verbatim in the `wiki-lint-knowledge.ts` header (the lint and this
  doc are kept in agreement — this doc is the human-facing canonical).
- **`category`** values come from the LLM seams (K2 page classification, K1/K4
  naming) but are **validator-gated** against `NODE_CATEGORIES` — an out-of-enum
  value drops the node.

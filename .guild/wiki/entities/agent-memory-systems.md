---
type: concept
owner: architect
confidence: high
importance: critical
source_refs:
  - .guild/research/cost-techniques.md
  - .guild/research/persistence-schema.md
  - .guild/wiki/_archive/v2-design/sources/12-knowledge-graph-semantic-indexing.md
  - .guild/wiki/_archive/v2-design/sources/14-session-learning-extraction.md
applies_to: [plugin]
related:
  - knowledge-and-advisory
  - memory-and-knowledge
  - agent-memory-sqlite-cache
  - cost-tiering-and-context-management
created_at: 2026-05-28
updated_at: 2026-05-28
sensitivity: internal
---

# Agent Memory Systems

Distilled canonical reference for Guild's memory architecture: the layers, retrieval
primitives, recall scoring, promotion pipeline, and upgrade thresholds.

## Memory Layer Model

Guild treats memory as a single connected model, not isolated stores. The layers,
in order of durability and retrieval cost:

| Layer | Store | Lifetime | Recall primitive |
|---|---|---|---|
| Wiki (canonical) | `.guild/wiki/**` Markdown | project | BM25 via `guild-memory` MCP |
| Knowledge graph | `.guild/indexes/knowledge-graph.json` | rebuildable | full-parse; 2-hop traversal |
| Knowledge links | `.guild/indexes/knowledge-links.json` | rebuildable | full-parse; edge scan |
| Run provenance | `.guild/runs/<id>/provenance.json` | 90d | glob + full-parse |
| Raw sources | `.guild/raw/sources/**` | project | source-only; never enters context directly |
| SQLite derived cache | `.guild/index.sqlite` | ephemeral / gitignored | FTS5 BM25; < 5 ms at scale |

**Invariant:** Filesystem is the canonical source of truth. SQLite is a rebuildable
derived cache — delete `index.sqlite` and zero data is lost; only speed is lost.
This is the memweave contract applied to Guild. [source: `.guild/research/persistence-schema.md §1.1`]

## Retrieval Ordering (Recall-Before-Read Rule)

Before any specialist reads a file, the coordinator MUST call `wiki_search` with the
task description. If one or more chunks return above `recallScoreThreshold` (default
0.4), the agent receives those chunks plus specific file references — not a full file
dump. Full file reads are permitted only when recall returns zero results or the task
explicitly requires source-of-truth verification.

This rule is enforced in `settings.json → costTiering.recallBeforeRead: true`.

## BM25 vs Vector vs Hybrid

The 2025–2026 research consensus on retrieval for agents [source: `.guild/research/persistence-schema.md §1.2`]:

- **BM25 (FTS5)** wins on exact-match: identifier names, decision IDs, schema version
  strings, file paths. Zero embedding cost. Guild's v2 recall layer uses BM25 exclusively.
- **Vector (cosine)** wins on semantic drift — finding a concept when the exact keyword
  is unknown. Requires an embedding pipeline (~80 MB model or an API call per chunk).
- **Hybrid (BM25 + vector, Reciprocal Rank Fusion)** is strictly better than either alone
  on mixed query populations. Hybrid recall: 0.72 → 0.91 (+26%) precision uplift at 60
  RRF. Default weight when enabled: 70% vector / 30% BM25.

**Guild v2 decision:** BM25-only is the correct starting point (G3: no embeddings until
measured slowness or precision miss is evidenced). Evidence threshold to switch:
> 15% of `context-assemble` retrievals marked `low_confidence` AND BM25 below correct
node in top-3 on > 20% of sampled queries.

## Knowledge Graph Schema and Retrieval Planner

The graph schema connects Guild's structured entities [source: `.guild/wiki/_archive/v2-design/sources/12-knowledge-graph-semantic-indexing.md §Guild Implications`]:

```
Feature → Task → Artifact → Source
                          → Decision → Standard
Specialist → Skill → Eval
File → Component → Feature
```

Retrieval planner sequence:
1. Parse request into categories, entities, domain tags.
2. BM25 search over wiki.
3. Traverse graph edges for related decisions, artifacts, owners, standards.
4. Use embeddings only when lexical/graph results are low-confidence (and G3 gate is met).

**Invalidation rules:**
- File checksum change → invalidate symbol/component edges.
- Wiki page `updated_at` change → invalidate text index row.
- Superseded decision → update active edge (tombstone, not delete).
- Deleted artifact → tombstone, never hard delete.

SQLite earns its keep over flat files at three measurable thresholds [source: `.guild/research/persistence-schema.md §1.1`]:
1. Cross-session recall latency — grep over `wiki/**` degrades at ~5k Markdown files
   (O(N) > 200 ms); FTS5 BM25 is O(log N) at < 5 ms at any realistic Guild wiki size.
2. Concurrent write pressure — multiple specialist agents writing JSONL + wiki; SQLite
   WAL mode handles this; ad-hoc file locking does not.
3. Cross-index join queries — joining graph nodes, link edges, and run provenance in
   memory is combinatorial at > 50 runs; SQLite makes these < 1 ms.

Below these thresholds direct file parse is correct (zero overhead, zero dependency).

## Recall Scoring

Agent memory recall is scored by a weighted mix of [source: `.guild/research/cost-techniques.md §6`]:
- **Relevance** — BM25 or cosine similarity score.
- **Recency** — exponential decay; wiki documents are append-only and dated so this
  is implicit in document age.
- **Importance** — self-assessed at write time (1–5). Routine task agents query only
  importance ≥ 3.

**Cache stable vs. recompute dynamic:**
- Cache stable structural knowledge (ADRs, API contracts, module topology) — recompute
  only on explicit invalidation (file change, ADR update).
- Recompute dynamic state (build status, test results, recent errors) on every agent
  dispatch — never serve stale state from the wiki.

## Session Learning Extraction and Promotion

Guild extracts durable knowledge from runs through a typed candidate queue [source: `.guild/wiki/_archive/v2-design/sources/14-session-learning-extraction.md §Guild Implications`]:

```
Run traces + artifacts
  → Learning extractor
    → Classify type and scope
      → Score confidence and impact
        → Candidate learning (typed: fact | decision | standard | skill_improvement | eval_fixture)
          → Promotion gate
              → wiki/decisions / evolve queue / run-local archive
```

Candidate schema (distilled):
```yaml
learning_candidate:
  id: learn_001
  run_id: run_001
  type: fact | decision | assumption | unknown | standard | skill_improvement | eval_fixture
  scope: run | feature | project | guild-system
  claim: "..."
  evidence_refs: [...]
  confidence: low | medium | high
  impact: low | medium | high
  review_status: proposed | approved | rejected | superseded
  recommended_destination: wiki | decision | reflection | eval_fixture | none
```

**Promotion policy:**
- Low-risk repo facts with direct evidence → auto-proposed.
- Project goals, standards, architecture decisions, security assumptions → human approval required.
- Secrets → never promoted.
- Failed hypotheses → run-local only (never durable memory).

**Open risks:** Over-extraction creates review fatigue; bad confidence scoring promotes
hallucinated facts; user corrections are high-signal events and must be captured explicitly.

## Importance Scoring at Ingest

When `guild:learn` or `guild:wiki` writes a wiki page, importance is scored (1–5):
- ADR → 5
- API contract → 4
- Module summary → 3
- File summary → 2

Importance ≥ 3 is the default gate for routine task-agent recall.

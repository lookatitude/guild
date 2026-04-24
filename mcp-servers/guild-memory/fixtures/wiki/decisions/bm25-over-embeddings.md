---
title: BM25 chosen over embeddings for initial wiki search
category: decisions
confidence: high
updated: 2026-03-22
source_refs:
  - .guild/raw/2026-03-20-search-benchmark.md
decision_id: D-2026-03-22-01
---

# BM25 chosen over embeddings for initial wiki search

Guild uses hand-rolled BM25 as the initial wiki search ranking below roughly
ten thousand pages. Embeddings are deferred until BM25 fails real usage. The
rationale: BM25 is deterministic, has zero network dependency, and delivers
adequate precision on technical prose. Revisit when confidence in a ranked
recall below eighty percent appears in three distinct reflection cycles.

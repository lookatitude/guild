---
type: decision
owner: architect
confidence: high
source_refs: [".guild/raw/2026-03-20-search-benchmark.md", "docs/v2/13-mcp-servers.md"]
created_at: 2026-03-22
updated_at: 2026-03-22
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-03-22
asker: architect
task: mcp-servers-scale-transition
category: architecture
decision_id: D-2026-03-22-01
---

# BM25 chosen over embeddings for initial wiki search

Guild uses hand-rolled BM25 as the initial wiki search ranking below roughly
ten thousand pages. Embeddings are deferred until BM25 fails real usage. The
rationale: BM25 is deterministic, has zero network dependency, and delivers
adequate precision on technical prose. Revisit when confidence in a ranked
recall below eighty percent appears in three distinct reflection cycles.

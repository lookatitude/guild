---
type: note
owner: tooling-engineer
confidence: high
importance: medium
source_refs:
  - plugin/scripts/understand/validate-graph.ts
  - plugin/scripts/understand/knowledge-orchestrator.ts
  - plugin/.guild/wiki/entities/codebase-understanding.md
created_at: 2026-06-13
updated_at: 2026-06-13
expires_at: null
supersedes: null
sensitivity: public
applies_to: [plugin]
related: [codebase-understanding, contract-map]
---

# Knowledge-tier gotcha — `validate-graph.ts` is the v1/structural validator; v2 validation lives inside `finalize`

## The footgun

`plugin/scripts/understand/validate-graph.ts` run as a **standalone CLI**
(`npx tsx scripts/understand/validate-graph.ts --cwd <root>`) is the
**structural / v1** graph validator. It re-derives and **overwrites**
`.guild/indexes/knowledge-graph.json` with the *structural* graph — node types
`function` / `file` / `class`, `version: guild.knowledge_graph.v1`. Running it
against a directory that already holds a `guild.knowledge_graph.v2` knowledge
graph **clobbers the v2 output**.

Symptom: after the run, `knowledge-graph.json` shows
`version: guild.knowledge_graph.v1` and node types collapse to
`function`/`file`/`class` — the topic / claim / concept / wiki_page / diagram /
domain overlay is gone.

## Why there is no separate "v2 validate" step

The v2 knowledge graph's validation (`validateGraphV2`) runs **inline inside**
`knowledge-orchestrator.ts --phase=finalize`. Finalize does
`validateGraphV2` → canonicalize → write, and a **fatal validation aborts the
write** — so a `finalize` that returns a JSON result with `nodeCount` /
`edgeCount` has, by construction, already passed v2 validation. There is no
second standalone command to "double-check" a v2 graph, and the only
`validate-graph.ts` binary is the wrong (structural) one. See
`architecture/codebase-understanding.md` (K6 row: "`validateGraphV2` →
canonicalize → write").

## How to apply

- **Inspect, don't re-validate.** To check a finalized v2 graph, read the file
  and assert `version === "guild.knowledge_graph.v2"`. Do **not** run
  `validate-graph.ts` on it.
- **Recovery if clobbered.** Re-run `knowledge-orchestrator.ts --phase=finalize`
  for the same `--run-id`. Finalize is a **pure function of (candidates,
  judgments, config)** — it never reads the prior graph — so it deterministically
  rebuilds the v2 graph from the still-present `k1..k5-judgments.json`. (SC-8:
  same inputs → byte-identical `knowledge-graph.json` + `knowledge-recall.json`.)

Observed 2026-06-13 during a full fresh `/guild:learn knowledge` rebuild on
`plugin/` — caught immediately because the node-type histogram flipped to
`function`/`file`/`class`; re-finalize restored the v2 graph with no data loss.

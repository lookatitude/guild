---
name: guild-wiki
description: "Project-knowledge assembler — the one indexed entry for everything that reads or writes `.guild/wiki/`: query, ingest, lint, and decision capture. Composes its chapters by pointer (references/wiki-query.md · references/wiki-ingest.md · references/wiki-lint.md · references/decisions.md) and loads only the chapter the request needs. TRIGGER for \"search the wiki\", \"what did we decide about X\", \"ingest these docs\", \"lint the wiki\", \"record this decision\", \"/guild:wiki <query|ingest|lint>\". DO NOT TRIGGER for: building or refreshing the knowledge graph (guild-learn), reviewing code (guild-review), or reading repo source (use Grep)."
when_to_use: "Any read from or write to .guild/wiki/ — user-typed /guild:wiki, a specialist recalling prior knowledge during context assembly, or a decision that must be captured while work is in flight."
type: knowledge
indexed: true
---

# guild:wiki

The wiki assembler. It holds no procedure of its own: it routes a wiki request to
exactly one chapter and loads that chapter's markdown on match (KTD25 three-stage
disclosure — frontmatter always, body on match, `references/` on demand).

## Chapters

| Request | Chapter |
|---|---|
| Search / recall / "what do we know about X" | `references/wiki-query.md` (+ `references/query-modes.md`) |
| Ingest an external source into the wiki | `references/wiki-ingest.md` (+ `references/ingest-reference.md`) |
| Lint wiki pages, fix structure defects | `references/wiki-lint.md` (+ `references/lint-rules.md`) |
| Capture a decision reached during work | `references/decisions.md` |

Read one chapter. Do not inline a chapter into this file, and do not read a chapter
you were not routed to.

## Routing rules

1. A read-only question about existing knowledge → `wiki-query`.
2. A new external artifact (URL, PDF, transcript, exported doc) → `wiki-ingest`.
   Promotion into the wiki stays human-gated; the chapter carries the gate.
3. A structural complaint about the wiki itself → `wiki-lint`.
4. A choice made under uncertainty, with a rationale worth recalling → `decisions`.

## Boundaries

- Specialists never write the wiki (KTD35). A specialist that reaches a decision
  reports it; the orchestrator runs the `decisions` chapter.
- The glossary is a wiki page (`.guild/wiki/glossary.md`), never a skill and never
  pasted into the always-on prefix (KTD70).
- Graph building, reverse-spec, and codebase mapping belong to `guild-learn`.

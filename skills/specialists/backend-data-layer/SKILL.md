---
name: backend-data-layer
description: Designs database schemas, access patterns, indexes, and query shapes for a single storage boundary. Output: DDL (SQL) or schema fragment plus query-pattern notes and indexing plan. Pulled by the `backend` specialist. TRIGGER: "design the schema for X", "what tables do we need for X", "model the data for X", "draft the DDL for X", "what indexes should we add for X queries", "how should we store X". DO NOT TRIGGER for: writing the actual migration file (use `backend-migration-writer`), external API shape (use `backend-api-contract`), third-party integration (use `backend-service-integration`), picking a DB engine at vendor level (architect-tradeoff-matrix or researcher-comparison-table), cross-service data-flow architecture (architect-systems-design).
when_to_use: The parent `backend` specialist pulls this skill when the task needs tables, columns, relationships, indexes, or query-access plans designed for a specific store. Also fires on explicit user request.
type: specialist
---

# backend-data-layer

Implements `guild-plan.md §6.1` (backend · data-layer) under `§6.4` engineering principles: the schema is the contract with the DB; the evidence is an `EXPLAIN` plan or a query count matching the expected access pattern.

## What you do

Design the persistent shape of one bounded domain. Name every table, every column with a type, every FK, every index. Co-locate the schema with the access patterns — an index without a query that needs it is wasted space; a query without an index is a production incident.

- Start from access patterns, not from the conceptual model. List the top 5–10 queries the app will run, then design tables to serve them.
- Declare PKs, FKs, `NOT NULL`, uniqueness, and defaults explicitly — lean on the DB, not the app.
- Index every FK. Add composite indexes for the specific `WHERE … ORDER BY … LIMIT` shapes the queries use.
- Bound every listing query with pagination — no `SELECT *` with no `LIMIT` in production code paths.
- Note denormalization and counter-cache columns explicitly and say why.
- Flag retention / archival expectations if rows accumulate unbounded.

## Output shape

Markdown or SQL file under `.guild/runs/<run-id>/data/<slug>.{sql|md}` with:

1. **Access patterns** — numbered list of the queries this schema must serve.
2. **Schema** — DDL or a table-by-table markdown spec (columns · types · constraints).
3. **Indexes** — one per line, tied to the query number it serves.
4. **Retention / growth** — expected row count and archival plan.
5. **Migration notes** — one paragraph on how to get from current state to proposed state (detailed file belongs to `backend-migration-writer`).

## Anti-patterns

- Missing indexes on FKs — guaranteed slow joins at any scale.
- Designing tables first, then figuring out how to query them — inverts the actual constraint.
- N+1 patterns baked in (parent list → per-row child fetch) — plan joins or batched fetches up front.
- Unbounded queries — no `LIMIT`, no pagination, no retention story.
- No migration plan — a schema change landing without a migration file is a production outage waiting.
- Over-normalization that forces 5-table joins on the hot path.

## Handoff

Return the schema and access-pattern notes to the invoking `backend` specialist. If the change is non-trivial, the backend agent chains into `backend-migration-writer` to author the actual migration. This skill writes the design; the migration file is a separate artifact.

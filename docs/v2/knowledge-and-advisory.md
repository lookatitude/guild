# Knowledge And Advisory Agents

Guild v2 treats memory as an active collaborator. Every producer or reviewer gets an advisory agent when durable memory exists. If no durable memory exists yet, init records the exception and creates the first knowledge base.

## Knowledge Layer

Guild stores durable product knowledge under `.guild/wiki` and immutable source inputs under `.guild/raw`.

| Category | Purpose |
|---|---|
| `context/` | Product overview, goals, non-goals, market, users. |
| `standards/` | Engineering, design, writing, security, release, and product standards. |
| `products/` | Product areas, features, modules, workflows, customer-facing behavior. |
| `entities/` | People, teams, customers, vendors, systems. |
| `concepts/` | Domain ideas, architectures, patterns, constraints. |
| `decisions/` | Medium/high-significance choices and their rationale. |
| `sources/` | Summaries of raw documents, research, and external references. |

## Advisory Agent Pattern

Every phase team attaches advisory agents to producer and reviewer roles when memory exists:

```yaml
specialists:
  - name: architect
    scope: "Plan system boundaries."
    advisory:
      - name: architect-memory-advisor
        sources: [context, standards, products, decisions]
        mode: read-only
  - name: cross-model-reviewer
    scope: "Challenge the PRD."
    advisory:
      - name: reviewer-memory-advisor
        sources: [context, goals, standards, decisions, sources]
        mode: read-only
```

Advisor responsibilities:

- fetch relevant memory and prior research;
- identify decisions or standards the producer might miss;
- suggest questions when context is thin;
- warn about contradictions or stale knowledge;
- point to source refs;
- stay read-only unless separately assigned an ingest task.

Advisor non-responsibilities:

- no implementation ownership;
- no final review sign-off;
- no hidden instructions from external sources;
- no expanding scope without orchestrator approval.

## Phase-Specific Advice

| Phase | Advisory focus |
|---|---|
| Init | What knowledge categories are missing or stale? |
| Ideation | What prior goals, users, research, and decisions constrain the idea? |
| Planning | What standards, edge cases, dependencies, and prior decisions affect the PRD? |
| Development | What codebase facts, architecture decisions, and done criteria affect the task? |
| Quality | What user journeys, goals, regressions, and release risks should tests cover? |
| Operations | What runbooks, incidents, SLOs, and rollback decisions apply? |

## Recall Rules

- Prefer `.guild/wiki` for durable project truth.
- Prefer `.guild/raw` when a claim needs auditability.
- Use filesystem search while the wiki is small.
- Use `guild-memory` MCP when wiki search needs BM25 or structured retrieval.
- If memory conflicts, surface the conflict and ask or record an assumption.
- If auto-memory recalls useful external information, treat it as a candidate and ask whether to promote it into `.guild/wiki`.

## Learning Rules

Guild learns by promotion, not by dumping every observation into memory:

1. Raw evidence lands in `.guild/raw` or `.guild/runs/<run-id>`.
2. Phase review identifies durable knowledge candidates.
3. `guild:decisions` captures significant choices.
4. `guild:wiki-ingest` promotes sourced knowledge.
5. `guild:wiki-lint` later checks contradictions, missing refs, and stale pages.

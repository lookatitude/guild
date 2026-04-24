---
name: guild-decisions
description: Captures Q&A during specialist work as structured ADR-lite decisions under .guild/wiki/decisions/<slug>.md per `guild-plan.md §10.3`. Required when a specialist reaches uncertainty (principle #1 "ask") and the answer is non-trivial — user supplies the answer, this skill writes the decision file, updates `wiki/index.md`, and appends a dated entry to `wiki/log.md`. Has a significance threshold (low → keep in the run transcript only; medium/high → persist to `wiki/decisions/`) to prevent the trivial-question flood called out in §15.2. TRIGGER for phrasings like "capture this decision", "record this as an ADR", "log why we chose X over Y", "write up this architectural decision", "persist this as a decision". DO NOT TRIGGER for: ingesting a source (hand off to `guild:wiki-ingest`); a specialist asking a clarifying question and getting an immediate answer with low significance (keep it in the run transcript — only escalate medium+ to this skill); routine status updates; wiki search or lint.
when_to_use: Any specialist or orchestrator that reaches medium+ significance uncertainty during task execution. Also fires when a user explicitly asks to record a past decision for the project wiki.
type: meta
---

# guild:decisions

Implements `guild-plan.md §10.3` (decision capture workflow). This skill turns ad-hoc Q&A during specialist work into structured, queryable knowledge under `.guild/wiki/decisions/`. It is a workflow (T2 meta) skill — it WRITES into the knowledge layer, but it is not itself a knowledge skill.

Companion references: `§10.1` (wiki directory layout; `decisions/` is the append-only subdir), `§10.1.1` (base wiki frontmatter shape), `§15.2` risk row "Decision capture noise — trivial questions flood wiki/decisions/" (motivates the significance threshold below), `§8.2` (specialist handoff contract — assumptions surfaced there are decision candidates).

## Flow

Per `guild-plan.md §10.3`:

1. **Specialist reaches uncertainty.** Karpathy principle #1 ("ask, don't guess") says stop and ask. Before asking in free text, invoke this skill.
2. **Specialist invokes `guild:decisions`** with three structured fields:
   - `question` — the precise thing that is unclear.
   - `why-it-matters` — what downstream work is blocked or will diverge depending on the answer.
   - `options` — concrete alternatives the specialist has already considered (A, B, …).
3. **Skill prompts the user** with those three fields verbatim and waits for an answer. Do not synthesize an answer from plan context — that defeats the principle.
4. **User answers.** The skill then asks the user to rate **significance** (low / medium / high). Low-significance stays in the run transcript (`.guild/runs/<run-id>/assumptions.md` per §8.1) and does **not** persist to the wiki. Medium or high triggers file creation (see §15.2 threshold).
5. **Skill writes `.guild/wiki/decisions/<slug>.md`** using the ADR-lite template below. Slug is a kebab-case summary of the question (e.g. `postgres-vs-dynamodb`). If a prior decision on the same topic exists, set `supersedes:` to that slug.
6. **Skill updates `.guild/wiki/index.md`** — adds an entry under the `decisions/` section linking to the new file with its date and one-line summary.
7. **Skill appends to `.guild/wiki/log.md`** — one line in the form `## [YYYY-MM-DD] decided <slug>`, so the chronological log shows the decision alongside other wiki events.
8. **Specialist receives the answer** and continues its task, citing the new decision slug in its handoff receipt (see "Handoff" below).

## ADR-lite template

Write the file exactly in this shape (per `§10.3`):

```yaml
---
# §10.1.1 base fields (required for every wiki page, including decisions)
type: decision
owner: <specialist-or-user>
confidence: low | medium | high
source_refs: []            # populate when citing external material
created_at: <YYYY-MM-DD>
updated_at: <YYYY-MM-DD>
expires_at: null
supersedes: null | <previous-slug>
sensitivity: public | internal | confidential | secret
# §10.3 ADR-lite additions (decision-page-specific)
date: <YYYY-MM-DD>
asker: <specialist-or-user>
task: <task-id-or-slug>
category: architecture | copy | pricing | data-model | voice | other
---
# <slug>
## Context
<why the question came up — the `why-it-matters` the specialist supplied, tightened>
## Options considered
- A: ...
- B: ...
## Decision
<chosen option> — because ...
## Consequences
...
```

The frontmatter is the **union** of the §10.1.1 base (which `guild:wiki-lint` enforces on every wiki page) and the §10.3 ADR-lite additions that make decisions distinct. `date` and `created_at` will usually match; `asker` and `owner` will usually match; keep both so the lint checks (which enforce §10.1.1 globally and §10.3 only on `decisions/`) stay decoupled.

Notes:
- `date` is today in ISO form.
- `asker` is the specialist skill name (e.g. `backend`, `copywriter`) or `user` when the user volunteers a decision unprompted.
- `task` is the current run/task slug so decisions are traceable back to the work that produced them.
- `category` picks the closest label; use `other` rather than inventing new categories without user approval.
- `supersedes` defaults to `null`; set it when the user explicitly replaces a prior decision — the wiki-lint skill (Task 3) will check for dangling supersedes chains.
- `confidence` is derived from the significance rating: **medium** significance → `confidence: medium`; **high** significance → `confidence: high`. Low significance does not produce a file.

## Significance threshold

Per `§15.2` (risk: "Decision capture noise — trivial questions flood wiki/decisions/"), always ask the user to rate the decision's significance after they answer:

- **low** — routine clarification ("is the field called `user_id` or `userId`?"). Record it in `.guild/runs/<run-id>/assumptions.md` only. Do **not** create a file under `wiki/decisions/`. Do not touch `index.md` or `log.md`.
- **medium** — affects more than the current task but is reversible. Persist with `confidence: medium`.
- **high** — architectural, contractual, or otherwise hard to reverse. Persist with `confidence: high` and include a one-line note in the run summary so reviewers see it without opening the file.

If the user declines to rate, default to **medium** and flag it in the handoff `assumptions:` field.

## Relationship to guild:wiki-ingest

Decisions are **authored by this skill**, not by `guild:wiki-ingest`. Ingest brings external material into `.guild/wiki/sources/` and synthesizes summaries; it does not produce ADR-lite pages. The `guild:wiki-lint` skill (Task 3) enforces this separation: any page under `wiki/decisions/` whose frontmatter or shape does not match this skill's template is flagged as not-written-by-`guild:decisions`. If a user insists on ingesting an external doc as a decision, the correct flow is: ingest to `sources/`, then invoke this skill to create a decision that cites the source in `source_refs`.

## Handoff

Return two things to the invoking specialist:

1. The **answer** the user gave, verbatim — so the specialist can proceed.
2. The **decision slug and absolute file path** (e.g. `postgres-vs-dynamodb` → `.guild/wiki/decisions/postgres-vs-dynamodb.md`), or `null` if significance was low and no file was written.

The specialist cites the decision in its own handoff receipt per `§8.2`:
- Under `assumptions:` when the decision locks in an inferred choice.
- Under `evidence:` when the decision is the justification for a concrete output.

When no file is written (low significance), the specialist still logs the exchange under `assumptions:` with the note "low-significance, transcript only" so the end-of-run review can revisit it if it turns out to matter.

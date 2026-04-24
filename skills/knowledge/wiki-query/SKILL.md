---
name: guild-wiki-query
description: Searches .guild/wiki/ by category, tag, freshness, confidence, or full-text. Under ~200 pages uses ripgrep/filesystem via Grep/Glob tools. Above that scale, delegates to guild-memory MCP (optional P6). Resolves source_refs back to .guild/raw/sources/<slug>/ when users ask "where does this come from". TRIGGER for "search the wiki for X", "what do we have on Y", "find standards about Z", "which decisions touched the pricing calculator", "show me recent sources on competitors". DO NOT TRIGGER for: ingesting a new source (guild:wiki-ingest), running lint (guild:wiki-lint), capturing a decision (guild:decisions), or searching the repo source code (use Grep directly).
when_to_use: Any specialist needs wiki knowledge. Invoked inside guild:context-assemble during role-dependent layer builds, and directly by the user via /guild:wiki query.
type: knowledge
---

# guild:wiki-query

Implements `guild-plan.md §10` (knowledge layer), `§10.1` (categorized wiki structure), `§10.1.1` (page frontmatter that makes filtering possible), `§10.2` (load-by-role categorization), `§10.5` (scale transition — rg/filesystem under ~200 pages, guild-memory MCP above), and `§10.5.1` (memory write path — this skill is the read side that all specialists depend on).

Read-only counterpart to `guild:wiki-ingest`. Every wiki page written by that skill carries a `source_refs: [<slug>]` back-citation into `.guild/raw/sources/<slug>/`; this skill honors that contract so users asking "where does this come from" always get the original URL or file path, not just the LLM-authored summary.

## Input

- **query** (required) — free-text search string. Matched against page body and frontmatter. Empty query is allowed only when at least one filter is set.
- **filters** (optional, any combination):
  - `category` — one of `context | standard | product | entity | concept | decision | source` (matches the `type:` frontmatter enum from `§10.1.1` used by `guild:wiki-ingest` and `guild:decisions`). Internally mapped to the plural directory (`standard` → `standards/`, etc.). Reject plural forms with an error pointing the caller at the singular enum.
  - `owner` — specialist slug (e.g. `backend`, `copywriter`, `orchestrator`). Matches the `owner:` frontmatter field.
  - `confidence` — `low | medium | high`. Matches the `confidence:` frontmatter field exactly.
  - `updated_since` — ISO-8601 date. Returns pages whose `updated_at:` is on or after the given date.
  - `tag` — free-text tag. Matched against any `tags:` frontmatter array if the page defines one, otherwise against body headings.
- **source_resolve** (optional, default `true`) — when true, each result's `source_refs:` slugs are dereferenced to `.guild/raw/sources/<slug>/metadata.json` and the original URL / path is included in the result.

If the caller passes an unknown category, reject the query with a list of valid categories rather than silently falling back to a full-wiki walk.

## Search strategy

Two paths, chosen by scale.

### Under ~200 pages — ripgrep + filesystem (default)

1. Determine the search root:
   - If `category` is set, search `.guild/wiki/<category>/`.
   - Otherwise search `.guild/wiki/` (excluding `index.md`, `log.md`, and any `lint-*.md` reports).
2. Full-text match:
   - Use `Grep` (ripgrep) over markdown bodies with the user's query. Honor case-insensitivity by default; only go case-sensitive if the query is all-lowercase and contains a mixed-case token the user clearly typed deliberately.
   - Use `Glob` to enumerate candidate files when the query is empty and only filters are set.
3. Frontmatter filtering:
   - Extract the YAML frontmatter block (between the first pair of `---` lines) from each candidate via a small `awk`/Python helper. Do not hand-parse YAML with regex — pull the block, then feed it to `python3 -c "import yaml,sys; …"` (or, when PyYAML is unavailable, parse the handful of flat keys this skill cares about directly).
   - Drop any candidate that fails `owner`, `confidence`, `updated_since`, or `tag` filters.
4. Rank results:
   - Exact phrase hits rank highest; bag-of-words hits second; frontmatter-only hits last.
   - Break ties with `updated_at:` descending (newer first), then `confidence: high` before `medium` before `low`.
5. Cap returned results at 20 by default; allow the caller to raise the cap via a `limit` parameter if provided.

### Above ~200 pages — guild-memory MCP (optional, P6)

If the guild-memory MCP server is available (see `mcp-servers/guild-memory/` in later phases), delegate to its BM25 index:

1. Call the MCP `search` tool with `{query, filters}`.
2. Accept the MCP's ranked list as-is; still post-filter for `confidence` / `updated_since` if the MCP does not support those natively.
3. If the MCP is unreachable, fall back to the ripgrep path and note the degradation in the handoff.

The MCP is out of scope for P2. Document the contract here so P6 can slot in without rewriting this skill.

## Scale transition

Per `§10.5`: check page count before deciding strategy.

```
find .guild/wiki/ -name '*.md' -not -name 'index.md' -not -name 'log.md' -not -name 'lint-*.md' | wc -l
```

- Under ~200 pages: ripgrep path is fast enough; stay on it.
- Over ~200 pages and the MCP is not yet installed: queries still work via ripgrep but latency climbs. Surface a suggestion in the handoff `followups:` that the user consider installing `guild-memory` MCP.
- Over ~200 pages with MCP installed: route through the MCP.

Do not switch strategies mid-query — pick one per invocation.

## Result format

Return a list of matches. For each match:

```
- path: .guild/wiki/<category>/<slug>.md
  category: <category>
  confidence: <low|medium|high>
  updated_at: <YYYY-MM-DD>
  summary: <first non-empty body line or explicit `## Summary` first line, one line>
  source_refs:
    - slug: <slug>
      raw_path: .guild/raw/sources/<slug>/original.<ext>
      url_or_path: <original URL or file path from metadata.json, or "unknown" if metadata.json missing>
```

If the result set is empty, say so explicitly. Do not fabricate pages. Never return a page whose frontmatter fails to parse — instead, include it in the handoff `followups:` as a page that `guild:wiki-lint` should flag.

## Contradiction policy

Per `§10.5`: when two returned pages contradict on the same claim, apply the confidence rule and surface both.

- Rule: **newer wins unless older has `confidence: high` and newer does not.**
- Never silently pick. Always return both pages and mark the conflict in the result, e.g.:

  ```
  conflict:
    - path: <page-a-path>
      updated_at: 2026-04-10
      confidence: high
    - path: <page-b-path>
      updated_at: 2026-04-20
      confidence: medium
    resolution: "older wins (high > medium)"
  ```

- Suggest `guild:wiki-lint` in the handoff `followups:` so the contradiction enters the lint report for human adjudication (`§10.6`).

## Source resolution

Back-citation contract with `guild:wiki-ingest`: every ingested page has `source_refs: [<slug>]` pointing at a directory under `.guild/raw/sources/`.

When a user asks "where does this come from", or when `source_resolve` is true (default):

1. For each slug in the page's `source_refs`:
   - Read `.guild/raw/sources/<slug>/metadata.json`.
   - Surface `url` (for URL captures) or `path` (for file captures) or `"pasted text"` (for inline captures).
   - Surface `checksum_sha256` so downstream tooling can verify the raw copy has not drifted.
   - Surface `captured_at` and `captured_by` for provenance.
2. If `metadata.json` is missing or unreadable, return the slug plus `raw_path_missing: true` and list it in handoff `followups:` — this is a broken ingest that `guild:wiki-lint` should catch.
3. Never inline the raw source's full contents into the result; link to the raw path. The wiki page's own `## Summary` is the paraphrase the user should read first; the raw copy is the audit trail if they need to dig deeper.

Pages outside the ingest flow (decisions, hand-written context) may have empty `source_refs: []`. That is valid — skip source resolution for those and note the absence in the result so the caller knows the claim is internal, not externally grounded.

## Handoff

This skill is read-only. It must not modify `.guild/wiki/`, `.guild/raw/`, `index.md`, or `log.md` under any circumstance. If a query reveals data issues (broken frontmatter, missing raw metadata, contradictions), record them in the handoff `followups:` and return them to the caller; do not auto-repair.

Return results to the caller:

- If invoked by `guild:context-assemble`, return the ranked list so context assembly can pack role-dependent layers.
- If invoked by the user directly via `/guild:wiki query`, render the list in a readable format (paths + one-line summaries + resolved source URLs).

The handoff receipt must include:

- `changed_files:` — `- none` (always; read-only).
- `evidence:` — the query, the filter set, the number of candidates walked, the number returned.
- `assumptions:` — case-sensitivity choice, any ambiguous filters defaulted, whether MCP vs ripgrep path was used.
- `followups:` — pages with broken frontmatter, missing raw metadata, contradictions, or a scale-transition suggestion if page count crossed ~200.

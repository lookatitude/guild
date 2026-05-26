# wiki-query — search modes, scale transition & result format

Full detail for the two search paths summarised in `SKILL.md`, the page-count
scale transition, and the result + conflict output templates. `SKILL.md` is the
lean playbook; this file is the procedure it points to.

Plan anchors: `guild-plan.md §10.2` (load-by-role categorization), `§10.5`
(scale transition — rg/filesystem under ~200 pages, guild-memory MCP above;
contradiction rule), `§10.5.1` (read side of the memory write path).

## Under ~200 pages — ripgrep + filesystem (default)

1. **Determine the search root:**
   - If `category` is set, search `.guild/wiki/<category>/`.
   - Otherwise search `.guild/wiki/` (excluding `index.md`, `log.md`, and any
     `lint-*.md` reports).
2. **Full-text match:**
   - Use `Grep` (ripgrep) over markdown bodies with the user's query. Honor
     case-insensitivity by default; only go case-sensitive if the query is all
     lowercase and contains a mixed-case token the user clearly typed
     deliberately.
   - Use `Glob` to enumerate candidate files when the query is empty and only
     filters are set.
3. **Frontmatter filtering:**
   - Extract the YAML frontmatter block (between the first pair of `---` lines)
     from each candidate via a small `awk`/Python helper. Do not hand-parse
     YAML with regex — pull the block, then feed it to
     `python3 -c "import yaml,sys; …"` (or, when PyYAML is unavailable, parse
     the handful of flat keys this skill cares about directly).
   - Drop any candidate that fails `owner`, `confidence`, `updated_since`, or
     `tag` filters.
4. **Rank results:**
   - Exact phrase hits rank highest; bag-of-words hits second; frontmatter-only
     hits last.
   - Break ties with `updated_at:` descending (newer first), then
     `confidence: high` before `medium` before `low`.
5. **Cap** returned results at 20 by default; allow the caller to raise the cap
   via a `limit` parameter if provided.

## Above ~200 pages — guild-memory MCP (optional, P6)

If the guild-memory MCP server is available (see `mcp-servers/guild-memory/` in
later phases), delegate to its BM25 index:

1. Call the MCP `search` tool with `{query, filters}`.
2. Accept the MCP's ranked list as-is; still post-filter for `confidence` /
   `updated_since` if the MCP does not support those natively.
3. If the MCP is unreachable, fall back to the ripgrep path and note the
   degradation in the handoff.

The MCP was out of scope for P2 — this contract lets P6 slot in without
rewriting the skill.

## Scale transition

Per `§10.5`, check page count before deciding strategy:

```
find .guild/wiki/ -name '*.md' -not -name 'index.md' -not -name 'log.md' -not -name 'lint-*.md' | wc -l
```

- Under ~200 pages: ripgrep path is fast enough; stay on it.
- Over ~200 pages and the MCP is not yet installed: queries still work via
  ripgrep but latency climbs. Surface a suggestion in the handoff `followups:`
  that the user consider installing `guild-memory` MCP.
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

If the result set is empty, say so explicitly. Do not fabricate pages. Never
return a page whose frontmatter fails to parse — instead, include it in the
handoff `followups:` as a page that `guild:wiki-lint` should flag.

## Conflict format

When two returned pages contradict on the same claim (`§10.5`), apply the
confidence rule and surface BOTH — never silently pick:

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

Rule: **newer wins unless older has `confidence: high` and newer does not.**
Suggest `guild:wiki-lint` in the handoff `followups:` so the contradiction
enters the lint report for human adjudication (`§10.6`).

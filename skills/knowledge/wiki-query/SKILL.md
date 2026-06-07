---
name: guild-wiki-query
description: Searches .guild/wiki/ by category, tag, freshness, confidence, or full-text. Under ~200 pages uses ripgrep/filesystem via Grep/Glob tools. Above that scale, delegates to guild-memory MCP (optional P6). Resolves source_refs back to .guild/raw/sources/<slug>/ when users ask "where does this come from". TRIGGER for "search the wiki for X", "what do we have on Y", "find standards about Z", "which decisions touched the pricing calculator", "show me recent sources on competitors", "search across all sub-guilds in this workspace", "what does the plugin sub-guild know about Z". DO NOT TRIGGER for: ingesting a new source (guild:wiki-ingest), running lint (guild:wiki-lint), capturing a decision (guild:decisions), or searching the repo source code (use Grep directly).
when_to_use: Any specialist needs wiki knowledge. Invoked inside guild:context-assemble during role-dependent layer builds, and directly by the user via /guild:wiki query.
type: knowledge
---

# guild:wiki-query

Implements `guild-plan.md §10`/`§10.1`/`§10.1.1` (wiki structure + filterable frontmatter), `§10.2` (load-by-role categorization), `§10.5` (scale transition — rg/filesystem under ~200 pages, guild-memory MCP above), and `§10.5.1` (read side of the memory write path that all specialists depend on).

Read-only counterpart to `guild:wiki-ingest`. Every page that skill writes carries a `source_refs: [<slug>]` back-citation into `.guild/raw/sources/<slug>/`; this skill honors it so "where does this come from" always returns the original URL or file path, not just the LLM summary.

## Input

- **query** (required) — free-text, matched against page body and frontmatter. An empty query is allowed only when at least one filter is set.
- **filters** (optional, combinable):
  - `category` — `context | standard | product | entity | concept | decision | source` (the `type:` enum). Mapped internally to the plural directory (`standard` → `standards/`). Reject plural forms with an error pointing at the singular enum.
  - `owner` — specialist slug; matches `owner:`.
  - `confidence` — `low | medium | high`; matches exactly.
  - `updated_since` — ISO-8601 date; returns pages with `updated_at:` on or after it.
  - `tag` — matched against a `tags:` array if present, else against body headings.
- **source_resolve** (optional, default `true`) — dereference each result's `source_refs:` to `.guild/raw/sources/<slug>/metadata.json` and include the original URL/path.

If the caller passes an unknown category, reject the query with the list of valid categories — never silently fall back to a full-wiki walk.

## Search strategy

Two paths, chosen by scale; pick one per invocation (no mid-query switching):

- **Under ~200 pages — ripgrep + filesystem (default).** Search root = `.guild/wiki/<category>/` if `category` set, else `.guild/wiki/` (excluding `index.md`, `log.md`, `lint-*.md`). Full-text match via `Grep` (case-insensitive by default), `Glob` to enumerate when only filters are set. Extract the frontmatter block and filter on `owner`/`confidence`/`updated_since`/`tag` — never regex-parse YAML. Rank exact-phrase > bag-of-words > frontmatter-only, tie-break `updated_at` desc then `confidence` high→low. Cap 20 (raise via `limit`).
- **Above ~200 pages — guild-memory MCP (optional, P6).** **First check `mcp.stdio_available`** (resolved config) — see `## MCP-availability gate`: when **false**, the MCP stdio transport is declared unavailable, so **do not attempt the MCP call**; route to `fsScan` instead. When true, delegate to its BM25 `search`; post-filter `confidence`/`updated_since` if unsupported; on an unreachable MCP despite `stdio_available: true`, fall back to `fsScan` (or ripgrep) and note the degradation.

Check page count first (`§10.5`); over ~200 with no MCP, queries still run via the filesystem (`fsScan` / ripgrep) but suggest installing `guild-memory` in `followups:`. Full step-by-step, the `find` count command, and the result-list template: **`query-modes.md`** (this directory).

## MCP-availability gate (R-019)

Implements the MCP degradation contract (`docs/knowledge/decisions/feature-degradation-contracts.md` FDC-13; resolved key `mcp.stdio_available`, default `true`). **Before any guild-memory MCP call** — the >200-page BM25 `search` above AND the federated `wiki_search`/`wiki_get`/`wiki_list` fan-out — read `mcp.stdio_available` from the resolved settings (`read-guild-config.ts`). When it is **false**, skip the MCP entirely and recall via the filesystem scanner `fsScan` (`scripts/lib/fs-scanner.ts`):

**Consume contract (do not violate):**
- Signature: `fsScan(query: string, guildRoot: string, opts?: { limit?, dirs?, extensions? }): FsScanResult | null`. `guildRoot` is the repo root (`.guild/` is resolved from it); default `dirs` are `["wiki","runs"]`.
- Returns `FsScanResult = { source: "fs-scanner", hits: FsScanHit[], scannedDirs: string[] }`, where `FsScanHit = { path, title, snippet }` — **no rank field**.
- `hits` is **PRE-SORTED** most-relevant-first. **Take hits in array order; never re-sort** (the internal score is deliberately not surfaced).
- Returns **`null` when no `.guild` target dirs exist** — handle exactly like a wiki-recall null (empty result set; note the absence), never as an error.

This config-gated fallback is distinct from the "MCP reachable but errored" runtime degradation. Record which path ran (MCP / fsScan / ripgrep) in the handoff `assumptions:`.

## Federated fan-out (workspace)

When the consuming root carries a `.guild/workspace.json`
(`guild.workspace.v1` — bound by pointer to the contract map,
`docs/knowledge/implementation/contract-map.md §A` row `guild.workspace.v1`;
canonical body in `docs/knowledge/decisions/workspace-aware-init-and-federation.md`),
a workspace-level query does **not** read the workspace's own (often empty)
wiki as the whole answer. It **fans out** across every registered sub-guild and
merges the results — no sub-guild knowledge is ever copied up. Use the manifest's
own `query_recipe` block (the recipe is self-documented in the manifest):

1. Read `sub_guilds[]` from `workspace.json`; iterate the entries where
   `has_wiki: true`.
2. For each, recall from **its** wiki via the existing guild-memory MCP `cwd`
   override (`wiki_search`/`wiki_get`/`wiki_list` with `cwd: <sub.path>`, or
   `GUILD_MEMORY_WIKI_ROOT=<sub.path>/.guild/wiki`) — no new MCP, no index copy.
   The shipped helper `npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/workspace/federated-query.ts` performs
   this read-only fan-out + merge for you.
3. **Tag each hit with its source sub-guild** (`sub_guild.name`) and merge into
   one ranked list (same ranking/contradiction rules as above, applied across
   the merged set).

**Scoping:** a query that **names one sub-guild** scopes to that sub-guild only
(query just its wiki via the `cwd` override). A query that names none fans out
across all `has_wiki` sub-guilds. If the root also has its own wiki
(`root_wiki: true`), include it as one more source, tagged as the root.
On a **regular** repo (no `workspace.json`) this section does not apply — the
single-wiki search strategy above runs unchanged.

## Contradiction policy

Per `§10.5`: when two returned pages contradict on the same claim, apply the rule and surface BOTH — never silently pick. Rule: **newer wins unless older has `confidence: high` and newer does not.** Mark the conflict in the result (both paths + `updated_at` + `confidence` + a `resolution:` line) and suggest `guild:wiki-lint` in `followups:` so it enters the lint report for human adjudication (`§10.6`). Conflict-block format: **`query-modes.md`**.

## Source resolution

Back-citation contract with `guild:wiki-ingest`: every ingested page has `source_refs: [<slug>]` pointing at a directory under `.guild/raw/sources/`. When the user asks "where does this come from", or `source_resolve` is true (default):

1. For each slug in `source_refs`, read `.guild/raw/sources/<slug>/metadata.json` and surface `url` / `path` / `"pasted text"`, plus `checksum_sha256` (drift check) and `captured_at` / `captured_by` (provenance).
2. If `metadata.json` is missing or unreadable, return the slug with `raw_path_missing: true` and list it in `followups:` — a broken ingest for `guild:wiki-lint` to catch.
3. Never inline the raw source's full contents — link to the raw path. The page's own `## Summary` is what the user reads first; the raw copy is the audit trail.

Pages outside the ingest flow (decisions, hand-written context) may have empty `source_refs: []` — valid; skip resolution and note the absence so the caller knows the claim is internal, not externally grounded.

## Handoff

Read-only: never modify `.guild/wiki/`, `.guild/raw/`, `index.md`, or `log.md` under any circumstance. If a query reveals data issues (broken frontmatter, missing raw metadata, contradictions), record them in `followups:` and return them — do not auto-repair. Return the ranked list to `guild:context-assemble` (for role-dependent layer packing), or render it readably (paths + one-line summaries + resolved source URLs) for a direct `/guild:wiki query`.

The handoff receipt must include:

- `changed_files:` — `- none` (always; read-only).
- `evidence:` — the query, the filter set, candidates walked, number returned (on a workspace: which sub-guilds were fanned out to and the per-source hit counts).
- `assumptions:` — case-sensitivity choice, ambiguous filters defaulted, which recall path ran (MCP vs `fsScan` vs ripgrep, incl. the `mcp.stdio_available` gate outcome), and (on a workspace) whether the query fanned out across all sub-guilds or scoped to one named sub-guild.
- `followups:` — pages with broken frontmatter, missing raw metadata, contradictions, or a scale-transition suggestion if page count crossed ~200.

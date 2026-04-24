# guild-memory

Optional Guild MCP server that exposes BM25 search, read, and list operations
over a consuming repo's `.guild/wiki/`.

Per `guild-plan.md` §13.3 this server is optional. Under 200 wiki pages,
plain ripgrep/filesystem search is faster to set up and sufficient; above that
threshold (§10.5) the BM25 ranking here delivers better precision without
requiring embeddings.

## Why it exists

Guild's wiki grows faster than grep can rank. `guild-memory` gives specialists
deterministic ranked access to categorized wiki pages, exposing the same
categories (`context/`, `standards/`, `products/`, `entities/`, `concepts/`,
`decisions/`, `sources/`) that `/guild:wiki` uses.

## Tools

### `wiki_search`

```
wiki_search { query: string, category?: string, limit?: number, cwd?: string }
```

Runs BM25 ranking over the wiki. Returns `{ results: [{ path, category,
score, excerpt, confidence, source_refs }] }`. Title tokens are weighted 2x.
Default `limit` is 20, max 200.

### `wiki_get`

```
wiki_get { path: string, cwd?: string }
```

Reads one page and returns `{ path, frontmatter, body }`. Path is resolved
relative to the wiki root and is guarded against traversal.

### `wiki_list`

```
wiki_list { category?: string, updated_since?: string, cwd?: string }
```

Lists every wiki page sorted by path. `updated_since` accepts any ISO-8601
date or datetime; pages without an `updated:` frontmatter field are excluded
when the filter is active.

## Wiki root resolution

1. `GUILD_MEMORY_WIKI_ROOT` env var (used in tests) overrides everything.
2. Per-call `cwd` argument → `<cwd>/.guild/wiki/`.
3. Server process cwd → `<cwd>/.guild/wiki/`.

## Invariants

- **Read-only.** The source never calls `writeFile`, `appendFile`, or anything
  that mutates `.guild/`.
- **Deterministic.** All results sort by score then path; lists sort by path;
  JSON output is pretty-printed for easy diffing.
- **Path-safe.** `wiki_get` rejects paths that resolve outside the wiki root.

## Wiring

See `.mcp.json` at the repo root — the server is registered via
`npx -y tsx mcp-servers/guild-memory/src/index.ts`, stdio transport.

## Tests

```bash
cd mcp-servers/guild-memory
npm install
npx jest --no-coverage
```

Tests spawn the server as a subprocess and drive it with the
`@modelcontextprotocol/sdk` client. Fixtures live under `fixtures/wiki/`.

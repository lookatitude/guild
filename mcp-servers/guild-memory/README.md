# guild-memory

Optional Guild MCP server that exposes BM25 search, read, and list operations
over a consuming repo's `.guild/wiki/`.

This server is optional. Under 200 wiki pages, plain ripgrep/filesystem search
is faster to set up and sufficient; above that threshold the BM25 ranking here
delivers better precision without requiring embeddings.

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

Runs BM25 ranking over the wiki. Returns `{ results: [{ path, category, type,
frontmatter_category, score, excerpt, confidence, source_refs }] }`. `category`
is always the wiki directory segment (e.g. `decisions`); a page's own
frontmatter `category`/`type` fields (when present) are surfaced separately so
a decision page's §10.3 topic taxonomy value never masks its directory.
`source_refs` is a real array (both inline flow lists and block lists parse
correctly). Title tokens are weighted 2x — title is derived from frontmatter
`title` (nonconforming pages only), else the first markdown H1, else the
filename, since canonical §10.1.1 pages carry no `title:` field. Default
`limit` is 20, max 200.

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
date or datetime and is read from the canonical `updated_at` frontmatter field
(with legacy `updated` as a fallback); pages with neither field are excluded
when the filter is active.

## Wiki root resolution

1. Explicit per-call `cwd` argument → `<cwd>/.guild/wiki/` (wins — required so
   a long-lived server can fan out across federated child repos by cwd).
2. `GUILD_MEMORY_WIKI_ROOT` env var (used in tests, when no `cwd` is given).
3. Server process cwd → `<cwd>/.guild/wiki/`.

### `--no-cwd-fallback` (hosts that launch the server outside the project)

A Codex plugin install must declare `cwd: "."` so Codex can resolve the server
path (measured on codex 0.146.0: `${CLAUDE_PLUGIN_ROOT}`-prefixed, bare-relative
and `./`-relative args all fail to start without a cwd; only an absolute path
works, and that cannot be published from a version-keyed cache root). That cwd is
the PLUGIN payload root, and Codex passes the child a scrubbed env with no
workspace signal at all — so step 3 above would resolve to the *plugin's own*
`.guild/`, serving Guild's bundled data instead of the consumer's.

The generated Codex manifest therefore passes `--no-cwd-fallback` alongside
`cwd: "."`. In that mode:

- step 3 is **removed** — no process-cwd default;
- the per-call `cwd` and the env override **must be ABSOLUTE** (a relative value
  would resolve against the payload, which is the same leak);
- calls without a usable root fail closed with `isError: true` and an actionable
  message, and the server's `instructions` plus every tool's `cwd` description
  say REQUIRED.

Unflagged behavior is unchanged: Claude Code and a dev checkout both launch the
server inside the consuming project, where step 3 is correct.

## Invariants

- **Read-only.** The source never calls `writeFile`, `appendFile`, or anything
  that mutates `.guild/`.
- **Deterministic.** All results sort by score then path; lists sort by path;
  JSON output is pretty-printed for easy diffing.
- **Path-safe.** `wiki_get` rejects paths that resolve outside the wiki root.

## Wiring

See `.mcp.json` at the repo root — the server is registered via
`node ${CLAUDE_PLUGIN_ROOT}/mcp-servers/guild-memory/dist/index.js`, stdio
transport. `npm run build` (esbuild, bundled/self-contained) produces that
`dist/index.js`; `npx tsx src/index.ts` is only for local development.

## Tests

```bash
cd mcp-servers/guild-memory
npm install
npx jest --no-coverage
```

Tests spawn the server as a subprocess and drive it with the
`@modelcontextprotocol/sdk` client. Fixtures live under `fixtures/wiki/`.

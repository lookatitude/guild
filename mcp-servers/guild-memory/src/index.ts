#!/usr/bin/env -S npx tsx
/**
 * mcp-servers/guild-memory/src/index.ts
 *
 * Optional Guild MCP server — BM25 search + read + list over .guild/wiki/.
 * See guild-plan.md §13.3 (MCP servers) and §10.5 (scale transition).
 *
 * Tools:
 *   - wiki_search { query, category?, limit? }
 *       → { results: [{ path, category, type, frontmatter_category, excerpt,
 *                        score, confidence, source_refs }] }
 *   - wiki_get { path }
 *       → { frontmatter, body }
 *   - wiki_list { category?, updated_since? }
 *       → { pages: [{ path, category, type, frontmatter_category, title, updated, confidence }] }
 *
 * Wiki root resolution (priority):
 *   1. Explicit per-tool `cwd` argument → <cwd>/.guild/wiki/ (wins — required for
 *      federated per-child cwd fan-out over a long-lived server: a single
 *      running server instance must be able to answer queries scoped to
 *      different consuming repos without an env var stuck at launch time).
 *   2. GUILD_MEMORY_WIKI_ROOT env var (used by tests when no cwd arg is given)
 *   3. process.cwd()/.guild/wiki/
 *
 * Frontmatter contract (§10.1.1, enforced by guild:wiki-lint / written by
 * guild:wiki-ingest and guild:decisions): canonical pages carry `type`,
 * `owner`, `confidence`, `source_refs` (inline flow list or block list),
 * `created_at`, `updated_at`, `expires_at`, `supersedes`, `sensitivity`. There
 * is no `title` field (title is derived — see deriveTitle) and `category` in
 * decision-page frontmatter is a TOPIC taxonomy (architecture|copy|...), NOT
 * the wiki directory — the directory segment is always the page's `category`
 * output field; the frontmatter value (when present) is surfaced separately
 * as `frontmatter_category`.
 *
 * Invariants:
 *   - Read-only. Source intentionally imports no fs-write APIs. Any violation
 *     would break the tooling-engineer invariant check and §13.3 scope.
 *   - Deterministic output. Sorted results, stable JSON.
 *   - Never traverses outside the resolved wiki root (path traversal guarded).
 *
 * Usage:
 *   npx tsx src/index.ts              # stdio server, CWD-aware
 *   GUILD_MEMORY_WIKI_ROOT=/... npx tsx src/index.ts   # override root
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// Pure fence-splitting logic shared with the rest of the plugin's frontmatter
// readers (src/modules/state/workflows/frontmatter.ts). Zero runtime deps —
// esbuild --bundle inlines it exactly like the shared bm25 module (./bm25.ts).
import { splitFrontmatter } from "../../../src/modules/state/workflows/frontmatter";

// ─── Wiki root resolution ────────────────────────────────────────────────

function resolveWikiRoot(cwdArg?: string): string {
  if (cwdArg) {
    return path.join(path.resolve(cwdArg), ".guild", "wiki");
  }
  if (process.env.GUILD_MEMORY_WIKI_ROOT) {
    return path.resolve(process.env.GUILD_MEMORY_WIKI_ROOT);
  }
  return path.join(process.cwd(), ".guild", "wiki");
}

// ─── Frontmatter parsing ─────────────────────────────────────────────────
//
// The YAML itself is parsed with js-yaml directly (declared dependency of
// this package — see package.json — statically resolved from
// mcp-servers/guild-memory/node_modules so esbuild --bundle inlines it into
// dist/index.js exactly like @modelcontextprotocol/sdk and zod already are).
// This intentionally does NOT go through src/modules/kernel's loadYamlApi():
// that loader resolves js-yaml via a runtime-computed, multi-candidate
// require.resolve(path) keyed off __dirname depths that match the scripts/
// and hooks/dist bundle layouts, not this package's dist/ layout — reusing it
// here would make js-yaml resolution depend on incidental directory-depth
// coincidences instead of a guaranteed, statically-bundled dependency.

interface YamlApi {
  JSON_SCHEMA: unknown;
  load(text: string, opts?: { schema?: unknown }): unknown;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require("js-yaml") as YamlApi;

interface Frontmatter {
  confidence?: "high" | "medium" | "low" | string;
  updated_at?: string;
  updated?: string;
  source_refs?: string[];
  category?: string;
  type?: string;
  [key: string]: unknown;
}

function parseFrontmatter(
  content: string
): { frontmatter: Frontmatter; body: string } {
  const { frontmatter: raw, body } = splitFrontmatter(content);
  if (raw === null || raw.trim() === "") return { frontmatter: {}, body };
  let parsed: unknown;
  try {
    parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
  } catch {
    parsed = null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { frontmatter: {}, body };
  }
  return { frontmatter: parsed as Frontmatter, body };
}

/**
 * Derive a display title: frontmatter `title` (nonconforming pages only — the
 * §10.1.1 contract has no such field) → first markdown H1 → filename stem.
 * Always returns a non-empty string so both the BM25 2x title-boost and the
 * wiki_list `title` output field are meaningful for canonical pages.
 */
function deriveTitle(frontmatter: Frontmatter, body: string, relPath: string): string {
  if (typeof frontmatter.title === "string" && frontmatter.title.trim() !== "") {
    return frontmatter.title.trim();
  }
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim();
  const base = relPath.split("/").pop() ?? relPath;
  return base.replace(/\.md$/, "");
}

/** updated_at with legacy `updated` fallback (both real canonical pages and old fixtures). */
function pageUpdated(frontmatter: Frontmatter): string | undefined {
  const v =
    typeof frontmatter.updated_at === "string"
      ? frontmatter.updated_at
      : typeof frontmatter.updated === "string"
        ? frontmatter.updated
        : undefined;
  return v;
}

// ─── Wiki enumeration ────────────────────────────────────────────────────

interface WikiPage {
  absPath: string;
  relPath: string;     // posix style, relative to wiki root
  category: string;    // ALWAYS the directory segment ("index" for root files) —
                        // never the frontmatter `category` value (see header note).
  frontmatterCategory?: string; // raw frontmatter `category` (a topic taxonomy on
                                 // decision pages), surfaced separately.
  type?: string;        // raw frontmatter `type` (§10.1.1 base field)
  title: string;        // derived — see deriveTitle
  frontmatter: Frontmatter;
  body: string;
}

function walkDir(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkDir(full));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function loadAllPages(wikiRoot: string): WikiPage[] {
  if (!fs.existsSync(wikiRoot) || !fs.statSync(wikiRoot).isDirectory()) {
    return [];
  }
  const files = walkDir(wikiRoot).sort();
  const pages: WikiPage[] = [];
  for (const abs of files) {
    const rel = path.relative(wikiRoot, abs).split(path.sep).join("/");
    const category = rel.includes("/") ? rel.split("/")[0] : "index";
    const content = fs.readFileSync(abs, "utf8");
    const { frontmatter, body } = parseFrontmatter(content);
    pages.push({
      absPath: abs,
      relPath: rel,
      category, // directory segment, always — frontmatter never overrides (see header note)
      frontmatterCategory:
        typeof frontmatter.category === "string" ? frontmatter.category : undefined,
      type: typeof frontmatter.type === "string" ? frontmatter.type : undefined,
      title: deriveTitle(frontmatter, body, rel),
      frontmatter,
      body,
    });
  }
  return pages;
}

// ─── BM25 ranking (delegated to ./bm25.ts for testable re-use) ───────────────
// Pure BM25 utilities live in ./bm25.ts so tests can import them without
// starting the MCP server (index.ts executes main() at module load time).
import { tokenize, bm25Score } from "./bm25";

interface Scored {
  page: WikiPage;
  score: number;
}

function rankPages(
  pages: WikiPage[],
  query: string,
  limit: number
): Scored[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const docTokens = pages.map((p) => {
    // Title weighted 2x by duplication — cheap and predictable. p.title is
    // always derived (frontmatter title → first H1 → filename), so this is
    // no longer inert for canonical pages (which carry no `title:` field).
    return { tokens: tokenize(p.title + "\n" + p.title + "\n" + p.body) };
  });
  const scores = bm25Score(qTokens, docTokens);
  const ranked: Scored[] = pages
    .map((p, i) => ({ page: p, score: scores[i] }))
    .filter((s) => s.score > 0);
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.page.relPath.localeCompare(b.page.relPath)
  );
  return ranked.slice(0, limit);
}

function excerpt(body: string, queryTokens: string[], maxLen = 160): string {
  const lower = body.toLowerCase();
  let bestIdx = -1;
  for (const t of queryTokens) {
    const idx = lower.indexOf(t);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
  }
  const start = bestIdx === -1 ? 0 : Math.max(0, bestIdx - 40);
  return body
    .slice(start, start + maxLen)
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Path traversal guard ────────────────────────────────────────────────

function resolveInsideWiki(wikiRoot: string, rel: string): string | null {
  const full = path.resolve(wikiRoot, rel);
  const relCheck = path.relative(wikiRoot, full);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) return null;
  return full;
}

// ─── MCP server ──────────────────────────────────────────────────────────

function jsonResult(value: unknown): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(message: string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "guild-memory", version: "0.1.0" },
    {
      instructions:
        "BM25 search, read, and list over .guild/wiki/. Read-only. " +
        "Pass `cwd` to override the consuming repo root per-tool, or set " +
        "GUILD_MEMORY_WIKI_ROOT to point directly at a wiki directory.",
    }
  );

  // ─── wiki_search ──────────────────────────────────────────────────
  server.registerTool(
    "wiki_search",
    {
      title: "BM25 search over the Guild wiki",
      description:
        "Run a BM25 ranked search over .guild/wiki/ pages, optionally " +
        "filtered by category (the wiki directory segment, e.g. 'decisions'). " +
        "Returns page path, category, frontmatter type/frontmatter_category, " +
        "one-line excerpt, BM25 score, confidence, and source_refs (array).",
      inputSchema: {
        query: z.string().min(1).describe("Free-text query"),
        category: z
          .string()
          .optional()
          .describe("Restrict to a single wiki category (e.g. 'decisions')"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max number of results (default 20)"),
        cwd: z
          .string()
          .optional()
          .describe("Override consuming-repo root (defaults to server cwd)"),
      },
    },
    async ({ query, category, limit, cwd }) => {
      const wikiRoot = resolveWikiRoot(cwd);
      const all = loadAllPages(wikiRoot);
      const scoped = category ? all.filter((p) => p.category === category) : all;
      const ranked = rankPages(scoped, query, limit ?? 20);
      const qTokens = tokenize(query);
      const results = ranked.map((r) => ({
        path: r.page.relPath,
        category: r.page.category,
        type: r.page.type ?? null,
        frontmatter_category: r.page.frontmatterCategory ?? null,
        score: Math.round(r.score * 10000) / 10000,
        excerpt: excerpt(r.page.body, qTokens),
        confidence: (r.page.frontmatter.confidence as string) ?? null,
        source_refs: Array.isArray(r.page.frontmatter.source_refs)
          ? (r.page.frontmatter.source_refs as string[])
          : [],
      }));
      return jsonResult({ results, total: ranked.length, wiki_root: wikiRoot });
    }
  );

  // ─── wiki_get ─────────────────────────────────────────────────────
  server.registerTool(
    "wiki_get",
    {
      title: "Read a wiki page",
      description:
        "Return the full content and parsed YAML frontmatter for a wiki page. " +
        "`path` must be a relative path inside the wiki root.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Wiki-relative path, e.g. 'decisions/foo.md'"),
        cwd: z.string().optional().describe("Override consuming-repo root"),
      },
    },
    async ({ path: rel, cwd }) => {
      const wikiRoot = resolveWikiRoot(cwd);
      const abs = resolveInsideWiki(wikiRoot, rel);
      if (!abs) return errorResult(`Path escapes wiki root: ${rel}`);
      if (!fs.existsSync(abs)) return errorResult(`Page not found: ${rel}`);
      const content = fs.readFileSync(abs, "utf8");
      const { frontmatter, body } = parseFrontmatter(content);
      return jsonResult({
        path: rel,
        frontmatter,
        body,
      });
    }
  );

  // ─── wiki_list ────────────────────────────────────────────────────
  server.registerTool(
    "wiki_list",
    {
      title: "List wiki pages",
      description:
        "List every wiki page, optionally filtered by category (the wiki " +
        "directory segment) or by an `updated_since` cutoff (ISO date, read " +
        "from `updated_at` with legacy `updated` as fallback). Results are " +
        "sorted by path for deterministic output.",
      inputSchema: {
        category: z.string().optional().describe("Filter by category"),
        updated_since: z
          .string()
          .optional()
          .describe("ISO date/time; keep pages with `updated_at` (or legacy `updated`) on/after this"),
        cwd: z.string().optional().describe("Override consuming-repo root"),
      },
    },
    async ({ category, updated_since, cwd }) => {
      const wikiRoot = resolveWikiRoot(cwd);
      const all = loadAllPages(wikiRoot);
      const cutoff = updated_since ? new Date(updated_since).getTime() : null;
      const filtered = all.filter((p) => {
        if (category && p.category !== category) return false;
        if (cutoff !== null) {
          const u = pageUpdated(p.frontmatter);
          if (!u) return false;
          const t = new Date(u).getTime();
          if (Number.isNaN(t) || t < cutoff) return false;
        }
        return true;
      });
      const pages = filtered.map((p) => ({
        path: p.relPath,
        category: p.category,
        type: p.type ?? null,
        frontmatter_category: p.frontmatterCategory ?? null,
        title: p.title,
        confidence: (p.frontmatter.confidence as string) ?? null,
        updated: pageUpdated(p.frontmatter) ?? null,
      }));
      pages.sort((a, b) => a.path.localeCompare(b.path));
      return jsonResult({ pages, total: pages.length, wiki_root: wikiRoot });
    }
  );

  return server;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP transport.
  process.stderr.write("[guild-memory] ready\n");
}

main().catch((err) => {
  process.stderr.write(`[guild-memory] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});

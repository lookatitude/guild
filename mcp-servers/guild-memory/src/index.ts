#!/usr/bin/env -S npx tsx
/**
 * mcp-servers/guild-memory/src/index.ts
 *
 * Optional Guild MCP server — BM25 search + read + list over .guild/wiki/.
 * See guild-plan.md §13.3 (MCP servers) and §10.5 (scale transition).
 *
 * Tools:
 *   - wiki_search { query, category?, limit? }
 *       → { results: [{ path, category, excerpt, score, confidence, source_refs }] }
 *   - wiki_get { path }
 *       → { frontmatter, body }
 *   - wiki_list { category?, updated_since? }
 *       → { pages: [{ path, category, updated, confidence }] }
 *
 * Wiki root resolution (priority):
 *   1. GUILD_MEMORY_WIKI_ROOT env var (used by tests, overrides everything)
 *   2. <cwd arg>/.guild/wiki/
 *   3. process.cwd()/.guild/wiki/
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

// ─── Wiki root resolution ────────────────────────────────────────────────

function resolveWikiRoot(cwdArg?: string): string {
  if (process.env.GUILD_MEMORY_WIKI_ROOT) {
    return path.resolve(process.env.GUILD_MEMORY_WIKI_ROOT);
  }
  const cwd = cwdArg ? path.resolve(cwdArg) : process.cwd();
  return path.join(cwd, ".guild", "wiki");
}

// ─── Frontmatter parsing ─────────────────────────────────────────────────

interface Frontmatter {
  title?: string;
  category?: string;
  confidence?: "high" | "medium" | "low" | string;
  updated?: string;
  source_refs?: string[];
  [key: string]: unknown;
}

function parseFrontmatter(
  content: string
): { frontmatter: Frontmatter; body: string } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: {}, body: content };
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: content };

  const raw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\r?\n/, "");
  const frontmatter: Frontmatter = {};
  let currentKey: string | null = null;
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    // Simple YAML: "key: value" or "  - item" for lists
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch && currentKey) {
      const val = listMatch[1].trim().replace(/^['"]|['"]$/g, "");
      const existing = frontmatter[currentKey];
      if (Array.isArray(existing)) existing.push(val);
      else frontmatter[currentKey] = [val];
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const rawVal = kv[2].trim();
      currentKey = key;
      if (rawVal === "") {
        // expect list on following lines
        frontmatter[key] = [];
      } else {
        // strip surrounding quotes
        frontmatter[key] = rawVal.replace(/^['"]|['"]$/g, "");
      }
    }
  }
  return { frontmatter, body };
}

// ─── Wiki enumeration ────────────────────────────────────────────────────

interface WikiPage {
  absPath: string;
  relPath: string;     // posix style, relative to wiki root
  category: string;    // first path segment or "index" for root files
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
      category: (frontmatter.category as string) || category,
      frontmatter,
      body,
    });
  }
  return pages;
}

// ─── BM25 ranking ────────────────────────────────────────────────────────

const TOKEN_RE = /[A-Za-z0-9]+/g;
function tokenize(s: string): string[] {
  const out: string[] = [];
  const m = s.toLowerCase().match(TOKEN_RE);
  if (!m) return out;
  for (const tok of m) if (tok.length > 1) out.push(tok);
  return out;
}

interface Scored {
  page: WikiPage;
  score: number;
}

function bm25Score(
  queryTokens: string[],
  docs: { tokens: string[] }[]
): number[] {
  // Classic BM25 (k1=1.5, b=0.75)
  const k1 = 1.5;
  const b = 0.75;
  const N = docs.length;
  if (N === 0) return [];
  const avgdl = docs.reduce((s, d) => s + d.tokens.length, 0) / N;

  // DF per query token
  const df = new Map<string, number>();
  for (const q of new Set(queryTokens)) {
    let count = 0;
    for (const d of docs) {
      if (d.tokens.includes(q)) count++;
    }
    df.set(q, count);
  }

  const scores: number[] = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const doc = docs[i];
    const dl = doc.tokens.length || 1;
    // Term frequencies for this doc (once)
    const tf = new Map<string, number>();
    for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let s = 0;
    for (const q of queryTokens) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      const n = df.get(q) ?? 0;
      // IDF with +1 floor so zero-document-frequency never explodes negative
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const num = f * (k1 + 1);
      const den = f + k1 * (1 - b + b * (dl / avgdl));
      s += idf * (num / den);
    }
    scores[i] = s;
  }
  return scores;
}

function rankPages(
  pages: WikiPage[],
  query: string,
  limit: number
): Scored[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const docTokens = pages.map((p) => {
    const title = (p.frontmatter.title as string) || "";
    return { tokens: tokenize(title + "\n" + title + "\n" + p.body) };
    // Title weighted 2x by duplication — cheap and predictable.
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
        "filtered by category. Returns page path, category, one-line " +
        "excerpt, BM25 score, confidence, and source_refs.",
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
        score: Math.round(r.score * 10000) / 10000,
        excerpt: excerpt(r.page.body, qTokens),
        confidence: (r.page.frontmatter.confidence as string) ?? null,
        source_refs: (r.page.frontmatter.source_refs as string[] | undefined) ?? [],
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
        "List every wiki page, optionally filtered by category or by an " +
        "`updated_since` cutoff (ISO date). Results are sorted by path for " +
        "deterministic output.",
      inputSchema: {
        category: z.string().optional().describe("Filter by category"),
        updated_since: z
          .string()
          .optional()
          .describe("ISO date/time; keep pages with `updated` on/after this"),
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
          const u = p.frontmatter.updated as string | undefined;
          if (!u) return false;
          const t = new Date(u).getTime();
          if (Number.isNaN(t) || t < cutoff) return false;
        }
        return true;
      });
      const pages = filtered.map((p) => ({
        path: p.relPath,
        category: p.category,
        title: (p.frontmatter.title as string) ?? null,
        confidence: (p.frontmatter.confidence as string) ?? null,
        updated: (p.frontmatter.updated as string) ?? null,
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

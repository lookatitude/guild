/**
 * mcp-servers/guild-memory/__tests__/guild-memory.test.ts
 *
 * TDD: spawns src/index.ts as a stdio MCP server and drives it via the
 * @modelcontextprotocol/sdk client. Each test covers the tool's happy path
 * plus at least one edge case per guild-plan.md §13.3.
 *
 * All fixture wiki pages live under ./fixtures/wiki/ and are written in the
 * REAL §10.1.1 producer shape (type/owner/confidence/source_refs/created_at/
 * updated_at/expires_at/supersedes/sensitivity — the shape guild:wiki-ingest
 * and guild:decisions actually write, copied from this repo's own
 * .guild/wiki/ pages), not the server's previously-wrong assumed shape
 * (title/category-as-directory-override/updated/block-list-only source_refs).
 * The server is invoked with a `cwd` argument (or GUILD_MEMORY_WIKI_ROOT env
 * var) pointing at the fixtures dir so .guild/wiki resolution works without
 * the fixture living under a real .guild/.
 */

import * as path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = path.resolve(__dirname, "../src/index.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

async function makeClient(env: Record<string, string> = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "tsx", SERVER],
    env: {
      ...(process.env as Record<string, string>),
      GUILD_MEMORY_WIKI_ROOT: path.join(FIXTURES, "wiki"),
      ...env,
    },
  });
  const client = new Client(
    { name: "guild-memory-test", version: "0.0.1" },
    { capabilities: {} }
  );
  await client.connect(transport);
  return client;
}

function textOf(result: any): string {
  return result.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}

function parseJson(result: any): any {
  return JSON.parse(textOf(result));
}

describe("guild-memory MCP server", () => {
  // ─── list tools ────────────────────────────────────────────────────
  describe("tools/list", () => {
    it("exposes wiki_search, wiki_get, wiki_list", async () => {
      const client = await makeClient();
      try {
        const tools = await client.listTools();
        const names = tools.tools.map((t) => t.name).sort();
        expect(names).toContain("wiki_search");
        expect(names).toContain("wiki_get");
        expect(names).toContain("wiki_list");
      } finally {
        await client.close();
      }
    });

    it("each tool has a JSON Schema inputSchema", async () => {
      const client = await makeClient();
      try {
        const tools = await client.listTools();
        for (const t of tools.tools) {
          expect(t.inputSchema).toBeDefined();
          expect(t.inputSchema.type).toBe("object");
        }
      } finally {
        await client.close();
      }
    });
  });

  // ─── wiki_search ───────────────────────────────────────────────────
  describe("wiki_search", () => {
    it("returns ranked results for a BM25-matchable query (happy)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_search",
          arguments: { query: "BM25 embeddings search" },
        });
        const payload = parseJson(res);
        expect(Array.isArray(payload.results)).toBe(true);
        expect(payload.results.length).toBeGreaterThan(0);
        // The decisions page is the exact match — should rank first. Its
        // title is derived from its H1 (canonical pages carry no `title:`
        // frontmatter field), proving the 2x title boost is no longer inert.
        const top = payload.results[0];
        expect(top.path).toMatch(/decisions\/bm25-over-embeddings\.md$/);
        expect(top).toHaveProperty("category", "decisions");
        expect(top).toHaveProperty("score");
        expect(typeof top.score).toBe("number");
        expect(top).toHaveProperty("excerpt");
        expect(top).toHaveProperty("confidence");
        expect(top).toHaveProperty("source_refs");
      } finally {
        await client.close();
      }
    });

    it("flags type_valid true for a page whose type: is in the §10.1.1 canonical enum (wiki-frontmatter-contract.ts)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_search",
          arguments: { query: "BM25 embeddings search" },
        });
        const payload = parseJson(res);
        const top = payload.results[0];
        // Fixture declares `type: decision` — a canonical WIKI_PAGE_TYPES value.
        expect(top.type).toBe("decision");
        expect(top.type_valid).toBe(true);
      } finally {
        await client.close();
      }
    });

    it("returns source_refs as an array, not a raw string (fix: inline flow-list parsing)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_search",
          arguments: { query: "BM25 embeddings search" },
        });
        const payload = parseJson(res);
        const top = payload.results[0];
        // Fixture declares source_refs as an inline flow list:
        // source_refs: [".guild/raw/2026-03-20-search-benchmark.md", "docs/v2/13-mcp-servers.md"]
        expect(Array.isArray(top.source_refs)).toBe(true);
        expect(top.source_refs).toEqual([
          ".guild/raw/2026-03-20-search-benchmark.md",
          "docs/v2/13-mcp-servers.md",
        ]);
      } finally {
        await client.close();
      }
    });

    it("category filter uses the wiki directory segment, not frontmatter `category` (fix)", async () => {
      const client = await makeClient();
      try {
        // The decisions fixture carries `category: architecture` in its
        // frontmatter (a §10.3 TOPIC taxonomy value, per guild:decisions),
        // NOT the directory name. Filtering by category:"decisions" must
        // still find it via the directory segment.
        const res = await client.callTool({
          name: "wiki_search",
          arguments: { query: "BM25 deterministic", category: "decisions" },
        });
        const payload = parseJson(res);
        expect(payload.results.length).toBeGreaterThan(0);
        const hit = payload.results.find((r: any) =>
          r.path.endsWith("bm25-over-embeddings.md")
        );
        expect(hit).toBeDefined();
        expect(hit.category).toBe("decisions");
        // The frontmatter topic is surfaced separately, not conflated.
        expect(hit.frontmatter_category).toBe("architecture");
        expect(hit.type).toBe("decision");
      } finally {
        await client.close();
      }
    });

    it("filters by category when supplied (edge)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_search",
          arguments: { query: "specialists team", category: "context" },
        });
        const payload = parseJson(res);
        for (const hit of payload.results) {
          expect(hit.category).toBe("context");
        }
      } finally {
        await client.close();
      }
    });

    it("returns empty results for a query with zero token overlap", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_search",
          arguments: { query: "zzzznothingmatcheshere42" },
        });
        const payload = parseJson(res);
        expect(payload.results).toEqual([]);
      } finally {
        await client.close();
      }
    });

    it("respects the limit argument", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_search",
          arguments: { query: "specialists guild wiki", limit: 2 },
        });
        const payload = parseJson(res);
        expect(payload.results.length).toBeLessThanOrEqual(2);
      } finally {
        await client.close();
      }
    });
  });

  // ─── wiki_get ─────────────────────────────────────────────────────
  describe("wiki_get", () => {
    it("returns full page body and parsed frontmatter (happy)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_get",
          arguments: { path: "decisions/bm25-over-embeddings.md" },
        });
        const payload = parseJson(res);
        expect(payload.frontmatter).toBeDefined();
        expect(payload.frontmatter.type).toBe("decision");
        expect(payload.frontmatter.owner).toBe("architect");
        expect(payload.frontmatter.confidence).toBe("high");
        expect(payload.frontmatter.decision_id).toBe("D-2026-03-22-01");
        // §10.3 topic taxonomy field — distinct from the directory category.
        expect(payload.frontmatter.category).toBe("architecture");
        // Inline flow-list source_refs parses to a real array (fix).
        expect(Array.isArray(payload.frontmatter.source_refs)).toBe(true);
        expect(payload.frontmatter.source_refs).toHaveLength(2);
        expect(payload.body).toMatch(/deterministic/);
      } finally {
        await client.close();
      }
    });

    it("parses a block-style (indented `- item`) source_refs list too", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_get",
          arguments: { path: "standards/testing-policy.md" },
        });
        const payload = parseJson(res);
        expect(Array.isArray(payload.frontmatter.source_refs)).toBe(true);
        expect(payload.frontmatter.source_refs).toEqual([
          ".guild/raw/2026-03-18-testing-summit.md",
        ]);
      } finally {
        await client.close();
      }
    });

    it("returns an error for a missing page (edge)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_get",
          arguments: { path: "decisions/does-not-exist.md" },
        });
        expect(res.isError).toBe(true);
      } finally {
        await client.close();
      }
    });

    it("rejects path traversal attempts (edge)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_get",
          arguments: { path: "../../../etc/passwd" },
        });
        expect(res.isError).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  // ─── wiki_list ────────────────────────────────────────────────────
  describe("wiki_list", () => {
    it("lists every wiki page when no filters given (happy)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_list",
          arguments: {},
        });
        const payload = parseJson(res);
        expect(Array.isArray(payload.pages)).toBe(true);
        // 1 index + 2 context + 2 standards + 1 decisions = 6
        expect(payload.pages.length).toBe(6);
        // Each entry has path, category, title
        for (const p of payload.pages) {
          expect(p).toHaveProperty("path");
          expect(p).toHaveProperty("category");
          expect(p).toHaveProperty("title");
          expect(typeof p.title).toBe("string");
          expect(p.title.length).toBeGreaterThan(0);
        }
      } finally {
        await client.close();
      }
    });

    it("flags type_valid per page against the §10.1.1 canonical enum, and false for index.md (no frontmatter at all)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_list",
          arguments: {},
        });
        const payload = parseJson(res);
        const decision = payload.pages.find(
          (p: any) => p.path === "decisions/bm25-over-embeddings.md"
        );
        expect(decision.type).toBe("decision");
        expect(decision.type_valid).toBe(true);
        // index.md has no frontmatter block at all — type is absent, so
        // type_valid must be false (never throws on a non-conforming page).
        const index = payload.pages.find((p: any) => p.path === "index.md");
        expect(index.type).toBeNull();
        expect(index.type_valid).toBe(false);
      } finally {
        await client.close();
      }
    });

    it("derives title from the first H1 when no frontmatter `title` exists (fix)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_list",
          arguments: {},
        });
        const payload = parseJson(res);
        const index = payload.pages.find((p: any) => p.path === "index.md");
        // index.md carries NO frontmatter block at all (matches this repo's
        // real .guild/wiki/index.md shape) — title must fall back to the H1.
        expect(index.title).toBe("Wiki index");
        const decision = payload.pages.find(
          (p: any) => p.path === "decisions/bm25-over-embeddings.md"
        );
        expect(decision.title).toBe(
          "BM25 chosen over embeddings for initial wiki search"
        );
      } finally {
        await client.close();
      }
    });

    it("filters by category using the directory segment, not frontmatter `category` (fix)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_list",
          arguments: { category: "decisions" },
        });
        const payload = parseJson(res);
        // The decisions fixture's frontmatter `category: architecture` (a
        // topic value) must not exclude it from the "decisions" directory
        // filter.
        expect(payload.pages.length).toBe(1);
        expect(payload.pages[0].path).toBe("decisions/bm25-over-embeddings.md");
        expect(payload.pages[0].category).toBe("decisions");
        expect(payload.pages[0].frontmatter_category).toBe("architecture");
        expect(payload.pages[0].type).toBe("decision");
      } finally {
        await client.close();
      }
    });

    it("filters by category when supplied (edge)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_list",
          arguments: { category: "standards" },
        });
        const payload = parseJson(res);
        expect(payload.pages.length).toBe(2);
        for (const p of payload.pages) {
          expect(p.category).toBe("standards");
        }
      } finally {
        await client.close();
      }
    });

    it("filters by updated_since reading `updated_at` (fix: was reading a key no canonical page has)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_list",
          arguments: { updated_since: "2026-03-15" },
        });
        const payload = parseJson(res);
        // bm25-over-embeddings (updated_at: 2026-03-22) and testing-policy
        // (legacy `updated:` 2026-04-05 — no updated_at at all) both qualify.
        expect(payload.pages.length).toBe(2);
        const paths = payload.pages.map((p: any) => p.path).sort();
        expect(paths).toEqual([
          "decisions/bm25-over-embeddings.md",
          "standards/testing-policy.md",
        ]);
      } finally {
        await client.close();
      }
    });

    it("surfaces `updated` in the output from updated_at, with legacy `updated` as fallback", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_list",
          arguments: {},
        });
        const payload = parseJson(res);
        const canonical = payload.pages.find(
          (p: any) => p.path === "context/project-overview.md"
        );
        expect(canonical.updated).toBe("2026-01-15"); // from updated_at
        const legacy = payload.pages.find(
          (p: any) => p.path === "standards/testing-policy.md"
        );
        expect(legacy.updated).toBe("2026-04-05"); // from legacy `updated` fallback
        const noDate = payload.pages.find((p: any) => p.path === "index.md");
        expect(noDate.updated).toBeNull();
      } finally {
        await client.close();
      }
    });

    it("returns pages sorted deterministically by path", async () => {
      const client = await makeClient();
      try {
        const res1 = await client.callTool({
          name: "wiki_list",
          arguments: {},
        });
        const res2 = await client.callTool({
          name: "wiki_list",
          arguments: {},
        });
        expect(parseJson(res1)).toEqual(parseJson(res2));
      } finally {
        await client.close();
      }
    });
  });

  // ─── wiki root resolution precedence ──────────────────────────────
  describe("wiki root resolution", () => {
    it("an explicit per-tool `cwd` argument wins over GUILD_MEMORY_WIKI_ROOT (fix)", async () => {
      // Server process env still sets GUILD_MEMORY_WIKI_ROOT to fixtures/wiki
      // (6 pages); the tool call passes an explicit cwd pointing at a
      // completely different repo root with exactly 1 page. The explicit
      // argument must win so federated per-child cwd fan-out works on a
      // long-lived server even when a launch-time env var is set.
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_list",
          arguments: { cwd: path.join(FIXTURES, "alt-repo") },
        });
        const payload = parseJson(res);
        expect(payload.pages.length).toBe(1);
        expect(payload.pages[0].path).toBe("only-page.md");
        expect(payload.wiki_root).toBe(
          path.join(FIXTURES, "alt-repo", ".guild", "wiki")
        );
      } finally {
        await client.close();
      }
    });
  });
});

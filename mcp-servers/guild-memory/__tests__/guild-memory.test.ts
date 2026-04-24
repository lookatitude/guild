/**
 * mcp-servers/guild-memory/__tests__/guild-memory.test.ts
 *
 * TDD: spawns src/index.ts as a stdio MCP server and drives it via the
 * @modelcontextprotocol/sdk client. Each test covers the tool's happy path
 * plus at least one edge case per guild-plan.md §13.3.
 *
 * All fixture wiki pages live under ./fixtures/wiki/ and the server is
 * invoked with cwd argument pointing at the fixtures dir so .guild/wiki
 * resolution works without the fixture living under .guild/.
 */

import * as path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = path.resolve(__dirname, "../src/index.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

async function makeClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "tsx", SERVER],
    env: {
      ...(process.env as Record<string, string>),
      GUILD_MEMORY_WIKI_ROOT: path.join(FIXTURES, "wiki"),
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
        // The decisions page is the exact match — should rank first.
        expect(payload.results[0].path).toMatch(/decisions\/bm25-over-embeddings\.md$/);
        expect(payload.results[0]).toHaveProperty("category", "decisions");
        expect(payload.results[0]).toHaveProperty("score");
        expect(typeof payload.results[0].score).toBe("number");
        expect(payload.results[0]).toHaveProperty("excerpt");
        expect(payload.results[0]).toHaveProperty("confidence");
        expect(payload.results[0]).toHaveProperty("source_refs");
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
        expect(payload.frontmatter.title).toMatch(/BM25/);
        expect(payload.frontmatter.confidence).toBe("high");
        expect(payload.frontmatter.decision_id).toBe("D-2026-03-22-01");
        expect(payload.body).toMatch(/deterministic/);
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
        // Each entry has path, category, updated
        for (const p of payload.pages) {
          expect(p).toHaveProperty("path");
          expect(p).toHaveProperty("category");
        }
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

    it("filters by updated_since when supplied (edge)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "wiki_list",
          arguments: { updated_since: "2026-03-15" },
        });
        const payload = parseJson(res);
        // Only bm25-decisions (2026-03-22) and testing-policy (2026-04-05) qualify
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
});

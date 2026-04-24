/**
 * mcp-servers/guild-telemetry/__tests__/guild-telemetry.test.ts
 *
 * TDD: spawns src/index.ts as a stdio MCP server and drives it via the
 * @modelcontextprotocol/sdk client. Each tool gets ≥2 tests (happy + edge).
 *
 * Fixtures live under ./fixtures/.guild/runs/{run-alpha,run-beta}/... . We
 * pass the fixture directory as cwd so the server resolves .guild/runs
 * against it instead of the test runner's cwd.
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
      GUILD_TELEMETRY_CWD: FIXTURES,
    },
  });
  const client = new Client(
    { name: "guild-telemetry-test", version: "0.0.1" },
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

describe("guild-telemetry MCP server", () => {
  // ─── list tools ──────────────────────────────────────────────────
  describe("tools/list", () => {
    it("exposes trace_summary, trace_query, trace_list_runs", async () => {
      const client = await makeClient();
      try {
        const tools = await client.listTools();
        const names = tools.tools.map((t) => t.name).sort();
        expect(names).toContain("trace_summary");
        expect(names).toContain("trace_query");
        expect(names).toContain("trace_list_runs");
      } finally {
        await client.close();
      }
    });
  });

  // ─── trace_summary ───────────────────────────────────────────────
  describe("trace_summary", () => {
    it("returns pre-existing summary.md verbatim when present (happy)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_summary",
          arguments: { run_id: "run-beta" },
        });
        const payload = parseJson(res);
        expect(payload.source).toBe("file");
        expect(payload.summary).toMatch(/Pre-existing summary fixture/);
      } finally {
        await client.close();
      }
    });

    it("synthesizes a summary from events.ndjson when summary.md absent (edge)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_summary",
          arguments: { run_id: "run-alpha" },
        });
        const payload = parseJson(res);
        expect(payload.source).toBe("synthesized");
        expect(payload.summary).toMatch(/run_id:\s*run-alpha/);
        expect(payload.summary).toMatch(/# Run run-alpha summary/);
        expect(payload.summary).toMatch(/event_count:\s*8/);
      } finally {
        await client.close();
      }
    });

    it("errors when run_id does not exist (edge)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_summary",
          arguments: { run_id: "does-not-exist" },
        });
        expect(res.isError).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  // ─── trace_query ─────────────────────────────────────────────────
  describe("trace_query", () => {
    it("returns all events from all runs when no filter given (happy)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_query",
          arguments: {},
        });
        const payload = parseJson(res);
        // run-alpha has 8 events, run-beta has 5 → 13 total
        expect(payload.events.length).toBe(13);
      } finally {
        await client.close();
      }
    });

    it("filters by run_id (edge)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_query",
          arguments: { run_id: "run-beta" },
        });
        const payload = parseJson(res);
        expect(payload.events.length).toBe(5);
        for (const e of payload.events) {
          expect(e.run_id).toBe("run-beta");
        }
      } finally {
        await client.close();
      }
    });

    it("filters by event type (edge)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_query",
          arguments: { event: "SubagentStop" },
        });
        const payload = parseJson(res);
        // 2 in run-alpha, 1 in run-beta
        expect(payload.events.length).toBe(3);
        for (const e of payload.events) {
          expect(e.event).toBe("SubagentStop");
        }
      } finally {
        await client.close();
      }
    });

    it("filters by specialist (edge)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_query",
          arguments: { specialist: "copywriter" },
        });
        const payload = parseJson(res);
        // run-beta has 4 specialist rows + SubagentStop for copywriter
        for (const e of payload.events) {
          expect(e.specialist).toBe("copywriter");
        }
        expect(payload.events.length).toBeGreaterThan(0);
      } finally {
        await client.close();
      }
    });

    it("filters by since (iso-date)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_query",
          arguments: { since: "2026-04-01T00:00:00.000Z" },
        });
        const payload = parseJson(res);
        // Only run-beta (April) events
        expect(payload.events.length).toBe(5);
      } finally {
        await client.close();
      }
    });

    it("applies limit", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_query",
          arguments: { limit: 3 },
        });
        const payload = parseJson(res);
        expect(payload.events.length).toBe(3);
      } finally {
        await client.close();
      }
    });
  });

  // ─── trace_list_runs ─────────────────────────────────────────────
  describe("trace_list_runs", () => {
    it("lists known runs with counts + date range (happy)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_list_runs",
          arguments: {},
        });
        const payload = parseJson(res);
        expect(payload.runs.length).toBe(2);
        const ids = payload.runs.map((r: any) => r.run_id).sort();
        expect(ids).toEqual(["run-alpha", "run-beta"]);
        for (const r of payload.runs) {
          expect(r).toHaveProperty("event_count");
          expect(r).toHaveProperty("started_at");
          expect(r).toHaveProperty("ended_at");
          expect(typeof r.event_count).toBe("number");
        }
      } finally {
        await client.close();
      }
    });

    it("filters by since (iso-date) (edge)", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_list_runs",
          arguments: { since: "2026-04-01T00:00:00.000Z" },
        });
        const payload = parseJson(res);
        expect(payload.runs.length).toBe(1);
        expect(payload.runs[0].run_id).toBe("run-beta");
      } finally {
        await client.close();
      }
    });

    it("respects limit", async () => {
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_list_runs",
          arguments: { limit: 1 },
        });
        const payload = parseJson(res);
        expect(payload.runs.length).toBe(1);
      } finally {
        await client.close();
      }
    });
  });
});

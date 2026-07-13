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
// ADR-OBS-4: isolated fixture root holding runs that record the v1.4 JSONL
// live log (logs/v1.4-events.jsonl) so the legacy-shape assertions above stay
// independent of these.
const FIXTURES_V14 = path.resolve(__dirname, "../fixtures-v14");
// A third, disjoint fixture root used only to prove that an explicit
// per-tool `cwd` argument wins over GUILD_TELEMETRY_CWD (fix).
const FIXTURES_ALT_CWD = path.resolve(__dirname, "../fixtures-alt-cwd");

async function makeClientForCwd(cwd: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "tsx", SERVER],
    env: {
      ...(process.env as Record<string, string>),
      GUILD_TELEMETRY_CWD: cwd,
    },
  });
  const client = new Client(
    { name: "guild-telemetry-test", version: "0.0.1" },
    { capabilities: {} }
  );
  await client.connect(transport);
  return client;
}

async function makeClient(): Promise<Client> {
  return makeClientForCwd(FIXTURES);
}

async function makeClientV14(): Promise<Client> {
  return makeClientForCwd(FIXTURES_V14);
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
    it("exposes trace_summary, trace_query, trace_list_runs, trace_cost_rollup", async () => {
      const client = await makeClient();
      try {
        const tools = await client.listTools();
        const names = tools.tools.map((t) => t.name).sort();
        expect(names).toContain("trace_summary");
        expect(names).toContain("trace_query");
        expect(names).toContain("trace_list_runs");
        expect(names).toContain("trace_cost_rollup");
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

  // ─── ADR-OBS-4: v1.4-events.jsonl primary read ──────────────────────
  describe("v1.4-events.jsonl primary read (ADR-OBS-4)", () => {
    it("synthesizes a summary from logs/v1.4-events.jsonl (happy)", async () => {
      const client = await makeClientV14();
      try {
        const res = await client.callTool({
          name: "trace_summary",
          arguments: { run_id: "run-cost" },
        });
        const payload = parseJson(res);
        expect(payload.source).toBe("synthesized");
        expect(payload.summary).toMatch(/run_id:\s*run-cost/);
        // 4 events recorded in the v1.4 live log
        expect(payload.summary).toMatch(/event_count:\s*4/);
      } finally {
        await client.close();
      }
    });

    it("prefers v1.4-events.jsonl over legacy events.ndjson when both exist (edge)", async () => {
      const client = await makeClientV14();
      try {
        const res = await client.callTool({
          name: "trace_summary",
          arguments: { run_id: "run-precedence" },
        });
        const payload = parseJson(res);
        // v1.4 log has 2 events; legacy events.ndjson has 5 — primary wins
        expect(payload.summary).toMatch(/event_count:\s*2/);
      } finally {
        await client.close();
      }
    });

    it("trace_query reads v1.4 events and exposes event types (edge)", async () => {
      const client = await makeClientV14();
      try {
        const res = await client.callTool({
          name: "trace_query",
          arguments: { run_id: "run-cost" },
        });
        const payload = parseJson(res);
        expect(payload.events.length).toBe(4);
        const types = payload.events.map((e: any) => e.event).sort();
        expect(types).toContain("specialist_dispatch");
        expect(types).toContain("tool_call");
      } finally {
        await client.close();
      }
    });
  });

  // ─── ADR-OBS-4: trace_cost_rollup ───────────────────────────────────
  describe("trace_cost_rollup", () => {
    it("rolls up token totals across a run, merging v2 tokens + tool_call scalars (happy)", async () => {
      const client = await makeClientV14();
      try {
        const res = await client.callTool({
          name: "trace_cost_rollup",
          arguments: { run_id: "run-cost" },
        });
        const payload = parseJson(res);
        // input  = 1000 (dispatch) + 50 (tool_call tokens_in) + 2000 = 3050
        // output =  400 (dispatch) + 20 (tool_call tokens_out) + 900 = 1320
        // cached =  200
        expect(payload.totals.input).toBe(3050);
        expect(payload.totals.output).toBe(1320);
        expect(payload.totals.cached).toBe(200);
        expect(payload.totals.total).toBe(4370);
        expect(payload.event_count).toBe(4);
        expect(payload.llm_event_count).toBe(3);
      } finally {
        await client.close();
      }
    });

    it("breaks down by tier/model/specialist sorted by total desc (edge)", async () => {
      const client = await makeClientV14();
      try {
        const res = await client.callTool({
          name: "trace_cost_rollup",
          arguments: { run_id: "run-cost" },
        });
        const payload = parseJson(res);
        // powerful/opus (2900) outranks mid/sonnet (1470)
        expect(payload.by_tier[0].tier).toBe("powerful");
        expect(payload.by_tier[0].total).toBe(2900);
        expect(payload.by_model[0].model).toBe("opus");
        const backend = payload.by_specialist.find(
          (r: any) => r.specialist === "backend"
        );
        expect(backend.input).toBe(1000);
        expect(backend.cached).toBe(200);
        // tool_call had no specialist → bucketed under its lane_id
        const byLane = payload.by_specialist.find(
          (r: any) => r.specialist === "L1"
        );
        expect(byLane.input).toBe(50);
      } finally {
        await client.close();
      }
    });

    it("errors when an explicit run_id does not exist (edge)", async () => {
      const client = await makeClientV14();
      try {
        const res = await client.callTool({
          name: "trace_cost_rollup",
          arguments: { run_id: "nope" },
        });
        expect(res.isError).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  // ─── status "n/a" handling (fix) ─────────────────────────────────
  describe('tool_call status "n/a"', () => {
    it("is treated as neither ok nor error — excluded from ok_rate, not counted as an error", async () => {
      const client = await makeClientV14();
      try {
        const res = await client.callTool({
          name: "trace_summary",
          arguments: { run_id: "run-status-na" },
        });
        const payload = parseJson(res);
        // Fixture: 1 "ok", 1 "error", 2 "n/a" tool_call events.
        // Old (broken) behavior: n/a -> ok=false, so errors=3, ok_rate=0.25.
        // Fixed behavior: only the ok/error-defined events (2) count;
        // errors=1, ok_rate=0.5.
        expect(payload.summary).toMatch(/event_count:\s*4/);
        expect(payload.summary).toMatch(/errors:\s*1/);
        expect(payload.summary).toMatch(/ok_rate:\s*0\.5/);
      } finally {
        await client.close();
      }
    });
  });

  // ─── cwd resolution precedence (fix) ──────────────────────────────
  describe("cwd resolution", () => {
    it("an explicit per-tool `cwd` argument wins over GUILD_TELEMETRY_CWD", async () => {
      // Server process env sets GUILD_TELEMETRY_CWD to the default fixtures
      // dir (2 runs); the tool call passes an explicit cwd pointing at a
      // disjoint fixture root with exactly 1 run. The explicit argument must
      // win so federated per-child cwd fan-out works on a long-lived server.
      const client = await makeClient();
      try {
        const res = await client.callTool({
          name: "trace_list_runs",
          arguments: { cwd: FIXTURES_ALT_CWD },
        });
        const payload = parseJson(res);
        expect(payload.runs.length).toBe(1);
        expect(payload.runs[0].run_id).toBe("run-only");
      } finally {
        await client.close();
      }
    });
  });
});

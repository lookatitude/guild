/**
 * mcp-servers/guild-telemetry/__tests__/dispatch-parity.test.ts
 *
 * rf-wi-02 (G2, part 2) — trace_summary must carry `dispatched_lanes` and
 * `dispatch_receipts` at PARITY with scripts/trace-summarize.ts. Before this
 * lane the MCP's synthesized summary omitted both, so a pane-only run queried
 * through the MCP reported "no specialists" even though N lanes dispatched
 * (each pane is a separate host session — none of its tool calls land in this
 * log; the dispatch receipt is the only lane signal).
 *
 * Self-contained: seeds a tmp run dir with a confirmed dispatch receipt and
 * points the server at it via GUILD_TELEMETRY_CWD, so shared fixtures (and
 * their count assertions) are untouched.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = path.resolve(__dirname, "../src/index.ts");

async function makeClientForCwd(cwd: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "tsx", SERVER],
    env: { ...(process.env as Record<string, string>), GUILD_TELEMETRY_CWD: cwd },
  });
  const client = new Client({ name: "dispatch-parity-test", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function parseJson(result: any): any {
  return JSON.parse(
    result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
  );
}

const DISPATCH_RUN = [
  { ts: "2026-03-11T10:00:00.000Z", event: "run_started", run_id: "run-dispatch" },
  { schema_version: "guild.trace.dispatch.v1", ts: "2026-03-11T10:00:01.000Z", event: "specialist_dispatch", run_id: "run-dispatch", backend: "tmux", specialist: "backend", task_id: "t1" },
  { schema_version: "guild.trace.dispatch.v1", ts: "2026-03-11T10:00:02.000Z", event: "specialist_dispatch", run_id: "run-dispatch", backend: "tmux", specialist: "backend", task_id: "t1" },
  { schema_version: "guild.trace.dispatch.v1", ts: "2026-03-11T10:00:03.000Z", event: "specialist_dispatch", run_id: "run-dispatch", backend: "tmux", specialist: "frontend", task_id: "t2" },
  { ts: "2026-03-11T10:00:04.000Z", event: "run_closed", run_id: "run-dispatch" },
];

describe("trace_summary dispatch parity (rf-wi-02)", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-tel-parity-"));
    const logs = path.join(tmpDir, ".guild", "runs", "run-dispatch", "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(
      path.join(logs, "v1.4-events.jsonl"),
      DISPATCH_RUN.map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf8"
    );
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("synthesized summary reports dispatched_lanes (distinct) and dispatch_receipts (raw)", async () => {
    const client = await makeClientForCwd(tmpDir);
    try {
      const res = await client.callTool({ name: "trace_summary", arguments: { run_id: "run-dispatch" } });
      const payload = parseJson(res);
      expect(payload.source).toBe("synthesized");
      // 2 distinct lanes (t1, t2) on tmux; 3 raw receipts on tmux.
      expect(payload.summary).toMatch(/dispatched_lanes:\s*\[tmux: 2\]/);
      expect(payload.summary).toMatch(/dispatch_receipts:\s*\[tmux: 3\]/);
    } finally {
      await client.close();
    }
  });

  it("a summary.md that only MENTIONS the field names in prose is still re-synthesized (codex r3 finding 2)", async () => {
    // The guard must check frontmatter KEYS, not a body substring.
    fs.writeFileSync(
      path.join(tmpDir, ".guild", "runs", "run-dispatch", "summary.md"),
      "---\nrun_id: run-dispatch\n---\n# Legacy\nThe new format adds `dispatched_lanes:` and `dispatch_receipts:` here.\n",
      "utf8"
    );
    const client = await makeClientForCwd(tmpDir);
    try {
      const res = await client.callTool({ name: "trace_summary", arguments: { run_id: "run-dispatch" } });
      const payload = parseJson(res);
      expect(payload.source).toBe("synthesized");
      expect(payload.summary).toMatch(/dispatched_lanes:\s*\[tmux: 2\]/);
    } finally {
      await client.close();
    }
  });

  it("a YAML multiline-scalar embedding the field names is still re-synthesized (codex r4 finding 2)", async () => {
    // Both names live inside a `description:` block scalar → NOT own top-level keys.
    fs.writeFileSync(
      path.join(tmpDir, ".guild", "runs", "run-dispatch", "summary.md"),
      '---\ndescription: "legacy prose\ndispatched_lanes:\ndispatch_receipts:"\n---\n# stale\n',
      "utf8"
    );
    const client = await makeClientForCwd(tmpDir);
    try {
      const res = await client.callTool({ name: "trace_summary", arguments: { run_id: "run-dispatch" } });
      const payload = parseJson(res);
      expect(payload.source).toBe("synthesized");
      expect(payload.summary).toMatch(/dispatched_lanes:\s*\[tmux: 2\]/);
    } finally {
      await client.close();
    }
  });

  it("a fake closing delimiter (---not-a-delimiter) is not a frontmatter block → re-synthesized (codex r5 finding 2)", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".guild", "runs", "run-dispatch", "summary.md"),
      "---\ndispatched_lanes: [bogus: 99]\ndispatch_receipts: [bogus: 99]\n---not-a-delimiter\n# stale\n",
      "utf8"
    );
    const client = await makeClientForCwd(tmpDir);
    try {
      const res = await client.callTool({ name: "trace_summary", arguments: { run_id: "run-dispatch" } });
      const payload = parseJson(res);
      expect(payload.source).toBe("synthesized");
      expect(payload.summary).toMatch(/dispatched_lanes:\s*\[tmux: 2\]/);
    } finally {
      await client.close();
    }
  });

  it("a STALE stored summary.md (no parity fields) is re-synthesized, not returned verbatim (codex r2 finding 2)", async () => {
    // A pre-parity / stub summary.md on disk must NOT be returned verbatim when
    // the run has dispatch events — the caller would otherwise never see the
    // parity fields. Fall through to synthesize.
    fs.writeFileSync(
      path.join(tmpDir, ".guild", "runs", "run-dispatch", "summary.md"),
      "---\nrun_id: run-dispatch\n---\n# old summary (no dispatch fields)\n",
      "utf8"
    );
    const client = await makeClientForCwd(tmpDir);
    try {
      const res = await client.callTool({ name: "trace_summary", arguments: { run_id: "run-dispatch" } });
      const payload = parseJson(res);
      expect(payload.source).toBe("synthesized");
      expect(payload.summary).toMatch(/dispatched_lanes:\s*\[tmux: 2\]/);
      expect(payload.summary).toMatch(/dispatch_receipts:\s*\[tmux: 3\]/);
    } finally {
      await client.close();
    }
  });
});

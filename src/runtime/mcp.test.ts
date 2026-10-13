/**
 * KTD3: one compiled MCP binary, two D-MCP ids (wiki | trace), the KTD16 read
 * paths, and an in-process fallback for a host whose mcp rung is missing.
 * Runs the COMMITTED binary, the file a user's host actually spawns.
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { MCP_IDS, callInProcess, mcpServerFor } from "./mcp";
import { rungPlanForFamily } from "../adapters";
import { recordRungLosses } from "../domains/dispatch";

const ROOT = path.resolve(__dirname, "..", "..");
const BINARY = path.join(ROOT, "runtime", "guild-mcp.js");
/** KTD16: each id reads exactly one durable tree, never both. */
const KTD16_READ_PATHS: Record<(typeof MCP_IDS)[number], string> = {
  wiki: ".guild/wiki/**",
  trace: ".guild/runs/**",
};

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [BINARY, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function fixtureRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-ktd3-")));
  fs.mkdirSync(path.join(root, ".guild", "wiki", "decisions"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".guild", "wiki", "decisions", "ktd3-probe.md"),
    "---\ntype: decision\ntitle: KTD3 probe\nconfidence: high\n---\n\n# KTD3 probe\n\nOne binary, two ids.\n",
  );
  fs.mkdirSync(path.join(root, ".guild", "runs", "run-ktd3", "logs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "runs", "run-ktd3", "logs", "v1.4-events.jsonl"), "");
  return root;
}

function text(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

describe("KTD3 one MCP binary, two D-MCP ids", () => {
  it("KTD3 · one runtime/guild-mcp.js serves exactly two D-MCP ids and refuses a third", () => {
    expect([...MCP_IDS]).toEqual(["wiki", "trace"]);
    const described = JSON.parse(run(["--describe"]).stdout) as Record<string, { server: string }>;
    expect(Object.keys(described).sort()).toEqual(["trace", "wiki"]);
    expect(run(["runs"]).status).toBe(2);
    expect(run(["wiki+trace"]).status).toBe(2);

    const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { args: string[]; mcp_capability: { read_paths: string[]; read_only: boolean } }>;
    };
    const ids = Object.entries(mcp.mcpServers).map(([name, s]) => {
      expect(s.args[0]).toBe("${CLAUDE_PLUGIN_ROOT}/runtime/guild-mcp.js");
      const id = s.args[1] as (typeof MCP_IDS)[number];
      expect(mcpServerFor(id).server).toBe(name);
      expect(s.mcp_capability.read_only).toBe(true);
      expect(s.mcp_capability.read_paths).toEqual([KTD16_READ_PATHS[id]]);
      return id;
    });
    expect(ids.sort()).toEqual(["trace", "wiki"]);

    const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "runtime", "mcp-descriptions.pins.json"), "utf8")) as {
      binary: string;
      servers: Record<string, { mcp_id: string }>;
    };
    expect(pins.binary).toBe("runtime/guild-mcp.js");
    expect(Object.values(pins.servers).map((s) => s.mcp_id).sort()).toEqual(["trace", "wiki"]);
  });

  it("KTD3 · the in-process fallback answers wiki and trace calls without an MCP transport", async () => {
    const root = fixtureRoot();
    const wiki = run(["--call", "wiki", "wiki_search", JSON.stringify({ query: "probe", cwd: root })]);
    expect(wiki.status).toBe(0);
    expect(text(JSON.parse(wiki.stdout))).toContain("decisions/ktd3-probe.md");
    const trace = await callInProcess("trace", "trace_list_runs", { cwd: root });
    expect(text(trace)).toContain("run-ktd3");
    await expect(callInProcess("wiki" as never, "no_such_tool", {})).rejects.toThrow(/no tool/);
  });

  it("KTD3 · a missing mcp rung routes retrieval in-process and records the MCP path as a loss", () => {
    const plan = rungPlanForFamily("codex", { verify_check_available: false });
    expect(plan.mcp).toBe("in_process");
    const root = fixtureRoot();
    const runDir = path.join(root, ".guild", "runs", "run-ktd3");
    expect(recordRungLosses({ runDir, run_id: "run-ktd3", plan })).toBe(plan.losses.length);
    const lines = fs
      .readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { attempted?: string; fallback?: string });
    const mcpLoss = lines.find((l) => l.attempted?.startsWith("mcp:"));
    expect(mcpLoss?.fallback).toContain("in-process wiki/trace retrieval");
  });
});

/**
 * hooks/__tests__/tool-call-sidecar.test.ts — the PreToolUse sidecar -> PostToolUse
 * tool_call pairing contract and the PreCompact boundary event, driven through the
 * COMMITTED dist bundles exactly as Claude Code runs them.
 *
 * Ported from the benchmark repo's pre-tool-use / post-tool-use-widened /
 * pre-compact tests (which reached into ../../plugin). One deliberate drift from
 * the old assertions: a Post-only event whose tool_response reports
 * `success:false` is now status "err" (the old tests expected "ok").
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO = path.resolve(__dirname, "..", "..");
const DIST = path.join(REPO, "hooks", "dist");
const RUN_ID = "run-sidecar-test";

let root: string;
let logsDir: string;
let sidecar: string;
let liveLog: string;

function runHook(
  bundle: string,
  stdin: string,
  env: Record<string, string> = {},
): { status: number; stderr: string } {
  const clean: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("GUILD_")) clean[k] = v;
  }
  const r = spawnSync("node", [path.join(DIST, bundle)], {
    input: stdin,
    encoding: "utf8",
    env: { ...clean, GUILD_CWD: root, ...env },
    timeout: 20000,
  });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

const readJsonl = (file: string): any[] =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));

const pre = (tool: string, input: unknown = {}): string =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input });
const post = (tool: string, input: unknown, response: unknown, extra: object = {}): string =>
  JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: tool,
    tool_input: input,
    tool_response: response,
    ...extra,
  });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-sidecar-"));
  logsDir = path.join(root, ".guild", "runs", RUN_ID, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  sidecar = path.join(logsDir, "tool-call-pre.jsonl");
  liveLog = path.join(logsDir, "v1.4-events.jsonl");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("hooks.json — tool-call hook registration", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(REPO, "hooks", "hooks.json"), "utf8")).hooks;

  it("PreToolUse and the first PostToolUse group match every tool ('*')", () => {
    expect(hooks.PreToolUse[0].matcher).toBe("*");
    expect(hooks.PostToolUse[0].matcher).toBe("*");
  });

  it("the '*' PostToolUse group runs capture-telemetry AND post-tool-use", () => {
    const cmds: string[] = hooks.PostToolUse[0].hooks.map((h: { command: string }) => h.command);
    expect(cmds.some((c) => c.includes("capture-telemetry.js"))).toBe(true);
    expect(cmds.some((c) => c.includes("post-tool-use.js"))).toBe(true);
  });

  it("PreCompact is registered to pre-compact.js", () => {
    expect(hooks.PreCompact[0].hooks[0].command).toContain("pre-compact.js");
  });
});

describe("pre-tool-use.js — fall-through and sidecar write", () => {
  it("falls through (exit 0, warn, no sidecar) when no run id resolves", () => {
    const r = runHook("pre-tool-use.js", pre("Read", { file_path: "/tmp/x" }), { GUILD_RUN_ID: "" });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("warn:");
    expect(r.stderr).toContain("GUILD_RUN_ID unset");
    expect(fs.existsSync(sidecar)).toBe(false);
  });

  it("skips off-enum tool names without writing a sidecar", () => {
    const r = runHook("pre-tool-use.js", pre("SomeFutureTool"), { GUILD_RUN_ID: RUN_ID });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("not in closed enum");
    expect(fs.existsSync(sidecar)).toBe(false);
  });

  it("skips invalid stdin JSON", () => {
    const r = runHook("pre-tool-use.js", "not valid json", { GUILD_RUN_ID: RUN_ID });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("invalid JSON");
    expect(fs.existsSync(sidecar)).toBe(false);
  });

  it("writes one entry with run_id, lane_id, tool, ISO ts_pre and command_redacted", () => {
    const r = runHook("pre-tool-use.js", pre("Read", { file_path: "/etc/passwd" }), {
      GUILD_RUN_ID: RUN_ID,
      GUILD_LANE_ID: "T3d",
    });
    expect(r.status).toBe(0);
    const entries = readJsonl(sidecar);
    expect(entries).toHaveLength(1);
    expect(entries[0].run_id).toBe(RUN_ID);
    expect(entries[0].lane_id).toBe("T3d");
    expect(entries[0].tool).toBe("Read");
    expect(entries[0].ts_pre).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entries[0].command_redacted).toContain("Read");
  });

  it("omits lane_id when GUILD_LANE_ID is absent", () => {
    runHook("pre-tool-use.js", pre("Bash", { command: "ls" }), { GUILD_RUN_ID: RUN_ID });
    const [entry] = readJsonl(sidecar);
    expect(entry.lane_id).toBeUndefined();
    expect(entry.tool).toBe("Bash");
  });

  it("appends one entry per invocation", () => {
    runHook("pre-tool-use.js", pre("Read", { file_path: "/a" }), { GUILD_RUN_ID: RUN_ID });
    runHook("pre-tool-use.js", pre("Write", { file_path: "/b", content: "hi" }), { GUILD_RUN_ID: RUN_ID });
    expect(readJsonl(sidecar).map((e) => e.tool)).toEqual(["Read", "Write"]);
  });
});

describe("post-tool-use.js — pairing, post-only, orphan sweep", () => {
  it("falls through (no log) when no run id resolves", () => {
    const r = runHook("post-tool-use.js", post("Read", { file_path: "/x" }, { success: true }), {
      GUILD_RUN_ID: "",
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("warn:");
    expect(r.stderr).toContain("GUILD_RUN_ID unset");
    expect(fs.existsSync(liveLog)).toBe(false);
  });

  it("never records an off-enum tool as a tool_call", () => {
    runHook("post-tool-use.js", post("MysteryTool", {}, {}), { GUILD_RUN_ID: RUN_ID });
    if (fs.existsSync(liveLog)) {
      for (const ev of readJsonl(liveLog)) expect(ev.tool).not.toBe("MysteryTool");
    }
  });

  it("consumes a matching Pre and emits a paired tool_call, emptying the sidecar", () => {
    const env = { GUILD_RUN_ID: RUN_ID, GUILD_LANE_ID: "T3d" };
    runHook("pre-tool-use.js", pre("Read", { file_path: "/etc/passwd" }), env);
    expect(readJsonl(sidecar)).toHaveLength(1);

    const r = runHook("post-tool-use.js", post("Read", { file_path: "/etc/passwd" }, { success: true }), env);
    expect(r.status).toBe(0);
    const tc = readJsonl(liveLog).find((e) => e.event === "tool_call");
    expect(tc).toBeDefined();
    expect(tc.run_id).toBe(RUN_ID);
    expect(tc.tool).toBe("Read");
    expect(tc.status).toBe("ok");
    expect(tc.latency_ms).toBeGreaterThanOrEqual(0);
    expect(tc.command_redacted).toContain("Read");
    if (fs.existsSync(sidecar)) expect(fs.readFileSync(sidecar, "utf8").trim()).toBe("");
  });

  it("POST-without-PRE: empty command_redacted, result and duration_ms from Post alone", () => {
    const r = runHook(
      "post-tool-use.js",
      post("Bash", { command: "ls" }, { success: false, error: "boom" }, { duration_ms: 42 }),
      { GUILD_RUN_ID: RUN_ID },
    );
    expect(r.status).toBe(0);
    const tc = readJsonl(liveLog).find((e) => e.event === "tool_call");
    expect(tc.tool).toBe("Bash");
    expect(tc.command_redacted).toBe("");
    expect(tc.result_excerpt_redacted).toContain("boom");
    expect(tc.latency_ms).toBe(42);
    // success:false maps to err (the pre-v3 test expected "ok"; the hook now reports the failure).
    expect(tc.status).toBe("err");
  });

  it("POST-without-PRE: latency_ms defaults to 0 without duration_ms; a success stays ok", () => {
    runHook("post-tool-use.js", post("Read", { file_path: "/x" }, { success: true }), {
      GUILD_RUN_ID: RUN_ID,
    });
    const tc = readJsonl(liveLog).find((e) => e.event === "tool_call" && e.tool === "Read");
    expect(tc.command_redacted).toBe("");
    expect(tc.status).toBe("ok");
    expect(tc.latency_ms).toBe(0);
  });

  it("flushes a stale (>5 min) Pre entry as a status:err tool_call on the next Post", () => {
    const stale = {
      run_id: RUN_ID,
      tool: "Edit",
      ts_pre: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      command_redacted: "Edit /old/file",
    };
    fs.writeFileSync(sidecar, JSON.stringify(stale) + "\n");

    const r = runHook("post-tool-use.js", post("Glob", { pattern: "*.ts" }, { success: true }), {
      GUILD_RUN_ID: RUN_ID,
    });
    expect(r.status).toBe(0);
    const orphan = readJsonl(liveLog).find(
      (e) => e.event === "tool_call" && e.tool === "Edit" && e.status === "err",
    );
    expect(orphan).toBeDefined();
  });
});

describe("pre-compact.js — boundary event", () => {
  it("falls through (no log) when no run id resolves", () => {
    const r = runHook("pre-compact.js", JSON.stringify({ hook_event_name: "PreCompact" }), {
      GUILD_RUN_ID: "",
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("warn:");
    expect(r.stderr).toContain("GUILD_RUN_ID unset");
    expect(fs.existsSync(liveLog)).toBe(false);
  });

  it("emits one hook_event line named PreCompact with status ok", () => {
    const r = runHook(
      "pre-compact.js",
      JSON.stringify({ hook_event_name: "PreCompact", payload: { trigger: "manual" } }),
      { GUILD_RUN_ID: RUN_ID },
    );
    expect(r.status).toBe(0);
    const events = readJsonl(liveLog).filter((e) => e.event === "hook_event");
    expect(events).toHaveLength(1);
    expect(events[0].hook_name).toBe("PreCompact");
    expect(events[0].status).toBe("ok");
    expect(events[0].run_id).toBe(RUN_ID);
    expect(events[0].latency_ms).toBe(0);
    expect(typeof events[0].payload_excerpt_redacted).toBe("string");
  });

  it("still logs the boundary when stdin JSON is invalid", () => {
    const r = runHook("pre-compact.js", "not json", { GUILD_RUN_ID: RUN_ID });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("invalid JSON");
    const ev = readJsonl(liveLog).find((e) => e.event === "hook_event");
    expect(ev.hook_name).toBe("PreCompact");
  });
});

describe("commands/guild.md — allowed-tools", () => {
  it("lists the base tools plus AskUserQuestion, TaskCreate, TaskUpdate, TaskList", () => {
    const line = fs
      .readFileSync(path.join(REPO, "commands", "guild.md"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("allowed-tools:"));
    expect(line).toBeDefined();
    const tools = line!.slice("allowed-tools:".length).split(",").map((t) => t.trim());
    for (const t of [
      "Read", "Write", "Edit", "Grep", "Glob", "Bash", "Agent", "Skill",
      "AskUserQuestion", "TaskCreate", "TaskUpdate", "TaskList",
    ]) {
      expect(tools).toContain(t);
    }
  });
});

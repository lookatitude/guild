// v1.4.0 — T3d-backend-platform post-tool-use widened-matcher tests.
// Pins the binding contract from the audit doc §"Tool-call pre/post pairing":
//   - Widened matcher fires on every tool call (no enum filter on the
//     hooks.json side; the handler enforces the closed enum internally).
//   - Sidecar lifecycle: Pre writes → Post consumes → entry removed → tool_call emit.
//   - Orphan sweep (PRE-without-POST > 5 min): tool_call status:"err" + ORPHAN sentinel.
//   - 4-tuple correlation key match (run_id, lane_id, tool, ts_pre < ts_post).
//   - **POST-without-PRE** (audit lines 133-135): emit a tool_call with
//     `command_redacted` absent (empty string), `status: "ok"` (observability
//     gap, NOT pairing error), and result + latency captured from Post alone.
//     This is distinct from the orphan-sweep path. Codex G-lane round 2 found
//     the original implementation conflated the two; round-2-patches split
//     them via `buildToolCallFromPostOnly()`.
//   - Hooks.json: widened matcher = "*" (greppable).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

import {
  appendSidecarPre,
  initStableLockfile,
  ORPHAN_LATENCY_MS,
  ORPHAN_RESULT_EXCERPT,
  sidecarPath,
  type SidecarPreEntry,
} from "../src/log-jsonl.js";

const HOOK_SCRIPT = resolve(__dirname, "../../hooks/post-tool-use.ts");
const HOOKS_JSON = resolve(__dirname, "../../hooks/hooks.json");
const RUN_ID = "test-run-post-tool-use";

function runHook(
  stdin: string,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", HOOK_SCRIPT], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

let tmpRoot: string;
let runDir: string;
let liveLogPath: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-post-tool-use-"));
  runDir = join(tmpRoot, ".guild", "runs", RUN_ID);
  mkdirSync(join(runDir, "logs"), { recursive: true });
  liveLogPath = join(runDir, "logs", "v1.4-events.jsonl");
  initStableLockfile(runDir);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("hooks.json — PostToolUse matcher widened to '*'", () => {
  it("registers PreToolUse with matcher '*'", () => {
    const json = JSON.parse(readFileSync(HOOKS_JSON, "utf8"));
    expect(json.hooks.PreToolUse).toBeDefined();
    expect(json.hooks.PreToolUse[0].matcher).toBe("*");
  });

  it("widens PostToolUse matcher from enum to '*'", () => {
    const json = JSON.parse(readFileSync(HOOKS_JSON, "utf8"));
    expect(json.hooks.PostToolUse[0].matcher).toBe("*");
  });

  it("registers PreCompact (no matcher needed)", () => {
    const json = JSON.parse(readFileSync(HOOKS_JSON, "utf8"));
    expect(json.hooks.PreCompact).toBeDefined();
    expect(json.hooks.PreCompact[0].hooks[0].command).toContain("pre-compact.js");
  });

  it("PostToolUse handler block fires both capture-telemetry AND post-tool-use (additive)", () => {
    const json = JSON.parse(readFileSync(HOOKS_JSON, "utf8"));
    const cmds = json.hooks.PostToolUse[0].hooks.map((h: any) => h.command);
    expect(cmds.some((c: string) => c.includes("capture-telemetry.js"))).toBe(true);
    expect(cmds.some((c: string) => c.includes("post-tool-use.js"))).toBe(true);
  });
});

describe("post-tool-use hook — fall-through paths", () => {
  it("falls through gracefully when GUILD_RUN_ID is unset", () => {
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/x" },
      tool_response: { success: true },
    });
    const result = runHook(payload, {
      GUILD_RUN_ID: "",
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("warn:");
    expect(result.stderr).toContain("GUILD_RUN_ID unset");
    expect(existsSync(liveLogPath)).toBe(false);
  });

  it("falls through silently for off-enum tool names (after orphan sweep)", () => {
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "MysteryTool",
      tool_input: {},
      tool_response: {},
    });
    const result = runHook(payload, {
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    // No tool_call event written for the off-enum tool itself.
    if (existsSync(liveLogPath)) {
      const text = readFileSync(liveLogPath, "utf8");
      // Allow only orphan sweep events here — there should be none in
      // this fresh-run case.
      const lines = text.split("\n").filter((l) => l.length > 0);
      for (const line of lines) {
        const ev = JSON.parse(line);
        // off-enum tool MUST NOT appear as event.tool.
        expect(ev.tool).not.toBe("MysteryTool");
      }
    }
  });
});

describe("post-tool-use hook — sidecar lifecycle (consume + tool_call emit)", () => {
  it("consumes a matching Pre and emits a paired tool_call event", () => {
    // Seed a Pre entry that PostToolUse will pair against. ts_pre must
    // be recent — the orphan sweep runs FIRST in the post-handler and
    // flushes any entry older than 5 minutes as status:"err".
    const tsPre = new Date(Date.now() - 100).toISOString();
    const pre: SidecarPreEntry = {
      run_id: RUN_ID,
      lane_id: "T3d",
      tool: "Read",
      ts_pre: tsPre,
      command_redacted: "Read /etc/passwd",
    };
    appendSidecarPre(runDir, pre);
    expect(existsSync(sidecarPath(runDir))).toBe(true);

    // Fire PostToolUse with matching tool + lane.
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/etc/passwd" },
      tool_response: { success: true, content: "root:x:0:0" },
    });
    const result = runHook(payload, {
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
      GUILD_LANE_ID: "T3d",
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(liveLogPath)).toBe(true);

    const lines = readFileSync(liveLogPath, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const events = lines.map((l) => JSON.parse(l));
    const toolCalls = events.filter((e) => e.event === "tool_call");
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    const tc = toolCalls[0]!;
    expect(tc.run_id).toBe(RUN_ID);
    expect(tc.lane_id).toBe("T3d");
    expect(tc.tool).toBe("Read");
    expect(tc.status).toBe("ok");
    // latency_ms is non-negative (post > pre).
    expect(tc.latency_ms).toBeGreaterThanOrEqual(0);
    // Sidecar entry consumed → file should be empty (or absent).
    if (existsSync(sidecarPath(runDir))) {
      const sidecar = readFileSync(sidecarPath(runDir), "utf8").trim();
      expect(sidecar).toBe("");
    }
  });

  it("POST-without-PRE: emits status=ok with command_redacted absent (audit lines 133-135)", () => {
    // No Pre seeded → sidecar absent → consumeSidecarPre returns null →
    // handler builds an audit-conformant Post-only event:
    //   - command_redacted: "" (audit calls this "absent")
    //   - status: "ok" (observability gap, NOT a pairing error)
    //   - result_excerpt_redacted: from Post payload (preserved verbatim)
    //   - latency_ms: 0 (or duration_ms from payload when present)
    // This is DISTINCT from the orphan-sweep path tested below.
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { success: false, error: "boom" },
      duration_ms: 42,
    });
    const result = runHook(payload, {
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(liveLogPath)).toBe(true);
    const events = readFileSync(liveLogPath, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
    const toolCalls = events.filter((e) => e.event === "tool_call");
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    const tc = toolCalls[0]!;
    expect(tc.tool).toBe("Bash");
    // Audit: command_redacted "absent" → empty string in the schema.
    expect(tc.command_redacted).toBe("");
    // Audit: status="ok" (observability gap, not pairing error).
    expect(tc.status).toBe("ok");
    // Result captured from Post alone (verbatim, JSON-stringified).
    expect(tc.result_excerpt_redacted).toContain("boom");
    // latency_ms from Post's duration_ms (when payload supplies it).
    expect(tc.latency_ms).toBe(42);
    // MUST NOT be the orphan-sweep sentinel — that's a different path.
    expect(tc.result_excerpt_redacted).not.toBe(ORPHAN_RESULT_EXCERPT);
    expect(tc.latency_ms).not.toBe(ORPHAN_LATENCY_MS);
  });

  it("POST-without-PRE: latency_ms defaults to 0 when payload omits duration_ms", () => {
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/x" },
      tool_response: { success: true },
    });
    const result = runHook(payload, {
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    const events = readFileSync(liveLogPath, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
    const tc = events.find((e: any) => e.event === "tool_call" && e.tool === "Read");
    expect(tc).toBeDefined();
    expect(tc!.command_redacted).toBe("");
    expect(tc!.status).toBe("ok");
    expect(tc!.latency_ms).toBe(0);
  });
});

describe("post-tool-use hook — orphan sweep (stale Pre entries)", () => {
  it("flushes stale Pre entries (>5 min) as tool_call status:err on every PostToolUse fire", () => {
    // Seed a stale Pre — 10 minutes ago.
    const stalePreTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const stalePre: SidecarPreEntry = {
      run_id: RUN_ID,
      tool: "Edit",
      ts_pre: stalePreTs,
      command_redacted: "Edit /old/file",
    };
    // Write directly (not via appendSidecarPre — simulates a crashed
    // earlier dispatch leaving the entry behind).
    mkdirSync(join(runDir, "logs"), { recursive: true });
    writeFileSync(sidecarPath(runDir), JSON.stringify(stalePre) + "\n");

    // Fire PostToolUse for a different tool that has no matching Pre.
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Glob",
      tool_input: { pattern: "*.ts" },
      tool_response: { success: true },
    });
    const result = runHook(payload, {
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(liveLogPath)).toBe(true);

    const events = readFileSync(liveLogPath, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
    const orphans = events.filter(
      (e) =>
        e.event === "tool_call" &&
        e.status === "err" &&
        e.latency_ms === ORPHAN_LATENCY_MS &&
        e.result_excerpt_redacted === ORPHAN_RESULT_EXCERPT,
    );
    // At least the stale-Edit orphan was flushed.
    expect(orphans.length).toBeGreaterThanOrEqual(1);
    const editOrphan = orphans.find((o: any) => o.tool === "Edit");
    expect(editOrphan).toBeDefined();
  });
});

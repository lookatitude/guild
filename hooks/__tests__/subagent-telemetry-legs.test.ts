/**
 * G04 R2 — the two subagent visibility legs, executed through the COMPILED
 * hooks the host runs (hooks/dist/*.js):
 *   - SubagentStop  → capture-telemetry emits guild.trace.analysis.v2
 *                     `agent_response_received` with a redacted payload sidecar.
 *   - PreToolUse Agent → pre-tool-use emits `agent_prompt_sent` with a
 *                     redacted payload sidecar and a prompt digest (never the
 *                     raw prompt on the event).
 * Negatives: no run binding → no event; a non-Agent tool → no prompt leg.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { mintTestBinding } from "../test-support/mint-binding";

const DIST = path.resolve(__dirname, "..", "dist");
const RUN = "test-run";
const SECRET = "ghp_" + "A".repeat(36);

let root: string;
let runDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-subagent-legs-"));
  runDir = path.join(root, ".guild", "runs", RUN);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run.yaml"), `run_id: ${RUN}\n`);
  mintTestBinding(root, RUN);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function runHook(script: string, payload: Record<string, unknown>, env: Record<string, string> = {}): number | null {
  const r = spawnSync("node", [path.join(DIST, script)], {
    input: JSON.stringify({ cwd: root, ...payload }),
    encoding: "utf8",
    env: {
      ...process.env,
      GUILD_CWD: root,
      GUILD_RUN_ID: RUN,
      GUILD_RUN_BINDING_REF: `rb-test-${RUN}`,
      GUILD_TASK_ID: "",
      GUILD_LANE_ID: "",
      ...env,
    },
    timeout: 20000,
  });
  return r.status;
}

function analysisEvents(eventClass: string): Record<string, unknown>[] {
  const file = path.join(runDir, "logs", "v1.4-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => e["schema_version"] === "guild.trace.analysis.v2" && e["event_class"] === eventClass);
}

function sidecar(ref: unknown): string {
  expect(typeof ref).toBe("string");
  return fs.readFileSync(path.join(runDir, ref as string), "utf8");
}

describe("G04 R2 — SubagentStop agent_response_received (compiled capture-telemetry)", () => {
  it("emits one agent_response_received with a redacted payload sidecar", () => {
    expect(
      runHook("capture-telemetry.js", {
        hook_event_name: "SubagentStop",
        agent_name: "backend",
        stop_reason: `done; token ${SECRET}`,
      }),
    ).toBe(0);
    const events = analysisEvents("agent_response_received");
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e).toMatchObject({ run_id: RUN, actor_type: "agent", actor_id: "backend", redaction: "redacted", status: "ok" });
    expect(typeof e["span_id"]).toBe("string");
    const body = sidecar(e["payload_ref"]);
    expect(body).toContain("backend");
    expect(body).not.toContain(SECRET);
    expect(JSON.stringify(e)).not.toContain(SECRET);
  });

  it("negative: no run binding → no event", () => {
    runHook("capture-telemetry.js", { hook_event_name: "SubagentStop", agent_name: "backend" }, { GUILD_RUN_BINDING_REF: "" });
    expect(analysisEvents("agent_response_received")).toHaveLength(0);
  });
});

describe("G04 R2 — PreToolUse Agent agent_prompt_sent (compiled pre-tool-use)", () => {
  const agentCall = (env: Record<string, string> = {}, dispatchEnv?: Record<string, string>): number | null =>
    runHook(
      "pre-tool-use.js",
      {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          description: "probe",
          prompt: `Summarize the repo. key=${SECRET}`,
          // A lane dispatch must carry a tier (#60 guard) or it is denied.
          ...(dispatchEnv ? { env: dispatchEnv, model: "haiku" } : {}),
        },
      },
      env,
    );

  it("emits one agent_prompt_sent with a prompt digest and a redacted payload sidecar", () => {
    expect(agentCall({}, { GUILD_TASK_ID: "T7" })).toBe(0);
    const events = analysisEvents("agent_prompt_sent");
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e).toMatchObject({ run_id: RUN, task_id: "T7", actor_type: "agent", actor_id: "general-purpose", redaction: "redacted" });
    expect(e["prompt_hash"]).toMatch(/^[0-9a-f]{12,}$/);
    expect(JSON.stringify(e)).not.toContain("Summarize the repo");
    const body = sidecar(e["payload_ref"]);
    expect(body).toContain("Summarize the repo");
    expect(body).not.toContain(SECRET);
  });

  const brokenPattern = (mode: "open" | "closed") =>
    fs.writeFileSync(
      path.join(root, ".guild", "settings.json"),
      JSON.stringify({ secrets_policy: { redaction_patterns: ["(unclosed"], fail_mode_telemetry: mode } }),
    );

  it("fail_mode_telemetry closed + a failed custom pattern: no sidecar, redaction omitted, dispatch not blocked", () => {
    brokenPattern("closed");
    expect(agentCall({}, { GUILD_TASK_ID: "T7" })).toBe(0);
    const [e] = analysisEvents("agent_prompt_sent");
    expect(e["redaction"]).toBe("omitted");
    expect(e["payload_ref"]).toBeUndefined();
    expect(fs.existsSync(path.join(runDir, "logs", "payloads"))).toBe(false);
  });

  it("fail_mode_telemetry open + a failed custom pattern: built-in-redacted sidecar still written", () => {
    brokenPattern("open");
    agentCall({}, { GUILD_TASK_ID: "T7" });
    const [e] = analysisEvents("agent_prompt_sent");
    expect(sidecar(e["payload_ref"])).not.toContain(SECRET);
  });

  it("dispatch env values never reach the sidecar (no key-context-free leak)", () => {
    expect(agentCall({}, { GUILD_TASK_ID: "T7", PASSWORD: "review-canary" })).toBe(0);
    const [e] = analysisEvents("agent_prompt_sent");
    const body = sidecar(e["payload_ref"]);
    expect(body).not.toContain("review-canary");
    expect(body).not.toContain("PASSWORD");
    expect(body).toContain("general-purpose");
  });

  it("negative: a GUILD_RUN_DIR override never redirects the write to an unbound run", () => {
    const other = path.join(root, ".guild", "runs", "other-run");
    fs.mkdirSync(other, { recursive: true });
    expect(agentCall({ GUILD_RUN_DIR: other }, { GUILD_TASK_ID: "T7" })).toBe(0);
    expect(fs.existsSync(path.join(other, "logs", "payloads"))).toBe(false);
    const otherLog = path.join(other, "logs", "v1.4-events.jsonl");
    const leaked = fs.existsSync(otherLog) && fs.readFileSync(otherLog, "utf8").includes("agent_prompt_sent");
    expect(leaked).toBe(false);
    expect(analysisEvents("agent_prompt_sent")).toHaveLength(1);
  });

  it("an untasked dispatch is keyed by its own span id", () => {
    agentCall();
    const [e] = analysisEvents("agent_prompt_sent");
    expect(e["task_id"]).toBe(e["span_id"]);
  });

  it("negative: no run binding → no event", () => {
    agentCall({ GUILD_RUN_BINDING_REF: "" });
    expect(analysisEvents("agent_prompt_sent")).toHaveLength(0);
  });

  it("negative: a dispatch a gate denies emits no prompt leg", () => {
    // A lane caller without a TaskCell instance id is refused by the KTD28 projection gate.
    agentCall({ GUILD_TASK_ID: "T7" });
    expect(analysisEvents("agent_prompt_sent")).toHaveLength(0);
  });

  it("negative: a non-Agent tool emits no prompt leg", () => {
    runHook("pre-tool-use.js", { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/x" } });
    expect(analysisEvents("agent_prompt_sent")).toHaveLength(0);
  });
});

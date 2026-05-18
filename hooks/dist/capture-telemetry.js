#!/usr/bin/env -S npx tsx
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// capture-telemetry.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var crypto = __toESM(require("crypto"));
function digest(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
}
function isOk(payload) {
  const resp = payload.tool_response;
  if (resp === null || resp === void 0) return true;
  if (typeof resp === "object") {
    const r = resp;
    if (r["success"] === false) return false;
    if (typeof r["error"] === "string" && r["error"].length > 0) return false;
  }
  return true;
}
async function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}
function readCurrentRunId(cwd) {
  const sentinelPath = path.join(cwd, ".guild", "runs", "current-run-id");
  try {
    const value = fs.readFileSync(sentinelPath, "utf8").trim();
    return value.length > 0 ? value : void 0;
  } catch {
    return void 0;
  }
}
function resolveRunId(cwd, payload) {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.length > 0) return envRunId;
  const currentRunId = readCurrentRunId(cwd);
  if (currentRunId !== void 0) return currentRunId;
  return payload.session_id ? `run-${payload.session_id}` : `run-session-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`;
}
async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw.trim());
  } catch {
    process.stderr.write("[capture-telemetry] WARN: invalid JSON on stdin; skipping.\n");
    process.exit(0);
  }
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const runId = resolveRunId(cwd, payload);
  const eventName = payload.hook_event_name ?? "PostToolUse";
  const tool = eventName === "SubagentStop" || eventName === "UserPromptSubmit" ? "" : payload.tool_name ?? "";
  const specialist = payload.agent_name ?? "";
  const payloadDigest = digest(
    payload.tool_input ?? payload.stop_reason ?? payload.prompt ?? ""
  );
  const ok = isOk(payload);
  const ms = typeof payload.duration_ms === "number" ? payload.duration_ms : 0;
  const event = {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    event: eventName,
    tool,
    specialist,
    payload_digest: payloadDigest,
    ok,
    ms
  };
  if (typeof payload.model === "string" && payload.model.length > 0) {
    event.model = payload.model;
  }
  if (eventName === "UserPromptSubmit" && typeof payload.prompt === "string") {
    event.prompt = payload.prompt;
  }
  if (eventName === "loop_round_start" || eventName === "loop_round_end") {
    if (typeof payload.loop_layer === "string") event.loop_layer = payload.loop_layer;
    if (typeof payload.loop_round === "number") event.loop_round = payload.loop_round;
    if (typeof payload.loop_gate === "string") event.loop_gate = payload.loop_gate;
    if (typeof payload.loop_terminated === "boolean") event.loop_terminated = payload.loop_terminated;
  }
  const runsDir = path.join(cwd, ".guild", "runs", runId);
  const eventsFile = path.join(runsDir, "events.ndjson");
  try {
    fs.mkdirSync(runsDir, { recursive: true });
    fs.appendFileSync(eventsFile, JSON.stringify(event) + "\n", "utf8");
  } catch (err) {
    process.stderr.write(
      `[capture-telemetry] ERROR: failed to write event: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
main().catch((err) => {
  process.stderr.write(
    `[capture-telemetry] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});

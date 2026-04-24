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
  const sessionId = payload.session_id;
  const runId = process.env["GUILD_RUN_ID"] ?? (sessionId ? `run-${sessionId}` : `run-session-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`);
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
  if (eventName === "UserPromptSubmit" && typeof payload.prompt === "string") {
    event.prompt = payload.prompt;
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

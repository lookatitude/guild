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

// agent-team/teammate-idle.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var readline = __toESM(require("readline"));

// lib/guild-root.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function resolveGuildRoot(startCwd) {
  let current = path.resolve(startCwd);
  for (; ; ) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const guildDir = path.join(current, ".guild");
    if (fs.existsSync(guildDir)) {
      try {
        if (fs.statSync(guildDir).isDirectory()) {
          return current;
        }
      } catch {
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startCwd);
    }
    current = parent;
  }
}

// lib/heartbeat.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
var DEFAULT_HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1e3;
function heartbeatPath(runDir, specialist) {
  return path2.join(runDir, "in-progress", `${specialist}.json`);
}
function legacyLogPath(runDir, specialist) {
  return path2.join(runDir, "in-progress", `${specialist}.log`);
}
function readHeartbeat(runDir, specialist) {
  let raw;
  try {
    raw = fs2.readFileSync(heartbeatPath(runDir, specialist), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed;
  if (typeof obj["timestamp"] !== "string" || obj["timestamp"].trim() === "") {
    return null;
  }
  const hb = { timestamp: obj["timestamp"] };
  if (typeof obj["step"] === "string") hb.step = obj["step"];
  if (typeof obj["pct_complete"] === "number") hb.pct_complete = obj["pct_complete"];
  if (typeof obj["last_action"] === "string") hb.last_action = obj["last_action"];
  return hb;
}
function readHeartbeatTimeoutMs(cwd) {
  const settingsPath = path2.join(resolveGuildRoot(cwd), ".guild", "settings.json");
  let raw;
  try {
    raw = fs2.readFileSync(settingsPath, "utf8");
  } catch {
    return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }
  const defaults = parsed["defaults"];
  if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
    return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }
  const val = defaults["heartbeat_timeout_ms"];
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    return val;
  }
  return DEFAULT_HEARTBEAT_TIMEOUT_MS;
}
function assessLiveness(runDir, specialist, timeoutMs, now = Date.now()) {
  const hb = readHeartbeat(runDir, specialist);
  if (hb) {
    const parsedMs = Date.parse(hb.timestamp);
    const ageMs = Number.isNaN(parsedMs) ? 0 : Math.max(0, now - parsedMs);
    const out = {
      source: "heartbeat",
      fresh: ageMs < timeoutMs,
      ageMs
    };
    if (hb.step !== void 0) out.step = hb.step;
    if (hb.pct_complete !== void 0) out.pctComplete = hb.pct_complete;
    return out;
  }
  const logPath = legacyLogPath(runDir, specialist);
  try {
    const stat = fs2.statSync(logPath);
    const ageMs = Math.max(0, now - stat.mtimeMs);
    return { source: "mtime", fresh: ageMs < timeoutMs, ageMs };
  } catch {
    return { source: "none", fresh: false, ageMs: null };
  }
}

// agent-team/teammate-idle.ts
function deriveRunId(sessionId) {
  return process.env["GUILD_RUN_ID"] ?? `run-${sessionId}`;
}
function findCompletedTaskIds(runDir, teammate) {
  const handoffsDir = path3.join(runDir, "handoffs");
  if (!fs3.existsSync(handoffsDir)) return /* @__PURE__ */ new Set();
  const prefix = `${teammate}-`;
  return new Set(
    fs3.readdirSync(handoffsDir).filter((f) => f.startsWith(prefix) && f.endsWith(".md")).map((f) => f.slice(prefix.length, -".md".length))
  );
}
function findAssignedTaskIds(cwd, teammate) {
  const planDir = path3.join(resolveGuildRoot(cwd), ".guild", "plan");
  if (!fs3.existsSync(planDir)) return [];
  const files = fs3.readdirSync(planDir).filter((f) => f.endsWith(".md"));
  const ids = [];
  for (const file of files) {
    const content = fs3.readFileSync(path3.join(planDir, file), "utf8");
    const blocks = content.split(/\n(?=[-*#]|\w)/);
    for (const block of blocks) {
      const isAssigned = new RegExp(`(?:owner|assigned|teammate):\\s*${teammate}\\b`, "i").test(block);
      if (isAssigned) {
        const idMatch = block.match(/\bid:\s*(task-[\w-]+)/i) ?? block.match(/^\s*[-*]\s*(task-[\w-]+):/im);
        if (idMatch) ids.push(idMatch[1]);
      }
    }
  }
  return ids;
}
function renderLiveness(liveness) {
  if (liveness.source === "none") {
    return `liveness: no heartbeat or progress log found (cannot confirm activity)`;
  }
  const ageSec = liveness.ageMs !== null ? Math.round(liveness.ageMs / 1e3) : "?";
  const freshness = liveness.fresh ? "FRESH (active)" : "STALE (possible stall)";
  if (liveness.source === "heartbeat") {
    const phase = liveness.step ? ` phase="${liveness.step}"` : "";
    const pct = liveness.pctComplete !== void 0 ? ` ${liveness.pctComplete}%` : "";
    return `liveness: heartbeat ${freshness}, last progress ${ageSec}s ago${phase}${pct}`;
  }
  return `liveness: legacy log mtime ${freshness}, last touched ${ageSec}s ago (no structured heartbeat)`;
}
function composeNudge(ctx) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const livenessLine = renderLiveness(ctx.liveness);
  if (ctx.pendingTaskIds.length > 0) {
    return `[TeammateIdle ${timestamp}] Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle but has ${ctx.pendingTaskIds.length} incomplete task(s): [${ctx.pendingTaskIds.join(", ")}].
${livenessLine}
Action required: ${ctx.teammate} should either
  1. Write a handoff receipt at ${ctx.runDir}/handoffs/${ctx.teammate}-<task-id>.md with sections: changed_files, opens_for, assumptions, evidence, followups \u2014 then mark the task complete.
  2. Or, if still working, update the structured heartbeat at ${ctx.runDir}/in-progress/${ctx.teammate}.json ({ timestamp, step, pct_complete, last_action }) to signal progress.
`;
  }
  return `[TeammateIdle ${timestamp}] Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle.
${livenessLine}
If you have an active task, please write a handoff receipt or update your structured heartbeat to signal progress. Receipt path: ${ctx.runDir}/handoffs/${ctx.teammate}-<task-id>.md
Heartbeat path: ${ctx.runDir}/in-progress/${ctx.teammate}.json ({ timestamp, step, pct_complete, last_action }).
Required receipt sections: changed_files, opens_for, assumptions, evidence, followups.
If all tasks are complete, no action is needed.
`;
}
async function main() {
  const agentTeamEnabled = process.env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] === "1";
  if (!agentTeamEnabled) {
    process.exit(0);
  }
  const rl = readline.createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) {
    lines.push(line);
  }
  const raw = lines.join("\n").trim();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write(`[teammate-idle] WARN: Invalid JSON on stdin: ${raw.slice(0, 120)}
`);
    process.exit(0);
  }
  const sessionId = payload.session_id ?? "unknown";
  const teammate = (payload.teammate_name ?? "").trim() || "unknown";
  const teamName = (payload.team_name ?? "").trim() || "unknown";
  const cwd = payload.cwd ?? process.cwd();
  const runId = deriveRunId(sessionId);
  const runDir = path3.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
  const completedIds = findCompletedTaskIds(runDir, teammate);
  const assignedIds = findAssignedTaskIds(cwd, teammate);
  const pendingTaskIds = assignedIds.filter((id) => !completedIds.has(id));
  const hasReceipt = completedIds.size > 0;
  const timeoutMs = readHeartbeatTimeoutMs(cwd);
  const liveness = assessLiveness(runDir, teammate, timeoutMs);
  process.stderr.write(
    `[teammate-idle] INFO: teammate="${teammate}" assigned=[${assignedIds.join(",")}] completed=[${[...completedIds].join(",")}] pending=[${pendingTaskIds.join(",")}] liveness=${liveness.source}/${liveness.fresh ? "fresh" : "stale"} ageMs=${liveness.ageMs ?? "n/a"} timeoutMs=${timeoutMs}
`
  );
  const ctx = {
    teammate,
    teamName,
    runId,
    hasReceipt,
    liveness,
    pendingTaskIds,
    runDir
  };
  process.stdout.write(composeNudge(ctx));
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(
    `[teammate-idle] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});

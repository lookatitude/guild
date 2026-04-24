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
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var readline = __toESM(require("readline"));
var STALE_THRESHOLD_MS = 10 * 60 * 1e3;
function deriveRunId(sessionId) {
  return process.env["GUILD_RUN_ID"] ?? `run-${sessionId}`;
}
function findCompletedTaskIds(runDir, teammate) {
  const handoffsDir = path.join(runDir, "handoffs");
  if (!fs.existsSync(handoffsDir)) return /* @__PURE__ */ new Set();
  const prefix = `${teammate}-`;
  return new Set(
    fs.readdirSync(handoffsDir).filter((f) => f.startsWith(prefix) && f.endsWith(".md")).map((f) => f.slice(prefix.length, -".md".length))
  );
}
function findAssignedTaskIds(cwd, teammate) {
  const planDir = path.join(cwd, ".guild", "plan");
  if (!fs.existsSync(planDir)) return [];
  const files = fs.readdirSync(planDir).filter((f) => f.endsWith(".md"));
  const ids = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(planDir, file), "utf8");
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
function hasActiveProgressLog(runDir, teammate) {
  const logPath = path.join(runDir, "in-progress", `${teammate}.log`);
  if (!fs.existsSync(logPath)) return false;
  const stat = fs.statSync(logPath);
  return Date.now() - stat.mtimeMs < STALE_THRESHOLD_MS;
}
function composeNudge(ctx) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  if (ctx.pendingTaskIds.length > 0) {
    return `[TeammateIdle ${timestamp}] Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle but has ${ctx.pendingTaskIds.length} incomplete task(s): [${ctx.pendingTaskIds.join(", ")}].
Action required: ${ctx.teammate} should either
  1. Write a handoff receipt at ${ctx.runDir}/handoffs/${ctx.teammate}-<task-id>.md with sections: changed_files, opens_for, assumptions, evidence, followups \u2014 then mark the task complete.
  2. Or, if still working, update the in-progress log at ${ctx.runDir}/in-progress/${ctx.teammate}.log to signal activity.
`;
  }
  return `[TeammateIdle ${timestamp}] Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle.
If you have an active task, please write a handoff receipt or update your in-progress log to signal activity. Receipt path: ${ctx.runDir}/handoffs/${ctx.teammate}-<task-id>.md
Required sections: changed_files, opens_for, assumptions, evidence, followups.
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
  const runDir = path.join(cwd, ".guild", "runs", runId);
  const completedIds = findCompletedTaskIds(runDir, teammate);
  const assignedIds = findAssignedTaskIds(cwd, teammate);
  const pendingTaskIds = assignedIds.filter((id) => !completedIds.has(id));
  const hasReceipt = completedIds.size > 0;
  const hasActiveLog = hasActiveProgressLog(runDir, teammate);
  process.stderr.write(
    `[teammate-idle] INFO: teammate="${teammate}" assigned=[${assignedIds.join(",")}] completed=[${[...completedIds].join(",")}] pending=[${pendingTaskIds.join(",")}] activeLog=${hasActiveLog}
`
  );
  const ctx = {
    teammate,
    teamName,
    runId,
    hasReceipt,
    hasActiveLog,
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

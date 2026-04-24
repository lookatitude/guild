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

// agent-team/task-completed.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var readline = __toESM(require("readline"));
var REQUIRED_FIELDS = [
  "changed_files",
  "opens_for",
  "assumptions",
  "evidence",
  "followups"
];
function die(reason) {
  process.stderr.write(`[task-completed] BLOCKED: ${reason}
`);
  process.exit(1);
}
function deriveRunId(sessionId) {
  return process.env["GUILD_RUN_ID"] ?? `run-${sessionId}`;
}
function receiptPath(cwd, runId, specialist, taskId) {
  return path.join(cwd, ".guild", "runs", runId, "handoffs", `${specialist}-${taskId}.md`);
}
function missingFields(content) {
  return REQUIRED_FIELDS.filter((field) => {
    const pattern = new RegExp(
      `(?:^##?\\s+${field}\\b|^${field}\\s*:)`,
      "im"
    );
    return !pattern.test(content);
  });
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
    die(`Invalid JSON on stdin: ${raw.slice(0, 120)}`);
  }
  const sessionId = payload.session_id ?? "unknown";
  const taskId = payload.task_id ?? "(unknown)";
  const specialist = (payload.teammate_name ?? "").trim() || "unknown";
  const cwd = payload.cwd ?? process.cwd();
  const runId = deriveRunId(sessionId);
  const rPath = receiptPath(cwd, runId, specialist, taskId);
  if (!fs.existsSync(rPath)) {
    die(
      `Task "${taskId}" (specialist: "${specialist}") has no handoff receipt. Expected at: ${rPath}
Write the receipt with sections: ${REQUIRED_FIELDS.join(", ")} before marking complete.`
    );
  }
  const content = fs.readFileSync(rPath, "utf8");
  const missing = missingFields(content);
  if (missing.length > 0) {
    die(
      `Task "${taskId}" receipt at "${rPath}" is missing required \xA78.2 fields: [${missing.join(", ")}]. Add the missing sections before marking complete.`
    );
  }
  process.stderr.write(
    `[task-completed] OK: task "${taskId}" receipt verified at "${rPath}".
`
  );
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(
    `[task-completed] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(1);
});

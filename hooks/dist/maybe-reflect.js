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

// maybe-reflect.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
async function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}
function loadEvents(eventsFile) {
  if (!fs.existsSync(eventsFile)) return [];
  const content = fs.readFileSync(eventsFile, "utf8");
  const events = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
    }
  }
  return events;
}
function gateCheck(events) {
  if (events.length === 0) return false;
  const hasSpecialist = events.some(
    (e) => e.event === "SubagentStop" && e.specialist && e.specialist.trim().length > 0
  );
  const hasFileEdit = events.some(
    (e) => e.event === "PostToolUse" && (e.tool === "Write" || e.tool === "Edit")
  );
  const hasError = events.some((e) => e.ok === false);
  return hasSpecialist && hasFileEdit && !hasError;
}
function writeStubSummary(runDir, runId, events) {
  const specialists = [
    ...new Set(events.map((e) => e.specialist).filter(Boolean))
  ];
  const tools = [...new Set(events.map((e) => e.tool).filter(Boolean))];
  const editCount = events.filter(
    (e) => e.tool === "Write" || e.tool === "Edit"
  ).length;
  const totalMs = events.reduce((acc, e) => acc + (e.ms ?? 0), 0);
  const lines = [
    `# Run summary: ${runId}`,
    "",
    `Generated: ${(/* @__PURE__ */ new Date()).toISOString()} (stub \u2014 trace-summarize.ts not yet available)`,
    "",
    "## Specialists dispatched",
    specialists.length > 0 ? specialists.map((s) => `- ${s}`).join("\n") : "- (none)",
    "",
    "## Tool activity",
    `- Total events: ${events.length}`,
    `- File edits: ${editCount}`,
    `- Unique tools: ${tools.join(", ") || "(none)"}`,
    `- Total duration: ${totalMs}ms`,
    "",
    "## Outcome",
    "Gate passed: specialist dispatched, file edited, no errors.",
    "",
    "<!-- fallback summary from maybe-reflect.ts \u2014 scripts/trace-summarize.ts was unavailable at this cwd. Install/restore scripts/trace-summarize.ts for the richer summary that guild:reflect prefers. -->"
  ];
  const summaryPath = path.join(runDir, "summary.md");
  fs.writeFileSync(summaryPath, lines.join("\n") + "\n", "utf8");
  process.stderr.write(`[maybe-reflect] wrote fallback summary to ${summaryPath}
`);
}
function tryRealSummarizer(cwd, runId) {
  const summarizerPath = path.join(cwd, "scripts", "trace-summarize.ts");
  if (!fs.existsSync(summarizerPath)) return false;
  const result = (0, import_child_process.spawnSync)(
    "npx",
    ["tsx", summarizerPath, "--run-id", runId, "--cwd", cwd],
    {
      cwd,
      encoding: "utf8",
      timeout: 15e3,
      env: { ...process.env }
    }
  );
  if (result.status !== 0) {
    process.stderr.write(
      `[maybe-reflect] trace-summarize.ts exited ${result.status}: ${result.stderr ?? ""}
`
    );
    return false;
  }
  return true;
}
async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw.trim());
  } catch {
    process.stderr.write("[maybe-reflect] WARN: invalid JSON on stdin; treating as non-task stop.\n");
    process.exit(0);
  }
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const sessionId = payload.session_id;
  const runId = process.env["GUILD_RUN_ID"] ?? (sessionId ? `run-${sessionId}` : `run-session-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`);
  const eventsFile = path.join(cwd, ".guild", "runs", runId, "events.ndjson");
  const events = loadEvents(eventsFile);
  if (!gateCheck(events)) {
    process.stderr.write(
      `[maybe-reflect] gate failed for run ${runId} \u2014 skipping reflection.
`
    );
    process.exit(0);
  }
  const runDir = path.join(cwd, ".guild", "runs", runId);
  const usedRealSummarizer = tryRealSummarizer(cwd, runId);
  if (!usedRealSummarizer) {
    writeStubSummary(runDir, runId, events);
  }
  process.stdout.write(`GUILD_REFLECT run_id=${runId}
`);
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(
    `[maybe-reflect] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});

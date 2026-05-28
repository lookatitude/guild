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
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var import_child_process = require("child_process");

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

// maybe-reflect.ts
async function readStdin() {
  return new Promise((resolve2) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve2(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve2(""));
  });
}
function loadEvents(eventsFile) {
  if (!fs2.existsSync(eventsFile)) return [];
  const content = fs2.readFileSync(eventsFile, "utf8");
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
function devteamSubagentGateCheck(events, cwd) {
  if (process.env["GUILD_ENABLE_DEVTEAM_REFLECT"] !== "1") {
    return { passed: false, reason: "GUILD_ENABLE_DEVTEAM_REFLECT != 1" };
  }
  const dispatchCount = events.filter(
    (e) => e.event === "SubagentStop" && typeof e.specialist === "string" && e.specialist.trim().length > 0
  ).length;
  if (dispatchCount < 3) {
    return {
      passed: false,
      reason: `dispatch count ${dispatchCount} < 3`
    };
  }
  const specDir = path2.join(resolveGuildRoot(cwd), ".guild", "spec");
  const slug = process.env["GUILD_SPEC_SLUG"];
  if (slug && slug.trim().length > 0) {
    const specPath = path2.join(specDir, `${slug}.md`);
    if (!fs2.existsSync(specPath)) {
      return { passed: false, reason: `spec not found: ${specPath}` };
    }
  } else {
    if (!fs2.existsSync(specDir)) {
      return { passed: false, reason: `spec dir not found: ${specDir}` };
    }
    let anySpec = false;
    try {
      const entries = fs2.readdirSync(specDir);
      anySpec = entries.some((name) => name.endsWith(".md"));
    } catch {
      anySpec = false;
    }
    if (!anySpec) {
      return { passed: false, reason: `no *.md spec under ${specDir}` };
    }
  }
  return { passed: true, reason: "all guards met" };
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
  const summaryPath = path2.join(runDir, "summary.md");
  fs2.writeFileSync(summaryPath, lines.join("\n") + "\n", "utf8");
  process.stderr.write(`[maybe-reflect] wrote fallback summary to ${summaryPath}
`);
}
function tryRealSummarizer(cwd, runId) {
  const summarizerPath = path2.join(cwd, "scripts", "trace-summarize.ts");
  if (!fs2.existsSync(summarizerPath)) return false;
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
  const guildRoot = resolveGuildRoot(cwd);
  try {
    const isSelfBuild = fs2.existsSync(path2.join(guildRoot, "plugin", "CLAUDE.md"));
    if (isSelfBuild) {
      const reflectionsDir = path2.join(guildRoot, ".guild", "reflections");
      if (fs2.existsSync(reflectionsDir)) {
        const reflectionFiles = fs2.readdirSync(reflectionsDir).filter((f) => f.endsWith(".md")).map((f) => path2.join(reflectionsDir, f)).map((p) => ({ path: p, mtime: fs2.statSync(p).mtimeMs })).sort((a, b) => b.mtime - a.mtime).slice(0, 3);
        const codexSkipCount = reflectionFiles.filter(({ path: p }) => {
          try {
            const content = fs2.readFileSync(p, "utf8");
            const m = content.match(/skill_improvement:\s*\[([^\]]*)\]/);
            return m ? m[1].includes("guild:codex-review") : false;
          } catch {
            return false;
          }
        }).length;
        if (codexSkipCount >= 3) {
          process.stderr.write(
            "\n[maybe-reflect] \u26A0\u26A0\u26A0 DISCIPLINE WARNING \u26A0\u26A0\u26A0\n[maybe-reflect] The last 3 reflections all named guild:codex-review\n[maybe-reflect] in skill_improvement \u2014 codex adversarial review has been\n[maybe-reflect] skipped on 3 consecutive self-build runs. This is the\n[maybe-reflect] \xA711.1 \u22653-reflection threshold for /guild:evolve auto-trigger.\n[maybe-reflect] Run `/guild:evolve guild:codex-review` to act on the proposals,\n[maybe-reflect] or wire codex (`codex --version` + OPENAI_API_KEY) before\n[maybe-reflect] the next G-gate. See plugin/CLAUDE.md \xA7'Codex adversarial review'.\n\n"
          );
        }
      }
    }
  } catch {
  }
  const sessionId = payload.session_id;
  const runId = process.env["GUILD_RUN_ID"] ?? (sessionId ? `run-${sessionId}` : `run-session-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`);
  const eventsFile = path2.join(guildRoot, ".guild", "runs", runId, "events.ndjson");
  const events = loadEvents(eventsFile);
  const hookEvent = payload.hook_event_name ?? "Stop";
  if (hookEvent === "SubagentStop") {
    const result = devteamSubagentGateCheck(events, guildRoot);
    if (!result.passed) {
      process.stderr.write(
        `[maybe-reflect] dev-team gate failed for run ${runId}: ${result.reason} \u2014 skipping reflection.
`
      );
      process.exit(0);
    }
  } else {
    if (!gateCheck(events)) {
      process.stderr.write(
        `[maybe-reflect] gate failed for run ${runId} \u2014 skipping reflection.
`
      );
      process.exit(0);
    }
  }
  const runDir = path2.join(guildRoot, ".guild", "runs", runId);
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

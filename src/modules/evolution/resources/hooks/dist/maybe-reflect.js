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
var fs3 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
var import_child_process = require("child_process");

// lib/guild-root.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function resolveGuildRoot(startCwd) {
  const resolvedStart = path.resolve(startCwd);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    if (nearestGuildDir === null) {
      const guildDir = path.join(current, ".guild");
      if (fs.existsSync(guildDir)) {
        try {
          if (fs.statSync(guildDir).isDirectory()) {
            nearestGuildDir = current;
          }
        } catch {
        }
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return nearestGuildDir ?? resolvedStart;
    }
    current = parent;
  }
}

// ../src/modules/lifecycle/workflows/run-binding.ts
var fsReal = __toESM(require("fs"));
var path2 = __toESM(require("path"));
function realBindingFs() {
  return {
    mkdirp: (p) => fsReal.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fsReal.writeFileSync(p, c, "utf8"),
    readFile: (p) => fsReal.existsSync(p) ? fsReal.readFileSync(p, "utf8") : null,
    exists: (p) => fsReal.existsSync(p)
  };
}
function runBindingPath(root, runId) {
  return path2.join(root, ".guild", "runs", runId, "binding.json");
}
function validateRunBindingRecord(parsed, expectedRunId) {
  if (parsed === null || typeof parsed !== "object") return null;
  const o = parsed;
  if (o["schema_version"] !== "guild.run_binding.v1") return null;
  if (typeof o["run_id"] !== "string" || o["run_id"] !== expectedRunId) return null;
  const ref = o["binding_ref"];
  if (typeof ref !== "string" || !/^rb-[A-Za-z0-9_-]+$/.test(ref)) return null;
  if (o["state"] !== "open" && o["state"] !== "closed") return null;
  return {
    schema_version: "guild.run_binding.v1",
    run_id: o["run_id"],
    binding_ref: ref,
    state: o["state"]
  };
}
function readRunBindingRecord(opts) {
  const fs4 = opts.fs ?? realBindingFs();
  const raw = fs4.readFile(runBindingPath(opts.root, opts.run_id));
  if (raw === null) return { status: "absent" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "malformed" };
  }
  const record = validateRunBindingRecord(parsed, opts.run_id);
  if (record === null) return { status: "malformed" };
  return { status: "ok", record };
}
function verifyRunBinding(input) {
  const reject2 = (reason) => ({
    ok: false,
    diagnostic: "binding_rejected",
    reason
  });
  if (!input.run_id || !input.binding_ref) return reject2("binding_absent");
  if (!input.root) return reject2("binding_unverifiable");
  const read = readRunBindingRecord({ root: input.root, run_id: input.run_id, fs: input.fs });
  if (read.status === "absent") return reject2("binding_not_minted");
  if (read.status === "malformed") return reject2("binding_malformed");
  const record = read.record;
  if (record.state === "closed") return reject2("binding_closed");
  if (record.binding_ref !== input.binding_ref || record.run_id !== input.run_id) {
    return reject2("binding_mismatch");
  }
  return { ok: true, binding: record };
}
var HOOK_BINDING_ENV_RUN_ID = "GUILD_RUN_ID";
var HOOK_BINDING_ENV_BINDING_REF = "GUILD_RUN_BINDING_REF";
function readHookBindingEnvelope(env) {
  const run_id = env[HOOK_BINDING_ENV_RUN_ID]?.trim();
  const binding_ref = env[HOOK_BINDING_ENV_BINDING_REF]?.trim();
  if (!run_id || !binding_ref) return null;
  return { run_id, binding_ref };
}

// lib/hook-binding.ts
function reject(reason, run_id) {
  return { ok: false, diagnostic: "binding_rejected", reason, run_id };
}
function authorizeHookWrite(root, opts = {}) {
  const env = opts.env ?? process.env;
  const envelope = readHookBindingEnvelope(env);
  const envRunId = env["GUILD_RUN_ID"]?.trim();
  const runId = opts.runId ?? envelope?.run_id ?? (envRunId || void 0);
  if (!runId) return reject("binding_absent", null);
  const ref = opts.bindingRef ?? (envelope && envelope.run_id === runId ? envelope.binding_ref : void 0);
  if (ref === void 0 || ref.trim().length === 0) {
    return reject("binding_absent", runId);
  }
  const verdict = verifyRunBinding({ root, run_id: runId, binding_ref: ref });
  if (verdict.ok === false) return reject(verdict.reason, runId);
  return { ok: true, run_id: runId, binding_ref: verdict.binding.binding_ref };
}
function formatBindingRejected(hook, auth) {
  if (auth.ok !== false) return "";
  return `[${hook}] binding_rejected (${auth.reason}) for run ${auth.run_id ?? "<unresolved>"} \u2014 no write performed (session_context \xA75: writers fail closed; sentinels are intake-only).
`;
}

// lib/self-build.ts
var fs2 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var SELF_BUILD_MARKER = "Guild \u2014 repo orientation";
function fileContainsMarker(p) {
  try {
    if (!fs2.existsSync(p)) return false;
    return fs2.readFileSync(p, "utf8").includes(SELF_BUILD_MARKER);
  } catch {
    return false;
  }
}
function detectSelfBuild(root) {
  const directPath = path3.join(root, "AGENTS.md");
  if (fileContainsMarker(directPath)) return { armed: true, path: directPath };
  const nestedPath = path3.join(root, "plugin", "AGENTS.md");
  if (fileContainsMarker(nestedPath)) return { armed: true, path: nestedPath };
  return { armed: false, path: null };
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
  if (!fs3.existsSync(eventsFile)) return [];
  const content = fs3.readFileSync(eventsFile, "utf8");
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
  const isFileEditCall = (e) => (e.event === "PostToolUse" || e.event === "tool_call") && (e.tool === "Write" || e.tool === "Edit");
  const hasFileEdit = events.some(isFileEditCall);
  const hasError = events.some((e) => e.ok === false || e.status === "err");
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
  const specDir = path4.join(resolveGuildRoot(cwd), ".guild", "spec");
  const slug = process.env["GUILD_SPEC_SLUG"];
  if (slug && slug.trim().length > 0) {
    const specPath = path4.join(specDir, `${slug}.md`);
    if (!fs3.existsSync(specPath)) {
      return { passed: false, reason: `spec not found: ${specPath}` };
    }
  } else {
    if (!fs3.existsSync(specDir)) {
      return { passed: false, reason: `spec dir not found: ${specDir}` };
    }
    let anySpec = false;
    try {
      const entries = fs3.readdirSync(specDir);
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
  const summaryPath = path4.join(runDir, "summary.md");
  fs3.writeFileSync(summaryPath, lines.join("\n") + "\n", "utf8");
  process.stderr.write(`[maybe-reflect] wrote fallback summary to ${summaryPath}
`);
}
function tryRealSummarizer(cwd, runId) {
  const summarizerPath = path4.join(cwd, "scripts", "trace-summarize.ts");
  if (!fs3.existsSync(summarizerPath)) return false;
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
var CODEX_SKIP_THRESHOLD = 3;
var CODEX_SKIP_EXIT_CODE = 2;
function reflectionRecordsCodexSkip(content) {
  if (/^\s*codex_review:\s*SKIPPED\s*$/im.test(content)) return true;
  if (/<!--\s*codex_review:\s*SKIPPED\s*-->/i.test(content)) return true;
  const m = content.match(/skill_improvement:\s*\[([^\]]*)\]/);
  if (m && m[1].includes("guild:codex-review")) return true;
  return false;
}
function evaluateCodexSkipGuard(guildRoot) {
  try {
    const { armed } = detectSelfBuild(guildRoot);
    if (!armed) return { armed: false, streak: 0 };
    const reflectionsDir = path4.join(guildRoot, ".guild", "reflections");
    if (!fs3.existsSync(reflectionsDir)) return { armed: true, streak: 0 };
    const files = fs3.readdirSync(reflectionsDir).filter((f) => f.endsWith(".md")).map((f) => path4.join(reflectionsDir, f)).map((p) => {
      let mtime = 0;
      try {
        mtime = fs3.statSync(p).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { path: p, mtime };
    }).sort((a, b) => b.mtime - a.mtime);
    let streak = 0;
    for (const { path: p } of files) {
      let content = "";
      try {
        content = fs3.readFileSync(p, "utf8");
      } catch {
        break;
      }
      if (reflectionRecordsCodexSkip(content)) {
        streak += 1;
      } else {
        break;
      }
    }
    return { armed: true, streak };
  } catch {
    return { armed: false, streak: 0 };
  }
}
function writeCodexSkipSentinel(guildRoot, streak) {
  try {
    const guildDir = path4.join(guildRoot, ".guild");
    fs3.mkdirSync(guildDir, { recursive: true });
    const sentinel = path4.join(guildDir, "codex-skip-streak.json");
    const data = {
      schema_version: "guild.codex_skip_streak.v1",
      streak,
      threshold: CODEX_SKIP_THRESHOLD,
      blocked: true,
      updated_at: (/* @__PURE__ */ new Date()).toISOString(),
      reason: "codex adversarial review skipped on >= 3 consecutive self-build reflections (FU-E)",
      clear_by: "run guild:codex-review at the next gate, OR record a reflection without a codex_review: SKIPPED marker, OR delete this file after an explicit operator override"
    };
    fs3.writeFileSync(sentinel, JSON.stringify(data, null, 2) + "\n", "utf8");
    process.stderr.write(
      `[maybe-reflect] wrote codex-skip sentinel: ${sentinel}
`
    );
  } catch (err) {
    process.stderr.write(
      `[maybe-reflect] WARN: failed to write codex-skip sentinel: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
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
  const codexGuard = evaluateCodexSkipGuard(guildRoot);
  if (codexGuard.armed && codexGuard.streak >= CODEX_SKIP_THRESHOLD) {
    writeCodexSkipSentinel(guildRoot, codexGuard.streak);
    process.stderr.write(
      `
[maybe-reflect] \u26A0\u26A0\u26A0 DISCIPLINE HARD-FAIL \u26A0\u26A0\u26A0
[maybe-reflect] codex adversarial review has been SKIPPED on ${codexGuard.streak}
[maybe-reflect] consecutive self-build reflections (>= 3 threshold reached).
[maybe-reflect] A blocking sentinel was written to:
[maybe-reflect]   .guild/codex-skip-streak.json  (blocked: true)
[maybe-reflect] The NEXT G-gate (G-spec/G-plan/G-lane) must REFUSE to pass
[maybe-reflect] until codex review runs or the streak is cleared. To clear:
[maybe-reflect]   1. wire codex (\`codex --version\` + \`codex login\`, or OPENAI_API_KEY) and run
[maybe-reflect]      \`guild:codex-review\` at the gate, OR
[maybe-reflect]   2. record a reflection WITHOUT a codex_review: SKIPPED marker
[maybe-reflect]      (a real review breaks the consecutive streak), OR
[maybe-reflect]   3. delete .guild/codex-skip-streak.json after an explicit
[maybe-reflect]      operator override.
[maybe-reflect] See plugin/CLAUDE.md \xA7'Codex adversarial review'.

`
    );
    process.exit(CODEX_SKIP_EXIT_CODE);
  }
  const reflectAuth = authorizeHookWrite(guildRoot);
  if (reflectAuth.ok === false) {
    process.stderr.write(formatBindingRejected("maybe-reflect", reflectAuth));
    process.exit(0);
  }
  const runId = reflectAuth.run_id;
  const eventsRunDir = path4.join(guildRoot, ".guild", "runs", runId);
  const canonicalEventsFile = path4.join(eventsRunDir, "logs", "v1.4-events.jsonl");
  const legacyEventsFile = path4.join(eventsRunDir, "events.ndjson");
  const eventsFile = fs3.existsSync(canonicalEventsFile) ? canonicalEventsFile : legacyEventsFile;
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
  const runDir = path4.join(guildRoot, ".guild", "runs", runId);
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

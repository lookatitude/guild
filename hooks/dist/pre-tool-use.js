#!/usr/bin/env -S npx tsx
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// pre-tool-use.ts
var pre_tool_use_exports = {};
__export(pre_tool_use_exports, {
  main: () => main
});
module.exports = __toCommonJS(pre_tool_use_exports);
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));

// ../../benchmark/src/log-jsonl.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");

// ../../benchmark/src/redact-log.ts
var TOKEN_REDACTED = "[REDACTED_TOKEN]";
var PATH_REDACTED = "[REDACTED]";
var KV_REDACTED = "[REDACTED]";
var HIGH_ENTROPY_REDACTED = "<HIGH_ENTROPY_REDACTED>";
var TRUNCATION_SUFFIX = "... [TRUNCATED]";
var FIELD_SIZE_CAP_BYTES = 4 * 1024;
var TOKEN_SHAPE_PATTERNS = [
  /Authorization:\s*Bearer\s+[A-Za-z0-9._\-+/=]+/g,
  /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/g,
  /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/g,
  /\bghp_[A-Za-z0-9]{36}\b/g,
  /\bgh[suor]_[A-Za-z0-9]{36}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{82}\b/g,
  /\bxox[bp]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
];
function redactTokenShapes(input) {
  let out = input;
  for (const re of TOKEN_SHAPE_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), TOKEN_REDACTED);
  }
  return out;
}
var HOME_DIR_PATTERN = /(~|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/(\.claude|\.codex|\.ssh|\.aws|\.gnupg)\/[^\s'"]+/g;
function redactHomeDirPaths(input) {
  return input.replace(HOME_DIR_PATTERN, (_match, root, dir) => {
    return `${root}/${dir}/${PATH_REDACTED}`;
  });
}
var KV_SECRET_PATTERN = /\b(password|token|api[_-]?key|secret|authorization|bearer)(\s*[:=]\s*)(\S+)/gi;
function redactKeyValueSecrets(input) {
  return input.replace(
    KV_SECRET_PATTERN,
    (_match, key, sep2) => `${key}${sep2}${KV_REDACTED}`
  );
}
function isWhitelistedHighEntropy(candidate, fullInput, matchIndex) {
  if (matchIndex >= 4 && fullInput.slice(matchIndex - 4, matchIndex) === "run-") {
    return true;
  }
  const lookBackStart = Math.max(0, matchIndex - 16);
  const before = fullInput.slice(lookBackStart, matchIndex).toLowerCase();
  if (/\b(commit|sha|tree|parent|head|merge|object|branch)\s*[:=]?\s*$/.test(before)) {
    return true;
  }
  if (/^[0-9a-f]{40}$/.test(candidate) || /^[0-9a-f]{64}$/.test(candidate)) {
    return true;
  }
  return false;
}
var HIGH_ENTROPY_PATTERN = /[A-Za-z0-9+/=]{20,}/g;
function redactHighEntropy(input) {
  return input.replace(HIGH_ENTROPY_PATTERN, (match, offset) => {
    if (isWhitelistedHighEntropy(match, input, offset)) {
      return match;
    }
    return HIGH_ENTROPY_REDACTED;
  });
}
function truncateToCap(input, cap = FIELD_SIZE_CAP_BYTES) {
  const byteLen = Buffer.byteLength(input, "utf8");
  if (byteLen <= cap) return input;
  const buf = Buffer.from(input, "utf8");
  const truncated = buf.slice(0, cap).toString("utf8");
  const cleaned = truncated.replace(/\uFFFD+$/u, "");
  return cleaned + TRUNCATION_SUFFIX;
}
function redactField(input, cap = FIELD_SIZE_CAP_BYTES) {
  if (typeof input !== "string") return input;
  let out = redactTokenShapes(input);
  out = redactHomeDirPaths(out);
  out = redactKeyValueSecrets(out);
  out = redactHighEntropy(out);
  out = truncateToCap(out, cap);
  return out;
}
var REDACTABLE_FIELDS = /* @__PURE__ */ new Set([
  "command_redacted",
  "result_excerpt_redacted",
  "payload_excerpt_redacted",
  "prompt_excerpt",
  "assumption_text",
  "result"
]);
function redactEventFields(event, cap = FIELD_SIZE_CAP_BYTES) {
  const out = { ...event };
  for (const [k, v] of Object.entries(out)) {
    if (REDACTABLE_FIELDS.has(k) && typeof v === "string") {
      out[k] = redactField(v, cap);
    }
  }
  return out;
}

// ../../benchmark/src/v1.4-lock.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function stableLockPath(runDir) {
  return (0, import_node_path.join)(runDir, "logs", ".lock");
}
function exclusionSentinelPath(runDir) {
  return (0, import_node_path.join)(runDir, "logs", ".lock.exclusion");
}
function initStableLockfile(runDir) {
  const path2 = stableLockPath(runDir);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path2), { recursive: true });
  if ((0, import_node_fs.existsSync)(path2)) return;
  try {
    const fd = (0, import_node_fs.openSync)(path2, "wx");
    (0, import_node_fs.closeSync)(fd);
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
  }
}
var DEFAULT_BACKOFF_MS = [2, 5, 10, 25, 50, 100, 200];
var DEFAULT_TIMEOUT_MS = 5e3;
function sleepSyncMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
  }
}
function withStableLock(runDir, fn, opts = {}) {
  initStableLockfile(runDir);
  const sentinel = exclusionSentinelPath(runDir);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const start = Date.now();
  let attempt = 0;
  for (; ; ) {
    try {
      const fd = (0, import_node_fs.openSync)(sentinel, "wx");
      try {
        (0, import_node_fs.writeSync)(fd, `${process.pid}
`);
      } catch {
      }
      (0, import_node_fs.closeSync)(fd);
      try {
        return fn();
      } finally {
        try {
          (0, import_node_fs.unlinkSync)(sentinel);
        } catch {
        }
      }
    } catch (err) {
      const code = err?.code;
      if (code !== "EEXIST") throw err;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `v1.4-lock: timed out waiting for ${sentinel} (${timeoutMs}ms). Stale lock? Remove the file if you are sure no other process holds it.`
        );
      }
      const idx = Math.min(attempt, backoff.length - 1);
      sleepSyncMs(backoff[idx]);
      attempt += 1;
    }
  }
}

// ../../benchmark/src/log-jsonl.ts
function sidecarPath(runDir) {
  return (0, import_node_path2.join)(runDir, "logs", "tool-call-pre.jsonl");
}
var TOOL_CALL_TOOL_VALUES = [
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Bash",
  "Agent",
  "Skill",
  "AskUserQuestion",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "BashOutput",
  "KillShell"
];
var RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var LANE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function isSafeRunId(id) {
  return RUN_ID_RE.test(id) && id !== "." && id !== "..";
}
function isSafeLaneId(id) {
  return LANE_ID_RE.test(id) && id !== "." && id !== "..";
}
function assertSafeRunId(id) {
  if (!isSafeRunId(id)) {
    throw new Error(`log-jsonl: invalid run_id ${JSON.stringify(id)}`);
  }
}
function assertSafeLaneId(id) {
  if (!isSafeLaneId(id)) {
    throw new Error(`log-jsonl: invalid lane_id ${JSON.stringify(id)}`);
  }
}
var ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
var SIDECAR_MAX_BYTES = 1024 * 1024;
function appendSidecarPre(runDir, entry, opts = {}) {
  validateSidecarEntry(entry);
  const path2 = sidecarPath(runDir);
  (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(path2), { recursive: true });
  const redacted = redactEventFields(entry, opts.fieldCap);
  const line = JSON.stringify(redacted) + "\n";
  const maxBytes = opts.maxBytes ?? SIDECAR_MAX_BYTES;
  const appendCapped = () => {
    const existing = (0, import_node_fs2.existsSync)(path2) ? (0, import_node_fs2.readFileSync)(path2, "utf8") : "";
    (0, import_node_fs2.writeFileSync)(path2, capSidecarText(existing, line, maxBytes));
  };
  if (process.platform === "win32") {
    appendCapped();
    return;
  }
  withStableLock(runDir, () => {
    appendCapped();
  });
}
function validateSidecarEntry(entry) {
  assertSafeRunId(entry.run_id);
  if (entry.lane_id !== void 0) assertSafeLaneId(entry.lane_id);
}
function capSidecarText(existing, incomingLine, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`log-jsonl: sidecar maxBytes must be positive; got ${maxBytes}`);
  }
  const combined = existing + incomingLine;
  if (Buffer.byteLength(combined, "utf8") <= maxBytes) return combined;
  const lines = combined.split("\n").filter((line) => line.length > 0);
  const kept = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === void 0) continue;
    const bytes = Buffer.byteLength(line + "\n", "utf8");
    if (kept.length > 0 && total + bytes > maxBytes) break;
    if (bytes > maxBytes) {
      return "";
    }
    kept.unshift(line);
    total += bytes;
  }
  return kept.length === 0 ? "" : kept.join("\n") + "\n";
}

// pre-tool-use.ts
async function readStdin() {
  return new Promise((resolve2) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve2(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve2(""));
  });
}
function renderCommand(toolName, toolInput) {
  if (toolInput === void 0 || toolInput === null) return toolName;
  if (typeof toolInput === "string") return `${toolName} ${toolInput}`;
  try {
    return `${toolName} ${JSON.stringify(toolInput)}`;
  } catch {
    return toolName;
  }
}
function isKnownTool(name) {
  if (typeof name !== "string") return false;
  return TOOL_CALL_TOOL_VALUES.includes(name);
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
function resolveRunId(cwd) {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.length > 0) return envRunId;
  return readCurrentRunId(cwd);
}
var GUILD_NS_TOKEN = /guild\.[A-Za-z0-9_]+\.v\d+/;
function hasGuildSignature(content) {
  if (typeof content !== "string" || content.length === 0) return false;
  if (/^\s*schema_version:\s*["']?guild\.[A-Za-z0-9_]+\.v\d+/m.test(content)) {
    return true;
  }
  if (/^---\s*$/m.test(content) && /^\s*type:\s*\S/m.test(content) && GUILD_NS_TOKEN.test(content)) {
    return true;
  }
  if (/task_run/.test(content) && GUILD_NS_TOKEN.test(content)) {
    return true;
  }
  return false;
}
function isInsideGuildDir(absPath) {
  return path.resolve(absPath).split(path.sep).includes(".guild");
}
function runBoundaryGuard(payload, cwd) {
  const tool = payload.tool_name;
  if (tool !== "Write" && tool !== "Edit" && tool !== "MultiEdit") {
    return false;
  }
  const ti = payload.tool_input;
  if (ti === void 0 || ti === null || typeof ti !== "object") return false;
  const filePath = typeof ti.file_path === "string" ? ti.file_path : void 0;
  if (filePath === void 0 || filePath.length === 0) return false;
  let content = "";
  if (typeof ti.content === "string") content += ti.content;
  if (typeof ti.new_string === "string") content += `
${ti.new_string}`;
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) {
      if (e !== null && typeof e === "object" && typeof e.new_string === "string") {
        content += `
${e.new_string}`;
      }
    }
  }
  if (!hasGuildSignature(content)) return false;
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  if (isInsideGuildDir(abs)) return false;
  const decision = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: `Guild-owned-file boundary (P5-boundary-001): a Guild-signed artifact would be written OUTSIDE the consuming repo's .guild/ (${abs}). Guild-owned files belong under .guild/ (or .guild/agents/proposed/, .guild/skills/proposed-*). Confirm this write is intentional.`
    }
  };
  process.stdout.write(JSON.stringify(decision));
  return true;
}
async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw.trim());
  } catch {
    process.stderr.write("warn: [pre-tool-use] invalid JSON on stdin; skipping.\n");
    return;
  }
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  if (runBoundaryGuard(payload, cwd)) return;
  const runId = resolveRunId(cwd);
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [pre-tool-use] GUILD_RUN_ID unset and current-run-id missing \u2014 falling through (no sidecar write).\n"
    );
    return;
  }
  if (!isSafeRunId(runId)) {
    process.stderr.write(
      "warn: [pre-tool-use] invalid GUILD_RUN_ID/current-run-id \u2014 falling through (no sidecar write).\n"
    );
    return;
  }
  const toolName = payload.tool_name ?? "";
  if (!isKnownTool(toolName)) {
    process.stderr.write(
      `warn: [pre-tool-use] tool '${toolName}' not in closed enum; skipping.
`
    );
    return;
  }
  const runDir = process.env["GUILD_RUN_DIR"] ?? path.join(cwd, ".guild", "runs", runId);
  const laneId = process.env["GUILD_LANE_ID"];
  const entry = {
    run_id: runId,
    tool: toolName,
    ts_pre: (/* @__PURE__ */ new Date()).toISOString(),
    command_redacted: renderCommand(toolName, payload.tool_input)
  };
  if (typeof laneId === "string" && laneId.length > 0 && isSafeLaneId(laneId)) {
    entry.lane_id = laneId;
  } else if (typeof laneId === "string" && laneId.length > 0) {
    process.stderr.write(
      "warn: [pre-tool-use] invalid GUILD_LANE_ID \u2014 omitting lane_id.\n"
    );
  }
  try {
    fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
    appendSidecarPre(runDir, entry);
  } catch (err) {
    process.stderr.write(
      `warn: [pre-tool-use] sidecar write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
if (process.argv[1] !== void 0 && process.argv[1].endsWith("pre-tool-use.ts")) {
  main().catch((err) => {
    process.stderr.write(
      `fatal: [pre-tool-use] ${err instanceof Error ? err.message : String(err)}
`
    );
    process.exit(0);
  });
} else if (process.argv[1] !== void 0 && process.argv[1].endsWith("pre-tool-use.js")) {
  main().catch((err) => {
    process.stderr.write(
      `fatal: [pre-tool-use] ${err instanceof Error ? err.message : String(err)}
`
    );
    process.exit(0);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});

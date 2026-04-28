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

// post-tool-use.ts
var post_tool_use_exports = {};
__export(post_tool_use_exports, {
  main: () => main
});
module.exports = __toCommonJS(post_tool_use_exports);
var path = __toESM(require("node:path"));

// ../benchmark/src/log-jsonl.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_zlib = require("node:zlib");

// ../benchmark/src/redact-log.ts
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
    (_match, key, sep) => `${key}${sep}${KV_REDACTED}`
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

// ../benchmark/src/v1.4-lock.ts
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

// ../benchmark/src/log-jsonl.ts
function liveLogPath(runDir) {
  return (0, import_node_path2.join)(runDir, "logs", "v1.4-events.jsonl");
}
function archiveDir(runDir) {
  return (0, import_node_path2.join)(runDir, "logs", "archive");
}
function archivePath(runDir, n) {
  return (0, import_node_path2.join)(archiveDir(runDir), `v1.4-events.${n}.jsonl.gz`);
}
function sidecarPath(runDir) {
  return (0, import_node_path2.join)(runDir, "logs", "tool-call-pre.jsonl");
}
function laneFallbackPath(runDir, laneId) {
  return (0, import_node_path2.join)(runDir, "logs", `lane-${laneId}-events.jsonl`);
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
var ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
function appendEvent(runDir, event, opts = {}) {
  const cap = opts.fieldCap;
  const redacted = redactEventFields(event, cap);
  const line = JSON.stringify(redacted) + "\n";
  if (opts.forceFallback || process.platform === "win32") {
    const laneId = opts.laneId ?? "global";
    const path2 = laneFallbackPath(runDir, laneId);
    (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(path2), { recursive: true });
    const fd = (0, import_node_fs2.openSync)(path2, "a");
    try {
      (0, import_node_fs2.writeSync)(fd, line);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    return;
  }
  const live = liveLogPath(runDir);
  (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(live), { recursive: true });
  withStableLock(runDir, () => {
    const fd = (0, import_node_fs2.openSync)(live, "a");
    try {
      (0, import_node_fs2.writeSync)(fd, line);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    maybeRotateLocked(runDir, opts.rotationThresholdBytes ?? ROTATION_THRESHOLD_BYTES);
  });
}
function nextRotationIndex(runDir) {
  const dir = archiveDir(runDir);
  if (!(0, import_node_fs2.existsSync)(dir)) return 1;
  let max = 0;
  for (const entry of (0, import_node_fs2.readdirSync)(dir)) {
    const m = /^v1\.4-events\.(\d+)\.jsonl\.gz$/.exec(entry);
    if (m && m[1] !== void 0) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}
function maybeRotateLocked(runDir, thresholdBytes) {
  const live = liveLogPath(runDir);
  if (!(0, import_node_fs2.existsSync)(live)) return;
  const size = (0, import_node_fs2.statSync)(live).size;
  if (size < thresholdBytes) return;
  rotateLocked(runDir);
}
function rotateLocked(runDir) {
  const live = liveLogPath(runDir);
  const archive = archiveDir(runDir);
  (0, import_node_fs2.mkdirSync)(archive, { recursive: true });
  const n = nextRotationIndex(runDir);
  const stagingPath = (0, import_node_path2.join)(archive, `v1.4-events.${n}.jsonl`);
  const finalArchive = archivePath(runDir, n);
  (0, import_node_fs2.renameSync)(live, stagingPath);
  const raw = (0, import_node_fs2.readFileSync)(stagingPath);
  const gzipped = (0, import_node_zlib.gzipSync)(raw);
  (0, import_node_fs2.writeFileSync)(finalArchive, gzipped);
  (0, import_node_fs2.unlinkSync)(stagingPath);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = (0, import_node_fs2.openSync)(live, "wx");
      (0, import_node_fs2.closeSync)(fd);
      return;
    } catch (err) {
      const code = err?.code;
      if (code !== "EEXIST") throw err;
      try {
        (0, import_node_fs2.unlinkSync)(live);
      } catch {
      }
    }
  }
  throw new Error(
    `log-jsonl: failed to recreate live log at ${live} with O_EXCL after 5 retries`
  );
}
function sidecarKeyMatches(entry, key) {
  if (entry.run_id !== key.run_id) return false;
  if (entry.tool !== key.tool) return false;
  if ((entry.lane_id ?? void 0) !== (key.lane_id ?? void 0)) return false;
  if (key.post_ts !== void 0) {
    const preMs = Date.parse(entry.ts_pre);
    const postMs = Date.parse(key.post_ts);
    if (Number.isFinite(preMs) && Number.isFinite(postMs) && preMs >= postMs) {
      return false;
    }
  }
  return true;
}
function consumeSidecarPre(runDir, matchOrCallId) {
  const path2 = sidecarPath(runDir);
  if (!(0, import_node_fs2.existsSync)(path2)) return null;
  const apply = (text) => {
    const lines = text.split("\n");
    const parsedLines = [];
    for (const raw of lines) {
      if (raw.length === 0) continue;
      try {
        parsedLines.push({ raw, parsed: JSON.parse(raw) });
      } catch {
        parsedLines.push({ raw, parsed: null });
      }
    }
    let pickIdx = -1;
    let pickTs = Number.POSITIVE_INFINITY;
    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (!p || p.parsed === null) continue;
      const eligible = typeof matchOrCallId === "string" ? p.parsed.call_id === matchOrCallId : sidecarKeyMatches(p.parsed, matchOrCallId);
      if (!eligible) continue;
      const ts = Date.parse(p.parsed.ts_pre);
      const tsForSort = Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
      if (tsForSort < pickTs) {
        pickTs = tsForSort;
        pickIdx = i;
      }
    }
    let match = null;
    const remainingLines = [];
    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (!p) continue;
      if (i === pickIdx && p.parsed !== null) {
        match = p.parsed;
        continue;
      }
      remainingLines.push(p.raw);
    }
    const rest = remainingLines.length === 0 ? "" : remainingLines.join("\n") + "\n";
    return { match, rest };
  };
  if (process.platform === "win32") {
    const text = (0, import_node_fs2.readFileSync)(path2, "utf8");
    const { match, rest } = apply(text);
    (0, import_node_fs2.writeFileSync)(path2, rest);
    return match;
  }
  return withStableLock(runDir, () => {
    const text = (0, import_node_fs2.readFileSync)(path2, "utf8");
    const { match, rest } = apply(text);
    (0, import_node_fs2.writeFileSync)(path2, rest);
    return match;
  });
}
function buildToolCallFromPair(pre, post) {
  const tsPostMs = Date.parse(post.ts_post);
  const tsPreMs = Date.parse(pre.ts_pre);
  const latency = Number.isFinite(tsPostMs) && Number.isFinite(tsPreMs) ? Math.max(0, tsPostMs - tsPreMs) : 0;
  const out = {
    ts: post.ts_post,
    event: "tool_call",
    run_id: post.run_id,
    tool: pre.tool,
    command_redacted: pre.command_redacted,
    status: post.status,
    latency_ms: latency,
    result_excerpt_redacted: post.result_excerpt_redacted
  };
  if (pre.lane_id !== void 0) out.lane_id = pre.lane_id;
  if (post.tokens_in !== void 0) out.tokens_in = post.tokens_in;
  if (post.tokens_out !== void 0) out.tokens_out = post.tokens_out;
  return out;
}
var ORPHAN_RESULT_EXCERPT = "<orphaned \u2014 pre/post pairing failed>";
var ORPHAN_LATENCY_MS = -1;
function buildOrphanedToolCall(pre) {
  const out = {
    ts: pre.ts_pre,
    event: "tool_call",
    run_id: pre.run_id,
    tool: pre.tool,
    command_redacted: pre.command_redacted,
    status: "err",
    latency_ms: ORPHAN_LATENCY_MS,
    result_excerpt_redacted: ORPHAN_RESULT_EXCERPT
  };
  if (pre.lane_id !== void 0) out.lane_id = pre.lane_id;
  return out;
}
function buildToolCallFromPostOnly(opts) {
  const out = {
    ts: opts.ts_post,
    event: "tool_call",
    run_id: opts.run_id,
    tool: opts.tool,
    command_redacted: "",
    status: "ok",
    latency_ms: typeof opts.latency_ms_override === "number" ? opts.latency_ms_override : 0,
    result_excerpt_redacted: opts.result_excerpt_redacted
  };
  if (opts.lane_id !== void 0) out.lane_id = opts.lane_id;
  if (opts.tokens_in !== void 0) out.tokens_in = opts.tokens_in;
  if (opts.tokens_out !== void 0) out.tokens_out = opts.tokens_out;
  return out;
}
function sweepOrphanedSidecarFull(runDir, nowMs = Date.now(), maxAgeMs = 5 * 60 * 1e3) {
  const path2 = sidecarPath(runDir);
  if (!(0, import_node_fs2.existsSync)(path2)) return { orphans: [], events: [] };
  const apply = (text) => {
    const lines = text.split("\n");
    const orphans2 = [];
    const kept = [];
    for (const raw of lines) {
      if (raw.length === 0) continue;
      try {
        const parsed = JSON.parse(raw);
        const tsMs = Date.parse(parsed.ts_pre);
        if (Number.isFinite(tsMs) && nowMs - tsMs > maxAgeMs) {
          orphans2.push(parsed);
          continue;
        }
        kept.push(raw);
      } catch {
        continue;
      }
    }
    const rest = kept.length === 0 ? "" : kept.join("\n") + "\n";
    return { orphans: orphans2, rest };
  };
  let orphans;
  if (process.platform === "win32") {
    const text = (0, import_node_fs2.readFileSync)(path2, "utf8");
    const out = apply(text);
    (0, import_node_fs2.writeFileSync)(path2, out.rest);
    orphans = out.orphans;
  } else {
    orphans = withStableLock(runDir, () => {
      const text = (0, import_node_fs2.readFileSync)(path2, "utf8");
      const out = apply(text);
      (0, import_node_fs2.writeFileSync)(path2, out.rest);
      return out.orphans;
    });
  }
  const events = orphans.map(buildOrphanedToolCall);
  return { orphans, events };
}

// post-tool-use.ts
async function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}
function isKnownTool(name) {
  if (typeof name !== "string") return false;
  return TOOL_CALL_TOOL_VALUES.includes(name);
}
function isOk(payload) {
  const resp = payload.tool_response;
  if (resp === null || resp === void 0) return "ok";
  if (typeof resp === "object") {
    const r = resp;
    if (r["success"] === false) return "err";
    if (typeof r["error"] === "string" && r["error"].length > 0) return "err";
  }
  return "ok";
}
function resultExcerpt(payload) {
  const resp = payload.tool_response;
  if (resp === null || resp === void 0) return "";
  if (typeof resp === "string") return resp;
  try {
    return JSON.stringify(resp);
  } catch {
    return "";
  }
}
async function main() {
  const runId = process.env["GUILD_RUN_ID"];
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [post-tool-use] GUILD_RUN_ID unset \u2014 falling through (no tool_call emit).\n"
    );
    return;
  }
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw.trim());
  } catch {
    process.stderr.write("warn: [post-tool-use] invalid JSON on stdin; skipping pairing.\n");
    return;
  }
  const toolName = payload.tool_name ?? "";
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const runDir = process.env["GUILD_RUN_DIR"] ?? path.join(cwd, ".guild", "runs", runId);
  const laneId = process.env["GUILD_LANE_ID"];
  const tsPost = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const sweep = sweepOrphanedSidecarFull(runDir);
    for (const ev of sweep.events) {
      try {
        appendEvent(runDir, ev);
      } catch (err) {
        process.stderr.write(
          `warn: [post-tool-use] orphan emit failed: ${err instanceof Error ? err.message : String(err)}
`
        );
      }
    }
  } catch (err) {
    process.stderr.write(
      `warn: [post-tool-use] sweep failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
  if (!isKnownTool(toolName)) {
    return;
  }
  const matchKey = {
    run_id: runId,
    tool: toolName,
    post_ts: tsPost
  };
  if (typeof laneId === "string" && laneId.length > 0) {
    matchKey.lane_id = laneId;
  }
  let event;
  try {
    const pre = consumeSidecarPre(runDir, matchKey);
    if (pre === null) {
      event = buildToolCallFromPostOnly({
        ts_post: tsPost,
        run_id: runId,
        tool: toolName,
        result_excerpt_redacted: resultExcerpt(payload),
        ...typeof laneId === "string" && laneId.length > 0 ? { lane_id: laneId } : {},
        ...typeof payload.duration_ms === "number" ? { latency_ms_override: payload.duration_ms } : {}
      });
    } else {
      event = buildToolCallFromPair(pre, {
        ts_post: tsPost,
        run_id: runId,
        status: isOk(payload),
        result_excerpt_redacted: resultExcerpt(payload)
      });
    }
    appendEvent(runDir, event);
  } catch (err) {
    process.stderr.write(
      `warn: [post-tool-use] tool_call emit failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
if (process.argv[1] !== void 0 && (process.argv[1].endsWith("post-tool-use.ts") || process.argv[1].endsWith("post-tool-use.js"))) {
  main().catch((err) => {
    process.stderr.write(
      `fatal: [post-tool-use] ${err instanceof Error ? err.message : String(err)}
`
    );
    process.exit(0);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});

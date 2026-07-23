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
var fs6 = __toESM(require("node:fs"));
var path7 = __toESM(require("node:path"));

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

// lib/v1.4/log-jsonl-schema.ts
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
function validateEventIds(event) {
  assertSafeRunId(event.run_id);
  if ("lane_id" in event && event.lane_id !== void 0) {
    assertSafeLaneId(event.lane_id);
  }
}

// lib/v1.4/log-jsonl-writer.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_zlib = require("node:zlib");

// lib/v1.4/redact-log.ts
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
var PATH_TOKEN_CHAR = /[A-Za-z0-9._/-]/;
var PATH_SHAPE = /^(?:\.{1,2}\/)?[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;
var PATH_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
var MAX_PATH_TOKEN_LEN = 512;
function allWordsWordish(words) {
  let opaqueBudget = 1;
  for (const word of words) {
    if (word.length === 0 || word.length >= 20) return false;
    let upper = 0;
    let lower = 0;
    let digits = 0;
    for (const ch of word) {
      if (ch >= "a" && ch <= "z") lower++;
      else if (ch >= "A" && ch <= "Z") upper++;
      else digits++;
    }
    if (lower === 0) {
      if (word.length > 8) return false;
      if (word.length > 2 && --opaqueBudget < 0) return false;
    } else if (upper > 3 || digits > 4) {
      return false;
    }
  }
  return true;
}
function isRelativePathToken(candidate, fullInput, matchIndex) {
  if (candidate.includes("+") || candidate.includes("=")) return false;
  let start = matchIndex;
  const startFloor = Math.max(0, matchIndex - MAX_PATH_TOKEN_LEN);
  while (start > startFloor && PATH_TOKEN_CHAR.test(fullInput[start - 1])) start--;
  if (start === startFloor && start > 0 && PATH_TOKEN_CHAR.test(fullInput[start - 1])) {
    return false;
  }
  let end = matchIndex + candidate.length;
  const endCeil = Math.min(fullInput.length, end + MAX_PATH_TOKEN_LEN);
  while (end < endCeil && PATH_TOKEN_CHAR.test(fullInput[end])) end++;
  if (end === endCeil && end < fullInput.length && PATH_TOKEN_CHAR.test(fullInput[end])) {
    return false;
  }
  const token = fullInput.slice(start, end);
  if (token.length > MAX_PATH_TOKEN_LEN) return false;
  if (!PATH_SHAPE.test(token)) return false;
  const slashCount = token.split("/").length - 1;
  if (slashCount < 2 && !PATH_EXTENSION.test(token)) return false;
  return allWordsWordish(token.split(/[/._-]+/).filter(Boolean));
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
  if (isRelativePathToken(candidate, fullInput, matchIndex)) {
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

// lib/v1.4/v1.4-lock.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function stableLockPath(runDir) {
  return (0, import_node_path.join)(runDir, "logs", ".lock");
}
function exclusionSentinelPath(runDir) {
  return (0, import_node_path.join)(runDir, "logs", ".lock.exclusion");
}
function initStableLockfile(runDir) {
  const path8 = stableLockPath(runDir);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path8), { recursive: true });
  if ((0, import_node_fs.existsSync)(path8)) return;
  try {
    const fd = (0, import_node_fs.openSync)(path8, "wx");
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

// lib/trace-v2.ts
var crypto = __toESM(require("crypto"));
var SIDECAR_MAX_BYTES = 16 * 1024;
function genSpanId(runId, eventType, ts, actorId) {
  const material = `${runId}|${eventType}|${ts}|${actorId || "main"}`;
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 16);
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function normalizeTokens(raw) {
  if (raw === null || typeof raw !== "object") return void 0;
  const r = raw;
  const out = {};
  const input = num(r["input"]) ?? num(r["input_tokens"]);
  const output = num(r["output"]) ?? num(r["output_tokens"]);
  const cached = num(r["cached"]) ?? num(r["cache_read_input_tokens"]) ?? num(r["cached_tokens"]);
  const cost = num(r["cost_usd"]) ?? num(r["cost"]);
  if (input !== void 0) out.input = input;
  if (output !== void 0) out.output = output;
  if (cached !== void 0) out.cached = cached;
  if (cost !== void 0) out.cost_usd = cost;
  return Object.keys(out).length > 0 ? out : void 0;
}
function envStr(env, key) {
  const v = env[key];
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function resolveTraceV2Fields(opts) {
  const env = opts.env ?? process.env;
  const out = {
    span_id: genSpanId(opts.runId, opts.eventType, opts.ts, opts.actorId)
  };
  const parent = envStr(env, "GUILD_PARENT_SPAN_ID");
  if (parent !== void 0) out.parent_span_id = parent;
  const tier = envStr(env, "GUILD_TIER");
  if (tier !== void 0) out.tier = tier;
  const model = envStr(env, "GUILD_MODEL") ?? opts.payloadModel;
  if (typeof model === "string" && model.length > 0) out.model = model;
  if (opts.tokens !== void 0) out.tokens = opts.tokens;
  if (typeof opts.payloadRef === "string" && opts.payloadRef.length > 0) {
    out.payload_ref = opts.payloadRef;
  }
  return out;
}
function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== void 0) out[k] = v;
  }
  return out;
}

// lib/v1.4/log-jsonl-writer.ts
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
  if (!isSafeLaneId(laneId)) {
    throw new Error(`log-jsonl: invalid lane_id ${JSON.stringify(laneId)}`);
  }
  return (0, import_node_path2.join)(runDir, "logs", `lane-${laneId}-events.jsonl`);
}
var ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
function appendEvent(runDir, event, opts = {}) {
  validateEventIds(event);
  const cap = opts.fieldCap;
  const redacted = redactEventFields(event, cap);
  const withV2 = opts.traceV2 !== void 0 ? { ...redacted, ...pruneUndefined(opts.traceV2) } : redacted;
  const line = JSON.stringify(withV2) + "\n";
  if (opts.forceFallback || process.platform === "win32") {
    const laneId = opts.laneId ?? "global";
    const path8 = laneFallbackPath(runDir, laneId);
    (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(path8), { recursive: true });
    const fd = (0, import_node_fs2.openSync)(path8, "a");
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

// lib/v1.4/log-jsonl-sidecar.ts
var import_node_fs3 = require("node:fs");
var SIDECAR_MAX_BYTES2 = 1024 * 1024;
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
  const path8 = sidecarPath(runDir);
  if (!(0, import_node_fs3.existsSync)(path8)) return null;
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
    const text = (0, import_node_fs3.readFileSync)(path8, "utf8");
    const { match, rest } = apply(text);
    (0, import_node_fs3.writeFileSync)(path8, rest);
    return match;
  }
  return withStableLock(runDir, () => {
    const text = (0, import_node_fs3.readFileSync)(path8, "utf8");
    const { match, rest } = apply(text);
    (0, import_node_fs3.writeFileSync)(path8, rest);
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
  const path8 = sidecarPath(runDir);
  if (!(0, import_node_fs3.existsSync)(path8)) return { orphans: [], events: [] };
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
    const text = (0, import_node_fs3.readFileSync)(path8, "utf8");
    const out = apply(text);
    (0, import_node_fs3.writeFileSync)(path8, out.rest);
    orphans = out.orphans;
  } else {
    orphans = withStableLock(runDir, () => {
      const text = (0, import_node_fs3.readFileSync)(path8, "utf8");
      const out = apply(text);
      (0, import_node_fs3.writeFileSync)(path8, out.rest);
      return out.orphans;
    });
  }
  const events = orphans.map(buildOrphanedToolCall);
  return { orphans, events };
}

// lib/dispatch-attribution.ts
var GENERIC_SUBAGENT_TYPE = "general-purpose";
var DEF_PATH_RE = /^\.guild\/agents\/([A-Za-z0-9._-]+)\.md$/;
var SAFE_ROLE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var ROLE_DEF_ANCHOR_RE = /role definition is at\s*[`'"]?\.guild\/agents\/([A-Za-z0-9._-]+)\.md/i;
var DISPATCH_PROSE_RE = /dispatched as the Guild\s+\*{0,2}([A-Za-z0-9._-]+)\*{0,2}\s+specialist/i;
var DEFINITION_MARKER_RE = /^GUILD_AGENT_DEFINITION=(\S+)$/;
var PRODUCER_MARKER_RE = /^GUILD_DISPATCH_PRODUCER=guild\.dispatch\.v\d+(?:\s+[A-Za-z0-9._-]+=[^\s]+)*\s+role=([A-Za-z0-9._-]+)(?:\s|$)/;
var PRODUCER_HEAD_CHARS = 300;
function safeRole(v) {
  return v !== void 0 && SAFE_ROLE_RE.test(v) ? v : void 0;
}
function envStr2(env, key) {
  const v = env[key];
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function resolveDispatchAttribution(toolInput) {
  if (toolInput === null || typeof toolInput !== "object") return null;
  const ti = toolInput;
  if (!("subagent_type" in ti) && !("prompt" in ti)) return null;
  const subagentType = typeof ti.subagent_type === "string" ? ti.subagent_type : "";
  const prompt = typeof ti.prompt === "string" ? ti.prompt : "";
  const env = ti.env !== null && typeof ti.env === "object" ? ti.env : {};
  const definitionPathRaw = envStr2(env, "GUILD_AGENT_DEFINITION");
  const definitionPath = definitionPathRaw?.trim();
  const taskId = envStr2(env, "GUILD_TASK_ID");
  const specialistEnv = safeRole(envStr2(env, "GUILD_SPECIALIST"));
  const firstLine = (prompt.split("\n", 1)[0] ?? "").trim();
  const markerPath = DEFINITION_MARKER_RE.exec(firstLine)?.[1];
  const markerRole = safeRole(
    markerPath !== void 0 ? DEF_PATH_RE.exec(markerPath)?.[1] : void 0
  );
  const producerMarkerRole = safeRole(PRODUCER_MARKER_RE.exec(firstLine)?.[1]);
  const head = prompt.slice(0, PRODUCER_HEAD_CHARS);
  const anchorRole = safeRole(ROLE_DEF_ANCHOR_RE.exec(head)?.[1]);
  const proseRole = safeRole(DISPATCH_PROSE_RE.exec(head)?.[1]);
  const hasProseSignature = proseRole !== void 0;
  const hasAdoptionPrompt = markerRole !== void 0 || anchorRole !== void 0;
  const defMatch = definitionPath !== void 0 && definitionPath.length > 0 ? DEF_PATH_RE.exec(definitionPath) : null;
  const defRole = safeRole(defMatch?.[1]);
  const hasValidDefinition = defMatch !== null && defRole !== void 0 && (specialistEnv === void 0 || defRole === specialistEnv);
  const roles = [
    specialistEnv,
    defRole,
    markerRole,
    producerMarkerRole,
    anchorRole,
    proseRole
  ].filter((r) => r !== void 0);
  const hasConsistentIdentity = roles.every((r) => r === roles[0]);
  const specialist = specialistEnv ?? defRole ?? markerRole ?? producerMarkerRole ?? anchorRole ?? proseRole;
  const promptTeammate = /teammate for run-id/i.test(head);
  const isComposedLane = taskId !== void 0 && specialistEnv !== void 0;
  const isSpecialistLane = hasAdoptionPrompt || hasProseSignature || isComposedLane;
  const hasLaneSignature = isSpecialistLane || promptTeammate || taskId !== void 0 || specialistEnv !== void 0 || // G3 — the universal producer marker is a lane signature (not adoption proof,
  // so it stays out of isSpecialistLane / the #58 persona-strip predicate).
  producerMarkerRole !== void 0;
  const out = {
    subagentType,
    isGeneric: subagentType === GENERIC_SUBAGENT_TYPE,
    isSpecialistLane,
    hasAdoptionPrompt,
    hasValidDefinition,
    hasConsistentIdentity,
    hasLaneSignature
  };
  if (specialist !== void 0) out.specialist = specialist;
  if (definitionPath !== void 0) out.definitionPath = definitionPath;
  if (taskId !== void 0) out.taskId = taskId;
  return out;
}

// lib/lane-attribution.ts
var UNATTRIBUTED_WORKER_LANE_ID = "unattributed-worker";
function isWorkerInvocation(env = process.env) {
  const laneId = env["GUILD_LANE_ID"];
  const taskId = env["GUILD_TASK_ID"];
  return typeof laneId === "string" && laneId.length > 0 || typeof taskId === "string" && taskId.length > 0;
}
function resolveLaneAttribution(env = process.env) {
  for (const candidate of [env["GUILD_LANE_ID"], env["GUILD_TASK_ID"]]) {
    if (typeof candidate === "string" && candidate.length > 0 && isSafeLaneId(candidate)) {
      return candidate;
    }
  }
  return isWorkerInvocation(env) ? UNATTRIBUTED_WORKER_LANE_ID : void 0;
}

// lib/security/scrubbed-write.ts
var fs4 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
var crypto2 = __toESM(require("node:crypto"));

// lib/security/secrets.ts
function applySecretsPolicy(value, policy, opts) {
  if (typeof value !== "string") {
    return { value: typeof value === "string" ? value : String(value ?? ""), ok: true, failures: [] };
  }
  let out = redactField(value, opts?.noTruncate ? Number.POSITIVE_INFINITY : void 0);
  const failures = [];
  for (const pat of policy.redaction_patterns) {
    let re;
    try {
      re = new RegExp(pat, "g");
    } catch (err) {
      failures.push(`${pat}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    try {
      out = out.replace(re, "[REDACTED]");
    } catch (err) {
      failures.push(`${pat}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { value: out, ok: failures.length === 0, failures };
}

// lib/security/config.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
function securityDefaults() {
  return {
    bypass_permissions_policy: "audit",
    secrets_policy: {
      env_allowlist: [],
      redaction_patterns: [],
      fail_mode_durable: "closed",
      fail_mode_telemetry: "open"
    },
    tool_description_hashes: {},
    mcp_availability: {
      stdio_available: true,
      http_available: false,
      bridge_package: null
    },
    allowed_tools: []
  };
}
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function parseSecurityConfig(parsed) {
  const out = securityDefaults();
  if (!isPlainObject(parsed)) return out;
  if (isPlainObject(parsed["security"])) {
    const bpp = parsed["security"]["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") {
      out.bypass_permissions_policy = bpp;
    }
  }
  if (isPlainObject(parsed["secrets_policy"])) {
    const sp = parsed["secrets_policy"];
    if (isStringArray(sp["env_allowlist"])) out.secrets_policy.env_allowlist = sp["env_allowlist"];
    if (isStringArray(sp["redaction_patterns"])) {
      out.secrets_policy.redaction_patterns = sp["redaction_patterns"];
    }
    if (sp["fail_mode_durable"] === "closed" || sp["fail_mode_durable"] === "open") {
      out.secrets_policy.fail_mode_durable = sp["fail_mode_durable"];
    }
    if (sp["fail_mode_telemetry"] === "open" || sp["fail_mode_telemetry"] === "closed") {
      out.secrets_policy.fail_mode_telemetry = sp["fail_mode_telemetry"];
    }
  }
  if (isPlainObject(parsed["defaults"])) {
    const defs = parsed["defaults"];
    if (isStringArray(defs["allowed_tools"])) {
      out.allowed_tools = defs["allowed_tools"];
    }
  }
  if (isPlainObject(parsed["mcp"])) {
    const mcp = parsed["mcp"];
    if (isPlainObject(mcp["tool_description_hashes"])) {
      const hashes = {};
      for (const [k, v] of Object.entries(mcp["tool_description_hashes"])) {
        if (typeof v === "string") hashes[k] = v;
      }
      out.tool_description_hashes = hashes;
    }
    if (typeof mcp["stdio_available"] === "boolean") {
      out.mcp_availability.stdio_available = mcp["stdio_available"];
    }
    if (typeof mcp["http_available"] === "boolean") {
      out.mcp_availability.http_available = mcp["http_available"];
    }
    if (mcp["bridge_package"] === null || typeof mcp["bridge_package"] === "string") {
      out.mcp_availability.bridge_package = mcp["bridge_package"];
    }
  }
  return out;
}
function readSecurityConfig(cwd) {
  const settingsPath = path2.join(resolveGuildRoot(cwd), ".guild", "settings.json");
  let raw;
  try {
    raw = fs2.readFileSync(settingsPath, "utf8");
  } catch {
    return securityDefaults();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return securityDefaults();
  }
  return parseSecurityConfig(parsed);
}

// lib/security/events.ts
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
var SECURITY_EVENT_SCHEMA_VERSION = "guild.security_event.v1";
var KNOWN_GUILD_HOST_KINDS = [
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
  "claude-code-app",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector"
];
var KNOWN_GUILD_HOST_ID_SET = new Set(KNOWN_GUILD_HOST_KINDS);
var LEGACY_HOST_ALIASES = {
  claude: "claude-code-cli",
  "claude-code-desktop": "claude-code-app",
  codex: "codex-cli",
  "codex-plugin": "codex-cli",
  agents: "agents-file",
  ".agents": "agents-file",
  pi: "pi-cli",
  antigravity: "antigravity-cli",
  "antigravity-2": "antigravity-cli"
};
function normalizeSecurityHostId(value) {
  const s = value.trim();
  if (KNOWN_GUILD_HOST_ID_SET.has(s)) return s;
  return LEGACY_HOST_ALIASES[s] ?? null;
}
function resolveHostResolution(env) {
  const explicit = (env["GUILD_HOST_ID"] ?? "").trim();
  if (explicit.length > 0) return { id: explicit, degraded: false, rawUnknown: "" };
  const rawHost = (env["GUILD_HOST"] ?? "").trim().toLowerCase();
  if (rawHost.length === 0) return { id: "claude-code-cli", degraded: false, rawUnknown: "" };
  const normalized = normalizeSecurityHostId(rawHost);
  if (normalized) return { id: normalized, degraded: false, rawUnknown: "" };
  return { id: rawHost, degraded: true, rawUnknown: rawHost };
}
function resolveHostId() {
  return resolveHostResolution(process.env).id;
}
function buildSecurityEvent(input) {
  const rec = {
    schema_version: SECURITY_EVENT_SCHEMA_VERSION,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    run_id: input.run_id,
    event_type: input.event_type,
    decision: input.decision,
    tool: input.tool,
    detail: redactField(input.detail ?? ""),
    host: typeof input.host === "string" && input.host.length > 0 ? input.host : resolveHostId()
  };
  if (typeof input.lane_id === "string" && input.lane_id.length > 0) rec.lane_id = input.lane_id;
  if (input.policy !== void 0) rec.policy = input.policy;
  if (typeof input.permission_mode === "string" && input.permission_mode.length > 0) {
    rec.permission_mode = input.permission_mode;
  }
  if (typeof input.dispatch_rung === "string" && input.dispatch_rung.length > 0) {
    rec.dispatch_rung = input.dispatch_rung;
  }
  return rec;
}
function appendSecurityEvent(runDir, record) {
  try {
    const logsDir = path3.join(runDir, "logs");
    fs3.mkdirSync(logsDir, { recursive: true });
    fs3.appendFileSync(path3.join(logsDir, "security-events.jsonl"), JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [security-events] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}

// lib/security/scrubbed-write.ts
function guildRootFromRunDir(runDir) {
  return path4.resolve(runDir, "../../..");
}
function writeScrubApprovalRequest(runDir, runId, surface, outPath, laneId) {
  try {
    const approvalDir = path4.join(runDir, "agent-bus", "approvals");
    fs4.mkdirSync(approvalDir, { recursive: true });
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    const safeTs = ts.replace(/[:.]/g, "-");
    const fileName = `${safeTs}-scrub-blocked.json`;
    const record = {
      schema_version: "guild.approval_request.v1",
      ts,
      run_id: runId,
      tool: "scrubbedWrite",
      reason: `Secret scrub failed for durable surface "${surface}" \u2014 write blocked. Human review required. Path: ${path4.basename(outPath)}`,
      permission_mode: "blocked",
      surface
    };
    if (laneId) record["lane_id"] = laneId;
    const rawContent = JSON.stringify(record, null, 2) + "\n";
    let content = rawContent;
    try {
      const secConfig = readSecurityConfig(guildRootFromRunDir(runDir));
      const scrubResult = applySecretsPolicy(rawContent, secConfig.secrets_policy, { noTruncate: true });
      content = scrubResult.value;
    } catch {
    }
    fs4.writeFileSync(path4.join(approvalDir, fileName), content, "utf8");
  } catch {
  }
}
function scrubbedWrite(outPath, content, opts) {
  const guildRoot = guildRootFromRunDir(opts.runDir);
  let policy;
  try {
    const secConfig = readSecurityConfig(guildRoot);
    policy = secConfig.secrets_policy;
  } catch {
    policy = {
      env_allowlist: [],
      redaction_patterns: [],
      fail_mode_durable: "closed",
      fail_mode_telemetry: "open"
    };
  }
  const scrubResult = applySecretsPolicy(content, policy, { noTruncate: true });
  const failMode = opts.surface === "telemetry" ? policy.fail_mode_telemetry : policy.fail_mode_durable;
  if (scrubResult.ok) {
    try {
      fs4.mkdirSync(path4.dirname(outPath), { recursive: true });
      fs4.writeFileSync(outPath, scrubResult.value, "utf8");
    } catch (err) {
      process.stderr.write(
        `[scrubbed-write] ERROR: write failed for surface "${opts.surface}" at ${outPath}: ${err instanceof Error ? err.message : String(err)}
`
      );
      return { written: false, blocked: false };
    }
    const result = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto2.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
    }
    return result;
  }
  if (failMode === "open") {
    process.stderr.write(
      `[scrubbed-write] WARN: secret scrub custom-pattern failure for surface "${opts.surface}" at ${path4.basename(outPath)} \u2014 writing built-in-redacted content (fail-open). Failures: ${scrubResult.failures.join("; ")}
`
    );
    try {
      fs4.mkdirSync(path4.dirname(outPath), { recursive: true });
      fs4.writeFileSync(outPath, scrubResult.value, "utf8");
    } catch (err) {
      process.stderr.write(
        `[scrubbed-write] ERROR: fail-open write failed: ${err instanceof Error ? err.message : String(err)}
`
      );
      return { written: false, blocked: false };
    }
    try {
      const evt = buildSecurityEvent({
        run_id: opts.runId,
        lane_id: opts.laneId,
        event_type: "secret_scrub_blocked",
        decision: "degraded",
        tool: "scrubbedWrite",
        detail: `Secret scrub custom-pattern failure (fail-open) for surface "${opts.surface}" at ${path4.basename(outPath)}. Built-in-redacted content written.`,
        permission_mode: "degraded"
      });
      appendSecurityEvent(opts.runDir, evt);
    } catch {
    }
    const result = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto2.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
    }
    return result;
  }
  process.stderr.write(
    `[scrubbed-write] BLOCKED: secret scrub failed for durable surface "${opts.surface}" at ${outPath} \u2014 file NOT written. Failures: ${scrubResult.failures.join("; ")}
`
  );
  try {
    const evt = buildSecurityEvent({
      run_id: opts.runId,
      lane_id: opts.laneId,
      event_type: "secret_scrub_blocked",
      decision: "blocked",
      tool: "scrubbedWrite",
      detail: `Secret scrub failed for durable surface "${opts.surface}" at ${path4.basename(outPath)} \u2014 write blocked (fail-closed).`,
      permission_mode: "blocked"
    });
    appendSecurityEvent(opts.runDir, evt);
  } catch {
  }
  writeScrubApprovalRequest(opts.runDir, opts.runId, opts.surface, outPath, opts.laneId);
  return { written: false, blocked: true };
}

// lib/heartbeat-write.ts
var fs5 = __toESM(require("node:fs"));
var path6 = __toESM(require("node:path"));

// lib/heartbeat.ts
var path5 = __toESM(require("node:path"));
var DEFAULT_HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1e3;
function heartbeatPath(runDir, specialist) {
  return path5.join(runDir, "in-progress", `${specialist}.json`);
}

// lib/heartbeat-write.ts
var SAFE_PATH_COMPONENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function isSafePathComponent(id) {
  return SAFE_PATH_COMPONENT_RE.test(id) && id !== "." && id !== "..";
}
function writeHeartbeat(runDir, specialist, record) {
  const finalPath = heartbeatPath(runDir, specialist);
  fs5.mkdirSync(path6.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs5.writeFileSync(tmpPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  try {
    fs5.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs5.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
  return finalPath;
}
function writeHeartbeatFromEnv(opts = {}) {
  try {
    const env = opts.env ?? process.env;
    const runId = env["GUILD_RUN_ID"];
    const specialist = env["GUILD_SPECIALIST"];
    if (typeof runId !== "string" || runId.length === 0) {
      return { written: false, path: null, reason: "env-absent" };
    }
    if (typeof specialist !== "string" || specialist.length === 0) {
      return { written: false, path: null, reason: "env-absent" };
    }
    if (!isSafePathComponent(runId) || !isSafePathComponent(specialist)) {
      return { written: false, path: null, reason: "unsafe-id" };
    }
    const envRunDir = env["GUILD_RUN_DIR"];
    const runDir = typeof envRunDir === "string" && envRunDir.length > 0 ? envRunDir : path6.join(
      resolveGuildRoot(opts.cwd ?? process.cwd()),
      ".guild",
      "runs",
      runId
    );
    const step = env["GUILD_STEP"];
    const record = {
      timestamp: opts.now ? opts.now() : (/* @__PURE__ */ new Date()).toISOString(),
      step: typeof step === "string" && step.length > 0 ? step : null,
      last_action: typeof opts.toolName === "string" && opts.toolName.length > 0 ? opts.toolName : null
    };
    const finalPath = writeHeartbeat(runDir, specialist, record);
    return { written: true, path: finalPath, reason: null };
  } catch (err) {
    return {
      written: false,
      path: null,
      reason: `write-failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

// lib/guild-hook-event.ts
async function readHookStdin() {
  return new Promise((resolve4) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve4(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve4(""));
  });
}
function emitClaudeHookEvent(raw) {
  const parsed = JSON.parse(raw.trim());
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  return { ...parsed, host: "claude" };
}

// post-tool-use.ts
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
function classifyGuildScrubSurface(absPath, guildRoot) {
  const rel = path7.relative(guildRoot, absPath);
  const parts = rel.split(path7.sep);
  if (parts[0] === ".guild" && parts[1] === "wiki") return "wiki";
  if (parts[0] === ".guild" && parts[1] === "runs" && parts.length >= 4) {
    if (parts[3] === "review") return "review";
    if (parts[3] === "handoffs") return "handoff";
    if (parts[3] === "provenance.json" && parts.length === 4) return "provenance";
  }
  return null;
}
function runGuildArtifactScrub(payload, guildRoot, runDir, runId, laneId) {
  const effectiveRunId = typeof runId === "string" && runId.length > 0 ? runId : "no-active-run";
  const effectiveRunDir = typeof runDir === "string" && runDir.length > 0 ? runDir : path7.join(guildRoot, ".guild", "runs", effectiveRunId);
  const toolName = payload.tool_name;
  if (toolName !== "Write" && toolName !== "Edit") return;
  const ti = payload.tool_input;
  if (!ti || typeof ti !== "object") return;
  const rawFilePath = ti["file_path"];
  if (typeof rawFilePath !== "string" || rawFilePath.length === 0) return;
  const absPath = path7.isAbsolute(rawFilePath) ? rawFilePath : path7.resolve(guildRoot, rawFilePath);
  const surface = classifyGuildScrubSurface(absPath, guildRoot);
  if (surface === null) return;
  let diskContent;
  try {
    diskContent = fs6.readFileSync(absPath, "utf8");
  } catch {
    return;
  }
  const result = scrubbedWrite(absPath, diskContent, {
    surface,
    runDir: effectiveRunDir,
    runId: effectiveRunId,
    laneId
  });
  if (result.blocked) {
    let quarantineDone = false;
    try {
      fs6.renameSync(absPath, absPath + ".quarantined");
      quarantineDone = true;
    } catch {
    }
    if (!quarantineDone) {
      let canonicalRemoved = false;
      try {
        fs6.writeFileSync(
          absPath,
          `[SCRUB-BLOCKED: ${surface} file content removed by Guild HK-06 secret scrub \u2014 quarantine rename failed, raw destroyed at canonical path]
`,
          "utf8"
        );
        canonicalRemoved = true;
      } catch {
        try {
          fs6.unlinkSync(absPath);
          canonicalRemoved = true;
        } catch {
        }
      }
      if (!canonicalRemoved) {
        process.stderr.write(
          `[CRITICAL] [post-tool-use] HK-06: CANNOT remove raw secret from canonical path "${path7.basename(absPath)}" \u2014 quarantine AND canonical-removal (overwrite+unlink) both failed. Exiting non-zero. Manual remediation required.
`
        );
        try {
          const evt = buildSecurityEvent({
            run_id: effectiveRunId,
            lane_id: laneId,
            event_type: "secret_scrub_blocked",
            decision: "blocked",
            tool: "post-tool-use/hk06-scrub",
            detail: `CRITICAL: Cannot remove raw ${surface} write from canonical path "${path7.basename(absPath)}" \u2014 quarantine AND canonical-removal both failed. Raw secret may persist. Manual remediation required.`,
            permission_mode: "blocked"
          });
          appendSecurityEvent(effectiveRunDir, evt);
        } catch {
        }
        process.exit(1);
      }
      process.stderr.write(
        `warn: [post-tool-use] HK-06: quarantine rename failed but canonical path overwritten/unlinked for ${path7.basename(absPath)}.
`
      );
    }
    process.stderr.write(
      `warn: [post-tool-use] HK-06: ${surface} write BLOCKED by secret scrub at ${path7.basename(absPath)} \u2014 quarantined/removed. secret_scrub_blocked event emitted.
`
    );
  } else if (result.written) {
    process.stderr.write(
      `info: [post-tool-use] HK-06: ${surface} file scrubbed in place: ${path7.basename(absPath)}.
`
    );
  }
}
function readCurrentRunId(guildRoot) {
  const sentinelPath = path7.join(guildRoot, ".guild", "runs", "current-run-id");
  try {
    const value = fs6.readFileSync(sentinelPath, "utf8").trim();
    return value.length > 0 ? value : void 0;
  } catch {
    return void 0;
  }
}
function resolveRunId(guildRoot) {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.length > 0) return envRunId;
  return readCurrentRunId(guildRoot);
}
async function main() {
  const raw = await readHookStdin();
  let payload = {};
  try {
    payload = emitClaudeHookEvent(raw);
  } catch {
    process.stderr.write("warn: [post-tool-use] invalid JSON on stdin; skipping pairing.\n");
    return;
  }
  const toolName = payload.tool_name ?? "";
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const guildRoot = resolveGuildRoot(cwd);
  {
    const hb = writeHeartbeatFromEnv({ toolName: payload.tool_name, cwd });
    if (!hb.written && hb.reason !== null && hb.reason !== "env-absent") {
      process.stderr.write(
        `warn: [post-tool-use] heartbeat write skipped (non-fatal): ${hb.reason}
`
      );
    }
  }
  {
    const earlyRunId = resolveRunId(guildRoot);
    const earlyRunIdSafe = typeof earlyRunId === "string" && earlyRunId.length > 0 && isSafeRunId(earlyRunId) ? earlyRunId : void 0;
    const earlyRunDir = earlyRunIdSafe ? process.env["GUILD_RUN_DIR"] ?? path7.join(guildRoot, ".guild", "runs", earlyRunIdSafe) : void 0;
    const earlyLaneId = resolveLaneAttribution();
    try {
      runGuildArtifactScrub(payload, guildRoot, earlyRunDir, earlyRunIdSafe, earlyLaneId);
    } catch (err) {
      process.stderr.write(
        `warn: [post-tool-use] HK-06 scrub threw (non-fatal): ${err instanceof Error ? err.message : String(err)}
`
      );
    }
  }
  const runId = resolveRunId(guildRoot);
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [post-tool-use] GUILD_RUN_ID unset and current-run-id missing \u2014 falling through (no tool_call emit).\n"
    );
    return;
  }
  if (!isSafeRunId(runId)) {
    process.stderr.write(
      "warn: [post-tool-use] invalid GUILD_RUN_ID/current-run-id \u2014 falling through (no tool_call emit).\n"
    );
    return;
  }
  const runDir = process.env["GUILD_RUN_DIR"] ?? path7.join(guildRoot, ".guild", "runs", runId);
  const rawLaneId = process.env["GUILD_LANE_ID"];
  const laneId = typeof rawLaneId === "string" && rawLaneId.length > 0 && isSafeLaneId(rawLaneId) ? rawLaneId : void 0;
  if (typeof rawLaneId === "string" && rawLaneId.length > 0 && laneId === void 0) {
    process.stderr.write(
      "warn: [post-tool-use] invalid GUILD_LANE_ID \u2014 omitting lane_id.\n"
    );
  }
  const attributionLaneId = resolveLaneAttribution();
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
  if (laneId !== void 0) {
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
        ...attributionLaneId !== void 0 ? { lane_id: attributionLaneId } : {},
        ...typeof payload.duration_ms === "number" ? { latency_ms_override: payload.duration_ms } : {}
      });
    } else {
      event = buildToolCallFromPair(pre, {
        ts_post: tsPost,
        run_id: runId,
        status: isOk(payload),
        result_excerpt_redacted: resultExcerpt(payload)
      });
      if (attributionLaneId !== void 0) {
        event.lane_id = attributionLaneId;
      }
    }
    const isLlmCallTool = toolName === "Agent" || toolName === "Skill";
    const tokens = isLlmCallTool ? normalizeTokens(payload.tokens ?? payload.usage) : void 0;
    const traceV2 = resolveTraceV2Fields({
      runId,
      eventType: "tool_call",
      ts: tsPost,
      actorId: attributionLaneId ?? "main",
      tokens
    });
    if (toolName === "Agent") {
      const attr = resolveDispatchAttribution(payload.tool_input);
      if (attr?.isSpecialistLane === true && attr.specialist !== void 0) {
        traceV2.attribution_specialist = attr.specialist;
      }
    }
    appendEvent(runDir, event, { traceV2 });
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

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

// pre-compact.ts
var pre_compact_exports = {};
__export(pre_compact_exports, {
  main: () => main
});
module.exports = __toCommonJS(pre_compact_exports);
var path3 = __toESM(require("node:path"));

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
  const fs2 = opts.fs ?? realBindingFs();
  const raw = fs2.readFile(runBindingPath(opts.root, opts.run_id));
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

// lib/v1.4/log-jsonl-schema.ts
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
    (_match, key, sep) => `${key}${sep}${KV_REDACTED}`
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
  const path4 = stableLockPath(runDir);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path4), { recursive: true });
  if ((0, import_node_fs.existsSync)(path4)) return;
  try {
    const fd = (0, import_node_fs.openSync)(path4, "wx");
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
    const path4 = laneFallbackPath(runDir, laneId);
    (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(path4), { recursive: true });
    const fd = (0, import_node_fs2.openSync)(path4, "a");
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
var SIDECAR_MAX_BYTES2 = 1024 * 1024;

// pre-compact.ts
async function readStdin() {
  return new Promise((resolve2) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve2(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve2(""));
  });
}
function payloadExcerpt(payload) {
  if (payload === void 0 || payload === null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}
function resolveRunId(guildRoot) {
  const auth = authorizeHookWrite(guildRoot);
  if (auth.ok === false) {
    process.stderr.write(formatBindingRejected("pre-compact", auth));
    return void 0;
  }
  return auth.run_id;
}
async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    if (raw.trim().length > 0) {
      payload = JSON.parse(raw.trim());
    }
  } catch {
    process.stderr.write("warn: [pre-compact] invalid JSON on stdin; emitting bare event.\n");
  }
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const guildRoot = resolveGuildRoot(cwd);
  const runId = resolveRunId(guildRoot);
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [pre-compact] GUILD_RUN_ID unset and current-run-id missing \u2014 falling through (no log emit).\n"
    );
    return;
  }
  const runDir = process.env["GUILD_RUN_DIR"] ?? path3.join(guildRoot, ".guild", "runs", runId);
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const event = {
    ts,
    event: "hook_event",
    run_id: runId,
    hook_name: "PreCompact",
    payload_excerpt_redacted: payloadExcerpt(payload.payload),
    latency_ms: 0,
    status: "ok"
  };
  const traceV2 = resolveTraceV2Fields({
    runId,
    eventType: "hook_event",
    ts,
    actorId: "main"
  });
  try {
    appendEvent(runDir, event, { traceV2 });
  } catch (err) {
    process.stderr.write(
      `warn: [pre-compact] log emit failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
if (process.argv[1] !== void 0 && (process.argv[1].endsWith("pre-compact.ts") || process.argv[1].endsWith("pre-compact.js"))) {
  main().catch((err) => {
    process.stderr.write(
      `fatal: [pre-compact] ${err instanceof Error ? err.message : String(err)}
`
    );
    process.exit(0);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});

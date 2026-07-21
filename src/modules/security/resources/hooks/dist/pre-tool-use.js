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
var fs6 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));

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

// lib/v1.4/log-jsonl-writer.ts
var import_node_path2 = require("node:path");

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
  const path6 = stableLockPath(runDir);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path6), { recursive: true });
  if ((0, import_node_fs.existsSync)(path6)) return;
  try {
    const fd = (0, import_node_fs.openSync)(path6, "wx");
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
var SIDECAR_MAX_BYTES = 16 * 1024;

// lib/v1.4/log-jsonl-writer.ts
function sidecarPath(runDir) {
  return (0, import_node_path2.join)(runDir, "logs", "tool-call-pre.jsonl");
}
var ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;

// lib/v1.4/log-jsonl-sidecar.ts
var import_node_fs2 = require("node:fs");
var import_node_path3 = require("node:path");
var SIDECAR_MAX_BYTES2 = 1024 * 1024;
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
function appendSidecarPre(runDir, entry, opts = {}) {
  validateSidecarEntry(entry);
  const path6 = sidecarPath(runDir);
  (0, import_node_fs2.mkdirSync)((0, import_node_path3.dirname)(path6), { recursive: true });
  const redacted = redactEventFields(entry, opts.fieldCap);
  const line = JSON.stringify(redacted) + "\n";
  const maxBytes = opts.maxBytes ?? SIDECAR_MAX_BYTES2;
  const appendCapped = () => {
    const existing = (0, import_node_fs2.existsSync)(path6) ? (0, import_node_fs2.readFileSync)(path6, "utf8") : "";
    (0, import_node_fs2.writeFileSync)(path6, capSidecarText(existing, line, maxBytes));
  };
  if (process.platform === "win32") {
    appendCapped();
    return;
  }
  withStableLock(runDir, () => {
    appendCapped();
  });
}

// lib/security/config.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
function parseAutonomyMode(v) {
  if (v === "interactive" || v === "autonomous_after_plan_approval" || v === "auto_approve") {
    return v;
  }
  return null;
}
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
var TASK_RUN_AUTONOMY_RE = /^\s*autonomy_policy:\s*["']?(interactive|autonomous_after_plan_approval|auto_approve)["']?\s*$/m;
function readTaskRunAutonomyPolicy(filePath) {
  try {
    const raw = fs2.readFileSync(filePath, "utf8");
    const m = TASK_RUN_AUTONOMY_RE.exec(raw);
    return m ? parseAutonomyMode(m[1]) : null;
  } catch {
    return null;
  }
}
function readSettingsAutoApprove(cwd) {
  try {
    const settingsPath = path2.join(resolveGuildRoot(cwd), ".guild", "settings.json");
    const parsed = JSON.parse(fs2.readFileSync(settingsPath, "utf8"));
    if (!isPlainObject(parsed)) return [];
    const defaults = parsed["defaults"];
    if (!isPlainObject(defaults)) return [];
    const gates = defaults["gates"];
    if (!isPlainObject(gates)) return [];
    const aa = gates["auto_approve"];
    return isStringArray(aa) ? aa : [];
  } catch {
    return [];
  }
}
function resolveRunAutonomyMode(opts) {
  const env = opts.env ?? process.env;
  const fromEnv = parseAutonomyMode(env["GUILD_AUTONOMY_POLICY"]);
  if (fromEnv !== null) return fromEnv;
  const runId = (env["GUILD_RUN_ID"] ?? "").trim();
  const taskId = (env["GUILD_TASK_ID"] ?? "").trim();
  if (runId.length > 0 && taskId.length > 0) {
    const safe = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
    if (safe.test(runId) && safe.test(taskId)) {
      const taskRunPath = path2.join(
        resolveGuildRoot(opts.cwd),
        ".guild",
        "runs",
        runId,
        "task-runs",
        `${taskId}.yaml`
      );
      const fromTaskRun = readTaskRunAutonomyPolicy(taskRunPath);
      if (fromTaskRun !== null) return fromTaskRun;
    }
  }
  if (readSettingsAutoApprove(opts.cwd).length > 0) return "auto_approve";
  return "interactive";
}

// lib/security/scrubbed-write.ts
var fs4 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
var crypto = __toESM(require("node:crypto"));

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
function resolveRunDir(cwd, runId, explicitRunDir) {
  if (typeof explicitRunDir === "string" && explicitRunDir.length > 0) return explicitRunDir;
  return path3.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
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
      result.sha256 = crypto.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
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
      result.sha256 = crypto.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
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

// lib/security/enforce.ts
var fs5 = __toESM(require("node:fs"));
function effectiveBypassPolicy(configured, autonomyMode) {
  if (autonomyMode === "auto_approve" || autonomyMode === "autonomous_after_plan_approval") {
    return { policy: "deny", forced: true, autonomyMode };
  }
  return { policy: configured, forced: false, autonomyMode };
}
function parseRuleArray(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) return { rules: null, invalid: false };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return { rules: parsed, invalid: false };
    }
    return { rules: [], invalid: true };
  } catch {
    return { rules: [], invalid: true };
  }
}
function readScopeContext(env, baseline = []) {
  const cap = parseRuleArray(env["GUILD_CAPABILITY_SCOPE"]);
  if (cap.rules === null && !cap.invalid) return null;
  const autonomy = parseRuleArray(env["GUILD_AUTONOMY_CONTRACT"]);
  return {
    capability: cap.rules ?? [],
    autonomy: autonomy.rules,
    // null ⇒ no mask
    invalid: cap.invalid || autonomy.invalid,
    baseline
  };
}
var ARG_FIELDS = ["command", "file_path", "path", "pattern"];
function toolArgString(toolName, toolInput) {
  if (toolName === "Bash" && toolInput && typeof toolInput === "object") {
    const cmd = toolInput["command"];
    if (typeof cmd === "string") return cmd;
  }
  if (toolInput && typeof toolInput === "object") {
    for (const f of ARG_FIELDS) {
      const v = toolInput[f];
      if (typeof v === "string") return v;
    }
    try {
      return JSON.stringify(toolInput);
    } catch {
      return "";
    }
  }
  if (typeof toolInput === "string") return toolInput;
  return "";
}
function globToRegExp(glob) {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
function ruleMatches(rule, toolName, toolInput) {
  if (rule === "*") return true;
  const open = rule.indexOf("(");
  if (open === -1 || !rule.endsWith(")")) {
    return rule === toolName;
  }
  const name = rule.slice(0, open);
  if (name !== toolName) return false;
  const glob = rule.slice(open + 1, rule.length - 1);
  if (glob === "" || glob === "*") return true;
  try {
    return globToRegExp(glob).test(toolArgString(toolName, toolInput));
  } catch {
    return false;
  }
}
function anyRuleMatches(rules, toolName, toolInput) {
  return rules.some((r) => ruleMatches(r, toolName, toolInput));
}
function isInScope(scope, toolName, toolInput) {
  if (scope.invalid) return false;
  const baseline = scope.baseline ?? [];
  const inEffectiveCapability = anyRuleMatches(scope.capability, toolName, toolInput) || baseline.length > 0 && anyRuleMatches(baseline, toolName, toolInput);
  if (!inEffectiveCapability) return false;
  if (scope.autonomy !== null && !anyRuleMatches(scope.autonomy, toolName, toolInput)) return false;
  return true;
}
function readScopeFile(filePath, baseline = []) {
  let raw;
  try {
    raw = fs5.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { capability: [], autonomy: null, invalid: true, baseline };
  }
  if (!("capability_scope" in parsed)) return null;
  const capArr = parsed.capability_scope;
  const capValid = Array.isArray(capArr) && capArr.every((x) => typeof x === "string");
  const capability = capValid ? capArr : [];
  const capInvalid = !capValid;
  const autonomyArr = parsed.autonomy_contract;
  const autonomyValid = Array.isArray(autonomyArr) && autonomyArr.every((x) => typeof x === "string");
  const autonomy = autonomyValid ? autonomyArr : null;
  return { capability, autonomy, invalid: capInvalid, baseline };
}
function resolveScopeDecision(args) {
  const { scope, toolName, toolInput, policy, permissionMode, policyForced } = args;
  if (isInScope(scope, toolName, toolInput)) {
    return { gate: false, recordedDecision: "pass", eventType: null, reason: "" };
  }
  const underBypass = permissionMode === "bypassPermissions";
  const baseReason = `capability-scope: tool "${toolName}" is outside this lane's effective allow-set (capability_scope AND-masked with autonomy_contract).`;
  if (!underBypass) {
    return {
      gate: true,
      permissionDecision: "ask",
      recordedDecision: "ask",
      eventType: "capability_scope_violation",
      reason: `${baseReason} Confirm this tool call is intentional.`
    };
  }
  switch (policy) {
    case "deny":
      return {
        gate: true,
        permissionDecision: "deny",
        recordedDecision: "deny",
        eventType: "capability_scope_violation",
        reason: policyForced === true ? `${baseReason} bypass_permissions_policy=deny (FORCED by non-interactive autonomy mode \u2014 docs/v2/security.html \xA7bypassPermissions governance) \u2014 hard-blocked under bypassPermissions.` : `${baseReason} bypass_permissions_policy=deny \u2014 hard-blocked under bypassPermissions.`
      };
    case "allow":
      return {
        gate: false,
        recordedDecision: "allow",
        eventType: "bypass_permission_allowed",
        reason: `${baseReason} bypass_permissions_policy=allow \u2014 permitted under bypassPermissions (audited).`
      };
    case "audit":
    default:
      return {
        gate: false,
        recordedDecision: "allow",
        eventType: "capability_scope_violation",
        reason: `${baseReason} bypass_permissions_policy=audit \u2014 permitted under bypassPermissions but recorded.`
      };
  }
}

// lib/security/mcp-hash-pin.ts
var crypto2 = __toESM(require("node:crypto"));
function isMcpTool(toolName) {
  return typeof toolName === "string" && toolName.startsWith("mcp__");
}
function hashDescription(description) {
  return crypto2.createHash("sha256").update(description, "utf8").digest("hex");
}
function verifyMcpDescription(toolName, liveDescription, pins) {
  const pinned = pins[toolName];
  if (typeof pinned !== "string" || pinned.length === 0) return { status: "unpinned" };
  if (typeof liveDescription !== "string") return { status: "unverifiable", pinned };
  const actual = hashDescription(liveDescription);
  return {
    status: actual.toLowerCase() === pinned.toLowerCase() ? "match" : "mismatch",
    pinned,
    actual
  };
}

// lib/dispatch-attribution.ts
var GENERIC_SUBAGENT_TYPE = "general-purpose";
var DEF_PATH_RE = /^\.guild\/agents\/([A-Za-z0-9._-]+)\.md$/;
var SAFE_ROLE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var ROLE_DEF_ANCHOR_RE = /role definition is at\s*[`'"]?\.guild\/agents\/([A-Za-z0-9._-]+)\.md/i;
var DISPATCH_PROSE_RE = /dispatched as the Guild\s+\*{0,2}([A-Za-z0-9._-]+)\*{0,2}\s+specialist/i;
var DEFINITION_MARKER_RE = /^GUILD_AGENT_DEFINITION=(\S+)$/;
var PRODUCER_HEAD_CHARS = 300;
function safeRole(v) {
  return v !== void 0 && SAFE_ROLE_RE.test(v) ? v : void 0;
}
function envStr(env, key) {
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
  const definitionPathRaw = envStr(env, "GUILD_AGENT_DEFINITION");
  const definitionPath = definitionPathRaw?.trim();
  const taskId = envStr(env, "GUILD_TASK_ID");
  const specialistEnv = safeRole(envStr(env, "GUILD_SPECIALIST"));
  const firstLine = (prompt.split("\n", 1)[0] ?? "").trim();
  const markerPath = DEFINITION_MARKER_RE.exec(firstLine)?.[1];
  const markerRole = safeRole(
    markerPath !== void 0 ? DEF_PATH_RE.exec(markerPath)?.[1] : void 0
  );
  const head = prompt.slice(0, PRODUCER_HEAD_CHARS);
  const anchorRole = safeRole(ROLE_DEF_ANCHOR_RE.exec(head)?.[1]);
  const proseRole = safeRole(DISPATCH_PROSE_RE.exec(head)?.[1]);
  const hasProseSignature = proseRole !== void 0;
  const hasAdoptionPrompt = markerRole !== void 0 || anchorRole !== void 0;
  const defMatch = definitionPath !== void 0 && definitionPath.length > 0 ? DEF_PATH_RE.exec(definitionPath) : null;
  const defRole = safeRole(defMatch?.[1]);
  const hasValidDefinition = defMatch !== null && defRole !== void 0 && (specialistEnv === void 0 || defRole === specialistEnv);
  const roles = [specialistEnv, defRole, markerRole, anchorRole, proseRole].filter(
    (r) => r !== void 0
  );
  const hasConsistentIdentity = roles.every((r) => r === roles[0]);
  const specialist = specialistEnv ?? defRole ?? markerRole ?? anchorRole ?? proseRole;
  const promptTeammate = /teammate for run-id/i.test(head);
  const isComposedLane = taskId !== void 0 && specialistEnv !== void 0;
  const isSpecialistLane = hasAdoptionPrompt || hasProseSignature || isComposedLane;
  const hasLaneSignature = isSpecialistLane || promptTeammate || taskId !== void 0 || specialistEnv !== void 0;
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
function dispatchViolations(attr) {
  if (!attr.isGeneric || !attr.isSpecialistLane) return [];
  const out = [];
  if (!attr.hasValidDefinition) out.push("missing_definition");
  if (!attr.hasAdoptionPrompt) out.push("missing_adoption_prompt");
  if (!attr.hasConsistentIdentity) out.push("identity_mismatch");
  return out;
}
function describeViolation(v, role, attr) {
  switch (v) {
    case "missing_definition":
      return `no valid GUILD_AGENT_DEFINITION env` + (attr.definitionPath !== void 0 ? ` (got ${JSON.stringify(attr.definitionPath)}, expected ".guild/agents/${role}.md")` : ` (absent; expected ".guild/agents/${role}.md")`);
    case "missing_adoption_prompt":
      return `the definition-adoption prompt prefix was stripped \u2014 the prompt must begin with the line "GUILD_AGENT_DEFINITION=.guild/agents/${role}.md" so the lane is actually told to adopt its role definition`;
    case "identity_mismatch":
      return `the dispatch's identity carriers disagree about the role (GUILD_SPECIALIST / GUILD_AGENT_DEFINITION / the prompt's adoption marker must all name the SAME specialist) \u2014 the lane would run the wrong persona`;
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

// pre-tool-use.ts
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
  const sentinelPath = path5.join(resolveGuildRoot(cwd), ".guild", "runs", "current-run-id");
  try {
    const value = fs6.readFileSync(sentinelPath, "utf8").trim();
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
function readHostCapability(cwd) {
  const addCandidate = (out, value) => {
    const v = (value ?? "").trim();
    if (v.length > 0 && !out.includes(v)) out.push(v);
  };
  const hostRes = resolveHostResolution(process.env);
  const rawHost = (process.env["GUILD_HOST"] ?? "").trim().toLowerCase();
  const candidates = [];
  addCandidate(candidates, hostRes.id);
  addCandidate(candidates, process.env["GUILD_HOST_ID"]);
  addCandidate(candidates, rawHost);
  const legacyByRegistry = {
    "claude-code-cli": "claude",
    "codex-cli": "codex",
    "pi-cli": "pi",
    "antigravity-cli": "antigravity-2",
    "claude-code-app": "claude-code-desktop"
  };
  addCandidate(candidates, legacyByRegistry[hostRes.id]);
  for (const hostId of candidates) {
    try {
      const manifestPath = path5.join(resolveGuildRoot(cwd), ".guild", "hosts", hostId, "capability.json");
      const raw = fs6.readFileSync(manifestPath, "utf8");
      return JSON.parse(raw);
    } catch {
    }
  }
  return null;
}
function writeApprovalRequest(runDir, opts) {
  try {
    const approvalDir = path5.join(runDir, "agent-bus", "approvals");
    fs6.mkdirSync(approvalDir, { recursive: true });
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    const safeTs = ts.replace(/[:.]/g, "-");
    const fileName = `${safeTs}-${opts.tool.toLowerCase()}.json`;
    const record = {
      schema_version: "guild.approval_request.v1",
      ts,
      run_id: opts.runId,
      tool: opts.tool,
      reason: opts.detail,
      permission_mode: "degraded"
    };
    if (opts.laneId) record["lane_id"] = opts.laneId;
    if (opts.dispatchRung) record["dispatch_rung"] = opts.dispatchRung;
    const content = JSON.stringify(record, null, 2) + "\n";
    scrubbedWrite(path5.join(approvalDir, fileName), content, {
      surface: "bus",
      runDir,
      runId: opts.runId,
      laneId: opts.laneId
    });
  } catch (err) {
    process.stderr.write(
      `warn: [pre-tool-use] approval_request write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
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
  return path5.resolve(absPath).split(path5.sep).includes(".guild");
}
function runBoundaryGuard(payload, cwd, ctx) {
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
  const abs = path5.isAbsolute(filePath) ? filePath : path5.resolve(cwd, filePath);
  if (isInsideGuildDir(abs)) return false;
  const guardReason = `Guild-owned-file boundary (P5-boundary-001): a Guild-signed artifact would be written OUTSIDE the consuming repo's .guild/ (${abs}). Guild-owned files belong under .guild/ (or .guild/agents/proposed/, .guild/skills/proposed-*). Confirm this write is intentional.`;
  const toolName = payload.tool_name ?? "";
  if (ctx !== void 0 && !ctx.hostSupportsAsk) {
    if (ctx.runId !== void 0 && ctx.runDir !== void 0) {
      writeApprovalRequest(ctx.runDir, {
        runId: ctx.runId,
        laneId: ctx.laneId,
        tool: toolName,
        detail: guardReason,
        dispatchRung: ctx.dispatchRung
      });
      appendSecurityEvent(
        ctx.runDir,
        buildSecurityEvent({
          run_id: ctx.runId,
          lane_id: ctx.laneId,
          dispatch_rung: ctx.dispatchRung,
          event_type: "capability_scope_degrade",
          decision: "deny",
          tool: toolName,
          detail: `Host lacks PreToolUse ask \u2014 boundary-guard degraded to file-bus approval_request. ${guardReason}`,
          permission_mode: "degraded"
        })
      );
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Guild security (capability_scope_degrade): host lacks PreToolUse ask. Approval request written to agent-bus/approvals/ (permission_mode: degraded). Original: ${guardReason}`
        }
      })
    );
    return true;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: guardReason
      }
    })
  );
  return true;
}
function readMcpDescription(payload, runDir, toolName) {
  if (typeof payload.tool_description === "string" && payload.tool_description.length > 0) {
    return payload.tool_description;
  }
  if (runDir !== void 0) {
    try {
      const p = path5.join(runDir, "logs", "mcp-tool-descriptions.json");
      const map = JSON.parse(fs6.readFileSync(p, "utf8"));
      const d = map[toolName];
      if (typeof d === "string") return d;
    } catch {
    }
  }
  return void 0;
}
function runSecurityEnforcement(payload, cwd) {
  const sec = readSecurityConfig(cwd);
  const toolName = payload.tool_name ?? "";
  let scope = readScopeContext(process.env, sec.allowed_tools);
  if (scope === null) {
    const envRunId = process.env["GUILD_RUN_ID"];
    const envTaskId = process.env["GUILD_TASK_ID"];
    if (typeof envRunId === "string" && envRunId.length > 0 && typeof envTaskId === "string" && envTaskId.length > 0) {
      const scopeFilePath = path5.join(
        resolveGuildRoot(cwd),
        ".guild",
        "runs",
        envRunId,
        "scope",
        `${envTaskId}.json`
      );
      scope = readScopeFile(scopeFilePath, sec.allowed_tools);
    }
  }
  const mcpPinned = isMcpTool(toolName) && sec.tool_description_hashes[toolName] !== void 0;
  if (scope === null && !mcpPinned) return false;
  const runId = resolveRunId(cwd);
  const runDir = runId !== void 0 ? process.env["GUILD_RUN_DIR"] ?? resolveRunDir(cwd, runId) : void 0;
  const laneEnv = process.env["GUILD_LANE_ID"];
  const laneId = typeof laneEnv === "string" && laneEnv.length > 0 && isSafeLaneId(laneEnv) ? laneEnv : void 0;
  const permissionMode = payload.permission_mode;
  const dispatchRung = (process.env["GUILD_DISPATCH_RUNG"] ?? "").trim() || void 0;
  const hostCap = readHostCapability(cwd);
  const hostSupportsAsk = hostCap?.tool_support?.pre_tool_use_ask !== false;
  const emit = (input) => {
    if (runId === void 0 || runDir === void 0) {
      process.stderr.write(
        `warn: [pre-tool-use] security event '${input.event_type}' not logged (no run id resolvable).
`
      );
      return;
    }
    appendSecurityEvent(
      runDir,
      buildSecurityEvent({
        run_id: runId,
        lane_id: laneId,
        dispatch_rung: dispatchRung,
        ...input
      })
    );
  };
  const gate = (permissionDecision, eventType, reason) => {
    if (permissionDecision === "ask" && !hostSupportsAsk && runId !== void 0 && runDir !== void 0) {
      writeApprovalRequest(runDir, {
        runId,
        laneId,
        tool: toolName,
        detail: reason,
        dispatchRung
      });
      emit({
        event_type: "capability_scope_degrade",
        decision: "deny",
        tool: toolName,
        detail: `Host lacks PreToolUse ask \u2014 degraded to file-bus approval_request. Original: ${reason}`,
        permission_mode: "degraded"
      });
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `Guild security (capability_scope_degrade): host lacks PreToolUse ask. Approval request written to agent-bus/approvals/ (permission_mode: degraded). Original: ${reason}`
          }
        })
      );
      return true;
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision,
          permissionDecisionReason: `Guild security (${eventType}): ${reason}`
        }
      })
    );
    return true;
  };
  const hostRes = resolveHostResolution(process.env);
  if (hostRes.degraded) {
    emit({
      event_type: "capability_scope_degrade",
      decision: "degraded",
      tool: "",
      detail: `Host resolution degraded (HK-10): GUILD_HOST="${hostRes.rawUnknown}" is not a recognized registry host id or alias. Security-event host is preserved as "${hostRes.id}" with degraded attribution. Set GUILD_HOST_ID or use a canonical GUILD_HOST value.`,
      permission_mode: permissionMode
    });
  }
  if (scope !== null) {
    const underBypass = permissionMode === "bypassPermissions";
    const bypass = underBypass ? effectiveBypassPolicy(
      sec.bypass_permissions_policy,
      resolveRunAutonomyMode({ cwd, env: process.env })
    ) : { policy: sec.bypass_permissions_policy, forced: false };
    const d = resolveScopeDecision({
      scope,
      toolName,
      toolInput: payload.tool_input,
      policy: bypass.policy,
      permissionMode,
      policyForced: bypass.forced
    });
    if (d.eventType !== null) {
      emit({
        event_type: d.eventType,
        decision: d.recordedDecision,
        tool: toolName,
        detail: d.reason,
        policy: underBypass ? bypass.policy : void 0,
        permission_mode: permissionMode
      });
    }
    if (d.gate && d.permissionDecision !== void 0) {
      return gate(d.permissionDecision, d.eventType ?? "capability_scope_violation", d.reason);
    }
  }
  if (mcpPinned) {
    const live = readMcpDescription(payload, runDir, toolName);
    const r = verifyMcpDescription(toolName, live, sec.tool_description_hashes);
    if (r.status === "mismatch") {
      const reason = `MCP tool "${toolName}" description hash mismatch (pinned ${r.pinned?.slice(0, 12)}\u2026, live ${r.actual?.slice(0, 12)}\u2026) \u2014 possible description rug-pull (PI-6).`;
      emit({ event_type: "mcp_description_mismatch", decision: "ask", tool: toolName, detail: reason, permission_mode: permissionMode });
      return gate("ask", "mcp_description_mismatch", `${reason} Confirm before allowing.`);
    }
    if (r.status === "unverifiable") {
      emit({
        event_type: "mcp_description_unverifiable",
        decision: "allow",
        tool: toolName,
        detail: `MCP tool "${toolName}" pinned but live description unobtainable \u2014 cannot verify; proceeding.`,
        permission_mode: permissionMode
      });
    }
  }
  return false;
}
function runDispatchIntegrityGuard(payload, cwd) {
  if (payload.tool_name !== "Agent") return false;
  const runId = resolveRunId(cwd);
  if (typeof runId !== "string" || runId.length === 0) return false;
  const attr = resolveDispatchAttribution(payload.tool_input);
  if (attr === null) return false;
  const violations = dispatchViolations(attr);
  if (violations.length === 0) return false;
  const role = attr.specialist ?? "<unknown>";
  const detail = violations.map((v) => describeViolation(v, role, attr)).join("; ");
  const reason = `Guild dispatch integrity (#58): a lane claiming the Guild "${role}" specialist is being dispatched as subagent_type="general-purpose", but ${detail}. The specialist's persona, scoped skills, tool permissions, and TRIGGER/DO-NOT-TRIGGER boundaries would be silently stripped \u2014 a real "${role}" lane and a bare generic agent would be indistinguishable. guild:execute-plan's backend descriptor (composeInProcessDispatch + buildPrompt) sets every required carrier; re-dispatch through it. Blocking this dispatch. [violations: ${violations.join(",")}]`;
  try {
    const runDir = process.env["GUILD_RUN_DIR"] ?? resolveRunDir(cwd, runId);
    const laneEnv = process.env["GUILD_LANE_ID"];
    const laneId = typeof laneEnv === "string" && laneEnv.length > 0 && isSafeLaneId(laneEnv) ? laneEnv : void 0;
    appendSecurityEvent(
      runDir,
      buildSecurityEvent({
        run_id: runId,
        lane_id: laneId,
        event_type: "dispatch_attribution_missing",
        decision: "deny",
        tool: "Agent",
        detail: reason
      })
    );
  } catch {
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason
      }
    })
  );
  return true;
}
async function main() {
  const raw = await readHookStdin();
  let payload = {};
  try {
    payload = emitClaudeHookEvent(raw);
  } catch {
    process.stderr.write("warn: [pre-tool-use] invalid JSON on stdin; skipping.\n");
    return;
  }
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  if (runDispatchIntegrityGuard(payload, cwd)) return;
  if (runSecurityEnforcement(payload, cwd)) return;
  {
    const bgHostCap = readHostCapability(cwd);
    const bgHostSupportsAsk = bgHostCap?.tool_support?.pre_tool_use_ask !== false;
    const bgRunId = resolveRunId(cwd);
    const bgRunDir = bgRunId !== void 0 ? process.env["GUILD_RUN_DIR"] ?? path5.join(resolveGuildRoot(cwd), ".guild", "runs", bgRunId) : void 0;
    const bgLaneEnv = process.env["GUILD_LANE_ID"];
    const bgLaneId = typeof bgLaneEnv === "string" && bgLaneEnv.length > 0 ? bgLaneEnv : void 0;
    const bgDispatchRung = (process.env["GUILD_DISPATCH_RUNG"] ?? "").trim() || void 0;
    if (runBoundaryGuard(payload, cwd, {
      hostSupportsAsk: bgHostSupportsAsk,
      runId: bgRunId,
      runDir: bgRunDir,
      laneId: bgLaneId,
      dispatchRung: bgDispatchRung
    }))
      return;
  }
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
  const runDir = process.env["GUILD_RUN_DIR"] ?? path5.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
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
    fs6.mkdirSync(path5.join(runDir, "logs"), { recursive: true });
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

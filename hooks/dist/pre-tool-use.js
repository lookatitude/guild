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
var fs4 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));

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

// lib/v1.4/log-jsonl.ts
var import_node_fs2 = require("node:fs");
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
  const path5 = stableLockPath(runDir);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path5), { recursive: true });
  if ((0, import_node_fs.existsSync)(path5)) return;
  try {
    const fd = (0, import_node_fs.openSync)(path5, "wx");
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

// lib/v1.4/log-jsonl.ts
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
var SIDECAR_MAX_BYTES2 = 1024 * 1024;
function appendSidecarPre(runDir, entry, opts = {}) {
  validateSidecarEntry(entry);
  const path5 = sidecarPath(runDir);
  (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(path5), { recursive: true });
  const redacted = redactEventFields(entry, opts.fieldCap);
  const line = JSON.stringify(redacted) + "\n";
  const maxBytes = opts.maxBytes ?? SIDECAR_MAX_BYTES2;
  const appendCapped = () => {
    const existing = (0, import_node_fs2.existsSync)(path5) ? (0, import_node_fs2.readFileSync)(path5, "utf8") : "";
    (0, import_node_fs2.writeFileSync)(path5, capSidecarText(existing, line, maxBytes));
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
    tool_description_hashes: {}
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
  if (isPlainObject(parsed["mcp"]) && isPlainObject(parsed["mcp"]["tool_description_hashes"])) {
    const hashes = {};
    for (const [k, v] of Object.entries(parsed["mcp"]["tool_description_hashes"])) {
      if (typeof v === "string") hashes[k] = v;
    }
    out.tool_description_hashes = hashes;
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
function buildSecurityEvent(input) {
  const rec = {
    schema_version: SECURITY_EVENT_SCHEMA_VERSION,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    run_id: input.run_id,
    event_type: input.event_type,
    decision: input.decision,
    tool: input.tool,
    detail: redactField(input.detail ?? "")
  };
  if (typeof input.lane_id === "string" && input.lane_id.length > 0) rec.lane_id = input.lane_id;
  if (input.policy !== void 0) rec.policy = input.policy;
  if (typeof input.permission_mode === "string" && input.permission_mode.length > 0) {
    rec.permission_mode = input.permission_mode;
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

// lib/security/enforce.ts
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
function readScopeContext(env) {
  const cap = parseRuleArray(env["GUILD_CAPABILITY_SCOPE"]);
  if (cap.rules === null && !cap.invalid) return null;
  const autonomy = parseRuleArray(env["GUILD_AUTONOMY_CONTRACT"]);
  return {
    capability: cap.rules ?? [],
    autonomy: autonomy.rules,
    // null ⇒ no mask
    invalid: cap.invalid || autonomy.invalid
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
  if (!anyRuleMatches(scope.capability, toolName, toolInput)) return false;
  if (scope.autonomy !== null && !anyRuleMatches(scope.autonomy, toolName, toolInput)) return false;
  return true;
}
function resolveScopeDecision(args) {
  const { scope, toolName, toolInput, policy, permissionMode } = args;
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
        reason: `${baseReason} bypass_permissions_policy=deny \u2014 hard-blocked under bypassPermissions.`
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
var crypto = __toESM(require("node:crypto"));
function isMcpTool(toolName) {
  return typeof toolName === "string" && toolName.startsWith("mcp__");
}
function hashDescription(description) {
  return crypto.createHash("sha256").update(description, "utf8").digest("hex");
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

// pre-tool-use.ts
async function readStdin() {
  return new Promise((resolve3) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve3(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve3(""));
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
  const sentinelPath = path4.join(resolveGuildRoot(cwd), ".guild", "runs", "current-run-id");
  try {
    const value = fs4.readFileSync(sentinelPath, "utf8").trim();
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
  return path4.resolve(absPath).split(path4.sep).includes(".guild");
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
  const abs = path4.isAbsolute(filePath) ? filePath : path4.resolve(cwd, filePath);
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
function readMcpDescription(payload, runDir, toolName) {
  if (typeof payload.tool_description === "string" && payload.tool_description.length > 0) {
    return payload.tool_description;
  }
  if (runDir !== void 0) {
    try {
      const p = path4.join(runDir, "logs", "mcp-tool-descriptions.json");
      const map = JSON.parse(fs4.readFileSync(p, "utf8"));
      const d = map[toolName];
      if (typeof d === "string") return d;
    } catch {
    }
  }
  return void 0;
}
function runSecurityEnforcement(payload, cwd) {
  const scope = readScopeContext(process.env);
  const toolName = payload.tool_name ?? "";
  const sec = readSecurityConfig(cwd);
  const mcpPinned = isMcpTool(toolName) && sec.tool_description_hashes[toolName] !== void 0;
  if (scope === null && !mcpPinned) return false;
  const runId = resolveRunId(cwd);
  const runDir = runId !== void 0 ? process.env["GUILD_RUN_DIR"] ?? resolveRunDir(cwd, runId) : void 0;
  const laneEnv = process.env["GUILD_LANE_ID"];
  const laneId = typeof laneEnv === "string" && laneEnv.length > 0 && isSafeLaneId(laneEnv) ? laneEnv : void 0;
  const permissionMode = payload.permission_mode;
  const emit = (input) => {
    if (runId === void 0 || runDir === void 0) {
      process.stderr.write(
        `warn: [pre-tool-use] security event '${input.event_type}' not logged (no run id resolvable).
`
      );
      return;
    }
    appendSecurityEvent(runDir, buildSecurityEvent({ run_id: runId, lane_id: laneId, ...input }));
  };
  const gate = (permissionDecision, eventType, reason) => {
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
  if (scope !== null) {
    const d = resolveScopeDecision({
      scope,
      toolName,
      toolInput: payload.tool_input,
      policy: sec.bypass_permissions_policy,
      permissionMode
    });
    if (d.eventType !== null) {
      emit({
        event_type: d.eventType,
        decision: d.recordedDecision,
        tool: toolName,
        detail: d.reason,
        policy: permissionMode === "bypassPermissions" ? sec.bypass_permissions_policy : void 0,
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
  if (runSecurityEnforcement(payload, cwd)) return;
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
  const runDir = process.env["GUILD_RUN_DIR"] ?? path4.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
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
    fs4.mkdirSync(path4.join(runDir, "logs"), { recursive: true });
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

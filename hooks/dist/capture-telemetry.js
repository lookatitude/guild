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

// capture-telemetry.ts
var fs4 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
var crypto = __toESM(require("crypto"));

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

// lib/security/secrets.ts
function applySecretsPolicy(value, policy) {
  if (typeof value !== "string") {
    return { value: typeof value === "string" ? value : String(value ?? ""), ok: true, failures: [] };
  }
  let out = redactField(value);
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
function resolveTelemetryField(scrub, policy) {
  if (scrub.ok) return { value: scrub.value, warn: false };
  if (policy.fail_mode_telemetry === "closed") return { value: void 0, warn: true };
  return { value: scrub.value, warn: true };
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

// capture-telemetry.ts
function digest(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
}
function isOk(payload) {
  const resp = payload.tool_response;
  if (resp === null || resp === void 0) return true;
  if (typeof resp === "object") {
    const r = resp;
    if (r["success"] === false) return false;
    if (typeof r["error"] === "string" && r["error"].length > 0) return false;
  }
  return true;
}
async function readStdin() {
  return new Promise((resolve2) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve2(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve2(""));
  });
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
function resolveRunId(cwd, payload) {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.length > 0) return envRunId;
  const currentRunId = readCurrentRunId(cwd);
  if (currentRunId !== void 0) return currentRunId;
  return payload.session_id ? `run-${payload.session_id}` : `run-session-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`;
}
async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw.trim());
  } catch {
    process.stderr.write("[capture-telemetry] WARN: invalid JSON on stdin; skipping.\n");
    process.exit(0);
  }
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const runId = resolveRunId(cwd, payload);
  const eventName = payload.hook_event_name ?? "PostToolUse";
  const tool = eventName === "SubagentStop" || eventName === "UserPromptSubmit" ? "" : payload.tool_name ?? "";
  const specialist = payload.agent_name ?? "";
  const payloadDigest = digest(
    payload.tool_input ?? payload.stop_reason ?? payload.prompt ?? ""
  );
  const ok = isOk(payload);
  const ms = typeof payload.duration_ms === "number" ? payload.duration_ms : 0;
  const event = {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    event: eventName,
    tool,
    specialist,
    payload_digest: payloadDigest,
    ok,
    ms
  };
  if (typeof payload.model === "string" && payload.model.length > 0) {
    event.model = payload.model;
  }
  if (eventName === "UserPromptSubmit" && typeof payload.prompt === "string") {
    const secPolicy = readSecurityConfig(cwd).secrets_policy;
    const scrub = applySecretsPolicy(payload.prompt, secPolicy);
    const resolved = resolveTelemetryField(scrub, secPolicy);
    if (resolved.value !== void 0) event.prompt = resolved.value;
    if (resolved.warn) {
      process.stderr.write(
        `[capture-telemetry] WARN: secrets_policy redaction_patterns failure on prompt (fail_mode_telemetry=${secPolicy.fail_mode_telemetry}): ${scrub.failures.join("; ")}
`
      );
      try {
        const evRunDir = process.env["GUILD_RUN_DIR"] ?? resolveRunDir(cwd, runId);
        appendSecurityEvent(
          evRunDir,
          buildSecurityEvent({
            run_id: runId,
            event_type: "secret_scrub_failure",
            decision: secPolicy.fail_mode_telemetry === "closed" ? "deny" : "allow",
            tool: "",
            detail: `secrets_policy redaction_patterns failed on telemetry prompt: ${scrub.failures.join("; ")}`
          })
        );
      } catch {
      }
    }
  }
  if (eventName === "loop_round_start" || eventName === "loop_round_end") {
    if (typeof payload.loop_layer === "string") event.loop_layer = payload.loop_layer;
    if (typeof payload.loop_round === "number") event.loop_round = payload.loop_round;
    if (typeof payload.loop_gate === "string") event.loop_gate = payload.loop_gate;
    if (typeof payload.loop_terminated === "boolean") event.loop_terminated = payload.loop_terminated;
  }
  const runsDir = path4.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
  const eventsFile = path4.join(runsDir, "events.ndjson");
  try {
    fs4.mkdirSync(runsDir, { recursive: true });
    fs4.appendFileSync(eventsFile, JSON.stringify(event) + "\n", "utf8");
  } catch (err) {
    process.stderr.write(
      `[capture-telemetry] ERROR: failed to write event: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
main().catch((err) => {
  process.stderr.write(
    `[capture-telemetry] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});

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
var fs5 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var crypto2 = __toESM(require("crypto"));

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

// lib/guild-hook-event.ts
async function readHookStdin() {
  return new Promise((resolve2) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve2(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve2(""));
  });
}
function emitClaudeHookEvent(raw) {
  const parsed = JSON.parse(raw.trim());
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  return { ...parsed, host: "claude" };
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
function resolveTelemetryField(scrub, policy) {
  if (scrub.ok) return { value: scrub.value, warn: false };
  if (policy.fail_mode_telemetry === "closed") return { value: void 0, warn: true };
  return { value: scrub.value, warn: true };
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

// lib/trace-v2.ts
var fs4 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
var crypto = __toESM(require("crypto"));
var TRACE_PAYLOAD_SCHEMA = "guild.trace_payload.v1";
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
var LLM_CALL_EVENTS = /* @__PURE__ */ new Set([
  "SubagentStop",
  "loop_round_start",
  "loop_round_end",
  "codex_review_round",
  "specialist_dispatch",
  "specialist_receipt"
]);
function isLlmCallEvent(eventType) {
  return LLM_CALL_EVENTS.has(eventType);
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
function payloadSidecarPath(runDir, evtId) {
  return path4.join(runDir, "logs", "payloads", `${evtId}.json`);
}
function payloadRef(evtId) {
  return `logs/payloads/${evtId}.json`;
}
function redactDeep(value, redact) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactDeep(v, redact);
    }
    return out;
  }
  return value;
}
function writePayloadSidecar(runDir, evtId, input, redact) {
  try {
    const record = {
      schema_version: TRACE_PAYLOAD_SCHEMA,
      evt_id: evtId,
      span_id: input.spanId,
      run_id: input.runId,
      event: input.eventType,
      ts: input.ts,
      actor_id: input.actorId || "main",
      body: redactDeep(input.body, redact)
    };
    if (input.parentSpanId !== void 0) record["parent_span_id"] = input.parentSpanId;
    let serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, "utf8") > SIDECAR_MAX_BYTES) {
      record["body"] = { truncated: true, reason: "sidecar exceeded SIDECAR_MAX_BYTES" };
      serialized = JSON.stringify(record);
    }
    const file = payloadSidecarPath(runDir, evtId);
    fs4.mkdirSync(path4.dirname(file), { recursive: true });
    fs4.writeFileSync(file, serialized + "\n", "utf8");
    return payloadRef(evtId);
  } catch {
    return void 0;
  }
}

// capture-telemetry.ts
function digest(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return crypto2.createHash("sha256").update(str).digest("hex").slice(0, 12);
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
function readCurrentRunId(cwd) {
  const sentinelPath = path5.join(resolveGuildRoot(cwd), ".guild", "runs", "current-run-id");
  try {
    const value = fs5.readFileSync(sentinelPath, "utf8").trim();
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
  const raw = await readHookStdin();
  let payload = {};
  try {
    payload = emitClaudeHookEvent(raw);
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
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const actorId = specialist || "main";
  const event = {
    ts,
    event: eventName,
    tool,
    specialist,
    payload_digest: payloadDigest,
    ok,
    ms
  };
  const secPolicy = readSecurityConfig(cwd).secrets_policy;
  if (eventName === "UserPromptSubmit" && typeof payload.prompt === "string") {
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
  if (eventName === "loop_round_start" || eventName === "loop_round_end" || eventName === "codex_review_round") {
    if (typeof payload.loop_layer === "string") event.loop_layer = payload.loop_layer;
    if (typeof payload.loop_round === "number") event.loop_round = payload.loop_round;
    if (typeof payload.loop_gate === "string") event.loop_gate = payload.loop_gate;
    if (typeof payload.loop_terminated === "boolean") event.loop_terminated = payload.loop_terminated;
  }
  const runsDir = path5.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
  const redact = (s) => applySecretsPolicy(s, secPolicy).value;
  const spanId = genSpanId(runId, eventName, ts, actorId);
  const body = {};
  if (tool) body["tool"] = tool;
  if (payload.tool_input !== void 0) body["tool_input"] = payload.tool_input;
  if (payload.tool_response !== void 0) body["tool_response"] = payload.tool_response;
  if (typeof payload.stop_reason === "string") body["stop_reason"] = payload.stop_reason;
  if (specialist) body["agent_name"] = specialist;
  if (typeof event.prompt === "string") body["prompt"] = event.prompt;
  if (typeof event.loop_layer === "string") body["loop_layer"] = event.loop_layer;
  if (typeof event.loop_gate === "string") body["loop_gate"] = event.loop_gate;
  let payloadRef2;
  if (Object.keys(body).length > 0) {
    payloadRef2 = writePayloadSidecar(
      runsDir,
      spanId,
      {
        runId,
        spanId,
        eventType: eventName,
        ts,
        actorId,
        parentSpanId: process.env["GUILD_PARENT_SPAN_ID"] || void 0,
        body
      },
      redact
    );
  }
  const tokens = isLlmCallEvent(eventName) ? normalizeTokens(payload.tokens ?? payload.usage) : void 0;
  Object.assign(
    event,
    pruneUndefined(
      resolveTraceV2Fields({
        runId,
        eventType: eventName,
        ts,
        actorId,
        payloadModel: payload.model,
        tokens,
        payloadRef: payloadRef2
      })
    )
  );
  const eventLine = JSON.stringify(event) + "\n";
  const logsDir = path5.join(runsDir, "logs");
  const canonicalFile = path5.join(logsDir, "v1.4-events.jsonl");
  const legacyFile = path5.join(runsDir, "events.ndjson");
  if (eventName !== "PostToolUse") {
    try {
      fs5.mkdirSync(logsDir, { recursive: true });
      fs5.appendFileSync(canonicalFile, eventLine, "utf8");
    } catch (err) {
      process.stderr.write(
        `[capture-telemetry] ERROR: failed to write to canonical log (${canonicalFile}): ${err instanceof Error ? err.message : String(err)}
`
      );
    }
  }
  try {
    fs5.mkdirSync(runsDir, { recursive: true });
    fs5.appendFileSync(legacyFile, eventLine, "utf8");
  } catch (err) {
    process.stderr.write(
      `[capture-telemetry] WARN: mirror write to events.ndjson failed: ${err instanceof Error ? err.message : String(err)}
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

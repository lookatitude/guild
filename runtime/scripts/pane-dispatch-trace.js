#!/usr/bin/env node
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

// scripts/lib/host/pane-dispatch-trace.ts
var pane_dispatch_trace_exports = {};
__export(pane_dispatch_trace_exports, {
  DEFAULT_PANE_DISPATCH_PHASE: () => DEFAULT_PANE_DISPATCH_PHASE,
  PANE_BACKEND_RUNG: () => PANE_BACKEND_RUNG,
  emitPaneDispatchEvents: () => emitPaneDispatchEvents,
  parseCliArgs: () => parseCliArgs,
  parseLaneSpec: () => parseLaneSpec
});
module.exports = __toCommonJS(pane_dispatch_trace_exports);
var path4 = __toESM(require("node:path"));

// src/domains/telemetry/guild-trace-emit.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));

// src/domains/telemetry/guild-trace-events.ts
var ANALYSIS_EVENT_CLASSES = Object.freeze([
  "run_started",
  "run_closed",
  "run_attachment_resolved",
  "config_snapshot_written",
  "prompt_received",
  "prompt_normalized",
  "clarifying_question_asked",
  "implementation_authorized",
  "agent_dispatched",
  "agent_prompt_sent",
  "agent_response_received",
  "agent_handoff_written",
  "knowledge_lookup_started",
  "knowledge_lookup_result",
  "memory_lookup_started",
  "memory_lookup_result",
  "tool_call_started",
  "tool_call_finished",
  "tool_call_denied",
  "tool_call_failed",
  "loop_entered",
  "loop_iteration",
  "loop_exited",
  "loop_cap_hit",
  "phase_entered",
  "phase_concluded",
  "gate_started",
  "gate_concluded",
  "instruction_violation_detected",
  "user_steering_received",
  "correction_applied",
  "repeated_failure_detected",
  "recommendation_created",
  "recommendation_routed",
  "bug_report_prompted"
]);
var GUILD_TRACE_SCHEMA_VERSIONS = Object.freeze([
  "guild.trace.dispatch.v1",
  "guild.trace.recall.v1",
  "guild.trace.recall_decision.v1",
  "guild.trace.config_resolution.v1",
  "guild.trace.security_decision.v1",
  "guild.trace.degradation.v1",
  "guild.trace.model_inspection.v1",
  "guild.trace.analysis.v2"
]);
function validateBase(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const e = ev;
  if (typeof e["schema_version"] !== "string" || e["schema_version"] === "") {
    return { ok: false, reason: "schema_version must be a non-empty string" };
  }
  if (!GUILD_TRACE_SCHEMA_VERSIONS.includes(e["schema_version"])) {
    return { ok: false, reason: `unknown schema_version: ${e["schema_version"]}` };
  }
  if (typeof e["ts"] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e["ts"])) {
    return { ok: false, reason: "ts must be an ISO-8601 timestamp string" };
  }
  if (typeof e["run_id"] !== "string" || e["run_id"] === "") {
    return { ok: false, reason: "run_id must be a non-empty string" };
  }
  if (typeof e["lane_id"] !== "string") {
    return { ok: false, reason: "lane_id must be a string (empty string for lead session)" };
  }
  return { ok: true };
}
var DISPATCH_BACKENDS = ["agent", "cmux", "tmux", "remote", "unknown"];
var RECALL_BRANCHES = ["sqlite", "file-bm25", "fs-scan", "kg-query", "structural", "combined", "empty"];
var SECURITY_OUTCOMES = ["allow", "ask", "deny", "audit", "pass-through"];
var DEGRADATION_SURFACES = ["dispatch", "recall", "config", "hook", "host-capability", "other"];
function validateDispatchEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.dispatch.v1") {
    return { ok: false, reason: `wrong schema_version for dispatch: ${e["schema_version"]}` };
  }
  if (typeof e["specialist"] !== "string" || e["specialist"] === "") {
    return { ok: false, reason: "specialist must be a non-empty string" };
  }
  if (typeof e["phase"] !== "string" || e["phase"] === "") {
    return { ok: false, reason: "phase must be a non-empty string" };
  }
  if (typeof e["task_id"] !== "string" || e["task_id"] === "") {
    return { ok: false, reason: "task_id must be a non-empty string" };
  }
  if (!DISPATCH_BACKENDS.includes(e["backend"])) {
    return { ok: false, reason: `backend must be one of: ${DISPATCH_BACKENDS.join(", ")}` };
  }
  if (typeof e["backend_rung"] !== "number" || e["backend_rung"] < 0 || e["backend_rung"] > 4) {
    return { ok: false, reason: "backend_rung must be a number 0-4" };
  }
  if (typeof e["dispatched_at"] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e["dispatched_at"])) {
    return { ok: false, reason: "dispatched_at must be an ISO-8601 timestamp string" };
  }
  for (const optKey of ["attribution_specialist", "pane_id", "pane_target", "pane_backend"]) {
    if (e[optKey] === void 0) continue;
    if (typeof e[optKey] !== "string" || e[optKey] === "") {
      return { ok: false, reason: `${optKey}, when present, must be a non-empty string` };
    }
  }
  if (e["pane_backend"] !== void 0) {
    if (e["backend"] !== "unknown") {
      return {
        ok: false,
        reason: `pane_backend is only for a surface the backend enum cannot name; it must not accompany backend "${e["backend"]}"`
      };
    }
    if (e["backend_rung"] < 1) {
      return {
        ok: false,
        reason: "pane_backend marks a CONFIRMED dispatch, so backend_rung must be >= 1"
      };
    }
  }
  return { ok: true };
}
function validateRecallEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.recall.v1") {
    return { ok: false, reason: `wrong schema_version for recall: ${e["schema_version"]}` };
  }
  if (typeof e["query"] !== "string" || e["query"] === "") {
    return { ok: false, reason: "query must be a non-empty string" };
  }
  if (!RECALL_BRANCHES.includes(e["branch"])) {
    return { ok: false, reason: `branch must be one of: ${RECALL_BRANCHES.join(", ")}` };
  }
  if (typeof e["chunk_count"] !== "number" || e["chunk_count"] < 0) {
    return { ok: false, reason: "chunk_count must be a non-negative number" };
  }
  if (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0) {
    return { ok: false, reason: "duration_ms must be a non-negative number" };
  }
  if (typeof e["had_quarantine"] !== "boolean") {
    return { ok: false, reason: "had_quarantine must be a boolean" };
  }
  if (typeof e["cwd_redacted"] !== "string") {
    return { ok: false, reason: "cwd_redacted must be a string" };
  }
  return { ok: true };
}
var LANE_OUTCOMES = ["success", "failure", "unknown"];
function validateRecallDecisionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.recall_decision.v1") {
    return { ok: false, reason: `wrong schema_version for recall_decision: ${e["schema_version"]}` };
  }
  if (typeof e["query_hash"] !== "string" || !/^[0-9a-f]{16}$/.test(e["query_hash"])) {
    return { ok: false, reason: "query_hash must be exactly 16 lowercase hex chars (sha256[:16])" };
  }
  if (typeof e["query_preview"] !== "string") {
    return { ok: false, reason: "query_preview must be a string (may be empty)" };
  }
  if (e["query_preview"].length > 60) {
    return { ok: false, reason: "query_preview must be <= 60 chars (no raw-query leak)" };
  }
  if (!RECALL_BRANCHES.includes(e["branch"])) {
    return { ok: false, reason: `branch must be one of: ${RECALL_BRANCHES.join(", ")}` };
  }
  if (typeof e["top_score"] !== "number" || e["top_score"] < 0 || !isFinite(e["top_score"])) {
    return { ok: false, reason: "top_score must be a finite number >= 0" };
  }
  if (typeof e["threshold"] !== "number" || e["threshold"] < 0 || !isFinite(e["threshold"])) {
    return { ok: false, reason: "threshold must be a finite number >= 0" };
  }
  if (typeof e["read_skip_fired"] !== "boolean") {
    return { ok: false, reason: "read_skip_fired must be a boolean" };
  }
  if (typeof e["chunk_count"] !== "number" || e["chunk_count"] < 0) {
    return { ok: false, reason: "chunk_count must be a non-negative number" };
  }
  if (typeof e["scored"] !== "boolean") {
    return { ok: false, reason: "scored must be a boolean" };
  }
  if (!LANE_OUTCOMES.includes(e["lane_outcome"])) {
    return { ok: false, reason: `lane_outcome must be one of: ${LANE_OUTCOMES.join(", ")}` };
  }
  return { ok: true };
}
function validateConfigResolutionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.config_resolution.v1") {
    return { ok: false, reason: `wrong schema_version for config_resolution: ${e["schema_version"]}` };
  }
  if (typeof e["rigor"] !== "string" || e["rigor"] === "") {
    return { ok: false, reason: "rigor must be a non-empty string" };
  }
  if (typeof e["agent_mode"] !== "string" || e["agent_mode"] === "") {
    return { ok: false, reason: "agent_mode must be a non-empty string" };
  }
  if (typeof e["layers"] !== "object" || e["layers"] === null) {
    return { ok: false, reason: "layers must be an object" };
  }
  const layers = e["layers"];
  for (const boolKey of ["workspace", "workspace_local", "project", "project_local", "cli"]) {
    if (typeof layers[boolKey] !== "boolean") {
      return { ok: false, reason: `layers.${boolKey} must be a boolean` };
    }
  }
  if (layers["rigor"] !== null && typeof layers["rigor"] !== "string") {
    return { ok: false, reason: "layers.rigor must be a string or null" };
  }
  if (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0) {
    return { ok: false, reason: "duration_ms must be a non-negative number" };
  }
  if (typeof e["config_fingerprint"] !== "string" || e["config_fingerprint"] === "") {
    return { ok: false, reason: "config_fingerprint must be a non-empty string" };
  }
  return { ok: true };
}
function validateSecurityDecisionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.security_decision.v1") {
    return { ok: false, reason: `wrong schema_version for security_decision: ${e["schema_version"]}` };
  }
  if (typeof e["tool_name"] !== "string" || e["tool_name"] === "") {
    return { ok: false, reason: "tool_name must be a non-empty string" };
  }
  if (!SECURITY_OUTCOMES.includes(e["decision"])) {
    return { ok: false, reason: `decision must be one of: ${SECURITY_OUTCOMES.join(", ")}` };
  }
  if (typeof e["bypass_mode"] !== "boolean") {
    return { ok: false, reason: "bypass_mode must be a boolean" };
  }
  if (typeof e["policy_forced"] !== "boolean") {
    return { ok: false, reason: "policy_forced must be a boolean" };
  }
  if (typeof e["autonomy_mode"] !== "string" || e["autonomy_mode"] === "") {
    return { ok: false, reason: "autonomy_mode must be a non-empty string" };
  }
  if (!["env", "file", "none"].includes(e["scope_source"])) {
    return { ok: false, reason: "scope_source must be 'env', 'file', or 'none'" };
  }
  return { ok: true };
}
function validateDegradationEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.degradation.v1") {
    return { ok: false, reason: `wrong schema_version for degradation: ${e["schema_version"]}` };
  }
  if (!DEGRADATION_SURFACES.includes(e["surface"])) {
    return { ok: false, reason: `surface must be one of: ${DEGRADATION_SURFACES.join(", ")}` };
  }
  if (typeof e["reason"] !== "string" || e["reason"] === "") {
    return { ok: false, reason: "reason must be a non-empty string" };
  }
  if (typeof e["attempted"] !== "string" || e["attempted"] === "") {
    return { ok: false, reason: "attempted must be a non-empty string" };
  }
  if (typeof e["fallback"] !== "string" || e["fallback"] === "") {
    return { ok: false, reason: "fallback must be a non-empty string" };
  }
  if (!["warn", "error"].includes(e["severity"])) {
    return { ok: false, reason: "severity must be 'warn' or 'error'" };
  }
  return { ok: true };
}
function validateModelInspectionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.model_inspection.v1") {
    return { ok: false, reason: `wrong schema_version for model_inspection: ${e["schema_version"]}` };
  }
  for (const key of ["host_family", "host_surface", "identity_trust", "catalog_state", "actual_model", "independence"]) {
    if (typeof e[key] !== "string" || e[key] === "") {
      return { ok: false, reason: `${key} must be a non-empty string` };
    }
  }
  if (e["selection_model"] !== null && (typeof e["selection_model"] !== "string" || e["selection_model"] === "")) {
    return { ok: false, reason: "selection_model must be a non-empty string or null" };
  }
  if (typeof e["unknowns_count"] !== "number" || e["unknowns_count"] < 0 || !Number.isInteger(e["unknowns_count"])) {
    return { ok: false, reason: "unknowns_count must be a non-negative integer" };
  }
  return { ok: true };
}
function validateAnalysisTraceEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.analysis.v2") {
    return { ok: false, reason: `wrong schema_version for analysis trace: ${e["schema_version"]}` };
  }
  if (!ANALYSIS_EVENT_CLASSES.includes(e["event_class"])) {
    return { ok: false, reason: `unknown analysis event_class: ${e["event_class"]}` };
  }
  if (!["lead", "agent", "user", "tool", "system"].includes(e["actor_type"])) {
    return { ok: false, reason: "actor_type must be lead|agent|user|tool|system" };
  }
  if (typeof e["actor_id"] !== "string" || e["actor_id"] === "") {
    return { ok: false, reason: "actor_id must be a non-empty string" };
  }
  if (!["ok", "error", "denied", "incomplete", "unknown"].includes(e["status"])) {
    return { ok: false, reason: "status must be ok|error|denied|incomplete|unknown" };
  }
  const allowedKeys = /* @__PURE__ */ new Set([
    "schema_version",
    "ts",
    "run_id",
    "lane_id",
    "event_class",
    "actor_type",
    "actor_id",
    "status",
    "span_id",
    "parent_span_id",
    "phase",
    "task_id",
    "initiative_id",
    "run_scope",
    "prompt_hash",
    "payload_ref",
    "redaction",
    "duration_ms",
    "tokens",
    "config_snapshot_ref",
    "signature"
  ]);
  for (const key of Object.keys(e)) {
    if (!allowedKeys.has(key)) return { ok: false, reason: `unknown analysis field: ${key}` };
  }
  if (e["run_scope"] !== void 0 && !["initiative", "independent"].includes(e["run_scope"])) {
    return { ok: false, reason: "run_scope must be initiative|independent when present" };
  }
  if (e["duration_ms"] !== void 0 && (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0)) {
    return { ok: false, reason: "duration_ms must be a non-negative number when present" };
  }
  for (const key of ["span_id", "parent_span_id", "phase", "task_id", "initiative_id", "prompt_hash", "payload_ref", "config_snapshot_ref", "signature"]) {
    if (e[key] !== void 0 && (typeof e[key] !== "string" || e[key] === "")) {
      return { ok: false, reason: `${key} must be a non-empty string when present` };
    }
  }
  if (e["redaction"] !== void 0 && !["none", "redacted", "omitted"].includes(e["redaction"])) {
    return { ok: false, reason: "redaction must be none|redacted|omitted when present" };
  }
  if (e["tokens"] !== void 0) {
    if (typeof e["tokens"] !== "object" || e["tokens"] === null || Array.isArray(e["tokens"])) {
      return { ok: false, reason: "tokens must be an object when present" };
    }
    for (const [key, value] of Object.entries(e["tokens"])) {
      if (!["input", "output", "cached", "cost_usd"].includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return { ok: false, reason: `tokens.${key} must be a non-negative finite number` };
      }
    }
  }
  const eventClass = e["event_class"];
  if (eventClass === "run_started" && e["run_scope"] === void 0) {
    return { ok: false, reason: "run_started requires run_scope" };
  }
  if (eventClass === "run_attachment_resolved" && (e["run_scope"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: "run_attachment_resolved requires run_scope and signature" };
  }
  if (eventClass === "config_snapshot_written" && e["config_snapshot_ref"] === void 0 && e["payload_ref"] === void 0) {
    return { ok: false, reason: "config_snapshot_written requires config_snapshot_ref or payload_ref" };
  }
  const promptClasses = ["prompt_received", "prompt_normalized", "clarifying_question_asked", "agent_prompt_sent"];
  if (promptClasses.includes(eventClass) && (e["prompt_hash"] === void 0 || e["redaction"] === void 0 || e["span_id"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires prompt_hash, redaction, and span_id` };
  }
  if ((eventClass.startsWith("knowledge_lookup_") || eventClass.startsWith("memory_lookup_")) && (e["span_id"] === void 0 || e["prompt_hash"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and prompt_hash` };
  }
  if (eventClass.startsWith("tool_call_") && e["span_id"] === void 0) {
    return { ok: false, reason: `${eventClass} requires span_id` };
  }
  if (["tool_call_finished", "tool_call_failed"].includes(eventClass) && e["duration_ms"] === void 0) {
    return { ok: false, reason: `${eventClass} requires duration_ms` };
  }
  if (["agent_dispatched", "agent_prompt_sent", "agent_handoff_written"].includes(eventClass) && (e["task_id"] === void 0 || e["span_id"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires task_id and span_id` };
  }
  if (eventClass === "agent_handoff_written" && e["payload_ref"] === void 0) {
    return { ok: false, reason: "agent_handoff_written requires payload_ref" };
  }
  if (eventClass === "agent_response_received" && e["span_id"] === void 0) {
    return { ok: false, reason: "agent_response_received requires span_id" };
  }
  if (eventClass.startsWith("loop_") && (e["span_id"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and signature` };
  }
  if (eventClass.startsWith("phase_") && (e["span_id"] === void 0 || e["phase"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and phase` };
  }
  if (eventClass.startsWith("gate_") && (e["span_id"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and signature` };
  }
  const evidenceClasses = [
    "instruction_violation_detected",
    "user_steering_received",
    "correction_applied",
    "repeated_failure_detected",
    "recommendation_created",
    "recommendation_routed",
    "bug_report_prompted"
  ];
  if (evidenceClasses.includes(eventClass) && (e["span_id"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and signature` };
  }
  return { ok: true };
}
function validateGuildTraceEvent(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const sv = ev["schema_version"];
  switch (sv) {
    case "guild.trace.analysis.v2":
      return validateAnalysisTraceEvent(ev);
    case "guild.trace.model_inspection.v1":
      return validateModelInspectionEvent(ev);
    case "guild.trace.dispatch.v1":
      return validateDispatchEvent(ev);
    case "guild.trace.recall.v1":
      return validateRecallEvent(ev);
    case "guild.trace.recall_decision.v1":
      return validateRecallDecisionEvent(ev);
    case "guild.trace.config_resolution.v1":
      return validateConfigResolutionEvent(ev);
    case "guild.trace.security_decision.v1":
      return validateSecurityDecisionEvent(ev);
    case "guild.trace.degradation.v1":
      return validateDegradationEvent(ev);
    default:
      return { ok: false, reason: `unknown schema_version: ${sv}` };
  }
}
function makeDispatchEvent(fields) {
  return { schema_version: "guild.trace.dispatch.v1", ...fields };
}

// src/domains/telemetry/guild-trace-emit.ts
function liveLogPath(runDir) {
  return path.join(runDir, "logs", "v1.4-events.jsonl");
}
function emitTraceEvent(event, runDir) {
  if (!runDir) return false;
  const validationResult = validateGuildTraceEvent(event);
  if (!validationResult.ok) {
    const schemaVersion = event["schema_version"];
    const failResult = validationResult;
    process.stderr.write(
      `[guild-trace-emit] WARN: dropping invalid trace event (${schemaVersion}): ${failResult.reason}
`
    );
    return false;
  }
  try {
    const live = liveLogPath(runDir);
    const dir = path.dirname(live);
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(event) + "\n";
    fs.appendFileSync(live, line, "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `[guild-trace-emit] WARN: could not write trace event to ${runDir}/logs/v1.4-events.jsonl: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}

// scripts/lib/guild-trace-emit.ts
var emitTraceEvent2 = emitTraceEvent;

// scripts/lib/guild-trace-events.ts
var makeDispatchEvent2 = makeDispatchEvent;

// scripts/lib/state/ensure-storage-layout.ts
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));

// src/domains/state/guild-root.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
function resolveGuildRoot(startDir) {
  const resolvedStart = path2.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs2.existsSync(path2.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path2.join(current, ".guild");
      try {
        if (fs2.existsSync(guildDir) && fs2.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path2.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}

// scripts/lib/state/ensure-storage-layout.ts
var CURRENT_LAYOUT_VERSION = 2;
function markerPath(root) {
  return path3.join(root, ".guild", "storage-layout.json");
}
function detect(cwd = process.cwd()) {
  const root = resolveGuildRoot(cwd);
  const marker = markerPath(root);
  if (!fs3.existsSync(path3.join(root, ".guild"))) {
    return { state: "absent", version: null, root, marker };
  }
  let version = null;
  try {
    const parsed = JSON.parse(fs3.readFileSync(marker, "utf8"));
    if (typeof parsed.storage_layout_version === "number") version = parsed.storage_layout_version;
  } catch {
    version = null;
  }
  if (version === null) return { state: "unmarked", version, root, marker };
  if (version === CURRENT_LAYOUT_VERSION) return { state: "current", version, root, marker };
  return { state: version > CURRENT_LAYOUT_VERSION ? "future" : "stale", version, root, marker };
}
var upgradeChunk = null;
function upgradeChain() {
  if (upgradeChunk === null) {
    const candidates = [
      path3.join(__dirname, "upgrade-chain.js"),
      path3.join(__dirname, "lib", "state", "upgrade-chain"),
      path3.join(__dirname, "upgrade-chain")
    ];
    const spec = candidates.find((c) => fs3.existsSync(c) || fs3.existsSync(`${c}.ts`)) ?? candidates[2];
    upgradeChunk = require(spec);
  }
  return upgradeChunk;
}
function ensureStorageLayout(cwd = process.cwd(), opts = {}) {
  const status = detect(cwd);
  if (status.state === "current") return status;
  if (status.state === "future") {
    throw new Error(
      `guild: .guild/ is layout ${status.version}, this build understands ${CURRENT_LAYOUT_VERSION}. Upgrade Guild; a newer layout is never down-migrated (${status.marker}).`
    );
  }
  if (status.state === "absent" || opts.detectOnly === true) return status;
  const chain = upgradeChain();
  const result = chain.runLayoutUpgrade({
    root: status.root,
    fromVersion: status.version,
    toVersion: CURRENT_LAYOUT_VERSION,
    dryRun: opts.dryRun === true
  });
  const after = detect(cwd);
  return { ...after, upgrade: result };
}
function isProcessEntry() {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry === "") return false;
  return /(^|[\\/])ensure-storage-layout(\.[cm]?[jt]s)?$/.test(entry);
}
if (isProcessEntry()) {
  const cwdArg = process.argv.find((a) => a.startsWith("--cwd="));
  const cwd = cwdArg ? cwdArg.slice("--cwd=".length) : process.cwd();
  try {
    const status = ensureStorageLayout(cwd, {
      dryRun: process.argv.includes("--dry-run"),
      detectOnly: process.argv.includes("--detect-only")
    });
    if (process.argv.includes("--print")) {
      process.stdout.write(JSON.stringify(status) + "\n");
    } else if (status.upgrade && status.upgrade.state !== "committed") {
      process.stderr.write(`${status.upgrade.report}
`);
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(`${e.message}
`);
    process.exit(1);
  }
}

// scripts/lib/host/pane-dispatch-trace.ts
var PANE_BACKEND_RUNG = 1;
var DEFAULT_PANE_DISPATCH_PHASE = "execute";
var EVENTS_RELPATH = path4.join("logs", "v1.4-events.jsonl");
var SURFACE_TO_BACKEND = {
  tmux: "tmux",
  cmux: "cmux",
  remote: "remote",
  agent: "agent"
};
function emitPaneDispatchEvents(opts) {
  try {
    if (!opts.runId || opts.lanes.length === 0) return 0;
    const env = opts.env ?? process.env;
    const phaseFromEnv = env["GUILD_PHASE"];
    const phase = opts.phase ?? (typeof phaseFromEnv === "string" && phaseFromEnv.length > 0 ? phaseFromEnv : DEFAULT_PANE_DISPATCH_PHASE);
    const surface = opts.surface ?? "tmux";
    const backend = SURFACE_TO_BACKEND[surface] ?? "unknown";
    const paneBackend = surface !== backend ? surface : void 0;
    const runDir = path4.join(opts.cwd, ".guild", "runs", opts.runId);
    const now = opts.now ?? (() => /* @__PURE__ */ new Date());
    let emitted = 0;
    for (const lane of opts.lanes) {
      const specialist = lane.specialist;
      if (!specialist) continue;
      const taskId = lane.taskId && lane.taskId.length > 0 ? lane.taskId : specialist;
      const ts = now().toISOString();
      const ok = emitTraceEvent2(
        makeDispatchEvent2({
          ts,
          run_id: opts.runId,
          lane_id: taskId,
          specialist,
          phase,
          task_id: taskId,
          backend,
          backend_rung: PANE_BACKEND_RUNG,
          dispatched_at: ts,
          // #58 parity — same field name the Agent-tool path stamps.
          attribution_specialist: specialist,
          ...lane.paneId && lane.paneId.length > 0 ? { pane_id: lane.paneId } : {},
          ...opts.target && opts.target.length > 0 ? { pane_target: opts.target } : {},
          ...paneBackend ? { pane_backend: paneBackend } : {}
        }),
        runDir
      );
      if (ok) emitted++;
    }
    return emitted;
  } catch {
    return 0;
  }
}
function parseLaneSpec(raw) {
  const parts = raw.split(":");
  const specialist = (parts[0] ?? "").trim();
  if (!specialist) return null;
  const lane = { specialist };
  const taskId = (parts[1] ?? "").trim();
  if (taskId) lane.taskId = taskId;
  const paneId = (parts[2] ?? "").trim();
  if (paneId) lane.paneId = paneId;
  return lane;
}
var CLI_SURFACES = Object.keys(SURFACE_TO_BACKEND);
function parseCliArgs(argv) {
  let cwd = ".";
  let runId = "";
  let target = "";
  let surface = "cmux";
  let phase;
  const lanes = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
    else if (a === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (a === "--target" && i + 1 < argv.length) target = argv[++i];
    else if (a === "--backend" && i + 1 < argv.length) surface = argv[++i];
    else if (a === "--phase" && i + 1 < argv.length) phase = argv[++i];
    else if (a === "--lane" && i + 1 < argv.length) {
      const lane = parseLaneSpec(argv[++i]);
      if (!lane) return { error: `--lane needs a specialist name: got "${argv[i]}"` };
      lanes.push(lane);
    } else return { error: `unknown or incomplete argument: ${a}` };
  }
  if (!runId) return { error: "--run-id <id> is required (the ORCHESTRATING run)" };
  if (lanes.length === 0) return { error: "at least one --lane <specialist>[:<task-id>[:<pane-id>]] is required" };
  if (!CLI_SURFACES.includes(surface)) {
    return { error: `--backend must be one of: ${CLI_SURFACES.join(", ")}` };
  }
  return { cwd, runId, target, surface, phase, lanes };
}
var USAGE = "Usage: npx tsx scripts/lib/host/pane-dispatch-trace.ts \\\n         --run-id <orchestrating-run-id> [--cwd <repo-root>] \\\n         [--target <session-or-workspace>] [--backend cmux|tmux|remote|agent] \\\n         [--phase <phase>] --lane <specialist>[:<task-id>[:<pane-id>]] ...\n";
if (require.main === module && /^pane-dispatch-trace\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  ensureStorageLayout(process.cwd(), { detectOnly: true });
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`[pane-dispatch-trace] ERROR: ${parsed.error}
${USAGE}`);
    process.exit(1);
  }
  const emitted = emitPaneDispatchEvents({
    cwd: path4.resolve(parsed.cwd),
    runId: parsed.runId,
    target: parsed.target,
    surface: parsed.surface,
    phase: parsed.phase,
    lanes: parsed.lanes
  });
  process.stdout.write(
    `[pane-dispatch-trace] recorded ${emitted}/${parsed.lanes.length} ${parsed.surface} dispatch receipt(s) \u2192 .guild/runs/${parsed.runId}/${EVENTS_RELPATH}
`
  );
  process.exit(emitted === parsed.lanes.length ? 0 : 1);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_PANE_DISPATCH_PHASE,
  PANE_BACKEND_RUNG,
  emitPaneDispatchEvents,
  parseCliArgs,
  parseLaneSpec
});

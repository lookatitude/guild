/**
 * Module-owned closed-shape validators used during run-start preflight.
 *
 * The host CLI consumes the same public API; this file must never re-export a
 * generated resource mirror because doing so reverses module ownership.
 */
import { normalizeHostId } from "../../host-runtime";

const MODEL_KEYS = new Set([
  "enabled", "tiers", "scoreWeights", "thresholds", "advisorRounds",
  "escalationMarkers", "recallBeforeRead", "recallScoreThreshold",
  "structuredOutputRequired", "cacheTTL", "importanceGate",
  "compositeRecall", "importanceAtIngest", "ingestSimilarityGate",
  "shortOutputThreshold", "knowledge",
]);
const SECURITY_KEYS = new Set(["bypass_permissions_policy"]);
const SECRETS_KEYS = new Set([
  "env_allowlist", "redaction_patterns", "fail_mode_durable", "fail_mode_telemetry",
]);
const MCP_KEYS = new Set([
  "tool_description_hashes", "stdio_available", "http_available", "bridge_package",
]);
const DEFAULT_KEYS = new Set([
  "auto_learn", "adversarial", "team", "review_workflow", "skill_policy",
  "gates", "wiki", "quality", "reporting", "index", "cross_host", "retry",
  "resume", "heartbeat_timeout_ms", "capability_manifest_ttl_s", "update",
  "allowed_tools", "lean_lead", "lifecycle_gate",
]);
const INDEX_KEYS = new Set([
  "enabled", "kg_node_threshold", "kg_size_threshold_mb", "links_edge_threshold",
  "runs_threshold", "wiki_file_threshold",
]);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string
): string[] {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `unknown ${label} key "${key}" (closed key set)`);
}

export function validateModels(models: Record<string, unknown>): string[] {
  const rejects = rejectUnknown(models, MODEL_KEYS, "models");
  const tiers = models["tiers"];
  if (object(tiers)) {
    const tierKeys = new Set(["cheap", "mid", "powerful"]);
    const specKeys = new Set(["model", "effort", "reasoning", "thinking", "verbosity"]);
    for (const [tier, rawHosts] of Object.entries(tiers)) {
      if (!tierKeys.has(tier)) {
        rejects.push(`unknown models.tiers key "${tier}" (valid: cheap|mid|powerful)`);
        continue;
      }
      if (!object(rawHosts)) continue;
      const canonical = new Map<string, string>();
      for (const [host, value] of Object.entries(rawHosts)) {
        const hostId = normalizeHostId(host);
        if (!hostId) {
          rejects.push(`unknown models.tiers.${tier} host key "${host}" (closed key set)`);
          continue;
        }
        const prior = canonical.get(hostId);
        if (prior && prior !== host) {
          rejects.push(
            `duplicate models.tiers.${tier} host keys "${prior}" and "${host}" both normalize to "${hostId}"`
          );
          continue;
        }
        canonical.set(hostId, host);
        if (value === null || typeof value === "string") continue;
        if (!object(value)) {
          rejects.push(
            `models.tiers.${tier}.${host} must be a string, null, or {model, effort?, reasoning?, thinking?, verbosity?}`
          );
          continue;
        }
        for (const key of Object.keys(value)) {
          if (!specKeys.has(key)) {
            rejects.push(`unknown models.tiers.${tier}.${host} key "${key}" (object form is a closed key set)`);
          }
        }
        if (typeof value["model"] !== "string" || !value["model"].trim()) {
          rejects.push(`models.tiers.${tier}.${host}.model is required and must be a non-empty string in the object form`);
        }
        for (const key of ["effort", "reasoning", "thinking", "verbosity"]) {
          if (value[key] !== undefined && typeof value[key] !== "string") {
            rejects.push(`models.tiers.${tier}.${host}.${key} must be a string (got ${JSON.stringify(value[key])})`);
          }
        }
      }
    }
  }
  if (object(models["thresholds"])) {
    for (const key of Object.keys(models["thresholds"])) {
      if (key !== "mid" && key !== "powerful") rejects.push(`unknown models.thresholds key "${key}" — only mid and powerful are valid`);
    }
  }
  if (object(models["cacheTTL"])) {
    const ttl = models["cacheTTL"];
    for (const key of Object.keys(ttl)) {
      if (key !== "coordinator" && key !== "leaf") rejects.push(`unknown models.cacheTTL key "${key}" — only coordinator and leaf are valid`);
    }
    for (const key of ["coordinator", "leaf"]) {
      if (ttl[key] !== undefined && !["1h", "5m", "off"].includes(String(ttl[key]))) {
        rejects.push(`models.cacheTTL.${key} "${ttl[key]}" is invalid — valid: 1h|5m|off`);
      }
    }
  }
  const integerRange = (key: string, min: number, max?: number): void => {
    const value = models[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < min || (max !== undefined && value > max))) {
      rejects.push(`models.${key} must be an integer ${min}${max === undefined ? "+" : `–${max}`} (got ${JSON.stringify(value)})`);
    }
  };
  integerRange("importanceGate", 1, 5);
  integerRange("advisorRounds", 1);
  for (const key of ["compositeRecall", "importanceAtIngest"]) {
    if (models[key] !== undefined && typeof models[key] !== "boolean") {
      rejects.push(`models.${key} must be a boolean (got ${JSON.stringify(models[key])})`);
    }
  }
  for (const key of ["recallScoreThreshold", "ingestSimilarityGate"]) {
    const value = models[key];
    if (value !== undefined && (typeof value !== "number" || value < 0 || value > 1)) {
      rejects.push(`models.${key} must be a float 0–1 (got ${JSON.stringify(value)})`);
    }
  }
  return rejects;
}

export function validateSecurity(value: Record<string, unknown>): string[] {
  const rejects = rejectUnknown(value, SECURITY_KEYS, "security");
  const policy = value["bypass_permissions_policy"];
  if (policy !== undefined && !["deny", "audit", "allow"].includes(String(policy))) {
    rejects.push(`security.bypass_permissions_policy "${policy}" is invalid — valid: deny|audit|allow`);
  }
  return rejects;
}

export function validateSecretsPolicy(value: Record<string, unknown>): string[] {
  const rejects = rejectUnknown(value, SECRETS_KEYS, "secrets_policy");
  for (const key of ["fail_mode_durable", "fail_mode_telemetry"]) {
    if (value[key] !== undefined && value[key] !== "closed" && value[key] !== "open") {
      rejects.push(`secrets_policy.${key} "${value[key]}" is invalid — valid: closed|open`);
    }
  }
  for (const key of ["env_allowlist", "redaction_patterns"]) {
    if (value[key] !== undefined && !Array.isArray(value[key])) rejects.push(`secrets_policy.${key} must be an array`);
  }
  return rejects;
}

export function validateMcp(value: Record<string, unknown>): string[] {
  const rejects = rejectUnknown(value, MCP_KEYS, "mcp");
  if (value["tool_description_hashes"] !== undefined && !object(value["tool_description_hashes"])) {
    rejects.push("mcp.tool_description_hashes must be an object (tool-name → SHA-256 hash)");
  }
  for (const key of ["stdio_available", "http_available"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") rejects.push(`mcp.${key} must be a boolean (got ${JSON.stringify(value[key])})`);
  }
  if (value["bridge_package"] !== undefined && value["bridge_package"] !== null && typeof value["bridge_package"] !== "string") {
    rejects.push(`mcp.bridge_package must be a string or null (got ${JSON.stringify(value["bridge_package"])})`);
  }
  return rejects;
}

export function validateCrossHostBlock(value: Record<string, unknown>): string[] {
  const rejects = rejectUnknown(value, new Set(["enabled", "hosts", "fallback_to_claude"]), "defaults.cross_host");
  for (const key of ["enabled", "fallback_to_claude"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") rejects.push(`defaults.cross_host.${key} must be a boolean (got ${JSON.stringify(value[key])})`);
  }
  if (value["hosts"] !== undefined && !object(value["hosts"])) {
    rejects.push("defaults.cross_host.hosts must be an object { host_id: { address, port?, user? } }");
  } else if (object(value["hosts"])) {
    for (const [host, raw] of Object.entries(value["hosts"])) {
      if (!object(raw)) {
        rejects.push(`defaults.cross_host.hosts["${host}"] must be an object { address, port?, user? }`);
        continue;
      }
      for (const key of Object.keys(raw)) {
        if (!["address", "port", "user", "login_shell"].includes(key)) rejects.push(`unknown defaults.cross_host.hosts["${host}"] key "${key}" (closed key set)`);
      }
      if (!raw["address"] || typeof raw["address"] !== "string") rejects.push(`defaults.cross_host.hosts["${host}"].address is required and must be a string`);
      const port = raw["port"];
      if (port !== undefined && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) rejects.push(`defaults.cross_host.hosts["${host}"].port must be an integer 1–65535 (got ${JSON.stringify(port)})`);
      for (const key of ["user", "login_shell"]) {
        if (raw[key] !== undefined && typeof raw[key] !== "string") rejects.push(`defaults.cross_host.hosts["${host}"].${key} must be a string (got ${JSON.stringify(raw[key])})`);
      }
    }
  }
  return rejects;
}

export function validateDefaults(value: Record<string, unknown>, selfBuild: boolean): string[] {
  const rejects = rejectUnknown(value, DEFAULT_KEYS, "defaults");
  if (value["adversarial"] === "off" && selfBuild) rejects.push("defaults.adversarial: off is REJECTED for Guild self-build");
  if (object(value["wiki"]) && value["wiki"]["autopromote"] === true) rejects.push("defaults.wiki.autopromote: true is REJECTED always (agents emit candidates only)");
  if (object(value["cross_host"])) rejects.push(...validateCrossHostBlock(value["cross_host"]));
  if (object(value["quality"]) && object(value["quality"]["budget"])) {
    for (const key of Object.keys(value["quality"]["budget"])) {
      if (!["per_class_minutes", "total_minutes"].includes(key)) rejects.push(`unknown defaults.quality.budget key "${key}"`);
    }
  }
  if (object(value["retry"])) {
    const retry = value["retry"];
    rejects.push(...rejectUnknown(retry, new Set(["max_attempts", "backoff"]), "defaults.retry"));
    if (retry["max_attempts"] !== undefined && (typeof retry["max_attempts"] !== "number" || !Number.isInteger(retry["max_attempts"]) || retry["max_attempts"] < 1)) rejects.push(`defaults.retry.max_attempts must be an integer ≥ 1 (got ${JSON.stringify(retry["max_attempts"])})`);
    if (retry["backoff"] !== undefined && !["immediate", "linear", "exponential"].includes(String(retry["backoff"]))) rejects.push(`defaults.retry.backoff must be "immediate"|"linear"|"exponential" (got ${JSON.stringify(retry["backoff"])})`);
  }
  if (object(value["resume"])) {
    rejects.push(...rejectUnknown(value["resume"], new Set(["enabled"]), "defaults.resume"));
    if (value["resume"]["enabled"] !== undefined && typeof value["resume"]["enabled"] !== "boolean") rejects.push(`defaults.resume.enabled must be a boolean (got ${JSON.stringify(value["resume"]["enabled"])})`);
  }
  for (const key of ["heartbeat_timeout_ms", "capability_manifest_ttl_s"]) {
    const number = value[key];
    if (number !== undefined && (typeof number !== "number" || number <= 0 || (key === "heartbeat_timeout_ms" && !Number.isInteger(number)))) rejects.push(`defaults.${key} must be a positive ${key === "heartbeat_timeout_ms" ? "integer" : "number"} (got ${JSON.stringify(number)})`);
  }
  if (value["allowed_tools"] !== undefined && !Array.isArray(value["allowed_tools"])) rejects.push("defaults.allowed_tools must be an array of strings");
  if (value["lean_lead"] !== undefined && !object(value["lean_lead"])) {
    rejects.push(`defaults.lean_lead must be an object { enabled?, hands_on_edit_threshold? } (got ${JSON.stringify(value["lean_lead"])})`);
  } else if (object(value["lean_lead"])) {
    const leanLead = value["lean_lead"];
    rejects.push(...rejectUnknown(leanLead, new Set(["enabled", "hands_on_edit_threshold"]), "defaults.lean_lead"));
    if (leanLead["enabled"] !== undefined && typeof leanLead["enabled"] !== "boolean") {
      rejects.push(`defaults.lean_lead.enabled must be a boolean (got ${JSON.stringify(leanLead["enabled"])})`);
    }
    const threshold = leanLead["hands_on_edit_threshold"];
    if (threshold !== undefined && (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1)) {
      rejects.push(`defaults.lean_lead.hands_on_edit_threshold must be a positive integer (got ${JSON.stringify(threshold)})`);
    }
  }
  if (value["lifecycle_gate"] !== undefined && !object(value["lifecycle_gate"])) {
    rejects.push(`defaults.lifecycle_gate must be an object { enabled?, adhoc_activity_threshold? } (got ${JSON.stringify(value["lifecycle_gate"])})`);
  } else if (object(value["lifecycle_gate"])) {
    const lifecycleGate = value["lifecycle_gate"];
    rejects.push(...rejectUnknown(lifecycleGate, new Set(["enabled", "adhoc_activity_threshold"]), "defaults.lifecycle_gate"));
    if (lifecycleGate["enabled"] !== undefined && typeof lifecycleGate["enabled"] !== "boolean") {
      rejects.push(`defaults.lifecycle_gate.enabled must be a boolean (got ${JSON.stringify(lifecycleGate["enabled"])})`);
    }
    const threshold = lifecycleGate["adhoc_activity_threshold"];
    if (threshold !== undefined && (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1)) {
      rejects.push(`defaults.lifecycle_gate.adhoc_activity_threshold must be a positive integer (got ${JSON.stringify(threshold)})`);
    }
  }
  if (object(value["update"])) {
    const update = value["update"];
    rejects.push(...rejectUnknown(update, new Set(["mode", "cadence_hours"]), "defaults.update"));
    if (update["mode"] !== undefined && !["auto", "notify", "off"].includes(String(update["mode"]))) rejects.push(`defaults.update.mode must be "auto" | "notify" | "off" (got ${JSON.stringify(update["mode"])})`);
    if (update["cadence_hours"] !== undefined && (typeof update["cadence_hours"] !== "number" || update["cadence_hours"] <= 0)) rejects.push(`defaults.update.cadence_hours must be a positive number of hours (got ${JSON.stringify(update["cadence_hours"])})`);
  } else if (value["update"] !== undefined) {
    rejects.push(`defaults.update must be an object { mode, cadence_hours } (got ${JSON.stringify(value["update"])})`);
  }
  if (object(value["index"])) {
    const index = value["index"];
    rejects.push(...rejectUnknown(index, INDEX_KEYS, "defaults.index"));
    if (index["enabled"] !== undefined && typeof index["enabled"] !== "boolean") rejects.push(`defaults.index.enabled must be a boolean (got ${JSON.stringify(index["enabled"])})`);
    for (const key of ["kg_node_threshold", "links_edge_threshold", "runs_threshold", "wiki_file_threshold"]) {
      const number = index[key];
      if (number !== undefined && (typeof number !== "number" || !Number.isInteger(number) || number < 1)) rejects.push(`defaults.index.${key} must be a positive integer (got ${JSON.stringify(number)})`);
    }
    const size = index["kg_size_threshold_mb"];
    if (size !== undefined && (typeof size !== "number" || size <= 0)) rejects.push(`defaults.index.kg_size_threshold_mb must be a positive number (got ${JSON.stringify(size)})`);
  }
  return rejects;
}

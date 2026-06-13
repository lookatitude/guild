#!/usr/bin/env -S npx tsx
/**
 * scripts/config-cmd.ts
 *
 * Unit 2 (U2) — Config command update path.
 *
 * Usage:
 *   npx tsx scripts/config-cmd.ts set <key> <value> --scope workspace|project|local [--cwd <p>]
 *   npx tsx scripts/config-cmd.ts show --sources [--cwd <p>]
 *   npx tsx scripts/config-cmd.ts validate --effective [--cwd <p>]
 *   npx tsx scripts/config-cmd.ts providers detect [--cwd <p>]
 *
 * Subcommands:
 *   set            Hard-set write: reads the target file, merges the key at the given
 *                  dotted path, and writes back. Validates the FULL dotted path and
 *                  value type before writing. Refuses unknown keys at every segment.
 *                  Scalar TIER1 keys (rigor, review, …) reject any sub-path.
 *                  Preserves _help and all unrelated keys (read-modify-write).
 *                  Fails CLOSED if the existing file has malformed JSON.
 *                  Prints exactly what was written and to which file.
 *
 *   show           Print resolved key→value with per-key Source annotation.
 *                  --sources is required.
 *
 *   validate       Validate the POST-INHERITANCE resolved config against the FULL
 *                  closed-key/value validators imported from read-guild-config.ts
 *                  (single source of truth — no drift). --effective is required.
 *
 *   providers      Sub-group for provider management.
 *     detect       Detect available review providers and print a human-readable
 *                  table: author host family, each provider's detected/authed/selectable
 *                  state, and the recommended cross-review provider + reason.
 *                  READ-ONLY (no writes). Exits 0 on success; 2 on bad --cwd.
 *
 * Scope semantics (--scope):
 *   workspace   Writes workspace-root .guild/settings.json. Workspace root is
 *               discovered by checking startDir itself first, then walking up.
 *   project     Writes <cwd>/.guild/settings.json.
 *   local       Writes <cwd>/.guild/settings.local.json.
 *
 * OD-4 (minimal-churn): no schema flatten.
 */

import * as fs from "fs";
import * as path from "path";
import { resolveSettings, Source } from "./lib/settings-resolver";
// Import the real validators from read-guild-config.ts (single source of truth).
// These are purely additive exports — the resolve path is unchanged.
import {
  validateModels,
  validateSecurity,
  validateSecretsPolicy,
  validateMcp,
  validateCrossHostBlock,
  validateDefaults,
} from "./read-guild-config";
import {
  detectProviders,
  recommendProvider,
  defaultProbeEnv,
  type ProbeEnv,
  type ResolvedReview,
} from "./lib/provider-detect";

// ---------------------------------------------------------------------------
// Prototype-pollution guard
// ---------------------------------------------------------------------------

const PROTO_POISON_KEYS = new Set(["__proto__", "prototype", "constructor"]);

// ---------------------------------------------------------------------------
// Scalar TIER1 keys — cannot have sub-paths
// ---------------------------------------------------------------------------

/**
 * TIER1 keys that are pure scalars (no sub-object children).
 * Any path like "rigor.foo" must be rejected.
 */
const SCALAR_TIER1_KEYS = new Set([
  "rigor",
  "auto_approve",
  "review",
  "host",
  "initiative_default",
  "index",
  "record_status_runs",
  "codex_skip_enforcement",
  "agent_mode",
  "statusline",                  // R-009: bool — status-line pane enable
  "adversarial_review_provider", // R-008: open string — any provider-id
  "loops",
  "loop_cap",
  "codex_cap",
]);

/**
 * All writable top-level keys (scalar + object).
 */
const TIER1_KEYS = new Set([
  ...SCALAR_TIER1_KEYS,
  "workspace",
  "models",
  "security",
  "secrets_policy",
  "mcp",
  "defaults",
]);

// ---------------------------------------------------------------------------
// Full closed-key schema for dotted-path validation
// ---------------------------------------------------------------------------

/** Valid sub-keys for workspace.* */
const WORKSPACE_KEYS = new Set(["mode"]);

/** Valid sub-keys for models.* (top-level) */
const MODELS_KEYS = new Set([
  "enabled",
  "tiers",
  "scoreWeights",
  "thresholds",
  "advisorRounds",
  "escalationMarkers",
  "recallBeforeRead",
  "recallScoreThreshold",
  "structuredOutputRequired",
  "cacheTTL",
  "importanceGate",
  "compositeRecall",
  "ingestSimilarityGate",
  "shortOutputThreshold",
]);

/** Valid sub-keys for models.tiers.* */
const MODELS_TIERS_KEYS = new Set(["cheap", "mid", "powerful"]);

/** Valid sub-keys for models.thresholds.* (finding #2 — only mid|powerful) */
const MODELS_THRESHOLDS_KEYS = new Set(["mid", "powerful"]);

/** Valid sub-keys for models.cacheTTL.* */
const MODELS_CACHETL_KEYS = new Set(["coordinator", "leaf"]);

/** Valid sub-keys for security.* */
const SECURITY_KEYS = new Set(["bypass_permissions_policy"]);

/** Valid sub-keys for secrets_policy.* */
const SECRETS_POLICY_KEYS = new Set([
  "env_allowlist",
  "redaction_patterns",
  "fail_mode_durable",
  "fail_mode_telemetry",
]);

/** Valid sub-keys for mcp.* (D-MCP + R-019) */
const MCP_KEYS = new Set([
  "tool_description_hashes",
  "stdio_available",   // R-019: bool — MCP stdio transport available
  "http_available",    // R-019: bool — MCP HTTP transport available
  "bridge_package",    // R-019: string|null — MCP bridge package name
]);

/** Valid sub-keys for defaults.* */
const DEFAULTS_ALLOWED_KEYS = new Set([
  "auto_learn",
  "adversarial",
  "team",
  "review_workflow",
  "skill_policy",
  "gates",
  "wiki",
  "quality",
  "reporting",
  "index",
  "cross_host",
  "retry",                     // R-016
  "resume",                    // R-016
  "heartbeat_timeout_ms",      // R-017
  "capability_manifest_ttl_s", // R-018
  "allowed_tools",             // R-020
]);

/** Valid sub-keys for defaults.team.* */
const DEFAULTS_TEAM_KEYS = new Set(["size", "always_include"]);

/** Valid sub-keys for defaults.gates.* */
const DEFAULTS_GATES_KEYS = new Set(["auto_approve"]);

/** Valid sub-keys for defaults.wiki.* */
const DEFAULTS_WIKI_KEYS = new Set(["share_mode", "autopromote"]);

/** Valid sub-keys for defaults.quality.* */
const DEFAULTS_QUALITY_KEYS = new Set(["budget"]);

/** Valid sub-keys for defaults.quality.budget.* */
const DEFAULTS_QUALITY_BUDGET_KEYS = new Set(["per_class_minutes", "total_minutes"]);

/** Valid sub-keys for defaults.index.* */
const DEFAULTS_INDEX_KEYS = new Set([
  "enabled",
  "kg_node_threshold",
  "kg_size_threshold_mb",
  "links_edge_threshold",
  "runs_threshold",
  "wiki_file_threshold",
]);

/** Valid sub-keys for defaults.cross_host.* (R-015 adds fallback_to_claude) */
const DEFAULTS_CROSS_HOST_KEYS = new Set(["enabled", "hosts", "fallback_to_claude"]);

/** Valid sub-keys for defaults.retry.* (R-016) */
const DEFAULTS_RETRY_KEYS = new Set(["max_attempts", "backoff"]);

/** Valid sub-keys for defaults.resume.* (R-016) */
const DEFAULTS_RESUME_KEYS = new Set(["enabled"]);

// ---------------------------------------------------------------------------
// Full dotted-path validator (findings #2 + round-2 #2)
// ---------------------------------------------------------------------------

/**
 * Validate a complete dotted key path against the full schema.
 *
 * Rules:
 *  - Prototype-poison keys rejected at every segment.
 *  - Scalar TIER1 keys (rigor, review, agent_mode, …) must have no sub-path.
 *  - Every segment of object-typed keys is validated against its closed key-set.
 *  - models.thresholds.* only accepts mid|powerful.
 *
 * Returns an error string if the path is invalid, or null if valid.
 */
function validateKeyPath(keyPath: string): string | null {
  const parts = keyPath.split(".");

  // Reject poison keys at any segment
  for (const part of parts) {
    if (PROTO_POISON_KEYS.has(part)) {
      return `key "${keyPath}" contains a dangerous prototype key segment — rejected`;
    }
  }

  const top = parts[0];

  if (!TIER1_KEYS.has(top)) {
    return (
      `unknown key "${keyPath}" — not in the closed key set. ` +
      `Known top-level keys: ${[...TIER1_KEYS].join(", ")}`
    );
  }

  // Scalar TIER1 keys — no sub-paths allowed (round-2 finding #2a)
  if (SCALAR_TIER1_KEYS.has(top)) {
    if (parts.length > 1) {
      return (
        `"${top}" is a scalar key — sub-key paths are not allowed ` +
        `(got "${keyPath}")`
      );
    }
    return null;
  }

  // Single-segment path for object keys: allowed (value must be JSON blob)
  if (parts.length === 1) return null;

  const seg1 = parts[1];

  // workspace.*
  if (top === "workspace") {
    if (!WORKSPACE_KEYS.has(seg1)) {
      return `unknown workspace key "${seg1}" (closed key set — only: ${[...WORKSPACE_KEYS].join(", ")})`;
    }
    if (parts.length > 2) {
      return `key path "${keyPath}" is too deep — workspace.mode is a scalar`;
    }
    return null;
  }

  // models.*
  if (top === "models") {
    if (!MODELS_KEYS.has(seg1)) {
      return `unknown models key "${seg1}" (closed key set — valid: ${[...MODELS_KEYS].join(", ")})`;
    }
    if (parts.length > 2) {
      const seg2 = parts[2];
      if (seg1 === "tiers") {
        if (!MODELS_TIERS_KEYS.has(seg2)) {
          return `unknown models.tiers key "${seg2}" (valid: cheap|mid|powerful)`;
        }
      } else if (seg1 === "thresholds") {
        // round-2 finding #2b: reject unknown threshold leaf keys up front
        if (!MODELS_THRESHOLDS_KEYS.has(seg2)) {
          return `unknown models.thresholds key "${seg2}" — only mid and powerful are valid`;
        }
      } else if (seg1 === "cacheTTL") {
        if (!MODELS_CACHETL_KEYS.has(seg2)) {
          return `unknown models.cacheTTL key "${seg2}" (valid: coordinator|leaf)`;
        }
      }
      // scoreWeights, shortOutputThreshold accept arbitrary sub-keys
    }
    return null;
  }

  // security.*
  if (top === "security") {
    if (!SECURITY_KEYS.has(seg1)) {
      return `unknown security key "${seg1}" (closed key set — only: ${[...SECURITY_KEYS].join(", ")})`;
    }
    return null;
  }

  // secrets_policy.*
  if (top === "secrets_policy") {
    if (!SECRETS_POLICY_KEYS.has(seg1)) {
      return `unknown secrets_policy key "${seg1}" (closed key set — valid: ${[...SECRETS_POLICY_KEYS].join(", ")})`;
    }
    return null;
  }

  // mcp.*
  if (top === "mcp") {
    if (!MCP_KEYS.has(seg1)) {
      return `unknown mcp key "${seg1}" (closed key set — only: ${[...MCP_KEYS].join(", ")})`;
    }
    return null;
  }

  // defaults.*
  if (top === "defaults") {
    if (!DEFAULTS_ALLOWED_KEYS.has(seg1)) {
      return (
        `unknown defaults key "${seg1}" (closed key set). ` +
        `Known defaults.* keys: ${[...DEFAULTS_ALLOWED_KEYS].join(", ")}`
      );
    }
    if (parts.length <= 2) return null;
    const seg2 = parts[2];

    if (seg1 === "team") {
      if (!DEFAULTS_TEAM_KEYS.has(seg2)) {
        return `unknown defaults.team key "${seg2}" (valid: ${[...DEFAULTS_TEAM_KEYS].join(", ")})`;
      }
      return null;
    }
    if (seg1 === "gates") {
      if (!DEFAULTS_GATES_KEYS.has(seg2)) {
        return `unknown defaults.gates key "${seg2}" (valid: ${[...DEFAULTS_GATES_KEYS].join(", ")})`;
      }
      return null;
    }
    if (seg1 === "wiki") {
      if (!DEFAULTS_WIKI_KEYS.has(seg2)) {
        return `unknown defaults.wiki key "${seg2}" (valid: ${[...DEFAULTS_WIKI_KEYS].join(", ")})`;
      }
      return null;
    }
    if (seg1 === "quality") {
      if (!DEFAULTS_QUALITY_KEYS.has(seg2)) {
        return `unknown defaults.quality key "${seg2}" (valid: ${[...DEFAULTS_QUALITY_KEYS].join(", ")})`;
      }
      if (parts.length > 3) {
        const seg3 = parts[3];
        if (!DEFAULTS_QUALITY_BUDGET_KEYS.has(seg3)) {
          return `unknown defaults.quality.budget key "${seg3}" (valid: ${[...DEFAULTS_QUALITY_BUDGET_KEYS].join(", ")})`;
        }
      }
      return null;
    }
    if (seg1 === "index") {
      if (!DEFAULTS_INDEX_KEYS.has(seg2)) {
        return `unknown defaults.index key "${seg2}" (valid: ${[...DEFAULTS_INDEX_KEYS].join(", ")})`;
      }
      return null;
    }
    if (seg1 === "cross_host") {
      if (!DEFAULTS_CROSS_HOST_KEYS.has(seg2)) {
        return `unknown defaults.cross_host key "${seg2}" (valid: ${[...DEFAULTS_CROSS_HOST_KEYS].join(", ")})`;
      }
      return null;
    }
    // R-016: retry.* and resume.* sub-paths
    if (seg1 === "retry") {
      if (!DEFAULTS_RETRY_KEYS.has(seg2)) {
        return `unknown defaults.retry key "${seg2}" (valid: ${[...DEFAULTS_RETRY_KEYS].join(", ")})`;
      }
      return null;
    }
    if (seg1 === "resume") {
      if (!DEFAULTS_RESUME_KEYS.has(seg2)) {
        return `unknown defaults.resume key "${seg2}" (valid: ${[...DEFAULTS_RESUME_KEYS].join(", ")})`;
      }
      return null;
    }
    // R-017/R-018/R-020: scalar keys — no sub-paths allowed
    if (seg1 === "heartbeat_timeout_ms" || seg1 === "capability_manifest_ttl_s" || seg1 === "allowed_tools") {
      if (parts.length > 2) {
        return `"defaults.${seg1}" is a scalar/list key — sub-key paths are not allowed`;
      }
      return null;
    }
    // adversarial, review_workflow, skill_policy, reporting, auto_learn are scalars
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Valid values and exact type/value validation
// ---------------------------------------------------------------------------

/** Paths that must be booleans — only "true" or "false" accepted. */
const BOOLEAN_PATHS = new Set([
  "record_status_runs",
  "defaults.auto_learn",
  "defaults.wiki.autopromote",
  "defaults.cross_host.enabled",
  "statusline",                              // R-009
  "defaults.cross_host.fallback_to_claude", // R-015
  "defaults.index.enabled",
  "defaults.resume.enabled",                // R-016
  "mcp.stdio_available",                    // R-019
  "mcp.http_available",                     // R-019
  "models.enabled",
  "models.recallBeforeRead",
  "models.structuredOutputRequired",
]);

/** Paths that must be integers (whole number strings). */
const INTEGER_PATHS = new Set([
  "loop_cap",
  "codex_cap",
  "defaults.team.size",
  "defaults.quality.budget.per_class_minutes",
  "defaults.quality.budget.total_minutes",
  "defaults.index.kg_node_threshold",
  "defaults.index.links_edge_threshold",
  "defaults.index.runs_threshold",
  "defaults.index.wiki_file_threshold",
  "defaults.retry.max_attempts",     // R-016
  "defaults.heartbeat_timeout_ms",   // R-017
  "models.advisorRounds",
  "models.importanceGate",
  "models.thresholds.mid",
  "models.thresholds.powerful",
]);

/** Paths that must be numbers (possibly non-integer). */
const NUMBER_PATHS = new Set([
  "defaults.index.kg_size_threshold_mb",
  "defaults.capability_manifest_ttl_s",    // R-018: positive number (seconds)
  "models.recallScoreThreshold",
  "models.ingestSimilarityGate",
]);

/** Valid values for each closed-enum key. */
const VALID_VALUES: Record<string, Set<string>> = {
  rigor: new Set(["quick", "standard", "deep"]),
  review: new Set(["local", "cross", "off"]),
  host: new Set(["claude", "codex", "auto"]),
  agent_mode: new Set(["team", "agent", "subagent", "auto"]),
  index: new Set(["auto", "off"]),
  codex_skip_enforcement: new Set(["warn", "block"]),
  "workspace.mode": new Set(["auto", "on", "off"]),
  "defaults.adversarial": new Set(["on", "off"]),
  "defaults.review_workflow": new Set(["standard", "cross", "minimal"]),
  "defaults.skill_policy": new Set(["standard", "conservative"]),
  "defaults.reporting": new Set(["standard", "quiet", "verbose"]),
  "defaults.wiki.share_mode": new Set(["team", "private"]),
  "security.bypass_permissions_policy": new Set(["deny", "audit", "allow"]),
  "secrets_policy.fail_mode_durable": new Set(["closed", "open"]),
  "secrets_policy.fail_mode_telemetry": new Set(["open", "closed"]),
  "models.cacheTTL.coordinator": new Set(["1h", "5m", "off"]),
  "models.cacheTTL.leaf": new Set(["1h", "5m", "off"]),
  "defaults.retry.backoff": new Set(["immediate", "linear", "exponential"]), // R-016
};

/**
 * Validate the value for a given key path BEFORE coercion.
 * Returns an error string if invalid, or null if valid.
 */
function validateValue(keyPath: string, rawValue: string): string | null {
  // Closed-enum check
  if (keyPath in VALID_VALUES) {
    const valid = VALID_VALUES[keyPath];
    if (!valid.has(rawValue)) {
      return `invalid value "${rawValue}" for key "${keyPath}" — valid: ${[...valid].join("|")}`;
    }
    return null;
  }

  // Boolean keys: ONLY "true" or "false"
  if (BOOLEAN_PATHS.has(keyPath)) {
    if (rawValue !== "true" && rawValue !== "false") {
      return (
        `value for "${keyPath}" must be true or false ` +
        `(got "${rawValue}") — only the exact literals "true" and "false" are accepted`
      );
    }
    return null;
  }

  // Integer keys
  if (INTEGER_PATHS.has(keyPath)) {
    const n = Number(rawValue);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return `value for "${keyPath}" must be an integer (got "${rawValue}")`;
    }
    return null;
  }

  // Numeric (possibly non-integer) keys
  if (NUMBER_PATHS.has(keyPath)) {
    const n = Number(rawValue);
    if (!Number.isFinite(n)) {
      return `value for "${keyPath}" must be a number (got "${rawValue}")`;
    }
    return null;
  }

  // Null keyword for nullable keys
  if (rawValue === "null" && (keyPath === "initiative_default" || keyPath === "loops")) {
    return null;
  }

  // JSON array / object: try-parse; reject if invalid JSON
  if (rawValue.startsWith("[") || rawValue.startsWith("{")) {
    try {
      JSON.parse(rawValue);
    } catch {
      return `value for "${keyPath}" looks like JSON but failed to parse: ${rawValue}`;
    }
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Value coercion (after validation — types are now guaranteed correct)
// ---------------------------------------------------------------------------

function coerceValue(keyPath: string, rawValue: string): unknown {
  if (rawValue === "null" && (keyPath === "initiative_default" || keyPath === "loops")) {
    return null;
  }
  if (BOOLEAN_PATHS.has(keyPath)) {
    return rawValue === "true";
  }
  if (INTEGER_PATHS.has(keyPath)) {
    return parseInt(rawValue, 10);
  }
  if (NUMBER_PATHS.has(keyPath)) {
    return Number(rawValue);
  }
  if (rawValue.startsWith("[") || rawValue.startsWith("{")) {
    try {
      return JSON.parse(rawValue);
    } catch {
      return rawValue;
    }
  }
  return rawValue;
}

// ---------------------------------------------------------------------------
// Deep set: apply a dotted path value into a plain object
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepSet(
  obj: Record<string, unknown>,
  keyPath: string,
  value: unknown
): Record<string, unknown> {
  const parts = keyPath.split(".");
  for (const p of parts) {
    if (PROTO_POISON_KEYS.has(p)) throw new Error(`dangerous key "${p}" rejected`);
  }
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!isPlainObject(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
  return obj;
}

// ---------------------------------------------------------------------------
// File read-modify-write — fail CLOSED on parse errors
// ---------------------------------------------------------------------------

function readModifyWrite(filePath: string, keyPath: string, value: unknown): void {
  let existing: Record<string, unknown> = {};

  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf8");
    try {
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      // FAIL CLOSED: throw so caller leaves the file untouched
      throw new Error(
        `cannot parse existing file ${filePath} — ` +
          `${(e as Error).message}. Fix the file manually before using config set.`
      );
    }
  }

  deepSet(existing, keyPath, value);

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Workspace discovery — check startDir itself first
// ---------------------------------------------------------------------------

interface WorkspaceManifest {
  is_workspace: boolean;
}

function discoverWorkspaceRoot(startDir: string): string | null {
  const absStart = path.resolve(startDir);
  const fsRoot = path.parse(absStart).root;

  let current = absStart;
  while (true) {
    const manifestPath = path.join(current, ".guild", "workspace.json");
    if (fs.existsSync(manifestPath)) {
      let manifest: WorkspaceManifest | null = null;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as WorkspaceManifest;
      } catch {
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
        continue;
      }
      if (manifest.is_workspace === true) return current;
      return null; // is_workspace: false — deliberate stop
    }
    const parent = path.dirname(current);
    if (parent === current || current === fsRoot) break;
    current = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// validate --effective: use imported validators (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Validate the fully-resolved config using the validators exported from
 * read-guild-config.ts. This is the ONLY place that calls these validators
 * for the post-inheritance merged result — no local replicas.
 */
function validateResolved(config: Record<string, unknown>, selfBuild = false): string[] {
  const violations: string[] = [];

  if (isPlainObject(config["models"])) {
    violations.push(...validateModels(config["models"] as Record<string, unknown>));
  }
  if (isPlainObject(config["security"])) {
    violations.push(...validateSecurity(config["security"] as Record<string, unknown>));
  }
  if (isPlainObject(config["secrets_policy"])) {
    violations.push(...validateSecretsPolicy(config["secrets_policy"] as Record<string, unknown>));
  }
  if (isPlainObject(config["mcp"])) {
    violations.push(...validateMcp(config["mcp"] as Record<string, unknown>));
  }
  if (isPlainObject(config["defaults"])) {
    violations.push(...validateDefaults(config["defaults"] as Record<string, unknown>, selfBuild));
  }

  return violations;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  subcommand: "set" | "show" | "validate" | "providers" | "update-mcp-hashes";
  /** For subcommand=providers: the sub-verb (e.g. "detect"). */
  providersVerb?: string;
  /** For subcommand=update-mcp-hashes: path to JSON file with tool-name→description map. */
  toolsFile?: string;
  key?: string;
  rawValue?: string;
  scope?: "workspace" | "project" | "local";
  cwd: string;
  showSources: boolean;
  validateEffective: boolean;
  selfBuild: boolean;
}

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  const args = argv.slice(2);
  if (args.length === 0) {
    return {
      error:
        "Usage: config-cmd.ts <set|show|validate|providers> [options...]\n" +
        "  set <key> <value> --scope workspace|project|local [--cwd <p>]\n" +
        "  show --sources [--cwd <p>]\n" +
        "  validate --effective [--cwd <p>]\n" +
        "  providers detect [--cwd <p>]\n" +
        "  update-mcp-hashes --tools <json-file> --scope workspace|project|local [--cwd <p>]",
    };
  }

  const sub = args[0];
  if (sub !== "set" && sub !== "show" && sub !== "validate" && sub !== "providers" && sub !== "update-mcp-hashes") {
    return { error: `unknown subcommand "${sub}" — expected: set, show, validate, providers, update-mcp-hashes` };
  }

  let key: string | undefined;
  let rawValue: string | undefined;
  let scope: ParsedArgs["scope"];
  let cwd = process.cwd();
  let showSources = false;
  let validateEffective = false;
  let selfBuild = false;
  let providersVerb: string | undefined;

  // For `providers`, the second positional is the sub-verb (e.g. "detect")
  if (sub === "providers") {
    if (args[1] && !args[1].startsWith("--")) {
      providersVerb = args[1];
      if (providersVerb !== "detect") {
        return { error: `unknown providers sub-verb "${providersVerb}" — expected: detect` };
      }
    } else {
      return { error: 'providers requires a sub-verb — expected: providers detect [--cwd <p>]' };
    }
  }

  // Parse flags from the rest of the args (skip the sub-verb for providers)
  const flagStart = sub === "providers" ? 2 : 1;
  const positionals: string[] = [];
  let toolsFile: string | undefined;
  for (let i = flagStart; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--sources") {
      showSources = true;
    } else if (arg === "--effective") {
      validateEffective = true;
    } else if (arg === "--self-build") {
      selfBuild = true;
    } else if (arg === "--cwd" && args[i + 1]) {
      cwd = args[++i];
    } else if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
    } else if (arg === "--scope" && args[i + 1]) {
      const s = args[++i];
      if (s !== "workspace" && s !== "project" && s !== "local") {
        return { error: `invalid --scope "${s}" — valid: workspace|project|local` };
      }
      scope = s;
    } else if (arg.startsWith("--scope=")) {
      const s = arg.slice("--scope=".length);
      if (s !== "workspace" && s !== "project" && s !== "local") {
        return { error: `invalid --scope "${s}" — valid: workspace|project|local` };
      }
      scope = s;
    } else if (arg === "--tools" && args[i + 1]) {
      toolsFile = args[++i];
    } else if (arg.startsWith("--tools=")) {
      toolsFile = arg.slice("--tools=".length);
    } else if (!arg.startsWith("--")) {
      positionals.push(arg);
    }
  }

  if (sub === "set") {
    [key, rawValue] = positionals;
    if (!key || rawValue === undefined) {
      return { error: "set requires: <key> <value>" };
    }
    if (!scope) {
      return { error: "set requires --scope workspace|project|local" };
    }
  }

  if (sub === "update-mcp-hashes" && !scope) {
    return { error: "update-mcp-hashes requires --scope workspace|project|local" };
  }

  return {
    subcommand: sub,
    providersVerb,
    toolsFile,
    key,
    rawValue,
    scope,
    cwd,
    showSources,
    validateEffective,
    selfBuild,
  };
}

// ---------------------------------------------------------------------------
// Subcommand: set
// ---------------------------------------------------------------------------

function cmdSet(
  keyPath: string,
  rawValue: string,
  scope: "workspace" | "project" | "local",
  cwd: string
): number {
  // 1. Validate the FULL dotted key path
  const keyErr = validateKeyPath(keyPath);
  if (keyErr) {
    process.stdout.write(`[config-cmd] ERROR: ${keyErr}\n`);
    return 1;
  }

  // 2. Validate value (exact type check BEFORE coercion)
  const valErr = validateValue(keyPath, rawValue);
  if (valErr) {
    process.stdout.write(`[config-cmd] ERROR: ${valErr}\n`);
    return 1;
  }

  // 3. Resolve target file
  let targetFile: string;
  if (scope === "workspace") {
    const wsRoot = discoverWorkspaceRoot(cwd);
    if (!wsRoot) {
      process.stdout.write(
        `[config-cmd] ERROR: --scope workspace requires a workspace root ` +
          `(found by checking ${cwd} and walking up for .guild/workspace.json with is_workspace:true)\n`
      );
      return 1;
    }
    targetFile = path.join(wsRoot, ".guild", "settings.json");
  } else if (scope === "project") {
    targetFile = path.join(cwd, ".guild", "settings.json");
  } else {
    targetFile = path.join(cwd, ".guild", "settings.local.json");
  }

  // 4. Coerce value
  const coerced = coerceValue(keyPath, rawValue);

  // 5. Read-modify-write — FAIL CLOSED on malformed JSON
  try {
    readModifyWrite(targetFile, keyPath, coerced);
  } catch (e) {
    process.stdout.write(`[config-cmd] ERROR: ${(e as Error).message}\n`);
    return 1;
  }

  // 6. Print what was written and where
  const valueDisplay = JSON.stringify(coerced);
  const fileName = path.basename(targetFile);
  process.stdout.write(
    `[config-cmd] SET ${keyPath} = ${valueDisplay}\n` +
      `  scope: ${scope}\n` +
      `  file:  ${targetFile}\n` +
      `  written: ${fileName}\n`
  );

  return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: show --sources
// ---------------------------------------------------------------------------

function cmdShowSources(cwd: string): number {
  let result: ReturnType<typeof resolveSettings>;
  try {
    result = resolveSettings({ cwd });
  } catch (e) {
    process.stdout.write(
      `[config-cmd] ERROR: could not resolve settings — ${(e as Error).message}\n`
    );
    return 1;
  }

  const { config, sources } = result;
  const configObj = config as unknown as Record<string, unknown>;

  const allKeys = new Set<string>([...Object.keys(configObj), ...Object.keys(sources)]);
  allKeys.delete("_rigorExpanded");

  const sorted = [...allKeys].sort();
  const lines: string[] = [];
  for (const key of sorted) {
    if (key.startsWith("_")) continue;
    const source: Source = (sources[key] as Source) ?? "builtin";
    const rawVal = configObj[key];
    let valDisplay: string;
    if (rawVal === null) {
      valDisplay = "null";
    } else if (typeof rawVal === "object") {
      valDisplay = JSON.stringify(rawVal);
    } else {
      valDisplay = String(rawVal);
    }
    lines.push(`${key} = ${valDisplay}  [${source}]`);
  }

  const wsModeSource: Source =
    (sources["workspace.mode"] as Source) ?? sources["workspace"] ?? "builtin";
  const wsMode = config.workspace?.mode ?? "auto";
  lines.push(`workspace.mode = ${wsMode}  [${wsModeSource}]`);

  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: validate --effective
// ---------------------------------------------------------------------------

/**
 * Closed-key reject for unknown TOP-LEVEL keys (13-config-surfaces / D11).
 *
 * The post-inheritance resolver strips unknown keys, so the merged result can
 * never carry them — a typo like {"rigour": "deep"} would otherwise pass
 * `validate --effective` silently. This raw-file sweep checks every
 * contributing settings file's top-level keys against the closed TIER1 set
 * and reports each unknown key as a violation ("rejected, not silently
 * ignored"). `_`-prefixed annotation keys (`_help`, `_docs`) are exempt.
 */
function collectUnknownTopLevelKeyViolations(cwd: string): string[] {
  const violations: string[] = [];
  const candidates: Array<{ label: string; file: string }> = [
    { label: "project settings.json", file: path.join(cwd, ".guild", "settings.json") },
    { label: "project settings.local.json", file: path.join(cwd, ".guild", "settings.local.json") },
  ];
  const wsRoot = discoverWorkspaceRoot(cwd);
  if (wsRoot && path.resolve(wsRoot) !== path.resolve(cwd)) {
    candidates.push(
      { label: "workspace settings.json", file: path.join(wsRoot, ".guild", "settings.json") },
      { label: "workspace settings.local.json", file: path.join(wsRoot, ".guild", "settings.local.json") }
    );
  }
  for (const { label, file } of candidates) {
    if (!fs.existsSync(file)) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      continue; // parse errors are reported by the resolver path, not here
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    for (const k of Object.keys(parsed)) {
      if (k.startsWith("_")) continue; // _help / _docs annotations
      if (!TIER1_KEYS.has(k)) {
        violations.push(
          `unknown top-level key "${k}" in ${label} (${file}) — closed key set; ` +
            `check spelling (known: ${[...TIER1_KEYS].join(", ")})`
        );
      }
    }
  }
  return violations;
}

function cmdValidateEffective(cwd: string, selfBuild: boolean): number {
  let result: ReturnType<typeof resolveSettings>;
  try {
    result = resolveSettings({ cwd });
  } catch (e) {
    process.stdout.write(
      `[config-cmd] ERROR: could not resolve settings — ${(e as Error).message}\n`
    );
    return 1;
  }

  const { config } = result;
  const configObj = config as unknown as Record<string, unknown>;

  const violations = validateResolved(configObj, selfBuild);
  // D11: unknown top-level keys are rejected, not silently ignored — the
  // resolver strips them before the merge, so they must be swept raw-file-side.
  violations.push(...collectUnknownTopLevelKeyViolations(cwd));

  if (violations.length === 0) {
    process.stdout.write(
      `[config-cmd] VALID — resolved config passes all closed-key checks\n`
    );
    return 0;
  }

  process.stdout.write(`[config-cmd] VIOLATIONS (${violations.length}):\n`);
  for (const v of violations) {
    process.stdout.write(`  - ${v}\n`);
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Subcommand: providers detect
// ---------------------------------------------------------------------------

/**
 * Print a human-readable detection table:
 *   - Author host family (from resolved config's host key)
 *   - Each provider: id, kind, family, detected, authed, selectable, detail
 *   - Recommended cross-review provider + reason
 *
 * READ-ONLY. Exits 0 on success, 2 on bad --cwd.
 *
 * The optional `probe` parameter is an injectable ProbeEnv (used by tests to
 * supply a deterministic fake without shelling out). Production callers — the
 * CLI entrypoint and any future programmatic callers — pass no probe, which
 * causes the function to fall back to defaultProbeEnv(cwd). There is NO CLI
 * flag for probe injection; injection is only possible via direct function call.
 */
export function cmdProvidersDetect(cwd: string, probe?: ProbeEnv): number {
  // Validate cwd exists and is a directory
  try {
    const stat = fs.statSync(cwd);
    if (!stat.isDirectory()) {
      process.stdout.write(
        `[config-cmd] ERROR: --cwd "${cwd}" is not a directory\n`
      );
      return 2;
    }
  } catch {
    process.stdout.write(
      `[config-cmd] ERROR: --cwd "${cwd}" does not exist or is not readable\n`
    );
    return 2;
  }

  // Resolve settings to get host and review config
  let resolvedHost = "auto";
  let resolvedReview: ResolvedReview = { mode: "local", provider: "auto" };
  try {
    const { config } = resolveSettings({ cwd });
    resolvedHost = config.host ?? "auto";
    resolvedReview = {
      mode: config.review as ResolvedReview["mode"],
      provider: "auto",
    };
  } catch {
    // If settings can't be resolved, use defaults — detection still runs
  }

  // Build the probe env: use the injected probe (test path) or the real default
  // (production path). No file-read hook exists in the production CLI — the only
  // way to inject a fake probe is via direct function call from test code.
  const resolvedProbe: ProbeEnv = probe ?? defaultProbeEnv(cwd);

  // Run detection
  const detection = detectProviders({
    cwd,
    host: resolvedHost,
    probe: resolvedProbe,
  });

  // Get recommendation
  const rec = recommendProvider(detection, resolvedReview);

  // ---------------------------------------------------------------------------
  // Print table
  // ---------------------------------------------------------------------------

  const lines: string[] = [];

  lines.push(`[config-cmd] providers detect`);
  lines.push(`  author host family : ${detection.authorHost}`);
  lines.push(`  review.mode        : ${resolvedReview.mode}`);
  lines.push("");
  lines.push(
    `  ${"PROVIDER".padEnd(18)} ${"KIND".padEnd(16)} ${"FAMILY".padEnd(12)} ` +
    `${"DETECTED".padEnd(9)} ${"AUTHED".padEnd(7)} ${"SELECTABLE".padEnd(11)} DETAIL`
  );
  lines.push(
    `  ${"─".repeat(18)} ${"─".repeat(16)} ${"─".repeat(12)} ` +
    `${"─".repeat(9)} ${"─".repeat(7)} ${"─".repeat(11)} ${"─".repeat(40)}`
  );

  for (const p of detection.providers) {
    const detected = p.detected ? "yes" : "no";
    const authed = p.authed ? "yes" : "no";
    const selectable = p.selectable ? "yes" : "no";
    lines.push(
      `  ${p.id.padEnd(18)} ${p.kind.padEnd(16)} ${p.family.padEnd(12)} ` +
      `${detected.padEnd(9)} ${authed.padEnd(7)} ${selectable.padEnd(11)} ${p.detail}`
    );
  }

  lines.push("");
  if (rec.recommended) {
    lines.push(`  recommended cross-review : ${rec.recommended}`);
  } else {
    lines.push(`  recommended cross-review : (none)`);
  }
  lines.push(`  reason : ${rec.reason}`);

  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: update-mcp-hashes (R-005)
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hashes of MCP tool descriptions and write them into
 * `mcp.tool_description_hashes` in the target settings file.
 *
 * Usage:
 *   npx tsx scripts/config-cmd.ts update-mcp-hashes \
 *     --tools <json-file> --scope project|workspace|local [--cwd <p>]
 *
 * <json-file> must contain a JSON object: { "<tool-name>": "<description>", ... }
 * The tool-name is the Claude Code mcp__ form (e.g. "mcp__server__tool_name").
 * Pass "-" as the file path to read from stdin.
 *
 * The command reads the file, hashes each description with SHA-256, and writes
 * the { tool-name → hash } map into mcp.tool_description_hashes via a
 * read-modify-write (preserving all other settings). Existing hashes for tools
 * NOT present in the input are PRESERVED (merge semantics, not replace).
 * Use --replace to overwrite the entire hash map from the input.
 *
 * READ-ONLY: the hash map is written to settings.json only — never to live Claude Code.
 * The PreToolUse hook (hooks/pre-tool-use.ts → hooks/lib/security/mcp-hash-pin.ts)
 * reads the persisted hashes and compares them at tool-call time.
 *
 * Exit codes: 0 success; 1 bad input / IO error; 2 bad --cwd.
 */
import * as crypto from "node:crypto";

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function cmdUpdateMcpHashes(
  cwd: string,
  scope: "workspace" | "project" | "local",
  toolsFile: string | undefined,
  replaceAll = false
): number {
  // 1. Read tools JSON (stdin or file)
  let rawTools: string;
  if (!toolsFile || toolsFile === "-") {
    try {
      rawTools = fs.readFileSync("/dev/stdin", "utf8");
    } catch (e) {
      process.stdout.write(
        `[config-cmd] ERROR: could not read stdin — ${(e as Error).message}\n` +
        `  Pass --tools <json-file> or pipe tool descriptions to stdin.\n`
      );
      return 1;
    }
  } else {
    const resolvedPath = path.resolve(toolsFile);
    if (!fs.existsSync(resolvedPath)) {
      process.stdout.write(`[config-cmd] ERROR: --tools file not found: ${resolvedPath}\n`);
      return 1;
    }
    try {
      rawTools = fs.readFileSync(resolvedPath, "utf8");
    } catch (e) {
      process.stdout.write(`[config-cmd] ERROR: could not read --tools file: ${(e as Error).message}\n`);
      return 1;
    }
  }

  // 2. Parse { tool-name → description }
  let toolDescriptions: Record<string, string>;
  try {
    toolDescriptions = JSON.parse(rawTools) as Record<string, string>;
    if (typeof toolDescriptions !== "object" || toolDescriptions === null || Array.isArray(toolDescriptions)) {
      throw new Error("expected a JSON object { \"tool-name\": \"description\", ... }");
    }
  } catch (e) {
    process.stdout.write(`[config-cmd] ERROR: invalid JSON in tools input — ${(e as Error).message}\n`);
    return 1;
  }

  // 3. Compute hashes: { tool-name → SHA-256(description) }
  const newHashes: Record<string, string> = {};
  for (const [name, desc] of Object.entries(toolDescriptions)) {
    if (typeof desc !== "string") {
      process.stdout.write(`[config-cmd] WARN: skipping "${name}" — description is not a string\n`);
      continue;
    }
    newHashes[name] = sha256Hex(desc);
  }

  const toolCount = Object.keys(newHashes).length;
  if (toolCount === 0) {
    process.stdout.write(`[config-cmd] WARN: no tool descriptions to hash — settings file unchanged\n`);
    return 0;
  }

  // 4. Resolve target file
  let targetFile: string;
  if (scope === "workspace") {
    const wsRoot = discoverWorkspaceRoot(cwd);
    if (!wsRoot) {
      process.stdout.write(
        `[config-cmd] ERROR: --scope workspace requires a workspace root ` +
          `(found by checking ${cwd} and walking up for .guild/workspace.json with is_workspace:true)\n`
      );
      return 1;
    }
    targetFile = path.join(wsRoot, ".guild", "settings.json");
  } else if (scope === "project") {
    targetFile = path.join(cwd, ".guild", "settings.json");
  } else {
    targetFile = path.join(cwd, ".guild", "settings.local.json");
  }

  // 5. Read-modify-write: merge or replace mcp.tool_description_hashes
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(targetFile)) {
    const raw = fs.readFileSync(targetFile, "utf8");
    try {
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      process.stdout.write(
        `[config-cmd] ERROR: cannot parse existing file ${targetFile} — ` +
          `${(e as Error).message}. Fix the file manually before using update-mcp-hashes.\n`
      );
      return 1;
    }
  }

  const existingMcp = (isPlainObject(existing["mcp"]) ? existing["mcp"] : {}) as Record<string, unknown>;
  const existingHashes = (isPlainObject(existingMcp["tool_description_hashes"])
    ? existingMcp["tool_description_hashes"]
    : {}) as Record<string, string>;

  const mergedHashes = replaceAll
    ? newHashes
    : { ...existingHashes, ...newHashes };

  existing["mcp"] = { ...existingMcp, tool_description_hashes: mergedHashes };

  const dir = path.dirname(targetFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(targetFile, JSON.stringify(existing, null, 2) + "\n", "utf8");

  const totalHashes = Object.keys(mergedHashes).length;
  process.stdout.write(
    `[config-cmd] update-mcp-hashes: ${toolCount} tool(s) hashed + written\n` +
    `  scope:  ${scope}\n` +
    `  file:   ${targetFile}\n` +
    `  total pinned hashes after update: ${totalHashes}\n`
  );
  if (toolCount > 0) {
    process.stdout.write(`  tools:\n`);
    for (const [name, hash] of Object.entries(newHashes)) {
      process.stdout.write(`    ${name}: ${hash.slice(0, 12)}…\n`);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function main(): void {
  const parsed = parseArgs(process.argv);

  if ("error" in parsed) {
    process.stdout.write(`[config-cmd] ERROR: ${parsed.error}\n`);
    process.exit(1);
  }

  let exitCode: number;

  switch (parsed.subcommand) {
    case "set": {
      if (!parsed.key || parsed.rawValue === undefined || !parsed.scope) {
        process.stdout.write("[config-cmd] ERROR: set requires <key> <value> --scope\n");
        process.exit(1);
      }
      exitCode = cmdSet(parsed.key, parsed.rawValue, parsed.scope, parsed.cwd);
      break;
    }

    case "show": {
      if (!parsed.showSources) {
        process.stdout.write(
          "[config-cmd] ERROR: show requires --sources (bare show coming in U7)\n"
        );
        process.exit(1);
      }
      exitCode = cmdShowSources(parsed.cwd);
      break;
    }

    case "validate": {
      if (!parsed.validateEffective) {
        process.stdout.write(
          "[config-cmd] ERROR: validate requires --effective\n"
        );
        process.exit(1);
      }
      exitCode = cmdValidateEffective(parsed.cwd, parsed.selfBuild);
      break;
    }

    case "providers": {
      // Only "detect" sub-verb is supported (validated in parseArgs).
      // No probe is passed — production always uses defaultProbeEnv(cwd).
      // Probe injection is only possible via direct function import (tests).
      exitCode = cmdProvidersDetect(parsed.cwd);
      break;
    }

    case "update-mcp-hashes": {
      // R-005: compute SHA-256 of tool descriptions → write mcp.tool_description_hashes.
      if (!parsed.scope) {
        process.stdout.write("[config-cmd] ERROR: update-mcp-hashes requires --scope workspace|project|local\n");
        process.exit(1);
      }
      exitCode = cmdUpdateMcpHashes(parsed.cwd, parsed.scope, parsed.toolsFile);
      break;
    }

    default: {
      process.stdout.write("[config-cmd] ERROR: unknown subcommand\n");
      exitCode = 1;
    }
  }

  process.exit(exitCode);
}

// Only run main() when this file is the entry-point (invoked directly via tsx/node).
// When imported by tests, the module executes but main() is NOT called — the
// exported functions are used directly instead.
if (require.main === module) {
  main();
}

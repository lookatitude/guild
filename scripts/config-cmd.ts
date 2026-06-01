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
 *
 * Subcommands:
 *   set         Hard-set write: reads the target file, merges the key at the given
 *               dotted path, and writes back. Validates the FULL dotted path and
 *               value type before writing. Refuses unknown keys at every segment.
 *               Scalar TIER1 keys (rigor, review, …) reject any sub-path.
 *               Preserves _help and all unrelated keys (read-modify-write).
 *               Fails CLOSED if the existing file has malformed JSON.
 *               Prints exactly what was written and to which file.
 *
 *   show        Print resolved key→value with per-key Source annotation.
 *               --sources is required.
 *
 *   validate    Validate the POST-INHERITANCE resolved config against the FULL
 *               closed-key/value validators imported from read-guild-config.ts
 *               (single source of truth — no drift). --effective is required.
 *
 * Scope semantics (--scope):
 *   workspace   Writes workspace-root .guild/settings.json. Workspace root is
 *               discovered by checking startDir itself first, then walking up.
 *   project     Writes <cwd>/.guild/settings.json.
 *   local       Writes <cwd>/.guild/settings.local.json.
 *
 * OD-4 (minimal-churn): no schema flatten.
 * providers detect: (provider detection: U4) — not yet implemented.
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

/** Valid sub-keys for mcp.* */
const MCP_KEYS = new Set(["tool_description_hashes"]);

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

/** Valid sub-keys for defaults.cross_host.* */
const DEFAULTS_CROSS_HOST_KEYS = new Set(["enabled", "hosts"]);

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
  "defaults.index.enabled",
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
  "models.advisorRounds",
  "models.importanceGate",
  "models.thresholds.mid",
  "models.thresholds.powerful",
]);

/** Paths that must be numbers (possibly non-integer). */
const NUMBER_PATHS = new Set([
  "defaults.index.kg_size_threshold_mb",
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
  subcommand: "set" | "show" | "validate";
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
        "Usage: config-cmd.ts <set|show|validate> [options...]\n" +
        "  set <key> <value> --scope workspace|project|local [--cwd <p>]\n" +
        "  show --sources [--cwd <p>]\n" +
        "  validate --effective [--cwd <p>]",
    };
  }

  const sub = args[0];
  if (sub !== "set" && sub !== "show" && sub !== "validate") {
    return { error: `unknown subcommand "${sub}" — expected: set, show, validate` };
  }

  let key: string | undefined;
  let rawValue: string | undefined;
  let scope: ParsedArgs["scope"];
  let cwd = process.cwd();
  let showSources = false;
  let validateEffective = false;
  let selfBuild = false;

  const positionals: string[] = [];
  for (let i = 1; i < args.length; i++) {
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

  return { subcommand: sub, key, rawValue, scope, cwd, showSources, validateEffective, selfBuild };
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

    default: {
      process.stdout.write("[config-cmd] ERROR: unknown subcommand\n");
      exitCode = 1;
    }
  }

  process.exit(exitCode);
}

main();

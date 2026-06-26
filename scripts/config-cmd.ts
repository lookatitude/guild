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
// Canonical single-source prototype-pollution guard (re-arch WAVE 1).
import { PROTO_POISON_KEYS } from "./lib/shared/safe-object";
// P1-L9: the config reconciler (`config init` → `reconcile sync`).
import { reconcileConfig, summarizeReconcile } from "./lib/config-reconcile";
import { RECONCILE_MODES, type ReconcileMode } from "./lib/config-reconcile-contract";
// Import the real validators from read-guild-config.ts (single source of truth).
// These are purely additive exports — the resolve path is unchanged.
import {
  validateModels,
  validateSecurity,
  validateSecretsPolicy,
  validateMcp,
  validateCrossHostBlock,
  validateDefaults,
  validateRoles,
  validateHostProfiles,
} from "./read-guild-config";
// Closed registry host-id set (single SoT — host-registry-schema.ts HOST_IDS) for
// validating roles.* / host_profiles.* values written via `config set`.
import { HOST_IDS } from "./lib/host-registry-schema";
import { normalizeHostId } from "./lib/host-id-namespace";
import {
  detectProviders,
  recommendProvider,
  defaultProbeEnv,
  type ProbeEnv,
  type ResolvedReview,
} from "./lib/provider-detect";
// LW1-7 (SC-W1-7 role aliases / SC-W1-8 --sources permission layers + per-host render):
// the P1 permission model (host_mode × guild_gates baseline golden), the per-host config
// renderer (LW1-6), and the never-clobber provenance type — all consumed READ-ONLY here.
import {
  resolveBaselineGolden,
  PHASES,
  GATE_TYPES,
  cellKey,
  type BypassPolicy,
  type PermissionDecision,
} from "./lib/permission-policy-schema";
import { renderAllHostConfigs } from "./lib/config-render";
import type {
  RenderConfigLike,
  ConfigSource,
} from "./lib/config-render";
import type { FieldProvenance } from "./lib/config-reconcile-contract";
// L4 (§E11/§E12): the host-adapter CONFIG-UI presentation core. The surface RENDERS the
// metadata-driven grouped settings panels + plans an edit's confirmation-strength gate; the
// PERSIST step is delegated to `cmdSet` below (the plugin config API — never the surface, V10).
import {
  buildHostConfigUiSurface,
  planConfigUiEdit,
  parseConfirmation,
  type HostConfigUiSurface,
  type ConfigUiKeyView,
} from "./lib/config-ui-surface";
import type { ConfigScope } from "./lib/config-ui-metadata";
// CLI/agents-file native-host set — drives the per-host `blocked` decision (app/connector → blocked).
import { CLI_NATIVE_HOSTS } from "./lib/host-open-preflight";

// ---------------------------------------------------------------------------
// Prototype-pollution guard — PROTO_POISON_KEYS is the canonical single-source
// set (re-arch WAVE 1), imported from ./lib/shared/safe-object above.
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
  // LW1-6 schema extension (SC-W1-7/W1-8): the per-run role pins + per-host render
  // overrides. They live in DEFAULTS, are written by `config role` AND materialized by
  // `reconcile sync`/`config init`, and resolved by the resolver — so the closed key-set
  // (config set + validate --effective top-level sweep) MUST accept them, else
  // `validate --effective` would reject the very keys `config role`/`config init` write
  // (Codex G-lane MUST-FIX). Their CONTENT is validated by validateRoles/validateHostProfiles.
  "roles",
  "host_profiles",
]);

// ---------------------------------------------------------------------------
// Role aliases (SC-W1-7 / AC14) — the host-native role-pin surface
// ---------------------------------------------------------------------------

/**
 * The three role-pin aliases. `config role <alias> <host_id|null>` writes `roles.<alias>`
 * to the scoped settings file. CLOSED set — mirrors read-guild-config.ts VALID_ROLES_KEYS;
 * the VALUE (a known registry host_id or null) is validated by the imported `validateRoles`,
 * so the single SoT for the host-id vocabulary stays in read-guild-config.ts (no drift).
 *
 * NOTE: the role-pin `host` (a registry host_id under `roles.host`) is DISTINCT from the
 * top-level `host` dispatch-selector (`claude|codex|auto`, set via `config set host …`).
 * The 5 registry ids (claude/codex/.agents/pi/antigravity) live only under the
 * `roles.*` and `host_profiles.*` blocks.
 */
const ROLE_ALIASES = new Set(["host", "advisory", "adversarial"]);

/** Known canonical registry host ids — value set for roles/host_profiles. */
const KNOWN_HOST_IDS = new Set<string>(HOST_IDS);

/** `host_profiles.<host_id>.enabled` — the one host_profiles leaf that must coerce to a boolean. */
const HP_ENABLED_RE = /^host_profiles\.[^.]+\.enabled$/;

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
  "importanceAtIngest",
  "ingestSimilarityGate",
  "shortOutputThreshold",
  // L5 (V12): models.knowledge.* is a CONFIG_SCHEMA + CONFIG_UI_METADATA key block the
  // resolver already round-trips (settings-reader VALID_MODELS_KEYS) — it MUST be writable
  // via `config set` / `config ui set` too, else the knowledge-tier knobs are uneditable.
  "knowledge",
]);

/** Valid sub-keys for models.tiers.* */
const MODELS_TIERS_KEYS = new Set(["cheap", "mid", "powerful"]);

/** Valid sub-keys for models.thresholds.* (finding #2 — only mid|powerful) */
const MODELS_THRESHOLDS_KEYS = new Set(["mid", "powerful"]);

/** Valid sub-keys for models.cacheTTL.* */
const MODELS_CACHETL_KEYS = new Set(["coordinator", "leaf"]);

/** Valid sub-keys for models.knowledge.* (mirrors KnowledgeConfigBlock in settings-reader). */
const MODELS_KNOWLEDGE_KEYS = new Set([
  "maxDepth",
  "maxBranching",
  "minTopicImportance",
  "relMinConf",
  "maxFiles",
  "maxTokens",
  "batchSize",
]);

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
      } else if (seg1 === "knowledge") {
        if (!MODELS_KNOWLEDGE_KEYS.has(seg2)) {
          return `unknown models.knowledge key "${seg2}" (valid: ${[...MODELS_KNOWLEDGE_KEYS].join("|")})`;
        }
        // knowledge leaves are scalars — reject any deeper path (e.g.
        // models.knowledge.maxDepth.foo) so an unknown nested key can't be persisted.
        if (parts.length > 3) {
          return `models.knowledge.${seg2} is a scalar — "${keyPath}" has an invalid deeper path`;
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

  // roles.* — closed sub-key set {host, advisory, adversarial}; each a scalar host-id/null.
  if (top === "roles") {
    if (!ROLE_ALIASES.has(seg1)) {
      return `unknown roles key "${seg1}" (closed key set — only host, advisory, adversarial)`;
    }
    if (parts.length > 2) {
      return `key path "${keyPath}" is too deep — roles.${seg1} is a scalar (host_id or null)`;
    }
    return null;
  }

  // host_profiles.* — keyed by KNOWN registry host_id; deeper content (models/enabled)
  // is validated by validateHostProfiles at validate --effective time.
  if (top === "host_profiles") {
    if (!normalizeHostId(seg1)) {
      return `unknown host_profiles host_id "${seg1}" (closed key set — valid: ${[...KNOWN_HOST_IDS].join("|")})`;
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
  // L5 (V12): knowledge-tier integer knobs — coerce so the resolver (which requires a
  // number) keeps them instead of dropping a string value.
  "models.knowledge.maxDepth",
  "models.knowledge.maxBranching",
  "models.knowledge.maxFiles",
  "models.knowledge.maxTokens",
  "models.knowledge.batchSize",
]);

/** Paths that must be numbers (possibly non-integer). */
const NUMBER_PATHS = new Set([
  "defaults.index.kg_size_threshold_mb",
  "defaults.capability_manifest_ttl_s",    // R-018: positive number (seconds)
  "models.recallScoreThreshold",
  "models.ingestSimilarityGate",
  // L5 (V12): knowledge-tier [0,1] ratio knobs.
  "models.knowledge.minTopicImportance",
  "models.knowledge.relMinConf",
]);

/**
 * Numeric RANGE constraints — write-time validation MUST mirror the resolver's accepted
 * range, else the config API persists a value that fresh resolveSettings silently drops to
 * default (validate-before-persist would be a lie). Mirrors KnowledgeConfigBlock parsing in
 * settings-reader.ts: depth/branching/files/tokens/batch are `>= 1`; the two ratios are [0,1].
 */
const NUMERIC_RANGE: Record<string, { min: number; max?: number }> = {
  // resolver enforces [0,1] (settings-reader.ts: ingestSimilarityGate guard) — mirror it so an
  // out-of-range value is rejected write-time, not accepted-then-silently-dropped (V12).
  "models.ingestSimilarityGate": { min: 0, max: 1 },
  "models.knowledge.maxDepth": { min: 1 },
  "models.knowledge.maxBranching": { min: 1 },
  "models.knowledge.maxFiles": { min: 1 },
  "models.knowledge.maxTokens": { min: 1 },
  "models.knowledge.batchSize": { min: 1 },
  "models.knowledge.minTopicImportance": { min: 0, max: 1 },
  "models.knowledge.relMinConf": { min: 0, max: 1 },
};

/** Range-check `n` for `keyPath`; returns an error string or null. */
function rangeError(keyPath: string, n: number, raw: string): string | null {
  const r = NUMERIC_RANGE[keyPath];
  if (!r) return null;
  if (n < r.min || (r.max !== undefined && n > r.max)) {
    const bound = r.max !== undefined ? `in [${r.min}, ${r.max}]` : `>= ${r.min}`;
    return `value for "${keyPath}" must be ${bound} (got "${raw}") — the resolver drops out-of-range values to default`;
  }
  return null;
}

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
  // roles.<alias> — value must be null/none or a known registry host_id (same vocab as
  // `config role`; a typo like "claudee" is rejected, not silently written).
  if (keyPath.startsWith("roles.") && ROLE_ALIASES.has(keyPath.slice("roles.".length))) {
    if (rawValue === "null" || rawValue === "none") return null;
    if (!normalizeHostId(rawValue)) {
      return `invalid value "${rawValue}" for key "${keyPath}" — valid: ${[...KNOWN_HOST_IDS].join("|")} or null`;
    }
    return null;
  }

  // roles whole-block set (`config set roles '{…}'`) — strict content validation.
  if (keyPath === "roles") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      return `value for "roles" looks like JSON but failed to parse: ${rawValue}`;
    }
    if (!isPlainObject(parsed)) return `value for "roles" must be an object { host?, advisory?, adversarial? }`;
    const rejects = validateRoles(parsed);
    return rejects.length > 0 ? rejects[0] : null;
  }

  // host_profiles whole-block / entry / sub-path — strict content validation via the
  // single-SoT validateHostProfiles. Without this, `config set host_profiles.claude
  // '{"models":{"cheap":123}}'` (or `…claude.foo true`) would write an invalid shape that
  // the resolver silently DROPS (filterHostProfiles), so `validate --effective` would
  // never see it (Codex G-lane MAJOR). Reconstruct the would-be block and validate it.
  if (keyPath === "host_profiles" || keyPath.startsWith("host_profiles.")) {
    if (HP_ENABLED_RE.test(keyPath) && rawValue !== "true" && rawValue !== "false") {
      return `value for "${keyPath}" must be true or false (got "${rawValue}")`;
    }
    const coerced = coerceValue(keyPath, rawValue);
    let block: Record<string, unknown>;
    if (keyPath === "host_profiles") {
      if (!isPlainObject(coerced)) return `value for "host_profiles" must be an object keyed by host_id`;
      block = coerced;
    } else {
      const parts = keyPath.split("."); // host_profiles.<id>[.rest…]
      const id = parts[1];
      const rest = parts.slice(2);
      const entry = rest.length === 0 ? coerced : deepSet({}, rest.join("."), coerced);
      block = { [id]: entry };
    }
    const rejects = validateHostProfiles(block);
    return rejects.length > 0 ? rejects[0] : null;
  }

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
    return rangeError(keyPath, n, rawValue);
  }

  // Numeric (possibly non-integer) keys
  if (NUMBER_PATHS.has(keyPath)) {
    const n = Number(rawValue);
    if (!Number.isFinite(n)) {
      return `value for "${keyPath}" must be a number (got "${rawValue}")`;
    }
    return rangeError(keyPath, n, rawValue);
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
  // roles.<alias> clear: null|none ⇒ null.
  if ((rawValue === "null" || rawValue === "none") && keyPath.startsWith("roles.")) {
    return null;
  }
  if (keyPath.startsWith("roles.") && ROLE_ALIASES.has(keyPath.slice("roles.".length))) {
    return normalizeHostId(rawValue) ?? rawValue;
  }
  // host_profiles.<id>.enabled ⇒ boolean (validateValue guarantees the true|false literal).
  if (HP_ENABLED_RE.test(keyPath)) {
    return rawValue === "true";
  }
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

function normalizeHostProfileKeyPath(keyPath: string): string {
  if (keyPath === "host_profiles" || !keyPath.startsWith("host_profiles.")) return keyPath;
  const parts = keyPath.split(".");
  const canonical = normalizeHostId(parts[1]);
  if (canonical) parts[1] = canonical;
  return parts.join(".");
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
// Provenance sidecar (P1 never-clobber contract reuse — SC-W1-7)
// ---------------------------------------------------------------------------

/** One provenance-sidecar record — the EXACT shape config-reconcile.ts reads/writes. */
interface ProvenanceRecord {
  provenance: FieldProvenance;
  last_reconciled_at: string | null;
}

/**
 * The provenance sidecar path for a settings file. Mirrors config-reconcile.ts:
 * `settings.json → settings.provenance.json` (the file the reconciler reads to gate
 * clobbering), and by the same rule `settings.local.json → settings.local.provenance.json`.
 */
function provenanceSidecarFor(settingsFile: string): string {
  return settingsFile.replace(/\.json$/, ".provenance.json");
}

/**
 * Stamp `key` as `user`-provenance (+ a UTC timestamp) in the scope's provenance sidecar,
 * reusing the P1 reconcile never-clobber contract: a `user` value is IMMUTABLE to the
 * reconciler (`mayReconcileWrite` returns false), so an explicit role pin is never
 * clobbered by a later `reconcile sync|repair`. Read-modify-write — preserves every
 * sibling record. Provenance is ADVISORY: if the existing sidecar is malformed we warn and
 * skip rather than corrupt it (the role write itself already succeeded, and a value with no
 * sidecar record is treated as `user` ⇒ still never-clobbered). Returns a status note.
 */
function stampUserProvenance(settingsFile: string, key: string, now: string): string {
  const sidecar = provenanceSidecarFor(settingsFile);
  let existing: Record<string, ProvenanceRecord> = {};
  if (fs.existsSync(sidecar)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(sidecar, "utf8")) as unknown;
      if (isPlainObject(parsed)) existing = parsed as Record<string, ProvenanceRecord>;
      else return `provenance sidecar ${path.basename(sidecar)} is not an object — left untouched (role still never-clobbered)`;
    } catch {
      return `provenance sidecar ${path.basename(sidecar)} is malformed — left untouched (role still never-clobbered)`;
    }
  }
  existing[key] = { provenance: "user", last_reconciled_at: now };
  fs.mkdirSync(path.dirname(sidecar), { recursive: true });
  fs.writeFileSync(sidecar, JSON.stringify(existing, null, 2) + "\n");
  return `provenance: ${key} → user @ ${now} (${path.basename(sidecar)})`;
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
  // LW1-6 schema extension: validate the CONTENT of the role pins + per-host overrides
  // (closed sub-keys + known host-ids) so `validate --effective` accepts valid roles/
  // host_profiles and flags malformed ones — consistent with what `config role` writes.
  if (isPlainObject(config["roles"])) {
    violations.push(...validateRoles(config["roles"] as Record<string, unknown>));
  }
  if (isPlainObject(config["host_profiles"])) {
    violations.push(...validateHostProfiles(config["host_profiles"] as Record<string, unknown>));
  }

  return violations;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  subcommand: "set" | "role" | "show" | "validate" | "providers" | "update-mcp-hashes" | "reconcile" | "ui";
  /** For subcommand=providers: the sub-verb (e.g. "detect"). */
  providersVerb?: string;
  /** For subcommand=ui: the sub-verb (list|get|sources|set). */
  uiVerb?: string;
  /** For subcommand=reconcile: the mode (check|sync|repair). */
  reconcileMode?: ReconcileMode;
  /** For subcommand=update-mcp-hashes: path to JSON file with tool-name→description map. */
  toolsFile?: string;
  key?: string;
  rawValue?: string;
  /** For subcommand=role: the role alias (host|advisory|adversarial). */
  roleAlias?: string;
  scope?: "workspace" | "project" | "local";
  cwd: string;
  showSources: boolean;
  /** For subcommand=show: --render (per-host config render). */
  showRender: boolean;
  validateEffective: boolean;
  selfBuild: boolean;
  /** For subcommand=ui: the registry host id the surface renders for (--host). */
  uiHost?: string;
  /** For subcommand=ui: restrict to one config group (--group). */
  uiGroup?: string;
  /** For subcommand=ui set: the operator-supplied confirmation token (--confirm). */
  uiConfirm?: string;
}

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  const args = argv.slice(2);
  if (args.length === 0) {
    return {
      error:
        "Usage: config-cmd.ts <set|role|show|validate|providers|ui> [options...]\n" +
        "  set <key> <value> --scope workspace|project|local [--cwd <p>]\n" +
        "  role <host|advisory|adversarial> <host_id|null> --scope workspace|project|local [--cwd <p>]\n" +
        "  show --sources [--render] [--cwd <p>]\n" +
        "  show --render [--cwd <p>]\n" +
        "  validate --effective [--cwd <p>]\n" +
        "  providers detect [--cwd <p>]\n" +
        "  ui <list|get|sources|set> [--host <id>] [--group <g>] [--cwd <p>]\n" +
        "  ui set <key> <value> --scope workspace|project|local [--confirm <strength>] [--host <id>] [--cwd <p>]\n" +
        "  update-mcp-hashes --tools <json-file> --scope workspace|project|local [--cwd <p>]\n" +
        "  reconcile <check|sync|repair> [--cwd <p>]   (config init = reconcile sync)",
    };
  }

  const sub = args[0];
  if (sub !== "set" && sub !== "role" && sub !== "show" && sub !== "validate" && sub !== "providers" && sub !== "update-mcp-hashes" && sub !== "reconcile" && sub !== "ui") {
    return { error: `unknown subcommand "${sub}" — expected: set, role, show, validate, providers, ui, update-mcp-hashes, reconcile` };
  }

  // P1-L9: reconcile takes a required mode positional (check|sync|repair).
  let reconcileMode: ReconcileMode | undefined;
  if (sub === "reconcile") {
    const m = args[1];
    if (!m || m.startsWith("--") || !(RECONCILE_MODES as readonly string[]).includes(m)) {
      return { error: `reconcile requires a mode — expected: ${RECONCILE_MODES.join("|")} (e.g. reconcile sync [--cwd <p>])` };
    }
    reconcileMode = m as ReconcileMode;
  }

  let key: string | undefined;
  let rawValue: string | undefined;
  let scope: ParsedArgs["scope"];
  let cwd = process.cwd();
  let showSources = false;
  let showRender = false;
  let validateEffective = false;
  let selfBuild = false;
  let providersVerb: string | undefined;
  let uiVerb: string | undefined;
  let uiHost: string | undefined;
  let uiGroup: string | undefined;
  let uiConfirm: string | undefined;

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

  // For `ui`, the second positional is the sub-verb (list|get|sources|set).
  if (sub === "ui") {
    if (args[1] && !args[1].startsWith("--")) {
      uiVerb = args[1];
      if (uiVerb !== "list" && uiVerb !== "get" && uiVerb !== "sources" && uiVerb !== "set") {
        return { error: `unknown ui sub-verb "${uiVerb}" — expected: list, get, sources, set` };
      }
    } else {
      return { error: "ui requires a sub-verb — expected: ui <list|get|sources|set> [options...]" };
    }
  }

  // Parse flags from the rest of the args (skip the sub-verb/mode for providers/reconcile/ui)
  const flagStart = sub === "providers" || sub === "reconcile" || sub === "ui" ? 2 : 1;
  const positionals: string[] = [];
  let toolsFile: string | undefined;
  for (let i = flagStart; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--sources") {
      showSources = true;
    } else if (arg === "--render") {
      showRender = true;
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
    } else if (arg === "--host" && args[i + 1]) {
      uiHost = args[++i];
    } else if (arg.startsWith("--host=")) {
      uiHost = arg.slice("--host=".length);
    } else if (arg === "--group" && args[i + 1]) {
      uiGroup = args[++i];
    } else if (arg.startsWith("--group=")) {
      uiGroup = arg.slice("--group=".length);
    } else if (arg === "--confirm" && args[i + 1]) {
      uiConfirm = args[++i];
    } else if (arg.startsWith("--confirm=")) {
      uiConfirm = arg.slice("--confirm=".length);
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

  let roleAlias: string | undefined;
  if (sub === "role") {
    [roleAlias, rawValue] = positionals;
    if (!roleAlias || rawValue === undefined) {
      return { error: "role requires: <host|advisory|adversarial> <host_id|null>" };
    }
    if (!scope) {
      return { error: "role requires --scope workspace|project|local" };
    }
  }

  if (sub === "update-mcp-hashes" && !scope) {
    return { error: "update-mcp-hashes requires --scope workspace|project|local" };
  }

  // `ui get` / `ui set` positionals (key, and value for set) + scope requirement for `ui set`.
  if (sub === "ui") {
    if (uiVerb === "get") {
      [key] = positionals;
      if (!key) return { error: "ui get requires: <key> [--host <id>] [--cwd <p>]" };
    } else if (uiVerb === "set") {
      [key, rawValue] = positionals;
      if (!key || rawValue === undefined) {
        return { error: "ui set requires: <key> <value> [--scope workspace|project|local] [--confirm <strength>]" };
      }
      // §E12: default child-session writes target PROJECT scope; an explicit `local`
      // scope writes the gitignored settings.local.json. Workspace must be explicit.
      if (!scope) scope = "project";
    }
  }

  return {
    subcommand: sub,
    providersVerb,
    uiVerb,
    reconcileMode,
    toolsFile,
    key,
    rawValue,
    roleAlias,
    scope,
    cwd,
    showSources,
    showRender,
    validateEffective,
    selfBuild,
    uiHost,
    uiGroup,
    uiConfirm,
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
  const writeKeyPath = normalizeHostProfileKeyPath(keyPath);
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
    readModifyWrite(targetFile, writeKeyPath, coerced);
  } catch (e) {
    process.stdout.write(`[config-cmd] ERROR: ${(e as Error).message}\n`);
    return 1;
  }

  // 6. Print what was written and where
  const valueDisplay = JSON.stringify(coerced);
  const fileName = path.basename(targetFile);
  process.stdout.write(
    `[config-cmd] SET ${writeKeyPath} = ${valueDisplay}\n` +
      `  scope: ${scope}\n` +
      `  file:  ${targetFile}\n` +
      `  written: ${fileName}\n`
  );

  return 0;
}

// ---------------------------------------------------------------------------
// Scoped settings-file resolution (shared by role; mirrors cmdSet)
// ---------------------------------------------------------------------------

/** Resolve the settings file for a scope, or an error string for an unfound workspace root. */
function resolveScopedSettingsFile(
  scope: "workspace" | "project" | "local",
  cwd: string
): { file: string } | { error: string } {
  if (scope === "workspace") {
    const wsRoot = discoverWorkspaceRoot(cwd);
    if (!wsRoot) {
      return {
        error:
          `--scope workspace requires a workspace root ` +
          `(found by checking ${cwd} and walking up for .guild/workspace.json with is_workspace:true)`,
      };
    }
    return { file: path.join(wsRoot, ".guild", "settings.json") };
  }
  if (scope === "project") return { file: path.join(cwd, ".guild", "settings.json") };
  return { file: path.join(cwd, ".guild", "settings.local.json") };
}

// ---------------------------------------------------------------------------
// Subcommand: role (SC-W1-7 / AC14) — host-native role-pin aliases
// ---------------------------------------------------------------------------

/**
 * `config role <host|advisory|adversarial> <host_id|null> --scope workspace|project|local`.
 *
 * Writes `roles.<alias>` to the correct scoped settings file (workspace/project →
 * settings.json; local → settings.local.json), reusing the P1 reconcile never-clobber
 * contract: the pin is stamped `user`-provenance + a UTC timestamp in the scope's
 * provenance sidecar, so a later `reconcile sync|repair` never clobbers it. The write is a
 * read-modify-write — it NEVER overwrites a sibling role pin (or any other key). The
 * host-id vocabulary is validated by the imported `validateRoles` (single SoT in
 * read-guild-config.ts). Pass `null` or `none` to clear a pin back to auto-resolve.
 */
function cmdRole(
  alias: string,
  rawValue: string,
  scope: "workspace" | "project" | "local",
  cwd: string
): number {
  // 1. Validate the alias against the closed role set.
  if (!ROLE_ALIASES.has(alias)) {
    process.stdout.write(
      `[config-cmd] ERROR: unknown role "${alias}" — valid: ${[...ROLE_ALIASES].join("|")}\n`
    );
    return 1;
  }

  // 2. Coerce the value: null|none ⇒ null (clear the pin); else the literal host_id.
  const coerced: string | null =
    rawValue === "null" || rawValue === "none" ? null : rawValue;

  // 3. Validate the value via the imported validateRoles (closed host-id set — no drift).
  const rejects = validateRoles({ [alias]: coerced });
  if (rejects.length > 0) {
    for (const r of rejects) process.stdout.write(`[config-cmd] ERROR: ${r}\n`);
    return 1;
  }

  // 4. Resolve the scoped target file.
  const resolved = resolveScopedSettingsFile(scope, cwd);
  if ("error" in resolved) {
    process.stdout.write(`[config-cmd] ERROR: ${resolved.error}\n`);
    return 1;
  }
  const targetFile = resolved.file;
  const keyPath = `roles.${alias}`;

  // 5. Read-modify-write the role pin — FAILS CLOSED on malformed JSON; preserves siblings.
  try {
    readModifyWrite(targetFile, keyPath, coerced);
  } catch (e) {
    process.stdout.write(`[config-cmd] ERROR: ${(e as Error).message}\n`);
    return 1;
  }

  // 6. Stamp never-clobber provenance (advisory — a sidecar failure never fails the write).
  const now = new Date().toISOString();
  const provNote = stampUserProvenance(targetFile, keyPath, now);

  // 7. Report exactly what was written and where.
  process.stdout.write(
    `[config-cmd] ROLE ${keyPath} = ${JSON.stringify(coerced)}\n` +
      `  scope: ${scope}\n` +
      `  file:  ${targetFile}\n` +
      `  ${provNote}\n`
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

  // ── phase-permission decisions (SC-W1-8 / AC23) ─────────────────────────────
  // Annotate every resolved (phase × gate-type) permission decision — the P1
  // host_mode × guild_gates × bypass triple — with the inheritance layer each input
  // resolved from. The baseline golden derives guild_gates from `auto_approve` and
  // bypass from `security.bypass_permissions_policy`; host_mode is the host default
  // (`ask`, builtin). So each cell's layer = the layer of the key that drives it.
  appendPermissionSourceLines(lines, config, sources);

  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

// ---------------------------------------------------------------------------
// Phase-permission decision layers (shared by show --sources and show --render)
// ---------------------------------------------------------------------------

/** The two config inputs the baseline-golden resolver reads (+ a safe default). */
function permissionInputs(config: ReturnType<typeof resolveSettings>["config"]): {
  auto_approve: string[];
  bypass_permissions_policy: BypassPolicy;
} {
  const auto_approve = Array.isArray(config.auto_approve) ? config.auto_approve : [];
  const bp = config.security?.bypass_permissions_policy;
  const bypass_permissions_policy: BypassPolicy =
    bp === "deny" || bp === "allow" || bp === "audit" ? bp : "audit";
  return { auto_approve, bypass_permissions_policy };
}

/**
 * Append a "phase-permission decisions" section: one line per (phase × gate-type) cell,
 * each annotating host_mode / guild_gates / bypass with the inheritance layer that drove
 * it. `auto_approve` drives guild_gates; `security.bypass_permissions_policy` drives
 * bypass; host_mode is the builtin host default. settings-resolver tracks sources at the
 * top-level-key granularity, so the security-block layer annotates bypass.
 */
function appendPermissionSourceLines(
  lines: string[],
  config: ReturnType<typeof resolveSettings>["config"],
  sources: Record<string, Source>
): void {
  const { auto_approve, bypass_permissions_policy } = permissionInputs(config);
  const golden = resolveBaselineGolden({ auto_approve, bypass_permissions_policy });

  const gatesSrc: Source = (sources["auto_approve"] as Source) ?? "builtin";
  const bypassSrc: Source = (sources["security"] as Source) ?? "builtin";
  const hostModeSrc: Source = "builtin"; // baseline host_mode is the host default

  lines.push("");
  lines.push("── phase-permission decisions (host_mode × guild_gates × bypass) ──");
  lines.push(
    `inputs: auto_approve=${JSON.stringify(auto_approve)} [${gatesSrc}]  ·  ` +
      `security.bypass_permissions_policy=${bypass_permissions_policy} [${bypassSrc}]  ·  ` +
      `host_mode baseline=ask [${hostModeSrc}]`
  );
  for (const phase of PHASES) {
    for (const gate of GATE_TYPES) {
      const key = cellKey(phase, gate);
      const d: PermissionDecision = golden[key];
      lines.push(
        `${key.padEnd(18)} host_mode=${d.host_mode} [${hostModeSrc}]  ` +
          `guild_gates=${d.guild_gates} [${gatesSrc}]  bypass=${d.bypass} [${bypassSrc}]`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Subcommand: show --render (SC-W1-8) — per-host config render
// ---------------------------------------------------------------------------

/**
 * `config show --render` — render the RESOLVED config + the P1 phase-permission block
 * into each of the 5 host native config shapes (claude / codex / .agents / pi /
 * antigravity) via the LW1-6 `renderAllHostConfigs` core. READ-ONLY (prints; never
 * writes). The resolver's per-key `sources` map is passed in so the renderer's
 * fail-closed local-scope guard can WITHHOLD any gitignored (workspace-local /
 * project-local) value from a would-be-shared host output. A render with `blocked:true`
 * means a real shared write of that host's config would be refused (a local/secret leak
 * was detected); this inspection surface flags it but still exits 0.
 */
function cmdShowRender(cwd: string): number {
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
  const { auto_approve, bypass_permissions_policy } = permissionInputs(config);
  const permissions = resolveBaselineGolden({ auto_approve, bypass_permissions_policy });

  const renderedAt = new Date().toISOString();
  const renders = renderAllHostConfigs({
    config: config as unknown as RenderConfigLike,
    permissions,
    sources: sources as unknown as Record<string, ConfigSource>,
    options: { renderedAt },
  });

  const lines: string[] = [];
  lines.push(`[config-cmd] show --render — per-host config (5 hosts)`);
  lines.push(`  rendered_at : ${renderedAt}`);
  lines.push("");

  let anyBlocked = false;
  for (const hostId of Object.keys(renders) as Array<keyof typeof renders>) {
    const r = renders[hostId];
    if (r.blocked) anyBlocked = true;
    const modelStr = r.models
      ? `cheap=${r.models.cheap ?? "—"} mid=${r.models.mid ?? "—"} powerful=${r.models.powerful ?? "—"}`
      : "(none)";
    const permCount = r.permissions ? Object.keys(r.permissions).length : 0;
    lines.push(
      `▸ ${String(hostId).padEnd(11)} family=${r.family} surface=${r.surface_kind} ` +
        `provenance=${r.provenance}  ok=${r.ok}${r.blocked ? " BLOCKED" : ""}`
    );
    lines.push(`    models      : ${modelStr}`);
    lines.push(`    permissions : ${permCount} cell(s)${r.roles ? `  · roles=${JSON.stringify(r.roles)}` : ""}`);
    if (r._unsupported && r._unsupported.length > 0) {
      lines.push(`    _unsupported: ${r._unsupported.map((u) => u.field).join(", ")}`);
    }
    if (r._redactions && r._redactions.length > 0) {
      lines.push(
        `    _redactions : ${r._redactions
          .map((x) => `${x.field}(${x.reason})`)
          .join(", ")}`
      );
    }
  }

  if (anyBlocked) {
    lines.push("");
    lines.push(
      `  ⚠ one or more host renders are BLOCKED (fail-closed): a local-scope or secret ` +
        `value was detected — a real shared write of that host config would be refused.`
    );
  }

  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: ui (§E11/§E12) — native CLI/agents-file settings render + edit
// ---------------------------------------------------------------------------

/** Default registry host for the UI surface when --host is omitted (this CLI host). */
const DEFAULT_UI_HOST = "claude-code-cli";

/** Resolve + validate the --host id (any registry id; app/connector ids render `blocked`). */
function resolveUiHost(uiHost: string | undefined): { host: string } | { error: string } {
  const host = uiHost ?? DEFAULT_UI_HOST;
  if (!(HOST_IDS as readonly string[]).includes(host)) {
    return {
      error:
        `unknown --host "${host}" — valid registry host ids: ${HOST_IDS.join(", ")}`,
    };
  }
  return { host };
}

/**
 * Resolve settings and build the host config-UI surface for `host` (optionally one group).
 * Reuses the same permission-block derivation as `show --render` so the embedded
 * `native_render` is identical to that command's output (single SoT).
 */
function buildUiSurfaceFor(
  cwd: string,
  host: string,
  group: string | undefined
): { surface: HostConfigUiSurface } | { error: string } {
  let result: ReturnType<typeof resolveSettings>;
  try {
    result = resolveSettings({ cwd });
  } catch (e) {
    return { error: `could not resolve settings — ${(e as Error).message}` };
  }
  const { config, sources } = result;
  const { auto_approve, bypass_permissions_policy } = permissionInputs(config);
  const permissions = resolveBaselineGolden({ auto_approve, bypass_permissions_policy });
  const surface = buildHostConfigUiSurface({
    host,
    config: config as unknown as RenderConfigLike & Record<string, unknown>,
    sources: sources as unknown as Record<string, ConfigSource>,
    permissions,
    renderedAt: new Date().toISOString(),
    groupFilter: group,
  });
  return { surface };
}

/** One key row, formatted for the panel. Confirmation/safety annotations are always shown. */
function formatKeyRow(v: ConfigUiKeyView): string[] {
  const lines: string[] = [];
  const dep = v.deprecated ? " (deprecated)" : "";
  lines.push(`  • ${v.key}${dep}`);
  lines.push(`      ${v.label}  ·  ${v.control}  ·  value=${v.value}  [${v.source}]${v.unset ? " (default)" : ""}`);
  lines.push(
    `      safety=${v.safety_class}  confirm=${v.confirmation_strength}  ` +
      `scopes=${v.scope_support.join("/")}  edit=${v.editability}  component=${v.native_component}`
  );
  return lines;
}

/** Print a blocked-host advisory panel (app/connector hosts — no native surface). */
function printBlockedSurface(s: HostConfigUiSurface, lines: string[]): void {
  lines.push(`[config-cmd] ui — host "${s.host_id}" (family=${s.family} surface=${s.surface_kind})`);
  lines.push(`  ⚠ BLOCKED — no native config surface for this host in this build.`);
  lines.push(
    `  App/connector hosts are an OPEN blocker (L0): only CLI/agents-file hosts ` +
      `(${[...CLI_NATIVE_HOSTS].join(", ")}) have a native render/edit surface.`
  );
}

/**
 * `config ui list` — the native grouped settings panel (§E11): config groups → keys, each
 * with its CONFIG_UI_METADATA (label/control/scope/safety/confirmation/component) + the
 * resolved value and the layer it won from. App/connector hosts report `blocked`.
 */
function cmdUiList(cwd: string, uiHost: string | undefined, group: string | undefined): number {
  const hostRes = resolveUiHost(uiHost);
  if ("error" in hostRes) {
    process.stdout.write(`[config-cmd] ERROR: ${hostRes.error}\n`);
    return 1;
  }
  const built = buildUiSurfaceFor(cwd, hostRes.host, group);
  if ("error" in built) {
    process.stdout.write(`[config-cmd] ERROR: ${built.error}\n`);
    return 1;
  }
  const s = built.surface;
  const lines: string[] = [];
  if (s.blocked) {
    printBlockedSurface(s, lines);
    process.stdout.write(lines.join("\n") + "\n");
    return 0;
  }

  lines.push(
    `[config-cmd] ui list — host "${s.host_id}" (family=${s.family} surface=${s.surface_kind} provenance=${s.provenance})`
  );
  lines.push(`  ${s.key_count} key(s) across ${s.groups.length} group(s)${group ? ` (group=${group})` : ""}`);
  if (group && s.groups.length === 0) {
    lines.push(`  (no keys for group "${group}")`);
  }
  for (const g of s.groups) {
    lines.push("");
    lines.push(`▸ ${g.group}  (${g.keys.length})`);
    for (const v of g.keys) lines.push(...formatKeyRow(v));
  }
  // Reuse the embedded host-native render summary (models / permission-cell count).
  const r = s.native_render;
  if (r) {
    lines.push("");
    const modelStr = r.models
      ? `cheap=${r.models.cheap ?? "—"} mid=${r.models.mid ?? "—"} powerful=${r.models.powerful ?? "—"}`
      : "(none)";
    lines.push(`  native projection: models[${modelStr}]  permissions=${r.permissions ? Object.keys(r.permissions).length : 0} cell(s)`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

/** `config ui get <key>` — render a single key row (§E11). */
function cmdUiGet(cwd: string, key: string, uiHost: string | undefined): number {
  const hostRes = resolveUiHost(uiHost);
  if ("error" in hostRes) {
    process.stdout.write(`[config-cmd] ERROR: ${hostRes.error}\n`);
    return 1;
  }
  const built = buildUiSurfaceFor(cwd, hostRes.host, undefined);
  if ("error" in built) {
    process.stdout.write(`[config-cmd] ERROR: ${built.error}\n`);
    return 1;
  }
  const s = built.surface;
  const lines: string[] = [];
  if (s.blocked) {
    printBlockedSurface(s, lines);
    process.stdout.write(lines.join("\n") + "\n");
    return 0;
  }
  let found: ConfigUiKeyView | undefined;
  for (const g of s.groups) {
    found = g.keys.find((k) => k.key === key);
    if (found) break;
  }
  if (!found) {
    process.stdout.write(
      `[config-cmd] ERROR: unknown config key "${key}" — not in the CONFIG_UI_METADATA table (or not visible to host "${s.host_id}")\n`
    );
    return 1;
  }
  lines.push(`[config-cmd] ui get — host "${s.host_id}"`);
  lines.push(...formatKeyRow(found));
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

/**
 * `config ui sources` — the value/layer panel (§E11), grouped: every visible key with its
 * resolved value and the inheritance layer it won from. Compact form of `ui list` focused
 * on the source column. App/connector hosts report `blocked`.
 */
function cmdUiSources(cwd: string, uiHost: string | undefined, group: string | undefined): number {
  const hostRes = resolveUiHost(uiHost);
  if ("error" in hostRes) {
    process.stdout.write(`[config-cmd] ERROR: ${hostRes.error}\n`);
    return 1;
  }
  const built = buildUiSurfaceFor(cwd, hostRes.host, group);
  if ("error" in built) {
    process.stdout.write(`[config-cmd] ERROR: ${built.error}\n`);
    return 1;
  }
  const s = built.surface;
  const lines: string[] = [];
  if (s.blocked) {
    printBlockedSurface(s, lines);
    process.stdout.write(lines.join("\n") + "\n");
    return 0;
  }
  lines.push(`[config-cmd] ui sources — host "${s.host_id}" (${s.key_count} key(s))`);
  for (const g of s.groups) {
    lines.push("");
    lines.push(`▸ ${g.group}`);
    for (const v of g.keys) {
      lines.push(`    ${v.key} = ${v.value}  [${v.source}]`);
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

/**
 * The plugin config WRITE API the `ui set` adapter delegates ALL persistence to (V10).
 * Default = `cmdSet` (validate-before-write, never-clobber read-modify-write, scoped file).
 * Injectable so the V10 boundary test can SPY the route and prove the adapter performs no
 * `fs` write of its own — and that a direct-fs rewire is caught (the counterexample).
 */
export type ConfigWriteApi = (
  key: string,
  rawValue: string,
  scope: "workspace" | "project" | "local",
  cwd: string
) => number;

/** Reload the resolved config after a successful write. Default = a fresh `resolveSettings`. */
export type ConfigReload = (cwd: string) => {
  config: Record<string, unknown>;
  sources: Record<string, string>;
};

/** Injectable seams for {@link cmdUiSet} — default to the real config API + resolver. */
export interface UiSetDeps {
  readonly persist: ConfigWriteApi;
  readonly reload: ConfigReload;
}

const DEFAULT_UI_SET_DEPS: UiSetDeps = {
  persist: (key, rawValue, scope, cwd) => cmdSet(key, rawValue, scope, cwd),
  reload: (cwd) => {
    const { config, sources } = resolveSettings({ cwd });
    return {
      config: config as unknown as Record<string, unknown>,
      sources: sources as Record<string, string>,
    };
  },
};

/**
 * `config ui set <key> <value> --scope <s> [--confirm <strength>]` — the §E12 persistence path.
 *
 * The surface (config-ui-surface.ts) PLANS the edit: it validates the key + scope and computes
 * the confirmation the metadata DECLARES (advanced/danger/strongest keys require an explicit
 * `--confirm`). The WRITE itself is delegated to the plugin config API (`deps.persist`, default
 * `cmdSet`: validate-before-write, never-clobber read-modify-write, scoped file). The UI adapter
 * does NO `fs` write of its own (V10) — the injectable seam makes that boundary provable.
 *
 * Sequence: PLAN → VALIDATE-BEFORE-PERSIST (reject an invalid candidate before any write, so
 * there is no half-applied state) → PERSIST via the config API → IMMEDIATE RELOAD. A post-write
 * reload failure is a HARD error: it returns NONZERO (V12), never a swallowed WARN. App/connector
 * hosts report `blocked`.
 */
export function cmdUiSet(
  cwd: string,
  key: string,
  rawValue: string,
  scope: "workspace" | "project" | "local",
  uiHost: string | undefined,
  uiConfirm: string | undefined,
  deps: UiSetDeps = DEFAULT_UI_SET_DEPS
): number {
  const hostRes = resolveUiHost(uiHost);
  if ("error" in hostRes) {
    process.stdout.write(`[config-cmd] ERROR: ${hostRes.error}\n`);
    return 1;
  }
  // App/connector host → no native edit surface (mirrors hostOpenPreflight blocked).
  if (!CLI_NATIVE_HOSTS.has(hostRes.host)) {
    process.stdout.write(
      `[config-cmd] ERROR: host "${hostRes.host}" has no native config-edit surface in this build ` +
        `(app/connector hosts are blocked; only ${[...CLI_NATIVE_HOSTS].join(", ")} can edit natively)\n`
    );
    return 1;
  }

  // 1. PLAN the edit — confirmation-strength gate (NO write here, V10).
  const plan = planConfigUiEdit({
    key,
    scope: scope as ConfigScope,
    providedConfirmation: parseConfirmation(uiConfirm),
  });
  if (!plan.ok) {
    process.stdout.write(`[config-cmd] ERROR: ${plan.reason}\n`);
    // Print the confirmation hint ONLY when the confirmation gate is the actual blocker
    // (a scope-support rejection has its own reason and must not also nag about --confirm).
    if ((plan.reason ?? "").includes("confirmation")) {
      process.stdout.write(
        `  This is a ${plan.safety_class} key; re-run with --confirm ${plan.required_confirmation}\n`
      );
    }
    return 1;
  }

  // 2. VALIDATE-BEFORE-PERSIST — reject an invalid candidate edit BEFORE any write, so an
  // invalid value can never leave a half-applied state. (The config API re-validates too;
  // this surfaces the rejection at the adapter boundary and keeps the write strictly gated.)
  const keyErr = validateKeyPath(key);
  if (keyErr) {
    process.stdout.write(`[config-cmd] ERROR: ${keyErr}\n`);
    return 1;
  }
  const valErr = validateValue(key, rawValue);
  if (valErr) {
    process.stdout.write(`[config-cmd] ERROR: ${valErr}\n`);
    return 1;
  }

  // 3. PERSIST through the plugin config API (validate-before-write, never-clobber). The adapter
  // itself writes NOTHING — every byte of mutation goes through this delegated seam (V10).
  const setRc = deps.persist(key, rawValue, scope, cwd);
  if (setRc !== 0) return setRc;

  // 4. IMMEDIATE RELOAD (V12) — a post-write reload failure is a HARD error, not a swallowed
  // WARN: the write landed but the config could not be re-resolved, so return NONZERO and say so.
  let reloaded: { config: Record<string, unknown>; sources: Record<string, string> };
  try {
    reloaded = deps.reload(cwd);
  } catch (e) {
    process.stdout.write(
      `[config-cmd] ERROR: write succeeded but the post-write reload failed — ${(e as Error).message}\n` +
        `  the on-disk write landed but the config could not be re-resolved; run \`config show\` to inspect\n`
    );
    return 1;
  }
  const newVal = getByPathLocal(reloaded.config, key);
  const layer = nearestSource(key, reloaded.sources);
  process.stdout.write(
    `[config-cmd] ui set — reloaded: ${key} = ${JSON.stringify(newVal)}  [${layer}]\n` +
      `  confirmation: ${plan.required_confirmation}${plan.confirmation_required ? " (satisfied)" : " (implicit — standard settings-write ask)"}\n`
  );
  return 0;
}

/** Local dotted-path read for the post-write reload print (kept inline; no surface dependency). */
function getByPathLocal(obj: Record<string, unknown>, dottedKey: string): unknown {
  let cursor: unknown = obj;
  for (const part of dottedKey.split(".")) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/** Nearest inheritance layer for a dotted key (key → ancestors → "builtin"). */
function nearestSource(dottedKey: string, sources: Record<string, string>): string {
  const parts = dottedKey.split(".");
  for (let i = parts.length; i >= 1; i--) {
    const src = sources[parts.slice(0, i).join(".")];
    if (src) return src;
  }
  return "builtin";
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
/** Every settings file that contributes to the resolved config (project + workspace, each layer). */
function contributingSettingsFiles(cwd: string): Array<{ label: string; file: string }> {
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
  return candidates;
}

/**
 * Raw-file sweep of the `roles` / `host_profiles` blocks (Codex G-lane MAJOR).
 *
 * The resolver FAIL-CLOSED drops malformed roles/host_profiles entries
 * (sparseRoles / filterHostProfiles), so the post-inheritance resolved config NEVER
 * carries them — `validateResolved` would validate `{}` and falsely pass. To make
 * `validate --effective` honest, run the STRICT validators (the single-SoT
 * validateRoles / validateHostProfiles) against the RAW block in each contributing file,
 * so an invalid pin or per-host override surfaces no matter how it was written (`config
 * set` blob, sub-path, or a hand-edit).
 */
function collectRawRolesHostProfilesViolations(cwd: string): string[] {
  const violations: string[] = [];
  for (const { label, file } of contributingSettingsFiles(cwd)) {
    if (!fs.existsSync(file)) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      continue; // parse errors are reported by the resolver path
    }
    if (!isPlainObject(parsed)) continue;
    if (isPlainObject(parsed["roles"])) {
      for (const r of validateRoles(parsed["roles"] as Record<string, unknown>)) {
        violations.push(`${r} — raw ${label} (${file})`);
      }
    }
    if (isPlainObject(parsed["host_profiles"])) {
      for (const r of validateHostProfiles(parsed["host_profiles"] as Record<string, unknown>)) {
        violations.push(`${r} — raw ${label} (${file})`);
      }
    }
  }
  return violations;
}

function collectUnknownTopLevelKeyViolations(cwd: string): string[] {
  const violations: string[] = [];
  const candidates = contributingSettingsFiles(cwd);
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
  // Codex G-lane MAJOR: the resolver also DROPS malformed roles/host_profiles entries,
  // so their content must be swept raw-file-side too (the resolved-config check is vacuous).
  violations.push(...collectRawRolesHostProfilesViolations(cwd));

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
// Subcommand: reconcile (P1-L9) — `config init` becomes `reconcile sync`
// ---------------------------------------------------------------------------

/**
 * Run a config reconcile pass. `check` is read-only (drift report); `sync` fills
 * missing keys to default; `repair` additionally coerces malformed default/reconciled
 * values. NEVER overwrites a user value (any mode, any key — security included).
 * On a fresh repo, `reconcile sync` writes a settings.json byte-identical to today's
 * `config init` output.
 */
function cmdReconcile(mode: ReconcileMode, cwd: string): number {
  const now = new Date().toISOString();
  const result = reconcileConfig({ cwd, mode, now });
  process.stdout.write(`[config-cmd] ${summarizeReconcile(result)}\n`);
  const notable = result.findings.filter(
    (f) => f.status !== "ok" && f.status !== "user-override-kept"
  );
  for (const f of notable) {
    process.stdout.write(`  ${f.key}: ${f.status} → ${f.action}\n`);
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

    case "role": {
      if (!parsed.roleAlias || parsed.rawValue === undefined || !parsed.scope) {
        process.stdout.write(
          "[config-cmd] ERROR: role requires <host|advisory|adversarial> <host_id|null> --scope\n"
        );
        process.exit(1);
      }
      exitCode = cmdRole(parsed.roleAlias, parsed.rawValue, parsed.scope, parsed.cwd);
      break;
    }

    case "show": {
      if (!parsed.showSources && !parsed.showRender) {
        process.stdout.write(
          "[config-cmd] ERROR: show requires --sources or --render\n"
        );
        process.exit(1);
      }
      // --sources and --render compose; render prints after the source annotations.
      exitCode = 0;
      if (parsed.showSources) exitCode = cmdShowSources(parsed.cwd);
      if (exitCode === 0 && parsed.showRender) exitCode = cmdShowRender(parsed.cwd);
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

    case "reconcile": {
      if (!parsed.reconcileMode) {
        process.stdout.write(
          `[config-cmd] ERROR: reconcile requires a mode — ${RECONCILE_MODES.join("|")}\n`
        );
        process.exit(1);
      }
      exitCode = cmdReconcile(parsed.reconcileMode, parsed.cwd);
      break;
    }

    case "ui": {
      // §E11/§E12: native CLI/agents-file settings render (list/get/sources) + edit (set).
      switch (parsed.uiVerb) {
        case "list":
          exitCode = cmdUiList(parsed.cwd, parsed.uiHost, parsed.uiGroup);
          break;
        case "sources":
          exitCode = cmdUiSources(parsed.cwd, parsed.uiHost, parsed.uiGroup);
          break;
        case "get":
          if (!parsed.key) {
            process.stdout.write("[config-cmd] ERROR: ui get requires <key>\n");
            process.exit(1);
          }
          exitCode = cmdUiGet(parsed.cwd, parsed.key, parsed.uiHost);
          break;
        case "set":
          if (!parsed.key || parsed.rawValue === undefined || !parsed.scope) {
            process.stdout.write(
              "[config-cmd] ERROR: ui set requires <key> <value> --scope workspace|project|local\n"
            );
            process.exit(1);
          }
          exitCode = cmdUiSet(
            parsed.cwd,
            parsed.key,
            parsed.rawValue,
            parsed.scope,
            parsed.uiHost,
            parsed.uiConfirm
          );
          break;
        default:
          process.stdout.write(
            "[config-cmd] ERROR: ui requires a sub-verb — list|get|sources|set\n"
          );
          exitCode = 1;
      }
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

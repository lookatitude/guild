/**
 * scripts/lib/settings-resolver.ts
 *
 * Usage (library — no CLI, no process.exit):
 *   import { resolveSettings } from "./lib/settings-resolver";
 *   const { config, sources } = resolveSettings({ cwd, flags });
 *
 * Pure settings resolver library. Extracted from read-guild-config.ts.
 * Implements the 5-layer inheritance chain (OD-2):
 *
 *   built-in
 *     < workspace settings.json
 *     < workspace settings.local.json
 *     < project settings.json
 *     < project settings.local.json
 *     < rigor-profile expansion
 *     < CLI flags
 *
 * Workspace discovery: walks UP from cwd to find the nearest ancestor with
 * .guild/workspace.json (is_workspace: true). If found and cwd is a child
 * of that workspace, the workspace settings are layered beneath the project
 * settings.
 *
 * Inheritance policy (§3 / OD-1 / OD-2):
 * - MOST keys inherit: agent_mode, rigor, loops, loop_cap, codex_cap,
 *   review, providers, models, security, secrets_policy, mcp,
 *   defaults.team, defaults.quality, defaults.index, defaults.cross_host, etc.
 * - EXCEPTIONS:
 *   (a) workspace.mode is root-detection-only — NOT inherited from workspace→child.
 *       A child's own workspace.mode applies to the child's detection only.
 *   (b) initiative_default does NOT inherit (OD-1). A child always resolves
 *       its own initiative_default or null (built-in).
 *
 * Per-key source map: every resolved key is tagged with the Source layer it
 * came from ('builtin'|'workspace'|'workspace-local'|'project'|'project-local'|
 * 'rigor'|'cli').
 *
 * Security: deepMerge rejects __proto__, prototype, and constructor keys at
 * every nesting level to prevent prototype pollution.
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Re-exported types from the schema defined in read-guild-config.ts
// ---------------------------------------------------------------------------

export type Source =
  | "builtin"
  | "workspace"
  | "workspace-local"
  | "project"
  | "project-local"
  | "rigor"
  | "cli";

interface QualityBudget {
  per_class_minutes: number;
  total_minutes: number;
}
interface DefaultsBlock {
  auto_learn: boolean;
  adversarial: "on" | "off";
  team: { size: number | null; always_include: string[] };
  review_workflow: "standard" | "cross" | "minimal";
  skill_policy: "standard" | "conservative";
  gates: { auto_approve: string[] };
  wiki: { share_mode: "team" | "private"; autopromote: boolean };
  quality: { budget: QualityBudget };
  reporting: "standard" | "quiet" | "verbose";
  index: IndexBlock;
  cross_host: CrossHostBlock;
}
interface WorkspaceBlock {
  mode: "auto" | "on" | "off";
}
interface TierHostMap {
  claude: string | null;
  codex: string | null;
  gemini: string | null;
}
interface TiersBlock {
  cheap: TierHostMap;
  mid: TierHostMap;
  powerful: TierHostMap;
}
interface CacheTTLBlock {
  coordinator: "1h" | "5m" | "off";
  leaf: "1h" | "5m" | "off";
}
interface ModelsBlock {
  enabled: boolean;
  tiers: TiersBlock;
  scoreWeights: Record<string, number>;
  thresholds: { mid: number; powerful: number };
  advisorRounds: number;
  escalationMarkers: string[];
  recallBeforeRead: boolean;
  recallScoreThreshold: number;
  structuredOutputRequired: boolean;
  cacheTTL: CacheTTLBlock;
  importanceGate: number;
  ingestSimilarityGate: number;
  shortOutputThreshold: Record<string, Record<string, number>>;
}
interface SecurityBlock {
  bypass_permissions_policy: "deny" | "audit" | "allow";
}
interface SecretsPolicyBlock {
  env_allowlist: string[];
  redaction_patterns: string[];
  fail_mode_durable: "closed" | "open";
  fail_mode_telemetry: "open" | "closed";
}
interface McpBlock {
  tool_description_hashes: Record<string, string>;
}
interface IndexBlock {
  enabled: boolean;
  kg_node_threshold: number;
  kg_size_threshold_mb: number;
  links_edge_threshold: number;
  runs_threshold: number;
  wiki_file_threshold: number;
}
interface CrossHostEndpointEntry {
  address: string;
  port?: number;
  user?: string;
}
interface CrossHostBlock {
  enabled: boolean;
  hosts: Record<string, CrossHostEndpointEntry>;
}

/**
 * The fully-resolved Guild settings, with all layers merged and rigor
 * expansion applied. Identical shape to what read-guild-config.ts emits on
 * stdout, plus `_rigorExpanded` for introspection.
 */
export interface ResolvedConfig {
  rigor: "quick" | "standard" | "deep";
  auto_approve: string[];
  review: "local" | "cross" | "off";
  host: "claude" | "codex" | "auto";
  initiative_default: string | null;
  index: "auto" | "off";
  record_status_runs: boolean;
  codex_skip_enforcement: "warn" | "block";
  agent_mode: "team" | "agent" | "subagent" | "auto";
  workspace: WorkspaceBlock;
  models: ModelsBlock;
  security: SecurityBlock;
  secrets_policy: SecretsPolicyBlock;
  mcp: McpBlock;
  loops: string | null;
  loop_cap: number;
  codex_cap: number;
  defaults: DefaultsBlock;
  /** Rigor expansion annotation — always present. */
  _rigorExpanded?: {
    rigor: string;
    loops: string;
    loop_cap: number | null;
    review: string;
    applied: string[];
    overridden_by_explicit: string[];
    review_implied?: string;
    review_fallback?: boolean;
    note?: string;
  };
}

// ---------------------------------------------------------------------------
// Resolver options
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  /** The project root whose settings to resolve. */
  cwd: string;
  /**
   * CLI flag overrides. Only keys present here override the layered result.
   * Accepts any subset of ResolvedConfig keys.
   */
  flags?: Partial<ResolvedConfig>;
  /** When true, apply self-build validation rules (adversarial:off rejected). */
  selfBuild?: boolean;
}

// ---------------------------------------------------------------------------
// Resolver return type
// ---------------------------------------------------------------------------

export interface ResolveResult {
  /** The fully-merged config with all layers applied. */
  config: ResolvedConfig;
  /**
   * Per-key source map. Top-level keys of ResolvedConfig are tracked here.
   * Nested keys (e.g. workspace.mode) use dotted notation in the map.
   */
  sources: Record<string, Source>;
}

// ---------------------------------------------------------------------------
// Built-in defaults — identical to DEFAULTS in read-guild-config.ts
// ---------------------------------------------------------------------------

const DEFAULT_ESCALATION_MARKERS: string[] = [
  "I'm not sure",
  "unclear",
  "cannot determine",
  "I don't know",
  "ambiguous",
  "uncertain",
  "not enough information",
];

const DEFAULTS: ResolvedConfig = {
  rigor: "standard",
  auto_approve: [],
  review: "local",
  host: "auto",
  initiative_default: null,
  index: "auto",
  record_status_runs: true,
  codex_skip_enforcement: "warn",
  agent_mode: "auto",
  workspace: { mode: "auto" },
  models: {
    enabled: true,
    tiers: {
      cheap:    { claude: "haiku",  codex: null, gemini: null },
      mid:      { claude: "sonnet", codex: null, gemini: null },
      powerful: { claude: "opus",   codex: null, gemini: null },
    },
    scoreWeights: {
      workType: 0,
      blastRadius: 1,
      dependsOn: 1,
      security: 1,
      priorEscalation: 1,
    },
    thresholds: { mid: 1, powerful: 3 },
    advisorRounds: 2,
    escalationMarkers: DEFAULT_ESCALATION_MARKERS,
    recallBeforeRead: true,
    recallScoreThreshold: 0.4,
    structuredOutputRequired: true,
    cacheTTL: { coordinator: "1h", leaf: "5m" },
    importanceGate: 3,
    ingestSimilarityGate: 0.80,
    shortOutputThreshold: {},
  },
  security: {
    bypass_permissions_policy: "audit",
  },
  secrets_policy: {
    env_allowlist: [],
    redaction_patterns: [],
    fail_mode_durable: "closed",
    fail_mode_telemetry: "open",
  },
  mcp: {
    tool_description_hashes: {},
  },
  loops: null,
  loop_cap: 16,
  codex_cap: 5,
  defaults: {
    auto_learn: false,
    adversarial: "on",
    team: { size: null, always_include: [] },
    review_workflow: "standard",
    skill_policy: "standard",
    gates: { auto_approve: [] },
    wiki: { share_mode: "team", autopromote: false },
    quality: { budget: { per_class_minutes: 10, total_minutes: 30 } },
    reporting: "standard",
    index: {
      enabled: true,
      kg_node_threshold: 2000,
      kg_size_threshold_mb: 1,
      links_edge_threshold: 2000,
      runs_threshold: 20,
      wiki_file_threshold: 500,
    },
    cross_host: { enabled: false, hosts: {} },
  },
};

// ---------------------------------------------------------------------------
// Keys that do NOT inherit from workspace → child (OD-1 + detection-only)
// ---------------------------------------------------------------------------

/**
 * Keys excluded from workspace-to-child inheritance.
 * These are always resolved from the child's own files or built-ins.
 */
const NON_INHERITABLE_KEYS = new Set<string>([
  "initiative_default", // OD-1: attach-to-wrong-initiative risk
  "workspace",          // workspace.mode is root-detection-only
]);

// ---------------------------------------------------------------------------
// Dangerous prototype-pollution key names — blocked at every merge level
// ---------------------------------------------------------------------------

/** Keys that must never be merged into any object (prototype pollution guard). */
const PROTO_POISON_KEYS = new Set(["__proto__", "prototype", "constructor"]);

// ---------------------------------------------------------------------------
// Valid value sets (mirrors read-guild-config.ts)
// ---------------------------------------------------------------------------

const VALID_LOOPS      = new Set(["none", "spec", "plan", "implementation", "all"]);
const VALID_RIGOR      = new Set(["quick", "standard", "deep"]);
const VALID_REVIEW     = new Set(["local", "cross", "off"]);
const VALID_HOST       = new Set(["claude", "codex", "auto"]);
const VALID_PHASES     = new Set(["spec", "plan", "build", "all"]);
const VALID_AGENT_MODE = new Set(["team", "agent", "subagent", "auto"]);
const VALID_CACHE_TTL  = new Set(["1h", "5m", "off"]);

const VALID_MODELS_KEYS = new Set([
  "enabled", "tiers", "scoreWeights", "thresholds", "advisorRounds",
  "escalationMarkers", "recallBeforeRead", "recallScoreThreshold",
  "structuredOutputRequired", "cacheTTL", "importanceGate", "ingestSimilarityGate",
  "shortOutputThreshold",
]);
const VALID_SECURITY_KEYS       = new Set(["bypass_permissions_policy"]);
const VALID_SECRETS_POLICY_KEYS = new Set([
  "env_allowlist", "redaction_patterns", "fail_mode_durable", "fail_mode_telemetry",
]);
const VALID_MCP_KEYS        = new Set(["tool_description_hashes"]);
const VALID_INDEX_KEYS      = new Set([
  "enabled", "kg_node_threshold", "kg_size_threshold_mb",
  "links_edge_threshold", "runs_threshold", "wiki_file_threshold",
]);
const DEFAULTS_ALLOWED_KEYS = new Set([
  "auto_learn", "adversarial", "team", "review_workflow", "skill_policy",
  "gates", "wiki", "quality", "reporting", "index", "cross_host",
]);
const TIER1_KEYS = new Set([
  "rigor", "auto_approve", "review", "host", "initiative_default",
  "index", "record_status_runs", "codex_skip_enforcement", "agent_mode", "workspace",
  "models", "security", "secrets_policy", "mcp",
  "loops", "loop_cap", "codex_cap", "defaults",
]);

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `overlay` over `base` into a new object.
 *  - object-typed values → deep merge key-by-key
 *  - array-typed values  → wholesale replace (Decision F.2)
 *  - scalar values       → replace
 *
 * SECURITY: keys in PROTO_POISON_KEYS are silently skipped at every
 * nesting level to prevent prototype pollution.
 */
export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>
): Record<string, unknown> {
  // Merge into a null-prototype object so __proto__ assignments can't reach Object.prototype
  const result: Record<string, unknown> = Object.assign(Object.create(null), base);
  for (const [k, v] of Object.entries(overlay)) {
    // SECURITY: skip poison keys at every level (F5 fix)
    if (PROTO_POISON_KEYS.has(k)) continue;
    if (Array.isArray(v)) {
      // List-typed: replace wholesale (Decision F.2)
      result[k] = v;
    } else if (isPlainObject(v) && isPlainObject(result[k])) {
      // Object-typed: recurse (F1 fix — deep-merge, not replace)
      result[k] = deepMerge(
        result[k] as Record<string, unknown>,
        v as Record<string, unknown>
      );
    } else {
      result[k] = v;
    }
  }
  // Re-box into a regular object so downstream spread/Object.keys work normally
  return { ...result };
}

function collectKeyPaths(obj: Record<string, unknown>, prefix = ""): Set<string> {
  const paths = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    if (PROTO_POISON_KEYS.has(k)) continue;
    const full = prefix ? `${prefix}.${k}` : k;
    paths.add(full);
    if (isPlainObject(v)) {
      for (const sub of collectKeyPaths(v as Record<string, unknown>, full)) {
        paths.add(sub);
      }
    }
  }
  return paths;
}

/**
 * Validate that every top-level key in localObj exists in the DEFAULTS schema.
 * Also rejects prototype-poison keys at the top level.
 * Throws on unknown key (per Decision F.3).
 */
function validateLocalKeysOrThrow(
  localObj: Record<string, unknown>,
  baseObj: Record<string, unknown>
): void {
  const basePaths = collectKeyPaths(baseObj);
  for (const key of Object.keys(localObj)) {
    // SECURITY: reject poison keys outright (F5 fix)
    if (PROTO_POISON_KEYS.has(key)) {
      throw new Error(
        `share-dot-guild: settings.local.json key '${key}' is a dangerous prototype key — rejected.`
      );
    }
    if (key.startsWith("_")) continue;
    if (!basePaths.has(key)) {
      throw new Error(
        `share-dot-guild: settings.local.json key '${key}' not in settings.json schema — ` +
          `refusing to silently extend. Declare it in settings.json first (with the team default) ` +
          `or remove it from settings.local.json.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// rigorProfile (same semantics as in read-guild-config.ts)
// ---------------------------------------------------------------------------

export interface RigorProfile {
  loops: string;
  loop_cap: number | null;
  review: ResolvedConfig["review"];
}

export function rigorProfile(rigor: ResolvedConfig["rigor"]): RigorProfile {
  switch (rigor) {
    case "quick":
      return { loops: "none", loop_cap: null, review: "off" };
    case "deep":
      return { loops: "all", loop_cap: 16, review: "cross" };
    case "standard":
    default:
      return { loops: "spec,plan", loop_cap: 16, review: "local" };
  }
}

// ---------------------------------------------------------------------------
// Workspace discovery
// ---------------------------------------------------------------------------

interface WorkspaceManifest {
  is_workspace: boolean;
  sub_guilds?: Array<{ name: string; path: string; kind?: string }>;
}

interface DiscoveredWorkspace {
  /** Absolute path to the workspace root directory. */
  rootDir: string;
  /** The parsed workspace.json manifest. */
  manifest: WorkspaceManifest;
}

/**
 * Walk up from `startDir` (exclusive) to find the nearest ancestor with
 * `.guild/workspace.json` where `is_workspace: true`.
 *
 * Returns null when no valid workspace root is found up to the filesystem root.
 *
 * FIX (F4): a malformed workspace.json (JSON parse error) no longer stops
 * the walk — we continue up to the next ancestor. Only `is_workspace: false`
 * (a deliberate opt-out) stops the walk early.
 */
function discoverWorkspace(startDir: string): DiscoveredWorkspace | null {
  let current = path.dirname(startDir);
  const fsRoot = path.parse(current).root;

  while (current !== fsRoot) {
    const manifestPath = path.join(current, ".guild", "workspace.json");
    if (fs.existsSync(manifestPath)) {
      let manifest: WorkspaceManifest | null = null;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as WorkspaceManifest;
      } catch {
        // Malformed JSON — skip this entry and keep walking up (F4 fix).
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
        continue;
      }
      if (manifest.is_workspace === true) {
        return { rootDir: current, manifest };
      }
      // is_workspace is false or missing — deliberate stop, do NOT continue.
      return null;
    }
    const parent = path.dirname(current);
    if (parent === current) break; // reached fs root
    current = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Settings file loading
// ---------------------------------------------------------------------------

/**
 * Parse a single settings.json file, returning ONLY the keys that were
 * explicitly present (i.e., a sparse Partial<ResolvedConfig>). Unknown keys
 * are silently skipped. This is intentionally sparse — callers must deep-merge
 * across layers themselves rather than relying on DEFAULTS being baked in here.
 */
function parseSettingsFile(filePath: string): Partial<ResolvedConfig> {
  if (!fs.existsSync(filePath)) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }

  const out: Partial<ResolvedConfig> = {};

  if (VALID_RIGOR.has(parsed["rigor"] as string))
    out.rigor = parsed["rigor"] as ResolvedConfig["rigor"];
  if (Array.isArray(parsed["auto_approve"]))
    out.auto_approve = parsed["auto_approve"] as string[];
  if (VALID_REVIEW.has(parsed["review"] as string))
    out.review = parsed["review"] as ResolvedConfig["review"];
  if (VALID_HOST.has(parsed["host"] as string))
    out.host = parsed["host"] as ResolvedConfig["host"];
  if (parsed["initiative_default"] === null || typeof parsed["initiative_default"] === "string")
    out.initiative_default = parsed["initiative_default"] as string | null;
  if (parsed["index"] === "auto" || parsed["index"] === "off")
    out.index = parsed["index"];
  if (typeof parsed["record_status_runs"] === "boolean")
    out.record_status_runs = parsed["record_status_runs"];
  if (parsed["codex_skip_enforcement"] === "warn" || parsed["codex_skip_enforcement"] === "block")
    out.codex_skip_enforcement = parsed["codex_skip_enforcement"];
  if (VALID_AGENT_MODE.has(parsed["agent_mode"] as string))
    out.agent_mode = parsed["agent_mode"] as ResolvedConfig["agent_mode"];
  if (isPlainObject(parsed["workspace"])) {
    const ws = parsed["workspace"] as Record<string, unknown>;
    const wsMode = ws["mode"];
    if (wsMode === "auto" || wsMode === "on" || wsMode === "off") {
      out.workspace = { mode: wsMode };
    }
  }
  if (isPlainObject(parsed["models"])) {
    const rawModels = parsed["models"] as Record<string, unknown>;
    // Sparse: only carry explicitly-set sub-fields so deepMerge can combine layers
    const sparse: Partial<ModelsBlock> = {};
    if (typeof rawModels["enabled"] === "boolean") sparse.enabled = rawModels["enabled"];
    if (isPlainObject(rawModels["tiers"])) {
      const rt = rawModels["tiers"] as Record<string, unknown>;
      const sparseTiers: Partial<TiersBlock> = {};
      for (const tier of ["cheap", "mid", "powerful"] as const) {
        if (isPlainObject(rt[tier])) {
          sparseTiers[tier] = rt[tier] as unknown as TierHostMap;
        }
      }
      sparse.tiers = sparseTiers as TiersBlock;
    }
    if (isPlainObject(rawModels["scoreWeights"]))
      sparse.scoreWeights = rawModels["scoreWeights"] as Record<string, number>;
    if (isPlainObject(rawModels["thresholds"]))
      sparse.thresholds = rawModels["thresholds"] as ModelsBlock["thresholds"];
    if (typeof rawModels["advisorRounds"] === "number" && rawModels["advisorRounds"] >= 1)
      sparse.advisorRounds = Math.floor(rawModels["advisorRounds"]);
    if (Array.isArray(rawModels["escalationMarkers"]))
      sparse.escalationMarkers = rawModels["escalationMarkers"] as string[];
    if (typeof rawModels["recallBeforeRead"] === "boolean")
      sparse.recallBeforeRead = rawModels["recallBeforeRead"];
    if (typeof rawModels["recallScoreThreshold"] === "number")
      sparse.recallScoreThreshold = rawModels["recallScoreThreshold"];
    if (typeof rawModels["structuredOutputRequired"] === "boolean")
      sparse.structuredOutputRequired = rawModels["structuredOutputRequired"];
    if (isPlainObject(rawModels["cacheTTL"])) {
      const rttl = rawModels["cacheTTL"] as Record<string, unknown>;
      const newTTL: Partial<CacheTTLBlock> = {};
      if (VALID_CACHE_TTL.has(rttl["coordinator"] as string)) newTTL.coordinator = rttl["coordinator"] as CacheTTLBlock["coordinator"];
      if (VALID_CACHE_TTL.has(rttl["leaf"] as string)) newTTL.leaf = rttl["leaf"] as CacheTTLBlock["leaf"];
      sparse.cacheTTL = newTTL as CacheTTLBlock;
    }
    if (typeof rawModels["importanceGate"] === "number" && rawModels["importanceGate"] >= 1 && rawModels["importanceGate"] <= 5)
      sparse.importanceGate = Math.floor(rawModels["importanceGate"]);
    if (typeof rawModels["ingestSimilarityGate"] === "number" && rawModels["ingestSimilarityGate"] >= 0 && rawModels["ingestSimilarityGate"] <= 1)
      sparse.ingestSimilarityGate = rawModels["ingestSimilarityGate"];
    if (isPlainObject(rawModels["shortOutputThreshold"])) {
      const sot = rawModels["shortOutputThreshold"] as Record<string, unknown>;
      const sotMerged: Record<string, Record<string, number>> = {};
      for (const taskType of Object.keys(sot)) {
        if (!isPlainObject(sot[taskType])) continue;
        const innerRaw = sot[taskType] as Record<string, unknown>;
        const innerMerged: Record<string, number> = {};
        for (const tier of Object.keys(innerRaw)) {
          if (typeof innerRaw[tier] === "number") innerMerged[tier] = innerRaw[tier] as number;
        }
        if (Object.keys(innerMerged).length > 0) sotMerged[taskType] = innerMerged;
      }
      sparse.shortOutputThreshold = sotMerged;
    }
    out.models = sparse as ModelsBlock;
  }
  if (isPlainObject(parsed["security"])) {
    const rawSec = parsed["security"] as Record<string, unknown>;
    const sparseSec: Partial<SecurityBlock> = {};
    const bpp = rawSec["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") sparseSec.bypass_permissions_policy = bpp;
    out.security = sparseSec as SecurityBlock;
  }
  if (isPlainObject(parsed["secrets_policy"])) {
    const rawSp = parsed["secrets_policy"] as Record<string, unknown>;
    const sparseSp: Partial<SecretsPolicyBlock> = {};
    if (Array.isArray(rawSp["env_allowlist"])) sparseSp.env_allowlist = rawSp["env_allowlist"] as string[];
    if (Array.isArray(rawSp["redaction_patterns"])) sparseSp.redaction_patterns = rawSp["redaction_patterns"] as string[];
    if (rawSp["fail_mode_durable"] === "closed" || rawSp["fail_mode_durable"] === "open") sparseSp.fail_mode_durable = rawSp["fail_mode_durable"];
    if (rawSp["fail_mode_telemetry"] === "open" || rawSp["fail_mode_telemetry"] === "closed") sparseSp.fail_mode_telemetry = rawSp["fail_mode_telemetry"];
    out.secrets_policy = sparseSp as SecretsPolicyBlock;
  }
  if (isPlainObject(parsed["mcp"])) {
    const rawMcp = parsed["mcp"] as Record<string, unknown>;
    const sparseMcp: Partial<McpBlock> = {};
    if (isPlainObject(rawMcp["tool_description_hashes"]))
      sparseMcp.tool_description_hashes = rawMcp["tool_description_hashes"] as Record<string, string>;
    out.mcp = sparseMcp as McpBlock;
  }
  if (typeof parsed["loops"] === "string" || parsed["loops"] === null)
    out.loops = parsed["loops"] as string | null;
  if (typeof parsed["loop_cap"] === "number")
    out.loop_cap = Math.min(256, Math.max(1, parsed["loop_cap"] as number));
  if (typeof parsed["codex_cap"] === "number")
    out.codex_cap = Math.min(10, Math.max(1, parsed["codex_cap"] as number));
  if (isPlainObject(parsed["defaults"])) {
    const rawDefaults = parsed["defaults"] as Record<string, unknown>;
    // Sparse: only carry known keys — do NOT bake in DEFAULTS here.
    // deepMerge across layers handles filling gaps from lower layers.
    const sparseDefaults: Record<string, unknown> = {};
    for (const k of Object.keys(rawDefaults)) {
      if (DEFAULTS_ALLOWED_KEYS.has(k)) sparseDefaults[k] = rawDefaults[k];
    }
    out.defaults = sparseDefaults as unknown as DefaultsBlock;
  }

  return out;
}

/**
 * Read a settings.local.json and return its SPARSE raw content (only keys
 * that were explicitly set), after validating for unknown/poison keys.
 *
 * FIX (F3): previously this function inflated the local content into
 * DEFAULTS+base+local, making the merged result appear as if ALL keys were
 * explicitly set. That caused the rigor-explicitness check to treat merged
 * loops/review as explicit even when the local file only set an unrelated key.
 * Now we return just the sparse local keys — callers merge via deepMerge.
 */
function parseLocalFile(guildDir: string): Partial<ResolvedConfig> {
  const localPath = path.join(guildDir, "settings.local.json");
  if (!fs.existsSync(localPath)) return {};
  let localParsed: Record<string, unknown>;
  try {
    localParsed = JSON.parse(fs.readFileSync(localPath, "utf8"));
  } catch {
    return {};
  }
  // Validate keys (throws on unknown or poison — caller catches at library level)
  validateLocalKeysOrThrow(localParsed, DEFAULTS as unknown as Record<string, unknown>);
  // Return sparse: only the keys present in the local file (no inflation)
  return parseSettingsFile_fromParsed(localParsed);
}

/**
 * Internal helper: same logic as parseSettingsFile but accepts an already-parsed
 * object. Used by parseLocalFile to avoid double-read.
 */
function parseSettingsFile_fromParsed(parsed: Record<string, unknown>): Partial<ResolvedConfig> {
  const out: Partial<ResolvedConfig> = {};

  if (VALID_RIGOR.has(parsed["rigor"] as string))
    out.rigor = parsed["rigor"] as ResolvedConfig["rigor"];
  if (Array.isArray(parsed["auto_approve"]))
    out.auto_approve = parsed["auto_approve"] as string[];
  if (VALID_REVIEW.has(parsed["review"] as string))
    out.review = parsed["review"] as ResolvedConfig["review"];
  if (VALID_HOST.has(parsed["host"] as string))
    out.host = parsed["host"] as ResolvedConfig["host"];
  if (parsed["initiative_default"] === null || typeof parsed["initiative_default"] === "string")
    out.initiative_default = parsed["initiative_default"] as string | null;
  if (parsed["index"] === "auto" || parsed["index"] === "off")
    out.index = parsed["index"];
  if (typeof parsed["record_status_runs"] === "boolean")
    out.record_status_runs = parsed["record_status_runs"];
  if (parsed["codex_skip_enforcement"] === "warn" || parsed["codex_skip_enforcement"] === "block")
    out.codex_skip_enforcement = parsed["codex_skip_enforcement"];
  if (VALID_AGENT_MODE.has(parsed["agent_mode"] as string))
    out.agent_mode = parsed["agent_mode"] as ResolvedConfig["agent_mode"];
  if (isPlainObject(parsed["workspace"])) {
    const ws = parsed["workspace"] as Record<string, unknown>;
    const wsMode = ws["mode"];
    if (wsMode === "auto" || wsMode === "on" || wsMode === "off") {
      out.workspace = { mode: wsMode };
    }
  }
  if (isPlainObject(parsed["models"])) {
    const rawModels = parsed["models"] as Record<string, unknown>;
    const sparse: Partial<ModelsBlock> = {};
    if (typeof rawModels["enabled"] === "boolean") sparse.enabled = rawModels["enabled"];
    if (isPlainObject(rawModels["tiers"])) {
      const rt = rawModels["tiers"] as Record<string, unknown>;
      const sparseTiers: Partial<TiersBlock> = {};
      for (const tier of ["cheap", "mid", "powerful"] as const) {
        if (isPlainObject(rt[tier])) sparseTiers[tier] = rt[tier] as unknown as TierHostMap;
      }
      sparse.tiers = sparseTiers as TiersBlock;
    }
    if (isPlainObject(rawModels["scoreWeights"])) sparse.scoreWeights = rawModels["scoreWeights"] as Record<string, number>;
    if (isPlainObject(rawModels["thresholds"])) sparse.thresholds = rawModels["thresholds"] as ModelsBlock["thresholds"];
    if (typeof rawModels["advisorRounds"] === "number" && rawModels["advisorRounds"] >= 1)
      sparse.advisorRounds = Math.floor(rawModels["advisorRounds"]);
    if (Array.isArray(rawModels["escalationMarkers"])) sparse.escalationMarkers = rawModels["escalationMarkers"] as string[];
    if (typeof rawModels["recallBeforeRead"] === "boolean") sparse.recallBeforeRead = rawModels["recallBeforeRead"];
    if (typeof rawModels["recallScoreThreshold"] === "number") sparse.recallScoreThreshold = rawModels["recallScoreThreshold"];
    if (typeof rawModels["structuredOutputRequired"] === "boolean") sparse.structuredOutputRequired = rawModels["structuredOutputRequired"];
    if (isPlainObject(rawModels["cacheTTL"])) {
      const rttl = rawModels["cacheTTL"] as Record<string, unknown>;
      const newTTL: Partial<CacheTTLBlock> = {};
      if (VALID_CACHE_TTL.has(rttl["coordinator"] as string)) newTTL.coordinator = rttl["coordinator"] as CacheTTLBlock["coordinator"];
      if (VALID_CACHE_TTL.has(rttl["leaf"] as string)) newTTL.leaf = rttl["leaf"] as CacheTTLBlock["leaf"];
      sparse.cacheTTL = newTTL as CacheTTLBlock;
    }
    if (typeof rawModels["importanceGate"] === "number" && rawModels["importanceGate"] >= 1 && rawModels["importanceGate"] <= 5)
      sparse.importanceGate = Math.floor(rawModels["importanceGate"]);
    if (typeof rawModels["ingestSimilarityGate"] === "number" && rawModels["ingestSimilarityGate"] >= 0 && rawModels["ingestSimilarityGate"] <= 1)
      sparse.ingestSimilarityGate = rawModels["ingestSimilarityGate"];
    if (isPlainObject(rawModels["shortOutputThreshold"])) {
      const sot = rawModels["shortOutputThreshold"] as Record<string, unknown>;
      const sotMerged: Record<string, Record<string, number>> = {};
      for (const taskType of Object.keys(sot)) {
        if (!isPlainObject(sot[taskType])) continue;
        const innerRaw = sot[taskType] as Record<string, unknown>;
        const innerMerged: Record<string, number> = {};
        for (const tier of Object.keys(innerRaw)) {
          if (typeof innerRaw[tier] === "number") innerMerged[tier] = innerRaw[tier] as number;
        }
        if (Object.keys(innerMerged).length > 0) sotMerged[taskType] = innerMerged;
      }
      sparse.shortOutputThreshold = sotMerged;
    }
    out.models = sparse as ModelsBlock;
  }
  if (isPlainObject(parsed["security"])) {
    const rawSec = parsed["security"] as Record<string, unknown>;
    const sparseSec: Partial<SecurityBlock> = {};
    const bpp = rawSec["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") sparseSec.bypass_permissions_policy = bpp;
    out.security = sparseSec as SecurityBlock;
  }
  if (isPlainObject(parsed["secrets_policy"])) {
    const rawSp = parsed["secrets_policy"] as Record<string, unknown>;
    const sparseSp: Partial<SecretsPolicyBlock> = {};
    if (Array.isArray(rawSp["env_allowlist"])) sparseSp.env_allowlist = rawSp["env_allowlist"] as string[];
    if (Array.isArray(rawSp["redaction_patterns"])) sparseSp.redaction_patterns = rawSp["redaction_patterns"] as string[];
    if (rawSp["fail_mode_durable"] === "closed" || rawSp["fail_mode_durable"] === "open") sparseSp.fail_mode_durable = rawSp["fail_mode_durable"];
    if (rawSp["fail_mode_telemetry"] === "open" || rawSp["fail_mode_telemetry"] === "closed") sparseSp.fail_mode_telemetry = rawSp["fail_mode_telemetry"];
    out.secrets_policy = sparseSp as SecretsPolicyBlock;
  }
  if (isPlainObject(parsed["mcp"])) {
    const rawMcp = parsed["mcp"] as Record<string, unknown>;
    const sparseMcp: Partial<McpBlock> = {};
    if (isPlainObject(rawMcp["tool_description_hashes"]))
      sparseMcp.tool_description_hashes = rawMcp["tool_description_hashes"] as Record<string, string>;
    out.mcp = sparseMcp as McpBlock;
  }
  if (typeof parsed["loops"] === "string" || parsed["loops"] === null)
    out.loops = parsed["loops"] as string | null;
  if (typeof parsed["loop_cap"] === "number")
    out.loop_cap = Math.min(256, Math.max(1, parsed["loop_cap"] as number));
  if (typeof parsed["codex_cap"] === "number")
    out.codex_cap = Math.min(10, Math.max(1, parsed["codex_cap"] as number));
  if (isPlainObject(parsed["defaults"])) {
    const rawDefaults = parsed["defaults"] as Record<string, unknown>;
    const sparseDefaults: Record<string, unknown> = {};
    for (const k of Object.keys(rawDefaults)) {
      if (DEFAULTS_ALLOWED_KEYS.has(k)) sparseDefaults[k] = rawDefaults[k];
    }
    out.defaults = sparseDefaults as unknown as DefaultsBlock;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Layer assembly: deep-merge sparse layers over the base
// ---------------------------------------------------------------------------

/**
 * Assemble the final resolved config from multiple ordered sparse layers
 * (lowest precedence first) plus the flag overrides (highest precedence).
 *
 * FIX (F1): uses deepMerge at every nesting level so a higher-layer partial
 * override (e.g. child defaults.team.size) does NOT discard sibling sub-keys
 * from lower layers (e.g. workspace defaults.quality).
 */
function assembleLayers(
  layers: Array<Partial<ResolvedConfig>>,
  flagsLayer: Partial<ResolvedConfig>
): ResolvedConfig {
  // Start from built-in defaults (as a plain object for deepMerge)
  let accumulated = DEFAULTS as unknown as Record<string, unknown>;

  for (const layer of layers) {
    if (Object.keys(layer).length === 0) continue;
    accumulated = deepMerge(accumulated, layer as unknown as Record<string, unknown>);
  }

  // Apply CLI flags last
  if (Object.keys(flagsLayer).length > 0) {
    accumulated = deepMerge(accumulated, flagsLayer as unknown as Record<string, unknown>);
  }

  return accumulated as unknown as ResolvedConfig;
}

// ---------------------------------------------------------------------------
// Cross-host availability (same semantics as read-guild-config.ts)
// ---------------------------------------------------------------------------

function crossHostAvailable(): boolean {
  const v = process.env["GUILD_CROSS_HOST_AVAILABLE"];
  if (v === undefined) return true;
  const s = v.trim().toLowerCase();
  return !(s === "0" || s === "false" || s === "no" || s === "off");
}

// ---------------------------------------------------------------------------
// Rigor explicitness helper
// ---------------------------------------------------------------------------

/**
 * Determine whether a given rigor-expandable key (loops, loop_cap, review)
 * was EXPLICITLY set in at least one of the named layers.
 *
 * FIX (F3): we check the SPARSE per-layer objects (before deepMerge inflation),
 * not the accumulated merged result. This prevents an unrelated local-file key
 * from making a rigor-expandable key appear explicit.
 */
function wasExplicitlySet(
  key: string,
  ...layers: Array<Partial<ResolvedConfig>>
): boolean {
  return layers.some((layer) => key in layer && (layer as Record<string, unknown>)[key] !== undefined);
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve settings for the given cwd through the 5-layer chain:
 *
 *   built-in < workspace settings < workspace local < project settings
 *   < project local < rigor expansion < CLI flags
 *
 * Returns `config` (the fully resolved config) and `sources` (per-key source map).
 */
export function resolveSettings(opts: ResolveOptions): ResolveResult {
  const { cwd, flags = {} } = opts;

  // ------------------------------------------------------------------
  // Step 1 — Discover workspace root (walk up from cwd, F4 fix applied)
  // ------------------------------------------------------------------
  const ws = discoverWorkspace(cwd);

  // ------------------------------------------------------------------
  // Step 2 — Initialise sources map with builtin for all top-level keys
  // ------------------------------------------------------------------
  const sources: Record<string, Source> = {};
  for (const key of Object.keys(DEFAULTS) as Array<keyof ResolvedConfig>) {
    sources[key as string] = "builtin";
  }
  sources["workspace.mode"] = "builtin";

  // ------------------------------------------------------------------
  // Step 3 — Load each layer as SPARSE partials
  // ------------------------------------------------------------------

  // Layer B: workspace settings.json (non-inheritable keys stripped)
  let wsSettings: Partial<ResolvedConfig> = {};
  let wsLocalSettings: Partial<ResolvedConfig> = {};

  if (ws !== null) {
    const wsGuildDir = path.join(ws.rootDir, ".guild");
    const rawWsSettings = parseSettingsFile(path.join(wsGuildDir, "settings.json"));

    // Strip non-inheritable keys from workspace layer
    const wsInheritable: Partial<ResolvedConfig> = {};
    for (const [k, v] of Object.entries(rawWsSettings) as Array<[keyof ResolvedConfig, unknown]>) {
      if (!NON_INHERITABLE_KEYS.has(k as string)) {
        (wsInheritable as Record<string, unknown>)[k as string] = v;
      }
    }
    wsSettings = wsInheritable;

    // Update sources for workspace-inherited keys
    for (const key of Object.keys(wsSettings)) {
      if (key !== "workspace") sources[key] = "workspace";
    }

    // Layer C: workspace settings.local.json
    try {
      const rawWsLocal = parseLocalFile(wsGuildDir);
      // Strip non-inheritable keys
      const wsLocalInheritable: Partial<ResolvedConfig> = {};
      for (const [k, v] of Object.entries(rawWsLocal) as Array<[keyof ResolvedConfig, unknown]>) {
        if (!NON_INHERITABLE_KEYS.has(k as string)) {
          (wsLocalInheritable as Record<string, unknown>)[k as string] = v;
        }
      }
      wsLocalSettings = wsLocalInheritable;
      // Update sources for workspace-local keys
      for (const key of Object.keys(wsLocalSettings)) {
        if (key !== "workspace") sources[key] = "workspace-local";
      }
    } catch {
      // local key validation error — silently ignore at library level
    }
  }

  // Layer D: project settings.json
  const projectGuildDir = path.join(cwd, ".guild");
  const projectSettings = parseSettingsFile(path.join(projectGuildDir, "settings.json"));
  for (const key of Object.keys(projectSettings)) {
    if (key === "workspace") {
      sources["workspace.mode"] = "project";
    } else {
      sources[key] = "project";
    }
  }

  // Layer E: project settings.local.json
  let projectLocalSettings: Partial<ResolvedConfig> = {};
  try {
    projectLocalSettings = parseLocalFile(projectGuildDir);
    for (const key of Object.keys(projectLocalSettings)) {
      if (key === "workspace") {
        sources["workspace.mode"] = "project-local";
      } else {
        sources[key] = "project-local";
      }
    }
  } catch {
    // local key validation error — silently ignore at library level
  }

  // Layer F: CLI flags — mark sources
  for (const key of Object.keys(flags) as Array<keyof typeof flags>) {
    if (flags[key] !== undefined) {
      if (key === "workspace") {
        sources["workspace.mode"] = "cli";
      }
      sources[key as string] = "cli";
    }
  }

  // ------------------------------------------------------------------
  // Step 4 — Assemble the final config via deep-merge (F1 fix)
  // workspace.mode is non-inheritable: it assembles from project layers only
  // ------------------------------------------------------------------

  // All-layers assembly (includes workspace layers for inheritable keys)
  const assembled = assembleLayers(
    [wsSettings, wsLocalSettings, projectSettings, projectLocalSettings],
    flags
  );

  // workspace.mode assembly: project settings < project local < flags (NOT workspace→child)
  const resolvedWorkspaceMode: WorkspaceBlock = {
    ...DEFAULTS.workspace,
    ...(projectSettings.workspace ?? {}),
    ...(projectLocalSettings.workspace ?? {}),  // FIX F2: project-local workspace now included
    ...(flags.workspace ?? {}),
  };
  assembled.workspace = resolvedWorkspaceMode;

  // workspace source is tracked via the dotted key
  sources["workspace"] = sources["workspace.mode"];

  // ------------------------------------------------------------------
  // Step 5 — Rigor explicitness check (F3 fix: use SPARSE per-layer data)
  // ------------------------------------------------------------------
  // A key is "explicit" if it was set in any non-builtin layer (file or flag).
  // We check sparse partials directly — NOT the accumulated merged result.
  const loopsExplicit = wasExplicitlySet(
    "loops",
    wsSettings, wsLocalSettings, projectSettings, projectLocalSettings, flags
  ) && (assembled.loops !== null);  // null is "derive from rigor"

  const loopCapExplicit = wasExplicitlySet(
    "loop_cap",
    wsSettings, wsLocalSettings, projectSettings, projectLocalSettings, flags
  );

  const reviewExplicit = wasExplicitlySet(
    "review",
    wsSettings, wsLocalSettings, projectSettings, projectLocalSettings, flags
  );

  // ------------------------------------------------------------------
  // Step 6 — Validate loops CSV
  // ------------------------------------------------------------------
  if (assembled.loops) {
    for (const v of assembled.loops.split(",").map((s) => s.trim())) {
      if (!VALID_LOOPS.has(v)) {
        assembled.loops = null;
        // loopsExplicit becomes false implicitly since we just nulled it
        break;
      }
    }
  }

  // Re-check after null: if loops is now null, treat as not explicit
  const loopsIsExplicit = loopsExplicit && assembled.loops !== null;

  // ------------------------------------------------------------------
  // Step 7 — Rigor expansion (F6 fix: tag loops/loop_cap/review all as 'rigor')
  // ------------------------------------------------------------------
  const profile = rigorProfile(assembled.rigor);
  const applied: string[] = [];
  const overridden: string[] = [];

  let derivedReview = profile.review;
  let reviewFallback = false;
  let fallbackNote: string | undefined;
  if (assembled.rigor === "deep" && derivedReview === "cross" && !crossHostAvailable()) {
    derivedReview = "local";
    reviewFallback = true;
    fallbackNote =
      "rigor=deep implies review=cross, but the cross-host (Codex) is unavailable — " +
      "fell back to review=local with a weak-independence caveat. Not a hard failure.";
  }

  // loops
  if (loopsIsExplicit) {
    overridden.push("loops");
  } else {
    assembled.loops = profile.loops;
    applied.push("loops");
    // FIX F6: tag as rigor when rigor itself came from a non-builtin layer
    if (sources.rigor !== "builtin") sources.loops = "rigor";
  }

  // loop_cap
  if (profile.loop_cap !== null) {
    if (loopCapExplicit) {
      overridden.push("loop_cap");
    } else {
      assembled.loop_cap = profile.loop_cap;
      applied.push("loop_cap");
      // FIX F6: tag as rigor when rigor itself came from a non-builtin layer
      if (sources.rigor !== "builtin") sources.loop_cap = "rigor";
    }
  }

  // review
  if (reviewExplicit) {
    overridden.push("review");
  } else {
    assembled.review = derivedReview;
    applied.push("review");
    // FIX F6: tag as rigor when rigor itself came from a non-builtin layer
    if (sources.rigor !== "builtin") sources.review = "rigor";
  }

  const rigorExpanded: ResolvedConfig["_rigorExpanded"] = {
    rigor: assembled.rigor,
    loops: profile.loops,
    loop_cap: profile.loop_cap,
    review: derivedReview,
    applied,
    overridden_by_explicit: overridden,
  };
  if (assembled.rigor === "deep") rigorExpanded.review_implied = "cross";
  if (reviewFallback) {
    rigorExpanded.review_fallback = true;
    rigorExpanded.note = fallbackNote;
  }
  assembled._rigorExpanded = rigorExpanded;

  return { config: assembled, sources };
}

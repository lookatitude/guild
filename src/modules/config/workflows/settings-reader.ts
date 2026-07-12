/**
 * src/modules/config/workflows/settings-reader.ts
 *
 * Settings resolution core — extracted from settings-resolver.ts (W3 god-file split).
 * The original path scripts/lib/settings-resolver.ts is a thin re-export shim.
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
import { HOST_IDS, HOST_REGISTRY_ROWS, type HostId } from "../../host-runtime";
import { normalizeHostId } from "../../host-runtime";
// host_profiles strict entry-shape filter — single SoT (same rules as `config validate`).
import { filterHostProfiles } from "../../host-runtime";
// Canonical single-source prototype-pollution guard (re-arch WAVE 1).
import { PROTO_POISON_KEYS } from "../../security";
import { DEFAULTS as SHARED_DEFAULTS, NON_INHERITABLE_KEYS } from "./config-defaults";
import { loadYamlApi } from "../../kernel";

const yaml = loadYamlApi() as { load: (src: string) => unknown };

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
  // R-016: lane retry + resume policies (v2-runtime-and-execution-model.md)
  retry: { max_attempts: number; backoff: "immediate" | "linear" | "exponential" };
  resume: { enabled: boolean };
  // R-017: heartbeat staleness threshold ms (hooks/lib/heartbeat.ts tolerant reader)
  heartbeat_timeout_ms: number;
  // R-018: host capability manifest TTL s (host-router.ts CR-5)
  capability_manifest_ttl_s: number;
  // R-020: explicit allowed-tools list (boundary-config-and-tracking Decision F)
  allowed_tools: string[];
  // plugin-update-lifecycle AC-6: channel-aware update-check behavior
  update: { mode: "auto" | "notify" | "off"; cadence_hours: number };
}
interface WorkspaceBlock {
  mode: "auto" | "on" | "off";
}
// LW1-6 (ADR step 14) — additive OPTIONAL keys; inert defaults preserve prior behavior.
interface RolesBlock {
  host: string | null;
  advisory: string | null;
  adversarial: string | null;
}
interface HostProfileEntry {
  models?: { cheap?: string; mid?: string; powerful?: string };
  enabled?: boolean;
}
type HostProfilesBlock = Record<string, HostProfileEntry>;
// G-11 (SC-6): tier→host values are a union — string | {model, effort?, verbosity?} | null.
// This resolver only STORES the union (sparse parse + deep-merge across layers);
// it never unpacks it. The ONLY unpack point is resolveTierModel() in
// read-guild-config.ts — consumers (score-tier, write-host-capability,
// host-router) import it from there.
interface TierModelSpec {
  model: string;
  effort?: string;
  reasoning?: string;
  thinking?: string;
  verbosity?: string;
}
type TierHostValue = string | TierModelSpec | null;
type TierHostMap = Partial<Record<HostId, TierHostValue>>;
interface TiersBlock {
  cheap: TierHostMap;
  mid: TierHostMap;
  powerful: TierHostMap;
}
interface CacheTTLBlock {
  coordinator: "1h" | "5m" | "off";
  leaf: "1h" | "5m" | "off";
}
/** Mutable numeric version of KNOWLEDGE_CONFIG_DEFAULTS — lets settings layers
 *  override individual fields without being locked to the exact literal types
 *  of the schema's `as const` export. */
interface KnowledgeConfigBlock {
  maxDepth: number;
  maxBranching: number;
  minTopicImportance: number;
  relMinConf: number;
  maxFiles: number;
  maxTokens: number;
  batchSize: number;
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
  /** Mirrors read-guild-config DEFAULTS — composite recall scoring toggle (default true). */
  compositeRecall: boolean;
  /** Mirrors read-guild-config DEFAULTS — write-time importance-at-ingest scorer (default true). */
  importanceAtIngest: boolean;
  ingestSimilarityGate: number;
  shortOutputThreshold: Record<string, Record<string, number>>;
  knowledge: KnowledgeConfigBlock;
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
  // R-019: FDC-13 MCP transport flags. Optional in the type (defaults provided by DEFAULTS.mcp)
  // so partial flag overrides in tests and consumer code remain type-safe.
  stdio_available?: boolean;
  http_available?: boolean;
  bridge_package?: string | null;
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
  fallback_to_claude: boolean; // R-015: CR-3 level-4 Claude-only fallback. Default true.
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
  host: HostId | "auto";
  /** LW1-6: per-run role pins. Default all null = auto-resolve via the role model. */
  roles: RolesBlock;
  /** LW1-6: per-host config-render overrides keyed by host_id. Default {} = none. */
  host_profiles: HostProfilesBlock;
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
  /** R-009: status-line pane enable. Default false. --statusline CLI flag or config set statusline true. */
  statusline: boolean;
  /** R-008: cross-review provider pin. "auto" = provider-detect selects best. Default "auto". */
  adversarial_review_provider: string;
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

const DEFAULTS = SHARED_DEFAULTS as unknown as ResolvedConfig;

// ---------------------------------------------------------------------------
// Dangerous prototype-pollution key names — blocked at every merge level.
// PROTO_POISON_KEYS is the canonical single-source set (re-arch WAVE 1),
// imported from ./shared/safe-object above.
// ---------------------------------------------------------------------------
// Closed host-key set for models.tiers.<tier>.* (G-11 + G-lane rework).
// Mirrors VALID_TIER_HOST_KEYS in read-guild-config.ts: unknown host keys
// (e.g. a "claudee" typo) are stripped at sparse-parse time so they never
// merge through the layer chain into the resolved config. --validate (the
// read-guild-config path) hard-rejects them; this resolver is tolerant by
// design, so it strips instead of throwing.
// ---------------------------------------------------------------------------

const VALID_TIER_HOST_KEYS = new Set<string>(HOST_IDS);

// LW1-6: known registry host ids (single SoT — host-registry-schema.ts HOST_IDS).
const KNOWN_HOST_IDS = new Set<string>(HOST_IDS);

/** Sparse-parse the `roles` block: carry only valid {host,advisory,adversarial} pins. */
function sparseRoles(raw: Record<string, unknown>): RolesBlock {
  const out: Partial<RolesBlock> = {};
  for (const k of ["host", "advisory", "adversarial"] as const) {
    const v = raw[k];
    if (v === null) out[k] = null;
    else if (typeof v === "string") {
      const normalized = normalizeHostId(v);
      if (normalized) out[k] = normalized;
    }
  }
  return out as RolesBlock;
}

/**
 * Sparse-parse `host_profiles` on the RESOLVE path. FAIL-CLOSED: reuse the strict entry-shape
 * validator (single SoT — lib/host-profiles-validate.ts, the same rules `config validate`
 * runs) and DROP any malformed entry so resolveSettings() never emits malformed host_profiles
 * content (Codex G-lane item3). An entry with an unknown host_id, unknown entry key
 * (e.g. host_profiles.claude.bogus_key), non-boolean `enabled`, or malformed `models` is
 * omitted — not passed through unchanged.
 */
function sparseHostProfiles(raw: Record<string, unknown>): HostProfilesBlock {
  return filterHostProfiles(raw) as HostProfilesBlock;
}

/** Sparse-copy a raw tier host map keeping ONLY the closed host-key set. */
function sparseTierHostMap(raw: Record<string, unknown>): TierHostMap {
  const out: Record<string, unknown> = {};
  for (const hk of Object.keys(raw)) {
    const canonicalHostId = normalizeHostId(hk);
    if (canonicalHostId) out[canonicalHostId] = raw[hk];
  }
  return out as unknown as TierHostMap;
}

// ---------------------------------------------------------------------------
// Valid value sets (mirrors read-guild-config.ts)
// ---------------------------------------------------------------------------

const VALID_LOOPS      = new Set(["none", "spec", "plan", "implementation", "all"]);
const VALID_RIGOR      = new Set(["quick", "standard", "deep"]);
const VALID_REVIEW     = new Set(["local", "cross", "off"]);
const DISPATCH_HOST_IDS = new Set<HostId>(
  HOST_IDS.filter((id): id is HostId => HOST_REGISTRY_ROWS[id].dispatch_selectable === true)
);

function normalizeDispatchHostId(value: string): HostId | null {
  const normalized = normalizeHostId(value);
  return normalized && DISPATCH_HOST_IDS.has(normalized) ? normalized : null;
}
// G-14 (SC-9): "qa" token — PASS-only auto-proceed (mirrors read-guild-config.ts).
const VALID_PHASES     = new Set(["spec", "plan", "build", "qa", "all"]);
const VALID_AGENT_MODE = new Set(["team", "agent", "subagent", "auto"]);
const VALID_CACHE_TTL  = new Set(["1h", "5m", "off"]);

const VALID_MODELS_KEYS = new Set([
  "enabled", "tiers", "scoreWeights", "thresholds", "advisorRounds",
  "escalationMarkers", "recallBeforeRead", "recallScoreThreshold",
  "structuredOutputRequired", "cacheTTL", "importanceGate", "compositeRecall", "importanceAtIngest", "ingestSimilarityGate",
  "shortOutputThreshold", "knowledge",
]);
const VALID_SECURITY_KEYS       = new Set(["bypass_permissions_policy"]);
const VALID_SECRETS_POLICY_KEYS = new Set([
  "env_allowlist", "redaction_patterns", "fail_mode_durable", "fail_mode_telemetry",
]);
const VALID_MCP_KEYS        = new Set([
  "tool_description_hashes",
  "stdio_available", "http_available", "bridge_package", // R-019
]);
const VALID_INDEX_KEYS      = new Set([
  "enabled", "kg_node_threshold", "kg_size_threshold_mb",
  "links_edge_threshold", "runs_threshold", "wiki_file_threshold",
]);
const DEFAULTS_ALLOWED_KEYS = new Set([
  "auto_learn", "adversarial", "team", "review_workflow", "skill_policy",
  "gates", "wiki", "quality", "reporting", "index", "cross_host",
  "retry", "resume",                // R-016
  "heartbeat_timeout_ms",           // R-017
  "capability_manifest_ttl_s",      // R-018
  "allowed_tools",                  // R-020
  "update",                         // plugin-update-lifecycle AC-6
]);
const TIER1_KEYS = new Set([
  "rigor", "auto_approve", "review", "host", "roles", "host_profiles", "initiative_default",
  "index", "record_status_runs", "codex_skip_enforcement", "agent_mode", "workspace",
  "models", "security", "secrets_policy", "mcp",
  "statusline",                  // R-009
  "adversarial_review_provider", // R-008
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

// Workspace-manifest parsing + ancestor discovery are extracted to the shared
// sibling module so detection (host-open-preflight) and this resolver bind to ONE
// classifier (§E3/§E8). Imported (NOT re-exported) to keep the settings-resolver
// shim surface unchanged (parity guard).
import { discoverWorkspace } from "./workspace-manifest";

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
  if (parsed["host"] === "auto") out.host = "auto";
  else if (typeof parsed["host"] === "string") {
    const normalized = normalizeDispatchHostId(parsed["host"]);
    if (normalized) out.host = normalized;
  }
  // LW1-6: roles + host_profiles (sparse — deep-merged across layers by assembleLayers).
  if (isPlainObject(parsed["roles"]))
    out.roles = sparseRoles(parsed["roles"] as Record<string, unknown>);
  if (isPlainObject(parsed["host_profiles"]))
    out.host_profiles = sparseHostProfiles(parsed["host_profiles"] as Record<string, unknown>);
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
          // G-lane rework: strip unknown host keys (closed set: claude|codex)
          sparseTiers[tier] = sparseTierHostMap(rt[tier] as Record<string, unknown>);
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
    if (typeof rawModels["compositeRecall"] === "boolean")
      sparse.compositeRecall = rawModels["compositeRecall"];
    if (typeof rawModels["importanceAtIngest"] === "boolean")
      sparse.importanceAtIngest = rawModels["importanceAtIngest"];
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
    if (isPlainObject(rawModels["knowledge"])) {
      const rawK = rawModels["knowledge"] as Record<string, unknown>;
      const sparseK: Partial<KnowledgeConfigBlock> = {};
      if (typeof rawK["maxDepth"] === "number" && rawK["maxDepth"] >= 1)
        sparseK.maxDepth = Math.floor(rawK["maxDepth"] as number);
      if (typeof rawK["maxBranching"] === "number" && rawK["maxBranching"] >= 1)
        sparseK.maxBranching = Math.floor(rawK["maxBranching"] as number);
      if (typeof rawK["minTopicImportance"] === "number" && rawK["minTopicImportance"] >= 0 && rawK["minTopicImportance"] <= 1)
        sparseK.minTopicImportance = rawK["minTopicImportance"] as number;
      if (typeof rawK["relMinConf"] === "number" && rawK["relMinConf"] >= 0 && rawK["relMinConf"] <= 1)
        sparseK.relMinConf = rawK["relMinConf"] as number;
      if (typeof rawK["maxFiles"] === "number" && rawK["maxFiles"] >= 1)
        sparseK.maxFiles = Math.floor(rawK["maxFiles"] as number);
      if (typeof rawK["maxTokens"] === "number" && rawK["maxTokens"] >= 1)
        sparseK.maxTokens = Math.floor(rawK["maxTokens"] as number);
      if (typeof rawK["batchSize"] === "number" && rawK["batchSize"] >= 1)
        sparseK.batchSize = Math.floor(rawK["batchSize"] as number);
      sparse.knowledge = sparseK as KnowledgeConfigBlock;
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
    // R-019: transport availability flags
    if (typeof rawMcp["stdio_available"] === "boolean") sparseMcp.stdio_available = rawMcp["stdio_available"];
    if (typeof rawMcp["http_available"] === "boolean")  sparseMcp.http_available  = rawMcp["http_available"];
    if (rawMcp["bridge_package"] === null || typeof rawMcp["bridge_package"] === "string")
      sparseMcp.bridge_package = rawMcp["bridge_package"] as string | null;
    out.mcp = sparseMcp as McpBlock;
  }
  // R-009: statusline
  if (typeof parsed["statusline"] === "boolean") out.statusline = parsed["statusline"];
  // R-008: adversarial_review_provider — open string; any non-empty string is valid
  if (typeof parsed["adversarial_review_provider"] === "string") {
    out.adversarial_review_provider = parsed["adversarial_review_provider"];
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
  if (parsed["host"] === "auto") out.host = "auto";
  else if (typeof parsed["host"] === "string") {
    const normalized = normalizeDispatchHostId(parsed["host"]);
    if (normalized) out.host = normalized;
  }
  // LW1-6: roles + host_profiles (sparse — deep-merged across layers by assembleLayers).
  if (isPlainObject(parsed["roles"]))
    out.roles = sparseRoles(parsed["roles"] as Record<string, unknown>);
  if (isPlainObject(parsed["host_profiles"]))
    out.host_profiles = sparseHostProfiles(parsed["host_profiles"] as Record<string, unknown>);
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
        // G-lane rework: strip unknown host keys (closed set: claude|codex)
        if (isPlainObject(rt[tier])) sparseTiers[tier] = sparseTierHostMap(rt[tier] as Record<string, unknown>);
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
    if (typeof rawModels["compositeRecall"] === "boolean")
      sparse.compositeRecall = rawModels["compositeRecall"];
    if (typeof rawModels["importanceAtIngest"] === "boolean")
      sparse.importanceAtIngest = rawModels["importanceAtIngest"];
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
    if (isPlainObject(rawModels["knowledge"])) {
      const rawK = rawModels["knowledge"] as Record<string, unknown>;
      const sparseK: Partial<KnowledgeConfigBlock> = {};
      if (typeof rawK["maxDepth"] === "number" && rawK["maxDepth"] >= 1)
        sparseK.maxDepth = Math.floor(rawK["maxDepth"] as number);
      if (typeof rawK["maxBranching"] === "number" && rawK["maxBranching"] >= 1)
        sparseK.maxBranching = Math.floor(rawK["maxBranching"] as number);
      if (typeof rawK["minTopicImportance"] === "number" && rawK["minTopicImportance"] >= 0 && rawK["minTopicImportance"] <= 1)
        sparseK.minTopicImportance = rawK["minTopicImportance"] as number;
      if (typeof rawK["relMinConf"] === "number" && rawK["relMinConf"] >= 0 && rawK["relMinConf"] <= 1)
        sparseK.relMinConf = rawK["relMinConf"] as number;
      if (typeof rawK["maxFiles"] === "number" && rawK["maxFiles"] >= 1)
        sparseK.maxFiles = Math.floor(rawK["maxFiles"] as number);
      if (typeof rawK["maxTokens"] === "number" && rawK["maxTokens"] >= 1)
        sparseK.maxTokens = Math.floor(rawK["maxTokens"] as number);
      if (typeof rawK["batchSize"] === "number" && rawK["batchSize"] >= 1)
        sparseK.batchSize = Math.floor(rawK["batchSize"] as number);
      sparse.knowledge = sparseK as KnowledgeConfigBlock;
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
    // R-019: transport availability flags
    if (typeof rawMcp["stdio_available"] === "boolean") sparseMcp.stdio_available = rawMcp["stdio_available"];
    if (typeof rawMcp["http_available"] === "boolean")  sparseMcp.http_available  = rawMcp["http_available"];
    if (rawMcp["bridge_package"] === null || typeof rawMcp["bridge_package"] === "string")
      sparseMcp.bridge_package = rawMcp["bridge_package"] as string | null;
    out.mcp = sparseMcp as McpBlock;
  }
  // R-009: statusline
  if (typeof parsed["statusline"] === "boolean") out.statusline = parsed["statusline"];
  // R-008: adversarial_review_provider — open string
  if (typeof parsed["adversarial_review_provider"] === "string") {
    out.adversarial_review_provider = parsed["adversarial_review_provider"];
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
// Initiative scope lookup (OD-1 conditional / FU-3)
// ---------------------------------------------------------------------------

/**
 * Validate that an initiative id is safe to use as a single directory-name
 * component inside .guild/initiatives/{active,archived}/.
 *
 * Mirrors the validateRunId pattern in run-lifecycle.ts and promote-upstream.ts.
 *
 * Rejects:
 *  - empty or whitespace-only
 *  - NUL byte (\x00)
 *  - absolute path prefix (/ or \)
 *  - any forward or backward slash (path separators)
 *  - lone "."
 *  - ".." anywhere in the string (catches pure "..", "..foo", "foo..bar")
 *
 * Returns true iff the id is safe to use as a directory segment.
 */
function isValidInitiativeId(id: string): boolean {
  if (!id || !id.trim()) return false;
  if (id.includes("\x00")) return false;
  if (id.startsWith("/") || id.startsWith("\\")) return false;
  if (id.includes("/") || id.includes("\\")) return false;
  if (id === ".") return false;
  if (id === ".." || id.startsWith("..")) return false;
  if (id.includes("..")) return false;
  return true;
}

/**
 * Assert that `candidatePath` is strictly contained within `baseDir` after
 * resolving both to absolute paths. Returns false (safe default) if not.
 * Defense-in-depth check applied after path.join to catch any edge case that
 * slips past isValidInitiativeId on unusual platforms.
 */
function isContainedIn(candidatePath: string, baseDir: string): boolean {
  const resolved = path.resolve(candidatePath);
  const resolvedBase = path.resolve(baseDir);
  return resolved.startsWith(resolvedBase + path.sep);
}

/**
 * Determine whether the initiative with the given `id` has `scope: "workspace"`
 * at the given workspace root.
 *
 * Lookup order (first hit wins):
 *  1. <workspaceRoot>/.guild/indexes/initiatives-registry.yaml
 *     Find the entry whose `id` matches; read its `scope`.
 *     (Registry lookup is by-value id match in parsed YAML — no path join involved.)
 *  2. Fallback: <workspaceRoot>/.guild/initiatives/active/<id>/initiative.yaml
 *     (also checks archived/ if active/ is absent)
 *     Read `initiative.scope`.
 *
 * Returns `true` iff scope resolves to exactly "workspace".
 * Returns `false` on ANY error (missing file, malformed YAML, missing entry,
 * unknown scope, invalid id, containment violation, etc.) — this is the safe
 * default (do NOT inherit).
 *
 * SECURITY: `id` is validated with isValidInitiativeId before being used as a
 * path segment. Defense-in-depth: a containment assertion is applied after
 * path.join. An invalid or escaping id always returns false — no file I/O.
 *
 * NEVER throws.
 */
export function initiativeIsWorkspaceScoped(
  workspaceRoot: string,
  id: string
): boolean {
  try {
    // --- Security: validate id before ANY file I/O using it as a path segment.
    // The registry lookup (step 1) uses by-value string comparison only and
    // does not join `id` into a path, so this guard is specifically for step 2.
    // We validate here (before step 1) so the function is unconditionally safe.
    if (!isValidInitiativeId(id)) return false;

    // --- 1. Try registry -------------------------------------------------
    // id is compared by value against registry entries — NOT used as a path.
    const registryPath = path.join(
      workspaceRoot,
      ".guild",
      "indexes",
      "initiatives-registry.yaml"
    );
    if (fs.existsSync(registryPath)) {
      try {
        const raw = fs.readFileSync(registryPath, "utf8");
        const parsed = yaml.load(raw) as Record<string, unknown> | null;
        if (isPlainObject(parsed)) {
          const list = (parsed as Record<string, unknown>)["initiatives"];
          if (Array.isArray(list)) {
            for (const entry of list) {
              if (!isPlainObject(entry)) continue;
              const rec = entry as Record<string, unknown>;
              if (rec["id"] === id) {
                // Found the entry — return true only for "workspace" scope
                return rec["scope"] === "workspace";
              }
            }
            // Entry not found in registry → fall through to initiative.yaml
          }
        }
      } catch {
        // Malformed YAML or read error → safe default: do NOT inherit
        return false;
      }
    }

    // --- 2. Fallback: initiative.yaml ------------------------------------
    // id has already been validated by isValidInitiativeId above.
    // Defense-in-depth: verify the joined path stays within the initiatives
    // base dir before reading.
    const initiativesBase = path.join(workspaceRoot, ".guild", "initiatives");

    const activePath = path.join(
      initiativesBase,
      "active",
      id,
      "initiative.yaml"
    );
    const archivedPath = path.join(
      initiativesBase,
      "archived",
      id,
      "initiative.yaml"
    );

    // Containment assertions — defense-in-depth after path.join
    const activeBase = path.join(initiativesBase, "active");
    const archivedBase = path.join(initiativesBase, "archived");
    if (!isContainedIn(activePath, activeBase) && !isContainedIn(archivedPath, archivedBase)) {
      // Resolved path escapes the expected base — reject
      return false;
    }

    let yamlPath: string | null = null;
    if (isContainedIn(activePath, activeBase) && fs.existsSync(activePath)) {
      yamlPath = activePath;
    } else if (isContainedIn(archivedPath, archivedBase) && fs.existsSync(archivedPath)) {
      yamlPath = archivedPath;
    }

    if (yamlPath !== null) {
      try {
        const raw = fs.readFileSync(yamlPath, "utf8");
        const parsed = yaml.load(raw) as Record<string, unknown> | null;
        if (isPlainObject(parsed)) {
          const doc = (parsed as Record<string, unknown>)["initiative"];
          if (isPlainObject(doc)) {
            return (doc as Record<string, unknown>)["scope"] === "workspace";
          }
        }
      } catch {
        // Malformed YAML → safe default
        return false;
      }
    }
  } catch {
    // Any unexpected error → safe default
    return false;
  }

  // No authoritative source found → safe default: do NOT inherit
  return false;
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

    // Strip non-inheritable keys from workspace layer.
    // EXCEPTION (OD-1 / FU-3): initiative_default inherits workspace→child ONLY
    // when the initiative it names has scope: "workspace" in the workspace
    // registry (or fallback initiative.yaml). workspace.mode is UNCONDITIONALLY
    // non-inheriting — the initiativeIsWorkspaceScoped check never applies to it.
    const wsInheritable: Partial<ResolvedConfig> = {};
    for (const [k, v] of Object.entries(rawWsSettings) as Array<[keyof ResolvedConfig, unknown]>) {
      const key = k as string;
      if (!NON_INHERITABLE_KEYS.has(key)) {
        (wsInheritable as Record<string, unknown>)[key] = v;
      } else if (key === "initiative_default" && typeof v === "string" && v !== null) {
        // Conditional exception: allow through only if the initiative is workspace-scoped
        if (initiativeIsWorkspaceScoped(ws.rootDir, v)) {
          (wsInheritable as Record<string, unknown>)[key] = v;
        }
        // Otherwise: do not add to wsInheritable (safe default: no inherit)
      }
      // workspace (workspace.mode): unconditionally non-inheriting — never added
    }
    wsSettings = wsInheritable;

    // Update sources for workspace-inherited keys
    for (const key of Object.keys(wsSettings)) {
      if (key !== "workspace") sources[key] = "workspace";
    }

    // Layer C: workspace settings.local.json
    try {
      const rawWsLocal = parseLocalFile(wsGuildDir);
      // Strip non-inheritable keys (same conditional exception for initiative_default)
      const wsLocalInheritable: Partial<ResolvedConfig> = {};
      for (const [k, v] of Object.entries(rawWsLocal) as Array<[keyof ResolvedConfig, unknown]>) {
        const key = k as string;
        if (!NON_INHERITABLE_KEYS.has(key)) {
          (wsLocalInheritable as Record<string, unknown>)[key] = v;
        } else if (key === "initiative_default" && typeof v === "string" && v !== null) {
          if (initiativeIsWorkspaceScoped(ws.rootDir, v)) {
            (wsLocalInheritable as Record<string, unknown>)[key] = v;
          }
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

  // R-007: top-level `index:"off"` must cohere with IndexBlock.enabled.
  // The two config surfaces are separate (top-level "index" key for the CLI / settings,
  // defaults.index.enabled for the SQLite cache gate) but must stay consistent after
  // all layers are merged. When the resolved index is "off", force the cache gate off too.
  if (assembled.index === "off" && assembled.defaults.index.enabled !== false) {
    assembled.defaults = {
      ...assembled.defaults,
      index: { ...assembled.defaults.index, enabled: false },
    };
  }

  return { config: assembled, sources };
}

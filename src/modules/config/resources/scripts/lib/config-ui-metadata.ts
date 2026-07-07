/**
 * scripts/lib/config-ui-metadata.ts
 *
 * init-config-goal lane L2 (§E10 / V9) — the HAND-AUTHORED config UI metadata table.
 * Keyed by the flattened dotted keys exported by config-schema.ts (`CONFIG_SCHEMA`,
 * derived from canonical DEFAULTS). There is NO generator: every key's group, label,
 * control, scope support, host visibility, editability, safety class, confirmation
 * strength, and native component mapping is declared here deliberately. The L5
 * coverage test (`config-ui-metadata-coverage.test.ts`) fails until every schema key
 * has metadata and `confirmation_strength >= default_for(safety_class)` holds.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ✓ SAFETY-CLASS SIGNED OFF (L3 security-auditor, run-8202a843).            │
 * │   The L2 §E10 DRAFT was reviewed RAISE-ONLY (spec line 174/176 — never    │
 * │   lower below the safety-class default). Verdict on the 5 decision points: │
 * │     • defaults.allowed_tools  advanced → security_sensitive (RAISED) —     │
 * │       a tool allow-list governs what an agent may invoke (permission grant).│
 * │     • mcp.bridge_package      advanced → security_sensitive (RAISED) —     │
 * │       selects an executable bridge (code-execution surface).               │
 * │     • mcp.stdio_available     advanced → security_sensitive (RAISED) —     │
 * │     • mcp.http_available      advanced → security_sensitive (RAISED) —     │
 * │       spec line 162: all mcp.* keys require strongest confirmation.        │
 * │     • agent_mode, host        CONFIRMED advanced (dispatch/host knobs;     │
 * │       not a permission/secret/cross-host/MCP-trust write).                 │
 * │     • review, defaults.adversarial  CONFIRMED dangerous (weaken a review   │
 * │       control = behavior-changing, danger confirmation; not security-      │
 * │       sensitive — they grant no permission/secret/host access).            │
 * │   Every schema-security_sensitive key stays `strongest` (floor holds).    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Ownership: CONFIG_UI_METADATA is L-core (L2). L3/L4 adapters only RENDER this
 * through host-native controls and route writes through the plugin config API.
 *
 * Module: config. Owned by tooling-engineer (L2).
 */

import { CONFIG_SCHEMA } from "./config-schema";

// ---------------------------------------------------------------------------
// Vocabulary (spec lines 139-174)
// ---------------------------------------------------------------------------

/** Control types (spec line 141 table). */
export type ControlType =
  | "text"
  | "number"
  | "boolean"
  | "enum"
  | "multi_select"
  | "string_array"
  | "object_editor"
  | "secret_array";

/** Confirmation strengths (spec line 154 table), ordered weakest → strongest. */
export type ConfirmationStrength = "none" | "normal" | "advanced" | "danger" | "strongest";

/** Safety classes (spec line 166 table). */
export type SafetyClass = "normal" | "advanced" | "dangerous" | "secret" | "security_sensitive";

/** Physical write scopes a key may be persisted to (spec line 162). */
export type ConfigScope = "workspace" | "project" | "local";

/** Host visibility — "all" host families, or an explicit allow-list of host ids. */
export type HostVisibility = "all" | readonly string[];

/** Editability — `replace_only` for secrets (never echo current value). */
export type Editability = "editable" | "replace_only";

/** One key's UI metadata (every field required by V9). */
export interface ConfigUiMeta {
  readonly group: string;
  readonly label: string;
  readonly control: ControlType;
  readonly scope_support: readonly ConfigScope[];
  readonly host_visibility: HostVisibility;
  readonly editability: Editability;
  /** Signed off by L3 (security-auditor), RAISE-ONLY per spec line 174/176. */
  readonly safety_class: SafetyClass;
  /** Must be >= default_for(safety_class). Signed off by L3 (security-auditor). */
  readonly confirmation_strength: ConfirmationStrength;
  /** Host-family → native component hint (spec line 275 "host-native component mapping"). */
  readonly native_component_map: Readonly<Record<string, string>>;
  /** Shown only in advanced/migration views when true (schema-evolution policy). */
  readonly deprecated: boolean;
}

// ---------------------------------------------------------------------------
// Safety-class → default confirmation (spec line 174) + ordering for V9's >= check
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIRMATION_FOR_SAFETY_CLASS: Readonly<Record<SafetyClass, ConfirmationStrength>> = {
  normal: "normal",
  advanced: "advanced",
  dangerous: "danger",
  secret: "strongest",
  security_sensitive: "strongest",
} as const;

export const CONFIRMATION_ORDER: readonly ConfirmationStrength[] = [
  "none",
  "normal",
  "advanced",
  "danger",
  "strongest",
];

function confirmationRank(c: ConfirmationStrength): number {
  return CONFIRMATION_ORDER.indexOf(c);
}

// ---------------------------------------------------------------------------
// Control → native component default
// ---------------------------------------------------------------------------

const NATIVE_COMPONENT_BY_CONTROL: Readonly<Record<ControlType, string>> = {
  text: "text_input",
  number: "number_input",
  boolean: "toggle",
  enum: "select",
  multi_select: "multi_select",
  string_array: "string_list_editor",
  object_editor: "object_editor",
  secret_array: "secret_list_editor",
} as const;

// ---------------------------------------------------------------------------
// meta() — hand-authoring constructor (fills derivable defaults; group/label/
// control/safety_class are always explicit per key).
// ---------------------------------------------------------------------------

interface MetaInput {
  group: string;
  label: string;
  control: ControlType;
  safety_class: SafetyClass;
  /** Override only to RAISE above the safety-class default. */
  confirmation_strength?: ConfirmationStrength;
  scope_support?: readonly ConfigScope[];
  host_visibility?: HostVisibility;
  editability?: Editability;
  native_component_map?: Readonly<Record<string, string>>;
  deprecated?: boolean;
}

const ALL_SCOPES: readonly ConfigScope[] = ["workspace", "project", "local"];

function meta(input: MetaInput): ConfigUiMeta {
  const confirmation =
    input.confirmation_strength ?? DEFAULT_CONFIRMATION_FOR_SAFETY_CLASS[input.safety_class];
  return {
    group: input.group,
    label: input.label,
    control: input.control,
    scope_support: input.scope_support ?? ALL_SCOPES,
    host_visibility: input.host_visibility ?? "all",
    editability: input.editability ?? (input.safety_class === "secret" ? "replace_only" : "editable"),
    safety_class: input.safety_class,
    confirmation_strength: confirmation,
    native_component_map: input.native_component_map ?? { default: NATIVE_COMPONENT_BY_CONTROL[input.control] },
    deprecated: input.deprecated ?? false,
  };
}

// ---------------------------------------------------------------------------
// The hand-authored table — non-tier keys explicit; the uniform models.tiers.*.*
// matrix enumerated below (one deliberate decision: advanced).
// ---------------------------------------------------------------------------

const EXPLICIT: Record<string, ConfigUiMeta> = {
  // ── Startup / workflow ─────────────────────────────────────────────────
  rigor: meta({ group: "startup", label: "Rigor profile", control: "enum", safety_class: "normal" }),
  review: meta({ group: "startup", label: "Review mode", control: "enum", safety_class: "dangerous" }),
  index: meta({ group: "startup", label: "Wiki SQLite index", control: "enum", safety_class: "normal" }),
  record_status_runs: meta({ group: "startup", label: "Record status runs", control: "boolean", safety_class: "normal" }),
  codex_skip_enforcement: meta({ group: "startup", label: "Codex review skip enforcement", control: "enum", safety_class: "security_sensitive" }),
  agent_mode: meta({ group: "startup", label: "Dispatch backend (agent mode)", control: "enum", safety_class: "advanced" }),
  statusline: meta({ group: "startup", label: "Status-line pane", control: "boolean", safety_class: "normal" }),
  initiative_default: meta({ group: "startup", label: "Default initiative", control: "text", safety_class: "normal" }),
  adversarial_review_provider: meta({ group: "startup", label: "Cross-review provider", control: "text", safety_class: "advanced" }),
  loops: meta({ group: "startup", label: "Active loops (CSV)", control: "text", safety_class: "normal" }),
  loop_cap: meta({ group: "startup", label: "Loop cap", control: "number", safety_class: "normal" }),
  codex_cap: meta({ group: "startup", label: "Codex review round cap", control: "number", safety_class: "normal" }),

  // ── Host & roles ───────────────────────────────────────────────────────
  host: meta({ group: "host_roles", label: "Execution host", control: "enum", safety_class: "advanced" }),
  "roles.host": meta({ group: "host_roles", label: "Host role pin", control: "enum", safety_class: "advanced" }),
  "roles.advisory": meta({ group: "host_roles", label: "Advisory role pin", control: "enum", safety_class: "advanced" }),
  "roles.adversarial": meta({ group: "host_roles", label: "Adversarial role pin", control: "enum", safety_class: "advanced" }),
  host_profiles: meta({ group: "host_roles", label: "Per-host config profiles", control: "object_editor", safety_class: "advanced" }),

  // ── Models & scoring (non-tier) ────────────────────────────────────────
  "models.enabled": meta({ group: "models", label: "Cost-tiered model scoring", control: "boolean", safety_class: "normal" }),
  "models.scoreWeights.workType": meta({ group: "models", label: "Score weight — work type", control: "number", safety_class: "advanced" }),
  "models.scoreWeights.blastRadius": meta({ group: "models", label: "Score weight — blast radius", control: "number", safety_class: "advanced" }),
  "models.scoreWeights.dependsOn": meta({ group: "models", label: "Score weight — depends-on", control: "number", safety_class: "advanced" }),
  "models.scoreWeights.security": meta({ group: "models", label: "Score weight — security", control: "number", safety_class: "advanced" }),
  "models.scoreWeights.priorEscalation": meta({ group: "models", label: "Score weight — prior escalation", control: "number", safety_class: "advanced" }),
  "models.thresholds.mid": meta({ group: "models", label: "Mid-tier threshold", control: "number", safety_class: "advanced" }),
  "models.thresholds.powerful": meta({ group: "models", label: "Powerful-tier threshold", control: "number", safety_class: "advanced" }),
  "models.advisorRounds": meta({ group: "models", label: "Advisor escalation rounds", control: "number", safety_class: "advanced" }),
  "models.escalationMarkers": meta({ group: "models", label: "Escalation marker phrases", control: "string_array", safety_class: "advanced" }),
  "models.structuredOutputRequired": meta({ group: "models", label: "Require structured output", control: "boolean", safety_class: "advanced" }),
  "models.cacheTTL.coordinator": meta({ group: "models", label: "Coordinator cache TTL", control: "enum", safety_class: "advanced" }),
  "models.cacheTTL.leaf": meta({ group: "models", label: "Leaf cache TTL", control: "enum", safety_class: "advanced" }),
  "models.shortOutputThreshold": meta({ group: "models", label: "Short-output thresholds", control: "object_editor", safety_class: "advanced" }),

  // ── Knowledge / recall / indexing ──────────────────────────────────────
  "models.recallBeforeRead": meta({ group: "knowledge_recall", label: "Recall before read", control: "boolean", safety_class: "normal" }),
  "models.recallScoreThreshold": meta({ group: "knowledge_recall", label: "Recall score threshold", control: "number", safety_class: "normal" }),
  "models.importanceGate": meta({ group: "knowledge_recall", label: "Importance gate", control: "number", safety_class: "advanced" }),
  "models.compositeRecall": meta({ group: "knowledge_recall", label: "Composite recall scoring", control: "boolean", safety_class: "advanced" }),
  "models.importanceAtIngest": meta({ group: "knowledge_recall", label: "Importance-at-ingest scorer", control: "boolean", safety_class: "advanced" }),
  "models.ingestSimilarityGate": meta({ group: "knowledge_recall", label: "Ingest similarity gate", control: "number", safety_class: "advanced" }),
  "models.knowledge.maxDepth": meta({ group: "knowledge_recall", label: "Knowledge graph max depth", control: "number", safety_class: "advanced" }),
  "models.knowledge.maxBranching": meta({ group: "knowledge_recall", label: "Knowledge graph max branching", control: "number", safety_class: "advanced" }),
  "models.knowledge.minTopicImportance": meta({ group: "knowledge_recall", label: "Min topic importance", control: "number", safety_class: "advanced" }),
  "models.knowledge.relMinConf": meta({ group: "knowledge_recall", label: "Relationship min confidence", control: "number", safety_class: "advanced" }),
  "models.knowledge.maxFiles": meta({ group: "knowledge_recall", label: "Knowledge scan max files", control: "number", safety_class: "advanced" }),
  "models.knowledge.maxTokens": meta({ group: "knowledge_recall", label: "Knowledge scan max tokens", control: "number", safety_class: "advanced" }),
  "models.knowledge.batchSize": meta({ group: "knowledge_recall", label: "Knowledge batch size", control: "number", safety_class: "advanced" }),

  // ── Team & gates ───────────────────────────────────────────────────────
  auto_approve: meta({ group: "team_gates", label: "Auto-approve phases", control: "multi_select", safety_class: "security_sensitive" }),
  "defaults.auto_learn": meta({ group: "team_gates", label: "Auto-learn on init", control: "boolean", safety_class: "normal" }),
  "defaults.adversarial": meta({ group: "team_gates", label: "Adversarial review", control: "enum", safety_class: "dangerous" }),
  "defaults.team.size": meta({ group: "team_gates", label: "Team size cap", control: "number", safety_class: "normal" }),
  "defaults.team.always_include": meta({ group: "team_gates", label: "Always-include specialists", control: "string_array", safety_class: "normal" }),
  "defaults.review_workflow": meta({ group: "team_gates", label: "Review workflow", control: "enum", safety_class: "advanced" }),
  "defaults.skill_policy": meta({ group: "team_gates", label: "Skill policy", control: "enum", safety_class: "advanced" }),
  "defaults.gates.auto_approve": meta({ group: "team_gates", label: "Gate auto-approve list", control: "multi_select", safety_class: "security_sensitive" }),
  // L3 RAISED advanced→security_sensitive: a tool allow-list is a permission grant (what an agent may invoke).
  "defaults.allowed_tools": meta({ group: "team_gates", label: "Allowed tools", control: "string_array", safety_class: "security_sensitive" }),

  // ── Wiki / quality / reporting ─────────────────────────────────────────
  "defaults.wiki.share_mode": meta({ group: "wiki_quality", label: "Wiki share mode", control: "enum", safety_class: "normal" }),
  "defaults.wiki.autopromote": meta({ group: "wiki_quality", label: "Wiki autopromote", control: "boolean", safety_class: "advanced" }),
  "defaults.quality.budget.per_class_minutes": meta({ group: "wiki_quality", label: "Quality budget — per class (min)", control: "number", safety_class: "normal" }),
  "defaults.quality.budget.total_minutes": meta({ group: "wiki_quality", label: "Quality budget — total (min)", control: "number", safety_class: "normal" }),
  "defaults.reporting": meta({ group: "wiki_quality", label: "Reporting verbosity", control: "enum", safety_class: "normal" }),

  // ── Indexing thresholds (defaults.index.*) ─────────────────────────────
  "defaults.index.enabled": meta({ group: "indexing", label: "SQLite index cache enabled", control: "boolean", safety_class: "normal" }),
  "defaults.index.kg_node_threshold": meta({ group: "indexing", label: "Index — KG node threshold", control: "number", safety_class: "advanced" }),
  "defaults.index.kg_size_threshold_mb": meta({ group: "indexing", label: "Index — KG size threshold (MB)", control: "number", safety_class: "advanced" }),
  "defaults.index.links_edge_threshold": meta({ group: "indexing", label: "Index — links edge threshold", control: "number", safety_class: "advanced" }),
  "defaults.index.runs_threshold": meta({ group: "indexing", label: "Index — runs threshold", control: "number", safety_class: "advanced" }),
  "defaults.index.wiki_file_threshold": meta({ group: "indexing", label: "Index — wiki file threshold", control: "number", safety_class: "advanced" }),

  // ── Cross-host & runtime ───────────────────────────────────────────────
  "defaults.cross_host.enabled": meta({ group: "cross_host_runtime", label: "Cross-host dispatch enabled", control: "boolean", safety_class: "security_sensitive" }),
  "defaults.cross_host.hosts": meta({ group: "cross_host_runtime", label: "Cross-host endpoints", control: "object_editor", safety_class: "security_sensitive" }),
  "defaults.cross_host.fallback_to_claude": meta({ group: "cross_host_runtime", label: "Cross-host fallback to Claude", control: "boolean", safety_class: "security_sensitive" }),
  "defaults.retry.max_attempts": meta({ group: "cross_host_runtime", label: "Lane retry max attempts", control: "number", safety_class: "advanced" }),
  "defaults.retry.backoff": meta({ group: "cross_host_runtime", label: "Lane retry backoff", control: "enum", safety_class: "advanced" }),
  "defaults.resume.enabled": meta({ group: "cross_host_runtime", label: "Run resume enabled", control: "boolean", safety_class: "normal" }),
  "defaults.heartbeat_timeout_ms": meta({ group: "cross_host_runtime", label: "Heartbeat timeout (ms)", control: "number", safety_class: "advanced" }),
  "defaults.capability_manifest_ttl_s": meta({ group: "cross_host_runtime", label: "Capability manifest TTL (s)", control: "number", safety_class: "advanced" }),

  // ── Safety / platform ──────────────────────────────────────────────────
  "security.bypass_permissions_policy": meta({ group: "safety_platform", label: "Bypass-permissions policy", control: "enum", safety_class: "security_sensitive" }),
  "secrets_policy.env_allowlist": meta({ group: "safety_platform", label: "Env var allow-list", control: "string_array", safety_class: "security_sensitive" }),
  "secrets_policy.redaction_patterns": meta({ group: "safety_platform", label: "Redaction patterns", control: "secret_array", safety_class: "secret" }),
  "secrets_policy.fail_mode_durable": meta({ group: "safety_platform", label: "Secrets fail-mode (durable)", control: "enum", safety_class: "security_sensitive" }),
  "secrets_policy.fail_mode_telemetry": meta({ group: "safety_platform", label: "Secrets fail-mode (telemetry)", control: "enum", safety_class: "security_sensitive" }),
  "mcp.tool_description_hashes": meta({ group: "safety_platform", label: "MCP tool-description trust hashes", control: "object_editor", safety_class: "security_sensitive" }),
  // L3 RAISED advanced→security_sensitive: spec line 162 — all mcp.* keys require strongest confirmation
  // (MCP transport/bridge governs what external servers/executables may connect).
  "mcp.stdio_available": meta({ group: "safety_platform", label: "MCP stdio transport", control: "boolean", safety_class: "security_sensitive" }),
  "mcp.http_available": meta({ group: "safety_platform", label: "MCP HTTP transport", control: "boolean", safety_class: "security_sensitive" }),
  // bridge_package selects an executable bridge — a code-execution surface.
  "mcp.bridge_package": meta({ group: "safety_platform", label: "MCP bridge package", control: "text", safety_class: "security_sensitive" }),

  // ── Workspace topology ─────────────────────────────────────────────────
  // workspace.mode is detection-only: it persists only to the current root/project
  // and local scopes, never as an inherited workspace write from a child (spec line 162).
  "workspace.mode": meta({
    group: "workspace",
    label: "Workspace mode (detection)",
    control: "enum",
    safety_class: "advanced",
    scope_support: ["project", "local"],
  }),
};

// Uniform models.tiers.<tier>.<host> matrix — one deliberate hand-authored decision
// (model picker per tier×host; advanced). Enumerated over the ACTUAL schema keys so
// it never drifts from CONFIG_SCHEMA's host set.
const TIER_MATRIX: Record<string, ConfigUiMeta> = {};
for (const spec of CONFIG_SCHEMA) {
  if (!spec.key.startsWith("models.tiers.")) continue;
  const parts = spec.key.split("."); // models.tiers.<tier>.<host>
  const tier = parts[2];
  const host = parts.slice(3).join(".");
  TIER_MATRIX[spec.key] = meta({
    group: "models",
    label: `Model — ${tier} tier · ${host}`,
    control: "text",
    safety_class: "advanced",
  });
}

/**
 * The hand-authored config UI metadata table, keyed by flattened CONFIG_SCHEMA keys.
 * safety_class + confirmation_strength signed off by L3 (security-auditor, RAISE-ONLY).
 */
export const CONFIG_UI_METADATA: Readonly<Record<string, ConfigUiMeta>> = {
  ...EXPLICIT,
  ...TIER_MATRIX,
};

// ---------------------------------------------------------------------------
// Coverage / invariant self-check (consumed by the L5 V9 coverage test)
// ---------------------------------------------------------------------------

export interface MetadataCoverageReport {
  /** Schema keys with no metadata entry. */
  readonly missing: readonly string[];
  /** Metadata keys not present in CONFIG_SCHEMA. */
  readonly extra: readonly string[];
  /** Keys where confirmation_strength < default_for(safety_class) (spec line 176). */
  readonly confirmationViolations: readonly string[];
  readonly ok: boolean;
}

/** Verify every CONFIG_SCHEMA key has metadata and the V9 confirmation-floor holds. */
export function verifyMetadataCoverage(): MetadataCoverageReport {
  const schemaKeys = new Set(CONFIG_SCHEMA.map((s) => s.key));
  const metaKeys = new Set(Object.keys(CONFIG_UI_METADATA));

  const missing = [...schemaKeys].filter((k) => !metaKeys.has(k)).sort();
  const extra = [...metaKeys].filter((k) => !schemaKeys.has(k)).sort();

  const confirmationViolations: string[] = [];
  for (const [key, m] of Object.entries(CONFIG_UI_METADATA)) {
    const floor = DEFAULT_CONFIRMATION_FOR_SAFETY_CLASS[m.safety_class];
    if (confirmationRank(m.confirmation_strength) < confirmationRank(floor)) {
      confirmationViolations.push(key);
    }
  }

  return {
    missing,
    extra,
    confirmationViolations: confirmationViolations.sort(),
    ok: missing.length === 0 && extra.length === 0 && confirmationViolations.length === 0,
  };
}

/** Lookup metadata for a flattened key. */
export function getUiMeta(key: string): ConfigUiMeta | undefined {
  return CONFIG_UI_METADATA[key];
}

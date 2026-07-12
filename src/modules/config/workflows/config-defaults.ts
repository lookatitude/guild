/**
 * src/modules/config/workflows/config-defaults.ts
 *
 * Canonical settings defaults shared by the settings resolver and config CLI.
 * Extracted as part of W3 god-file split (settings-resolver.ts/read-guild-config.ts).
 *
 * Module: config — zero internal deps, only node builtins or external packages.
 * These constants are consumed by core/settings-reader.ts and core/config-cli.ts.
 */

/** Default escalation marker phrases for the cost auto-scorer. */
export const DEFAULT_ESCALATION_MARKERS: string[] = [
  "I'm not sure",
  "unclear",
  "cannot determine",
  "I don't know",
  "ambiguous",
  "uncertain",
  "not enough information",
];

/** Keys excluded from workspace-to-child inheritance (OD-1 + detection-only). */
export const NON_INHERITABLE_KEYS: ReadonlySet<string> = new Set<string>([
  "initiative_default", // OD-1: attach-to-wrong-initiative risk
  "workspace",          // workspace.mode is root-detection-only
]);

/** Default rotation threshold for JSONL log files — 10 MiB. */
export const LOG_ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;

/** Default sidecar file cap — 1 MiB. */
export const SIDECAR_MAX_BYTES = 1024 * 1024;

/**
 * Canonical Guild settings default tree.
 *
 * Keep this file free of internal runtime imports: config defaults must remain
 * usable by both core settings code paths without pulling host/runtime layers upward.
 */
export const DEFAULTS = {
  rigor: "standard",
  auto_approve: [],
  review: "local",
  host: "auto",
  roles: { host: null, advisory: null, adversarial: null },
  host_profiles: {},
  initiative_default: null,
  index: "auto",
  record_status_runs: true,
  codex_skip_enforcement: "warn",
  agent_mode: "auto",
  workspace: { mode: "auto" },
  models: {
    enabled: true,
    tiers: {
      cheap:    { "claude-code-cli": "haiku",  "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null },
      mid:      { "claude-code-cli": "sonnet", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null },
      powerful: { "claude-code-cli": "opus",   "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null },
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
    compositeRecall: true,
    importanceAtIngest: true,
    ingestSimilarityGate: 0.80,
    shortOutputThreshold: {},
    knowledge: {
      maxDepth: 8,
      maxBranching: 12,
      minTopicImportance: 0.4,
      relMinConf: 0.5,
      maxFiles: 3000,
      maxTokens: 1_000_000,
      batchSize: 20,
    },
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
    stdio_available: true,
    http_available: false,
    bridge_package: null,
  },
  statusline: false,
  adversarial_review_provider: "auto",
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
    cross_host: { enabled: false, hosts: {}, fallback_to_claude: true },
    retry: { max_attempts: 1, backoff: "exponential" },
    resume: { enabled: true },
    heartbeat_timeout_ms: 600000,
    capability_manifest_ttl_s: 3600,
    // plugin-update-lifecycle G1 AC-6: update-signal behavior. `notify` prints
    // the SessionStart signal; `auto` additionally stages the host apply path;
    // `off` silences everything. cadence_hours bounds the ls-remote cache TTL.
    update: { mode: "notify", cadence_hours: 24 },
    allowed_tools: [],
  },
} as const;

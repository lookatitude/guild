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

// ---------------------------------------------------------------------------
// Project-capability localization vocabularies (spec S5; cap-loc-D03/D04)
// ---------------------------------------------------------------------------

/**
 * D03's migration ladder, ordered least→most localized. `resolver_mode` records
 * WHERE A PROJECT IS on this ladder; it never encodes whether it may advance —
 * advance conditions are gate criteria the initiative evaluates, and a mode change
 * is always a deliberate write.
 *
 * Ordered on purpose: a consumer comparing progress must not re-derive the order
 * from a set, and `indexOf` here is the only ranking anyone should use.
 */
export const CAPABILITY_RESOLVER_MODES = [
  "legacy",
  "observe",
  "shadow",
  "project-local",
  "strict",
] as const;
export type CapabilityResolverMode = (typeof CAPABILITY_RESOLVER_MODES)[number];

/** Whether an approved proposal may auto-advance the resolver mode (D04). */
export const CAPABILITY_AUTO_CREATE_POLICIES = ["never", "on_approval"] as const;
export type CapabilityAutoCreatePolicy = (typeof CAPABILITY_AUTO_CREATE_POLICIES)[number];

/**
 * Shipped default for `capability.resolver_mode`.
 *
 * ── WHY `legacy` AND NOT D04's `observe` ────────────────────────────────────
 * S5 §"Hard precondition (from D04)" is explicit: *"Do not ship the `observe`
 * default until F7 (candidate surfacing in `/guild:status`) lands. An `observe`
 * install that emits candidates nobody surfaces is a silent no-op — worse than no
 * default."* F7 has not landed, so shipping `observe` today would create exactly
 * the vacuous behavior the precondition forbids: profiling would run, candidates
 * would accumulate, and no surface would ever show them to a human.
 *
 * `legacy` is the honest value for a codebase that has no localization machinery
 * wired yet — it says "this project resolves the way it always has", which is true.
 *
 * ── FLIPPING IT ─────────────────────────────────────────────────────────────
 * When F7 lands, change this ONE constant to `"observe"`. Nothing else moves:
 * DEFAULTS reads it, CONFIG_SCHEMA derives from DEFAULTS, and the conformance
 * test `capability-config.test.ts` already carries the post-F7 expectation in a
 * test named for the flip, so the change is one line plus one expectation.
 */
export const CAPABILITY_RESOLVER_MODE_DEFAULT: CapabilityResolverMode = "legacy";

/**
 * D04's intended default once F7 (candidate surfacing) lands. Exported so the flip
 * is a documented, testable transition rather than a remembered intention — see
 * CAPABILITY_RESOLVER_MODE_DEFAULT.
 */
export const CAPABILITY_RESOLVER_MODE_AFTER_F7: CapabilityResolverMode = "observe";

/**
 * Inclusive bounds for `capability.suggestion_budget` (D04/F10: fixed at 4, not
 * "3–4"). The ceiling matches the one S1's profile validator enforces so the two
 * cannot disagree; `0` is legal and means "profile but never propose".
 */
export const CAPABILITY_SUGGESTION_BUDGET_MIN = 0;
export const CAPABILITY_SUGGESTION_BUDGET_MAX = 4;

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
  /**
   * rf-wi-01 (v23x-deferred-followups G1) — the sanctioned P1-L10 host-autonomy
   * override (host_mode × guild_gates orthogonality invariant, permission-policy-schema.ts).
   * null (default) = no override; the host's own default ("ask", lifted to "bypass_all" for
   * unattended team panes per issue #54) applies. NOT under `security.` — the #54 lane
   * explicitly reverted an ad-hoc `security.host_mode` key because it bypassed this schema;
   * this top-level placement (sibling of the `host` dispatch selector) is the registered
   * replacement. One of only three keys ever legitimately null-typed at the top level.
   */
  host_mode: null,
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
    // G4b (host-reachability): every host in the registry's HOST_IDS gets an
    // explicit tier slot — NOT generated by importing HOST_IDS here (this file's
    // own contract, stated in the module doc comment above, is to stay free of
    // internal runtime imports so core settings code can load it before the
    // host-runtime layer). The literal key set below IS the full 16-id HOST_IDS
    // roster (host-registry-schema.ts) enumerated by hand; a jest test
    // (scripts/__tests__/config-defaults-tiers-host-ids.test.ts) asserts the two
    // stay in sync so this can never silently drift again the way it had (7 of
    // 16 hosts were missing a slot before this fix). Only claude-code-cli has a
    // non-null model — every other host's registry row carries `models.<tier>.model:
    // null` (no Guild-mapped model), so `null` here is the HONEST default, not a
    // gap (see tier-defaults.ts's `tierDefaults()` for the runtime-computed
    // equivalent this static scaffold mirrors).
    tiers: {
      cheap:    { "claude-code-cli": "haiku",  "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null },
      mid:      { "claude-code-cli": "sonnet", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null },
      powerful: { "claude-code-cli": "opus",   "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null },
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
  /**
   * Project-capability localization (spec S5; decisions cap-loc-D04 new-install
   * policy, cap-loc-D03 migration window). Closes audit gaps D12 (no config keys
   * existed), F3 (resolver-mode ownership undefined) and F10 (budget "3–4").
   *
   * These keys select WHICH DEFINITIONS RESOLVE — they are deliberately NOT
   * security-sensitive (`isSecuritySensitiveKey` matches none of them, correctly).
   * What a lane may DO stays with `capability_scope` and the permission keys.
   *
   * Scope is `project` for all four, which is what the CONFIG_SCHEMA generator
   * already emits unconditionally — capability ownership is per project by
   * definition (the umbrella and each child answer "what roles do I need"
   * independently, and D03 has the four repos migrating at different rates). Per
   * S5 spec-call #2, per-key `scope` is NOT introduced here: the right values fall
   * out with zero generator change, and adding it would touch every existing key.
   */
  capability: {
    /**
     * Which resolver mode this project is in on D03's migration ladder. Config
     * records WHERE WE ARE, never WHETHER WE MAY MOVE — advance conditions are
     * gate criteria the initiative evaluates, and a mode change is a deliberate
     * write.
     *
     * DEFAULT IS `legacy`, NOT `observe` — see CAPABILITY_RESOLVER_MODE_DEFAULT in
     * capability-config.ts for the F7 precondition governing the flip to D04's
     * intended `observe`. Never silently defaulted: an unset value resolves with
     * provenance `default`, so `config show --sources` shows it was never chosen.
     */
    resolver_mode: CAPABILITY_RESOLVER_MODE_DEFAULT,
    /**
     * Max capability proposals surfaced per project (D04/F10: fixed at 4, not
     * "3–4"). Range [0, 4] — the same ceiling S1's profile validator enforces, so
     * the two cannot disagree. 0 is legal: "profile but never propose".
     */
    suggestion_budget: 4,
    /**
     * Roles a new install starts with. EMPTY BY DESIGN — a non-empty default would
     * ship a roster, which is precisely what localization exists to stop. Empty ⇒
     * Learn proposes.
     */
    starter_roles: [],
    /** Whether an approved proposal may auto-advance the resolver mode (D04). */
    auto_create_policy: "on_approval",
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
    /**
     * rf-wi-01 (G1) — registers the guard hooks/lib/lean-lead-guard.ts already reads
     * tolerantly. enabled: advisory master toggle. hands_on_edit_threshold: direct lead
     * Edit/Write ops before the inline-shortcut-expired advisory fires (SKILL.md
     * "Inline shortcut under high autonomy").
     */
    lean_lead: { enabled: true, hands_on_edit_threshold: 8 },
    /**
     * rf-wi-01 (G1) — registers the guard hooks/lib/lifecycle-gate.ts already reads
     * tolerantly. enabled: master toggle. adhoc_activity_threshold: ad-hoc (non-skill)
     * activity count before the lifecycle gate advisory fires.
     */
    lifecycle_gate: { enabled: true, adhoc_activity_threshold: 20 },
  },
} as const;

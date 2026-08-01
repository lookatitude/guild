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
 * D04's intended default, now REACHED. Kept as a distinct name rather than folded
 * away: it records WHY the default is what it is, and it is what
 * `CAPABILITY_RESOLVER_MODE_DEFAULT` is defined as, so the two cannot drift apart
 * into a silent disagreement about which value F7 unlocked.
 */
export const CAPABILITY_RESOLVER_MODE_AFTER_F7: CapabilityResolverMode = "observe";

/**
 * Shipped default for `capability.resolver_mode`.
 *
 * ── F7 HAS LANDED, SO THIS IS `observe` ─────────────────────────────────────
 * S5 §"Hard precondition (from D04)" was explicit: *"Do not ship the `observe`
 * default until F7 (candidate surfacing in `/guild:status`) lands. An `observe`
 * install that emits candidates nobody surfaces is a silent no-op — worse than no
 * default."* That precondition is what held this constant at `legacy`.
 *
 * F7 is now closed. `scripts/lib/capability/candidate-surface.ts` reads the newest
 * emitted profile and renders a candidate block, `commands/status.md` prints it,
 * and `capability-candidate-surface.test.ts` proves the round trip from a REAL
 * emission through to the rendered text. Candidates therefore reach a human, so
 * `observe` — "profile and propose, change nothing" — is now the honest default
 * rather than a silent accumulator.
 *
 * ── WHAT WOULD REVERT IT ────────────────────────────────────────────────────
 * Removing the surfacing path. If `/guild:status` ever stops printing the
 * candidate block, this constant must go back to `legacy` in the same change —
 * the default and the surface are one decision, not two.
 */
export const CAPABILITY_RESOLVER_MODE_DEFAULT: CapabilityResolverMode =
  CAPABILITY_RESOLVER_MODE_AFTER_F7;

/**
 * Inclusive bounds for `capability.suggestion_budget` (D04/F10: fixed at 4, not
 * "3–4"). The ceiling matches the one S1's profile validator enforces so the two
 * cannot disagree; `0` is legal and means "profile but never propose".
 */
export const CAPABILITY_SUGGESTION_BUDGET_MIN = 0;
export const CAPABILITY_SUGGESTION_BUDGET_MAX = 4;

/**
 * Maximum length of a role slug. A slug names a file under `.guild/agents/`; an
 * unbounded "non-empty string" is a smuggling channel (a sibling lane found a 12KB
 * agent body riding in a field schema-d as a commit id).
 */
export const CAPABILITY_ROLE_SLUG_MAX_LEN = 64;

/**
 * The CANONICAL role-slug form. One referent, one spelling.
 *
 * Shape-checked rather than merely "non-empty string": bounded, no control characters
 * (a slug never contains a newline — that is the sharp universal guard against body
 * smuggling), and no whitespace or path separators, since the slug names a file.
 */
const ROLE_SLUG = /^[a-z0-9][a-z0-9._-]*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function isCanonicalRoleSlug(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= CAPABILITY_ROLE_SLUG_MAX_LEN &&
    !CONTROL_CHARS.test(v) &&
    ROLE_SLUG.test(v)
  );
}

/**
 * Lower-case, because the roster is FILESYSTEM-BACKED: `.guild/agents/QA.md` and
 * `.guild/agents/qa.md` are the same file on macOS and Windows. Accepting both
 * spellings would let one role appear twice in a roster that can only hold it once.
 * Slugs are therefore required lower-case and deduped case-insensitively — REJECTED
 * when non-canonical, never silently lower-cased.
 */
export function roleSlugDedupKey(slug: string): string {
  return slug.toLowerCase();
}

/**
 * SEMANTIC validity of one flattened `capability.*` value, for the reconciler.
 *
 * Returns `undefined` for any non-capability key so the caller falls through to the
 * generic structural check.
 *
 * Why this exists (adversarial-review finding): `reconcile repair` classifies a value
 * as malformed via `defaultIsValidValue`, which is STRUCTURAL — it accepts any finite
 * number and any array. So `suggestion_budget: 9` and
 * `starter_roles: ["qa","qa"]` were considered valid and survived `repair`, even at
 * `reconciled` provenance where the reconciler is allowed to write. That made S5's
 * "budget over-range ⇒ repair → 4" conformance row false.
 *
 * Never-clobber is unaffected: a `user`-provenance value is still immutable, because
 * the reconciler consults provenance before it ever consults validity.
 */
export function isValidCapabilityValue(key: string, value: unknown): boolean | undefined {
  switch (key) {
    case "capability.resolver_mode":
      return CAPABILITY_RESOLVER_MODES.includes(value as CapabilityResolverMode);
    case "capability.auto_create_policy":
      return CAPABILITY_AUTO_CREATE_POLICIES.includes(value as CapabilityAutoCreatePolicy);
    case "capability.suggestion_budget":
      return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= CAPABILITY_SUGGESTION_BUDGET_MIN &&
        value <= CAPABILITY_SUGGESTION_BUDGET_MAX
      );
    case "capability.starter_roles": {
      if (!Array.isArray(value)) return false;
      const seen = new Set<string>();
      for (const entry of value) {
        // ONE slug contract, shared by validate / repair / resolve, so the three can
        // never disagree about what a well-formed roster looks like.
        if (!isCanonicalRoleSlug(entry)) return false;
        const key = roleSlugDedupKey(entry);
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    }
    default:
      return undefined;
  }
}

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
     * DEFAULT IS `observe` (D04), unlocked by F7 landing — see
     * CAPABILITY_RESOLVER_MODE_DEFAULT above for what would revert it. Never
     * silently defaulted: an unset value resolves with provenance `default`, so
     * `config show --sources` shows it was never chosen.
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

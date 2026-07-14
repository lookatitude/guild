/**
 * scripts/lib/core/config-cli.ts
 *
 * CLI + validation core — extracted from read-guild-config.ts (W3 god-file split).
 * The original path scripts/read-guild-config.ts is a thin re-export shim.
 * Original file docblock preserved below.
 *
 * scripts/read-guild-config.ts
 *
 * Reads `.guild/settings.json` (the single v2 config surface) from the current
 * working directory (or --cwd override), merges with CLI flag overrides, and
 * prints the resolved config as JSON to stdout.
 *
 * Resolution order (first wins) — the canonical precedence ladder
 * (architecture/command-surface.md §4.3/§4.4):
 *   1. CLI flags passed to /guild
 *   2. --rigor profile expansion
 *   3. .guild/settings.json keys (Tier-1 + the closed-key `defaults:` block)
 *   4. Built-in defaults
 *
 * `.guild/settings.json` is the single v2 config surface. The v1 `.guild/config.yml`
 * runtime reader has been removed (SC-8 W2B-5). The on-open converter
 * (`scripts/dot-guild/convert/`) is the ONLY migration path: it materializes
 * `settings.json` from `config.yml` on first open. Users who skip the converter
 * get built-in defaults (no silent v1 fallback — locked by OQ5). See MIGRATION.md.
 *
 * Modes:
 *   (default)     resolve + print the merged config JSON. The resolver expands
 *                 `--rigor` into loops/loop_cap/review (command-surface.md §4.3)
 *                 and emits an `_rigor_expanded` annotation — the expansion is
 *                 ALWAYS visible. Explicit user values (flag or settings.json)
 *                 win over rigor-derived values; rigor only FILLS unset keys.
 *   --scaffold    print the canonical settings.json (all keys = defaults + a
 *                 self-documenting `_help` block); used by `/guild config init`
 *   --validate    read settings.json, run the closed-key reject rules, print a
 *                 report; exit non-zero on a violation
 *
 * Usage:
 *   npx tsx scripts/read-guild-config.ts [--cwd <path>] [--rigor=deep] [--review=cross] [--auto-approve=spec,plan]
 *   npx tsx scripts/read-guild-config.ts --scaffold > .guild/settings.json
 *   npx tsx scripts/read-guild-config.ts --validate [--cwd <path>]
 *   npx tsx scripts/read-guild-config.ts --self-build --validate   (enables the adversarial:off reject)
 *
 * Stdout: JSON object (resolve/scaffold) or a validation report (--validate).
 * Stderr: warnings for unknown keys, parse errors.
 * Exit:   0 in resolve/scaffold (config failures must not block the lifecycle);
 *         non-zero only from --validate on a closed-key violation.
 */

import * as fs from "fs";
import * as path from "path";
import { resolveSettings } from "../settings-resolver";
import { HOST_IDS, HOST_REGISTRY_ROWS, type HostId } from "../host-registry-schema";
import { normalizeHostId } from "../host-id-namespace";
// host_profiles strict validation — single SoT (also consumed by the resolve path).
import { validateHostProfiles } from "../host-profiles-validate";
// Canonical single-source prototype-pollution guard (re-arch WAVE 1).
import { PROTO_POISON_KEYS } from "../shared/safe-object";
import { DEFAULTS as SHARED_DEFAULTS } from "../shared/config-defaults";
import {
  resolveTierModel,
  type ResolvedTierModel,
  type TierHostValue,
  type TierModelSpec,
} from "../../../src/modules/config/workflows/tier-model";
export { resolveTierModel };
export type { ResolvedTierModel, TierHostValue, TierModelSpec };

// ── Schema (Tier-1 + Tier-2 defaults). Canonical body: command-surface.md §4.4.
interface QualityBudget {
  per_class_minutes: number;
  total_minutes: number;
}
interface DefaultsBlock {
  /** When true, `/guild init` runs the full learn-* pipeline at bootstrap (D3). Default false. */
  auto_learn: boolean;
  adversarial: "on" | "off";
  team: { size: number | null; always_include: string[] };
  review_workflow: "standard" | "cross" | "minimal";
  skill_policy: "standard" | "conservative";
  gates: { auto_approve: string[] };
  wiki: { share_mode: "team" | "private"; autopromote: boolean };
  quality: { budget: QualityBudget };
  reporting: "standard" | "quiet" | "verbose";
  /** SQLite lazy-cache trigger thresholds (v2-persistence-and-sqlite-index ADR D-PS-1). */
  index: IndexBlock;
  /** Cross-host SSH endpoint config (v2-cross-host-orchestration.md CR-1/CH-1). Default { enabled: false, hosts: {}, fallback_to_claude: true }. */
  cross_host: CrossHostBlock;
  /**
   * R-016: Per-lane retry policy (v2-runtime-and-execution-model.md §"retry").
   * max_attempts: int ≥ 1 (default 1 — no retry by default).
   * backoff: "immediate" | "linear" | "exponential" (default "exponential").
   */
  retry: { max_attempts: number; backoff: "immediate" | "linear" | "exponential" };
  /**
   * R-016: Lane resume behavior (v2-runtime-and-execution-model.md §"resume").
   * enabled: bool (default true — failed lanes can be resumed from checkpoint).
   */
  resume: { enabled: boolean };
  /**
   * R-017: Heartbeat staleness threshold in milliseconds.
   * hooks/lib/heartbeat.ts:153 reads this via a tolerant reader; absent → DEFAULT_HEARTBEAT_TIMEOUT_MS (600000 ms).
   * Adding to the closed-key set lets `config validate` accept it and `config set` write it.
   */
  heartbeat_timeout_ms: number;
  /**
   * R-018: Host capability manifest freshness TTL in seconds (v2-cross-host-orchestration.md CR-5).
   * host-router.ts RouteOptions.manifestTtlS consumes this value. Default 3600 (1 hour).
   */
  capability_manifest_ttl_s: number;
  /**
   * plugin-update-lifecycle G1 AC-6: update-check behavior. mode `notify`
   * (default) prints the SessionStart update signal; `auto` additionally
   * stages the host-appropriate apply; `off` disables the check entirely.
   * cadence_hours is the machine-level ls-remote cache TTL.
   */
  update: { mode: "auto" | "notify" | "off"; cadence_hours: number };
  /**
   * R-020: Explicit allowed-tools list (guild-boundary-config-and-tracking.md Decision F).
   * Replaces, not extends, the shared tool allow-list. Default [] (no restriction).
   */
  allowed_tools: string[];
}
interface WorkspaceBlock {
  /** auto (default) = detect by immediate-child rule; on = force workspace; off = force regular. NO max_depth — depth is fixed at 1. */
  mode: "auto" | "on" | "off";
}

// ── roles + host_profiles (P2-Wave-1 LW1-6, ADR step 14 — additive OPTIONAL keys).
// Defaults (null role pins, empty host_profiles) are INERT ⇒ default-absent behavior is
// byte-for-byte preserved; only the scaffold/reconcile golden is re-baselined (SC-W1-9).
/** Per-run role pins. null = resolve via the role model (capability-matrix); else a registry host_id. */
interface RolesBlock {
  host: string | null;
  advisory: string | null;
  adversarial: string | null;
}
/** A per-host config-render override. CLOSED entry shape (validateHostProfiles rejects others). */
interface HostProfileEntry {
  /** Optional per-tier model override for this host's render. */
  models?: { cheap?: string; mid?: string; powerful?: string };
  /** Optional render toggle. */
  enabled?: boolean;
}
/** Per-host config-render overrides, keyed by registry host_id. {} (default) = none. */
type HostProfilesBlock = Record<string, HostProfileEntry>;

// ── Host-agnostic model tier map (ADR §1, §10 — cost-aware-tiering-and-lean-context).
// tiers: cheap|mid|powerful → canonical v2 host-id map.
// Defaults preserve zero-config behavior (cheaper learn, same routing otherwise).
//
// G-11 (SC-6, v2-gap-closure): each tier→host VALUE is a union —
//   string                                  (plain model name; the historical form)
//   { model, effort?, verbosity? }          (object form — pins a model plus the
//                                            host's effort/verbosity axes, e.g. for
//                                            frontier models that take a reasoning-
//                                            effort knob)
//   null                                    (no model for this tier on this host)
// The union is unpacked in EXACTLY ONE place: resolveTierModel() below. Every
// consumer of tier model strings (score-tier.ts, lib/settings-resolver.ts,
// write-host-capability.ts, lib/host-router.ts) goes through it — never index
// the map and assume a string.
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
interface ModelsBlock {
  /** Master toggle for cost-tiering. Default true. */
  enabled: boolean;
  /** Host-agnostic tier→model map (ADR §1). null host slot = no model for that tier on that host. */
  tiers: TiersBlock;
  /** Auto-score signal weights (ADR §2, tunable; ship fixed). Keys: workType, blastRadius, dependsOn, security, priorEscalation. */
  scoreWeights: Record<string, number>;
  /** Score-band cutoffs (ADR §2). Default {mid:1, powerful:3}. */
  thresholds: { mid: number; powerful: number };
  /** Advisor consults per lane cap (ADR §3). Default 2. */
  advisorRounds: number;
  /** Uncertainty phrases that trigger advisor escalation (ADR §3). */
  escalationMarkers: string[];
  /** Enforce recall-before-read discipline (ADR §4). Default true. */
  recallBeforeRead: boolean;
  /** Min BM25 recall score to skip a full file read (ADR §4). Default 0.4. */
  recallScoreThreshold: number;
  /** Reject non-guild.handoff.v2 returns from agents (ADR §5). Default true. */
  structuredOutputRequired: boolean;
  /** Prompt cache TTL hints (ADR §9). */
  cacheTTL: CacheTTLBlock;
  /** Min wiki importance level (1–5) for routine recall (ADR §6). Default 3. */
  importanceGate: number;
  /**
   * Composite recall scoring (docs/v2/05 §Recall scoring). true (default) = wiki
   * recall ranks by relevance × recency × importance and filters pages below
   * `importanceGate`. false = legacy BM25-only ranking.
   */
  compositeRecall: boolean;
  /**
   * Write-time importance-at-ingest scorer (docs/v2/05 §Importance-at-ingest).
   * true (default) = the ingest/learn path stamps each wiki page with a 1–5
   * `recall_importance:` score so recall reads a stable stored weight. false =
   * recall derives the 1–5 weight from the page category at query time.
   */
  importanceAtIngest: boolean;
  /** BM25 top-1 similarity threshold for the ingest anomaly gate (D-INGEST-GATE). Default 0.80. */
  ingestSimilarityGate: number;
  /**
   * O-3 short-output advisor trigger buckets (D-OBS-3).
   * Keyed by task_type → tier → output-token floor.
   * Empty map (default) ⇒ O-3 trigger is silent for all buckets.
   * Values are proposed by `benchmark/src/calibrate-o3-cli.ts`; operator reviews + lands.
   */
  shortOutputThreshold: Record<string, Record<string, number>>;
  /** Knowledge-graph analysis tuning params (SC-14/SC-15 / cost-aware-tiering ADR §10). */
  knowledge: KnowledgeConfigBlock;
}
/** Mutable numeric mirror of KNOWLEDGE_CONFIG_DEFAULTS — enables per-project overrides. */
interface KnowledgeConfigBlock {
  maxDepth: number;
  maxBranching: number;
  minTopicImportance: number;
  relMinConf: number;
  maxFiles: number;
  maxTokens: number;
  batchSize: number;
}

// ── Security block (v2-security-and-untrusted-content ADR — D-BYPASS).
interface SecurityBlock {
  /** bypassPermissions governance during Guild-managed runs (D-BYPASS). Default "audit". */
  bypass_permissions_policy: "deny" | "audit" | "allow";
}

// ── Secrets-policy block (v2-security-and-untrusted-content ADR — D-SECRETS).
interface SecretsPolicyBlock {
  /** Env vars explicitly allowed in agent-context injection. Default []. */
  env_allowlist: string[];
  /** Redaction regex patterns applied over all .guild/ artifact writes. Default []. */
  redaction_patterns: string[];
  /** Fail mode for durable shared-git writes on scrub failure: closed (block) | open (warn). Default "closed". */
  fail_mode_durable: "closed" | "open";
  /** Fail mode for local gitignored telemetry writes on scrub failure: open (warn+event) | closed (block). Default "open". */
  fail_mode_telemetry: "open" | "closed";
}

// ── MCP block (v2-security-and-untrusted-content ADR — D-MCP, PI-6 description pinning).
interface McpBlock {
  /** Pinned SHA-256 hashes of MCP tool descriptions (tool-name → hash). Default {}. */
  tool_description_hashes: Record<string, string>;
  /**
   * R-019: MCP transport availability flags (feature-degradation-contracts ADR FDC-13).
   * Optional (defaults provided by DEFAULTS.mcp) so partial mcp overrides remain type-safe.
   * Consumed by hooks/lib/security/config.ts (McpAvailability).
   */
  /** stdio transport available (Claude Code Desktop, Claude Code CLI). Default true. */
  stdio_available?: boolean;
  /** HTTP transport available (Claude Code Web, some enterprise setups). Default false. */
  http_available?: boolean;
  /** Bridge package name for restricted-transport envs (pi-adapter, antigravity). Default null. */
  bridge_package?: string | null;
}

// ── defaults.index sub-block (v2-persistence-and-sqlite-index ADR — D-PS-1).
// Configures the measured-slowness thresholds for the lazy index.sqlite cache.
interface IndexBlock {
  /** Master switch: false = always direct-parse, no index.sqlite written. Default true. */
  enabled: boolean;
  /** Populate kg_nodes/kg_edges when knowledge-graph.json has > N nodes. Default 2000. */
  kg_node_threshold: number;
  /** Populate kg_nodes/kg_edges when knowledge-graph.json is > N MB. Default 1. */
  kg_size_threshold_mb: number;
  /** Populate kl_edges when knowledge-links.json has > N edges. Default 2000. */
  links_edge_threshold: number;
  /** Populate run_provenance when runs/[id]/provenance.json count > N. Default 20. */
  runs_threshold: number;
  /** Populate wiki_fts when wiki file count > N. Default 500. */
  wiki_file_threshold: number;
}

// ── defaults.cross_host sub-block (v2-cross-host-orchestration ADR — CH-1/CR-1).
// SECURITY: address/port/user only — NO secrets, NO passwords. Auth via ssh keys/agent.
// Passwords must never appear here; the ssh binary reads ~/.ssh/config or the agent socket.
interface CrossHostEndpointEntry {
  /** SSH target address (hostname or IP). SECURITY: no credentials stored here. */
  address: string;
  /** SSH port (optional, default 22). Non-standard ports prefer ~/.ssh/config Host entries. */
  port?: number;
  /** SSH username (optional). Produces `user@address` endpoint. No passwords stored here. */
  user?: string;
  /**
   * Remote login shell (optional, e.g. "zsh" | "bash"). When set, the cross-host
   * spawn command is wrapped `<login_shell> -lic '<cmd>'` so a CLI off the
   * default non-interactive ssh PATH (e.g. codex under linuxbrew) is found.
   * Absent ⇒ no wrap (claude-on-PATH needs none). NOT a secret.
   */
  login_shell?: string;
}
interface CrossHostBlock {
  /** Master toggle. false (default) ⇒ single-host behavior byte-identical to today. */
  enabled: boolean;
  /**
   * Per-host SSH endpoint config keyed by guild.host_capability.v1 host_id.
   * SECURITY: address/port/user only — NO secrets, NO passwords. Auth via ssh keys/agent.
   */
  hosts: Record<string, CrossHostEndpointEntry>;
  /**
   * R-015: CR-3 level-4 Claude-only fallback. When true (default), the router falls back to
   * the Claude host if no non-Claude host can satisfy a lane request. host-router.ts
   * RouteOptions.fallbackToClaude consumes this value.
   * v2-cross-host-orchestration.md CR-3 / §CR-3 §"level-4 fallback".
   */
  fallback_to_claude: boolean;
}

interface GuildSettings {
  rigor: "quick" | "standard" | "deep";
  auto_approve: string[]; // [] | [spec,plan,build] | [all]
  review: "local" | "cross" | "off";
  host: HostId | "auto";
  /** Per-run role pins {host,advisory,adversarial} (LW1-6 / SC-W1-7). Default all null = auto-resolve. */
  roles: RolesBlock;
  /** Per-host config-render overrides keyed by host_id (LW1-6 / SC-W1-8). Default {} = none. */
  host_profiles: HostProfilesBlock;
  initiative_default: string | null;
  index: "auto" | "off";
  /**
   * OQ6 (SC-B) — /guild:status records a lightweight run (run.yaml +
   * provenance.json, runs/-only) when true. false reverts status to its
   * historical pure-read behavior. Default true. B3 wires the gate; this
   * reader surfaces the key.
   */
  record_status_runs: boolean;
  /**
   * FU-E codex-skip enforcement — governs whether the codex-skip streak
   * sentinel (.guild/codex-skip-streak.json) causes G-gates to merely
   * surface a warning (warn) or hard-refuse dispatch (block). Default "warn".
   * Referenced by guild:codex-review and guild:review-broker skills.
   */
  codex_skip_enforcement: "warn" | "block";
  /** Execution backend selection (D5 dispatch ladder). Default "auto". */
  agent_mode: "team" | "agent" | "subagent" | "auto";
  /** Workspace federation mode (guild.workspace.v1). Depth is hard-fixed at 1 — no max_depth. */
  workspace: WorkspaceBlock;
  /** Host-agnostic model tier map + cost-tiering config (ADR cost-aware-tiering-and-lean-context §1/§10). */
  models: ModelsBlock;
  /** bypassPermissions governance (v2-security-and-untrusted-content ADR D-BYPASS). */
  security: SecurityBlock;
  /** Secrets redaction policy (v2-security-and-untrusted-content ADR D-SECRETS). */
  secrets_policy: SecretsPolicyBlock;
  /** MCP description pinning + capability declarations + transport flags (v2-security ADR D-MCP + R-019). */
  mcp: McpBlock;
  /**
   * R-009: Enable the Guild status-line runner / GUILD_STATUSLINE integration.
   * When true, the skill orchestrator sets GUILD_STATUSLINE=1 in the session env before
   * invoking the launcher, and statusline-guild.sh reads the flag to enable the pane.
   * CLI flag: --statusline. Default false.
   */
  statusline: boolean;
  /**
   * R-008: Pin the cross-review provider (v2-cross-host-orchestration ADR). Default "auto".
   * "auto" → provider-detect.ts selects the best available cross-review provider.
   * Any provider-id (e.g. "codex-plugin", "codex-cli") → pin that provider; ignored when
   * review is not "cross". Set via: config set adversarial_review_provider codex-plugin
   */
  adversarial_review_provider: string;
  // power-user overrides
  loops: string | null;
  loop_cap: number;
  codex_cap: number;
  defaults: DefaultsBlock;
}

// P1-L9: exported (additive — no behavior change) so config-schema.ts derives its
// typed field registry from this single canonical source and the reconciler
// materializes from it, guaranteeing `reconcile sync` is byte-identical to scaffold().
export const DEFAULTS = SHARED_DEFAULTS as unknown as GuildSettings;

// Self-documenting help block written into the scaffolded settings.json.
// P1-L9: exported (additive) so the reconciler reproduces scaffold() byte-identically.
export const HELP: Record<string, string> = {
  rigor: "quick | standard | deep — profile knob; expands loops/caps/review depth",
  auto_approve:
    "[] | [spec,plan,build,qa] | [all] — opt-in autonomy; destructive/network/spend STILL ask. " +
    "qa (G-14/SC-9): auto-proceed ONLY on a computed ReleaseGate PASS — a BLOCK-override and the " +
    "always-ask hard set still prompt. No ops token (rails stay interactive by design).",
  review: "local | cross | off — cross engages the Claude<->Codex adversarial review broker",
  host: "canonical host id | legacy alias | auto — co-equal host adapter selection",
  roles:
    "per-run role pins {host,advisory,adversarial}; null = resolve via the role model " +
    "(capability-matrix), or pin a canonical registry host_id. Legacy aliases normalize to canonical ids. " +
    "Top-level `host` stays the dispatch-host selector; the v2 registry ids also key roles.*/host_profiles.*.",
  host_profiles:
    "per-host config-render overrides keyed by host_id; {} = none (defaults render from the " +
    "host-registry capability rows). CLOSED entry shape: { models?: {cheap?,mid?,powerful?}, enabled?: bool }.",
  initiative_default: "null | <initiative-id> — attach runs to a durable initiative",
  index: "auto | off — optional SQLite read-through cache (auto = lazy-build past measured slowness)",
  record_status_runs:
    "bool (default true) — OQ6 (SC-B): /guild:status records a lightweight run " +
    "(run.yaml + provenance.json, runs/-only; never wiki/decisions/indexes). " +
    "false = revert to historical pure-read (no run written). Default-safe-when-absent.",
  codex_skip_enforcement:
    "\"warn\" | \"block\" (default \"warn\") — FU-E codex-skip enforcement: " +
    "warn surfaces the block sentinel (.guild/codex-skip-streak.json) at G-gates without stopping dispatch; " +
    "block hard-refuses dispatch at the gate until the streak is cleared. " +
    "Referenced by guild:codex-review and guild:review-broker.",
  agent_mode:
    "team | agent | subagent | auto (default) — execution backend (D5 dispatch ladder). " +
    "auto: $TMUX→team(in-session); tmux-installed→team(new-session); " +
    "independent-agents-supported→agent; else→subagent.",
  "workspace.mode":
    "auto (default) | on | off — workspace federation mode (guild.workspace.v1). " +
    "auto: detect by immediate-child rule (.git/.guild). on: force workspace. off: force regular. " +
    "Depth is hard-fixed at 1 — no max_depth knob. Overridden by --mode flag on workspace/detect.ts.",
  loops: "null | none|spec|plan|implementation|all|<csv> — power-user; null = derive from rigor",
  loop_cap: "int 1-256 — max rounds per adversarial loop",
  codex_cap: "int 1-10 — max rounds per Codex review gate",
  "defaults.auto_learn":
    "bool (default false) — when true, /guild init runs the full learn-* pipeline at bootstrap (D3). " +
    "Precedence: --learn CLI flag > settings.json > built-in(false).",
  "defaults.adversarial": "on | off — (off REJECTED for Guild self-build)",
  "defaults.team.size": "null = 3-4 rule | <int> (cap-6 unless overridden)",
  "defaults.team.always_include": "[] | subset of the specialist roles",
  "defaults.review_workflow": "standard | cross | minimal — default review depth",
  "defaults.skill_policy": "standard | conservative — default skill-usage",
  "defaults.gates.auto_approve":
    "[] | [spec,plan,build,qa,all] — default approval-gate posture. " +
    "qa auto-proceeds ONLY on a computed ReleaseGate PASS (BLOCK-override still prompts); never ops",
  "defaults.wiki.share_mode": "team | private — wiki share mode (moved here from legacy project.yaml)",
  "defaults.wiki.autopromote": "false ALWAYS (true REJECTED — agents emit candidates only)",
  "defaults.quality.budget.per_class_minutes": "int > 0 — per-check-class wall-clock cap",
  "defaults.quality.budget.total_minutes": "int > 0 — whole-phase wall-clock cap",
  "defaults.reporting": "standard | quiet | verbose — default task/progress reporting",
  // ── models: block (cost-aware-tiering-and-lean-context ADR §10)
  "models.enabled":
    "bool (default true) — master toggle for cost-tiering. false = all lanes run at mid (current v2 behavior).",
  "models.tiers":
    "{cheap|mid|powerful: {<canonical-host-id>: value}} — host-agnostic tier→model map. " +
    "Each host value is string | {model, effort?, reasoning?, thinking?, verbosity?} | null. " +
    "Object form pins a model PLUS host-defined effort/reasoning/thinking/verbosity axes, e.g. " +
    "powerful: {\"claude-code-cli\": {model: \"opus\", effort: \"high\", reasoning: \"xhigh\"}}. " +
    "Closed sub-keys: only model/effort/reasoning/thinking/verbosity are accepted inside the object form. " +
    "null host slot = no model for that tier on that host (fall through to host mapping). " +
    "Defaults: cheap=haiku, mid=sonnet, powerful=opus (plain strings). " +
    "Legacy host aliases normalize to canonical ids; non-Claude host slots default to null until configured. " +
    "Consumers unpack the union ONLY via resolveTierModel() (read-guild-config.ts).",
  "models.scoreWeights":
    "object (signal→int) — auto-score rubric weights (ADR §2). " +
    "Signals: workType, blastRadius, dependsOn, security, priorEscalation. Ship fixed; tunable per-repo.",
  "models.thresholds":
    "{mid:int, powerful:int} — score-band cutoffs (ADR §2). Default {mid:1, powerful:3}. " +
    "score<mid→cheap; mid≤score<powerful→mid; score≥powerful→powerful.",
  "models.advisorRounds":
    "int > 0 (default 2) — max advisor consults per lane before recording inconclusive (ADR §3).",
  "models.escalationMarkers":
    "string[] — uncertainty phrases that trigger advisor escalation (ADR §3). " +
    "Defaults: [\"I'm not sure\", \"unclear\", \"cannot determine\", ...].",
  "models.recallBeforeRead":
    "bool (default true) — enforce recall-before-read: query wiki before opening a file (ADR §4).",
  "models.recallScoreThreshold":
    "float 0–1 (default 0.4) — min BM25 recall score to skip a full file read (ADR §4).",
  "models.structuredOutputRequired":
    "bool (default true) — reject non-guild.handoff.v2 agent returns (ADR §5).",
  "models.cacheTTL.coordinator":
    "\"1h\" | \"5m\" | \"off\" (default \"1h\") — coordinator prompt-cache TTL hint (ADR §9).",
  "models.cacheTTL.leaf":
    "\"1h\" | \"5m\" | \"off\" (default \"5m\") — leaf-agent prompt-cache TTL hint (ADR §9).",
  "models.importanceGate":
    "int 1–5 (default 3) — min wiki importance level for routine recall (ADR §6).",
  "models.compositeRecall":
    "bool (default true) — composite recall scoring (docs/v2/05 §Recall scoring). " +
    "true = wiki recall ranks by relevance × recency × importance and filters pages scoring " +
    "below models.importanceGate. Because this requires raw BM25 scores, it bypasses the SQLite " +
    "FTS read-through cache and uses file-BM25 for bundle recall. false = legacy BM25-only " +
    "ranking with the SQLite cache eligible above defaults.index.wiki_file_threshold.",
  "models.importanceAtIngest":
    "bool (default true) — write-time importance-at-ingest scorer (docs/v2/05 §Importance-at-ingest). " +
    "true = the ingest/learn path stamps each wiki page with a 1–5 recall_importance: score so recall " +
    "reads a stable stored weight. false = recall derives the weight from the page category at query time.",
  "models.ingestSimilarityGate":
    "float 0–1 (default 0.80) — BM25 top-1 similarity threshold for the wiki ingest anomaly gate (D-INGEST-GATE). " +
    "If a candidate page scores ≥ this against existing pages, guild:wiki-ingest pauses: supersede / skip / proceed — never silently overwrites.",
  "models.shortOutputThreshold":
    "object (default {}) — O-3 short-output advisor trigger buckets (D-OBS-3). " +
    "Shape: { [task_type]: { [tier]: number } } where numbers are output-token floors. " +
    "Empty map ⇒ O-3 trigger is silent for all (task_type, tier) buckets. " +
    "Values are proposed by benchmark/src/calibrate-o3-cli.ts after ≥30 samples per bucket; " +
    "operator reviews and lands them here — nothing auto-writes this key.",
  // ── security: block (v2-security-and-untrusted-content ADR — D-BYPASS)
  "security.bypass_permissions_policy":
    "\"deny\" | \"audit\" | \"allow\" (default \"audit\") — bypassPermissions governance during Guild-managed runs (D-BYPASS). " +
    "deny: hard-block + security event (forced under auto_approve / autonomous_after_plan_approval). " +
    "audit: surfaces always-ask channel + security event (default for interactive mode). " +
    "allow: opt-in for interactive mode only. Guild cannot govern bypass outside its own run lifecycle.",
  // ── secrets_policy: block (v2-security-and-untrusted-content ADR — D-SECRETS)
  "secrets_policy.env_allowlist":
    "string[] (default []) — env var names explicitly permitted in agent-context injection. " +
    "All others are redacted before context assembly.",
  "secrets_policy.redaction_patterns":
    "string[] (default []) — regex patterns applied as the first stage of the 3-stage secrets scrubber " +
    "(prefix regexes → Shannon-entropy → file-path context). Run over all .guild/ artifact writes.",
  "secrets_policy.fail_mode_durable":
    "\"closed\" | \"open\" (default \"closed\") — on scrub failure for durable shared-git artifacts " +
    "(handoff, provenance, wiki, review): closed = block the write + surface always-ask; open = warn + proceed.",
  "secrets_policy.fail_mode_telemetry":
    "\"open\" | \"closed\" (default \"open\") — on scrub failure for local gitignored telemetry writes " +
    "(runs/<id>/logs/*.jsonl): open = warn + security event + proceed; closed = block.",
  // ── mcp: block (v2-security-and-untrusted-content ADR — D-MCP)
  "mcp.tool_description_hashes":
    "object (default {}) — map of MCP tool-name → SHA-256 hash of the tool description string " +
    "(description only; see hooks/lib/security/mcp-hash-pin.ts hashDescription), " +
    "pinned at /guild:config init time (D-MCP PI-6). PreToolUse compares the live hash per call. " +
    "Drift triggers a warn+gate-on-approval. Re-pin via /guild:config update-mcp-hashes.",
  // ── defaults.index: block (v2-persistence-and-sqlite-index ADR — D-PS-1)
  "defaults.index.enabled":
    "bool (default true) — master switch for the lazy index.sqlite cache. false = always direct-parse, " +
    "no index.sqlite ever written. Equivalent to the /guild:stats --no-index one-shot, made persistent.",
  "defaults.index.kg_node_threshold":
    "int (default 2000) — populate kg_nodes/kg_edges tables when knowledge-graph.json has more than N nodes.",
  "defaults.index.kg_size_threshold_mb":
    "number (default 1) — populate kg_nodes/kg_edges tables when knowledge-graph.json exceeds N MB.",
  "defaults.index.links_edge_threshold":
    "int (default 2000) — populate kl_edges table when knowledge-links.json has more than N edges.",
  "defaults.index.runs_threshold":
    "int (default 20) — populate run_provenance table when runs/*/provenance.json count exceeds N.",
  "defaults.index.wiki_file_threshold":
    "int (default 500) — populate wiki_fts table when wiki/** file count exceeds N. " +
    "Below threshold, guild-memory BM25 grep path is used unchanged.",
  // ── defaults.cross_host: block (v2-cross-host-orchestration ADR — CR-1/CH-1)
  "defaults.cross_host.enabled":
    "bool (default false) — THE local-vs-remote switch. false (default) ⇒ EVERYTHING " +
    "RUNS LOCALLY (single-host, byte-identical to today; no SSH, ever). true ⇒ a specialist " +
    "may run on a remote host, but ONLY when ALL of: (1) this is true, (2) the specialist is " +
    "routed to a remote host (team.yaml `host:` / capability routing), (3) that host has an " +
    "endpoint in defaults.cross_host.hosts, and (4) the pre-dispatch capability probe confirms " +
    "the host has the brand CLI + tmux (missing ⇒ fail-fast, nothing spawned). Otherwise the " +
    "lane stays local (or falls back to Claude per fallback_to_claude). Env override: " +
    "GUILD_CROSS_HOST_ENABLED=1 (env wins). SECURITY: enables SSH dispatch — ssh keys/agent only, no passwords.",
  "defaults.cross_host.hosts":
    "object { <host_id>: { address: string, port?: number, user?: string } } — " +
    "SSH endpoint config keyed by guild.host_capability.v1 host_id. " +
    "SECURITY: address/port/user ONLY — NO secrets, NO passwords. Auth via ssh keys/agent. " +
    "Non-standard ports: prefer ~/.ssh/config Host entries over the port field.",
  // ── R-009: statusline
  statusline:
    "bool (default false) — enable the Guild status-line pane (R-009). " +
    "When true, the skill orchestrator sets GUILD_STATUSLINE=1 in the session env before " +
    "invoking the launcher; statusline-guild.sh reads the flag to enable the tmux status pane. " +
    "CLI flag: --statusline. Config: config set statusline true --scope project",
  // ── R-019: mcp transport availability
  "mcp.stdio_available":
    "bool (default true) — MCP stdio transport available (R-019, FDC-13). " +
    "true for Claude Code CLI/Desktop; consumed by hooks/lib/security/config.ts McpAvailability.",
  "mcp.http_available":
    "bool (default false) — MCP HTTP transport available (R-019, FDC-13). " +
    "true for Claude Code Web and some enterprise setups.",
  "mcp.bridge_package":
    "string|null (default null) — MCP bridge package name for restricted-transport envs (R-019, FDC-13). " +
    "null = no bridge. Used by pi-adapter and antigravity connectors.",
  // ── R-008: adversarial_review_provider
  adversarial_review_provider:
    "\"auto\" | <provider-id> (default \"auto\") — pin the cross-review provider " +
    "(R-008, v2-cross-host-orchestration ADR). Only honored when review=cross. " +
    "\"auto\" ⇒ provider-detect.ts selects the best available provider. " +
    "Explicit IDs: \"codex-plugin\", \"codex-cli\". Set via: config set adversarial_review_provider codex-plugin",
  // ── R-015: defaults.cross_host.fallback_to_claude
  "defaults.cross_host.fallback_to_claude":
    "bool (default true) — CR-3 level-4 Claude-only fallback (v2-cross-host-orchestration ADR CR-3). " +
    "When true, the host-router falls back to the Claude host if no non-Claude host can satisfy a lane. " +
    "Consumed by host-router.ts RouteOptions.fallbackToClaude.",
  // ── R-016: defaults.retry.* + defaults.resume.*
  "defaults.retry.max_attempts":
    "int ≥ 1 (default 1) — max retry attempts per lane on transient failure " +
    "(v2-runtime-and-execution-model.md §retry). 1 = no retry.",
  "defaults.retry.backoff":
    "\"immediate\" | \"linear\" | \"exponential\" (default \"exponential\") — backoff strategy between retries.",
  "defaults.resume.enabled":
    "bool (default true) — enable lane resume from checkpoint on failure " +
    "(v2-runtime-and-execution-model.md §resume).",
  // ── R-017: defaults.heartbeat_timeout_ms
  "defaults.heartbeat_timeout_ms":
    "int > 0 (default 600000 ms = 10 min) — staleness threshold for the heartbeat sentinel. " +
    "hooks/lib/heartbeat.ts:153 reads this via tolerant reader (fallback = DEFAULT_HEARTBEAT_TIMEOUT_MS). " +
    "Adding to the closed-key set lets config validate accept it and config set write it.",
  // ── R-018: defaults.capability_manifest_ttl_s
  "defaults.capability_manifest_ttl_s":
    "number > 0 (default 3600 s = 1 hour) — host capability manifest freshness TTL " +
    "(v2-cross-host-orchestration ADR CR-5). Consumed by host-router.ts RouteOptions.manifestTtlS.",
  // ── plugin-update-lifecycle AC-6: defaults.update
  "defaults.update":
    '{ mode: "auto"|"notify"|"off" (default "notify"), cadence_hours: number > 0 (default 24) } — ' +
    "channel-aware update-check behavior. Consumed by hooks/update-check.ts (SessionStart signal + " +
    "background cache refresh) and guild-run update. Dev/symlink installs are always excluded.",
  // ── R-020: defaults.allowed_tools
  "defaults.allowed_tools":
    "string[] (default []) — explicit allowed-tools list (guild-boundary-config-and-tracking.md Decision F). " +
    "Replaces, not extends, the shared tool allow-list. [] ⇒ no restriction.",
  _precedence:
    "CLI flag > --rigor profile > settings.json > built-in default. " +
    "For model tier: --model-tier=cheap|mid|powerful > per-lane plan override > models.tiers/thresholds > built-in.",
  _docs: "Canonical schema: architecture/command-surface.md §4.4. Regenerate with: /guild config init",
};

const VALID_LOOPS = new Set(["none", "spec", "plan", "implementation", "all"]);
const VALID_RIGOR = new Set(["quick", "standard", "deep"]);
const VALID_REVIEW = new Set(["local", "cross", "off"]);
const DISPATCH_HOST_IDS = new Set<HostId>(
  HOST_IDS.filter((id): id is HostId => HOST_REGISTRY_ROWS[id].dispatch_selectable === true)
);
// G-14 (SC-9): "qa" is a valid auto-approve token. Semantics: auto-proceed ONLY
// on a computed ReleaseGate PASS — a BLOCK-override and the always-ask hard set
// (destructive/network/spend) still prompt. There is still NO "ops" token (rails
// stay interactive by design).
const VALID_PHASES = new Set(["spec", "plan", "build", "qa", "all"]);
const VALID_AGENT_MODE = new Set(["team", "agent", "subagent", "auto"]);
const VALID_MODEL_TIER = new Set(["cheap", "mid", "powerful"]);
const VALID_CACHE_TTL = new Set(["1h", "5m", "off"]);

// Closed-key set for models.* top-level fields (ADR §10 + D-INGEST-GATE + D-OBS-3).
const VALID_MODELS_KEYS = new Set([
  "enabled", "tiers", "scoreWeights", "thresholds", "advisorRounds",
  "escalationMarkers", "recallBeforeRead", "recallScoreThreshold",
  "structuredOutputRequired", "cacheTTL", "importanceGate", "compositeRecall", "importanceAtIngest", "ingestSimilarityGate",
  "shortOutputThreshold", "knowledge",
]);

// Closed host-key set for models.tiers.<tier>.* (G-11 + G-lane rework): the
// documented host map is the canonical v2 host-id set. Shared by validateModels
// (reject) and the resolve-mode merge strip (unknown host keys never leak
// into the resolved config — same regime as DEFAULTS_ALLOWED_KEYS).
const VALID_TIER_HOST_KEYS = new Set<string>(HOST_IDS);

// Known registry host ids (single SoT — host-registry-schema.ts HOST_IDS). Used by
// validateRoles + validateHostProfiles so a typo'd host id surfaces (closed set).
const KNOWN_HOST_IDS = new Set<string>(HOST_IDS);

function normalizeDispatchHostId(value: string): HostId | null {
  const normalized = normalizeHostId(value);
  return normalized && DISPATCH_HOST_IDS.has(normalized) ? normalized : null;
}

// Closed sub-key sets for the LW1-6 schema extension (ADR step 14).
const VALID_ROLES_KEYS = new Set(["host", "advisory", "adversarial"]);
// host_profiles entry-shape validation lives in lib/host-profiles-validate.ts (single SoT,
// reused by the resolve path — Codex G-lane item3). Re-exported below for config-cmd.

// Closed-key set for security.* block (D-BYPASS).
const VALID_SECURITY_KEYS = new Set(["bypass_permissions_policy"]);

// Closed-key set for secrets_policy.* block (D-SECRETS).
const VALID_SECRETS_POLICY_KEYS = new Set([
  "env_allowlist", "redaction_patterns", "fail_mode_durable", "fail_mode_telemetry",
]);

// Closed-key set for mcp.* block (D-MCP + R-019).
const VALID_MCP_KEYS = new Set([
  "tool_description_hashes",
  "stdio_available",  // R-019: bool — stdio transport available
  "http_available",   // R-019: bool — HTTP transport available
  "bridge_package",   // R-019: string|null — bridge package name
]);

// Closed-key set for defaults.index.* sub-block (D-PS-1).
const VALID_INDEX_KEYS = new Set([
  "enabled", "kg_node_threshold", "kg_size_threshold_mb",
  "links_edge_threshold", "runs_threshold", "wiki_file_threshold",
]);

interface ParsedArgs {
  cwd?: string;
  mode: "resolve" | "scaffold" | "validate";
  selfBuild: boolean;
  /** --model-tier CLI escape hatch (ADR §2, O-2). Top of the tier precedence ladder. */
  modelTier?: "cheap" | "mid" | "powerful";
  flags: Partial<GuildSettings>;
}

function parseAutoApprove(v: string): string[] {
  if (v === "" || v === "all") return v === "all" ? ["all"] : ["all"]; // bare = all
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => VALID_PHASES.has(s));
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Partial<GuildSettings> = {};
  let cwd: string | undefined;
  let mode: ParsedArgs["mode"] = "resolve";
  let selfBuild = false;
  let modelTier: ParsedArgs["modelTier"];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) cwd = argv[++i];
    else if (arg === "--scaffold") mode = "scaffold";
    else if (arg === "--validate") mode = "validate";
    else if (arg === "--self-build") selfBuild = true;
    else if (arg.startsWith("--rigor=")) {
      const v = arg.slice("--rigor=".length);
      if (VALID_RIGOR.has(v)) flags.rigor = v as GuildSettings["rigor"];
    } else if (arg.startsWith("--review=")) {
      const v = arg.slice("--review=".length);
      if (VALID_REVIEW.has(v)) flags.review = v as GuildSettings["review"];
    } else if (arg.startsWith("--host=")) {
      const v = arg.slice("--host=".length);
      if (v === "auto") flags.host = "auto";
      else {
        const normalized = normalizeDispatchHostId(v);
        if (normalized) flags.host = normalized;
      }
    } else if (arg === "--auto-approve") {
      flags.auto_approve = ["all"]; // bare flag = all
    } else if (arg.startsWith("--auto-approve=")) {
      flags.auto_approve = parseAutoApprove(arg.slice("--auto-approve=".length));
    } else if (arg.startsWith("--agent-mode=")) {
      const v = arg.slice("--agent-mode=".length);
      if (VALID_AGENT_MODE.has(v)) flags.agent_mode = v as GuildSettings["agent_mode"];
    } else if (arg.startsWith("--model-tier=")) {
      const v = arg.slice("--model-tier=".length);
      if (VALID_MODEL_TIER.has(v)) modelTier = v as ParsedArgs["modelTier"];
      // invalid values silently ignored (consistent with --agent-mode handling)
    } else if (arg.startsWith("--loops=")) {
      flags.loops = arg.slice("--loops=".length);
    } else if (arg.startsWith("--loop-cap=")) {
      const n = parseInt(arg.slice("--loop-cap=".length), 10);
      if (!isNaN(n)) flags.loop_cap = Math.min(256, Math.max(1, n));
    } else if (arg.startsWith("--codex-cap=")) {
      const n = parseInt(arg.slice("--codex-cap=".length), 10);
      if (!isNaN(n)) flags.codex_cap = Math.min(10, Math.max(1, n));
    } else if (arg === "--statusline") {
      // R-009: enable status-line pane; orchestrator reads this and sets GUILD_STATUSLINE=1
      flags.statusline = true;
    }
  }
  return { cwd, mode, selfBuild, modelTier, flags };
}

interface FileLoad {
  config: Partial<GuildSettings>;
  rejects: string[];
  source: "settings.json" | "none";
}

// ── settings.local.json merge (Decision F — guild-boundary-config-and-tracking.md)
// Precedence: CLI flag > --rigor profile > settings.local.json > settings.json > built-in.
// Deep-merge for objects; list values replace wholesale; unknown local keys throw.

/**
 * Collect all dotted key paths present in a (potentially nested) object.
 * Used to build the allow-list from settings.json for the local-key validator.
 */
function collectKeyPaths(obj: Record<string, unknown>, prefix = ""): Set<string> {
  const paths = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
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
 * Validate that every top-level key in localObj exists in baseObj.
 * Only validates the first level (top-level keys of settings.local.json);
 * nested keys are acceptable as long as the top-level parent exists in base.
 * Throws a clear error (Decision F.3) on unknown key.
 */
function validateLocalKeys(
  localObj: Record<string, unknown>,
  baseObj: Record<string, unknown>
): void {
  const basePaths = collectKeyPaths(baseObj);
  for (const key of Object.keys(localObj)) {
    if (key.startsWith("_")) continue; // _help / _docs annotations exempt
    if (!basePaths.has(key)) {
      throw new Error(
        `share-dot-guild: settings.local.json key '${key}' not in settings.json schema — ` +
          `refusing to silently extend. Declare it in settings.json first (with the team default) ` +
          `or remove it from settings.local.json.`
      );
    }
  }
}

/**
 * Deep-merge `local` over `base`:
 *  - object-typed values → deep merge key-by-key
 *  - array-typed values  → wholesale replace (Decision F.2)
 *  - scalar values       → replace
 */
// SECURITY: prototype-pollution guard — PROTO_POISON_KEYS is the canonical
// single-source set (scripts/lib/shared/safe-object.ts, imported above); these
// keys are never merged in from an untrusted settings.local.json.

function deepMergeLocal(
  base: Record<string, unknown>,
  local: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.assign(Object.create(null), base);
  for (const [k, v] of Object.entries(local)) {
    if (PROTO_POISON_KEYS.has(k)) continue; // never assign __proto__/prototype/constructor
    if (Array.isArray(v)) {
      // List-typed: replace wholesale (Decision F.2)
      result[k] = v;
    } else if (isPlainObject(v) && isPlainObject(result[k])) {
      // Object-typed: deep merge
      result[k] = deepMergeLocal(
        result[k] as Record<string, unknown>,
        v as Record<string, unknown>
      );
    } else {
      // Scalar: replace
      result[k] = v;
    }
  }
  return result;
}

/**
 * loadLocalOverride — reads .guild/settings.local.json (if present) and merges
 * it over fileConfig. Returns a new Partial<GuildSettings> or throws on unknown key.
 * Called AFTER loadFileConfig; only runs when source is "settings.json".
 */
function loadLocalOverride(
  cwd: string,
  fileConfig: Partial<GuildSettings>,
  selfBuild: boolean
): Partial<GuildSettings> {
  const localPath = path.join(cwd, ".guild", "settings.local.json");
  if (!fs.existsSync(localPath)) return fileConfig; // no-op when absent

  let localParsed: Record<string, unknown>;
  try {
    localParsed = JSON.parse(fs.readFileSync(localPath, "utf8"));
  } catch (e) {
    process.stderr.write(
      `[read-guild-config] WARN: could not parse .guild/settings.local.json ` +
        `(${(e as Error).message}) — local overrides ignored.\n`
    );
    return fileConfig;
  }

  // Build a reference object for the allow-list: the DEFAULTS shape is the canonical schema.
  // We use DEFAULTS directly as the base schema (all legal top-level keys present there).
  const schemaBase = DEFAULTS as unknown as Record<string, unknown>;
  validateLocalKeys(localParsed, schemaBase);

  // Deep-merge local over fileConfig (fileConfig may be partial; fill gaps from DEFAULTS first)
  const base: Record<string, unknown> = {
    ...(DEFAULTS as unknown as Record<string, unknown>),
    ...(fileConfig as unknown as Record<string, unknown>),
  };
  const merged = deepMergeLocal(base, localParsed);

  process.stderr.write(
    `[read-guild-config] INFO: .guild/settings.local.json loaded — ` +
      `${Object.keys(localParsed).length} override key(s): ` +
      `[${Object.keys(localParsed).join(", ")}]\n`
  );

  return merged as Partial<GuildSettings>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Closed-key validation of the `models:` block. Returns reject messages. (ADR §10) */
export function validateModels(m: Record<string, unknown>): string[] {
  const rejects: string[] = [];
  for (const k of Object.keys(m)) {
    if (!VALID_MODELS_KEYS.has(k)) {
      rejects.push(`unknown models key "${k}" (closed key set — check spelling against ADR §10)`);
    }
  }
  // tiers value union: each tier→host value must be string | null |
  // {model: string, effort?: string, reasoning?: string, thinking?: string, verbosity?: string}.
  // The object form is a CLOSED key set — unknown sub-keys are rejected.
  // G-lane rework: the host map itself is ALSO a closed key set
  // canonical v2 host ids — a typo like "claudee" must surface, not merge.
  if (isPlainObject(m["tiers"])) {
    const rt = m["tiers"] as Record<string, unknown>;
    const VALID_TIER_KEYS = new Set(["cheap", "mid", "powerful"]);
    const VALID_TIER_SPEC_KEYS = new Set(["model", "effort", "reasoning", "thinking", "verbosity"]);
    for (const tk of Object.keys(rt)) {
      if (!VALID_TIER_KEYS.has(tk)) {
        rejects.push(`unknown models.tiers key "${tk}" (valid: cheap|mid|powerful)`);
        continue;
      }
      if (!isPlainObject(rt[tk])) continue; // non-object tier entries handled by the merge (legacy flat form tolerated by resolveTierModel)
      const hostMap = rt[tk] as Record<string, unknown>;
      const seenCanonicalHosts = new Map<HostId, string>();
      for (const [hk, hv] of Object.entries(hostMap)) {
        const canonicalHostId = normalizeHostId(hk);
        if (!canonicalHostId) {
          rejects.push(
            `unknown models.tiers.${tk} host key "${hk}" (closed key set — valid: ${[...VALID_TIER_HOST_KEYS].join(", ")})`
          );
          continue;
        }
        const previousHostKey = seenCanonicalHosts.get(canonicalHostId);
        if (previousHostKey && previousHostKey !== hk) {
          rejects.push(
            `duplicate models.tiers.${tk} host keys "${previousHostKey}" and "${hk}" both normalize to "${canonicalHostId}"`
          );
          continue;
        }
        seenCanonicalHosts.set(canonicalHostId, hk);
        if (hv === null || typeof hv === "string") continue; // both historical forms valid
        if (isPlainObject(hv)) {
          const spec = hv as Record<string, unknown>;
          for (const sk of Object.keys(spec)) {
            if (!VALID_TIER_SPEC_KEYS.has(sk)) {
              rejects.push(
                `unknown models.tiers.${tk}.${hk} key "${sk}" ` +
                  `(object form is a closed key set — only model, effort, reasoning, thinking, verbosity)`
              );
            }
          }
          if (typeof spec["model"] !== "string" || !(spec["model"] as string).trim()) {
            rejects.push(
              `models.tiers.${tk}.${hk}.model is required and must be a non-empty string in the object form`
            );
          }
          if (spec["effort"] !== undefined && typeof spec["effort"] !== "string") {
            rejects.push(`models.tiers.${tk}.${hk}.effort must be a string (got ${JSON.stringify(spec["effort"])})`);
          }
          if (spec["reasoning"] !== undefined && typeof spec["reasoning"] !== "string") {
            rejects.push(`models.tiers.${tk}.${hk}.reasoning must be a string (got ${JSON.stringify(spec["reasoning"])})`);
          }
          if (spec["thinking"] !== undefined && typeof spec["thinking"] !== "string") {
            rejects.push(`models.tiers.${tk}.${hk}.thinking must be a string (got ${JSON.stringify(spec["thinking"])})`);
          }
          if (spec["verbosity"] !== undefined && typeof spec["verbosity"] !== "string") {
            rejects.push(`models.tiers.${tk}.${hk}.verbosity must be a string (got ${JSON.stringify(spec["verbosity"])})`);
          }
        } else {
          rejects.push(
            `models.tiers.${tk}.${hk} must be a string, null, or {model, effort?, reasoning?, thinking?, verbosity?} ` +
              `(got ${JSON.stringify(hv)})`
          );
        }
      }
    }
  }
  // thresholds sub-keys
  if (isPlainObject(m["thresholds"])) {
    const t = m["thresholds"] as Record<string, unknown>;
    for (const tk of Object.keys(t)) {
      if (tk !== "mid" && tk !== "powerful") {
        rejects.push(`unknown models.thresholds key "${tk}" — only mid and powerful are valid`);
      }
    }
  }
  // cacheTTL sub-keys
  if (isPlainObject(m["cacheTTL"])) {
    const ttl = m["cacheTTL"] as Record<string, unknown>;
    for (const ck of Object.keys(ttl)) {
      if (ck !== "coordinator" && ck !== "leaf") {
        rejects.push(`unknown models.cacheTTL key "${ck}" — only coordinator and leaf are valid`);
      }
    }
    if (ttl["coordinator"] !== undefined && !VALID_CACHE_TTL.has(ttl["coordinator"] as string)) {
      rejects.push(`models.cacheTTL.coordinator "${ttl["coordinator"]}" is invalid — valid: 1h|5m|off`);
    }
    if (ttl["leaf"] !== undefined && !VALID_CACHE_TTL.has(ttl["leaf"] as string)) {
      rejects.push(`models.cacheTTL.leaf "${ttl["leaf"]}" is invalid — valid: 1h|5m|off`);
    }
  }
  // importanceGate range 1–5
  if (m["importanceGate"] !== undefined) {
    const ig = m["importanceGate"];
    if (typeof ig !== "number" || ig < 1 || ig > 5 || !Number.isInteger(ig)) {
      rejects.push(`models.importanceGate must be an integer 1–5 (got ${JSON.stringify(ig)})`);
    }
  }
  // compositeRecall is a boolean
  if (m["compositeRecall"] !== undefined && typeof m["compositeRecall"] !== "boolean") {
    rejects.push(`models.compositeRecall must be a boolean (got ${JSON.stringify(m["compositeRecall"])})`);
  }
  // importanceAtIngest is a boolean
  if (m["importanceAtIngest"] !== undefined && typeof m["importanceAtIngest"] !== "boolean") {
    rejects.push(`models.importanceAtIngest must be a boolean (got ${JSON.stringify(m["importanceAtIngest"])})`);
  }
  // advisorRounds > 0
  if (m["advisorRounds"] !== undefined) {
    const ar = m["advisorRounds"];
    if (typeof ar !== "number" || ar < 1 || !Number.isInteger(ar)) {
      rejects.push(`models.advisorRounds must be an integer > 0 (got ${JSON.stringify(ar)})`);
    }
  }
  // recallScoreThreshold 0–1
  if (m["recallScoreThreshold"] !== undefined) {
    const rs = m["recallScoreThreshold"];
    if (typeof rs !== "number" || rs < 0 || rs > 1) {
      rejects.push(`models.recallScoreThreshold must be a float 0–1 (got ${JSON.stringify(rs)})`);
    }
  }
  // ingestSimilarityGate 0–1 (D-INGEST-GATE, default 0.80)
  if (m["ingestSimilarityGate"] !== undefined) {
    const ig = m["ingestSimilarityGate"];
    if (typeof ig !== "number" || ig < 0 || ig > 1) {
      rejects.push(`models.ingestSimilarityGate must be a float 0–1 (got ${JSON.stringify(ig)})`);
    }
  }
  return rejects;
}

/** Closed-key validation of the `security:` block (D-BYPASS). Returns reject messages. */
export function validateSecurity(s: Record<string, unknown>): string[] {
  const rejects: string[] = [];
  for (const k of Object.keys(s)) {
    if (!VALID_SECURITY_KEYS.has(k)) {
      rejects.push(`unknown security key "${k}" (closed key set — only bypass_permissions_policy is valid)`);
    }
  }
  if (s["bypass_permissions_policy"] !== undefined) {
    const v = s["bypass_permissions_policy"];
    if (v !== "deny" && v !== "audit" && v !== "allow") {
      rejects.push(`security.bypass_permissions_policy "${v}" is invalid — valid: deny|audit|allow`);
    }
  }
  return rejects;
}

/** Closed-key validation of the `secrets_policy:` block (D-SECRETS). Returns reject messages. */
export function validateSecretsPolicy(sp: Record<string, unknown>): string[] {
  const rejects: string[] = [];
  for (const k of Object.keys(sp)) {
    if (!VALID_SECRETS_POLICY_KEYS.has(k)) {
      rejects.push(`unknown secrets_policy key "${k}" (closed key set — check v2-security-and-untrusted-content ADR)`);
    }
  }
  if (sp["fail_mode_durable"] !== undefined && sp["fail_mode_durable"] !== "closed" && sp["fail_mode_durable"] !== "open") {
    rejects.push(`secrets_policy.fail_mode_durable "${sp["fail_mode_durable"]}" is invalid — valid: closed|open`);
  }
  if (sp["fail_mode_telemetry"] !== undefined && sp["fail_mode_telemetry"] !== "open" && sp["fail_mode_telemetry"] !== "closed") {
    rejects.push(`secrets_policy.fail_mode_telemetry "${sp["fail_mode_telemetry"]}" is invalid — valid: open|closed`);
  }
  if (sp["env_allowlist"] !== undefined && !Array.isArray(sp["env_allowlist"])) {
    rejects.push(`secrets_policy.env_allowlist must be an array of strings`);
  }
  if (sp["redaction_patterns"] !== undefined && !Array.isArray(sp["redaction_patterns"])) {
    rejects.push(`secrets_policy.redaction_patterns must be an array of regex strings`);
  }
  return rejects;
}

/** Closed-key validation of the `mcp:` block (D-MCP + R-019). Returns reject messages. */
export function validateMcp(m: Record<string, unknown>): string[] {
  const rejects: string[] = [];
  for (const k of Object.keys(m)) {
    if (!VALID_MCP_KEYS.has(k)) {
      rejects.push(`unknown mcp key "${k}" (closed key set — valid: tool_description_hashes, stdio_available, http_available, bridge_package)`);
    }
  }
  if (m["tool_description_hashes"] !== undefined && !isPlainObject(m["tool_description_hashes"])) {
    rejects.push(`mcp.tool_description_hashes must be an object (tool-name → SHA-256 hash)`);
  }
  // R-019: transport availability flags
  if (m["stdio_available"] !== undefined && typeof m["stdio_available"] !== "boolean") {
    rejects.push(`mcp.stdio_available must be a boolean (got ${JSON.stringify(m["stdio_available"])})`);
  }
  if (m["http_available"] !== undefined && typeof m["http_available"] !== "boolean") {
    rejects.push(`mcp.http_available must be a boolean (got ${JSON.stringify(m["http_available"])})`);
  }
  if (m["bridge_package"] !== undefined && m["bridge_package"] !== null && typeof m["bridge_package"] !== "string") {
    rejects.push(`mcp.bridge_package must be a string or null (got ${JSON.stringify(m["bridge_package"])})`);
  }
  return rejects;
}

/**
 * Closed-key validation of the `roles` block (LW1-6 / SC-W1-7). Sub-keys are CLOSED to
 * {host, advisory, adversarial}; each value must be `null` or a KNOWN registry host_id
 * (a typo like "claudee" must surface, not silently pass). Returns reject messages.
 */
export function validateRoles(r: Record<string, unknown>): string[] {
  const rejects: string[] = [];
  for (const k of Object.keys(r)) {
    if (!VALID_ROLES_KEYS.has(k)) {
      rejects.push(`unknown roles key "${k}" (closed key set — only host, advisory, adversarial)`);
      continue;
    }
    const v = r[k];
    if (v !== null && !(typeof v === "string" && normalizeHostId(v) !== null)) {
      rejects.push(
        `roles.${k} must be null or a known registry host_id (${[...KNOWN_HOST_IDS].join("|")}); got ${JSON.stringify(v)}`
      );
    }
  }
  return rejects;
}

/**
 * Closed-key validation of the `host_profiles` block (LW1-6 / SC-W1-8). The implementation
 * is the single SoT in `lib/host-profiles-validate.ts`, reused by the resolve path
 * (`settings-resolver.ts`) so the --validate and resolve mirrors can never drift (Codex
 * G-lane item3). Re-exported here so existing `./read-guild-config` importers (config-cmd)
 * keep working.
 */
export { validateHostProfiles };

/**
 * Closed-key validation of the `defaults.cross_host` block (cross-host ADR CR-1/CH-1).
 * Returns reject messages. SECURITY: validates that only address/port/user are present.
 */
export function validateCrossHostBlock(ch: Record<string, unknown>): string[] {
  const rejects: string[] = [];
  // R-015: added fallback_to_claude to the closed key set (CR-3 level-4 Claude-only fallback).
  const ALLOWED_CH = new Set(["enabled", "hosts", "fallback_to_claude"]);
  for (const k of Object.keys(ch)) {
    if (!ALLOWED_CH.has(k)) {
      rejects.push(`unknown defaults.cross_host key "${k}" (closed key set — valid: enabled, hosts, fallback_to_claude)`);
    }
  }
  if (ch["enabled"] !== undefined && typeof ch["enabled"] !== "boolean") {
    rejects.push(`defaults.cross_host.enabled must be a boolean (got ${JSON.stringify(ch["enabled"])})`);
  }
  // R-015: fallback_to_claude validation
  if (ch["fallback_to_claude"] !== undefined && typeof ch["fallback_to_claude"] !== "boolean") {
    rejects.push(`defaults.cross_host.fallback_to_claude must be a boolean (got ${JSON.stringify(ch["fallback_to_claude"])})`);
  }
  if (ch["hosts"] !== undefined) {
    if (!isPlainObject(ch["hosts"])) {
      rejects.push(`defaults.cross_host.hosts must be an object { host_id: { address, port?, user? } }`);
    } else {
      const hosts = ch["hosts"] as Record<string, unknown>;
      const ALLOWED_ENTRY = new Set(["address", "port", "user", "login_shell"]);
      for (const [hostId, entry] of Object.entries(hosts)) {
        if (!isPlainObject(entry)) {
          rejects.push(`defaults.cross_host.hosts["${hostId}"] must be an object { address, port?, user? }`);
          continue;
        }
        const e = entry as Record<string, unknown>;
        for (const ek of Object.keys(e)) {
          if (!ALLOWED_ENTRY.has(ek)) {
            // SECURITY: reject any unexpected key (e.g. "password", "key_path") from the config.
            rejects.push(
              `unknown defaults.cross_host.hosts["${hostId}"] key "${ek}" ` +
                `(closed key set — valid: address, port, user; no secrets stored here)`
            );
          }
        }
        if (!e["address"] || typeof e["address"] !== "string") {
          rejects.push(
            `defaults.cross_host.hosts["${hostId}"].address is required and must be a string`
          );
        }
        if (e["port"] !== undefined) {
          const p = e["port"];
          if (typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > 65535) {
            rejects.push(
              `defaults.cross_host.hosts["${hostId}"].port must be an integer 1–65535 ` +
                `(got ${JSON.stringify(p)})`
            );
          }
        }
        if (e["user"] !== undefined && typeof e["user"] !== "string") {
          rejects.push(
            `defaults.cross_host.hosts["${hostId}"].user must be a string ` +
              `(got ${JSON.stringify(e["user"])})`
          );
        }
        if (e["login_shell"] !== undefined && typeof e["login_shell"] !== "string") {
          rejects.push(
            `defaults.cross_host.hosts["${hostId}"].login_shell must be a string ` +
              `(got ${JSON.stringify(e["login_shell"])})`
          );
        }
      }
    }
  }
  return rejects;
}

// Closed-key set for defaults.* block. Shared by validateDefaults and the
// resolve-mode strip so unknown keys are NEVER carried into resolved config.
const DEFAULTS_ALLOWED_KEYS = new Set([
  "auto_learn",   // D3: bool, default false
  "adversarial", "team", "review_workflow", "skill_policy",
  "gates", "wiki", "quality", "reporting",
  "index",        // D-PS-1: SQLite lazy-cache trigger thresholds
  "cross_host",   // CR-1/CH-1: cross-host SSH endpoint config (R-015 adds fallback_to_claude)
  "retry",        // R-016: { max_attempts: int, backoff: "immediate"|"linear"|"exponential" }
  "resume",       // R-016: { enabled: bool }
  "heartbeat_timeout_ms",    // R-017: int ms (hooks/lib/heartbeat.ts tolerant reader)
  "capability_manifest_ttl_s", // R-018: number s (host-router.ts CR-5 manifest freshness)
  "update",       // plugin-update-lifecycle AC-6: { mode: "auto"|"notify"|"off", cadence_hours: number }
  "allowed_tools",           // R-020: string[] (boundary-config-and-tracking Decision F)
]);

/** Closed-key validation of the `defaults:` block. Returns reject messages. */
export function validateDefaults(d: Record<string, unknown>, selfBuild: boolean): string[] {
  const rejects: string[] = [];
  for (const k of Object.keys(d)) {
    if (!DEFAULTS_ALLOWED_KEYS.has(k)) rejects.push(`unknown defaults key "${k}" (closed key set — a typo must surface)`);
  }
  if (d["adversarial"] === "off" && selfBuild)
    rejects.push(`defaults.adversarial: off is REJECTED for Guild self-build`);
  if (isPlainObject(d["wiki"]) && (d["wiki"] as Record<string, unknown>)["autopromote"] === true)
    rejects.push(`defaults.wiki.autopromote: true is REJECTED always (agents emit candidates only)`);
  if (isPlainObject(d["quality"])) {
    const q = (d["quality"] as Record<string, unknown>)["budget"];
    if (isPlainObject(q)) {
      for (const bk of Object.keys(q)) {
        if (bk !== "per_class_minutes" && bk !== "total_minutes")
          rejects.push(`unknown defaults.quality.budget key "${bk}"`);
      }
    }
  }
  // defaults.cross_host.* — closed key set (CR-1/CH-1), R-015 adds fallback_to_claude
  if (isPlainObject(d["cross_host"])) {
    rejects.push(...validateCrossHostBlock(d["cross_host"] as Record<string, unknown>));
  }
  // R-016: defaults.retry.* — lane retry policy
  if (isPlainObject(d["retry"])) {
    const retry = d["retry"] as Record<string, unknown>;
    const VALID_RETRY_KEYS = new Set(["max_attempts", "backoff"]);
    for (const rk of Object.keys(retry)) {
      if (!VALID_RETRY_KEYS.has(rk)) rejects.push(`unknown defaults.retry key "${rk}" (valid: max_attempts, backoff)`);
    }
    if (retry["max_attempts"] !== undefined) {
      const v = retry["max_attempts"];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
        rejects.push(`defaults.retry.max_attempts must be an integer ≥ 1 (got ${JSON.stringify(v)})`);
    }
    if (retry["backoff"] !== undefined) {
      const v = retry["backoff"];
      if (v !== "immediate" && v !== "linear" && v !== "exponential")
        rejects.push(`defaults.retry.backoff must be "immediate"|"linear"|"exponential" (got ${JSON.stringify(v)})`);
    }
  }
  // R-016: defaults.resume.* — lane resume behavior
  if (isPlainObject(d["resume"])) {
    const res = d["resume"] as Record<string, unknown>;
    const VALID_RESUME_KEYS = new Set(["enabled"]);
    for (const rk of Object.keys(res)) {
      if (!VALID_RESUME_KEYS.has(rk)) rejects.push(`unknown defaults.resume key "${rk}" (valid: enabled)`);
    }
    if (res["enabled"] !== undefined && typeof res["enabled"] !== "boolean")
      rejects.push(`defaults.resume.enabled must be a boolean (got ${JSON.stringify(res["enabled"])})`);
  }
  // R-017: defaults.heartbeat_timeout_ms — positive integer (ms)
  if (d["heartbeat_timeout_ms"] !== undefined) {
    const v = d["heartbeat_timeout_ms"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
      rejects.push(`defaults.heartbeat_timeout_ms must be a positive integer (ms) (got ${JSON.stringify(v)})`);
  }
  // plugin-update-lifecycle AC-6: defaults.update — closed shape
  if (d["update"] !== undefined) {
    const v = d["update"];
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      rejects.push(`defaults.update must be an object { mode, cadence_hours } (got ${JSON.stringify(v)})`);
    } else {
      const u = v as Record<string, unknown>;
      if (u["mode"] !== undefined && u["mode"] !== "auto" && u["mode"] !== "notify" && u["mode"] !== "off")
        rejects.push(`defaults.update.mode must be "auto" | "notify" | "off" (got ${JSON.stringify(u["mode"])})`);
      if (u["cadence_hours"] !== undefined && (typeof u["cadence_hours"] !== "number" || u["cadence_hours"] <= 0))
        rejects.push(`defaults.update.cadence_hours must be a positive number of hours (got ${JSON.stringify(u["cadence_hours"])})`);
      for (const k of Object.keys(u)) {
        if (k !== "mode" && k !== "cadence_hours")
          rejects.push(`defaults.update.${k} is not a recognized key (closed shape: mode, cadence_hours)`);
      }
    }
  }
  // R-018: defaults.capability_manifest_ttl_s — positive number (seconds)
  if (d["capability_manifest_ttl_s"] !== undefined) {
    const v = d["capability_manifest_ttl_s"];
    if (typeof v !== "number" || v <= 0)
      rejects.push(`defaults.capability_manifest_ttl_s must be a positive number (seconds) (got ${JSON.stringify(v)})`);
  }
  // R-020: defaults.allowed_tools — string[]
  if (d["allowed_tools"] !== undefined && !Array.isArray(d["allowed_tools"]))
    rejects.push(`defaults.allowed_tools must be an array of strings`);
  // defaults.index.* — closed key set (D-PS-1)
  if (isPlainObject(d["index"])) {
    const idx = d["index"] as Record<string, unknown>;
    for (const ik of Object.keys(idx)) {
      if (!VALID_INDEX_KEYS.has(ik)) {
        rejects.push(`unknown defaults.index key "${ik}" (closed key set — see v2-persistence-and-sqlite-index ADR D-PS-1)`);
      }
    }
    if (idx["enabled"] !== undefined && typeof idx["enabled"] !== "boolean") {
      rejects.push(`defaults.index.enabled must be a boolean (got ${JSON.stringify(idx["enabled"])})`);
    }
    for (const numKey of ["kg_node_threshold", "links_edge_threshold", "runs_threshold", "wiki_file_threshold"] as const) {
      if (idx[numKey] !== undefined) {
        const v = idx[numKey];
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
          rejects.push(`defaults.index.${numKey} must be a positive integer (got ${JSON.stringify(v)})`);
        }
      }
    }
    if (idx["kg_size_threshold_mb"] !== undefined) {
      const v = idx["kg_size_threshold_mb"];
      if (typeof v !== "number" || v <= 0) {
        rejects.push(`defaults.index.kg_size_threshold_mb must be a positive number (got ${JSON.stringify(v)})`);
      }
    }
  }
  return rejects;
}

function loadFileConfig(cwd: string, selfBuild: boolean): FileLoad {
  const settingsPath = path.join(cwd, ".guild", "settings.json");

  if (fs.existsSync(settingsPath)) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch (e) {
      process.stderr.write(`[read-guild-config] WARN: could not parse .guild/settings.json (${(e as Error).message}) — using defaults\n`);
      return { config: {}, rejects: [], source: "none" };
    }
    const rejects: string[] = [];
    const TIER1 = new Set([
      "rigor", "auto_approve", "review", "host", "roles", "host_profiles", "initiative_default",
      "index", "record_status_runs", "codex_skip_enforcement", "agent_mode", "workspace", "models",
      "security", "secrets_policy", "mcp",
      "statusline",                  // R-009: status-line pane enable (--statusline flag / settings key)
      "adversarial_review_provider", // R-008: cross-review provider pin
      "loops", "loop_cap", "codex_cap", "defaults",
    ]);
    for (const k of Object.keys(parsed)) {
      if (k.startsWith("_")) continue; // _help / _docs annotations
      if (!TIER1.has(k)) {
        // Closed-key reject (13-config-surfaces / D11): an unknown TOP-LEVEL key is
        // REJECTED at --validate, never silently ignored — a typo ("rigour") must
        // surface. loadFileConfig only feeds the --validate path; resolve mode goes
        // through lib/settings-resolver.ts, which strips unknown keys.
        rejects.push(
          `unknown top-level key "${k}" (closed key set — check spelling; known: ${[...TIER1].join(", ")})`
        );
        process.stderr.write(`[read-guild-config] WARN: unknown top-level key "${k}" ignored\n`);
      }
    }
    const out: Partial<GuildSettings> = {};
    if (VALID_RIGOR.has(parsed["rigor"] as string)) out.rigor = parsed["rigor"] as GuildSettings["rigor"];
    if (Array.isArray(parsed["auto_approve"])) out.auto_approve = parsed["auto_approve"] as string[];
    if (VALID_REVIEW.has(parsed["review"] as string)) out.review = parsed["review"] as GuildSettings["review"];
    if (parsed["host"] === "auto") out.host = "auto";
    else if (typeof parsed["host"] === "string") {
      const normalized = normalizeDispatchHostId(parsed["host"]);
      if (normalized) out.host = normalized;
      else {
        rejects.push(
          `host "${parsed["host"]}" is invalid for the top-level dispatch selector ` +
            `(valid: auto or dispatch-selectable host ids ${[...DISPATCH_HOST_IDS].join("|")})`
        );
      }
    }
    // roles: per-run role pins (LW1-6). Closed sub-keys; null or known host_id values.
    if (isPlainObject(parsed["roles"])) {
      const rawRoles = parsed["roles"] as Record<string, unknown>;
      rejects.push(...validateRoles(rawRoles));
      const mergedRoles = { ...DEFAULTS.roles } as unknown as Record<string, unknown>;
      for (const rk of VALID_ROLES_KEYS) {
        const v = rawRoles[rk];
        if (v === null) {
          mergedRoles[rk] = null;
        } else if (typeof v === "string") {
          const normalized = normalizeHostId(v);
          if (normalized) mergedRoles[rk] = normalized;
        }
      }
      out.roles = mergedRoles as unknown as RolesBlock;
    }
    // host_profiles: per-host render overrides (LW1-6). Strict closed shape.
    if (isPlainObject(parsed["host_profiles"])) {
      const rawHp = parsed["host_profiles"] as Record<string, unknown>;
      rejects.push(...validateHostProfiles(rawHp));
      const mergedHp: HostProfilesBlock = {};
      for (const [hostId, entry] of Object.entries(rawHp)) {
        const normalized = normalizeHostId(hostId);
        if (normalized && isPlainObject(entry)) {
          mergedHp[normalized] = entry as HostProfileEntry;
        }
      }
      out.host_profiles = mergedHp;
    }
    if (parsed["initiative_default"] === null || typeof parsed["initiative_default"] === "string")
      out.initiative_default = parsed["initiative_default"] as string | null;
    if (parsed["index"] === "auto" || parsed["index"] === "off") out.index = parsed["index"];
    // OQ6 (SC-B): record_status_runs — default-safe-when-absent (true).
    if (typeof parsed["record_status_runs"] === "boolean")
      out.record_status_runs = parsed["record_status_runs"] as boolean;
    // FU-E: codex_skip_enforcement — closed values warn|block; default-safe-when-absent (warn).
    if (parsed["codex_skip_enforcement"] === "warn" || parsed["codex_skip_enforcement"] === "block")
      out.codex_skip_enforcement = parsed["codex_skip_enforcement"];
    else if (parsed["codex_skip_enforcement"] !== undefined) {
      rejects.push(
        `codex_skip_enforcement "${parsed["codex_skip_enforcement"]}" is invalid — valid: warn|block`
      );
    }
    // D5: agent_mode as Tier-1 key (supersedes defaults.agent_team).
    if (VALID_AGENT_MODE.has(parsed["agent_mode"] as string))
      out.agent_mode = parsed["agent_mode"] as GuildSettings["agent_mode"];
    // workspace.mode (guild.workspace.v1): auto|on|off. No max_depth — depth is fixed at 1.
    if (isPlainObject(parsed["workspace"])) {
      const ws = parsed["workspace"] as Record<string, unknown>;
      const wsMode = ws["mode"];
      if (wsMode === "auto" || wsMode === "on" || wsMode === "off") {
        out.workspace = { mode: wsMode };
      } else if (ws["mode"] !== undefined) {
        process.stderr.write(
          `[read-guild-config] WARN: unknown workspace.mode "${wsMode}" — valid values: auto|on|off. Using auto.\n`
        );
      }
      // Closed-key: reject unknown workspace.* keys (no max_depth — depth is fixed at 1)
      const VALID_WS_KEYS = new Set(["mode"]);
      for (const wk of Object.keys(ws)) {
        if (!VALID_WS_KEYS.has(wk)) {
          rejects.push(
            `unknown workspace key "${wk}" (closed key set — no max_depth, depth is hard-fixed at 1)`
          );
        }
      }
    }
    // models: block — host-agnostic tier map + cost-tiering config (ADR §10).
    // Deep-merge over DEFAULTS.models so partial overrides work; closed-key reject unknown fields.
    if (isPlainObject(parsed["models"])) {
      const rawModels = parsed["models"] as Record<string, unknown>;
      rejects.push(...validateModels(rawModels));
      // Deep-merge tiers, scoreWeights, thresholds, cacheTTL sub-objects.
      const mergedModels: ModelsBlock = { ...DEFAULTS.models };
      if (typeof rawModels["enabled"] === "boolean") mergedModels.enabled = rawModels["enabled"];
      if (isPlainObject(rawModels["tiers"])) {
        const rt = rawModels["tiers"] as Record<string, unknown>;
        mergedModels.tiers = { ...DEFAULTS.models.tiers } as TiersBlock;
        for (const tier of ["cheap", "mid", "powerful"] as const) {
          if (isPlainObject(rt[tier])) {
            // G-lane rework: strip unknown host keys BEFORE merging so they can
            // never leak into the resolved config (--validate hard-rejects above;
            // resolve mode must also not carry them — same pattern as defaults.*).
            const rawHostMap = rt[tier] as Record<string, unknown>;
            const knownHosts: Partial<TierHostMap> = {};
            for (const hk of Object.keys(rawHostMap)) {
              const canonicalHostId = normalizeHostId(hk);
              if (canonicalHostId) {
                (knownHosts as Record<string, unknown>)[canonicalHostId] = rawHostMap[hk];
              }
            }
            mergedModels.tiers[tier] = { ...DEFAULTS.models.tiers[tier], ...knownHosts };
          }
        }
      }
      if (isPlainObject(rawModels["scoreWeights"])) {
        mergedModels.scoreWeights = { ...DEFAULTS.models.scoreWeights, ...(rawModels["scoreWeights"] as Record<string, number>) };
      }
      if (isPlainObject(rawModels["thresholds"])) {
        mergedModels.thresholds = { ...DEFAULTS.models.thresholds, ...(rawModels["thresholds"] as Partial<ModelsBlock["thresholds"]>) };
      }
      if (typeof rawModels["advisorRounds"] === "number" && rawModels["advisorRounds"] >= 1) {
        mergedModels.advisorRounds = Math.floor(rawModels["advisorRounds"]);
      }
      if (Array.isArray(rawModels["escalationMarkers"])) {
        mergedModels.escalationMarkers = rawModels["escalationMarkers"] as string[];
      }
      if (typeof rawModels["recallBeforeRead"] === "boolean") mergedModels.recallBeforeRead = rawModels["recallBeforeRead"];
      // compositeRecall + importanceAtIngest booleans (these had no merge before — a user's
      // settings.json value was silently dropped; the live recall path never consumed it so it
      // went unnoticed. Now that recall is config-driven they MUST merge.)
      if (typeof rawModels["compositeRecall"] === "boolean") mergedModels.compositeRecall = rawModels["compositeRecall"];
      if (typeof rawModels["importanceAtIngest"] === "boolean") mergedModels.importanceAtIngest = rawModels["importanceAtIngest"];
      if (typeof rawModels["recallScoreThreshold"] === "number") mergedModels.recallScoreThreshold = rawModels["recallScoreThreshold"];
      if (typeof rawModels["structuredOutputRequired"] === "boolean") mergedModels.structuredOutputRequired = rawModels["structuredOutputRequired"];
      if (isPlainObject(rawModels["cacheTTL"])) {
        const rttl = rawModels["cacheTTL"] as Record<string, unknown>;
        const newTTL: CacheTTLBlock = { ...DEFAULTS.models.cacheTTL };
        if (VALID_CACHE_TTL.has(rttl["coordinator"] as string)) newTTL.coordinator = rttl["coordinator"] as CacheTTLBlock["coordinator"];
        if (VALID_CACHE_TTL.has(rttl["leaf"] as string)) newTTL.leaf = rttl["leaf"] as CacheTTLBlock["leaf"];
        mergedModels.cacheTTL = newTTL;
      }
      if (typeof rawModels["importanceGate"] === "number" && rawModels["importanceGate"] >= 1 && rawModels["importanceGate"] <= 5) {
        mergedModels.importanceGate = Math.floor(rawModels["importanceGate"]);
      }
      if (typeof rawModels["ingestSimilarityGate"] === "number" && rawModels["ingestSimilarityGate"] >= 0 && rawModels["ingestSimilarityGate"] <= 1) {
        mergedModels.ingestSimilarityGate = rawModels["ingestSimilarityGate"];
      }
      // shortOutputThreshold: nested map { task_type → { tier → token-floor } } (D-OBS-3).
      // Malformed outer values (non-object) are silently dropped; malformed inner values
      // (non-number) are silently dropped — graceful degradation so a partial calibration
      // proposal never hard-blocks the config load.
      if (isPlainObject(rawModels["shortOutputThreshold"])) {
        const sot = rawModels["shortOutputThreshold"] as Record<string, unknown>;
        const merged: Record<string, Record<string, number>> = {};
        for (const taskType of Object.keys(sot)) {
          if (!isPlainObject(sot[taskType])) continue; // drop malformed outer entry
          const innerRaw = sot[taskType] as Record<string, unknown>;
          const innerMerged: Record<string, number> = {};
          for (const tier of Object.keys(innerRaw)) {
            if (typeof innerRaw[tier] === "number") {
              innerMerged[tier] = innerRaw[tier] as number;
            }
            // non-number inner values silently dropped
          }
          if (Object.keys(innerMerged).length > 0) merged[taskType] = innerMerged;
        }
        mergedModels.shortOutputThreshold = merged;
      }
      // knowledge: per-project K-stage tuning params (SC-14/SC-15, cost-aware-tiering ADR §10).
      if (isPlainObject(rawModels["knowledge"])) {
        const rawK = rawModels["knowledge"] as Record<string, unknown>;
        const mergedK: KnowledgeConfigBlock = { ...DEFAULTS.models.knowledge };
        if (typeof rawK["maxDepth"] === "number" && rawK["maxDepth"] >= 1)
          mergedK.maxDepth = Math.floor(rawK["maxDepth"] as number);
        if (typeof rawK["maxBranching"] === "number" && rawK["maxBranching"] >= 1)
          mergedK.maxBranching = Math.floor(rawK["maxBranching"] as number);
        if (typeof rawK["minTopicImportance"] === "number" && rawK["minTopicImportance"] >= 0 && rawK["minTopicImportance"] <= 1)
          mergedK.minTopicImportance = rawK["minTopicImportance"] as number;
        if (typeof rawK["relMinConf"] === "number" && rawK["relMinConf"] >= 0 && rawK["relMinConf"] <= 1)
          mergedK.relMinConf = rawK["relMinConf"] as number;
        if (typeof rawK["maxFiles"] === "number" && rawK["maxFiles"] >= 1)
          mergedK.maxFiles = Math.floor(rawK["maxFiles"] as number);
        if (typeof rawK["maxTokens"] === "number" && rawK["maxTokens"] >= 1)
          mergedK.maxTokens = Math.floor(rawK["maxTokens"] as number);
        if (typeof rawK["batchSize"] === "number" && rawK["batchSize"] >= 1)
          mergedK.batchSize = Math.floor(rawK["batchSize"] as number);
        mergedModels.knowledge = mergedK;
      }
      out.models = mergedModels;
    }
    // security: block — bypassPermissions governance (D-BYPASS).
    if (isPlainObject(parsed["security"])) {
      const rawSec = parsed["security"] as Record<string, unknown>;
      rejects.push(...validateSecurity(rawSec));
      const mergedSec: SecurityBlock = { ...DEFAULTS.security };
      const bpp = rawSec["bypass_permissions_policy"];
      if (bpp === "deny" || bpp === "audit" || bpp === "allow") mergedSec.bypass_permissions_policy = bpp;
      out.security = mergedSec;
    }
    // secrets_policy: block — secrets redaction policy (D-SECRETS).
    if (isPlainObject(parsed["secrets_policy"])) {
      const rawSp = parsed["secrets_policy"] as Record<string, unknown>;
      rejects.push(...validateSecretsPolicy(rawSp));
      const mergedSp: SecretsPolicyBlock = { ...DEFAULTS.secrets_policy };
      if (Array.isArray(rawSp["env_allowlist"])) mergedSp.env_allowlist = rawSp["env_allowlist"] as string[];
      if (Array.isArray(rawSp["redaction_patterns"])) mergedSp.redaction_patterns = rawSp["redaction_patterns"] as string[];
      if (rawSp["fail_mode_durable"] === "closed" || rawSp["fail_mode_durable"] === "open") mergedSp.fail_mode_durable = rawSp["fail_mode_durable"];
      if (rawSp["fail_mode_telemetry"] === "open" || rawSp["fail_mode_telemetry"] === "closed") mergedSp.fail_mode_telemetry = rawSp["fail_mode_telemetry"];
      out.secrets_policy = mergedSp;
    }
    // mcp: block — description pinning (D-MCP) + transport availability (R-019).
    if (isPlainObject(parsed["mcp"])) {
      const rawMcp = parsed["mcp"] as Record<string, unknown>;
      rejects.push(...validateMcp(rawMcp));
      const mergedMcp: McpBlock = { ...DEFAULTS.mcp };
      if (isPlainObject(rawMcp["tool_description_hashes"])) {
        mergedMcp.tool_description_hashes = rawMcp["tool_description_hashes"] as Record<string, string>;
      }
      // R-019: transport availability flags
      if (typeof rawMcp["stdio_available"] === "boolean") mergedMcp.stdio_available = rawMcp["stdio_available"];
      if (typeof rawMcp["http_available"] === "boolean")  mergedMcp.http_available  = rawMcp["http_available"];
      if (rawMcp["bridge_package"] === null || typeof rawMcp["bridge_package"] === "string") {
        mergedMcp.bridge_package = rawMcp["bridge_package"] as string | null;
      }
      out.mcp = mergedMcp;
    }
    if (typeof parsed["loops"] === "string" || parsed["loops"] === null) out.loops = parsed["loops"] as string | null;
    if (typeof parsed["loop_cap"] === "number") out.loop_cap = Math.min(256, Math.max(1, parsed["loop_cap"]));
    if (typeof parsed["codex_cap"] === "number") out.codex_cap = Math.min(10, Math.max(1, parsed["codex_cap"]));
    // R-009: statusline — bool; --statusline flag sets it true at CLI level too
    if (typeof parsed["statusline"] === "boolean") out.statusline = parsed["statusline"];
    // R-008: adversarial_review_provider — open string; any non-empty string is a valid provider id
    if (typeof parsed["adversarial_review_provider"] === "string") {
      out.adversarial_review_provider = parsed["adversarial_review_provider"];
    }
    if (isPlainObject(parsed["defaults"])) {
      rejects.push(...validateDefaults(parsed["defaults"], selfBuild));
      // Strip unknown keys before merging so resolved config never carries them.
      // (--validate hard-rejects above; resolve mode must also not leak them.)
      const rawDefaults = parsed["defaults"] as Record<string, unknown>;
      const knownDefaults: Record<string, unknown> = {};
      for (const k of Object.keys(rawDefaults)) {
        if (DEFAULTS_ALLOWED_KEYS.has(k)) knownDefaults[k] = rawDefaults[k];
      }
      // Deep-merge cross_host so fallback_to_claude (R-015) is preserved alongside enabled/hosts
      const rawCrossHost = knownDefaults["cross_host"];
      if (rawCrossHost && isPlainObject(rawCrossHost)) {
        knownDefaults["cross_host"] = { ...DEFAULTS.defaults.cross_host, ...(rawCrossHost as Record<string, unknown>) };
      }
      out.defaults = { ...DEFAULTS.defaults, ...(knownDefaults as Partial<DefaultsBlock>) } as DefaultsBlock;
    }
    // R-007: top-level `index:"off"` must cohere with IndexBlock.enabled.
    // When the operator sets index:"off", the SQLite cache must also be fully disabled.
    // The two config surfaces are separate but must stay coherent after merge.
    if (out.index === "off" && out.defaults) {
      out.defaults = { ...out.defaults, index: { ...out.defaults.index, enabled: false } };
    }
    return { config: out, rejects, source: "settings.json" };
  }

  // No settings.json — return built-in defaults.
  // config.yml is no longer read at runtime (SC-8 W2B-5).
  // Migration path: run the on-open converter (scripts/dot-guild/convert/) which
  // materializes settings.json from config.yml. See MIGRATION.md.
  return { config: {}, rejects: [], source: "none" };
}

// P1-L9: exported (additive) — the canonical `config init` output generator. The
// reconciler reuses {...DEFAULTS, _help: HELP} so `reconcile sync` on a fresh repo is
// byte-identical to this.
export function scaffold(): string {
  return JSON.stringify({ ...DEFAULTS, _help: HELP }, null, 2) + "\n";
}

// ── --rigor profile expansion (command-surface.md §4.3 — the anti-soup mechanism).
// Each profile maps to loops / loop_cap / review. loop_cap is null ("—") for quick.
interface RigorProfile {
  loops: string;
  loop_cap: number | null;
  review: GuildSettings["review"];
}
function rigorProfile(rigor: GuildSettings["rigor"]): RigorProfile {
  switch (rigor) {
    case "quick":
      return { loops: "none", loop_cap: null, review: "off" };
    case "deep":
      // deep AUTO-IMPLIES review=cross (§4.3); host-availability fallback at apply time.
      return { loops: "all", loop_cap: 16, review: "cross" };
    case "standard":
    default:
      return { loops: "spec,plan", loop_cap: 16, review: "local" };
  }
}

// Cross-host (Codex) availability for the deep→cross auto-implication. We do NOT
// probe Codex here; the orchestrator signals availability via env. Absent ⇒ assume
// available (so rigor=deep resolves to review=cross by default). When unavailable,
// deep falls back to review=local + a weak-independence note (D7) — NEVER a hard fail.
function crossHostAvailable(): boolean {
  const v = process.env["GUILD_CROSS_HOST_AVAILABLE"];
  if (v === undefined) return true;
  const s = v.trim().toLowerCase();
  return !(s === "0" || s === "false" || s === "no" || s === "off");
}

function main(): void {
  const { cwd: cwdFlag, mode, selfBuild, modelTier, flags } = parseArgs(process.argv.slice(2));
  const cwd = cwdFlag ?? process.env["GUILD_CWD"] ?? process.cwd();

  if (mode === "scaffold") {
    process.stdout.write(scaffold());
    return;
  }

  // ── --validate mode: run closed-key validation on the project's settings.json.
  // Uses the local loadFileConfig/loadLocalOverride path (full validation rejects).
  if (mode === "validate") {
    const { config: fileConfigRaw, rejects, source } = loadFileConfig(cwd, selfBuild);

    let fileConfig = fileConfigRaw;
    if (source === "settings.json") {
      try {
        fileConfig = loadLocalOverride(cwd, fileConfigRaw, selfBuild);
      } catch (e) {
        rejects.push((e as Error).message);
        process.stderr.write(`[read-guild-config] ERROR: ${(e as Error).message}\n`);
      }
    }

    if (source === "none") {
      process.stdout.write("no .guild/settings.json found — built-in defaults are valid.\n");
      return;
    }
    if (rejects.length === 0) {
      process.stdout.write(`.guild/${source}: VALID (closed-key checks pass)\n`);
      return;
    }
    process.stdout.write(`.guild/${source}: INVALID — ${rejects.length} violation(s):\n`);
    for (const r of rejects) process.stdout.write(`  - ${r}\n`);
    process.exit(1);
    return;
  }

  // ── resolve mode: delegate to the shared settings-resolver library.
  // This is the canonical path; all workspace inheritance and precedence
  // chain logic lives in lib/settings-resolver.ts.
  const localPath = path.join(cwd, ".guild", "settings.local.json");
  let localLoadedKeys: string[] = [];

  // Surface settings.local.json INFO/ERROR log (parity with the old loader's stderr output).
  // We validate keys here before delegating to the library so the error message surfaces
  // on stderr for the CLI consumer, consistent with the original behavior.
  if (fs.existsSync(localPath)) {
    try {
      const rawLocal = JSON.parse(fs.readFileSync(localPath, "utf8")) as Record<string, unknown>;
      localLoadedKeys = Object.keys(rawLocal).filter((k) => !k.startsWith("_"));
      // Validate top-level keys against the schema (same rule as old loadLocalOverride)
      const schemaBase = DEFAULTS as unknown as Record<string, unknown>;
      const basePaths = new Set<string>();
      (function collectPaths(obj: Record<string, unknown>, prefix = ""): void {
        for (const [k, v] of Object.entries(obj)) {
          const full = prefix ? `${prefix}.${k}` : k;
          basePaths.add(full);
          if (typeof v === "object" && v !== null && !Array.isArray(v)) {
            collectPaths(v as Record<string, unknown>, full);
          }
        }
      })(schemaBase);
      for (const key of localLoadedKeys) {
        if (!basePaths.has(key)) {
          const errMsg =
            `share-dot-guild: settings.local.json key '${key}' not in settings.json schema — ` +
            `refusing to silently extend. Declare it in settings.json first (with the team default) ` +
            `or remove it from settings.local.json.`;
          process.stderr.write(`[read-guild-config] ERROR: ${errMsg}\n`);
          // Don't emit INFO — surface error only (same as original behavior)
          localLoadedKeys = []; // prevent INFO from firing below
          break;
        }
      }
      if (localLoadedKeys.length > 0) {
        process.stderr.write(
          `[read-guild-config] INFO: .guild/settings.local.json loaded — ` +
            `${localLoadedKeys.length} override key(s): ` +
            `[${localLoadedKeys.join(", ")}]\n`
        );
      }
    } catch {
      // parse error already handled inside the library
    }
  }

  const { config: resolved } = resolveSettings({
    cwd,
    flags: flags as Partial<import("../settings-resolver").ResolvedConfig>,
    selfBuild,
  });

  // Remap _rigorExpanded → _rigor_expanded for CLI output (backwards compat)
  const rigorExpanded = resolved._rigorExpanded;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _rigorExpanded: _drop, ...resolvedWithout } = resolved;

  const output: Record<string, unknown> = {
    ...resolvedWithout,
    _rigor_expanded: rigorExpanded,
  };

  if (modelTier !== undefined) {
    output["_model_tier_override"] = {
      tier: modelTier,
      source: "--model-tier CLI flag",
      note: "Top of tier precedence ladder: --model-tier > per-lane override > models.thresholds > built-in",
    };
  }

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

// Export main() so the shim at scripts/read-guild-config.ts can invoke it when executed directly.
// The shim owns the `require.main === module` guard so it is NOT here (avoids double-execution
// when imported via the shim and when config-cmd.ts imports the validators).
export { main as __main };

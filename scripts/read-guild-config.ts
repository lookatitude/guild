#!/usr/bin/env -S npx tsx
/**
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
 * `.guild/settings.json` REPLACES the v1 `.guild/config.yml`. A one-time
 * back-compat shim reads + migrates an existing config.yml when settings.json
 * is absent and warns once (MIGRATION.md). Once settings.json exists it is
 * authoritative.
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
 * Stderr: warnings for unknown keys, parse errors, deprecation shim.
 * Exit:   0 in resolve/scaffold (config failures must not block the lifecycle);
 *         non-zero only from --validate on a closed-key violation.
 */

import * as fs from "fs";
import * as path from "path";

// ── Schema (Tier-1 + Tier-2 defaults). Canonical body: command-surface.md §4.4.
interface QualityBudget {
  per_class_minutes: number;
  total_minutes: number;
}
interface DefaultsBlock {
  /** @deprecated Use top-level `agent_mode` (D5). Warn-once alias: auto→auto, on→team, off→subagent. Removed at v2.1.0. */
  agent_team: "auto" | "on" | "off";
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
}
interface WorkspaceBlock {
  /** auto (default) = detect by immediate-child rule; on = force workspace; off = force regular. NO max_depth — depth is fixed at 1. */
  mode: "auto" | "on" | "off";
}

// ── Host-agnostic model tier map (ADR §1, §10 — cost-aware-tiering-and-lean-context).
// tiers: cheap|mid|powerful → {claude,codex,gemini}. codex/gemini are null now (no third host).
// Defaults preserve zero-config behavior (cheaper learn, same routing otherwise).
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
  /** BM25 top-1 similarity threshold for the ingest anomaly gate (D-INGEST-GATE). Default 0.80. */
  ingestSimilarityGate: number;
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

interface GuildSettings {
  rigor: "quick" | "standard" | "deep";
  auto_approve: string[]; // [] | [spec,plan,build] | [all]
  review: "local" | "cross" | "off";
  host: "claude" | "codex" | "auto";
  initiative_default: string | null;
  index: "auto" | "off";
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
  /** MCP description pinning + capability declarations (v2-security-and-untrusted-content ADR D-MCP). */
  mcp: McpBlock;
  // power-user overrides
  loops: string | null;
  loop_cap: number;
  codex_cap: number;
  defaults: DefaultsBlock;
}

// Default escalation marker phrases (ADR §3, research defaults).
const DEFAULT_ESCALATION_MARKERS: string[] = [
  "I'm not sure",
  "unclear",
  "cannot determine",
  "I don't know",
  "ambiguous",
  "uncertain",
  "not enough information",
];

const DEFAULTS: GuildSettings = {
  rigor: "standard",
  auto_approve: [],
  review: "local",
  host: "auto",
  initiative_default: null,
  index: "auto",
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
      workType:         0,  // base; read/summarize=0, draft/extract=+1, architect/review/schema=+2
      blastRadius:      1,  // per-point contribution when blast-radius/file-count is large
      dependsOn:        1,  // upstream depends-on contract present
      security:         1,  // security/correctness sensitivity flag
      priorEscalation:  1,  // prior-attempt escalation on this lane (sticky for the run)
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
    agent_team: "auto",
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
  },
};

// Self-documenting help block written into the scaffolded settings.json.
const HELP: Record<string, string> = {
  rigor: "quick | standard | deep — profile knob; expands loops/caps/review depth",
  auto_approve: "[] | [spec,plan,build] | [all] — opt-in autonomy; destructive/network/spend STILL ask",
  review: "local | cross | off — cross engages the Claude<->Codex adversarial review broker",
  host: "claude | codex | auto — co-equal host adapter selection",
  initiative_default: "null | <initiative-id> — attach runs to a durable initiative",
  index: "auto | off — optional SQLite read-through cache (auto = lazy-build past measured slowness)",
  agent_mode:
    "team | agent | subagent | auto (default) — execution backend (D5 dispatch ladder). " +
    "auto: $TMUX→team(in-session); tmux-installed→team(new-session); " +
    "independent-agents-supported→agent; else→subagent. " +
    "Replaces deprecated defaults.agent_team.",
  "workspace.mode":
    "auto (default) | on | off — workspace federation mode (guild.workspace.v1). " +
    "auto: detect by immediate-child rule (.git/.guild). on: force workspace. off: force regular. " +
    "Depth is hard-fixed at 1 — no max_depth knob. Overridden by --mode flag on workspace/detect.ts.",
  loops: "null | none|spec|plan|implementation|all|<csv> — power-user; null = derive from rigor",
  loop_cap: "int 1-256 — max rounds per adversarial loop",
  codex_cap: "int 1-10 — max rounds per Codex review gate",
  "defaults.agent_team":
    "[DEPRECATED → use top-level agent_mode] auto | on | off — " +
    "warn-once alias: auto→auto, on→team, off→subagent. Removed at v2.1.0.",
  "defaults.auto_learn":
    "bool (default false) — when true, /guild init runs the full learn-* pipeline at bootstrap (D3). " +
    "Precedence: --learn CLI flag > settings.json > built-in(false).",
  "defaults.adversarial": "on | off — (off REJECTED for Guild self-build)",
  "defaults.team.size": "null = 3-4 rule | <int> (cap-6 unless overridden)",
  "defaults.team.always_include": "[] | subset of the 14 specialists",
  "defaults.review_workflow": "standard | cross | minimal — default review depth",
  "defaults.skill_policy": "standard | conservative — default skill-usage",
  "defaults.gates.auto_approve": "[] | [spec,plan,build,all] — default approval-gate posture (never qa/ops)",
  "defaults.wiki.share_mode": "team | private — wiki share mode (moved here from project.yaml)",
  "defaults.wiki.autopromote": "false ALWAYS (true REJECTED — agents emit candidates only)",
  "defaults.quality.budget.per_class_minutes": "int > 0 — per-check-class wall-clock cap",
  "defaults.quality.budget.total_minutes": "int > 0 — whole-phase wall-clock cap",
  "defaults.reporting": "standard | quiet | verbose — default task/progress reporting",
  // ── models: block (cost-aware-tiering-and-lean-context ADR §10)
  "models.enabled":
    "bool (default true) — master toggle for cost-tiering. false = all lanes run at mid (current v2 behavior).",
  "models.tiers":
    "{cheap|mid|powerful: {claude,codex,gemini}} — host-agnostic tier→model map (ADR §1). " +
    "null host slot = no model for that tier on that host (fall through to host mapping). " +
    "Defaults: cheap=haiku, mid=sonnet, powerful=opus. codex/gemini are null (no third host yet).",
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
  "models.ingestSimilarityGate":
    "float 0–1 (default 0.80) — BM25 top-1 similarity threshold for the wiki ingest anomaly gate (D-INGEST-GATE). " +
    "If a candidate page scores ≥ this against existing pages, guild:wiki-ingest pauses: supersede / skip / proceed — never silently overwrites.",
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
    "object (default {}) — map of MCP tool-name → SHA-256 hash of (description + inputSchema), " +
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
  _precedence:
    "CLI flag > --rigor profile > settings.json > built-in default. " +
    "For model tier: --model-tier=cheap|mid|powerful > per-lane plan override > models.tiers/thresholds > built-in.",
  _docs: "Canonical schema: architecture/command-surface.md §4.4. Regenerate with: /guild config init",
};

const VALID_LOOPS = new Set(["none", "spec", "plan", "implementation", "all"]);
const VALID_RIGOR = new Set(["quick", "standard", "deep"]);
const VALID_REVIEW = new Set(["local", "cross", "off"]);
const VALID_HOST = new Set(["claude", "codex", "auto"]);
const VALID_PHASES = new Set(["spec", "plan", "build", "all"]);
const VALID_AGENT_MODE = new Set(["team", "agent", "subagent", "auto"]);
const VALID_MODEL_TIER = new Set(["cheap", "mid", "powerful"]);
const VALID_CACHE_TTL = new Set(["1h", "5m", "off"]);

// Closed-key set for models.* top-level fields (ADR §10 + D-INGEST-GATE).
const VALID_MODELS_KEYS = new Set([
  "enabled", "tiers", "scoreWeights", "thresholds", "advisorRounds",
  "escalationMarkers", "recallBeforeRead", "recallScoreThreshold",
  "structuredOutputRequired", "cacheTTL", "importanceGate", "ingestSimilarityGate",
]);

// Closed-key set for security.* block (D-BYPASS).
const VALID_SECURITY_KEYS = new Set(["bypass_permissions_policy"]);

// Closed-key set for secrets_policy.* block (D-SECRETS).
const VALID_SECRETS_POLICY_KEYS = new Set([
  "env_allowlist", "redaction_patterns", "fail_mode_durable", "fail_mode_telemetry",
]);

// Closed-key set for mcp.* block (D-MCP).
const VALID_MCP_KEYS = new Set(["tool_description_hashes"]);

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
    } else if (arg === "--codex-review") {
      flags.review = "cross"; // v1 back-compat → v2 review=cross
    } else if (arg.startsWith("--host=")) {
      const v = arg.slice("--host=".length);
      if (VALID_HOST.has(v)) flags.host = v as GuildSettings["host"];
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
    }
  }
  return { cwd, mode, selfBuild, modelTier, flags };
}

// ── config.yml back-compat shim (flat v1 keys → v2 shape). MIGRATION.md §3.
function parseYamlSimple(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const raw of content.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line || !line.includes(":")) continue;
    const i = line.indexOf(":");
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (!key) continue;
    if (val === "true") result[key] = true;
    else if (val === "false") result[key] = false;
    else if (/^\d+$/.test(val)) result[key] = parseInt(val, 10);
    else result[key] = val.replace(/^["']|["']$/g, "");
  }
  return result;
}

function migrateLegacyConfig(parsed: Record<string, unknown>): Partial<GuildSettings> {
  const out: Partial<GuildSettings> = {};
  if (typeof parsed["loops"] === "string") out.loops = parsed["loops"];
  if (typeof parsed["loop_cap"] === "number") out.loop_cap = Math.min(256, Math.max(1, parsed["loop_cap"]));
  if (typeof parsed["codex_cap"] === "number") out.codex_cap = Math.min(10, Math.max(1, parsed["codex_cap"]));
  if (parsed["codex_review"] === true) out.review = "cross";
  if (typeof parsed["auto_approve"] === "string") {
    const m = parsed["auto_approve"] as string;
    if (m === "spec-and-plan") out.auto_approve = ["spec", "plan"];
    else if (m === "all") out.auto_approve = ["all"];
    else if (m === "implementation") out.auto_approve = ["build"];
  }
  return out;
}

interface FileLoad {
  config: Partial<GuildSettings>;
  rejects: string[];
  source: "settings.json" | "config.yml" | "none";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Closed-key validation of the `models:` block. Returns reject messages. (ADR §10) */
function validateModels(m: Record<string, unknown>): string[] {
  const rejects: string[] = [];
  for (const k of Object.keys(m)) {
    if (!VALID_MODELS_KEYS.has(k)) {
      rejects.push(`unknown models key "${k}" (closed key set — check spelling against ADR §10)`);
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
function validateSecurity(s: Record<string, unknown>): string[] {
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
function validateSecretsPolicy(sp: Record<string, unknown>): string[] {
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

/** Closed-key validation of the `mcp:` block (D-MCP). Returns reject messages. */
function validateMcp(m: Record<string, unknown>): string[] {
  const rejects: string[] = [];
  for (const k of Object.keys(m)) {
    if (!VALID_MCP_KEYS.has(k)) {
      rejects.push(`unknown mcp key "${k}" (closed key set — only tool_description_hashes is valid)`);
    }
  }
  if (m["tool_description_hashes"] !== undefined && !isPlainObject(m["tool_description_hashes"])) {
    rejects.push(`mcp.tool_description_hashes must be an object (tool-name → SHA-256 hash)`);
  }
  return rejects;
}

/** Closed-key validation of the `defaults:` block. Returns reject messages. */
function validateDefaults(d: Record<string, unknown>, selfBuild: boolean): string[] {
  const rejects: string[] = [];
  const ALLOWED = new Set([
    "agent_team",   // DEPRECATED alias — still accepted, warn-once in loadFileConfig
    "auto_learn",   // D3: bool, default false
    "adversarial", "team", "review_workflow", "skill_policy",
    "gates", "wiki", "quality", "reporting",
    "index",        // D-PS-1: SQLite lazy-cache trigger thresholds
  ]);
  for (const k of Object.keys(d)) {
    if (!ALLOWED.has(k)) rejects.push(`unknown defaults key "${k}" (closed key set — a typo must surface)`);
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
  const legacyPath = path.join(cwd, ".guild", "config.yml");

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
      "rigor", "auto_approve", "review", "host", "initiative_default",
      "index", "agent_mode", "workspace", "models",
      "security", "secrets_policy", "mcp",
      "loops", "loop_cap", "codex_cap", "defaults",
    ]);
    for (const k of Object.keys(parsed)) {
      if (k.startsWith("_")) continue; // _help / _docs annotations
      if (!TIER1.has(k)) process.stderr.write(`[read-guild-config] WARN: unknown top-level key "${k}" ignored\n`);
    }
    const out: Partial<GuildSettings> = {};
    if (VALID_RIGOR.has(parsed["rigor"] as string)) out.rigor = parsed["rigor"] as GuildSettings["rigor"];
    if (Array.isArray(parsed["auto_approve"])) out.auto_approve = parsed["auto_approve"] as string[];
    if (VALID_REVIEW.has(parsed["review"] as string)) out.review = parsed["review"] as GuildSettings["review"];
    if (VALID_HOST.has(parsed["host"] as string)) out.host = parsed["host"] as GuildSettings["host"];
    if (parsed["initiative_default"] === null || typeof parsed["initiative_default"] === "string")
      out.initiative_default = parsed["initiative_default"] as string | null;
    if (parsed["index"] === "auto" || parsed["index"] === "off") out.index = parsed["index"];
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
            mergedModels.tiers[tier] = { ...DEFAULTS.models.tiers[tier], ...(rt[tier] as Partial<TierHostMap>) };
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
    // mcp: block — description pinning (D-MCP).
    if (isPlainObject(parsed["mcp"])) {
      const rawMcp = parsed["mcp"] as Record<string, unknown>;
      rejects.push(...validateMcp(rawMcp));
      const mergedMcp: McpBlock = { ...DEFAULTS.mcp };
      if (isPlainObject(rawMcp["tool_description_hashes"])) {
        mergedMcp.tool_description_hashes = rawMcp["tool_description_hashes"] as Record<string, string>;
      }
      out.mcp = mergedMcp;
    }
    if (typeof parsed["loops"] === "string" || parsed["loops"] === null) out.loops = parsed["loops"] as string | null;
    if (typeof parsed["loop_cap"] === "number") out.loop_cap = Math.min(256, Math.max(1, parsed["loop_cap"]));
    if (typeof parsed["codex_cap"] === "number") out.codex_cap = Math.min(10, Math.max(1, parsed["codex_cap"]));
    if (isPlainObject(parsed["defaults"])) {
      rejects.push(...validateDefaults(parsed["defaults"], selfBuild));
      // deep-merge known sub-keys over DEFAULTS.defaults
      out.defaults = { ...DEFAULTS.defaults, ...(parsed["defaults"] as Partial<DefaultsBlock>) } as DefaultsBlock;

      // Deprecation: defaults.agent_team → top-level agent_mode (D5, warn-once).
      // Mapping: auto→auto, on→team, off→subagent.
      const d = parsed["defaults"] as Record<string, unknown>;
      if (d["agent_team"] !== undefined) {
        process.stderr.write(
          "[read-guild-config] WARN: defaults.agent_team is DEPRECATED — use top-level agent_mode instead. " +
            "Migration: auto→auto, on→team, off→subagent. " +
            "Will be removed at v2.1.0. Run `/guild config init` to regenerate settings.json.\n"
        );
        // Translate to agent_mode only when Tier-1 agent_mode was NOT explicitly set.
        if (out.agent_mode === undefined) {
          const mapping: Record<string, GuildSettings["agent_mode"]> = {
            auto: "auto",
            on: "team",
            off: "subagent",
          };
          const mapped = mapping[d["agent_team"] as string];
          if (mapped) out.agent_mode = mapped;
        }
      }
    }
    return { config: out, rejects, source: "settings.json" };
  }

  if (fs.existsSync(legacyPath)) {
    process.stderr.write(
      "[read-guild-config] WARN: .guild/config.yml is DEPRECATED. Reading it via the back-compat shim. " +
        "Run `/guild config init` to migrate to .guild/settings.json (then config.yml is ignored).\n"
    );
    try {
      return { config: migrateLegacyConfig(parseYamlSimple(fs.readFileSync(legacyPath, "utf8"))), rejects: [], source: "config.yml" };
    } catch {
      process.stderr.write("[read-guild-config] WARN: could not read/parse .guild/config.yml — using defaults\n");
      return { config: {}, rejects: [], source: "none" };
    }
  }

  return { config: {}, rejects: [], source: "none" };
}

function scaffold(): string {
  // Omit the deprecated `defaults.agent_team` key from the scaffolded output.
  // The top-level `agent_mode: "auto"` already replaces it (D5). A freshly-
  // scaffolded settings.json must not contain a deprecated key — otherwise
  // every subsequent `loadFileConfig` call would fire the WARN on its own output.
  // Back-compat reading (warn-once + migrate auto→auto / on→team / off→subagent)
  // is preserved in loadFileConfig for EXISTING configs that still carry the key.
  const { agent_team: _omitDeprecated, ...scaffoldDefaults } = DEFAULTS.defaults;
  return JSON.stringify({ ...DEFAULTS, defaults: scaffoldDefaults, _help: HELP }, null, 2) + "\n";
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

  const { config: fileConfig, rejects, source } = loadFileConfig(cwd, selfBuild);

  if (mode === "validate") {
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
  }

  // resolve: built-in < file < flags  (CLI flag > settings.json > built-in per key)
  const resolved: GuildSettings = {
    ...DEFAULTS,
    ...fileConfig,
    ...flags,
    defaults: {
      ...DEFAULTS.defaults,
      ...(fileConfig.defaults ?? {}),
      // deep-merge defaults.index sub-block
      index: { ...DEFAULTS.defaults.index, ...((fileConfig.defaults as Partial<DefaultsBlock>)?.index ?? {}) },
    },
    // workspace is a nested object — deep-merge so partial overrides work
    workspace: { ...DEFAULTS.workspace, ...(fileConfig.workspace ?? {}), ...(flags.workspace ?? {}) },
    // models is a nested object — deep-merge so partial overrides work (ADR §10)
    models: { ...DEFAULTS.models, ...(fileConfig.models ?? {}), ...(flags.models ?? {}) },
    // security, secrets_policy, mcp — deep-merge so partial overrides work
    security: { ...DEFAULTS.security, ...(fileConfig.security ?? {}), ...(flags.security ?? {}) },
    secrets_policy: { ...DEFAULTS.secrets_policy, ...(fileConfig.secrets_policy ?? {}), ...(flags.secrets_policy ?? {}) },
    mcp: { ...DEFAULTS.mcp, ...(fileConfig.mcp ?? {}), ...(flags.mcp ?? {}) },
  };

  // Which rigor-expandable keys did the user set EXPLICITLY (CLI flag OR present in
  // settings.json)? An explicit value WINS over the rigor-derived value; rigor only
  // FILLS keys the user did not set (command-surface.md §4.3 "those override the
  // profile"). Note: an explicit `loops: null` is NOT a choice — null means "derive
  // from rigor" — so only a non-null loops string counts as explicit.
  let loopsExplicit = typeof flags.loops === "string" || typeof fileConfig.loops === "string";
  const loopCapExplicit = "loop_cap" in flags || "loop_cap" in fileConfig;
  const reviewExplicit = "review" in flags || "review" in fileConfig;

  // validate an explicit loops CSV; an invalid value reverts to "derive from rigor".
  if (resolved.loops) {
    for (const v of resolved.loops.split(",").map((s) => s.trim())) {
      if (!VALID_LOOPS.has(v)) {
        process.stderr.write(`[read-guild-config] WARN: unknown loops value "${v}"; treating as null (derive from rigor)\n`);
        resolved.loops = null;
        loopsExplicit = false;
        break;
      }
    }
  }

  // ── Expand --rigor into loops / loop_cap / review (§4.3). Explicitly-set keys are
  // recorded as overridden and left untouched; everything else is filled from the
  // profile. The expansion is ALWAYS surfaced via _rigor_expanded.
  const profile = rigorProfile(resolved.rigor);
  const applied: string[] = [];
  const overridden: string[] = [];

  // review: deep auto-implies cross, with a host-availability fallback to local (D7).
  let derivedReview = profile.review;
  let reviewFallback = false;
  let fallbackNote: string | undefined;
  if (resolved.rigor === "deep" && derivedReview === "cross" && !crossHostAvailable()) {
    derivedReview = "local";
    reviewFallback = true;
    fallbackNote =
      "rigor=deep implies review=cross, but the cross-host (Codex) is unavailable — " +
      "fell back to review=local with a weak-independence caveat (command-surface.md §4.3 / D7). Not a hard failure.";
  }

  // loops
  if (loopsExplicit) overridden.push("loops");
  else {
    resolved.loops = profile.loops;
    applied.push("loops");
  }
  // loop_cap (skip when the profile leaves it N/A — quick's "—")
  if (profile.loop_cap !== null) {
    if (loopCapExplicit) overridden.push("loop_cap");
    else {
      resolved.loop_cap = profile.loop_cap;
      applied.push("loop_cap");
    }
  }
  // review
  if (reviewExplicit) overridden.push("review");
  else {
    resolved.review = derivedReview;
    applied.push("review");
  }

  // _rigor_expanded — what rigor derived, ALWAYS emitted (§4.3 "the expansion is
  // always visible"). Shows the profile mapping plus which keys it actually applied
  // vs. which the user pinned explicitly.
  const rigorExpanded: Record<string, unknown> = {
    rigor: resolved.rigor,
    loops: profile.loops,
    loop_cap: profile.loop_cap, // null = N/A for quick
    review: derivedReview,
    applied, // keys filled from the profile
    overridden_by_explicit: overridden, // expandable keys the user set — profile skipped
  };
  if (resolved.rigor === "deep") rigorExpanded["review_implied"] = "cross";
  if (reviewFallback) {
    rigorExpanded["review_fallback"] = true;
    rigorExpanded["note"] = fallbackNote;
  }

  // Surface --model-tier CLI escape hatch in output (ADR §2, O-2). Top of tier precedence ladder.
  const output: Record<string, unknown> = { ...resolved, _rigor_expanded: rigorExpanded };
  if (modelTier !== undefined) {
    output["_model_tier_override"] = {
      tier: modelTier,
      source: "--model-tier CLI flag",
      note: "Top of tier precedence ladder: --model-tier > per-lane override > models.thresholds > built-in",
    };
  }

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

main();

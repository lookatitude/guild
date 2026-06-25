#!/usr/bin/env npx tsx
/**
 * docs-hygiene/docs-code-audit.ts
 *
 * G-AUDIT — Semantic docs↔code reconciliation audit for plugin-docs-code-reconciliation
 * (Phase 1, read-only discovery).
 *
 * Mechanically surfaces drift candidates across four check domains:
 *
 *   1. CONFIG KEYS — Every key/default/type asserted in docs/knowledge + commands/config.md
 *      vs the shipped closed-key set + defaults in plugin/scripts/read-guild-config.ts.
 *      Flags: key documented-but-absent, key present-but-undocumented, default/type mismatch.
 *
 *   2. COMMANDS / SUBCOMMANDS — Command + subcommand names in docs vs the shipped surface
 *      (plugin/commands/*.md filenames + plugin/scripts/config-cmd.ts accepted subcommands).
 *      Flags: documented-but-unwired, wired-but-undocumented.
 *
 *   3. CLI FLAGS / ENV VARS — Flags and GUILD_* env vars referenced in docs vs what
 *      plugin/scripts/read-guild-config.ts actually parses + what scripts/hooks read.
 *      Flags: documented-but-not-parsed, parsed-but-undocumented.
 *
 *   4. COUNTS — "N skills / N commands / N agents / N hooks / N specialists" assertions
 *      in docs vs the real plugin tree.
 *      Flags: number mismatch between docs claim and actual count.
 *
 * Output: two files in the initiative's audit/ directory
 *   - audit/candidates.json    (machine-readable, matches ledger schema)
 *   - audit/candidates-summary.md (human-readable markdown table)
 *
 * Usage:
 *   npx tsx plugin/scripts/docs-hygiene/docs-code-audit.ts [--workspace=/path/to/guild]
 *   npx tsx plugin/scripts/docs-hygiene/docs-code-audit.ts --output=/custom/path/candidates.json
 *
 * The --workspace flag defaults to three levels above this script (guild repo root).
 * This script is READ-ONLY — it never modifies any plugin code or docs.
 * Re-runnable and deterministic given the same source tree.
 *
 * Candidates are FLAGGED, not adjudicated — each needs human/research verification
 * before Phase 2 reconciliation. See briefing.md for the OD-1 direction gate.
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config + paths
// ---------------------------------------------------------------------------

const cliArgs = process.argv.slice(2);
const workspaceArg = cliArgs.find((a) => a.startsWith("--workspace="));
// docs-hygiene/ → scripts/ → plugin/ → workspace root (three levels up)
const WORKSPACE = workspaceArg
  ? workspaceArg.split("=")[1]
  : path.resolve(__dirname, "../../..");

const DOCS_KNOWLEDGE = path.join(WORKSPACE, "docs/knowledge");
const PLUGIN_COMMANDS = path.join(WORKSPACE, "plugin/commands");
const PLUGIN_SKILLS = path.join(WORKSPACE, "plugin/skills");
const PLUGIN_AGENTS = path.join(WORKSPACE, "plugin/agents");
const PLUGIN_HOOKS = path.join(WORKSPACE, "plugin/hooks/hooks.json");
const PLUGIN_SCRIPTS = path.join(WORKSPACE, "plugin/scripts");
const READ_CONFIG_TS = path.join(PLUGIN_SCRIPTS, "read-guild-config.ts");
const CONFIG_CMD_TS = path.join(PLUGIN_SCRIPTS, "config-cmd.ts");
const PLUGIN_CLAUDE_MD = path.join(WORKSPACE, "plugin/CLAUDE.md");

const outputArg = cliArgs.find((a) => a.startsWith("--output="));
const AUDIT_DIR = path.join(
  WORKSPACE,
  ".guild/initiatives/active/plugin-docs-code-reconciliation/audit"
);
const OUTPUT_JSON = outputArg
  ? path.resolve(outputArg.split("=")[1])
  : path.join(AUDIT_DIR, "candidates.json");
const OUTPUT_MD = OUTPUT_JSON.replace(/\.json$/, "-summary.md");

// ---------------------------------------------------------------------------
// Types — candidate schema (aligns with reconciliation-ledger-schema.md v1.0)
// ---------------------------------------------------------------------------

type CandidateKind =
  | "config-key-absent-in-code"
  | "config-key-absent-in-docs"
  | "config-default-mismatch"
  | "config-type-mismatch"
  | "command-unwired"
  | "command-undocumented"
  | "subcommand-unwired"
  | "subcommand-undocumented"
  | "flag-undocumented"
  | "env-var-undocumented"
  | "env-var-absent-in-code"
  | "count-mismatch";

// Closed vocabularies from reconciliation-ledger-schema.md §"Controlled vocabularies"
type LedgerSurface =
  | "config-key" | "command" | "flag" | "env" | "count"
  | "behavior" | "roster" | "tier" | "group" | "skill" | "hook" | "path";

type LedgerDriftType =
  | "docs-overclaim" | "docs-stale" | "code-incomplete" | "half-shipped" | "source-vs-source";

type LedgerDirection = "fix-code" | "fix-docs" | "wire-up" | "needs-decision";

type LedgerAuthoritativeSide = "code" | "docs" | "neither" | "both-partial";

type Confidence = "high" | "medium" | "low";

interface Candidate {
  /** Internal scanner id (e.g. "cfg-001") — ledger promotes to R-NNN at verification */
  id: string;
  kind: CandidateKind;
  // ── ledger closed-vocab fields (schema §"Controlled vocabularies") ──────────
  surface: LedgerSurface;
  drift_type: LedgerDriftType;
  recommended_direction: LedgerDirection;
  authoritative_side: LedgerAuthoritativeSide;
  // ── citation fields ─────────────────────────────────────────────────────────
  /** "relative/path/to/file.md:lineNo" — doc side */
  doc_ref: string;
  /** "relative/path/to/file.ts:lineNo" — must be executable source, never .md */
  code_ref: string;
  /** Verbatim doc-side claim (for ledger doc_claim column) */
  doc_claim: string;
  /** Code-side reality (for ledger code_truth column) */
  code_reality: string;
  confidence: Confidence;
  /** Extra context for researcher/operator */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function relPath(p: string): string {
  return p.startsWith(WORKSPACE + "/")
    ? p.slice(WORKSPACE.length + 1)
    : p.startsWith(WORKSPACE)
    ? p.slice(WORKSPACE.length)
    : p;
}

function readFile(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function walkFiles(dir: string, filter = /\.md$/): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, filter));
    } else if (entry.isFile() && filter.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/** Find the 1-based line number where `text` appears in `content`. Returns "?" if not found. */
function findLineNo(content: string, text: string): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(text)) return String(i + 1);
  }
  return "?";
}

/** Find all line numbers where `pattern` matches in `content`. Returns [] if none. */
function findLineNos(content: string, pattern: RegExp): Array<{ line: string; lineNo: number }> {
  const lines = content.split("\n");
  const results: Array<{ line: string; lineNo: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      results.push({ line: lines[i].trim(), lineNo: i + 1 });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Real shipped surface (code-side ground truth)
// ---------------------------------------------------------------------------

/**
 * Extract the full closed-key set from read-guild-config.ts by text-parsing
 * the DEFAULTS constant and the VALID_* sets. Stdlib-only, no dynamic import.
 */
function extractShippedConfigKeys(src: string): {
  tier1Keys: Set<string>;
  defaultsKeys: Set<string>;
  modelsKeys: Set<string>;
  securityKeys: Set<string>;
  secretsPolicyKeys: Set<string>;
  mcpKeys: Set<string>;
  indexKeys: Set<string>;
  crossHostKeys: Set<string>;
  workspaceKeys: Set<string>;
} {
  // Tier-1 keys extracted from the TIER1 Set literal in loadFileConfig
  const tier1Match = src.match(/const TIER1\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  const tier1Keys = new Set<string>();
  if (tier1Match) {
    for (const m of tier1Match[1].matchAll(/"([^"]+)"/g)) tier1Keys.add(m[1]);
  }

  // Extract named VALID_*_KEYS sets
  function extractSet(name: string): Set<string> {
    const re = new RegExp(`const ${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`, "m");
    const m = src.match(re);
    if (!m) return new Set<string>();
    const s = new Set<string>();
    for (const mm of m[1].matchAll(/"([^"]+)"/g)) s.add(mm[1]);
    return s;
  }

  return {
    tier1Keys,
    defaultsKeys: extractSet("DEFAULTS_ALLOWED_KEYS"),
    modelsKeys: extractSet("VALID_MODELS_KEYS"),
    securityKeys: extractSet("VALID_SECURITY_KEYS"),
    secretsPolicyKeys: extractSet("VALID_SECRETS_POLICY_KEYS"),
    mcpKeys: extractSet("VALID_MCP_KEYS"),
    indexKeys: extractSet("VALID_INDEX_KEYS"),
    crossHostKeys: new Set(["enabled", "hosts"]),
    workspaceKeys: new Set(["mode"]),
  };
}

/** Extract defaults values from the DEFAULTS constant for type/default checks. */
function extractDefaultValues(src: string): Map<string, string> {
  const defaults = new Map<string, string>();
  // Parse the DEFAULTS object for simple scalar assignments.
  // Pattern: key: "value", or key: true/false/number
  const kvRe = /^\s{2}(\w+):\s*(.+?),?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = kvRe.exec(src)) !== null) {
    const key = m[1];
    const val = m[2].trim().replace(/,$/, "");
    defaults.set(key, val);
  }
  return defaults;
}

/** Get the list of shipped command names from plugin/commands/*.md filenames */
function getShippedCommands(): Set<string> {
  if (!fs.existsSync(PLUGIN_COMMANDS)) return new Set();
  return new Set(
    fs.readdirSync(PLUGIN_COMMANDS)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
  );
}

/** Get config-cmd.ts accepted subcommands by parsing the source */
function getShippedConfigSubcommands(src: string): Set<string> {
  const subs = new Set<string>();
  // Matches: sub !== "set" && sub !== "show" && sub !== "validate" && sub !== "providers"
  for (const m of src.matchAll(/"(set|show|validate|providers|update-mcp-hashes|detect|init)"/g)) {
    subs.add(m[1]);
  }
  // Refine: only subcommands from the parseArgs subcommand check
  const subMatch = src.match(/sub !== "set" && sub !== "show" && sub !== "validate" && sub !== "providers"/);
  if (subMatch) {
    return new Set(["set", "show", "validate", "providers"]);
  }
  return subs;
}

/** Get all GUILD_* env vars read in scripts/ and hooks/ */
function getShippedEnvVars(): Set<string> {
  const vars = new Set<string>();
  const guildRe = /\bGUILD_[A-Z_]+\b/g;

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== "node_modules" && e.name !== "__tests__") {
        scanDir(full);
      } else if (e.isFile() && /\.(ts|js|sh)$/.test(e.name)) {
        const src = readFile(full);
        for (const m of src.matchAll(guildRe)) vars.add(m[0]);
      } else if (e.isFile() && !e.name.includes(".")) {
        // Shell scripts without extension (e.g. .githooks/pre-push, .githooks/pre-commit)
        const src = readFile(full);
        if (src.startsWith("#!/")) { // only scan files with a shebang
          for (const m of src.matchAll(guildRe)) vars.add(m[0]);
        }
      }
    }
  }

  scanDir(PLUGIN_SCRIPTS);
  // hooks/: Claude Code native hooks (hooks.json runners, hook scripts)
  const hooksDir = path.join(WORKSPACE, "plugin/hooks");
  scanDir(hooksDir);
  // .githooks/: git lifecycle hooks (pre-push etc.) — may reference GUILD_* env vars
  // e.g. GUILD_ALLOW_PUSH_MAIN in plugin/.githooks/pre-push
  const githooksDir = path.join(WORKSPACE, "plugin/.githooks");
  scanDir(githooksDir);
  return vars;
}

/** Get CLI flags parsed by read-guild-config.ts parseArgs */
function getShippedCLIFlags(src: string): Set<string> {
  const flags = new Set<string>();
  for (const m of src.matchAll(/arg\s*===\s*"(--[a-z][a-z-=]*)"|arg\.startsWith\("(--[a-z][a-z-=]*)"\)/g)) {
    const flag = (m[1] || m[2]).replace(/=$/, "");
    flags.add(flag);
  }
  return flags;
}

/** Count real hooks from hooks.json */
function countHooks(): number {
  try {
    const d = JSON.parse(readFile(PLUGIN_HOOKS));
    const hooks = d.hooks;
    if (Array.isArray(hooks)) return hooks.length;
    if (typeof hooks === "object" && hooks !== null) return Object.keys(hooks).length;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Count skills by finding all SKILL.md files under plugin/skills/ at any depth.
 * Handles both the 2-level layout (tier/skill-name/SKILL.md) AND top-level tier
 * skills (guild-operations/SKILL.md, guild-quality/SKILL.md) that sit directly
 * under a tier dir with no skill subdir. Uses walkFiles() so no tier list is
 * hard-coded — new tiers are picked up automatically.
 */
function countSkills(): number {
  if (!fs.existsSync(PLUGIN_SKILLS)) return 0;
  return walkFiles(PLUGIN_SKILLS, /^SKILL\.md$/).length;
}

/** Count all agent files from plugin/agents/ (includes augmenting roles). */
function countAgents(): number {
  if (!fs.existsSync(PLUGIN_AGENTS)) return 0;
  return fs.readdirSync(PLUGIN_AGENTS).filter((f) => f.endsWith(".md")).length;
}

/**
 * Count SHIPPING specialists only — excludes augmenting / dev-team roles that
 * are not part of the 14-specialist roster (advisor, developer, doc-writer).
 * Use this for "N specialists" / "N subagents" comparisons in docs.
 * (Total agent files = 17; augmenting roles = 3; shipping specialists = 14.)
 */
const AUGMENTING_AGENT_FILES = new Set(["advisor.md", "developer.md", "doc-writer.md"]);
function countShippingSpecialists(): number {
  if (!fs.existsSync(PLUGIN_AGENTS)) return 0;
  return fs.readdirSync(PLUGIN_AGENTS).filter(
    (f) => f.endsWith(".md") && !AUGMENTING_AGENT_FILES.has(f)
  ).length;
}

/** Count command files from plugin/commands/ */
function countCommands(): number {
  if (!fs.existsSync(PLUGIN_COMMANDS)) return 0;
  return fs.readdirSync(PLUGIN_COMMANDS).filter((f) => f.endsWith(".md")).length;
}

// ---------------------------------------------------------------------------
// Doc corpus assembly
// ---------------------------------------------------------------------------

/** Build the corpus: docs/knowledge (all .md) + plugin/commands/*.md + plugin/CLAUDE.md */
function buildCorpus(): string[] {
  const docsKnowledge = walkFiles(DOCS_KNOWLEDGE);
  const commandsDocs = walkFiles(PLUGIN_COMMANDS);
  const extra: string[] = [];
  if (fs.existsSync(PLUGIN_CLAUDE_MD)) extra.push(PLUGIN_CLAUDE_MD);
  return [...docsKnowledge, ...commandsDocs, ...extra];
}

// ---------------------------------------------------------------------------
// Check 1: Config Keys
// ---------------------------------------------------------------------------

/** All dotted key paths mentioned in docs (best-effort extraction) */
function extractDocConfigKeyRefs(
  corpus: string[]
): Array<{ key: string; file: string; lineNo: number; line: string }> {
  const refs: Array<{ key: string; file: string; lineNo: number; line: string }> = [];

  // Patterns that plausibly indicate a config key reference (not just any word):
  //  - `key` (backtick-quoted, short enough to be a key)
  //  - "key" in code blocks listing config keys
  //  - key: value  (YAML-style in docs)
  //  - settings.json key callouts like `defaults.auto_learn`

  const keyPatterns: RegExp[] = [
    // dotted key paths in backticks: `defaults.auto_learn`, `models.enabled`
    /`((?:defaults|models|security|secrets_policy|mcp|workspace)\.[a-zA-Z_.]+)`/g,
    // top-level keys in backticks: `rigor`, `agent_mode`, `review`, etc.
    /`(rigor|auto_approve|review|host|initiative_default|index|record_status_runs|codex_skip_enforcement|agent_mode|loops|loop_cap|codex_cap)`/g,
    // bare key= patterns in code blocks: defaults.auto_learn =
    /\b((?:defaults|models|security|secrets_policy|mcp|workspace)\.[a-zA-Z_.]+)\s*[:=]/g,
    // review.adversarial.provider (undocumented half-shipped feature)
    /\b(review\.adversarial\.[a-zA-Z_.]+)\b/g,
  ];

  for (const fpath of corpus) {
    const rel = relPath(fpath);
    // Skip research/ideation — not canonical claims
    if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
    const content = readFile(fpath);
    const lines = content.split("\n");

    for (const pattern of keyPatterns) {
      const pat = new RegExp(pattern.source, "g");
      for (let i = 0; i < lines.length; i++) {
        let m: RegExpExecArray | null;
        while ((m = pat.exec(lines[i])) !== null) {
          refs.push({ key: m[1], file: rel, lineNo: i + 1, line: lines[i].trim() });
        }
      }
    }
  }

  return refs;
}

function runConfigKeyAudit(
  corpus: string[],
  readConfigSrc: string,
  idCounter: Counter
): Candidate[] {
  const candidates: Candidate[] = [];

  const shipped = extractShippedConfigKeys(readConfigSrc);
  // Build the full shipped dotted-key set
  const shippedKeySet = new Set<string>([
    ...shipped.tier1Keys,
    ...[...shipped.defaultsKeys].map((k) => `defaults.${k}`),
    ...[...shipped.modelsKeys].map((k) => `models.${k}`),
    ...[...shipped.securityKeys].map((k) => `security.${k}`),
    ...[...shipped.secretsPolicyKeys].map((k) => `secrets_policy.${k}`),
    ...[...shipped.mcpKeys].map((k) => `mcp.${k}`),
    ...[...shipped.indexKeys].map((k) => `defaults.index.${k}`),
    ...[...shipped.crossHostKeys].map((k) => `defaults.cross_host.${k}`),
    ...[...shipped.workspaceKeys].map((k) => `workspace.${k}`),
    // models sub-keys
    "models.tiers.cheap", "models.tiers.mid", "models.tiers.powerful",
    "models.thresholds.mid", "models.thresholds.powerful",
    "models.cacheTTL.coordinator", "models.cacheTTL.leaf",
    // defaults sub-keys
    "defaults.team.size", "defaults.team.always_include",
    "defaults.gates.auto_approve",
    "defaults.wiki.share_mode", "defaults.wiki.autopromote",
    "defaults.quality.budget.per_class_minutes", "defaults.quality.budget.total_minutes",
  ]);

  const docRefs = extractDocConfigKeyRefs(corpus);

  // Deduplicate by key so we flag each key once, with a representative doc_ref
  const seenKeys = new Map<string, { file: string; lineNo: number; line: string }>();
  for (const ref of docRefs) {
    if (!seenKeys.has(ref.key)) seenKeys.set(ref.key, ref);
  }

  // Known half-shipped / intentionally-missing keys (from briefing OD-2):
  const halfShippedKeys = new Set([
    "review.adversarial.provider", // OD-2: not a real shipped key path
  ]);

  // Flag: key documented in docs but not in shipped code
  for (const [key, ref] of seenKeys.entries()) {
    if (halfShippedKeys.has(key)) {
      const notes = "OD-2: review.adversarial.provider — implement in read-guild-config.ts";
      const ledger = deriveLedgerFields("config-key-absent-in-code", notes);
      candidates.push({
        id: idCounter.next("cfg"),
        kind: "config-key-absent-in-code",
        ...ledger,
        doc_ref: `${ref.file}:${ref.lineNo}`,
        code_ref: `plugin/scripts/read-guild-config.ts:DEFAULTS (no such key)`,
        doc_claim: `"${key}" referenced as a config key — excerpt: "${ref.line.slice(0, 80)}"`,
        code_reality: `"${key}" absent from DEFAULTS + VALID_* sets (half-shipped per OD-2)`,
        confidence: "high",
        notes,
      });
    } else if (!shippedKeySet.has(key)) {
      const notes = "May be a prose mention, a removed key, or a planned-but-absent key — researcher to verify";
      const ledger = deriveLedgerFields("config-key-absent-in-code", notes);
      candidates.push({
        id: idCounter.next("cfg"),
        kind: "config-key-absent-in-code",
        ...ledger,
        doc_ref: `${ref.file}:${ref.lineNo}`,
        code_ref: `plugin/scripts/read-guild-config.ts:DEFAULTS (no such key)`,
        doc_claim: `"${key}" referenced as a config key — excerpt: "${ref.line.slice(0, 80)}"`,
        code_reality: `"${key}" NOT found in shipped DEFAULTS + VALID_* sets`,
        confidence: "medium",
        notes,
      });
    }
  }

  // Flag: shipped keys with no matching doc reference
  // Only flag tier-1 and first-level defaults.* — deep sub-keys are too noisy
  const KEYS_TO_CHECK_FOR_DOC_COVERAGE = new Set([
    "rigor", "auto_approve", "review", "host", "initiative_default", "index",
    "record_status_runs", "codex_skip_enforcement", "agent_mode", "workspace", "models",
    "security", "secrets_policy", "mcp", "loops", "loop_cap", "codex_cap", "defaults",
    "defaults.auto_learn", "defaults.adversarial", "defaults.team", "defaults.review_workflow",
    "defaults.skill_policy", "defaults.gates", "defaults.wiki", "defaults.quality",
    "defaults.reporting", "defaults.index", "defaults.cross_host",
    "models.enabled", "models.tiers", "models.scoreWeights", "models.thresholds",
    "models.advisorRounds", "models.escalationMarkers", "models.recallBeforeRead",
    "models.recallScoreThreshold", "models.structuredOutputRequired", "models.cacheTTL",
    "models.importanceGate", "models.ingestSimilarityGate", "models.shortOutputThreshold",
    "security.bypass_permissions_policy",
    "secrets_policy.env_allowlist", "secrets_policy.redaction_patterns",
    "secrets_policy.fail_mode_durable", "secrets_policy.fail_mode_telemetry",
    "mcp.tool_description_hashes",
  ]);

  const docKeySet = new Set([...seenKeys.keys()]);
  for (const key of KEYS_TO_CHECK_FOR_DOC_COVERAGE) {
    if (!docKeySet.has(key) && !docKeySet.has(key.split(".").pop()!)) {
      // Low confidence: many keys are intentionally undocumented in canonical docs
      // (only surfaced in scaffold/HELP). Don't over-flag.
      // Focus on keys explicitly called out as half-shipped:
      if (key === "models.enabled") {
        const notes = "OD-2: models.enabled — scorer gate not yet wired; both docs and code need update";
        const ledger = deriveLedgerFields("config-key-absent-in-docs", notes);
        candidates.push({
          id: idCounter.next("cfg"),
          kind: "config-key-absent-in-docs",
          ...ledger,
          doc_ref: `plugin/commands/config.md:?`,
          code_ref: `plugin/scripts/read-guild-config.ts:${findLineNo(readConfigSrc, '"enabled"')} (key parsed but scorer ignores it)`,
          doc_claim: `models.enabled not documented as a live scorer gate; scorer gate path unimplemented`,
          code_reality: `models.enabled parsed (default: true) but scorer consumer does not gate on it (half-shipped)`,
          confidence: "high",
          notes,
        });
      }
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Check 2: Commands / Subcommands
// ---------------------------------------------------------------------------

function runCommandAudit(
  corpus: string[],
  shippedCommands: Set<string>,
  configCmdSrc: string,
  idCounter: Counter
): Candidate[] {
  const candidates: Candidate[] = [];

  // Collect all /guild:* command mentions in docs
  const mentionedCommands = new Map<string, { file: string; lineNo: number }>();
  const commandRe = /\/guild:([a-z][a-z-]*)/g;

  for (const fpath of corpus) {
    const rel = relPath(fpath);
    if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
    const content = readFile(fpath);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      let m: RegExpExecArray | null;
      const pat = new RegExp(commandRe.source, "g");
      while ((m = pat.exec(lines[i])) !== null) {
        const cmd = m[1];
        if (!mentionedCommands.has(cmd)) {
          mentionedCommands.set(cmd, { file: rel, lineNo: i + 1 });
        }
      }
    }
  }

  // Flag: docs mention a command that has no commands/*.md file
  for (const [cmd, ref] of mentionedCommands) {
    if (!shippedCommands.has(cmd)) {
      const notes = "May be a v1 command reference (MIGRATION.md) or placeholder; researcher to verify intent";
      const kind: CandidateKind = "command-unwired";
      const ledger = deriveLedgerFields(kind, notes);
      candidates.push({
        id: idCounter.next("cmd"),
        kind,
        ...ledger,
        // commands in MIGRATION.md documenting v1 removals are docs-stale not half-shipped
        drift_type: ref.file.includes("MIGRATION") ? "docs-stale" as LedgerDriftType : ledger.drift_type,
        recommended_direction: ref.file.includes("MIGRATION") ? "fix-docs" as LedgerDirection : ledger.recommended_direction,
        doc_ref: `${ref.file}:${ref.lineNo}`,
        code_ref: `plugin/commands/ (no ${cmd}.md)`,
        doc_claim: `"/guild:${cmd}" referenced in docs`,
        code_reality: `plugin/commands/${cmd}.md does NOT exist in shipped surface`,
        confidence: "medium",
        notes,
      });
    }
  }

  // Flag: shipped command file has no mention in any doc
  for (const cmd of shippedCommands) {
    if (!mentionedCommands.has(cmd)) {
      const notes = "Many commands are referenced via lifecycle/architecture docs; low confidence — researcher to confirm absence";
      const kind: CandidateKind = "command-undocumented";
      const ledger = deriveLedgerFields(kind, notes);
      candidates.push({
        id: idCounter.next("cmd"),
        kind,
        ...ledger,
        doc_ref: `docs/knowledge:? (no reference found)`,
        code_ref: `plugin/commands/${cmd}.md:1 (file exists)`,
        doc_claim: `no docs/knowledge canonical mention of /guild:${cmd}`,
        code_reality: `plugin/commands/${cmd}.md exists in shipped command surface`,
        confidence: "low",
        notes,
      });
    }
  }

  // Subcommand audit for /guild:config
  // Shipped subcommands from config-cmd.ts
  const shippedSubs = new Set(["set", "show", "validate", "providers", "init"]);
  // providers detect: the sub-verb
  shippedSubs.add("detect"); // sub-verb of providers

  // Documented-but-absent: update-mcp-hashes (explicitly called out in OD-2 briefing)
  const halfShippedSubs = ["update-mcp-hashes"];
  for (const sub of halfShippedSubs) {
    // Check if any doc mentions it
    const refs: Array<{ file: string; lineNo: number }> = [];
    for (const fpath of corpus) {
      const rel = relPath(fpath);
      if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
      const content = readFile(fpath);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(sub)) refs.push({ file: rel, lineNo: i + 1 });
      }
    }
    const docRef = refs.length > 0
      ? `${refs[0].file}:${refs[0].lineNo}`
      : `docs/knowledge:?`;

    const notes = `OD-2: /guild:config ${sub} — wire the MCP hash-update subcommand in config-cmd.ts`;
    const kind: CandidateKind = "subcommand-unwired";
    const ledger = deriveLedgerFields(kind, notes);
    candidates.push({
      id: idCounter.next("cmd"),
      kind,
      ...ledger,
      doc_ref: docRef,
      code_ref: `plugin/scripts/config-cmd.ts:670 (parseArgs — subcommands: set|show|validate|providers only)`,
      doc_claim: `"${sub}" referenced as a /guild:config subcommand in docs/ADR`,
      code_reality: `config-cmd.ts parseArgs accepts only set|show|validate|providers — "${sub}" absent`,
      confidence: "high",
      notes,
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Check 3: CLI flags + Env vars
// ---------------------------------------------------------------------------

function runFlagEnvAudit(
  corpus: string[],
  readConfigSrc: string,
  shippedEnvVars: Set<string>,
  idCounter: Counter
): Candidate[] {
  const candidates: Candidate[] = [];

  // Shipped CLI flags from read-guild-config.ts parseArgs
  const shippedFlags = getShippedCLIFlags(readConfigSrc);

  // Collect docs mentions of --flag patterns
  const mentionedFlags = new Map<string, { file: string; lineNo: number; line: string }>();
  const flagRe = /--(statusline|[a-z][a-z-]+=?)/g;

  for (const fpath of corpus) {
    const rel = relPath(fpath);
    if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
    const content = readFile(fpath);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      let m: RegExpExecArray | null;
      const pat = new RegExp(flagRe.source, "g");
      while ((m = pat.exec(lines[i])) !== null) {
        const flag = `--${m[1]}`.replace(/=$/, "");
        if (flag.length > 3 && !mentionedFlags.has(flag)) {
          mentionedFlags.set(flag, { file: rel, lineNo: i + 1, line: lines[i].trim() });
        }
      }
    }
  }

  // Half-shipped flags (OD-2): --statusline and GUILD_STATUSLINE
  const halfShippedFlags = new Set(["--statusline"]);

  for (const [flag, ref] of mentionedFlags) {
    if (halfShippedFlags.has(flag)) {
      const notes = "OD-2: --statusline / GUILD_STATUSLINE — wire the runner/parser enable path";
      const kind: CandidateKind = "flag-undocumented";
      const ledger = deriveLedgerFields(kind, notes);
      candidates.push({
        id: idCounter.next("flg"),
        kind,
        ...ledger,
        doc_ref: `${ref.file}:${ref.lineNo}`,
        code_ref: `plugin/scripts/read-guild-config.ts:508-544 (parseArgs — no --statusline branch)`,
        doc_claim: `"${flag}" referenced as a CLI flag — context: "${ref.line.slice(0, 80)}"`,
        code_reality: `"${flag}" absent from read-guild-config.ts parseArgs; statusline-guild.sh does not read GUILD_STATUSLINE`,
        confidence: "high",
        notes,
      });
    }
    // Only flag --statusline as the explicit OD-2 half-shipped item.
    // Other flags may be commands-level and not in read-guild-config.ts.
  }

  // Env var audit: docs mentions of GUILD_* vars
  const mentionedEnvVars = new Map<string, { file: string; lineNo: number }>();
  const envRe = /\bGUILD_[A-Z_]+\b/g;

  for (const fpath of corpus) {
    const rel = relPath(fpath);
    if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
    const content = readFile(fpath);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      let m: RegExpExecArray | null;
      const pat = new RegExp(envRe.source, "g");
      while ((m = pat.exec(lines[i])) !== null) {
        const envVar = m[0];
        if (!mentionedEnvVars.has(envVar)) {
          mentionedEnvVars.set(envVar, { file: rel, lineNo: i + 1 });
        }
      }
    }
  }

  // Flag: env vars in docs but not in code (absent in code = potentially half-shipped)
  const halfShippedEnv = new Set(["GUILD_STATUSLINE"]);
  for (const [envVar, ref] of mentionedEnvVars) {
    if (!shippedEnvVars.has(envVar)) {
      const isHalfShipped = halfShippedEnv.has(envVar);
      const notes = isHalfShipped
        ? `OD-2: ${envVar} — wire the statusline enable path`
        : "May be a conceptual mention or docs-only description; researcher to verify";
      const kind: CandidateKind = "env-var-absent-in-code";
      const ledger = deriveLedgerFields(kind, notes);
      candidates.push({
        id: idCounter.next("env"),
        kind,
        ...ledger,
        doc_ref: `${ref.file}:${ref.lineNo}`,
        code_ref: isHalfShipped
          ? `plugin/scripts/statusline-guild.sh:1 (does not read ${envVar})`
          : `plugin/scripts + hooks (grep: no match)`,
        doc_claim: `"${envVar}" referenced as an env var in docs`,
        code_reality: `"${envVar}" not found in plugin/scripts/**/*.ts or hooks/**/*.ts or hooks/**/*.sh`,
        confidence: isHalfShipped ? "high" : "medium",
        notes,
      });
    }
  }

  // Flag: env vars in code but never mentioned in any canonical doc
  // (high noise — only flag the known half-shipped items)
  // GUILD_STATUSLINE is absent from code but mentioned in docs — already flagged above.

  return candidates;
}

// ---------------------------------------------------------------------------
// Check 4: Count assertions
// ---------------------------------------------------------------------------

interface CountClaim {
  number: number;
  thing: string;
  file: string;
  lineNo: number;
  line: string;
}

/**
 * Returns true only when a count mention is plausibly a TOTAL roster assertion,
 * not a local / per-task / subset count.
 *
 * Three gates — ALL three must pass:
 *
 *   A. The digit is not immediately preceded by an alphanumeric or identifier
 *      character (-, ., #, §, or any letter a-z A-Z, or digit) that would make it
 *      part of a label or version string (e.g. "v1 commands" → `v` before `1`,
 *      "D-14 command" → `-` before `14`, "§8 skills" → `§` before `8`).
 *
 *   B. Either the line contains a TOTAL-SIGNAL word (present-tense verb or quantifier
 *      that signals the whole roster, not a subset), OR the count meets a
 *      per-type minimum threshold above which subset counts are implausible.
 *      NOTE: "shipped" (past participle) is intentionally excluded — it commonly
 *      modifies a subset noun ("the shipped spine's 8 skills") and is too broad.
 *      Use "ships" (present-tense) or explicit "total" instead.
 *
 *   C. The matched noun-word is not used as an adjective modifying a following noun
 *      (e.g. "4 specialist skills" → "specialist" is an adjective here, not a count).
 *
 * Threshold rationale:
 *   specialists/agents/subagents — per-team size is 3-6; total roster is 17 → threshold 10
 *   skills — subsets are typically 1-10; total is 102 → threshold 50
 *   commands — subsets (phase verbs etc.) are 6-8; total is 19 → threshold 15
 *   hooks — nobody says "N hook events" to mean a subset → threshold 1 (any count flags)
 */
function isTotalAssertion(
  line: string,
  matchIndex: number,
  matchLength: number,
  thing: string,
  count: number
): boolean {
  // Gate A: reject if the digit is immediately preceded by any alphanumeric,
  // identifier, or punctuation character that makes it part of a compound token.
  // (Catches v1, v2, D-14, P6, R-001, §8, #14, oc-14, T1-6, etc.)
  if (matchIndex > 0) {
    const charBefore = line[matchIndex - 1];
    if (/[-#§.A-Za-z0-9]/.test(charBefore)) return false;
  }

  // Gate D: reject if the line is a comparative/self-aware statement about a discrepancy,
  // not a live canonical claim. These lines document drift rather than asserting a count.
  // Examples: "14 agents declared vs 17 on disk", "14 vs 17 specialists count inconsistency".
  const COMPARATIVE_PATTERNS = /\b(declared\s+vs|vs\s+\d|on\s+disk\b|\bvs\s+[a-z]|\binconsistency\b|\bdiscrepancy\b|vs\s+stale\b)/i;
  if (COMPARATIVE_PATTERNS.test(line)) return false;

  // Gate C: reject if the matched noun is used as an adjective modifying the next word.
  // E.g. "4 specialist skills" — "specialist" is adjectival (followed by "skills").
  // Check the two characters immediately after the full match.
  const afterMatch = line.slice(matchIndex + matchLength).trimStart();
  if (/^(skills?|agents?|commands?|hooks?|tiers?|groups?|teams?)\b/i.test(afterMatch)) {
    return false;
  }

  // Gate B-1: total-signal words anywhere on the same line.
  // "ships" (present-tense) signals the whole product ships these things.
  // "shipped" (past participle) is intentionally excluded — too often modifies a subset noun.
  const TOTAL_SIGNALS =
    /\b(total|across all|roster|ships\b|taxonomy|exactly|comprising|consist|the full set|shipping)\b/i;
  if (TOTAL_SIGNALS.test(line)) return true;

  // Gate B-2: per-type minimum threshold
  const THRESHOLDS: Record<string, number> = {
    specialist: 10,
    subagent:   10,
    agent:      10,
    skill:      50,
    command:    15,
    hook:        1,
  };
  const threshold = THRESHOLDS[thing] ?? 10;
  return count >= threshold;
}

function extractCountClaims(corpus: string[]): CountClaim[] {
  const claims: CountClaim[] = [];

  // Match "N things" where N is 1-3 digits.
  // We apply isTotalAssertion() on each match to filter subset/identifier false-positives.
  const countRe = /(\d{1,3})\s+(skills?|commands?|agents?|hooks?|specialists?|subagents?)\b/gi;

  for (const fpath of corpus) {
    const rel = relPath(fpath);
    if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
    // Exclude docs/knowledge/audits/ — these are dated snapshot reports, not live
    // canonical claims. Their counts reflect the tree at the audit date and will
    // always lag the current state; flagging them generates chronic noise.
    if (rel.includes("knowledge/audits/")) continue;
    const content = readFile(fpath);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const pat = new RegExp(countRe.source, "gi");
      let m: RegExpExecArray | null;
      while ((m = pat.exec(lines[i])) !== null) {
        const n = parseInt(m[1], 10);
        const thing = m[2].toLowerCase().replace(/s$/, ""); // normalize to singular
        const matchIndex = m.index;
        const matchLength = m[0].length;
        if (!isTotalAssertion(lines[i], matchIndex, matchLength, thing, n)) continue;
        claims.push({
          number: n,
          thing,
          file: rel,
          lineNo: i + 1,
          line: lines[i].trim().slice(0, 120),
        });
      }
    }
  }

  return claims;
}

function runCountAudit(
  corpus: string[],
  idCounter: Counter
): Candidate[] {
  const candidates: Candidate[] = [];

  // Real counts
  // NOTE: "specialists"/"subagents" compare against the SHIPPING roster (14),
  // not the full agent file count (17). Augmenting roles (advisor, developer, doc-writer)
  // are real .md files but not counted in the "14 shipping specialists" roster claim.
  // "agents" uses the full file count since docs may say "N agent files".
  const shippingSpecialists = countShippingSpecialists();
  const allAgents = countAgents();
  const realCounts: Record<string, number> = {
    skill: countSkills(),
    command: countCommands(),
    agent: allAgents,
    hook: countHooks(),
    specialist: shippingSpecialists, // "N specialists" → 14 shipping roster
    subagent: shippingSpecialists,   // "N subagents" → same
  };

  const claims = extractCountClaims(corpus);

  // Aggregate claims by thing — flag each unique (thing, number) pair
  const seenClaims = new Map<string, CountClaim>(); // key = `thing:number`
  for (const claim of claims) {
    const key = `${claim.thing}:${claim.number}`;
    if (!seenClaims.has(key)) seenClaims.set(key, claim);
  }

  for (const [key, claim] of seenClaims) {
    const real = realCounts[claim.thing];
    if (real === undefined) continue; // unknown thing type
    if (claim.number !== real) {
      const notes = `Delta = ${real - claim.number} (real minus claimed). Real: skills=${realCounts.skill}, commands=${realCounts.command}, shipping-specialists=${shippingSpecialists}, all-agents=${allAgents}, hooks=${realCounts.hook}`;
      const kind: CandidateKind = "count-mismatch";
      const codeRefMap: Record<string, string> = {
        skill: `plugin/skills/**/SKILL.md (${realCounts.skill} files — recursive find across all tier dirs)`,
        command: `plugin/commands/*.md (${realCounts.command} files — ls count)`,
        agent: `plugin/agents/*.md (${allAgents} files — ls count)`,
        hook: `plugin/hooks/hooks.json:hooks[] (${realCounts.hook} events — JSON parse)`,
        // specialists = 14 shipping roster; excludes advisor/developer/doc-writer augmenting roles
        specialist: `plugin/agents/*.md (${shippingSpecialists} shipping specialists — ${allAgents} total minus 3 augmenting: advisor/developer/doc-writer)`,
        subagent:   `plugin/agents/*.md (${shippingSpecialists} shipping specialists)`,
      };
      const ledger = deriveLedgerFields(kind, notes);
      candidates.push({
        id: idCounter.next("cnt"),
        kind,
        ...ledger,
        doc_ref: `${claim.file}:${claim.lineNo}`,
        code_ref: codeRefMap[claim.thing] || `plugin/${claim.thing}s/ (ls count)`,
        doc_claim: `"${claim.number} ${claim.thing}s" — full line: "${claim.line}"`,
        code_reality: `Real count = ${real} ${claim.thing}s in plugin tree (as of audit snapshot)`,
        confidence: Math.abs(claim.number - real) <= 2 ? "medium" : "high",
        notes,
      });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Ledger schema field derivation (reconciliation-ledger-schema.md §"Controlled vocabularies")
// ---------------------------------------------------------------------------

/**
 * Derive the three closed-vocab ledger fields from a candidate's `kind` and `notes`.
 * OD-2 half-shipped features get drift_type="half-shipped" and recommended_direction="wire-up".
 */
function deriveLedgerFields(
  kind: CandidateKind,
  notes: string = ""
): { surface: LedgerSurface; drift_type: LedgerDriftType; recommended_direction: LedgerDirection; authoritative_side: LedgerAuthoritativeSide } {
  const isOD2 = notes.includes("OD-2");

  // surface mapping
  let surface: LedgerSurface;
  switch (kind) {
    case "config-key-absent-in-code":
    case "config-key-absent-in-docs":
    case "config-default-mismatch":
    case "config-type-mismatch":
      surface = "config-key"; break;
    case "command-unwired":
    case "command-undocumented":
    case "subcommand-unwired":
    case "subcommand-undocumented":
      surface = "command"; break;
    case "flag-undocumented":
      surface = "flag"; break;
    case "env-var-undocumented":
    case "env-var-absent-in-code":
      surface = "env"; break;
    case "count-mismatch":
      surface = "count"; break;
    default:
      surface = "config-key";
  }

  // drift_type + recommended_direction + authoritative_side
  let drift_type: LedgerDriftType;
  let recommended_direction: LedgerDirection;
  let authoritative_side: LedgerAuthoritativeSide;

  if (isOD2) {
    // OD-2 items: feature is documented AND partially wired — half-shipped, wire-up
    drift_type = "half-shipped";
    recommended_direction = "wire-up";
    authoritative_side = "both-partial"; // key/flag exists in code but consumer ignores it
  } else {
    switch (kind) {
      // Docs claim something the code lacks (overclaim) — code is ground truth
      case "config-key-absent-in-code":
      case "flag-undocumented":
      case "env-var-absent-in-code":
        drift_type = "docs-overclaim";
        recommended_direction = "needs-decision";
        authoritative_side = "code";
        break;

      // Code has moved past what docs describe — docs are stale
      case "command-unwired":
      case "command-undocumented":
      case "subcommand-unwired":
      case "subcommand-undocumented":
      case "config-key-absent-in-docs":
      case "env-var-undocumented":
        drift_type = "docs-stale";
        recommended_direction = "fix-docs";
        authoritative_side = "code";
        break;

      case "config-default-mismatch":
      case "config-type-mismatch":
        drift_type = "docs-overclaim";
        recommended_direction = "needs-decision";
        authoritative_side = "both-partial";
        break;

      case "count-mismatch":
        drift_type = "docs-stale";
        recommended_direction = "fix-docs";
        authoritative_side = "code";
        break;

      default:
        drift_type = "docs-overclaim";
        recommended_direction = "needs-decision";
        authoritative_side = "both-partial";
    }
  }

  return { surface, drift_type, recommended_direction, authoritative_side };
}

// ---------------------------------------------------------------------------
// ID counter
// ---------------------------------------------------------------------------

class Counter {
  private counts: Record<string, number> = {};
  next(prefix: string): string {
    this.counts[prefix] = (this.counts[prefix] || 0) + 1;
    return `${prefix}-${String(this.counts[prefix]).padStart(3, "0")}`;
  }
}

// ---------------------------------------------------------------------------
// Render outputs
// ---------------------------------------------------------------------------

function renderMarkdown(candidates: Candidate[], runDate: string): string {
  const byKind: Record<string, Candidate[]> = {};
  for (const c of candidates) {
    (byKind[c.kind] = byKind[c.kind] || []).push(c);
  }

  let md = `---
type: artifact
initiative: plugin-docs-code-reconciliation
phase: P1-audit
owner: tooling-engineer
created_at: ${runDate}
---

# G-AUDIT: docs↔code reconciliation candidates

Generated by \`plugin/scripts/docs-hygiene/docs-code-audit.ts\` on ${runDate}.
Phase 1 — read-only discovery. Candidates are FLAGGED, not adjudicated.
Each row needs researcher/operator verification at the OD-1 per-item gate (Phase 2).

## Summary

| Kind | Count |
|---|---|
`;
  for (const [kind, list] of Object.entries(byKind)) {
    md += `| ${kind} | ${list.length} |\n`;
  }
  md += `| **Total** | **${candidates.length}** |\n\n`;

  // Real counts sidebar
  const skills = countSkills();
  const commands = countCommands();
  const agents = countAgents();
  const hooks = countHooks();
  md += `## Real tree counts (as of audit run)

| Artifact | Real count |
|---|---|
| Skills (SKILL.md files in plugin/skills/** — all tiers) | ${skills} |
| Commands (plugin/commands/*.md) | ${commands} |
| Agents (plugin/agents/*.md) | ${agents} |
| Hook events (hooks.json hooks[]) | ${hooks} |

`;

  md += `## Candidate detail\n\n`;
  md += `| ID | Kind | Doc ref | Code ref | Doc claim | Code reality | Rec | Conf |\n`;
  md += `|---|---|---|---|---|---|---|---|\n`;
  for (const c of candidates) {
    const docClaim = c.doc_claim.replace(/\|/g, "\\|").slice(0, 80);
    const codeReality = c.code_reality.replace(/\|/g, "\\|").slice(0, 80);
    md += `| ${c.id} | ${c.kind} | \`${c.doc_ref}\` | \`${c.code_ref}\` | ${docClaim} | ${codeReality} | ${c.recommendation} | ${c.confidence} |\n`;
  }

  md += `
---

## Half-shipped features (OD-2 — fix-code priority)

Per briefing OD-2, the following are documented/referenced but not fully wired in code.
Phase 3 (Wire-up) owns implementation; Phase 1 flags them here for the ledger.

| Feature | Kind | Status |
|---|---|---|
| \`models.enabled\` scorer gate | config key | key exists in code but gate logic not wired |
| \`--statusline\` / \`GUILD_STATUSLINE\` | CLI flag + env var | referenced in docs/briefing; not parsed by any script |
| \`/guild:config update-mcp-hashes\` | config subcommand | documented in mcp.tool_description_hashes help; not in config-cmd.ts |
| \`review.adversarial.provider\` | config key | referenced as a half-shipped feature; not in DEFAULTS closed-key set |
| top-level \`index: "off"\` → IndexBlock.enabled | config wiring | key exists; wire to IndexBlock.enabled |

---

## How to use this list

1. **Phase 2 (Reconcile):** Walk each row; at the per-item OD-1 gate, operator decides
   fix-code vs fix-docs. High-confidence candidates need the least verification.
2. **Researcher (research-digester):** Verify medium/low confidence candidates —
   confirm the doc claim is real and the code reality is accurate.
3. **Phase 3 (Wire-up):** fix-code candidates where \`notes\` reference OD-2 go to
   tooling-engineer + hook-engineer for implementation.

_Run: \`npx tsx plugin/scripts/docs-hygiene/docs-code-audit.ts\` from the workspace root._
`;
  return md;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const readConfigSrc = readFile(READ_CONFIG_TS);
const configCmdSrc = readFile(CONFIG_CMD_TS);

console.error(`[docs-code-audit] Workspace: ${WORKSPACE}`);
console.error(`[docs-code-audit] Building corpus...`);
const corpus = buildCorpus();
console.error(`[docs-code-audit] Corpus: ${corpus.length} files`);

const counter = new Counter();
const allCandidates: Candidate[] = [];

console.error(`[docs-code-audit] Running config-key audit...`);
allCandidates.push(...runConfigKeyAudit(corpus, readConfigSrc, counter));

console.error(`[docs-code-audit] Running command/subcommand audit...`);
const shippedCommands = getShippedCommands();
allCandidates.push(...runCommandAudit(corpus, shippedCommands, configCmdSrc, counter));

console.error(`[docs-code-audit] Running CLI flag / env-var audit...`);
const shippedEnvVars = getShippedEnvVars();
allCandidates.push(...runFlagEnvAudit(corpus, readConfigSrc, shippedEnvVars, counter));

console.error(`[docs-code-audit] Running count audit...`);
allCandidates.push(...runCountAudit(corpus, counter));

console.error(`[docs-code-audit] Total candidates: ${allCandidates.length}`);

// Write outputs
const runDate = new Date().toISOString().slice(0, 10);
fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
fs.writeFileSync(OUTPUT_JSON, JSON.stringify(allCandidates, null, 2) + "\n", "utf8");
fs.writeFileSync(OUTPUT_MD, renderMarkdown(allCandidates, runDate), "utf8");

console.log(`candidates.json → ${OUTPUT_JSON}`);
console.log(`candidates-summary.md → ${OUTPUT_MD}`);
console.error(`\n[docs-code-audit] Done — ${allCandidates.length} candidates`);

// Print kind breakdown
const byKind: Record<string, number> = {};
for (const c of allCandidates) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
for (const [kind, count] of Object.entries(byKind)) {
  console.error(`  ${kind.padEnd(40)} ${count}`);
}

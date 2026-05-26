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
  agent_team: "auto" | "on" | "off";
  adversarial: "on" | "off";
  team: { size: number | null; always_include: string[] };
  review_workflow: "standard" | "cross" | "minimal";
  skill_policy: "standard" | "conservative";
  gates: { auto_approve: string[] };
  wiki: { share_mode: "team" | "private"; autopromote: boolean };
  quality: { budget: QualityBudget };
  reporting: "standard" | "quiet" | "verbose";
}
interface GuildSettings {
  rigor: "quick" | "standard" | "deep";
  auto_approve: string[]; // [] | [spec,plan,build] | [all]
  review: "local" | "cross" | "off";
  host: "claude" | "codex" | "auto";
  initiative_default: string | null;
  index: "auto" | "off";
  // power-user overrides
  loops: string | null;
  loop_cap: number;
  codex_cap: number;
  defaults: DefaultsBlock;
}

const DEFAULTS: GuildSettings = {
  rigor: "standard",
  auto_approve: [],
  review: "local",
  host: "auto",
  initiative_default: null,
  index: "auto",
  loops: null,
  loop_cap: 16,
  codex_cap: 5,
  defaults: {
    agent_team: "auto",
    adversarial: "on",
    team: { size: null, always_include: [] },
    review_workflow: "standard",
    skill_policy: "standard",
    gates: { auto_approve: [] },
    wiki: { share_mode: "team", autopromote: false },
    quality: { budget: { per_class_minutes: 10, total_minutes: 30 } },
    reporting: "standard",
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
  loops: "null | none|spec|plan|implementation|all|<csv> — power-user; null = derive from rigor",
  loop_cap: "int 1-256 — max rounds per adversarial loop",
  codex_cap: "int 1-10 — max rounds per Codex review gate",
  "defaults.agent_team": "auto | on | off — tmux multi-agent team backend",
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
  _precedence: "CLI flag > --rigor profile > settings.json > built-in default",
  _docs: "Canonical schema: architecture/command-surface.md §4.4. Regenerate with: /guild config init",
};

const VALID_LOOPS = new Set(["none", "spec", "plan", "implementation", "all"]);
const VALID_RIGOR = new Set(["quick", "standard", "deep"]);
const VALID_REVIEW = new Set(["local", "cross", "off"]);
const VALID_HOST = new Set(["claude", "codex", "auto"]);
const VALID_PHASES = new Set(["spec", "plan", "build", "all"]);

interface ParsedArgs {
  cwd?: string;
  mode: "resolve" | "scaffold" | "validate";
  selfBuild: boolean;
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
  return { cwd, mode, selfBuild, flags };
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

/** Closed-key validation of the `defaults:` block. Returns reject messages. */
function validateDefaults(d: Record<string, unknown>, selfBuild: boolean): string[] {
  const rejects: string[] = [];
  const ALLOWED = new Set([
    "agent_team", "adversarial", "team", "review_workflow", "skill_policy",
    "gates", "wiki", "quality", "reporting",
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
      "index", "loops", "loop_cap", "codex_cap", "defaults",
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
    if (typeof parsed["loops"] === "string" || parsed["loops"] === null) out.loops = parsed["loops"] as string | null;
    if (typeof parsed["loop_cap"] === "number") out.loop_cap = Math.min(256, Math.max(1, parsed["loop_cap"]));
    if (typeof parsed["codex_cap"] === "number") out.codex_cap = Math.min(10, Math.max(1, parsed["codex_cap"]));
    if (isPlainObject(parsed["defaults"])) {
      rejects.push(...validateDefaults(parsed["defaults"], selfBuild));
      // deep-merge known sub-keys over DEFAULTS.defaults
      out.defaults = { ...DEFAULTS.defaults, ...(parsed["defaults"] as Partial<DefaultsBlock>) } as DefaultsBlock;
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
  const { cwd: cwdFlag, mode, selfBuild, flags } = parseArgs(process.argv.slice(2));
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
    defaults: { ...DEFAULTS.defaults, ...(fileConfig.defaults ?? {}) },
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

  process.stdout.write(JSON.stringify({ ...resolved, _rigor_expanded: rigorExpanded }, null, 2) + "\n");
}

main();

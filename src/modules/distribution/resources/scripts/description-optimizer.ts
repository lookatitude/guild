#!/usr/bin/env -S npx tsx
/**
 * scripts/description-optimizer.ts
 *
 * Implements guild-plan.md §11.2 step 9 — description optimizer.
 * Deterministic heuristic (NOT an LLM). Given a skill's evals.json, treats
 * should_trigger as positives and should_not_trigger as negatives, derives
 * common positive trigger tokens, filters against negative-example tokens,
 * and assembles a description with TRIGGER / DO NOT TRIGGER clauses capped
 * at 1024 chars.
 *
 * Usage:
 *   scripts/description-optimizer.ts --skill <slug> [--cwd <path>]
 *
 * Options:
 *   --skill <slug>  (required) Skill slug (e.g. "guild-brainstorm").
 *   --cwd <path>    (optional, default ".") Repo root.
 *                   Resolves the LIVE skill dir exactly like evolve-loop.ts's
 *                   findLiveSkillDir (same three tiers, same priority, same SKILL.md
 *                   gate), then reads that dir's evals.json sibling — so step 9 always
 *                   finds the evals that steps 1-8 evolved against, never a same-slug
 *                   corpus from an unrelated tier:
 *                     1. <cwd>/.guild/skills/<slug>/{SKILL.md,evals.json} — v2 project
 *                        instance (DH-3: wins over the plugin library when present).
 *                     2. <cwd>/skills/<tier>/<slug>/{SKILL.md,evals.json} across every
 *                        tier dir found under <cwd>/skills/ (dynamic enumeration, not a
 *                        hardcoded tier list — new tiers like "knowledge" are picked up
 *                        automatically), plus dir-level skills at
 *                        <cwd>/skills/<slug>/{SKILL.md,evals.json} (e.g. guild-quality,
 *                        guild-operations) — the self-build/plugin-repo layout.
 *                     3. The plugin install root (GUILD_PLUGIN_ROOT or CLAUDE_PLUGIN_ROOT),
 *                        same tier search as (2) — the shipped baseline, used when a
 *                        consuming repo has no project instance yet.
 *                   A live dir found with no evals.json sibling is treated as "not found"
 *                   (evals not yet bootstrapped) — it never falls through to a different
 *                   tier's evals.json for the same slug.
 *
 * Reads:  see resolution order above.
 * Writes: none (emits YAML on stdout; orchestrator decides whether to apply).
 *
 * Stdout: one-line YAML `description: <...>`.
 * Stderr: diagnostics.
 *
 * Exit codes:
 *   0  Success.
 *   1  Bad input (missing --skill, evals.json not found).
 *   2  Internal error.
 *
 * Invariant: never writes to disk. Never writes to .guild/wiki/.
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * A single eval entry. The shipped evals corpus uses bare strings; the
 * {prompt} object shape is also accepted (§F2 fix — both must be tolerated).
 */
type RawEvalItem = string | { id?: string; prompt: string };

interface Evals {
  should_trigger: RawEvalItem[];
  should_not_trigger: RawEvalItem[];
}

/** Normalize an eval entry to its prompt string regardless of shape. */
function normalizePrompt(item: RawEvalItem): string {
  if (typeof item === "string") return item;
  return item.prompt ?? "";
}

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  skill: string | null;
  cwd: string;
} {
  let skill: string | null = null;
  let cwd = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skill" && i + 1 < argv.length) skill = argv[++i];
    else if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
  }
  return { skill, cwd };
}

// ── Skill path resolution ──────────────────────────────────────────────────

/**
 * Enumerate the tier directories directly under <cwd>/skills/ — dynamic
 * replacement for a hardcoded tier list. Picks up any tier (core, meta,
 * knowledge, specialists, guild-operations, guild-quality, or a future
 * addition) without a code change. Returns [] when skills/ does not exist.
 */
function listSkillTierDirs(cwd: string): string[] {
  const skillsRoot = path.join(cwd, "skills");
  try {
    return fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Search the self-build/plugin layout under `root` for a LIVE skill dir (one that
 * actually has a SKILL.md): dir-level then tier-nested. Gating on SKILL.md — not just
 * evals.json — matters because a bare evals.json with no sibling SKILL.md is not a real
 * skill instance; requiring both avoids picking up a stray/orphaned evals.json.
 */
function findSkillDirUnderSkillsRoot(root: string, slug: string): string | null {
  // Dir-level skill: SKILL.md directly at skills/<slug>/ (e.g. guild-quality,
  // guild-operations — checked first so a slug that happens to match a tier
  // dir name doesn't get misread as a tier).
  const direct = path.join(root, "skills", slug);
  if (fs.existsSync(path.join(direct, "SKILL.md"))) return direct;

  // Tier dirs — enumerated from disk, not a hardcoded list.
  for (const tier of listSkillTierDirs(root)) {
    const dir = path.join(root, "skills", tier, slug);
    if (fs.existsSync(path.join(dir, "SKILL.md"))) return dir;
  }
  return null;
}

/**
 * Resolve the LIVE skill directory for `slug`, mirroring evolve-loop.ts's
 * findLiveSkillDir exactly (same three tiers, same priority, same SKILL.md gate, same
 * env var fallback): v2 project instance first (DH-3), then the self-build/plugin-repo
 * layout under `cwd`, then the shipped baseline under the plugin install root.
 */
function findLiveSkillDir(cwd: string, slug: string): string | null {
  const project = path.join(cwd, ".guild", "skills", slug);
  if (fs.existsSync(path.join(project, "SKILL.md"))) return project;

  const selfBuild = findSkillDirUnderSkillsRoot(cwd, slug);
  if (selfBuild) return selfBuild;

  const pluginRoot =
    process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"];
  if (pluginRoot && path.resolve(pluginRoot) !== path.resolve(cwd)) {
    const shipped = findSkillDirUnderSkillsRoot(pluginRoot, slug);
    if (shipped) return shipped;
  }
  return null;
}

/**
 * Resolve the evals.json for `slug` — always the evals.json sibling of the live
 * SKILL.md, never a same-slug evals.json from a DIFFERENT tier. A live dir found with
 * no evals.json sibling is a genuine "not ready to optimize" state (evals not yet
 * bootstrapped), not a cue to fall through to an unrelated corpus for the same slug.
 */
function findEvalsFile(cwd: string, slug: string): string | null {
  const liveDir = findLiveSkillDir(cwd, slug);
  if (!liveDir) return null;
  const evalsPath = path.join(liveDir, "evals.json");
  return fs.existsSync(evalsPath) ? evalsPath : null;
}

// ── Tokenization ───────────────────────────────────────────────────────────

// Deliberately conservative stopword list — keep domain nouns intact.
const STOPWORDS = new Set<string>([
  "a", "an", "the", "and", "or", "but", "if", "then", "else",
  "for", "to", "of", "in", "on", "at", "by", "with", "from",
  "as", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "doing", "have", "has", "had",
  "i", "me", "my", "we", "us", "our", "you", "your",
  "it", "its", "this", "that", "these", "those",
  "will", "would", "should", "could", "can", "may", "might",
  "please", "lets", "let", "need", "want", "help",
  "new", "some", "any", "all", "more", "now",
  "about", "into", "onto", "up", "down", "out", "over", "under",
  "so", "than", "too", "very", "just", "only", "also",
  "me", "us", "them", "him", "her",
  "what", "when", "where", "which", "who", "why", "how",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function tokenFrequency(prompts: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const p of prompts) {
    const seen = new Set<string>();
    for (const tok of tokenize(p)) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
    }
  }
  return freq;
}

// ── Description building ───────────────────────────────────────────────────

function buildDescription(slug: string, evals: Evals): string {
  const posPrompts = evals.should_trigger.map(normalizePrompt);
  const negPrompts = evals.should_not_trigger.map(normalizePrompt);

  const posFreq = tokenFrequency(posPrompts);
  const negFreq = tokenFrequency(negPrompts);

  // Pick trigger tokens: appear in ≥ 1/3 of positives, not in any negative.
  const posThreshold = Math.max(1, Math.ceil(posPrompts.length / 3));
  const triggerTokens: string[] = [];
  for (const [tok, count] of Array.from(posFreq.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )) {
    if (count < posThreshold) continue;
    if (negFreq.has(tok)) continue;
    triggerTokens.push(tok);
  }

  // Pick negative-boundary tokens: appear in ≥ 1/3 of negatives, not in
  // positives — these become the DO NOT TRIGGER cues.
  const negThreshold = Math.max(1, Math.ceil(negPrompts.length / 3));
  const blockTokens: string[] = [];
  for (const [tok, count] of Array.from(negFreq.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )) {
    if (count < negThreshold) continue;
    if (posFreq.has(tok)) continue;
    blockTokens.push(tok);
  }

  // Fallback: if no high-signal trigger tokens, use all positive-only tokens.
  if (triggerTokens.length === 0) {
    for (const tok of Array.from(posFreq.keys()).sort()) {
      if (!negFreq.has(tok)) triggerTokens.push(tok);
    }
  }

  const slugReadable = slug.replace(/^guild[-:]?/, "").replace(/-/g, " ");

  // Assemble a single-line description.
  const triggerList =
    triggerTokens.length > 0 ? triggerTokens.slice(0, 12).join(", ") : slugReadable;
  const blockList = blockTokens.length > 0 ? blockTokens.slice(0, 10).join(", ") : "";

  let desc = `${slugReadable} skill. TRIGGER on: ${triggerList}.`;
  if (blockList) {
    desc += ` DO NOT TRIGGER for: ${blockList}.`;
  } else {
    desc += ` DO NOT TRIGGER for unrelated tasks.`;
  }

  // Enforce 1024-char cap.
  if (desc.length > 1024) {
    desc = desc.slice(0, 1021) + "...";
  }
  return desc;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const { skill, cwd: cwdArg } = parseArgs(process.argv.slice(2));

  if (!skill) {
    process.stderr.write(
      "[description-optimizer] ERROR: --skill <slug> is required\n"
    );
    process.exit(1);
  }

  const cwd = path.resolve(cwdArg);
  const evalsPath = findEvalsFile(cwd, skill);
  if (!evalsPath) {
    process.stderr.write(
      `[description-optimizer] ERROR: evals.json not found for skill "${skill}" under ` +
        `${cwd}/.guild/skills/${skill}/, ${cwd}/skills/${skill}/, ${cwd}/skills/<tier>/${skill}/ ` +
        `for any tier under skills/, or the plugin install root\n`
    );
    process.exit(1);
  }

  let evals: Evals;
  try {
    const raw = JSON.parse(fs.readFileSync(evalsPath!, "utf8"));
    if (
      !raw ||
      typeof raw !== "object" ||
      !Array.isArray(raw.should_trigger) ||
      !Array.isArray(raw.should_not_trigger)
    ) {
      throw new Error(
        "evals.json must have should_trigger and should_not_trigger arrays"
      );
    }
    evals = raw as Evals;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[description-optimizer] ERROR: failed to parse evals.json at ${evalsPath}: ${msg}\n`
    );
    process.exit(1);
    return;
  }

  const desc = buildDescription(skill, evals);
  process.stdout.write(`description: ${desc}\n`);
  process.stderr.write(
    `[description-optimizer] optimized description for ${skill} (${desc.length} chars)\n`
  );
  process.exit(0);
}

main();

#!/usr/bin/env -S npx tsx
/**
 * scripts/lint/description-budget.ts — KTD25 three-stage disclosure, measured.
 *
 * Three legs, each a separate pass/fail so CI can say WHICH budget blew:
 *
 *   catalog   sum of the 17 indexed assembler `description:` values   <= 8,000 tokens
 *   per-skill the largest single indexed `description:`               <=   350 tokens
 *   prefix    the always-on prefix (using-guild SKILL body + the       <= min(2% of the
 *             plugin AGENTS.md) — what every session pays before it        host window,
 *             has done anything                                            1,500 tokens)
 *
 * WHY a script and not a review note: the catalog is what the host pastes into
 * every session's tool list. It grows one description at a time and nobody
 * notices until the prefix is a measurable fraction of the window. The number is
 * only a budget if something fails when it is exceeded.
 *
 * Token estimate: chars/4 is the standard conservative approximation and is what
 * the source plan's budgets are stated in. It is deliberately NOT a tokenizer
 * dependency — a budget gate must not need a model download to run in CI.
 *
 * Usage:
 *   description-budget.ts [--root <pluginRoot>] [--json] [--advisory-prefix]
 *
 * Exit 0 every blocking leg passes · 1 a blocking leg failed · 2 the tree could
 * not be read. `--advisory-prefix` downgrades the prefix leg to a warning (the
 * catalog and per-skill legs always block).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

export const CATALOG_TOKEN_BUDGET = 8_000;
export const PER_SKILL_TOKEN_BUDGET = 350;
export const PREFIX_TOKEN_BUDGET = 1_500;
/** Fraction of the host context window the always-on prefix may occupy. */
export const PREFIX_WINDOW_FRACTION = 0.02;

/** chars/4, floor-free: the budgets in the source plan are stated on this estimate. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface IndexedSkill {
  id: string;
  dir: string;
  file: string;
  description: string;
}

function exists(p: string): boolean {
  try { fs.statSync(p); return true; } catch { return false; }
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function read(p: string): string {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

/**
 * The `description:` frontmatter value, unwrapped.
 *
 * Skill descriptions are long single-line scalars that routinely contain colons,
 * quotes and escaped quotes, so this reads the raw line (plus any indented
 * continuation) rather than parsing YAML — the same fail-open approach
 * build-inventory uses for the same reason.
 */
export function frontmatterDescription(content: string): string {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return "";
  let out: string | undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") break;
    if (out !== undefined) {
      // A folded/indented continuation line belongs to the description.
      if (/^\s+\S/.test(line) && !/^\s*\w[\w-]*\s*:/.test(line)) { out += " " + line.trim(); continue; }
      break;
    }
    const m = /^description\s*:\s*(.*)$/.exec(line);
    if (m) out = m[1];
  }
  if (out === undefined) return "";
  let v = out.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v.replace(/\\"/g, '"').trim();
}

/** The skills the plugin manifest actually indexes — the catalog the host pastes. */
export function indexedSkills(root: string): IndexedSkill[] {
  const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
  let manifest: { skills?: unknown };
  try { manifest = JSON.parse(read(manifestPath)); } catch { return []; }
  const entries = Array.isArray(manifest.skills) ? manifest.skills.map(String) : [];
  const out: IndexedSkill[] = [];
  const push = (dir: string) => {
    for (const name of ["SKILL.md", "SKILL.src.md"]) {
      const file = path.join(root, dir, name);
      if (!exists(file)) continue;
      out.push({ id: path.basename(dir), dir, file: `${dir}/${name}`, description: frontmatterDescription(read(file)) });
      return;
    }
  };
  for (const raw of entries) {
    const rel = raw.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!isDir(path.join(root, rel))) continue;
    if (exists(path.join(root, rel, "SKILL.md")) || exists(path.join(root, rel, "SKILL.src.md"))) {
      push(rel);
      continue;
    }
    for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
      const sub = `${rel}/${name}`;
      if (isDir(path.join(root, sub))) push(sub);
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Every byte a session pays before it has done anything: the using-guild body
 * (the one always-on Guild file, KTD25) plus the plugin's own AGENTS.md.
 */
export function prefixSources(root: string): Array<{ path: string; tokens: number }> {
  const out: Array<{ path: string; tokens: number }> = [];
  for (const skill of indexedSkills(root)) {
    if (skill.id !== "using-guild") continue;
    out.push({ path: skill.file, tokens: estimateTokens(read(path.join(root, skill.file))) });
  }
  const agents = path.join(root, "AGENTS.md");
  if (exists(agents)) out.push({ path: "AGENTS.md", tokens: estimateTokens(read(agents)) });
  return out;
}

export interface Leg {
  id: "catalog" | "per-skill" | "prefix";
  budget: number;
  measured: number;
  ok: boolean;
  blocking: boolean;
  detail: string;
}

export function measure(root: string, advisoryPrefix = false): Leg[] {
  const skills = indexedSkills(root);
  const catalog = skills.reduce((sum, s) => sum + estimateTokens(s.description), 0);
  const worst = skills.reduce<{ id: string; tokens: number }>(
    (acc, s) => {
      const t = estimateTokens(s.description);
      return t > acc.tokens ? { id: s.id, tokens: t } : acc;
    },
    { id: "(none)", tokens: 0 },
  );
  const prefix = prefixSources(root);
  const prefixTokens = prefix.reduce((sum, p) => sum + p.tokens, 0);

  return [
    {
      id: "catalog",
      budget: CATALOG_TOKEN_BUDGET,
      measured: catalog,
      ok: catalog <= CATALOG_TOKEN_BUDGET,
      blocking: true,
      detail: `${skills.length} indexed descriptions`,
    },
    {
      id: "per-skill",
      budget: PER_SKILL_TOKEN_BUDGET,
      measured: worst.tokens,
      ok: worst.tokens <= PER_SKILL_TOKEN_BUDGET,
      blocking: true,
      detail: `largest: ${worst.id}`,
    },
    {
      id: "prefix",
      budget: PREFIX_TOKEN_BUDGET,
      measured: prefixTokens,
      ok: prefixTokens <= PREFIX_TOKEN_BUDGET,
      blocking: !advisoryPrefix,
      detail: prefix.map((p) => `${p.path}=${p.tokens}`).join(" + ") || "(no prefix files found)",
    },
  ];
}

function main(argv: string[]): number {
  let root = DEFAULT_ROOT;
  let json = false;
  let advisoryPrefix = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && argv[i + 1] !== undefined) root = path.resolve(argv[++i]);
    else if (a.startsWith("--root=")) root = path.resolve(a.slice("--root=".length));
    else if (a === "--json") json = true;
    else if (a === "--advisory-prefix") advisoryPrefix = true;
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      return 2;
    }
  }
  if (!exists(path.join(root, ".claude-plugin", "plugin.json"))) {
    process.stderr.write(`description-budget: no plugin manifest under ${root}\n`);
    return 2;
  }

  const legs = measure(root, advisoryPrefix);
  if (json) {
    process.stdout.write(JSON.stringify({ root, legs }, null, 2) + "\n");
  } else {
    const skills = indexedSkills(root);
    process.stdout.write(
      `description-budget — ${skills.length} indexed skills · prefix window fraction ${PREFIX_WINDOW_FRACTION * 100}% (floor ${PREFIX_TOKEN_BUDGET})\n`,
    );
    for (const leg of legs) {
      const verdict = leg.ok ? "PASS" : leg.blocking ? "FAIL" : "WARN";
      process.stdout.write(
        `  ${verdict.padEnd(4)} ${leg.id.padEnd(9)} ${String(leg.measured).padStart(6)} / ${leg.budget} tokens  (${leg.detail})\n`,
      );
    }
    const over = skills
      .map((s) => ({ id: s.id, tokens: estimateTokens(s.description) }))
      .filter((s) => s.tokens > PER_SKILL_TOKEN_BUDGET)
      .sort((a, b) => b.tokens - a.tokens);
    for (const s of over) process.stdout.write(`  over per-skill budget: ${s.id} = ${s.tokens} tokens\n`);
  }

  return legs.some((l) => l.blocking && !l.ok) ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

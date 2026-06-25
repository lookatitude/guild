#!/usr/bin/env -S npx tsx
/**
 * src/modules/docs-sync/workflows/check-command-coverage.ts
 *
 * Umbrella-side COMPLEMENT to the plugin-side doc-sync advisory (check-doc-sync.ts).
 * Where check-doc-sync is DIFF-based (did THIS PR's surface change get a root-doc
 * update?), this is STATE-based: is the WHOLE current command surface covered by root
 * reference docs? It is meant to run from the UMBRELLA repo's CI, which can check out the
 * sibling plugin repo — so it can verify coverage the plugin-repo CI structurally cannot.
 *
 * Enforces Rule 2 of docs/knowledge/decisions/workspace-knowledge-flow.md as a standing
 * gate: every plugin command (plugin/commands/<token>.md) must be referenced somewhere
 * under root docs/knowledge/ — as the namespaced `guild:<token>` / `/guild:<token>` token
 * (word-bounded) or as a `commands/<token>.md` reference. An uncovered command means a
 * command shipped without its root reference docs being updated (rollout-coupling drift).
 *
 * Usage:
 *   npx tsx check-command-coverage.ts --commands-dir <path> --knowledge-dir <path> [--warn]
 *
 *   --commands-dir <path>   The plugin repo's commands/ dir (e.g. ./.plugin-src/commands).
 *   --knowledge-dir <path>  The umbrella repo's docs/knowledge/ dir.
 *   --warn                  Report but exit 0 even when commands are uncovered (advisory).
 *                           Default: exit 1 when any command is uncovered (a real gate).
 *
 * Exit: 0 = all covered (or --warn). 1 = uncovered commands found. 2 = bad input.
 *
 * Pure core (`evaluateCommandCoverage`) takes already-read inputs so it is deterministic
 * and unit-testable with no filesystem.
 */

import * as fs from "fs";
import * as path from "path";

export interface CoverageResult {
  covered: string[];
  uncovered: string[];
}

/** Escape a string for safe use inside a RegExp. Command tokens are [a-z0-9-] but escape defensively. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pure core. A token is "covered" iff, across the concatenated knowledge text, it appears
 * as `guild:<token>` or `/guild:<token>` (word-bounded — so `stat` does NOT match
 * `guild:status` and vice-versa) OR as a `commands/<token>.md` file reference.
 */
export function isTokenCovered(token: string, knowledgeText: string): boolean {
  const t = escapeRegex(token);
  // Namespaced command/skill token, optional leading slash, word boundary after the token.
  const namespaced = new RegExp(`/?guild:${t}\\b`);
  // A direct reference to the command file.
  const fileRef = new RegExp(`commands/${t}\\.md\\b`);
  return namespaced.test(knowledgeText) || fileRef.test(knowledgeText);
}

/**
 * Pure core. Given the command tokens and the concatenated knowledge text, partition into
 * covered / uncovered (uncovered sorted for stable output).
 */
export function evaluateCommandCoverage(
  commandTokens: string[],
  knowledgeText: string,
): CoverageResult {
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const token of commandTokens) {
    if (isTokenCovered(token, knowledgeText)) covered.push(token);
    else uncovered.push(token);
  }
  uncovered.sort();
  return { covered, uncovered };
}

/** Read command tokens from a commands/ dir: each `<token>.md` → `<token>`. */
export function collectCommandTokens(commandsDir: string): string[] {
  const entries = fs.readdirSync(commandsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name.slice(0, -".md".length))
    .sort();
}

/** Read every .md under knowledgeDir (recursively) and concatenate. */
export function gatherKnowledgeText(knowledgeDir: string): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && e.name.endsWith(".md")) parts.push(fs.readFileSync(abs, "utf8"));
    }
  };
  walk(knowledgeDir);
  return parts.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { commandsDir?: string; knowledgeDir?: string; warn: boolean } {
  let commandsDir: string | undefined;
  let knowledgeDir: string | undefined;
  let warn = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commands-dir" && argv[i + 1]) commandsDir = argv[++i];
    else if (a.startsWith("--commands-dir=")) commandsDir = a.slice("--commands-dir=".length);
    else if (a === "--knowledge-dir" && argv[i + 1]) knowledgeDir = argv[++i];
    else if (a.startsWith("--knowledge-dir=")) knowledgeDir = a.slice("--knowledge-dir=".length);
    else if (a === "--warn") warn = true;
  }
  return { commandsDir, knowledgeDir, warn };
}

export function main(argv: string[]): number {
  const { commandsDir, knowledgeDir, warn } = parseArgs(argv);
  if (!commandsDir || !knowledgeDir) {
    process.stderr.write(
      "[command-coverage] ERROR: --commands-dir and --knowledge-dir are required\n",
    );
    return 2;
  }
  if (!fs.existsSync(commandsDir) || !fs.statSync(commandsDir).isDirectory()) {
    process.stderr.write(`[command-coverage] ERROR: commands dir not found: ${commandsDir}\n`);
    return 2;
  }
  if (!fs.existsSync(knowledgeDir) || !fs.statSync(knowledgeDir).isDirectory()) {
    process.stderr.write(`[command-coverage] ERROR: knowledge dir not found: ${knowledgeDir}\n`);
    return 2;
  }

  const tokens = collectCommandTokens(commandsDir);
  const knowledgeText = gatherKnowledgeText(knowledgeDir);
  const { covered, uncovered } = evaluateCommandCoverage(tokens, knowledgeText);

  if (uncovered.length === 0) {
    process.stdout.write(
      `[command-coverage] OK — all ${covered.length} commands covered in docs/knowledge/\n`,
    );
    return 0;
  }

  process.stdout.write(
    `[command-coverage] ${uncovered.length} of ${tokens.length} command(s) NOT covered in root docs/knowledge/:\n` +
      uncovered.map((t) => `  - guild:${t} (plugin/commands/${t}.md)`).join("\n") +
      `\n  Rollout-coupling drift: a command shipped without its root reference docs.` +
      `\n  Fix: document each in docs/knowledge/ (canon: architecture/command-surface.md),` +
      `\n  or, if intentional, exclude it explicitly. Canon rule: workspace-knowledge-flow.md Rule 2.\n`,
  );
  return warn ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

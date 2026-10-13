/**
 * tests/dot-guild/gitignore-equivalence.test.ts
 *
 * SC-9 (CQ-B): the plugin's share-dot-guild block carries the canonical policy
 * lines (the `.guild` ignore/re-include patterns), in the order that makes the
 * default-deny and the structural-cache re-deny hold.
 *
 * Checkout-robust: this reads the plugin repo ONLY. The cross-repo half of
 * CQ-B (umbrella, benchmark and website carry the SAME block) needs files that
 * do not exist on a plugin checkout, so it belongs to the umbrella workspace,
 * which holds all four .gitignore files.
 *
 * Strategy:
 *   1. Extract the share-dot-guild block: starting at the first `.guild`
 *      policy line (or the "# .guild/ —" header comment), collect every line
 *      matching a `.guild` pattern, skipping comments/blanks, and stop at the
 *      first non-comment line that is NOT a `.guild` pattern (e.g. the plugin's
 *      fixture exemptions `!benchmark/fixtures/**`, or `.claude/...`).
 *   2. Assert it contains sentinel lines from the start, middle, and end of the
 *      canonical block, so a silently truncated extraction can never pass; a
 *      planted truncated block proves the check still flags.
 */

import { describe, test, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";

function findPluginRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".git")) && fs.existsSync(path.join(current, ".gitignore"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(__dirname, "../..");
    current = parent;
  }
}

// Supports both the normal plugin checkout and plugin/.worktrees/<name>.
const PLUGIN_ROOT = findPluginRoot(__dirname);
const PLUGIN_GITIGNORE = path.join(PLUGIN_ROOT, ".gitignore");

// A share-dot-guild policy line: an ignore or re-include pattern targeting
// .guild — `.guild`, `!/.guild/`, `.guild/*`, `!.guild/wiki/**`, the runs
// re-deny/re-include patterns, etc. Deliberately does NOT match nested-fixture
// exemptions like `!benchmark/fixtures/**/.guild/` (those are repo-specific
// and act as the block's end stopper).
const GUILD_POLICY_LINE = /^!?\/?\.guild(\/|$)/;

/**
 * Sentinel lines that MUST appear in every extracted block — start, middle,
 * and end of the canonical sequence. If extraction truncates (or a repo lacks
 * the default-deny hardening), these fail loudly instead of comparing
 * fragments as equal.
 */
const REQUIRED_SENTINELS = [
  ".guild", // block start
  ".guild/*", // HIGH default-deny (Decision J remediation)
  "!.guild/adoption-manifest.json", // replay-safe capability localization authority
  "!.guild/wiki/**", // middle of the re-include list
  "!.guild/runs/*/run-state.json", // end of the runs share-set
  ".guild/runs/current-run-id", // last line of the canonical block
];

/**
 * Extract the share-dot-guild policy-line sequence from a .gitignore file.
 *
 * Start: the "# .guild/ —" header comment if present, else the first
 * GUILD_POLICY_LINE. From there, comments and blank lines are skipped,
 * policy lines are collected, and the first non-comment non-blank line that
 * is not a `.guild` pattern ends the block.
 *
 * Throws if no guild block is found at all.
 */
function extractGuildBlock(content: string, gitignorePath: string): string {
  const lines = content.split("\n");

  let blockStart = lines.findIndex((l) => l.startsWith("# .guild/ —"));
  if (blockStart === -1) {
    blockStart = lines.findIndex((l) => GUILD_POLICY_LINE.test(l));
  }
  if (blockStart === -1) {
    throw new Error(`No .guild block found in ${gitignorePath}`);
  }

  const blockLines: string[] = [];
  for (let i = blockStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.startsWith("#")) continue; // docs, not policy
    if (!GUILD_POLICY_LINE.test(line)) break; // stopper: end of the shared block
    blockLines.push(line);
  }

  if (blockLines.length === 0) {
    throw new Error(`Empty .guild block in ${gitignorePath}`);
  }

  return blockLines.join("\n");
}

/** The sentinel lines an extracted block is missing (empty = complete). */
function missingSentinels(block: string): string[] {
  const blockLines = new Set(block.split("\n"));
  return REQUIRED_SENTINELS.filter((sentinel) => !blockLines.has(sentinel));
}

/** Why the structural-cache re-deny does not hold, or null when it does. */
function structuralCacheDenyProblem(lines: string[]): string | null {
  const reinclude = lines.indexOf("!.guild/indexes/**");
  const deny = lines.indexOf("**/*.structural-cache.json");
  if (reinclude === -1) return 'missing "!.guild/indexes/**" re-include';
  if (deny === -1) {
    return 'missing "**/*.structural-cache.json" re-deny — a tampered structural-cache sidecar is committable via !.guild/indexes/**';
  }
  if (deny < reinclude) {
    return `"**/*.structural-cache.json" (line ${deny + 1}) must come AFTER "!.guild/indexes/**" (line ${reinclude + 1}) or the re-include wins`;
  }
  return null;
}

describe("gitignore-equivalence: the plugin share-dot-guild block is canonical (CQ-B)", () => {
  const content = fs.readFileSync(PLUGIN_GITIGNORE, "utf8");

  test("the plugin .gitignore has a .guild block (sanity)", () => {
    expect(extractGuildBlock(content, PLUGIN_GITIGNORE).length).toBeGreaterThan(0);
  });

  test("the extracted block spans the full canonical sequence (anti-vacuity)", () => {
    expect(missingSentinels(extractGuildBlock(content, PLUGIN_GITIGNORE))).toEqual([]);
  });

  test("CONTROL: a block truncated before its runs share-set is flagged", () => {
    const cut = content.slice(0, content.indexOf("!.guild/runs/*/run-state.json"));
    const missing = missingSentinels(extractGuildBlock(cut, "<truncated fixture>"));
    expect(missing).toContain("!.guild/runs/*/run-state.json");
    expect(missing).toContain(".guild/runs/current-run-id");
  });

  test("the structural-cache sidecar is re-denied AFTER the !.guild/indexes/** re-include", () => {
    // `**/*.structural-cache.json` is a `.guild/indexes/**` security override
    // (FIX-T4.1-r6) but is not a `.guild`-prefixed pattern, so block extraction
    // cannot see it — assert it directly, including the file-order requirement
    // (a later gitignore rule wins, so the deny must come after the re-include).
    expect(structuralCacheDenyProblem(content.split("\n"))).toBeNull();
  });

  test("CONTROL: a re-deny placed BEFORE the re-include is flagged", () => {
    const reordered = ["**/*.structural-cache.json", "!.guild/indexes/**"];
    expect(structuralCacheDenyProblem(reordered)).toMatch(/must come AFTER/);
    expect(structuralCacheDenyProblem(["!.guild/indexes/**"])).toMatch(/missing .* re-deny/);
  });
});

/**
 * tests/dot-guild/gitignore-equivalence.test.ts
 *
 * SC-9 (CQ-B): Assert the share-dot-guild block is identical across all 4
 * workspace repos (umbrella, plugin, benchmark, website), comparing the
 * POLICY LINES (the `.guild` ignore/re-include patterns) — comments and blank
 * lines are documentation and may differ per repo.
 *
 * Strategy:
 *   1. Read each repo's .gitignore.
 *   2. Extract the share-dot-guild block: starting at the first `.guild`
 *      policy line (or the "# .guild/ —" header comment), collect every line
 *      matching a `.guild` pattern, skipping comments/blanks, and stop at the
 *      first non-comment line that is NOT a `.guild` pattern (e.g. the plugin's
 *      fixture exemptions `!benchmark/fixtures/**`, or `.claude/...`). Repo-
 *      specific `.guild` rules (like the plugin's point-in-time incident
 *      re-denies) must therefore live BELOW such a stopper line.
 *   3. Assert the 4 extracted policy sequences are identical, and that each
 *      contains sentinel lines from the start, middle, and end of the
 *      canonical block — so a silently truncated extraction can never pass
 *      (anti-vacuity guard: the previous extractor stopped at any interior
 *      "# " comment and compared only a fragment).
 *
 * If any repo drifts, the test fails with a diff showing which repos diverge.
 *
 * NOTE: If the equivalence test fails, propagate the block change to the
 * lagging repos (each in its own repo/commit) — see the HIGH default-deny
 * remediation: the `.guild/*` deny line means an unlisted subtree is never
 * committable by default, in ALL 4 repos equally.
 */

import * as fs from "fs";
import * as path from "path";

// Workspace root: 4 levels up from this test file
const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

const REPOS = {
  umbrella: WORKSPACE_ROOT,
  plugin: path.join(WORKSPACE_ROOT, "plugin"),
  benchmark: path.join(WORKSPACE_ROOT, "benchmark"),
  website: path.join(WORKSPACE_ROOT, "website"),
};

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
function extractGuildBlock(gitignorePath: string): string {
  if (!fs.existsSync(gitignorePath)) {
    throw new Error(`No .gitignore found at ${gitignorePath}`);
  }

  const content = fs.readFileSync(gitignorePath, "utf8");
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

const SIBLINGS_PRESENT = ["umbrella", "benchmark", "website"].every((k) =>
  fs.existsSync(path.join(REPOS[k as keyof typeof REPOS], ".gitignore"))
);
if (!SIBLINGS_PRESENT) {
  // Plugin-only checkout (CI): the umbrella/benchmark/website .gitignore files
  // do not exist, so the 4-repo equivalence contract cannot be evaluated here.
  // It runs in the umbrella workspace (and in any full-workspace CI).
  console.warn("[gitignore-equivalence] sibling repos absent — plugin-only checkout; skipping 4-repo block comparison");
}
const describeIfSiblings = SIBLINGS_PRESENT ? describe : describe.skip;
describeIfSiblings("gitignore-equivalence: share-dot-guild block identical across 4 repos (CQ-B)", () => {
  const blocks: Record<string, string> = {};
  const extractionErrors: Record<string, string> = {};

  beforeAll(() => {
    for (const [name, repoPath] of Object.entries(REPOS)) {
      const gitignorePath = path.join(repoPath, ".gitignore");
      try {
        blocks[name] = extractGuildBlock(gitignorePath);
      } catch (e) {
        extractionErrors[name] = (e as Error).message;
        blocks[name] = "";
      }
    }
  });

  test("all 4 repos have a .gitignore with a .guild block (sanity)", () => {
    for (const [name] of Object.entries(REPOS)) {
      if (extractionErrors[name]) {
        throw new Error(
          `${name}: failed to extract .guild block — ${extractionErrors[name]}`
        );
      }
      expect(blocks[name].length).toBeGreaterThan(0);
    }
  });

  test("every extracted block spans the full canonical sequence (anti-vacuity)", () => {
    for (const [name] of Object.entries(REPOS)) {
      const blockLines = new Set(blocks[name].split("\n"));
      for (const sentinel of REQUIRED_SENTINELS) {
        if (!blockLines.has(sentinel)) {
          throw new Error(
            `${name}: extracted .guild block is missing required line ${JSON.stringify(sentinel)} — ` +
              `either the block is truncated/drifted or the default-deny hardening is absent`
          );
        }
      }
    }
  });

  test("every repo re-denies the structural-cache sidecar AFTER the !.guild/indexes/** re-include", () => {
    // `**/*.structural-cache.json` is a `.guild/indexes/**` security override
    // (FIX-T4.1-r6) but is not a `.guild`-prefixed pattern, so block extraction
    // cannot see it — assert it directly, including the file-order requirement
    // (a later gitignore rule wins, so the deny must come after the re-include).
    for (const [name, repoPath] of Object.entries(REPOS)) {
      const lines = fs
        .readFileSync(path.join(repoPath, ".gitignore"), "utf8")
        .split("\n");
      const reinclude = lines.indexOf("!.guild/indexes/**");
      const deny = lines.indexOf("**/*.structural-cache.json");
      if (reinclude === -1) {
        throw new Error(`${name}: missing "!.guild/indexes/**" re-include`);
      }
      if (deny === -1) {
        throw new Error(
          `${name}: missing "**/*.structural-cache.json" re-deny — a tampered structural-cache sidecar is committable via !.guild/indexes/**`
        );
      }
      if (deny < reinclude) {
        throw new Error(
          `${name}: "**/*.structural-cache.json" (line ${deny + 1}) must come AFTER "!.guild/indexes/**" (line ${reinclude + 1}) or the re-include wins`
        );
      }
    }
  });

  for (const other of ["plugin", "benchmark", "website"] as const) {
    test(`umbrella and ${other} share-dot-guild policy lines are identical`, () => {
      if (extractionErrors.umbrella || extractionErrors[other]) {
        throw new Error(
          `Extraction error: umbrella=${extractionErrors.umbrella ?? "ok"} ${other}=${extractionErrors[other] ?? "ok"}`
        );
      }
      if (blocks.umbrella !== blocks[other]) {
        const diff = buildDiff("umbrella", blocks.umbrella, other, blocks[other]);
        throw new Error(
          `umbrella vs ${other} .gitignore share-dot-guild blocks differ:\n\n${diff}`
        );
      }
      expect(blocks.umbrella).toBe(blocks[other]);
    });
  }
});

/** Build a simple line-level diff between two strings for error messages. */
function buildDiff(aName: string, a: string, bName: string, b: string): string {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const maxLen = Math.max(aLines.length, bLines.length);
  const diffs: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const al = aLines[i] ?? "<absent>";
    const bl = bLines[i] ?? "<absent>";
    if (al !== bl) {
      diffs.push(`  line ${i + 1}:`);
      diffs.push(`    ${aName}: ${JSON.stringify(al)}`);
      diffs.push(`    ${bName}: ${JSON.stringify(bl)}`);
    }
  }
  return diffs.length === 0
    ? "(no line differences found but strings differ — possibly whitespace)"
    : diffs.join("\n");
}

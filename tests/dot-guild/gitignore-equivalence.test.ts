/**
 * tests/dot-guild/gitignore-equivalence.test.ts
 *
 * SC-9 (CQ-B): Assert the share-dot-guild block is byte-identical across all
 * 4 workspace repos (umbrella, plugin, benchmark, website) modulo the plugin's
 * pre-existing fixture exemptions.
 *
 * Strategy:
 *   1. Read each repo's .gitignore.
 *   2. Extract the share-dot-guild block. The block starts at:
 *      - "# .guild/ —" (preferred comment header), OR
 *      - the first line that starts with ".guild" or "!.guild" (fallback for
 *        repos where Lane B applied the block without the comment header).
 *   3. For the plugin repo: strip the leading fixture-exemption lines (the
 *      non-negotiable "!benchmark/fixtures/**" and "!mcp-servers/..." blocks
 *      preserved verbatim per spec constraints). extractGuildBlock already
 *      starts at the header so these are excluded automatically.
 *   4. Assert the 4 stripped blocks are byte-identical.
 *
 * If any repo drifts, the test fails with a diff showing which repos diverge.
 *
 * NOTE: If the equivalence test fails, file a followup for Lane B (tooling-engineer)
 * with the diff output. This test is the enforcement gate for CQ-B.
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

/**
 * Extract the share-dot-guild block from a .gitignore file.
 *
 * Block detection:
 *   - Preferred: starts at the line "# .guild/ —" (the canonical block header)
 *   - Fallback: starts at the first line that begins with ".guild" or "!.guild"
 *     (handles repos where Lane B applied the block without the header)
 *
 * Block end: first line that starts with "# " and is NOT "# Re-deny",
 * after the block has started. Or EOF.
 *
 * Returns the block as a trimmed string for comparison.
 * Throws if no guild block is found at all.
 */
function extractGuildBlock(gitignorePath: string): string {
  if (!fs.existsSync(gitignorePath)) {
    throw new Error(`No .gitignore found at ${gitignorePath}`);
  }

  const content = fs.readFileSync(gitignorePath, "utf8");
  const lines = content.split("\n");

  // Try preferred header first
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("# .guild/ —")) {
      blockStart = i;
      break;
    }
  }

  // Fallback: first .guild or !.guild line
  if (blockStart === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(".guild") || lines[i].startsWith("!.guild")) {
        blockStart = i;
        break;
      }
    }
  }

  if (blockStart === -1) {
    throw new Error(`No .guild block found in ${gitignorePath}`);
  }

  // Collect block lines until a new non-guild comment section
  const blockLines: string[] = [];
  for (let i = blockStart; i < lines.length; i++) {
    const line = lines[i];
    // Stop at a new comment section that is not "# Re-deny"
    if (
      i > blockStart &&
      line.startsWith("# ") &&
      !line.startsWith("# Re-deny")
    ) {
      break;
    }
    // Also stop at a blank line after we've already collected some block content
    // UNLESS we haven't seen the re-deny section yet (blank line between header and block)
    blockLines.push(line);
  }

  // Trim trailing empty lines
  while (blockLines.length > 0 && blockLines[blockLines.length - 1].trim() === "") {
    blockLines.pop();
  }

  // Normalize: strip the optional comment header so comparison focuses on
  // the policy content, not the comment text (which may vary slightly)
  const normalizedLines = blockLines.filter(
    (l) => !l.startsWith("# .guild/ —") && !l.startsWith("# Re-deny")
  );

  return normalizedLines.join("\n").trim();
}

describe("gitignore-equivalence: share-dot-guild block identical across 4 repos (CQ-B)", () => {
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

  test("umbrella and plugin share-dot-guild blocks are byte-identical", () => {
    if (extractionErrors.umbrella || extractionErrors.plugin) {
      throw new Error(
        `Extraction error: umbrella=${extractionErrors.umbrella ?? "ok"} plugin=${extractionErrors.plugin ?? "ok"}`
      );
    }
    if (blocks.umbrella !== blocks.plugin) {
      const diff = buildDiff("umbrella", blocks.umbrella, "plugin", blocks.plugin);
      throw new Error(
        `umbrella vs plugin .gitignore share-dot-guild blocks differ:\n\n${diff}`
      );
    }
    expect(blocks.umbrella).toBe(blocks.plugin);
  });

  test("umbrella and benchmark share-dot-guild blocks are byte-identical", () => {
    if (extractionErrors.umbrella || extractionErrors.benchmark) {
      throw new Error(
        `Extraction error: umbrella=${extractionErrors.umbrella ?? "ok"} benchmark=${extractionErrors.benchmark ?? "ok"}`
      );
    }
    if (blocks.umbrella !== blocks.benchmark) {
      const diff = buildDiff("umbrella", blocks.umbrella, "benchmark", blocks.benchmark);
      throw new Error(
        `umbrella vs benchmark .gitignore share-dot-guild blocks differ:\n\n${diff}`
      );
    }
    expect(blocks.umbrella).toBe(blocks.benchmark);
  });

  test("umbrella and website share-dot-guild blocks are byte-identical", () => {
    if (extractionErrors.umbrella || extractionErrors.website) {
      throw new Error(
        `Extraction error: umbrella=${extractionErrors.umbrella ?? "ok"} website=${extractionErrors.website ?? "ok"}`
      );
    }
    if (blocks.umbrella !== blocks.website) {
      const diff = buildDiff("umbrella", blocks.umbrella, "website", blocks.website);
      throw new Error(
        `umbrella vs website .gitignore share-dot-guild blocks differ:\n\n${diff}`
      );
    }
    expect(blocks.umbrella).toBe(blocks.website);
  });
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

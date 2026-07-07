/**
 * tests/dot-guild/install-sh-equivalence.test.ts
 *
 * Installer byte-identity gate: `plugin/install.sh` (repo root of this repo)
 * is the CANONICAL SOURCE of the Guild installer; `website/public/install.sh`
 * is the served copy behind the primary one-liner
 * (`curl -fsSL https://guildstack.dev/install.sh | bash`), with the raw
 * GitHub URL (`raw.githubusercontent.com/lookatitude/guild/main/install.sh`)
 * as the always-available fallback. The two files must stay byte-for-byte
 * identical — operator decision 2026-06-11 (domain-independent install).
 *
 * Sibling-repo pattern (same as gitignore-equivalence.test.ts): the website
 * repo is a sibling checkout in the 4-repo workspace. When it is absent
 * (e.g. plugin repo cloned standalone in CI), skip gracefully instead of
 * failing — the gate is enforceable only where both checkouts exist.
 */

import * as fs from "fs";
import * as path from "path";

// Plugin repo root: 2 levels up from this test file (tests/dot-guild/)
const PLUGIN_ROOT = path.resolve(__dirname, "../..");
// Workspace root: the plugin repo's parent in the 4-repo workspace layout
const WORKSPACE_ROOT = path.resolve(PLUGIN_ROOT, "..");

const CANONICAL = path.join(PLUGIN_ROOT, "install.sh");
const SERVED_COPY = path.join(WORKSPACE_ROOT, "website", "public", "install.sh");

describe("install-sh-equivalence: plugin/install.sh === website/public/install.sh (byte-for-byte)", () => {
  test("canonical installer exists at the plugin repo root", () => {
    expect(fs.existsSync(CANONICAL)).toBe(true);
  });

  test("served copy is byte-identical to the canonical source", () => {
    if (!fs.existsSync(path.join(WORKSPACE_ROOT, "website"))) {
      // Sibling website checkout absent (standalone plugin clone) — skip.
      console.warn(
        "install-sh-equivalence: sibling website/ checkout not found — skipping byte-identity assertion"
      );
      return;
    }

    expect(fs.existsSync(SERVED_COPY)).toBe(true);

    const canonical = fs.readFileSync(CANONICAL);
    const served = fs.readFileSync(SERVED_COPY);

    if (!canonical.equals(served)) {
      const diff = buildDiff(
        "plugin/install.sh",
        canonical.toString("utf8"),
        "website/public/install.sh",
        served.toString("utf8")
      );
      throw new Error(
        `plugin/install.sh and website/public/install.sh differ — re-copy the canonical source ` +
          `(cp plugin/install.sh website/public/install.sh):\n\n${diff}`
      );
    }
    expect(canonical.equals(served)).toBe(true);
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
    ? "(no line differences found but strings differ — possibly whitespace or EOL)"
    : diffs.join("\n");
}

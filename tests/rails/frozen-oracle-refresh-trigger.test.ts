/**
 * tests/rails/frozen-oracle-refresh-trigger.test.ts
 *
 * G06 R4 (M7) — every frozen oracle carries refresh_trigger metadata.
 *
 * A frozen oracle is a test that hard-codes a pre-collapse reference
 * ("Frozen reference" / "frozen oracle") and asserts the live impl still
 * equals it. Without a recorded trigger nobody knows when the freeze may be
 * lifted, so the oracle either rots or gets edited to match a regression.
 *
 * Required: exactly one header line of the form
 *
 *   * refresh_trigger: {"owner": "...", "when": "...", "source": "<repo path>"}
 *
 * owner and when are non-empty strings; source is the repo-relative canonical
 * file the oracle pins, and it must exist. This rail refuses any frozen oracle
 * without a valid block.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(__dirname, "..", "..");
const SELF = "tests/rails/frozen-oracle-refresh-trigger.test.ts";
const SCAN_ROOTS = ["src", "scripts", "hooks", "tests", "mcp-servers"];
const SKIP_DIRS = new Set(["node_modules", "dist", "fixtures", ".worktrees"]);
const ORACLE_RE = /frozen[ -](?:reference|oracle)/i;
const TRIGGER_RE = /^\s*\*?\s*refresh_trigger:\s*(\{.*\})\s*$/gm;

/** The four oracles G06 R4 names; the scan must keep finding each. */
const KNOWN_ORACLES = [
  "src/domains/knowledge/bm25-parity.test.ts",
  "scripts/learn/lib/graph-scoring-parity.test.ts",
  "src/domains/security/safe-object-parity.test.ts",
  "src/domains/security/share-set-parity.test.ts",
];

export function refreshTriggerProblems(text: string, repoRoot: string): string[] {
  const blocks = [...text.matchAll(TRIGGER_RE)];
  if (blocks.length !== 1) return [`expected exactly 1 refresh_trigger line, found ${blocks.length}`];
  let meta: unknown;
  try {
    meta = JSON.parse(blocks[0][1]);
  } catch {
    return ["refresh_trigger is not valid JSON"];
  }
  const m = (meta ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of ["owner", "when", "source"]) {
    if (typeof m[key] !== "string" || (m[key] as string).trim() === "") problems.push(`refresh_trigger.${key} must be a non-empty string`);
  }
  const source = m["source"];
  if (typeof source === "string" && source.trim() !== "") {
    if (path.isAbsolute(source) || source.split("/").includes("..")) problems.push("refresh_trigger.source must be repo-relative");
    else if (!fs.existsSync(path.join(repoRoot, source))) problems.push(`refresh_trigger.source does not exist: ${source}`);
  }
  return problems;
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (/\.test\.[cm]?ts$/.test(entry.name)) out.push(abs);
  }
}

function frozenOracles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(path.join(REPO, root), files);
  return files
    .map((abs) => path.relative(REPO, abs).split(path.sep).join("/"))
    .filter((rel) => rel !== SELF && ORACLE_RE.test(fs.readFileSync(path.join(REPO, rel), "utf8")))
    .sort();
}

describe("G06 R4 — frozen oracles carry refresh_trigger metadata", () => {
  const oracles = frozenOracles();

  test("the scan finds every named frozen oracle", () => {
    for (const known of KNOWN_ORACLES) expect(oracles).toContain(known);
  });

  test("every frozen oracle has a valid refresh_trigger block", () => {
    const failures = oracles.flatMap((rel) =>
      refreshTriggerProblems(fs.readFileSync(path.join(REPO, rel), "utf8"), REPO).map((p) => `${rel}: ${p}`),
    );
    expect(failures).toEqual([]);
  });

  test("anti-vacuity: missing, duplicate, malformed and dangling blocks are refused", () => {
    const ok = ' * refresh_trigger: {"owner": "tooling-engineer", "when": "canonical change", "source": "src/domains/knowledge/bm25.ts"}';
    expect(refreshTriggerProblems("// Frozen reference: no metadata", REPO)).toHaveLength(1);
    expect(refreshTriggerProblems(`${ok}\n${ok}`, REPO)).toHaveLength(1);
    expect(refreshTriggerProblems(" * refresh_trigger: {owner: x}", REPO)).toEqual(["refresh_trigger is not valid JSON"]);
    expect(refreshTriggerProblems(' * refresh_trigger: {"owner": "", "when": "x", "source": "src/domains/knowledge/bm25.ts"}', REPO)).toHaveLength(1);
    expect(refreshTriggerProblems(' * refresh_trigger: {"owner": "a", "when": "b", "source": "src/nope/missing.ts"}', REPO)).toHaveLength(1);
    expect(refreshTriggerProblems(' * refresh_trigger: {"owner": "a", "when": "b", "source": "../outside.ts"}', REPO)).toHaveLength(1);
    expect(refreshTriggerProblems(ok, REPO)).toEqual([]);
  });
});

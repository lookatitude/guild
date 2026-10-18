/**
 * G06 R6 — ONE canonical Claude tier ladder.
 *
 * `CLAUDE_TIER_FALLBACK` and `tierForModel` are defined once, in
 * src/domains/config/tier-defaults.ts. Every other site imports them. The one
 * literal restatement allowed is the config-defaults.ts scaffold (its contract
 * forbids internal imports), so it is parity-pinned here instead.
 *
 * Unknown-model default: `tierForModel` returns null (no ladder rung matches).
 * A caller that must fill a tier field applies "mid" itself, the same way in
 * roster.ts, self-build-canonicalize.ts and workspace-role-localize.ts.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { CLAUDE_TIER_FALLBACK, DEFAULTS, tierForModel } from "../../src/domains/config/index";
import { tierForModel as rosterTierForModel } from "../../scripts/lib/roster";
import { CLAUDE_TIER_FALLBACK as hookTierFallback } from "../../hooks/lib/tier-dispatch";

const REPO = path.resolve(__dirname, "..", "..");
const CANONICAL = "src/domains/config/tier-defaults.ts";
// This file holds the patterns and planted copies; it is not a ladder copy.
const SELF = "tests/rails/tier-ladder-single-source.test.ts";
const SCAN_ROOTS = ["src", "scripts", "hooks", "tests"];
const SKIP_DIRS = new Set(["node_modules", "dist", "fixtures", "perf-corpus", ".worktrees"]);

/** Declarations that would be a second copy of the ladder or the model→tier rule. */
const COPY_PATTERNS: Array<[string, RegExp]> = [
  ["CLAUDE_TIER_FALLBACK declaration", /\b(?:const|let|var)\s+CLAUDE_TIER_FALLBACK\b/],
  ["tierForModel definition", /\bfunction\s+tierForModel\b|\b(?:const|let|var)\s+tierForModel\s*[:=]/],
  ["model→tier literal map", /\bhaiku\s*:\s*["']cheap["']/],
];

export function findLadderCopies(rel: string, text: string): string[] {
  if (rel === CANONICAL || rel === SELF) return [];
  return COPY_PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => `${rel}: ${label}`);
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (/\.[cm]?ts$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(abs);
  }
}

describe("G06 R6 — single-source Claude tier ladder", () => {
  test("tierForModel maps the ladder and returns null for an unknown model", () => {
    expect(tierForModel("opus")).toBe("powerful");
    expect(tierForModel("sonnet")).toBe("mid");
    expect(tierForModel("haiku")).toBe("cheap");
    expect(tierForModel("claude-opus-4-8")).toBe("powerful");
    expect(tierForModel("Claude-Haiku-4-5-20251001")).toBe("cheap");
    expect(tierForModel("gpt-5.5")).toBeNull();
    expect(tierForModel("")).toBeNull();
    expect(tierForModel(null)).toBeNull();
  });

  test("tierForModel is the inverse of CLAUDE_TIER_FALLBACK", () => {
    for (const [tier, model] of Object.entries(CLAUDE_TIER_FALLBACK)) {
      expect(tierForModel(model)).toBe(tier as keyof typeof CLAUDE_TIER_FALLBACK);
    }
  });

  test("roster.ts and the hook bundle use the canonical objects, not copies", () => {
    expect(rosterTierForModel).toBe(tierForModel);
    expect(hookTierFallback).toBe(CLAUDE_TIER_FALLBACK);
  });

  test("config-defaults.ts scaffold matches the canonical ladder for claude-code-cli", () => {
    for (const tier of ["cheap", "mid", "powerful"] as const) {
      expect(DEFAULTS.models.tiers[tier]["claude-code-cli"]).toBe(CLAUDE_TIER_FALLBACK[tier]);
    }
  });

  test("no file outside tier-defaults.ts restates the ladder or the model→tier rule", () => {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) walk(path.join(REPO, root), files);
    expect(files.length).toBeGreaterThan(500);
    const copies = files.flatMap((abs) =>
      findLadderCopies(path.relative(REPO, abs).split(path.sep).join("/"), fs.readFileSync(abs, "utf8")),
    );
    expect(copies).toEqual([]);
  });

  test("anti-vacuity: the scan flags each planted copy and skips the canonical file", () => {
    expect(findLadderCopies("hooks/lib/x.ts", "export const CLAUDE_TIER_FALLBACK = {};")).toHaveLength(1);
    expect(findLadderCopies("scripts/lib/x.ts", "const tierForModel = (m: string) => 'mid';")).toHaveLength(1);
    expect(findLadderCopies("scripts/lib/x.ts", "export function tierForModel(m) { return null; }")).toHaveLength(1);
    expect(findLadderCopies("tests/x.ts", 'const M = { haiku: "cheap" };')).toHaveLength(1);
    expect(findLadderCopies(CANONICAL, "export const CLAUDE_TIER_FALLBACK = {};")).toEqual([]);
  });
});

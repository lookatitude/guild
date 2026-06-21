/**
 * tests/universal-host/p2-w1-sc9-no-regression.test.ts
 *
 * SC-W1-9 — no unintended default-path change. The full scripts/ + tests/ suites green
 * in-band is the primary gate; this file adds the FALSIFIABLE A/B determinism checks that
 * pin the new P2-W1 pure surfaces (additive, no clock/random) so a nondeterminism or
 * silent default-shape drift fails fast. The ONE allowlisted intentional re-baseline is the
 * config-schema-extension golden (LW1-9-signed) — NOT these.
 */
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { classifyIntake } from "../../scripts/lib/classify-intake";
import { detectImpact } from "../../scripts/lib/workspace-impact-detector";
import { validateExploreV1, EXPLORE_V1_EXAMPLE } from "../../scripts/lib/explore-schema";
import { validateDefineV1, DEFINE_V1_EXAMPLE } from "../../scripts/lib/define-schema";
import type { DependencyGraphV1 } from "../../scripts/lib/dependency-graph-schema";

const GRAPH: DependencyGraphV1 = {
  schema_version: "guild.dependency_graph.v1",
  nodes: [
    { id: "plugin", path: "plugin" },
    { id: "website", path: "website" },
    { id: "benchmark", path: "benchmark" },
  ],
  edges: [
    { from: "website", to: "plugin" },
    { from: "benchmark", to: "website" },
  ],
};

describe("SC-W1-9 — additive pure surfaces are deterministic (A/B)", () => {
  it("classifyIntake: same prompt ⇒ byte-identical result", () => {
    const p = "I have an idea for an app that helps neighbors share tools";
    expect(JSON.stringify(classifyIntake(p))).toBe(JSON.stringify(classifyIntake(p)));
  });

  it("detectImpact: same graph + change-set ⇒ byte-identical map", () => {
    expect(JSON.stringify(detectImpact(GRAPH, ["plugin"]))).toBe(
      JSON.stringify(detectImpact(GRAPH, ["plugin"]))
    );
  });

  it("validators: stable verdict on the producer examples (no drift)", () => {
    expect(validateExploreV1(EXPLORE_V1_EXAMPLE).valid).toBe(true);
    expect(validateDefineV1(DEFINE_V1_EXAMPLE).valid).toBe(true);
  });

  it("the intake tuning preserved the five over-fire NEGATIVES (precision floor held)", () => {
    const overfire = [
      "What if we built an endpoint that creates invoices?",
      "I want to create a script that migrates users to the new table",
      "Thinking about a small script to rotate old logs",
      "What if we made a hook that validates receipts?",
      "I would like to build a tool for debugging flaky tests",
    ];
    for (const p of overfire) expect(classifyIntake(p).intake).toBe("other");
  });
});

// ── SC-W1-9 named A/B over the command / hook / package entry paths (FIX 3) ──────
//
// R4: prove this wave did NOT silently change a default-output entry path. The A/B is
// worktree-vs-HEAD (git is the A=committed / B=working-tree comparator) over the
// command / hook / package surfaces; the changed set MUST be a subset of an EXPLICIT
// allowlist. The ONE intentional default-output delta this wave is the config-schema-
// extension scaffold, which lives under the CONFIG path (scripts/lib/config-schema.ts +
// the re-baselined tests/.../config-init-baseline.json) and is byte-pinned separately by
// scripts/__tests__/config-reconcile.test.ts (`scaffold() === config-init-baseline.json`).
// So the command/hook/package allowlist is EMPTY — those entry paths must be byte-identical.
const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const ENTRY_PATHS = ["commands", "hooks", ".claude-plugin"];
// Intentional new/changed entrypoints permitted under the three paths above.
//
// HOST-ADAPTER RECONCILE (run-host-adapter-reconcile-20260621, lane HA-2): the landed
// host-adapter migration (R0–R13) legitimately changed `hooks/**` entry-path files. Each
// delta below was verified (git diff HEAD) to be that intended migration work — additive,
// coherent, no behavior deletions/corruption — NOT a regression:
//   - hooks/lib/guild-hook-event.ts ....... GuildHostKind extended to the 9-host roster +
//                                           new pi/antigravity/app/connector emitters.
//   - hooks/lib/run-state.ts .............. R5 host-native model-params (LaneModelParams).
//   - hooks/dist/{run-trace,run-trace-start,run-trace-close,learning-backstop}.js
//                                           recompiled bundles embedding the above.
//   - hooks/lib/__tests__/run-state.test.ts ......... covers the R5 host modelParams block.
//   - hooks/lib/__tests__/guild-hook-event.test.ts .. (new) covers the new host emitters.
//   - hooks/__tests__/using-guild-bootstrap.test.ts + hooks/__tests__/golden/
//     using-guild-session-start.json ...... golden regenerated from current using-guild
//                                           source (product-loop intake section); the test
//                                           re-asserts golden===source, so the delta is
//                                           intentional and pinned, not silent drift.
// The allowlist stays EXPLICIT (named files, never a wildcard) so any OTHER entry-path
// change still fails the A/B guard below — anti-vacuity preserved. After the lead commits
// these files HEAD advances, the diff empties, and these entries become harmless no-ops.
const ENTRY_ALLOWLIST = new Set<string>([
  "hooks/lib/guild-hook-event.ts",
  "hooks/lib/run-state.ts",
  "hooks/dist/run-trace.js",
  "hooks/dist/run-trace-start.js",
  "hooks/dist/run-trace-close.js",
  "hooks/dist/learning-backstop.js",
  "hooks/lib/__tests__/run-state.test.ts",
  "hooks/lib/__tests__/guild-hook-event.test.ts",
  "hooks/__tests__/using-guild-bootstrap.test.ts",
  "hooks/__tests__/golden/using-guild-session-start.json",
]);

function gitLines(args: string[]): string[] {
  return execFileSync("git", ["-C", PLUGIN_ROOT, ...args], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

describe("SC-W1-9 — command/hook/package entry paths byte-identical vs HEAD (A/B + allowlist)", () => {
  it("no tracked entry-path file differs from HEAD outside the allowlist", () => {
    const modified = gitLines(["diff", "--name-only", "HEAD", "--", ...ENTRY_PATHS]);
    const offending = modified.filter((f) => !ENTRY_ALLOWLIST.has(f));
    expect(offending).toEqual([]);
  });

  it("no NEW (untracked) entrypoint snuck into command/hook/package outside the allowlist", () => {
    const untracked = gitLines(["status", "--porcelain", "--", ...ENTRY_PATHS])
      .filter((l) => l.startsWith("??"))
      .map((l) => l.replace(/^\?\?\s+/, ""));
    const offending = untracked.filter((f) => !ENTRY_ALLOWLIST.has(f));
    expect(offending).toEqual([]);
  });

  it("ANTI-VACUITY: the A/B comparator actually sees the repo (HEAD resolves, paths exist)", () => {
    // A bogus pathspec would make the diff trivially empty — prove the comparator is live by
    // confirming git knows these tracked entry paths (so an empty diff means 'unchanged', not 'unseen').
    const tracked = gitLines(["ls-files", "--", ...ENTRY_PATHS]);
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.some((f) => f.startsWith("commands/"))).toBe(true);
  });

  it("ANTI-VACUITY: the allowlist is TIGHT — a non-migration entry-path change would still fail", () => {
    // The allowlist names ONLY the host-adapter migration's verified deltas. Prove it did
    // not get widened to a wildcard: representative entry paths that are NOT part of the
    // migration must be absent, so the offending-filter above would still flag them.
    for (const notAllowed of [
      "commands/guild-build.md",
      ".claude-plugin/plugin.json",
      "hooks/hooks.json",
    ]) {
      expect(ENTRY_ALLOWLIST.has(notAllowed)).toBe(false);
    }
  });
});

/**
 * scripts/__tests__/failure-ingestion.test.ts
 *
 * P2-Wave-3 SC-W3-7 — AC37 failure → improvement-PROPOSAL ingestion (no self-edit).
 * Canonical contract: scripts/lib/failure-ingestion.ts (header); .guild/spec/universal-host-p2-wave3.md SC-W3-7.
 *
 * Coverage:
 *  - A fixture of REPEATED failures produces the THREE proposal kinds (skill_evolution,
 *    benchmark_fixture, template_improvement); a below-threshold one-off produces none.
 *  - Proposals route through the EXISTING reflect/evolve path: the reflection frontmatter
 *    carries `proposals.skill_improvement[]` (the key analyze-runs.ts aggregates).
 *  - Every proposal is PROPOSE-only (gate ∈ {human_approval, auto_propose}; never auto-apply).
 *  - **AC37 NO-SELF-EDIT NEGATIVE TEST (anti-vacuous, spy-based):** running the full
 *    ingest+emit over the fixture writes ONLY under .guild/reflections / .guild/evolve and
 *    NEVER to any runtime permission / skill (skills/**) / agent (agents/**, .claude/agents/**)
 *    file. Proven non-vacuous by (a) asserting the 3 proposal kinds really were produced and
 *    (b) a known-positive control where a real forbidden write trips the spy, plus a
 *    fail-closed guard test that the emitter REFUSES a redirected skills/agents target.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  FAILURE_PROPOSAL_KINDS,
  DEFAULT_MIN_REPEATS,
  FAILURE_FIXTURE,
  ingestFailures,
  renderReflectionMarkdown,
  emitFailureProposals,
  isRuntimeSurfacePath,
  runSelfCheck,
  type ProductWorkflowFailure,
} from "../lib/failure-ingestion";

const META = { run_id: "run-ac37-test", date: "2026-06-17" };

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ac37-"));
}

describe("AC37 ingestion — repeated failures → three proposal kinds", () => {
  it("produces all three proposal kinds for a repeated signature", () => {
    const { proposals, clusters } = ingestFailures(FAILURE_FIXTURE);
    const kinds = new Set(proposals.map((p) => p.kind));
    expect([...FAILURE_PROPOSAL_KINDS].every((k) => kinds.has(k))).toBe(true);
    // the repeated signature clustered; the one-off did not.
    expect(clusters.map((c) => c.signature)).toEqual(["explore-stalls-on-vague-idea"]);
    expect(clusters[0].occurrences).toBe(3);
  });

  it("drops a below-threshold one-off failure (no proposal)", () => {
    const { proposals } = ingestFailures(FAILURE_FIXTURE);
    expect(proposals.some((p) => p.signature === "one-off-flake")).toBe(false);
  });

  it("honors a custom minRepeats threshold", () => {
    const two: ProductWorkflowFailure[] = [
      { run_id: "r1", stage: "explore", signature: "sig" },
      { run_id: "r2", stage: "explore", signature: "sig" },
    ];
    expect(ingestFailures(two, { minRepeats: 3 }).proposals).toHaveLength(0);
    expect(ingestFailures(two, { minRepeats: 2 }).proposals).toHaveLength(3);
  });

  it("uses the analyze-runs default repeat threshold", () => {
    expect(DEFAULT_MIN_REPEATS).toBe(3);
  });

  it("every proposal is PROPOSE-only (never an auto-apply gate)", () => {
    const { proposals } = ingestFailures(FAILURE_FIXTURE);
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      expect(["human_approval", "auto_propose"]).toContain(p.promotion_gate);
    }
  });

  it("ignores entries with an empty/missing signature", () => {
    const noisy = [
      { run_id: "r", stage: "explore", signature: "" },
      ...FAILURE_FIXTURE,
    ] as ProductWorkflowFailure[];
    const { clusters } = ingestFailures(noisy);
    expect(clusters.map((c) => c.signature)).toEqual(["explore-stalls-on-vague-idea"]);
  });

  it("runSelfCheck passes", () => {
    const { pass, details } = runSelfCheck();
    expect(pass).toBe(true);
    expect(details).toContain("all-three-kinds=true");
  });
});

describe("AC37 ingestion — routes through the existing reflect/evolve path", () => {
  it("reflection frontmatter carries proposals.skill_improvement[] (the analyze-runs key)", () => {
    const result = ingestFailures(FAILURE_FIXTURE);
    const md = renderReflectionMarkdown(result, META);
    expect(md).toMatch(/^---/);
    expect(md).toContain("proposals:");
    // INLINE-ARRAY form of clean tokens — the only nested shape analyze-runs parses.
    expect(md).toMatch(/^\s+skill_improvement: \['[^,'\]]+'/m);
    expect(md).toContain("benchmark_fixture: [");
    expect(md).toContain("template_improvement: [");
    // the implicated skill becomes the aggregation token (product-explore in the fixture).
    expect(md).toMatch(/skill_improvement: \['product-explore'\]/);
  });

  it("REAL-PATH: the actual analyze-runs CLI parses the reflection + emits evolve-skill", () => {
    // The injected-seam trap: my own parser passing ≠ the real aggregator reading it.
    // analyze-runs.ts self-runs main() on import, so exercise it as a USER does — the real
    // CLI as a subprocess via the local tsx — over reflections we actually emitted to disk.
    // Emit 3 distinct-run reflections so the SAME token clears analyze-runs' min-runs=3.
    const root = mkTmp();
    const result = ingestFailures(FAILURE_FIXTURE);
    for (const rid of ["run-1", "run-2", "run-3"]) {
      emitFailureProposals(result, { run_id: rid, date: "2026-06-17", guildRoot: root });
    }
    const scriptsDir = path.resolve(__dirname, "..");
    const tsxBin = path.join(scriptsDir, "node_modules", ".bin", "tsx");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFileSync } = require("child_process") as typeof import("child_process");
    const out = execFileSync(
      tsxBin,
      ["analyze-runs.ts", "--cwd", root, "--min-runs", "3", "--format", "json"],
      { cwd: scriptsDir, encoding: "utf8", timeout: 25000 }
    );
    const report = JSON.parse(out);
    expect(report.reflections_read).toBe(3);
    const evolve = (report.proposals as Array<{ kind: string; target: string; run_count: number }>).filter(
      (p) => p.kind === "evolve-skill"
    );
    // The real CLI parsed our inline-array skill_improvement token and aggregated it 3×.
    expect(evolve.some((p) => p.target === "product-explore" && p.run_count === 3)).toBe(true);
  });

  it("emits exactly two files, both under .guild/reflections and .guild/evolve", () => {
    const root = mkTmp();
    const result = ingestFailures(FAILURE_FIXTURE);
    const { reflection_path, evolve_path } = emitFailureProposals(result, { ...META, guildRoot: root });
    expect(reflection_path).toBe(path.join(root, ".guild", "reflections", "run-ac37-test.md"));
    expect(evolve_path).toBe(path.join(root, ".guild", "evolve", "run-ac37-test-ac37-candidates.md"));
    expect(fs.existsSync(reflection_path)).toBe(true);
    expect(fs.existsSync(evolve_path)).toBe(true);
    expect(fs.readFileSync(reflection_path, "utf8")).toContain("skill_improvement:");
  });
});

describe("isRuntimeSurfacePath — the AC37 forbidden-path predicate", () => {
  it.each([
    "plugin/skills/meta/reflect/SKILL.md",
    "skills/core/foo.md",
    "agents/backend.md",
    "plugin/.claude/agents/tooling-engineer.md",
    "plugin/.claude-plugin/plugin.json",
    "commands/guild.md",
    "scripts/lib/permission-policy.ts",
    "/abs/path/.guild/settings.json",
  ])("flags %s as a runtime surface", (p) => {
    expect(isRuntimeSurfacePath(p)).toBe(true);
  });

  it.each([
    ".guild/reflections/run-a.md",
    ".guild/evolve/run-a-ac37-candidates.md",
    "/tmp/ac37-xyz/.guild/reflections/run.md",
  ])("does NOT flag the proposal path %s", (p) => {
    expect(isRuntimeSurfacePath(p)).toBe(false);
  });
});

/**
 * AC37 NO-SELF-EDIT — the property SC-W3-7 names explicitly:
 * "an anti-vacuous negative test asserts zero writes to any runtime permission / skill /
 * agent file (proposes, never self-applies)."
 */
describe("AC37 no-self-edit — ingestion writes ZERO runtime-surface files", () => {
  const WRITE_MUTATORS = [
    "writeFile",
    "writeFileSync",
    "appendFile",
    "appendFileSync",
    "rename",
    "renameSync",
    "rm",
    "rmSync",
    "unlink",
    "unlinkSync",
    "createWriteStream",
    "truncate",
    "truncateSync",
    "open",
    "openSync",
  ] as const;

  /** Spy all write mutators; record the path each was called with. */
  function spyWrites(): { paths: string[]; restore: () => void } {
    const paths: string[] = [];
    const spies = WRITE_MUTATORS.map((name) => {
      const orig = (fs as unknown as Record<string, unknown>)[name];
      if (typeof orig !== "function") return null;
      return jest
        .spyOn(fs as unknown as Record<string, (...a: unknown[]) => unknown>, name as never)
        .mockImplementation(((...args: unknown[]) => {
          paths.push(String(args[0]));
          return undefined as never;
        }) as never);
    });
    return { paths, restore: () => spies.forEach((s) => s?.mockRestore()) };
  }

  it("control: the spy actually records a real write (anti-vacuous)", () => {
    const { paths, restore } = spyWrites();
    try {
      fs.writeFileSync("skills/should-never-happen.md", "x"); // mocked — records, no real write
    } finally {
      restore();
    }
    expect(paths.some((p) => isRuntimeSurfacePath(p))).toBe(true);
  });

  it("full ingest+emit produces the 3 kinds AND writes NO runtime-surface file", () => {
    const result = ingestFailures(FAILURE_FIXTURE);
    // Non-vacuity: the run really produced the three proposal kinds.
    expect(new Set(result.proposals.map((p) => p.kind)).size).toBe(3);

    const { paths, restore } = spyWrites();
    try {
      // emit under a real tmp guildRoot; mkdirSync is also spied (records dir paths).
      emitFailureProposals(result, { ...META, guildRoot: path.join(os.tmpdir(), "ac37-emit") });
    } finally {
      restore();
    }

    // SOME write happened (proves emit ran, not a no-op).
    expect(paths.length).toBeGreaterThan(0);
    // ZERO of them touch a runtime permission / skill / agent surface.
    const forbidden = paths.filter((p) => isRuntimeSurfacePath(p));
    expect(forbidden).toEqual([]);
    // Every write lands under a proposal root.
    for (const p of paths) {
      const n = p.replace(/\\/g, "/");
      expect(/\.guild\/(reflections|evolve)(\/|$)/.test(n)).toBe(true);
    }
  });

  it("fail-closed: the emitter THROWS when the resolved target lands on a runtime surface", () => {
    const result = ingestFailures(FAILURE_FIXTURE);
    // Sanity: a clean guildRoot emits fine.
    expect(() => emitFailureProposals(result, { ...META, guildRoot: mkTmp() })).not.toThrow();
    // A guildRoot whose path itself contains a `skills/` segment makes the resolved
    // reflections target a runtime-surface path → the code guard MUST refuse (never write).
    const hostileRoot = path.join(mkTmp(), "skills", "proj");
    const { paths, restore } = spyWrites();
    let threw = false;
    try {
      emitFailureProposals(result, { ...META, guildRoot: hostileRoot });
    } catch {
      threw = true;
    } finally {
      restore();
    }
    expect(threw).toBe(true);
    // And it never wrote the reflection/evolve file (only the recursive mkdir may appear).
    expect(paths.some((p) => /\.md$/.test(p))).toBe(false);
  });
});

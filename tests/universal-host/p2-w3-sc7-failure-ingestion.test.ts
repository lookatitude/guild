/**
 * tests/universal-host/p2-w3-sc7-failure-ingestion.test.ts
 *
 * AUTHORITATIVE cross-cutting acceptance test for SC-W3-7 (ADR step 18 / AC37 — repeated
 * product-workflow failures → improvement PROPOSALS, never a self-edit).
 *
 * Binding assertions (anti-vacuity mandatory):
 *  (1) A fixture of REPEATED failures yields ALL THREE proposal kinds — skill_evolution /
 *      benchmark_fixture / template_improvement.
 *  (2) The proposals route through the REAL reflect/evolve path: emit reflections to a tmp
 *      `.guild/`, then run the REAL `analyze-runs.ts` CLI (subprocess) and confirm it
 *      aggregates the skill_evolution token into an `evolve-skill` proposal (≥ min-runs).
 *  (3) AC37 no-self-edit: a real fs write-spy proves ZERO writes to a runtime perms / skills /
 *      agents file (with a non-vacuous control that the spy fires on a real forbidden write),
 *      and the emitter's code guard REFUSES a runtime-surface target.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ingestFailures,
  emitFailureProposals,
  isRuntimeSurfacePath,
  FAILURE_FIXTURE,
  FAILURE_PROPOSAL_KINDS,
} from "../../scripts/lib/failure-ingestion";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const META = { run_id: "run-w3-sc7", date: "2026-06-17" };

const FS_WRITE_MUTATORS = [
  "writeFile", "writeFileSync", "appendFile", "appendFileSync",
  "rename", "renameSync", "rm", "rmSync", "unlink", "unlinkSync",
  "mkdir", "mkdirSync", "createWriteStream", "truncate", "truncateSync",
  "open", "openSync",
] as const;

function spyWrites(): { paths: string[]; restore: () => void } {
  const paths: string[] = [];
  const spies = FS_WRITE_MUTATORS.map((name) => {
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

describe("SC-W3-7 (1) — repeated failures yield all three proposal kinds", () => {
  it("produces skill_evolution + benchmark_fixture + template_improvement", () => {
    const { proposals, clusters } = ingestFailures(FAILURE_FIXTURE);
    const kinds = new Set(proposals.map((p) => p.kind));
    expect([...FAILURE_PROPOSAL_KINDS].every((k) => kinds.has(k))).toBe(true);
    // the below-threshold one-off in the fixture did NOT cluster.
    expect(clusters.some((c) => c.signature === "one-off-flake")).toBe(false);
  });

  it("anti-vacuity: a below-threshold set yields ZERO proposals (the threshold is real)", () => {
    const two = [
      { run_id: "r1", stage: "explore", signature: "sig" },
      { run_id: "r2", stage: "explore", signature: "sig" },
    ];
    expect(ingestFailures(two, { minRepeats: 3 }).proposals).toHaveLength(0);
    expect(ingestFailures(two, { minRepeats: 2 }).proposals.length).toBeGreaterThan(0);
  });

  it("every proposal is PROPOSE-only (never an auto-apply gate)", () => {
    for (const p of ingestFailures(FAILURE_FIXTURE).proposals) {
      expect(["human_approval", "auto_propose"]).toContain(p.promotion_gate);
    }
  });
});

describe("SC-W3-7 (2) — routes through the REAL reflect/evolve path (analyze-runs CLI)", () => {
  it("emitted reflections feed analyze-runs → an evolve-skill proposal surfaces (≥ min-runs)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "w3-sc7-evolve-"));
    const result = ingestFailures(FAILURE_FIXTURE);
    // Emit 3 distinct-run reflections so the SAME skill token clears analyze-runs min-runs=3.
    for (const rid of ["run-1", "run-2", "run-3"]) {
      emitFailureProposals(result, { run_id: rid, date: "2026-06-17", guildRoot: root });
    }
    const tsx = path.join(PLUGIN_ROOT, "scripts", "node_modules", ".bin", "tsx");
    const out = execFileSync(
      tsx,
      ["analyze-runs.ts", "--cwd", root, "--min-runs", "3", "--format", "json"],
      { cwd: path.join(PLUGIN_ROOT, "scripts"), encoding: "utf8", timeout: 30000 }
    );
    const report = JSON.parse(out);
    expect(report.reflections_read).toBe(3);
    const evolve = (report.proposals as Array<{ kind: string; target: string; run_count: number }>)
      .filter((p) => p.kind === "evolve-skill");
    expect(evolve.some((p) => p.target === "product-explore" && p.run_count === 3)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("anti-vacuity: the SAME analyze-runs over an EMPTY .guild yields zero proposals", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "w3-sc7-empty-"));
    fs.mkdirSync(path.join(empty, ".guild", "reflections"), { recursive: true });
    const tsx = path.join(PLUGIN_ROOT, "scripts", "node_modules", ".bin", "tsx");
    const out = execFileSync(
      tsx,
      ["analyze-runs.ts", "--cwd", empty, "--min-runs", "3", "--format", "json"],
      { cwd: path.join(PLUGIN_ROOT, "scripts"), encoding: "utf8", timeout: 30000 }
    );
    expect(JSON.parse(out).proposals).toEqual([]);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

describe("SC-W3-7 (3) — AC37 no-self-edit: ZERO writes to a runtime surface", () => {
  it("CONTROL: the write-spy fires on a real forbidden write (non-vacuous)", () => {
    const { paths, restore } = spyWrites();
    try {
      fs.writeFileSync("agents/should-never-happen.md", "x"); // mocked — records only
    } finally {
      restore();
    }
    expect(paths.some((p) => isRuntimeSurfacePath(p))).toBe(true);
  });

  it("full ingest+emit writes ONLY under .guild/{reflections,evolve}; ZERO runtime surface", () => {
    const result = ingestFailures(FAILURE_FIXTURE);
    expect(new Set(result.proposals.map((p) => p.kind)).size).toBe(3); // non-vacuous
    const { paths, restore } = spyWrites();
    try {
      emitFailureProposals(result, { ...META, guildRoot: path.join(os.tmpdir(), "w3-sc7-emit") });
    } finally {
      restore();
    }
    expect(paths.length).toBeGreaterThan(0); // emit ran
    expect(paths.filter((p) => isRuntimeSurfacePath(p))).toEqual([]); // none forbidden
    for (const p of paths) {
      expect(/\.guild\/(reflections|evolve)(\/|$)/.test(p.replace(/\\/g, "/"))).toBe(true);
    }
  });

  it("the emitter's code guard REFUSES a runtime-surface guildRoot (fail-closed, no .md write)", () => {
    const result = ingestFailures(FAILURE_FIXTURE);
    const hostile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "w3-sc7-hostile-")), "skills", "proj");
    const { paths, restore } = spyWrites();
    let threw = false;
    try {
      emitFailureProposals(result, { ...META, guildRoot: hostile });
    } catch {
      threw = true;
    } finally {
      restore();
    }
    expect(threw).toBe(true);
    expect(paths.some((p) => /\.md$/.test(p))).toBe(false);
  });
});

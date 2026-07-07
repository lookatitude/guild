/**
 * tests/universal-host/p2-w3-sc3-dashboard-isolation.test.ts
 *
 * AUTHORITATIVE cross-cutting acceptance test for SC-W3-3 (ADR step 18 / AC36 dashboard +
 * AC33 isolation) and the folded-in LW3-7a FU-2 (same-bytes child-wiki predicate).
 *
 * Binding assertions (anti-vacuity mandatory):
 *  (1) AC36 — projecting a real fixture repo yields ALL SIX sections, validateDashboardV1 passes.
 *  (2) AC33 ISOLATION (anti-vacuous): a fixture child repo carries a SENTINEL string in its
 *      `.guild/wiki/`; the projection (a) performs NO fs write (real write-spy) and (b) the
 *      sentinel does NOT appear anywhere in the projection output. Controls prove non-vacuity:
 *        - the sentinel IS present on disk (so its absence in the output is meaningful);
 *        - `guardDashboardReads` ACTUALLY throws + fires onDeny on a `.guild/wiki` read.
 *  (3) FU-2 — `isChildWikiPath` in dashboard-projector is NORMALIZED-SOURCE-IDENTICAL to the
 *      W1 canonical in dependency-graph-reader (whitespace-normalized `fn.toString()`; the two
 *      copies live in different modules with possibly different indentation, and normalized
 *      source still catches any token/logic divergence), so the AC33 rule cannot silently drift.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  projectDashboard,
  validateDashboardV1,
  DASHBOARD_SECTION_KEYS,
  guardDashboardReads,
  isChildWikiPath as dashIsChildWikiPath,
  createRealReadSeam,
  type DashboardReadSeam,
} from "../../scripts/lib/dashboard-projector";
import { isChildWikiPath as canonIsChildWikiPath } from "../../scripts/lib/dependency-graph-reader";

const SENTINEL = "SENTINEL_CHILD_WIKI_LEAK_a1b2c3d4";
const OPTS = { now: Date.parse("2026-06-17T00:00:00Z"), generated_at: "2026-06-17T00:00:00Z" };

let ROOT: string;

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "w3-sc3-dash-"));
  const g = (p: string) => path.join(ROOT, ".guild", p);
  fs.mkdirSync(g("indexes"), { recursive: true });
  fs.mkdirSync(g("spec"), { recursive: true });
  fs.mkdirSync(g("runs/run-fixture/handoffs"), { recursive: true });
  fs.mkdirSync(g("initiatives/active/demo"), { recursive: true });

  // workspace.json — a workspace with one child sub-guild (ids/paths/flags only).
  fs.writeFileSync(
    path.join(ROOT, ".guild", "workspace.json"),
    JSON.stringify({
      is_workspace: true,
      sub_guilds: [{ name: "childA", path: "childA", kind: "library", has_wiki: true, has_indexes: false, last_seen_commit: "abc123" }],
    })
  );
  // The CHILD wiki carries the sentinel — the projector must NEVER read it (AC33).
  fs.mkdirSync(path.join(ROOT, "childA", ".guild", "wiki", "decisions"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "childA", ".guild", "wiki", "decisions", "secret.md"),
    `# child decision\n\n${SENTINEL} — must never leak into the projection.\n`
  );
  // A spec with SC ids for the acceptance-criteria section.
  fs.writeFileSync(
    g("spec/demo.md"),
    `# Demo\n\n## Success criteria\n\n- **SC-D1 [AC36]** the dashboard renders.\n- **SC-D2** another.\n`
  );
  // A run + handoff for lane-progress / qa-readiness.
  fs.writeFileSync(g("runs/run-fixture/run.yaml"), `run_id: run-fixture\nphase: build\nstatus: open\ngates: {}\n`);
  fs.writeFileSync(g("runs/run-fixture/handoffs/dev-LD1.md"), `---\ntask_id: LD1\n---\nok\n`);
  fs.writeFileSync(g("runs/current-run-id"), "run-fixture\n");
  // An index manifest for the stale-knowledge section.
  fs.writeFileSync(g("indexes/codebase-map.json"), JSON.stringify({ generated_at: "2026-06-16T00:00:00Z" }));
});

afterAll(() => {
  if (ROOT) fs.rmSync(ROOT, { recursive: true, force: true });
});

const FS_WRITE_MUTATORS = [
  "writeFile", "writeFileSync", "appendFile", "appendFileSync", "rename", "renameSync",
  "rm", "rmSync", "unlink", "unlinkSync", "mkdir", "mkdirSync", "createWriteStream",
  "truncate", "truncateSync", "open", "openSync",
] as const;
function spyWrites(): { paths: string[]; restore: () => void } {
  const paths: string[] = [];
  const spies = FS_WRITE_MUTATORS.map((name) => {
    const orig = (fs as unknown as Record<string, unknown>)[name];
    if (typeof orig !== "function") return null;
    return jest
      .spyOn(fs as unknown as Record<string, (...a: unknown[]) => unknown>, name as never)
      .mockImplementation(((...args: unknown[]) => { paths.push(String(args[0])); return undefined as never; }) as never);
  });
  return { paths, restore: () => spies.forEach((s) => s?.mockRestore()) };
}

describe("SC-W3-3 (1) — AC36: all six dashboard sections present", () => {
  it("projection validates and carries ALL SIX sections", () => {
    const projection = projectDashboard(ROOT, createRealReadSeam(), OPTS);
    const v = validateDashboardV1(projection);
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
    for (const key of DASHBOARD_SECTION_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(projection.sections, key)).toBe(true);
    }
    expect(DASHBOARD_SECTION_KEYS.length).toBe(6);
  });

  it("anti-vacuity: validateDashboardV1 REJECTS a projection missing a section", () => {
    const projection = projectDashboard(ROOT, createRealReadSeam(), OPTS) as unknown as {
      sections: Record<string, unknown>;
    };
    delete projection.sections["qa_release_readiness"];
    expect(validateDashboardV1(projection).valid).toBe(false);
  });
});

describe("SC-W3-3 (2) — AC33 isolation: no write + no child-wiki content leak", () => {
  it("CONTROL: the sentinel IS present on disk (absence in the projection is meaningful)", () => {
    const disk = fs.readFileSync(path.join(ROOT, "childA", ".guild", "wiki", "decisions", "secret.md"), "utf8");
    expect(disk).toContain(SENTINEL);
  });

  it("CONTROL: the write-spy FIRES on a real dashboard-shaped fs write (the empty-set assertion is non-vacuous)", () => {
    // Mirror the SC-W3-1/4/7 write-spy controls: drive a real write THROUGH the spied mutators
    // and assert the spy captured it. Without this, `expect(paths).toEqual([])` below could pass
    // vacuously if spyWrites failed to intercept fs. The mock does NOT touch disk (no cleanup).
    const { paths, restore } = spyWrites();
    const dashboardDir = path.join(ROOT, ".guild", "dashboard");
    const dashboardOut = path.join(dashboardDir, "projection.json");
    try {
      fs.mkdirSync(dashboardDir);
      fs.writeFileSync(dashboardOut, "x");
    } finally {
      restore();
    }
    expect(paths).toContain(dashboardDir);
    expect(paths).toContain(dashboardOut);
  });

  it("the projection performs ZERO fs writes AND does NOT contain the child-wiki sentinel", () => {
    const { paths, restore } = spyWrites();
    let projection: unknown;
    try {
      projection = projectDashboard(ROOT, createRealReadSeam(), OPTS);
    } finally {
      restore();
    }
    expect(paths).toEqual([]); // read-only
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain(SENTINEL); // no child-wiki content copied
    // but the child id/path (non-wiki) DID surface — proves child health was projected.
    expect(serialized).toContain("childA");
  });

  it("CONTROL: guardDashboardReads ACTUALLY throws + fires onDeny on a .guild/wiki read", () => {
    const denied: string[] = [];
    const inner: DashboardReadSeam = { exists: () => true, readFile: () => "x", readDir: () => [] };
    const guarded = guardDashboardReads(inner, (p) => denied.push(p));
    expect(() => guarded.readFile(path.join(ROOT, "childA", ".guild", "wiki", "decisions", "secret.md"))).toThrow(/isolation/);
    expect(denied.length).toBe(1);
    // a non-wiki read passes through.
    expect(() => guarded.readFile(path.join(ROOT, ".guild", "workspace.json"))).not.toThrow();
  });
});

describe("SC-W3-3 (3) — FU-2: child-wiki predicate is normalized-source-identical to the W1 canonical", () => {
  it("dashboard isChildWikiPath is normalized-source-identical to the dependency-graph-reader canonical", () => {
    // Whitespace-normalized fn.toString() (NOT byte-equality — the two copies may be indented
    // differently in their modules); normalized source still catches any token/logic divergence.
    const norm = (fn: (p: string) => boolean) => fn.toString().replace(/\s+/g, " ").trim();
    expect(norm(dashIsChildWikiPath)).toBe(norm(canonIsChildWikiPath));
  });

  it("both copies agree behaviorally on a battery of paths (incl. Windows separators)", () => {
    const cases = [
      "a/.guild/wiki/x.md", "x\\.guild\\wiki\\y.md", ".guild/wiki",
      ".guild/reflections/run.md", "/abs/.guild/wiki/decisions/d.md", "wikis/.guildx/wiki",
    ];
    for (const c of cases) expect(dashIsChildWikiPath(c)).toBe(canonIsChildWikiPath(c));
  });
});

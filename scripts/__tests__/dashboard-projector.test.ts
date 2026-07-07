/**
 * scripts/__tests__/dashboard-projector.test.ts
 *
 * LW3-3 co-located unit test for the `guild.dashboard.v1` read-only projector.
 * Covers (de-risking the lane; the AUTHORITATIVE SC-W3-3 cross-cutting eval is LW3-6's):
 *   1. REAL-PATH: build a temp `.guild/` fixture on disk, drive the SHIPPED projector via
 *      `createRealReadSeam()` (injected-seam tests mask real-path misses — this repo's #1
 *      recurring defect class), assert all six AC36 sections populate from real files.
 *   2. AC36 — validateDashboardV1 asserts ALL SIX sections present (and rejects a deletion).
 *   3. AC33 anti-vacuous isolation — a child `.guild/wiki/` carries a SENTINEL; assert the
 *      sentinel NEVER appears in the projection output, AND a POSITIVE CONTROL proves the
 *      guard is not vacuous (a deliberate child-wiki read THROWS, recording the denied path).
 *   4. READ-ONLY — a recording seam proves the projector performs ONLY reads (the seam has
 *      no write method; every accessed path is logged and asserted read-class only).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  projectDashboard,
  validateDashboardV1,
  guardDashboardReads,
  createRealReadSeam,
  DASHBOARD_SCHEMA_VERSION,
  DASHBOARD_SECTION_KEYS,
  type DashboardReadSeam,
} from "../lib/dashboard-projector";

const NOW = Date.parse("2026-06-17T12:00:00Z");
const STAMP = "2026-06-17T12:00:00.000Z";
const SENTINEL = "SENTINEL-CHILD-WIKI-MUST-NOT-LEAK-7f3a9";

/** A recording seam: REAL reads, every accessed path logged. No write method exists. */
function recordingSeam(log: string[]): DashboardReadSeam {
  return {
    exists(p) {
      log.push(`exists:${p}`);
      return fs.existsSync(p);
    },
    readFile(p) {
      log.push(`readFile:${p}`);
      return fs.readFileSync(p, "utf-8");
    },
    readDir(p) {
      log.push(`readDir:${p}`);
      try {
        return fs.readdirSync(p);
      } catch {
        return [];
      }
    },
  };
}

function mkFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-lw3-3-"));
  const g = path.join(root, ".guild");
  const w = (rel: string, body: string) => {
    const p = path.join(g, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };

  // workspace.json with a child that HAS a wiki (whose content must never leak).
  w(
    "workspace.json",
    JSON.stringify({
      schema_version: "guild.workspace.v1",
      is_workspace: true,
      sub_guilds: [
        {
          name: "plugin",
          path: "plugin",
          kind: "sub-guild",
          has_wiki: true,
          has_indexes: true,
          last_seen_commit: "abc1234",
        },
        { name: "website", path: "website", kind: "sub-guild", has_wiki: false, has_indexes: false },
      ],
    }),
  );

  // A CHILD wiki carrying the sentinel — the projector must never read it.
  fs.mkdirSync(path.join(root, "plugin", ".guild", "wiki", "decisions"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "plugin", ".guild", "wiki", "decisions", "secret.md"),
    `# secret\n${SENTINEL}\n`,
  );

  // initiatives registry (one active, one archived/closed).
  w(
    "indexes/initiatives-registry.yaml",
    [
      "schema_version: guild.initiatives_registry.v1",
      "initiatives:",
      "  - id: universal-host-plugin-architecture",
      '    title: "Universal host plugin architecture"',
      "    status: in_progress",
      "    final_status: open",
      "    scope: workspace",
      "    path: .guild/initiatives/active/universal-host-plugin-architecture/",
      "    release_status: not_released",
      "    updated_at: 2026-06-17T00:00:00Z",
      "  - id: old-done",
      '    title: "Old done thing"',
      "    status: closed",
      "    final_status: closed",
      "    scope: workspace",
      "    path: .guild/initiatives/archived/old-done/",
      "    updated_at: 2026-01-01T00:00:00Z",
    ].join("\n"),
  );

  // knowledge manifests: one fresh, one stale (old timestamp).
  w(
    "indexes/codebase-map.json",
    JSON.stringify({ version: "guild.codebase_map.v1", generated_at: STAMP, generated_from_commit: "abc1234" }),
  );
  w(
    "indexes/knowledge-graph.json",
    JSON.stringify({ generated_at: "2026-01-01T00:00:00Z" }), // >30d old vs NOW → stale
  );

  // active run dir: run.yaml + handoffs + questions + verify.md.
  const runId = "run-universal-host-plugin-architecture-20260617-152632";
  const runDir = path.join(g, "runs", runId);
  fs.mkdirSync(path.join(runDir, "handoffs"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "questions"), { recursive: true });
  fs.writeFileSync(path.join(g, "runs", "current-run-id"), runId);
  fs.writeFileSync(
    path.join(runDir, "run.yaml"),
    [
      "schema_version: guild.run.v1",
      `run_id: ${runId}`,
      "phase: build",
      "status: open",
      "initiative_attachment: universal-host-plugin-architecture",
      "gates:",
      "  g-plan: passed",
      "  g-lane-LW3-3: pending",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(runDir, "handoffs", "tooling-engineer-LW3-1.md"), "ok");
  fs.writeFileSync(path.join(runDir, "handoffs", "command-builder-LW3-2.md"), "ok");
  fs.writeFileSync(path.join(runDir, "questions", "LW3-9.md"), "blocked");
  fs.writeFileSync(path.join(runDir, "verify.md"), "SC-W3-3 verified pass\n");

  // spec with a Success criteria section naming SC ids + AC refs.
  w(
    "spec/universal-host-p2-wave3.md",
    [
      "---",
      "type: spec",
      "---",
      "# Wave 3",
      "## Success criteria",
      "- **SC-W3-1 [AC37 / step 18] product templates.** something.",
      "- **SC-W3-3 [AC36 + AC33 / step 18] dashboard views.** read-only projection.",
      "## Non-goals",
      "- something else with SC-W3-9 that must NOT be counted.",
    ].join("\n"),
  );

  return root;
}

describe("LW3-3 dashboard projector — real-path + AC36 + AC33 + read-only", () => {
  let root: string;
  beforeAll(() => {
    root = mkFixture();
  });
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("REAL PATH: populates all six AC36 sections from on-disk .guild/ state", () => {
    const proj = projectDashboard(root, createRealReadSeam(), { now: NOW, generated_at: STAMP });

    expect(proj.schema_version).toBe(DASHBOARD_SCHEMA_VERSION);
    expect(proj.generated_at).toBe(STAMP);

    // 1. active initiatives — the archived/closed one is filtered out.
    expect(proj.sections.active_initiatives.map((i) => i.id)).toEqual([
      "universal-host-plugin-architecture",
    ]);

    // 2. child-project health — ids/paths/flags only.
    const names = proj.sections.child_project_health.map((c) => c.name).sort();
    expect(names).toEqual(["plugin", "website"]);
    const plugin = proj.sections.child_project_health.find((c) => c.name === "plugin")!;
    expect(plugin.has_wiki).toBe(true);
    expect(plugin.last_seen_commit).toBe("abc1234");

    // 3. stale knowledge — codebase-map fresh, knowledge-graph stale, two missing.
    const byArtifact = new Map(proj.sections.stale_knowledge.map((s) => [s.artifact, s]));
    expect(byArtifact.get("indexes/codebase-map.json")!.stale).toBe(false);
    expect(byArtifact.get("indexes/knowledge-graph.json")!.stale).toBe(true);
    expect(byArtifact.get("indexes/architecture-map.md")!.present).toBe(false);
    expect(byArtifact.get("indexes/architecture-map.md")!.stale).toBe(true);

    // 4. lane progress — completed lanes parsed from handoffs; open question listed.
    expect(proj.sections.lane_progress.run_id).toContain("run-universal-host");
    expect(proj.sections.lane_progress.phase).toBe("build");
    expect(proj.sections.lane_progress.completed_lanes.sort()).toEqual(["LW3-1", "LW3-2"]);
    expect(proj.sections.lane_progress.handoffs_count).toBe(2);
    expect(proj.sections.lane_progress.open_questions).toEqual(["LW3-9"]);

    // 5. acceptance criteria — only Success-criteria SC ids (NOT the Non-goals SC-W3-9).
    const scIds = proj.sections.acceptance_criteria.map((c) => c.id);
    expect(scIds).toEqual(["SC-W3-1", "SC-W3-3"]);
    const sc33 = proj.sections.acceptance_criteria.find((c) => c.id === "SC-W3-3")!;
    expect(sc33.ac_refs.sort()).toEqual(["AC33", "AC36"]);
    expect(sc33.status).toBe("verified"); // verify.md names SC-W3-3

    // 6. QA / release readiness — gates + release_status from the attached initiative.
    const qa = proj.sections.qa_release_readiness;
    expect(qa.run_status).toBe("open");
    expect(qa.gates_total).toBe(2);
    expect(qa.gates_passed).toBe(1);
    expect(qa.verify_present).toBe(true);
    expect(qa.release_status).toBe("not_released");
  });

  it("AC36: validateDashboardV1 passes a full projection and rejects a missing section", () => {
    const proj = projectDashboard(root, createRealReadSeam(), { now: NOW, generated_at: STAMP });
    expect(validateDashboardV1(proj).valid).toBe(true);

    // delete one section → invalid, with the AC36 error.
    const broken = JSON.parse(JSON.stringify(proj));
    delete broken.sections.stale_knowledge;
    const res = validateDashboardV1(broken);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("stale_knowledge"))).toBe(true);
  });

  it("exposes exactly the six AC36 section keys", () => {
    const proj = projectDashboard(root, createRealReadSeam(), { now: NOW, generated_at: STAMP });
    expect(Object.keys(proj.sections).sort()).toEqual([...DASHBOARD_SECTION_KEYS].sort());
  });

  it("AC33 anti-vacuous: the child-wiki SENTINEL never appears in the projection output", () => {
    const proj = projectDashboard(root, createRealReadSeam(), { now: NOW, generated_at: STAMP });
    expect(JSON.stringify(proj)).not.toContain(SENTINEL);
  });

  it("AC33 positive control: the guard is NOT vacuous — a child-wiki read THROWS and is recorded", () => {
    const denied: string[] = [];
    const guarded = guardDashboardReads(createRealReadSeam(), (p) => denied.push(p));
    const childWiki = path.join(root, "plugin", ".guild", "wiki", "decisions", "secret.md");
    expect(() => guarded.readFile(childWiki)).toThrow(/AC33\/F-7 isolation/);
    expect(() => guarded.exists(childWiki)).toThrow(/AC33\/F-7 isolation/);
    expect(() => guarded.readDir(path.dirname(childWiki))).toThrow(/AC33\/F-7 isolation/);
    expect(denied.length).toBe(3);
    // sanity: the sentinel really IS in that file (so the guard prevented a real leak).
    expect(fs.readFileSync(childWiki, "utf-8")).toContain(SENTINEL);
  });

  it("READ-ONLY: the projector only ever performs read-class operations (no write seam exists)", () => {
    const log: string[] = [];
    projectDashboard(root, recordingSeam(log), { now: NOW, generated_at: STAMP });
    expect(log.length).toBeGreaterThan(0);
    for (const entry of log) {
      expect(entry).toMatch(/^(exists|readFile|readDir):/);
    }
    // None of the recorded reads touched any .guild/wiki path.
    expect(log.some((e) => /\.guild\/wiki(\/|$)/.test(e))).toBe(false);
  });
});

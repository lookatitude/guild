/**
 * scripts/__tests__/resume-lanes.test.ts
 *
 * TDD suite for scripts/resume-lanes.ts (R-016 resume READ seam).
 *
 * Closes the writer-without-reader gap: markLaneDead WRITES resume.json checkpoints;
 * this CLI READS them (version-guarded + resume.enabled-filtered + tier-joined) so
 * the guild:execute-plan "## Resuming dead lanes" prose (triggered by commands/resume.md)
 * can re-enter dead lanes. Mirrors the mark-lane-dead.ts subprocess pattern
 * (resume-lanes.ts imports ../hooks/lib/run-state, whose .js-suffixed transitive
 * imports resolve under the tsx runtime but not ts-jest — so we test the real CLI).
 *
 * Output contract (--json): a BARE JSON ARRAY of
 *   { lane_id, attempts, last_error?, last_attempt_at, resumable_at, tier? }
 * sorted by lane_id; empty array when none resumable OR resume.enabled=false.
 *
 * Coverage map:
 *  - lists resumable dead lanes with the run-state-joined `tier`.
 *  - bare-array shape + snake_case field names verbatim.
 *  - sorted by lane_id (deterministic re-entry order).
 *  - defaults.resume.enabled=false → empty array (CLI-side filter).
 *  - version guard: wrong schema_version skipped.
 *  - corrupt resume.json skipped; valid ones still listed.
 *  - empty (no lanes/ dir) → empty array; arg error on missing runDir.
 */

import { spawnSync } from "child_process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

const CLI = path.resolve(__dirname, "..", "resume-lanes.ts");

/** Build a repo with a runDir; optionally set defaults.resume.enabled. */
function makeRepo(opts: { resumeEnabled?: boolean } = {}): { repo: string; runDir: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "guild-resume-test-"));
  const runDir = path.join(repo, ".guild", "runs", "run-2026-06-07");
  fs.mkdirSync(runDir, { recursive: true });
  if (opts.resumeEnabled !== undefined) {
    fs.writeFileSync(
      path.join(repo, ".guild", "settings.json"),
      JSON.stringify({ defaults: { resume: { enabled: opts.resumeEnabled } } }, null, 2)
    );
  }
  return { repo, runDir };
}

function writeResumeCheckpoint(
  runDir: string,
  laneId: string,
  body: Record<string, unknown>
): void {
  const dir = path.join(runDir, "lanes", laneId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "resume.json"), JSON.stringify(body, null, 2));
}

/** Write a `.guild/plan/<slug>.md` with the given owner/task-id lanes (R-016 r4). */
function writePlan(
  repo: string,
  slug: string,
  lanes: Array<{ owner: string; taskId: string }>,
): void {
  const dir = path.join(repo, ".guild", "plan");
  fs.mkdirSync(dir, { recursive: true });
  const blocks = lanes
    .map((l) => `## Lane: ${l.owner}\n- task-id: ${l.taskId}\n- owner: ${l.owner}\n- scope: x.\n`)
    .join("\n");
  fs.writeFileSync(path.join(dir, `${slug}.md`), `# Plan: test\n\n${blocks}`);
}

/** Seed run-state.json so the CLI can join `tier` for a lane. */
function writeRunStateWithTier(runDir: string, lanes: Record<string, { tier: string }>): void {
  const laneStates: Record<string, unknown> = {};
  for (const [laneId, { tier }] of Object.entries(lanes)) {
    laneStates[laneId] = {
      status: "dead",
      tier,
      attempt: 3,
      depends_on: [],
      receipt_ref: null,
      updated_at: "2026-06-07T00:00:00.000Z",
    };
  }
  fs.writeFileSync(
    path.join(runDir, "run-state.json"),
    JSON.stringify(
      {
        schema_version: "guild.run_state.v1",
        run_id: "run-2026-06-07",
        plan_slug: "p",
        program_id: null,
        wave_index: 0,
        lanes: laneStates,
        last_checkpoint_at: "2026-06-07T00:00:00.000Z",
      },
      null,
      2
    )
  );
}

function validCheckpoint(laneId: string, attempts = 3): Record<string, unknown> {
  return {
    schema_version: "guild.lane_resume.v1",
    lane_id: laneId,
    run_id: "run-2026-06-07",
    attempts,
    last_attempt_at: "2026-06-07T00:00:00.000Z",
    last_error: `boom in ${laneId}`,
    resumable_at: "2026-06-07T00:00:01.000Z",
  };
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("npx", ["tsx", CLI, ...args], { encoding: "utf8", timeout: 60000 });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// ---------------------------------------------------------------------------
// 1. Arg validation
// ---------------------------------------------------------------------------

describe("resume-lanes CLI — arg validation", () => {
  it("exits non-zero when runDir is missing", () => {
    const r = runCli([]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("usage:");
  });
});

// ---------------------------------------------------------------------------
// 2. Lists resumable dead lanes (bare array + tier join)
// ---------------------------------------------------------------------------

describe("resume-lanes CLI — lists resumable lanes as a bare array", () => {
  it("emits a bare JSON array with snake_case fields + run-state-joined tier", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    writeResumeCheckpoint(runDir, "backend-api", validCheckpoint("backend-api", 3));
    writeResumeCheckpoint(runDir, "frontend", validCheckpoint("frontend", 2));
    writeRunStateWithTier(runDir, {
      "backend-api": { tier: "powerful" },
      frontend: { tier: "mid" },
    });

    const r = runCli([runDir, "--json", "--cwd", repo]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    // Bare array, NOT { resumable: [...] }
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);

    const byLane = Object.fromEntries(parsed.map((c: { lane_id: string }) => [c.lane_id, c]));
    expect(byLane["backend-api"].lane_id).toBe("backend-api"); // snake_case verbatim
    expect(byLane["backend-api"].attempts).toBe(3);
    expect(byLane["backend-api"].last_error).toBe("boom in backend-api");
    expect(byLane["backend-api"].tier).toBe("powerful"); // joined from run-state
    expect(byLane["frontend"].tier).toBe("mid");
  });

  it("omits tier when run-state has no entry for the lane (tolerant join)", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    writeResumeCheckpoint(runDir, "orphan", validCheckpoint("orphan"));
    // no run-state.json written
    const r = runCli([runDir, "--json", "--cwd", repo]);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].lane_id).toBe("orphan");
    expect(parsed[0].tier).toBeUndefined();
  });

  it("sorts lanes by lane_id for deterministic re-entry", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    writeResumeCheckpoint(runDir, "zeta", validCheckpoint("zeta"));
    writeResumeCheckpoint(runDir, "alpha", validCheckpoint("alpha"));
    const r = runCli([runDir, "--json", "--cwd", repo]);
    const order = JSON.parse(r.stdout).map((c: { lane_id: string }) => c.lane_id);
    expect(order).toEqual(["alpha", "zeta"]);
  });
});

// ---------------------------------------------------------------------------
// 3. resume.enabled filter (CLI-side)
// ---------------------------------------------------------------------------

describe("resume-lanes CLI — defaults.resume.enabled filter", () => {
  it("returns an empty array when resume.enabled=false (even with checkpoints present)", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: false });
    writeResumeCheckpoint(runDir, "backend-api", validCheckpoint("backend-api"));
    const r = runCli([runDir, "--json", "--cwd", repo]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
  });

  it("lists lanes when resume.enabled defaults to true (no settings.json)", () => {
    const { repo, runDir } = makeRepo(); // no settings → readResumeEnabled defaults true
    writeResumeCheckpoint(runDir, "lane-a", validCheckpoint("lane-a"));
    const r = runCli([runDir, "--json", "--cwd", repo]);
    expect(JSON.parse(r.stdout)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Version guard + corruption tolerance
// ---------------------------------------------------------------------------

describe("resume-lanes CLI — version guard + tolerance", () => {
  it("skips a checkpoint with a wrong schema_version", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    writeResumeCheckpoint(runDir, "good", validCheckpoint("good"));
    writeResumeCheckpoint(runDir, "stale", {
      ...validCheckpoint("stale"),
      schema_version: "guild.lane_resume.v0",
    });
    const r = runCli([runDir, "--json", "--cwd", repo]);
    const lanes = JSON.parse(r.stdout).map((c: { lane_id: string }) => c.lane_id);
    expect(lanes).toContain("good");
    expect(lanes).not.toContain("stale");
  });

  it("skips an unparseable resume.json but still lists the valid ones", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    writeResumeCheckpoint(runDir, "ok", validCheckpoint("ok"));
    const badDir = path.join(runDir, "lanes", "broken");
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, "resume.json"), "{ not valid json");
    const r = runCli([runDir, "--json", "--cwd", repo]);
    expect(r.status).toBe(0);
    const lanes = JSON.parse(r.stdout).map((c: { lane_id: string }) => c.lane_id);
    expect(lanes).toEqual(["ok"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Empty cases
// ---------------------------------------------------------------------------

describe("resume-lanes CLI — empty cases", () => {
  it("returns an empty array (exit 0) when no lanes/ dir exists", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    const r = runCli([runDir, "--json", "--cwd", repo]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
  });

  it("returns an empty array when lanes/ exists but holds no resume.json", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    fs.mkdirSync(path.join(runDir, "lanes", "in-progress"), { recursive: true });
    const r = runCli([runDir, "--json", "--cwd", repo]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Human-readable default output
// ---------------------------------------------------------------------------

describe("resume-lanes CLI — human-readable output", () => {
  it("prints a readable table (with tier) without --json", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    writeResumeCheckpoint(runDir, "backend-api", validCheckpoint("backend-api", 3));
    writeRunStateWithTier(runDir, { "backend-api": { tier: "powerful" } });
    const r = runCli([runDir, "--cwd", repo]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("backend-api");
    expect(r.stdout).toContain("powerful");
    expect(r.stdout).toContain("3");
  });
});

// ---------------------------------------------------------------------------
// 7. R-016 r4 — reader-side lane_id validation against plan task-ids (MAJOR A+B)
// ---------------------------------------------------------------------------

describe("resume-lanes CLI — lane_id validation against the plan (R-016 r4)", () => {
  it("OMITS an orphan checkpoint whose lane_id is not a plan task-id", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    writePlan(repo, "myslug", [
      { owner: "architect", taskId: "T1-architect" },
      { owner: "backend", taskId: "T2-backend" },
    ]);
    // Valid (a real plan task-id) + orphan (a name-keyed/fallback checkpoint).
    writeResumeCheckpoint(runDir, "T2-backend", validCheckpoint("T2-backend", 3));
    writeResumeCheckpoint(runDir, "backend", validCheckpoint("backend", 2)); // orphan name-key

    const r = runCli([runDir, "--json", "--cwd", repo, "--slug", "myslug"]);
    expect(r.status).toBe(0);
    const lanes = JSON.parse(r.stdout).map((c: { lane_id: string }) => c.lane_id);
    expect(lanes).toContain("T2-backend"); // valid plan task-id → offered
    expect(lanes).not.toContain("backend"); // orphan name-key → omitted
  });

  it("offers ONLY checkpoints whose lane_id is a real plan task-id", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    writePlan(repo, "myslug", [{ owner: "backend", taskId: "T2-backend" }]);
    writeResumeCheckpoint(runDir, "T2-backend", validCheckpoint("T2-backend"));
    writeResumeCheckpoint(runDir, "T9-ghost", validCheckpoint("T9-ghost")); // not in plan
    writeResumeCheckpoint(runDir, "frontend", validCheckpoint("frontend")); // name-key orphan

    const r = runCli([runDir, "--json", "--cwd", repo, "--slug", "myslug"]);
    const lanes = JSON.parse(r.stdout).map((c: { lane_id: string }) => c.lane_id);
    expect(lanes).toEqual(["T2-backend"]);
  });

  it("resolves the slug from run-state plan_slug when --slug is omitted", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    writePlan(repo, "p", [{ owner: "backend", taskId: "T2-backend" }]); // run-state plan_slug is "p"
    writeRunStateWithTier(runDir, { "T2-backend": { tier: "mid" } }); // plan_slug: "p"
    writeResumeCheckpoint(runDir, "T2-backend", validCheckpoint("T2-backend"));
    writeResumeCheckpoint(runDir, "backend", validCheckpoint("backend")); // orphan

    const r = runCli([runDir, "--json", "--cwd", repo]); // no --slug → use run-state plan_slug
    const lanes = JSON.parse(r.stdout).map((c: { lane_id: string }) => c.lane_id);
    expect(lanes).toContain("T2-backend");
    expect(lanes).not.toContain("backend");
  });

  it("skips validation (emits all) when the plan is genuinely unresolvable", () => {
    const { repo, runDir } = makeRepo({ resumeEnabled: true });
    // No plan file, no --slug, run-state plan_slug points nowhere → cannot validate.
    writeResumeCheckpoint(runDir, "some-lane", validCheckpoint("some-lane"));
    const r = runCli([runDir, "--json", "--cwd", repo]);
    const lanes = JSON.parse(r.stdout).map((c: { lane_id: string }) => c.lane_id);
    // Degraded: can't validate → don't drop valid lanes (write-side join is the primary defense).
    expect(lanes).toContain("some-lane");
  });
});

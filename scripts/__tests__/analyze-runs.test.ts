/**
 * scripts/__tests__/analyze-runs.test.ts
 *
 * TDD for analyze-runs.ts — cross-run evolution-signal aggregator (E1).
 *
 * Verifies:
 *  - ≥N runs with same skill in proposals.skill_improvement → evolve-skill proposal
 *  - <N runs → no proposal (threshold not met)
 *  - ≥N runs with same role in proposals.missing_specialist → create-specialist proposal
 *  - Mixed signals → multiple proposals in one output
 *  - Escalation status in handoff receipts accumulated across ≥N runs → escalation proposal
 *  - Zero reflections → exits 0, no proposals
 *  - --min-runs=4 suppresses a 3-run signal
 *  - --out writes to a custom path
 *  - Malformed frontmatter → skipped gracefully, no crash
 *  - Never writes to .guild/wiki/
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../analyze-runs.ts");

function runScript(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Seed N reflections all naming the same skill_improvement item. */
function seedReflections(
  tmpDir: string,
  opts: {
    skillImprovement?: string[];
    missingSpecialist?: string[];
    runCount: number;
    runIdPrefix?: string;
  }
): void {
  const reflectDir = path.join(tmpDir, ".guild", "reflections");
  fs.mkdirSync(reflectDir, { recursive: true });
  const prefix = opts.runIdPrefix ?? "run-test";
  for (let i = 0; i < opts.runCount; i++) {
    const runId = `${prefix}-${i + 1}`;
    const skillList = (opts.skillImprovement ?? []).map((s) => `"${s}"`).join(", ");
    const specialistList = (opts.missingSpecialist ?? []).map((s) => `"${s}"`).join(", ");
    const content = `---
run_id: ${runId}
date: 2026-05-2${i + 1}
task_slug: test-task-${i + 1}
proposals:
  skill_improvement: [${skillList}]
  missing_specialist: [${specialistList}]
  context_issues: []
  followup_backlog: []
significance: medium
---

## Skill improvement

Evidence for run ${i + 1}.
`;
    fs.writeFileSync(path.join(reflectDir, `${runId}.md`), content, "utf8");
  }
}

/** Seed N handoff receipts with escalate status. */
function seedHandoffEscalations(
  tmpDir: string,
  opts: {
    specialist: string;
    runCount: number;
  }
): void {
  for (let i = 0; i < opts.runCount; i++) {
    const runId = `run-esc-${i + 1}`;
    const handoffDir = path.join(tmpDir, ".guild", "runs", runId, "handoffs");
    fs.mkdirSync(handoffDir, { recursive: true });
    const content = `---
schema_version: guild.handoff.v2
task_id: ${opts.specialist}-task-${i + 1}
tier: mid
status: escalate
escalate_reason: Cannot determine the correct approach for this domain.
summary: Escalated after 2 attempts.
artifacts: []
issues: []
---

## Notes

Escalated on run ${i + 1}.
`;
    fs.writeFileSync(
      path.join(handoffDir, `${opts.specialist}-task-${i + 1}.md`),
      content,
      "utf8"
    );
  }
}

describe("analyze-runs.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-analyze-runs-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Signal threshold — skill_improvement ──────────────────────────────────

  describe("evolve-skill proposal — meets threshold (default min-runs=3)", () => {
    it("exits 0", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const { exitCode } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("emits an evolve-skill proposal for guild-brainstorm", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).toMatch(/evolve-skill/i);
      expect(stdout).toMatch(/guild-brainstorm/);
    });

    it("includes the run_count (3) in the output", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).toMatch(/3/);
    });

    it("lists the supporting run ids", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).toContain("run-test-1");
      expect(stdout).toContain("run-test-2");
      expect(stdout).toContain("run-test-3");
    });
  });

  describe("evolve-skill proposal — below threshold (2 runs, default 3)", () => {
    it("exits 0", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 2 });
      const { exitCode } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("emits NO evolve-skill proposal (below threshold)", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 2 });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).not.toMatch(/evolve-skill/i);
    });

    it("says no proposals found or similar", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 2 });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).toMatch(/no proposals|0 proposal/i);
    });
  });

  // ── Signal threshold — missing_specialist ─────────────────────────────────

  describe("create-specialist proposal — meets threshold", () => {
    it("exits 0", () => {
      seedReflections(tmpDir, { missingSpecialist: ["data-scientist"], runCount: 3 });
      const { exitCode } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("emits a create-specialist proposal for data-scientist", () => {
      seedReflections(tmpDir, { missingSpecialist: ["data-scientist"], runCount: 3 });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).toMatch(/create-specialist/i);
      expect(stdout).toMatch(/data-scientist/);
    });

    it("includes evidence run ids", () => {
      seedReflections(tmpDir, { missingSpecialist: ["data-scientist"], runCount: 3 });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).toContain("run-test-1");
    });
  });

  describe("create-specialist — below threshold (2 runs)", () => {
    it("emits NO create-specialist proposal", () => {
      seedReflections(tmpDir, { missingSpecialist: ["data-scientist"], runCount: 2 });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).not.toMatch(/create-specialist/i);
    });
  });

  // ── Mixed signals ─────────────────────────────────────────────────────────

  describe("mixed signals — both proposal types", () => {
    it("emits both evolve-skill and create-specialist proposals", () => {
      seedReflections(tmpDir, {
        skillImprovement: ["guild-context-assemble"],
        missingSpecialist: ["ml-engineer"],
        runCount: 3,
      });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).toMatch(/evolve-skill/i);
      expect(stdout).toMatch(/guild-context-assemble/);
      expect(stdout).toMatch(/create-specialist/i);
      expect(stdout).toMatch(/ml-engineer/);
    });
  });

  // ── Multiple skills mentioned in same reflection ──────────────────────────

  describe("multiple skills mentioned across runs", () => {
    it("only emits proposal for skill appearing in ≥3 runs; others stay silent", () => {
      // skill-a appears 3×, skill-b appears 1×
      const reflectDir = path.join(tmpDir, ".guild", "reflections");
      fs.mkdirSync(reflectDir, { recursive: true });
      for (let i = 0; i < 3; i++) {
        const skills = i === 0 ? `["guild-skill-a", "guild-skill-b"]` : `["guild-skill-a"]`;
        fs.writeFileSync(
          path.join(reflectDir, `run-multi-${i + 1}.md`),
          `---
run_id: run-multi-${i + 1}
date: 2026-05-2${i + 1}
task_slug: multi-${i + 1}
proposals:
  skill_improvement: ${skills}
  missing_specialist: []
  context_issues: []
  followup_backlog: []
significance: medium
---
`,
          "utf8"
        );
      }
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).toMatch(/guild-skill-a/);
      expect(stdout).not.toMatch(/guild-skill-b/);
    });
  });

  // ── Escalation signals from handoff receipts ──────────────────────────────

  describe("escalation cluster — meets threshold", () => {
    it("exits 0", () => {
      seedHandoffEscalations(tmpDir, { specialist: "guild-security", runCount: 3 });
      const { exitCode } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("emits an escalation-cluster proposal for guild-security", () => {
      seedHandoffEscalations(tmpDir, { specialist: "guild-security", runCount: 3 });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).toMatch(/escalation/i);
      expect(stdout).toMatch(/guild-security/);
    });

    it("includes evidence count ≥ 3", () => {
      seedHandoffEscalations(tmpDir, { specialist: "guild-security", runCount: 3 });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).toMatch(/3/);
    });
  });

  describe("escalation cluster — below threshold (2 runs)", () => {
    it("emits NO escalation proposal", () => {
      seedHandoffEscalations(tmpDir, { specialist: "guild-security", runCount: 2 });
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).not.toMatch(/escalation/i);
    });
  });

  // ── --min-runs flag ───────────────────────────────────────────────────────

  describe("--min-runs override", () => {
    it("--min-runs=4 suppresses a 3-run signal", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const { stdout } = runScript(["--cwd", tmpDir, "--min-runs", "4"]);
      expect(stdout).not.toMatch(/evolve-skill/i);
      expect(stdout).toMatch(/no proposals|0 proposal/i);
    });

    it("--min-runs=2 promotes a 2-run signal", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 2 });
      const { stdout } = runScript(["--cwd", tmpDir, "--min-runs", "2"]);
      expect(stdout).toMatch(/evolve-skill/i);
      expect(stdout).toMatch(/guild-brainstorm/);
    });

    it("--min-runs=0 exits 1 (invalid)", () => {
      const { exitCode } = runScript(["--cwd", tmpDir, "--min-runs", "0"]);
      expect(exitCode).toBe(1);
    });

    it("--min-runs=abc exits 1 (invalid)", () => {
      const { exitCode } = runScript(["--cwd", tmpDir, "--min-runs", "abc"]);
      expect(exitCode).toBe(1);
    });
  });

  // ── --out flag ────────────────────────────────────────────────────────────

  describe("--out flag", () => {
    it("writes output to the specified path", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const outPath = path.join(tmpDir, "my-proposals.md");
      runScript(["--cwd", tmpDir, "--out", outPath]);
      expect(fs.existsSync(outPath)).toBe(true);
    });

    it("written file contains the proposal", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const outPath = path.join(tmpDir, "my-proposals.md");
      runScript(["--cwd", tmpDir, "--out", outPath]);
      const content = fs.readFileSync(outPath, "utf8");
      expect(content).toMatch(/evolve-skill/i);
      expect(content).toMatch(/guild-brainstorm/);
    });

    it("never writes to .guild/wiki/", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const outPath = path.join(tmpDir, "proposals.md");
      runScript(["--cwd", tmpDir, "--out", outPath]);
      const wikiDir = path.join(tmpDir, ".guild", "wiki");
      expect(fs.existsSync(wikiDir)).toBe(false);
    });
  });

  // ── Default --out path ────────────────────────────────────────────────────

  describe("default output to .guild/evolve/analyze-runs-latest.md", () => {
    it("writes to default path when --out is omitted", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      runScript(["--cwd", tmpDir]);
      const defaultPath = path.join(tmpDir, ".guild", "evolve", "analyze-runs-latest.md");
      expect(fs.existsSync(defaultPath)).toBe(true);
    });

    it("written default file contains YAML frontmatter with proposals array", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "analyze-runs-latest.md"),
        "utf8"
      );
      expect(content).toMatch(/^---/m);
      expect(content).toMatch(/proposals:/);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe("empty / missing reflections directory", () => {
    it("exits 0 when .guild/reflections does not exist", () => {
      const { exitCode } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("reports no proposals when no reflections", () => {
      const { stdout } = runScript(["--cwd", tmpDir]);
      expect(stdout).toMatch(/no proposals|0 proposal/i);
    });
  });

  describe("malformed reflection frontmatter", () => {
    it("skips malformed files and does not crash", () => {
      const reflectDir = path.join(tmpDir, ".guild", "reflections");
      fs.mkdirSync(reflectDir, { recursive: true });
      // Write one malformed file
      fs.writeFileSync(
        path.join(reflectDir, "run-bad.md"),
        "this is not valid frontmatter at all\njust prose\n",
        "utf8"
      );
      // Write 3 valid ones
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const { exitCode, stdout } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/evolve-skill/i);
    });

    it("skips reflections with empty proposals arrays gracefully", () => {
      const reflectDir = path.join(tmpDir, ".guild", "reflections");
      fs.mkdirSync(reflectDir, { recursive: true });
      for (let i = 0; i < 3; i++) {
        fs.writeFileSync(
          path.join(reflectDir, `run-empty-${i + 1}.md`),
          `---
run_id: run-empty-${i + 1}
date: 2026-05-2${i + 1}
task_slug: empty-${i + 1}
proposals:
  skill_improvement: []
  missing_specialist: []
  context_issues: []
  followup_backlog: []
significance: low
---
`,
          "utf8"
        );
      }
      const { exitCode, stdout } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/no proposals|0 proposal/i);
    });
  });

  // ── JSON format ───────────────────────────────────────────────────────────

  describe("--format json", () => {
    it("exits 0", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const { exitCode } = runScript(["--cwd", tmpDir, "--format", "json"]);
      expect(exitCode).toBe(0);
    });

    it("emits valid JSON to stdout", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const { stdout } = runScript(["--cwd", tmpDir, "--format", "json"]);
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(stdout);
      }).not.toThrow();
      expect(parsed).toHaveProperty("proposals");
    });

    it("JSON proposals array contains the evolve-skill entry", () => {
      seedReflections(tmpDir, { skillImprovement: ["guild-brainstorm"], runCount: 3 });
      const { stdout } = runScript(["--cwd", tmpDir, "--format", "json"]);
      const parsed = JSON.parse(stdout) as { proposals: Array<{ kind: string; target: string }> };
      const evolveProp = parsed.proposals.find((p) => p.kind === "evolve-skill");
      expect(evolveProp).toBeDefined();
      expect(evolveProp?.target).toBe("guild-brainstorm");
    });
  });
});

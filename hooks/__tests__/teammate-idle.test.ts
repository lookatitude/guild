/**
 * hooks/__tests__/teammate-idle.test.ts
 *
 * Tests for hooks/agent-team/teammate-idle.ts
 *
 * Covers:
 *  - LANE-COMPLETE: valid fenced-JSON receipt → pointer + [AUTO-DISMISS] lines
 *  - Invalid-envelope nudge: strict fenced-JSON wording (not YAML frontmatter)
 *  - Missing-receipt nudge: strict fenced-JSON wording (not YAML frontmatter)
 *  - Always exits 0
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../agent-team/teammate-idle.ts");

// ── Helpers ────────────────────────────────────────────────────────────────

function runScript(
  payload: Record<string, unknown>,
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      GUILD_RUN_ID: "test-run",
      ...env,
    },
    timeout: 20000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Build a valid fenced-JSON receipt markdown string. */
function makeValidReceipt(taskId: string, status = "done"): string {
  return [
    "## changed_files",
    "- hooks/lib/handoff-v2.ts:1-200",
    "",
    "## opens_for",
    "Downstream consumers can rely on strict validation.",
    "",
    "## assumptions",
    "None.",
    "",
    "## evidence",
    "Tests pass.",
    "",
    "## followups",
    "None.",
    "",
    "```guild.handoff.v2",
    JSON.stringify({
      schema_version: "guild.handoff.v2",
      task_id: taskId,
      tier: "mid",
      status,
      summary: "Implemented the feature.",
      artifacts: [],
      issues: [],
    }),
    "```",
  ].join("\n");
}

/** Build an invalid receipt (YAML frontmatter only — the p2-3 drift pattern). */
function makeYamlFrontmatterReceipt(taskId: string): string {
  return [
    "---",
    `schema: guild.handoff.v2`,
    `task_id: ${taskId}`,
    `specialist: backend`,
    `status: done`,
    `timestamp: 2026-05-27T00:00:00Z`,
    "---",
    "",
    "## changed_files",
    "- some/file.ts",
    "",
    "## opens_for",
    "Unblocks next.",
    "",
    "## assumptions",
    "None.",
    "",
    "## evidence",
    "Ran tests.",
    "",
    "## followups",
    "None.",
  ].join("\n");
}

/** Build a plan file that assigns a task to a teammate. */
function makePlanFile(taskId: string, teammate: string): string {
  return `- ${taskId}: Some task to do\n  owner: ${teammate}\n`;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

describe("teammate-idle.ts", () => {
  let tmpDir: string;
  let runDir: string;
  let handoffsDir: string;
  let planDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-idle-test-"));
    // Create .guild/ so resolveGuildRoot anchors here
    fs.mkdirSync(path.join(tmpDir, ".guild"), { recursive: true });
    runDir = path.join(tmpDir, ".guild", "runs", "test-run");
    handoffsDir = path.join(runDir, "handoffs");
    planDir = path.join(tmpDir, ".guild", "plan");
    fs.mkdirSync(handoffsDir, { recursive: true });
    fs.mkdirSync(planDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const basePayload = {
    hook_event_name: "TeammateIdle",
    session_id: "test-session",
    teammate_name: "backend",
    team_name: "guild",
  };

  // ── Always-exit-0 ─────────────────────────────────────────────────────────

  it("always exits 0", () => {
    const { exitCode } = runScript({ ...basePayload, cwd: tmpDir });
    expect(exitCode).toBe(0);
  });

  it("exits 0 even with invalid JSON on stdin", () => {
    const result = spawnSync("npx", ["tsx", SCRIPT], {
      input: "not json",
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
        GUILD_RUN_ID: "test-run",
      },
      timeout: 20000,
    });
    expect(result.status).toBe(0);
  });

  // ── LANE-COMPLETE ─────────────────────────────────────────────────────────

  describe("LANE-COMPLETE (valid receipt, nothing pending/invalid)", () => {
    beforeEach(() => {
      // Write a valid fenced-JSON receipt
      fs.writeFileSync(
        path.join(handoffsDir, "backend-task-t1.md"),
        makeValidReceipt("task-t1", "done")
      );
    });

    it("emits [LANE-COMPLETE]", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).toContain("[LANE-COMPLETE]");
      expect(stdout).toContain('teammate="backend"');
      expect(stdout).toContain('team="guild"');
    });

    it("emits the canonical R2 pointer line per valid task", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      const receiptPath = path.join(handoffsDir, "backend-task-t1.md");
      expect(stdout).toContain(`done · task-t1 · status:done · receipt:${receiptPath}`);
    });

    it("emits [AUTO-DISMISS] directive per valid task", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).toContain(
        `[AUTO-DISMISS] teammate="backend" team="guild" reason=valid-receipt task=task-t1`
      );
    });

    it("reflects the correct status in the pointer line (blocked)", () => {
      fs.writeFileSync(
        path.join(handoffsDir, "backend-task-t2.md"),
        makeValidReceipt("task-t2", "blocked")
      );
      // Remove the done-receipt so only the blocked one exists
      fs.unlinkSync(path.join(handoffsDir, "backend-task-t1.md"));
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      const receiptPath = path.join(handoffsDir, "backend-task-t2.md");
      expect(stdout).toContain(`done · task-t2 · status:blocked · receipt:${receiptPath}`);
      expect(stdout).toContain(
        `[AUTO-DISMISS] teammate="backend" team="guild" reason=valid-receipt task=task-t2`
      );
    });

    it("emits pointer + AUTO-DISMISS for EACH valid task when multiple receipts", () => {
      // Write a second valid receipt
      fs.writeFileSync(
        path.join(handoffsDir, "backend-task-t2.md"),
        makeValidReceipt("task-t2", "done")
      );
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).toContain("done · task-t1 · status:done");
      expect(stdout).toContain("done · task-t2 · status:done");
      expect(stdout).toContain("reason=valid-receipt task=task-t1");
      expect(stdout).toContain("reason=valid-receipt task=task-t2");
    });
  });

  // ── Invalid-envelope nudge ─────────────────────────────────────────────────

  describe("invalid-envelope nudge (receipt exists, envelope missing/invalid)", () => {
    beforeEach(() => {
      // Write a YAML-frontmatter-only receipt (p2-3 drift pattern)
      fs.writeFileSync(
        path.join(handoffsDir, "backend-task-t1.md"),
        makeYamlFrontmatterReceipt("task-t1")
      );
    });

    it("does NOT emit [LANE-COMPLETE]", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).not.toContain("[LANE-COMPLETE]");
    });

    it("does NOT emit [AUTO-DISMISS]", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).not.toContain("[AUTO-DISMISS]");
    });

    it("states the envelope must be a strict fenced JSON block (not YAML frontmatter)", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).toContain("strict fenced JSON block");
      expect(stdout).toContain("NOT YAML frontmatter");
      expect(stdout).toContain("frontmatter-only receipt is rejected");
    });

    it("still exits 0", () => {
      const { exitCode } = runScript({ ...basePayload, cwd: tmpDir });
      expect(exitCode).toBe(0);
    });
  });

  // ── Missing-receipt nudge ──────────────────────────────────────────────────

  describe("missing-receipt nudge (plan assigns task, no receipt)", () => {
    beforeEach(() => {
      // Create a plan file assigning task-t1 to backend
      fs.writeFileSync(path.join(planDir, "lane.md"), makePlanFile("task-t1", "backend"));
    });

    it("does NOT emit [LANE-COMPLETE]", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).not.toContain("[LANE-COMPLETE]");
    });

    it("states the envelope must be a strict fenced JSON block (not YAML frontmatter)", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).toContain("strict fenced JSON block");
      expect(stdout).toContain("NOT YAML frontmatter");
      expect(stdout).toContain("frontmatter-only receipt is rejected");
    });

    it("references the receipt path", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).toContain("backend-task-t1.md");
    });

    it("still exits 0", () => {
      const { exitCode } = runScript({ ...basePayload, cwd: tmpDir });
      expect(exitCode).toBe(0);
    });
  });
});

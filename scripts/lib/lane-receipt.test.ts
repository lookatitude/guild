import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { inspectLaneReceipt, recordLaneReceipt, waitForLaneReceipt } from "./lane-receipt";
import { loadRunState } from "../../src/domains/lifecycle/index";
import { CLOSE_GATE_MARKER, evaluateCloseGate } from "../../hooks/lib/lifecycle-gate";

const RUN_ID = "run-20261020-000000-h1-receipt";

function receipt(taskId: string, status: "done" | "blocked" | "escalate" = "done"): string {
  const envelope: Record<string, unknown> = {
    schema_version: "guild.handoff.v2",
    task_id: taskId,
    tier: "mid",
    status,
    summary: "lane finished",
    artifacts: [],
    issues: [],
  };
  if (status === "escalate") envelope.escalate_reason = "needs a powerful pass";
  return [
    "---",
    "schema_version: guild.handoff_receipt.v1",
    "---",
    "",
    "## changed_files",
    "- src/version.js",
    "",
    "```guild.handoff.v2",
    JSON.stringify(envelope, null, 2),
    "```",
    "",
  ].join("\n");
}

/** A fake clock: sleep advances time, so a wait never spends real time. */
function fakeClock(onSleep?: (t: number) => void): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
      onSleep?.(t);
    },
  };
}

describe("lane-receipt — deterministic receipt-wait (#138)", () => {
  let root: string;
  let runDir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-lane-receipt-"));
    runDir = path.join(root, ".guild", "runs", RUN_ID);
    fs.mkdirSync(path.join(runDir, "handoffs"), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const writeReceipt = (name: string, body: string) =>
    fs.writeFileSync(path.join(runDir, "handoffs", name), body);
  const lane = (taskId: string) => loadRunState(runDir)?.lanes[taskId];

  it("times out to an explicit `missing` status and records the lane failed, never done", async () => {
    const clock = fakeClock();
    const result = await waitForLaneReceipt({
      runDir, runId: RUN_ID, specialist: "developer", taskId: "A-version",
      timeoutMs: 10_000, pollMs: 1_000, ...clock,
    });
    expect(result.status).toBe("missing");
    expect(result.receipt_ref).toBeNull();
    expect(result.waited_ms).toBeGreaterThanOrEqual(10_000);
    expect(lane("A-version")?.status).toBe("failed");
    expect(lane("A-version")?.receipt_ref ?? null).toBeNull();
  });

  it("returns `done` when the receipt lands mid-wait, after a partial write", async () => {
    const clock = fakeClock((t) => {
      if (t === 2_000) writeReceipt("developer-A-version.md", "---\npartial");
      if (t === 4_000) writeReceipt("developer-A-version.md", receipt("A-version"));
    });
    const result = await waitForLaneReceipt({
      runDir, runId: RUN_ID, specialist: "developer", taskId: "A-version",
      timeoutMs: 60_000, pollMs: 1_000, ...clock,
    });
    expect(result.status).toBe("done");
    expect(result.waited_ms).toBe(4_000);
    expect(result.receipt_ref).toBe(path.join("handoffs", "developer-A-version.md"));
    expect(lane("A-version")?.status).toBe("done");
    expect(lane("A-version")?.receipt_ref).toBe(path.join("handoffs", "developer-A-version.md"));
  });

  it("maps blocked / escalate receipts to `failed`", async () => {
    writeReceipt("developer-B-cli.md", receipt("B-cli", "blocked"));
    writeReceipt("developer-C-docs.md", receipt("C-docs", "escalate"));
    for (const taskId of ["B-cli", "C-docs"]) {
      const result = await waitForLaneReceipt({
        runDir, runId: RUN_ID, specialist: "developer", taskId, timeoutMs: 0, ...fakeClock(),
      });
      expect(result.status).toBe("failed");
      expect(lane(taskId)?.status).toBe("failed");
    }
  });

  it("refuses a receipt whose envelope names another task", () => {
    writeReceipt("developer-A-version.md", receipt("B-cli"));
    const seen = inspectLaneReceipt(runDir, "developer", "A-version");
    expect(seen.state).toBe("failed");
    expect(seen.receipt_ref).toBeNull();
  });

  it("refuses unsafe ids before touching the file system", async () => {
    await expect(
      waitForLaneReceipt({ runDir, runId: RUN_ID, specialist: "../x", taskId: "A", timeoutMs: 0 }),
    ).rejects.toThrow(/unsafe specialist/);
    expect(() => inspectLaneReceipt(runDir, "developer", "..")).toThrow(/unsafe task id/);
  });
});

describe("lane-receipt — fallback lanes reach the Stop backstop (#237)", () => {
  let root: string;
  let runDir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-lane-receipt-gate-"));
    runDir = path.join(root, ".guild", "runs", RUN_ID);
    fs.mkdirSync(path.join(runDir, "handoffs"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), RUN_ID);
    fs.writeFileSync(
      path.join(runDir, "run.yaml"),
      [
        "schema_version: guild.run.v1",
        `run_id: ${RUN_ID}`,
        "initiative_attachment: null",
        "phase: build",
        "gates: {}",
        "status: open",
        "phases_log: []",
        "",
      ].join("\n"),
    );
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const leadEnv = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH, HOME: process.env.HOME });

  it("checkpoints written by the receipt-wait force guild:verify-done at close", async () => {
    for (const taskId of ["A-version", "B-cli"]) {
      fs.writeFileSync(path.join(runDir, "handoffs", `developer-${taskId}.md`), receipt(taskId));
      const result = await waitForLaneReceipt({
        runDir, runId: RUN_ID, specialist: "developer", taskId, timeoutMs: 0, ...fakeClock(),
      });
      expect(result.status).toBe("done");
    }
    const gate = await evaluateCloseGate(root, RUN_ID, leadEnv());
    expect(gate.advisory).toContain(CLOSE_GATE_MARKER);
    expect(gate.advisory).toContain("guild:verify-done");
  });

  it("CONTROL: with no lane checkpoint the backstop stays silent (the #237 defect)", async () => {
    fs.writeFileSync(path.join(runDir, "handoffs", "developer-A-version.md"), receipt("A-version"));
    const gate = await evaluateCloseGate(root, RUN_ID, leadEnv());
    expect(gate.advisory).toBeNull();
  });

  it("a missing lane keeps the backstop from reading the run as cleanly done", async () => {
    recordLaneReceipt(runDir, RUN_ID, "A-version", "missing", null);
    const gate = await evaluateCloseGate(root, RUN_ID, leadEnv());
    expect(gate.advisory).toBeNull();
    expect(loadRunState(runDir)?.lanes["A-version"]?.status).toBe("failed");
  });
});

/**
 * __tests__/check-lane-liveness.test.ts
 *
 * G-9 (sweep part) / SC-5 — backend-agnostic lane-liveness report.
 *
 * Fixtures are REAL-SHAPE:
 *   - run-state.json mirrors the frozen guild.run_state.v1 body
 *     (hooks/lib/run-state.ts — schema_version, run_id, plan_slug, program_id,
 *     wave_index, lanes keyed by task-id with status/attempt/depends_on/
 *     receipt_ref/updated_at).
 *   - in-progress/<specialist>.json heartbeats mirror hooks/lib/heartbeat.ts
 *     ({timestamp, step, pct_complete?, last_action}).
 *   - handoffs/<specialist>-<task-id>.md receipts mirror the real
 *     guild.handoff.v2 receipts under .guild/runs/<id>/handoffs/.
 *
 * Includes CLI end-to-end tests via `npx tsx` subprocess (mirrors
 * mark-lane-dead.test.ts) so the REAL path — arg parsing, env threshold,
 * filesystem reads, stdout JSON, exit code — is exercised.
 */

import { spawnSync } from "child_process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

import {
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  isStalled,
  resolveTimeoutMs,
  sweepLaneLiveness,
} from "../check-lane-liveness";

const CLI = path.resolve(__dirname, "..", "check-lane-liveness.ts");

// ---------------------------------------------------------------------------
// Real-shape fixture builders
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-06-10T12:00:00.000Z");

function iso(msAgo: number, base: number = NOW): string {
  return new Date(base - msAgo).toISOString();
}

function makeRunDir(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cll-test-"));
  const runDir = path.join(cwd, ".guild", "runs", "run-cll-test");
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

/** Real-shape guild.run_state.v1 lane record. */
function lane(
  status: string,
  opts: { receiptRef?: string | null; updatedAgoMs?: number } = {}
): Record<string, unknown> {
  return {
    status,
    attempt: 1,
    depends_on: [],
    receipt_ref: opts.receiptRef ?? null,
    updated_at: iso(opts.updatedAgoMs ?? 0),
  };
}

function writeRunState(runDir: string, lanes: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(runDir, "run-state.json"),
    JSON.stringify(
      {
        schema_version: "guild.run_state.v1",
        run_id: "run-cll-test",
        plan_slug: "v2-gap-closure",
        program_id: null,
        wave_index: 0,
        lanes,
        last_checkpoint_at: iso(0),
      },
      null,
      2
    )
  );
}

/** Real-shape structured heartbeat (hooks/lib/heartbeat.ts writer shape). */
function writeHeartbeat(
  runDir: string,
  specialist: string,
  agoMs: number,
  base: number = NOW
): void {
  const dir = path.join(runDir, "in-progress");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${specialist}.json`),
    JSON.stringify({
      timestamp: iso(agoMs, base),
      step: "implementing",
      pct_complete: 40,
      last_action: "Edit",
    })
  );
}

/** Real-shape guild.handoff.v2 receipt (mirrors real run-dir receipts). */
function writeReceipt(runDir: string, stem: string): void {
  const dir = path.join(runDir, "handoffs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${stem}.md`),
    [
      "---",
      "schema_version: guild.handoff.v2",
      `agent: ${stem.split("-").slice(0, 2).join("-")}`,
      "task: fixture lane",
      "status: done",
      "evidence:",
      '  tests: "all green"',
      "---",
      "",
      "## What changed",
      "",
      "Fixture receipt body.",
      "",
    ].join("\n")
  );
}

function laneRow(report: ReturnType<typeof sweepLaneLiveness>, id: string) {
  return report.lanes.find((l) => l.lane === id);
}

function runCli(
  args: string[],
  env: Record<string, string> = {}
): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("npx", ["tsx", CLI, ...args], {
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, ...env },
  });
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// isStalled — the rule
// ---------------------------------------------------------------------------

describe("isStalled", () => {
  const T = 600_000;

  it("a receipt always clears the stall", () => {
    expect(isStalled("in_progress", true, T * 2, T)).toBe(false);
  });

  it("terminal statuses never stall", () => {
    for (const s of ["done", "skipped", "dead", "failed"]) {
      expect(isStalled(s, false, T * 2, T)).toBe(false);
    }
  });

  it("a pending lane with no signal has not started — not stalled", () => {
    expect(isStalled("pending", false, null, T)).toBe(false);
  });

  it("an in_progress lane stalls on a stale or absent signal", () => {
    expect(isStalled("in_progress", false, T, T)).toBe(true);
    expect(isStalled("in_progress", false, null, T)).toBe(true);
    expect(isStalled("in_progress", false, T - 1, T)).toBe(false);
  });

  it("an unknown lane stalls only on an actually-stale signal", () => {
    expect(isStalled("unknown", false, T + 1, T)).toBe(true);
    expect(isStalled("unknown", false, null, T)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sweepLaneLiveness — with run-state.json
// ---------------------------------------------------------------------------

describe("sweepLaneLiveness (run-state present)", () => {
  it("reports a fresh in_progress lane (joined heartbeat) as not stalled", () => {
    const runDir = makeRunDir();
    writeRunState(runDir, {
      "P1-enforcement": lane("in_progress", { updatedAgoMs: 3_000_000 }),
    });
    // Heartbeat keyed by <specialist>-<laneId> — direct suffix join.
    writeHeartbeat(runDir, "tooling-engineer-P1-enforcement", 30_000);

    const report = sweepLaneLiveness(runDir, DEFAULT_HEARTBEAT_TIMEOUT_MS, NOW);
    expect(report.run_state_present).toBe(true);
    const row = laneRow(report, "P1-enforcement")!;
    expect(row.status).toBe("in_progress");
    expect(row.receipt_present).toBe(false);
    expect(row.heartbeat_age_ms).toBe(30_000);
    expect(row.stalled).toBe(false);
    // The joined heartbeat must not double-report as its own row.
    expect(report.lanes).toHaveLength(1);
  });

  it("reports an in_progress lane with a stale heartbeat as stalled", () => {
    const runDir = makeRunDir();
    writeRunState(runDir, {
      "P1-enforcement": lane("in_progress", { updatedAgoMs: 30_000 }),
    });
    writeHeartbeat(runDir, "P1-enforcement", 1_200_000); // laneId-keyed join

    const report = sweepLaneLiveness(runDir, DEFAULT_HEARTBEAT_TIMEOUT_MS, NOW);
    const row = laneRow(report, "P1-enforcement")!;
    expect(row.heartbeat_age_ms).toBe(1_200_000);
    expect(row.stalled).toBe(true);
  });

  it("falls back to run-state updated_at when no heartbeat joins the lane", () => {
    const runDir = makeRunDir();
    writeRunState(runDir, {
      fresh: lane("in_progress", { updatedAgoMs: 60_000 }),
      stale: lane("in_progress", { updatedAgoMs: 2_000_000 }),
    });

    const report = sweepLaneLiveness(runDir, DEFAULT_HEARTBEAT_TIMEOUT_MS, NOW);
    expect(laneRow(report, "fresh")!.stalled).toBe(false);
    expect(laneRow(report, "fresh")!.heartbeat_age_ms).toBeNull();
    expect(laneRow(report, "stale")!.stalled).toBe(true);
  });

  it("a done lane with a receipt is never stalled; receipt is detected by suffix", () => {
    const runDir = makeRunDir();
    writeRunState(runDir, {
      F7: lane("done", { updatedAgoMs: 9_000_000 }),
    });
    writeReceipt(runDir, "docs-writer-F7");

    const report = sweepLaneLiveness(runDir, DEFAULT_HEARTBEAT_TIMEOUT_MS, NOW);
    const row = laneRow(report, "F7")!;
    expect(row.receipt_present).toBe(true);
    expect(row.stalled).toBe(false);
  });

  it("joins a specialist-keyed heartbeat via the receipt stem", () => {
    const runDir = makeRunDir();
    writeRunState(runDir, {
      FU2: lane("in_progress", { updatedAgoMs: 9_000_000 }),
    });
    writeReceipt(runDir, "tooling-engineer-FU2");
    writeHeartbeat(runDir, "tooling-engineer", 5_000);

    const report = sweepLaneLiveness(runDir, DEFAULT_HEARTBEAT_TIMEOUT_MS, NOW);
    const row = laneRow(report, "FU2")!;
    expect(row.heartbeat_age_ms).toBe(5_000);
    expect(row.stalled).toBe(false);
    expect(report.lanes).toHaveLength(1); // heartbeat consumed by the lane
  });

  it("a pending lane with no signal is not stalled (not started)", () => {
    const runDir = makeRunDir();
    const pendingLane = lane("pending") as Record<string, unknown>;
    delete pendingLane["updated_at"]; // lenient: stamp may be absent pre-dispatch
    writeRunState(runDir, { Z: pendingLane });

    const report = sweepLaneLiveness(runDir, DEFAULT_HEARTBEAT_TIMEOUT_MS, NOW);
    expect(laneRow(report, "Z")!.stalled).toBe(false);
  });

  it("surfaces an unmatched stale heartbeat as its own stalled row", () => {
    const runDir = makeRunDir();
    writeRunState(runDir, { P2: lane("done", { receiptRef: "handoffs/x.md" }) });
    writeHeartbeat(runDir, "rogue-specialist", 2_000_000);

    const report = sweepLaneLiveness(runDir, DEFAULT_HEARTBEAT_TIMEOUT_MS, NOW);
    const rogue = laneRow(report, "rogue-specialist")!;
    expect(rogue.status).toBe("unknown");
    expect(rogue.stalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sweepLaneLiveness — run-state absent (receipts-only report)
// ---------------------------------------------------------------------------

describe("sweepLaneLiveness (run-state absent)", () => {
  it("reports from receipts only", () => {
    const runDir = makeRunDir();
    writeReceipt(runDir, "tooling-engineer-FU2");
    writeReceipt(runDir, "docs-writer-F7");

    const report = sweepLaneLiveness(runDir, DEFAULT_HEARTBEAT_TIMEOUT_MS, NOW);
    expect(report.run_state_present).toBe(false);
    expect(report.lanes).toHaveLength(2);
    for (const row of report.lanes) {
      expect(row.receipt_present).toBe(true);
      expect(row.stalled).toBe(false);
    }
  });

  it("flags a stale heartbeat with no receipt as stalled", () => {
    const runDir = makeRunDir();
    writeHeartbeat(runDir, "tooling-engineer", 2_000_000);

    const report = sweepLaneLiveness(runDir, DEFAULT_HEARTBEAT_TIMEOUT_MS, NOW);
    const row = laneRow(report, "tooling-engineer")!;
    expect(row.receipt_present).toBe(false);
    expect(row.stalled).toBe(true);
  });

  it("returns an empty report for a missing run dir (never throws)", () => {
    const report = sweepLaneLiveness("/no/such/run-dir", DEFAULT_HEARTBEAT_TIMEOUT_MS, NOW);
    expect(report.run_state_present).toBe(false);
    expect(report.lanes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveTimeoutMs
// ---------------------------------------------------------------------------

describe("resolveTimeoutMs", () => {
  it("defaults to 600000", () => {
    expect(resolveTimeoutMs({})).toBe(600_000);
    expect(DEFAULT_HEARTBEAT_TIMEOUT_MS).toBe(600_000);
  });

  it("honors GUILD_HEARTBEAT_TIMEOUT_MS", () => {
    expect(resolveTimeoutMs({ GUILD_HEARTBEAT_TIMEOUT_MS: "180000" })).toBe(180_000);
  });

  it("falls back on a non-numeric / non-positive value", () => {
    expect(resolveTimeoutMs({ GUILD_HEARTBEAT_TIMEOUT_MS: "soon" })).toBe(600_000);
    expect(resolveTimeoutMs({ GUILD_HEARTBEAT_TIMEOUT_MS: "0" })).toBe(600_000);
  });
});

// ---------------------------------------------------------------------------
// CLI end-to-end (real path: npx tsx subprocess on a temp run dir)
// ---------------------------------------------------------------------------

describe("check-lane-liveness CLI (end-to-end)", () => {
  it("prints the JSON report and exits 0", () => {
    const runDir = makeRunDir();
    writeRunState(runDir, {
      FU2: lane("in_progress"),
      F7: lane("done"),
    });
    writeReceipt(runDir, "docs-writer-F7");
    writeHeartbeat(runDir, "tooling-engineer-FU2", 1_000, Date.now());

    const r = runCli(["--run-dir", runDir]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.run_state_present).toBe(true);
    expect(report.timeout_ms).toBe(600_000);
    const fu2 = report.lanes.find((l: { lane: string }) => l.lane === "FU2");
    expect(fu2.stalled).toBe(false);
    const f7 = report.lanes.find((l: { lane: string }) => l.lane === "F7");
    expect(f7.receipt_present).toBe(true);
  });

  it("honors the GUILD_HEARTBEAT_TIMEOUT_MS env threshold", () => {
    const runDir = makeRunDir();
    writeRunState(runDir, { FU2: lane("in_progress") });
    writeHeartbeat(runDir, "FU2", 5_000, Date.now()); // 5s old — stale under a 1s threshold

    const r = runCli(["--run-dir", runDir], { GUILD_HEARTBEAT_TIMEOUT_MS: "1000" });
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.timeout_ms).toBe(1000);
    const fu2 = report.lanes.find((l: { lane: string }) => l.lane === "FU2");
    expect(fu2.stalled).toBe(true);
  });

  it("exits 0 even for a missing run dir (report tool, never a gate)", () => {
    const r = runCli(["--run-dir", "/no/such/run-dir"]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.run_state_present).toBe(false);
    expect(report.lanes).toEqual([]);
  });

  it("exits 1 only on a usage error (missing --run-dir)", () => {
    const r = runCli([]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage:");
  });
});

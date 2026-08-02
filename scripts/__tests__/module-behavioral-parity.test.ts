import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";

import { appendEvent } from "../../src/modules/lifecycle/workflows/event-log";
import {
  markLaneDead,
  type RunStateV1,
} from "../../src/modules/lifecycle/workflows/run-state";
import { scrubbedWrite } from "../../src/modules/security/workflows/scrubbed-write";

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runWorkers(source: string, environments: Record<string, string>[]): Promise<void> {
  const repoRoot = path.resolve(__dirname, "../..");
  const tsx = path.join(repoRoot, "scripts", "node_modules", ".bin", "tsx");
  return Promise.all(environments.map((extraEnv) => new Promise<void>((resolve, reject) => {
    const child = spawn(tsx, ["-e", source], {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker exited ${code}: ${stderr}`));
    });
  }))).then(() => undefined);
}

describe("MH-07 module behavioral parity", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  describe("P1 lifecycle event log", () => {
    test("uses canonical validation and numbered gzip rotation", () => {
      const root = tempRoot("mh07-event-log-");
      roots.push(root);
      const runDir = path.join(root, ".guild", "runs", "run-parity");
      const event = {
        ts: "2026-07-27T00:00:00.000Z",
        event: "loop_round_start" as const,
        run_id: "run-parity",
        lane_id: "lane-a",
        loop_layer: "L1" as const,
        round_number: 1,
        cap: 2,
      };

      const appendWithOptions = appendEvent as unknown as (
        dir: string,
        value: typeof event,
        options: { rotationThresholdBytes: number },
      ) => void;
      const archive = path.join(runDir, "logs", "archive", "v1.4-events.1.jsonl.gz");
      const live = path.join(runDir, "logs", "v1.4-events.jsonl");

      expect(() =>
        appendWithOptions(runDir, { ...event, run_id: "../escape" }, { rotationThresholdBytes: 1 }),
      ).toThrow(/invalid run_id/);

      appendWithOptions(runDir, event, { rotationThresholdBytes: 1 });
      expect(fs.existsSync(archive)).toBe(true);
      expect(gunzipSync(fs.readFileSync(archive)).toString("utf8"))
        .toContain('"event":"loop_round_start"');
      expect(fs.readFileSync(live, "utf8")).toBe("");
    });

    test("serializes concurrent process writers through the stable per-run lock", async () => {
      const root = tempRoot("mh07-event-concurrency-");
      roots.push(root);
      const runDir = path.join(root, ".guild", "runs", "run-parity");
      const worker = `
        import { appendEvent } from "./src/modules/lifecycle/workflows/event-log.ts";
        for (let n = 0; n < 20; n++) appendEvent(process.env.MH07_RUN_DIR!, {
          ts: new Date().toISOString(), event: "loop_round_start",
          run_id: "run-parity", lane_id: process.env.MH07_LANE!,
          loop_layer: "L1", round_number: n + 1, cap: 20
        });
      `;
      await runWorkers(worker, Array.from({ length: 6 }, (_, n) => ({
        MH07_RUN_DIR: runDir,
        MH07_LANE: `lane-${n}`,
      })));

      const lines = fs.readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")
        .trim().split("\n").map((line) => JSON.parse(line) as { lane_id: string });
      expect(lines).toHaveLength(120);
      expect(new Set(lines.map((line) => line.lane_id)).size).toBe(6);
      expect(fs.statSync(path.join(runDir, "logs", ".lock")).size).toBe(0);
    });
  });

  describe("P2 lifecycle run state", () => {
    test("markLaneDead preserves the complete host/model routing block", () => {
      const root = tempRoot("mh07-run-state-");
      roots.push(root);
      const runDir = path.join(root, ".guild", "runs", "run-parity");
      fs.mkdirSync(runDir, { recursive: true });
      const existing = {
        schema_version: "guild.run_state.v1",
        run_id: "run-parity",
        plan_slug: "parity",
        program_id: "program-a",
        wave_index: 3,
        lanes: {
          "lane-a": {
            status: "in_progress",
            attempt: 1,
            depends_on: ["lane-zero"],
            receipt_ref: "handoffs/lane-a.md",
            updated_at: "2026-07-26T00:00:00.000Z",
            tier: "powerful",
            host: {
              requested: "codex",
              selected: "codex-cli",
              degraded: true,
              independence: "independent",
              tier: "powerful",
              model: "gpt-5",
              modelParams: { effort: "high", temperature: 0.2 },
            },
          },
        },
        last_checkpoint_at: "2026-07-26T00:00:00.000Z",
      };
      fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify(existing));

      const state = markLaneDead(
        runDir,
        { runId: "run-parity", planSlug: "parity" },
        "lane-a",
        { attempts: 4, lastAttemptAt: "2026-07-27T00:00:00.000Z", lastError: "exhausted" },
        root,
      ) as RunStateV1;

      expect((state.lanes["lane-a"] as unknown as { host?: unknown })?.host)
        .toEqual(existing.lanes["lane-a"].host);
      expect(state.lanes["lane-a"]).toMatchObject({
        status: "dead",
        attempt: 4,
        tier: "powerful",
        depends_on: ["lane-zero"],
        receipt_ref: "handoffs/lane-a.md",
      });
    });

    test("atomic locked upserts preserve every concurrent lane transition", async () => {
      const root = tempRoot("mh07-state-concurrency-");
      roots.push(root);
      const runDir = path.join(root, ".guild", "runs", "run-parity");
      const worker = `
        import { upsertLane } from "./src/modules/lifecycle/workflows/run-state.ts";
        upsertLane(process.env.MH07_RUN_DIR!, { runId: "run-parity" }, process.env.MH07_LANE!, {
          status: "done", attempt: 1, tier: "mid"
        });
      `;
      await runWorkers(worker, Array.from({ length: 8 }, (_, n) => ({
        MH07_RUN_DIR: runDir,
        MH07_LANE: `lane-${n}`,
      })));

      const stored = JSON.parse(
        fs.readFileSync(path.join(runDir, "run-state.json"), "utf8"),
      ) as RunStateV1;
      expect(Object.keys(stored.lanes).sort()).toEqual(
        Array.from({ length: 8 }, (_, n) => `lane-${n}`),
      );
      expect(fs.readdirSync(runDir).filter((name) => name.includes(".tmp-"))).toEqual([]);
    });
  });

  describe("P3 security scrubbed write", () => {
    function setupPolicy(policy: Record<string, unknown>) {
      const root = tempRoot("mh07-scrub-");
      roots.push(root);
      const runDir = path.join(root, ".guild", "runs", "run-parity");
      fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".guild", "settings.json"),
        JSON.stringify({ secrets_policy: policy }),
      );
      return { root, runDir };
    }

    test("applies a custom policy pattern to the whole document", () => {
      const { runDir } = setupPolicy({
        redaction_patterns: ["ACME-\\d+"],
        fail_mode_durable: "closed",
        fail_mode_telemetry: "open",
      });
      const out = path.join(runDir, "provenance.json");
      const content = `${"safe ".repeat(1200)}custom ACME-1234`;

      expect(scrubbedWrite(out, content, {
        surface: "provenance", runDir, runId: "run-parity",
      })).toEqual({ written: true, blocked: false });
      const stored = fs.readFileSync(out, "utf8");
      expect(stored).toContain("custom [REDACTED]");
      expect(stored).not.toContain("ACME-1234");
      expect(stored).not.toContain("[TRUNCATED]");
    });

    test("durable closed blocks and emits security plus approval evidence", () => {
      const { runDir } = setupPolicy({
        redaction_patterns: ["("],
        fail_mode_durable: "closed",
        fail_mode_telemetry: "open",
      });
      const out = path.join(runDir, "provenance.json");

      expect(scrubbedWrite(out, "safe document", {
        surface: "provenance", runDir, runId: "run-parity", laneId: "lane-a",
      })).toEqual({ written: false, blocked: true });
      expect(fs.existsSync(out)).toBe(false);
      expect(fs.readFileSync(path.join(runDir, "logs", "security-events.jsonl"), "utf8"))
        .toContain('"event_type":"secret_scrub_blocked"');
      const approvals = fs.readdirSync(path.join(runDir, "agent-bus", "approvals"));
      expect(approvals).toHaveLength(1);
      expect(JSON.parse(fs.readFileSync(
        path.join(runDir, "agent-bus", "approvals", approvals[0]!),
        "utf8",
      )).schema_version).toBe("guild.approval_request.v1");
    });

    test("telemetry open writes built-in-redacted content on custom failure", () => {
      const { runDir } = setupPolicy({
        redaction_patterns: ["("],
        fail_mode_durable: "closed",
        fail_mode_telemetry: "open",
      });
      const out = path.join(runDir, "logs", "custom.jsonl");
      const result = scrubbedWrite(out, "password=hunter2", {
        surface: "telemetry", runDir, runId: "run-parity",
      });

      expect(result).toEqual({ written: true, blocked: false });
      expect(fs.readFileSync(out, "utf8")).toContain("password=[REDACTED]");
    });
  });
});

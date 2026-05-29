/**
 * hooks/__tests__/run-trace.test.ts
 *
 * TDD — written before hooks/lib/run-trace.ts (Lane B3 / SC-B + SC-G).
 *
 * Covers the three B3 deliverables against the B1 run-lifecycle contract
 * (.guild/.../run-lifecycle-contract.md) + B2's lib (scripts/lib/run-lifecycle.ts):
 *
 *   1. run_started / run_closed guild.trace_event.v1 lines land in
 *      <runDir>/logs/v1.4-events.jsonl (the contract's terminal_trace_event.log_ref).
 *   2. run_closed is appended carrying the SAME event_id the provenance pointer
 *      references (B1 ordering note: provenance points AT the appended line).
 *   3. The status lightweight path is gated behind readRecordStatusRuns; a
 *      `record_status_runs: false` settings.json disables it.
 *   4. The skipped-files sink writes the SC-G entry shape to
 *      <runDir>/learn/skipped-files.json.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import {
  emitRunStarted,
  emitRunClosed,
  recordStatusLightweight,
  startAndCloseRun,
  writeSkippedFiles,
  resolveRunIdForTrace,
  type SkippedFileEntry,
} from "../lib/run-trace";

// B2's lib — the real spine we wire into.
import {
  createRunLifecycle,
  createRealEnv,
  readRecordStatusRuns,
} from "../../scripts/lib/run-lifecycle";

// A deterministic resolveHost stub (host-neutral; never claude-pinned in logic).
const resolveHost = (requested: string) => ({
  requested,
  resolved: "claude" as const,
});

function startedRun(root: string, runClass: "full" | "lightweight"): string {
  const lifecycle = createRunLifecycle(createRealEnv(root, resolveHost));
  return lifecycle.startRun({
    command: "/guild:learn",
    arguments: {},
    cwd: root,
    root,
    target_kind: "existing_guild_project",
    workspace: { is_workspace: false, root },
    project: "test",
    host_requested: "auto",
    model_tier_policy: "test",
    ignore_policy: "test",
    scan_policy: "test",
    initiative: null,
    run_class: runClass,
  });
}

function liveLog(root: string, runId: string): string {
  return path.join(root, ".guild", "runs", runId, "logs", "v1.4-events.jsonl");
}

function readJsonl(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("run-trace lib (Lane B3)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-trace-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("emitRunStarted", () => {
    it("appends one run_started guild.trace_event.v1 line to logs/v1.4-events.jsonl", () => {
      const runId = startedRun(root, "full");
      emitRunStarted(root, runId, { now: "2026-05-29T09:00:00Z" });
      const lines = readJsonl(liveLog(root, runId));
      expect(lines).toHaveLength(1);
      expect(lines[0]["schema_version"]).toBe("guild.trace_event.v1");
      expect(lines[0]["event_name"]).toBe("run_started");
      expect(lines[0]["run_id"]).toBe(runId);
      expect(typeof lines[0]["event_id"]).toBe("string");
      expect(lines[0]["at"]).toBe("2026-05-29T09:00:00Z");
    });

    it("is idempotent — does not double-emit run_started for one run", () => {
      const runId = startedRun(root, "full");
      emitRunStarted(root, runId, { now: "2026-05-29T09:00:00Z" });
      emitRunStarted(root, runId, { now: "2026-05-29T09:00:05Z" });
      const started = readJsonl(liveLog(root, runId)).filter(
        (e) => e["event_name"] === "run_started",
      );
      expect(started).toHaveLength(1);
    });
  });

  describe("emitRunClosed", () => {
    it("calls closeRun then appends a run_closed line whose event_id matches the provenance pointer", () => {
      const runId = startedRun(root, "full");
      emitRunStarted(root, runId, { now: "2026-05-29T09:00:00Z" });

      emitRunClosed(root, runId, resolveHost, { status: "closed" });

      // provenance.json was written by closeRun and points at the terminal event.
      const provPath = path.join(root, ".guild", "runs", runId, "provenance.json");
      const prov = JSON.parse(fs.readFileSync(provPath, "utf8"));
      const pointer = prov.terminal_trace_event;
      expect(pointer.event_name).toBe("run_closed");

      // the appended line carries the SAME event_id the pointer references.
      const closed = readJsonl(liveLog(root, runId)).filter(
        (e) => e["event_name"] === "run_closed",
      );
      expect(closed).toHaveLength(1);
      expect(closed[0]["event_id"]).toBe(pointer.event_id);
      expect(closed[0]["schema_version"]).toBe("guild.trace_event.v1");
      expect(closed[0]["run_id"]).toBe(runId);

      // run.yaml status flipped to closed.
      const runYaml = fs.readFileSync(
        path.join(root, ".guild", "runs", runId, "run.yaml"),
        "utf8",
      );
      expect(runYaml).toMatch(/^status: closed$/m);
    });
  });

  describe("recordStatusLightweight (OQ6)", () => {
    it("when record_status_runs is default (true), writes run.yaml + provenance.json to runs/ ONLY", () => {
      const runId = recordStatusLightweight(root, resolveHost, { cwd: root });
      expect(runId).not.toBeNull();
      const runDir = path.join(root, ".guild", "runs", runId as string);
      expect(fs.existsSync(path.join(runDir, "run.yaml"))).toBe(true);
      expect(fs.existsSync(path.join(runDir, "provenance.json"))).toBe(true);
      // run_class is lightweight; checkpoint is null.
      const prov = JSON.parse(fs.readFileSync(path.join(runDir, "provenance.json"), "utf8"));
      expect(prov.run_class).toBe("lightweight");
      expect(prov.final_learning_checkpoint).toBeNull();
      // NEVER writes wiki/decisions/indexes/reflections/initiatives.
      for (const forbidden of ["wiki", "indexes", "reflections", "initiatives"]) {
        expect(fs.existsSync(path.join(root, ".guild", forbidden))).toBe(false);
      }
    });

    it("when record_status_runs is false, the gate disables it (returns null, writes nothing)", () => {
      fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".guild", "settings.json"),
        JSON.stringify({ record_status_runs: false }),
        "utf8",
      );
      expect(readRecordStatusRuns(root)).toBe(false);
      const runId = recordStatusLightweight(root, resolveHost, { cwd: root });
      expect(runId).toBeNull();
      expect(fs.existsSync(path.join(root, ".guild", "runs"))).toBe(false);
    });
  });

  describe("writeSkippedFiles (SC-G)", () => {
    it("writes the SC-G entry shape to .guild/runs/<run-id>/learn/skipped-files.json", () => {
      const runId = startedRun(root, "full");
      const entries: SkippedFileEntry[] = [
        {
          path: "node_modules/foo/index.js",
          reason: "vendored dependency",
          rule: ".gitignore",
          can_manually_include: true,
          summary_produced: false,
        },
      ];
      const out = writeSkippedFiles(root, runId, entries);
      const written = JSON.parse(fs.readFileSync(out, "utf8"));
      expect(out).toContain(path.join("runs", runId, "learn", "skipped-files.json"));
      expect(written.run_id).toBe(runId);
      expect(written.skipped).toHaveLength(1);
      expect(written.skipped[0]).toEqual(entries[0]);
    });
  });

  describe("resolveRunIdForTrace", () => {
    it("prefers GUILD_RUN_ID, then runs/current-run-id, then .guild/current-run-id (B2 sentinel)", () => {
      // B2's lib writes the sentinel to .guild/current-run-id (NOT runs/).
      fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
      fs.writeFileSync(path.join(root, ".guild", "current-run-id"), "run-from-b2", "utf8");
      expect(resolveRunIdForTrace(root, {})).toBe("run-from-b2");

      // legacy new-run-id.ts writes runs/current-run-id — takes precedence over B2's.
      fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
      fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), "run-legacy", "utf8");
      expect(resolveRunIdForTrace(root, {})).toBe("run-legacy");

      // explicit env wins outright.
      expect(resolveRunIdForTrace(root, { GUILD_RUN_ID: "run-env" })).toBe("run-env");
    });
  });

  // ── startAndCloseRun (A2 rollout seam) ─────────────────────────────────────

  describe("startAndCloseRun (A2 rollout seam)", () => {
    it("default run_class=full: writes run.yaml (run_class:full) + provenance.json under runs/", () => {
      const runId = startAndCloseRun(root, resolveHost, {
        command: "/guild:learn",
        cwd: root,
        run_class: "full",
      });
      expect(runId).not.toBeNull();
      const runDir = path.join(root, ".guild", "runs", runId as string);
      expect(fs.existsSync(path.join(runDir, "run.yaml"))).toBe(true);
      expect(fs.existsSync(path.join(runDir, "provenance.json"))).toBe(true);
      const prov = JSON.parse(
        fs.readFileSync(path.join(runDir, "provenance.json"), "utf8"),
      );
      expect(prov.run_class).toBe("full");
      expect(prov.status).toBe("closed");
    });

    it("omitting run_class defaults to full", () => {
      const runId = startAndCloseRun(root, resolveHost, { command: "/guild:plan" });
      const prov = JSON.parse(
        fs.readFileSync(
          path.join(root, ".guild", "runs", runId as string, "provenance.json"),
          "utf8",
        ),
      );
      expect(prov.run_class).toBe("full");
    });

    it("run_class=lightweight: writes runs/-only, never wiki/indexes/reflections/initiatives, checkpoint null", () => {
      const runId = startAndCloseRun(root, resolveHost, {
        command: "/guild:status",
        cwd: root,
        run_class: "lightweight",
      });
      expect(runId).not.toBeNull();
      const runDir = path.join(root, ".guild", "runs", runId as string);
      expect(fs.existsSync(path.join(runDir, "run.yaml"))).toBe(true);
      expect(fs.existsSync(path.join(runDir, "provenance.json"))).toBe(true);
      const prov = JSON.parse(
        fs.readFileSync(path.join(runDir, "provenance.json"), "utf8"),
      );
      expect(prov.run_class).toBe("lightweight");
      expect(prov.final_learning_checkpoint).toBeNull();
      // NEVER writes durable store dirs.
      for (const forbidden of ["wiki", "indexes", "reflections", "initiatives"]) {
        expect(fs.existsSync(path.join(root, ".guild", forbidden))).toBe(false);
      }
    });

    it("startAndCloseRun does NOT apply the OQ6 gate (no record_status_runs read)", () => {
      // Even when record_status_runs:false, startAndCloseRun writes normally —
      // the gate is applied only by recordStatusLightweight / A2's /guild:status.
      fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".guild", "settings.json"),
        JSON.stringify({ record_status_runs: false }),
        "utf8",
      );
      const runId = startAndCloseRun(root, resolveHost, {
        command: "/guild:stats",
        run_class: "lightweight",
      });
      // startAndCloseRun itself does not gate — it wrote.
      expect(runId).not.toBeNull();
    });
  });

  // ── run-trace CLI `start` sub-command ──────────────────────────────────────
  //
  // The CLI tests use a separate tmpdir with a pre-seeded .guild/ dir so that
  // resolveGuildRoot anchors on the tmpdir rather than walking up and finding
  // a higher-level .guild/ (e.g. /tmp/.guild on macOS).

  const CLI = path.resolve(__dirname, "../run-trace.ts");

  /** tmpdir with a pre-seeded .guild/ so resolveGuildRoot anchors here. */
  let cliRoot: string;

  beforeEach(() => {
    cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-runtrace-cli-"));
    // Pre-seed .guild/ so resolveGuildRoot stops here, not at a higher ancestor.
    fs.mkdirSync(path.join(cliRoot, ".guild"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(cliRoot, { recursive: true, force: true });
  });

  function runCli(
    args: string[],
    envOverrides: Record<string, string> = {},
  ): { exitCode: number; stdout: string; stderr: string } {
    const result = spawnSync("npx", ["tsx", CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...envOverrides },
      timeout: 20000,
    });
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  describe("run-trace CLI start sub-command", () => {
    it("start with default run-class=full exits 0 and prints a run-id", () => {
      const { exitCode, stdout } = runCli(
        ["start", "--command=/guild:learn", `--cwd=${cliRoot}`],
      );
      expect(exitCode).toBe(0);
      const runId = stdout.trim();
      expect(runId.length).toBeGreaterThan(0);
      expect(
        fs.existsSync(path.join(cliRoot, ".guild", "runs", runId, "provenance.json")),
      ).toBe(true);
      const prov = JSON.parse(
        fs.readFileSync(
          path.join(cliRoot, ".guild", "runs", runId, "provenance.json"),
          "utf8",
        ),
      );
      expect(prov.run_class).toBe("full");
    });

    it("start --run-class=lightweight exits 0, run_class:lightweight, no durable dirs", () => {
      const { exitCode, stdout } = runCli([
        "start",
        "--command=/guild:status",
        "--run-class=lightweight",
        `--cwd=${cliRoot}`,
      ]);
      expect(exitCode).toBe(0);
      const runId = stdout.trim();
      expect(runId.length).toBeGreaterThan(0);
      const runDir = path.join(cliRoot, ".guild", "runs", runId);
      expect(fs.existsSync(path.join(runDir, "run.yaml"))).toBe(true);
      const prov = JSON.parse(
        fs.readFileSync(path.join(runDir, "provenance.json"), "utf8"),
      );
      expect(prov.run_class).toBe("lightweight");
      expect(prov.final_learning_checkpoint).toBeNull();
      for (const forbidden of ["wiki", "indexes", "reflections", "initiatives"]) {
        expect(fs.existsSync(path.join(cliRoot, ".guild", forbidden))).toBe(false);
      }
    });

    it("start --run-class=full and start with no --run-class both produce run_class:full", () => {
      const r1 = runCli(["start", "--run-class=full", `--cwd=${cliRoot}`]);
      const r2 = runCli(["start", `--cwd=${cliRoot}`]); // no flag → default full
      expect(r1.exitCode).toBe(0);
      expect(r2.exitCode).toBe(0);
      for (const runId of [r1.stdout.trim(), r2.stdout.trim()]) {
        const prov = JSON.parse(
          fs.readFileSync(
            path.join(cliRoot, ".guild", "runs", runId, "provenance.json"),
            "utf8",
          ),
        );
        expect(prov.run_class).toBe("full");
      }
    });

    it("status sub-command still works (OQ6 gate alias)", () => {
      const { exitCode, stdout } = runCli(["status", `--cwd=${cliRoot}`]);
      expect(exitCode).toBe(0);
      const runId = stdout.trim();
      expect(runId.length).toBeGreaterThan(0);
      const prov = JSON.parse(
        fs.readFileSync(
          path.join(cliRoot, ".guild", "runs", runId, "provenance.json"),
          "utf8",
        ),
      );
      expect(prov.run_class).toBe("lightweight");
    });

    it("status sub-command respects OQ6 gate (record_status_runs:false → empty stdout)", () => {
      fs.writeFileSync(
        path.join(cliRoot, ".guild", "settings.json"),
        JSON.stringify({ record_status_runs: false }),
        "utf8",
      );
      const { exitCode, stdout } = runCli(["status", `--cwd=${cliRoot}`]);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(""); // gate disabled → nothing printed
    });

    it("unknown sub-command exits 1", () => {
      const { exitCode } = runCli(["bogus"]);
      expect(exitCode).toBe(1);
    });
  });
});

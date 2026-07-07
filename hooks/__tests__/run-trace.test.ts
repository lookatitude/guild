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
  recordPhase,
  recordStatusLightweight,
  startAndCloseRun,
  startRunOnly,
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

// Shared js-yaml frontmatter parser (OD-3 compliant) — read run.yaml fields by
// parsing the document instead of hand-rolled line-anchored regex assertions.
import { parseYaml } from "../../scripts/lib/frontmatter";

/** Parse a run.yaml document to its top-level fields (fail-loud null on parse error). */
const runYamlFields = (text: string) =>
  parseYaml(text) as Record<string, unknown> | null;

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
      expect(runYamlFields(runYaml)).toMatchObject({ status: "closed" });
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

    // P2a — inline (lightweight) close MUST append the matching run_closed line.
    it("lightweight close appends a run_closed jsonl line whose event_id matches the provenance pointer", () => {
      const runId = startAndCloseRun(root, resolveHost, {
        command: "/guild:status",
        cwd: root,
        run_class: "lightweight",
      });
      expect(runId).not.toBeNull();
      const runDir = path.join(root, ".guild", "runs", runId as string);

      // provenance.json carries the terminal_trace_event POINTER.
      const prov = JSON.parse(
        fs.readFileSync(path.join(runDir, "provenance.json"), "utf8"),
      );
      const pointer = prov.terminal_trace_event;
      expect(pointer.event_name).toBe("run_closed");
      expect(typeof pointer.event_id).toBe("string");

      // The JSONL line the pointer references must EXIST and carry the same id.
      const closed = readJsonl(liveLog(root, runId as string)).filter(
        (e) => e["event_name"] === "run_closed",
      );
      expect(closed).toHaveLength(1);
      expect(closed[0]["event_id"]).toBe(pointer.event_id);
      expect(closed[0]["schema_version"]).toBe("guild.trace_event.v1");
      expect(closed[0]["run_id"]).toBe(runId);
    });

    // P2b — initiative scalar threads through, with NO initiatives/ dir (NN#5).
    it("initiative scalar is recorded in run.yaml + provenance, and creates NO .guild/initiatives/ dir", () => {
      const runId = startAndCloseRun(root, resolveHost, {
        command: "/guild:build",
        cwd: root,
        run_class: "full",
        initiative: "foo",
      });
      expect(runId).not.toBeNull();
      const runDir = path.join(root, ".guild", "runs", runId as string);

      const runYaml = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
      expect(runYamlFields(runYaml)).toMatchObject({ initiative_attachment: "foo" });

      const prov = JSON.parse(
        fs.readFileSync(path.join(runDir, "provenance.json"), "utf8"),
      );
      expect(prov.initiative).toBe("foo");
      // Attached runs retain until archive (not the one-off-90d detached class).
      expect(prov.retention_class).toBe("until-archive");

      // NN#5: the scalar attachment MUST NOT create any initiatives/ dir.
      expect(fs.existsSync(path.join(root, ".guild", "initiatives"))).toBe(false);
    });
  });

  // ── startRunOnly (P1 — full-run start leaves the run OPEN) ─────────────────

  describe("startRunOnly (P1 — full start leaves run OPEN)", () => {
    it("writes run.yaml with status:open and NO provenance.json (close deferred to Stop hook)", () => {
      const runId = startRunOnly(root, resolveHost, {
        command: "/guild:build",
        cwd: root,
        run_class: "full",
      });
      expect(runId).not.toBeNull();
      const runDir = path.join(root, ".guild", "runs", runId as string);

      // run.yaml exists and is OPEN — not flipped to closed.
      const runYaml = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
      expect(runYamlFields(runYaml)).toMatchObject({ status: "open" });

      // NO provenance.json — the Stop hook (emitRunClosed) writes it at close.
      expect(fs.existsSync(path.join(runDir, "provenance.json"))).toBe(false);

      // No run_closed line has been emitted yet either.
      const closed = readJsonl(liveLog(root, runId as string)).filter(
        (e) => e["event_name"] === "run_closed",
      );
      expect(closed).toHaveLength(0);
    });

    it("a deferred Stop-hook close (emitRunClosed) then closes the OPEN run normally", () => {
      const runId = startRunOnly(root, resolveHost, {
        command: "/guild:build",
        run_class: "full",
      }) as string;
      // Simulate the Stop hook firing at session end.
      emitRunClosed(root, runId, resolveHost, { status: "closed" });
      const runDir = path.join(root, ".guild", "runs", runId);
      expect(fs.existsSync(path.join(runDir, "provenance.json"))).toBe(true);
      const runYaml = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
      expect(runYamlFields(runYaml)).toMatchObject({ status: "closed" });
    });

    it("threads --initiative scalar with NO initiatives/ dir (NN#5)", () => {
      const runId = startRunOnly(root, resolveHost, {
        command: "/guild:build",
        run_class: "full",
        initiative: "foo",
      }) as string;
      const runYaml = fs.readFileSync(
        path.join(root, ".guild", "runs", runId, "run.yaml"),
        "utf8",
      );
      expect(runYamlFields(runYaml)).toMatchObject({ initiative_attachment: "foo" });
      expect(fs.existsSync(path.join(root, ".guild", "initiatives"))).toBe(false);
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
    it("start with default run-class=full exits 0, prints a run-id, leaves run.yaml OPEN with NO provenance.json (P1)", () => {
      const { exitCode, stdout } = runCli(
        ["start", "--command=/guild:learn", `--cwd=${cliRoot}`],
      );
      expect(exitCode).toBe(0);
      const runId = stdout.trim();
      expect(runId.length).toBeGreaterThan(0);
      const runDir = path.join(cliRoot, ".guild", "runs", runId);
      // run.yaml written + OPEN (close deferred to the Stop hook).
      const runYaml = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
      expect(runYamlFields(runYaml)).toMatchObject({ status: "open" });
      // P1: full start must NOT close inline — no provenance.json yet.
      expect(fs.existsSync(path.join(runDir, "provenance.json"))).toBe(false);
    });

    it("start --initiative=foo records the attachment with NO initiatives/ dir created (P2b/NN#5)", () => {
      const { exitCode, stdout } = runCli([
        "start",
        "--command=/guild:build",
        "--initiative=foo",
        `--cwd=${cliRoot}`,
      ]);
      expect(exitCode).toBe(0);
      const runId = stdout.trim();
      expect(runId.length).toBeGreaterThan(0);
      const runYaml = fs.readFileSync(
        path.join(cliRoot, ".guild", "runs", runId, "run.yaml"),
        "utf8",
      );
      expect(runYamlFields(runYaml)).toMatchObject({ initiative_attachment: "foo" });
      // NN#5: scalar attachment never creates a .guild/initiatives/ dir.
      expect(fs.existsSync(path.join(cliRoot, ".guild", "initiatives"))).toBe(false);
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

    it("start --run-class=full and start with no --run-class both record run_class:full + stay OPEN (P1)", () => {
      const r1 = runCli(["start", "--run-class=full", `--cwd=${cliRoot}`]);
      const r2 = runCli(["start", `--cwd=${cliRoot}`]); // no flag → default full
      expect(r1.exitCode).toBe(0);
      expect(r2.exitCode).toBe(0);
      for (const runId of [r1.stdout.trim(), r2.stdout.trim()]) {
        const runDir = path.join(cliRoot, ".guild", "runs", runId);
        const runYaml = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
        expect(runYamlFields(runYaml)).toMatchObject({ run_class: "full" });
        // P1: full start defers close to the Stop hook — no inline provenance.json.
        expect(fs.existsSync(path.join(runDir, "provenance.json"))).toBe(false);
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

  // ── recordPhase (T0 — join-path phase writer) ───────────────────────────────
  //
  // F5 coverage: `recordPhase` in hooks/lib/run-trace.ts was uncovered.
  // The moduleNameMapper in hooks/package.json already handles the
  // ../../scripts/lib/run-lifecycle.js transitive import (^(\\.{1,2}/.*)\\.js$ → $1),
  // so no resolver fix is needed — these tests exercise the function directly
  // under ts-jest in the hooks jest project.

  describe("recordPhase (T0 — join-path phase writer)", () => {
    it("returns null when no run-id can be resolved (no sentinel, no env, no opts.runId)", () => {
      // No GUILD_RUN_ID in env, no sentinel files in root → resolveRunIdForTrace
      // returns null → recordPhase short-circuits and returns null.
      const result = recordPhase(root, "plan", { env: {} });
      expect(result).toBeNull();
    });

    it("is best-effort — returns null (does NOT throw) when root is completely bogus", () => {
      // A non-existent root path — appendPhase can't read run.yaml → null, no throw.
      expect(() => {
        const r = recordPhase("/nonexistent-guild-root-xxxxxx", "build", {
          runId: "run-bogus-001",
        });
        expect(r).toBeNull();
      }).not.toThrow();
    });

    it("returns null for a non-canonical phase token even when the run exists and runId is supplied", () => {
      // Start a real run so run.yaml exists. appendPhase validates the token
      // and rejects non-canonical ones (returns false) → recordPhase → null.
      const runId = startedRun(root, "full");
      const result = recordPhase(root, "bogus-phase", { runId });
      expect(result).toBeNull();
      // run.yaml must NOT have the bogus token written.
      const runYaml = fs.readFileSync(
        path.join(root, ".guild", "runs", runId, "run.yaml"),
        "utf8",
      );
      expect(runYaml).not.toMatch(/bogus-phase/);
    });

    it("records a canonical phase via opts.runId and returns the runId", () => {
      const runId = startedRun(root, "full");
      const result = recordPhase(root, "build", { runId });
      // Returns the runId on success.
      expect(result).toBe(runId);
      // run.yaml carries the updated `phase:` scalar and a phases_log entry.
      const runYaml = fs.readFileSync(
        path.join(root, ".guild", "runs", runId, "run.yaml"),
        "utf8",
      );
      expect(runYamlFields(runYaml)).toMatchObject({ phase: "build" });
      expect(runYaml).toMatch(/phases_log:/);
      expect(runYaml).toMatch(/phase: build/);
    });

    it("all six canonical phase tokens are accepted (init, ideate, plan, build, qa, ops)", () => {
      // One run per canonical phase — each append should succeed.
      for (const phase of ["init", "ideate", "plan", "build", "qa", "ops"]) {
        const runId = startedRun(root, "full");
        const result = recordPhase(root, phase, { runId });
        expect(result).toBe(runId);
        const runYaml = fs.readFileSync(
          path.join(root, ".guild", "runs", runId, "run.yaml"),
          "utf8",
        );
        expect(runYamlFields(runYaml)).toMatchObject({ phase });
      }
    });

    it("resolves runId from GUILD_RUN_ID env (opts.env seam) when no opts.runId supplied", () => {
      const runId = startedRun(root, "full");
      // Supply GUILD_RUN_ID via the opts.env seam — this exercises the
      // resolveRunIdForTrace path inside recordPhase.
      const result = recordPhase(root, "qa", { env: { GUILD_RUN_ID: runId } });
      expect(result).toBe(runId);
      const runYaml = fs.readFileSync(
        path.join(root, ".guild", "runs", runId, "run.yaml"),
        "utf8",
      );
      expect(runYamlFields(runYaml)).toMatchObject({ phase: "qa" });
    });

    it("resolves runId from .guild/runs/current-run-id legacy sentinel when no opts override", () => {
      const runId = startedRun(root, "full");
      // Write the legacy sentinel (written by scripts/new-run-id.ts).
      const sentinelDir = path.join(root, ".guild", "runs");
      fs.mkdirSync(sentinelDir, { recursive: true });
      fs.writeFileSync(path.join(sentinelDir, "current-run-id"), runId, "utf8");

      // No GUILD_RUN_ID in env, no opts.runId — must fall through to sentinel.
      const result = recordPhase(root, "ops", { env: {} });
      expect(result).toBe(runId);
      const runYaml = fs.readFileSync(
        path.join(root, ".guild", "runs", runId, "run.yaml"),
        "utf8",
      );
      expect(runYamlFields(runYaml)).toMatchObject({ phase: "ops" });
    });

    it("resolves runId from .guild/current-run-id B2 sentinel (fallback after legacy)", () => {
      const runId = startedRun(root, "full");
      // Write ONLY the B2 sentinel (written by scripts/lib/run-lifecycle.ts startRun).
      const guildDir = path.join(root, ".guild");
      fs.mkdirSync(guildDir, { recursive: true });
      fs.writeFileSync(path.join(guildDir, "current-run-id"), runId, "utf8");
      // Make sure the legacy location does NOT exist so the B2 path is exercised.
      const legacyPath = path.join(guildDir, "runs", "current-run-id");
      if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);

      const result = recordPhase(root, "ideate", { env: {} });
      expect(result).toBe(runId);
      const runYaml = fs.readFileSync(
        path.join(root, ".guild", "runs", runId, "run.yaml"),
        "utf8",
      );
      expect(runYamlFields(runYaml)).toMatchObject({ phase: "ideate" });
    });
  });

  // ── #13 — startRun self-heals a STALE prior open run ───────────────────────
  describe("#13 — startRun finalizes a stale prior open run (interrupted-session self-heal)", () => {
    // Grace = resolveHeartbeatTimeoutMs(root,"powerful") × 3 = 20min × 3 = 60min
    // (no settings.json in temp root → powerful tier default). Age past it to abandon.
    const ABANDONED_MS = 61 * 60 * 1000;
    const runRel = (r: string, id: string, rel: string) =>
      path.join(r, ".guild", "runs", id, rel);
    const statusOf = (r: string, id: string) =>
      (runYamlFields(fs.readFileSync(runRel(r, id, "run.yaml"), "utf8")) ?? {})["status"];

    /** Backdate the run's TRACE files (not the heartbeat surface) to age it. */
    function backdateTrace(r: string, id: string, ageMs: number): void {
      const t = (Date.now() - ageMs) / 1000;
      for (const rel of ["logs/v1.4-events.jsonl", "events.ndjson", "run.yaml"]) {
        const p = runRel(r, id, rel);
        if (fs.existsSync(p)) fs.utimesSync(p, t, t);
      }
    }

    it("closes an ABANDONED open prior run when a new run starts, and still starts the new run", () => {
      const prior = startedRun(root, "full"); // status:open, sentinel -> prior
      expect(statusOf(root, prior)).toBe("open");
      backdateTrace(root, prior, ABANDONED_MS);

      const next = startRunOnly(root, resolveHost, { command: "/guild:evolve" }) as string;
      expect(next).toBeTruthy();
      expect(next).not.toBe(prior);

      // prior finalized through the REAL close path: status flipped + provenance minted
      expect(statusOf(root, prior)).toBe("closed");
      expect(fs.existsSync(runRel(root, prior, "provenance.json"))).toBe(true);
      // and the new run is open and owns the sentinel
      expect(statusOf(root, next)).toBe("open");
      expect(resolveRunIdForTrace(root, {})).toBe(next);
    });

    it("ANTI-VACUITY: a FRESH open prior run is LEFT OPEN — an active run is never closed", () => {
      const prior = startedRun(root, "full"); // just started → live (not backdated)
      const next = startRunOnly(root, resolveHost, { command: "/guild:evolve" }) as string;
      expect(next).not.toBe(prior);
      expect(statusOf(root, prior)).toBe("open");
    });

    it("ANTI-VACUITY (the risky case): stale TRACE mtimes but a FRESH structured heartbeat → LEFT OPEN", () => {
      const prior = startedRun(root, "full");
      // age the top-level trace files well past the grace window…
      backdateTrace(root, prior, ABANDONED_MS);
      // …but the run has a LIVE lane: write a fresh in-progress/<specialist> heartbeat.
      const hbDir = runRel(root, prior, "in-progress");
      fs.mkdirSync(hbDir, { recursive: true });
      fs.writeFileSync(
        path.join(hbDir, "backend.json"),
        JSON.stringify({ timestamp: new Date().toISOString() }),
      );

      const next = startRunOnly(root, resolveHost, { command: "/guild:evolve" }) as string;
      expect(next).not.toBe(prior);
      // the heartbeat surface proves liveness → the run must NOT be finalized
      expect(statusOf(root, prior)).toBe("open");
    });

    it("the lightweight /guild:status path (startAndCloseRun) also heals an abandoned orphan", () => {
      const prior = startedRun(root, "full");
      backdateTrace(root, prior, ABANDONED_MS);
      const statusRun = startAndCloseRun(root, resolveHost, {
        command: "/guild:status",
        run_class: "lightweight",
      }) as string;
      expect(statusRun).toBeTruthy();
      expect(statusOf(root, prior)).toBe("closed");
    });
  });
});

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
  resolvePreflightSnapshot,
  resolveInstalledPluginIdentity,
  startAndCloseRun,
  startRunOnly,
  writeSkippedFiles,
  resolveRunIdForTrace,
  type SkippedFileEntry,
} from "../lib/run-trace";
// T3b §5: sentinel assertions go through the INTAKE surface, never a writer.
import { locateCandidateRunId } from "../lib/hook-binding";

// B2's lib — the real spine we wire into.
import {
  createRunLifecycle,
  createRealEnv,
  readRecordStatusRuns,
  readResolvedSettingsSnapshot,
} from "../../scripts/lib/run-lifecycle";

// Imported from the ORIGINAL declaring module (not the scripts/lib/
// runstart-preflight.ts `export *` shim) so jest.spyOn can replace the
// function in place — spying on a re-exported star-binding hits TS's
// getter-only __createBinding indirection and throws "Cannot redefine
// property" under ts-jest (no babel-jest hoisting in this project's jest
// config). hooks/lib/run-trace.ts's own `export *` chain re-reads this same
// module's exports object on every call, so the spy is visible end-to-end.
import * as runstartPreflightOriginal from "../../src/modules/lifecycle/workflows/runstart-preflight";

// Shared js-yaml frontmatter parser (OD-3 compliant) — read run.yaml fields by
// parsing the document instead of hand-rolled line-anchored regex assertions.
import { parseYaml } from "../../scripts/lib/frontmatter";
import {
  compareCheckpointToJournal,
  defaultJournalIo,
  readCheckpointState,
  scanReceiptJournal,
} from "../../src/modules/telemetry/workflows/receipt-journal";

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

// Rework F1: writers accept ONLY a caller-presented (run_id, binding_ref)
// pair. startRun mints the nonce; the frozen core surface returns only the
// run id, so these tests read the minted record back to SIMULATE the caller
// that was handed the nonce at run start (the guard itself never does this).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadRunBinding } = require("../../scripts/lib/run-binding") as
  typeof import("../../scripts/lib/run-binding");
const refOf = (r: string, id: string): string =>
  loadRunBinding({ root: r, run_id: id })!.binding_ref;

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

  it("derives plugin identity from the installed package rather than the consuming project", () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-installed-plugin-"));
    fs.mkdirSync(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
    fs.mkdirSync(path.join(pluginRoot, "command-src"), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ version: "9.9.9" }));
    fs.writeFileSync(path.join(pluginRoot, "command-src", "command-registry.json"), "{}\n");
    const identity = resolveInstalledPluginIdentity({ GUILD_PLUGIN_ROOT: pluginRoot }, root);
    expect(identity.version).toBe("9.9.9");
    expect(identity.ref.startsWith("sha256:")).toBe(true);
    expect(identity.command_surface_version.startsWith("sha256:")).toBe(true);
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  });

  describe("emitRunStarted", () => {
    it("appends one run_started guild.trace_event.v1 line to logs/v1.4-events.jsonl", () => {
      const runId = startedRun(root, "full");
      emitRunStarted(root, runId, { now: "2026-05-29T09:00:00Z", binding_ref: refOf(root, runId) });
      const lines = readJsonl(liveLog(root, runId)).filter(
        (event) => event["schema_version"] === "guild.trace_event.v1",
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]["schema_version"]).toBe("guild.trace_event.v1");
      expect(lines[0]["event_name"]).toBe("run_started");
      expect(lines[0]["run_id"]).toBe(runId);
      expect(typeof lines[0]["event_id"]).toBe("string");
      expect(lines[0]["at"]).toBe("2026-05-29T09:00:00Z");
    });

    it("REWORK F1: a run id alone writes NOTHING — the loadable open record is never recovered", () => {
      const runId = startedRun(root, "full"); // binding minted + OPEN on disk
      const before = readJsonl(liveLog(root, runId));
      emitRunStarted(root, runId, { now: "2026-05-29T09:00:00Z" }); // no nonce presented
      expect(readJsonl(liveLog(root, runId))).toEqual(before);
    });

    it("is idempotent — does not double-emit run_started for one run", () => {
      const runId = startedRun(root, "full");
      emitRunStarted(root, runId, { now: "2026-05-29T09:00:00Z", binding_ref: refOf(root, runId) });
      emitRunStarted(root, runId, { now: "2026-05-29T09:00:05Z", binding_ref: refOf(root, runId) });
      const started = readJsonl(liveLog(root, runId)).filter(
        (e) => e["event_name"] === "run_started",
      );
      expect(started).toHaveLength(1);
    });
  });

  describe("emitRunClosed", () => {
    it("calls closeRun then appends a run_closed line whose event_id matches the provenance pointer", () => {
      const runId = startedRun(root, "full");
      emitRunStarted(root, runId, { now: "2026-05-29T09:00:00Z", binding_ref: refOf(root, runId) });

      emitRunClosed(root, runId, resolveHost, {
        status: "closed",
        binding_ref: refOf(root, runId),
      });

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
      const out = writeSkippedFiles(root, runId, entries, { binding_ref: refOf(root, runId) });
      const written = JSON.parse(fs.readFileSync(out, "utf8"));
      expect(out).toContain(path.join("runs", runId, "learn", "skipped-files.json"));
      expect(written.run_id).toBe(runId);
      expect(written.skipped).toHaveLength(1);
      expect(written.skipped[0]).toEqual(entries[0]);
    });
  });

  describe("resolveRunIdForTrace", () => {
    it("resolves from the explicit GUILD_RUN_ID env ONLY — sentinels never resolve a writer identity (T3b §5)", () => {
      // CORRECTED (T3b): this test previously ENCODED the retired sentinel
      // fallback chain (env → legacy sentinel → B2 sentinel). Under
      // session_context §5 the sentinels are interactive intake only: a writer
      // with no explicit binding env resolves null and fails closed, no matter
      // what either sentinel says.
      fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
      fs.writeFileSync(path.join(root, ".guild", "current-run-id"), "run-from-b2", "utf8");
      expect(resolveRunIdForTrace(root, {})).toBeNull();

      fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
      fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), "run-legacy", "utf8");
      expect(resolveRunIdForTrace(root, {})).toBeNull();

      // explicit env wins outright (the ONLY resolving source).
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

    it("recovers a journal-won start receipt before exposing the full run id", () => {
      const checkpointWrite = jest.spyOn(defaultJournalIo, "writeCheckpoint")
        .mockImplementationOnce(() => { throw new Error("planted start-checkpoint crash"); });
      let runId: string | null = null;
      try {
        runId = startRunOnly(root, resolveHost, { command: "/guild:learn", run_class: "full" });
      } finally {
        checkpointWrite.mockRestore();
      }
      expect(runId).not.toBeNull();
      expect(fs.readFileSync(path.join(root, ".guild", "runs", "current-run-id"), "utf8")).toBe(runId);
      const receipts = path.join(root, ".guild", "runs", runId as string, "receipts");
      const scan = scanReceiptJournal(path.join(receipts, "journal.jsonl"));
      expect(scan.records).toHaveLength(1);
      expect(scan.records[0]).toEqual(expect.objectContaining({
        sequence: 1,
        operation_id: `capability-start-snapshot:${runId}`,
      }));
      expect(compareCheckpointToJournal(
        readCheckpointState(path.join(receipts, "checkpoint.json")),
        scan,
        runId as string,
      )).toEqual([]);
    });

    it("removes the full run transaction when its start receipt cannot be appended", () => {
      const acquire = jest.spyOn(defaultJournalIo, "acquireLock")
        .mockImplementation(() => { throw new Error("planted non-recoverable lock failure"); });
      let runId: string | null = "unexpected";
      try {
        runId = startRunOnly(root, resolveHost, { command: "/guild:learn", run_class: "full" });
      } finally {
        acquire.mockRestore();
      }
      expect(runId).toBeNull();
      const runsRoot = path.join(root, ".guild", "runs");
      const entries = fs.existsSync(runsRoot) ? fs.readdirSync(runsRoot) : [];
      expect(entries.filter((entry) => entry.startsWith("run-"))).toEqual([]);
      expect(fs.existsSync(path.join(runsRoot, "current-run-id"))).toBe(false);
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
      expect(fs.existsSync(path.join(runDir, "capability"))).toBe(false);
      expect(fs.existsSync(path.join(runDir, "receipts"))).toBe(false);
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
      emitRunClosed(root, runId, resolveHost, {
        status: "closed",
        binding_ref: refOf(root, runId),
      });
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

  // ── resolvePreflightSnapshot (U3/U6 wiring — audit fix G3c) ─────────────────
  //
  // Before this wiring, runStartPreflight had ZERO production callers
  // (plugin-implementation-audit-2026-07-12, high/incomplete-wiring). This is
  // the deterministic caller: the CLI's `start` sub-command invokes it and
  // threads the result into startRunOnly/startAndCloseRun.
  //
  // runStartPreflight itself is mocked here (module boundary) so we can force
  // a genuine throw to prove the "degrade, don't die" contract — every real
  // probe inside runStartPreflight is already best-effort/non-throwing
  // (settings-reader.ts swallows malformed JSON internally), so the ONLY way
  // to observe resolvePreflightSnapshot's own try/catch firing is to inject a
  // failure at this boundary.
  describe("resolvePreflightSnapshot (U3/U6 wiring)", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("returns a well-shaped ResolvedSettingsSnapshot on a healthy preflight (real, unmocked call)", () => {
      const snapshot = resolvePreflightSnapshot(root);
      expect(snapshot?.schema_version).toBe("guild.resolved_settings.v1");
      expect(snapshot?.effective).toHaveProperty("agent_mode");
      expect(snapshot?.effective).toHaveProperty("host");
      expect(snapshot?.providers).toHaveProperty("detected");
      expect(snapshot?.communication_contract).toBe("review_result.v1");
    });

    it("degrades to undefined + logs a WARN to stderr when runStartPreflight throws (preflight failure must NEVER block run start)", () => {
      jest.spyOn(runstartPreflightOriginal, "runStartPreflight").mockImplementationOnce(() => {
        throw new Error("simulated preflight crash");
      });
      const errSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
      const snapshot = resolvePreflightSnapshot(root);
      expect(snapshot).toBeUndefined();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("[run-trace] WARN: run-start preflight failed"),
      );
      errSpy.mockRestore();
    });

    it("startRunOnly still succeeds (run.yaml written, OPEN, no resolved-settings.json) when the snapshot is undefined (degraded)", () => {
      const runId = startRunOnly(root, resolveHost, {
        command: "/guild:build",
        run_class: "full",
        snapshot: undefined,
      }) as string;
      expect(runId).toBeTruthy();
      const runDir = path.join(root, ".guild", "runs", runId);
      expect(fs.existsSync(path.join(runDir, "run.yaml"))).toBe(true);
      const runYaml = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
      expect(runYamlFields(runYaml)).toMatchObject({ status: "open" });
      // Back-compat: no snapshot ⇒ no resolved-settings.json (unchanged from pre-wiring behavior).
      expect(fs.existsSync(path.join(runDir, "resolved-settings.json"))).toBe(false);
      expect(runYaml).not.toContain("settings_ref:");
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

    it("production start persists the live Claude native-adapter identity in session-context.json", () => {
      const { exitCode, stdout } = runCli(
        ["start", "--command=/guild:build", `--cwd=${cliRoot}`],
        { CLAUDECODE: "1", CLAUDE_PLUGIN_ROOT: "" },
      );
      expect(exitCode).toBe(0);
      const runId = stdout.trim();
      const sessionContext = JSON.parse(fs.readFileSync(
        path.join(cliRoot, ".guild", "runs", runId, "session-context.json"),
        "utf8",
      ));
      expect(sessionContext.host).toMatchObject({
        family: "claude",
        surface: "cli",
        adapter_id: "claude-code-native",
        adapter_version: "guild.host_adapter.v1.0.0",
      });
      expect(sessionContext.identity).toMatchObject({
        source: "native_adapter",
        trust: "verified",
        confidence: "high",
      });
      expect(sessionContext.identity.evidence).toContain(
        "adapter contract guild.host_adapter.v1.0.0",
      );
    });

    it("production start without a live host marker preserves the honest unknown identity", () => {
      const { exitCode, stdout } = runCli(
        ["start", "--command=/guild:build", `--cwd=${cliRoot}`],
        { CLAUDECODE: "0", CLAUDE_PLUGIN_ROOT: "" },
      );
      expect(exitCode).toBe(0);
      const runId = stdout.trim();
      const sessionContext = JSON.parse(fs.readFileSync(
        path.join(cliRoot, ".guild", "runs", runId, "session-context.json"),
        "utf8",
      ));
      expect(sessionContext.host).toMatchObject({
        family: "unknown",
        adapter_version: "unknown",
      });
      expect(sessionContext.identity).toMatchObject({
        source: "none",
        confidence: "low",
      });
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

    it("status sub-command preserves the live native-adapter identity (OQ6 gate alias)", () => {
      const { exitCode, stdout } = runCli(
        ["status", `--cwd=${cliRoot}`],
        { CLAUDECODE: "1", CLAUDE_PLUGIN_ROOT: "" },
      );
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
      const sessionContext = JSON.parse(fs.readFileSync(
        path.join(cliRoot, ".guild", "runs", runId, "session-context.json"),
        "utf8",
      ));
      expect(sessionContext.host).toMatchObject({
        family: "claude",
        surface: "cli",
        adapter_id: "claude-code-native",
        adapter_version: "guild.host_adapter.v1.0.0",
      });
      expect(sessionContext.identity).toMatchObject({
        source: "native_adapter",
        trust: "verified",
        confidence: "high",
      });
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

    // ── U3/U6 wiring (audit fix G3c) ───────────────────────────────────────
    //
    // Before this wiring, runStartPreflight had zero production callers and
    // resolved-settings.json never landed on disk in a real run
    // (plugin-implementation-audit-2026-07-12, high/incomplete-wiring). These
    // exercise the REAL CLI subprocess end-to-end (not an injected seam).

    it("start writes resolved-settings.json with the U6 snapshot shape + run.yaml settings_ref (U3/U6 wiring)", () => {
      const { exitCode, stdout } = runCli([
        "start",
        "--command=/guild:build",
        `--cwd=${cliRoot}`,
      ]);
      expect(exitCode).toBe(0);
      const runId = stdout.trim();
      const runDir = path.join(cliRoot, ".guild", "runs", runId);

      const snapshotPath = path.join(runDir, "resolved-settings.json");
      expect(fs.existsSync(snapshotPath)).toBe(true);
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      expect(snapshot.schema_version).toBe("guild.resolved_settings.v1");
      expect(snapshot.effective).toHaveProperty("agent_mode");
      expect(snapshot.effective).toHaveProperty("host");
      expect(snapshot.effective).toHaveProperty("review");
      expect(snapshot.providers).toHaveProperty("detected");
      expect(snapshot.communication_contract).toBe("review_result.v1");
      // U6: resolved_at_ref is stamped to the run-id on write (never null on disk).
      expect(snapshot.resolved_at_ref).toBe(runId);

      // readResolvedSettingsSnapshot is the documented consumer contract
      // (commands/build.md, commands/resume.md: execute-plan reads
      // snapshot.effective.agent_mode via readResolvedSettingsSnapshot(runId, { cwd })).
      const readBack = readResolvedSettingsSnapshot(runId, { cwd: cliRoot });
      expect(readBack).not.toBeNull();
      expect(readBack?.schema_version).toBe("guild.resolved_settings.v1");
      expect(readBack?.effective.agent_mode).toBe(snapshot.effective.agent_mode);

      // run.yaml gains the compact settings_ref pointer (U6).
      const runYaml = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
      expect(runYaml).toContain("settings_ref:");
      expect(runYaml).toContain(`effective_backend: ${snapshot.effective.agent_mode}`);
    });

    it("start --run-class=lightweight ALSO writes resolved-settings.json", () => {
      const { exitCode, stdout } = runCli([
        "start",
        "--command=/guild:status",
        "--run-class=lightweight",
        `--cwd=${cliRoot}`,
      ]);
      expect(exitCode).toBe(0);
      const runId = stdout.trim();
      const snapshotPath = path.join(
        cliRoot, ".guild", "runs", runId, "resolved-settings.json",
      );
      expect(fs.existsSync(snapshotPath)).toBe(true);
    });

    it("start with a syntactically broken .guild/settings.json still starts the run (degraded resilience end-to-end, exit 0)", () => {
      // Not valid JSON. settings-reader.ts's parseSettingsFile already catches
      // this internally and falls back to {} (defaults), so resolveSettings
      // itself never throws — this proves the FULL pipeline (including the
      // new CLI wiring) tolerates a corrupt settings.json without blocking
      // run start, which is the outer invariant the audit fix requires.
      fs.writeFileSync(
        path.join(cliRoot, ".guild", "settings.json"),
        "{ this is not : valid json !!!",
        "utf8",
      );
      const { exitCode, stdout, stderr } = runCli([
        "start",
        "--command=/guild:build",
        `--cwd=${cliRoot}`,
      ]);
      expect(exitCode).toBe(0);
      const runId = stdout.trim();
      expect(runId.length).toBeGreaterThan(0);
      const runDir = path.join(cliRoot, ".guild", "runs", runId);
      expect(fs.existsSync(path.join(runDir, "run.yaml"))).toBe(true);
      const runYaml = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
      expect(runYamlFields(runYaml)).toMatchObject({ status: "open" });
      expect(stderr).not.toMatch(/FATAL/);
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
      const result = recordPhase(root, "build", { runId, binding_ref: refOf(root, runId) });
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
        const result = recordPhase(root, phase, { runId, binding_ref: refOf(root, runId) });
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
      const result = recordPhase(root, "qa", {
        env: { GUILD_RUN_ID: runId, GUILD_RUN_BINDING_REF: refOf(root, runId) },
      });
      expect(result).toBe(runId);
      const runYaml = fs.readFileSync(
        path.join(root, ".guild", "runs", runId, "run.yaml"),
        "utf8",
      );
      expect(runYamlFields(runYaml)).toMatchObject({ phase: "qa" });
    });

    it("does NOT resolve runId from the legacy runs/current-run-id sentinel (T3b §5: fail closed, no write)", () => {
      // CORRECTED (T3b): the sentinel fallback this test used to pin is
      // retired — a writer with no explicit binding env records NOTHING.
      const runId = startedRun(root, "full");
      const sentinelDir = path.join(root, ".guild", "runs");
      fs.mkdirSync(sentinelDir, { recursive: true });
      fs.writeFileSync(path.join(sentinelDir, "current-run-id"), runId, "utf8");

      const result = recordPhase(root, "ops", { env: {} });
      expect(result).toBeNull();
      const runYaml = fs.readFileSync(
        path.join(root, ".guild", "runs", runId, "run.yaml"),
        "utf8",
      );
      expect(runYamlFields(runYaml)).not.toMatchObject({ phase: "ops" });
    });

    it("does NOT resolve runId from the B2 .guild/current-run-id sentinel either (T3b §5)", () => {
      // CORRECTED (T3b): same demotion for the B2 sentinel location.
      const runId = startedRun(root, "full");
      const guildDir = path.join(root, ".guild");
      fs.mkdirSync(guildDir, { recursive: true });
      fs.writeFileSync(path.join(guildDir, "current-run-id"), runId, "utf8");
      const legacyPath = path.join(guildDir, "runs", "current-run-id");
      if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);

      const result = recordPhase(root, "ideate", { env: {} });
      expect(result).toBeNull();
      const runYaml = fs.readFileSync(
        path.join(root, ".guild", "runs", runId, "run.yaml"),
        "utf8",
      );
      expect(runYamlFields(runYaml)).not.toMatchObject({ phase: "ideate" });
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

    it("REWORK F1: an ABANDONED open prior run is REFUSED (left open) — the janitor holds no caller nonce; the new run still starts", () => {
      // CORRECTED (rework F1): the self-heal janitor previously finalized the
      // orphan by letting the guard recover the nonce from the orphan's own
      // binding.json — the exact fail-open escape T3B-R1-F1 closed. The
      // janitor's process holds NO caller-presented nonce for the prior run,
      // so the close is now refused (binding_rejected) and the orphan is
      // honestly left open. Orphan finalization needs an authorized channel
      // (T3-core follow-up) — never nonce recovery.
      const prior = startedRun(root, "full"); // status:open, sentinel -> prior
      expect(statusOf(root, prior)).toBe("open");
      backdateTrace(root, prior, ABANDONED_MS);

      const next = startRunOnly(root, resolveHost, { command: "/guild:evolve" }) as string;
      expect(next).toBeTruthy();
      expect(next).not.toBe(prior);

      // prior is NOT closed (fail closed, no write) — no provenance minted.
      expect(statusOf(root, prior)).toBe("open");
      expect(fs.existsSync(runRel(root, prior, "provenance.json"))).toBe(false);
      // and the new run is open and owns the sentinel — asserted through the
      // INTAKE surface (locateCandidateRunId), since resolveRunIdForTrace is
      // env-only under T3b §5 and never reads a sentinel.
      expect(statusOf(root, next)).toBe("open");
      expect(locateCandidateRunId(root)?.run_id).toBe(next);
      expect(resolveRunIdForTrace(root, {})).toBeNull();
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

    it("REWORK F1: the lightweight path also REFUSES the orphan close (no caller nonce) but records its own run", () => {
      const prior = startedRun(root, "full");
      backdateTrace(root, prior, ABANDONED_MS);
      const statusRun = startAndCloseRun(root, resolveHost, {
        command: "/guild:status",
        run_class: "lightweight",
      }) as string;
      expect(statusRun).toBeTruthy();
      // The orphan stays open (fail closed) — but the lightweight run ITSELF
      // closed fine via its mint-origin nonce (anti-vacuity: the refusal is
      // specific to the foreign run, not a broken close path).
      expect(statusOf(root, prior)).toBe("open");
      expect(statusOf(root, statusRun)).toBe("closed");
    });
  });
});

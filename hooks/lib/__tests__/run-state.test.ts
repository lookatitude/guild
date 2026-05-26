/**
 * Tests for hooks/lib/run-state.ts — the guild.run_state.v1 checkpoint (ADR-RE-1).
 *
 * Covers:
 *   - runStatePath / loadRunState (absent, corrupt, wrong-schema → null)
 *   - writeRunStateAtomic (temp-then-rename leaves no temp siblings)
 *   - upsertLane: fresh seed, merge-preserve, depends_on/receipt_ref/tier/attempt,
 *     top-level identity preservation across writes
 *   - markLaneInProgress (dispatch seam)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  RUN_STATE_SCHEMA_VERSION,
  loadRunState,
  runStatePath,
  writeRunStateAtomic,
  upsertLane,
  markLaneInProgress,
  RunStateV1,
} from "../run-state";

describe("run-state.ts", () => {
  let tmpDir: string;
  let runDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-runstate-"));
    runDir = path.join(tmpDir, ".guild", "runs", "run-abc");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("runStatePath", () => {
    it("resolves <runDir>/run-state.json", () => {
      expect(runStatePath(runDir)).toBe(path.join(runDir, "run-state.json"));
    });
  });

  describe("loadRunState", () => {
    it("returns null when the file is absent", () => {
      expect(loadRunState(runDir)).toBeNull();
    });

    it("returns null on corrupt JSON", () => {
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(runStatePath(runDir), "{ not json");
      expect(loadRunState(runDir)).toBeNull();
    });

    it("returns null when schema_version is wrong", () => {
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(
        runStatePath(runDir),
        JSON.stringify({ schema_version: "guild.run_state.v2", lanes: {} })
      );
      expect(loadRunState(runDir)).toBeNull();
    });
  });

  describe("writeRunStateAtomic", () => {
    it("writes the state and leaves no .tmp sibling behind", () => {
      const state: RunStateV1 = {
        schema_version: RUN_STATE_SCHEMA_VERSION,
        run_id: "run-abc",
        plan_slug: "auth",
        program_id: null,
        wave_index: 0,
        lanes: {},
        last_checkpoint_at: new Date().toISOString(),
      };
      writeRunStateAtomic(runDir, state);

      const loaded = loadRunState(runDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.run_id).toBe("run-abc");

      const siblings = fs.readdirSync(runDir);
      expect(siblings.filter((f) => f.includes(".tmp-"))).toHaveLength(0);
    });
  });

  describe("upsertLane", () => {
    it("seeds a fresh checkpoint with the supplied init identity", () => {
      const state = upsertLane(
        runDir,
        { runId: "run-abc", planSlug: "auth", programId: "auth-prog", waveIndex: 2 },
        "backend-001",
        { status: "done", tier: "mid", receipt_ref: "handoffs/backend-backend-001.md" }
      );

      expect(state.schema_version).toBe(RUN_STATE_SCHEMA_VERSION);
      expect(state.run_id).toBe("run-abc");
      expect(state.plan_slug).toBe("auth");
      expect(state.program_id).toBe("auth-prog");
      expect(state.wave_index).toBe(2);
      expect(state.lanes["backend-001"].status).toBe("done");
      expect(state.lanes["backend-001"].tier).toBe("mid");
      expect(state.lanes["backend-001"].attempt).toBe(1);
      expect(state.lanes["backend-001"].depends_on).toEqual([]);
      expect(state.lanes["backend-001"].receipt_ref).toBe("handoffs/backend-backend-001.md");

      // persisted to disk
      const loaded = loadRunState(runDir);
      expect(loaded?.lanes["backend-001"].status).toBe("done");
    });

    it("defaults plan_slug to runId and program_id to null when init omits them", () => {
      const state = upsertLane(runDir, { runId: "run-xyz" }, "qa-001", { status: "pending" });
      expect(state.plan_slug).toBe("run-xyz");
      expect(state.program_id).toBeNull();
      expect(state.wave_index).toBe(0);
    });

    it("merges a patch into an existing lane, preserving unset fields", () => {
      upsertLane(
        runDir,
        { runId: "run-abc", planSlug: "auth" },
        "backend-001",
        { status: "in_progress", tier: "powerful", attempt: 2, depends_on: ["architect-001"] }
      );
      // Second write only flips status + sets receipt; tier/attempt/depends_on preserved.
      const state = upsertLane(runDir, { runId: "run-abc" }, "backend-001", {
        status: "done",
        receipt_ref: "handoffs/backend-backend-001.md",
      });

      const lane = state.lanes["backend-001"];
      expect(lane.status).toBe("done");
      expect(lane.tier).toBe("powerful");
      expect(lane.attempt).toBe(2);
      expect(lane.depends_on).toEqual(["architect-001"]);
      expect(lane.receipt_ref).toBe("handoffs/backend-backend-001.md");
    });

    it("preserves launcher-seeded top-level identity across later writes", () => {
      // First write (launcher) sets the slug/program/wave.
      upsertLane(
        runDir,
        { runId: "run-abc", planSlug: "auth-revamp", programId: "auth-revamp", waveIndex: 1 },
        "architect-001",
        { status: "in_progress" }
      );
      // Later write (hook) passes only runId — identity must NOT be clobbered.
      const state = upsertLane(runDir, { runId: "run-abc" }, "backend-001", { status: "done" });

      expect(state.plan_slug).toBe("auth-revamp");
      expect(state.program_id).toBe("auth-revamp");
      expect(state.wave_index).toBe(1);
      // Both lanes coexist.
      expect(Object.keys(state.lanes).sort()).toEqual(["architect-001", "backend-001"]);
    });

    it("clears receipt_ref when explicitly passed null, preserves when omitted", () => {
      upsertLane(runDir, { runId: "run-abc" }, "x-001", {
        status: "done",
        receipt_ref: "handoffs/x-x-001.md",
      });
      // omit receipt_ref → preserved
      let state = upsertLane(runDir, { runId: "run-abc" }, "x-001", { status: "done" });
      expect(state.lanes["x-001"].receipt_ref).toBe("handoffs/x-x-001.md");
      // explicit null → cleared
      state = upsertLane(runDir, { runId: "run-abc" }, "x-001", { receipt_ref: null });
      expect(state.lanes["x-001"].receipt_ref).toBeNull();
    });

    it("bumps last_checkpoint_at on each write", () => {
      const s1 = upsertLane(runDir, { runId: "run-abc" }, "a", { status: "pending" });
      const s2 = upsertLane(runDir, { runId: "run-abc" }, "b", { status: "pending" });
      expect(Date.parse(s2.last_checkpoint_at)).toBeGreaterThanOrEqual(
        Date.parse(s1.last_checkpoint_at)
      );
    });
  });

  describe("markLaneInProgress (dispatch seam)", () => {
    it("writes an in_progress lane with tier + depends_on", () => {
      const state = markLaneInProgress(
        runDir,
        { runId: "run-abc", planSlug: "auth" },
        "backend-001",
        { tier: "mid", depends_on: ["architect-001"] }
      );
      const lane = state.lanes["backend-001"];
      expect(lane.status).toBe("in_progress");
      expect(lane.tier).toBe("mid");
      expect(lane.depends_on).toEqual(["architect-001"]);
    });
  });

  describe("concurrent-safe upserts (lock discipline)", () => {
    it("serializes many lane writes without losing any", () => {
      const ids = Array.from({ length: 12 }, (_, i) => `lane-${i}`);
      for (const id of ids) {
        upsertLane(runDir, { runId: "run-abc" }, id, { status: "done" });
      }
      const loaded = loadRunState(runDir);
      expect(Object.keys(loaded!.lanes).sort()).toEqual(ids.sort());
    });
  });
});

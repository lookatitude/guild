/**
 * scripts/__tests__/write-run-manifest.test.ts
 *
 * RE-6 — multi-wave program run-manifest writer.
 *
 * Covers:
 *   - initRunManifest creates a guild.run_manifest.v1 manifest; idempotent
 *     (never clobbers wave progress on re-init).
 *   - upsertWave appends / merges waves and auto-stamps started_at (active) and
 *     completed_at (terminal) transitions.
 *   - current_wave resolves to the lowest non-completed wave (the resume point).
 *   - setProgramStatus flips the program-level status.
 *   - readRunManifest returns null when absent; writes never touch .guild/wiki/.
 *   - CLI: --init / --wave / --status / --show / --handoff-summary.
 *   - TE-04 generated-shape fixture: on-disk JSON uses `wave_index` (not `wave`)
 *     and includes `handoff_summary` per canonical guild.run_manifest.v1 schema.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  initRunManifest,
  upsertWave,
  setProgramStatus,
  readRunManifest,
  manifestPathFor,
  type RunManifest,
} from "../write-run-manifest";

const SCRIPT = path.resolve(__dirname, "../write-run-manifest.ts");
const NODE_ENV = { ...process.env, NODE_NO_WARNINGS: "1", PATH: "/opt/homebrew/bin:/usr/bin:/bin" } as NodeJS.ProcessEnv;

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-runmanifest-"));
}

describe("write-run-manifest — initRunManifest (RE-6)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  it("creates a guild.run_manifest.v1 manifest with status active + empty waves", () => {
    const root = mkRoot();
    const m = initRunManifest(root, "alpha", { title: "Alpha program" });
    expect(m.schema_version).toBe("guild.run_manifest.v1");
    expect(m.slug).toBe("alpha");
    expect(m.title).toBe("Alpha program");
    expect(m.status).toBe("active");
    expect(m.waves).toEqual([]);
    expect(m.current_wave).toBeNull();
    expect(fs.existsSync(manifestPathFor(root, "alpha"))).toBe(true);
  });

  it("has all required guild.run_manifest.v1 top-level keys", () => {
    const root = mkRoot();
    const m = initRunManifest(root, "alpha") as unknown as Record<string, unknown>;
    for (const k of ["schema_version", "slug", "title", "status", "created_at", "updated_at", "current_wave", "waves"]) {
      expect(m).toHaveProperty(k);
    }
  });

  it("idempotent: re-init does NOT clobber existing wave progress", () => {
    const root = mkRoot();
    initRunManifest(root, "alpha");
    upsertWave(root, "alpha", { wave_index: 1, status: "completed", run_id: "run-x" });
    const reinit = initRunManifest(root, "alpha");
    expect(reinit.waves).toHaveLength(1);
    expect(reinit.waves[0]!.status).toBe("completed");
    expect(reinit.waves[0]!.run_id).toBe("run-x");
  });
});

describe("write-run-manifest — upsertWave (RE-6)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  it("appends a new wave with defaults when wave is unknown", () => {
    const root = mkRoot();
    const m = upsertWave(root, "alpha", { wave_index: 2 });
    const w = m.waves.find((x) => x.wave_index === 2)!;
    expect(w.name).toBe("wave-2");
    expect(w.status).toBe("pending");
    expect(w.run_id).toBeNull();
    // TE-04: handoff_summary present on new wave (null by default)
    expect("handoff_summary" in w).toBe(true);
    expect(w.handoff_summary).toBeNull();
  });

  it("merges fields onto an existing wave (does not duplicate)", () => {
    const root = mkRoot();
    upsertWave(root, "alpha", { wave_index: 1, name: "foundation", status: "pending" });
    const m = upsertWave(root, "alpha", { wave_index: 1, status: "active", run_id: "run-1" });
    expect(m.waves.filter((w) => w.wave_index === 1)).toHaveLength(1);
    const w = m.waves.find((x) => x.wave_index === 1)!;
    expect(w.name).toBe("foundation"); // preserved
    expect(w.status).toBe("active");
    expect(w.run_id).toBe("run-1");
  });

  it("auto-stamps started_at when a wave becomes active", () => {
    const root = mkRoot();
    const m = upsertWave(root, "alpha", { wave_index: 1, status: "active" });
    const w = m.waves.find((x) => x.wave_index === 1)!;
    expect(w.started_at).not.toBeNull();
    expect(() => new Date(w.started_at as string)).not.toThrow();
    expect(w.completed_at).toBeNull();
  });

  it("auto-stamps completed_at when a wave completes or fails", () => {
    const root = mkRoot();
    const done = upsertWave(root, "alpha", { wave_index: 1, status: "completed" });
    expect(done.waves[0]!.completed_at).not.toBeNull();
    const failed = upsertWave(root, "alpha", { wave_index: 2, status: "failed" });
    expect(failed.waves.find((w) => w.wave_index === 2)!.completed_at).not.toBeNull();
  });

  it("current_wave is the lowest non-completed wave (the resume point)", () => {
    const root = mkRoot();
    upsertWave(root, "alpha", { wave_index: 1, status: "completed" });
    upsertWave(root, "alpha", { wave_index: 3, status: "pending" });
    const m = upsertWave(root, "alpha", { wave_index: 2, status: "active" });
    expect(m.current_wave).toBe(2);
  });

  it("current_wave points at the last wave when all are completed", () => {
    const root = mkRoot();
    upsertWave(root, "alpha", { wave_index: 1, status: "completed" });
    const m = upsertWave(root, "alpha", { wave_index: 2, status: "completed" });
    expect(m.current_wave).toBe(2);
  });

  it("keeps waves sorted by wave_index", () => {
    const root = mkRoot();
    upsertWave(root, "alpha", { wave_index: 3 });
    upsertWave(root, "alpha", { wave_index: 1 });
    const m = upsertWave(root, "alpha", { wave_index: 2 });
    expect(m.waves.map((w) => w.wave_index)).toEqual([1, 2, 3]);
  });

  it("merges handoff_summary onto an existing wave", () => {
    const root = mkRoot();
    upsertWave(root, "alpha", { wave_index: 1, status: "active" });
    const m = upsertWave(root, "alpha", {
      wave_index: 1,
      status: "completed",
      handoff_summary: "Wave 1 complete — artifacts in .guild/programs/alpha/wave-1/",
    });
    const w = m.waves.find((x) => x.wave_index === 1)!;
    expect(w.handoff_summary).toBe("Wave 1 complete — artifacts in .guild/programs/alpha/wave-1/");
  });
});

describe("write-run-manifest — setProgramStatus + read (RE-6)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  it("setProgramStatus flips the program-level status", () => {
    const root = mkRoot();
    initRunManifest(root, "alpha");
    const m = setProgramStatus(root, "alpha", "completed");
    expect(m.status).toBe("completed");
    expect(readRunManifest(root, "alpha")!.status).toBe("completed");
  });

  it("readRunManifest returns null when absent", () => {
    expect(readRunManifest(mkRoot(), "nope")).toBeNull();
  });

  it("never creates .guild/wiki/", () => {
    const root = mkRoot();
    initRunManifest(root, "alpha");
    upsertWave(root, "alpha", { wave_index: 1, status: "active" });
    expect(fs.existsSync(path.join(root, ".guild", "wiki"))).toBe(false);
  });
});

describe("write-run-manifest — TE-04 generated-shape fixture (RE-6)", () => {
  /**
   * Verifies the REAL on-disk JSON shape, not just the TypeScript API return.
   * This catches regressions where the TS interface is renamed but serialisation
   * still emits the old key name (injected-seam tests would miss this).
   */
  const tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  it("on-disk JSON wave object uses `wave_index` key (not `wave`)", () => {
    const root = mkRoot();
    initRunManifest(root, "shape-test");
    upsertWave(root, "shape-test", { wave_index: 1, status: "active" });

    const raw = fs.readFileSync(manifestPathFor(root, "shape-test"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const waves = parsed["waves"] as Array<Record<string, unknown>>;
    expect(waves).toHaveLength(1);
    // canonical field MUST be present
    expect(waves[0]).toHaveProperty("wave_index", 1);
    // legacy field MUST NOT be present
    expect(waves[0]).not.toHaveProperty("wave");
  });

  it("on-disk JSON wave object includes `handoff_summary` field (null by default)", () => {
    const root = mkRoot();
    initRunManifest(root, "shape-test2");
    upsertWave(root, "shape-test2", { wave_index: 1 });

    const raw = fs.readFileSync(manifestPathFor(root, "shape-test2"), "utf8");
    const waves = (JSON.parse(raw) as Record<string, unknown[]>)["waves"] as Array<Record<string, unknown>>;
    expect(waves[0]).toHaveProperty("handoff_summary");
    expect(waves[0]!["handoff_summary"]).toBeNull();
  });

  it("on-disk JSON wave object includes `handoff_summary` string when provided", () => {
    const root = mkRoot();
    initRunManifest(root, "shape-test3");
    upsertWave(root, "shape-test3", {
      wave_index: 1,
      status: "completed",
      handoff_summary: "shipped to prod",
    });

    const raw = fs.readFileSync(manifestPathFor(root, "shape-test3"), "utf8");
    const waves = (JSON.parse(raw) as Record<string, unknown[]>)["waves"] as Array<Record<string, unknown>>;
    expect(waves[0]!["handoff_summary"]).toBe("shipped to prod");
  });
});

describe("write-run-manifest — CLI (RE-6)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  function run(args: string[]): { status: number; out: string; err: string } {
    const r = spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8", env: NODE_ENV, timeout: 120_000 });
    return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
  }

  it("--init creates the manifest and prints its path", () => {
    const root = mkRoot();
    const r = run(["--cwd", root, "--slug", "alpha", "--init", "--title", "Alpha"]);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toContain(path.join(".guild", "programs", "alpha", "manifest.json"));
    expect(fs.existsSync(manifestPathFor(root, "alpha"))).toBe(true);
  });

  it("--wave upserts a wave; --show prints JSON with wave_index + handoff_summary", () => {
    const root = mkRoot();
    run(["--cwd", root, "--slug", "alpha", "--init"]);
    run([
      "--cwd", root, "--slug", "alpha",
      "--wave", "1", "--wave-name", "foundation", "--wave-status", "completed",
      "--run-id", "run-9", "--handoff-summary", "done",
    ]);
    const r = run(["--cwd", root, "--slug", "alpha", "--show"]);
    expect(r.status).toBe(0);
    const m = JSON.parse(r.out) as RunManifest;
    expect(m.waves[0]!.wave_index).toBe(1);
    expect(m.waves[0]!.name).toBe("foundation");
    expect(m.waves[0]!.status).toBe("completed");
    expect(m.waves[0]!.run_id).toBe("run-9");
    expect(m.waves[0]!.handoff_summary).toBe("done");
  });

  it("--status flips program status via CLI", () => {
    const root = mkRoot();
    run(["--cwd", root, "--slug", "alpha", "--init"]);
    run(["--cwd", root, "--slug", "alpha", "--status", "paused"]);
    expect(readRunManifest(root, "alpha")!.status).toBe("paused");
  });

  it("exits 1 when --slug is missing", () => {
    const root = mkRoot();
    const r = run(["--cwd", root, "--init"]);
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/--slug/);
  });

  it("exits 1 when reading a non-existent program without --init", () => {
    const root = mkRoot();
    const r = run(["--cwd", root, "--slug", "ghost", "--show"]);
    expect(r.status).toBe(1);
  });
});

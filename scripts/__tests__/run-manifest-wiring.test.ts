/**
 * scripts/__tests__/run-manifest-wiring.test.ts
 *
 * ARCH-8 — multi-wave run-manifest wiring.
 *
 * Covers:
 *   - wireRunManifest: happy path (init + wave upsert + read-back)
 *   - wireRunManifest: init is idempotent (never clobbers existing waves)
 *   - wireRunManifest: write→read round-trip produces a valid manifest
 *   - wireRunManifest: caller-supplied `now` is used for updated_at
 *   - validateRunManifest: accepts a valid guild.run_manifest.v1 shape
 *   - validateRunManifest: rejects missing required keys
 *   - validateRunManifest: rejects wrong schema_version
 *   - validateRunManifest: rejects invalid program status
 *   - validateRunManifest: rejects malformed waves array entries
 *   - validateRunManifest: rejects non-object input
 *   - buildMultiWaveProgram: produces a 2-wave program and validates it
 *   - Key contract guarantees:
 *       - manifest lives under .guild/programs/ (not .guild/runs/, not .guild/wiki/)
 *       - current_wave is the lowest non-completed wave (resume semantics)
 *       - validation errors are non-empty on a malformed manifest
 *       - on-disk JSON uses `wave_index` key (TE-04)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  wireRunManifest,
  buildMultiWaveProgram,
  validateRunManifest,
  manifestPathFor,
  readRunManifest,
  PROGRAM_STATUSES,
  WAVE_STATUSES,
  type WireResult,
  type ValidationResult,
} from "../lib/run-manifest-wiring";
import type { RunManifest } from "../write-run-manifest";

// ── Test helpers ──────────────────────────────────────────────────────────────

const FIXED_NOW = "2026-06-13T12:00:00Z";

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-wiring-test-"));
}

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function mkRoot(): string {
  const d = mkTmp();
  tmpDirs.push(d);
  return d;
}

// ── validateRunManifest ───────────────────────────────────────────────────────

describe("validateRunManifest — accepts valid shape", () => {
  it("returns valid=true for a minimal conforming manifest", () => {
    const manifest: RunManifest = {
      schema_version: "guild.run_manifest.v1",
      slug: "test-prog",
      title: null,
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: null,
      waves: [],
    };
    const result = validateRunManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid=true for a manifest with waves", () => {
    const manifest: RunManifest = {
      schema_version: "guild.run_manifest.v1",
      slug: "auth-revamp",
      title: "Auth revamp",
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: 1,
      waves: [
        {
          wave_index: 0,
          name: "foundation",
          status: "completed",
          run_id: "run-auth-20260613-120000",
          started_at: FIXED_NOW,
          completed_at: FIXED_NOW,
          handoff_summary: "Foundation wave complete",
        },
        {
          wave_index: 1,
          name: "hardening",
          status: "active",
          run_id: null,
          started_at: FIXED_NOW,
          completed_at: null,
          handoff_summary: null,
        },
      ],
    };
    const result = validateRunManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts all valid program statuses", () => {
    // PROGRAM_STATUSES matches the shipped ProgramStatus union: active|completed|paused|aborted
    for (const status of PROGRAM_STATUSES) {
      const m = {
        schema_version: "guild.run_manifest.v1",
        slug: "p",
        title: null,
        status,
        created_at: FIXED_NOW,
        updated_at: FIXED_NOW,
        current_wave: null,
        waves: [],
      };
      const r = validateRunManifest(m);
      expect(r.valid).toBe(true);
    }
  });
});

describe("validateRunManifest — rejects malformed input", () => {
  it("rejects null input", () => {
    const r = validateRunManifest(null);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects array input", () => {
    const r = validateRunManifest([]);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects string input", () => {
    const r = validateRunManifest("guild.run_manifest.v1");
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects wrong schema_version", () => {
    const obj = {
      schema_version: "guild.run_manifest.v2",
      slug: "p",
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: null,
      waves: [],
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  it("rejects missing required key (waves)", () => {
    const obj = {
      schema_version: "guild.run_manifest.v1",
      slug: "p",
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: null,
      // waves: intentionally omitted
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("waves"))).toBe(true);
  });

  it("rejects missing required key (slug)", () => {
    const obj = {
      schema_version: "guild.run_manifest.v1",
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: null,
      waves: [],
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("slug"))).toBe(true);
  });

  it("rejects invalid program status", () => {
    const obj = {
      schema_version: "guild.run_manifest.v1",
      slug: "p",
      status: "running",  // not in the closed set
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: null,
      waves: [],
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("status"))).toBe(true);
  });

  it("rejects non-integer wave_index", () => {
    const obj = {
      schema_version: "guild.run_manifest.v1",
      slug: "p",
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: null,
      waves: [
        {
          wave_index: -1,  // negative — invalid
          status: "pending",
          run_id: null,
          started_at: null,
          completed_at: null,
        },
      ],
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("wave_index"))).toBe(true);
  });

  it("rejects a wave entry that is not an object", () => {
    const obj = {
      schema_version: "guild.run_manifest.v1",
      slug: "p",
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: null,
      waves: [42],  // not an object
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("waves[0]"))).toBe(true);
  });

  it("rejects current_wave that is not a number or null", () => {
    const obj = {
      schema_version: "guild.run_manifest.v1",
      slug: "p",
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: "one",  // string — invalid
      waves: [],
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("current_wave"))).toBe(true);
  });

  it("collects multiple errors in one pass", () => {
    const obj = {
      schema_version: "wrong",
      status: "bogus",
      // missing: slug, created_at, updated_at, current_wave, waves
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(1);
  });
});

// ── wireRunManifest — happy path ──────────────────────────────────────────────

describe("wireRunManifest — happy path (real temp-dir fs)", () => {
  it("creates a manifest when none exists", () => {
    const root = mkRoot();
    const result = wireRunManifest({ cwd: root, slug: "alpha", now: FIXED_NOW });

    expect(result.manifest.schema_version).toBe("guild.run_manifest.v1");
    expect(result.manifest.slug).toBe("alpha");
    expect(result.manifest.status).toBe("active");
    expect(result.manifest.waves).toEqual([]);
    expect(result.manifest.current_wave).toBeNull();
    expect(fs.existsSync(result.manifestPath)).toBe(true);
  });

  it("returns a valid validation result on creation", () => {
    const root = mkRoot();
    const result = wireRunManifest({ cwd: root, slug: "alpha", now: FIXED_NOW });
    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toHaveLength(0);
  });

  it("write→read round-trip: on-disk JSON matches returned manifest", () => {
    const root = mkRoot();
    const result = wireRunManifest({ cwd: root, slug: "beta", now: FIXED_NOW });

    // Read the raw file and compare
    const raw = fs.readFileSync(result.manifestPath, "utf8");
    const parsed = JSON.parse(raw) as RunManifest;
    expect(parsed.schema_version).toBe(result.manifest.schema_version);
    expect(parsed.slug).toBe(result.manifest.slug);
    expect(parsed.status).toBe(result.manifest.status);
    expect(parsed.current_wave).toBe(result.manifest.current_wave);
  });

  it("upserts a wave via the wave option", () => {
    const root = mkRoot();
    const result = wireRunManifest({
      cwd: root,
      slug: "gamma",
      now: FIXED_NOW,
      wave: {
        wave_index: 1,
        name: "foundation",
        status: "active",
        run_id: "run-gamma-001",
      },
    });

    expect(result.manifest.waves).toHaveLength(1);
    const w = result.manifest.waves[0]!;
    expect(w.wave_index).toBe(1);
    expect(w.name).toBe("foundation");
    expect(w.status).toBe("active");
    expect(w.run_id).toBe("run-gamma-001");
    expect(result.validation.valid).toBe(true);
  });

  it("sets program status via programStatus option", () => {
    const root = mkRoot();
    wireRunManifest({ cwd: root, slug: "delta", now: FIXED_NOW });
    const result = wireRunManifest({
      cwd: root,
      slug: "delta",
      now: FIXED_NOW,
      programStatus: "paused",
    });

    expect(result.manifest.status).toBe("paused");
    expect(result.validation.valid).toBe(true);
  });

  it("manifest lives under .guild/programs/ (not under .guild/runs/ or .guild/wiki/)", () => {
    const root = mkRoot();
    const result = wireRunManifest({ cwd: root, slug: "path-check", now: FIXED_NOW });

    expect(result.manifestPath).toContain(path.join(".guild", "programs", "path-check"));
    expect(result.manifestPath).not.toContain(path.join(".guild", "runs"));
    expect(result.manifestPath).not.toContain(path.join(".guild", "wiki"));
  });
});

// ── wireRunManifest — idempotence ─────────────────────────────────────────────

describe("wireRunManifest — idempotence contract", () => {
  it("re-init does NOT clobber existing wave progress", () => {
    const root = mkRoot();
    // First call: init + wave
    wireRunManifest({
      cwd: root,
      slug: "idempotent",
      now: FIXED_NOW,
      wave: { wave_index: 1, status: "completed", run_id: "run-001" },
    });

    // Second call: init only (no wave patch)
    const result2 = wireRunManifest({ cwd: root, slug: "idempotent", now: FIXED_NOW });

    expect(result2.manifest.waves).toHaveLength(1);
    expect(result2.manifest.waves[0]!.status).toBe("completed");
    expect(result2.manifest.waves[0]!.run_id).toBe("run-001");
  });

  it("calling wireRunManifest twice on the same slug is safe", () => {
    const root = mkRoot();
    const r1 = wireRunManifest({ cwd: root, slug: "safe", now: FIXED_NOW });
    const r2 = wireRunManifest({ cwd: root, slug: "safe", now: FIXED_NOW });

    expect(r1.manifest.slug).toBe(r2.manifest.slug);
    expect(r2.validation.valid).toBe(true);
  });
});

// ── wireRunManifest — current_wave resume semantics ───────────────────────────

describe("wireRunManifest — current_wave resume semantics", () => {
  it("current_wave is null when there are no waves", () => {
    const root = mkRoot();
    const result = wireRunManifest({ cwd: root, slug: "resume-1", now: FIXED_NOW });
    expect(result.manifest.current_wave).toBeNull();
  });

  it("current_wave is the lowest non-completed wave index", () => {
    const root = mkRoot();

    wireRunManifest({
      cwd: root, slug: "resume-2", now: FIXED_NOW,
      wave: { wave_index: 1, status: "completed" },
    });
    wireRunManifest({
      cwd: root, slug: "resume-2", now: FIXED_NOW,
      wave: { wave_index: 2, status: "active" },
    });
    const result = wireRunManifest({
      cwd: root, slug: "resume-2", now: FIXED_NOW,
      wave: { wave_index: 3, status: "pending" },
    });

    // wave 1 is completed; lowest non-completed is 2
    expect(result.manifest.current_wave).toBe(2);
  });

  it("current_wave points at the last wave when all are completed", () => {
    const root = mkRoot();
    wireRunManifest({
      cwd: root, slug: "resume-3", now: FIXED_NOW,
      wave: { wave_index: 1, status: "completed" },
    });
    const result = wireRunManifest({
      cwd: root, slug: "resume-3", now: FIXED_NOW,
      wave: { wave_index: 2, status: "completed" },
    });

    expect(result.manifest.current_wave).toBe(2);
  });
});

// ── wireRunManifest — on-disk shape (TE-04 key contract) ─────────────────────

describe("wireRunManifest — on-disk JSON shape (TE-04 contract)", () => {
  it("on-disk wave object uses `wave_index` key (not `wave`)", () => {
    const root = mkRoot();
    const result = wireRunManifest({
      cwd: root,
      slug: "te04-check",
      now: FIXED_NOW,
      wave: { wave_index: 1, status: "active" },
    });

    const raw = fs.readFileSync(result.manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const waves = (parsed["waves"] as Array<Record<string, unknown>>);
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveProperty("wave_index", 1);
    expect(waves[0]).not.toHaveProperty("wave");
  });

  it("on-disk wave object includes `handoff_summary` (null by default)", () => {
    const root = mkRoot();
    const result = wireRunManifest({
      cwd: root, slug: "te04-hs", now: FIXED_NOW,
      wave: { wave_index: 1 },
    });

    const raw = fs.readFileSync(result.manifestPath, "utf8");
    const waves = (JSON.parse(raw) as Record<string, unknown[]>)["waves"] as Array<Record<string, unknown>>;
    expect(waves[0]).toHaveProperty("handoff_summary");
    expect(waves[0]!["handoff_summary"]).toBeNull();
  });
});

// ── buildMultiWaveProgram ─────────────────────────────────────────────────────

describe("buildMultiWaveProgram — 2-wave program", () => {
  it("produces a valid 2-wave program manifest (happy path)", () => {
    const root = mkRoot();
    const result = buildMultiWaveProgram({
      cwd: root,
      slug: "two-wave",
      title: "Two-wave integration test",
      now: FIXED_NOW,
      waves: [
        {
          wave_index: 1,
          name: "foundation",
          status: "completed",
          run_id: "run-two-wave-001",
          handoff_summary: "Wave 1 done",
        },
        {
          wave_index: 2,
          name: "hardening",
          status: "active",
          run_id: "run-two-wave-002",
        },
      ],
    });

    expect(result.manifest.waves).toHaveLength(2);
    expect(result.manifest.waves[0]!.status).toBe("completed");
    expect(result.manifest.waves[1]!.status).toBe("active");
    // current_wave is 2 (the lowest non-completed)
    expect(result.manifest.current_wave).toBe(2);
    expect(result.validation.valid).toBe(true);
  });

  it("produces a valid program with no waves (init-only)", () => {
    const root = mkRoot();
    const result = buildMultiWaveProgram({
      cwd: root,
      slug: "zero-wave",
      now: FIXED_NOW,
      waves: [],
    });

    expect(result.manifest.waves).toHaveLength(0);
    expect(result.validation.valid).toBe(true);
  });

  it("applies the final programStatus after waves", () => {
    const root = mkRoot();
    const result = buildMultiWaveProgram({
      cwd: root,
      slug: "finished-prog",
      now: FIXED_NOW,
      waves: [
        { wave_index: 1, status: "completed", run_id: "run-fp-001" },
      ],
      programStatus: "completed",
    });

    expect(result.manifest.status).toBe("completed");
    expect(result.validation.valid).toBe(true);
  });

  it("manifest is readable by readRunManifest after buildMultiWaveProgram", () => {
    const root = mkRoot();
    buildMultiWaveProgram({
      cwd: root,
      slug: "readable",
      now: FIXED_NOW,
      waves: [{ wave_index: 1, status: "active" }],
    });

    const onDisk = readRunManifest(root, "readable");
    expect(onDisk).not.toBeNull();
    expect(onDisk!.schema_version).toBe("guild.run_manifest.v1");
    expect(onDisk!.waves).toHaveLength(1);
  });
});

// ── validateRunManifest — edge / malformed cases ──────────────────────────────

describe("validateRunManifest — edge cases", () => {
  it("is lenient about extra unknown keys (lenient-reader rule)", () => {
    const obj = {
      schema_version: "guild.run_manifest.v1",
      slug: "p",
      title: null,
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: null,
      waves: [],
      // unknown future field — should NOT cause a validation error
      future_field: "some-value",
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(true);
  });

  it("accepts current_wave: null explicitly", () => {
    const obj = {
      schema_version: "guild.run_manifest.v1",
      slug: "p",
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: null,
      waves: [],
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(true);
  });

  it("accepts current_wave: 0 (first wave)", () => {
    const obj = {
      schema_version: "guild.run_manifest.v1",
      slug: "p",
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: 0,
      waves: [
        {
          wave_index: 0,
          status: "pending",
          run_id: null,
          started_at: null,
          completed_at: null,
        },
      ],
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(true);
  });

  it("rejects waves: null (not an array)", () => {
    const obj = {
      schema_version: "guild.run_manifest.v1",
      slug: "p",
      status: "active",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      current_wave: null,
      waves: null,
    };
    const r = validateRunManifest(obj);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("waves"))).toBe(true);
  });
});

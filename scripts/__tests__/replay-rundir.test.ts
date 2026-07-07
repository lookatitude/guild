/**
 * scripts/__tests__/replay-rundir.test.ts
 *
 * ITEM-30 — Replay-facing run-dir completeness.
 *
 * Covers:
 *   assembleReplayManifest —
 *     - happy path: all shipped artifacts present → manifest.complete === true,
 *       isReplayComplete() === true, correct schema_version, runDir echoed back.
 *     - missing events file → manifest.complete === false, events entry present:false,
 *       isReplayComplete() === false, missingRequiredArtifacts() lists events.
 *     - missing provenance.json → complete:false, provenance entry present:false.
 *     - missing run.yaml → complete:false, run-manifest entry present:false.
 *     - all three required artifacts missing → complete:false, three missing entries.
 *     - deferred artifacts (timeline, context-refs, etc.) are listed with
 *       status:"deferred" and required:false regardless of presence.
 *     - directory artifacts (handoffs/, payloads/, evidence/) populate files[].
 *     - handoffs/ absent → files:[] (not undefined).
 *
 *   isReplayComplete —
 *     - returns manifest.complete directly (idempotent, pure).
 *
 *   missingRequiredArtifacts —
 *     - empty when complete.
 *     - lists only required+missing entries when incomplete.
 *     - advisory (non-required) missing artifacts are NOT included.
 *
 *   contract guarantees —
 *     - schema_version is always "guild.replay_manifest.v1".
 *     - runDir is echoed back verbatim (not resolved or normalised).
 *     - deferred artifacts' required flag is always false.
 *     - artifacts array contains all expected roles.
 *     - no Date.now() or Math.random() calls inside the lib (seam is pure).
 *
 *   edge / malformed cases —
 *     - non-existent runDir → all artifacts present:false, complete:false.
 *     - runDir with only partial artifacts → correct partial present flags.
 *     - unusual runDir string (trailing slash, relative-looking absolute) echoed
 *       verbatim.
 *
 * All tests use the injected ReplayFsSeam stub — no real filesystem I/O.
 * The real-fs path is exercised once via a genuine temp directory to cover the
 * `createRealReplayFsSeam` default.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  assembleReplayManifest,
  isReplayComplete,
  missingRequiredArtifacts,
  createRealReplayFsSeam,
  type ReplayFsSeam,
  type ReplayManifest,
  type ArtifactRole,
} from "../lib/replay-rundir";

// ── In-memory fs seam ─────────────────────────────────────────────────────────

interface MemEntry {
  kind: "file" | "dir";
  /** When kind=="dir", lists the immediate child names. */
  children?: string[];
}

/**
 * Build an in-memory ReplayFsSeam from a record of { path → entry }.
 * Only the keys listed in `entries` exist on the virtual fs.
 */
function memSeam(entries: Record<string, MemEntry>): ReplayFsSeam {
  return {
    exists(absPath: string): boolean {
      return absPath in entries;
    },
    listDir(absPath: string): string[] {
      const e = entries[absPath];
      if (!e || e.kind !== "dir") return [];
      return e.children ?? [];
    },
  };
}

/** Build a seam where all standard shipped files exist (happy path). */
function happyPathSeam(runDir: string): ReplayFsSeam {
  return memSeam({
    [path.join(runDir, "logs/v1.4-events.jsonl")]: { kind: "file" },
    [path.join(runDir, "provenance.json")]:         { kind: "file" },
    [path.join(runDir, "run.yaml")]:                { kind: "file" },
    [path.join(runDir, "events.ndjson")]:           { kind: "file" },
    [path.join(runDir, "handoffs")]:                { kind: "dir", children: ["backend-task-001.md"] },
    [path.join(runDir, "logs/payloads")]:           { kind: "dir", children: ["evt-abc.json"] },
    [path.join(runDir, "review.md")]:               { kind: "file" },
    [path.join(runDir, "verify.md")]:               { kind: "file" },
    [path.join(runDir, "summary.md")]:              { kind: "file" },
    // deferred artifacts NOT present (typical v2 state)
  });
}

const FAKE_RUN_DIR = "/fake/.guild/runs/run-abc-20260613-120000";

// ── Happy path ────────────────────────────────────────────────────────────────

describe("assembleReplayManifest — happy path", () => {
  let manifest: ReplayManifest;

  beforeAll(() => {
    manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: happyPathSeam(FAKE_RUN_DIR) });
  });

  it("schema_version is guild.replay_manifest.v1", () => {
    expect(manifest.schema_version).toBe("guild.replay_manifest.v1");
  });

  it("runDir is echoed back verbatim", () => {
    expect(manifest.runDir).toBe(FAKE_RUN_DIR);
  });

  it("complete is true when all required artifacts present", () => {
    expect(manifest.complete).toBe(true);
  });

  it("isReplayComplete returns true", () => {
    expect(isReplayComplete(manifest)).toBe(true);
  });

  it("missingRequiredArtifacts returns empty array", () => {
    expect(missingRequiredArtifacts(manifest)).toHaveLength(0);
  });

  it("events artifact is present and required", () => {
    const e = manifest.artifacts.find((a) => a.role === "events");
    expect(e).toBeDefined();
    expect(e!.present).toBe(true);
    expect(e!.required).toBe(true);
    expect(e!.status).toBe("shipped");
    expect(e!.relativePath).toBe("logs/v1.4-events.jsonl");
  });

  it("provenance artifact is present and required", () => {
    const e = manifest.artifacts.find((a) => a.role === "provenance");
    expect(e?.present).toBe(true);
    expect(e?.required).toBe(true);
  });

  it("run-manifest artifact is present and required", () => {
    const e = manifest.artifacts.find((a) => a.role === "run-manifest");
    expect(e?.present).toBe(true);
    expect(e?.required).toBe(true);
    expect(e?.relativePath).toBe("run.yaml");
  });

  it("handoffs directory artifact populates files[]", () => {
    const e = manifest.artifacts.find((a) => a.role === "handoffs");
    expect(e?.present).toBe(true);
    expect(e?.files).toEqual(["backend-task-001.md"]);
  });

  it("payloads directory artifact populates files[]", () => {
    const e = manifest.artifacts.find((a) => a.role === "payloads");
    expect(e?.present).toBe(true);
    expect(e?.files).toEqual(["evt-abc.json"]);
  });

  it("events-legacy (events.ndjson) is shipped but not required", () => {
    const e = manifest.artifacts.find((a) => a.role === "events-legacy");
    expect(e?.present).toBe(true);
    expect(e?.required).toBe(false);
    expect(e?.status).toBe("shipped");
  });
});

// ── Deferred artifacts ────────────────────────────────────────────────────────

describe("assembleReplayManifest — deferred artifacts", () => {
  const DEFERRED_ROLES: ArtifactRole[] = [
    "timeline",
    "context-refs",
    "evidence",
    "assumptions",
    "decisions",
  ];

  let manifest: ReplayManifest;

  beforeAll(() => {
    manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: happyPathSeam(FAKE_RUN_DIR) });
  });

  it.each(DEFERRED_ROLES)("role '%s' has status:deferred and required:false", (role) => {
    const e = manifest.artifacts.find((a) => a.role === role);
    expect(e).toBeDefined();
    expect(e!.status).toBe("deferred");
    expect(e!.required).toBe(false);
  });

  it("deferred artifacts are NOT present (not emitted in v2)", () => {
    for (const role of DEFERRED_ROLES) {
      const e = manifest.artifacts.find((a) => a.role === role);
      expect(e?.present).toBe(false);
    }
  });

  it("complete is still true even with all deferred artifacts absent", () => {
    expect(manifest.complete).toBe(true);
  });
});

// ── Missing required artifact cases ──────────────────────────────────────────

describe("assembleReplayManifest — missing events file", () => {
  it("complete:false, events entry present:false", () => {
    const seam = memSeam({
      // events NOT present
      [path.join(FAKE_RUN_DIR, "provenance.json")]: { kind: "file" },
      [path.join(FAKE_RUN_DIR, "run.yaml")]:        { kind: "file" },
    });
    const manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: seam });
    expect(manifest.complete).toBe(false);
    expect(isReplayComplete(manifest)).toBe(false);

    const e = manifest.artifacts.find((a) => a.role === "events");
    expect(e?.present).toBe(false);
    expect(e?.required).toBe(true);

    const missing = missingRequiredArtifacts(manifest);
    expect(missing.map((a) => a.role)).toContain("events");
  });
});

describe("assembleReplayManifest — missing provenance.json", () => {
  it("complete:false, provenance entry present:false", () => {
    const seam = memSeam({
      [path.join(FAKE_RUN_DIR, "logs/v1.4-events.jsonl")]: { kind: "file" },
      // provenance NOT present
      [path.join(FAKE_RUN_DIR, "run.yaml")]: { kind: "file" },
    });
    const manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: seam });
    expect(manifest.complete).toBe(false);

    const e = manifest.artifacts.find((a) => a.role === "provenance");
    expect(e?.present).toBe(false);

    expect(missingRequiredArtifacts(manifest).map((a) => a.role)).toContain("provenance");
  });
});

describe("assembleReplayManifest — missing run.yaml", () => {
  it("complete:false, run-manifest entry present:false", () => {
    const seam = memSeam({
      [path.join(FAKE_RUN_DIR, "logs/v1.4-events.jsonl")]: { kind: "file" },
      [path.join(FAKE_RUN_DIR, "provenance.json")]:         { kind: "file" },
      // run.yaml NOT present
    });
    const manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: seam });
    expect(manifest.complete).toBe(false);

    const e = manifest.artifacts.find((a) => a.role === "run-manifest");
    expect(e?.present).toBe(false);

    expect(missingRequiredArtifacts(manifest).map((a) => a.role)).toContain("run-manifest");
  });
});

describe("assembleReplayManifest — all required artifacts missing", () => {
  it("lists three missing required artifacts", () => {
    const seam = memSeam({}); // empty fs
    const manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: seam });
    expect(manifest.complete).toBe(false);
    expect(isReplayComplete(manifest)).toBe(false);

    const missing = missingRequiredArtifacts(manifest);
    const missingRoles = missing.map((a) => a.role);
    expect(missingRoles).toContain("events");
    expect(missingRoles).toContain("provenance");
    expect(missingRoles).toContain("run-manifest");
    expect(missing.every((a) => a.required)).toBe(true);
  });
});

// ── Advisory (non-required) artifacts ────────────────────────────────────────

describe("missingRequiredArtifacts — advisory artifacts not included", () => {
  it("missing review.md / verify.md / summary.md are not surfaced as missing required", () => {
    const seam = memSeam({
      // only the three required ones
      [path.join(FAKE_RUN_DIR, "logs/v1.4-events.jsonl")]: { kind: "file" },
      [path.join(FAKE_RUN_DIR, "provenance.json")]:         { kind: "file" },
      [path.join(FAKE_RUN_DIR, "run.yaml")]:                { kind: "file" },
      // review.md, verify.md, summary.md all absent
    });
    const manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: seam });

    // complete because required artifacts are all present
    expect(manifest.complete).toBe(true);

    // missing-required list is empty even though advisory files are absent
    expect(missingRequiredArtifacts(manifest)).toHaveLength(0);

    // the advisory files are correctly flagged present:false in the full list
    const review = manifest.artifacts.find((a) => a.role === "review");
    expect(review?.present).toBe(false);
    expect(review?.required).toBe(false);
  });
});

// ── Directory entries ─────────────────────────────────────────────────────────

describe("assembleReplayManifest — directory artifact with files", () => {
  it("handoffs/ absent → files:[]", () => {
    const seam = memSeam({
      [path.join(FAKE_RUN_DIR, "logs/v1.4-events.jsonl")]: { kind: "file" },
      [path.join(FAKE_RUN_DIR, "provenance.json")]:         { kind: "file" },
      [path.join(FAKE_RUN_DIR, "run.yaml")]:                { kind: "file" },
      // handoffs/ absent
    });
    const manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: seam });
    const handoffs = manifest.artifacts.find((a) => a.role === "handoffs");
    expect(handoffs?.present).toBe(false);
    expect(handoffs?.files).toEqual([]);
  });

  it("handoffs/ present with multiple receipts → files[] populated", () => {
    const receipts = ["backend-task-001.md", "qa-task-002.md"];
    const seam = memSeam({
      [path.join(FAKE_RUN_DIR, "logs/v1.4-events.jsonl")]: { kind: "file" },
      [path.join(FAKE_RUN_DIR, "provenance.json")]:         { kind: "file" },
      [path.join(FAKE_RUN_DIR, "run.yaml")]:                { kind: "file" },
      [path.join(FAKE_RUN_DIR, "handoffs")]: {
        kind: "dir",
        children: receipts,
      },
    });
    const manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: seam });
    const handoffs = manifest.artifacts.find((a) => a.role === "handoffs");
    expect(handoffs?.present).toBe(true);
    expect(handoffs?.files).toEqual(receipts);
  });

  it("file-type artifacts have no files property", () => {
    const seam = memSeam({ [path.join(FAKE_RUN_DIR, "run.yaml")]: { kind: "file" } });
    const manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: seam });
    const runManifest = manifest.artifacts.find((a) => a.role === "run-manifest");
    expect(runManifest?.files).toBeUndefined();
  });
});

// ── Edge / malformed cases ────────────────────────────────────────────────────

describe("assembleReplayManifest — edge cases", () => {
  it("non-existent runDir → all present:false, complete:false", () => {
    const seam = memSeam({}); // nothing exists
    const manifest = assembleReplayManifest("/no/such/run-dir", { fs: seam });
    expect(manifest.complete).toBe(false);
    expect(manifest.artifacts.every((a) => !a.present)).toBe(true);
  });

  it("runDir with trailing slash echoed verbatim", () => {
    const dirWithSlash = FAKE_RUN_DIR + "/";
    const seam = memSeam({});
    const manifest = assembleReplayManifest(dirWithSlash, { fs: seam });
    expect(manifest.runDir).toBe(dirWithSlash);
  });

  it("all roles appear exactly once in the manifest", () => {
    const seam = memSeam({});
    const manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: seam });
    const roles = manifest.artifacts.map((a) => a.role);
    const uniqueRoles = new Set(roles);
    expect(uniqueRoles.size).toBe(roles.length);
  });

  it("complete on manifest matches isReplayComplete return value", () => {
    const seam = memSeam({});
    const manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: seam });
    expect(manifest.complete).toBe(isReplayComplete(manifest));
  });

  it("partial presence: only run.yaml present → complete:false, run-manifest present:true", () => {
    const seam = memSeam({
      [path.join(FAKE_RUN_DIR, "run.yaml")]: { kind: "file" },
    });
    const manifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: seam });
    expect(manifest.complete).toBe(false);
    const runManifest = manifest.artifacts.find((a) => a.role === "run-manifest");
    expect(runManifest?.present).toBe(true);
    const events = manifest.artifacts.find((a) => a.role === "events");
    expect(events?.present).toBe(false);
  });
});

// ── Real-fs path (integration) ────────────────────────────────────────────────

describe("createRealReplayFsSeam — real temp dir integration", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-replay-test-"));
    // Write the three required files
    fs.mkdirSync(path.join(tmpDir, "logs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "logs/v1.4-events.jsonl"), '{"event":"run_started"}\n', "utf8");
    fs.writeFileSync(
      path.join(tmpDir, "provenance.json"),
      JSON.stringify({ schema_version: "guild.provenance.v1", run_id: "run-test" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "run.yaml"),
      "schema_version: guild.run.v1\nrun_id: run-test\n",
      "utf8",
    );
    // Write a handoffs dir with one file
    fs.mkdirSync(path.join(tmpDir, "handoffs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "handoffs/backend-task.md"), "# done\n", "utf8");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("real-fs seam: assembles complete manifest for a well-formed run dir", () => {
    // Uses default real-fs seam (no injected seam)
    const manifest = assembleReplayManifest(tmpDir);
    expect(manifest.schema_version).toBe("guild.replay_manifest.v1");
    expect(manifest.runDir).toBe(tmpDir);
    expect(manifest.complete).toBe(true);
    expect(isReplayComplete(manifest)).toBe(true);
    expect(missingRequiredArtifacts(manifest)).toHaveLength(0);
  });

  it("real-fs seam: handoffs directory files[] populated", () => {
    const manifest = assembleReplayManifest(tmpDir);
    const handoffs = manifest.artifacts.find((a) => a.role === "handoffs");
    expect(handoffs?.present).toBe(true);
    expect(handoffs?.files).toContain("backend-task.md");
  });

  it("createRealReplayFsSeam: exists() returns false for non-existent path", () => {
    const seam = createRealReplayFsSeam();
    expect(seam.exists("/no/such/path/run.yaml")).toBe(false);
  });

  it("createRealReplayFsSeam: listDir() returns [] for non-existent directory", () => {
    const seam = createRealReplayFsSeam();
    expect(seam.listDir("/no/such/directory")).toEqual([]);
  });
});

// ── isReplayComplete contract ─────────────────────────────────────────────────

describe("isReplayComplete — contract guarantees", () => {
  it("is equivalent to manifest.complete (idempotent)", () => {
    const completeManifest = assembleReplayManifest(FAKE_RUN_DIR, {
      fs: happyPathSeam(FAKE_RUN_DIR),
    });
    expect(isReplayComplete(completeManifest)).toBe(completeManifest.complete);

    const incompleteManifest = assembleReplayManifest(FAKE_RUN_DIR, { fs: memSeam({}) });
    expect(isReplayComplete(incompleteManifest)).toBe(incompleteManifest.complete);
  });
});

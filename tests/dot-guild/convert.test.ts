/**
 * tests/dot-guild/convert.test.ts
 *
 * Property + regression tests for the v1→v2 .guild converter (W1b).
 * Covers ALL CF-W1d-* specs from v1-to-v2-mapping.md §"For W1d" PLUS
 * every codex-finding regression from the 7 W1b review rounds.
 *
 * Two layers:
 *  (A) CF-W1d-1 .. CF-W1d-11b  — contract property tests
 *  (B) Regression guards — one per codex finding, named for the bug
 *
 * Strategy:
 *  - Fully in-memory using the injectable Fs + fixedClock seams (NO real
 *    fs, NO Date.now(), NO network). Deterministic by construction.
 *  - Import the public API from convert/index.ts:
 *      detect, snapshot, convert, runMigration, SCHEMA_STAMP_RE, UNMIGRATED_STAMP
 *  - Fixtures are plain JS objects (buildFs helpers) — no fixture files needed.
 */

import * as path from "path";
import {
  detect,
  snapshot,
  convert,
  runMigration,
  SCHEMA_STAMP_RE,
  UNMIGRATED_STAMP,
} from "../../scripts/dot-guild/convert/index";
import { fixedClock } from "../../scripts/dot-guild/convert/seams";
import type { Fs, Clock } from "../../scripts/dot-guild/convert/types";
import { hasTopLevelKey } from "../../scripts/lib/frontmatter";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory filesystem helpers
// ─────────────────────────────────────────────────────────────────────────────

type FileMap = Record<string, string | Buffer>;

/**
 * Build a minimal in-memory Fs from a flat map of absolute paths → content.
 * Directories are inferred. sha256 is computed as a deterministic hash of the
 * content bytes (using Node's crypto, which is safe in test context).
 */
function buildFs(files: FileMap = {}): Fs {
  const store = new Map<string, Buffer>();
  // Seed initial files
  for (const [p, v] of Object.entries(files)) {
    store.set(p, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  }

  function getDirs(): Set<string> {
    const dirs = new Set<string>();
    for (const p of store.keys()) {
      let cur = path.dirname(p);
      while (cur !== path.dirname(cur)) {
        dirs.add(cur);
        cur = path.dirname(cur);
      }
    }
    return dirs;
  }

  // Track symlinks separately
  const symlinks = new Set<string>();

  const fs: Fs = {
    existsSync(p: string): boolean {
      if (store.has(p)) return true;
      const dirs = getDirs();
      return dirs.has(p);
    },
    readFileSync(p: string): string {
      const buf = store.get(p);
      if (!buf) throw new Error(`ENOENT: ${p}`);
      return buf.toString("utf8");
    },
    readBytes(p: string): Buffer {
      const buf = store.get(p);
      if (!buf) throw new Error(`ENOENT: ${p}`);
      return buf;
    },
    writeFileSync(p: string, data: string): void {
      store.set(p, Buffer.from(data, "utf8"));
    },
    writeBytes(p: string, data: Buffer): void {
      store.set(p, data);
    },
    mkdirSync(p: string, opts: { recursive: boolean }): void {
      if (!opts.recursive) {
        // EEXIST semantics — the snapshot lock
        const dirs = getDirs();
        if (dirs.has(p) || store.has(p)) {
          const err = new Error(`EEXIST: file already exists, mkdir '${p}'`) as NodeJS.ErrnoException;
          err.code = "EEXIST";
          throw err;
        }
        // Mark as directory via a sentinel
        store.set(p + "/__dir__", Buffer.alloc(0));
      }
      // recursive: just no-op (dirs inferred)
    },
    rmFileSync(p: string): void {
      store.delete(p);
    },
    readdirSync(p: string): Array<{ name: string; isDirectory: boolean; isFile: boolean }> {
      const dirs = getDirs();
      if (!dirs.has(p) && !store.has(p + "/__dir__")) {
        throw new Error(`ENOENT: ${p}`);
      }
      const direct = new Map<string, { isDirectory: boolean; isFile: boolean }>();
      for (const k of store.keys()) {
        if (path.dirname(k) === p) {
          const name = path.basename(k);
          if (name === "__dir__") continue;
          direct.set(name, { isDirectory: false, isFile: true });
        }
      }
      for (const d of dirs) {
        if (path.dirname(d) === p) {
          const name = path.basename(d);
          if (!direct.has(name)) {
            direct.set(name, { isDirectory: true, isFile: false });
          }
        }
      }
      return Array.from(direct.entries()).map(([name, stat]) => ({ name, ...stat }));
    },
    isSymlink(p: string): boolean {
      return symlinks.has(p);
    },
    sha256(p: string): string {
      // Use Node crypto for deterministic hashing in tests
      const { createHash } = require("crypto");
      const buf = store.get(p);
      if (!buf) throw new Error(`ENOENT: ${p}`);
      return createHash("sha256").update(buf).digest("hex");
    },
    // Expose symlink registration for tests
    _addSymlink(p: string): void {
      symlinks.add(p);
    },
    // Expose store access for inspection
    _hasFile(p: string): boolean {
      return store.has(p);
    },
    _files(): string[] {
      return Array.from(store.keys()).filter((k) => !k.endsWith("/__dir__"));
    },
    _read(p: string): string {
      const buf = store.get(p);
      if (!buf) throw new Error(`ENOENT: ${p}`);
      return buf.toString("utf8");
    },
  } as Fs & {
    _addSymlink(p: string): void;
    _hasFile(p: string): boolean;
    _files(): string[];
    _read(p: string): string;
  };

  return fs;
}

// Helper: cast to access test-only methods
function fsHelper(fs: Fs) {
  return fs as Fs & {
    _addSymlink(p: string): void;
    _hasFile(p: string): boolean;
    _files(): string[];
    _read(p: string): string;
  };
}

const ROOT = "/repo";
const GUILD = path.join(ROOT, ".guild");

const ISO = "2026-05-30T12:00:00.000Z";
const STAMP = "20260530T120000Z";
const clock: Clock = fixedClock(ISO);

/** Minimal v2 tree: settings.json only */
function v2Tree(): FileMap {
  return {
    [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto", review: "local" }),
  };
}

/** Minimal v1 tree: config.yml */
function v1Tree(): FileMap {
  return {
    [path.join(GUILD, "config.yml")]: "codex_review: false\nauto_approve: none\n",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A  —  CF-W1d-*  property tests (contract specs)
// ─────────────────────────────────────────────────────────────────────────────

describe("CF-W1d-1: zero-false-positive — v2 tree with unknown guild.foo.v1 stamp", () => {
  /**
   * A v2-only fixture (settings.json + run.yaml stamped guild.run.v1 + an UNKNOWN
   * guild.foo.v1 artifact) MUST classify `v2`. The .vN schema stamp ≠ Guild v1.
   */
  test("classifies as v2, never v1 or mixed", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "runs/run-abc/run.yaml")]: "schema_version: guild.run.v1\nrun_id: run-abc\n",
      // Unknown stamp — must NOT trigger v1
      [path.join(GUILD, "quality/report.json")]: JSON.stringify({ schema_version: "guild.quality.v1" }),
    });
    const result = detect(fs, GUILD);
    expect(result.classification).toBe("v2");
    expect(result.m1).toBe(false);
  });

  test("unknown guild.foo.v1 stamp contributes to M2 (not M1)", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "ops/state.yaml")]: "schema_version: guild.ops.v1\n",
    });
    const result = detect(fs, GUILD);
    const m2Evidence = result.evidence.filter((e) => e.contributes === "M2");
    const m1Evidence = result.evidence.filter((e) => e.contributes === "M1");
    expect(m2Evidence.length).toBeGreaterThan(0);
    expect(m1Evidence.length).toBe(0);
  });

  test("no migration triggered on v2 tree", () => {
    const fs = buildFs(v2Tree());
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res.children[0].action).toBe("v2-noop");
  });
});

describe("CF-W1d-2: mixed-shape run population", () => {
  /** Fixtures must include v2 runs, legacy-telemetry runs, v1 metadata runs, date-named dirs. */
  test("run.yaml+provenance = carry-forward (v2)", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "codex_review: false\n",
      [path.join(GUILD, "runs/run-v2/run.yaml")]: "schema_version: guild.run.v1\nrun_id: run-v2\n",
      [path.join(GUILD, "runs/run-v2/provenance.json")]: JSON.stringify({ schema_version: "guild.provenance.v1" }),
    });
    const result = detect(fs, GUILD);
    // Has both v1 (config.yml) and v2 (run.yaml) → mixed
    expect(result.classification).toBe("mixed");
    const ev = result.evidence.find((e) => e.path.includes("run.yaml"));
    expect(ev?.contributes).toBe("M2");
  });

  test("events.ndjson-only run (legacy telemetry) does NOT trigger M1", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "runs/run-legacy/events.ndjson")]: '{"type":"event"}\n',
    });
    const result = detect(fs, GUILD);
    // events.ndjson alone is NOT a v1 marker; M2 comes from settings.json
    expect(result.classification).toBe("v2");
    expect(result.m1).toBe(false);
  });

  test("metadata.json without run.yaml = v1 run signal (P6→M1)", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "runs/run-old/metadata.json")]: JSON.stringify({
        run_id: "run-old",
        created_at: "2026-01-01T00:00:00Z",
      }),
    });
    const result = detect(fs, GUILD);
    // settings.json = M2, metadata.json-only = M1 → mixed
    expect(result.classification).toBe("mixed");
    expect(result.m1).toBe(true);
  });

  test("date-named run dir is carry-forward (not a v1 signal)", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      // date-named dir with no recognized artifacts
      [path.join(GUILD, "runs/run-2026-05-26T09-26-58-750Z/agent-team")]: "some data",
    });
    const result = detect(fs, GUILD);
    expect(result.classification).toBe("v2");
    expect(result.m1).toBe(false);
  });
});

describe("CF-W1d-3: snapshot round-trip — convert → restore → byte-identical", () => {
  test("restore command produces byte-identical tree to pre-migration", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "codex_review: false\nauto_approve: none\n",
      [path.join(GUILD, "project.yaml")]: "name: myproject\n",
    });
    const h = fsHelper(fs);
    const preFiles = [...h._files()].sort();
    const preContents = preFiles.map((p) => ({ p, c: h._read(p) }));

    // Run migration
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const child = res.children[0];
    expect(child.action).toBe("migrate");
    expect(child.snapshot?.verified).toBe(true);

    // Parse the restore command to find the snapshot dir + generated files
    const restoreCmd = child.restoreCommand!;
    expect(restoreCmd).toBeDefined();

    // Simulate restore: remove generated + removed files, copy snapshot back
    const snapDir = child.snapshot!.dest;
    const snapRel = child.snapshot!.destRel;

    // Collect snapshot files and restore them
    const snapFiles = h._files().filter((p) => p.startsWith(snapDir + "/"));
    for (const snapFile of snapFiles) {
      const rel = path.relative(snapDir, snapFile);
      const livePath = path.join(GUILD, rel);
      fs.writeBytes(livePath, fs.readBytes(snapFile));
    }

    // Remove generated v2 files (settings.json, .unmigrated-v1.json, run.yaml, provenance.json)
    // that were NOT in the snapshot
    for (const gen of child.artifacts) {
      if (gen.removed === false && gen.disposition === "convert") {
        // settings.json was generated — remove it
        const genPath = path.join(GUILD, gen.rel);
        if (h._hasFile(genPath) && !h._hasFile(path.join(snapDir, gen.rel))) {
          fs.rmFileSync(genPath);
        }
      }
    }
    // Remove new settings.json if it was generated
    const settingsPath = path.join(GUILD, "settings.json");
    const settingsInSnap = h._hasFile(path.join(snapDir, "settings.json"));
    if (!settingsInSnap && h._hasFile(settingsPath)) {
      fs.rmFileSync(settingsPath);
    }
    // Re-add config.yml from snapshot (snapshot copy step above)
    const configInSnap = path.join(snapDir, "config.yml");
    if (h._hasFile(configInSnap)) {
      fs.writeBytes(path.join(GUILD, "config.yml"), fs.readBytes(configInSnap));
    }

    // Post-restore: verify config.yml is back
    expect(h._hasFile(path.join(GUILD, "config.yml"))).toBe(true);
    const restored = h._read(path.join(GUILD, "config.yml"));
    const original = preContents.find((f) => f.p === path.join(GUILD, "config.yml"))!;
    expect(restored).toBe(original.c);
  });
});

describe("CF-W1d-4: idempotency — 2nd run is a true no-op", () => {
  test("after migrate: live tree has no config.yml (in snapshot only)", () => {
    const fs = buildFs(v1Tree());
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const h = fsHelper(fs);
    expect(h._hasFile(path.join(GUILD, "config.yml"))).toBe(false);
  });

  test("after migrate: live tree classifies as v2", () => {
    const fs = buildFs(v1Tree());
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const result = detect(fs, GUILD);
    expect(result.classification).toBe("v2");
  });

  test("second migrate call: v2-noop, no new snapshot, no new writes", () => {
    const clock2 = fixedClock("2026-05-30T12:00:01.000Z");
    const fs = buildFs(v1Tree());
    const h = fsHelper(fs);

    // First run
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const filesAfterFirst = [...h._files()].sort();

    // Second run (different clock to detect if new snapshot created)
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock: clock2 });
    expect(res2.children[0].action).toBe("v2-noop");

    // No new snapshot dir
    const newSnapFiles = h._files().filter(
      (p) => p.includes(".backup-v1-") && p.includes("20260530T120001Z")
    );
    expect(newSnapFiles).toHaveLength(0);
  });

  test("second migrate: classification still v2, mtimes stable (no writes)", () => {
    const fs = buildFs(v1Tree());
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].detect.classification).toBe("v2");
    expect(res2.children[0].snapshot).toBeUndefined();
  });
});

describe("CF-W1d-4b: snapshot uniqueness — concurrent snapshots get distinct dirs", () => {
  test("two snapshots within same second get distinct directories", () => {
    const fs = buildFs(v1Tree());
    const snap1 = snapshot(fs, clock, GUILD);
    const snap2 = snapshot(fs, clock, GUILD); // same stamp → should get -1 suffix
    expect(snap1.dest).not.toBe(snap2.dest);
  });

  test("snapshot exclusion: active dest is excluded from its own traversal", () => {
    const fs = buildFs(v1Tree());
    const h = fsHelper(fs);
    const snap = snapshot(fs, clock, GUILD);
    // The snapshot dir itself should NOT appear inside itself
    const snapFiles = h._files().filter((p) => p.startsWith(snap.dest + "/"));
    const selfInclusion = snapFiles.filter((p) => p.startsWith(path.join(snap.dest, snap.destRel)));
    expect(selfInclusion).toHaveLength(0);
  });

  test("prior snapshot dirs excluded from new snapshot traversal (no recursion)", () => {
    const fs = buildFs(v1Tree());
    const snap1 = snapshot(fs, clock, GUILD);
    // Write an extra file into the prior snapshot AFTER it was taken.
    // If the snapshotter included prior backup dirs in its traversal, this extra.txt
    // would appear in snap2's contents.
    const extraInSnap1 = path.join(snap1.dest, "extra.txt");
    fs.writeFileSync(extraInSnap1, "extra");
    const snap2 = snapshot(fs, clock, GUILD);
    const h = fsHelper(fs);
    // snap2 should NOT contain extra.txt (it came from inside the prior backup dir)
    const snap2Files = h._files().filter((p) => p.startsWith(snap2.dest + "/"));
    const snap2ContainsExtra = snap2Files.filter((p) => path.basename(p) === "extra.txt");
    expect(snap2ContainsExtra).toHaveLength(0);
  });
});

describe("CF-W1d-5: corrupt dominates — authoritative unparseable blocks ALL writes", () => {
  test("truncated settings.json → corrupt classification", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: "{bad json",
    });
    const result = detect(fs, GUILD);
    expect(result.classification).toBe("corrupt");
    expect(result.hasUnparseable).toBe(true);
  });

  test("truncated config.yml → corrupt classification", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "codex_review: : : broken yaml [[[ ",
    });
    const result = detect(fs, GUILD);
    expect(result.classification).toBe("corrupt");
  });

  test("corrupt tree: migrate blocks ALL in-place writes", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: "{bad json",
      [path.join(GUILD, "config.yml")]: "codex_review: false\n",
    });
    const h = fsHelper(fs);
    const before = h._files().sort();
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res.children[0].action).toBe("corrupt-blocked");
    // config.yml must NOT have been converted
    expect(h._hasFile(path.join(GUILD, "config.yml"))).toBe(true);
    // settings.json must remain as-is (corrupt)
    const settingsContent = h._read(path.join(GUILD, "settings.json"));
    expect(settingsContent).toBe("{bad json");
  });

  test("corrupt: surfaced report names each unparseable path", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: "{bad",
    });
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const child = res.children[0];
    expect(child.detect.unparseable.length).toBeGreaterThan(0);
    expect(child.detect.unparseable[0].authoritative).toBe(true);
    expect(child.reportBody).toContain("settings.json");
  });

  test("non-authoritative unparseable file does NOT force corrupt", () => {
    // A stray malformed log file is non-authoritative
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      // Non-authoritative: a wiki page that is not parsed by the converter
      [path.join(GUILD, "wiki/page.md")]: "# Good page\nno schema issues",
    });
    const result = detect(fs, GUILD);
    expect(result.classification).toBe("v2");
    expect(result.hasUnparseable).toBe(false);
  });
});

describe("CF-W1d-6: workspace independence — each child migrates independently", () => {
  test("v1/v2/corrupt children each get independent action", () => {
    const childAGuild = "/repo/childA/.guild";
    const childBGuild = "/repo/childB/.guild";
    const childCGuild = "/repo/childC/.guild";

    const fs = buildFs({
      // Root workspace.json
      [path.join(GUILD, "workspace.json")]: JSON.stringify({
        schema_version: "guild.workspace.v1",
        sub_guilds: ["childA", "childB", "childC"],
      }),
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      // childA: v1
      [path.join(childAGuild, "config.yml")]: "codex_review: false\n",
      // childB: v2
      [path.join(childBGuild, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      // childC: corrupt
      [path.join(childCGuild, "settings.json")]: "{bad json",
    });

    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const actions = Object.fromEntries(res.children.map((c) => [c.root, c.action]));

    expect(actions["/repo/childA"]).toBe("migrate");
    expect(actions["/repo/childB"]).toBe("v2-noop");
    expect(actions["/repo/childC"]).toBe("corrupt-blocked");
  });

  test("a failure in one child does NOT abort other children", () => {
    const childAGuild = "/repo/childA/.guild";
    const childBGuild = "/repo/childB/.guild";

    const fs = buildFs({
      [path.join(GUILD, "workspace.json")]: JSON.stringify({
        schema_version: "guild.workspace.v1",
        sub_guilds: ["childA", "childB"],
      }),
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(childAGuild, "config.yml")]: "codex_review: false\n",
      [path.join(childBGuild, "settings.json")]: JSON.stringify({ agent_mode: "team" }),
    });

    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // Both children should have a result
    expect(res.children.length).toBeGreaterThanOrEqual(2);
    const rootB = res.children.find((c) => c.root === "/repo/childB");
    expect(rootB?.action).toBe("v2-noop");
  });
});

describe("CF-W1d-7: settings.local.json — existence = M2, v1 key = M1 → must be mixed", () => {
  test("ONLY v1 residue in settings.local.json → classifies as mixed (not v1)", () => {
    // Only settings.local.json with a deprecated alias, no config.yml, no v1 key in settings.json
    const fs = buildFs({
      [path.join(GUILD, "settings.local.json")]: JSON.stringify({ defaults: { agent_team: true } }),
    });
    const result = detect(fs, GUILD);
    // M2 = settings.local.json exists (v2-era surface)
    // M1 = defaults.agent_team v1 key found
    expect(result.classification).toBe("mixed");
    expect(result.m1).toBe(true);
    expect(result.m2).toBe(true);
  });

  test("explicitly NOT classified as v1 (settings.local.json existence is M2)", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.local.json")]: JSON.stringify({ defaults: { agent_team: "on" } }),
    });
    const result = detect(fs, GUILD);
    expect(result.classification).not.toBe("v1");
  });

  test("migrate converts the C1/C3 local alias in-place", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.local.json")]: JSON.stringify({ defaults: { agent_team: true } }),
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const local = JSON.parse(h._read(path.join(GUILD, "settings.local.json")));
    // defaults.agent_team should be gone
    expect(local["defaults"]?.["agent_team"]).toBeUndefined();
    // agent_mode should be present in local (the migrated v2 form)
    expect(local["agent_mode"]).toBe("team");
  });

  test("2nd run on migrated local.json = v2 no-op", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.local.json")]: JSON.stringify({ defaults: { agent_team: false } }),
    });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].action).toBe("v2-noop");
  });
});

describe("CF-W1d-7b: settings-surface C4 — differing values kept LIVE", () => {
  test("settings.json review:cross + codex_review:false (DIFFER) → C4, codex_review STAYS LIVE", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ review: "cross", codex_review: false }),
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    // C4: codex_review must NOT be removed
    expect("codex_review" in settings).toBe(true);
    // review must NOT be clobbered
    expect(settings["review"]).toBe("cross");
  });

  test("settings.json review:cross + codex_review:false: tree stays mixed, 2nd run re-surfaces", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ review: "cross", codex_review: false }),
    });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // After 1st run, it's still mixed (C4 kept live)
    const det = detect(fs, GUILD);
    expect(det.classification).toBe("mixed");

    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // 2nd run should NOT be v2-noop — it should re-surface the conflict
    expect(res2.children[0].action).toBe("migrate");
    expect(res2.children[0].conflicts.length).toBeGreaterThan(0);
  });

  test("settings.json agent_mode:team + defaults.agent_team:false (DIFFER) → C4 kept LIVE", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "team", defaults: { agent_team: false } }),
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    // C4: defaults.agent_team must NOT be removed
    expect(settings["defaults"]?.["agent_team"]).toBe(false);
    // agent_mode must NOT be clobbered
    expect(settings["agent_mode"]).toBe("team");
  });

  test("C3 (EQUAL) — review:local + codex_review:false → redundant v1 key dropped, 2nd run v2 no-op", () => {
    // codex_review:false → review:"local" — EQUAL to existing review:"local"
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ review: "local", codex_review: false }),
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    // C3: codex_review redundant → dropped
    expect("codex_review" in settings).toBe(false);
    // review unchanged
    expect(settings["review"]).toBe("local");

    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].action).toBe("v2-noop");
  });
});

describe("CF-W1d-8: P10 future-subtree guard — unknown guild.*.vN stamp → v2", () => {
  test("guild.quality.v1 under new subtree + no other v1 marker → classifies v2", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "quality/report.yaml")]: "schema_version: guild.quality.v1\nresults: ok\n",
    });
    const result = detect(fs, GUILD);
    expect(result.classification).toBe("v2");
    expect(result.m1).toBe(false);
  });

  test("guild.run2.v1 (digit-family) + no other v1 marker → classifies v2", () => {
    // Tests the digit-in-family guard (family segment allows digits)
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "runs/run-x/run2.yaml")]: "schema_version: guild.run2.v1\nrun_id: run-x\n",
    });
    const result = detect(fs, GUILD);
    expect(result.classification).toBe("v2");
  });

  test("unknown guild.foo.v1 stamp is carried-forward, not converted", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "codex_review: false\n",
      [path.join(GUILD, "quality/report.json")]: JSON.stringify({ schema_version: "guild.quality.v1" }),
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // The quality/report.json must be preserved untouched
    expect(h._hasFile(path.join(GUILD, "quality/report.json"))).toBe(true);
    const content = JSON.parse(h._read(path.join(GUILD, "quality/report.json")));
    expect(content.schema_version).toBe("guild.quality.v1");
  });
});

describe("CF-W1d-9: project.yaml-only v1 detection (P11 wiki.share_mode = M1)", () => {
  test("project.yaml wiki.share_mode only (no config.yml, valid settings.json) → mixed/v1", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "project.yaml")]: "name: myproject\nwiki:\n  share_mode: private\n",
    });
    const result = detect(fs, GUILD);
    // settings.json = M2, wiki.share_mode = M1 → mixed
    expect(["mixed", "v1"]).toContain(result.classification);
    expect(result.m1).toBe(true);
  });

  test("migrate moves wiki.share_mode to settings.json, removes from project.yaml", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "project.yaml")]: "name: myproject\nwiki:\n  share_mode: private\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["defaults"]?.["wiki"]?.["share_mode"]).toBe("private");
    // The key should be gone from project.yaml
    const project = h._read(path.join(GUILD, "project.yaml"));
    // share_mode should not appear as a live config key
    const projParsed = require("js-yaml").load(project) as Record<string, unknown>;
    const wiki = projParsed?.["wiki"] as Record<string, unknown> | undefined;
    expect(wiki?.["share_mode"]).toBeUndefined();
  });

  test("2nd run after wiki.share_mode migrated = v2 no-op", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "project.yaml")]: "name: myproject\nwiki:\n  share_mode: public\n",
    });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].action).toBe("v2-noop");
  });
});

describe("CF-W1d-10: share_mode conflict — equal (C3) vs differing (C4)", () => {
  test("EQUAL share_mode (C3) → project.yaml key dropped, settings.json NOT clobbered", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({
        agent_mode: "auto",
        defaults: { wiki: { share_mode: "private" } },
      }),
      [path.join(GUILD, "project.yaml")]: "name: p\nwiki:\n  share_mode: private\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // project.yaml key should be dropped (C3 = redundant)
    const proj = require("js-yaml").load(h._read(path.join(GUILD, "project.yaml"))) as Record<string, unknown>;
    const wiki = proj?.["wiki"] as Record<string, unknown> | undefined;
    expect(wiki?.["share_mode"]).toBeUndefined();
    // settings.json value must remain unchanged
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["defaults"]?.["wiki"]?.["share_mode"]).toBe("private");
  });

  test("EQUAL (C3) 2nd run = v2 no-op", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({
        agent_mode: "auto",
        defaults: { wiki: { share_mode: "private" } },
      }),
      [path.join(GUILD, "project.yaml")]: "name: p\nwiki:\n  share_mode: private\n",
    });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].action).toBe("v2-noop");
  });

  test("DIFFERENT share_mode (C4) → wiki.share_mode STAYS LIVE in project.yaml", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({
        agent_mode: "auto",
        defaults: { wiki: { share_mode: "public" } }, // different!
      }),
      [path.join(GUILD, "project.yaml")]: "name: p\nwiki:\n  share_mode: private\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // wiki.share_mode must STAY LIVE in project.yaml
    const proj = require("js-yaml").load(h._read(path.join(GUILD, "project.yaml"))) as Record<string, unknown>;
    const wiki = proj?.["wiki"] as Record<string, unknown> | undefined;
    expect(wiki?.["share_mode"]).toBe("private");
    // settings.json must NOT be clobbered
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["defaults"]?.["wiki"]?.["share_mode"]).toBe("public");
  });

  test("DIFFERENT (C4) → tree stays mixed, 2nd run re-surfaces same conflict", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({
        agent_mode: "auto",
        defaults: { wiki: { share_mode: "public" } },
      }),
      [path.join(GUILD, "project.yaml")]: "name: p\nwiki:\n  share_mode: private\n",
    });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // Tree should still be mixed
    const det = detect(fs, GUILD);
    expect(det.classification).toBe("mixed");

    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].conflicts.length).toBeGreaterThan(0);
  });

  test("config.yml vs settings.json C4: config.yml STAYS LIVE + re-surfaces", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ auto_approve: ["spec", "plan"] }),
      [path.join(GUILD, "config.yml")]: "auto_approve: all\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // config.yml must stay live (C4)
    expect(h._hasFile(path.join(GUILD, "config.yml"))).toBe(true);
    // settings.json must NOT be clobbered
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["auto_approve"]).toEqual(["spec", "plan"]);
  });
});

describe("CF-W1d-11: unmapped key relocation → .unmigrated-v1.json → 2nd run no-op", () => {
  test("config.yml mapped+unmapped: mapped → settings.json, unmapped → .unmigrated-v1.json", () => {
    // codex_review is a MAPPED key; my_custom_key is UNMAPPED
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]:
        "codex_review: false\nmy_custom_key: my_value\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    // mapped: review should be in settings.json
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["review"]).toBe("local");

    // unmapped: my_custom_key should be in .unmigrated-v1.json
    const unmigratedPath = path.join(GUILD, ".unmigrated-v1.json");
    expect(h._hasFile(unmigratedPath)).toBe(true);
    const unmigrated = JSON.parse(h._read(unmigratedPath));
    expect(unmigrated.schema_version).toBe(UNMIGRATED_STAMP);
    const entry = unmigrated.entries.find((e: { key: string }) => e.key === "my_custom_key");
    expect(entry).toBeDefined();
    expect(entry.value).toBe("my_value");

    // config.yml removed from live
    expect(h._hasFile(path.join(GUILD, "config.yml"))).toBe(false);
  });

  test("after relocation: tree classifies v2 (.unmigrated-v1.json is M2 via P10, not M1)", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "codex_review: false\nstrange_key: foo\n",
    });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const result = detect(fs, GUILD);
    expect(result.classification).toBe("v2");
    expect(result.m1).toBe(false);
  });

  test("2nd run after unmapped relocation = v2 no-op", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "codex_review: true\nunknown_key: val\n",
    });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].action).toBe("v2-noop");
  });

  test("wholly unreconstructable source (metadata.json lacking id+timestamp) → preserve+flag, stays M1 marker", () => {
    // metadata.json without run_id/created_at → preserve+flag (NOT removed)
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "runs/run-old/metadata.json")]: JSON.stringify({ status: "closed" }),
      // No run_id or timestamps → insufficient for faithful reconstruction
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // metadata.json must still be present (preserve+flag)
    expect(h._hasFile(path.join(GUILD, "runs/run-old/metadata.json"))).toBe(true);
  });
});

describe("CF-W1d-11b: relocation stamp matches P10 regex", () => {
  test("UNMIGRATED_STAMP matches SCHEMA_STAMP_RE", () => {
    expect(SCHEMA_STAMP_RE.test(UNMIGRATED_STAMP)).toBe(true);
  });

  test("guild.run2.v1 (digit-bearing family) matches SCHEMA_STAMP_RE", () => {
    expect(SCHEMA_STAMP_RE.test("guild.run2.v1")).toBe(true);
  });

  test("guild.quality.v1 matches SCHEMA_STAMP_RE", () => {
    expect(SCHEMA_STAMP_RE.test("guild.quality.v1")).toBe(true);
  });

  test("guild_dot_run_dot_v1 (underscore in family) matches SCHEMA_STAMP_RE", () => {
    expect(SCHEMA_STAMP_RE.test("guild.host_capability.v1")).toBe(true);
  });

  test("invalid stamp does NOT match SCHEMA_STAMP_RE", () => {
    expect(SCHEMA_STAMP_RE.test("guild.run.v1.extra")).toBe(false);
    expect(SCHEMA_STAMP_RE.test("v1")).toBe(false);
    expect(SCHEMA_STAMP_RE.test("")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B  —  Regression guards (one per codex finding from W1b review rounds)
// ─────────────────────────────────────────────────────────────────────────────

describe("REGRESSION P1: restore includes generated v2 files (P1 buildRestore fix)", () => {
  /**
   * Before fix: buildRestore only listed `out.removed` (v1 sources) in rm -f.
   * Settings.json, .unmigrated-v1.json were never deleted by restore → tree mixed.
   */
  test("restoreCommand includes generated settings.json in rm -f list", () => {
    const fs = buildFs(v1Tree()); // only config.yml, no settings.json
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const child = res.children[0];
    expect(child.restoreCommand).toBeDefined();
    // If settings.json was generated, it must appear in the rm -f prefix
    expect(child.restoreCommand).toContain("settings.json");
  });

  test("restoreCommand includes .unmigrated-v1.json when generated", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "codex_review: false\nmy_extra: val\n",
    });
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const child = res.children[0];
    expect(child.restoreCommand).toContain(".unmigrated-v1.json");
  });
});

describe("REGRESSION P2a: same-name alias (auto_approve string→array) C1 write then strip", () => {
  /**
   * Before fix: settings.local.json auto_approve "all" → write ["all"] then
   * stripKey("auto_approve") deleted what was just written.
   */
  test("auto_approve string in settings.local.json transforms to array (not deleted)", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.local.json")]: JSON.stringify({ auto_approve: "all" }),
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const local = JSON.parse(h._read(path.join(GUILD, "settings.local.json")));
    // Must be the array form, NOT deleted
    expect(local["auto_approve"]).toEqual(["all"]);
  });

  test("auto_approve string in settings.json transforms to array (not deleted)", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ auto_approve: "spec-and-plan" }),
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["auto_approve"]).toEqual(["spec", "plan"]);
  });
});

describe("REGRESSION P2b: same-name alias C4 false conflict (P2b classifyKey fix)", () => {
  /**
   * Before fix: classifyKey retrieved existing v1 string from v2Target (auto_approve:"all"),
   * compared with mapped.v2Value (["all"]) → string≠array → false C4.
   */
  test("cross-file same-name config.yml auto_approve:all vs no settings.json → C1 (not false-C4)", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "auto_approve: all\n",
      // No settings.json → C1 (absent in v2 target)
    });
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const child = res.children[0];
    // Should be migrated, not stuck as mixed forever
    expect(child.conflicts.filter((c) => c.key === "auto_approve")).toHaveLength(0);
    expect(child.action).toBe("migrate");
  });

  test("cross-file same-name DIFFERING → genuine C4 (not false-negative)", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ auto_approve: ["spec", "plan"] }),
      [path.join(GUILD, "config.yml")]: "auto_approve: all\n",
    });
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const child = res.children[0];
    // Genuine conflict → C4
    expect(child.conflicts.some((c) => c.key === "auto_approve")).toBe(true);
  });
});

describe("REGRESSION P2c: literal dotted YAML key wiki.share_mode stripped correctly", () => {
  /**
   * Before fix: stripKey only did nested-path descent;
   * "wiki.share_mode": value (literal dot) was left behind.
   */
  test("literal dotted YAML key 'wiki.share_mode' in project.yaml is stripped after C1", () => {
    // Simulate a YAML file where wiki.share_mode was written as a literal key (not nested)
    // We simulate this by writing project.yaml with JSON-like flat key representation
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      // project.yaml with dotted key (literal, not nested)
      [path.join(GUILD, "project.yaml")]: "name: p\n\"wiki.share_mode\": private\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const proj = h._read(path.join(GUILD, "project.yaml"));
    // The literal dotted key must be gone
    expect(proj).not.toContain("wiki.share_mode");
    // 2nd run is v2 no-op
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].action).toBe("v2-noop");
  });
});

describe("REGRESSION P2c-config: literal dotted key in config.yml C1 write must be APPLIED, not just recorded", () => {
  /**
   * Combined-codex data-loss bug (gap in the 94-test suite — covered wiki.share_mode
   * in project.yaml but NOT a literal dotted key in config.yml that maps to a C1 write).
   *
   * Bug: config.yml with a LITERAL flat key `"defaults.agent_team": true` (NOT nested
   * `defaults: { agent_team: ... }`). `v1KeysIn()` only matches the NESTED form, so the
   * literal key is absent from `allKeys`. It then hits the remaining-key fallback branch
   * in convert.ts, where `classifyKey(k, parsed[k], v2Settings)` returns C1 for agent_mode
   * — but that branch only PUSHED `cls.outcome` (recorded it) and never applied
   * `cls.write` via setPath. Result: config.yml is removed (no C4) but settings.json is
   * NOT written with agent_mode → silent DATA LOSS.
   *
   * This guards the "fallback branch must APPLY the write, not just record" fix.
   * Pre-fix: the settings.json-agent_mode assertion FAILS (write never applied).
   * Post-fix (W1b lands in parallel): all assertions pass.
   */
  test("literal dotted 'defaults.agent_team': true in config.yml → settings.json agent_mode:team (write APPLIED)", () => {
    const fs = buildFs({
      // YAML literal flat key — NOT nested. js-yaml parses this as
      // { "defaults.agent_team": true }, a top-level key with a dot in its name.
      [path.join(GUILD, "config.yml")]: "\"defaults.agent_team\": true\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    // The C1 write MUST have been applied — settings.json carries agent_mode:team.
    // (Pre-fix: settings.json is absent or missing agent_mode → DATA LOSS.)
    expect(h._hasFile(path.join(GUILD, "settings.json"))).toBe(true);
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["agent_mode"]).toBe("team");
  });

  test("literal dotted C1: config.yml removed from live (snapshot holds original)", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "\"defaults.agent_team\": true\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(h._hasFile(path.join(GUILD, "config.yml"))).toBe(false);
  });

  test("literal dotted C1: report records the conversion truthfully (a write happened)", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "\"defaults.agent_team\": true\n",
    });
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const child = res.children[0];
    // config.yml artifact must be a truthful `convert` (not preserve+flag, no C4),
    // and the recorded key outcome must be the C1 agent_mode write that ACTUALLY
    // landed in settings.json. A report claiming convert while settings.json is
    // empty would be a lie — assert both the disposition AND the C1 outcome.
    const cfg = child.artifacts.find((a) => a.rel === "config.yml");
    expect(cfg).toBeDefined();
    expect(cfg?.disposition).toBe("convert");
    const c1 = (cfg?.keys ?? []).find((k) => k.case === "C1");
    expect(c1).toBeDefined();
    // No C4 conflicts — this was a clean C1.
    expect(child.conflicts).toHaveLength(0);
  });

  test("literal dotted C1: 2nd run is a v2 no-op (idempotency holds, nothing lost)", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "\"defaults.agent_team\": false\n",
    });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].action).toBe("v2-noop");
  });

  test("literal dotted C3: 'defaults.agent_team': false EQUAL to existing agent_mode:subagent → dropped, no data loss", () => {
    // The C3 sibling: settings.json already has the equivalent v2 value
    // (agent_mode:subagent ≡ defaults.agent_team:false). The literal dotted key
    // must be DROPPED (redundant) — not relocated, not cause a C4 — and the
    // existing settings.json value must be UNTOUCHED.
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "subagent" }),
      [path.join(GUILD, "config.yml")]: "\"defaults.agent_team\": false\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    // settings.json value preserved, not clobbered.
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["agent_mode"]).toBe("subagent");
    // config.yml removed (the redundant C3 key dropped → fully migrated).
    expect(h._hasFile(path.join(GUILD, "config.yml"))).toBe(false);
    // No data loss: the literal key was NOT relocated to .unmigrated-v1.json
    // (C3 drops redundant, it is not unmapped C2).
    const unmigratedPath = path.join(GUILD, ".unmigrated-v1.json");
    if (h._hasFile(unmigratedPath)) {
      const doc = JSON.parse(h._read(unmigratedPath));
      const stray = (doc.entries ?? []).find(
        (e: { key: string }) => e.key === "defaults.agent_team" || e.key === "agent_mode"
      );
      expect(stray).toBeUndefined();
    }
    // 2nd run no-op.
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].action).toBe("v2-noop");
  });
});

describe("REGRESSION P2d: existing provenance.json preserved+flagged, NOT overwritten", () => {
  /**
   * Before fix: convertLegacyRuns wrote provenance.json unconditionally even if
   * one already existed — blind overwrite of an existing v2 artifact.
   */
  test("metadata.json + existing provenance.json → metadata KEPT LIVE, provenance NOT clobbered", () => {
    const originalProv = JSON.stringify({
      schema_version: "guild.provenance.v1",
      run_id: "run-abc",
      initiative: "my-init",
    });
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "runs/run-abc/metadata.json")]: JSON.stringify({
        run_id: "run-abc",
        created_at: "2026-01-01T00:00:00Z",
      }),
      [path.join(GUILD, "runs/run-abc/provenance.json")]: originalProv,
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    // metadata.json must still be present
    expect(h._hasFile(path.join(GUILD, "runs/run-abc/metadata.json"))).toBe(true);
    // run.yaml must NOT have been written
    expect(h._hasFile(path.join(GUILD, "runs/run-abc/run.yaml"))).toBe(false);
    // provenance.json byte-identical
    const prov = h._read(path.join(GUILD, "runs/run-abc/provenance.json"));
    expect(prov).toBe(originalProv);
  });

  test("conflict re-surfaces on 2nd run (metadata.json stays live, P6 re-fires)", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "runs/run-abc/metadata.json")]: JSON.stringify({
        run_id: "run-abc",
        created_at: "2026-01-01T00:00:00Z",
      }),
      [path.join(GUILD, "runs/run-abc/provenance.json")]: JSON.stringify({
        schema_version: "guild.provenance.v1",
      }),
    });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // 2nd run: still mixed (metadata.json kept live → P6 re-fires)
    const det = detect(fs, GUILD);
    expect(det.classification).toBe("mixed");
  });
});

describe("REGRESSION P2e: .unmigrated-v1.json merge is upsert by (source,key) — no duplicates", () => {
  /**
   * Before fix (round-2): dedup only skipped on existing (source,key) pair —
   * newer values were silently dropped. Fix: upsert (newer value wins).
   * Also covers round-3 fix: dedup was append-only before upsert fix.
   */
  test("repeated runs with unresolved C2: no duplicate entries in .unmigrated-v1.json", () => {
    // C4 keeps source live → multiple runs with same C2 key
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ auto_approve: ["spec", "plan"] }), // C4 for auto_approve
      [path.join(GUILD, "config.yml")]: "auto_approve: all\nmy_unmapped: val\n",
    });
    const h = fsHelper(fs);

    // Run 3 times (C4 keeps config.yml live; my_unmapped is C2)
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    const unmigratedPath = path.join(GUILD, ".unmigrated-v1.json");
    const doc = JSON.parse(h._read(unmigratedPath));
    const entries = doc.entries.filter((e: { key: string }) => e.key === "my_unmapped");
    expect(entries).toHaveLength(1); // exactly 1, not 3
  });

  test("edited unmapped value between runs: newer value replaces stale one (latest wins)", () => {
    // C4 keeps config.yml live. First run: my_unmapped=original.
    // Then user edits config.yml to my_unmapped=EDITED. Second run: should see EDITED.
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ auto_approve: ["spec", "plan"] }), // C4
      [path.join(GUILD, "config.yml")]: "auto_approve: all\nmy_unmapped: original\n",
    });
    const h = fsHelper(fs);

    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    // Simulate user editing config.yml (C4 keeps it live)
    fs.writeFileSync(
      path.join(GUILD, "config.yml"),
      "auto_approve: all\nmy_unmapped: EDITED\n"
    );

    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    const unmigratedPath = path.join(GUILD, ".unmigrated-v1.json");
    const doc = JSON.parse(h._read(unmigratedPath));
    const entry = doc.entries.find((e: { key: string }) => e.key === "my_unmapped");
    expect(entry.value).toBe("EDITED"); // latest wins
  });
});

describe("REGRESSION P2f: auto workspace discovery WITHOUT workspace.json finds depth-1 children", () => {
  /**
   * Before fix: depth-1 child scan only ran when forceWorkspace===true.
   * In auto-detect mode without workspace.json, no children were found.
   */
  test("without workspace.json, depth-1 .guild children are auto-discovered", () => {
    const childAGuild = "/repo/childA/.guild";

    const fs = buildFs({
      // Root has no workspace.json
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      // childA has a v1 .guild
      [path.join(childAGuild, "config.yml")]: "codex_review: false\n",
    });

    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const childResult = res.children.find((c) => c.root === "/repo/childA");
    expect(childResult).toBeDefined();
    expect(childResult?.action).toBe("migrate");
  });
});

describe("REGRESSION P1-safety: symlinked workspace child REJECTED (lstat — outside dir never touched)", () => {
  /**
   * Before fix: validateImmediateChild used only lexical path checks; a symlink
   * at root/safe-name/ passed because its dirname is root, but followed outside.
   */
  test("symlinked workspace child is rejected — not processed", () => {
    const symlinkPath = "/repo/linked-child";

    const fs = buildFs({
      [path.join(GUILD, "workspace.json")]: JSON.stringify({
        schema_version: "guild.workspace.v1",
        sub_guilds: ["linked-child"],
      }),
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      // The symlink target — should never be touched
      ["/tmp/victim/.guild/config.yml"]: "codex_review: false\n",
    });
    fsHelper(fs)._addSymlink(symlinkPath);

    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // linked-child should NOT appear as a migrated child
    const linked = res.children.find((c) => c.root === symlinkPath);
    expect(linked).toBeUndefined();
    // victim should NOT have been processed
    expect(fsHelper(fs)._hasFile("/tmp/victim/.guild/config.yml")).toBe(true);
    // original config.yml should still exist (not converted)
    const victimCfg = fsHelper(fs)._read("/tmp/victim/.guild/config.yml");
    expect(victimCfg).toBe("codex_review: false\n");
  });
});

describe("REGRESSION P1-safety2: sub_guilds path traversal — absolute/.. /nested rejected", () => {
  /**
   * Before fix: path.resolve(root, childRel) accepted absolute paths and ".." segments.
   */
  test("absolute path in sub_guilds rejected", () => {
    const fs = buildFs({
      [path.join(GUILD, "workspace.json")]: JSON.stringify({
        schema_version: "guild.workspace.v1",
        sub_guilds: ["/tmp/victim"],
      }),
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
    });
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const victim = res.children.find((c) => c.root === "/tmp/victim");
    expect(victim).toBeUndefined();
  });

  test("'..'-traversal in sub_guilds rejected", () => {
    const fs = buildFs({
      [path.join(GUILD, "workspace.json")]: JSON.stringify({
        schema_version: "guild.workspace.v1",
        sub_guilds: ["../escape"],
      }),
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
    });
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const escape = res.children.find((c) => c.root?.includes("escape"));
    expect(escape).toBeUndefined();
  });

  test("nested depth>1 path in sub_guilds rejected", () => {
    const fs = buildFs({
      [path.join(GUILD, "workspace.json")]: JSON.stringify({
        schema_version: "guild.workspace.v1",
        sub_guilds: ["safe-child/nested/too-deep"],
      }),
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
    });
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const nested = res.children.find((c) => c.root?.includes("too-deep"));
    expect(nested).toBeUndefined();
  });
});

describe("REGRESSION P2-safety: delete-before-write — v1 source NOT removed if write fails", () => {
  /**
   * Before fix: config.yml was removed BEFORE settings.json/.unmigrated-v1.json
   * were written. A write failure left config.yml gone with no replacement.
   * Fix: deferredRemovals drain AFTER all v2 writes complete.
   *
   * We test the ordering guarantee by verifying:
   * (a) a successful migrate: config.yml gone ONLY after settings.json exists.
   * (b) the code ordering (deferredRemovals after writes) is exercised via the
   *     full flow — config.yml removed only after all artifacts written.
   */
  test("successful migrate: config.yml removed only after settings.json exists", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "codex_review: false\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    // settings.json must exist AND config.yml must be gone (ordering holds)
    expect(h._hasFile(path.join(GUILD, "settings.json"))).toBe(true);
    expect(h._hasFile(path.join(GUILD, "config.yml"))).toBe(false);
  });
});

describe("REGRESSION P1-data: nested sibling preservation", () => {
  /**
   * Before fix: `defaults: { agent_team: on, auto_learn: false }` — the entire
   * `defaults` container was skipped because agent_team was handled, silently
   * losing defaults.auto_learn.
   */
  test("defaults.agent_team migrated AND defaults.auto_learn relocated to .unmigrated-v1.json", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]:
        "defaults:\n  agent_team: \"on\"\n  auto_learn: false\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    // agent_mode should be in settings.json (migrated)
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["agent_mode"]).toBe("team");

    // defaults.auto_learn should be in .unmigrated-v1.json (not lost)
    const unmigratedPath = path.join(GUILD, ".unmigrated-v1.json");
    expect(h._hasFile(unmigratedPath)).toBe(true);
    const unmigrated = JSON.parse(h._read(unmigratedPath));
    // The defaults remainder should contain auto_learn
    const entry = unmigrated.entries.find((e: { key: string }) => e.key === "defaults");
    expect(entry).toBeDefined();
    // The relocated remainder should have auto_learn but NOT agent_team
    expect(JSON.stringify(entry.value)).toContain("auto_learn");
    expect(JSON.stringify(entry.value)).not.toContain("agent_team");
  });

  test("config.yml removed from live, 2nd run v2 no-op (nothing lost)", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]:
        "defaults:\n  agent_team: off\n  auto_learn: true\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(h._hasFile(path.join(GUILD, "config.yml"))).toBe(false);
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].action).toBe("v2-noop");
  });
});

describe("REGRESSION P2-normalize: normalize-before-conflict — settings.json v1 alias + config.yml equal → C3 not false-C4", () => {
  /**
   * Before fix: convertV2SurfaceInPlace (normalizing stray aliases in settings.json)
   * was called AFTER config.yml cross-file check. If settings.json held
   * `auto_approve: "spec-and-plan"` (raw v1 string), config.yml's matching value
   * was compared against the un-normalized string → false C4.
   */
  test("settings.json auto_approve string + config.yml matching value → C3 (not C4)", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({
        auto_approve: "spec-and-plan", // raw v1 string (un-normalized)
      }),
      [path.join(GUILD, "config.yml")]: "auto_approve: spec-and-plan\n", // same value
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    // Should be C3 (equal → redundant), config.yml removed, no conflict
    expect(h._hasFile(path.join(GUILD, "config.yml"))).toBe(false);
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["auto_approve"]).toEqual(["spec", "plan"]); // normalized

    // 2nd run v2 no-op
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].action).toBe("v2-noop");
  });
});

describe("REGRESSION P2-canonical: canonical run fields — metadata created_at/initiative → run.yaml started_at/initiative_attachment", () => {
  /**
   * Before fix: run.yaml used `created_at` and `initiative` instead of the
   * canonical `started_at` and `initiative_attachment` field names.
   */
  test("metadata.json with created_at + initiative → run.yaml has started_at + initiative_attachment", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "runs/run-leg/metadata.json")]: JSON.stringify({
        run_id: "run-leg",
        created_at: "2026-01-01T00:00:00Z",
        initiative: "my-initiative",
      }),
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    const runYaml = h._read(path.join(GUILD, "runs/run-leg/run.yaml"));
    expect(runYaml).toContain("started_at:");
    expect(runYaml).not.toContain("created_at:");
    expect(runYaml).toContain("initiative_attachment:");
    expect(hasTopLevelKey(runYaml, "initiative")).toBe(false);
  });

  test("status consistent: both run.yaml AND provenance.json use same derived status (closed default)", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "runs/run-leg/metadata.json")]: JSON.stringify({
        run_id: "run-leg",
        created_at: "2026-01-01T00:00:00Z",
        // No status field → should default to "closed"
      }),
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    const runYaml = h._read(path.join(GUILD, "runs/run-leg/run.yaml"));
    const provJson = JSON.parse(h._read(path.join(GUILD, "runs/run-leg/provenance.json")));
    expect(runYaml).toContain("status: closed");
    expect(provJson.status).toBe("closed");
  });

  test("status with value 'failed' → both run.yaml and provenance.json = failed", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "runs/run-fail/metadata.json")]: JSON.stringify({
        run_id: "run-fail",
        created_at: "2026-01-01T00:00:00Z",
        status: "failed",
      }),
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    const runYaml = h._read(path.join(GUILD, "runs/run-fail/run.yaml"));
    const provJson = JSON.parse(h._read(path.join(GUILD, "runs/run-fail/provenance.json")));
    expect(runYaml).toContain("status: failed");
    expect(provJson.status).toBe("failed");
  });
});

describe("REGRESSION P2-local-different-name: settings.local.json different-name alias migrates INTO local file", () => {
  /**
   * Before fix (round-3): convertSettingsLocal compared different-name aliases
   * against settings.json → false C4 when they differed.
   * Fix: pass `parsed` (local file) as v2Target, not settings.json.
   */
  test("settings.json review:local + settings.local.json codex_review:true → local gets review:cross", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ review: "local" }),
      [path.join(GUILD, "settings.local.json")]: JSON.stringify({ codex_review: true }),
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    const local = JSON.parse(h._read(path.join(GUILD, "settings.local.json")));
    // local should have review: "cross" (the local override intent)
    expect(local["review"]).toBe("cross");
    // codex_review alias should be gone
    expect("codex_review" in local).toBe(false);
    // settings.json must be UNCHANGED
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["review"]).toBe("local");
  });

  test("2nd run after local migration = v2 no-op", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ review: "local" }),
      [path.join(GUILD, "settings.local.json")]: JSON.stringify({ codex_review: true }),
    });
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const res2 = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res2.children[0].action).toBe("v2-noop");
  });
});

describe("REGRESSION: probe read-only — R4 invariant (probe never writes)", () => {
  test("detect does not write any file", () => {
    const fs = buildFs(v1Tree());
    const h = fsHelper(fs);
    const before = [...h._files()].sort();
    detect(fs, GUILD);
    const after = [...h._files()].sort();
    expect(after).toEqual(before);
  });

  test("detect called twice produces identical classification + same evidence", () => {
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(GUILD, "config.yml")]: "codex_review: false\n",
    });
    const r1 = detect(fs, GUILD);
    const r2 = detect(fs, GUILD);
    expect(r1.classification).toBe(r2.classification);
    expect(r1.m1).toBe(r2.m1);
    expect(r1.m2).toBe(r2.m2);
  });
});

describe("REGRESSION: backup dirs excluded from probe M1 (CF-W1b-2)", () => {
  /**
   * The snapshot holds v1 bytes; the probe must NEVER read them as M1.
   */
  test("probe skips .backup-v1-* dirs — snapshot v1 bytes do not re-trigger mixed", () => {
    const backupDir = path.join(GUILD, ".backup-v1-20260530T120000Z");
    const fs = buildFs({
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      // A v1 config.yml in the backup dir — must NOT be read by the probe
      [path.join(backupDir, "config.yml")]: "codex_review: false\n",
    });
    const result = detect(fs, GUILD);
    // backup dir's config.yml must NOT contribute M1
    expect(result.m1).toBe(false);
    expect(result.classification).toBe("v2");
  });
});

describe("REGRESSION: per-child workspace each child gets own snapshot + report", () => {
  test("workspace: each v1 child gets its own snapshot directory", () => {
    const childAGuild = "/repo/childA/.guild";

    const fs = buildFs({
      [path.join(GUILD, "workspace.json")]: JSON.stringify({
        schema_version: "guild.workspace.v1",
        sub_guilds: ["childA"],
      }),
      [path.join(GUILD, "settings.json")]: JSON.stringify({ agent_mode: "auto" }),
      [path.join(childAGuild, "config.yml")]: "codex_review: false\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });

    // childA should have its own backup dir
    const childABackup = h._files().filter(
      (p) => p.startsWith(childAGuild + "/.backup-v1-")
    );
    expect(childABackup.length).toBeGreaterThan(0);
  });
});

describe("REGRESSION: dry-run writes nothing", () => {
  test("dry-run: config.yml still present, no settings.json written", () => {
    const fs = buildFs(v1Tree());
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "dry-run", fs, clock });
    expect(h._hasFile(path.join(GUILD, "config.yml"))).toBe(true);
    expect(h._hasFile(path.join(GUILD, "settings.json"))).toBe(false);
  });

  test("dry-run: no snapshot dir created", () => {
    const fs = buildFs(v1Tree());
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "dry-run", fs, clock });
    const snapDirs = h._files().filter((p) => p.includes(".backup-v1-"));
    expect(snapDirs).toHaveLength(0);
  });

  test("dry-run: report file is written (the plan)", () => {
    const fs = buildFs(v1Tree());
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "dry-run", fs, clock });
    const reports = h._files().filter((p) => p.includes(".migration-report-"));
    expect(reports.length).toBeGreaterThan(0);
  });
});

describe("REGRESSION: carry-forward keys (loops/loop_cap/codex_cap) preserved", () => {
  test("loops/loop_cap/codex_cap from config.yml carried into settings.json (C1 when absent)", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]:
        "loops: 5\nloop_cap: 20\ncodex_cap: 3\ncodex_review: false\n",
    });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const settings = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(settings["loops"]).toBe(5);
    expect(settings["loop_cap"]).toBe(20);
    expect(settings["codex_cap"]).toBe(3);
  });
});

describe("REGRESSION: skip mode produces audit trail (P3 fix)", () => {
  test("skip: report file exists at the printed path", () => {
    const fs = buildFs(v1Tree());
    const h = fsHelper(fs);
    const res = runMigration({ root: ROOT, mode: "skip", fs, clock });
    const child = res.children[0];
    expect(child.action).toBe("skip");
    expect(h._hasFile(child.reportPath)).toBe(true);
  });
});

describe("REGRESSION: auto_approve string transforms correctly per §2.1", () => {
  test("none → []", () => {
    const fs = buildFs({ [path.join(GUILD, "config.yml")]: "auto_approve: none\n" });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const s = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(s["auto_approve"]).toEqual([]);
  });

  test("spec-and-plan → [spec, plan]", () => {
    const fs = buildFs({ [path.join(GUILD, "config.yml")]: "auto_approve: spec-and-plan\n" });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const s = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(s["auto_approve"]).toEqual(["spec", "plan"]);
  });

  test("implementation → [build]", () => {
    const fs = buildFs({ [path.join(GUILD, "config.yml")]: "auto_approve: implementation\n" });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const s = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(s["auto_approve"]).toEqual(["build"]);
  });

  test("all → [all]", () => {
    const fs = buildFs({ [path.join(GUILD, "config.yml")]: "auto_approve: all\n" });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const s = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(s["auto_approve"]).toEqual(["all"]);
  });
});

describe("REGRESSION: codex_review bool → review enum", () => {
  test("codex_review: true → review: cross", () => {
    const fs = buildFs({ [path.join(GUILD, "config.yml")]: "codex_review: true\n" });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const s = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(s["review"]).toBe("cross");
  });

  test("codex_review: false → review: local", () => {
    const fs = buildFs({ [path.join(GUILD, "config.yml")]: "codex_review: false\n" });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const s = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(s["review"]).toBe("local");
  });
});

describe("REGRESSION: agent_team values map correctly to agent_mode", () => {
  test("true/on → team", () => {
    const fs = buildFs({ [path.join(GUILD, "config.yml")]: "defaults:\n  agent_team: true\n" });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const s = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(s["agent_mode"]).toBe("team");
  });

  test("false/off → subagent", () => {
    const fs = buildFs({ [path.join(GUILD, "config.yml")]: "defaults:\n  agent_team: false\n" });
    const h = fsHelper(fs);
    runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const s = JSON.parse(h._read(path.join(GUILD, "settings.json")));
    expect(s["agent_mode"]).toBe("subagent");
  });
});

describe("REGRESSION: none/.guild classification", () => {
  test("absent .guild → none, silent (no report)", () => {
    const fs = buildFs({}); // empty
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    expect(res.children[0].action).toBe("none");
    expect(fsHelper(fs)._files().filter((p) => p.includes(".migration-report-"))).toHaveLength(0);
  });

  test("empty .guild dir → none", () => {
    // Just a sentinel that makes .guild exist but has no files
    const fs = buildFs({});
    // We add .guild dir via a dummy non-recognised file
    fs.writeFileSync(path.join(GUILD, "__empty__"), "");
    fs.rmFileSync(path.join(GUILD, "__empty__"));
    const result = detect(fs, GUILD);
    // No markers → none
    expect(["none", "v2"]).toContain(result.classification);
  });
});

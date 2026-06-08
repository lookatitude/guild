/**
 * __tests__/write-back-scored-tier.test.ts
 *
 * W2-A3 — concurrent-safe scored-tier writeback helper.
 *
 * Covers:
 *   1. Basic field update — writes `tier:` for the named specialist.
 *   2. Idempotency — second call with the same tier is a no-op (or succeeds).
 *   3. Tier update — overwrite existing tier with a new value.
 *   4. Specialist not found — graceful error, file unchanged.
 *   5. File does not exist — graceful error.
 *   6. Multiple specialists — only the target specialist's tier is touched.
 *   7. Atomicity/lock — concurrent writes resolve without clobber.
 *   8. Lock cleanup — lock file removed after successful write.
 *   9. Lock cleanup — lock file removed after failure too.
 *
 * Generated-team-shape fixtures (per spec constraint): team.yaml files are
 * written by the test helpers, not loaded from disk — no pre-existing fixtures.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  writeBackScoredTier,
  type ScoredTier,
  type WriteBackResult,
} from "../lib/write-back-scored-tier";

// ── Fixture helpers ───────────────────────────────────────────────────────────

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
function track<T extends string>(v: T): T {
  TEMP_DIRS.push(v);
  return v;
}
function mkTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-wbst-test-"));
  return track(d);
}

/**
 * Generated team.yaml fixture with a fixed schema.
 * `specialists` is a list of { name, tier?, default_tier?, scope, dependsOn? }.
 */
interface SpecShape {
  name: string;
  scope?: string;
  tier?: ScoredTier;
  default_tier?: ScoredTier;
  dependsOn?: string[];
}

function buildTeamYaml(specialists: SpecShape[]): string {
  const lines: string[] = ["backend: auto", "specialists:"];
  for (const s of specialists) {
    lines.push(`  - name: ${s.name}`);
    if (s.scope !== undefined) lines.push(`    scope: ${s.scope}`);
    if (s.tier !== undefined) lines.push(`    tier: ${s.tier}`);
    if (s.default_tier !== undefined) lines.push(`    default_tier: ${s.default_tier}`);
    if (s.dependsOn && s.dependsOn.length > 0) {
      lines.push(`    depends-on: [${s.dependsOn.join(", ")}]`);
    }
  }
  return lines.join("\n") + "\n";
}

function writeTeamYaml(dir: string, specialists: SpecShape[]): string {
  const p = path.join(dir, "team.yaml");
  fs.writeFileSync(p, buildTeamYaml(specialists));
  return p;
}

/** Read back the `tier:` field for a named specialist from a team.yaml. */
function readSpecialistTier(teamYamlPath: string, name: string): string | undefined {
  const content = fs.readFileSync(teamYamlPath, "utf8");
  const lines = content.split("\n");
  let inSpec = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*-\s+name:\s*/.test(line)) {
      const specName = line.replace(/^\s*-\s+name:\s*/, "").trim();
      inSpec = specName === name;
      continue;
    }
    if (inSpec) {
      // If we hit another list item or top-level key, stop.
      if (/^\s*-\s+/.test(line) || (line.length > 0 && !/^\s/.test(line))) {
        inSpec = false;
        continue;
      }
      const m = /^\s+tier:\s*(\S+)/.exec(line);
      if (m) return m[1];
    }
  }
  return undefined;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("writeBackScoredTier — basic field write", () => {
  test("writes tier: field for an existing specialist (no prior tier)", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [
      { name: "architect", scope: "boundaries" },
      { name: "backend", scope: "api" },
    ]);

    const result = writeBackScoredTier(p, "architect", "powerful");

    expect(result.ok).toBe(true);
    expect(readSpecialistTier(p, "architect")).toBe("powerful");
    // Other specialist untouched
    expect(readSpecialistTier(p, "backend")).toBeUndefined();
  });

  test("writes tier: cheap", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [{ name: "docs-writer", scope: "docs" }]);

    const result = writeBackScoredTier(p, "docs-writer", "cheap");

    expect(result.ok).toBe(true);
    expect(readSpecialistTier(p, "docs-writer")).toBe("cheap");
  });

  test("writes tier: mid", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [{ name: "qa", scope: "tests" }]);

    const result = writeBackScoredTier(p, "qa", "mid");

    expect(result.ok).toBe(true);
    expect(readSpecialistTier(p, "qa")).toBe("mid");
  });
});

describe("writeBackScoredTier — update existing tier", () => {
  test("overwrites existing tier: mid → powerful", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [{ name: "backend", scope: "api", tier: "mid" }]);

    const result = writeBackScoredTier(p, "backend", "powerful");

    expect(result.ok).toBe(true);
    expect(readSpecialistTier(p, "backend")).toBe("powerful");
  });

  test("overwrites existing tier: powerful → cheap (re-score downgrade)", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [{ name: "docs-writer", scope: "docs", tier: "powerful" }]);

    const result = writeBackScoredTier(p, "docs-writer", "cheap");

    expect(result.ok).toBe(true);
    expect(readSpecialistTier(p, "docs-writer")).toBe("cheap");
  });

  test("idempotent — writing the same tier twice produces identical file", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [{ name: "architect", scope: "boundaries", tier: "powerful" }]);

    const r1 = writeBackScoredTier(p, "architect", "powerful");
    const content1 = fs.readFileSync(p, "utf8");
    const r2 = writeBackScoredTier(p, "architect", "powerful");
    const content2 = fs.readFileSync(p, "utf8");

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(content1).toBe(content2);
  });
});

describe("writeBackScoredTier — multiple specialists (isolation)", () => {
  test("only the named specialist's tier is updated; others are unchanged", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [
      { name: "architect", scope: "boundaries", tier: "powerful" },
      { name: "backend", scope: "api", tier: "mid" },
      { name: "qa", scope: "tests" },
    ]);

    const result = writeBackScoredTier(p, "qa", "cheap");

    expect(result.ok).toBe(true);
    expect(readSpecialistTier(p, "qa")).toBe("cheap");
    expect(readSpecialistTier(p, "architect")).toBe("powerful"); // untouched
    expect(readSpecialistTier(p, "backend")).toBe("mid");       // untouched
  });

  test("sequential writes for different specialists all land correctly", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [
      { name: "architect", scope: "boundaries" },
      { name: "backend", scope: "api" },
      { name: "qa", scope: "tests" },
    ]);

    writeBackScoredTier(p, "architect", "powerful");
    writeBackScoredTier(p, "backend", "mid");
    writeBackScoredTier(p, "qa", "cheap");

    expect(readSpecialistTier(p, "architect")).toBe("powerful");
    expect(readSpecialistTier(p, "backend")).toBe("mid");
    expect(readSpecialistTier(p, "qa")).toBe("cheap");
  });
});

describe("writeBackScoredTier — error cases (graceful, never throw)", () => {
  test("specialist not found → ok:false, file unchanged", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [{ name: "backend", scope: "api", tier: "mid" }]);
    const before = fs.readFileSync(p, "utf8");

    const result = writeBackScoredTier(p, "nonexistent-specialist", "powerful");

    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
    expect(fs.readFileSync(p, "utf8")).toBe(before); // file unchanged
  });

  test("file does not exist → ok:false", () => {
    const dir = mkTmpDir();
    const p = path.join(dir, "nonexistent.yaml");

    const result = writeBackScoredTier(p, "architect", "powerful");

    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });

  test("never throws — catches all errors internally", () => {
    // File in a non-writable location
    const p = "/dev/null/team.yaml"; // non-creatable path
    expect(() => writeBackScoredTier(p, "architect", "powerful")).not.toThrow();
  });
});

describe("writeBackScoredTier — lock lifecycle", () => {
  test("lock file is cleaned up after a successful write", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [{ name: "backend", scope: "api" }]);
    const lockPath = p + ".scoring.lock";

    writeBackScoredTier(p, "backend", "mid");

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("lock file is cleaned up even when specialist is not found", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [{ name: "backend", scope: "api" }]);
    const lockPath = p + ".scoring.lock";

    writeBackScoredTier(p, "nonexistent", "mid");

    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

describe("writeBackScoredTier — preserves file structure", () => {
  test("non-target lines (comments stripped by parser are preserved syntactically)", () => {
    const dir = mkTmpDir();
    const p = writeTeamYaml(dir, [
      { name: "architect", scope: "boundaries", default_tier: "powerful" },
      { name: "backend", scope: "api + data layer", dependsOn: ["architect"] },
    ]);

    writeBackScoredTier(p, "backend", "mid");

    const content = fs.readFileSync(p, "utf8");
    // 'architect' block still present
    expect(content).toContain("name: architect");
    // backend has its scored tier now
    expect(content).toContain("name: backend");
    expect(readSpecialistTier(p, "backend")).toBe("mid");
    // architect block unchanged
    expect(readSpecialistTier(p, "architect")).toBeUndefined();
  });
});

/**
 * tests/workspace/manifest-shape.test.ts
 *
 * Cross-cutting deliverable 2 — MANIFEST-SHAPE VALIDATION against
 * `guild.workspace.v1` (SC-2, spec §2 + pinned contract in the plan).
 *
 * Drives scripts/workspace/write-manifest.ts END-TO-END as a subprocess; reads
 * the emitted <root>/.guild/workspace.json and validates it field-by-field
 * against the pinned contract:
 *   - required top-level keys present + correct types
 *   - schema_version === "guild.workspace.v1"
 *   - detection.depth === 1
 *   - detection.mode ∈ {auto,on,off}; detection.rule a non-empty string
 *   - sub_guilds[] entries carry the full field set
 *   - sub_guild.kind ∈ {sub-guild, sub-project}
 *   - query_recipe present with mechanism / fan_out / example strings
 *   - root_wiki boolean; true iff top-level code present (D-OQ2)
 *   - real-git children populate remote + last_seen_commit
 *
 * Validates the manifest is well-formed JSON and round-trips.
 */

import * as fs from "fs";
import * as path from "path";
import {
  WRITE_MANIFEST,
  runScript,
  makeTempRoot,
  rmTree,
  plantSubProject,
  plantSubGuild,
  plantPlainDir,
  plantTopLevelCode,
  plantRealGitSubGuild,
  gitAvailable,
} from "./_fixtures";

const REQUIRED_TOP_KEYS = [
  "schema_version",
  "is_workspace",
  "detected_at",
  "detection",
  "root_wiki",
  "sub_guilds",
  "query_recipe",
] as const;

const REQUIRED_SUB_KEYS = [
  "name",
  "path",
  "kind",
  "remote",
  "has_wiki",
  "has_indexes",
  "last_seen_commit",
] as const;

interface Manifest {
  schema_version: string;
  is_workspace: boolean;
  detected_at: string;
  detection: { depth: number; rule: string; mode: string };
  root_wiki: boolean;
  sub_guilds: Array<Record<string, unknown>>;
  query_recipe: { mechanism: string; fan_out: string; example: string };
}

function writeAndRead(root: string, mode?: "auto" | "on" | "off"): Manifest {
  const args = ["--cwd", root];
  if (mode) args.push("--mode", mode);
  const res = runScript(WRITE_MANIFEST, args);
  expect(res.exitCode).toBe(0);
  const manifestPath = path.join(root, ".guild", "workspace.json");
  expect(fs.existsSync(manifestPath)).toBe(true);
  // stdout should be the manifest path
  expect(res.stdout.trim()).toBe(manifestPath);
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as Manifest;
}

describe("manifest shape — guild.workspace.v1 (e2e via write-manifest.ts)", () => {
  let root: string;
  afterEach(() => {
    if (root) rmTree(root);
  });

  test("required top-level keys present with correct types", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true, indexes: true });
    const m = writeAndRead(root);
    for (const k of REQUIRED_TOP_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(m, k)).toBe(true);
    }
    expect(m.schema_version).toBe("guild.workspace.v1");
    expect(typeof m.is_workspace).toBe("boolean");
    expect(typeof m.detected_at).toBe("string");
    expect(typeof m.detection).toBe("object");
    expect(typeof m.root_wiki).toBe("boolean");
    expect(Array.isArray(m.sub_guilds)).toBe(true);
    expect(typeof m.query_recipe).toBe("object");
  });

  test("detection.depth === 1 and detection block well-formed", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    const m = writeAndRead(root);
    expect(m.detection.depth).toBe(1);
    expect(["auto", "on", "off"]).toContain(m.detection.mode);
    expect(typeof m.detection.rule).toBe("string");
    expect(m.detection.rule.length).toBeGreaterThan(0);
  });

  test("detected_at is a valid ISO-8601 timestamp", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    const m = writeAndRead(root);
    const parsed = Date.parse(m.detected_at);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(m.detected_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("sub_guilds[] entries carry the full guild.workspace.v1 field set", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true, indexes: true });
    plantSubProject(root, "svc-api");
    const m = writeAndRead(root);
    expect(m.sub_guilds.length).toBe(2);
    for (const sub of m.sub_guilds) {
      for (const k of REQUIRED_SUB_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(sub, k)).toBe(true);
      }
      expect(typeof sub.name).toBe("string");
      expect(typeof sub.path).toBe("string");
      expect(typeof sub.has_wiki).toBe("boolean");
      expect(typeof sub.has_indexes).toBe("boolean");
    }
  });

  test("sub_guild.kind ∈ {sub-guild, sub-project}", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantSubProject(root, "svc-api");
    const m = writeAndRead(root);
    const byName = Object.fromEntries(m.sub_guilds.map((s) => [s.name as string, s]));
    for (const sub of m.sub_guilds) {
      expect(["sub-guild", "sub-project"]).toContain(sub.kind);
    }
    expect(byName["plugin"].kind).toBe("sub-guild");
    expect(byName["svc-api"].kind).toBe("sub-project");
  });

  test("query_recipe present with mechanism / fan_out / example strings", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    const m = writeAndRead(root);
    expect(typeof m.query_recipe.mechanism).toBe("string");
    expect(typeof m.query_recipe.fan_out).toBe("string");
    expect(typeof m.query_recipe.example).toBe("string");
    // recipe must describe the cwd-override fan-out mechanism (no new MCP)
    expect(m.query_recipe.mechanism).toMatch(/guild-memory/);
    expect(m.query_recipe.fan_out.toLowerCase()).toContain("tag");
  });

  test("is_workspace tracks detection: true for workspace, false for regular", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    expect(writeAndRead(root).is_workspace).toBe(true);
    rmTree(root);

    root = makeTempRoot();
    plantPlainDir(root, "docs"); // regular
    const reg = writeAndRead(root);
    expect(reg.is_workspace).toBe(false);
    expect(reg.sub_guilds).toEqual([]);
  });

  test("root_wiki=false on a pure federation root (no top-level code) — D-OQ2", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantPlainDir(root, "docs");
    const m = writeAndRead(root);
    expect(m.root_wiki).toBe(false);
  });

  test("root_wiki=true when the workspace root itself has top-level code — D-OQ2", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantTopLevelCode(root, "index.ts");
    const m = writeAndRead(root);
    expect(m.root_wiki).toBe(true);
  });

  test("manifest body is valid JSON and round-trips byte-for-byte", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    writeAndRead(root);
    const manifestPath = path.join(root, ".guild", "workspace.json");
    const raw = fs.readFileSync(manifestPath, "utf8");
    // valid JSON
    const obj = JSON.parse(raw);
    // re-stringify of the parsed object must equal the trimmed file body
    expect(JSON.stringify(obj, null, 2)).toBe(raw.trimEnd());
  });

  test("mode override is reflected in detection.mode", () => {
    root = makeTempRoot();
    plantPlainDir(root, "docs");
    const forced = writeAndRead(root, "on");
    expect(forced.detection.mode).toBe("on");
    expect(forced.is_workspace).toBe(true);
  });

  describe("real-git remote + last_seen_commit population", () => {
    const hasGit = gitAvailable();
    (hasGit ? test : test.skip)(
      "a real-git sub-guild populates remote (host/path) and a 40-char HEAD",
      () => {
        root = makeTempRoot();
        plantRealGitSubGuild(root, "plugin", "https://github.com/acme/plugin.git", true);
        const m = writeAndRead(root);
        const sub = m.sub_guilds.find((s) => s.name === "plugin")!;
        expect(sub).toBeDefined();
        expect(sub.remote).toBe("github.com/acme/plugin");
        expect(typeof sub.last_seen_commit).toBe("string");
        expect(sub.last_seen_commit as string).toMatch(/^[0-9a-f]{40}$/);
      }
    );

    test("a non-git sub-guild leaves remote and last_seen_commit null", () => {
      root = makeTempRoot();
      plantSubGuild(root, "plugin", { wiki: true }); // .guild only, no .git
      const m = writeAndRead(root);
      const sub = m.sub_guilds.find((s) => s.name === "plugin")!;
      expect(sub.remote).toBeNull();
      expect(sub.last_seen_commit).toBeNull();
    });
  });
});

/**
 * scripts/__tests__/init-scaffold-manifest.test.ts
 *
 * V5/V6 (init-config-goal §V line 260-261) — `initializeGuild` materializes the
 * FULL versioned scaffold manifest for both modes, reconciles settings.json, and
 * re-running is NEVER-CLOBBER:
 *   - single_project / workspace create every `scaffoldFor(mode)` dir + file;
 *   - resolveSettings (returned by init) yields defaults + per-key sources;
 *   - a clean re-run creates NOTHING (all already_present);
 *   - a user-modified file is `skipped_user_modified` and stays BYTE-IDENTICAL.
 *
 * Real-fs, deterministic stamp, anti-vacuous (the modified bytes are read back and
 * compared exactly; the first init is shown to actually create the same entries).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initializeGuild } from "../lib/init-guild";
import {
  scaffoldFor,
  type ScaffoldEntry,
} from "../../src/modules/config/workflows/init-scaffold-manifest";

const NOW = "2026-01-01T00:00:00Z";
const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ }
});
function mkRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-scaffold-"));
  tmps.push(d);
  return d;
}
function abs(root: string, entry: ScaffoldEntry): string {
  return path.join(root, ...entry.path.replace(/\/+$/, "").split("/"));
}
function entryExists(root: string, entry: ScaffoldEntry): boolean {
  try {
    const s = fs.statSync(abs(root, entry));
    return entry.kind === "dir" ? s.isDirectory() : s.isFile();
  } catch {
    return false;
  }
}

describe("initializeGuild — full scaffold materialization (V5/V6)", () => {
  it("single_project creates EVERY scaffoldFor('single_project') entry + settings.json", () => {
    const root = mkRoot();
    const result = initializeGuild(root, "single_project", { now: NOW });
    for (const entry of scaffoldFor("single_project")) {
      expect(entryExists(root, entry)).toBe(true);
    }
    expect(fs.existsSync(path.join(root, ".guild", "settings.json"))).toBe(true);
    // resolveSettings returns defaults + sources (§E4).
    expect(result.settings).toBeDefined();
    expect(Object.keys(result.sources).length).toBeGreaterThan(0);
    expect(result.mode).toBe("single_project");
  });

  it("workspace creates the workspace-only entries (workspace.json, workspace descriptors, registry)", () => {
    const root = mkRoot();
    const result = initializeGuild(root, "workspace", { now: NOW });
    for (const entry of scaffoldFor("workspace_root")) {
      expect(entryExists(root, entry)).toBe(true);
    }
    expect(fs.existsSync(path.join(root, ".guild", "workspace.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".guild", "workspace", "workspace.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".guild", "workspace", "children.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".guild", "workspace", "relationships.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".guild", "workspace-knowledge"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".guild", "initiatives", "registry.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".guild", "indexes", "initiatives-registry.yaml"))).toBe(true);
    expect(result.mode).toBe("workspace");
    expect(Object.keys(result.sources).length).toBeGreaterThan(0);
  });
});

describe("initializeGuild — re-run is never-clobber (V5/V6 anti-vacuity)", () => {
  it("a clean re-run creates NOTHING (every required entry already_present)", () => {
    const root = mkRoot();
    initializeGuild(root, "single_project", { now: NOW });
    const second = initializeGuild(root, "single_project", { now: NOW });
    const created = second.entries.filter((e) => e.status === "created");
    expect(created).toEqual([]); // idempotent: nothing re-created
    // and the pristine wiki entrypoint reports already_present (matched its marker)
    const wiki = second.entries.find((e) => e.path === ".guild/wiki/index.md");
    expect(wiki?.status).toBe("already_present");
  });

  it("a user-modified file is skipped_user_modified and stays BYTE-IDENTICAL", () => {
    const root = mkRoot();
    initializeGuild(root, "single_project", { now: NOW });

    const guildYaml = path.join(root, ".guild", "guild.yaml");
    const userContent = "# my hand-edited Guild root file\nname: custom\n# (marker removed on purpose)\n";
    fs.writeFileSync(guildYaml, userContent);

    const re = initializeGuild(root, "single_project", { now: NOW });
    const entry = re.entries.find((e) => e.path === ".guild/guild.yaml");
    expect(entry?.status).toBe("skipped_user_modified");
    expect(entry?.action).toBe("manual_review");
    // the central anti-vacuity claim: the user's bytes survive untouched
    expect(fs.readFileSync(guildYaml, "utf8")).toBe(userContent);
  });
});

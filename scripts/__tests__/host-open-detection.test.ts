/**
 * scripts/__tests__/host-open-detection.test.ts
 *
 * V1 (init-config-goal §V line 251-256) — detectGuildState install-state +
 * workspace-topology detection, the 6-fixture matrix. Real-fs fixtures built from
 * the REAL generator (`initializeGuild`) so a valid install is generated-shape, not
 * hand-authored (avoids fixture drift). Anti-vacuity is the point of this lane:
 *   - NEVER a silent single_project fallback on a malformed/incomplete `.guild/`;
 *   - NEVER throws (every fs/JSON access is wrapped → installed_needs_repair);
 *   - ancestor parse-error SKIPS and the walk continues up;
 *   - ancestor is_workspace !== true STOPS the walk (matches discoverWorkspace).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { detectGuildState } from "../../src/modules/config/workflows/host-open-preflight";
import { initializeGuild } from "../lib/init-guild";

const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ }
});
function mkRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-detect-"));
  tmps.push(d);
  return d;
}
/** Build a generated-shape install with the real initializer (deterministic stamp). */
function installSingle(root: string): void { initializeGuild(root, "single_project", { now: "2026-01-01T00:00:00Z" }); }
function installWorkspace(root: string): void { initializeGuild(root, "workspace", { now: "2026-01-01T00:00:00Z" }); }
function writeManifest(root: string, raw: string): void {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "workspace.json"), raw);
}

// ---------------------------------------------------------------------------
// The 6-fixture matrix (clean classifications)
// ---------------------------------------------------------------------------
describe("detectGuildState — the 6-fixture matrix (V1)", () => {
  it("1. absent .guild/ → not_installed (no projectRoot, no workspaceRoot)", () => {
    const root = mkRoot();
    const r = detectGuildState(root);
    expect(r.state).toBe("not_installed");
    expect(r.projectRoot).toBeNull();
    expect(r.workspaceRoot).toBeNull();
    expect(r.problem).toBeNull();
    expect(r.schema_version).toBe("guild.guild_state.v1");
  });

  it("2. single-project (full floor, no workspace.json) → single_project", () => {
    const root = mkRoot();
    installSingle(root);
    const r = detectGuildState(root);
    expect(r.state).toBe("single_project");
    expect(r.projectRoot).toBe(root);
    expect(r.workspaceRoot).toBeNull();
    expect(r.problem).toBeNull();
  });

  it("3. workspace-root (workspace.json is_workspace:true, floor present) → workspace_root", () => {
    const root = mkRoot();
    installWorkspace(root);
    const r = detectGuildState(root);
    expect(r.state).toBe("workspace_root");
    expect(r.workspaceRoot).toBe(root);
    expect(r.problem).toBeNull();
  });

  it("4. workspace-child (own .guild/ under an ancestor workspace root) → workspace_child", () => {
    const ws = mkRoot();
    installWorkspace(ws);
    const child = path.join(ws, "child");
    fs.mkdirSync(child, { recursive: true });
    installSingle(child);
    const r = detectGuildState(child);
    expect(r.state).toBe("workspace_child");
    expect(r.projectRoot).toBe(child);
    expect(r.workspaceRoot).toBe(ws);
    expect(r.problem).toBeNull();
  });

  it("5a. malformed workspace.json (JSON parse error) at cwd → installed_needs_repair{malformed_workspace_json}", () => {
    const root = mkRoot();
    writeManifest(root, "{ this is : not json ");
    const r = detectGuildState(root);
    expect(r.state).toBe("installed_needs_repair");
    expect(r.problem?.problem).toBe("malformed_workspace_json");
    expect(r.problem?.path).toBe(path.join(root, ".guild", "workspace.json"));
  });

  it("5b. parseable-but-invalid shape (is_workspace:false) at cwd → installed_needs_repair{malformed_workspace_json}", () => {
    const root = mkRoot();
    writeManifest(root, JSON.stringify({ schema_version: "guild.workspace.v1", is_workspace: false }));
    const r = detectGuildState(root);
    expect(r.state).toBe("installed_needs_repair");
    expect(r.problem?.problem).toBe("malformed_workspace_json");
  });

  it("6. incomplete .guild/ (missing required manifest entry) → installed_needs_repair{missing_required_manifest_entry}", () => {
    const root = mkRoot();
    installSingle(root);
    fs.rmSync(path.join(root, ".guild", "guild.yaml"));
    const r = detectGuildState(root);
    expect(r.state).toBe("installed_needs_repair");
    expect(r.problem?.problem).toBe("missing_required_manifest_entry");
    expect(r.problem?.path.endsWith("guild.yaml")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Anti-vacuity — the properties this lane exists to pin
// ---------------------------------------------------------------------------
describe("detectGuildState — anti-vacuity (V1)", () => {
  it("NEVER silently falls back to single_project on a malformed manifest", () => {
    const root = mkRoot();
    writeManifest(root, "{ broken ");
    // even a malformed workspace.json sitting next to nothing else must not read as single_project
    const r = detectGuildState(root);
    expect(r.state).not.toBe("single_project");
    expect(r.state).toBe("installed_needs_repair");
  });

  it("NEVER silently falls back to single_project on an incomplete install", () => {
    const root = mkRoot();
    installSingle(root);
    fs.rmSync(path.join(root, ".guild", "wiki", "index.md"));
    const r = detectGuildState(root);
    expect(r.state).not.toBe("single_project");
    expect(r.state).toBe("installed_needs_repair");
  });

  it("NEVER throws — a workspace.json that is a directory (EISDIR) is classified, not crashed", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".guild", "workspace.json"), { recursive: true });
    let r!: ReturnType<typeof detectGuildState>;
    expect(() => { r = detectGuildState(root); }).not.toThrow();
    expect(r.state).toBe("installed_needs_repair");
    expect(r.problem?.problem).toBe("malformed_workspace_json");
  });

  it("ancestor parse-error SKIPS and the walk continues up to a valid workspace root", () => {
    // /top (valid workspace) > /top/mid (malformed manifest, must be skipped) > child (own .guild/)
    const top = mkRoot();
    installWorkspace(top);
    const mid = path.join(top, "mid");
    fs.mkdirSync(mid, { recursive: true });
    writeManifest(mid, "{ not json at all ");
    const child = path.join(mid, "child");
    fs.mkdirSync(child, { recursive: true });
    installSingle(child);
    const r = detectGuildState(child);
    expect(r.state).toBe("workspace_child");
    expect(r.workspaceRoot).toBe(top); // skipped the malformed mid, found the valid top
  });

  it("ancestor is_workspace !== true STOPS the walk (deliberate opt-out) → NOT a child", () => {
    const ancestor = mkRoot();
    writeManifest(ancestor, JSON.stringify({ is_workspace: false }));
    const child = path.join(ancestor, "proj");
    fs.mkdirSync(child, { recursive: true });
    installSingle(child);
    const r = detectGuildState(child);
    expect(r.state).toBe("single_project"); // the opt-out stopped the walk; child is its own project
    expect(r.workspaceRoot).toBeNull();
  });
});

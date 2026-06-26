/**
 * scripts/__tests__/init-routing.test.ts
 *
 * V3 (+ V4 routing residue) (init-config-goal §V line 258-259) — the init prompt
 * contract is DATA-only and write-free:
 *   - `hostOpenPreflight` runs detection + suggestion and NEVER writes a file
 *     (no write before approval — the adapter renders, `initializeGuild` writes);
 *   - a DENY path (decline init → no `initializeGuild` call) leaves the tree
 *     BYTE-IDENTICAL;
 *   - V4 routing residue: "selecting multiple → initializes workspace mode"
 *     (has_child_repos ⇒ recommended_mode "workspace" ⇒ the workspace scaffold);
 *   - an app/connector (non-CLI) host is `blocked`, never a false-native path.
 *
 * Real-fs, anti-vacuous: the APPROVE path is shown to MUTATE the tree so the
 * byte-identical assertion on DENY is not vacuously true.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  hostOpenPreflight,
  suggestWorkspaceMode,
} from "../../src/modules/config/workflows/host-open-preflight";
import { initializeGuild } from "../lib/init-guild";

const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ }
});
function mkRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-route-"));
  tmps.push(d);
  return d;
}
function touch(p: string, content = ""): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function mkRepo(at: string): void { fs.mkdirSync(path.join(at, ".git"), { recursive: true }); }

/** Byte-exact snapshot of a directory tree: sorted relpath → file contents. */
function snapshot(root: string): string {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else out[path.relative(root, abs)] = fs.readFileSync(abs, "utf8");
    }
  };
  walk(root);
  return JSON.stringify(out, Object.keys(out).sort());
}

describe("init prompt routing — write-free preflight + deny is byte-identical (V3)", () => {
  it("hostOpenPreflight on a not_installed root writes NOTHING (no write before approval)", () => {
    const root = mkRoot();
    touch(path.join(root, "README.md"), "hello\n"); // pre-existing user content
    const before = snapshot(root);
    const r = hostOpenPreflight(root, "claude-code-cli");
    expect(r.action).toBe("offer_init"); // the init prompt path actually ran...
    expect(r.init_prompt).not.toBeNull();
    expect(r.lifecycle_available).toBe(false);
    expect(snapshot(root)).toBe(before); // ...and yet the tree is untouched
  });

  it("DENY (no initializeGuild call) leaves the tree byte-identical; APPROVE mutates it", () => {
    const denyRoot = mkRoot();
    touch(path.join(denyRoot, "src", "main.ts"), "export const x = 1;\n");
    const before = snapshot(denyRoot);

    // DENY: the host offered init, the user declined → we simply do not initialize.
    const offered = hostOpenPreflight(denyRoot, "claude-code-cli");
    expect(offered.action).toBe("offer_init");
    expect(offered.init_prompt?.branches).toContain("skip"); // "skip" is always offered
    expect(snapshot(denyRoot)).toBe(before); // deny == zero writes

    // APPROVE (anti-vacuity): the SAME starting tree, initialized, must differ.
    const approveRoot = mkRoot();
    touch(path.join(approveRoot, "src", "main.ts"), "export const x = 1;\n");
    const approveBefore = snapshot(approveRoot);
    initializeGuild(approveRoot, "single_project", { now: "2026-01-01T00:00:00Z" });
    expect(snapshot(approveRoot)).not.toBe(approveBefore); // the snapshot diff is real
  });
});

describe("init prompt routing — V4 residue: selecting multiple → workspace mode", () => {
  it("has_child_repos ⇒ recommended_mode 'workspace' and the multiple-repo branch is offered", () => {
    const root = mkRoot();
    mkRepo(path.join(root, "packages", "a"));
    mkRepo(path.join(root, "packages", "b"));

    const suggestion = suggestWorkspaceMode(root);
    expect(suggestion.root_kind).toBe("has_child_repos");
    expect(suggestion.recommended_mode).toBe("workspace");

    const r = hostOpenPreflight(root, "claude-code-cli");
    expect(r.action).toBe("offer_init");
    expect(r.init_prompt?.recommended_mode).toBe("workspace");
    expect(r.init_prompt?.branches).toContain("multiple_repo_workspace");
    expect(r.init_prompt?.child_git_repos.length).toBe(2);
  });

  it("selecting the workspace branch initializes WORKSPACE mode (workspace.json created); single does not", () => {
    const wsRoot = mkRoot();
    mkRepo(path.join(wsRoot, "packages", "a"));
    initializeGuild(wsRoot, "workspace", { now: "2026-01-01T00:00:00Z" });
    expect(fs.existsSync(path.join(wsRoot, ".guild", "workspace.json"))).toBe(true);
    expect(hostOpenPreflight(wsRoot, "claude-code-cli").detection.state).toBe("workspace_root");

    // routing residue contrast: the single_project branch never creates workspace.json
    const spRoot = mkRoot();
    initializeGuild(spRoot, "single_project", { now: "2026-01-01T00:00:00Z" });
    expect(fs.existsSync(path.join(spRoot, ".guild", "workspace.json"))).toBe(false);
    expect(hostOpenPreflight(spRoot, "claude-code-cli").detection.state).toBe("single_project");
  });
});

describe("init prompt routing — non-CLI host is blocked, never false-native (V3/L0)", () => {
  it("an app/connector host id → action 'blocked', advisory host_unsupported, no lifecycle", () => {
    const root = mkRoot();
    initializeGuild(root, "single_project", { now: "2026-01-01T00:00:00Z" });
    const r = hostOpenPreflight(root, "claude-app"); // not in CLI_NATIVE_HOSTS
    expect(r.action).toBe("blocked");
    expect(r.advisory.code).toBe("host_unsupported");
    expect(r.lifecycle_available).toBe(false);
    expect(r.init_prompt).toBeNull();
    expect(r.repair_hint).toBeNull();
  });

  it("anti-vacuity: a CLI-native host on the SAME ready install proceeds with lifecycle", () => {
    const root = mkRoot();
    initializeGuild(root, "single_project", { now: "2026-01-01T00:00:00Z" });
    const r = hostOpenPreflight(root, "claude-code-cli");
    expect(r.action).toBe("proceed");
    expect(r.lifecycle_available).toBe(true);
  });
});

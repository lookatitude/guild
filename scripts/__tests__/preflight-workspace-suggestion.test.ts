/**
 * scripts/__tests__/preflight-workspace-suggestion.test.ts
 *
 * Regression for the L2+L3 G-lane review (init-config-goal §E6/V4): the original
 * detectChildGitRepos was depth-1 only (missed nested repos) and rootIsEmpty's
 * allowlist was too narrow (.gitignore / editor metadata misclassified a root as
 * non-empty). Real-fs, anti-vacuous.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  detectChildGitRepos,
  suggestWorkspaceMode,
} from "../../src/modules/config/workflows/host-open-preflight";

const tmps: string[] = [];
afterAll(() => { for (const d of tmps) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } });
function mkRoot(): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pf-")); tmps.push(d); return d; }
function mkRepo(at: string): void { fs.mkdirSync(path.join(at, ".git"), { recursive: true }); }
function touch(p: string): void { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ""); }

describe("detectChildGitRepos — immediate AND nested (review fix 1)", () => {
  it("finds a NESTED child repo (packages/foo/.git), not just depth-1", () => {
    const root = mkRoot();
    mkRepo(path.join(root, "packages", "foo"));   // nested
    mkRepo(path.join(root, "direct"));            // immediate
    const found = detectChildGitRepos(root);
    expect(found).toContain(path.join(root, "packages", "foo"));
    expect(found).toContain(path.join(root, "direct"));
  });

  it("does NOT descend into a found repo (a repo's own submodule is not a separate child)", () => {
    const root = mkRoot();
    mkRepo(path.join(root, "repoA"));
    mkRepo(path.join(root, "repoA", "sub"));      // inside repoA → must be ignored
    const found = detectChildGitRepos(root);
    expect(found).toContain(path.join(root, "repoA"));
    expect(found).not.toContain(path.join(root, "repoA", "sub"));
  });

  it("anti-vacuity: a tree with NO child repos returns []", () => {
    const root = mkRoot();
    touch(path.join(root, "packages", "foo", "index.ts")); // dirs but no .git
    expect(detectChildGitRepos(root)).toEqual([]);
  });
});

describe("suggestWorkspaceMode — empty-root allowlist (review fix 2)", () => {
  it("a root with ONLY .gitignore is treated as empty (ask single-vs-workspace)", () => {
    const root = mkRoot();
    touch(path.join(root, ".gitignore"));
    expect(suggestWorkspaceMode(root).root_kind).toBe("empty");
  });

  it("a root with ONLY editor metadata (.vscode/) is empty", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".vscode"), { recursive: true });
    expect(suggestWorkspaceMode(root).root_kind).toBe("empty");
  });

  it("nested child repos → recommend workspace", () => {
    const root = mkRoot();
    mkRepo(path.join(root, "packages", "a"));
    const s = suggestWorkspaceMode(root);
    expect(s.root_kind).toBe("has_child_repos");
    expect(s.recommended_mode).toBe("workspace");
  });

  it("anti-vacuity: a real source file makes the root non-empty", () => {
    const root = mkRoot();
    touch(path.join(root, "README.md"));
    expect(suggestWorkspaceMode(root).root_kind).toBe("non_empty_no_child_repos");
  });
});

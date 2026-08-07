/**
 * tests/dot-guild/nested-guild.test.ts
 *
 * FU-F (share-dot-guild closeout): one `.guild/` per project (git repo) root.
 * Declared test fixtures are the only exemption (see FIXTURE_EXEMPT_PATTERNS
 * in plugin/scripts/dot-guild/audit.ts).
 *
 * Strategy: plant a temp workspace with combinations of legitimate /
 * fixture-exempt / leak `.guild/` dirs; assert audit.ts's nested-guild
 * detection flags exactly the leaks and exempts the rest.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawnSync } from "child_process";
// T6B-R2-B1: the audit CLI runs through the PACKAGE-LOCAL runtime (no ambient npx).
import { runTsCli } from "./ts-runtime-helper";

const AUDIT_SCRIPT = path.resolve(__dirname, "../../scripts/dot-guild/audit.ts");

function setupTempWorkspace(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-nested-"));
  // Init as a git repo so the top-level .guild/ would be legitimate
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return {
    dir,
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

function runAudit(workspaceDir: string): { stdout: string; stderr: string; status: number | null } {
  const result = runTsCli(AUDIT_SCRIPT, [`--workspace=${workspaceDir}`]);
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

describe("nested-guild lint (FU-F): one .guild/ per repo root", () => {
  test("clean workspace (only repo-root .guild/) — no flags", () => {
    const { dir, cleanup } = setupTempWorkspace();
    try {
      fs.mkdirSync(path.join(dir, ".guild", "wiki"), { recursive: true });
      const r = runAudit(dir);
      expect(r.stdout).not.toMatch(/nested-guild/);
      expect(r.stderr).toMatch(/No actionable flags/);
    } finally { cleanup(); }
  });

  test("workspace with a nested .guild/ — flags exactly one leak", () => {
    const { dir, cleanup } = setupTempWorkspace();
    try {
      fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
      fs.mkdirSync(path.join(dir, "hooks", ".guild", "runs", "run-X"), { recursive: true });
      fs.writeFileSync(path.join(dir, "hooks", ".guild", "runs", "run-X", "events.ndjson"), "{}\n");
      const r = runAudit(dir);
      expect(r.stdout).toMatch(/nested-guild/);
      expect(r.stdout).toMatch(/hooks\/\.guild/);
      expect(r.status).toBe(1); // audit exits 1 on actionable flags
    } finally { cleanup(); }
  });

  test("fixture-exempt path is NOT flagged", () => {
    const { dir, cleanup } = setupTempWorkspace();
    try {
      fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
      // Mirror the FIXTURE_EXEMPT_PATTERNS shape — `benchmark/fixtures/<X>/.guild`
      fs.mkdirSync(path.join(dir, "benchmark", "fixtures", "demo", ".guild"), { recursive: true });
      const r = runAudit(dir);
      expect(r.stdout).not.toMatch(/nested-guild/);
      expect(r.stderr).toMatch(/No actionable flags/);
    } finally { cleanup(); }
  });

  test("multiple leaks at different depths — all flagged", () => {
    const { dir, cleanup } = setupTempWorkspace();
    try {
      fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
      fs.mkdirSync(path.join(dir, "a", ".guild"), { recursive: true });
      fs.mkdirSync(path.join(dir, "a", "b", ".guild"), { recursive: true });
      fs.mkdirSync(path.join(dir, "c", "d", "e", ".guild"), { recursive: true });
      const r = runAudit(dir);
      const matches = (r.stdout.match(/nested-guild/g) ?? []).length;
      expect(matches).toBeGreaterThanOrEqual(3);
      // Audit should NOT descend into the flagged nested .guild/ — so deeper
      // .guild/ inside a flagged one is not double-counted.
      expect(r.status).toBe(1);
    } finally { cleanup(); }
  });
});

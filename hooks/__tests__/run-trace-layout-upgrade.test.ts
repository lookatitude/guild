/**
 * hooks/__tests__/run-trace-layout-upgrade.test.ts — #276.
 *
 * Run start upgrades the layout of the root it is started in, every time,
 * whatever the timing, and says so when it does not. Driven against the SHIPPED
 * bundle (`hooks/dist/run-trace.js`) the way a command dispatcher spawns it, with
 * no plugin-root env var (test-preload strips CLAUDE_* / GUILD_*): the result may
 * not depend on the host exporting one.
 */

import { describe, it, expect } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const RUN_TRACE = path.join(PLUGIN_ROOT, "hooks", "dist", "run-trace.js");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
}

/** A committed v1-shaped root: settings.json grab-bag, an in-tree index cache, a wiki. */
function v1Root(base: string, name: string): string {
  const root = path.join(base, name);
  const g = path.join(root, ".guild");
  fs.mkdirSync(path.join(g, "wiki"), { recursive: true });
  fs.mkdirSync(path.join(g, "indexes"), { recursive: true });
  fs.writeFileSync(path.join(g, "settings.json"), '{"recall":{"backend":"bm25"}}\n');
  fs.writeFileSync(path.join(g, "indexes", "codebase-map.json"), "{}\n");
  fs.writeFileSync(path.join(g, "wiki", "index.md"), "# index\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "v1");
  return root;
}

function start(root: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUN_TRACE, "start", "--command=/guild:guild", "--phase=ideate", "--cwd", root], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

function shape(root: string): { marker: boolean; config: boolean; glossary: boolean; indexes: boolean } {
  const g = path.join(root, ".guild");
  return {
    marker: fs.existsSync(path.join(g, "storage-layout.json")),
    config: fs.existsSync(path.join(g, "config", "project.json")),
    glossary: fs.existsSync(path.join(g, "wiki", "glossary.md")),
    indexes: fs.existsSync(path.join(g, "indexes")),
  };
}

describe("#276 run start upgrades every root, deterministically", () => {
  it("three sibling roots started within one second all reach layout 2", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-276-"));
    const roots = ["a", "b", "c"].map((n) => v1Root(base, n));

    const results = await Promise.all(roots.map((r) => start(r)));

    for (const [i, root] of roots.entries()) {
      expect(results[i].code).toBe(0);
      expect(shape(root)).toEqual({ marker: true, config: true, glossary: true, indexes: false });
      expect(results[i].stderr).toContain("layout upgraded");
    }
  }, 60_000);

  it("a root whose upgrade blocks says why, and names the retry", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-276-dirty-"));
    const root = v1Root(base, "dirty");
    fs.writeFileSync(path.join(root, ".guild", "settings.json"), '{"recall":{"backend":"hybrid"}}\n');

    const r = await start(root);

    expect(r.code).toBe(0);
    expect(shape(root).marker).toBe(false);
    expect(r.stderr).toContain("layout upgrade not applied");
    expect(r.stderr).toContain("blocked_dirty_durable");
    expect(r.stderr).toContain(".guild/settings.json");
    expect(r.stderr).toContain("config migrate --mode=migrate");
  }, 60_000);

  it("a current root prints nothing about the layout", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-276-current-"));
    const root = v1Root(base, "current");
    await start(root);
    const second = await start(root);
    expect(second.stderr).not.toContain("layout");
  }, 60_000);
});

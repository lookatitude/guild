/**
 * #273 — learn-scan on a workspace root indexes only the root's own files:
 * every sub_guild workspace-detect registered in .guild/workspace.json is
 * excluded without a .guildignore. A root with no sub_guilds scans as before.
 */
import { test, expect, afterAll } from "bun:test";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCAN = path.resolve(__dirname, "scan.ts");
const WRITE_MANIFEST = path.resolve(__dirname, "..", "workspace", "write-manifest.ts");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

function mkRoot(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "scan-ws-"));
  roots.push(r);
  return r;
}

function put(root: string, rel: string, body = "export const x = 1;\n"): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

function registerWorkspace(root: string): void {
  const r = spawnSync("npx", ["tsx", WRITE_MANIFEST, "--cwd", root], { encoding: "utf8", timeout: 60000 });
  expect(r.status).toBe(0);
}

function scannedPaths(root: string): string[] {
  const r = spawnSync("npx", ["tsx", SCAN, "--cwd", root, "--print"], { encoding: "utf8", timeout: 60000 });
  expect(r.status).toBe(0);
  const map = JSON.parse(r.stdout) as { files: Array<{ path: string }> };
  return map.files.map((f) => f.path).sort();
}

test("workspace root: registered sub_guild paths are excluded without a .guildignore", () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, "app", ".git"), { recursive: true });
  put(root, "app/src/a.ts");
  fs.mkdirSync(path.join(root, "lib", ".guild"), { recursive: true });
  put(root, "lib/b.ts");
  put(root, "tools/t.ts");
  registerWorkspace(root);
  expect(fs.existsSync(path.join(root, ".guildignore"))).toBe(false);
  expect(scannedPaths(root)).toEqual(["tools/t.ts"]);
});

test("a root with no sub_guilds scans as before", () => {
  const root = mkRoot();
  put(root, "app/src/a.ts");
  put(root, "lib/b.ts");
  registerWorkspace(root);
  expect(scannedPaths(root)).toEqual(["app/src/a.ts", "lib/b.ts"]);
});

test("workspace.mode=off: sub_guilds are not registered, so nothing is excluded", () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify({ workspace: { mode: "off" } }));
  fs.mkdirSync(path.join(root, "app", ".git"), { recursive: true });
  put(root, "app/src/a.ts");
  put(root, "tools/t.ts");
  registerWorkspace(root);
  expect(scannedPaths(root)).toEqual(["app/src/a.ts", "tools/t.ts"]);
});

test("a manifest entry that is not a depth-1 name excludes nothing", () => {
  const root = mkRoot();
  put(root, "app/src/a.ts");
  put(root, "tools/t.ts");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".guild", "workspace.json"),
    JSON.stringify({ schema_version: "guild.workspace.v1", is_workspace: true, sub_guilds: [{ path: "app/src" }, { path: ".." }, { path: "" }] }),
  );
  expect(scannedPaths(root)).toEqual(["app/src/a.ts", "tools/t.ts"]);
});

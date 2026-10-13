/**
 * A compiled CLI under runtime/scripts/ resolves the PLUGIN root, not
 * runtime/, when GUILD_PLUGIN_ROOT / CLAUDE_PLUGIN_ROOT are unset. The fixture
 * runs the committed bundles from a temp cwd with the env stripped.
 */

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { findPluginRoot, resolvePluginRoot } from "../src/domains/kernel";
import { produceFromTemplateFile } from "./instantiate-template";

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const BUNDLES = path.join(PLUGIN_ROOT, "runtime", "scripts");
const TEMPLATE_COUNT = fs.readdirSync(path.join(PLUGIN_ROOT, "templates", "specialists")).filter((f) => f.endsWith(".md")).length;

function bareEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["GUILD_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT", "GUILD_RUN_ID", "GUILD_RUN_DIR"]) delete env[key];
  return env;
}

function tempDir(tag: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `guild-root-${tag}-`)));
}

function run(bundle: string, args: string[], cwd: string) {
  return spawnSync("node", [bundle, ...args], { cwd, env: bareEnv(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function templateRows(stdout: string): number {
  return (JSON.parse(stdout).templates as unknown[]).length;
}

/** A package with the copied bundle at runtime/scripts/ and the real trees it reads, env unset. */
function packageWith(bundleName: string, body: string): string {
  const pkg = tempDir("pkg");
  fs.mkdirSync(path.join(pkg, "runtime", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "runtime", "guild-mcp.js"), "// marker\n");
  fs.writeFileSync(path.join(pkg, "runtime", "scripts", bundleName), body);
  for (const tree of ["agents", "templates", "scripts"]) fs.symlinkSync(path.join(PLUGIN_ROOT, tree), path.join(pkg, tree));
  return pkg;
}

describe("compiled entries resolve the plugin root, not runtime/", () => {
  it("findPluginRoot walks up to the runtime/guild-mcp.js marker from either shape", () => {
    expect(findPluginRoot(BUNDLES)).toBe(PLUGIN_ROOT);
    expect(findPluginRoot(path.join(PLUGIN_ROOT, "src", "domains", "kernel"))).toBe(PLUGIN_ROOT);
    expect(findPluginRoot(tempDir("none"))).toBeNull();
    expect(resolvePluginRoot(BUNDLES, {})).toBe(PLUGIN_ROOT);
    expect(resolvePluginRoot(BUNDLES, { GUILD_PLUGIN_ROOT: "/x" })).toBe("/x");
    expect(() => resolvePluginRoot(tempDir("none"), {})).toThrow(/plugin root not found/);
  });

  it("runtime/scripts/roster-resolve.js lists every specialist template with the env unset", () => {
    const cwd = tempDir("roster");
    const res = run(path.join(BUNDLES, "roster-resolve.js"), ["--cwd", cwd], cwd);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).plugin_root).toBe(PLUGIN_ROOT);
    expect(TEMPLATE_COUNT).toBe(15);
    expect(templateRows(res.stdout)).toBe(TEMPLATE_COUNT);
  });

  it("runtime/scripts/instantiate-template.js produces the same pair as the source", () => {
    const cwd = tempDir("tpl");
    const res = run(path.join(BUNDLES, "instantiate-template.js"), ["web-app", "--stdout"], cwd);
    expect(res.status).toBe(0);
    const expected = produceFromTemplateFile(path.join(PLUGIN_ROOT, "templates", "products", "web-app.template.json"));
    expect(JSON.parse(res.stdout)).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it("CONTROL: the old __dirname/.. root planted in a copied bundle reads runtime/ (0 templates, ENOENT)", () => {
    const fix = "resolvePluginRoot(__dirname)";
    const old = 'require("path").resolve(__dirname, "..")';

    const roster = fs.readFileSync(path.join(BUNDLES, "roster-resolve.js"), "utf8");
    expect(roster).toContain(fix);
    const good = packageWith("roster-resolve.js", roster);
    const cwd = tempDir("ctl");
    expect(templateRows(run(path.join(good, "runtime", "scripts", "roster-resolve.js"), ["--cwd", cwd], cwd).stdout)).toBe(TEMPLATE_COUNT);
    const bad = packageWith("roster-resolve.js", roster.split(fix).join(old));
    expect(templateRows(run(path.join(bad, "runtime", "scripts", "roster-resolve.js"), ["--cwd", cwd], cwd).stdout)).toBe(0);

    const tpl = fs.readFileSync(path.join(BUNDLES, "instantiate-template.js"), "utf8");
    expect(tpl).toContain(fix);
    const badTpl = packageWith("instantiate-template.js", tpl.split(fix).join(old));
    const res = run(path.join(badTpl, "runtime", "scripts", "instantiate-template.js"), ["web-app", "--stdout"], cwd);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("ENOENT");
  });
});

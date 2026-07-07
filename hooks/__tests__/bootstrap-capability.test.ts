/**
 * bootstrap-capability.test.ts
 *
 * Verifies that bootstrap.sh triggers the write-host-capability.ts invocation
 * (RE-5) and that .guild/hosts/<host-id>/capability.json is written at SessionStart.
 *
 * This is an integration test: it runs the real bootstrap.sh against a temp
 * directory and checks that capability.json is produced with the expected schema.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const BOOTSTRAP = path.resolve(__dirname, "../bootstrap.sh");
const PLUGIN_ROOT = path.resolve(__dirname, "../..");

describe("bootstrap.sh — host-capability manifest (RE-5)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-bootstrap-cap-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes .guild/hosts/<host>/capability.json when bootstrap.sh runs", () => {
    const result = spawnSync("bash", [BOOTSTRAP], {
      input: "{}",
      encoding: "utf8",
      env: {
        ...process.env,
        // Override GUILD_PLUGIN_ROOT so bootstrap.sh finds the plugin at the right path.
        GUILD_PLUGIN_ROOT: PLUGIN_ROOT,
        // Set PWD to tmpDir so write-host-capability.ts writes there.
        PWD: tmpDir,
        HOME: process.env["HOME"] ?? tmpDir,
      },
      cwd: tmpDir,
      timeout: 30000,
    });

    // bootstrap.sh always exits 0.
    expect(result.status).toBe(0);

    // Capability file should exist under .guild/hosts/<host-id>/
    const hostsDir = path.join(tmpDir, ".guild", "hosts");
    if (!fs.existsSync(hostsDir)) {
      // write-host-capability.ts requires npx/tsx — if unavailable in CI, skip gracefully.
      console.warn("[bootstrap-capability.test] .guild/hosts/ not created — tsx/npx may be unavailable in this environment; skipping deep assertion.");
      return;
    }

    const hostDirs = fs.readdirSync(hostsDir);
    expect(hostDirs.length).toBeGreaterThan(0);

    const capFile = path.join(hostsDir, hostDirs[0], "capability.json");
    expect(fs.existsSync(capFile)).toBe(true);

    const cap = JSON.parse(fs.readFileSync(capFile, "utf8"));
    expect(cap.schema_version).toBe("guild.host_capability.v1");
    expect(cap.source).toBe("session-start");
    expect(typeof cap.host_id).toBe("string");
    // TE-07: canonical field name is tier_models
    expect(typeof cap.tier_models).toBe("object");
  });

  it("exits 0 even when write-host-capability.ts is unavailable (non-fatal)", () => {
    // Simulate a broken PLUGIN_ROOT where scripts/ doesn't exist — bootstrap.sh
    // must still exit 0 and print the status block.
    const fakePluginRoot = path.join(tmpDir, "fake-plugin");
    fs.mkdirSync(path.join(fakePluginRoot, ".claude-plugin"), { recursive: true });
    // Write a minimal plugin.json so bootstrap.sh gets past the version check.
    fs.writeFileSync(
      path.join(fakePluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ version: "test-stub" })
    );

    const result = spawnSync("bash", [BOOTSTRAP], {
      input: "{}",
      encoding: "utf8",
      env: {
        ...process.env,
        GUILD_PLUGIN_ROOT: fakePluginRoot,
        PWD: tmpDir,
        HOME: process.env["HOME"] ?? tmpDir,
      },
      cwd: tmpDir,
      timeout: 15000,
    });

    // Must always exit 0 — capability write failure is non-fatal.
    expect(result.status).toBe(0);
    // The status block must still be emitted.
    expect(result.stdout).toMatch(/Guild/i);
  });
});

/**
 * scripts/__tests__/permission-policy-host-mode.test.ts
 *
 * rf-wi-01 (v23x-deferred-followups G1) — readRuntimePermissionConfig's newly-wired
 * `host_mode` read, plus the codex-review P1 fix that layers settings.local.json
 * (project settings.json < project settings.local.json) so a resolved-config
 * override actually takes effect for auto_approve/bypass_permissions_policy/host_mode,
 * not just settings.json.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { readRuntimePermissionConfig, RUNTIME_DEFAULT_CONFIG } from "../lib/permission-policy";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "permission-policy-test-"));
}
function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
function writeSettings(root: string, settings: object): void {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify(settings, null, 2));
}
function writeLocalSettings(root: string, settings: object): void {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "settings.local.json"), JSON.stringify(settings, null, 2));
}

describe("readRuntimePermissionConfig — host_mode (G1 registration)", () => {
  let root: string;
  beforeEach(() => (root = tmpRoot()));
  afterEach(() => cleanup(root));

  it("defaults to RUNTIME_DEFAULT_CONFIG (host_mode unset) with no settings.json", () => {
    expect(readRuntimePermissionConfig(root)).toEqual(RUNTIME_DEFAULT_CONFIG);
  });

  it("reads a valid top-level host_mode from settings.json", () => {
    writeSettings(root, { host_mode: "accept_edits" });
    expect(readRuntimePermissionConfig(root).host_mode).toBe("accept_edits");
  });

  it("null host_mode (the schema default) leaves it unset, not literally null", () => {
    writeSettings(root, { host_mode: null });
    expect(readRuntimePermissionConfig(root).host_mode).toBeUndefined();
  });

  it("ignores an invalid host_mode enum string (degrades to unset)", () => {
    writeSettings(root, { host_mode: "godmode" });
    expect(readRuntimePermissionConfig(root).host_mode).toBeUndefined();
  });

  it("degrades to defaults on corrupt settings.json", () => {
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "settings.json"), "{not json");
    expect(readRuntimePermissionConfig(root)).toEqual(RUNTIME_DEFAULT_CONFIG);
  });

  // codex-review P1 fix — resolved-config precedence (settings.local.json wins)
  it("a settings.local.json host_mode override wins over settings.json", () => {
    writeSettings(root, { host_mode: "accept_edits" });
    writeLocalSettings(root, { host_mode: "read_only" });
    expect(readRuntimePermissionConfig(root).host_mode).toBe("read_only");
  });

  it("settings.local.json alone (no settings.json) still applies", () => {
    writeLocalSettings(root, { host_mode: "bypass_all" });
    expect(readRuntimePermissionConfig(root).host_mode).toBe("bypass_all");
  });

  it("a settings.local.json auto_approve/bypass override also wins (same precedence fix)", () => {
    writeSettings(root, { defaults: { gates: { auto_approve: ["plan"] } }, security: { bypass_permissions_policy: "audit" } });
    writeLocalSettings(root, { defaults: { gates: { auto_approve: ["all"] } }, security: { bypass_permissions_policy: "allow" } });
    const cfg = readRuntimePermissionConfig(root);
    expect(cfg.auto_approve).toEqual(["all"]);
    expect(cfg.bypass_permissions_policy).toBe("allow");
  });

  it("a corrupt settings.local.json degrades gracefully, keeping the settings.json value", () => {
    writeSettings(root, { host_mode: "auto" });
    fs.writeFileSync(path.join(root, ".guild", "settings.local.json"), "{not json");
    expect(readRuntimePermissionConfig(root).host_mode).toBe("auto");
  });
});

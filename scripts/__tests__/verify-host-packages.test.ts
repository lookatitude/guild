import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { buildHostPackages } from "../build-host-packages";
import { PLUGIN_ROOT, UNSTAMPED_GENERATED_AT } from "../build-inventory";
import {
  verifyGeneratedHostPackages,
} from "../verify-host-packages";

describe("verify generated host packages", () => {
  function buildTempDist(): string {
    const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-verify-host-packages-"));
    const result = buildHostPackages({
      root: PLUGIN_ROOT,
      distRoot,
      generatedAt: UNSTAMPED_GENERATED_AT,
      gates: true,
      syncClaudeInstall: false,
      checkClaudeInstall: false,
    });
    expect(result.gateOk).toBe(true);
    return distRoot;
  }

  it("passes for a freshly generated host package set", () => {
    const distRoot = buildTempDist();
    try {
      const result = verifyGeneratedHostPackages({ root: PLUGIN_ROOT, distRoot });
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.checks).toContain("agents:bin/guild-run --dry-run");
      expect(result.checks).toContain("codex:bin/guild-run --dry-run");
      expect(result.checks).toContain("pi:bin/guild-run --dry-run");
      expect(result.checks).toContain("antigravity:bin/guild-run --dry-run");
    } finally {
      fs.rmSync(distRoot, { recursive: true, force: true });
    }
  });

  it("CONTROL: fails when the generated package omits the hook runtime used by guild-run", () => {
    const distRoot = buildTempDist();
    try {
      fs.rmSync(path.join(distRoot, "codex", "hooks", "lib", "handoff-v2.ts"), { force: true });
      const result = verifyGeneratedHostPackages({ root: PLUGIN_ROOT, distRoot });
      expect(result.ok).toBe(false);
      expect(result.errors).toContain("missing generated package file: codex/hooks/lib/handoff-v2.ts");
      expect(result.errors.join("\n")).toContain("codex: guild-run dry-run failed");
    } finally {
      fs.rmSync(distRoot, { recursive: true, force: true });
    }
  });

  it("CLI exits nonzero for a missing dist tree", () => {
    const missingDist = path.join(os.tmpdir(), `guild-missing-dist-${Date.now()}`);
    const res = spawnSync(path.join(__dirname, "..", "node_modules", ".bin", "tsx"), [
      "verify-host-packages.ts",
      "--root",
      PLUGIN_ROOT,
      "--dist",
      missingDist,
    ], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: "/private/tmp/guild-npm-cache" },
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("verify-host-packages: FAIL");
  });
});

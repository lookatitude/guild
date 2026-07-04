import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { PLUGIN_ROOT } from "../build-inventory";
import {
  INSTALLER_HOST_EXPECTATIONS,
  verifyInstallerFixtureExecutions,
  verifyInstallerLiveIsolatedExecutions,
  verifyInstallerDryRunOutput,
  verifyInstallerDryRuns,
  verifyInstallerHostExecutionLog,
} from "../verify-installer";

describe("verify installer dry-runs", () => {
  it("passes for every supported install.sh host without requiring host binaries", () => {
    const result = verifyInstallerDryRuns({ root: PLUGIN_ROOT, pathEnv: "/usr/bin:/bin" });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.checks).toEqual(
      INSTALLER_HOST_EXPECTATIONS.map((entry) => `${entry.host}:install.sh --dry-run`)
    );
  });

  it("executes every supported install.sh host against isolated fake host binaries", () => {
    const result = verifyInstallerFixtureExecutions({ root: PLUGIN_ROOT });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.checks).toEqual(
      INSTALLER_HOST_EXPECTATIONS.map((entry) => `${entry.host}:install.sh fixture execution`)
    );
  });

  it("executes the live-isolated installer rail against PATH host binaries without dry-run", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-installer-live-test-"));
    try {
      const fakeBin = path.join(tmp, "bin");
      fs.mkdirSync(fakeBin, { recursive: true });
      for (const binary of ["claude", "codex", "pi", "agy"]) {
        const abs = path.join(fakeBin, binary);
        fs.writeFileSync(abs, "#!/usr/bin/env bash\nexit 0\n");
        fs.chmodSync(abs, 0o755);
      }

      const result = verifyInstallerLiveIsolatedExecutions({
        root: PLUGIN_ROOT,
        pathEnv: `${fakeBin}${path.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
      });
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.checks).toEqual(
        INSTALLER_HOST_EXPECTATIONS.map((entry) => `${entry.host}:install.sh live isolated execution`)
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("CONTROL: fails when a required host command snippet is absent", () => {
    const errors = verifyInstallerDryRunOutput(
      "pi-cli",
      "Pi CLI selected (dry-run; pi binary not required for planning)\n"
    );
    expect(errors.join("\n")).toContain("pi-cli: missing dry-run output snippet: would run: pi install dist/pi");
  });

  it("CONTROL: fails if dry-run emits a real generated timestamp", () => {
    const goodEnoughOutput = INSTALLER_HOST_EXPECTATIONS.find((entry) => entry.host === "agents-file")!.snippets.join(
      "\n"
    );
    const errors = verifyInstallerDryRunOutput(
      "agents-file",
      `${goodEnoughOutput}\nwould run: npx tsx scripts/build-host-packages.ts --generated-at 2026-06-23T12:00:00Z\n`
    );
    expect(errors).toContain("agents-file: dry-run emitted a real timestamp instead of <generated-at>");
  });

  it("CONTROL: fails when fixture execution misses or adds a host command", () => {
    const missing = verifyInstallerHostExecutionLog("claude-code-cli", [
      "claude\tplugin validate ./dist/claude-code",
      "claude\tplugin marketplace add ./dist/claude-code",
    ]);
    expect(missing.join("\n")).toContain(
      "claude-code-cli: missing executed host call: claude\tplugin marketplace update guild"
    );

    const unexpected = verifyInstallerHostExecutionLog("pi-cli", [
      "pi\tinstall ./dist/pi",
      "pi\tdelete-everything",
    ]);
    expect(unexpected).toContain("pi-cli: unexpected executed host call: pi\tdelete-everything");
  });

  it("CLI exits nonzero for a missing installer script", () => {
    const missingInstaller = path.join(os.tmpdir(), `guild-missing-install-${Date.now()}.sh`);
    const res = spawnSync(
      path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
      ["verify-installer.ts", "--root", PLUGIN_ROOT, "--install-script", missingInstaller],
      {
        cwd: path.join(__dirname, ".."),
        encoding: "utf8",
        env: { ...process.env, npm_config_cache: "/private/tmp/guild-npm-cache" },
      }
    );
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("verify-installer: FAIL");
    expect(res.stderr).toContain("missing installer script");
  });

  it("CLI rejects mutually exclusive installer execution modes", () => {
    const res = spawnSync(
      path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
      ["verify-installer.ts", "--root", PLUGIN_ROOT, "--execute-fixtures", "--execute-live-isolated"],
      {
        cwd: path.join(__dirname, ".."),
        encoding: "utf8",
        env: { ...process.env, npm_config_cache: "/private/tmp/guild-npm-cache" },
      }
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--execute-fixtures and --execute-live-isolated are mutually exclusive");
  });
});

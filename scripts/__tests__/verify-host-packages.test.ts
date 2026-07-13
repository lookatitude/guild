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

  // ---------------------------------------------------------------------------
  // Path-resolution gate CONTROL tests (audit fix item 5: prove the new pass
  // actually catches the defects it was added for, not just that it runs).
  // Each test mutates a freshly-built, otherwise-GREEN dist tree to reproduce
  // exactly the shape of the fixed defect, then asserts verify fails closed
  // with a message naming the dangling reference.
  // ---------------------------------------------------------------------------

  it("CONTROL: fails when a package omits a hooks/dist/*.js bundle its own commands invoke (item 1)", () => {
    const distRoot = buildTempDist();
    try {
      fs.rmSync(path.join(distRoot, "claude-code", "hooks", "dist", "run-trace.js"), { force: true });
      const result = verifyGeneratedHostPackages({ root: PLUGIN_ROOT, distRoot });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("hooks/dist/run-trace.js"))).toBe(true);
    } finally {
      fs.rmSync(distRoot, { recursive: true, force: true });
    }
  });

  it("CONTROL: fails when the AGENTS.md bootstrap points at a file the package doesn't ship (item 3)", () => {
    const distRoot = buildTempDist();
    try {
      const agentsMd = path.join(distRoot, "agents", "AGENTS.md");
      const original = fs.readFileSync(agentsMd, "utf8");
      // Reproduce the pre-fix defect shape: point the bootstrap at SKILL.md
      // instead of the SKILL.src.md that actually ships.
      fs.writeFileSync(
        agentsMd,
        original.replace(
          ".agents/skills/guild/meta/using-guild/SKILL.src.md",
          ".agents/skills/guild/meta/using-guild/SKILL.md"
        )
      );
      const result = verifyGeneratedHostPackages({ root: PLUGIN_ROOT, distRoot });
      expect(result.ok).toBe(false);
      expect(
        result.errors.some((e) => e.includes("AGENTS.md") && e.includes("using-guild/SKILL.md"))
      ).toBe(true);
    } finally {
      fs.rmSync(distRoot, { recursive: true, force: true });
    }
  });

  it("CONTROL: fails when a Pi manifest skills glob resolves to nothing (item 4)", () => {
    const distRoot = buildTempDist();
    try {
      const manifestPath = path.join(distRoot, "pi", "pi-manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      // Reproduce the pre-fix defect shape: the Claude-shaped path that never
      // existed in the Pi package tree at all.
      manifest.skills = ["./skills/core/"];
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      const result = verifyGeneratedHostPackages({ root: PLUGIN_ROOT, distRoot });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("skills glob") && e.includes("./skills/core/"))).toBe(true);
    } finally {
      fs.rmSync(distRoot, { recursive: true, force: true });
    }
  });

  it("CONTROL: fails when a Pi manifest command source_path points at a missing file (item 4)", () => {
    const distRoot = buildTempDist();
    try {
      const manifestPath = path.join(distRoot, "pi", "pi-manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.commands = [{ name: "guild", source_path: "./commands/guild.md" }];
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      const result = verifyGeneratedHostPackages({ root: PLUGIN_ROOT, distRoot });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("commands/guild.md"))).toBe(true);
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

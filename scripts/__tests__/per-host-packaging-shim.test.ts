import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/per-host-packaging";
import * as moduleImpl from "../../src/modules/distribution/workflows/per-host-packaging";

describe("per-host-packaging compatibility shim", () => {
  test("scripts/lib/per-host-packaging re-exports src/modules/distribution", () => {
    expect(shim.validateManifest).toBe(moduleImpl.validateManifest);
    expect(shim.renderCodexPluginJson).toBe(moduleImpl.renderCodexPluginJson);
    expect(shim.renderGeminiToml).toBe(moduleImpl.renderGeminiToml);
    expect(shim.renderPiManifest).toBe(moduleImpl.renderPiManifest);
    expect(shim.renderClaudePluginPackage).toBe(moduleImpl.renderClaudePluginPackage);
    expect(shim.renderAntigravityManifest).toBe(moduleImpl.renderAntigravityManifest);
    expect(shim.renderAgentsPackage).toBe(moduleImpl.renderAgentsPackage);
  });

  test("only the module file defines the renderer bodies", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/per-host-packaging.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/distribution/workflows/per-host-packaging.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/distribution\/workflows\/per-host-packaging["']/);
    expect(oldPath).not.toMatch(/export\s+function\s+renderCodexPluginJson/);
    expect(modulePath).toMatch(/export\s+function\s+renderCodexPluginJson/);
  });
});

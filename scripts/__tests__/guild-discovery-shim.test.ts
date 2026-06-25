import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/guild-discovery";
import * as moduleImpl from "../../src/modules/state/workflows/guild-discovery";

describe("guild-discovery compatibility shim", () => {
  test("scripts/lib/guild-discovery re-exports src/modules/state", () => {
    expect(shim.readWorkspaceManifest).toBe(moduleImpl.readWorkspaceManifest);
    expect(shim.discoverGuild).toBe(moduleImpl.discoverGuild);
    expect(shim.workspaceReadThroughSources).toBe(moduleImpl.workspaceReadThroughSources);
    expect(shim.isCanonicalGuildMemoryPath).toBe(moduleImpl.isCanonicalGuildMemoryPath);
    expect(shim.classifyMemoryPath).toBe(moduleImpl.classifyMemoryPath);
  });

  test("legacy path stays a thin public wrapper", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/guild-discovery.ts"), "utf8");
    const modulePath = fs.readFileSync(
      path.join(repoRoot, "src/modules/state/workflows/guild-discovery.ts"),
      "utf8",
    );

    expect(oldPath).toMatch(/src\/modules\/state\/workflows\/guild-discovery/);
    expect(oldPath).not.toMatch(/export\s+function\s+discoverGuild/);
    expect(modulePath).toMatch(/export\s+function\s+discoverGuild/);
    expect(modulePath).toMatch(/export\s+function\s+workspaceReadThroughSources/);
  });
});

import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/surface-manifest";
import * as moduleImpl from "../../src/modules/distribution/workflows/surface-manifest";

describe("surface-manifest compatibility shim", () => {
  test("scripts/lib/surface-manifest re-exports src/modules/distribution", () => {
    expect(shim.SURFACE_MANIFEST_SCHEMA_VERSION).toBe(moduleImpl.SURFACE_MANIFEST_SCHEMA_VERSION);
    expect(shim.SURFACE_KINDS).toBe(moduleImpl.SURFACE_KINDS);
    expect(shim.validateSurfaceManifest).toBe(moduleImpl.validateSurfaceManifest);
  });

  test("only the module file defines the validator body", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/surface-manifest.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/distribution/workflows/surface-manifest.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/distribution\/workflows\/surface-manifest["']/);
    expect(oldPath).not.toMatch(/export\s+function\s+validateSurfaceManifest/);
    expect(modulePath).toMatch(/export\s+function\s+validateSurfaceManifest/);
  });
});

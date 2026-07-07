import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/host-registry-schema";
import * as moduleImpl from "../../src/modules/host-runtime/workflows/host-registry-schema";

describe("host-registry-schema compatibility shim", () => {
  test("scripts/lib/host-registry-schema re-exports src/modules/host-runtime", () => {
    expect(shim.HOST_IDS).toBe(moduleImpl.HOST_IDS);
    expect(shim.HOST_FAMILIES).toBe(moduleImpl.HOST_FAMILIES);
    expect(shim.HOST_REGISTRY_ROWS).toBe(moduleImpl.HOST_REGISTRY_ROWS);
    expect(shim.validateHostRegistryEntry).toBe(moduleImpl.validateHostRegistryEntry);
    expect(shim.isHostRegistryEntry).toBe(moduleImpl.isHostRegistryEntry);
  });

  test("only the module file defines the registry row body", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/host-registry-schema.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/host-runtime/workflows/host-registry-schema.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/host-runtime\/workflows\/host-registry-schema["']/);
    expect(oldPath).not.toMatch(/export\s+const\s+HOST_REGISTRY_ROWS/);
    expect(modulePath).toMatch(/export\s+const\s+HOST_REGISTRY_ROWS/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-capabilities-schema["']/);
  });
});

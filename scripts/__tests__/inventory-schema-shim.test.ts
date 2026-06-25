import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/inventory-schema";
import * as moduleImpl from "../../src/modules/distribution/workflows/inventory-schema";

describe("inventory-schema compatibility shim", () => {
  test("scripts/lib/inventory-schema re-exports src/modules/distribution", () => {
    expect(shim.INVENTORY_CATEGORIES).toBe(moduleImpl.INVENTORY_CATEGORIES);
    expect(shim.ALLOWED_INVENTORY_KEYS).toBe(moduleImpl.ALLOWED_INVENTORY_KEYS);
    expect(shim.validateInventoryV1).toBe(moduleImpl.validateInventoryV1);
    expect(shim.isInventoryV1).toBe(moduleImpl.isInventoryV1);
  });

  test("only the module file defines the validator body", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/inventory-schema.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/distribution/workflows/inventory-schema.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/distribution\/workflows\/inventory-schema["']/);
    expect(oldPath).not.toMatch(/export\s+function\s+validateInventoryV1/);
    expect(modulePath).toMatch(/export\s+function\s+validateInventoryV1/);
  });
});

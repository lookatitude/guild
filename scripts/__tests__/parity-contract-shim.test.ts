import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/parity-contract";
import * as moduleImpl from "../../src/modules/distribution/workflows/parity-contract";

describe("parity-contract compatibility shim", () => {
  test("scripts/lib/parity-contract re-exports src/modules/distribution", () => {
    expect(shim.DISCOVERY_RULES).toBe(moduleImpl.DISCOVERY_RULES);
    expect(shim.COVERAGE_ENFORCED_CATEGORIES).toBe(moduleImpl.COVERAGE_ENFORCED_CATEGORIES);
    expect(shim.checkCoverage).toBe(moduleImpl.checkCoverage);
    expect(shim.checkSubset).toBe(moduleImpl.checkSubset);
    expect(shim.checkParity).toBe(moduleImpl.checkParity);
  });

  test("only the module file defines the implementation body", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/parity-contract.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/distribution/workflows/parity-contract.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/distribution\/workflows\/parity-contract["']/);
    expect(oldPath).not.toMatch(/export\s+function\s+checkCoverage/);
    expect(modulePath).toMatch(/export\s+function\s+checkCoverage/);
  });
});

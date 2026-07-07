import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/installer-contract";
import * as moduleImpl from "../../src/modules/distribution/workflows/installer-contract";

describe("installer-contract compatibility shim", () => {
  test("scripts/lib/installer-contract re-exports src/modules/distribution", () => {
    expect(shim.INSTALL_RECEIPT_SCHEMA).toBe(moduleImpl.INSTALL_RECEIPT_SCHEMA);
    expect(shim.INSTALLER_PLAN_SCHEMA).toBe(moduleImpl.INSTALLER_PLAN_SCHEMA);
    expect(shim.RECEIPT_FACET_KEYS).toBe(moduleImpl.RECEIPT_FACET_KEYS);
    expect(shim.deriveReceiptFacets).toBe(moduleImpl.deriveReceiptFacets);
    expect(shim.buildInstallReceipt).toBe(moduleImpl.buildInstallReceipt);
    expect(shim.buildInstallSteps).toBe(moduleImpl.buildInstallSteps);
    expect(shim.buildReconcileSteps).toBe(moduleImpl.buildReconcileSteps);
    expect(shim.buildHostInstallerPlan).toBe(moduleImpl.buildHostInstallerPlan);
    expect(shim.buildInstallerPlan).toBe(moduleImpl.buildInstallerPlan);
    expect(shim.validateInstallReceipt).toBe(moduleImpl.validateInstallReceipt);
    expect(shim.validateInstallerPlan).toBe(moduleImpl.validateInstallerPlan);
    expect(shim.isInstallReceipt).toBe(moduleImpl.isInstallReceipt);
    expect(shim.isInstallerPlan).toBe(moduleImpl.isInstallerPlan);
  });

  test("only the module file defines the installer contract body", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/installer-contract.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/distribution/workflows/installer-contract.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/distribution\/workflows\/installer-contract["']/);
    expect(oldPath).not.toMatch(/export\s+function\s+buildInstallerPlan/);
    expect(modulePath).toMatch(/export\s+function\s+buildInstallerPlan/);
  });
});

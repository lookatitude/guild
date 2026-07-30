import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/result-contracts";
import * as moduleImpl from "../../src/modules/distribution/workflows/result-contracts";

describe("result-contracts compatibility shim", () => {
  test("scripts/lib/result-contracts re-exports src/modules/distribution", () => {
    expect(shim.EXISTING_CONTRACTS).toBe(moduleImpl.EXISTING_CONTRACTS);
    expect(shim.DEFERRED_CONTRACTS).toBe(moduleImpl.DEFERRED_CONTRACTS);
    expect(shim.RESULT_CONTRACTS).toBe(moduleImpl.RESULT_CONTRACTS);
    expect(shim.PHASE1_NORMALIZER_TARGETS).toBe(moduleImpl.PHASE1_NORMALIZER_TARGETS);
    expect(shim.CONTRACT_VALIDATORS).toBe(moduleImpl.CONTRACT_VALIDATORS);
    expect(shim.findContract).toBe(moduleImpl.findContract);
  });

  test("only the module file defines the registry body", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/result-contracts.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/distribution/workflows/result-contracts.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/distribution\/workflows\/result-contracts["']/);
    expect(oldPath).not.toMatch(/export\s+const\s+RESULT_CONTRACTS/);
    expect(modulePath).toMatch(/export\s+const\s+RESULT_CONTRACTS/);
    expect(modulePath).toMatch(/from\s+["']\.\/handoff-v2["']/);
    expect(modulePath).toMatch(/from\s+["']\.\/review-result["']/);
  });
});

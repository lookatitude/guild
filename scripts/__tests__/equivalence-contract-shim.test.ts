import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/equivalence-contract";
import * as moduleImpl from "../../src/modules/distribution/workflows/equivalence-contract";

describe("equivalence-contract compatibility shim", () => {
  test("scripts/lib/equivalence-contract re-exports src/modules/distribution", () => {
    expect(shim.EQUIVALENCE_SURFACES).toBe(moduleImpl.EQUIVALENCE_SURFACES);
    expect(shim.INTENTIONAL_EXCLUSIONS).toBe(moduleImpl.INTENTIONAL_EXCLUSIONS);
    expect(shim.PROVENANCE_FIELDS).toBe(moduleImpl.PROVENANCE_FIELDS);
    expect(shim.SORTED_MANIFEST_ARRAYS).toBe(moduleImpl.SORTED_MANIFEST_ARRAYS);
    expect(shim.normalizeJson).toBe(moduleImpl.normalizeJson);
    expect(shim.normalizeText).toBe(moduleImpl.normalizeText);
    expect(shim.jsonEquivalent).toBe(moduleImpl.jsonEquivalent);
    expect(shim.textEquivalent).toBe(moduleImpl.textEquivalent);
    expect(shim.checkClaudeEquivalence).toBe(moduleImpl.checkClaudeEquivalence);
  });

  test("only the module file defines the implementation body", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/equivalence-contract.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/distribution/workflows/equivalence-contract.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/distribution\/workflows\/equivalence-contract["']/);
    expect(oldPath).not.toMatch(/export\s+function\s+checkClaudeEquivalence/);
    expect(modulePath).toMatch(/export\s+function\s+checkClaudeEquivalence/);
  });
});

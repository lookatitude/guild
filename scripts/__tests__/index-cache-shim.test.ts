import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/index-cache";
import * as moduleImpl from "../../src/modules/state/workflows/index-cache";

describe("index-cache compatibility shim", () => {
  test("scripts/lib/index-cache re-exports src/modules/state", () => {
    expect(shim.DEFAULT_INDEX_BLOCK).toBe(moduleImpl.DEFAULT_INDEX_BLOCK);
    expect(shim.resolveMainRepoRoot).toBe(moduleImpl.resolveMainRepoRoot);
    expect(shim.ensureKgIndex).toBe(moduleImpl.ensureKgIndex);
    expect(shim.ensureKlIndex).toBe(moduleImpl.ensureKlIndex);
    expect(shim.ensureRunProvenanceIndex).toBe(moduleImpl.ensureRunProvenanceIndex);
    expect(shim.ensureWikiFtsIndex).toBe(moduleImpl.ensureWikiFtsIndex);
    expect(shim.ensureFederationWikiCache).toBe(moduleImpl.ensureFederationWikiCache);
  });

  test("legacy path stays a thin public wrapper", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/index-cache.ts"), "utf8");
    const modulePath = fs.readFileSync(
      path.join(repoRoot, "src/modules/state/workflows/index-cache.ts"),
      "utf8",
    );

    expect(oldPath).toMatch(/src\/modules\/state\/workflows\/index-cache/);
    expect(oldPath).not.toMatch(/export\s+function\s+ensureWikiFtsIndex/);
    expect(modulePath).toMatch(/export\s+function\s+ensureWikiFtsIndex/);
    expect(modulePath).toMatch(/from\s+["']\.\.\/\.\.\/migrations["']/);
    expect(modulePath).not.toMatch(/migrations\/workflows\/index-migrate/);
  });
});

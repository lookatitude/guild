import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/recall";
import * as moduleImpl from "../../src/modules/context/workflows/recall";

describe("recall compatibility shim", () => {
  test("scripts/lib/recall re-exports src/modules/context", () => {
    expect(shim.recall).toBe(moduleImpl.recall);
    expect(shim.recencyDecay).toBe(moduleImpl.recencyDecay);
    expect(shim.compositeScore).toBe(moduleImpl.compositeScore);
    expect(shim.resolveCompositeConfig).toBe(moduleImpl.resolveCompositeConfig);
    expect(shim.ingestImportanceScore).toBe(moduleImpl.ingestImportanceScore);
    expect(shim.runRecallCli).toBe(moduleImpl.runRecallCli);
  });

  test("legacy path stays a thin public and CLI wrapper", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/recall.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/context/workflows/recall.ts"), "utf8");

    expect(oldPath).toMatch(/src\/modules\/context\/workflows\/recall/);
    expect(oldPath).not.toMatch(/export\s+function\s+recall/);
    expect(oldPath).toMatch(/runRecallCli\(\)/);
    expect(modulePath).toMatch(/export\s+function\s+recall/);
    expect(modulePath).toMatch(/export\s+function\s+runRecallCli/);
    expect(modulePath).toMatch(/from\s+["']\.\/wiki-recall["']/);
    expect(modulePath).toMatch(/from\s+["']\.\.\/\.\.\/state["']/);
  });
});

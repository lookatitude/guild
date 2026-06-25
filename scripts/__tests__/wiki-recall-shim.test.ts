import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/wiki-recall";
import * as moduleImpl from "../../src/modules/context/workflows/wiki-recall";

describe("wiki-recall compatibility shim", () => {
  test("scripts/lib/wiki-recall re-exports src/modules/context", () => {
    expect(shim.wikiRecall).toBe(moduleImpl.wikiRecall);
    expect(shim.normalizeFtsQuery).toBe(moduleImpl.normalizeFtsQuery);
    expect(shim.classifyTrustTier).toBe(moduleImpl.classifyTrustTier);
    expect(shim.RECALL_INTEGRITY_DIRECTIVE).toBe(moduleImpl.RECALL_INTEGRITY_DIRECTIVE);
    expect(shim.runWikiRecallCli).toBe(moduleImpl.runWikiRecallCli);
  });

  test("preserves query normalization through the shim", () => {
    expect(shim.normalizeFtsQuery(`"auth"* (config): x ^ y`)).toBe("auth config");
  });

  test("legacy path stays a thin public and CLI wrapper", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/wiki-recall.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/context/workflows/wiki-recall.ts"), "utf8");

    expect(oldPath).toMatch(/src\/modules\/context\/workflows\/wiki-recall/);
    expect(oldPath).not.toMatch(/export\s+function\s+wikiRecall/);
    expect(oldPath).not.toMatch(/function\s+main/);
    expect(oldPath).toMatch(/runWikiRecallCli\(\)/);
    expect(modulePath).toMatch(/export\s+function\s+wikiRecall/);
    expect(modulePath).toMatch(/export\s+function\s+runWikiRecallCli/);
    expect(modulePath).toMatch(/DEFAULT_INDEX_BLOCK/);
    expect(modulePath).toMatch(/from\s+["']\.\/recall-protect["']/);
  });
});

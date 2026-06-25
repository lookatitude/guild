import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/memory-adapter";
import * as moduleImpl from "../../src/modules/context/workflows/memory-adapter";

describe("memory-adapter compatibility shim", () => {
  test("scripts/lib/memory-adapter re-exports src/modules/context", () => {
    expect(shim.selectMemoryTransport).toBe(moduleImpl.selectMemoryTransport);
    expect(shim.queryGuildMemory).toBe(moduleImpl.queryGuildMemory);
  });

  test("legacy path stays a thin public wrapper", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/memory-adapter.ts"), "utf8");
    const modulePath = fs.readFileSync(
      path.join(repoRoot, "src/modules/context/workflows/memory-adapter.ts"),
      "utf8",
    );

    expect(oldPath).toMatch(/src\/modules\/context\/workflows\/memory-adapter/);
    expect(oldPath).not.toMatch(/export\s+function\s+queryGuildMemory/);
    expect(modulePath).toMatch(/export\s+function\s+queryGuildMemory/);
    expect(modulePath).toMatch(/from\s+["']\.\/recall["']/);
    expect(modulePath).toMatch(/from\s+["']\.\.\/\.\.\/state["']/);
  });
});

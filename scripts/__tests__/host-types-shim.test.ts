import * as fs from "node:fs";
import * as path from "node:path";

describe("host-types compatibility shim", () => {
  test("scripts/lib/host-types re-exports the canonical src/modules/host-runtime type", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const shim = fs.readFileSync(path.join(repoRoot, "scripts/lib/host-types.ts"), "utf8");
    const module = fs.readFileSync(path.join(repoRoot, "src/modules/host-runtime/workflows/host-types.ts"), "utf8");

    expect(shim).toMatch(/export\s+type\s+\{\s*HostKind\s*\}\s+from\s+["']\.\.\/\.\.\/src\/modules\/host-runtime\/workflows\/host-types["']/);
    expect(shim).not.toMatch(/export\s+type\s+HostKind\s*=/);
    expect(module).toMatch(/export\s+type\s+HostKind\s*=/);
    expect(module).toMatch(/"claude-ai-connector"/);
  });
});

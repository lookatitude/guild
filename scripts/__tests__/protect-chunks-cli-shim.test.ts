import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/protect-chunks";
import * as moduleImpl from "../../src/modules/context/workflows/protect-chunks-cli";

describe("protect-chunks CLI compatibility shim", () => {
  test("scripts/lib/protect-chunks re-exports src/modules/context CLI implementation", () => {
    expect(shim.runProtectChunksCli).toBe(moduleImpl.runProtectChunksCli);
  });

  test("legacy executable stays a thin wrapper", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/protect-chunks.ts"), "utf8");
    const modulePath = fs.readFileSync(
      path.join(repoRoot, "src/modules/context/workflows/protect-chunks-cli.ts"),
      "utf8"
    );

    expect(oldPath).toMatch(/^#!\/usr\/bin\/env -S npx tsx/);
    expect(oldPath).toMatch(/src\/modules\/context\/workflows\/protect-chunks-cli/);
    expect(oldPath).not.toMatch(/fs\.readFileSync\(0/);
    expect(oldPath).not.toMatch(/JSON\.parse\(rawJson/);
    expect(modulePath).toMatch(/export\s+function\s+runProtectChunksCli/);
    expect(modulePath).toMatch(/fs\.readFileSync\(0/);
    expect(modulePath).toMatch(/callerTool:\s*"protect-chunks"/);
  });
});

import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/fs-scanner";
import * as moduleImpl from "../../src/modules/context/workflows/fs-scanner";

describe("fs-scanner compatibility shim", () => {
  test("scripts/lib/fs-scanner re-exports src/modules/context", () => {
    expect(shim.fsScan).toBe(moduleImpl.fsScan);
    expect(shim.runFsScannerCli).toBe(moduleImpl.runFsScannerCli);
  });

  test("legacy path stays a thin public and CLI wrapper", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/fs-scanner.ts"), "utf8");
    const modulePath = fs.readFileSync(
      path.join(repoRoot, "src/modules/context/workflows/fs-scanner.ts"),
      "utf8",
    );

    expect(oldPath).toMatch(/src\/modules\/context\/workflows\/fs-scanner/);
    expect(oldPath).not.toMatch(/export\s+function\s+fsScan/);
    expect(oldPath).toMatch(/runFsScannerCli\(\)/);
    expect(modulePath).toMatch(/export\s+function\s+fsScan/);
    expect(modulePath).toMatch(/export\s+function\s+runFsScannerCli/);
  });
});

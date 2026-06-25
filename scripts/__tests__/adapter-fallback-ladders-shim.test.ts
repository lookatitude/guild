import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/adapter-fallback-ladders";
import * as moduleImpl from "../../src/modules/host-runtime/workflows/adapter-fallback-ladders";

describe("adapter-fallback-ladders compatibility shim", () => {
  test("scripts/lib/adapter-fallback-ladders re-exports src/modules/host-runtime", () => {
    expect(shim.RUNGS).toBe(moduleImpl.RUNGS);
    expect(shim.ADAPTER_SURFACES).toBe(moduleImpl.ADAPTER_SURFACES);
    expect(shim.FALLBACK_LADDER_TABLE).toBe(moduleImpl.FALLBACK_LADDER_TABLE);
    expect(shim.INFERRED_HOSTS).toBe(moduleImpl.INFERRED_HOSTS);
    expect(shim.rungLoss).toBe(moduleImpl.rungLoss);
    expect(shim.isInferredRung).toBe(moduleImpl.isInferredRung);
    expect(shim.resolveRung).toBe(moduleImpl.resolveRung);
    expect(shim.validateDegradationReceipt).toBe(moduleImpl.validateDegradationReceipt);
    expect(shim.validateLadderTableComplete).toBe(moduleImpl.validateLadderTableComplete);
  });

  test("preserves fallback ladder behavior through the shim", () => {
    expect(shim.validateLadderTableComplete()).toEqual({ valid: true, errors: [] });
    expect(shim.resolveRung("interaction", "claude-code-cli").rung).toBe("native");
    expect(shim.resolveRung("browser", "agents-file")).toMatchObject({
      rung: "degraded",
      degraded: true,
      inferred: true,
    });
    expect(shim.resolveRung("interaction", "unknown-host")).toMatchObject({
      rung: "degraded",
      degraded: true,
      inferred: false,
    });
  });

  test("only the module file defines the fallback ladder table", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/adapter-fallback-ladders.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/host-runtime/workflows/adapter-fallback-ladders.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/host-runtime\/workflows\/adapter-fallback-ladders["']/);
    expect(oldPath).not.toMatch(/export\s+const\s+FALLBACK_LADDER_TABLE/);
    expect(modulePath).toMatch(/export\s+const\s+FALLBACK_LADDER_TABLE/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-registry-schema["']/);
  });
});

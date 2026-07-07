import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/runtime-adapters";
import * as moduleImpl from "../../src/modules/host-runtime/workflows/runtime-adapters";

describe("runtime-adapters compatibility shim", () => {
  test("scripts/lib/runtime-adapters re-exports src/modules/host-runtime", () => {
    expect(shim.RUNTIME_ADAPTERS).toBe(moduleImpl.RUNTIME_ADAPTERS);
    expect(shim.resolveAdapter).toBe(moduleImpl.resolveAdapter);
    expect(shim.resolveAllAdapters).toBe(moduleImpl.resolveAllAdapters);
    expect(shim.DegradationRecorder).toBe(moduleImpl.DegradationRecorder);
  });

  test("preserves runtime adapter behavior through the shim", () => {
    const rec = new shim.DegradationRecorder();
    const resolved = shim.resolveAllAdapters("codex-cli", rec);
    expect(Object.keys(resolved).sort()).toEqual(["browser", "interaction", "semantic_tool", "session"]);
    expect(resolved.interaction.rung).toBe("wrapped");
    expect(rec.all()).toHaveLength(4);
    expect(rec.degraded()).toHaveLength(4);
    expect(rec.inferred()).toHaveLength(0);
  });

  test("only the module file defines runtime adapter resolution", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/runtime-adapters.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/host-runtime/workflows/runtime-adapters.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/host-runtime\/workflows\/runtime-adapters["']/);
    expect(oldPath).not.toMatch(/export\s+const\s+RUNTIME_ADAPTERS/);
    expect(modulePath).toMatch(/export\s+const\s+RUNTIME_ADAPTERS/);
    expect(modulePath).toMatch(/from\s+["']\.\/adapter-fallback-ladders["']/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-registry-schema["']/);
  });
});

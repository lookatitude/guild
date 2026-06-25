import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/host-adapter-contract";
import * as moduleImpl from "../../src/modules/host-runtime/workflows/host-adapter-contract";

describe("host-adapter-contract compatibility shim", () => {
  test("scripts/lib/host-adapter-contract re-exports src/modules/host-runtime", () => {
    expect(shim.HOST_ADAPTER_OPERATIONS).toBe(moduleImpl.HOST_ADAPTER_OPERATIONS);
    expect(shim.createHostAdapter).toBe(moduleImpl.createHostAdapter);
    expect(shim.createAllHostAdapters).toBe(moduleImpl.createAllHostAdapters);
  });

  test("preserves default host adapter behavior through the shim", () => {
    expect(shim.createHostAdapter("claude").hostId).toBe("claude-code-cli");
    expect(shim.createHostAdapter("unknown-host").dispatch({ taskRun: { id: "x" } })).toMatchObject({
      schema_version: "guild.host_adapter_result.v1",
      status: "unavailable",
      receipt: {
        schema_version: "guild.host_adapter_receipt.v1",
        degradation_receipt: { rung: "degraded" },
      },
    });
    expect(Object.keys(shim.createAllHostAdapters()).sort()).toEqual([
      "agents-file",
      "antigravity-cli",
      "claude-ai-connector",
      "claude-code-app",
      "claude-code-cli",
      "claude-code-web",
      "codex-app",
      "codex-cli",
      "pi-cli",
    ]);
  });

  test("only the module file defines the default host adapter contract", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/host-adapter-contract.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/host-runtime/workflows/host-adapter-contract.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/host-runtime\/workflows\/host-adapter-contract["']/);
    expect(oldPath).not.toMatch(/export\s+function\s+createHostAdapter/);
    expect(modulePath).toMatch(/export\s+function\s+createHostAdapter/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-registry-schema["']/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-id-namespace["']/);
    expect(modulePath).toMatch(/from\s+["']\.\/adapter-fallback-ladders["']/);
  });
});

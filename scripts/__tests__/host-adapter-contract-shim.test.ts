import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/host-adapter-contract";
import * as moduleImpl from "../../src/modules/host-runtime/workflows/host-adapter-contract";
import { createHostAdapter as createRoutedHostAdapter } from "../lib/host-adapter-factory";

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
      "cursor",
      "github-copilot",
      "kiro",
      "opencode",
      "pi-cli",
      "qoder",
      "rovo-dev",
      "trae",
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

// L0 ADR §3.1 / codex C-B2: the REAL factory MUST dereference adapter_binding:"agents-file"
// (the IDE file-surface rows) to the universal agents-file adapter BEFORE the default
// fail-closed fallback — otherwise kiro/qoder/trae mis-route to a degraded default adapter.
describe("host-adapter-factory adapter_binding dereference (IDE rows → agents-file)", () => {
  const agentsFile = createRoutedHostAdapter("agents-file");

  for (const ide of ["kiro", "qoder", "trae"] as const) {
    test(`createHostAdapter("${ide}") returns the agents-file adapter, not the default`, () => {
      const a = createRoutedHostAdapter(ide);
      // Same identity as the agents-file adapter (NOT the default, which would stamp the
      // IDE's own id — proving the factory branched on adapter_binding, not fell through).
      expect(a.hostId).toBe("agents-file");
      expect(a.hostId).toBe(agentsFile.hostId);
      expect(a.hostId).not.toBe(ide);
    });
  }

  test("a genuinely unknown id still falls through to the default (branch is registry-keyed)", () => {
    // Anti-vacuity: the dereference is keyed on the registry adapter_binding, not a blanket
    // catch — an id with no "agents-file"-bound registry row must NOT become agents-file.
    expect(createRoutedHostAdapter("totally-unknown").hostId).not.toBe("agents-file");
  });
});

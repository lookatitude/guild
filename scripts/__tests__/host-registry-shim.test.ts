import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/host-registry";
import * as moduleImpl from "../../src/modules/host-runtime/workflows/host-registry";

describe("host-registry compatibility shim", () => {
  test("scripts/lib/host-registry re-exports src/modules/host-runtime", () => {
    expect(shim.HOST_IDS).toBe(moduleImpl.HOST_IDS);
    expect(shim.HOST_REGISTRY_ROWS).toBe(moduleImpl.HOST_REGISTRY_ROWS);
    expect(shim.HOSTKIND_TO_REGISTRY_ID).toBe(moduleImpl.HOSTKIND_TO_REGISTRY_ID);
    expect(shim.hostKindToRegistryId).toBe(moduleImpl.hostKindToRegistryId);
    expect(shim.registryIdToCanonicalHostKind).toBe(moduleImpl.registryIdToCanonicalHostKind);
    expect(shim.isDroppedHostKind).toBe(moduleImpl.isDroppedHostKind);
    expect(shim.getRegistryEntry).toBe(moduleImpl.getRegistryEntry);
    expect(shim.getRegistryEntryForHostKind).toBe(moduleImpl.getRegistryEntryForHostKind);
    expect(shim.resultAdapterForFamily).toBe(moduleImpl.resultAdapterForFamily);
    expect(shim.resultAdapterForHostId).toBe(moduleImpl.resultAdapterForHostId);
    expect(shim.resultAdapterForHostKind).toBe(moduleImpl.resultAdapterForHostKind);
    expect(shim.dispatchSelectableForHostId).toBe(moduleImpl.dispatchSelectableForHostId);
    expect(shim.installabilityForHostId).toBe(moduleImpl.installabilityForHostId);
  });

  test("preserves runtime registry behavior through the shim", () => {
    expect(shim.getRegistryEntry("codex-cli")?.family).toBe("codex");
    expect(shim.getRegistryEntryForHostKind("antigravity-2")?.host_id).toBe("antigravity-cli");
    expect(shim.getRegistryEntryForHostKind("gemini")).toBeNull();
    expect(shim.resultAdapterForFamily("codex")).toBe(true);
    expect(shim.resultAdapterForFamily("claude")).toBe(false);
    // gap-audit C-agents-file: flipped from true — a pane-less file surface is not a
    // dispatch destination. `codex-cli` keeps this assertion non-vacuous by pinning a
    // genuine true alongside the false.
    expect(shim.dispatchSelectableForHostId("codex-cli")).toBe(true);
    expect(shim.dispatchSelectableForHostId("agents-file")).toBe(false);
    expect(shim.dispatchSelectableForHostId("unknown")).toBe(false);
    expect(shim.installabilityForHostId("unknown")).toBe("none");
  });

  test("only the module file defines the runtime registry accessors", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/host-registry.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/host-runtime/workflows/host-registry.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/host-runtime\/workflows\/host-registry["']/);
    expect(oldPath).not.toMatch(/export\s+function\s+getRegistryEntry/);
    expect(modulePath).toMatch(/export\s+function\s+getRegistryEntry/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-registry-schema["']/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-id-namespace["']/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-types["']/);
  });
});

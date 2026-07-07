import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/host-id-namespace";
import * as moduleImpl from "../../src/modules/host-runtime/workflows/host-id-namespace";

describe("host-id-namespace compatibility shim", () => {
  test("scripts/lib/host-id-namespace re-exports src/modules/host-runtime", () => {
    expect(shim.HOSTKIND_TO_REGISTRY_ID).toBe(moduleImpl.HOSTKIND_TO_REGISTRY_ID);
    expect(shim.LEGACY_HOST_ALIASES).toBe(moduleImpl.LEGACY_HOST_ALIASES);
    expect(shim.hostKindToRegistryId).toBe(moduleImpl.hostKindToRegistryId);
    expect(shim.normalizeHostId).toBe(moduleImpl.normalizeHostId);
    expect(shim.registryIdToCanonicalHostKind).toBe(moduleImpl.registryIdToCanonicalHostKind);
    expect(shim.isDroppedHostKind).toBe(moduleImpl.isDroppedHostKind);
  });

  test("preserves namespace bridge behavior through the shim", () => {
    expect(shim.hostKindToRegistryId("claude")).toBe("claude-code-cli");
    expect(shim.hostKindToRegistryId("antigravity-2")).toBe("antigravity-cli");
    expect(shim.hostKindToRegistryId("gemini")).toBeNull();
    expect(shim.normalizeHostId(".agents")).toBe("agents-file");
    expect(shim.registryIdToCanonicalHostKind("agents-file")).toBeNull();
  });

  test("only the module file defines the namespace bridge body", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/host-id-namespace.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/host-runtime/workflows/host-id-namespace.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/host-runtime\/workflows\/host-id-namespace["']/);
    expect(oldPath).not.toMatch(/export\s+const\s+HOSTKIND_TO_REGISTRY_ID/);
    expect(modulePath).toMatch(/export\s+const\s+HOSTKIND_TO_REGISTRY_ID/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-types["']/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-registry-schema["']/);
  });
});

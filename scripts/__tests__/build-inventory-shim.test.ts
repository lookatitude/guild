import * as shim from "../build-inventory";
import * as moduleImpl from "../../src/modules/distribution/workflows/build-inventory";

describe("build-inventory compatibility shim", () => {
  test("scripts/build-inventory re-exports src/modules/distribution", () => {
    expect(shim.PLUGIN_ROOT).toBe(moduleImpl.PLUGIN_ROOT);
    expect(shim.UNSTAMPED_GENERATED_AT).toBe(moduleImpl.UNSTAMPED_GENERATED_AT);
    expect(shim.discoverSurfaces).toBe(moduleImpl.discoverSurfaces);
    expect(shim.buildInventory).toBe(moduleImpl.buildInventory);
    expect(shim.serializeInventory).toBe(moduleImpl.serializeInventory);
    expect(shim.parseArgs).toBe(moduleImpl.parseArgs);
  });
});

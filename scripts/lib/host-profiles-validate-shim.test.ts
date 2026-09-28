import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "./host-profiles-validate";
import * as moduleImpl from "../../src/domains/config/index";

describe("host-profiles-validate compatibility shim", () => {
  test("scripts/lib/host-profiles-validate re-exports src/modules/host-runtime", () => {
    expect(shim.VALID_HOST_PROFILE_ENTRY_KEYS).toBe(moduleImpl.VALID_HOST_PROFILE_ENTRY_KEYS);
    expect(shim.VALID_HOST_PROFILE_MODEL_KEYS).toBe(moduleImpl.VALID_HOST_PROFILE_MODEL_KEYS);
    expect(shim.validateHostProfiles).toBe(moduleImpl.validateHostProfiles);
    expect(shim.filterHostProfiles).toBe(moduleImpl.filterHostProfiles);
  });

  test("preserves host_profiles validation behavior through the shim", () => {
    expect(
      shim.validateHostProfiles({
        "codex-cli": { enabled: true, models: { cheap: "gpt-5-mini", mid: "gpt-5" } },
      })
    ).toEqual([]);
    expect(shim.validateHostProfiles({ nope: { enabled: true } })[0]).toContain("unknown host_profiles host_id");
    expect(shim.validateHostProfiles({ "codex-cli": { bogus: true } })[0]).toContain("unknown host_profiles");
    expect(
      shim.filterHostProfiles({
        codex: { enabled: true },
        nope: { enabled: true },
      })
    ).toEqual({ "codex-cli": { enabled: true } });
  });

  test("only the module file defines host profile validation", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/host-profiles-validate.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/domains/config/host-profiles-validate.ts"), "utf8");

    expect(oldPath).toMatch(/from\s+["']\.\.\/\.\.\/src\/domains\/config\/index["']/);
    expect(oldPath).not.toMatch(/export\s+function\s+validateHostProfiles/);
    expect(modulePath).toMatch(/export\s+function\s+validateHostProfiles/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-registry-schema["']/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-id-namespace["']/);
  });
});

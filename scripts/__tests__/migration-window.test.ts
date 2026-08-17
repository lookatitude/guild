import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { advanceMigrationWindow, evaluateMigrationAdvance, legacyRemovalEligibility, recordMigrationRelease, startMigrationWindow } from "../lib/capability/migration-window";
import { readFeatureGateRegistry } from "../lib/capability/strangler-control";

describe("D03 production migration window", () => {
  it("requires three releases, fourteen days, and conformance before advancing", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-window-"));
    try {
      let window = startMigrationWindow({ projectRoot: root, mode: "observe", release: "2.6.0", recordedAt: "2026-08-01T00:00:00Z", actor: "operator" });
      window = recordMigrationRelease({ projectRoot: root, release: "2.6.1", recordedAt: "2026-08-07T00:00:00Z" });
      expect(evaluateMigrationAdvance(window, "shadow", "2026-08-15T00:00:00Z", true).passed).toBe(false);
      window = recordMigrationRelease({ projectRoot: root, release: "2.6.2", recordedAt: "2026-08-14T00:00:00Z" });
      expect(evaluateMigrationAdvance(window, "shadow", "2026-08-15T00:00:00Z", false).blockers).toContain("conformance gate has not passed");
      expect(advanceMigrationWindow({ projectRoot: root, to: "shadow", release: "2.7.0", recordedAt: "2026-08-15T00:00:00Z", actor: "operator", conformancePassed: true }).status).toBe("advanced");
      expect(readFeatureGateRegistry(root)?.resolver_mode).toBe("shadow");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("never clears v2 and enforces both G5 and the two-minor floor", () => {
    expect(legacyRemovalEligibility({ projectLocalDefault: "2.7.0", currentVersion: "2.9.0", g5Passed: true }).passed).toBe(false);
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.1.0", currentVersion: "3.2.0", g5Passed: true }).passed).toBe(false);
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.1.0", currentVersion: "3.3.0", g5Passed: false }).passed).toBe(false);
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.1.0", currentVersion: "3.3.0", g5Passed: true }).passed).toBe(true);
    expect(legacyRemovalEligibility({ projectLocalDefault: "4.1.0", currentVersion: "3.0.0", g5Passed: true }).blockers).toContain("current version predates the project-local default");
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.1.0", currentVersion: "3.3.0-beta.1", g5Passed: true }).blockers).toContain("removal-floor versions must be stable semantic versions");
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.1.0-beta.1", currentVersion: "3.3.0", g5Passed: true }).blockers).toContain("removal-floor versions must be stable semantic versions");
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.9.0", currentVersion: "4.0.0", g5Passed: true }).passed).toBe(true);
  });
});

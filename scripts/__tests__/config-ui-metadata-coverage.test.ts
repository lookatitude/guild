/**
 * scripts/__tests__/config-ui-metadata-coverage.test.ts
 *
 * init-config-goal §E10 / V9 — CONFIG_UI_METADATA coverage + the safety-class
 * sign-off (L3 security-auditor). Every flattened CONFIG_SCHEMA key must have full UI
 * metadata; confirmation_strength must be >= default_for(safety_class) (raise-only,
 * spec line 174/176); every schema-security_sensitive key must require `strongest`.
 *
 * Anti-vacuity: the L3-RAISED keys are asserted against an INDEPENDENT expectation,
 * so silently lowering one back below security_sensitive fails this test.
 */

import {
  CONFIG_UI_METADATA,
  verifyMetadataCoverage,
  DEFAULT_CONFIRMATION_FOR_SAFETY_CLASS,
} from "../lib/config-ui-metadata";
import { CONFIG_SCHEMA } from "../lib/config-schema";

describe("CONFIG_UI_METADATA coverage (V9)", () => {
  it("covers every CONFIG_SCHEMA key with no extras and no confirmation-floor violations", () => {
    const report = verifyMetadataCoverage();
    expect(report.missing).toEqual([]);
    expect(report.extra).toEqual([]);
    expect(report.confirmationViolations).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("has metadata for all 109 schema keys", () => {
    expect(CONFIG_SCHEMA.length).toBe(109);
    expect(Object.keys(CONFIG_UI_METADATA).length).toBe(109);
  });

  it("every key declares all required UI fields", () => {
    for (const [key, m] of Object.entries(CONFIG_UI_METADATA)) {
      expect(typeof m.group).toBe("string");
      expect(typeof m.label).toBe("string");
      expect(typeof m.control).toBe("string");
      expect(Array.isArray(m.scope_support)).toBe(true);
      expect(m.host_visibility).toBeDefined();
      expect(typeof m.editability).toBe("string");
      expect(typeof m.safety_class).toBe("string");
      expect(typeof m.confirmation_strength).toBe("string");
      expect(typeof m.native_component_map).toBe("object");
      expect(typeof m.deprecated).toBe("boolean");
      // Raise-only floor (V9).
      const floor = DEFAULT_CONFIRMATION_FOR_SAFETY_CLASS[m.safety_class];
      expect(floor).toBeDefined();
    }
  });

  it("every schema-security_sensitive key requires `strongest` confirmation", () => {
    const secSensitive = CONFIG_SCHEMA.filter((s) => s.security_sensitive).map((s) => s.key);
    expect(secSensitive.length).toBeGreaterThan(0);
    for (const key of secSensitive) {
      const m = CONFIG_UI_METADATA[key];
      expect(m).toBeDefined();
      expect(m.confirmation_strength).toBe("strongest");
    }
  });

  // L3 sign-off (RAISE-ONLY) — independent oracle of the 5 decision points.
  it("L3 RAISED the conservative keys to security_sensitive (strongest)", () => {
    for (const key of [
      "defaults.allowed_tools",
      "mcp.bridge_package",
      "mcp.stdio_available",
      "mcp.http_available",
    ]) {
      const m = CONFIG_UI_METADATA[key];
      expect(m.safety_class).toBe("security_sensitive");
      expect(m.confirmation_strength).toBe("strongest");
    }
  });

  it("L3 CONFIRMED agent_mode/host=advanced and review/adversarial=dangerous (not over-raised)", () => {
    expect(CONFIG_UI_METADATA["agent_mode"].safety_class).toBe("advanced");
    expect(CONFIG_UI_METADATA["host"].safety_class).toBe("advanced");
    expect(CONFIG_UI_METADATA["review"].safety_class).toBe("dangerous");
    expect(CONFIG_UI_METADATA["review"].confirmation_strength).toBe("danger");
    expect(CONFIG_UI_METADATA["defaults.adversarial"].safety_class).toBe("dangerous");
  });

  it("secrets are redacted (replace_only) and never echo", () => {
    const secret = CONFIG_UI_METADATA["secrets_policy.redaction_patterns"];
    expect(secret.safety_class).toBe("secret");
    expect(secret.editability).toBe("replace_only");
    expect(secret.confirmation_strength).toBe("strongest");
  });
});

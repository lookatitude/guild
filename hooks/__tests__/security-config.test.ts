/**
 * hooks/__tests__/security-config.test.ts
 *
 * Unit tests for the security-config reader (hooks/lib/security/config.ts).
 * Confirms it mirrors the canonical DEFAULTS (src/domains/config/config-defaults.ts),
 * merges partial blocks, tolerates malformed input, and never throws. Default
 * values are read from DEFAULTS, never restated here (G06 R5).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  parseSecurityConfig,
  readSecurityConfig,
  securityDefaults,
} from "../lib/security/config";
import { DEFAULTS } from "../../src/domains/config/index";

/** The SecurityConfig the canonical DEFAULTS tree describes. */
const CANON = {
  bypass_permissions_policy: DEFAULTS.security.bypass_permissions_policy,
  secrets_policy: {
    env_allowlist: [...DEFAULTS.secrets_policy.env_allowlist],
    redaction_patterns: [...DEFAULTS.secrets_policy.redaction_patterns],
    fail_mode_durable: DEFAULTS.secrets_policy.fail_mode_durable,
    fail_mode_telemetry: DEFAULTS.secrets_policy.fail_mode_telemetry,
  },
  tool_description_hashes: { ...DEFAULTS.mcp.tool_description_hashes },
  mcp_availability: {
    stdio_available: DEFAULTS.mcp.stdio_available,
    http_available: DEFAULTS.mcp.http_available,
    bridge_package: DEFAULTS.mcp.bridge_package,
  },
  allowed_tools: [...DEFAULTS.defaults.allowed_tools],
};

describe("securityDefaults", () => {
  it("parity: equals the canonical DEFAULTS security/secrets_policy/mcp/defaults.allowed_tools", () => {
    expect(securityDefaults()).toEqual(CANON);
  });

  it("parity is not vacuous: a one-field drift from DEFAULTS is detected", () => {
    const drifted = { ...securityDefaults(), bypass_permissions_policy: "deny" as const };
    expect(drifted).not.toEqual(CANON);
    const driftedMcp = securityDefaults();
    driftedMcp.mcp_availability.http_available = !CANON.mcp_availability.http_available;
    expect(driftedMcp).not.toEqual(CANON);
  });

  it("mcp_availability defaults come from DEFAULTS.mcp (R-019)", () => {
    expect(securityDefaults().mcp_availability).toEqual(CANON.mcp_availability);
  });

  it("returns a fresh object (no shared mutation)", () => {
    const a = securityDefaults();
    a.secrets_policy.redaction_patterns.push("x");
    expect(securityDefaults().secrets_policy.redaction_patterns).toEqual(CANON.secrets_policy.redaction_patterns);
  });
});

describe("parseSecurityConfig", () => {
  it("returns defaults for non-object input", () => {
    expect(parseSecurityConfig(null)).toEqual(CANON);
    expect(parseSecurityConfig("nope")).toEqual(CANON);
    expect(parseSecurityConfig(42)).toEqual(CANON);
  });

  it("merges a full security/secrets_policy/mcp block", () => {
    const cfg = parseSecurityConfig({
      security: { bypass_permissions_policy: "deny" },
      secrets_policy: {
        env_allowlist: ["HOME", "PATH"],
        redaction_patterns: ["foo\\d+"],
        fail_mode_durable: "open",
        fail_mode_telemetry: "closed",
      },
      mcp: { tool_description_hashes: { "mcp__x__y": "abc123" } },
    });
    expect(cfg.bypass_permissions_policy).toBe("deny");
    expect(cfg.secrets_policy.env_allowlist).toEqual(["HOME", "PATH"]);
    expect(cfg.secrets_policy.redaction_patterns).toEqual(["foo\\d+"]);
    expect(cfg.secrets_policy.fail_mode_durable).toBe("open");
    expect(cfg.secrets_policy.fail_mode_telemetry).toBe("closed");
    expect(cfg.tool_description_hashes).toEqual({ "mcp__x__y": "abc123" });
  });

  it("parses mcp_availability sub-keys (R-019 / FDC-13)", () => {
    const cfg = parseSecurityConfig({
      mcp: {
        tool_description_hashes: { "mcp__a__b": "deadbeef" },
        stdio_available: false,
        http_available: true,
        bridge_package: "guild-pi-mcp",
      },
    });
    expect(cfg.tool_description_hashes).toEqual({ "mcp__a__b": "deadbeef" });
    expect(cfg.mcp_availability.stdio_available).toBe(false);
    expect(cfg.mcp_availability.http_available).toBe(true);
    expect(cfg.mcp_availability.bridge_package).toBe("guild-pi-mcp");
  });

  it("mcp_availability falls back to defaults for missing / mistyped values", () => {
    // No mcp block at all → defaults.
    const none = parseSecurityConfig({});
    expect(none.mcp_availability).toEqual(CANON.mcp_availability);

    // mcp block present but availability keys mistyped → defaults preserved.
    const bad = parseSecurityConfig({
      mcp: { stdio_available: "yes", http_available: 1, bridge_package: 42 },
    });
    expect(bad.mcp_availability).toEqual(CANON.mcp_availability);
  });

  it("accepts null bridge_package explicitly (R-019)", () => {
    const cfg = parseSecurityConfig({ mcp: { bridge_package: null } });
    expect(cfg.mcp_availability.bridge_package).toBeNull();
  });

  it("parses defaults.allowed_tools as the scope baseline (R-020)", () => {
    const cfg = parseSecurityConfig({ defaults: { allowed_tools: ["Read", "Glob"] } });
    expect(cfg.allowed_tools).toEqual(["Read", "Glob"]);
  });

  it("allowed_tools defaults to [] when absent or mistyped (R-020)", () => {
    expect(parseSecurityConfig({}).allowed_tools).toEqual(CANON.allowed_tools);
    expect(parseSecurityConfig({ defaults: { allowed_tools: "Read" } }).allowed_tools).toEqual(CANON.allowed_tools);
    expect(parseSecurityConfig({ defaults: {} }).allowed_tools).toEqual(CANON.allowed_tools);
  });

  it("ignores invalid enum values and falls back to defaults", () => {
    const cfg = parseSecurityConfig({
      security: { bypass_permissions_policy: "yolo" },
      secrets_policy: { fail_mode_durable: "maybe", env_allowlist: "notarray" },
      mcp: { tool_description_hashes: { good: "h", bad: 123 } },
    });
    expect(cfg.bypass_permissions_policy).toBe(CANON.bypass_permissions_policy);
    expect(cfg.secrets_policy.fail_mode_durable).toBe(CANON.secrets_policy.fail_mode_durable);
    expect(cfg.secrets_policy.env_allowlist).toEqual(CANON.secrets_policy.env_allowlist);
    // non-string hash dropped; string hash kept
    expect(cfg.tool_description_hashes).toEqual({ good: "h" });
  });
});

describe("readSecurityConfig", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-seccfg-"));
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true }); // anchor for resolveGuildRoot
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("returns defaults when settings.json is missing", () => {
    expect(readSecurityConfig(tmp)).toEqual(CANON);
  });

  it("returns defaults when settings.json is malformed JSON", () => {
    fs.mkdirSync(path.join(tmp, ".guild"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".guild", "settings.json"), "{ not json", "utf8");
    expect(readSecurityConfig(tmp)).toEqual(CANON);
  });

  it("reads the security blocks from .guild/settings.json", () => {
    fs.mkdirSync(path.join(tmp, ".guild"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".guild", "settings.json"),
      JSON.stringify({ security: { bypass_permissions_policy: "allow" } }),
      "utf8",
    );
    expect(readSecurityConfig(tmp).bypass_permissions_policy).toBe("allow");
  });
});

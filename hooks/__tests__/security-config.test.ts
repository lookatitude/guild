/**
 * hooks/__tests__/security-config.test.ts
 *
 * Unit tests for the security-config reader (hooks/lib/security/config.ts).
 * Confirms it mirrors scripts/read-guild-config.ts DEFAULTS, merges partial
 * blocks, tolerates malformed input, and never throws.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  parseSecurityConfig,
  readSecurityConfig,
  securityDefaults,
} from "../lib/security/config";

describe("securityDefaults", () => {
  it("mirrors read-guild-config DEFAULTS (audit / closed+open / empty)", () => {
    const d = securityDefaults();
    expect(d.bypass_permissions_policy).toBe("audit");
    expect(d.secrets_policy.env_allowlist).toEqual([]);
    expect(d.secrets_policy.redaction_patterns).toEqual([]);
    expect(d.secrets_policy.fail_mode_durable).toBe("closed");
    expect(d.secrets_policy.fail_mode_telemetry).toBe("open");
    expect(d.tool_description_hashes).toEqual({});
  });

  it("mcp_availability defaults: stdio=true, http=false, bridge=null (R-019)", () => {
    const d = securityDefaults();
    expect(d.mcp_availability.stdio_available).toBe(true);
    expect(d.mcp_availability.http_available).toBe(false);
    expect(d.mcp_availability.bridge_package).toBeNull();
  });

  it("returns a fresh object (no shared mutation)", () => {
    const a = securityDefaults();
    a.secrets_policy.redaction_patterns.push("x");
    expect(securityDefaults().secrets_policy.redaction_patterns).toEqual([]);
  });
});

describe("parseSecurityConfig", () => {
  it("returns defaults for non-object input", () => {
    expect(parseSecurityConfig(null).bypass_permissions_policy).toBe("audit");
    expect(parseSecurityConfig("nope").tool_description_hashes).toEqual({});
    expect(parseSecurityConfig(42).secrets_policy.fail_mode_durable).toBe("closed");
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
    expect(none.mcp_availability.stdio_available).toBe(true);
    expect(none.mcp_availability.http_available).toBe(false);
    expect(none.mcp_availability.bridge_package).toBeNull();

    // mcp block present but availability keys mistyped → defaults preserved.
    const bad = parseSecurityConfig({
      mcp: { stdio_available: "yes", http_available: 1, bridge_package: 42 },
    });
    expect(bad.mcp_availability.stdio_available).toBe(true);
    expect(bad.mcp_availability.http_available).toBe(false);
    expect(bad.mcp_availability.bridge_package).toBeNull();
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
    expect(parseSecurityConfig({}).allowed_tools).toEqual([]);
    expect(parseSecurityConfig({ defaults: { allowed_tools: "Read" } }).allowed_tools).toEqual([]);
    expect(parseSecurityConfig({ defaults: {} }).allowed_tools).toEqual([]);
  });

  it("ignores invalid enum values and falls back to defaults", () => {
    const cfg = parseSecurityConfig({
      security: { bypass_permissions_policy: "yolo" },
      secrets_policy: { fail_mode_durable: "maybe", env_allowlist: "notarray" },
      mcp: { tool_description_hashes: { good: "h", bad: 123 } },
    });
    expect(cfg.bypass_permissions_policy).toBe("audit");
    expect(cfg.secrets_policy.fail_mode_durable).toBe("closed");
    expect(cfg.secrets_policy.env_allowlist).toEqual([]);
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
    expect(readSecurityConfig(tmp).bypass_permissions_policy).toBe("audit");
  });

  it("returns defaults when settings.json is malformed JSON", () => {
    fs.mkdirSync(path.join(tmp, ".guild"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".guild", "settings.json"), "{ not json", "utf8");
    expect(readSecurityConfig(tmp).tool_description_hashes).toEqual({});
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

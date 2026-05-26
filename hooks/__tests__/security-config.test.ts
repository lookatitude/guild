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

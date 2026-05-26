/**
 * hooks/lib/security/config.ts
 *
 * Minimal reader for the SECURITY-relevant config sub-blocks the PreToolUse
 * enforcement + telemetry-redaction hooks need at tool-call time.
 *
 * ── BIND BY POINTER ────────────────────────────────────────────────────────
 * The canonical schema, defaults, and the ONLY closed-key VALIDATOR for these
 * three blocks live in `scripts/read-guild-config.ts`:
 *   - interfaces  SecurityBlock / SecretsPolicyBlock / McpBlock
 *   - DEFAULTS.security / DEFAULTS.secrets_policy / DEFAULTS.mcp
 *   - validateSecurity / validateSecretsPolicy / validateMcp
 * That CLI is the single source of truth. This reader does NOT re-validate or
 * re-spell the closed-key sets — a PreToolUse hook fires on EVERY tool call and
 * must not shell out to the CLI each time. It reads the three blocks directly
 * from `.guild/settings.json` with the SAME documented defaults so a policy
 * decision can be made cheaply and without throwing.
 *
 * Decisions (canonical: docs/knowledge/decisions/v2-security-and-untrusted-content.md):
 *   D-BYPASS  → security.bypass_permissions_policy   (deny|audit|allow, default "audit")
 *   D-SECRETS → secrets_policy.{env_allowlist,redaction_patterns,fail_mode_durable,fail_mode_telemetry}
 *   D-MCP     → mcp.tool_description_hashes           (tool-name → SHA-256, PI-6 description pinning)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGuildRoot } from "../guild-root.js";

export type BypassPolicy = "deny" | "audit" | "allow";
export type FailModeDurable = "closed" | "open";
export type FailModeTelemetry = "open" | "closed";

export interface SecretsPolicy {
  env_allowlist: string[];
  redaction_patterns: string[];
  fail_mode_durable: FailModeDurable;
  fail_mode_telemetry: FailModeTelemetry;
}

export interface SecurityConfig {
  bypass_permissions_policy: BypassPolicy;
  secrets_policy: SecretsPolicy;
  /** tool-name → pinned SHA-256 hash of the tool description. */
  tool_description_hashes: Record<string, string>;
}

/**
 * Documented defaults. MUST mirror `scripts/read-guild-config.ts` DEFAULTS
 * (DEFAULTS.security / .secrets_policy / .mcp). Kept as a factory so callers
 * can never mutate a shared object.
 */
export function securityDefaults(): SecurityConfig {
  return {
    bypass_permissions_policy: "audit",
    secrets_policy: {
      env_allowlist: [],
      redaction_patterns: [],
      fail_mode_durable: "closed",
      fail_mode_telemetry: "open",
    },
    tool_description_hashes: {},
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Parse a raw settings object into a SecurityConfig, merging over the
 * documented defaults. Unknown / mistyped values fall back to the default
 * silently (the CLI owns user-facing closed-key rejection — this reader is a
 * tolerant runtime consumer, NOT the validator).
 */
export function parseSecurityConfig(parsed: unknown): SecurityConfig {
  const out = securityDefaults();
  if (!isPlainObject(parsed)) return out;

  // security.bypass_permissions_policy (D-BYPASS)
  if (isPlainObject(parsed["security"])) {
    const bpp = parsed["security"]["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") {
      out.bypass_permissions_policy = bpp;
    }
  }

  // secrets_policy.* (D-SECRETS)
  if (isPlainObject(parsed["secrets_policy"])) {
    const sp = parsed["secrets_policy"];
    if (isStringArray(sp["env_allowlist"])) out.secrets_policy.env_allowlist = sp["env_allowlist"];
    if (isStringArray(sp["redaction_patterns"])) {
      out.secrets_policy.redaction_patterns = sp["redaction_patterns"];
    }
    if (sp["fail_mode_durable"] === "closed" || sp["fail_mode_durable"] === "open") {
      out.secrets_policy.fail_mode_durable = sp["fail_mode_durable"];
    }
    if (sp["fail_mode_telemetry"] === "open" || sp["fail_mode_telemetry"] === "closed") {
      out.secrets_policy.fail_mode_telemetry = sp["fail_mode_telemetry"];
    }
  }

  // mcp.tool_description_hashes (D-MCP / PI-6)
  if (isPlainObject(parsed["mcp"]) && isPlainObject(parsed["mcp"]["tool_description_hashes"])) {
    const hashes: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed["mcp"]["tool_description_hashes"])) {
      if (typeof v === "string") hashes[k] = v;
    }
    out.tool_description_hashes = hashes;
  }

  return out;
}

/**
 * Read `<root>/.guild/settings.json` (root resolved via resolveGuildRoot) and
 * return the SecurityConfig. Returns documented defaults on any failure
 * (missing file, parse error). NEVER throws — a security-config read failure
 * must not crash a PreToolUse hook.
 */
export function readSecurityConfig(cwd: string): SecurityConfig {
  const settingsPath = path.join(resolveGuildRoot(cwd), ".guild", "settings.json");
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch {
    return securityDefaults();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return securityDefaults();
  }
  return parseSecurityConfig(parsed);
}

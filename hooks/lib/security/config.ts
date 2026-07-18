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
 * Decisions (canonical: ADR: v2-security-and-untrusted-content (workspace wiki)):
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

/**
 * The run's autonomy posture (docs/v2/security.html §bypassPermissions
 * governance). Closed triple — mirrors `AutonomyPolicy` in
 * scripts/write-task-run.ts (guild.task_run.v1 `autonomy_policy`).
 */
export type AutonomyMode =
  | "interactive"
  | "autonomous_after_plan_approval"
  | "auto_approve";

/** Validate an unknown value against the closed AutonomyMode triple. */
export function parseAutonomyMode(v: unknown): AutonomyMode | null {
  if (
    v === "interactive" ||
    v === "autonomous_after_plan_approval" ||
    v === "auto_approve"
  ) {
    return v;
  }
  return null;
}

/**
 * MCP transport availability flags (R-019 / FDC-13 / adapter docs).
 * Written to settings.json under the `mcp` block by operators or adapter
 * setup scripts; consumed by the runtime to decide whether to attempt
 * stdio/HTTP MCP transport or fall back to the fs_scanner reader.
 *
 * Defaults: stdio assumed present (backward-compat); HTTP and bridge absent.
 * BIND BY POINTER — canonical validation lives in scripts/read-guild-config.ts
 * (McpBlock / validateMcp). This reader is the tolerant runtime consumer.
 */
export interface McpAvailability {
  /** Is stdio-based MCP transport available? Default true (safe backward-compat assumption). */
  stdio_available: boolean;
  /** Is HTTP-based MCP transport available (e.g. web adapter)? Default false. */
  http_available: boolean;
  /**
   * Bridge package name when a PI adapter provides MCP bridging
   * (e.g. "guild-pi-mcp"). null = no bridge present.
   */
  bridge_package: string | null;
}

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
  /** MCP transport availability flags (R-019 / FDC-13). */
  mcp_availability: McpAvailability;
  /**
   * Project-wide baseline allow-list (R-020 / guild-boundary-config Decision F).
   * Sourced from `defaults.allowed_tools` in settings.json. Merged with the
   * per-lane GUILD_CAPABILITY_SCOPE in enforce.ts — tools in this list are
   * permitted even if not present in the per-lane capability scope.
   * Default [] ⇒ no baseline restriction (current behaviour preserved).
   */
  allowed_tools: string[];
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
    mcp_availability: {
      stdio_available: true,
      http_available: false,
      bridge_package: null,
    },
    allowed_tools: [],
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

  // defaults.allowed_tools (R-020 / guild-boundary-config Decision F)
  // Project-wide baseline allow-list consumed by enforce.ts to union with the
  // per-lane GUILD_CAPABILITY_SCOPE. Tolerant: non-array or absent → [].
  if (isPlainObject(parsed["defaults"])) {
    const defs = parsed["defaults"] as Record<string, unknown>;
    if (isStringArray(defs["allowed_tools"])) {
      out.allowed_tools = defs["allowed_tools"];
    }
  }

  // mcp block (D-MCP / PI-6 + R-019 / FDC-13)
  if (isPlainObject(parsed["mcp"])) {
    const mcp = parsed["mcp"] as Record<string, unknown>;

    // mcp.tool_description_hashes — description hash-pin map (PI-6)
    if (isPlainObject(mcp["tool_description_hashes"])) {
      const hashes: Record<string, string> = {};
      for (const [k, v] of Object.entries(mcp["tool_description_hashes"])) {
        if (typeof v === "string") hashes[k] = v;
      }
      out.tool_description_hashes = hashes;
    }

    // mcp.stdio_available / http_available / bridge_package — transport
    // availability flags (R-019 / FDC-13). Tolerant reader: unknown or
    // mistyped values fall back to the documented defaults silently.
    if (typeof mcp["stdio_available"] === "boolean") {
      out.mcp_availability.stdio_available = mcp["stdio_available"];
    }
    if (typeof mcp["http_available"] === "boolean") {
      out.mcp_availability.http_available = mcp["http_available"];
    }
    if (mcp["bridge_package"] === null || typeof mcp["bridge_package"] === "string") {
      out.mcp_availability.bridge_package = mcp["bridge_package"] as string | null;
    }
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

// ── Autonomy-mode resolution (D-BYPASS forcing input) ───────────────────────
//
// docs/v2/security.html §bypassPermissions governance: under the
// non-interactive autonomy modes (`auto_approve`,
// `autonomous_after_plan_approval`) `bypass_permissions_policy` is FORCED to
// `deny` — a bypassPermissions attempt on an out-of-scope call must hard-block.
// This resolver gives the PreToolUse hook a deterministic, code-readable view
// of the run's autonomy mode from artifacts the hook already has access to.
//
// Resolution order (first hit wins; every read is best-effort, never throws):
//   1. env GUILD_AUTONOMY_POLICY            — direct dispatcher export (closed triple).
//   2. guild.task_run.v1 `autonomy_policy:` — `<root>/.guild/runs/<runId>/task-runs/
//      <taskId>.yaml`, located via GUILD_RUN_ID + GUILD_TASK_ID (both already
//      exported on every dispatch path — same locator as the D-CAP scope-file
//      fallback). Parsed with a line regex, not a YAML library (hook-side
//      zero-dependency discipline; the value set is a closed triple).
//   3. settings `defaults.gates.auto_approve` non-empty ⇒ "auto_approve"
//      (the persisted opt-in autonomy gates).
//   4. default "interactive" (fail-open to the AUDITED posture — interactive
//      keeps the always-ask channel + security event; it never silently allows).

const TASK_RUN_AUTONOMY_RE =
  /^\s*autonomy_policy:\s*["']?(interactive|autonomous_after_plan_approval|auto_approve)["']?\s*$/m;

/** Read `autonomy_policy:` from a guild.task_run.v1 YAML file. Best-effort. */
export function readTaskRunAutonomyPolicy(filePath: string): AutonomyMode | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const m = TASK_RUN_AUTONOMY_RE.exec(raw);
    return m ? parseAutonomyMode(m[1]) : null;
  } catch {
    return null;
  }
}

/** Read `defaults.gates.auto_approve` (string[]) from settings.json. Best-effort. */
export function readSettingsAutoApprove(cwd: string): string[] {
  try {
    const settingsPath = path.join(resolveGuildRoot(cwd), ".guild", "settings.json");
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as unknown;
    if (!isPlainObject(parsed)) return [];
    const defaults = parsed["defaults"];
    if (!isPlainObject(defaults)) return [];
    const gates = defaults["gates"];
    if (!isPlainObject(gates)) return [];
    const aa = gates["auto_approve"];
    return isStringArray(aa) ? aa : [];
  } catch {
    return [];
  }
}

export interface ResolveAutonomyModeOpts {
  /** Starting cwd for guild-root resolution. */
  cwd: string;
  /** Env bag (default process.env) — test seam AND the primary channel. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the run's effective autonomy mode for D-BYPASS forcing. NEVER
 * throws; every layer is best-effort. See the resolution-order comment above.
 */
export function resolveRunAutonomyMode(opts: ResolveAutonomyModeOpts): AutonomyMode {
  const env = opts.env ?? process.env;

  // 1. Direct dispatcher export.
  const fromEnv = parseAutonomyMode(env["GUILD_AUTONOMY_POLICY"]);
  if (fromEnv !== null) return fromEnv;

  // 2. guild.task_run.v1 autonomy_policy (the per-attempt ground truth).
  const runId = (env["GUILD_RUN_ID"] ?? "").trim();
  const taskId = (env["GUILD_TASK_ID"] ?? "").trim();
  if (runId.length > 0 && taskId.length > 0) {
    // Same conservative path-component hygiene as the D-CAP scope-file fallback.
    const safe = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
    if (safe.test(runId) && safe.test(taskId)) {
      const taskRunPath = path.join(
        resolveGuildRoot(opts.cwd),
        ".guild",
        "runs",
        runId,
        "task-runs",
        `${taskId}.yaml`,
      );
      const fromTaskRun = readTaskRunAutonomyPolicy(taskRunPath);
      if (fromTaskRun !== null) return fromTaskRun;
    }
  }

  // 3. Persisted autonomy gates: defaults.gates.auto_approve non-empty.
  if (readSettingsAutoApprove(opts.cwd).length > 0) return "auto_approve";

  // 4. Default: interactive (audited + surfaced — never a silent allow).
  return "interactive";
}

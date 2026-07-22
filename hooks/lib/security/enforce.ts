/**
 * hooks/lib/security/enforce.ts
 *
 * PreToolUse capability-scope enforcement core (priority 1 of the v2 security
 * ADR hook-side work). Decision logic (readScopeContext / resolveScopeDecision /
 * isInScope etc.) is pure and I/O-free — trivially unit-testable. The one I/O
 * function is `readScopeFile` (the D-CAP belt-and-suspenders file-fallback);
 * it is sync, best-effort, and never throws — same discipline as every other
 * best-effort read in the hook codebase.
 * PreToolUse handler wires this to stdin/stdout + logging.
 *
 * Model
 * ─────
 * A dispatched lane runs under a declared `capability_scope` (the per-agent
 * allow-list from team.yaml / the agent def) AND-masked with the run-level
 * `autonomy_contract`. A tool call is permitted iff it matches BOTH. Anything
 * outside the effective allow-set is gated through Claude Code's EXISTING
 * always-ask channel (PreToolUse `permissionDecision`). Fail-closed.
 *
 * Channel (env, set by the dispatch wrapper — see followups):
 *   GUILD_CAPABILITY_SCOPE  — JSON string[] of rule entries for THIS lane.
 *   GUILD_AUTONOMY_CONTRACT — JSON string[] of run-level allow rules (optional
 *                             AND-mask). Absent ⇒ no additional narrowing.
 *
 * Enforcement only engages when GUILD_CAPABILITY_SCOPE is present. Absent ⇒
 * clean fall-through (the lead/orchestrator and non-Guild sessions are
 * unaffected) — same fall-through contract the telemetry hooks already honor.
 *
 * Rule syntax (mirrors Claude Code's own permission-rule grammar — bound by
 * convention, not re-invented):
 *   "*"               → matches any tool.
 *   "ToolName"        → matches any call to ToolName.
 *   "ToolName(glob)"  → matches ToolName when its argument string matches glob
 *                       (`*` = any run of chars). Argument string: Bash→command;
 *                       Read/Write/Edit/MultiEdit/Glob/Grep→file_path|path|pattern;
 *                       else→JSON(tool_input).
 *
 * bypass_permissions_policy (D-BYPASS) modulates an OUT-OF-SCOPE call ONLY when
 * Claude Code is in `bypassPermissions` mode (the operator already opted out of
 * prompts). Not under bypass, an out-of-scope call is ALWAYS `ask` (fail-closed):
 *   not-bypass        → ask     (always-ask gate; event logged)
 *   bypass + deny     → deny     (hard block — bypass cannot override Guild scope)
 *   bypass + audit    → proceed  (no block) but log the violation  [DEFAULT]
 *   bypass + allow    → proceed, log a bypass_permission_allowed record
 *
 * AUTONOMY-MODE FORCING (docs/v2/security.html §bypassPermissions governance):
 * under the non-interactive autonomy modes (`auto_approve`,
 * `autonomous_after_plan_approval`) the policy is FORCED to `deny` via
 * `effectiveBypassPolicy()` — the configured value is overridden, the bypass
 * attempt hard-blocks, and the security event records the forcing. Interactive
 * mode keeps the configured policy (audited + surfaced).
 */

import * as fs from "node:fs";
import type { AutonomyMode, BypassPolicy } from "./config.js";
import type { SecurityEventType, SecurityDecision } from "./events.js";

// ── D-BYPASS autonomy-mode forcing ──────────────────────────────────────────

export interface EffectiveBypassPolicy {
  policy: BypassPolicy;
  /** True when the policy was FORCED to deny by a non-interactive autonomy mode. */
  forced: boolean;
  /** The autonomy mode that drove the decision (diagnostic). */
  autonomyMode: AutonomyMode;
}

/**
 * docs/v2/security.html §bypassPermissions governance: under
 * `auto_approve` / `autonomous_after_plan_approval` the
 * `bypass_permissions_policy` is FORCED to `deny` — a bypassPermissions
 * attempt must hard-block (abort the tool call + security event), regardless
 * of the configured policy. Interactive keeps the configured policy
 * (default `audit`: proceed + log + always-ask surface when not under bypass).
 * Pure — trivially unit-testable.
 */
export function effectiveBypassPolicy(
  configured: BypassPolicy,
  autonomyMode: AutonomyMode,
): EffectiveBypassPolicy {
  if (autonomyMode === "auto_approve" || autonomyMode === "autonomous_after_plan_approval") {
    return { policy: "deny", forced: true, autonomyMode };
  }
  return { policy: configured, forced: false, autonomyMode };
}

// ── Scope context ────────────────────────────────────────────────────────

export interface ScopeContext {
  /** Per-lane capability_scope rules (may be empty ⇒ everything out of scope). */
  capability: string[];
  /** Run-level autonomy_contract rules; null ⇒ no AND-mask narrowing. */
  autonomy: string[] | null;
  /** True when the scope env was present but unparseable ⇒ fail-closed. */
  invalid: boolean;
  /**
   * Project-wide baseline allow-list (R-020 / `defaults.allowed_tools`).
   * Tools matching any rule here are permitted even if not in the per-lane
   * `capability` scope. Optional — absent or [] ⇒ no baseline expansion
   * (current behaviour preserved).
   */
  baseline?: string[];
}

function parseRuleArray(raw: string | undefined): { rules: string[] | null; invalid: boolean } {
  if (typeof raw !== "string" || raw.trim().length === 0) return { rules: null, invalid: false };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return { rules: parsed as string[], invalid: false };
    }
    return { rules: [], invalid: true };
  } catch {
    return { rules: [], invalid: true };
  }
}

/**
 * Build the scope context from an env bag. Returns null when no
 * GUILD_CAPABILITY_SCOPE is present (⇒ enforcement does not engage).
 *
 * @param env      Process environment bag (GUILD_CAPABILITY_SCOPE / GUILD_AUTONOMY_CONTRACT).
 * @param baseline Project-wide baseline allow-list from `defaults.allowed_tools` (R-020).
 *                 Merged into the scope as an OR-expansion of the per-lane capability.
 *                 Empty or absent ⇒ no baseline restriction (absent-⇒-no-scoping contract intact).
 */
export function readScopeContext(env: NodeJS.ProcessEnv, baseline: string[] = []): ScopeContext | null {
  const cap = parseRuleArray(env["GUILD_CAPABILITY_SCOPE"]);
  if (cap.rules === null && !cap.invalid) return null; // not a scoped lane
  const autonomy = parseRuleArray(env["GUILD_AUTONOMY_CONTRACT"]);
  return {
    capability: cap.rules ?? [],
    autonomy: autonomy.rules, // null ⇒ no mask
    invalid: cap.invalid || autonomy.invalid,
    baseline,
  };
}

// ── Rule matching ──────────────────────────────────────────────────────────

const ARG_FIELDS = ["command", "file_path", "path", "pattern"] as const;

/** Derive the argument string a `ToolName(glob)` rule matches against. */
export function toolArgString(toolName: string, toolInput: unknown): string {
  if (toolName === "Bash" && toolInput && typeof toolInput === "object") {
    const cmd = (toolInput as Record<string, unknown>)["command"];
    if (typeof cmd === "string") return cmd;
  }
  if (toolInput && typeof toolInput === "object") {
    for (const f of ARG_FIELDS) {
      const v = (toolInput as Record<string, unknown>)[f];
      if (typeof v === "string") return v;
    }
    try {
      return JSON.stringify(toolInput);
    } catch {
      return "";
    }
  }
  if (typeof toolInput === "string") return toolInput;
  return "";
}

/** Convert a `*`-glob to an anchored RegExp. All other chars are literal. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Does a single rule match this tool call? */
export function ruleMatches(rule: string, toolName: string, toolInput: unknown): boolean {
  if (rule === "*") return true;
  const open = rule.indexOf("(");
  if (open === -1 || !rule.endsWith(")")) {
    return rule === toolName;
  }
  const name = rule.slice(0, open);
  if (name !== toolName) return false;
  const glob = rule.slice(open + 1, rule.length - 1);
  if (glob === "" || glob === "*") return true;
  try {
    return globToRegExp(glob).test(toolArgString(toolName, toolInput));
  } catch {
    return false; // malformed glob ⇒ no match (fail-closed)
  }
}

/** Does ANY rule in the list match? Empty list ⇒ false (fail-closed). */
export function anyRuleMatches(rules: string[], toolName: string, toolInput: unknown): boolean {
  return rules.some((r) => ruleMatches(r, toolName, toolInput));
}

/**
 * Effective scope check:
 *   in (capability_scope UNION baseline) AND (no autonomy mask OR in it).
 *
 * The baseline (from `defaults.allowed_tools`, R-020) is a project-wide OR-
 * expansion of the per-lane capability scope — a tool matching it is permitted
 * even when not in the per-lane list. The autonomy AND-mask still applies over
 * the full effective capability (baseline does not bypass autonomy narrowing).
 */
export function isInScope(scope: ScopeContext, toolName: string, toolInput: unknown): boolean {
  if (scope.invalid) return false; // unparseable scope ⇒ fail-closed
  const baseline = scope.baseline ?? [];
  // Effective capability = per-lane scope OR project-wide baseline (R-020).
  const inEffectiveCapability =
    anyRuleMatches(scope.capability, toolName, toolInput) ||
    (baseline.length > 0 && anyRuleMatches(baseline, toolName, toolInput));
  if (!inEffectiveCapability) return false;
  if (scope.autonomy !== null && !anyRuleMatches(scope.autonomy, toolName, toolInput)) return false;
  return true;
}

// ── File-fallback scope reader (D-CAP belt-and-suspenders) ──────────────

/** Expected JSON shape of a per-task scope file. */
interface ScopeFileContent {
  capability_scope?: unknown;
  autonomy_contract?: unknown;
}

/**
 * Read the scope context from the per-task scope file on disk. This is the
 * D-CAP belt-and-suspenders fallback — engaged when `GUILD_CAPABILITY_SCOPE`
 * is absent from the process env (e.g. cross-host SSH, or any environment
 * where env-injection is unreliable). The primary path remains the env bag.
 *
 * File path (assembled by the caller):
 *   `<guildRoot>/.guild/runs/<runId>/scope/<taskId>.json`
 *
 * Returns null when the file is absent, unreadable, or lacks a
 * `capability_scope` key — identical fall-through contract as `readScopeContext`.
 *
 * @param filePath  Absolute path to the scope JSON file (computed by `pre-tool-use.ts`).
 * @param baseline  Project-wide baseline allow-list from `defaults.allowed_tools` (R-020).
 */
export function readScopeFile(filePath: string, baseline: string[] = []): ScopeContext | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null; // file absent or unreadable — clean fall-through (not a scoped lane)
  }
  let parsed: ScopeFileContent;
  try {
    parsed = JSON.parse(raw) as ScopeFileContent;
  } catch {
    // Malformed JSON in scope file → fail-closed (treat as invalid scope).
    return { capability: [], autonomy: null, invalid: true, baseline };
  }
  if (!("capability_scope" in parsed)) return null; // key absent ⇒ no scoping
  const capArr = parsed.capability_scope;
  const capValid =
    Array.isArray(capArr) && (capArr as unknown[]).every((x) => typeof x === "string");
  const capability = capValid ? (capArr as string[]) : [];
  const capInvalid = !capValid;
  const autonomyArr = parsed.autonomy_contract;
  const autonomyValid =
    Array.isArray(autonomyArr) &&
    (autonomyArr as unknown[]).every((x) => typeof x === "string");
  const autonomy = autonomyValid ? (autonomyArr as string[]) : null;
  return { capability, autonomy, invalid: capInvalid, baseline };
}

// ── Decision resolver ────────────────────────────────────────────────────

export interface ScopeDecision {
  /** True ⇒ the handler must emit a PreToolUse permission decision + stop. */
  gate: boolean;
  /** The PreToolUse permissionDecision to emit when gate === true. */
  permissionDecision?: "ask" | "deny";
  /** Decision recorded in the security event (the action actually taken). */
  recordedDecision: SecurityDecision;
  /** Security event to log; null ⇒ in-scope, nothing to record. */
  eventType: SecurityEventType | null;
  /** Human-readable reason for the prompt / record. */
  reason: string;
}

export interface ResolveArgs {
  scope: ScopeContext;
  toolName: string;
  toolInput: unknown;
  policy: BypassPolicy;
  /** Claude Code permission mode at call time. */
  permissionMode?: string;
  /**
   * True when `policy` was forced to `deny` by a non-interactive autonomy
   * mode (effectiveBypassPolicy). Only affects the recorded reason text.
   */
  policyForced?: boolean;
}

/**
 * Resolve the capability-scope decision for one tool call. Pure.
 */
export function resolveScopeDecision(args: ResolveArgs): ScopeDecision {
  const { scope, toolName, toolInput, policy, permissionMode, policyForced } = args;

  if (isInScope(scope, toolName, toolInput)) {
    return { gate: false, recordedDecision: "pass", eventType: null, reason: "" };
  }

  const underBypass = permissionMode === "bypassPermissions";
  const baseReason =
    `capability-scope: tool "${toolName}" is outside this lane's effective ` +
    `allow-set (capability_scope AND-masked with autonomy_contract).`;

  if (!underBypass) {
    return {
      gate: true,
      permissionDecision: "ask",
      recordedDecision: "ask",
      eventType: "capability_scope_violation",
      reason: `${baseReason} Confirm this tool call is intentional.`,
    };
  }

  switch (policy) {
    case "deny":
      return {
        gate: true,
        permissionDecision: "deny",
        recordedDecision: "deny",
        eventType: "capability_scope_violation",
        reason: policyForced === true
          ? `${baseReason} bypass_permissions_policy=deny (FORCED by non-interactive autonomy ` +
            `mode — docs/v2/security.html §bypassPermissions governance) — hard-blocked ` +
            `under bypassPermissions.`
          : `${baseReason} bypass_permissions_policy=deny — hard-blocked under bypassPermissions.`,
      };
    case "allow":
      return {
        gate: false,
        recordedDecision: "allow",
        eventType: "bypass_permission_allowed",
        reason: `${baseReason} bypass_permissions_policy=allow — permitted under bypassPermissions (audited).`,
      };
    case "audit":
    default:
      return {
        gate: false,
        recordedDecision: "allow",
        eventType: "capability_scope_violation",
        reason: `${baseReason} bypass_permissions_policy=audit — permitted under bypassPermissions but recorded.`,
      };
  }
}

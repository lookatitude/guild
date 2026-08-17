/**
 * src/modules/distribution/workflows/result-contracts-v2.ts
 *
 * The four orchestration-result contracts that were previously DEFERRED (no
 * producer yet) — now shipped in v2 so a host emitting any of them is normalized
 * the moment its producer appears, rather than failing closed as "unknown
 * contract". Schemas are minimal, forward-compatible v1s (extra keys are tolerated
 * per the lenient-reader rule; the required core is validated strictly):
 *
 *   - guild.phase_result.v1       — phase-close summary + gate predicate
 *   - guild.permission_receipt.v1 — requested/selected host mode + gate policy
 *   - guild.host_event.v1         — normalized hook/tool/session event
 *   - guild.qa_result.v1          — test-matrix execution + release predicate
 *
 * Each validator returns the `{ valid, errors }` shape the result-normalizer
 * dispatches through (CONTRACT_VALIDATORS). Fail-closed: a malformed value is
 * rejected with a pointed error, never silently accepted.
 */

type V = { valid: boolean; errors: string[] };

function obj(value: unknown, errors: string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push("not a JSON object");
    return false;
  }
  return true;
}
function reqStr(o: Record<string, unknown>, k: string, errors: string[]): void {
  if (typeof o[k] !== "string" || (o[k] as string).length === 0) errors.push(`"${k}" must be a non-empty string`);
}
function reqEnum(o: Record<string, unknown>, k: string, allowed: readonly string[], errors: string[]): void {
  if (typeof o[k] !== "string" || !allowed.includes(o[k] as string)) {
    errors.push(`"${k}" must be one of ${allowed.join("|")}`);
  }
}
function reqBool(o: Record<string, unknown>, k: string, errors: string[]): void {
  if (typeof o[k] !== "boolean") errors.push(`"${k}" must be a boolean`);
}
function reqStrArray(o: Record<string, unknown>, k: string, errors: string[]): void {
  if (!Array.isArray(o[k]) || !(o[k] as unknown[]).every((x) => typeof x === "string")) {
    errors.push(`"${k}" must be a string[]`);
  }
}

const PHASES = ["init", "ideate", "plan", "build", "qa", "ops"] as const;

/** guild.phase_result.v1 — phase-close summary + gate predicate. */
export function validatePhaseResultV1(value: unknown): V {
  const errors: string[] = [];
  if (!obj(value, errors)) return { valid: false, errors };
  if (value["schema_version"] !== "guild.phase_result.v1") errors.push('schema_version must be "guild.phase_result.v1"');
  reqStr(value, "run_id", errors);
  reqEnum(value, "phase", PHASES, errors);
  reqEnum(value, "status", ["complete", "blocked", "partial"], errors);
  reqBool(value, "gate_passed", errors);
  reqStrArray(value, "outputs", errors);
  reqStr(value, "ts", errors);
  return { valid: errors.length === 0, errors };
}

/** guild.permission_receipt.v1 — requested/selected host mode + gate policy. */
export function validatePermissionReceiptV1(value: unknown): V {
  const errors: string[] = [];
  if (!obj(value, errors)) return { valid: false, errors };
  if (value["schema_version"] !== "guild.permission_receipt.v1") errors.push('schema_version must be "guild.permission_receipt.v1"');
  reqStr(value, "run_id", errors);
  reqStr(value, "requested_mode", errors);
  reqStr(value, "selected_mode", errors);
  reqEnum(value, "gate_policy", ["prompted_inline", "autonomous", "forbidden"], errors);
  reqStrArray(value, "scope", errors);
  reqStr(value, "ts", errors);
  return { valid: errors.length === 0, errors };
}

/** guild.host_event.v1 — normalized hook/tool/session event. */
export function validateHostEventV1(value: unknown): V {
  const errors: string[] = [];
  if (!obj(value, errors)) return { valid: false, errors };
  if (value["schema_version"] !== "guild.host_event.v1") errors.push('schema_version must be "guild.host_event.v1"');
  reqStr(value, "run_id", errors);
  reqStr(value, "host_id", errors);
  reqEnum(value, "event_type", ["hook", "tool", "session"], errors);
  reqStr(value, "name", errors);
  // `detail` is optional; when present it must be a string.
  if (value["detail"] !== undefined && typeof value["detail"] !== "string") errors.push('"detail" must be a string when present');
  reqStr(value, "ts", errors);
  return { valid: errors.length === 0, errors };
}

/** guild.qa_result.v1 — test-matrix execution + release predicate. */
export function validateQaResultV1(value: unknown): V {
  const errors: string[] = [];
  if (!obj(value, errors)) return { valid: false, errors };
  if (value["schema_version"] !== "guild.qa_result.v1") errors.push('schema_version must be "guild.qa_result.v1"');
  reqStr(value, "run_id", errors);
  // checks: array of { id: string, status: pass|fail|skip }
  const checks = value["checks"];
  if (!Array.isArray(checks)) {
    errors.push('"checks" must be an array of {id, status}');
  } else {
    checks.forEach((c, i) => {
      if (c === null || typeof c !== "object") {
        errors.push(`checks[${i}] must be an object`);
        return;
      }
      const cc = c as Record<string, unknown>;
      if (typeof cc["id"] !== "string" || (cc["id"] as string).length === 0) errors.push(`checks[${i}].id must be a non-empty string`);
      if (!["pass", "fail", "skip"].includes(cc["status"] as string)) errors.push(`checks[${i}].status must be pass|fail|skip`);
    });
  }
  reqStrArray(value, "gaps", errors);
  reqStrArray(value, "failures", errors);
  reqBool(value, "release_ok", errors);
  reqStr(value, "ts", errors);
  return { valid: errors.length === 0, errors };
}

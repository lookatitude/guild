// v1.4.0 adversarial-loops — JSONL schema validator.
//
// Validates events emitted by `benchmark/src/log-jsonl.ts` against the
// binding schema doc `benchmark/plans/v1.4-jsonl-schema.md` (12 event
// types, schema_version: 1).
//
// Usage:
//   npx tsx scripts/v1.4-log-validator.ts <jsonl-file>
//
// Library API:
//   import { validateEvent, validateText } from "./v1.4-log-validator.js";
//   const result = validateEvent(parsedObject);
//   if (!result.ok) console.error(result.errors);
//
// Exit codes (CLI):
//   0 — every line valid
//   1 — at least one line invalid (errors printed to stderr)
//   2 — usage error (missing/unreadable file)

import { readFileSync, existsSync } from "node:fs";

// ──────────────────────────────────────────────────────────────────────────
// Closed enums — copied verbatim from `benchmark/plans/v1.4-jsonl-schema.md`.
// Each enum is the binding contract; expanding requires a schema bump.
// ──────────────────────────────────────────────────────────────────────────

export const PHASE_VALUES = [
  "brainstorm",
  "team-compose",
  "plan",
  "context",
  "execute",
  "review",
  "verify",
  "reflect",
] as const;

export const LOOP_LAYER_VALUES = [
  "L1",
  "L2",
  "L3",
  "L4",
  "security-review",
] as const;

export const TOOL_CALL_TOOL_VALUES = [
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Bash",
  "Agent",
  "Skill",
  "AskUserQuestion",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "BashOutput",
  "KillShell",
] as const;

export const HOOK_EVENT_NAMES = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "TaskCreated",
  "TaskCompleted",
  "TeammateIdle",
] as const;

export const EVENT_TYPES = [
  "phase_start",
  "phase_end",
  "specialist_dispatch",
  "specialist_receipt",
  "loop_round_start",
  "loop_round_end",
  "tool_call",
  "hook_event",
  "gate_decision",
  "assumption_logged",
  "escalation",
  "codex_review_round",
] as const;

export const PHASE_END_STATUS = ["ok", "error", "escalated"] as const;
export const LOOP_TERMINATED = [
  "satisfied",
  "malformed_termination",
  "cap_hit",
  "escalation",
  "error",
] as const;
export const TOOL_CALL_STATUS = ["ok", "err", "n/a"] as const;
export const HOOK_STATUS = ["ok", "err"] as const;
export const GATE_DECISION = ["approved", "rejected", "deferred"] as const;
export const GATE_SOURCE = ["user", "auto-approve-mode"] as const;
export const ESCALATION_REASON = [
  "cap_hit",
  "malformed_termination_x2",
  "restart_cap_hit",
] as const;
export const ESCALATION_LABELS = ["force-pass", "extend-cap", "rework"] as const;
export const FIXED_GATES = ["gate-1-spec", "gate-2-team", "gate-3-plan"] as const;

// ISO-8601 timestamp with millisecond precision (Z-suffixed). The schema
// example: "2026-04-27T07:35:00.123Z".
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// gate_decision.gate slug grammar — schema doc §9.
const MID_EXEC_DECISION_RE =
  /^mid-execution-decision:[a-z][a-z0-9-]{0,63}$/;

// codex_review_round.gate lane-id grammar — schema doc §12.
const G_LANE_RE = /^G-lane:T[0-9]+[a-z]?-[a-z][a-z-]{0,32}$/;

// ──────────────────────────────────────────────────────────────────────────
// Validator helpers
// ──────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && Number.isFinite(v);
}
function isNonNegInt(v: unknown): v is number {
  return isInt(v) && v >= 0;
}
function isPosInt(v: unknown): v is number {
  return isInt(v) && v >= 1;
}
function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}
function isOneOf<T extends readonly string[]>(
  v: unknown,
  values: T,
): v is T[number] {
  return typeof v === "string" && (values as readonly string[]).includes(v);
}

function checkEnvelope(
  obj: Record<string, unknown>,
  errs: string[],
  expectedEvent: string,
): void {
  if (!isString(obj.ts) || !ISO_TS_RE.test(obj.ts)) {
    errs.push(`ts: expected ISO-8601 millisecond UTC timestamp, got ${JSON.stringify(obj.ts)}`);
  }
  if (obj.event !== expectedEvent) {
    errs.push(`event: expected "${expectedEvent}", got ${JSON.stringify(obj.event)}`);
  }
  if (!isString(obj.run_id) || obj.run_id.length === 0) {
    errs.push(`run_id: expected non-empty string`);
  }
}

function checkOptionalString(
  obj: Record<string, unknown>,
  field: string,
  errs: string[],
): void {
  if (field in obj && !isString(obj[field])) {
    errs.push(`${field}: expected string when present, got ${typeof obj[field]}`);
  }
}

function checkRequiredString(
  obj: Record<string, unknown>,
  field: string,
  errs: string[],
): void {
  if (!isString(obj[field]) || (obj[field] as string).length === 0) {
    errs.push(`${field}: expected non-empty string`);
  }
}

function checkRequiredEnum(
  obj: Record<string, unknown>,
  field: string,
  values: readonly string[],
  errs: string[],
): void {
  if (!isOneOf(obj[field], values)) {
    errs.push(
      `${field}: expected one of ${JSON.stringify(values)}, got ${JSON.stringify(obj[field])}`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Per-event validators
// ──────────────────────────────────────────────────────────────────────────

function validatePhaseStart(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "phase_start");
  checkRequiredEnum(o, "phase", PHASE_VALUES, errs);
}
function validatePhaseEnd(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "phase_end");
  checkRequiredEnum(o, "phase", PHASE_VALUES, errs);
  if (!isNonNegInt(o.duration_ms))
    errs.push(`duration_ms: expected non-negative integer`);
  checkRequiredEnum(o, "status", PHASE_END_STATUS, errs);
}
function validateSpecialistDispatch(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "specialist_dispatch");
  checkRequiredString(o, "lane_id", errs);
  checkRequiredString(o, "specialist", errs);
  checkRequiredString(o, "task_id", errs);
  checkRequiredString(o, "prompt_excerpt", errs);
}
function validateSpecialistReceipt(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "specialist_receipt");
  checkRequiredString(o, "lane_id", errs);
  checkRequiredString(o, "specialist", errs);
  checkRequiredString(o, "task_id", errs);
  checkRequiredString(o, "receipt_path", errs);
}
function validateLoopRoundStart(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "loop_round_start");
  checkRequiredString(o, "lane_id", errs);
  checkRequiredEnum(o, "loop_layer", LOOP_LAYER_VALUES, errs);
  if (!isPosInt(o.round_number)) errs.push(`round_number: expected integer ≥ 1`);
  if (!isPosInt(o.cap) || (o.cap as number) > 256)
    errs.push(`cap: expected integer in [1, 256]`);
}
function validateLoopRoundEnd(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "loop_round_end");
  checkRequiredString(o, "lane_id", errs);
  checkRequiredEnum(o, "loop_layer", LOOP_LAYER_VALUES, errs);
  if (!isPosInt(o.round_number)) errs.push(`round_number: expected integer ≥ 1`);
  checkRequiredEnum(o, "terminated", LOOP_TERMINATED, errs);
  checkRequiredString(o, "terminator", errs);
}
function validateToolCall(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "tool_call");
  checkOptionalString(o, "lane_id", errs);
  checkRequiredEnum(o, "tool", TOOL_CALL_TOOL_VALUES, errs);
  if (!isString(o.command_redacted))
    errs.push(`command_redacted: expected string (may be empty)`);
  checkRequiredEnum(o, "status", TOOL_CALL_STATUS, errs);
  if (!isNonNegInt(o.latency_ms))
    errs.push(`latency_ms: expected non-negative integer`);
  if (!isString(o.result_excerpt_redacted))
    errs.push(`result_excerpt_redacted: expected string (may be empty)`);
  if ("tokens_in" in o && !isNonNegInt(o.tokens_in))
    errs.push(`tokens_in: when present, expected non-negative integer`);
  if ("tokens_out" in o && !isNonNegInt(o.tokens_out))
    errs.push(`tokens_out: when present, expected non-negative integer`);
}
function validateHookEvent(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "hook_event");
  checkOptionalString(o, "lane_id", errs);
  checkRequiredEnum(o, "hook_name", HOOK_EVENT_NAMES, errs);
  if (!isString(o.payload_excerpt_redacted))
    errs.push(`payload_excerpt_redacted: expected string (may be empty)`);
  if (!isNonNegInt(o.latency_ms))
    errs.push(`latency_ms: expected non-negative integer`);
  checkRequiredEnum(o, "status", HOOK_STATUS, errs);
}
function validateGateDecision(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "gate_decision");
  if (!isString(o.gate)) {
    errs.push(`gate: expected string`);
  } else {
    const g = o.gate;
    const ok =
      (FIXED_GATES as readonly string[]).includes(g) ||
      MID_EXEC_DECISION_RE.test(g);
    if (!ok)
      errs.push(
        `gate: expected one of ${JSON.stringify(FIXED_GATES)} or "mid-execution-decision:<slug>", got ${JSON.stringify(g)}`,
      );
  }
  checkRequiredEnum(o, "decision", GATE_DECISION, errs);
  checkRequiredEnum(o, "source", GATE_SOURCE, errs);
}
function validateAssumptionLogged(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "assumption_logged");
  checkRequiredString(o, "lane_id", errs);
  checkRequiredString(o, "specialist", errs);
  checkRequiredString(o, "assumption_text", errs);
}
function validateEscalation(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "escalation");
  checkOptionalString(o, "lane_id", errs);
  checkRequiredEnum(o, "reason", ESCALATION_REASON, errs);
  // options_offered must be exactly the canonical 3 labels.
  const off = o.options_offered;
  if (
    !Array.isArray(off) ||
    off.length !== ESCALATION_LABELS.length ||
    !ESCALATION_LABELS.every((label, i) => off[i] === label)
  ) {
    errs.push(
      `options_offered: expected exactly ${JSON.stringify(ESCALATION_LABELS)}`,
    );
  }
  checkRequiredEnum(o, "user_choice", ESCALATION_LABELS, errs);
}
function validateCodexReviewRound(o: Record<string, unknown>, errs: string[]): void {
  checkEnvelope(o, errs, "codex_review_round");
  if (!isString(o.gate)) {
    errs.push(`gate: expected string`);
  } else {
    const g = o.gate;
    const ok = g === "G-spec" || g === "G-plan" || G_LANE_RE.test(g);
    if (!ok)
      errs.push(
        `gate: expected "G-spec" | "G-plan" | "G-lane:<lane-id>", got ${JSON.stringify(g)}`,
      );
  }
  if (!isPosInt(o.round_number) || (o.round_number as number) > 5)
    errs.push(`round_number: expected integer in [1, 5] (Codex cap = 5)`);
  if (!isBool(o.terminated_by_satisfied))
    errs.push(`terminated_by_satisfied: expected boolean`);
}

const VALIDATORS: Record<
  string,
  (o: Record<string, unknown>, errs: string[]) => void
> = {
  phase_start: validatePhaseStart,
  phase_end: validatePhaseEnd,
  specialist_dispatch: validateSpecialistDispatch,
  specialist_receipt: validateSpecialistReceipt,
  loop_round_start: validateLoopRoundStart,
  loop_round_end: validateLoopRoundEnd,
  tool_call: validateToolCall,
  hook_event: validateHookEvent,
  gate_decision: validateGateDecision,
  assumption_logged: validateAssumptionLogged,
  escalation: validateEscalation,
  codex_review_round: validateCodexReviewRound,
};

/**
 * Validate a single parsed event object. Returns
 * `{ ok: true, errors: [] }` on success, or `{ ok: false, errors: [...] }`
 * on failure with one error string per violation.
 *
 * This validator is strict per schema doc §"Encoding rules":
 *   - `event` must be one of the 12 listed types.
 *   - All required fields per type must be present and well-typed.
 *   - Optional fields, when present, must be well-typed (no nulls).
 *   - Enums are closed; unknown values reject.
 */
export function validateEvent(parsed: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, errors: ["event must be a JSON object"] };
  }
  const o = parsed as Record<string, unknown>;
  if (!isString(o.event)) {
    return { ok: false, errors: ['envelope: "event" field missing or non-string'] };
  }
  if (!(EVENT_TYPES as readonly string[]).includes(o.event)) {
    return {
      ok: false,
      errors: [
        `event: unknown value ${JSON.stringify(o.event)}; ` +
          `expected one of ${JSON.stringify(EVENT_TYPES)}`,
      ],
    };
  }
  // Schema doc §"Encoding rules" #3 — null is a violation; only absence
  // signals optionality. Reject any null values up front.
  for (const [k, v] of Object.entries(o)) {
    if (v === null) errors.push(`${k}: null is not allowed (omit the field instead)`);
  }
  const validator = VALIDATORS[o.event];
  if (validator) validator(o, errors);
  return { ok: errors.length === 0, errors };
}

/**
 * Validate every line of a JSONL text blob. Returns the per-line
 * results in input order. Empty lines are skipped silently. Lines that
 * fail `JSON.parse` are reported with `ok: false`.
 */
export function validateText(text: string): {
  total: number;
  valid: number;
  invalid: number;
  perLine: Array<{ line: number; result: ValidationResult }>;
} {
  const lines = text.split("\n");
  const perLine: Array<{ line: number; result: ValidationResult }> = [];
  let valid = 0;
  let invalid = 0;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined || raw.length === 0) continue;
    total += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      invalid += 1;
      perLine.push({
        line: i + 1,
        result: {
          ok: false,
          errors: [`JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`],
        },
      });
      continue;
    }
    const result = validateEvent(parsed);
    if (result.ok) valid += 1;
    else invalid += 1;
    perLine.push({ line: i + 1, result });
  }
  return { total, valid, invalid, perLine };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI entrypoint — runs only when invoked directly via `tsx`.
// ──────────────────────────────────────────────────────────────────────────

function isMainModule(): boolean {
  // tsx + ESM: import.meta.url ends with the script path. We avoid
  // depending on import.meta to keep the validator easily importable
  // from CommonJS test harnesses; instead, gate on `process.argv[1]`.
  const arg1 = process.argv[1];
  if (!arg1) return false;
  return /v1\.4-log-validator\.[tj]s$/.test(arg1);
}

function cliMain(argv: string[]): number {
  const path = argv[2];
  if (!path) {
    process.stderr.write("usage: v1.4-log-validator <jsonl-file>\n");
    return 2;
  }
  if (!existsSync(path)) {
    process.stderr.write(`error: file not found: ${path}\n`);
    return 2;
  }
  const text = readFileSync(path, "utf8");
  const summary = validateText(text);
  if (summary.invalid > 0) {
    for (const { line, result } of summary.perLine) {
      if (!result.ok) {
        for (const e of result.errors) {
          process.stderr.write(`${path}:${line}: ${e}\n`);
        }
      }
    }
    process.stderr.write(
      `validator: ${summary.invalid}/${summary.total} lines invalid\n`,
    );
    return 1;
  }
  process.stdout.write(`validator: ${summary.valid}/${summary.total} lines valid\n`);
  return 0;
}

if (isMainModule()) {
  process.exit(cliMain(process.argv));
}

/**
 * `guild.progress_ledger.v1` — the T1 cell loop, on disk under the cell.
 *
 * Two things live here, and they are the same thing seen from two ends:
 *
 *  - **`done_when[]`** on `guild.task_assignment.v2` is the ORACLE LIST: the
 *    machine form of the TaskCell ADR's D6 acceptance tests. Prose acceptance is
 *    not an oracle; every entry names a closed oracle kind so a deterministic
 *    runner — never a model judgement — can settle it.
 *  - **the ledger** is the running state of those oracles for one cell. It is
 *    authoritative for crash resume and compaction rehydrate (KTD26/R46), which
 *    is why it is a FILE and not a chat turn: a rehydrating session reads disk,
 *    never a host transcript summary.
 *
 * The invariant this module exists to enforce: **a cell without oracles cannot
 * go done.** An empty `done_when[]` is not "vacuously satisfied" — it is a
 * dispatch that declared no way to be checked, and it fails closed. Cell done
 * iff every item is `pass` or `skip-recorded` AND there is at least one item.
 */
import * as fs from "fs";
import * as path from "path";

import { deepFreeze, frozenList } from "../kernel";
import { assertWritableBinding } from "../lifecycle";
import type { DispatchBindingEnvelope } from "./task-assignment";
import { assignmentId, taskCellPaths, type TaskAssignmentV2 } from "./task-cell-contract";

export const PROGRESS_LEDGER_SCHEMA = "guild.progress_ledger.v1" as const;

/**
 * Closed oracle kinds. A `done_when` entry naming anything else is malformed and
 * the dispatch fails closed — the point of the enum is that an assignment cannot
 * smuggle in "the lead thinks it looks right" as an acceptance test.
 */
export const DONE_WHEN_ORACLE_KINDS = frozenList([
  /** The adapter's inner verify hook (native | wrapped | skip-recorded). */
  "verify.after_edit",
  /** A named check the project already defines (lint id, test id, script id). */
  "named_check",
  /** An exact command that must exit 0. */
  "command",
  /** A file the assignment's scope says must exist after the lane runs. */
  "artifact_exists",
  /** An upstream `guild.handoff_acceptance.v1` record that must be durable. */
  "acceptance_record",
] as const);

export type DoneWhenOracle = (typeof DONE_WHEN_ORACLE_KINDS)[number];

export function isDoneWhenOracle(value: unknown): value is DoneWhenOracle {
  return typeof value === "string" && (DONE_WHEN_ORACLE_KINDS as readonly string[]).includes(value);
}

/** One machine-checkable acceptance test on `guild.task_assignment.v2`. */
export interface DoneWhenItem {
  id: string;
  oracle: DoneWhenOracle;
  /** Oracle-specific target: the command, check id, or path. Free-form by kind. */
  target?: string | null;
}

export const LEDGER_ITEM_STATES = frozenList([
  "pending",
  "running",
  "pass",
  "fail",
  "skip-recorded",
] as const);

export type LedgerItemState = (typeof LEDGER_ITEM_STATES)[number];

/**
 * The closed cell failure enum (KTD24 / R46). Distinct from `TaskCellFailure`,
 * which is the *operation* failure enum on the backend seam: this one is the
 * CELL LOOP's verdict about what to do next after an oracle failed.
 */
export const CELL_LAST_FAILURES = frozenList([
  "retry",
  "replan",
  "escalate",
  "skip-recorded",
] as const);

export type CellLastFailure = (typeof CELL_LAST_FAILURES)[number];

export interface ProgressLedgerItem {
  id: string;
  state: LedgerItemState;
  /** The oracle this item settles; carried so a rehydrate needs no assignment read. */
  oracle: DoneWhenOracle;
}

export interface ProgressLedgerV1 {
  schema_version: typeof PROGRESS_LEDGER_SCHEMA;
  cell_id: string;
  run_id: string;
  logical_task_id: string;
  /**
   * The assignment whose `done_when[]` this ledger settles.
   *
   * Without it the ledger is only "some evidence for this logical task", and an
   * assignment that declared no oracles can be released by a ledger a different
   * attempt wrote. The gate binds on this id AND on the oracle id set.
   */
  assignment_id?: string;
  updated_at: string;
  items: ProgressLedgerItem[];
  last_failure?: CellLastFailure;
}

// ── done_when validation ─────────────────────────────────────────────────────

export type DoneWhenCheck =
  | { ok: true; items: readonly DoneWhenItem[] }
  | { ok: false; reason: string };

/** Narrowing predicate for the refusal arm (see `cellBlocked` for why). */
export function doneWhenRefused(
  check: DoneWhenCheck,
): check is Extract<DoneWhenCheck, { ok: false }> {
  return !check.ok;
}

/**
 * Fail-closed read of an assignment's `done_when[]`.
 *
 * `missing` and `[]` are the SAME refusal on purpose. The ADR's D6 floor checks
 * the assignment's acceptance tests; an assignment that declares none has no
 * floor, so letting it through would make "cell done" mean "the worker said so"
 * — exactly the receipt-on-disk false positive D5 closes.
 */
export function validateDoneWhen(value: unknown): DoneWhenCheck {
  if (!Array.isArray(value) || value.length === 0) {
    return {
      ok: false,
      reason:
        "assignment declares no done_when[] oracles — a cell with no acceptance " +
        "oracle cannot go done (R46). Declare at least one closed-kind oracle.",
    };
  }
  const seen = new Set<string>();
  const items: DoneWhenItem[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object") {
      return { ok: false, reason: "done_when[] entry is not an object" };
    }
    const o = raw as Record<string, unknown>;
    const id = o["id"];
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, reason: "done_when[] entry has no id" };
    }
    if (seen.has(id)) {
      return { ok: false, reason: `done_when[] id is not unique: ${id}` };
    }
    seen.add(id);
    if (!isDoneWhenOracle(o["oracle"])) {
      return {
        ok: false,
        reason:
          `done_when[${id}].oracle ${JSON.stringify(o["oracle"])} is not a closed ` +
          `oracle kind (${DONE_WHEN_ORACLE_KINDS.join(" | ")})`,
      };
    }
    const target = o["target"];
    if (target !== undefined && target !== null && typeof target !== "string") {
      return { ok: false, reason: `done_when[${id}].target must be a string or null` };
    }
    items.push({ id, oracle: o["oracle"], target: (target as string | undefined) ?? null });
  }
  return { ok: true, items: frozenList(items) };
}

// ── The ledger on disk ───────────────────────────────────────────────────────

/**
 * The ledger is per CELL, not per instance: a retry writes a new attempt (D4)
 * but the cell's oracle list is the same contract, so resume reads one file.
 */
export function progressLedgerPath(input: {
  run_id: string;
  logical_task_id: string;
  guildDir?: string;
}): string {
  const paths = taskCellPaths(
    {
      run_id: input.run_id,
      logical_task_id: input.logical_task_id,
      attempt: 1,
      instance_id: "ledger",
    },
    { guildDir: input.guildDir },
  );
  return path.join(paths.cell_dir, "progress-ledger.json");
}

export function validateProgressLedgerV1(obj: unknown): ProgressLedgerV1 | null {
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o["schema_version"] !== PROGRESS_LEDGER_SCHEMA) return null;
  for (const k of ["cell_id", "run_id", "logical_task_id", "updated_at"]) {
    if (typeof o[k] !== "string" || (o[k] as string).length === 0) return null;
  }
  const items = o["items"];
  if (!Array.isArray(items)) return null;
  for (const it of items) {
    if (it === null || typeof it !== "object") return null;
    const e = it as Record<string, unknown>;
    if (typeof e["id"] !== "string" || e["id"] === "") return null;
    if (!(LEDGER_ITEM_STATES as readonly string[]).includes(e["state"] as string)) return null;
    if (!isDoneWhenOracle(e["oracle"])) return null;
  }
  if (o["assignment_id"] !== undefined && typeof o["assignment_id"] !== "string") return null;
  const lastFailure = o["last_failure"];
  if (
    lastFailure !== undefined &&
    !(CELL_LAST_FAILURES as readonly string[]).includes(lastFailure as string)
  ) {
    return null;
  }
  return obj as ProgressLedgerV1;
}

export interface InitLedgerInput {
  cwd: string;
  run_id: string;
  logical_task_id: string;
  cell_id: string;
  /** The assignment's raw `done_when` value — validated here, not by the caller. */
  done_when: unknown;
  /** The assignment this ledger settles (`assignmentId(assignment)`). */
  assignment_id?: string;
  now?: () => string;
  guildDir?: string;
  /** The caller's verified run binding (CD9); absent or invalid throws BindingRejectedError. */
  binding?: DispatchBindingEnvelope;
}

export type InitLedgerResult =
  | { ok: true; ledger: ProgressLedgerV1; path: string }
  | { ok: false; reason: string };

/** Create the cell's ledger from its oracle list. Refuses an oracle-less cell. */
export function initProgressLedger(input: InitLedgerInput): InitLedgerResult {
  assertWritableBinding({ root: input.cwd, run_id: input.run_id, binding_ref: input.binding?.binding_ref });
  const check = validateDoneWhen(input.done_when);
  if (doneWhenRefused(check)) return { ok: false, reason: check.reason };
  const now = (input.now ?? (() => new Date().toISOString()))();
  const ledger: ProgressLedgerV1 = {
    schema_version: PROGRESS_LEDGER_SCHEMA,
    cell_id: input.cell_id,
    run_id: input.run_id,
    logical_task_id: input.logical_task_id,
    ...(input.assignment_id === undefined ? {} : { assignment_id: input.assignment_id }),
    updated_at: now,
    items: check.items.map((i) => ({ id: i.id, state: "pending" as const, oracle: i.oracle })),
  };
  const rel = progressLedgerPath({
    run_id: input.run_id,
    logical_task_id: input.logical_task_id,
    guildDir: input.guildDir,
  });
  const abs = path.resolve(input.cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  return { ok: true, ledger, path: rel };
}

export function readProgressLedger(input: {
  cwd: string;
  run_id: string;
  logical_task_id: string;
  guildDir?: string;
}): ProgressLedgerV1 | null {
  const abs = path.resolve(input.cwd, progressLedgerPath(input));
  try {
    return validateProgressLedgerV1(JSON.parse(fs.readFileSync(abs, "utf8")));
  } catch {
    return null;
  }
}

export interface RecordOracleInput {
  cwd: string;
  run_id: string;
  logical_task_id: string;
  item_id: string;
  state: LedgerItemState;
  last_failure?: CellLastFailure;
  now?: () => string;
  guildDir?: string;
  /** The caller's verified run binding (CD9); absent or invalid throws BindingRejectedError. */
  binding?: DispatchBindingEnvelope;
}

export type RecordOracleResult =
  | { ok: true; ledger: ProgressLedgerV1 }
  | { ok: false; reason: string };

/** Settle one oracle. Unknown item ids fail closed rather than being appended. */
export function recordOracleOutcome(input: RecordOracleInput): RecordOracleResult {
  assertWritableBinding({ root: input.cwd, run_id: input.run_id, binding_ref: input.binding?.binding_ref });
  const ledger = readProgressLedger(input);
  if (!ledger) return { ok: false, reason: "no readable guild.progress_ledger.v1 for this cell" };
  const item = ledger.items.find((i) => i.id === input.item_id);
  if (!item) {
    return {
      ok: false,
      reason:
        `${input.item_id} is not a declared done_when oracle on this cell — ` +
        `the ledger never grows a new acceptance test at run time`,
    };
  }
  item.state = input.state;
  ledger.updated_at = (input.now ?? (() => new Date().toISOString()))();
  if (input.last_failure !== undefined) ledger.last_failure = input.last_failure;
  const abs = path.resolve(input.cwd, progressLedgerPath(input));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  return { ok: true, ledger };
}

export type CellDoneCheck = { ok: true } | { ok: false; reason: string; pending: string[] };

/**
 * The gate. Cell done iff it HAS oracles and every one is `pass` or
 * `skip-recorded`. `skip-recorded` counts because a host that cannot run the
 * inner verify records the loss rather than silently passing (KTD28) — the loss
 * is on the record, so the outer qa gate still sees it.
 */
export function cellCanGoDone(ledger: ProgressLedgerV1 | null): CellDoneCheck {
  if (!ledger) {
    return {
      ok: false,
      reason: "no guild.progress_ledger.v1 on disk — a cell with no oracles cannot go done (R46)",
      pending: [],
    };
  }
  if (ledger.items.length === 0) {
    return {
      ok: false,
      reason: "guild.progress_ledger.v1 declares zero oracles — a cell with no oracles cannot go done (R46)",
      pending: [],
    };
  }
  const pending = ledger.items
    .filter((i) => i.state !== "pass" && i.state !== "skip-recorded")
    .map((i) => `${i.id}:${i.state}`);
  if (pending.length > 0) {
    return { ok: false, reason: `done_when oracles unsettled: ${pending.join(", ")}`, pending };
  }
  return { ok: true };
}

/**
 * Is this ledger the one THIS assignment's oracles belong to?
 *
 * Three bindings, all REQUIRED, because each alone has a hole:
 *
 *  - **The assignment declares oracles or it cannot be done.** Checked first and
 *    unconditionally, so no ledger on disk can release an oracle-less dispatch.
 *  - **The ledger names THIS assignment.** `assignment_id` must be present and
 *    equal. Treating it as "checked when present" made the binding opt-in: a
 *    ledger written without one bound to every dispatch for that logical task.
 *  - **The oracle set matches by id AND KIND.** Ids alone let a ledger settle
 *    `verify.after_edit` for an oracle the assignment declared as a `command` —
 *    the same name discharged by a weaker check.
 */
export function ledgerBoundToAssignment(
  ledger: ProgressLedgerV1 | null,
  assignment: TaskAssignmentV2,
): CellDoneCheck {
  const expectedId = assignmentId(assignment);
  const declared = readDoneWhen(assignment);
  if (doneWhenRefused(declared)) {
    return {
      ok: false,
      reason:
        `${declared.reason} (assignment ${expectedId}) — no ledger on disk can ` +
        `release a cell whose own assignment declared no oracles.`,
      pending: [],
    };
  }
  if (!ledger) {
    return { ok: false, reason: `no guild.progress_ledger.v1 for assignment ${expectedId}`, pending: [] };
  }
  // `assignment_id` is REQUIRED, not "checked when present". An absent id used to
  // bind to any assignment, which made the whole check opt-in: a ledger written
  // without one released every dispatch for that logical task.
  if (typeof ledger.assignment_id !== "string" || ledger.assignment_id.length === 0) {
    return {
      ok: false,
      reason:
        `ledger carries no assignment_id — refusing to bind it to ${expectedId}. ` +
        `An unbound ledger is evidence for no dispatch in particular.`,
      pending: [],
    };
  }
  if (ledger.assignment_id !== expectedId) {
    return {
      ok: false,
      reason:
        `ledger belongs to assignment ${ledger.assignment_id}, not ${expectedId} — ` +
        `refusing to release this attempt on another attempt's evidence.`,
      pending: [],
    };
  }
  // Compare the oracle SET by id AND KIND. Matching ids alone let a ledger claim
  // `verify.after_edit` passed for an oracle the assignment declared as a
  // `command` — the same name settled by a weaker check.
  const fmt = (xs: ReadonlyArray<{ id: string; oracle: string }>) =>
    xs.map((x) => `${x.id}:${x.oracle}`).sort();
  const want = fmt(declared.items);
  const have = fmt(ledger.items);
  if (want.length !== have.length || want.some((x, i) => x !== have[i])) {
    return {
      ok: false,
      reason:
        `ledger oracles [${have.join(", ")}] do not match this assignment's ` +
        `done_when [${want.join(", ")}] (compared by id AND kind) — the ledger ` +
        `settles a different dispatch (assignment ${expectedId}).`,
      pending: [],
    };
  }
  return { ok: true };
}

/** Narrowing predicate for the blocked arm (see `capRefused` for why). */
export function cellBlocked(
  check: CellDoneCheck,
): check is Extract<CellDoneCheck, { ok: false }> {
  return !check.ok;
}

/** Frozen so a consumer cannot mutate the closed enums it is handed. */
export const PROGRESS_LEDGER_CONTRACT = deepFreeze({
  schema: PROGRESS_LEDGER_SCHEMA,
  oracle_kinds: DONE_WHEN_ORACLE_KINDS,
  item_states: LEDGER_ITEM_STATES,
  last_failures: CELL_LAST_FAILURES,
});

// ── CD9 · typed executable oracles over the unchanged ledger path ────────────
//
// A typed target travels in the existing `target` string as the CANONICAL JSON
// encoding of its object (keys sorted, no insignificant whitespace). The legacy
// readers above compare id + kind only, so they accept these strings unchanged.

/** Upper bound on a `command` oracle's runtime (ms). */
export const EXECUTABLE_COMMAND_TIMEOUT_MAX_MS = 600_000;

/** The oracle kinds an E00 controller can settle from its own evidence. */
export const EXECUTABLE_ORACLE_KINDS = frozenList(["command", "artifact_exists", "acceptance_record"] as const);
export type ExecutableOracleKind = (typeof EXECUTABLE_ORACLE_KINDS)[number];

export interface CommandOracleTarget { argv: string[]; cwd: string; timeout_ms: number }
export interface ArtifactExistsOracleTarget { path: string; sha256: string | null }
export interface AcceptanceRecordOracleTarget { logical_task_id: string }

export type ExecutableTargetValue = CommandOracleTarget | ArtifactExistsOracleTarget | AcceptanceRecordOracleTarget;

export type DecodeExecutableTargetResult =
  | { ok: true; kind: ExecutableOracleKind; value: ExecutableTargetValue }
  | { ok: false; reason: string };

/** CD9 canonical encoding: sorted keys, no insignificant whitespace, UTF-8. */
export function canonicalOracleJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalOracleJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalOracleJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

/** A normalized, relative, non-escaping POSIX path (no `..`, no leading `/`, no `.`-only). */
function isSafeRelativePath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0 || p.includes("\0") || p.includes("\\")) return false;
  if (path.posix.isAbsolute(p)) return false;
  const normalized = path.posix.normalize(p);
  if (normalized !== p || normalized === "." || normalized === ".." || normalized.startsWith("../")) return false;
  return true;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Parse one typed target. The string must be JSON whose canonical re-encoding
 * reproduces it byte-for-byte, with the exact closed key set and types of its
 * kind. Scope and dependency membership are checked by validateExecutableDoneWhen.
 */
export function decodeExecutableTarget(kind: string, target: unknown): DecodeExecutableTargetResult {
  if (!(EXECUTABLE_ORACLE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, reason: "oracle_kind_unsupported_in_e00" };
  }
  if (typeof target !== "string" || target.length === 0) return { ok: false, reason: "oracle_target_missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(target);
  } catch {
    return { ok: false, reason: "oracle_target_not_json" };
  }
  if (canonicalOracleJson(parsed) !== target) return { ok: false, reason: "oracle_target_not_canonical" };
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "oracle_target_not_object" };
  }
  const o = parsed as Record<string, unknown>;
  const bad = (reason: string): DecodeExecutableTargetResult => ({ ok: false, reason });
  if (kind === "command") {
    if (!exactKeys(o, ["argv", "cwd", "timeout_ms"])) return bad("command_target_keys");
    const argv = o["argv"];
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === "string" && a.length > 0)) {
      return bad("command_argv_invalid");
    }
    if (!isSafeRelativePath(o["cwd"])) return bad("command_cwd_invalid");
    const timeout = o["timeout_ms"];
    if (!Number.isInteger(timeout) || (timeout as number) <= 0 || (timeout as number) > EXECUTABLE_COMMAND_TIMEOUT_MAX_MS) {
      return bad("command_timeout_invalid");
    }
    return { ok: true, kind, value: { argv: [...argv] as string[], cwd: o["cwd"] as string, timeout_ms: timeout as number } };
  }
  if (kind === "artifact_exists") {
    if (!exactKeys(o, ["path", "sha256"])) return bad("artifact_target_keys");
    if (!isSafeRelativePath(o["path"])) return bad("artifact_path_invalid");
    const digest = o["sha256"];
    if (digest !== null && (typeof digest !== "string" || !SHA256_HEX.test(digest))) return bad("artifact_sha256_invalid");
    return { ok: true, kind, value: { path: o["path"] as string, sha256: digest as string | null } };
  }
  if (!exactKeys(o, ["logical_task_id"])) return bad("acceptance_target_keys");
  const id = o["logical_task_id"];
  if (typeof id !== "string" || id.length === 0) return bad("acceptance_logical_task_id_invalid");
  return { ok: true, kind: "acceptance_record", value: { logical_task_id: id } };
}

/** True when `rel` equals a scope path or lies under it (both safe relative paths). */
function insideScope(rel: string, scopePaths: readonly string[]): boolean {
  return scopePaths.some((scope) => {
    if (!isSafeRelativePath(scope)) return false;
    return rel === scope || rel.startsWith(`${scope}/`);
  });
}

export interface ExecutableDoneWhenContext {
  scope_paths: readonly string[];
  dependencies: ReadonlyArray<{ logical_task_id: string }>;
}

export type ExecutableDoneWhenCheck =
  | { ok: true; items: ReadonlyArray<DoneWhenItem & { target: string; value: ExecutableTargetValue }> }
  | { ok: false; reason: string; item_id?: string };

/**
 * The E00 admission check (CD9): the legacy validateDoneWhen floor, then every
 * item decoded as a typed executable oracle. named_check and verify.after_edit
 * refuse with oracle_kind_unsupported_in_e00 (the controller has no runner for
 * them). command cwd and artifact path must lie inside scope_paths;
 * acceptance_record must name one of the assignment's dependencies.
 */
export function validateExecutableDoneWhen(doneWhen: unknown, ctx: ExecutableDoneWhenContext): ExecutableDoneWhenCheck {
  const floor = validateDoneWhen(doneWhen);
  if (doneWhenRefused(floor)) return { ok: false, reason: floor.reason };
  const out: Array<DoneWhenItem & { target: string; value: ExecutableTargetValue }> = [];
  for (const item of floor.items) {
    if (!(EXECUTABLE_ORACLE_KINDS as readonly string[]).includes(item.oracle)) {
      return { ok: false, reason: "oracle_kind_unsupported_in_e00", item_id: item.id };
    }
    const decoded = decodeExecutableTarget(item.oracle, item.target);
    if (!decoded.ok) return { ok: false, reason: decoded.reason, item_id: item.id };
    if (decoded.kind === "command" && !insideScope((decoded.value as CommandOracleTarget).cwd, ctx.scope_paths)) {
      return { ok: false, reason: "command_cwd_outside_scope", item_id: item.id };
    }
    if (decoded.kind === "artifact_exists" && !insideScope((decoded.value as ArtifactExistsOracleTarget).path, ctx.scope_paths)) {
      return { ok: false, reason: "artifact_path_outside_scope", item_id: item.id };
    }
    if (
      decoded.kind === "acceptance_record" &&
      !ctx.dependencies.some((d) => d.logical_task_id === (decoded.value as AcceptanceRecordOracleTarget).logical_task_id)
    ) {
      return { ok: false, reason: "acceptance_record_not_a_dependency", item_id: item.id };
    }
    out.push({ ...item, target: item.target as string, value: decoded.value });
  }
  return { ok: true, items: frozenList(out) };
}

/**
 * Read `done_when[]` off an assignment.
 *
 * It is an ADDITIVE field on `guild.task_assignment.v2` rather than a member of
 * the frozen D6 floor, so every read goes through here: one place decides that
 * "absent" and "empty" mean the same thing, and neither means "satisfied".
 */
export function readDoneWhen(assignment: unknown): DoneWhenCheck {
  if (assignment === null || typeof assignment !== "object") {
    return { ok: false, reason: "not an assignment object" };
  }
  return validateDoneWhen((assignment as Record<string, unknown>)["done_when"]);
}

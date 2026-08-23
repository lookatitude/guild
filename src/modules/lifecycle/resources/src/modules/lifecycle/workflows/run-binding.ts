/**
 * src/modules/lifecycle/workflows/run-binding.ts
 *
 * Run-binding core — guild.session_context.v1 §5 (frozen 2026-07-30, run
 * run-20260730-131020-dynamic-host-model-routing).
 *
 * Every runtime write (trace, telemetry, catalog, resolution, receipts,
 * checkpoints) carries an explicit run binding: `run_id` + `binding_ref`, an
 * unforgeable nonce minted at run start and revoked at run close. Writers FAIL
 * CLOSED when the binding is absent, closed, mismatched, or unverifiable: no
 * write, a structured `binding_rejected` diagnostic, non-zero result to the
 * caller.
 *
 * Sentinel demotion (§5, SC-1): the workspace-global sentinels — BOTH
 * `.guild/runs/current-run-id` (legacy) and `.guild/current-run-id` (B2) — are
 * interactive command intake convenience ONLY. `locateCandidateRunId()` may
 * surface a CANDIDATE run for a user-typed command; a sentinel value never
 * authorizes a runtime write and never serves as a fallback binding in
 * concurrent execution paths. Moving the sentinel mid-run cannot redirect an
 * in-flight write, because writes resolve through the binding, never the
 * sentinel.
 */

import * as crypto from "crypto";
import * as fsReal from "fs";
import * as path from "path";
import { initStableLockfile, withStableLock } from "./stable-lock";

// ── Schema ───────────────────────────────────────────────────────────────────

export interface RunBindingRecord {
  schema_version: "guild.run_binding.v1";
  run_id: string;
  /** Unforgeable nonce reference minted at run start (§5). */
  binding_ref: string;
  state: "open" | "closed";
}

/** Reasons a write-authorization check refuses (all map to `binding_rejected`). */
export type BindingRejectReason =
  | "binding_absent" // caller supplied no run_id / binding_ref
  | "binding_unverifiable" // no root to verify against
  | "binding_not_minted" // no binding record exists for the run
  | "binding_malformed" // a record exists but fails schema validation — closed, never writable
  | "binding_closed" // run closed; nonce revoked
  | "binding_mismatch"; // nonce does not match the run's minted binding

export type BindingVerdict =
  | { ok: true; binding: RunBindingRecord }
  | { ok: false; diagnostic: "binding_rejected"; reason: BindingRejectReason };

/** Thrown by assertWritableBinding — the structured fail-closed signal (§5). */
export class BindingRejectedError extends Error {
  readonly diagnostic = "binding_rejected" as const;
  constructor(
    readonly reason: BindingRejectReason,
    readonly run_id: string | undefined
  ) {
    super(`binding_rejected (${reason}) for run ${run_id ?? "<absent>"}`);
    this.name = "BindingRejectedError";
  }
}

// ── Fs seam (shape-compatible with RunLifecycleEnv["fs"]) ────────────────────

export interface BindingFs {
  mkdirp(absPath: string): void;
  writeFile(absPath: string, contents: string): void;
  /** Create a new file without replacing an existing inode. */
  writeFileExclusive?(absPath: string, contents: string): boolean;
  readFile(absPath: string): string | null;
  exists(absPath: string): boolean;
}

function realBindingFs(): BindingFs {
  return {
    mkdirp: (p) => fsReal.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fsReal.writeFileSync(p, c, "utf8"),
    writeFileExclusive: (p, c) => {
      fsReal.mkdirSync(path.dirname(p), { recursive: true });
      try {
        fsReal.writeFileSync(p, c, { encoding: "utf8", flag: "wx" });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw error;
      }
    },
    readFile: (p) => (fsReal.existsSync(p) ? fsReal.readFileSync(p, "utf8") : null),
    exists: (p) => fsReal.existsSync(p),
  };
}

export function runBindingPath(root: string, runId: string): string {
  return path.join(root, ".guild", "runs", runId, "binding.json");
}

export const PENDING_SUBSTANTIVE_OPERATION_SCHEMA = "guild.pending_substantive_operation.v1" as const;

export interface PendingSubstantiveOperationRecord {
  readonly schema_version: typeof PENDING_SUBSTANTIVE_OPERATION_SCHEMA;
  readonly state: "pending" | "complete";
  readonly run_id: string;
  readonly task_id: string;
}

export function pendingSubstantiveOperationPath(root: string, runId: string): string {
  return path.join(root, ".guild", "runs", runId, "capability", "pending-substantive-operation.json");
}

function readPendingSubstantiveOperation(root: string, runId: string, fs: BindingFs): PendingSubstantiveOperationRecord | null {
  const raw = fs.readFile(pendingSubstantiveOperationPath(root, runId));
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("pending substantive operation marker is malformed"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("pending substantive operation marker is malformed");
  const record = value as Record<string, unknown>;
  if (record.schema_version !== PENDING_SUBSTANTIVE_OPERATION_SCHEMA
    || (record.state !== "pending" && record.state !== "complete")
    || record.run_id !== runId
    || typeof record.task_id !== "string" || record.task_id.length === 0 || record.task_id.length > 192) {
    throw new Error("pending substantive operation marker is malformed");
  }
  return record as unknown as PendingSubstantiveOperationRecord;
}

function writePendingSubstantiveOperation(root: string, record: PendingSubstantiveOperationRecord, fs: BindingFs): void {
  const target = pendingSubstantiveOperationPath(root, record.run_id);
  fs.mkdirp(path.dirname(target));
  fs.writeFile(target, `${JSON.stringify(record, null, 2)}\n`);
}

/** Caller must already hold withRunBindingExclusion for this run. */
export function stagePendingSubstantiveOperation(opts: RunBindingLocator & { readonly task_id: string }): void {
  const fs = opts.fs ?? realBindingFs();
  const prior = readPendingSubstantiveOperation(opts.root, opts.run_id, fs);
  if (prior?.state === "pending" && prior.task_id !== opts.task_id) {
    throw new Error(`pending substantive operation for ${prior.task_id} must be recovered before ${opts.task_id}`);
  }
  if (prior?.state === "pending") return;
  writePendingSubstantiveOperation(opts.root, {
    schema_version: PENDING_SUBSTANTIVE_OPERATION_SCHEMA,
    state: "pending",
    run_id: opts.run_id,
    task_id: opts.task_id,
  }, fs);
}

/** Caller must already hold withRunBindingExclusion for this run. */
export function completePendingSubstantiveOperation(opts: RunBindingLocator & { readonly task_id: string }): void {
  const fs = opts.fs ?? realBindingFs();
  const prior = readPendingSubstantiveOperation(opts.root, opts.run_id, fs);
  if (!prior || prior.task_id !== opts.task_id) throw new Error("pending substantive operation completion has no matching transaction");
  if (prior.state === "complete") return;
  writePendingSubstantiveOperation(opts.root, { ...prior, state: "complete" }, fs);
}

/** Close-time fail-closed barrier; call while holding withRunBindingExclusion. */
export function assertNoPendingSubstantiveOperation(opts: RunBindingLocator): void {
  const record = readPendingSubstantiveOperation(opts.root, opts.run_id, opts.fs ?? realBindingFs());
  if (record?.state === "pending") {
    throw new Error(`pending substantive operation for ${record.task_id} must be recovered before lifecycle close`);
  }
}

/**
 * Serialize a lifecycle-state transition with every receipt-producing runtime
 * write for the same run. Both close and compatibility reads use this exact
 * exclusion domain, so a receipt linearizes wholly before close or is refused
 * wholly after it; there is no post-hoc journal cleanup path.
 */
export function withRunBindingExclusion<T>(
  root: string,
  runId: string,
  fn: () => T,
): T {
  if (!/^run-[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/.test(runId)) {
    throw new Error(`run-binding exclusion: invalid run id ${JSON.stringify(runId)}`);
  }
  // Fail before withStableLock initializes logs/.lock. A refused operation for
  // a nonexistent or malformed run must not manufacture a phantom run tree.
  const persisted = readRunBindingRecord({ root, run_id: runId });
  if (persisted.status === "absent") throw new BindingRejectedError("binding_not_minted", runId);
  if (persisted.status === "malformed") throw new BindingRejectedError("binding_malformed", runId);
  return withStableLock(path.join(root, ".guild", "runs", runId), fn);
}

/** Initialize the permanent exclusion inode as part of a successful run start. */
export function initializeRunBindingExclusion(root: string, runId: string): void {
  if (!/^run-[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/.test(runId)) {
    throw new Error(`run-binding exclusion: invalid run id ${JSON.stringify(runId)}`);
  }
  initStableLockfile(path.join(root, ".guild", "runs", runId));
}

// ── Mint / load / close ──────────────────────────────────────────────────────

export interface RunBindingLocator {
  root: string;
  run_id: string;
  fs?: BindingFs;
}

/**
 * Mint the run's binding at run start. One mint per run: re-minting an
 * existing binding (open OR closed) throws — a closed run must never be
 * re-authorized, and an open run's nonce must never rotate mid-run (that
 * would orphan in-flight holders). Resume RESTORES the existing record via
 * loadRunBinding; it never re-mints.
 */
export function mintRunBinding(opts: RunBindingLocator): RunBindingRecord {
  const fs = opts.fs ?? realBindingFs();
  const p = runBindingPath(opts.root, opts.run_id);
  if (fs.exists(p)) {
    throw new Error(
      `run-binding: a binding for ${opts.run_id} is already minted — ` +
        `resume restores it (loadRunBinding); it is never re-minted`
    );
  }
  const record: RunBindingRecord = {
    schema_version: "guild.run_binding.v1",
    run_id: opts.run_id,
    binding_ref: `rb-${crypto.randomBytes(16).toString("hex")}`,
    state: "open",
  };
  fs.mkdirp(path.dirname(p));
  const contents = JSON.stringify(record, null, 2) + "\n";
  // Production adapters publish the binding with O_EXCL. The preliminary
  // exists check above improves the normal diagnostic but is not the race
  // control: only this exclusive create makes one same-ID starter the owner.
  const created = fs.writeFileExclusive
    ? fs.writeFileExclusive(p, contents)
    : !fs.exists(p) && (fs.writeFile(p, contents), true);
  if (!created) {
    throw new Error(
      `run-binding: a binding for ${opts.run_id} is already minted — ` +
        `resume restores it (loadRunBinding); it is never re-minted`
    );
  }
  return record;
}

/**
 * Full schema validation of a persisted `guild.run_binding.v1` record (T3
 * rework F1). Every field is checked against the frozen §5 contract:
 * exact schema_version, run_id exactly equal to the locator's run, a non-empty
 * `rb-`-prefixed nonce string, and the CLOSED `open | closed` state enum. Any
 * deviation is MALFORMED — never partially trusted, never repaired.
 */
export function validateRunBindingRecord(
  parsed: unknown,
  expectedRunId: string
): RunBindingRecord | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (o["schema_version"] !== "guild.run_binding.v1") return null;
  if (typeof o["run_id"] !== "string" || o["run_id"] !== expectedRunId) return null;
  const ref = o["binding_ref"];
  if (typeof ref !== "string" || !/^rb-[A-Za-z0-9_-]+$/.test(ref)) return null;
  if (o["state"] !== "open" && o["state"] !== "closed") return null;
  return {
    schema_version: "guild.run_binding.v1",
    run_id: o["run_id"],
    binding_ref: ref,
    state: o["state"],
  };
}

/** Tri-state read used by the verifier: absent vs malformed vs a valid record. */
export type RunBindingReadResult =
  | { status: "absent" }
  | { status: "malformed" }
  | { status: "ok"; record: RunBindingRecord };

/**
 * Read + fully validate the run's persisted binding record. A record that
 * exists but fails ANY schema check (unparseable JSON, wrong schema_version,
 * run_id not exactly this run, non-nonce binding_ref, a state outside the
 * closed `open | closed` enum) is `malformed` — treated as CLOSED by every
 * consumer: it never authorizes a write and is never "repaired" (F1).
 */
export function readRunBindingRecord(opts: RunBindingLocator): RunBindingReadResult {
  const fs = opts.fs ?? realBindingFs();
  const raw = fs.readFile(runBindingPath(opts.root, opts.run_id));
  if (raw === null) return { status: "absent" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "malformed" };
  }
  const record = validateRunBindingRecord(parsed, opts.run_id);
  if (record === null) return { status: "malformed" };
  return { status: "ok", record };
}

/**
 * Read the run's frozen binding record (resume path), or null when none.
 * Schema-validates on load (F1): a malformed persisted record loads as null —
 * REJECTED at read time exactly like an absent one; the structured
 * malformed-vs-absent distinction is available via readRunBindingRecord.
 */
export function loadRunBinding(opts: RunBindingLocator): RunBindingRecord | null {
  const read = readRunBindingRecord(opts);
  return read.status === "ok" ? read.record : null;
}

/**
 * Revoke the binding at run close (§5). Idempotent: closing an already-closed
 * or never-minted binding is a no-op (there is nothing left to revoke). A
 * MALFORMED record is also left as-is: it already fails every verification
 * (binding_malformed — closed-equivalent), and fabricating a well-formed
 * "closed" record over unverifiable content would be a repair (§3 forbids).
 */
export function closeRunBinding(opts: RunBindingLocator): void {
  const fs = opts.fs ?? realBindingFs();
  const record = loadRunBinding(opts);
  if (record === null || record.state === "closed") return;
  fs.writeFile(
    runBindingPath(opts.root, opts.run_id),
    JSON.stringify({ ...record, state: "closed" }, null, 2) + "\n"
  );
}

/**
 * Re-open a CLOSED binding for the run-reopen transition (reopen-on-activity:
 * the Stop hook detected tool activity AFTER an earlier close — the run was
 * not genuinely done, so the RUN reopens and its binding state follows).
 *
 * This is NOT a re-authorization loophole; every fail-closed property holds:
 *   - the caller must present the run's OWN exact nonce (mismatch → throw);
 *   - the persisted record must be fully schema-valid (malformed → throw —
 *     never repaired);
 *   - an absent record cannot be conjured (not-minted → throw);
 *   - the nonce is never rotated and never re-minted.
 * A stray writer without the nonce still cannot write, reopen, or redirect.
 * Idempotent when the record is already open.
 */
export function reopenRunBinding(opts: RunBindingLocator, binding_ref: string): RunBindingRecord {
  return withRunBindingExclusion(opts.root, opts.run_id, () =>
    reopenRunBindingUnderExclusion(opts, binding_ref));
}

function reopenRunBindingUnderExclusion(
  opts: RunBindingLocator,
  binding_ref: string,
): RunBindingRecord {
  const fs = opts.fs ?? realBindingFs();
  const read = readRunBindingRecord(opts);
  if (read.status === "absent") throw new BindingRejectedError("binding_not_minted", opts.run_id);
  if (read.status === "malformed") throw new BindingRejectedError("binding_malformed", opts.run_id);
  const record = read.record;
  if (record.binding_ref !== binding_ref) {
    throw new BindingRejectedError("binding_mismatch", opts.run_id);
  }
  if (record.state === "open") return record;
  const reopened: RunBindingRecord = { ...record, state: "open" };
  fs.writeFile(runBindingPath(opts.root, opts.run_id), JSON.stringify(reopened, null, 2) + "\n");
  return reopened;
}

// ── Verification (writers fail closed) ───────────────────────────────────────

export interface VerifyRunBindingInput {
  run_id?: string;
  binding_ref?: string;
  root?: string;
  fs?: BindingFs;
}

/**
 * Verify a caller-presented binding against the run's minted record. Never
 * throws — returns a structured verdict; absent/unverifiable inputs are
 * rejections, not errors (writers branch on `ok`).
 */
export function verifyRunBinding(input: VerifyRunBindingInput): BindingVerdict {
  const reject = (reason: BindingRejectReason): BindingVerdict => ({
    ok: false,
    diagnostic: "binding_rejected",
    reason,
  });
  if (!input.run_id || !input.binding_ref) return reject("binding_absent");
  if (!input.root) return reject("binding_unverifiable");
  const read = readRunBindingRecord({ root: input.root, run_id: input.run_id, fs: input.fs });
  if (read.status === "absent") return reject("binding_not_minted");
  // F1: a malformed persisted record is CLOSED, not writable — a structured
  // rejection, never a pass-through of partially-validated content.
  if (read.status === "malformed") return reject("binding_malformed");
  const record = read.record;
  if (record.state === "closed") return reject("binding_closed");
  if (record.binding_ref !== input.binding_ref || record.run_id !== input.run_id) {
    return reject("binding_mismatch");
  }
  return { ok: true, binding: record };
}

/**
 * Fail-closed gate for core writers: returns the open binding or throws
 * BindingRejectedError (`diagnostic: "binding_rejected"`). No write may
 * proceed past a throw.
 */
export function assertWritableBinding(input: VerifyRunBindingInput): RunBindingRecord {
  const verdict = verifyRunBinding(input);
  if (verdict.ok === false) throw new BindingRejectedError(verdict.reason, input.run_id);
  return verdict.binding;
}

// T3 rework F2: the former `guardRunWrite` migration guard (which allowed an
// "open-unreferenced" write for a minted open run and a "legacy" write for a
// run with no binding record) is DELETED. There is no migration posture that
// authorizes a runtime write without an explicit verified binding: every core
// writer calls assertWritableBinding with the caller-threaded nonce, and a
// caller that cannot present one is refused (`binding_absent`) — even for a
// freshly minted open run. Legacy runs are migrated or refused, never
// grandfathered past verification.

// ── Sentinel: interactive intake ONLY (§5) ───────────────────────────────────

export interface IntakeCandidate {
  run_id: string;
  source: "sentinel-legacy" | "sentinel-b2";
  /**
   * Type-level demotion marker: this value may seed a user-facing question
   * ("resume run-x?") and NOTHING else. It is never a write authorization and
   * never a fallback binding.
   */
  intake_only: true;
}

/**
 * Locate a CANDIDATE run id for interactive command intake from the two
 * historical sentinel locations (legacy first, then B2). Read-only; the
 * result must be confirmed by the operator and then bound via the run's
 * minted binding — it never flows into verifyRunBinding as a substitute.
 */
export function locateCandidateRunId(root: string, fs?: BindingFs): IntakeCandidate | null {
  const f = fs ?? realBindingFs();
  const candidates: Array<[string, IntakeCandidate["source"]]> = [
    [path.join(root, ".guild", "runs", "current-run-id"), "sentinel-legacy"],
    [path.join(root, ".guild", "current-run-id"), "sentinel-b2"],
  ];
  for (const [p, source] of candidates) {
    const raw = f.readFile(p);
    const runId = raw?.trim();
    if (runId) return { run_id: runId, source, intake_only: true };
  }
  return null;
}

// ── Hook-facing contract (published for T3b — do not fork this shape) ────────

/**
 * ## Hook-facing run-binding contract (consumed by hooks/, lane T3b)
 *
 * Hooks receive the binding through the process environment of the bound run:
 *
 *   - `GUILD_RUN_ID`          — the run this process is bound to;
 *   - `GUILD_RUN_BINDING_REF` — the nonce minted by mintRunBinding at start.
 *
 * Hook-side writers MUST resolve their run identity from this envelope and
 * verify it via verifyRunBinding (or the compiled equivalent) BEFORE any
 * write; on a non-ok verdict they emit the `binding_rejected` diagnostic and
 * exit non-zero without writing. The sentinel files may still be read for
 * interactive command intake (locateCandidateRunId semantics) but never as a
 * fallback run identity for a write.
 */
export const HOOK_BINDING_ENV_RUN_ID = "GUILD_RUN_ID" as const;
export const HOOK_BINDING_ENV_BINDING_REF = "GUILD_RUN_BINDING_REF" as const;

export interface HookBindingEnvelope {
  run_id: string;
  binding_ref: string;
}

/**
 * Parse the hook binding envelope from an env map. Returns null when either
 * key is absent/empty — the hook then FAILS CLOSED for writes (it may still
 * perform read-only intake work).
 */
export function readHookBindingEnvelope(
  env: Record<string, string | undefined>
): HookBindingEnvelope | null {
  const run_id = env[HOOK_BINDING_ENV_RUN_ID]?.trim();
  const binding_ref = env[HOOK_BINDING_ENV_BINDING_REF]?.trim();
  if (!run_id || !binding_ref) return null;
  return { run_id, binding_ref };
}

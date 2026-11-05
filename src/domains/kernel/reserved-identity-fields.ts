/**
 * Field names the v2 execution-identity contracts (R01, contract bundle
 * guild.stack.contract_bundle.v2) own: every top-level property of the six
 * identity records plus the lineage keys. A v1 record that carries one was
 * written for a package v1 cannot represent, so v1 readers refuse it rather
 * than drop the field. Each reader passes the fields its own v1 schema
 * already owns (`legacyFields`) so a shared name is never refused by mistake.
 * execution-identity.test.ts derives this set independently from the frozen
 * contracts and fails on drift.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { checkContained, isRefused, prepareContainedWrite } from "./path-containment";

export const RESERVED_IDENTITY_FIELDS = Object.freeze([
  // logical-run
  "source_id", "run_id", "initiative_id", "parent_run", "created_at", "phase", "initial_command", "initial_prompt_ref",
  "controller", "workflow_hash", "settings_hash", "execution_refs", "goal_refs", "state",
  // execution-segment
  "lineage", "original_host_id", "host_session_id", "issued_controller_epoch", "adapter_capability_hash", "pins",
  "admission", "interval", "observation_manifest", "seal_evidence",
  // task-assignment v3
  "assignment_hash", "result_scope_hash", "grant_id", "goal_contributions", "input_refs",
  // stack task-attempt
  "assignment_ref", "ordinal", "result_refs", "acceptance_subject_hash", "accepted_by_controller_epoch",
  "receipt_loss_reconciled", "uncertain_effects",
  // run-binding v2
  "controller_source_id", "controller_host_id", "controller_epoch", "writer_grant_id", "writer_scope_hash",
  "logical_run_manifest_hash",
  // execution-lineage receipt
  "run_schema", "requested_host", "observed_host", "requested_model", "observed_identity", "authority",
  "attempt_grant_ref", "handoffs", "evidence",
  // lineage keys
  "execution_id", "goal_id", "logical_task_id", "attempt_id", "agent_instance_id", "request_id",
] as const);

export function reservedIdentityFieldsIn(record: unknown, legacyFields: readonly string[]): string[] {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return [];
  return RESERVED_IDENTITY_FIELDS.filter((f) => !legacyFields.includes(f) && Object.prototype.hasOwnProperty.call(record, f));
}

// ── Run kind: the one exclusion both run writer families claim ───────────────

export const RUN_KIND_FILE = "run-kind.json";
/** Mirrors lifecycle LOGICAL_RUN_MANIFEST_RELPATH (kernel cannot import lifecycle). */
const RUN_KIND_V2_MANIFEST_RELPATH = path.join("lineage", "logical-run.json");
type RunKind = "v1" | "v2";

export class RunKindConflictError extends Error {
  constructor(readonly runDir: string, readonly claimed: RunKind, readonly existing: RunKind | "unreadable" | "uncontained") {
    super(`run ${path.basename(runDir)} is already a ${existing} run; it cannot become ${claimed}`);
    this.name = "RunKindConflictError";
  }
}

export function parseRunKind(raw: string | null): RunKind | "unreadable" | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v["schema_version"] === "guild.run_kind.v1" && (v["kind"] === "v1" || v["kind"] === "v2") && Object.keys(v).length === 2) return v["kind"];
  } catch { /* fall through */ }
  return "unreadable";
}

/** The run's claimed kind, or null for a run created before the marker existed. Never follows a final symlink. */
export function readRunKind(runDir: string): RunKind | "unreadable" | null {
  const file = path.join(runDir, RUN_KIND_FILE);
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "unreadable";
  }
  try {
    return parseRunKind(fs.readFileSync(fd, "utf8"));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Check-only variant for writers that go through an injected fs seam (which
 * cannot do an exclusive claim): refuses when the run is recorded as the other
 * kind, or — for a v1 writer — when a v2 manifest exists.
 */
export function assertRunKindAllows(
  runDir: string,
  kind: RunKind,
  io: { readFile(absPath: string): string | null; exists(absPath: string): boolean },
): void {
  const existing = parseRunKind(io.readFile(path.join(runDir, RUN_KIND_FILE)));
  if (existing !== null && existing !== kind) throw new RunKindConflictError(runDir, kind, existing);
  if (kind === "v1" && io.exists(path.join(runDir, RUN_KIND_V2_MANIFEST_RELPATH))) throw new RunKindConflictError(runDir, kind, "v2");
}

/** <root>/.guild/runs/<id> → <root>; otherwise the run dir's parent bounds containment. */
function containmentRootFor(runDir: string): string {
  const runs = path.dirname(runDir);
  const guild = path.dirname(runs);
  return path.basename(runs) === "runs" && path.basename(guild) === ".guild" ? path.dirname(guild) : runs;
}

/**
 * Claim the run's kind before writing any binding or manifest. The marker is
 * created under physical containment (no symlinked ancestor) and published
 * write-once (temp file + link), so of two writers of different kinds exactly
 * one wins and the other throws RunKindConflictError; nothing is deleted.
 * Re-claiming the same kind is a no-op.
 */
export function claimRunKind(runDir: string, kind: RunKind): void {
  const root = containmentRootFor(path.resolve(runDir));
  const rel = path.relative(root, path.join(path.resolve(runDir), RUN_KIND_FILE));
  const prepared = prepareContainedWrite(root, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(prepared)) throw new RunKindConflictError(runDir, kind, "uncontained");
  const file = prepared.realPath;
  const dir = path.dirname(file);
  const bytes = Buffer.from(`${JSON.stringify({ schema_version: "guild.run_kind.v1", kind })}\n`, "utf8");
  let created = false;
  const tmp = path.join(dir, `.${RUN_KIND_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
    try {
      let off = 0;
      while (off < bytes.length) off += fs.writeSync(fd, bytes, off, bytes.length - off);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.linkSync(tmp, file);
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  const after = checkContained(root, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(after) || after.realPath !== file) {
    // No linkat/openat in Node: an ancestor swapped around link(2) can redirect
    // it. Withdraw what this call published there.
    if (created) fs.rmSync(file, { force: true });
    throw new RunKindConflictError(runDir, kind, "uncontained");
  }
  const existing = readRunKind(dir);
  if (existing !== kind) throw new RunKindConflictError(runDir, kind, existing ?? "unreadable");
}

/**
 * src/domains/lifecycle/followup-transfer.ts — R04 exclusive follow-up
 * transfer with recovery (AT15, AT16).
 *
 * The source owns the transfer. Its work item carries a disposition chain
 * under `.guild/runs/<run>/work/<kind>/<id>/disposition/`: write-once entries
 * `open → transfer_reserved → transferred | released`, each naming the
 * revision (sha256 of the bytes) of the entry before it. Reserving appends the
 * next sequence number with link(2), so it is a CAS on the expected
 * disposition revision: of any number of claimants for one revision exactly
 * one links the entry, and a `transferred` head is terminal, so at most one
 * destination ever activates.
 *
 * Stages, each write-once and resumable by replaying the same request:
 *   intent → reserve (source CAS) → target prepare (not executable) →
 *   source commit (disposition `transferred`) → target activate → target ack →
 *   source records the ack. The source's clean close waits for that last step.
 * Every source write is authorized by the R02 run controller with a writer
 * grant (fenced by epoch); the controller's single lease serializes source
 * writers. Target writes are deterministic bytes, so a replay is a no-op.
 * A target that cannot be reached is reported `recovery_needed`, never
 * committed or acknowledged.
 *
 * Shareable bytes hold relative paths and hashes only: the target root is
 * recorded as a digest of its real path, and no grant nonce is serialized.
 * Trust: cooperative local. Records under `.guild/` are validated, chained and
 * cross-checked on every read, but they are not keyed; a same-user process that
 * rewrites them coherently is out of model.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalizeRealPath } from "../kernel";
import { ControllerRefusal, readControllerJournal, type ControlAction, type RunController, type WriterGrant } from "./run-controller";
import type { Entity, Evidence, Hash } from "./execution-identity";
import { DurableOnceError, canonicalJson, hashOf, listOnce, publishOnce, readOnce } from "./durable-once";

export const FOLLOWUP_TRANSFER_SCHEMA = "guild.followup_transfer.v1" as const;
export const WORK_DISPOSITION_SCHEMA = "guild.work_disposition.v1" as const;
export const TRANSFER_INTENT_SCHEMA = "guild.followup_transfer_intent.v1" as const;
export const FOLLOWUP_INBOUND_SCHEMA = "guild.followup_inbound.v1" as const;

export type TransferState = "reserved" | "target_prepared" | "source_committed" | "target_activated" | "acknowledged" | "recovery_needed" | "aborted";

/** The frozen A02 `guild.followup_transfer.v1` shape. */
export interface FollowupTransferV1 {
  schema_version: typeof FOLLOWUP_TRANSFER_SCHEMA;
  operation_id: string;
  source_work: Entity;
  expected_disposition_revision: Hash;
  reserved_disposition_revision: Hash;
  destination_work: Entity;
  destination_policy_hash: Hash;
  payload_hash: Hash;
  state: TransferState;
  source_commit: Evidence | null;
  target_activation: Evidence | null;
  target_ack: Evidence | null;
  prepared_target_executable: false;
  recorded_at: string;
}

/** Points where a test (or a fault injector) can stop the protocol. */
export const TRANSFER_POINTS = [
  "intent", "reserve_receipt", "reserve_link", "reserve", "reserved_record",
  "prepare", "prepared_record",
  "commit_receipt", "source_commit", "source_committed_record",
  "activate", "activated_record",
  "target_ack", "ack_receipt", "ack",
] as const;
export type TransferPoint = (typeof TRANSFER_POINTS)[number];

export type TransferRefusalCode =
  | "request_invalid"
  | "operation_conflict"
  | "journal_corrupt"
  | "controller_refused"
  | "already_committed"
  | "not_reserved"
  | "storage_refused";

export class TransferRefusal extends Error {
  constructor(readonly code: TransferRefusalCode, detail: string) {
    super(`follow-up transfer refused (${code}): ${detail}`);
    this.name = "TransferRefusal";
  }
}

export interface TransferRequest {
  operation_id: string;
  source_work: Entity;
  expected_disposition_revision: Hash;
  destination_work: Entity;
  destination_policy_hash: Hash;
  payload: unknown;
}
export interface TransferPorts {
  controller: RunController;
  grant: WriterGrant;
  /** Source project root (holds the source `.guild/`). */
  sourceRoot: string;
  /** Destination project root. */
  targetRoot: string;
  now?: () => number;
  /** Fault-injection seam: called at each TRANSFER_POINTS step; a throw stops the protocol there. */
  at?: (point: TransferPoint) => void;
}
export type TransferOutcomeReason = "disposition_conflict" | "reservation_lost" | "aborted" | "target_unreachable" | "target_conflict" | null;
export interface TransferResult {
  state: TransferState;
  record: FollowupTransferV1;
  refusal: TransferOutcomeReason;
}

// ── validation of the frozen shape ───────────────────────────────────────────

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Ids that become path segments: no ':' (relative_path forbids it), bounded so suffixed controller ids stay ≤128. */
const SEG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const HASH_RE = /^sha256:[a-f0-9]{64}$/;
const REL_RE = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\\%\x00-\x1f])[^:]+$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const KINDS = new Set(["initiative", "run", "execution", "host_session", "goal", "logical_task", "task_attempt", "agent_instance", "request", "operation", "decision", "workflow", "component", "invocation", "obligation", "memory", "knowledge", "candidate", "agent", "skill", "tool", "team", "loop", "config", "evaluation", "report", "benchmark_case", "transfer", "query"]);
const STATES = new Set<TransferState>(["reserved", "target_prepared", "source_committed", "target_activated", "acknowledged", "recovery_needed", "aborted"]);
const RECORD_KEYS = ["schema_version", "operation_id", "source_work", "expected_disposition_revision", "reserved_disposition_revision", "destination_work", "destination_policy_hash", "payload_hash", "state", "source_commit", "target_activation", "target_ack", "prepared_target_executable", "recorded_at"];
const EVIDENCE_KEYS = ["source_id", "path", "sha256", "schema_version", "observed_at", "availability", "reason"];
const ENTITY_KEYS = ["source_id", "kind", "id", "revision"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exactKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const isTime = (v: unknown) => typeof v === "string" && TIME_RE.test(v) && !Number.isNaN(Date.parse(v));
const isText = (v: unknown) => typeof v === "string" && v.length >= 1 && v.length <= 4096;
function entityOk(v: unknown): boolean {
  return isObj(v) && exactKeys(v, ENTITY_KEYS) && typeof v.source_id === "string" && ID_RE.test(v.source_id)
    && typeof v.kind === "string" && KINDS.has(v.kind) && typeof v.id === "string" && ID_RE.test(v.id)
    && typeof v.revision === "string" && HASH_RE.test(v.revision);
}
function evidenceOk(v: unknown): boolean {
  return isObj(v) && exactKeys(v, EVIDENCE_KEYS) && typeof v.source_id === "string" && ID_RE.test(v.source_id)
    && typeof v.path === "string" && v.path.length >= 1 && v.path.length <= 1024 && REL_RE.test(v.path)
    && typeof v.sha256 === "string" && HASH_RE.test(v.sha256) && isText(v.schema_version) && isTime(v.observed_at)
    && ["available", "expired", "redacted", "missing", "unsupported"].includes(v.availability as string)
    && (v.reason === null || isText(v.reason));
}
/** Historical prerequisite: a retained hash may be expired/redacted with a reason; missing/unsupported never satisfies it. */
function disclosed(e: unknown): boolean {
  if (!isObj(e)) return false;
  return e.availability === "available" || ((e.availability === "expired" || e.availability === "redacted") && typeof e.reason === "string" && e.reason.length > 0);
}

/** Validate against the frozen A02 schema and its semantic rule for this contract. */
export function validateFollowupTransfer(v: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(v) || !exactKeys(v, RECORD_KEYS)) return { ok: false, errors: ["followup_transfer: fields must be exactly the v1 set"] };
  if (v.schema_version !== FOLLOWUP_TRANSFER_SCHEMA) errors.push("schema_version");
  if (typeof v.operation_id !== "string" || !ID_RE.test(v.operation_id)) errors.push("operation_id");
  if (!entityOk(v.source_work)) errors.push("source_work");
  if (!entityOk(v.destination_work)) errors.push("destination_work");
  for (const k of ["expected_disposition_revision", "reserved_disposition_revision", "destination_policy_hash", "payload_hash"]) {
    if (typeof v[k] !== "string" || !HASH_RE.test(v[k] as string)) errors.push(k);
  }
  if (!STATES.has(v.state as TransferState)) errors.push("state");
  for (const k of ["source_commit", "target_activation", "target_ack"]) if (v[k] !== null && !evidenceOk(v[k])) errors.push(k);
  if (v.prepared_target_executable !== false) errors.push("prepared_target_executable");
  if (!isTime(v.recorded_at)) errors.push("recorded_at");
  if (errors.length) return { ok: false, errors };
  const order = ["reserved", "target_prepared", "source_committed", "target_activated", "acknowledged"];
  const i = order.indexOf(v.state as string);
  if (i >= 2 && !disclosed(v.source_commit)) errors.push("activation without retained source commit evidence");
  if (i >= 3 && !disclosed(v.target_activation)) errors.push("activation evidence absent or unavailable");
  if (i === 4 && !disclosed(v.target_ack)) errors.push("source completion needs retained target ack evidence");
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ── paths ────────────────────────────────────────────────────────────────────

const WORK_KINDS = new Set(["logical_task", "goal"]);
const seg = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !SEG_RE.test(v)) throw new TransferRefusal("request_invalid", `${what} must match ${SEG_RE}`);
  return v;
};
const dispositionDir = (run: string, w: Entity) => path.join(".guild", "runs", run, "work", w.kind, w.id, "disposition");
const dispositionFile = (run: string, w: Entity, seq: number) => path.join(dispositionDir(run, w), `${String(seq).padStart(6, "0")}.json`);
const transferDir = (run: string, op: string) => path.join(".guild", "runs", run, "transfers", op);
const STAGE_FILES = { reserved: "01-reserved.json", target_prepared: "02-target_prepared.json", source_committed: "03-source_committed.json", target_activated: "04-target_activated.json", acknowledged: "05-acknowledged.json", aborted: "aborted.json" } as const;
type StageName = keyof typeof STAGE_FILES;
const inboundDir = (source_id: string, op: string) => path.join(".guild", "transfers", "inbound", source_id, op);
const toPosix = (p: string) => p.split(path.sep).join("/");

/** The target root is recorded only as a digest of its real path. */
export function targetRootDigest(targetRoot: string): Hash {
  return hashOf(`guild.transfer_target\0${canonicalizeRealPath(targetRoot)}`);
}

function storage<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof DurableOnceError) throw new TransferRefusal("storage_refused", e.message);
    throw e;
  }
}

// ── disposition chain ────────────────────────────────────────────────────────

/** `closed` is written by work closure: terminal, so a closed work can never be reserved. */
export type DispositionState = "open" | "transfer_reserved" | "transferred" | "released" | "closed";
export interface DispositionEntry {
  schema_version: typeof WORK_DISPOSITION_SCHEMA;
  source_id: string;
  run_id: string;
  work: Entity;
  seq: number;
  prev_revision: Hash | null;
  state: DispositionState;
  operation_id: string | null;
  intent_hash: Hash | null;
  destination_work: Entity | null;
  target_root_digest: Hash | null;
  prepared_sha256: Hash | null;
}
export interface DispositionView {
  entries: DispositionEntry[];
  revisions: Hash[];
  head_revision: Hash | null;
}
const DISPOSITION_KEYS = ["schema_version", "source_id", "run_id", "work", "seq", "prev_revision", "state", "operation_id", "intent_hash", "destination_work", "target_root_digest", "prepared_sha256"];
const MAX_DISPOSITION_ENTRIES = 1000;
const entryBytes = (e: DispositionEntry) => Buffer.from(`${canonicalJson(e)}\n`, "utf8");
const corrupt = (detail: string): never => { throw new TransferRefusal("journal_corrupt", detail); };
const sameEntity = (a: unknown, b: Entity) => canonicalJson(a) === canonicalJson(b);

function checkWork(run_id: string, work: Entity): void {
  seg(run_id, "run_id");
  if (!entityOk(work) || !WORK_KINDS.has(work.kind)) throw new TransferRefusal("request_invalid", "work must be a logical_task or goal entity");
  seg(work.source_id, "work.source_id");
  seg(work.id, "work.id");
}

/** Read and verify the source work's disposition chain. */
export function readWorkDisposition(sourceRoot: string, run_id: string, work: Entity): DispositionView {
  checkWork(run_id, work);
  const root = path.resolve(sourceRoot);
  const names = storage(() => listOnce(root, dispositionDir(run_id, work), MAX_DISPOSITION_ENTRIES));
  const entries: DispositionEntry[] = [];
  const revisions: Hash[] = [];
  names.forEach((name, i) => {
    if (name !== `${String(i).padStart(6, "0")}.json`) corrupt(`disposition chain has a gap or a foreign file at ${name}`);
    const raw = storage(() => readOnce(root, dispositionFile(run_id, work, i)));
    if (raw === null) corrupt(`disposition entry ${i} unreadable`);
    let e: DispositionEntry;
    try { e = JSON.parse(raw!) as DispositionEntry; } catch { return corrupt(`disposition entry ${i} is not JSON`); }
    if (!isObj(e) || !exactKeys(e as unknown as Record<string, unknown>, DISPOSITION_KEYS) || e.schema_version !== WORK_DISPOSITION_SCHEMA) corrupt(`disposition entry ${i} shape`);
    if (raw !== entryBytes(e).toString("utf8")) corrupt(`disposition entry ${i} is not canonical`);
    if (e.source_id !== work.source_id || e.run_id !== run_id || !sameEntity(e.work, work) || e.seq !== i) corrupt(`disposition entry ${i} identity`);
    if (e.prev_revision !== (i === 0 ? null : revisions[i - 1])) corrupt(`disposition entry ${i} breaks the chain`);
    const prev = i === 0 ? null : entries[i - 1]!;
    const carried = prev !== null && e.operation_id === prev.operation_id && e.intent_hash === prev.intent_hash
      && canonicalJson(e.destination_work) === canonicalJson(prev.destination_work) && e.target_root_digest === prev.target_root_digest;
    const opFields = typeof e.operation_id === "string" && SEG_RE.test(e.operation_id) && typeof e.intent_hash === "string" && HASH_RE.test(e.intent_hash)
      && entityOk(e.destination_work) && typeof e.target_root_digest === "string" && HASH_RE.test(e.target_root_digest);
    const ok =
      e.state === "open" ? i === 0 && e.operation_id === null && e.intent_hash === null && e.destination_work === null && e.target_root_digest === null && e.prepared_sha256 === null
      : e.state === "transfer_reserved" ? prev !== null && (prev.state === "open" || prev.state === "released") && opFields && e.prepared_sha256 === null
      : e.state === "transferred" ? prev?.state === "transfer_reserved" && carried && typeof e.prepared_sha256 === "string" && HASH_RE.test(e.prepared_sha256)
      : e.state === "released" ? prev?.state === "transfer_reserved" && carried && e.prepared_sha256 === null
      : e.state === "closed" ? prev !== null && (prev.state === "open" || prev.state === "released" || prev.state === "transferred")
        && typeof e.operation_id === "string" && SEG_RE.test(e.operation_id) && typeof e.intent_hash === "string" && HASH_RE.test(e.intent_hash)
        && e.destination_work === null && e.target_root_digest === null && e.prepared_sha256 === null
      : false;
    if (!ok) corrupt(`disposition entry ${i} is not a valid ${String(e.state)} transition`);
    entries.push(e);
    revisions.push(hashOf(raw!));
  });
  return { entries, revisions, head_revision: revisions.length ? revisions[revisions.length - 1]! : null };
}

/** Create (or re-read) the work's genesis `open` entry. Returns its revision. */
export function openWorkDisposition(sourceRoot: string, run_id: string, work: Entity): Hash {
  checkWork(run_id, work);
  const root = path.resolve(sourceRoot);
  const genesis: DispositionEntry = {
    schema_version: WORK_DISPOSITION_SCHEMA, source_id: work.source_id, run_id, work, seq: 0, prev_revision: null, state: "open",
    operation_id: null, intent_hash: null, destination_work: null, target_root_digest: null, prepared_sha256: null,
  };
  storage(() => publishOnce(root, dispositionFile(run_id, work, 0), entryBytes(genesis)));
  const view = readWorkDisposition(root, run_id, work);
  return view.revisions[0]!;
}

function appendDisposition(root: string, run_id: string, work: Entity, view: DispositionView, next: Omit<DispositionEntry, "schema_version" | "source_id" | "run_id" | "work" | "seq" | "prev_revision">, beforeLink?: () => void):
  { won: true; revision: Hash } | { won: false; existing: DispositionEntry } {
  const seq = view.entries.length;
  const e: DispositionEntry = { schema_version: WORK_DISPOSITION_SCHEMA, source_id: work.source_id, run_id, work, seq, prev_revision: view.head_revision, ...next };
  const bytes = entryBytes(e);
  const r = storage(() => publishOnce(root, dispositionFile(run_id, work, seq), bytes, beforeLink));
  const after = readWorkDisposition(root, run_id, work);
  const landed = after.entries[seq];
  if (!landed) return corrupt(`disposition entry ${seq} vanished`);
  if (r.created || canonicalJson(landed) === canonicalJson(e)) return { won: true, revision: after.revisions[seq]! };
  return { won: false, existing: landed };
}

/**
 * The reservation CAS: append `transfer_reserved` iff the head revision equals
 * `expected_revision` and the head is `open` or `released`. Exactly one of any
 * number of concurrent callers for one revision wins.
 */
export function reserveWorkDisposition(
  sourceRoot: string,
  run_id: string,
  work: Entity,
  r: { operation_id: string; expected_revision: Hash; intent_hash: Hash; destination_work: Entity; target_root_digest: Hash },
  beforeLink?: () => void,
): { outcome: "reserved" | "already"; revision: Hash } | { outcome: "conflict" } {
  const root = path.resolve(sourceRoot);
  const view = readWorkDisposition(root, run_id, work);
  const mine = view.entries.findIndex((e) => e.state === "transfer_reserved" && e.operation_id === r.operation_id && e.intent_hash === r.intent_hash);
  if (mine >= 0) return { outcome: "already", revision: view.revisions[mine]! };
  const head = view.entries[view.entries.length - 1];
  if (!head || view.head_revision !== r.expected_revision || (head.state !== "open" && head.state !== "released")) return { outcome: "conflict" };
  const res = appendDisposition(root, run_id, work, view, {
    state: "transfer_reserved", operation_id: r.operation_id, intent_hash: r.intent_hash, destination_work: r.destination_work,
    target_root_digest: r.target_root_digest, prepared_sha256: null,
  }, beforeLink);
  return res.won ? { outcome: "reserved", revision: res.revision } : { outcome: "conflict" };
}

// ── intent ───────────────────────────────────────────────────────────────────

interface TransferIntent {
  schema_version: typeof TRANSFER_INTENT_SCHEMA;
  operation_id: string;
  source_id: string;
  run_id: string;
  source_work: Entity;
  expected_disposition_revision: Hash;
  destination_work: Entity;
  destination_policy_hash: Hash;
  payload_hash: Hash;
  target_root_digest: Hash;
}
const MAX_PAYLOAD_BYTES = 256 * 1024;
const intentBytes = (i: TransferIntent) => Buffer.from(`${canonicalJson(i)}\n`, "utf8");

function readIntent(root: string, run_id: string, op: string): { intent: TransferIntent; hash: Hash } | null {
  const raw = storage(() => readOnce(root, path.join(transferDir(run_id, op), "intent.json")));
  if (raw === null) return null;
  let i: TransferIntent;
  try { i = JSON.parse(raw) as TransferIntent; } catch { return corrupt(`intent for ${op} is not JSON`); }
  if (!isObj(i) || i.schema_version !== TRANSFER_INTENT_SCHEMA || i.operation_id !== op || i.run_id !== run_id || raw !== intentBytes(i).toString("utf8")
    || !entityOk(i.source_work) || !entityOk(i.destination_work) || !HASH_RE.test(String(i.target_root_digest))) corrupt(`intent for ${op} is invalid`);
  return { intent: i, hash: hashOf(raw) };
}

// ── inbound (target) records ─────────────────────────────────────────────────

interface InboundPrepared {
  schema_version: typeof FOLLOWUP_INBOUND_SCHEMA; stage: "prepared"; operation_id: string; source_id: string; source_run_id: string;
  source_work: Entity; reserved_disposition_revision: Hash; intent_hash: Hash; destination_work: Entity;
  destination_policy_hash: Hash; payload_hash: Hash; payload: unknown; executable: false;
}
interface InboundActivated {
  schema_version: typeof FOLLOWUP_INBOUND_SCHEMA; stage: "activated"; operation_id: string; source_id: string;
  prepared_sha256: Hash; source_commit_sha256: Hash; executable: true;
}
interface InboundAck { schema_version: typeof FOLLOWUP_INBOUND_SCHEMA; stage: "ack"; operation_id: string; source_id: string; activated_sha256: Hash }
const inboundBytes = (v: unknown) => Buffer.from(`${canonicalJson(v)}\n`, "utf8");
/** The only activation bytes a committed transfer can have: fully determined by the source journal. */
function activatedBytesFor(i: TransferIntent, preparedSha: Hash, commitRev: Hash): Buffer {
  const a: InboundActivated = { schema_version: FOLLOWUP_INBOUND_SCHEMA, stage: "activated", operation_id: i.operation_id, source_id: i.source_id, prepared_sha256: preparedSha, source_commit_sha256: commitRev, executable: true };
  return inboundBytes(a);
}
function ackBytesFor(i: TransferIntent, activatedSha: Hash): Buffer {
  const k: InboundAck = { schema_version: FOLLOWUP_INBOUND_SCHEMA, stage: "ack", operation_id: i.operation_id, source_id: i.source_id, activated_sha256: activatedSha };
  return inboundBytes(k);
}

class TargetUnreachable extends Error {}
function rootReachable(targetRoot: string): boolean {
  try { return fs.statSync(targetRoot).isDirectory(); } catch { return false; }
}
/** Run a target-side step; I/O and containment failures mean the target is unreachable, never a success. */
function onTarget<T>(targetRoot: string, fn: () => T): T {
  if (!rootReachable(targetRoot)) throw new TargetUnreachable("target root missing or not a directory");
  try {
    return fn();
  } catch (e) {
    if (e instanceof DurableOnceError || (e instanceof Error && typeof (e as NodeJS.ErrnoException).code === "string" && !(e instanceof TransferRefusal))) {
      throw new TargetUnreachable(e.message);
    }
    throw e;
  }
}

// ── stage records ────────────────────────────────────────────────────────────

const iso = (ms: number) => new Date(ms).toISOString();
/** Stage record identity ignores the wall-clock fields. */
const stageIdentity = (r: FollowupTransferV1) => canonicalJson({
  ...r, recorded_at: null,
  source_commit: r.source_commit && { ...r.source_commit, observed_at: null },
  target_activation: r.target_activation && { ...r.target_activation, observed_at: null },
  target_ack: r.target_ack && { ...r.target_ack, observed_at: null },
});

function readStage(root: string, intent: TransferIntent, stage: StageName): FollowupTransferV1 | null {
  const raw = storage(() => readOnce(root, path.join(transferDir(intent.run_id, intent.operation_id), STAGE_FILES[stage])));
  if (raw === null) return null;
  let r: FollowupTransferV1;
  try { r = JSON.parse(raw) as FollowupTransferV1; } catch { return corrupt(`${stage} record is not JSON`); }
  const v = validateFollowupTransfer(r);
  if (!v.ok) corrupt(`${stage} record invalid: ${v.errors.join("; ")}`);
  if (r.state !== stage || r.operation_id !== intent.operation_id || !sameEntity(r.source_work, intent.source_work) || !sameEntity(r.destination_work, intent.destination_work)
    || r.expected_disposition_revision !== intent.expected_disposition_revision || r.destination_policy_hash !== intent.destination_policy_hash || r.payload_hash !== intent.payload_hash) {
    corrupt(`${stage} record does not match the transfer intent`);
  }
  return r;
}

interface Ctx {
  root: string;
  targetRoot: string;
  intent: TransferIntent;
  intentHash: Hash;
  ports: TransferPorts;
  now: () => number;
}

function authorize(ctx: Ctx, step: "reserve" | "prepared" | "commit" | "activated" | "ack" | "abort", action: ControlAction): void {
  try {
    ctx.ports.controller.control(ctx.ports.grant, { operation_id: `${ctx.intent.operation_id}.${step}`, action, subject: `xfer.${ctx.intentHash.slice(7, 47)}` });
  } catch (e) {
    if (e instanceof ControllerRefusal) throw new TransferRefusal("controller_refused", `${e.code}: ${e.message}`);
    throw e;
  }
}

function buildRecord(ctx: Ctx, state: TransferState, reserved: Hash, ev: Pick<FollowupTransferV1, "source_commit" | "target_activation" | "target_ack">): FollowupTransferV1 {
  const i = ctx.intent;
  return {
    schema_version: FOLLOWUP_TRANSFER_SCHEMA, operation_id: i.operation_id, source_work: i.source_work,
    expected_disposition_revision: i.expected_disposition_revision, reserved_disposition_revision: reserved,
    destination_work: i.destination_work, destination_policy_hash: i.destination_policy_hash, payload_hash: i.payload_hash,
    state, source_commit: ev.source_commit, target_activation: ev.target_activation, target_ack: ev.target_ack,
    prepared_target_executable: false, recorded_at: iso(ctx.now()),
  };
}

const AUTH_FOR: Record<StageName, ["reserve" | "prepared" | "commit" | "activated" | "ack" | "abort", ControlAction]> = {
  reserved: ["reserve", "schedule"], target_prepared: ["prepared", "schedule"], source_committed: ["commit", "release"],
  target_activated: ["activated", "schedule"], acknowledged: ["ack", "accept"], aborted: ["abort", "close"],
};

function writeStage(ctx: Ctx, stage: StageName, reserved: Hash, ev: Pick<FollowupTransferV1, "source_commit" | "target_activation" | "target_ack">): FollowupTransferV1 {
  const existing = readStage(ctx.root, ctx.intent, stage);
  const want = buildRecord(ctx, stage, reserved, ev);
  if (existing) {
    if (stageIdentity(existing) !== stageIdentity(want)) corrupt(`${stage} record disagrees with the journal`);
    return existing;
  }
  const v = validateFollowupTransfer(want);
  if (!v.ok) throw new TransferRefusal("request_invalid", `would emit an invalid ${stage} record: ${v.errors.join("; ")}`);
  authorize(ctx, ...AUTH_FOR[stage]);
  const rel = path.join(transferDir(ctx.intent.run_id, ctx.intent.operation_id), STAGE_FILES[stage]);
  const r = storage(() => publishOnce(ctx.root, rel, Buffer.from(`${JSON.stringify(want, null, 2)}\n`, "utf8")));
  if (r.created) return want;
  const landed = readStage(ctx.root, ctx.intent, stage);
  if (!landed || stageIdentity(landed) !== stageIdentity(want)) corrupt(`${stage} record raced with different content`);
  return landed!;
}

function evidence(source_id: string, rel: string, sha: Hash, schema: string, ms: number): Evidence {
  return { source_id, path: toPosix(rel), sha256: sha, schema_version: schema, observed_at: iso(ms), availability: "available", reason: null };
}

const NONE = { source_commit: null, target_activation: null, target_ack: null };

// ── protocol ─────────────────────────────────────────────────────────────────

function validateRequest(req: TransferRequest, ports: TransferPorts): { intent: TransferIntent; payload: unknown } {
  if (!isObj(req)) throw new TransferRefusal("request_invalid", "request must be an object");
  seg(req.operation_id, "operation_id");
  const run_id = seg(ports.controller.run_id, "run_id");
  checkWork(run_id, req.source_work);
  if (req.source_work.source_id !== ports.controller.source_id) throw new TransferRefusal("request_invalid", "source work belongs to another source");
  if (!entityOk(req.destination_work) || !WORK_KINDS.has(req.destination_work.kind)) throw new TransferRefusal("request_invalid", "destination must be a logical_task or goal entity");
  seg(req.destination_work.source_id, "destination_work.source_id");
  for (const k of ["expected_disposition_revision", "destination_policy_hash"] as const) {
    if (typeof req[k] !== "string" || !HASH_RE.test(req[k])) throw new TransferRefusal("request_invalid", `${k} must be a sha256 hash`);
  }
  if (canonicalizeRealPath(ports.targetRoot) === canonicalizeRealPath(ports.sourceRoot)) throw new TransferRefusal("request_invalid", "destination root is the source root");
  let text: string;
  try { text = canonicalJson(req.payload); } catch { throw new TransferRefusal("request_invalid", "payload must be JSON"); }
  if (text === undefined || Buffer.byteLength(text) > MAX_PAYLOAD_BYTES) throw new TransferRefusal("request_invalid", "payload missing or over the size bound");
  const intent: TransferIntent = {
    schema_version: TRANSFER_INTENT_SCHEMA, operation_id: req.operation_id, source_id: req.source_work.source_id, run_id,
    source_work: req.source_work, expected_disposition_revision: req.expected_disposition_revision,
    destination_work: req.destination_work, destination_policy_hash: req.destination_policy_hash,
    payload_hash: hashOf(text), target_root_digest: targetRootDigest(ports.targetRoot),
  };
  return { intent, payload: JSON.parse(text) };
}

function abortWith(ctx: Ctx, reserved: Hash, refusal: TransferOutcomeReason): TransferResult {
  const prior = latestStage(ctx);
  const record = writeStage(ctx, "aborted", reserved, prior ? { source_commit: prior.source_commit, target_activation: prior.target_activation, target_ack: prior.target_ack } : NONE);
  return { state: "aborted", record, refusal };
}

/**
 * The whole source journal, verified: stages are contiguous, every record
 * matches the intent and its one reservation, evidence once recorded is
 * carried unchanged, and every evidence hash joins the disposition chain (the
 * source commit) or the bytes that chain determines (target activation and
 * ack). Returns the latest record.
 */
function latestStage(ctx: Ctx): FollowupTransferV1 | null {
  const i = ctx.intent;
  const order = ["reserved", "target_prepared", "source_committed", "target_activated", "acknowledged"] as const;
  const recs = order.map((s) => readStage(ctx.root, i, s));
  if (!recs.some(Boolean)) return null;
  const view = readWorkDisposition(ctx.root, i.run_id, i.source_work);
  const ri = view.entries.findIndex((e) => e.state === "transfer_reserved" && e.operation_id === i.operation_id && e.intent_hash === ctx.intentHash);
  if (ri < 0) corrupt(`${i.operation_id} journal has no reservation in the disposition chain`);
  const ti = view.entries.findIndex((e) => e.state === "transferred" && e.operation_id === i.operation_id && e.intent_hash === ctx.intentHash);
  const commit = ti >= 0 ? { rel: toPosix(dispositionFile(i.run_id, i.source_work, ti)), rev: view.revisions[ti]!, prepared: view.entries[ti]!.prepared_sha256! } : null;
  const inbound = inboundDir(i.source_id, i.operation_id);
  const activatedSha = commit ? hashOf(activatedBytesFor(i, commit.prepared, commit.rev)) : null;
  const ackSha = activatedSha ? hashOf(ackBytesFor(i, activatedSha)) : null;
  const joins = (e: Evidence | null, source_id: string, rel: string, sha: Hash | null, schema: string) =>
    e === null || (sha !== null && e.source_id === source_id && e.path === rel && e.sha256 === sha && e.schema_version === schema && e.availability === "available");
  let last: FollowupTransferV1 | null = null;
  recs.forEach((r, k) => {
    if (!r) return;
    if (k > 0 && !recs[k - 1]) corrupt(`${order[k]} recorded without ${order[k - 1]}`);
    if (r.reserved_disposition_revision !== view.revisions[ri]) corrupt(`${order[k]} names another reservation`);
    if (k >= 2 && !commit) corrupt(`${order[k]} recorded without a source commit`);
    const dest = i.destination_work.source_id;
    if (!joins(r.source_commit, i.source_id, commit?.rel ?? "", commit?.rev ?? null, WORK_DISPOSITION_SCHEMA)
      || !joins(r.target_activation, dest, toPosix(path.join(inbound, "activated.json")), activatedSha, FOLLOWUP_INBOUND_SCHEMA)
      || !joins(r.target_ack, dest, toPosix(path.join(inbound, "ack.json")), ackSha, FOLLOWUP_INBOUND_SCHEMA)) {
      corrupt(`${order[k]} evidence does not join the disposition chain`);
    }
    if (last) {
      for (const f of ["source_commit", "target_activation", "target_ack"] as const) {
        if (last[f] !== null && canonicalJson(r[f]) !== canonicalJson(last[f])) corrupt(`${order[k]} rewrote ${f}`);
      }
    }
    last = r;
  });
  return last;
}

function recovery(ctx: Ctx, reserved: Hash, refusal: TransferOutcomeReason): TransferResult {
  const prior = latestStage(ctx);
  const record = buildRecord(ctx, "recovery_needed", reserved, prior ? { source_commit: prior.source_commit, target_activation: prior.target_activation, target_ack: prior.target_ack } : NONE);
  return { state: "recovery_needed", record, refusal };
}

/**
 * Drive a transfer as far as it can go. Replaying the same request resumes it
 * from whatever was durably written; a different payload under the same
 * operation id is refused. Throws TransferRefusal on refusals and propagates
 * any fault thrown by `ports.at`.
 */
export function runTransfer(req: TransferRequest, ports: TransferPorts): TransferResult {
  const { intent, payload } = validateRequest(req, ports);
  const root = path.resolve(ports.sourceRoot);
  const targetRoot = path.resolve(ports.targetRoot);
  const at = ports.at ?? (() => {});
  const now = ports.now ?? Date.now;
  const op = intent.operation_id;
  const run_id = intent.run_id;
  const work = intent.source_work;

  const ib = intentBytes(intent);
  const pub = storage(() => publishOnce(root, path.join(transferDir(run_id, op), "intent.json"), ib));
  if (!pub.created && pub.existing !== ib.toString("utf8")) throw new TransferRefusal("operation_conflict", `${op} already names a different transfer`);
  const ctx: Ctx = { root, targetRoot, intent, intentHash: hashOf(ib), ports, now };
  at("intent");

  const done = readStage(root, intent, "aborted");
  if (done) return { state: "aborted", record: done, refusal: "aborted" };

  // Reserve: CAS on the expected disposition revision.
  let view = readWorkDisposition(root, run_id, work);
  const findMine = (v: DispositionView, state: DispositionState) => {
    const i = v.entries.findIndex((e) => e.state === state && e.operation_id === op);
    if (i >= 0 && v.entries[i]!.intent_hash !== ctx.intentHash) corrupt(`disposition names ${op} with another intent`);
    return i;
  };
  let ri = findMine(view, "transfer_reserved");
  if (ri < 0) {
    const head = view.entries[view.entries.length - 1];
    if (!head || view.head_revision !== intent.expected_disposition_revision || (head.state !== "open" && head.state !== "released")) {
      return abortWith(ctx, intent.expected_disposition_revision, "disposition_conflict");
    }
    authorize(ctx, "reserve", "schedule");
    at("reserve_receipt");
    const r = reserveWorkDisposition(root, run_id, work, {
      operation_id: op, expected_revision: intent.expected_disposition_revision, intent_hash: ctx.intentHash,
      destination_work: intent.destination_work, target_root_digest: intent.target_root_digest,
    }, () => at("reserve_link"));
    if (r.outcome === "conflict") return abortWith(ctx, intent.expected_disposition_revision, "reservation_lost");
    at("reserve");
    view = readWorkDisposition(root, run_id, work);
    ri = findMine(view, "transfer_reserved");
  }
  const reserved = view.revisions[ri]!;
  if (findMine(view, "released") >= 0) return abortWith(ctx, reserved, "aborted");
  writeStage(ctx, "reserved", reserved, NONE);
  at("reserved_record");

  // Target prepare: recorded, never executable.
  const inbound = inboundDir(intent.source_id, op);
  const prepared: InboundPrepared = {
    schema_version: FOLLOWUP_INBOUND_SCHEMA, stage: "prepared", operation_id: op, source_id: intent.source_id, source_run_id: run_id,
    source_work: work, reserved_disposition_revision: reserved, intent_hash: ctx.intentHash, destination_work: intent.destination_work,
    destination_policy_hash: intent.destination_policy_hash, payload_hash: intent.payload_hash, payload, executable: false,
  };
  const pb = inboundBytes(prepared);
  const preparedSha = hashOf(pb);
  const target = <T>(fn: () => T): T | TransferResult => {
    try {
      return onTarget(targetRoot, fn);
    } catch (e) {
      if (e instanceof TargetUnreachable) return recovery(ctx, reserved, "target_unreachable");
      throw e;
    }
  };
  const isResult = (v: unknown): v is TransferResult => isObj(v) && "refusal" in v && "record" in v;

  const prep = target(() => {
    const r = publishOnce(targetRoot, path.join(inbound, "prepared.json"), pb);
    return r.created || r.existing === pb.toString("utf8");
  });
  if (isResult(prep)) return prep;
  if (!prep) return recovery(ctx, reserved, "target_conflict");
  at("prepare");
  writeStage(ctx, "target_prepared", reserved, NONE);
  at("prepared_record");

  // Source commit: the disposition becomes `transferred` (terminal for the source).
  view = readWorkDisposition(root, run_id, work);
  let ti = findMine(view, "transferred");
  if (ti < 0) {
    if (findMine(view, "released") >= 0) return abortWith(ctx, reserved, "aborted");
    if (view.head_revision !== reserved) corrupt(`${op} reservation is not the disposition head`);
    authorize(ctx, "commit", "release");
    at("commit_receipt");
    const res = appendDisposition(root, run_id, work, view, {
      state: "transferred", operation_id: op, intent_hash: ctx.intentHash, destination_work: intent.destination_work,
      target_root_digest: intent.target_root_digest, prepared_sha256: preparedSha,
    });
    if (!res.won) {
      if (res.existing.state === "released" && res.existing.operation_id === op) return abortWith(ctx, reserved, "aborted");
      corrupt(`${op} source commit raced with ${res.existing.state}`);
    }
    at("source_commit");
    view = readWorkDisposition(root, run_id, work);
    ti = findMine(view, "transferred");
  }
  const committed = view.entries[ti]!;
  if (committed.prepared_sha256 !== preparedSha) corrupt(`${op} committed a different prepared target`);
  const commitRev = view.revisions[ti]!;
  const source_commit = evidence(intent.source_id, dispositionFile(run_id, work, ti), commitRev, WORK_DISPOSITION_SCHEMA, now());
  const rc = writeStage(ctx, "source_committed", reserved, { source_commit, target_activation: null, target_ack: null });
  at("source_committed_record");

  // Target activate: only against the committed source and the same prepared bytes.
  const ab = activatedBytesFor(intent, preparedSha, commitRev);
  const act = target(() => {
    if (readOnce(targetRoot, path.join(inbound, "prepared.json")) !== pb.toString("utf8")) return false;
    const r = publishOnce(targetRoot, path.join(inbound, "activated.json"), ab);
    return r.created || r.existing === ab.toString("utf8");
  });
  if (isResult(act)) return act;
  if (!act) return recovery(ctx, reserved, "target_conflict");
  at("activate");
  const destSource = intent.destination_work.source_id;
  const target_activation = evidence(destSource, path.join(inbound, "activated.json"), hashOf(ab), FOLLOWUP_INBOUND_SCHEMA, now());
  const ra = writeStage(ctx, "target_activated", reserved, { source_commit: rc.source_commit, target_activation, target_ack: null });
  at("activated_record");

  // Target ack, then the source retains it.
  const kb = ackBytesFor(intent, hashOf(ab));
  const acked = target(() => {
    if (readOnce(targetRoot, path.join(inbound, "activated.json")) !== ab.toString("utf8")) return false;
    const r = publishOnce(targetRoot, path.join(inbound, "ack.json"), kb);
    return r.created || r.existing === kb.toString("utf8");
  });
  if (isResult(acked)) return acked;
  if (!acked) return recovery(ctx, reserved, "target_conflict");
  at("target_ack");
  const target_ack = evidence(destSource, path.join(inbound, "ack.json"), hashOf(kb), FOLLOWUP_INBOUND_SCHEMA, now());
  if (!readStage(root, intent, "acknowledged")) {
    authorize(ctx, "ack", "accept");
    at("ack_receipt");
  }
  const record = writeStage(ctx, "acknowledged", reserved, { source_commit: ra.source_commit, target_activation: ra.target_activation, target_ack });
  at("ack");
  return { state: "acknowledged", record, refusal: null };
}

/**
 * Abandon a transfer before its source commit: the disposition returns to the
 * source (`released`) and any prepared target stays non-executable forever.
 */
export function abortTransfer(req: { operation_id: string; source_work: Entity }, ports: TransferPorts): TransferResult {
  const op = seg(req.operation_id, "operation_id");
  const run_id = seg(ports.controller.run_id, "run_id");
  checkWork(run_id, req.source_work);
  const root = path.resolve(ports.sourceRoot);
  const found = readIntent(root, run_id, op);
  if (!found) throw new TransferRefusal("not_reserved", `${op} has no transfer intent`);
  if (!sameEntity(found.intent.source_work, req.source_work)) throw new TransferRefusal("operation_conflict", `${op} transfers another work item`);
  const ctx: Ctx = { root, targetRoot: path.resolve(ports.targetRoot), intent: found.intent, intentHash: found.hash, ports, now: ports.now ?? Date.now };
  const done = readStage(root, found.intent, "aborted");
  if (done) return { state: "aborted", record: done, refusal: "aborted" };
  const view = readWorkDisposition(root, run_id, req.source_work);
  const idx = (s: DispositionState) => view.entries.findIndex((e) => e.state === s && e.operation_id === op);
  if (idx("transferred") >= 0) throw new TransferRefusal("already_committed", `${op} source already committed`);
  const ri = idx("transfer_reserved");
  if (ri < 0) return abortWith(ctx, found.intent.expected_disposition_revision, "aborted");
  const reserved = view.revisions[ri]!;
  if (idx("released") < 0) {
    if (view.head_revision !== reserved) corrupt(`${op} reservation is not the disposition head`);
    authorize(ctx, "abort", "close");
    const head = view.entries[ri]!;
    const res = appendDisposition(root, run_id, req.source_work, view, {
      state: "released", operation_id: op, intent_hash: head.intent_hash, destination_work: head.destination_work,
      target_root_digest: head.target_root_digest, prepared_sha256: null,
    });
    if (!res.won) {
      if (res.existing.state === "transferred") throw new TransferRefusal("already_committed", `${op} source committed concurrently`);
      corrupt(`${op} abort raced with ${res.existing.state}`);
    }
  }
  return abortWith(ctx, reserved, "aborted");
}

export interface TransferView {
  /** Furthest stage evidenced on disk (source journal, disposition chain or target files). */
  journal_state: TransferState | "none";
  target_reachable: boolean;
  /** Latest source record; `recovery_needed` when the target cannot be reached before the ack. */
  record: FollowupTransferV1 | null;
}

/** Read-only reconciliation of one transfer across the source and target roots. */
export function reconcileTransfer(opts: { sourceRoot: string; targetRoot: string; source_id: string; run_id: string; operation_id: string }): TransferView | null {
  const op = seg(opts.operation_id, "operation_id");
  const run_id = seg(opts.run_id, "run_id");
  const root = path.resolve(opts.sourceRoot);
  const targetRoot = path.resolve(opts.targetRoot);
  const found = readIntent(root, run_id, op);
  if (!found) return null;
  if (found.intent.source_id !== opts.source_id) corrupt(`${op} intent names another source`);
  const ctx: Ctx = { root, targetRoot, intent: found.intent, intentHash: found.hash, ports: undefined as unknown as TransferPorts, now: Date.now };
  const aborted = readStage(root, found.intent, "aborted");
  const reachable = rootReachable(targetRoot);
  if (aborted) return { journal_state: "aborted", target_reachable: reachable, record: aborted };

  const view = readWorkDisposition(root, run_id, found.intent.source_work);
  const ri = view.entries.findIndex((e) => e.state === "transfer_reserved" && e.operation_id === op);
  if (ri >= 0 && view.entries[ri]!.intent_hash !== found.hash) corrupt(`disposition names ${op} with another intent`);
  const committed = view.entries.some((e) => e.state === "transferred" && e.operation_id === op);
  const latest = latestStage(ctx);
  const inbound = inboundDir(found.intent.source_id, op);
  const ti = view.entries.findIndex((e) => e.state === "transferred" && e.operation_id === op);
  const targetRaw = (f: string): string | null => {
    if (!reachable) return null;
    try { return readOnce(targetRoot, path.join(inbound, f)); } catch { return null; }
  };
  const preparedOk = (): boolean => {
    const raw = targetRaw("prepared.json");
    if (raw === null) return false;
    if (ti >= 0) return hashOf(raw) === view.entries[ti]!.prepared_sha256;
    try {
      const p = JSON.parse(raw) as InboundPrepared;
      return raw === inboundBytes(p).toString("utf8") && p.stage === "prepared" && p.operation_id === op && p.intent_hash === found.hash
        && p.reserved_disposition_revision === view.revisions[ri] && p.executable === false;
    } catch { return false; }
  };
  const activatedOk = (): boolean => ti >= 0 && targetRaw("activated.json") === activatedBytesFor(found.intent, view.entries[ti]!.prepared_sha256!, view.revisions[ti]!).toString("utf8");

  const order: Array<TransferState | "none"> = ["none", "reserved", "target_prepared", "source_committed", "target_activated", "acknowledged"];
  let rank = latest ? order.indexOf(latest.state) : 0;
  const lift = (s: TransferState) => { rank = Math.max(rank, order.indexOf(s)); };
  if (ri >= 0) lift("reserved");
  if (ri >= 0 && preparedOk()) lift("target_prepared");
  if (committed) lift("source_committed");
  if (committed && activatedOk()) lift("target_activated");
  const journal_state = order[rank]!;

  let record = latest;
  if (!record && ri >= 0) record = buildRecord(ctx, "reserved", view.revisions[ri]!, NONE);
  if (record && record.state !== "acknowledged" && !reachable) record = { ...record, state: "recovery_needed", recorded_at: iso(Date.now()) };
  return { journal_state, target_reachable: reachable, record };
}

/**
 * What blocks a clean close of the source work: a reservation in flight, or a
 * committed transfer whose ack the source has not retained. An ack counts only
 * when the whole journal verifies and the run controller's keyed journal holds
 * the ack authorization for this exact intent. Null when free.
 */
export function transferCloseBlocker(sourceRoot: string, run_id: string, work: Entity, controllerPrivateDir: string): { operation_id: string; state: TransferState } | null {
  const root = path.resolve(sourceRoot);
  const view = readWorkDisposition(root, run_id, work);
  const head = view.entries[view.entries.length - 1];
  if (!head || head.state === "open" || head.state === "released" || head.state === "closed") return null;
  const op = head.operation_id!;
  if (head.state === "transfer_reserved") return { operation_id: op, state: "reserved" };
  const found = readIntent(root, run_id, op);
  if (!found || found.hash !== head.intent_hash) return corrupt(`${op} committed without its intent`);
  const ctx: Ctx = { root, targetRoot: root, intent: found.intent, intentHash: found.hash, ports: undefined as unknown as TransferPorts, now: Date.now };
  const latest = latestStage(ctx);
  if (!latest || latest.state !== "acknowledged" || !disclosed(latest.target_ack)) return { operation_id: op, state: latest?.state ?? "source_committed" };
  const journal = readControllerJournal({ privateDir: controllerPrivateDir });
  const auth = journal.run_id === run_id && journal.source_id === found.intent.source_id ? journal.operations.get(`${op}.ack`) : undefined;
  if (!auth || auth.action !== "accept" || auth.subject !== `xfer.${found.hash.slice(7, 47)}`) return { operation_id: op, state: "acknowledged" };
  return null;
}

/**
 * Append the terminal `closed` entry for a work closure. Same CAS chain as
 * reservations, so a close and a reservation can never both win. Idempotent
 * for the same operation and closure digest.
 */
export function closeWorkDisposition(sourceRoot: string, run_id: string, work: Entity, c: { operation_id: string; closure_hash: Hash }):
  { outcome: "closed" | "already" } | { outcome: "blocked"; state: DispositionState } {
  const root = path.resolve(sourceRoot);
  seg(c.operation_id, "operation_id");
  if (!HASH_RE.test(c.closure_hash)) throw new TransferRefusal("request_invalid", "closure_hash must be a sha256 hash");
  openWorkDisposition(root, run_id, work);
  const view = readWorkDisposition(root, run_id, work);
  const head = view.entries[view.entries.length - 1]!;
  if (head.state === "closed") return head.operation_id === c.operation_id && head.intent_hash === c.closure_hash ? { outcome: "already" } : { outcome: "blocked", state: "closed" };
  if (head.state === "transfer_reserved") return { outcome: "blocked", state: head.state };
  const res = appendDisposition(root, run_id, work, view, { state: "closed", operation_id: c.operation_id, intent_hash: c.closure_hash, destination_work: null, target_root_digest: null, prepared_sha256: null });
  return res.won ? { outcome: "closed" } : { outcome: "blocked", state: res.existing.state };
}

/**
 * True only when the target holds an activation for this operation that the
 * source committed to this very root with the same prepared bytes. Anything
 * unreadable, foreign or replayed is not executable.
 */
export function isFollowupExecutable(opts: { sourceRoot: string; targetRoot: string; source_id: string; run_id: string; operation_id: string }): boolean {
  try {
    const op = seg(opts.operation_id, "operation_id");
    const run_id = seg(opts.run_id, "run_id");
    const source_id = seg(opts.source_id, "source_id");
    const root = path.resolve(opts.sourceRoot);
    const targetRoot = path.resolve(opts.targetRoot);
    const inbound = inboundDir(source_id, op);
    const pRaw = readOnce(targetRoot, path.join(inbound, "prepared.json"));
    const aRaw = readOnce(targetRoot, path.join(inbound, "activated.json"));
    if (pRaw === null || aRaw === null) return false;
    const p = JSON.parse(pRaw) as InboundPrepared;
    const a = JSON.parse(aRaw) as InboundActivated;
    if (pRaw !== inboundBytes(p).toString("utf8") || aRaw !== inboundBytes(a).toString("utf8")) return false;
    if (p.stage !== "prepared" || p.operation_id !== op || p.source_id !== source_id || p.source_run_id !== run_id || p.executable !== false) return false;
    if (a.stage !== "activated" || a.operation_id !== op || a.source_id !== source_id || a.executable !== true || a.prepared_sha256 !== hashOf(pRaw)) return false;
    const found = readIntent(root, run_id, op);
    if (!found || found.intent.source_id !== source_id || found.hash !== p.intent_hash) return false;
    if (found.intent.target_root_digest !== targetRootDigest(targetRoot)) return false;
    if (readStage(root, found.intent, "aborted")) return false;
    const view = readWorkDisposition(root, run_id, found.intent.source_work);
    const ti = view.entries.findIndex((e) => e.state === "transferred" && e.operation_id === op);
    if (ti < 0) return false;
    const e = view.entries[ti]!;
    return view.revisions[ti] === a.source_commit_sha256 && e.prepared_sha256 === hashOf(pRaw)
      && e.intent_hash === found.hash && e.target_root_digest === found.intent.target_root_digest;
  } catch {
    return false;
  }
}

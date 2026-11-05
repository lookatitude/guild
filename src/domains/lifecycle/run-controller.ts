/**
 * src/domains/lifecycle/run-controller.ts — R02 fixed run controller, writer
 * grants, immutable attempt grants and fencing (AT10, AT11).
 *
 * One local controller is the only authority for a logical run's control
 * writes (accept, schedule, close, release, admission changes, artifact
 * bindings, observation collection). It is pinned to the host that opened the
 * run: failover is `manual_new_run_only`, so another machine never takes over
 * automatically.
 *
 * Epoch journal: private, on the platform state root (never under `.guild/`).
 * Each entry is one write-once file `journal/<seq>.json`, published with
 * link(2) after fsync, so two writers racing for a sequence number cannot both
 * win. Entries are HMAC-SHA256 chained under a per-run controller key, so an
 * edited, reordered or gapped journal fails closed. Every open on the pinned
 * host appends `epoch_open` with the next epoch; a controller re-reads the
 * journal head before every authoritative write and refuses once a newer
 * epoch exists (`controller_fenced`).
 *
 * Availability: a controller writes only while it holds a fresh lease. A lease
 * whose pid is dead, or whose heartbeat is older than `leaseMs` (a live but
 * reused pid), is stale and may be reclaimed by a new epoch on the same host.
 * Unavailable means refused, not queued: workers keep writing observations as
 * files, and the next epoch collects them idempotently.
 *
 * Grants: a writer grant (epoch-bound, nonce held in process only) authorizes
 * control writes. An attempt grant is immutable, one per attempt, and only
 * lets a worker MAC its observations with a secret derived from the controller
 * key; it is never a lifecycle writer. Observations under an attempt grant
 * from an older epoch stay collectable in `reconcile_only` admission until the
 * execution is revoked or sealed.
 *
 * Shareable bytes under `.guild/`: worker observations, control receipts and
 * grant refs. None carries the key, a nonce or a derived secret; receipts and
 * bound artifacts (the W02 assurance ledger) are verified against digests in
 * the keyed journal, so a rewrite that recomputes an unkeyed hash is detected.
 *
 * Trust: cooperative local. A process that can read the controller key on the
 * platform state root can forge anything; that is out of model.
 * Activation stays gated: nothing here is wired into a launcher or hook.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalizeRealPath, checkContained, isRefused, isWithin, prepareContainedWrite } from "../kernel";

export const CONTROLLER_JOURNAL_SCHEMA = "guild.controller_journal_entry.v1" as const;
export const CONTROL_RECEIPT_SCHEMA = "guild.controller_receipt.v1" as const;
export const WORKER_OBSERVATION_SCHEMA = "guild.worker_observation.v1" as const;
export const CONTROLLER_ANCHOR_SCHEMA = "guild.controller_anchor.v1" as const;

export type ControlAction = "accept" | "schedule" | "close" | "release";
export type AdmissionState = "active" | "reconcile_only" | "revoked" | "sealed";
export type ArtifactKind = "assurance-ledger";

export type ControllerRefusalCode =
  | "private_dir_shareable"
  | "controller_key_missing"
  | "journal_corrupt"
  | "journal_identity_mismatch"
  | "controller_failover_refused"
  | "controller_busy"
  | "controller_unavailable"
  | "controller_fenced"
  | "worker_grant_not_writer"
  | "writer_grant_forged"
  | "writer_grant_fenced"
  | "attempt_grant_exists"
  | "admission_closed"
  | "admission_transition_refused"
  | "operation_conflict"
  | "receipt_conflict"
  | "observation_exists"
  | "artifact_invalid"
  | "request_invalid";

export class ControllerRefusal extends Error {
  constructor(readonly code: ControllerRefusalCode, detail: string) {
    super(`run controller refused (${code}): ${detail}`);
    this.name = "ControllerRefusal";
  }
}

export interface WriterGrant {
  kind: "writer";
  grant_id: string;
  issued_controller_epoch: number;
  scope_hash: string;
  /** Private. Proves the grant came from this controller; never serialized. */
  nonce: string;
}

export interface AttemptGrantClaims {
  grant_id: string;
  source_id: string;
  run_id: string;
  execution_id: string;
  attempt_id: string;
  scope_hash: string;
  issued_controller_epoch: number;
  expires_at_ms: number;
  nonce_hash: string;
}

export interface AttemptGrant {
  kind: "attempt";
  grant_id: string;
  claims: AttemptGrantClaims;
  /** Private worker secret, HMAC(controller key, claims). Never serialized. */
  secret: string;
}

export interface ShareableGrantRef {
  kind: "writer" | "attempt";
  grant_id: string;
  issued_controller_epoch: number;
  scope_hash: string;
  execution_id: string | null;
}

export interface ControlReceipt {
  schema_version: typeof CONTROL_RECEIPT_SCHEMA;
  source_id: string;
  run_id: string;
  operation_id: string;
  action: ControlAction;
  subject: string;
  controller_epoch: number;
  writer_grant_id: string;
}

export interface CollectReport {
  accepted: Array<{ observation_id: string; execution_id: string; admission: "active" | "reconcile_only" }>;
  replayed: string[];
  /** True when the per-call bound stopped the scan; the next call resumes after the last file examined. */
  truncated: boolean;
  rejected: Array<{ observation_id: string; code: ObservationRejection }>;
}
export type ObservationRejection =
  | "observation_invalid"
  | "observation_forged"
  | "observation_conflict"
  | "grant_forged"
  | "grant_expired"
  | "admission_revoked"
  | "admission_sealed";

export interface JournalEntry {
  schema_version: typeof CONTROLLER_JOURNAL_SCHEMA;
  seq: number;
  prev_mac: string;
  kind: "genesis" | "epoch_open" | "suspend" | "writer_grant" | "attempt_grant" | "admission" | "control" | "observation" | "artifact_bind" | "commit" | "extension";
  epoch: number;
  at_ms: number;
  body: Record<string, unknown>;
  mac: string;
}

export interface ControllerJournalView {
  source_id: string;
  run_id: string;
  host_id: string;
  epoch: number;
  suspended: boolean;
  entries: JournalEntry[];
  writerGrants: Map<string, { epoch: number; nonce_hash: string; scope_hash: string }>;
  attemptGrants: Map<string, AttemptGrantClaims & { claims_hash: string }>;
  attempts: Set<string>;
  admission: Map<string, AdmissionState>;
  operations: Map<string, ControlReceipt & { receipt_sha256: string }>;
  observations: Map<string, string>;
  artifacts: Map<string, { sha256: string; claimed_hash: string }>;
}

export interface OpenControllerOptions {
  /** Controller-private directory on the platform state root; never inside the project. */
  privateDir: string;
  /** Project root that holds `.guild/`. */
  durableRoot: string;
  source_id: string;
  run_id: string;
  host_id: string;
  now?: () => number;
  leaseMs?: number;
  pid?: number;
  pidAlive?: (pid: number) => boolean;
  /** Upper bound of observation files examined per collect call; traversal resumes after the last one. */
  maxObservationsPerCollect?: number;
  /** R03 hook: trusted gate run before an attempt grant is issued or re-delivered; throws to refuse. */
  attemptGate?: (req: { execution_id: string; attempt_id: string; scope_hash: string }, records: readonly ExtensionRecord[]) => void;
}

/** R03 hook: a committed `extension` journal entry (owner-defined body, keyed and epoch-fenced like any control write). */
export interface ExtensionRecord {
  seq: number;
  epoch: number;
  at_ms: number;
  body: Record<string, unknown>;
}

// ── primitives ───────────────────────────────────────────────────────────────

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_RE = /^sha256:[a-f0-9]{64}$/;
const ACTIONS: readonly ControlAction[] = ["accept", "schedule", "close", "release"];
const ENTRY_FILE_RE = /^\d{12}\.json$/;
const MAX_ENTRY_BYTES = 1 << 20;
const MAX_OBSERVATION_BYTES = 1 << 20;
const MAX_OBSERVATIONS_PER_COLLECT = 10_000;
const DEFAULT_LEASE_MS = 30_000;
const KEY_FILE = "controller.key";
const LEASE_FILE = "lease.json";

function canonical(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new ControllerRefusal("request_invalid", "non-finite number");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  throw new ControllerRefusal("request_invalid", `unsupported value ${typeof v}`);
}
const sha256 = (s: string | Buffer) => `sha256:${crypto.createHash("sha256").update(s).digest("hex")}`;
const hmac = (key: Buffer | string, s: string) => crypto.createHmac("sha256", key).update(s, "utf8").digest("hex");
function macEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function requireId(v: unknown, what: string): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new ControllerRefusal("request_invalid", `${what} is not an id`);
  return v;
}
function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
function fsyncDir(dir: string): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    /* directory fsync is unsupported on some filesystems */
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
function writeAll(fd: number, bytes: Buffer): void {
  let off = 0;
  while (off < bytes.length) {
    const n = fs.writeSync(fd, bytes, off, bytes.length - off);
    if (n <= 0) throw new Error("short write");
    off += n;
  }
}
/** fsync a private temp file, then link(2) it to `final`. Returns false when `final` already exists. */
function linkOnce(final: string, bytes: Buffer, mode: number, precommit?: () => void): boolean {
  const dir = path.dirname(final);
  const tmp = path.join(dir, `.${path.basename(final)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let created = false;
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, mode);
    try {
      writeAll(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    precommit?.();
    try {
      fs.linkSync(tmp, final);
      created = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  fsyncDir(dir);
  return created;
}
function readNoFollow(file: string, max: number): string | null {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > max) return null;
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = fs.readSync(fd, buf, off, st.size - off, off);
      if (n <= 0) break;
      off += n;
    }
    return buf.subarray(0, off).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

// ── durable (.guild/) side: contained write-once ────────────────────────────

function durablePath(...segments: string[]): string {
  return path.join(".guild", ...segments);
}
/** Write-once under the durable root. True = created, false = identical bytes already there. */
function publishDurable(durableRoot: string, rel: string, bytes: Buffer, onDifferent: ControllerRefusalCode): boolean {
  const prepared = prepareContainedWrite(durableRoot, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(prepared)) throw new ControllerRefusal("request_invalid", `durable write refused (${prepared.code}): ${rel}`);
  const created = linkOnce(prepared.realPath, bytes, 0o644);
  const after = checkContained(durableRoot, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(after) || after.realPath !== prepared.realPath) {
    if (created) fs.rmSync(prepared.realPath, { force: true });
    throw new ControllerRefusal("request_invalid", `${rel}: containment changed during publication`);
  }
  if (!created && readNoFollow(prepared.realPath, bytes.length + 1) !== bytes.toString("utf8")) {
    throw new ControllerRefusal(onDifferent, `${rel} already holds different bytes`);
  }
  return created;
}
function readDurable(durableRoot: string, rel: string, max: number): string | null {
  const r = checkContained(durableRoot, rel, { policy: "physical" });
  if (isRefused(r)) return null;
  return readNoFollow(r.realPath, max);
}

// ── journal ──────────────────────────────────────────────────────────────────

const journalDir = (privateDir: string) => path.join(privateDir, "journal");
const entryFile = (privateDir: string, seq: number) => path.join(journalDir(privateDir), `${String(seq).padStart(12, "0")}.json`);
const macOf = (key: Buffer, e: Omit<JournalEntry, "mac">) => hmac(key, canonical(e));

function readKey(privateDir: string): Buffer | null {
  const file = path.join(privateDir, KEY_FILE);
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size !== 32) throw new ControllerRefusal("controller_key_missing", "controller key is not a 32-byte regular file");
    const buf = Buffer.alloc(32);
    fs.readSync(fd, buf, 0, 32, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function emptyView(): ControllerJournalView {
  return {
    source_id: "", run_id: "", host_id: "", epoch: 0, suspended: false, entries: [],
    writerGrants: new Map(), attemptGrants: new Map(), attempts: new Set(), admission: new Map(),
    operations: new Map(), observations: new Map(), artifacts: new Map(),
  };
}

function corrupt(detail: string): never {
  throw new ControllerRefusal("journal_corrupt", detail);
}

/** Verify one entry against the chain so far and fold it into the view. */
function foldEntry(view: ControllerJournalView, key: Buffer, raw: string, seq: number): void {
  let e: JournalEntry;
  try {
    e = JSON.parse(raw) as JournalEntry;
  } catch {
    corrupt(`entry ${seq} is not JSON`);
  }
  if (!isObj(e) || e.schema_version !== CONTROLLER_JOURNAL_SCHEMA || e.seq !== seq || typeof e.mac !== "string" || !isObj(e.body)) corrupt(`entry ${seq} malformed`);
  const keys = Object.keys(e).sort().join(",");
  if (keys !== "at_ms,body,epoch,kind,mac,prev_mac,schema_version,seq") corrupt(`entry ${seq} has unexpected fields`);
  const { mac, ...unsigned } = e;
  if (!macEqual(mac, macOf(key, unsigned))) corrupt(`entry ${seq} mac does not verify`);
  const prev = view.entries[view.entries.length - 1];
  if (e.prev_mac !== (prev ? prev.mac : "")) corrupt(`entry ${seq} breaks the chain`);
  const b = e.body;
  if (seq === 0) {
    if (e.kind !== "genesis" || e.epoch !== 0) corrupt("journal does not start with genesis");
    view.source_id = String(b.source_id);
    view.run_id = String(b.run_id);
    view.host_id = String(b.host_id);
  } else if (e.kind === "genesis") {
    corrupt(`second genesis at ${seq}`);
  } else if (e.kind === "epoch_open") {
    if (e.epoch !== view.epoch + 1) corrupt(`epoch ${e.epoch} does not follow ${view.epoch}`);
    view.epoch = e.epoch;
    view.suspended = false;
  } else if (e.epoch !== view.epoch || view.epoch === 0) {
    corrupt(`entry ${seq} written under epoch ${e.epoch} while ${view.epoch} is current`);
  } else if (view.suspended) {
    corrupt(`entry ${seq} written after suspend`);
  }
  if (e.kind === "commit") {
    // A commit makes the immediately preceding provisional entry of the same epoch effective.
    const target = view.entries[seq - 1];
    if (!target || b.target_seq !== seq - 1 || target.epoch !== e.epoch || ["genesis", "epoch_open", "commit"].includes(target.kind)) corrupt(`commit ${seq} has no valid target`);
    if (target.kind === "suspend") view.suspended = true;
  }
  view.entries.push(e);
}

/** Recompute the effect maps from committed entries only; an uncommitted provisional entry has no effect. */
function rebuildEffects(view: ControllerJournalView): void {
  view.writerGrants.clear(); view.attemptGrants.clear(); view.attempts.clear(); view.admission.clear();
  view.operations.clear(); view.observations.clear(); view.artifacts.clear();
  const committed = new Set(view.entries.filter((x) => x.kind === "commit").map((x) => Number(x.body.target_seq)));
  for (const e of view.entries) {
    if (!committed.has(e.seq)) continue;
    const b = e.body;
    const seq = e.seq;
  switch (e.kind) {
    case "writer_grant":
      view.writerGrants.set(String(b.grant_id), { epoch: e.epoch, nonce_hash: String(b.nonce_hash), scope_hash: String(b.scope_hash) });
      break;
    case "attempt_grant": {
      const claims = b.claims as AttemptGrantClaims;
      if (claims.issued_controller_epoch !== e.epoch) corrupt(`attempt grant ${seq} epoch mismatch`);
      view.attemptGrants.set(claims.grant_id, { ...claims, claims_hash: sha256(canonical(claims)) });
      view.attempts.add(claims.attempt_id);
      break;
    }
    case "admission":
      view.admission.set(String(b.execution_id), b.state as AdmissionState);
      break;
    case "control": {
      const { receipt_sha256, ...receipt } = b as unknown as ControlReceipt & { receipt_sha256: string };
      view.operations.set(receipt.operation_id, { ...receipt, receipt_sha256 });
      break;
    }
    case "observation":
      view.observations.set(`${String(b.execution_id)}/${String(b.observation_id)}`, String(b.digest));
      break;
    case "artifact_bind":
      view.artifacts.set(`${String(b.kind)}\0${String(b.id)}`, { sha256: String(b.sha256), claimed_hash: String(b.claimed_hash) });
      break;
    default:
      break;
  }
  }
}

function listSeqs(privateDir: string): number[] {
  let names: string[];
  try {
    names = fs.readdirSync(journalDir(privateDir));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const seqs = names.filter((n) => ENTRY_FILE_RE.test(n)).map((n) => Number(n.slice(0, 12))).sort((a, b) => a - b);
  seqs.forEach((s, i) => { if (s !== i) corrupt(`journal sequence gap at ${i}`); });
  return seqs;
}

function loadJournal(privateDir: string, key: Buffer, into: ControllerJournalView = emptyView()): ControllerJournalView {
  const seqs = listSeqs(privateDir);
  let changed = into.entries.length === 0;
  for (const seq of seqs) {
    if (seq < into.entries.length) continue;
    const raw = readNoFollow(entryFile(privateDir, seq), MAX_ENTRY_BYTES);
    if (raw === null) corrupt(`entry ${seq} unreadable`);
    foldEntry(into, key, raw, seq);
    changed = true;
  }
  if (changed) rebuildEffects(into);
  return into;
}

/** Read and verify the whole private journal. Read-only; needs the controller key. */
export function readControllerJournal(opts: { privateDir: string }): ControllerJournalView {
  const key = readKey(opts.privateDir);
  if (!key) throw new ControllerRefusal("controller_key_missing", "no controller key");
  const view = loadJournal(opts.privateDir, key);
  if (view.entries.length === 0) corrupt("journal is empty");
  return view;
}

// ── lease ────────────────────────────────────────────────────────────────────

interface Lease { pid: number; host_id: string; token: string; heartbeat_ms: number; epoch: number }
function readLease(privateDir: string): Lease | null {
  const raw = readNoFollow(path.join(privateDir, LEASE_FILE), 4096);
  if (raw === null) return null;
  try {
    const l = JSON.parse(raw) as Lease;
    return isObj(l) && typeof l.pid === "number" && typeof l.token === "string" && typeof l.heartbeat_ms === "number" && typeof l.epoch === "number" ? l : null;
  } catch {
    return null;
  }
}
function writeLease(privateDir: string, lease: Lease): void {
  const file = path.join(privateDir, LEASE_FILE);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    writeAll(fd, Buffer.from(JSON.stringify(lease), "utf8"));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fsyncDir(privateDir);
}

// ── controller ───────────────────────────────────────────────────────────────

export interface RunController {
  readonly epoch: number;
  readonly source_id: string;
  readonly run_id: string;
  heartbeat(): void;
  suspend(): void;
  close(): void;
  issueWriterGrant(scope: string): WriterGrant;
  issueAttemptGrant(req: { execution_id: string; attempt_id: string; scope: string; expires_at_ms: number }): AttemptGrant;
  control(grant: WriterGrant, op: { operation_id: string; action: ControlAction; subject: string }): ControlReceipt;
  setAdmission(grant: WriterGrant, execution_id: string, state: Exclude<AdmissionState, "active">): void;
  collectObservations(): CollectReport;
  bindArtifact(grant: WriterGrant, a: { kind: ArtifactKind; id: string; text: string }): { kind: ArtifactKind; id: string; sha256: string };
  // ── R03 hooks (worker ingress) ──
  /** Refuse unless this controller may write now; with a grant, also unless it is a current-epoch writer grant. */
  assertWritable(grant?: WriterGrant): void;
  /** Journal an owner-defined record under a current-epoch writer grant. */
  extend(grant: WriterGrant, body: Record<string, unknown>): ExtensionRecord;
  /** Committed extension records, oldest first, after folding any newer journal entries. */
  extensionRecords(): ExtensionRecord[];
  /** Committed claims of an attempt grant, or undefined. */
  attemptClaims(grant_id: string): AttemptGrantClaims | undefined;
  /** HMAC of `message` under the attempt's worker secret; the secret itself never leaves the controller. */
  attemptMac(grant_id: string, message: string): string;
  /** HMAC under the controller key, domain-separated by `purpose`; only the controller can mint or check it. */
  controllerMac(purpose: string, message: string): string;
  /** Effective admission of an attempt grant's execution (explicit state, else epoch-derived). */
  attemptAdmission(grant_id: string): AdmissionState | undefined;
}

/** Open the run's controller on this host, advancing the epoch. Throws ControllerRefusal. */
export function openRunController(opts: OpenControllerOptions): RunController {
  const now = opts.now ?? Date.now;
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
  const pid = opts.pid ?? process.pid;
  const pidAlive = opts.pidAlive ?? defaultPidAlive;
  const source_id = requireId(opts.source_id, "source_id");
  const run_id = requireId(opts.run_id, "run_id");
  const host_id = requireId(opts.host_id, "host_id");
  const privateDir = path.resolve(opts.privateDir);
  const durableRoot = path.resolve(opts.durableRoot);

  fs.mkdirSync(journalDir(privateDir), { recursive: true, mode: 0o700 });
  if (isWithin(canonicalizeRealPath(privateDir), canonicalizeRealPath(durableRoot))) {
    throw new ControllerRefusal("private_dir_shareable", "controller state must live outside the project root");
  }

  let key = readKey(privateDir);
  if (!key) {
    if (listSeqs(privateDir).length > 0) throw new ControllerRefusal("controller_key_missing", "journal exists but its key is gone; refusing to re-key");
    const fresh = crypto.randomBytes(32);
    linkOnce(path.join(privateDir, KEY_FILE), fresh, 0o600);
    key = readKey(privateDir);
    if (!key) throw new ControllerRefusal("controller_key_missing", "controller key could not be created");
  }
  // The durable anchor pins the run's one authority (host + key id) in the
  // project, so a second machine with its own empty state root cannot mint a
  // parallel controller, and a host that lost its state cannot silently re-key.
  const keyId = sha256(hmac(key, "guild.controller.key_id"));
  const anchorRel = durablePath("runs", run_id, "controller", "anchor.json");
  const anchor = { schema_version: CONTROLLER_ANCHOR_SCHEMA, source_id, run_id, host_id, key_id: keyId, failover: "manual_new_run_only" };
  const anchorBytes = Buffer.from(`${JSON.stringify(anchor, null, 2)}\n`, "utf8");
  const existingAnchor = readDurable(durableRoot, anchorRel, 4096);
  if (existingAnchor !== null && existingAnchor !== anchorBytes.toString("utf8")) {
    let other: Record<string, unknown> | null = null;
    try { other = JSON.parse(existingAnchor) as Record<string, unknown>; } catch { other = null; }
    if (isObj(other) && other.host_id !== host_id) throw new ControllerRefusal("controller_failover_refused", `run is anchored to ${String(other.host_id)}; failover is manual_new_run_only`);
    throw new ControllerRefusal("journal_identity_mismatch", "run is anchored to another controller authority");
  }
  const view = loadJournal(privateDir, key);
  if (existingAnchor === null && view.entries.length > 0) {
    // An established run whose anchor vanished fails closed; restoring it is an operator action.
    throw new ControllerRefusal("journal_identity_mismatch", "controller anchor is missing for an established run");
  }
  if (existingAnchor === null) {
    try {
      publishDurable(durableRoot, anchorRel, anchorBytes, "journal_identity_mismatch");
    } catch (err) {
      if (err instanceof ControllerRefusal && err.code === "journal_identity_mismatch" && view.entries.length === 0) {
        throw new ControllerRefusal("controller_failover_refused", "another controller anchored this run first");
      }
      throw err;
    }
  }
  if (view.entries.length > 0) {
    if (view.source_id !== source_id || view.run_id !== run_id) throw new ControllerRefusal("journal_identity_mismatch", "journal belongs to another run");
    if (view.host_id !== host_id) throw new ControllerRefusal("controller_failover_refused", `run is pinned to ${view.host_id}; failover is manual_new_run_only`);
  }

  const held = readLease(privateDir);
  if (held && held.host_id === host_id && pidAlive(held.pid) && now() - held.heartbeat_ms <= leaseMs) {
    throw new ControllerRefusal("controller_busy", `controller pid ${held.pid} holds a fresh lease`);
  }
  const token = crypto.randomBytes(16).toString("hex");
  let heartbeatAt = now();
  const maxPerCollect = opts.maxObservationsPerCollect ?? MAX_OBSERVATIONS_PER_COLLECT;
  let collectCursor = "";

  const k = key;
  let epoch = 0;
  let closed = false;
  let suspended = false;

  const append = (kind: JournalEntry["kind"], body: Record<string, unknown>, atEpoch: number, precommit?: () => void): JournalEntry => {
    const seq = view.entries.length;
    const prev = view.entries[seq - 1];
    const unsigned = { schema_version: CONTROLLER_JOURNAL_SCHEMA, seq, prev_mac: prev ? prev.mac : "", kind, epoch: atEpoch, at_ms: now(), body };
    const entry: JournalEntry = { ...unsigned, mac: macOf(k, unsigned) };
    const raw = JSON.stringify(entry);
    if (!linkOnce(entryFile(privateDir, seq), Buffer.from(raw, "utf8"), 0o600, precommit)) return null as unknown as JournalEntry;
    foldEntry(view, k, raw, seq);
    rebuildEffects(view);
    return entry;
  };

  // Genesis + epoch_open, retried when another opener wins a sequence number.
  for (let tries = 0; ; tries++) {
    if (tries > 8) throw new ControllerRefusal("controller_busy", "lost the epoch race repeatedly");
    loadJournal(privateDir, k, view);
    if (view.entries.length === 0) {
      if (!append("genesis", { source_id, run_id, host_id, failover: "manual_new_run_only" }, 0)) continue;
    }
    if (view.host_id !== host_id) throw new ControllerRefusal("controller_failover_refused", `run is pinned to ${view.host_id}`);
    const next = view.epoch + 1;
    if (append("epoch_open", { host_id, pid }, next)) {
      epoch = next;
      break;
    }
  }
  heartbeatAt = now();
  writeLease(privateDir, { pid, host_id, token, heartbeat_ms: heartbeatAt, epoch });
  const expired = () => now() - heartbeatAt > leaseMs;
  // Commits stop a margin before the lease ends, so a commit that passed its
  // check lands before any successor can treat the lease as stale.
  const commitMargin = Math.floor(leaseMs / 4);
  const commitExpired = () => now() - heartbeatAt > leaseMs - commitMargin;

  /** Every authoritative write goes through here first. */
  const assertLive = (): void => {
    if (closed) throw new ControllerRefusal("controller_unavailable", "controller closed");
    // Re-verify the cached head, then fold anything appended since.
    const headSeq = view.entries.length - 1;
    const headRaw = readNoFollow(entryFile(privateDir, headSeq), MAX_ENTRY_BYTES);
    if (headRaw === null || headRaw !== JSON.stringify(view.entries[headSeq])) corrupt(`journal head ${headSeq} changed under the controller`);
    loadJournal(privateDir, k, view);
    if (view.epoch !== epoch) throw new ControllerRefusal("controller_fenced", `epoch ${epoch} superseded by ${view.epoch}`);
    if (suspended || view.suspended) throw new ControllerRefusal("controller_unavailable", "controller suspended");
    if (expired()) throw new ControllerRefusal("controller_unavailable", "lease expired");
    // A missing or replaced anchor means another authority may exist: stop writing.
    if (readDurable(durableRoot, anchorRel, 4096) !== anchorBytes.toString("utf8")) {
      throw new ControllerRefusal("controller_unavailable", "controller anchor missing or replaced");
    }
    // The journal decides authority; the lease only signals liveness. A lease
    // removed or overwritten by an older epoch (a stale heartbeat or close) is
    // restored by the current epoch instead of wedging it.
    const lease = readLease(privateDir);
    if (lease && lease.epoch > epoch) throw new ControllerRefusal("controller_fenced", `lease held by epoch ${lease.epoch}`);
    if (lease && lease.epoch === epoch && lease.token !== token) throw new ControllerRefusal("controller_unavailable", "lease lost");
    if (!lease || lease.epoch < epoch) writeLease(privateDir, { pid, host_id, token, heartbeat_ms: heartbeatAt, epoch });
  };
  const write = (kind: JournalEntry["kind"], body: Record<string, unknown>, still?: () => void): JournalEntry => {
    assertLive();
    // Two-phase: a provisional entry, then a `commit` naming it. Only committed
    // entries have effect, so a crash, an expired lease or a newer epoch taking
    // the next sequence leaves the provisional entry inert. Lease validity is
    // checked after fsync, immediately before each link(2).
    const live = () => { if (commitExpired()) throw new ControllerRefusal("controller_unavailable", "lease expired before commit"); still?.(); };
    const lost = (): never => {
      loadJournal(privateDir, k, view);
      if (view.epoch !== epoch) throw new ControllerRefusal("controller_fenced", `epoch ${epoch} superseded by ${view.epoch}`);
      throw new ControllerRefusal("controller_unavailable", "journal diverged under this controller");
    };
    const e = append(kind, body, epoch, live);
    if (!e) lost();
    if (!append("commit", { target_seq: e.seq }, epoch, live)) lost();
    return e;
  };

  const checkWriter = (grant: WriterGrant): { scope_hash: string } => {
    if (!isObj(grant) || (grant as { kind?: unknown }).kind === "attempt" || "claims" in grant || "secret" in grant) {
      throw new ControllerRefusal("worker_grant_not_writer", "attempt grants never authorize control writes");
    }
    const known = typeof grant.grant_id === "string" ? view.writerGrants.get(grant.grant_id) : undefined;
    if (grant.kind !== "writer" || !known || typeof grant.nonce !== "string" || !macEqual(sha256(grant.nonce), known.nonce_hash)) {
      throw new ControllerRefusal("writer_grant_forged", "writer grant was not issued by this controller");
    }
    if (known.epoch !== epoch || grant.issued_controller_epoch !== epoch) {
      throw new ControllerRefusal("writer_grant_fenced", `writer grant from epoch ${known.epoch}; current epoch ${epoch}`);
    }
    return known;
  };

  const workerSecret = (claims: AttemptGrantClaims) => hmac(k, `attempt\0${canonical(claims)}`);
  const effectiveAdmission = (g: AttemptGrantClaims): AdmissionState => {
    const explicit = view.admission.get(g.execution_id);
    if (explicit && explicit !== "active") return explicit;
    return g.issued_controller_epoch < epoch ? "reconcile_only" : "active";
  };

  const receiptRel = (operation_id: string) => durablePath("runs", run_id, "controller", "receipts", `${operation_id}.json`);
  const publishReceipt = (r: ControlReceipt): string => {
    const bytes = Buffer.from(`${JSON.stringify(r, null, 2)}\n`, "utf8");
    publishDurable(durableRoot, receiptRel(r.operation_id), bytes, "receipt_conflict");
    return sha256(bytes);
  };
  const extensionRecords = (): ExtensionRecord[] => {
    loadJournal(privateDir, k, view);
    const committed = new Set(view.entries.filter((x) => x.kind === "commit").map((x) => Number(x.body.target_seq)));
    return view.entries.filter((e) => e.kind === "extension" && committed.has(e.seq))
      .map((e) => ({ seq: e.seq, epoch: e.epoch, at_ms: e.at_ms, body: structuredClone(e.body.ext as Record<string, unknown>) }));
  };
  const receiptBytes = (r: ControlReceipt) => Buffer.from(`${JSON.stringify(r, null, 2)}\n`, "utf8");

  return {
    get epoch() { return epoch; },
    source_id,
    run_id,

    heartbeat() {
      assertLive();
      heartbeatAt = now();
      writeLease(privateDir, { pid, host_id, token, heartbeat_ms: heartbeatAt, epoch });
      // A newer epoch may have opened during the write; it restores its own lease.
      assertLive();
    },

    suspend() {
      // Local suspension is immediate; the journal record is best effort (an
      // unavailable or fenced controller is already unable to write).
      try { write("suspend", {}); } catch (err) { if (!(err instanceof ControllerRefusal) || err.code === "journal_corrupt") throw err; }
      suspended = true;
      const lease = readLease(privateDir);
      if (lease && lease.token === token) fs.rmSync(path.join(privateDir, LEASE_FILE), { force: true });
    },

    close() {
      if (closed) return;
      closed = true;
      const lease = readLease(privateDir);
      if (lease && lease.token === token) fs.rmSync(path.join(privateDir, LEASE_FILE), { force: true });
    },

    issueWriterGrant(scope) {
      assertLive();
      const scope_hash = sha256(canonical({ scope: requireId(scope, "scope") }));
      const nonce = crypto.randomBytes(32).toString("hex");
      const grant_id = `wg-${epoch}-${crypto.randomBytes(8).toString("hex")}`;
      write("writer_grant", { grant_id, scope_hash, nonce_hash: sha256(nonce) });
      return { kind: "writer", grant_id, issued_controller_epoch: epoch, scope_hash, nonce };
    },

    issueAttemptGrant(req) {
      assertLive();
      const execution_id = requireId(req.execution_id, "execution_id");
      const attempt_id = requireId(req.attempt_id, "attempt_id");
      if (!Number.isSafeInteger(req.expires_at_ms) || req.expires_at_ms <= now()) throw new ControllerRefusal("request_invalid", "expires_at_ms must be a future instant");
      const adm = view.admission.get(execution_id);
      if (adm === "revoked" || adm === "sealed") throw new ControllerRefusal("admission_closed", `execution ${execution_id} is ${adm}`);
      const scope_hash = sha256(canonical({ scope: requireId(req.scope, "scope") }));
      opts.attemptGate?.({ execution_id, attempt_id, scope_hash }, extensionRecords());
      if (view.attempts.has(attempt_id)) {
        // Immutable: an identical request re-delivers the committed grant (crash before delivery); anything else refuses.
        const prior = [...view.attemptGrants.values()].find((g) => g.attempt_id === attempt_id);
        if (!prior || prior.execution_id !== execution_id || prior.scope_hash !== scope_hash || prior.expires_at_ms !== req.expires_at_ms) {
          throw new ControllerRefusal("attempt_grant_exists", `attempt ${attempt_id} already holds its immutable grant`);
        }
        const { claims_hash: _h, ...claims } = prior;
        return { kind: "attempt", grant_id: claims.grant_id, claims, secret: workerSecret(claims) };
      }
      const claims: AttemptGrantClaims = {
        grant_id: `ag-${epoch}-${crypto.randomBytes(8).toString("hex")}`,
        source_id, run_id, execution_id, attempt_id,
        scope_hash,
        issued_controller_epoch: epoch,
        expires_at_ms: req.expires_at_ms,
        nonce_hash: sha256(crypto.randomBytes(32)),
      };
      write("attempt_grant", { claims });
      return { kind: "attempt", grant_id: claims.grant_id, claims, secret: workerSecret(claims) };
    },

    control(grant, op) {
      assertLive();
      checkWriter(grant);
      const operation_id = requireId(op?.operation_id, "operation_id");
      const subject = requireId(op?.subject, "subject");
      if (!ACTIONS.includes(op.action)) throw new ControllerRefusal("request_invalid", `unknown action ${String(op.action)}`);
      const prior = view.operations.get(operation_id);
      if (prior) {
        if (prior.action !== op.action || prior.subject !== subject) throw new ControllerRefusal("operation_conflict", `${operation_id} already recorded with a different payload`);
        const { receipt_sha256: _h, ...receipt } = prior;
        publishReceipt(receipt);
        return receipt;
      }
      const receipt: ControlReceipt = {
        schema_version: CONTROL_RECEIPT_SCHEMA, source_id, run_id, operation_id, action: op.action, subject,
        controller_epoch: epoch, writer_grant_id: grant.grant_id,
      };
      // Journal first: a crash before the receipt file is repaired by an identical replay.
      write("control", { ...receipt, receipt_sha256: sha256(receiptBytes(receipt)) });
      publishReceipt(receipt);
      return receipt;
    },

    setAdmission(grant, execution_id, state) {
      assertLive();
      checkWriter(grant);
      requireId(execution_id, "execution_id");
      if (!["reconcile_only", "revoked", "sealed"].includes(state)) throw new ControllerRefusal("request_invalid", `unknown admission ${String(state)}`);
      const cur = view.admission.get(execution_id) ?? "active";
      if (cur === state) return;
      if (cur === "revoked" || cur === "sealed") throw new ControllerRefusal("admission_transition_refused", `${execution_id} is ${cur}`);
      write("admission", { execution_id, state });
    },

    collectObservations() {
      assertLive();
      const report: CollectReport = { accepted: [], replayed: [], truncated: false, rejected: [] };
      const execRoot = durablePath("runs", run_id, "executions");
      const execAbs = checkContained(durableRoot, execRoot, { policy: "physical" });
      if (isRefused(execAbs) || !fs.existsSync(execAbs.realPath)) return report;
      const all: Array<{ key: string; obsRel: string; execution_id: string; file: string }> = [];
      let execDirents: fs.Dirent[];
      try { execDirents = fs.readdirSync(execAbs.realPath, { withFileTypes: true }); } catch { return report; }
      const execs = execDirents.filter((d) => d.isDirectory() && ID_RE.test(d.name)).map((d) => d.name).sort();
      for (const execution_id of execs) {
        const obsRel = path.join(execRoot, execution_id, "observations");
        const obsAbs = checkContained(durableRoot, obsRel, { policy: "physical" });
        if (isRefused(obsAbs)) continue;
        // A worker may plant a file or swap a directory here; skip that execution, never abort the sweep.
        let names: fs.Dirent[];
        try { names = fs.readdirSync(obsAbs.realPath, { withFileTypes: true }); } catch { continue; }
        for (const d of names) {
          if (d.isFile() && d.name.endsWith(".json") && !d.name.startsWith(".")) all.push({ key: `${execution_id}/${d.name}`, obsRel, execution_id, file: d.name });
        }
      }
      // Traversal and cursor share one order: the composite key.
      all.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
      // Fair traversal: resume after the last file examined, wrapping around, so a
      // prefix of retained or junk files cannot starve later observations.
      const start = all.findIndex((c) => c.key > collectCursor);
      const order = start <= 0 ? all : [...all.slice(start), ...all.slice(0, start)];
      const batch = order.slice(0, maxPerCollect);
      report.truncated = order.length > batch.length;
      collectCursor = report.truncated ? batch[batch.length - 1]!.key : "";
      for (const { obsRel, execution_id, file } of batch) {
        {
          const observation_id = file.slice(0, -5);
          const reject = (c: ObservationRejection) => { report.rejected.push({ observation_id, code: c }); };
          let raw: string | null = null;
          try { raw = ID_RE.test(observation_id) ? readDurable(durableRoot, path.join(obsRel, file), MAX_OBSERVATION_BYTES) : null; } catch { raw = null; }
          let rec: Record<string, unknown> | null = null;
          try { rec = raw === null ? null : (JSON.parse(raw) as Record<string, unknown>); } catch { rec = null; }
          if (!isObj(rec) || rec.schema_version !== WORKER_OBSERVATION_SCHEMA || rec.run_id !== run_id || rec.execution_id !== execution_id
            || rec.observation_id !== observation_id || typeof rec.grant_id !== "string" || typeof rec.grant_claims_hash !== "string"
            || typeof rec.mac !== "string" || !("body" in rec) || Object.keys(rec).length !== 8) { reject("observation_invalid"); continue; }
          let digest: string;
          try { digest = sha256(canonical(rec)); } catch { reject("observation_invalid"); continue; }
          const prior = view.observations.get(`${execution_id}/${observation_id}`);
          if (prior !== undefined) {
            if (prior === digest) report.replayed.push(observation_id);
            else reject("observation_conflict");
            continue;
          }
          const g = view.attemptGrants.get(rec.grant_id);
          if (!g || g.claims_hash !== rec.grant_claims_hash || g.execution_id !== execution_id || g.run_id !== run_id) { reject("grant_forged"); continue; }
          const { claims_hash: _c, ...claims } = g;
          const { mac, ...signed } = rec;
          if (!macEqual(String(mac), hmac(workerSecret(claims), canonical(signed)))) { reject("observation_forged"); continue; }
          if (now() > g.expires_at_ms) { reject("grant_expired"); continue; }
          const admission = effectiveAdmission(g);
          if (admission === "revoked") { reject("admission_revoked"); continue; }
          if (admission === "sealed") { reject("admission_sealed"); continue; }
          try {
            write("observation", { execution_id, observation_id, grant_id: g.grant_id, digest, admission }, () => {
              if (now() > g.expires_at_ms) throw new ControllerRefusal("request_invalid", "grant expired before commit");
            });
          } catch (err) {
            if (err instanceof ControllerRefusal && err.code === "request_invalid") { reject("grant_expired"); continue; }
            throw err;
          }
          report.accepted.push({ observation_id, execution_id, admission });
        }
      }
      return report;
    },

    bindArtifact(grant, a) {
      assertLive();
      checkWriter(grant);
      if (a?.kind !== "assurance-ledger") throw new ControllerRefusal("artifact_invalid", `unsupported artifact kind ${String(a?.kind)}`);
      const id = requireId(a.id, "artifact id");
      if (typeof a.text !== "string") throw new ControllerRefusal("artifact_invalid", "artifact text must be a string");
      let parsed: unknown;
      try { parsed = JSON.parse(a.text); } catch { throw new ControllerRefusal("artifact_invalid", "assurance ledger is not JSON"); }
      const claimed = isObj(parsed) ? parsed.ledger_hash : undefined;
      if (typeof claimed !== "string" || !HASH_RE.test(claimed)) throw new ControllerRefusal("artifact_invalid", "assurance ledger has no ledger_hash");
      const digest = sha256(Buffer.from(a.text, "utf8"));
      write("artifact_bind", { kind: a.kind, id, sha256: digest, claimed_hash: claimed });
      return { kind: a.kind, id, sha256: digest };
    },

    assertWritable(grant) { assertLive(); if (grant !== undefined) checkWriter(grant); },

    extend(grant, body) {
      assertLive();
      checkWriter(grant);
      if (!isObj(body)) throw new ControllerRefusal("request_invalid", "extension body must be an object");
      canonical(body);
      const e = write("extension", { ext: body });
      return { seq: e.seq, epoch: e.epoch, at_ms: e.at_ms, body: structuredClone(body) };
    },

    extensionRecords,

    attemptClaims(grant_id) {
      const g = view.attemptGrants.get(grant_id);
      if (!g) return undefined;
      const { claims_hash: _h, ...claims } = g;
      return claims;
    },

    controllerMac(purpose, message) {
      return hmac(k, `guild.ext\0${requireId(purpose, "purpose")}\0${message}`);
    },

    attemptAdmission(grant_id) {
      const g = view.attemptGrants.get(grant_id);
      return g ? effectiveAdmission(g) : undefined;
    },

    attemptMac(grant_id, message) {
      const g = view.attemptGrants.get(grant_id);
      if (!g) throw new ControllerRefusal("request_invalid", `unknown attempt grant ${grant_id}`);
      const { claims_hash: _h, ...claims } = g;
      return hmac(workerSecret(claims), message);
    },
  };
}

// ── worker side (no key) ─────────────────────────────────────────────────────

/** Worker-side: write one observation under `.guild/`, MACed with the attempt grant secret. */
export function writeWorkerObservation(
  durableRoot: string,
  run_id: string,
  grant: AttemptGrant,
  obs: { observation_id: string; body: unknown },
): void {
  const claims = grant.claims;
  const execution_id = requireId(claims.execution_id, "execution_id");
  const observation_id = requireId(obs.observation_id, "observation_id");
  const signed = {
    schema_version: WORKER_OBSERVATION_SCHEMA,
    run_id: requireId(run_id, "run_id"),
    execution_id,
    observation_id,
    grant_id: requireId(claims.grant_id, "grant_id"),
    grant_claims_hash: sha256(canonical(claims)),
    body: obs.body,
  };
  const rec = { ...signed, mac: hmac(grant.secret, canonical(signed)) };
  const bytes = Buffer.from(`${JSON.stringify(rec)}\n`, "utf8");
  if (bytes.length > MAX_OBSERVATION_BYTES) throw new ControllerRefusal("request_invalid", "observation exceeds the size bound");
  publishDurable(path.resolve(durableRoot), durablePath("runs", run_id, "executions", execution_id, "observations", `${observation_id}.json`), bytes, "observation_exists");
}

/** The only grant form allowed in shareable refs: no nonce, no secret, no claims hash. */
export function shareableGrantRef(grant: WriterGrant | AttemptGrant): ShareableGrantRef {
  if (grant.kind === "attempt") {
    return { kind: "attempt", grant_id: grant.claims.grant_id, issued_controller_epoch: grant.claims.issued_controller_epoch, scope_hash: grant.claims.scope_hash, execution_id: grant.claims.execution_id };
  }
  return { kind: "writer", grant_id: grant.grant_id, issued_controller_epoch: grant.issued_controller_epoch, scope_hash: grant.scope_hash, execution_id: null };
}

/** Verify a control receipt under `.guild/` against the keyed journal. */
export function verifyControlReceipt(opts: { privateDir: string; durableRoot: string; run_id: string; operation_id: string }):
  { ok: true } | { ok: false; code: "receipt_unbound" | "receipt_missing" | "receipt_mismatch" } {
  const view = readControllerJournal({ privateDir: opts.privateDir });
  const bound = view.run_id === opts.run_id ? view.operations.get(opts.operation_id) : undefined;
  if (!bound) return { ok: false, code: "receipt_unbound" };
  const raw = readDurable(path.resolve(opts.durableRoot), durablePath("runs", opts.run_id, "controller", "receipts", `${requireId(opts.operation_id, "operation_id")}.json`), MAX_ENTRY_BYTES);
  if (raw === null) return { ok: false, code: "receipt_missing" };
  return macEqual(sha256(Buffer.from(raw, "utf8")), bound.receipt_sha256) ? { ok: true } : { ok: false, code: "receipt_mismatch" };
}

/** Verify artifact bytes (e.g. a W02 assurance ledger) against the latest controller binding. */
export function verifyBoundArtifact(opts: { privateDir: string; kind: ArtifactKind; id: string; text: string }):
  { ok: true } | { ok: false; code: "artifact_unbound" | "artifact_mismatch" } {
  const view = readControllerJournal({ privateDir: opts.privateDir });
  const bound = view.artifacts.get(`${opts.kind}\0${opts.id}`);
  if (!bound) return { ok: false, code: "artifact_unbound" };
  return macEqual(sha256(Buffer.from(opts.text, "utf8")), bound.sha256) ? { ok: true } : { ok: false, code: "artifact_mismatch" };
}

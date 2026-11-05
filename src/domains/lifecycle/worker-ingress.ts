/**
 * src/domains/lifecycle/worker-ingress.ts — R03 worker ingress and safe
 * remote execution (AT12, AT13).
 *
 * Threat model: the worker is untrusted. Everything it submits (records,
 * file names, sizes, replays, effect claims) is hostile input. The R02 run
 * controller and in-process callers are trusted.
 *
 * Isolation: a worker gets an attempt workspace outside the project and the
 * controller state, an attempt grant (MAC secret only) and an allowlisted
 * environment. It never gets the durable-root path, a writer grant, the
 * controller key or a credential. It writes records into its own `ingress/`
 * directory; the controller reads them bounded and no-follow, verifies source,
 * run, attempt, grant, MAC, expiry, admission and scope, journals the accepted
 * ones, and writes the durable copy itself. Adapters must present a capability
 * proof with no durable-root access and no credential forwarding; a remote host
 * is refused unless explicitly listed as qualified (none are, until V01).
 *
 * Attempt ownership: one live attempt per task. A new attempt is dispatched
 * only after the previous one is fenced and released, and release requires
 * every effect it started to be settled. External effects run only through
 * the trusted executor (`runEffect`), which holds the credentials the worker
 * never gets: the worker submits `effect_intent`, collection journals it and
 * returns a controller-keyed permit, and the executor consumes the permit
 * (journal `effect_start`), acts, then journals `effect_done`. A crash in
 * between leaves the effect uncertain. A key that is permitted, started or
 * done never gets a second permit; worker outcome claims are recorded but
 * never settle anything. Uncertain effects are surfaced and wait for a trusted
 * verdict; they are never replayed.
 *
 * State lives only in the controller's keyed journal (extension records), so
 * it survives restarts and is fenced with the controller epoch.
 * Activation stays gated: nothing here is wired into a launcher or hook.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalizeRealPath, checkContained, isRefused, isWithin, prepareContainedWrite } from "../kernel";
import {
  openRunController,
  type AttemptGrant,
  type ExtensionRecord,
  type OpenControllerOptions,
  type RunController,
  type WriterGrant,
} from "./run-controller";

export const WORKER_RECORD_SCHEMA = "guild.worker_ingress_record.v1" as const;
export const ADAPTER_CAPABILITY_SCHEMA = "guild.adapter_capability_proof.v1" as const;
export const WORKER_BUNDLE_SCHEMA = "guild.worker_bundle.v1" as const;
export const EFFECT_PERMIT_SCHEMA = "guild.effect_permit.v1" as const;
export const INGRESS_RECORD_COPY_SCHEMA = "guild.ingress_record_copy.v1" as const;
const NS = "r03.ingress";

export type IngressRefusalCode =
  | "capability_refused"
  | "remote_unqualified"
  | "durable_root_exposed"
  | "credential_forwarding_refused"
  | "workspace_not_isolated"
  | "attempt_live"
  | "attempt_unbound"
  | "attempt_exists"
  | "attempt_unknown"
  | "attempt_not_fenced"
  | "attempt_released"
  | "effects_unreconciled"
  | "reconcile_refused"
  | "permit_invalid"
  | "effect_refused"
  | "request_invalid";

export class IngressRefusal extends Error {
  constructor(readonly code: IngressRefusalCode, detail: string, readonly uncertain: string[] = []) {
    super(`worker ingress refused (${code}): ${detail}`);
    this.name = "IngressRefusal";
  }
}

export interface AdapterCapabilityProof {
  schema_version: typeof ADAPTER_CAPABILITY_SCHEMA;
  adapter_id: string;
  transport: "local_process" | "remote_host";
  host_id: string;
  workspace: "isolated";
  durable_root_access: "none" | "read_only" | "read_write";
  credential_forwarding: "none" | "env" | "agent";
  env_allowlist: string[];
}

export interface IngressLimits {
  max_record_bytes: number;
  max_records_per_collect: number;
  max_bytes_per_collect: number;
  max_records_per_attempt: number;
  max_entries_scanned: number;
}
const DEFAULT_LIMITS: IngressLimits = {
  max_record_bytes: 64 * 1024,
  max_records_per_collect: 256,
  max_bytes_per_collect: 4 * 1024 * 1024,
  max_records_per_attempt: 4096,
  max_entries_scanned: 8192,
};

export interface WorkerBundle {
  schema_version: typeof WORKER_BUNDLE_SCHEMA;
  source_id: string;
  run_id: string;
  task_id: string;
  attempt_id: string;
  execution_id: string;
  workspace: string;
  ingress_dir: string;
  effects: boolean;
  limits: { max_record_bytes: number };
  env: Record<string, string>;
  capability_hash: string;
  grant: AttemptGrant;
}

export type RecordKind = "observation" | "effect_intent" | "effect_result";
export type RecordRejection =
  | "record_invalid"
  | "payload_oversized"
  | "foreign_source"
  | "grant_mismatch"
  | "grant_forged"
  | "record_forged"
  | "grant_expired"
  | "admission_revoked"
  | "admission_sealed"
  | "scope_denied"
  | "quota_exceeded"
  | "effect_replay_refused"
  | "effect_result_unmatched"
  | "record_conflict";

export interface EffectPermit {
  schema_version: typeof EFFECT_PERMIT_SCHEMA;
  run_id: string;
  attempt_id: string;
  grant_id: string;
  effect_key: string;
  controller_epoch: number;
  /** Controller-keyed; the worker relays the permit but cannot mint or alter one. */
  mac: string;
}

export interface IngressReport {
  accepted: Array<{ attempt_id: string; record_id: string; kind: RecordKind }>;
  replayed: string[];
  rejected: Array<{ attempt_id: string; record_id: string; code: RecordRejection }>;
  permits: EffectPermit[];
  truncated: boolean;
}

export type EffectState = "permitted" | "unstarted" | "in_flight" | "uncertain" | "applied" | "not_applied";
export interface TaskState {
  task_id: string;
  live_attempt: string | null;
  attempts: Array<{ attempt_id: string; fenced: boolean; released: boolean }>;
  /** `worker_claim` is the worker's untrusted report; it never settles an effect. */
  effects: Array<{ effect_key: string; state: EffectState; attempt_id: string; worker_claim: "applied" | "failed" | null }>;
  uncertain_effects: string[];
  receipt_loss_reconciled: boolean;
}

export interface WorkerIngressOptions extends Omit<OpenControllerOptions, "attemptGate"> {
  /** Parent directory for isolated attempt workspaces; must not overlap the project or controller state. */
  workspaceRoot: string;
  /** Remote hosts that passed second-host qualification. Empty until V01. */
  qualifiedRemoteHosts?: readonly string[];
  limits?: Partial<IngressLimits>;
  /** Environment the allowlist is applied to. Default `process.env`. */
  env?: Record<string, string | undefined>;
}

export interface WorkerIngress {
  readonly controller: RunController;
  dispatchAttempt(grant: WriterGrant, req: { task_id: string; attempt_id: string; execution_id: string; effects: boolean; expires_at_ms: number; capability: AdapterCapabilityProof }): WorkerBundle;
  collect(): IngressReport;
  fenceAttempt(grant: WriterGrant, attempt_id: string): void;
  reconcileEffect(grant: WriterGrant, r: { task_id: string; effect_key: string; verdict: "applied" | "not_applied"; evidence_ref: string }): void;
  releaseAttempt(grant: WriterGrant, attempt_id: string): void;
  /**
   * Trusted effect executor: consumes a controller permit, journals start, runs `effect`, journals done.
   * An async effect is journaled done only after its promise fulfils; a throw, a rejection, or a fence
   * meanwhile leaves it `started` (uncertain).
   */
  runEffect<T>(grant: WriterGrant, permit: EffectPermit, effect: () => T): T;
  /** Re-publish any durable record copy missing on disk from the journal. Returns how many were written. */
  repairRecordCopies(): number;
  taskState(task_id: string): TaskState;
  verifyRecordCopy(attempt_id: string, record_id: string): { ok: true } | { ok: false; code: "record_unbound" | "record_copy_missing" | "record_copy_mismatch" };
  close(): void;
}

// ── primitives ───────────────────────────────────────────────────────────────

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** Names that look like credentials or controller material are never forwarded. */
const CREDENTIAL_NAME_RE = /(TOKEN|SECRET|PASSW|CREDENTIAL|API_?KEY|PRIVATE|AUTH|SESSION|COOKIE|SSH_|GPG|AWS_|GH_|GITHUB_|NPM_|GUILD_CONTROLLER|_KEY$|^KEY)/i;
const RECORD_KEYS = "attempt_id,body,effect_key,grant_claims_hash,grant_id,kind,mac,outcome,record_id,run_id,schema_version,source_id,task_id";
const CAP_KEYS = "adapter_id,credential_forwarding,durable_root_access,env_allowlist,host_id,schema_version,transport,workspace";
const KINDS: readonly RecordKind[] = ["observation", "effect_intent", "effect_result"];

function canonical(v: unknown, depth = 0): string {
  if (depth > 64) throw new IngressRefusal("request_invalid", "value nests too deeply");
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new IngressRefusal("request_invalid", "non-finite number");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x, depth + 1)).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k], depth + 1)}`).join(",")}}`;
  }
  throw new IngressRefusal("request_invalid", `unsupported value ${typeof v}`);
}
const sha256 = (s: string | Buffer) => `sha256:${crypto.createHash("sha256").update(s).digest("hex")}`;
const hmac = (key: string, s: string) => crypto.createHmac("sha256", key).update(s, "utf8").digest("hex");
function macEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function requireId(v: unknown, what: string): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new IngressRefusal("request_invalid", `${what} is not an id`);
  return v;
}
const recordMessage = (signed: Record<string, unknown>) => `guild.r03.record\0${canonical(signed)}`;
const PERMIT_PURPOSE = "r03.effect-permit";
const permitMessage = (p: { run_id: string; attempt_id: string; grant_id: string; effect_key: string; controller_epoch: number }) =>
  canonical({ run_id: p.run_id, attempt_id: p.attempt_id, grant_id: p.grant_id, effect_key: p.effect_key, controller_epoch: p.controller_epoch });

type Read = { kind: "ok"; text: string; bytes: number } | { kind: "oversized" } | { kind: "invalid" };
/** Read a hostile file: no symlink follow, no FIFO block, size checked before any read. */
function readHostile(file: string, max: number): Read {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch {
    return { kind: "invalid" };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { kind: "invalid" };
    if (st.size > max) return { kind: "oversized" };
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = fs.readSync(fd, buf, off, st.size - off, off);
      if (n <= 0) break;
      off += n;
    }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, off) > 0) return { kind: "oversized" };
    return { kind: "ok", text: buf.subarray(0, off).toString("utf8"), bytes: off };
  } catch {
    return { kind: "invalid" };
  } finally {
    fs.closeSync(fd);
  }
}

/** Write-once into a controller-owned directory: O_EXCL temp, fsync, link(2). False = identical bytes already present. */
function writeOnce(root: string, rel: string, bytes: Buffer): boolean {
  const prepared = prepareContainedWrite(root, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(prepared)) throw new IngressRefusal("request_invalid", `durable write refused (${prepared.code})`);
  const final = prepared.realPath;
  const tmp = path.join(path.dirname(final), `.${path.basename(final)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let created = false;
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
      fs.linkSync(tmp, final);
      created = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  const after = checkContained(root, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(after) || after.realPath !== final) {
    if (created) fs.rmSync(final, { force: true });
    throw new IngressRefusal("request_invalid", "containment changed during publication");
  }
  if (!created) {
    const r = readHostile(final, bytes.length);
    if (r.kind !== "ok" || r.text !== bytes.toString("utf8")) throw new IngressRefusal("request_invalid", `${rel} already holds different bytes`);
  }
  return created;
}

// ── capability proofs ────────────────────────────────────────────────────────

function checkCapability(c: AdapterCapabilityProof, controllerHost: string, qualified: ReadonlySet<string>): string {
  if (!isObj(c) || Object.keys(c).sort().join(",") !== CAP_KEYS || c.schema_version !== ADAPTER_CAPABILITY_SCHEMA || c.workspace !== "isolated"
    || !ID_RE.test(String(c.adapter_id)) || !ID_RE.test(String(c.host_id)) || !Array.isArray(c.env_allowlist)
    || !["local_process", "remote_host"].includes(c.transport)) {
    throw new IngressRefusal("capability_refused", "capability proof is malformed");
  }
  if (c.durable_root_access !== "none") throw new IngressRefusal("durable_root_exposed", `adapter ${c.adapter_id} grants ${String(c.durable_root_access)} durable-root access`);
  if (c.credential_forwarding !== "none") throw new IngressRefusal("credential_forwarding_refused", `adapter ${c.adapter_id} forwards credentials (${String(c.credential_forwarding)})`);
  for (const name of c.env_allowlist) {
    if (typeof name !== "string" || !ENV_NAME_RE.test(name)) throw new IngressRefusal("capability_refused", "env allowlist holds an invalid name");
    if (CREDENTIAL_NAME_RE.test(name)) throw new IngressRefusal("credential_forwarding_refused", `env ${name} looks like a credential`);
  }
  if (c.transport === "local_process" && c.host_id !== controllerHost) throw new IngressRefusal("capability_refused", "a local adapter must run on the controller host");
  if (c.transport === "remote_host" && !qualified.has(c.host_id)) throw new IngressRefusal("remote_unqualified", `host ${c.host_id} has no second-host qualification`);
  return sha256(canonical(c));
}

function overlaps(a: string, b: string): boolean {
  return isWithin(a, b) || isWithin(b, a);
}

// ── journal fold ─────────────────────────────────────────────────────────────

interface Bind {
  task_id: string; attempt_id: string; execution_id: string; effects: boolean; expires_at_ms: number;
  capability_hash: string; workspace: string; grant_id: string | null; fenced: boolean; released: boolean;
}
interface Effect {
  attempt_id: string;
  state: "permitted" | "started" | "done" | "applied" | "not_applied";
  permit_epoch: number;
  claim: "applied" | "failed" | null;
}
interface Fold {
  binds: Map<string, Bind>;
  liveByTask: Map<string, string>;
  ingested: Map<string, { digest: string; kind: RecordKind; effect_key: string | null; copy: string }>;
  perAttempt: Map<string, number>;
  /** key `${task_id}\0${effect_key}` */
  effects: Map<string, Effect>;
  reconciledTasks: Set<string>;
}

function fold(records: readonly ExtensionRecord[]): Fold {
  const f: Fold = { binds: new Map(), liveByTask: new Map(), ingested: new Map(), perAttempt: new Map(), effects: new Map(), reconciledTasks: new Set() };
  for (const { body: b, epoch } of records) {
    if (b.ns !== NS) continue;
    const attempt_id = String(b.attempt_id);
    switch (b.type) {
      case "bind":
        f.binds.set(attempt_id, {
          task_id: String(b.task_id), attempt_id, execution_id: String(b.execution_id), effects: b.effects === true,
          expires_at_ms: Number(b.expires_at_ms), capability_hash: String(b.capability_hash), workspace: String(b.workspace),
          grant_id: null, fenced: false, released: false,
        });
        f.liveByTask.set(String(b.task_id), attempt_id);
        break;
      case "grant": { const x = f.binds.get(attempt_id); if (x) x.grant_id = String(b.grant_id); break; }
      case "fence": { const x = f.binds.get(attempt_id); if (x) x.fenced = true; break; }
      case "release": {
        const x = f.binds.get(attempt_id);
        if (x) { x.released = true; if (f.liveByTask.get(x.task_id) === attempt_id) f.liveByTask.delete(x.task_id); }
        break;
      }
      case "ingest": {
        const kind = b.kind as RecordKind;
        const effect_key = typeof b.effect_key === "string" ? b.effect_key : null;
        f.ingested.set(`${attempt_id}/${String(b.record_id)}`, { digest: String(b.digest), kind, effect_key, copy: String(b.copy) });
        f.perAttempt.set(attempt_id, (f.perAttempt.get(attempt_id) ?? 0) + 1);
        const task = f.binds.get(attempt_id)?.task_id;
        if (task && effect_key) {
          const k = `${task}\0${effect_key}`;
          const cur = f.effects.get(k);
          if (kind === "effect_intent" && b.replay_permit !== true) f.effects.set(k, { attempt_id, state: "permitted", permit_epoch: epoch, claim: null });
          else if (kind === "effect_result" && cur && cur.attempt_id === attempt_id) cur.claim = b.outcome === "applied" ? "applied" : "failed";
        }
        break;
      }
      case "effect_start":
      case "effect_done": {
        const e = f.effects.get(`${String(b.task_id)}\0${String(b.effect_key)}`);
        if (e && e.attempt_id === attempt_id) e.state = b.type === "effect_start" ? "started" : "done";
        break;
      }
      case "reconcile": {
        const k = `${String(b.task_id)}\0${String(b.effect_key)}`;
        const e = f.effects.get(k);
        if (e) e.state = b.verdict === "applied" ? "applied" : "not_applied";
        f.reconciledTasks.add(String(b.task_id));
        break;
      }
      default:
        break;
    }
  }
  return f;
}

/**
 * Unsettled: the trusted executor started the effect and never journaled done.
 * Worker claims never settle anything. A permit the executor never consumed
 * cannot have produced an executor effect, so it settles once fenced.
 */
const unsettled = (e: Effect) => e.state === "started";
/** May a new intent for this key be permitted? Never permitted, reconciled not_applied, or an unconsumed permit of a fenced attempt. */
const permittable = (e: Effect | undefined, f: Fold) =>
  !e || e.state === "not_applied" || (e.state === "permitted" && f.binds.get(e.attempt_id)?.fenced === true);

// ── ingress ──────────────────────────────────────────────────────────────────

export function openWorkerIngress(opts: WorkerIngressOptions): WorkerIngress {
  const limits: IngressLimits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) };
  for (const v of Object.values(limits)) if (!Number.isSafeInteger(v) || v <= 0) throw new IngressRefusal("request_invalid", "limits must be positive integers");
  const now = opts.now ?? Date.now;
  const qualified = new Set(opts.qualifiedRemoteHosts ?? []);
  const env = opts.env ?? process.env;
  const durableRoot = path.resolve(opts.durableRoot);
  const privateDir = path.resolve(opts.privateDir);
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const run_id = opts.run_id;

  const gate = (req: { execution_id: string; attempt_id: string }, records: readonly ExtensionRecord[]): void => {
    const f = fold(records);
    const b = f.binds.get(req.attempt_id);
    if (!b || b.execution_id !== req.execution_id) throw new IngressRefusal("attempt_unbound", `attempt ${req.attempt_id} was not dispatched through ingress`);
    if (b.fenced || b.released) throw new IngressRefusal("attempt_released", `attempt ${req.attempt_id} is fenced`);
    if (f.liveByTask.get(b.task_id) !== req.attempt_id) throw new IngressRefusal("attempt_live", `task ${b.task_id} has another live attempt`);
  };
  const controller = openRunController({ ...opts, attemptGate: gate });
  let internal: WriterGrant;
  try {
    internal = controller.issueWriterGrant("ingress");
  } catch (e) {
    controller.close();
    throw e;
  }
  const cursors = new Map<string, string>();

  const state = (): Fold => fold(controller.extensionRecords());
  const extend = (grant: WriterGrant, body: Record<string, unknown>) => controller.extend(grant, { ns: NS, ...body });
  const scopeOf = (effects: boolean) => (effects ? "ingress.effects" : "ingress.observe");
  const copyRel = (attempt_id: string, record_id: string) => path.join(".guild", "runs", run_id, "attempts", attempt_id, "records", `${record_id}.json`);

  const workspaceFor = (attempt_id: string): string => {
    let realRoot: string;
    try {
      fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
      realRoot = canonicalizeRealPath(workspaceRoot);
    } catch {
      throw new IngressRefusal("workspace_not_isolated", "workspace root is unusable");
    }
    const fences = [canonicalizeRealPath(durableRoot), canonicalizeRealPath(privateDir)];
    if (fences.some((x) => overlaps(realRoot, x))) throw new IngressRefusal("workspace_not_isolated", "workspace root overlaps the project or controller state");
    const rel = path.join(run_id, attempt_id, "ingress");
    const prepared = prepareContainedWrite(realRoot, path.join(rel, ".keep"), { policy: "physical" });
    if (isRefused(prepared)) throw new IngressRefusal("workspace_not_isolated", `attempt workspace refused (${prepared.code})`);
    const ws = path.dirname(prepared.realDir);
    if (fences.some((x) => overlaps(canonicalizeRealPath(ws), x))) throw new IngressRefusal("workspace_not_isolated", "attempt workspace resolves into the project or controller state");
    return ws;
  };

  const bundleFor = (b: Bind, grant: AttemptGrant, cap: AdapterCapabilityProof): WorkerBundle => {
    const allowed: Record<string, string> = {};
    for (const name of cap.env_allowlist) {
      const v = env[name];
      if (typeof v === "string") allowed[name] = v;
    }
    return {
      schema_version: WORKER_BUNDLE_SCHEMA, source_id: controller.source_id, run_id, task_id: b.task_id, attempt_id: b.attempt_id,
      execution_id: b.execution_id, workspace: b.workspace, ingress_dir: path.join(b.workspace, "ingress"), effects: b.effects,
      limits: { max_record_bytes: limits.max_record_bytes }, env: allowed, capability_hash: b.capability_hash, grant,
    };
  };

  const repairCopies = (): number => {
    let written = 0;
    for (const [k, rec] of state().ingested) {
      const [attempt_id, record_id] = k.split("/") as [string, string];
      const rel = copyRel(attempt_id, record_id);
      const c = checkContained(durableRoot, rel, { policy: "physical" });
      if (isRefused(c) || fs.existsSync(c.realPath)) continue;
      if (writeOnce(durableRoot, rel, Buffer.from(rec.copy, "utf8"))) written++;
    }
    return written;
  };

  return {
    controller,

    dispatchAttempt(grant, req) {
      controller.assertWritable(grant);
      const task_id = requireId(req?.task_id, "task_id");
      const attempt_id = requireId(req.attempt_id, "attempt_id");
      const execution_id = requireId(req.execution_id, "execution_id");
      if (typeof req.effects !== "boolean") throw new IngressRefusal("request_invalid", "effects must be boolean");
      if (!Number.isSafeInteger(req.expires_at_ms) || req.expires_at_ms <= now()) throw new IngressRefusal("request_invalid", "expires_at_ms must be a future instant");
      const capability_hash = checkCapability(req.capability, opts.host_id, qualified);
      let f = state();
      const prior = f.binds.get(attempt_id);
      if (prior) {
        if (prior.task_id !== task_id || prior.execution_id !== execution_id || prior.effects !== req.effects
          || prior.expires_at_ms !== req.expires_at_ms || prior.capability_hash !== capability_hash) {
          throw new IngressRefusal("attempt_exists", `attempt ${attempt_id} is already bound`);
        }
        if (prior.fenced || prior.released) throw new IngressRefusal("attempt_released", `attempt ${attempt_id} is fenced`);
      } else {
        const live = f.liveByTask.get(task_id);
        if (live) throw new IngressRefusal("attempt_live", `task ${task_id} still has attempt ${live}; fence, reconcile and release it first`);
        const workspace = workspaceFor(attempt_id);
        // Bind before the grant exists: a crash in between leaves a reserved,
        // grant-less attempt that still blocks the task until released.
        extend(grant, { type: "bind", task_id, attempt_id, execution_id, effects: req.effects, expires_at_ms: req.expires_at_ms, capability_hash, workspace });
        f = state();
      }
      const b = f.binds.get(attempt_id)!;
      const ag = controller.issueAttemptGrant({ execution_id, attempt_id, scope: scopeOf(req.effects), expires_at_ms: req.expires_at_ms });
      if (b.grant_id === null) extend(grant, { type: "grant", attempt_id, grant_id: ag.grant_id });
      else if (b.grant_id !== ag.grant_id) throw new IngressRefusal("attempt_exists", "attempt grant changed");
      return bundleFor({ ...b, grant_id: ag.grant_id }, ag, req.capability);
    },

    collect() {
      controller.assertWritable();
      // Copies lost between journal commit and publication come back from the journal, whatever the worker kept.
      repairCopies();
      const report: IngressReport = { accepted: [], replayed: [], rejected: [], permits: [], truncated: false };
      const binds = [...state().binds.values()].filter((b) => !b.fenced && !b.released && b.grant_id !== null)
        .sort((x, y) => (x.attempt_id < y.attempt_id ? -1 : 1));
      for (const b of binds) {
        const grant_id = b.grant_id!;
        const claims = controller.attemptClaims(grant_id);
        if (!claims) continue;
        const claimsHash = sha256(canonical(claims));
        const inbox = checkContained(b.workspace, "ingress", { policy: "physical" });
        if (isRefused(inbox)) continue;
        // Bounded listing: a flooded inbox only stalls its own attempt.
        const names: string[] = [];
        let dir: fs.Dir | null = null;
        let scanned = 0;
        try {
          dir = fs.opendirSync(inbox.realPath);
          for (let d = dir.readSync(); d; d = dir.readSync()) {
            // Every entry counts against the scan budget, whatever its name.
            if (++scanned > limits.max_entries_scanned) { report.truncated = true; break; }
            if (d.name.endsWith(".json") && !d.name.startsWith(".")) names.push(d.name);
          }
        } catch {
          continue;
        } finally {
          try { dir?.closeSync(); } catch { /* already closed */ }
        }
        names.sort();
        const cursor = cursors.get(b.attempt_id) ?? "";
        const start = names.findIndex((n) => n > cursor);
        const order = start <= 0 ? names : [...names.slice(start), ...names.slice(0, start)];
        let examined = 0;
        let bytes = 0;
        let last = "";
        let f = state();
        for (const name of order) {
          const record_id = name.slice(0, -5);
          if (!ID_RE.test(record_id)) continue;
          if (f.ingested.has(`${b.attempt_id}/${record_id}`)) { report.replayed.push(`${b.attempt_id}/${record_id}`); continue; }
          if (examined >= limits.max_records_per_collect || bytes >= limits.max_bytes_per_collect) { report.truncated = true; break; }
          examined++;
          last = name;
          const reject = (code: RecordRejection) => { report.rejected.push({ attempt_id: b.attempt_id, record_id, code }); };
          if ((f.perAttempt.get(b.attempt_id) ?? 0) >= limits.max_records_per_attempt) { reject("quota_exceeded"); continue; }
          const leaf = checkContained(b.workspace, path.join("ingress", name), { policy: "physical", requireRegularFileLeaf: true });
          if (isRefused(leaf)) { reject("record_invalid"); continue; }
          const r = readHostile(leaf.realPath, limits.max_record_bytes);
          if (r.kind === "oversized") { reject("payload_oversized"); continue; }
          if (r.kind !== "ok") { reject("record_invalid"); continue; }
          bytes += r.bytes;
          let rec: Record<string, unknown>;
          let signedText: string;
          try {
            const parsed = JSON.parse(r.text) as unknown;
            if (!isObj(parsed) || Object.keys(parsed).sort().join(",") !== RECORD_KEYS) throw new Error("shape");
            rec = parsed;
            const { mac: _m, ...signed } = rec;
            signedText = recordMessage(signed);
          } catch { reject("record_invalid"); continue; }
          if (rec.schema_version !== WORKER_RECORD_SCHEMA || rec.record_id !== record_id || typeof rec.mac !== "string"
            || !KINDS.includes(rec.kind as RecordKind) || typeof rec.source_id !== "string" || typeof rec.run_id !== "string") { reject("record_invalid"); continue; }
          if (rec.source_id !== controller.source_id || rec.run_id !== run_id) { reject("foreign_source"); continue; }
          if (rec.attempt_id !== b.attempt_id || rec.task_id !== b.task_id || rec.grant_id !== grant_id) { reject("grant_mismatch"); continue; }
          if (rec.grant_claims_hash !== claimsHash) { reject("grant_forged"); continue; }
          if (!macEqual(rec.mac, controller.attemptMac(grant_id, signedText))) { reject("record_forged"); continue; }
          if (now() > claims.expires_at_ms) { reject("grant_expired"); continue; }
          const admission = controller.attemptAdmission(grant_id);
          if (admission === "revoked") { reject("admission_revoked"); continue; }
          if (admission === "sealed") { reject("admission_sealed"); continue; }
          const kind = rec.kind as RecordKind;
          let effect_key: string | null = null;
          let outcome: string | null = null;
          if (kind === "observation") {
            if (rec.effect_key !== null || rec.outcome !== null) { reject("record_invalid"); continue; }
          } else {
            if (!b.effects) { reject("scope_denied"); continue; }
            if (typeof rec.effect_key !== "string" || !ID_RE.test(rec.effect_key)) { reject("record_invalid"); continue; }
            effect_key = rec.effect_key;
            const e = f.effects.get(`${b.task_id}\0${effect_key}`);
            if (kind === "effect_intent") {
              if (rec.outcome !== null) { reject("record_invalid"); continue; }
              const ownReplay = e?.attempt_id === b.attempt_id && e.state === "permitted" && e.permit_epoch === controller.epoch;
              // Every permit needs active, current-epoch admission; reconcile_only collects, never authorizes.
              if (admission !== "active" || (!ownReplay && !permittable(e, f))) { reject("effect_replay_refused"); continue; }
            } else {
              if (rec.outcome !== "applied" && rec.outcome !== "failed") { reject("record_invalid"); continue; }
              if (!e || e.attempt_id !== b.attempt_id) { reject("effect_result_unmatched"); continue; }
              outcome = rec.outcome;
            }
          }
          const { mac: _mac, ...copyBody } = rec;
          const copy = Buffer.from(`${JSON.stringify({ schema_version: INGRESS_RECORD_COPY_SCHEMA, record: copyBody })}\n`, "utf8");
          const digest = sha256(copy);
          // Journal first; the durable copy is controller-written and repairable from the same bytes.
          const prev = f.effects.get(`${b.task_id}\0${effect_key}`);
          const ownReplay = kind === "effect_intent" && prev?.attempt_id === b.attempt_id && prev.state === "permitted";
          extend(internal, { type: "ingest", attempt_id: b.attempt_id, record_id, kind, effect_key, outcome, digest, replay_permit: ownReplay, copy: copy.toString("utf8") });
          f = state();
          writeOnce(durableRoot, copyRel(b.attempt_id, record_id), copy);
          report.accepted.push({ attempt_id: b.attempt_id, record_id, kind });
          if (kind === "effect_intent" && effect_key) {
            const p = { run_id, attempt_id: b.attempt_id, grant_id, effect_key, controller_epoch: controller.epoch };
            report.permits.push({ schema_version: EFFECT_PERMIT_SCHEMA, ...p, mac: controller.controllerMac(PERMIT_PURPOSE, permitMessage(p)) });
          }
        }
        cursors.set(b.attempt_id, report.truncated ? last : "");
      }
      return report;
    },

    fenceAttempt(grant, attempt_id) {
      controller.assertWritable(grant);
      const b = state().binds.get(requireId(attempt_id, "attempt_id"));
      if (!b) throw new IngressRefusal("attempt_unknown", `attempt ${attempt_id} is not bound`);
      if (b.fenced) return;
      extend(grant, { type: "fence", attempt_id });
    },

    reconcileEffect(grant, r) {
      controller.assertWritable(grant);
      const task_id = requireId(r?.task_id, "task_id");
      const effect_key = requireId(r.effect_key, "effect_key");
      const evidence_ref = requireId(r.evidence_ref, "evidence_ref");
      if (r.verdict !== "applied" && r.verdict !== "not_applied") throw new IngressRefusal("request_invalid", "verdict must be applied or not_applied");
      const f = state();
      const e = f.effects.get(`${task_id}\0${effect_key}`);
      const owner = e ? f.binds.get(e.attempt_id) : undefined;
      if (!e || !owner || !unsettled(e)) throw new IngressRefusal("reconcile_refused", `effect ${effect_key} is not uncertain`);
      // Fenced and still `started`: the executor can no longer finish it, so a verdict cannot race the effect.
      if (!owner.fenced) throw new IngressRefusal("reconcile_refused", `attempt ${e.attempt_id} is still live; fence it first`);
      extend(grant, { type: "reconcile", attempt_id: e.attempt_id, task_id, effect_key, verdict: r.verdict, evidence_ref });
    },

    releaseAttempt(grant, attempt_id) {
      controller.assertWritable(grant);
      const f = state();
      const b = f.binds.get(requireId(attempt_id, "attempt_id"));
      if (!b) throw new IngressRefusal("attempt_unknown", `attempt ${attempt_id} is not bound`);
      if (b.released) return;
      if (!b.fenced) { throw new IngressRefusal("attempt_not_fenced", `attempt ${attempt_id} must be fenced before release`); }
      const open = [...f.effects.entries()].filter(([k, e]) => e.attempt_id === attempt_id && k.startsWith(`${b.task_id}\0`) && unsettled(e)).map(([k]) => k.split("\0")[1]!).sort();
      if (open.length > 0) {
        throw new IngressRefusal("effects_unreconciled", `attempt ${attempt_id} has uncertain effects: ${open.join(", ")}`, open);
      }
      extend(grant, { type: "release", attempt_id });
    },

    taskState(task_id) {
      const f = state();
      const attempts = [...f.binds.values()].filter((b) => b.task_id === task_id)
        .map((b) => ({ attempt_id: b.attempt_id, fenced: b.fenced, released: b.released }));
      const effects: TaskState["effects"] = [];
      for (const [k, e] of f.effects) {
        const [t, key] = k.split("\0") as [string, string];
        if (t !== task_id) continue;
        const fenced = f.binds.get(e.attempt_id)?.fenced === true;
        const s: EffectState = e.state === "applied" || e.state === "done" ? "applied"
          : e.state === "not_applied" ? "not_applied"
          : e.state === "permitted" ? (fenced ? "unstarted" : "permitted")
          : fenced ? "uncertain" : "in_flight";
        effects.push({ effect_key: key, state: s, attempt_id: e.attempt_id, worker_claim: e.claim });
      }
      effects.sort((x, y) => (x.effect_key < y.effect_key ? -1 : 1));
      return {
        task_id, live_attempt: f.liveByTask.get(task_id) ?? null, attempts, effects,
        uncertain_effects: effects.filter((e) => e.state === "uncertain").map((e) => e.effect_key),
        receipt_loss_reconciled: f.reconciledTasks.has(task_id),
      };
    },

    runEffect(grant, permit, effect) {
      controller.assertWritable(grant);
      const p = permit;
      if (!isObj(p) || Object.keys(p).sort().join(",") !== "attempt_id,controller_epoch,effect_key,grant_id,mac,run_id,schema_version"
        || p.schema_version !== EFFECT_PERMIT_SCHEMA || typeof p.mac !== "string" || !Number.isSafeInteger(p.controller_epoch)) {
        throw new IngressRefusal("permit_invalid", "permit is malformed");
      }
      requireId(p.attempt_id, "attempt_id"); requireId(p.grant_id, "grant_id"); requireId(p.effect_key, "effect_key");
      if (p.run_id !== run_id || !macEqual(p.mac, controller.controllerMac(PERMIT_PURPOSE, permitMessage(p)))) {
        throw new IngressRefusal("permit_invalid", "permit was not issued by this controller");
      }
      if (p.controller_epoch !== controller.epoch) throw new IngressRefusal("permit_invalid", "permit belongs to an older controller epoch");
      const f = state();
      const b = f.binds.get(p.attempt_id);
      if (!b || b.grant_id !== p.grant_id || b.fenced || b.released) throw new IngressRefusal("effect_refused", `attempt ${p.attempt_id} is not live`);
      const claims = controller.attemptClaims(p.grant_id);
      if (!claims || now() > claims.expires_at_ms || controller.attemptAdmission(p.grant_id) !== "active") {
        throw new IngressRefusal("effect_refused", `attempt ${p.attempt_id} has no active, unexpired grant`);
      }
      const e = f.effects.get(`${b.task_id}\0${p.effect_key}`);
      if (!e || e.attempt_id !== p.attempt_id || e.state !== "permitted" || e.permit_epoch !== p.controller_epoch) {
        throw new IngressRefusal("effect_refused", `effect ${p.effect_key} is not awaiting this permit`);
      }
      // Consume before acting: a crash from here on leaves the effect `started`, i.e. uncertain.
      extend(grant, { type: "effect_start", attempt_id: p.attempt_id, task_id: b.task_id, effect_key: p.effect_key });
      const finish = (): void => {
        // Journal done only while this attempt still owns a started effect; otherwise it stays uncertain.
        const g = state();
        const cur = g.effects.get(`${b.task_id}\0${p.effect_key}`);
        const owner = g.binds.get(p.attempt_id);
        if (!cur || cur.attempt_id !== p.attempt_id || cur.state !== "started" || !owner || owner.fenced || owner.released) {
          throw new IngressRefusal("effect_refused", `effect ${p.effect_key} was fenced while running; it stays uncertain`);
        }
        extend(grant, { type: "effect_done", attempt_id: p.attempt_id, task_id: b.task_id, effect_key: p.effect_key });
      };
      const out = effect();
      if (out !== null && (typeof out === "object" || typeof out === "function") && typeof (out as { then?: unknown }).then === "function") {
        return Promise.resolve(out).then((v) => { finish(); return v; }) as unknown as typeof out;
      }
      finish();
      return out;
    },

    repairRecordCopies: repairCopies,

    verifyRecordCopy(attempt_id, record_id) {
      const bound = state().ingested.get(`${requireId(attempt_id, "attempt_id")}/${requireId(record_id, "record_id")}`);
      if (!bound) return { ok: false, code: "record_unbound" };
      const c = checkContained(durableRoot, copyRel(attempt_id, record_id), { policy: "physical", requireRegularFileLeaf: true });
      const r = isRefused(c) ? null : readHostile(c.realPath, limits.max_record_bytes * 2);
      if (!r || r.kind !== "ok") return { ok: false, code: "record_copy_missing" };
      return macEqual(sha256(Buffer.from(r.text, "utf8")), bound.digest) ? { ok: true } : { ok: false, code: "record_copy_mismatch" };
    },

    close() { controller.close(); },
  };
}

// ── worker side (no key, no durable root) ───────────────────────────────────

/** Worker-side: write one MACed record into the bundle's own ingress directory. */
export function submitWorkerRecord(
  bundle: WorkerBundle,
  r: { record_id: string; kind: RecordKind; body: unknown; effect_key?: string; outcome?: "applied" | "failed" },
): void {
  const record_id = requireId(r.record_id, "record_id");
  const signed = {
    schema_version: WORKER_RECORD_SCHEMA,
    source_id: bundle.source_id,
    run_id: bundle.run_id,
    task_id: bundle.task_id,
    attempt_id: bundle.attempt_id,
    grant_id: bundle.grant.grant_id,
    grant_claims_hash: sha256(canonical(bundle.grant.claims)),
    record_id,
    kind: r.kind,
    effect_key: r.effect_key ?? null,
    outcome: r.outcome ?? null,
    body: r.body,
  };
  const bytes = Buffer.from(`${JSON.stringify({ ...signed, mac: hmac(bundle.grant.secret, recordMessage(signed)) })}\n`, "utf8");
  if (bytes.length > bundle.limits.max_record_bytes) throw new IngressRefusal("request_invalid", "record exceeds the size bound");
  const file = path.join(bundle.ingress_dir, `${record_id}.json`);
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
}

/** The only bundle form allowed in shareable files: no secret, no environment values. */
export function shareableBundleRef(b: WorkerBundle): Record<string, unknown> {
  return {
    schema_version: b.schema_version, run_id: b.run_id, task_id: b.task_id, attempt_id: b.attempt_id,
    execution_id: b.execution_id, grant_id: b.grant.grant_id, capability_hash: b.capability_hash,
    env_names: Object.keys(b.env).sort(),
  };
}

// ── leak check ───────────────────────────────────────────────────────────────

const MAX_LEAK_FILES = 20_000;
const MAX_LEAK_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Scan a run's shareable tree for private grant material (writer nonces,
 * attempt secrets). Fails closed when the scan cannot complete.
 */
export function checkShareableLeaks(opts: { durableRoot: string; run_id: string; grants: Array<WriterGrant | AttemptGrant>; secrets?: string[] }):
  { ok: boolean; findings: Array<{ file: string; secret_index: number }>; complete: boolean } {
  const secrets = [
    ...opts.grants.map((g) => (g.kind === "attempt" ? g.secret : g.nonce)),
    ...(opts.secrets ?? []),
  ];
  if (secrets.length === 0 || secrets.some((s) => typeof s !== "string" || s.length < 16)) {
    throw new IngressRefusal("request_invalid", "leak check needs secrets of at least 16 characters");
  }
  const rel = path.join(".guild", "runs", requireId(opts.run_id, "run_id"));
  const root = checkContained(path.resolve(opts.durableRoot), rel, { policy: "physical" });
  if (isRefused(root)) return { ok: false, findings: [], complete: false };
  const findings: Array<{ file: string; secret_index: number }> = [];
  let complete = true;
  let files = 0;
  const visit = (dir: string): void => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { complete = false; return; }
    for (const d of ents) {
      const p = path.join(dir, d.name);
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) { visit(p); continue; }
      if (!d.isFile()) continue;
      if (++files > MAX_LEAK_FILES) { complete = false; return; }
      const r = readHostile(p, MAX_LEAK_FILE_BYTES);
      if (r.kind !== "ok") { complete = false; continue; }
      secrets.forEach((s, i) => { if (r.text.includes(s)) findings.push({ file: p, secret_index: i }); });
    }
  };
  if (fs.existsSync(root.realPath)) visit(root.realPath);
  findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.secret_index - b.secret_index));
  return { ok: complete && findings.length === 0, findings, complete };
}

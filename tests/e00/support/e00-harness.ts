/**
 * tests/e00/support/e00-harness.ts — shared TA fixture for the E00 regression
 * harness (E00-T0). Operative spec: e00-controller-contract.json r12
 * (sha256 8eea7db0…). Every root is an OS-temp root with its own binding minted
 * through the canonical mintRunBinding; nothing here borrows a live run's nonce,
 * writes production acceptance/state, or fakes a native callback.
 *
 * Declared-but-absent E00 API is loaded through requireExport(), which FAILS the
 * calling test with an ABSENT_CAPABILITY error. A missing module is never
 * caught and never counted as an expected refusal: refusal assertions go
 * through expectRefusal(), which requires the exact declared reason code.
 */
import { spawnSync, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  FilesystemTaskCellRuntime,
  acknowledgeAssignment,
  assignmentId,
  buildTaskAssignmentV2,
  initProgressLedger,
  publishSubmittedHandoffPointer,
  recordOracleOutcome,
  resolveRungPlan,
  ADAPTER_RUNG_NAMES,
  type AdapterRungCell,
  type AdapterRungName,
  type TaskCellWorkerPort,
} from "../../../src/domains/dispatch";
import { mintRunBinding } from "../../../src/domains/lifecycle";

export const PLUGIN = path.resolve(__dirname, "..", "..", "..");
export const CONTRACT_REF = "e00-controller-contract.json r12 sha256:8eea7db0bcac017072ed536cfbe4665ae4eacdaa0a44c1f76af7de6080674e1b";

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ── Owned temp roots, children and tmux servers (F8/F9) ──────────────────────
// Every root, direct child and isolated tmux server a test creates is registered
// here; each test file calls afterEach(teardownOwned), which runs on pass, fail
// and timeout. Closure is established ONLY from the process table, never from a
// tmux query's exit status:
//   - a direct child is signalled only while pid AND `ps` start time still match
//     the identity recorded at spawn, and it belongs to one root;
//   - an isolated tmux server (tc/tmux-shim) is owned ONLY through the ledger the shim
//     writes: every potentially server-starting call is recorded as a start BEFORE
//     tmux runs, and a server is owned only when that same call captured it and its
//     start time is not earlier than the start record. Panes are owned only when
//     captured under an owned server. Socket paths and argv never confer ownership,
//     and a later successful query never refreshes it.
//   - ledger integrity is checked against the shim's calls.log: every start-capable
//     call must have its start record. An unreadable or short ledger is "integrity
//     unconfirmed" and keeps the root, as does a start with no verified identity.
//   - teardown never sends a kill through the socket (a holder check and a later
//     socket command cannot be made atomic); it signals ONLY captured owned identities
//     matched by pid+start in a fresh, successful process-table read. An unreadable
//     table never authorizes a signal.
// A root is removed only when every owned child and every owned server/pane process
// is confirmed gone and no unowned or unknown server holds its socket. Otherwise the
// root is kept and teardown throws. Fault tests may leave read-only modes behind,
// so teardown restores owner write before removal.

interface OwnedChild { child: ChildProcess; pid: number; start: string; root: string }
interface OwnedTmux { root: string; realTmux: string; socket: string; ledger: string }
export interface ProcRow { pid: number; ppid: number; start: string; command: string }
export interface TeardownSeams {
  /** Process table snapshot; null means it could not be read (closure unknown). */
  listProcesses?: () => ProcRow[] | null;
  /** Signal delivery; tests inject a no-op to exercise the unconfirmed path. */
  signal?: (pid: number, sig: NodeJS.Signals) => void;
  waitMs?: number;
}

const ownedRoots = new Set<string>();
const ownedChildren: OwnedChild[] = [];
const ownedTmux: OwnedTmux[] = [];

export function ownRoot(dir: string): string {
  ownedRoots.add(dir);
  return dir;
}

/** Start time of a live pid, or null when no such process exists. */
export function processStart(pid: number): string | null {
  const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  const out = (r.stdout ?? "").trim();
  return r.status === 0 && out.length > 0 ? out : null;
}

/** Full process table via `ps`, or null if it cannot be read. */
export function listProcesses(): ProcRow[] | null {
  const r = spawnSync("ps", ["-axo", "pid=,ppid=,lstart=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } });
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  const rows: ProcRow[] = [];
  for (const line of r.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), start: m[3].replace(/\s+/g, " "), command: m[4] });
  }
  return rows.length > 0 ? rows : null;
}

/** Register a directly spawned child with its verified identity and owning root. */
export function ownChild<T extends ChildProcess>(child: T, root: string): T {
  if (typeof child.pid !== "number") throw new Error("ownChild: child has no pid (spawn failed)");
  const start = processStart(child.pid);
  if (start === null) throw new Error("ownChild: child exited before its identity could be recorded");
  ownedChildren.push({ child, pid: child.pid, start: start.replace(/\s+/g, " "), root });
  return child;
}

/** Register an isolated tmux server created through tc/tmux-shim for this root. */
export function ownTmuxServer(root: string, realTmux: string, socket: string, ledger: string): void {
  ownedTmux.push({ root, realTmux, socket, ledger });
}

export interface TmuxLedger {
  /** Servers a recorded start call captured, started no earlier than that record. */
  servers: Array<{ pid: number; start: string }>;
  /** Panes captured under an owned server. */
  panes: Array<{ pid: number; start: string }>;
  /** Start records with no verified server identity (exit unknown). */
  uncovered: string[];
  /** "ok", or why the ledger cannot be trusted to list every start (root kept). */
  integrity: "ok" | "unreadable" | "missing_start_records";
}

/** Mirrors the shim's start-capable `case` (a bare `tmux` starts a session; -V never does). */
export function startCapable(sub: string): boolean {
  if (sub === "-V") return false;
  return sub === "" || sub === "new" || sub === "start" || sub.startsWith("new-s") || sub.startsWith("start-s") || sub.startsWith("-");
}

function readIfPresent(file: string): string | null | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? undefined : null;
  }
}

const startEpoch = (lstart: string) => Math.floor(Date.parse(lstart) / 1000);

/**
 * Ownership from the shim ledger. Lines: `start <seq> <epoch>` (written before tmux
 * runs), `server <seq> <pid> <lstart>` (a server first seen by that call),
 * `reuse <seq> <pid> <lstart>` (the call reached an already-running server) and
 * `pane <server-pid> <server-lstart> <pid> <lstart>`.
 */
export function readTmuxLedger(ledger: string): TmuxLedger {
  const starts = new Map<string, number>();
  const serverLines: Array<{ seq: string; pid: number; start: string }> = [];
  const reuseLines: Array<{ seq: string; key: string }> = [];
  const paneLines: Array<{ server: string; pid: number; start: string }> = [];
  const norm = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
  const raw = readIfPresent(ledger);
  const calls = readIfPresent(path.join(path.dirname(ledger), "calls.log"));
  const text = raw ?? "";
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f[0] === "start" && f[1] && /^\d+$/.test(f[2] ?? "")) starts.set(f[1], Number(f[2]));
    else if ((f[0] === "server" || f[0] === "reuse") && f[1] && Number(f[2]) > 0 && norm(f[3])) {
      if (f[0] === "server") serverLines.push({ seq: f[1], pid: Number(f[2]), start: norm(f[3]) });
      else reuseLines.push({ seq: f[1], key: `${Number(f[2])}|${norm(f[3])}` });
    } else if (f[0] === "pane" && Number(f[1]) > 0 && norm(f[2]) && Number(f[3]) > 0 && norm(f[4])) {
      paneLines.push({ server: `${Number(f[1])}|${norm(f[2])}`, pid: Number(f[3]), start: norm(f[4]) });
    }
  }
  const owned = new Map<string, { pid: number; start: string }>();
  const covered = new Set<string>();
  for (const s of serverLines) {
    const at = starts.get(s.seq);
    const began = startEpoch(s.start);
    if (at === undefined || !Number.isFinite(began) || began < at) continue;
    owned.set(`${s.pid}|${s.start}`, { pid: s.pid, start: s.start });
    covered.add(s.seq);
  }
  for (const r of reuseLines) if (owned.has(r.key)) covered.add(r.seq);
  const panes = new Map<string, { pid: number; start: string }>();
  for (const p of paneLines) if (owned.has(p.server)) panes.set(`${p.pid}|${p.start}`, { pid: p.pid, start: p.start });
  let integrity: TmuxLedger["integrity"] = "ok";
  if (raw === null || calls === null) integrity = "unreadable";
  else {
    const lines = (calls ?? "").split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    if (lines.filter(startCapable).length > starts.size) integrity = "missing_start_records";
  }
  return { servers: [...owned.values()], panes: [...panes.values()], uncovered: [...starts.keys()].filter((s) => !covered.has(s)), integrity };
}

/** True when argv carries `-S` immediately followed by exactly `socket` as its own token. */
export function argvNamesSocket(command: string, socket: string): boolean {
  const tokens = command.split(/\s+/);
  for (let i = 0; i + 1 < tokens.length; i++) if (tokens[i] === "-S" && tokens[i + 1] === socket) return true;
  return false;
}

async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return cond();
}

type Ident = { pid: number; start: string };

/** "gone" | "alive" | "unknown" for a set of identities, from one process-table read. */
function identitiesState(ids: Ident[], list: () => ProcRow[] | null): "gone" | "alive" | "unknown" {
  const rows = list();
  if (rows === null) return "unknown";
  const live = new Set(rows.map((r) => `${r.pid}|${r.start}`));
  return ids.some((i) => live.has(`${i.pid}|${i.start}`)) ? "alive" : "gone";
}

const key = (i: Ident) => `${i.pid}|${i.start}`;

type SocketHolder = { state: "none" } | { state: "unknown" } | { state: "server"; ident: Ident };

/** Which server (if any) currently answers on the socket, identified by pid+start. */
function socketHolder(s: OwnedTmux, seams: Required<TeardownSeams>): SocketHolder {
  try {
    if (!fs.lstatSync(s.socket).isSocket()) return { state: "unknown" };
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? { state: "none" } : { state: "unknown" };
  }
  const env: Record<string, string | undefined> = { ...process.env, LC_ALL: "C" };
  delete env["TMUX"];
  delete env["TMUX_PANE"];
  const r = spawnSync(s.realTmux, ["-S", s.socket, "list-sessions", "-F", "#{pid}"], { encoding: "utf8", timeout: 10000, env });
  if (r.status === 0) {
    const pid = Number((r.stdout ?? "").trim().split("\n")[0]);
    const row = (seams.listProcesses() ?? []).find((x) => x.pid === pid);
    return row ? { state: "server", ident: { pid, start: row.start } } : { state: "unknown" };
  }
  return /no server running|connection refused/i.test(r.stderr ?? "") ? { state: "none" } : { state: "unknown" };
}

async function closeTmux(s: OwnedTmux, seams: Required<TeardownSeams>): Promise<string | null> {
  const ledger = readTmuxLedger(s.ledger);
  const errors: string[] = [];
  if (ledger.integrity !== "ok") errors.push(`ledger integrity unconfirmed (${ledger.integrity})`);
  if (ledger.uncovered.length > 0) errors.push(`${ledger.uncovered.length} server start(s) without a verified identity (exit unknown)`);
  const ids = new Map<string, Ident>();
  for (const i of [...ledger.servers, ...ledger.panes]) ids.set(key(i), i);
  const owned = [...ids.values()];
  if (owned.length > 0) {
    // Fresh read immediately before acting; only an exact pid+start match is signalled.
    const now = seams.listProcesses();
    if (now === null) return `tmux server ${s.socket}: ${["process table unreadable, closure unknown", ...errors].join("; ")}`;
    const live = new Set(now.map((r) => `${r.pid}|${r.start}`));
    const remaining = owned.filter((i) => live.has(key(i)));
    for (const i of remaining) seams.signal(i.pid, "SIGKILL");
    if (remaining.length > 0) await until(() => identitiesState(owned, seams.listProcesses) === "gone", seams.waitMs);
    const state = identitiesState(owned, seams.listProcesses);
    if (state !== "gone") errors.push(`owned identities not confirmed closed (${state}; servers=${ledger.servers.length} panes=${ledger.panes.length})`);
  }
  const ownedServers = new Set(ledger.servers.map(key));
  const after = socketHolder(s, seams);
  if (after.state === "unknown") errors.push("socket holder unknown");
  if (after.state === "server" && !ownedServers.has(key(after.ident))) errors.push("socket held by a server whose ownership is not verified (no signal sent)");
  return errors.length > 0 ? `tmux server ${s.socket}: ${errors.join("; ")}` : null;
}

function restoreWritable(dir: string): void {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    try {
      fs.chmodSync(d, 0o700);
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) fs.chmodSync(p, 0o600);
      }
    } catch {
      /* best effort; rmSync reports what remains */
    }
  }
}

const realSeams: Required<TeardownSeams> = {
  listProcesses,
  signal: (pid, sig) => {
    try {
      process.kill(pid, sig);
    } catch {
      /* exited between check and signal */
    }
  },
  waitMs: 5000,
};

/**
 * Terminate verified owned children, close and confirm owned tmux servers, then
 * remove owned roots. Any root with an unconfirmed child or server/pane process
 * is kept and teardown throws.
 */
export async function teardownOwned(seamsIn: TeardownSeams = {}): Promise<void> {
  const seams: Required<TeardownSeams> = { ...realSeams, ...seamsIn };
  const errors: string[] = [];
  const keep = new Set<string>();
  for (const c of ownedChildren.splice(0)) {
    const ident = [{ pid: c.pid, start: c.start }];
    const first = identitiesState(ident, seams.listProcesses);
    if (first === "gone") continue;
    // Only a pid+start matched in a successful read authorizes a signal; "unknown" never does.
    if (first === "alive") {
      seams.signal(c.pid, "SIGKILL");
      await until(() => identitiesState(ident, seams.listProcesses) === "gone", seams.waitMs);
    }
    const state = identitiesState(ident, seams.listProcesses);
    if (state !== "gone") {
      errors.push(`owned child ${c.pid} not confirmed stopped (${state})`);
      keep.add(c.root);
    }
  }
  for (const s of ownedTmux.splice(0)) {
    const err = await closeTmux(s, seams);
    if (err) {
      errors.push(err);
      keep.add(s.root);
    }
  }
  for (const root of ownedRoots) {
    if (keep.has(root)) continue;
    restoreWritable(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
  ownedRoots.clear();
  if (errors.length > 0) throw new Error(`teardown incomplete; kept ${keep.size} root(s): ${errors.join("; ")}`);
}

/** An owned OS-temp directory with no binding (sibling cwd, copies). */
export function ownedTempDir(prefix: string): string {
  return ownRoot(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))));
}

// ── Typed binding refusal (F6) ───────────────────────────────────────────────

export const BINDING_REJECT_REASONS = new Set([
  "binding_absent", "binding_unverifiable", "binding_not_minted", "binding_malformed", "binding_closed", "binding_mismatch",
]);

/** True only for BindingRejectedError (or an equivalent typed error) carrying a declared reason. */
export function isTypedBindingRejection(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const e = error as Record<string, unknown>;
  return (e["diagnostic"] === "binding_rejected" || e["name"] === "BindingRejectedError") &&
    typeof e["reason"] === "string" && BINDING_REJECT_REASONS.has(e["reason"] as string);
}

/** True only for a returned { ok:false, reason } whose reason is a declared binding reason. */
export function isTypedBindingResult(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v["ok"] === false && typeof v["reason"] === "string" && BINDING_REJECT_REASONS.has(v["reason"] as string);
}

// ── Absent-capability classification ─────────────────────────────────────────

export class AbsentCapability extends Error {
  readonly classification = "absent_capability" as const;
  constructor(readonly modulePath: string, readonly symbol: string, detail = "") {
    super(`ABSENT_CAPABILITY ${modulePath}#${symbol} (declared by ${CONTRACT_REF})${detail ? `: ${detail}` : ""}`);
  }
}

/** Load a declared export or fail the test with an explicit absent-capability error. */
export async function requireExport<T = any>(relModule: string, symbol: string): Promise<T> {
  const abs = path.join(PLUGIN, relModule);
  const candidates = [abs, `${abs}.ts`, path.join(abs, "index.ts")];
  const found = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!found) throw new AbsentCapability(relModule, symbol, "module file not present");
  const mod = (await import(found)) as Record<string, unknown>;
  if (mod[symbol] === undefined) throw new AbsentCapability(relModule, symbol, "export not present");
  return mod[symbol] as T;
}

/** Require a method declared on an existing class prototype (e.g. runtime reconcilers). */
export function requireMethod(proto: object, owner: string, method: string): void {
  if (typeof (proto as Record<string, unknown>)[method] !== "function") {
    throw new AbsentCapability(owner, method, "method not present");
  }
}

/** Require a file the design declares (CLI, schema copy). */
export function requireFile(rel: string): string {
  const abs = path.join(PLUGIN, rel);
  if (!fs.existsSync(abs)) throw new AbsentCapability(rel, "<file>", "file not present");
  return abs;
}

function reasonOf(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  for (const k of ["reason", "code", "outcome", "refused"]) {
    if (typeof v[k] === "string") return v[k] as string;
  }
  return null;
}

/**
 * Proposed test contract (handoff §followups): a refusal is EITHER a returned
 * object `{ ok: false, reason }` OR a thrown error carrying `.reason` / `.code`
 * equal to the declared code. A TypeError or a message-only throw never counts.
 */
export async function expectRefusal(run: () => unknown, reason: string): Promise<void> {
  let outcome: { kind: "returned"; value: unknown } | { kind: "threw"; error: unknown };
  try {
    outcome = { kind: "returned", value: await run() };
  } catch (error) {
    if (error instanceof AbsentCapability) throw error;
    outcome = { kind: "threw", error };
  }
  if (outcome.kind === "returned") {
    const v = outcome.value as Record<string, unknown> | null;
    if (v === null || typeof v !== "object" || v["ok"] !== false || reasonOf(v) !== reason) {
      throw new Error(`expected refusal ${reason}, got ${JSON.stringify(outcome.value)?.slice(0, 400)}`);
    }
    return;
  }
  const err = outcome.error as Record<string, unknown> | null;
  const code = err && typeof err === "object" ? (err["reason"] ?? err["code"]) : null;
  if (code !== reason) {
    throw new Error(`expected refusal ${reason}, got thrown ${String((outcome.error as Error)?.message ?? outcome.error).slice(0, 400)}`);
  }
}

// ── Temp roots and bindings ──────────────────────────────────────────────────

export interface TempRoot {
  cwd: string;
  runId: string;
  bindingRef: string;
  /** Digest of the nonce; tests compare digests, never print nonce bytes. */
  bindingDigest: string;
}

export function tempRoot(prefix = "guild-e00-", runId = "run-e00-ta"): TempRoot {
  const cwd = ownRoot(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))));
  const record = mintRunBinding({ root: cwd, run_id: runId });
  return { cwd, runId, bindingRef: record.binding_ref, bindingDigest: sha256(record.binding_ref) };
}

export function bindingPathOf(root: TempRoot): string {
  return path.join(root.cwd, ".guild", "runs", root.runId, "binding.json");
}

/** Walk every regular file under dir (no symlink follow). */
export function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  return out.sort();
}

/**
 * Files (other than binding.json itself) whose bytes contain the nonce.
 * Returns relative paths only; nonce bytes never leave this function.
 */
export function filesContainingNonce(root: TempRoot, extraRoots: string[] = []): string[] {
  const nonce = Buffer.from(root.bindingRef, "utf8");
  const binding = bindingPathOf(root);
  const hits: string[] = [];
  for (const base of [root.cwd, ...extraRoots]) {
    for (const f of walkFiles(base)) {
      if (f === binding) continue;
      if (fs.readFileSync(f).includes(nonce)) hits.push(path.relative(root.cwd, f));
    }
  }
  return hits;
}

// ── Runtime fixture over existing injected seams (CD16) ──────────────────────

export const FIXED_NOW = "2026-10-26T13:00:00.000Z";

export const FULL_RUNGS = resolveRungPlan(
  {
    family: "test-native",
    rungs: Object.fromEntries(
      ADAPTER_RUNG_NAMES.map((n) => [n, { rung: "native", evidence: "verified", verified_by: "e00 TA fixture" }]),
    ) as Record<AdapterRungName, AdapterRungCell>,
  },
  { verify_check_available: false },
);

export class FakeWorkerPort implements TaskCellWorkerPort {
  readonly mode = "native" as const;
  readonly losses: string[] = [];
  spawned: string[] = [];
  terminated: string[] = [];
  onNotify: ((input: { instance_id: string; run_id: string; assignment_path: string }) => void) | null = null;
  isAvailable(): boolean { return true; }
  spawn(input: { instance_id: string }): { ok: boolean; reason: string | null } {
    this.spawned.push(input.instance_id);
    return { ok: true, reason: null };
  }
  ready(): { ok: boolean; reason: string | null } { return { ok: true, reason: null }; }
  notifyAssignment(input: { instance_id: string; run_id: string; assignment_path: string }): { ok: boolean; reason: string | null } {
    this.onNotify?.(input);
    return { ok: true, reason: null };
  }
  terminate(input: { instance_id: string }): { ok: boolean; reason: string | null } {
    this.terminated.push(input.instance_id);
    return { ok: true, reason: null };
  }
}

export function makeRuntime(root: TempRoot, worker = new FakeWorkerPort(), now: () => string = () => FIXED_NOW) {
  let seq = 0;
  const runtime = new FilesystemTaskCellRuntime({
    rungPlan: FULL_RUNGS,
    cwd: root.cwd,
    substrate: "tmux",
    parallelism: 4,
    binding: { binding_ref: root.bindingRef },
    worker,
    now,
    idFactory: (kind) => `${kind}-${++seq}`,
  });
  return { runtime, worker };
}

export interface LaneSpec {
  logicalTaskId: string;
  role: string;
  station?: string;
  dependencies?: Array<{ logical_task_id: string; accepted_artifact_ref: string | null }>;
  doneWhen?: Array<{ id: string; oracle: string; target?: string | null }>;
  /** Stop after deliverAssignment with no worker ack (ack-path tests). */
  stopAfterDeliver?: boolean;
}

export function receiptBytes(runId: string, a: { logical_task_id: string; task_run_id: string; worker_role: string; host_id: string; objective: string; scope_paths: string[]; acceptance_tests: string[] }): string {
  return [
    "---", "schema_version: guild.handoff_receipt.v1", "ids:", "  initiative_id: null",
    `  run_id: ${runId}`, `  task_id: ${a.logical_task_id}`, `  task_run_id: ${a.task_run_id}`,
    `specialist: ${a.worker_role}`, "host:", `  selected: ${a.host_id}`, "  degraded: false",
    "  native_ref: null", "  independence: weak", "scope:", `  objective: ${JSON.stringify(a.objective)}`,
    `  in_scope: ${JSON.stringify(a.scope_paths)}`, "  out_of_scope_touched: []", "status: completed",
    "changed_files:", "  - path: src/api/routes.ts", "    change: modified", `    sha256_after: ${"a".repeat(64)}`,
    "evidence:", "  - kind: command", `    ref: ${JSON.stringify(a.acceptance_tests[0])}`, "    result: pass",
    "assumptions: []", "open_risks: []", "followups: []", `produced_at: ${FIXED_NOW}`,
    "---", "", "## changed_files", "- src/api/routes.ts", "", "## opens_for", "- lead", "",
    "## assumptions", "- none", "", "## evidence", "- runtime collection", "",
    "## followups", "- none", "", "```guild.handoff.v2",
    JSON.stringify({ schema_version: "guild.handoff.v2", task_id: a.logical_task_id, tier: "mid", status: "done", summary: "fixture lane", artifacts: ["src/api/routes.ts"], issues: [] }),
    "```", "",
  ].join("\n");
}

/**
 * Drive one lane through the EXISTING runtime (mechanics only, CD16): spawn,
 * ready, deliver, ack, submit, collect, ledger, accept, terminate. The binding
 * is passed explicitly everywhere the E00 binding_matrix requires it; current
 * code ignores the extra argument, so this stays a valid positive path.
 */
export async function driveLane(root: TempRoot, rt: ReturnType<typeof makeRuntime>, lane: LaneSpec) {
  const { runtime, worker } = rt;
  const binding = { binding_ref: root.bindingRef };
  const station = lane.station ?? "build";
  const contextRel = `.guild/context/${root.runId}/${lane.role}-${lane.logicalTaskId}.md`;
  const context = `# context ${lane.logicalTaskId}\n`;
  fs.mkdirSync(path.dirname(path.join(root.cwd, contextRel)), { recursive: true });
  fs.writeFileSync(path.join(root.cwd, contextRel), context);
  const cell = await runtime.spawnCell({
    run_id: root.runId, cell_id: `cell-${lane.logicalTaskId}`, goal_id: "goal-e00", phase_id: station,
    step_id: lane.logicalTaskId, team_id: "team-e00", logical_task_id: lane.logicalTaskId,
    fanout: "lead_plus_one", lead: { lead_binding_id: "lead-binding-e00" },
  });
  const instance = await runtime.spawnInstance(cell, {
    task_run_id: `${lane.logicalTaskId}.tr1`, attempt: 1, worker_role: lane.role,
    specialist_type_id: lane.role, specialist_type_version: "1", specialist_type_hash: "sha256:type",
    specialist_profile_id: lane.role, specialist_profile_hash: "sha256:profile",
    host_id: "claude-code-cli", adapter_id: "claude-code-cli@1", host_capabilities_hash: "sha256:caps",
    model_tier: "mid", model_id: "fixture-model", context_bundle_id: contextRel,
    context_bundle_hash: runtime.contentHash(context),
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
  });
  const ready = await runtime.awaitReady(instance);
  if (!ready.ok) throw new Error(`fixture: not ready ${JSON.stringify(ready)}`);
  const doneWhen = lane.doneWhen ?? [{ id: "api", oracle: "named_check", target: "npm test -- api" }];
  const assignment = buildTaskAssignmentV2({
    run_id: root.runId, cell_id: cell.cell_id, goal_id: cell.goal_id, phase_id: cell.phase_id,
    step_id: cell.step_id, team_id: cell.team_id, logical_task_id: cell.logical_task_id,
    task_run_id: instance.task_run_id, attempt: instance.attempt, attempt_id: instance.attempt_id,
    previous_attempt_id: null, retry_reason: null, instance_id: instance.instance_id,
    lead_binding_id: "lead-binding-e00", team_lead_instance_id: null, worker_role: instance.worker_role,
    specialist_type_id: lane.role, specialist_type_version: "1", specialist_type_hash: "sha256:type",
    specialist_profile_id: lane.role, specialist_profile_hash: "sha256:profile",
    context_bundle_id: contextRel, context_bundle_hash: runtime.contentHash(context),
    host_id: "claude-code-cli", adapter_id: "claude-code-cli@1", host_capabilities_hash: "sha256:caps",
    objective: `implement ${lane.logicalTaskId}`, non_goals: [], scope_paths: ["src/api"],
    output_schema: "guild.handoff_receipt.v1", acceptance_tests: ["npm test -- api"],
    dependencies: lane.dependencies ?? [],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    autonomy_policy: "supervised", budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    deadline: null, written_at: FIXED_NOW,
  });
  (assignment as typeof assignment & { done_when?: unknown }).done_when = doneWhen;
  worker.onNotify = lane.stopAfterDeliver ? null : ({ assignment_path }) => {
    const persisted = JSON.parse(fs.readFileSync(path.join(root.cwd, assignment_path), "utf8"));
    (acknowledgeAssignment as (...a: unknown[]) => unknown)(root.cwd, persisted, () => FIXED_NOW, binding);
  };
  const delivered = await runtime.deliverAssignment((ready as { ok: true; instance: typeof instance }).instance, assignment);
  if (!delivered.ok) throw new Error(`fixture: deliver ${JSON.stringify(delivered)}`);
  if (lane.stopAfterDeliver) return { cell, instance, assignment, receiptRel: "", station };
  const running = await runtime.awaitAssignmentAck(instance);
  if (!running.ok) throw new Error(`fixture: ack ${JSON.stringify(running)}`);
  const receiptRel = `.guild/runs/${root.runId}/handoffs/${lane.role}-${lane.logicalTaskId}.md`;
  fs.mkdirSync(path.dirname(path.join(root.cwd, receiptRel)), { recursive: true });
  fs.writeFileSync(path.join(root.cwd, receiptRel), receiptBytes(root.runId, assignment));
  const pointer = (publishSubmittedHandoffPointer as (i: unknown) => unknown)({ cwd: root.cwd, assignment, submittedAt: FIXED_NOW, binding });
  if (pointer === null) throw new Error("fixture: pointer refused");
  const collected = await runtime.collectHandoff(instance);
  if (!collected.ok) throw new Error(`fixture: collect ${JSON.stringify(collected)}`);
  const ledgerIds = { cwd: root.cwd, run_id: root.runId, logical_task_id: lane.logicalTaskId };
  const init = (initProgressLedger as (i: unknown) => { ok: boolean })({
    ...ledgerIds, cell_id: cell.cell_id, assignment_id: assignmentId(assignment), done_when: doneWhen, now: () => FIXED_NOW, binding,
  });
  if (!init.ok) throw new Error("fixture: ledger init refused");
  for (const item of doneWhen) {
    (recordOracleOutcome as (i: unknown) => unknown)({ ...ledgerIds, item_id: item.id, state: "pass", now: () => FIXED_NOW, binding });
  }
  return { cell, instance, assignment, receiptRel, station };
}

export async function acceptLane(rt: ReturnType<typeof makeRuntime>, instance: Parameters<FilesystemTaskCellRuntime["acceptHandoff"]>[0]) {
  return rt.runtime.acceptHandoff(instance, {
    acceptance_policy_version: "1",
    authorities_required: ["deterministic_floor", "team_lead"],
    authorities_observed: [
      { authority: "deterministic_floor", decision: "accepted", at: FIXED_NOW, reason: null },
      { authority: "team_lead", decision: "accepted", at: FIXED_NOW, reason: null },
    ],
  });
}

/** CD9 canonical encoding: sorted keys, no insignificant whitespace, UTF-8. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

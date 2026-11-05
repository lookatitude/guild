/**
 * workflow-invocation-state.ts — W04: durable, bounded workflow loop state.
 *
 * A compiled workflow (W01) declares its loops in the compile manifest: each
 * `repeat` has an entry node, an exit node, a `max_rounds` and an `until`
 * condition. This module persists the RUNTIME side of those loops on the run
 * record: the invocation stack, every round with its outcome, unresolved
 * questions and evidence, and the hashes the invocation started under. It
 * produces the C8 WorkflowProjection v2 `invocations` overlay.
 *
 * Rules:
 *   - A round is recorded as `started` BEFORE its work is dispatched
 *     (write-ahead). A crash therefore leaves the round in flight; restart
 *     re-attaches to it and a second `beginRound` is refused, so no round runs
 *     twice and no restart hands back budget.
 *   - The budget is the manifest's `max_rounds`, pinned at init. A completed
 *     round that does not satisfy `until` with no unresolved questions, at the
 *     bound, blocks the invocation and records an escalation. Exhaustion never
 *     accepts.
 *   - The state is bound to the compile basis (definition, compiler, policy and
 *     expanded hashes plus the loop table). Any difference refuses with
 *     `replan-required` and leaves the files untouched; only
 *     `replanInvocationState` rebinds, and only to a DIFFERENT basis.
 *   - State is re-validated on every load: shape, self-hash, a head file that
 *     anchors the latest sequence number, and every invocation's status is
 *     re-derived from its rounds. A torn write (snapshot renamed, head not)
 *     rolls forward exactly once; anything else inconsistent is refused.
 *
 * Trust: cooperative local. A writer that rewrites BOTH files consistently
 * with a forged history is out of model; restoring an older snapshot, deleting
 * the snapshot, or editing derived status is detected.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { checkContained, isRefused, prepareContainedWrite, writeContainedFile } from "../kernel";
import type { CompileManifest, ComponentCondition, WorkflowProjectionV2 } from "./workflow-component-compiler";

export const WORKFLOW_INVOCATION_STATE_SCHEMA = "guild.workflow_invocation_state.v1" as const;
export const WORKFLOW_INVOCATION_HEAD_SCHEMA = "guild.workflow_invocation_head.v1" as const;
export const INVOCATION_STATE_FILE = "workflow-invocations.json" as const;
export const INVOCATION_HEAD_FILE = "workflow-invocations.head.json" as const;
export const INVOCATION_LOCK_FILE = "workflow-invocations.lock" as const;

const LIMITS = Object.freeze({ fileBytes: 4 << 20, headBytes: 4096, lockBytes: 256, invocations: 1000, questions: 64, evidence: 64, artifacts: 64, reason: 500, depth: 16 });
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;

// ---------------------------------------------------------------- types

export interface InvocationBasis {
  projection: WorkflowProjectionV2;
  manifest: CompileManifest;
}

export interface BasisLoop { id: string; entry: string; exit: string; max_rounds: number; until: ComponentCondition; body: string[] }

export interface StateBasis {
  workflow: { source_id: string; id: string };
  class: string;
  definition_hash: string;
  compiler_hash: string;
  policy_hash: string;
  expanded_hash: string;
  loops: BasisLoop[];
}

export interface EvidenceRef { name: string; sha256: string }

export interface RoundRecord {
  round: number;
  status: "started" | "completed";
  outcome: string | null;
  unresolved_questions: string[];
  evidence: EvidenceRef[];
  obligations_accepted: boolean;
  artifacts: string[];
}

export type InvocationStatus = "active" | "blocked" | "accepted" | "cancelled";
export interface Escalation { kind: "budget-exhausted"; round: number; unresolved_questions: string[] }

export interface InvocationRecord {
  id: string;
  loop_id: string;
  node_id: string;
  parent: { invocation_id: string; round: number } | null;
  max_rounds: number;
  definition_hash: string;
  subject_hash: string;
  state: InvocationStatus;
  escalation: Escalation | null;
  cancel_reason: string | null;
  rounds: RoundRecord[];
}

export interface ReplanRecord {
  definition_hash: string;
  basis_hash: string;
  state_hash: string;
  reason: string;
  open_questions: string[];
  cancelled_invocations: string[];
}

export interface InvocationStateV1 {
  schema_version: typeof WORKFLOW_INVOCATION_STATE_SCHEMA;
  run_id: string;
  seq: number;
  prev_state_hash: string | null;
  basis: StateBasis;
  basis_hash: string;
  stack: string[];
  invocations: InvocationRecord[];
  previous: ReplanRecord | null;
  state_hash: string;
}

interface HeadV1 { schema_version: typeof WORKFLOW_INVOCATION_HEAD_SCHEMA; run_id: string; seq: number; state_hash: string; prev_state_hash: string | null }

export type StoreRule =
  | "invalid-input"
  | "path-not-contained"
  | "write-failed"
  | "state-locked"
  | "capacity-exceeded"
  | "no-state"
  | "state-exists"
  | "state-missing"
  | "state-stale"
  | "state-corrupt"
  | "replan-required"
  | "replan-unchanged"
  | "unknown-loop"
  | "unknown-invocation"
  | "invocation-conflict"
  | "invocation-closed"
  | "parent-required"
  | "not-top-of-stack"
  | "round-in-flight"
  | "no-round-in-flight"
  | "round-mismatch"
  | "round-already-completed"
  | "budget-exhausted";

export type StoreResult<T> = { ok: true; value: T } | { ok: false; rule: StoreRule; detail: string };

export interface StoreContext {
  /** Project root; the run dir and both state files must resolve inside it. */
  root: string;
  /** Absolute run record dir, e.g. `GuildStorage.project.runRecord(runId)`. */
  runDir: string;
  run_id: string;
}

/** Crash injection for tests; the production path passes nothing. */
export interface StoreOptions {
  /** Crash injection for tests: after the head names the pending snapshot, and after both writes landed. */
  faults?: { afterHead?: () => void; afterSnapshot?: () => void };
  /** Lower the snapshot size cap (tests); can never raise it. */
  maxStateBytes?: number;
}

export type ResumeAction =
  | { kind: "idle" }
  | { kind: "begin-round"; invocation_id: string; round: number }
  | { kind: "await-round"; invocation_id: string; round: number }
  | { kind: "blocked"; invocation_id: string; escalation: Escalation };

// ---------------------------------------------------------------- helpers

class Refusal extends Error {
  constructor(readonly rule: StoreRule, readonly detail: string) {
    super(`${rule}: ${detail}`);
  }
}
function refuse(rule: StoreRule, detail: string): never {
  throw new Refusal(rule, detail);
}
function guard<T>(fn: () => T): StoreResult<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, rule: err.rule, detail: err.detail };
    throw err;
  }
}

function isPlain(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/** Copy untrusted data into plain values; accessors, symbols, exotic prototypes and cycles are refused. */
function detach(v: unknown, rule: StoreRule, where: string, depth = 0): unknown {
  if (depth > LIMITS.depth) refuse(rule, `${where} nests too deeply`);
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) refuse(rule, `${where} holds a non-finite number`);
    return v;
  }
  if (Array.isArray(v)) {
    if (Object.getPrototypeOf(v) !== Array.prototype) refuse(rule, `${where} is not a plain array`);
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      const d = Object.getOwnPropertyDescriptor(v, i);
      if (!d || !("value" in d)) refuse(rule, `${where}[${i}] is an accessor or hole`);
      out.push(detach(d.value, rule, `${where}[${i}]`, depth + 1));
    }
    return out;
  }
  if (!isPlain(v)) refuse(rule, `${where} is not a plain object`);
  if (Object.getOwnPropertySymbols(v).length) refuse(rule, `${where} carries symbol keys`);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    const d = Object.getOwnPropertyDescriptor(v, k)!;
    if (!("value" in d)) refuse(rule, `${where}.${k} is an accessor`);
    if (d.value === undefined) continue;
    out[k] = detach(d.value, rule, `${where}.${k}`, depth + 1);
  }
  return out;
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[], rule: StoreRule, where: string): void {
  const have = Object.keys(o).sort();
  const want = [...keys].sort();
  if (have.length !== want.length || have.some((k, i) => k !== want[i])) refuse(rule, `${where} keys [${have.join(",")}] != [${want.join(",")}]`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlain(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  throw new Error(`value of type ${typeof value} is not canonical JSON`);
}
function sha256Of(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

/** The self-hash over every field but `state_hash`. */
export function invocationStateHash(state: InvocationStateV1): string {
  const { state_hash: _ignored, ...rest } = state;
  return sha256Of(rest);
}

const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const isHash = (v: unknown): v is string => typeof v === "string" && HASH.test(v);
const isInt = (v: unknown, min: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;

function idList(v: unknown, max: number, rule: StoreRule, where: string): string[] {
  if (!Array.isArray(v) || v.length > max || !v.every(isId)) refuse(rule, `${where} must be at most ${max} ids`);
  const sorted = [...new Set(v as string[])].sort();
  if (sorted.length !== v.length) refuse(rule, `${where} repeats an id`);
  return sorted;
}
function evidenceList(v: unknown, rule: StoreRule, where: string): EvidenceRef[] {
  if (!Array.isArray(v) || v.length > LIMITS.evidence) refuse(rule, `${where} must be at most ${LIMITS.evidence} evidence refs`);
  const out = v.map((e, i) => {
    if (!isPlain(e)) refuse(rule, `${where}[${i}] is not {name, sha256}`);
    exactKeys(e, ["name", "sha256"], rule, `${where}[${i}]`);
    if (!isId(e.name) || !isHash(e.sha256)) refuse(rule, `${where}[${i}] needs an id name and a sha256:<hex> digest`);
    return { name: e.name, sha256: e.sha256 };
  });
  const sorted = [...out].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
  if (new Set(sorted.map((e) => e.name)).size !== sorted.length) refuse(rule, `${where} repeats an evidence name`);
  return sorted;
}

// ---------------------------------------------------------------- basis

/** Nodes inside a loop body: reachable from entry and able to reach exit without the repeat back-edge. */
function loopBody(p: WorkflowProjectionV2, entry: string, exit: string): string[] {
  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const e of p.edges) {
    if (e.on === "repeat") continue;
    fwd.set(e.from, [...(fwd.get(e.from) ?? []), e.to]);
    rev.set(e.to, [...(rev.get(e.to) ?? []), e.from]);
  }
  const reach = (start: string, g: Map<string, string[]>): Set<string> => {
    const seen = new Set([start]);
    const todo = [start];
    while (todo.length) for (const n of g.get(todo.pop()!) ?? []) if (!seen.has(n)) (seen.add(n), todo.push(n));
    return seen;
  };
  const a = reach(entry, fwd);
  const b = reach(exit, rev);
  return [...a].filter((n) => b.has(n)).sort();
}

function basisOf(raw: InvocationBasis): StateBasis {
  const b = detach(raw, "invalid-input", "basis") as unknown as InvocationBasis;
  const p = b?.projection;
  const m = b?.manifest;
  if (!isPlain(p) || !isPlain(m)) refuse("invalid-input", "basis must carry a compiled projection and manifest");
  if (p.schema_version !== "guild.stack.workflow-projection.v2" || m.schema_version !== "guild.workflow_compile_manifest.v1") refuse("invalid-input", "basis is not a W01 compile result");
  for (const k of ["definition_hash", "policy_hash", "expanded_hash"] as const) {
    if (!isHash(p[k]) || p[k] !== m[k]) refuse("invalid-input", `projection and manifest disagree on ${k}`);
  }
  if (!isHash(p.compiler_hash) || !isPlain(m.compiler) || m.compiler.hash !== p.compiler_hash) refuse("invalid-input", "projection and manifest disagree on compiler_hash");
  if (!Array.isArray(p.nodes) || !Array.isArray(p.edges) || !Array.isArray(m.loops)) refuse("invalid-input", "basis lacks nodes, edges or loops");
  const expanded = sha256Of({ nodes: p.nodes, edges: p.edges, entry: p.entry, protected_gates: p.protected_gates });
  if (expanded !== p.expanded_hash) refuse("invalid-input", "projection graph does not match its expanded_hash");
  const nodeIds = new Set(p.nodes.map((n) => n.id));
  const loops: BasisLoop[] = m.loops.map((l) => {
    if (!isId(l.id) || !nodeIds.has(l.entry) || !nodeIds.has(l.exit) || !isInt(l.max_rounds, 1)) refuse("invalid-input", `manifest loop ${String(l?.id)} is malformed`);
    return { id: l.id, entry: l.entry, exit: l.exit, max_rounds: l.max_rounds, until: l.until, body: loopBody(p, l.entry, l.exit) };
  });
  if (new Set(loops.map((l) => l.id)).size !== loops.length) refuse("invalid-input", "manifest repeats a loop id");
  return {
    workflow: { source_id: p.workflow.source_id, id: p.workflow.id },
    class: p.class,
    definition_hash: p.definition_hash,
    compiler_hash: p.compiler_hash,
    policy_hash: p.policy_hash,
    expanded_hash: p.expanded_hash,
    loops: loops.sort((x, y) => (x.id < y.id ? -1 : 1)),
  };
}

// ---------------------------------------------------------------- derivation

function satisfied(c: ComponentCondition, r: RoundRecord): boolean {
  switch (c.kind) {
    case "outcome":
      return r.outcome === c.equals;
    case "no_unresolved_questions":
      return r.unresolved_questions.length === 0;
    case "obligations_accepted":
      return r.obligations_accepted;
    case "artifact_present":
      return r.artifacts.includes(c.name);
    case "all_of":
      return c.conditions.every((x) => satisfied(x, r));
    case "any_of":
      return c.conditions.some((x) => satisfied(x, r));
    default:
      return false;
  }
}

/** Status and escalation follow from rounds alone; stored values are checked against this. */
function derive(inv: Pick<InvocationRecord, "rounds" | "max_rounds" | "cancel_reason">, loop: BasisLoop): { state: InvocationStatus; escalation: Escalation | null } {
  if (inv.cancel_reason !== null) return { state: "cancelled", escalation: null };
  const last = inv.rounds[inv.rounds.length - 1];
  if (!last || last.status === "started") return { state: "active", escalation: null };
  // C8: an accepted invocation has no unresolved questions, whatever `until` says.
  if (last.unresolved_questions.length === 0 && satisfied(loop.until, last)) return { state: "accepted", escalation: null };
  if (inv.rounds.length >= inv.max_rounds) {
    return { state: "blocked", escalation: { kind: "budget-exhausted", round: last.round, unresolved_questions: [...last.unresolved_questions] } };
  }
  return { state: "active", escalation: null };
}

function invocationIdFor(loopId: string, parent: { invocation_id: string; round: number } | null): string {
  return parent === null ? `inv:${loopId}` : `${parent.invocation_id}:${parent.round}:${loopId}`;
}

// ---------------------------------------------------------------- validation

const STATE_KEYS = ["schema_version", "run_id", "seq", "prev_state_hash", "basis", "basis_hash", "stack", "invocations", "previous", "state_hash"] as const;
const INV_KEYS = ["id", "loop_id", "node_id", "parent", "max_rounds", "definition_hash", "subject_hash", "state", "escalation", "cancel_reason", "rounds"] as const;
const ROUND_KEYS = ["round", "status", "outcome", "unresolved_questions", "evidence", "obligations_accepted", "artifacts"] as const;
const C = "state-corrupt" as const;

function checkRound(r: unknown, n: number, last: boolean, where: string): RoundRecord {
  if (!isPlain(r)) refuse(C, `${where} is not an object`);
  exactKeys(r, ROUND_KEYS, C, where);
  if (r.round !== n) refuse(C, `${where} is round ${String(r.round)}, expected ${n}`);
  if (r.status !== "started" && r.status !== "completed") refuse(C, `${where} has status ${String(r.status)}`);
  if (r.status === "started" && !last) refuse(C, `${where} is still started but a later round exists`);
  const q = idList(r.unresolved_questions, LIMITS.questions, C, `${where}.unresolved_questions`);
  const ev = evidenceList(r.evidence, C, `${where}.evidence`);
  const art = idList(r.artifacts, LIMITS.artifacts, C, `${where}.artifacts`);
  if (typeof r.obligations_accepted !== "boolean") refuse(C, `${where}.obligations_accepted is not boolean`);
  if (r.status === "started") {
    if (r.outcome !== null || q.length || ev.length || art.length || r.obligations_accepted) refuse(C, `${where} is started but carries results`);
  } else if (!isId(r.outcome)) refuse(C, `${where} has no outcome id`);
  if (canonicalJson(q) !== canonicalJson(r.unresolved_questions) || canonicalJson(ev) !== canonicalJson(r.evidence) || canonicalJson(art) !== canonicalJson(r.artifacts)) {
    refuse(C, `${where} lists are not in canonical order`);
  }
  return r as unknown as RoundRecord;
}

/** Structural + semantic check of a parsed snapshot against its own basis. */
function checkState(raw: unknown, runId: string): InvocationStateV1 {
  if (!isPlain(raw)) refuse(C, "snapshot is not an object");
  exactKeys(raw, STATE_KEYS, C, "snapshot");
  const s = raw as unknown as InvocationStateV1;
  if (s.schema_version !== WORKFLOW_INVOCATION_STATE_SCHEMA) refuse(C, `schema ${String(s.schema_version)}`);
  if (s.run_id !== runId) refuse(C, `snapshot belongs to run ${String(s.run_id)}`);
  if (!isInt(s.seq, 1)) refuse(C, "seq must be a positive integer");
  if (s.prev_state_hash !== null && !isHash(s.prev_state_hash)) refuse(C, "prev_state_hash malformed");
  if ((s.seq === 1) !== (s.prev_state_hash === null)) refuse(C, "only the first snapshot has no predecessor");
  if (!isHash(s.state_hash) || s.state_hash !== invocationStateHash(s)) refuse(C, "self-hash does not match the snapshot");
  if (!isPlain(s.basis) || s.basis_hash !== sha256Of(s.basis)) refuse(C, "basis_hash does not match the basis");
  if (!Array.isArray(s.basis.loops)) refuse(C, "basis has no loop table");
  const loops = new Map(s.basis.loops.map((l) => [l.id, l]));
  if (s.previous !== null) {
    if (!isPlain(s.previous)) refuse(C, "previous is malformed");
    exactKeys(s.previous as unknown as Record<string, unknown>, ["definition_hash", "basis_hash", "state_hash", "reason", "open_questions", "cancelled_invocations"], C, "previous");
  }
  if (!Array.isArray(s.invocations) || s.invocations.length > LIMITS.invocations) refuse(C, "invocations malformed");
  const byId = new Map<string, InvocationRecord>();
  s.invocations.forEach((inv, i) => {
    const where = `invocations[${i}]`;
    if (!isPlain(inv)) refuse(C, `${where} is not an object`);
    exactKeys(inv, INV_KEYS, C, where);
    const loop = loops.get(inv.loop_id);
    if (!loop) refuse(C, `${where} names unknown loop ${String(inv.loop_id)}`);
    if (inv.node_id !== loop.entry) refuse(C, `${where} node is not the loop entry`);
    if (inv.max_rounds !== loop.max_rounds) refuse(C, `${where} max_rounds ${String(inv.max_rounds)} differs from the pinned ${loop.max_rounds}`);
    if (inv.definition_hash !== s.basis.definition_hash) refuse(C, `${where} started under another definition`);
    if (!isHash(inv.subject_hash)) refuse(C, `${where} subject_hash malformed`);
    if (inv.parent !== null) {
      if (!isPlain(inv.parent) || !isId(inv.parent.invocation_id) || !isInt(inv.parent.round, 1)) refuse(C, `${where} parent malformed`);
      exactKeys(inv.parent as unknown as Record<string, unknown>, ["invocation_id", "round"], C, `${where}.parent`);
    }
    if (inv.id !== invocationIdFor(inv.loop_id, inv.parent)) refuse(C, `${where} id is not derived from its loop and parent`);
    if (byId.has(inv.id)) refuse(C, `${where} repeats id ${inv.id}`);
    if (inv.cancel_reason !== null && (typeof inv.cancel_reason !== "string" || inv.cancel_reason.length === 0 || inv.cancel_reason.length > LIMITS.reason)) refuse(C, `${where} cancel_reason malformed`);
    if (!Array.isArray(inv.rounds) || inv.rounds.length > inv.max_rounds) refuse(C, `${where} has more rounds than its bound`);
    inv.rounds.forEach((r, k) => checkRound(r, k + 1, k === inv.rounds.length - 1, `${where}.rounds[${k}]`));
    const d = derive(inv, loop);
    if (inv.state !== d.state || canonicalJson(inv.escalation) !== canonicalJson(d.escalation)) refuse(C, `${where} records ${String(inv.state)} but its rounds say ${d.state}`);
    if (inv.parent !== null) {
      const parent = byId.get(inv.parent.invocation_id);
      if (!parent) refuse(C, `${where} parent ${inv.parent.invocation_id} is not an earlier invocation`);
      if (inv.parent.round > parent.rounds.length) refuse(C, `${where} parent round was never begun`);
      const pl = loops.get(parent.loop_id)!;
      if (!pl.body.includes(loop.entry)) refuse(C, `${where} loop is not inside its parent loop`);
    }
    byId.set(inv.id, inv);
  });
  // The stack is exactly the open invocations, each the child of the one below it.
  if (!Array.isArray(s.stack) || !s.stack.every(isId) || new Set(s.stack).size !== s.stack.length) refuse(C, "stack malformed");
  const open = s.invocations.filter((i) => i.state === "active" || i.state === "blocked").map((i) => i.id).sort();
  if (canonicalJson([...s.stack].sort()) !== canonicalJson(open)) refuse(C, "stack does not hold exactly the open invocations");
  s.stack.forEach((id, k) => {
    const inv = byId.get(id)!;
    if (k === 0) {
      if (inv.parent !== null) refuse(C, "stack bottom has a parent");
      return;
    }
    const below = byId.get(s.stack[k - 1])!;
    const lastBelow = below.rounds[below.rounds.length - 1];
    if (inv.parent?.invocation_id !== below.id || !lastBelow || lastBelow.status !== "started" || lastBelow.round !== inv.parent.round) {
      refuse(C, `stack entry ${id} is not running inside the in-flight round of ${below.id}`);
    }
    if (below.state !== "active") refuse(C, `stack entry ${id} sits on a non-active parent`);
  });
  return s;
}

// ---------------------------------------------------------------- io

function paths(ctx: StoreContext): { snap: string; head: string; lock: string } {
  if (!isPlain(ctx) || typeof ctx.root !== "string" || typeof ctx.runDir !== "string" || !isId(ctx.run_id)) refuse("invalid-input", "context needs root, runDir and an id run_id");
  if (!path.isAbsolute(ctx.root) || !path.isAbsolute(ctx.runDir)) refuse("invalid-input", "root and runDir must be absolute");
  const rel = path.relative(ctx.root, ctx.runDir);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) refuse("path-not-contained", `run dir ${ctx.runDir} is not inside ${ctx.root}`);
  const c = checkContained(ctx.root, rel);
  if (isRefused(c)) refuse("path-not-contained", `run dir ${ctx.runDir} [${c.code}]`);
  return { snap: path.join(rel, INVOCATION_STATE_FILE), head: path.join(rel, INVOCATION_HEAD_FILE), lock: path.join(rel, INVOCATION_LOCK_FILE) };
}

function readContained(root: string, rel: string, max: number): string | null {
  const c = checkContained(root, rel, { requireRegularFileLeaf: true });
  if (isRefused(c)) refuse("path-not-contained", `${rel} [${c.code}]`);
  let st: fs.Stats;
  try {
    st = fs.lstatSync(c.realPath);
  } catch {
    return null;
  }
  if (!st.isFile()) refuse("path-not-contained", `${rel} is not a regular file`);
  if (st.size > max) refuse(C, `${rel} exceeds ${max} bytes`);
  let fd: number;
  try {
    fd = fs.openSync(c.realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    refuse("path-not-contained", `${rel} could not be opened without following a link`);
  }
  try {
    const fst = fs.fstatSync(fd);
    if (!fst.isFile() || fst.ino !== st.ino || fst.dev !== st.dev) refuse("path-not-contained", `${rel} changed while it was read`);
    if (fst.size > max) refuse(C, `${rel} exceeds ${max} bytes`);
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function parseJson(text: string, what: string): unknown {
  try {
    return detach(JSON.parse(text), C, what);
  } catch (err) {
    if (err instanceof Refusal) throw err;
    refuse(C, `${what} is not JSON`);
  }
}

/**
 * Read and verify the files; `null` when no state was ever written.
 *
 * Write order is head first, then snapshot: the head names the exact hash of
 * the snapshot about to land. So the snapshot either equals the head, or is
 * the head's named predecessor (the crash fell between the two writes and the
 * pending change never landed; the caller saw no success). A snapshot the head
 * does not name is refused, whatever its own chain says.
 */
function readState(ctx: StoreContext): InvocationStateV1 | null {
  const p = paths(ctx);
  const headText = readContained(ctx.root, p.head, LIMITS.headBytes);
  const snapText = readContained(ctx.root, p.snap, LIMITS.fileBytes);
  if (snapText === null && headText === null) return null;
  if (headText === null) refuse("state-missing", "the head file is gone; refusing to trust an unanchored snapshot");
  const h = parseJson(headText, "head");
  if (!isPlain(h)) refuse(C, "head is not an object");
  exactKeys(h, ["schema_version", "run_id", "seq", "state_hash", "prev_state_hash"], C, "head");
  if (h.schema_version !== WORKFLOW_INVOCATION_HEAD_SCHEMA || h.run_id !== ctx.run_id || !isInt(h.seq, 1) || !isHash(h.state_hash)) refuse(C, "head malformed");
  if (h.prev_state_hash !== null && !isHash(h.prev_state_hash)) refuse(C, "head malformed");
  if ((h.seq === 1) !== (h.prev_state_hash === null)) refuse(C, "only the first head has no predecessor");
  if (snapText === null) {
    // The very first write crashed after its head: nothing ever landed.
    if (h.seq === 1) return null;
    refuse("state-missing", "the head names a snapshot that is gone; refusing to restart the loop budget");
  }
  const state = checkState(parseJson(snapText, "snapshot"), ctx.run_id);
  if (h.seq === state.seq && h.state_hash === state.state_hash && h.prev_state_hash === state.prev_state_hash) return state;
  if (h.seq === state.seq + 1 && h.prev_state_hash === state.state_hash) return state;
  refuse("state-stale", `snapshot seq ${state.seq} is not the one the head (seq ${String(h.seq)}) names`);
}

function persist(ctx: StoreContext, prev: InvocationStateV1 | null, next: Omit<InvocationStateV1, "seq" | "prev_state_hash" | "state_hash">, opts: StoreOptions): InvocationStateV1 {
  const p = paths(ctx);
  const full = { ...next, seq: (prev?.seq ?? 0) + 1, prev_state_hash: prev?.state_hash ?? null, state_hash: "" } as InvocationStateV1;
  full.state_hash = invocationStateHash(full);
  checkState(JSON.parse(JSON.stringify(full)), ctx.run_id);
  const bytes = Buffer.from(JSON.stringify(full, null, 2) + "\n", "utf8");
  const cap = Math.min(LIMITS.fileBytes, isInt(opts.maxStateBytes, 1) ? opts.maxStateBytes : LIMITS.fileBytes);
  if (bytes.length > cap) refuse("capacity-exceeded", `the next snapshot is ${bytes.length} bytes; the cap is ${cap}. Nothing was written — escalate or replan`);
  const head: HeadV1 = { schema_version: WORKFLOW_INVOCATION_HEAD_SCHEMA, run_id: ctx.run_id, seq: full.seq, state_hash: full.state_hash, prev_state_hash: full.prev_state_hash };
  const w1 = writeContainedFile(ctx.root, p.head, Buffer.from(JSON.stringify(head, null, 2) + "\n", "utf8"));
  if (!w1.written) refuse(w1.code === "write-failed" ? "write-failed" : "path-not-contained", `head: ${w1.detail ?? w1.code}`);
  opts.faults?.afterHead?.();
  const w2 = writeContainedFile(ctx.root, p.snap, bytes);
  if (!w2.written) refuse(w2.code === "write-failed" ? "write-failed" : "path-not-contained", `snapshot: ${w2.detail ?? w2.code}`);
  opts.faults?.afterSnapshot?.();
  return full;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * One controller at a time per run: an exclusive-create lock file holding
 * `<pid>:<nonce>`. A lock whose pid is dead is a crashed holder and is taken
 * over; a live holder refuses with `state-locked`.
 */
function withLock<T>(ctx: StoreContext, fn: () => T): T {
  const p = paths(ctx);
  const prep = prepareContainedWrite(ctx.root, p.lock, { requireRegularFileLeaf: true });
  if (isRefused(prep)) refuse("path-not-contained", `lock: [${prep.code}]`);
  const token = `${process.pid}:${crypto.randomBytes(8).toString("hex")}`;
  let held = false;
  for (let attempt = 0; attempt < 2 && !held; attempt++) {
    try {
      const fd = fs.openSync(prep.realPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      try {
        fs.writeSync(fd, token);
      } finally {
        fs.closeSync(fd);
      }
      held = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") refuse("write-failed", `lock: ${(err as Error).message}`);
      const text = readContained(ctx.root, p.lock, LIMITS.lockBytes) ?? "";
      const pid = Number(/^(\d+):/.exec(text)?.[1]);
      if (Number.isInteger(pid) && pid > 0 && pidAlive(pid)) refuse("state-locked", `run ${ctx.run_id} is held by live controller pid ${pid}`);
      if (attempt === 1) break;
      try {
        fs.unlinkSync(prep.realPath);
      } catch {
        // Another controller took it over first; the retry decides.
      }
    }
  }
  if (!held) refuse("state-locked", `run ${ctx.run_id} lock could not be taken`);
  try {
    return fn();
  } finally {
    try {
      if (fs.readFileSync(prep.realPath, "utf8") === token) fs.unlinkSync(prep.realPath);
    } catch {
      // Already gone.
    }
  }
}

/** Load, verify and require the state to be bound to exactly this basis. */
function loadBound(ctx: StoreContext, raw: InvocationBasis): { state: InvocationStateV1; basis: StateBasis } {
  const basis = basisOf(raw);
  const state = readState(ctx);
  if (!state) refuse("no-state", "no invocation state on this run; call initInvocationState first");
  if (state.basis_hash !== sha256Of(basis)) {
    refuse("replan-required", `run state is bound to definition ${state.basis.definition_hash}; the current basis is ${basis.definition_hash} — replan explicitly`);
  }
  return { state, basis };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function body(s: InvocationStateV1): Omit<InvocationStateV1, "seq" | "prev_state_hash" | "state_hash"> {
  return clone({ schema_version: s.schema_version, run_id: s.run_id, basis: s.basis, basis_hash: s.basis_hash, stack: s.stack, invocations: s.invocations, previous: s.previous });
}
function findInv(s: { invocations: InvocationRecord[] }, id: unknown): InvocationRecord {
  if (!isId(id)) refuse("invalid-input", "invocation_id must be an id");
  const inv = s.invocations.find((i) => i.id === id);
  if (!inv) refuse("unknown-invocation", `no invocation ${id}`);
  return inv;
}
function loopOf(basis: StateBasis, id: string): BasisLoop {
  const l = basis.loops.find((x) => x.id === id);
  if (!l) refuse("unknown-loop", `the compiled workflow has no loop ${id}`);
  return l;
}
function requireTop(s: InvocationStateV1, id: string): void {
  if (s.stack[s.stack.length - 1] !== id) refuse("not-top-of-stack", `${id} is not the innermost open invocation (top is ${s.stack[s.stack.length - 1] ?? "none"})`);
}
function input(raw: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const v = detach(raw, "invalid-input", "input");
  if (!isPlain(v)) refuse("invalid-input", "input is not an object");
  const extra = Object.keys(v).filter((k) => !keys.includes(k) && !optional.includes(k));
  const missing = keys.filter((k) => !(k in v));
  if (extra.length || missing.length) refuse("invalid-input", `input keys: missing [${missing.join(",")}], unknown [${extra.join(",")}]`);
  return v;
}

// ---------------------------------------------------------------- API

/** Create the run's invocation state, bound to this compile basis. */
export function initInvocationState(ctx: StoreContext, raw: InvocationBasis, opts: StoreOptions = {}): StoreResult<InvocationStateV1> {
  return guard(() => withLock(ctx, () => {
    const basis = basisOf(raw);
    const existing = readState(ctx);
    if (existing) {
      if (existing.basis_hash !== sha256Of(basis)) refuse("replan-required", "the run already holds state for another definition");
      refuse("state-exists", "the run already holds invocation state; resume it");
    }
    return persist(ctx, null, { schema_version: WORKFLOW_INVOCATION_STATE_SCHEMA, run_id: ctx.run_id, basis, basis_hash: sha256Of(basis), stack: [], invocations: [], previous: null }, opts);
  }));
}

/** Verified state for this basis. Never writes. */
export function loadInvocationState(ctx: StoreContext, raw: InvocationBasis): StoreResult<InvocationStateV1> {
  return guard(() => loadBound(ctx, raw).state);
}

/** What a restarted controller must do next. Deterministic for the same bytes; never writes. */
export function resumeInvocations(ctx: StoreContext, raw: InvocationBasis): StoreResult<{ state: InvocationStateV1; next: ResumeAction }> {
  return guard(() => {
    const { state } = loadBound(ctx, raw);
    const top = state.stack[state.stack.length - 1];
    if (top === undefined) return { state, next: { kind: "idle" } as ResumeAction };
    const inv = findInv(state, top);
    if (inv.state === "blocked") return { state, next: { kind: "blocked", invocation_id: inv.id, escalation: inv.escalation! } };
    const last = inv.rounds[inv.rounds.length - 1];
    if (last && last.status === "started") return { state, next: { kind: "await-round", invocation_id: inv.id, round: last.round } };
    return { state, next: { kind: "begin-round", invocation_id: inv.id, round: inv.rounds.length + 1 } };
  });
}

export interface OpenInvocationInput { loop_id: string; subject_hash: string; parent?: { invocation_id: string; round: number } }

/**
 * Open (or, after a restart, re-find) the invocation of one loop. The id is
 * derived from the loop and its parent round, so reopening returns the same
 * invocation with its spent budget — never a fresh one.
 */
export function openInvocation(ctx: StoreContext, raw: InvocationBasis, rawIn: OpenInvocationInput, opts: StoreOptions = {}): StoreResult<InvocationRecord> {
  return guard(() => withLock(ctx, () => {
    const { state } = loadBound(ctx, raw);
    const inp = input(rawIn, ["loop_id", "subject_hash"], ["parent"]);
    if (!isId(inp.loop_id) || !isHash(inp.subject_hash)) refuse("invalid-input", "loop_id must be an id and subject_hash a sha256:<hex> digest");
    const loop = loopOf(state.basis, inp.loop_id);
    let parent: { invocation_id: string; round: number } | null = null;
    if (inp.parent !== undefined) {
      if (!isPlain(inp.parent)) refuse("invalid-input", "parent must be {invocation_id, round}");
      exactKeys(inp.parent, ["invocation_id", "round"], "invalid-input", "parent");
      if (!isInt(inp.parent.round, 1)) refuse("invalid-input", "parent.round must be a positive integer");
      parent = { invocation_id: findInv(state, inp.parent.invocation_id).id, round: inp.parent.round };
    }
    const id = invocationIdFor(loop.id, parent);
    if (!ID.test(id)) refuse("invalid-input", `invocation id ${id} exceeds the C8 id pattern`);
    const existing = state.invocations.find((i) => i.id === id);
    if (existing) {
      if (existing.subject_hash !== inp.subject_hash) refuse("invocation-conflict", `${id} already runs on subject ${existing.subject_hash}`);
      return existing;
    }
    if (parent === null) {
      if (state.stack.length) refuse("parent-required", `${loop.id} opens inside ${state.stack[state.stack.length - 1]}; name it as parent`);
      const enclosing = state.basis.loops.find((l) => l.id !== loop.id && l.body.includes(loop.entry));
      if (enclosing) refuse("parent-required", `${loop.id} sits inside loop ${enclosing.id}`);
    } else {
      const p = findInv(state, parent.invocation_id);
      const pl = loopOf(state.basis, p.loop_id);
      if (!pl.body.includes(loop.entry)) refuse("invalid-input", `${loop.id} is not inside loop ${pl.id}`);
      requireTop(state, p.id);
      const last = p.rounds[p.rounds.length - 1];
      if (p.state !== "active" || !last || last.status !== "started" || last.round !== parent.round) refuse("no-round-in-flight", `${p.id} round ${parent.round} is not in flight`);
    }
    if (state.invocations.length >= LIMITS.invocations) refuse("invalid-input", "invocation limit reached");
    const inv: InvocationRecord = {
      id,
      loop_id: loop.id,
      node_id: loop.entry,
      parent,
      max_rounds: loop.max_rounds,
      definition_hash: state.basis.definition_hash,
      subject_hash: inp.subject_hash,
      state: "active",
      escalation: null,
      cancel_reason: null,
      rounds: [],
    };
    const next = body(state);
    next.invocations.push(inv);
    next.stack.push(id);
    persist(ctx, state, next, opts);
    return inv;
  }));
}

/**
 * Record round N as started BEFORE its work is dispatched. `expected_round` is
 * a compare-and-set: a caller that lost track after a crash is refused instead
 * of skipping or repeating a round.
 */
export function beginRound(ctx: StoreContext, raw: InvocationBasis, rawIn: { invocation_id: string; expected_round: number }, opts: StoreOptions = {}): StoreResult<{ invocation_id: string; round: number }> {
  return guard(() => withLock(ctx, () => {
    const { state } = loadBound(ctx, raw);
    const inp = input(rawIn, ["invocation_id", "expected_round"]);
    if (!isInt(inp.expected_round, 1)) refuse("invalid-input", "expected_round must be a positive integer");
    const inv = findInv(state, inp.invocation_id);
    if (inv.state === "accepted" || inv.state === "cancelled") refuse("invocation-closed", `${inv.id} is ${inv.state}`);
    if (inv.state === "blocked") refuse("budget-exhausted", `${inv.id} spent ${inv.max_rounds} of ${inv.max_rounds} rounds with unresolved questions; escalate, cancel or replan`);
    const last = inv.rounds[inv.rounds.length - 1];
    if (last && last.status === "started") refuse("round-in-flight", `${inv.id} round ${last.round} is already in flight; await it, never re-run it`);
    requireTop(state, inv.id);
    const n = inv.rounds.length + 1;
    if (inp.expected_round !== n) refuse("round-mismatch", `${inv.id} would begin round ${n}, caller expected ${String(inp.expected_round)}`);
    if (n > inv.max_rounds) refuse("budget-exhausted", `${inv.id} has no rounds left`);
    const next = body(state);
    const target = findInv(next, inv.id);
    target.rounds.push({ round: n, status: "started", outcome: null, unresolved_questions: [], evidence: [], obligations_accepted: false, artifacts: [] });
    persist(ctx, state, next, opts);
    return { invocation_id: inv.id, round: n };
  }));
}

export interface CompleteRoundInput {
  invocation_id: string;
  round: number;
  outcome: string;
  unresolved_questions: string[];
  evidence: EvidenceRef[];
  obligations_accepted?: boolean;
  artifacts?: string[];
}

/** Record the in-flight round's result; derive accepted / active / blocked. Idempotent for an identical replay. */
export function completeRound(ctx: StoreContext, raw: InvocationBasis, rawIn: CompleteRoundInput, opts: StoreOptions = {}): StoreResult<{ state: InvocationStatus; escalation: Escalation | null; replayed: boolean }> {
  return guard(() => withLock(ctx, () => {
    const { state } = loadBound(ctx, raw);
    const inp = input(rawIn, ["invocation_id", "round", "outcome", "unresolved_questions", "evidence"], ["obligations_accepted", "artifacts"]);
    if (!isInt(inp.round, 1) || !isId(inp.outcome)) refuse("invalid-input", "round must be a positive integer and outcome an id");
    if (inp.obligations_accepted !== undefined && typeof inp.obligations_accepted !== "boolean") refuse("invalid-input", "obligations_accepted must be boolean");
    const record: RoundRecord = {
      round: inp.round,
      status: "completed",
      outcome: inp.outcome,
      unresolved_questions: idList(inp.unresolved_questions, LIMITS.questions, "invalid-input", "unresolved_questions"),
      evidence: evidenceList(inp.evidence, "invalid-input", "evidence"),
      obligations_accepted: inp.obligations_accepted === true,
      artifacts: idList(inp.artifacts ?? [], LIMITS.artifacts, "invalid-input", "artifacts"),
    };
    const inv = findInv(state, inp.invocation_id);
    const prior = inv.rounds[inp.round - 1];
    if (prior && prior.status === "completed") {
      if (canonicalJson(prior) === canonicalJson(record)) return { state: inv.state, escalation: inv.escalation, replayed: true };
      refuse("round-already-completed", `${inv.id} round ${inp.round} already completed with a different result`);
    }
    if (inv.state !== "active") refuse("invocation-closed", `${inv.id} is ${inv.state}`);
    const last = inv.rounds[inv.rounds.length - 1];
    if (!last || last.status !== "started" || last.round !== inp.round) refuse("no-round-in-flight", `${inv.id} round ${inp.round} is not in flight`);
    requireTop(state, inv.id);
    const next = body(state);
    const target = findInv(next, inv.id);
    target.rounds[inp.round - 1] = record;
    const d = derive(target, loopOf(next.basis, target.loop_id));
    target.state = d.state;
    target.escalation = d.escalation;
    if (d.state === "accepted") next.stack.pop();
    persist(ctx, state, next, opts);
    return { state: d.state, escalation: d.escalation, replayed: false };
  }));
}

/** Operator/controller cancel of the innermost open invocation (the way past an exhausted loop short of a replan). */
export function cancelInvocation(ctx: StoreContext, raw: InvocationBasis, rawIn: { invocation_id: string; reason: string }, opts: StoreOptions = {}): StoreResult<InvocationRecord> {
  return guard(() => withLock(ctx, () => {
    const { state } = loadBound(ctx, raw);
    const inp = input(rawIn, ["invocation_id", "reason"]);
    if (typeof inp.reason !== "string" || inp.reason.trim() === "" || inp.reason.length > LIMITS.reason) refuse("invalid-input", `reason must be 1..${LIMITS.reason} chars`);
    const inv = findInv(state, inp.invocation_id);
    if (inv.state === "accepted" || inv.state === "cancelled") refuse("invocation-closed", `${inv.id} is ${inv.state}`);
    requireTop(state, inv.id);
    const next = body(state);
    const target = findInv(next, inv.id);
    target.cancel_reason = inp.reason;
    target.state = "cancelled";
    target.escalation = null;
    next.stack.pop();
    persist(ctx, state, next, opts);
    return target;
  }));
}

/**
 * Explicit replan: rebind the run to a DIFFERENT compile basis. Every open
 * invocation is cancelled into the `previous` record with its open questions;
 * the new definition starts with no invocations. Rebinding to the same basis is
 * refused, so a replan cannot be used to hand back budget. Dispatch of the new
 * definition still needs W03's recomposition and renewed team approval.
 */
export function replanInvocationState(ctx: StoreContext, raw: InvocationBasis, rawIn: { reason: string }, opts: StoreOptions = {}): StoreResult<InvocationStateV1> {
  return guard(() => withLock(ctx, () => {
    const basis = basisOf(raw);
    const inp = input(rawIn, ["reason"]);
    if (typeof inp.reason !== "string" || inp.reason.trim() === "" || inp.reason.length > LIMITS.reason) refuse("invalid-input", `reason must be 1..${LIMITS.reason} chars`);
    const old = readState(ctx);
    if (!old) refuse("no-state", "nothing to replan; initialise instead");
    const basisHash = sha256Of(basis);
    if (old.basis_hash === basisHash) refuse("replan-unchanged", "the basis is unchanged; resume the existing invocations");
    const openInv = old.invocations.filter((i) => i.state === "active" || i.state === "blocked");
    const questions = new Set<string>();
    for (const i of openInv) for (const q of lastCompleted(i)) questions.add(q);
    const previous: ReplanRecord = {
      definition_hash: old.basis.definition_hash,
      basis_hash: old.basis_hash,
      state_hash: old.state_hash,
      reason: inp.reason,
      open_questions: [...questions].sort(),
      cancelled_invocations: openInv.map((i) => i.id).sort(),
    };
    return persist(ctx, old, { schema_version: WORKFLOW_INVOCATION_STATE_SCHEMA, run_id: ctx.run_id, basis, basis_hash: basisHash, stack: [], invocations: [], previous }, opts);
  }));
}

function lastCompleted(inv: InvocationRecord): string[] {
  for (let k = inv.rounds.length - 1; k >= 0; k--) if (inv.rounds[k].status === "completed") return inv.rounds[k].unresolved_questions;
  return [];
}

/** The C8 WorkflowProjection v2 with the runtime `invocations` overlay filled from verified state. */
export function overlayInvocations(projection: WorkflowProjectionV2, state: InvocationStateV1): WorkflowProjectionV2 {
  if (state.basis.definition_hash !== projection.definition_hash || state.basis.expanded_hash !== projection.expanded_hash) {
    throw new Error("overlayInvocations: state is bound to another definition");
  }
  const invocations = state.invocations.map((i) => ({
    id: i.id,
    node_id: i.node_id,
    round: i.rounds.length,
    max_rounds: i.max_rounds,
    unresolved_questions: [...lastCompleted(i)],
    state: i.state,
    definition_hash: i.definition_hash,
    subject_hash: i.subject_hash,
  }));
  return { ...clone(projection), invocations: invocations as never[] };
}

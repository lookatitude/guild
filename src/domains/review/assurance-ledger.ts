/**
 * assurance-ledger.ts — W02 subject-bound assurance state machine (C8 v2
 * obligations, architecture T13 / D1-F1).
 *
 * Every verdict binds obligation id, invocation + round, authority and the
 * subject hash the invocation started under. The subject manifest pins the
 * source revision and artifact bytes plus the workflow definition, compiler,
 * policy (role/capability basis) and expanded-graph hashes, so evidence for
 * source A never counts for repaired source B just because the same QA node is
 * visited again.
 *
 * Mutation: a declared change set invalidates the obligations whose scoped
 * artifacts moved; a change that is unknown, or larger than declared,
 * invalidates every obligation. Every open invocation is superseded, so a
 * verdict can only land on an invocation started under the current subject.
 * Evidence bytes already spent on one scope cannot be spent again on another.
 *
 * Restart: `restoreLedger` re-validates the serialized bytes (shape, hash and
 * internal consistency) and treats a subject that moved since the last write
 * as an unknown mutation. Acceptance re-checks the subject at the boundary.
 *
 * Trust: in-process callers are trusted. The ledger hash detects torn or edited
 * bytes; it is not a signature. Reviewer independence is the caller's policy.
 */

import * as crypto from "node:crypto";

export const ASSURANCE_LEDGER_SCHEMA_VERSION = "guild.assurance_ledger.v1" as const;
export const ASSURANCE_KINDS = Object.freeze(["security", "adversarial_security", "ui", "ux", "quality", "project_specific"] as const);
export type AssuranceKind = (typeof ASSURANCE_KINDS)[number];
const QA_KINDS: readonly string[] = ["security", "adversarial_security", "ui", "ux"];

const LIMITS = { obligations: 200, invocations: 1000, artifacts: 1000, scope: 100, evidence: 50, spent: 10_000, maxRounds: 10, bytes: 4_000_000 };
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]{1,1024}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const AVAILABILITY = ["available", "expired", "redacted", "missing", "unsupported"];

export interface SubjectArtifact { name: string; sha256: string }
export interface SubjectManifest { source_id: string; source_revision: string; artifacts: SubjectArtifact[] }
export interface WorkflowBasis { source_id: string; id: string; definition_hash: string; compiler_hash: string; policy_hash: string; expanded_hash: string }

export interface ObligationSpec {
  id: string;
  kind: AssuranceKind;
  node_id: string;
  required: boolean;
  /** Identity whose verdict this obligation accepts. */
  authority: string;
  /** Artifact names the evidence covers; empty means the whole subject. */
  scope: string[];
  max_rounds: number;
}

/** C8 v2 common evidence reference. */
export interface EvidenceRef {
  source_id: string;
  path: string;
  sha256: string;
  schema_version: string;
  observed_at: string;
  availability: "available" | "expired" | "redacted" | "missing" | "unsupported";
  reason: string | null;
}

export interface Binding { invocation_id: string; round: number; authority: string; subject_hash: string; scope_hash: string; evidence: EvidenceRef[] }
export type ObligationStatus = "pending" | "accepted" | "rejected" | "invalidated";
export type InvalidationCause = "mutation" | "unknown-mutation" | "restart-subject-mismatch";
export interface ObligationState extends ObligationSpec { status: ObligationStatus; round: number; accepted: Binding | null; invalidated_by: InvalidationCause | null }
export type InvocationStatus = "active" | "accepted" | "rejected" | "superseded";
export interface InvocationState { id: string; obligation_id: string; node_id: string; round: number; subject_hash: string; scope_hash: string; state: InvocationStatus }

export interface AssuranceLedger {
  schema_version: typeof ASSURANCE_LEDGER_SCHEMA_VERSION;
  workflow: WorkflowBasis;
  subject: SubjectManifest;
  subject_hash: string;
  obligations: ObligationState[];
  invocations: InvocationState[];
  spent_evidence: Array<{ sha256: string; scope_hash: string }>;
  ledger_hash: string;
}

export interface VerdictReceipt {
  source_id: string;
  obligation_id: string;
  invocation_id: string;
  round: number;
  authority: string;
  subject_hash: string;
  verdict: "accept" | "reject";
  evidence: EvidenceRef[];
}

export type AssuranceRule =
  | "invalid-ledger"
  | "ledger-corrupt"
  | "foreign-source"
  | "assurance-outside-gate"
  | "unknown-obligation"
  | "unknown-invocation"
  | "duplicate-invocation"
  | "invocation-mismatch"
  | "stale-invocation"
  | "round-mismatch"
  | "round-cap"
  | "subject-mismatch"
  | "authority-mismatch"
  | "missing-evidence"
  | "evidence-reused";
export interface AssuranceViolation { rule: AssuranceRule; detail: string }
export type AssuranceResult<T> = { ok: true; value: T } | { ok: false; violations: AssuranceViolation[] };

export type AcceptanceResult =
  | { ok: true; accepted: string[] }
  | { ok: false; blockers: Array<{ obligation_id: string; reason: string }> };

// ---------------------------------------------------------------- hashing

function canonical(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
const sha = (v: unknown) => `sha256:${crypto.createHash("sha256").update(canonical(v), "utf8").digest("hex")}`;

const basisOf = (w: WorkflowBasis) => ({ source_id: w.source_id, id: w.id, definition_hash: w.definition_hash, compiler_hash: w.compiler_hash, policy_hash: w.policy_hash, expanded_hash: w.expanded_hash });
const sortedArtifacts = (m: SubjectManifest) => [...m.artifacts].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((a) => ({ name: a.name, sha256: a.sha256 }));

/** Hash of the whole subject: workflow basis + source revision + artifact bytes. */
export function subjectHash(workflow: WorkflowBasis, subject: SubjectManifest): string {
  return sha({ workflow: basisOf(workflow), source_id: subject.source_id, source_revision: subject.source_revision, artifacts: sortedArtifacts(subject) });
}

/** Hash of the subset one obligation covers: reuse is allowed only while this is unchanged. */
function scopeHash(workflow: WorkflowBasis, subject: SubjectManifest, ob: Pick<ObligationSpec, "id" | "authority" | "scope">): string {
  const bytes = new Map(subject.artifacts.map((a) => [a.name, a.sha256]));
  const names = ob.scope.length ? [...ob.scope].sort() : sortedArtifacts(subject).map((a) => a.name);
  const scoped = ob.scope.length ? names.map((n) => [n, bytes.get(n) ?? null]) : [...names.map((n) => [n, bytes.get(n)!]), ["@source_revision", subject.source_revision]];
  return sha({ workflow: basisOf(workflow), source_id: subject.source_id, obligation: ob.id, authority: ob.authority, scope: scoped });
}

/** Hash over every ledger field except `ledger_hash`. */
export function assuranceLedgerHash(body: Omit<AssuranceLedger, "ledger_hash">): string {
  return sha(body);
}

// ---------------------------------------------------------------- strict reading

class Bad extends Error {
  constructor(readonly rule: AssuranceRule, msg: string, readonly all?: AssuranceViolation[]) {
    super(msg);
  }
}
const bad = (rule: AssuranceRule, msg: string): never => {
  throw new Bad(rule, msg);
};

/** Plain-data copy; accessors, symbols, toJSON and exotic prototypes refused. */
function snapshot(value: unknown, rule: AssuranceRule, where: string): unknown {
  let budget = 500_000;
  const walk = (v: unknown, depth: number, at: string): unknown => {
    if (--budget < 0 || depth > 16) bad(rule, `${where} is too large or deep`);
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : bad(rule, `${at} is not finite`);
    if (typeof v !== "object") return bad(rule, `${at} holds a ${typeof v}`);
    const isArr = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (isArr ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) bad(rule, `${at} is not plain data`);
    const keys = Reflect.ownKeys(v as object);
    if (isArr && keys.length !== (v as unknown[]).length + 1) bad(rule, `${at} is a sparse or decorated array`);
    const out: Record<string, unknown> | unknown[] = isArr ? [] : {};
    for (const k of keys) {
      if (typeof k === "symbol") bad(rule, `${at} carries a symbol key`);
      if (isArr && k === "length") continue;
      if (k === "toJSON" || k === "__proto__") bad(rule, `${at} carries reserved key '${String(k)}'`);
      const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (!("value" in d) || !d.enumerable) bad(rule, `${at}.${String(k)} is an accessor or hidden property`);
      if (isArr && !/^(0|[1-9][0-9]*)$/.test(k as string)) bad(rule, `${at} is a decorated array`);
      (out as Record<string, unknown>)[k as string] = walk(d.value, depth + 1, `${at}.${String(k)}`);
    }
    return out;
  };
  return walk(value, 0, where);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
function exact(v: unknown, keys: string[], rule: AssuranceRule, at: string): Obj {
  if (!isObj(v)) return bad(rule, `${at} is not a mapping`);
  for (const k of keys) if (!(k in v)) bad(rule, `${at} lacks '${k}'`);
  for (const k of Object.keys(v)) if (!keys.includes(k)) bad(rule, `${at} has unknown key '${k}'`);
  return v;
}
function str(v: unknown, re: RegExp, rule: AssuranceRule, at: string): string {
  if (typeof v !== "string" || !re.test(v)) bad(rule, `${at} is not a valid value`);
  return v as string;
}
function int(v: unknown, min: number, max: number, rule: AssuranceRule, at: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) bad(rule, `${at} must be an integer in ${min}..${max}`);
  return v as number;
}
function arr(v: unknown, max: number, rule: AssuranceRule, at: string): unknown[] {
  if (!Array.isArray(v) || v.length > max) bad(rule, `${at} must be an array of at most ${max}`);
  return v as unknown[];
}
function oneOf<T extends string>(v: unknown, set: readonly T[], rule: AssuranceRule, at: string): T {
  if (!(set as readonly unknown[]).includes(v)) bad(rule, `${at} '${String(v)}' is not one of ${set.join(", ")}`);
  return v as T;
}

function readSubject(v: unknown, rule: AssuranceRule): SubjectManifest {
  const s = exact(v, ["source_id", "source_revision", "artifacts"], rule, "subject");
  const artifacts = arr(s.artifacts, LIMITS.artifacts, rule, "subject.artifacts").map((a, i) => {
    const o = exact(a, ["name", "sha256"], rule, `subject.artifacts[${i}]`);
    return { name: str(o.name, ID, rule, `subject.artifacts[${i}].name`), sha256: str(o.sha256, HASH, rule, `subject.artifacts[${i}].sha256`) };
  });
  if (new Set(artifacts.map((a) => a.name)).size !== artifacts.length) bad(rule, "subject names an artifact twice");
  return { source_id: str(s.source_id, ID, rule, "subject.source_id"), source_revision: str(s.source_revision, HASH, rule, "subject.source_revision"), artifacts };
}

function readEvidence(v: unknown, rule: AssuranceRule, at: string): EvidenceRef[] {
  return arr(v, LIMITS.evidence, rule, at).map((e, i) => {
    const o = exact(e, ["source_id", "path", "sha256", "schema_version", "observed_at", "availability", "reason"], rule, `${at}[${i}]`);
    if (o.reason !== null && (typeof o.reason !== "string" || o.reason.length === 0 || o.reason.length > 4096)) bad(rule, `${at}[${i}].reason is invalid`);
    if (typeof o.schema_version !== "string" || o.schema_version.length === 0 || o.schema_version.length > 4096) bad(rule, `${at}[${i}].schema_version is invalid`);
    return {
      source_id: str(o.source_id, ID, rule, `${at}[${i}].source_id`),
      path: str(o.path, PATH, rule, `${at}[${i}].path`),
      sha256: str(o.sha256, HASH, rule, `${at}[${i}].sha256`),
      schema_version: o.schema_version as string,
      observed_at: str(o.observed_at, TIME, rule, `${at}[${i}].observed_at`),
      availability: oneOf(o.availability, AVAILABILITY as EvidenceRef["availability"][], rule, `${at}[${i}].availability`),
      reason: o.reason as string | null,
    };
  });
}

function readSpec(v: unknown, rule: AssuranceRule, at: string, extra: string[] = []): ObligationSpec & Obj {
  const o = exact(v, ["id", "kind", "node_id", "required", "authority", "scope", "max_rounds", ...extra], rule, at);
  if (typeof o.required !== "boolean") bad(rule, `${at}.required must be boolean`);
  const scope = arr(o.scope, LIMITS.scope, rule, `${at}.scope`).map((n, i) => str(n, ID, rule, `${at}.scope[${i}]`));
  if (new Set(scope).size !== scope.length) bad(rule, `${at}.scope repeats a name`);
  return {
    ...o,
    id: str(o.id, ID, rule, `${at}.id`),
    kind: oneOf(o.kind, ASSURANCE_KINDS, rule, `${at}.kind`),
    node_id: str(o.node_id, ID, rule, `${at}.node_id`),
    required: o.required as boolean,
    authority: str(o.authority, ID, rule, `${at}.authority`),
    scope: [...scope].sort(),
    max_rounds: int(o.max_rounds, 1, LIMITS.maxRounds, rule, `${at}.max_rounds`),
  };
}

// ---------------------------------------------------------------- construction

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v as object)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

type Body = Omit<AssuranceLedger, "ledger_hash">;
function seal(input: Body): AssuranceLedger {
  // Bodies are cloned from sealed ledgers; never hash a stale ledger_hash.
  const { ledger_hash: _stale, ...body } = input as Body & { ledger_hash?: string };
  const sorted: Body = {
    ...body,
    obligations: [...body.obligations].sort((a, b) => (a.id < b.id ? -1 : 1)),
    invocations: [...body.invocations].sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  return deepFreeze({ ...sorted, ledger_hash: assuranceLedgerHash(sorted) });
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function run<T>(fn: () => T): AssuranceResult<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    if (err instanceof Bad) return { ok: false, violations: err.all ?? [{ rule: err.rule, detail: err.message }] };
    throw err;
  }
}

export interface CreateLedgerInput {
  /** The compiled C8 v2 projection (only workflow, hashes and node scopes are read). */
  projection: unknown;
  subject: SubjectManifest;
  obligations: ObligationSpec[];
}

/** Open a ledger for one compiled workflow and its current subject. */
export function createAssuranceLedger(input: CreateLedgerInput): AssuranceResult<AssuranceLedger> {
  return run(() => {
    const raw = snapshot(input, "invalid-ledger", "input");
    const inp = exact(raw, ["projection", "subject", "obligations"], "invalid-ledger", "input");
    const p = inp.projection;
    if (!isObj(p) || !isObj(p.workflow) || !Array.isArray(p.nodes)) return bad("invalid-ledger", "projection lacks workflow/nodes");
    const workflow: WorkflowBasis = {
      source_id: str(p.workflow.source_id, ID, "invalid-ledger", "projection.workflow.source_id"),
      id: str(p.workflow.id, ID, "invalid-ledger", "projection.workflow.id"),
      definition_hash: str(p.definition_hash, HASH, "invalid-ledger", "projection.definition_hash"),
      compiler_hash: str(p.compiler_hash, HASH, "invalid-ledger", "projection.compiler_hash"),
      policy_hash: str(p.policy_hash, HASH, "invalid-ledger", "projection.policy_hash"),
      expanded_hash: str(p.expanded_hash, HASH, "invalid-ledger", "projection.expanded_hash"),
    };
    const nodes = new Map<string, { gate_role: unknown; within_gate: unknown }>();
    for (const n of p.nodes as unknown[]) if (isObj(n) && typeof n.id === "string") nodes.set(n.id, { gate_role: n.gate_role, within_gate: n.within_gate });
    const subject = readSubject(inp.subject, "invalid-ledger");
    if (subject.source_id !== workflow.source_id) bad("foreign-source", `subject source ${subject.source_id} is not workflow source ${workflow.source_id}`);
    const specs = arr(inp.obligations, LIMITS.obligations, "invalid-ledger", "obligations").map((o, i) => readSpec(o, "invalid-ledger", `obligations[${i}]`));
    if (new Set(specs.map((s) => s.id)).size !== specs.length) bad("invalid-ledger", "an obligation id is declared twice");
    const names = new Set(subject.artifacts.map((a) => a.name));
    const obligations: ObligationState[] = specs.map((s) => {
      const n = nodes.get(s.node_id);
      if (!n) bad("invalid-ledger", `obligation ${s.id} names unknown node ${s.node_id}`);
      if (QA_KINDS.includes(s.kind) && n!.gate_role !== "qa" && n!.within_gate !== "qa") bad("assurance-outside-gate", `${s.kind} obligation ${s.id} must execute inside the QA gate scope; ${s.node_id} is outside it`);
      for (const name of s.scope) if (!names.has(name)) bad("invalid-ledger", `obligation ${s.id} scopes unknown artifact ${name}`);
      return { id: s.id, kind: s.kind, node_id: s.node_id, required: s.required, authority: s.authority, scope: s.scope, max_rounds: s.max_rounds, status: "pending", round: 0, accepted: null, invalidated_by: null };
    });
    return seal({ schema_version: ASSURANCE_LEDGER_SCHEMA_VERSION, workflow, subject, subject_hash: subjectHash(workflow, subject), obligations, invocations: [], spent_evidence: [] });
  });
}

/** Start the next round of one obligation under the CURRENT subject; supersedes any open round. */
export function beginInvocation(ledger: AssuranceLedger, req: { obligation_id: string; invocation_id: string }): AssuranceResult<AssuranceLedger> {
  return run(() => {
    const body: Body = clone(ledger);
    const errs: AssuranceViolation[] = [];
    const ob = body.obligations.find((o) => o.id === req.obligation_id);
    if (!ob) bad("unknown-obligation", `no obligation ${String(req.obligation_id)}`);
    if (typeof req.invocation_id !== "string" || !ID.test(req.invocation_id)) bad("invalid-ledger", "invocation id is not an id");
    if (body.invocations.some((i) => i.id === req.invocation_id)) errs.push({ rule: "duplicate-invocation", detail: `invocation ${req.invocation_id} already exists` });
    if (ob!.round + 1 > ob!.max_rounds) errs.push({ rule: "round-cap", detail: `obligation ${ob!.id} has used ${ob!.round} of ${ob!.max_rounds} rounds; exhaustion blocks` });
    if (body.invocations.length >= LIMITS.invocations) errs.push({ rule: "round-cap", detail: `ledger holds ${LIMITS.invocations} invocations` });
    if (errs.length) throw new Bad(errs[0].rule, errs[0].detail, errs);
    for (const i of body.invocations) if (i.obligation_id === ob!.id && i.state === "active") i.state = "superseded";
    ob!.round += 1;
    ob!.status = "pending";
    ob!.accepted = null;
    ob!.invalidated_by = null;
    body.invocations.push({ id: req.invocation_id, obligation_id: ob!.id, node_id: ob!.node_id, round: ob!.round, subject_hash: body.subject_hash, scope_hash: scopeHash(body.workflow, body.subject, ob!), state: "active" });
    return seal(body);
  });
}

/** Record one verdict. Every binding field is checked; all failures are reported. */
export function recordVerdict(ledger: AssuranceLedger, rawReceipt: VerdictReceipt): AssuranceResult<AssuranceLedger> {
  const res = run(() => {
    const r = exact(snapshot(rawReceipt, "invalid-ledger", "receipt"), ["source_id", "obligation_id", "invocation_id", "round", "authority", "subject_hash", "verdict", "evidence"], "invalid-ledger", "receipt");
    const evidence = readEvidence(r.evidence, "invalid-ledger", "receipt.evidence");
    const verdict = oneOf(r.verdict, ["accept", "reject"] as const, "invalid-ledger", "receipt.verdict");
    const body: Body = clone(ledger);
    const errs: AssuranceViolation[] = [];
    const push = (rule: AssuranceRule, detail: string) => errs.push({ rule, detail });
    const src = body.subject.source_id;
    if (r.source_id !== src) push("foreign-source", `receipt source ${String(r.source_id)} is not ${src}`);
    const ob = body.obligations.find((o) => o.id === r.obligation_id);
    const inv = body.invocations.find((i) => i.id === r.invocation_id);
    if (!ob) push("unknown-obligation", `no obligation ${String(r.obligation_id)}`);
    if (!inv) push("unknown-invocation", `no invocation ${String(r.invocation_id)}`);
    if (ob && inv) {
      if (inv.obligation_id !== ob.id) push("invocation-mismatch", `invocation ${inv.id} belongs to ${inv.obligation_id}, not ${ob.id}`);
      if (inv.state !== "active") push("stale-invocation", `invocation ${inv.id} is ${inv.state}; start a new round under the current subject`);
      if (r.round !== inv.round) push("round-mismatch", `receipt round ${String(r.round)} is not invocation round ${inv.round}`);
      if (r.subject_hash !== body.subject_hash || inv.subject_hash !== body.subject_hash) push("subject-mismatch", `receipt subject ${String(r.subject_hash)} is not the current subject ${body.subject_hash}`);
      if (r.authority !== ob.authority) push("authority-mismatch", `receipt authority ${String(r.authority)} is not ${ob.authority}`);
    }
    if (verdict === "accept") {
      if (!evidence.length || !evidence.every((e) => e.availability === "available" && e.source_id === src)) push("missing-evidence", `an accept needs available evidence owned by ${src}`);
      if (inv) {
        for (const e of evidence) {
          if (body.spent_evidence.some((s) => s.sha256 === e.sha256 && s.scope_hash !== inv.scope_hash)) push("evidence-reused", `evidence ${e.sha256} already backed a verdict for a different subject scope`);
        }
      }
    }
    if (errs.length) throw new Bad(errs[0].rule, errs[0].detail, errs);
    inv!.state = verdict === "accept" ? "accepted" : "rejected";
    ob!.status = verdict === "accept" ? "accepted" : "rejected";
    ob!.accepted = verdict === "accept" ? { invocation_id: inv!.id, round: inv!.round, authority: ob!.authority, subject_hash: inv!.subject_hash, scope_hash: inv!.scope_hash, evidence } : null;
    if (verdict === "accept") {
      for (const e of evidence) if (!body.spent_evidence.some((s) => s.sha256 === e.sha256 && s.scope_hash === inv!.scope_hash)) body.spent_evidence.push({ sha256: e.sha256, scope_hash: inv!.scope_hash });
      if (body.spent_evidence.length > LIMITS.spent) bad("invalid-ledger", `ledger spent-evidence index exceeds ${LIMITS.spent}`);
    }
    return seal(body);
  });
  return res;
}

function invalidate(body: Body, next: SubjectManifest, cause: InvalidationCause | "declared"): void {
  for (const i of body.invocations) if (i.state === "active") i.state = "superseded";
  for (const ob of body.obligations) {
    if (cause === "declared") {
      const latest = body.invocations.filter((i) => i.obligation_id === ob.id).sort((a, b) => b.round - a.round)[0];
      // Unchanged scope keeps its verdict: the declared input subset still matches exactly.
      if (!latest || latest.scope_hash === scopeHash(body.workflow, next, ob)) continue;
      ob.invalidated_by = "mutation";
    } else {
      ob.invalidated_by = cause;
    }
    ob.status = "invalidated";
    ob.accepted = null;
  }
  body.subject = next;
  body.subject_hash = subjectHash(body.workflow, next);
}

/**
 * Record a mutation of the subject (repair or any other change). `changed`
 * lists the artifact names the mutation touched, or "unknown". A list that
 * misses a real change is treated as unknown.
 */
export function applyMutation(ledger: AssuranceLedger, m: { subject: SubjectManifest; changed: string[] | "unknown" }): AssuranceResult<AssuranceLedger> {
  return run(() => {
    const next = readSubject(snapshot(m.subject, "invalid-ledger", "subject"), "invalid-ledger");
    if (next.source_id !== ledger.subject.source_id) bad("foreign-source", `mutation source ${next.source_id} is not ${ledger.subject.source_id}`);
    const body: Body = clone(ledger);
    if (subjectHash(body.workflow, next) === body.subject_hash) return ledger;
    const before = new Map(body.subject.artifacts.map((a) => [a.name, a.sha256]));
    const after = new Map(next.artifacts.map((a) => [a.name, a.sha256]));
    const moved = [...new Set([...before.keys(), ...after.keys()])].filter((n) => before.get(n) !== after.get(n));
    const changed = m.changed === "unknown" ? null : arr(snapshot(m.changed, "invalid-ledger", "changed"), LIMITS.artifacts, "invalid-ledger", "changed").map((n, i) => str(n, ID, "invalid-ledger", `changed[${i}]`));
    const known = changed !== null && moved.every((n) => changed.includes(n));
    invalidate(body, next, known ? "declared" : "unknown-mutation");
    return seal(body);
  });
}

/** Acceptance boundary: re-check every required obligation against the subject as it is NOW. */
export function checkAcceptance(ledger: AssuranceLedger, current: SubjectManifest): AcceptanceResult {
  const blockers: Array<{ obligation_id: string; reason: string }> = [];
  const accepted: string[] = [];
  let subject: SubjectManifest | null = null;
  try {
    subject = readSubject(snapshot(current, "invalid-ledger", "subject"), "invalid-ledger");
  } catch (err) {
    if (!(err instanceof Bad)) throw err;
  }
  const required = ledger.obligations.filter((o) => o.required);
  if (!subject || subject.source_id !== ledger.subject.source_id || subjectHash(ledger.workflow, subject) !== ledger.subject_hash) {
    return { ok: false, blockers: required.map((o) => ({ obligation_id: o.id, reason: "subject-changed" })) };
  }
  for (const ob of ledger.obligations) {
    const b = ob.accepted;
    const inv = b ? ledger.invocations.find((i) => i.id === b.invocation_id) : undefined;
    let reason: string | null = null;
    if (ob.status !== "accepted" || !b) reason = `not-accepted:${ob.status}`;
    else if (!inv || inv.state !== "accepted" || inv.round !== b.round || b.round !== ob.round) reason = "round-mismatch";
    else if (b.authority !== ob.authority) reason = "authority-mismatch";
    else if (b.scope_hash !== scopeHash(ledger.workflow, subject, ob) || inv.scope_hash !== b.scope_hash) reason = "subject-mismatch";
    else if (!b.evidence.length || !b.evidence.every((e) => e.availability === "available" && e.source_id === subject!.source_id)) reason = "missing-evidence";
    if (reason === null) accepted.push(ob.id);
    else if (ob.required) blockers.push({ obligation_id: ob.id, reason });
  }
  return blockers.length ? { ok: false, blockers } : { ok: true, accepted: accepted.sort() };
}

export function serializeLedger(ledger: AssuranceLedger): string {
  return canonical(ledger);
}

/** Re-validate every invariant of a ledger body; throws `ledger-corrupt`. */
function verifyBody(body: Body): void {
  const fail = (why: string): never => bad("ledger-corrupt", why);
  if (body.subject_hash !== subjectHash(body.workflow, body.subject)) fail("subject_hash does not match the subject");
  if (body.subject.source_id !== body.workflow.source_id) fail("subject source differs from workflow source");
  const obs = new Map(body.obligations.map((o) => [o.id, o]));
  if (obs.size !== body.obligations.length) fail("duplicate obligation");
  const invs = new Map(body.invocations.map((i) => [i.id, i]));
  if (invs.size !== body.invocations.length) fail("duplicate invocation");
  const names = new Set(body.subject.artifacts.map((a) => a.name));
  for (const ob of body.obligations) {
    for (const n of ob.scope) if (!names.has(n) && ob.status === "accepted") fail(`accepted ${ob.id} scopes an artifact the subject lacks`);
    const mine = body.invocations.filter((i) => i.obligation_id === ob.id);
    if (mine.filter((i) => i.state === "active").length > 1) fail(`${ob.id} has two open rounds`);
    const rounds = mine.map((i) => i.round).sort((a, b) => a - b);
    if (rounds.some((r, i) => r !== i + 1) || ob.round !== rounds.length || ob.round > ob.max_rounds) fail(`${ob.id} round history is inconsistent`);
    for (const i of mine) if (i.node_id !== ob.node_id) fail(`invocation ${i.id} node differs from ${ob.id}`);
    if ((ob.status === "invalidated") !== (ob.invalidated_by !== null)) fail(`${ob.id} invalidation cause is inconsistent`);
    if ((ob.status === "accepted") !== (ob.accepted !== null)) fail(`${ob.id} binding is inconsistent with its status`);
    const b = ob.accepted;
    if (b) {
      const inv = invs.get(b.invocation_id);
      if (!inv || inv.obligation_id !== ob.id || inv.state !== "accepted" || inv.round !== b.round || b.round !== ob.round) fail(`${ob.id} binding does not match an accepted invocation at its round`);
      if (b.authority !== ob.authority || b.subject_hash !== inv!.subject_hash || b.scope_hash !== inv!.scope_hash) fail(`${ob.id} binding fields differ from its invocation`);
      if (!b.evidence.length || !b.evidence.every((e) => e.availability === "available" && e.source_id === body.subject.source_id)) fail(`${ob.id} binding lacks available evidence`);
      for (const e of b.evidence) if (!body.spent_evidence.some((s) => s.sha256 === e.sha256 && s.scope_hash === b.scope_hash)) fail(`${ob.id} evidence is not indexed`);
    }
  }
  for (const i of body.invocations) {
    if (!obs.has(i.obligation_id)) fail(`invocation ${i.id} names unknown obligation`);
    if (i.state === "active" && i.subject_hash !== body.subject_hash) fail(`open invocation ${i.id} is not on the current subject`);
  }
}

function readLedger(v: unknown): Body & { ledger_hash: string } {
  const R: AssuranceRule = "ledger-corrupt";
  const o = exact(v, ["schema_version", "workflow", "subject", "subject_hash", "obligations", "invocations", "spent_evidence", "ledger_hash"], R, "ledger");
  if (o.schema_version !== ASSURANCE_LEDGER_SCHEMA_VERSION) bad(R, `schema_version is not ${ASSURANCE_LEDGER_SCHEMA_VERSION}`);
  const w = exact(o.workflow, ["source_id", "id", "definition_hash", "compiler_hash", "policy_hash", "expanded_hash"], R, "workflow");
  const workflow: WorkflowBasis = {
    source_id: str(w.source_id, ID, R, "workflow.source_id"),
    id: str(w.id, ID, R, "workflow.id"),
    definition_hash: str(w.definition_hash, HASH, R, "workflow.definition_hash"),
    compiler_hash: str(w.compiler_hash, HASH, R, "workflow.compiler_hash"),
    policy_hash: str(w.policy_hash, HASH, R, "workflow.policy_hash"),
    expanded_hash: str(w.expanded_hash, HASH, R, "workflow.expanded_hash"),
  };
  const obligations = arr(o.obligations, LIMITS.obligations, R, "obligations").map((x, i): ObligationState => {
    const s = readSpec(x, R, `obligations[${i}]`, ["status", "round", "accepted", "invalidated_by"]);
    let accepted: Binding | null = null;
    if (s.accepted !== null) {
      const b = exact(s.accepted, ["invocation_id", "round", "authority", "subject_hash", "scope_hash", "evidence"], R, `obligations[${i}].accepted`);
      accepted = {
        invocation_id: str(b.invocation_id, ID, R, "binding.invocation_id"),
        round: int(b.round, 1, LIMITS.maxRounds, R, "binding.round"),
        authority: str(b.authority, ID, R, "binding.authority"),
        subject_hash: str(b.subject_hash, HASH, R, "binding.subject_hash"),
        scope_hash: str(b.scope_hash, HASH, R, "binding.scope_hash"),
        evidence: readEvidence(b.evidence, R, "binding.evidence"),
      };
    }
    return {
      id: s.id, kind: s.kind, node_id: s.node_id, required: s.required, authority: s.authority, scope: s.scope, max_rounds: s.max_rounds,
      status: oneOf(s.status, ["pending", "accepted", "rejected", "invalidated"] as const, R, "status"),
      round: int(s.round, 0, LIMITS.maxRounds, R, "round"),
      accepted,
      invalidated_by: s.invalidated_by === null ? null : oneOf(s.invalidated_by, ["mutation", "unknown-mutation", "restart-subject-mismatch"] as const, R, "invalidated_by"),
    };
  });
  const invocations = arr(o.invocations, LIMITS.invocations, R, "invocations").map((x, i): InvocationState => {
    const v2 = exact(x, ["id", "obligation_id", "node_id", "round", "subject_hash", "scope_hash", "state"], R, `invocations[${i}]`);
    return {
      id: str(v2.id, ID, R, "invocation.id"),
      obligation_id: str(v2.obligation_id, ID, R, "invocation.obligation_id"),
      node_id: str(v2.node_id, ID, R, "invocation.node_id"),
      round: int(v2.round, 1, LIMITS.maxRounds, R, "invocation.round"),
      subject_hash: str(v2.subject_hash, HASH, R, "invocation.subject_hash"),
      scope_hash: str(v2.scope_hash, HASH, R, "invocation.scope_hash"),
      state: oneOf(v2.state, ["active", "accepted", "rejected", "superseded"] as const, R, "invocation.state"),
    };
  });
  const spent_evidence = arr(o.spent_evidence, LIMITS.spent, R, "spent_evidence").map((x, i) => {
    const s = exact(x, ["sha256", "scope_hash"], R, `spent_evidence[${i}]`);
    return { sha256: str(s.sha256, HASH, R, "spent.sha256"), scope_hash: str(s.scope_hash, HASH, R, "spent.scope_hash") };
  });
  return {
    schema_version: ASSURANCE_LEDGER_SCHEMA_VERSION,
    workflow,
    subject: readSubject(o.subject, R),
    subject_hash: str(o.subject_hash, HASH, R, "subject_hash"),
    obligations,
    invocations,
    spent_evidence,
    ledger_hash: str(o.ledger_hash, HASH, R, "ledger_hash"),
  };
}

/**
 * Restart: reload a serialized ledger against the subject as it is now. Bytes
 * are re-validated (shape, hash, invariants). A subject that moved since the
 * last write is an unknown mutation: every obligation is invalidated.
 */
export function restoreLedger(text: string, current: SubjectManifest): AssuranceResult<AssuranceLedger> {
  return run(() => {
    if (typeof text !== "string" || text.length > LIMITS.bytes) bad("ledger-corrupt", `ledger bytes exceed ${LIMITS.bytes}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return bad("ledger-corrupt", "ledger is not JSON");
    }
    const full = readLedger(snapshot(parsed, "ledger-corrupt", "ledger"));
    const { ledger_hash, ...body } = full;
    if (assuranceLedgerHash(body) !== ledger_hash) bad("ledger-corrupt", "ledger_hash does not match the ledger body");
    verifyBody(body);
    const now = readSubject(snapshot(current, "invalid-ledger", "subject"), "invalid-ledger");
    if (now.source_id !== body.subject.source_id) bad("foreign-source", `current source ${now.source_id} is not ledger source ${body.subject.source_id}`);
    const working: Body = clone(body);
    if (subjectHash(working.workflow, now) !== working.subject_hash) invalidate(working, now, "restart-subject-mismatch");
    return seal(working);
  });
}

export interface C8Obligation {
  id: string; kind: AssuranceKind; node_id: string; subject_hash: string; invocation_id: string; round: number;
  status: ObligationStatus; authority: string; evidence: EvidenceRef[];
}
export interface C8Invocation {
  id: string; node_id: string; round: number; max_rounds: number; unresolved_questions: string[];
  state: "active" | "blocked" | "accepted" | "cancelled"; definition_hash: string; subject_hash: string;
}

/** Project the ledger onto C8 v2 `obligations` / `invocations` (latest round per obligation that has one). */
export function toProjectionAssurance(ledger: AssuranceLedger): AssuranceResult<{ obligations: C8Obligation[]; invocations: C8Invocation[] }> {
  return run(() => {
    const obligations: C8Obligation[] = [];
    const invocations: C8Invocation[] = [];
    const STATE = { active: "active", accepted: "accepted", rejected: "blocked", superseded: "cancelled" } as const;
    for (const ob of ledger.obligations) {
      const inv = ledger.invocations.filter((i) => i.obligation_id === ob.id).sort((a, b) => b.round - a.round)[0];
      if (!inv) continue;
      obligations.push({ id: ob.id, kind: ob.kind, node_id: ob.node_id, subject_hash: inv.subject_hash, invocation_id: inv.id, round: inv.round, status: ob.status, authority: ob.authority, evidence: ob.accepted ? clone(ob.accepted.evidence) : [] });
      invocations.push({ id: inv.id, node_id: inv.node_id, round: inv.round, max_rounds: ob.max_rounds, unresolved_questions: [], state: STATE[inv.state], definition_hash: ledger.workflow.definition_hash, subject_hash: inv.subject_hash });
    }
    if (invocations.length > 100) bad("invalid-ledger", "C8 v2 carries at most 100 invocations");
    return { obligations, invocations };
  });
}

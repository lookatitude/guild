/**
 * phase-composition.ts — W03: compose a phase's workflow and its team together.
 *
 * One composition binds four inputs: a W01 component composition (compiled into
 * a C8 WorkflowProjection v2 and checked by the W02 protected-path verifier), the
 * phase's `guild.team_proposal.v2`, the exact plan bytes and the project QA
 * policy. The team supplies the compile policy (role → capabilities), so a
 * workflow role no participant serves is refused rather than narrowed.
 *
 * The composition explains, per role, which nodes the role is obliged to run at
 * which component version and hash; which QA nodes serve each required
 * assurance kind; and whether every review and gate node is independent of the
 * authoring roles. It authorises nothing: dispatch still needs the existing
 * team approval (`dispatchGate`) over the exact proposal, and the dispatch gate
 * recomposes from sources, so a changed plan, team, component set or QA policy
 * requires a new composition and a new approval.
 *
 * Roles never add operations: nodes come only from components, and a team
 * capability named after a gate, release, approval or privileged authority is
 * refused. The QA policy names assurance kinds only; it cannot add gates.
 *
 * Trust: cooperative local. Proposal, QA policy and plan reference are untrusted
 * data; they are detached into plain values (no accessors, prototypes or
 * symbols) before any check reads them.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { checkContained, isRefused, loadYamlApi } from "../kernel";
import {
  dispatchGate,
  proposalHashOf,
  validateProposal,
  type DispatchGateVerdict,
  type TeamDecisionV1,
  type TeamProposalV2,
} from "../teams";
import {
  compileWorkflow,
  type CompileManifest,
  type CompileRule,
  type ComponentEffect,
  type ComponentGateRole,
  type ComponentRef,
  type WorkflowComponentRegistry,
  type WorkflowProjectionV2,
} from "./workflow-component-compiler";
import type { WorkflowClass } from "./workflow-graph-overlay";

export const PHASE_COMPOSITION_SCHEMA_VERSION = "guild.phase_composition.v1" as const;
export const QA_POLICY_SCHEMA_VERSION = "guild.qa_policy.v1" as const;

/** C8 obligation kinds a QA policy may require. */
export const QA_POLICY_KINDS = Object.freeze(["security", "adversarial_security", "ui", "ux", "quality", "project_specific"] as const);
export type QaPolicyKind = (typeof QA_POLICY_KINDS)[number];

/** A team capability token that names one of these is a claim of authority, not a capability. */
const RESERVED_CAPABILITY_TOKENS: ReadonlySet<string> = new Set([
  "d5", "qa", "ops", "d8", "gate", "release", "approve", "approval", "approved", "approver", "privileged", "bypass", "override",
]);

const PHASE = /^[a-z][a-z0-9-]{0,31}$/;
const SHA_HEX = /^[0-9a-f]{64}$/;
const MAX_INPUT_FILE_BYTES = 1024 * 1024;
const DETACH_LIMITS = { depth: 32, values: 100_000 };

export type PhaseCompositionRule =
  | CompileRule
  | "invalid-request"
  | "invalid-team"
  | "team-phase-mismatch"
  | "role-claims-authority"
  | "invalid-qa-policy"
  | "qa-obligation-unserved"
  | "review-not-independent"
  | "path-not-contained"
  | "invalid-input";

export interface PhaseCompositionViolation { rule: PhaseCompositionRule; detail: string }

export interface QaPolicy { schema_version: typeof QA_POLICY_SCHEMA_VERSION; required: QaPolicyKind[] }
export interface PlanRef { path: string; sha256: string }

export interface PhaseCompositionInput {
  phase: string;
  class: WorkflowClass;
  workflow: { source_id: string; id: string };
  root: ComponentRef;
  /** Untrusted `guild.team_proposal.v2`. */
  proposal: unknown;
  plan: PlanRef;
  /** Untrusted `guild.qa_policy.v1`. */
  qa_policy: unknown;
}

export interface RoleNodeObligation {
  node_id: string;
  component: string;
  component_hash: string;
  effect: ComponentEffect;
  gate_role: ComponentGateRole | null;
  within_gate: ComponentGateRole | null;
  capabilities: string[];
  required: boolean;
}

export interface RoleObligation {
  role: string;
  participants: string[];
  granted: string[];
  nodes: RoleNodeObligation[];
}

export interface ReviewIndependence {
  node_id: string;
  effect: ComponentEffect;
  role: string;
  reviewers: string[];
  authors: string[];
  independent: boolean;
}

export interface PhaseCompositionV1 {
  schema_version: typeof PHASE_COMPOSITION_SCHEMA_VERSION;
  phase: string;
  class: WorkflowClass;
  workflow: {
    source_id: string;
    id: string;
    root: string;
    definition_hash: string;
    compiler_hash: string;
    policy_hash: string;
    expanded_hash: string;
    components: Array<{ id: string; version: string; sha256: string }>;
    entry: string;
    protected_gates: string[];
    loops: Array<{ id: string; max_rounds: number }>;
  };
  team: { run_id: string; proposal_version: number; proposal_hash: string; participants: string[] };
  plan: PlanRef;
  qa_policy_hash: string;
  qa_obligations: Array<{ kind: QaPolicyKind; node_ids: string[] }>;
  role_obligations: RoleObligation[];
  unbound_participants: string[];
  review_independence: ReviewIndependence[];
  approval: { required: true; via: "guild.team_decision.v1"; proposal_hash: string; participants: string[] };
  composition_hash: string;
}

export type PhaseCompositionResult =
  | { ok: true; composition: PhaseCompositionV1; projection: WorkflowProjectionV2; manifest: CompileManifest }
  | { ok: false; violations: PhaseCompositionViolation[] };

// ---------------------------------------------------------------- helpers

class Abort extends Error {
  constructor(readonly violation: PhaseCompositionViolation) {
    super(violation.detail);
  }
}
function fail(rule: PhaseCompositionRule, detail: string): never {
  throw new Abort({ rule, detail });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
function sha256Of(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Copy untrusted data into plain JSON values. Refuses accessors, symbols,
 * non-plain prototypes, forbidden keys, non-finite numbers, cycles and
 * oversized graphs, so every later read sees one stable value.
 */
function detach(value: unknown, label: string, rule: PhaseCompositionRule): unknown {
  let count = 0;
  const stack = new Set<object>();
  const walk = (v: unknown, at: string, depth: number): unknown => {
    if (++count > DETACH_LIMITS.values) fail(rule, `${label} exceeds ${DETACH_LIMITS.values} values`);
    if (depth > DETACH_LIMITS.depth) fail(rule, `${label} nests deeper than ${DETACH_LIMITS.depth}`);
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail(rule, `${at} is not a finite number`);
      return v;
    }
    if (typeof v !== "object") fail(rule, `${at} is a ${typeof v}, not data`);
    if (stack.has(v as object)) fail(rule, `${at} is cyclic`);
    const proto = Object.getPrototypeOf(v);
    const isArr = Array.isArray(v);
    if (isArr ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail(rule, `${at} is not a plain value`);
    stack.add(v as object);
    const keys = Reflect.ownKeys(v as object);
    const out: Record<string, unknown> | unknown[] = isArr ? [] : {};
    for (const k of keys) {
      if (typeof k === "symbol") fail(rule, `${at} has a symbol key`);
      if (isArr && k === "length") continue;
      const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (!("value" in d)) fail(rule, `${at}.${k} is an accessor`);
      if (isArr && !/^(0|[1-9][0-9]*)$/.test(k)) fail(rule, `${at} has a non-index key '${k}'`);
      if (!isArr && FORBIDDEN_KEYS.has(k)) fail(rule, `${at} has a forbidden key '${k}'`);
      const child = walk(d.value, `${at}.${k}`, depth + 1);
      if (isArr) (out as unknown[])[Number(k)] = child;
      else (out as Record<string, unknown>)[k] = child;
    }
    stack.delete(v as object);
    if (isArr && (out as unknown[]).length !== (v as unknown[]).length) fail(rule, `${at} is a sparse array`);
    return out;
  };
  return walk(value, label, 0);
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function exactKeys(v: Record<string, unknown>, keys: readonly string[]): string | null {
  const extra = Object.keys(v).filter((k) => !keys.includes(k));
  if (extra.length) return `unknown key(s) ${extra.sort().join(", ")}`;
  const missing = keys.filter((k) => !(k in v));
  return missing.length ? `missing key(s) ${missing.join(", ")}` : null;
}
const sortStr = (xs: Iterable<string>): string[] => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

function checkPlan(raw: unknown): PlanRef {
  if (!isPlain(raw) || exactKeys(raw, ["path", "sha256"]) !== null) fail("invalid-request", "plan must be exactly {path, sha256}");
  const p = raw.path;
  if (typeof p !== "string" || p.length === 0 || p.length > 4096 || p.includes("\0")) fail("invalid-request", "plan.path must be a non-empty path");
  if (typeof raw.sha256 !== "string" || !SHA_HEX.test(raw.sha256)) fail("invalid-request", "plan.sha256 must be 64 lowercase hex characters");
  return { path: p, sha256: raw.sha256 };
}

function checkQaPolicy(raw: unknown): QaPolicy {
  if (!isPlain(raw) || exactKeys(raw, ["schema_version", "required"]) !== null) {
    fail("invalid-qa-policy", `QA policy must be exactly {schema_version, required}; it names assurance kinds and cannot declare gates or nodes`);
  }
  if (raw.schema_version !== QA_POLICY_SCHEMA_VERSION) fail("invalid-qa-policy", `QA policy schema_version must be ${QA_POLICY_SCHEMA_VERSION}`);
  const req = raw.required;
  if (!Array.isArray(req) || req.length > QA_POLICY_KINDS.length) fail("invalid-qa-policy", "QA policy required must be a list of assurance kinds");
  const seen = new Set<string>();
  for (const k of req) {
    if (typeof k !== "string" || !(QA_POLICY_KINDS as readonly string[]).includes(k)) {
      fail("invalid-qa-policy", `'${String(k).slice(0, 64)}' is not an assurance kind (${QA_POLICY_KINDS.join(", ")})`);
    }
    if (seen.has(k)) fail("invalid-qa-policy", `assurance kind '${k}' is listed twice`);
    seen.add(k);
  }
  return { schema_version: QA_POLICY_SCHEMA_VERSION, required: sortStr(seen) as QaPolicyKind[] };
}

function checkProposal(raw: unknown, phase: string): TeamProposalV2 {
  const verdict = validateProposal(raw);
  if (!verdict.valid) fail("invalid-team", `team proposal is not a valid guild.team_proposal.v2: ${verdict.reasons.slice(0, 5).join("; ")}`);
  const p = raw as TeamProposalV2;
  if (p.phase !== phase) fail("team-phase-mismatch", `team was proposed for phase '${String(p.phase).slice(0, 64)}', not '${phase}'`);
  for (const part of p.participants) {
    for (const cap of part.capability_scope ?? []) {
      const tokens = cap.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const claimed = tokens.find((t) => RESERVED_CAPABILITY_TOKENS.has(t));
      if (claimed) {
        fail("role-claims-authority", `participant ${part.participant_id} (role ${part.role_ref}) lists capability '${cap}'; '${claimed}' is gate, release or approval authority, which no role grant carries`);
      }
    }
  }
  return p;
}

// ---------------------------------------------------------------- compose

function composeInner(registry: WorkflowComponentRegistry, rawInput: PhaseCompositionInput): PhaseCompositionResult {
  if (!isPlain(rawInput)) fail("invalid-request", "input is not a mapping");
  const proposal = detach((rawInput as { proposal?: unknown }).proposal, "proposal", "invalid-team");
  const qaRaw = detach((rawInput as { qa_policy?: unknown }).qa_policy, "qa_policy", "invalid-qa-policy");
  const rest = detach({ ...rawInput, proposal: null, qa_policy: null }, "input", "invalid-request") as Record<string, unknown>;
  const keyErr = exactKeys(rest, ["phase", "class", "workflow", "root", "proposal", "plan", "qa_policy"]);
  if (keyErr) fail("invalid-request", `input: ${keyErr}`);
  const phase = rest.phase;
  if (typeof phase !== "string" || !PHASE.test(phase)) fail("invalid-request", "phase must be a lowercase phase id");
  const plan = checkPlan(rest.plan);
  const qaPolicy = checkQaPolicy(qaRaw);
  const team = checkProposal(proposal, phase);

  // The team is the compile policy: role → union of its participants' capabilities.
  const roleCaps = new Map<string, Set<string>>();
  const roleMembers = new Map<string, string[]>();
  for (const part of team.participants) {
    const caps = roleCaps.get(part.role_ref) ?? new Set<string>();
    for (const c of part.capability_scope ?? []) caps.add(c);
    roleCaps.set(part.role_ref, caps);
    roleMembers.set(part.role_ref, [...(roleMembers.get(part.role_ref) ?? []), part.participant_id]);
  }
  const roles: Record<string, string[]> = {};
  for (const r of sortStr(roleCaps.keys())) Object.defineProperty(roles, r, { value: sortStr(roleCaps.get(r)!), enumerable: true, writable: true, configurable: true });

  const compiled = compileWorkflow(registry, {
    class: rest.class as WorkflowClass,
    workflow: rest.workflow as { source_id: string; id: string },
    root: rest.root as ComponentRef,
    policy: { roles },
  });
  if (!compiled.ok) return { ok: false, violations: compiled.violations };
  const { projection, manifest } = compiled;

  const pinOf = new Map(projection.components.map((c) => [`${c.id}\u0000${c.sha256}`, `${c.id}@${c.version}`]));
  const members = (role: string): string[] => sortStr(roleMembers.get(role) ?? []);

  const roleObligations: RoleObligation[] = [];
  const boundRoles = new Set<string>();
  for (const role of sortStr(roleCaps.keys())) {
    const nodes = projection.nodes.filter((n) => n.role === role);
    if (!nodes.length) continue;
    boundRoles.add(role);
    roleObligations.push({
      role,
      participants: members(role),
      granted: roles[role],
      nodes: nodes
        .map((n) => ({
          node_id: n.id,
          component: pinOf.get(`${n.component_id}\u0000${n.component_hash}`)!,
          component_hash: n.component_hash,
          effect: n.effect,
          gate_role: n.gate_role,
          within_gate: n.within_gate,
          capabilities: sortStr(n.capabilities),
          required: n.required,
        }))
        .sort((a, b) => (a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : 0)),
    });
  }
  const unbound = sortStr(team.participants.filter((p) => !boundRoles.has(p.role_ref)).map((p) => p.participant_id));

  const qaNodes = projection.nodes.filter((n) => n.within_gate === "qa");
  const qaObligations = qaPolicy.required.map((kind) => {
    const ids = sortStr(qaNodes.filter((n) => n.capabilities.includes(`assurance:${kind}`)).map((n) => n.id));
    if (!ids.length) fail("qa-obligation-unserved", `QA policy requires '${kind}' assurance, but no node inside the QA gate carries capability assurance:${kind}`);
    return { kind, node_ids: ids };
  });

  const writeRoles = new Set(projection.nodes.filter((n) => n.effect === "write").map((n) => n.role));
  const authors = sortStr(new Set([...writeRoles].flatMap(members)));
  const independence: ReviewIndependence[] = projection.nodes
    .filter((n) => n.effect === "review" || n.effect === "gate")
    .map((n) => {
      const reviewers = members(n.role);
      return { node_id: n.id, effect: n.effect, role: n.role, reviewers, authors, independent: reviewers.length > 0 && reviewers.every((r) => !authors.includes(r)) };
    })
    .sort((a, b) => (a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : 0));
  const dependent = independence.filter((r) => !r.independent);
  if (dependent.length) {
    fail("review-not-independent", `review/gate node(s) ${dependent.map((r) => `${r.node_id} (role ${r.role})`).join(", ")} are served only by participants who also author the work`);
  }

  const proposalHash = proposalHashOf(team);
  const participants = sortStr(team.participants.map((p) => p.participant_id));
  const body: Omit<PhaseCompositionV1, "composition_hash"> = {
    schema_version: PHASE_COMPOSITION_SCHEMA_VERSION,
    phase,
    class: projection.class,
    workflow: {
      source_id: projection.workflow.source_id,
      id: projection.workflow.id,
      root: `${manifest.root.id}@${manifest.root.version}`,
      definition_hash: projection.definition_hash,
      compiler_hash: projection.compiler_hash,
      policy_hash: projection.policy_hash,
      expanded_hash: projection.expanded_hash,
      components: [...projection.components].map((c) => ({ ...c })).sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : 1),
      entry: projection.entry,
      protected_gates: [...projection.protected_gates],
      loops: manifest.loops.map((l) => ({ id: l.id, max_rounds: l.max_rounds })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    },
    team: { run_id: team.run_id, proposal_version: team.proposal_version, proposal_hash: proposalHash, participants },
    plan,
    qa_policy_hash: sha256Of(qaPolicy),
    qa_obligations: qaObligations,
    role_obligations: roleObligations,
    unbound_participants: unbound,
    review_independence: independence,
    approval: { required: true, via: "guild.team_decision.v1", proposal_hash: proposalHash, participants },
  };
  const composition: PhaseCompositionV1 = { ...body, composition_hash: sha256Of(body) };
  return { ok: true, composition, projection, manifest };
}

/** Compose one phase: workflow and team resolved together. Pure and deterministic. */
export function composePhase(registry: WorkflowComponentRegistry, input: PhaseCompositionInput): PhaseCompositionResult {
  try {
    return composeInner(registry, input);
  } catch (err) {
    if (err instanceof Abort) return { ok: false, violations: [err.violation] };
    throw err;
  }
}

// ---------------------------------------------------------------- recompose / dispatch

const SECTIONS: ReadonlyArray<readonly [string, readonly (keyof PhaseCompositionV1)[]]> = [
  ["workflow", ["schema_version", "phase", "class", "workflow", "role_obligations", "review_independence"]],
  ["team", ["team", "approval", "unbound_participants"]],
  ["plan", ["plan"]],
  ["qa_policy", ["qa_policy_hash", "qa_obligations"]],
];

export interface CompositionCurrency {
  current: boolean;
  changed: string[];
  violations?: PhaseCompositionViolation[];
}

/**
 * Recompose from the current sources and compare with a stored composition.
 * Any changed section (workflow, team, plan, QA policy) means the scope moved
 * and the phase must be recomposed and re-approved.
 */
export function verifyPhaseComposition(registry: WorkflowComponentRegistry, input: PhaseCompositionInput, stored: unknown): CompositionCurrency {
  const fresh = composePhase(registry, input);
  if (!fresh.ok) return { current: false, changed: ["recompose-failed"], violations: fresh.violations };
  let prior: Record<string, unknown>;
  try {
    const d = detach(stored, "composition", "invalid-input");
    if (!isPlain(d)) return { current: false, changed: ["composition"] };
    prior = d;
  } catch (err) {
    if (err instanceof Abort) return { current: false, changed: ["composition"] };
    throw err;
  }
  const now = fresh.composition as unknown as Record<string, unknown>;
  const known = new Set<string>(SECTIONS.flatMap(([, ks]) => ks as readonly string[]).concat("composition_hash"));
  if (Object.keys(prior).some((k) => !known.has(k))) return { current: false, changed: ["composition"] };
  const changed = SECTIONS.filter(([, ks]) => ks.some((k) => canonicalJson(prior[k] ?? null) !== canonicalJson(now[k]))).map(([s]) => s);
  if (!changed.length && prior.composition_hash !== now.composition_hash) changed.push("composition");
  return { current: changed.length === 0, changed };
}

/**
 * Dispatch admission for a composed phase. The stored composition must equal a
 * fresh recomposition from the same sources, then the existing team approval
 * gate must accept a current approve decision over the exact proposal. Nothing
 * in the composition, its roles or its participants substitutes for that
 * decision.
 */
export function phaseDispatchGate(
  registry: WorkflowComponentRegistry,
  input: PhaseCompositionInput,
  stored: unknown,
  decision: TeamDecisionV1 | null | undefined,
): DispatchGateVerdict {
  const currency = verifyPhaseComposition(registry, input, stored);
  if (!currency.current) {
    const why = currency.violations?.length ? `: ${currency.violations.map((v) => v.rule).join(", ")}` : "";
    return { allowed: false, reason: `phase composition is not current (${currency.changed.join(", ")}${why}) — recompose and renew team approval` };
  }
  let proposal: unknown;
  let decided: unknown;
  try {
    proposal = detach(input.proposal, "proposal", "invalid-team");
    decided = decision == null ? decision : detach(decision, "decision", "invalid-input");
  } catch (err) {
    if (err instanceof Abort) return { allowed: false, reason: err.violation.detail };
    throw err;
  }
  return dispatchGate(proposal as object, decided as TeamDecisionV1 | null | undefined);
}

// ---------------------------------------------------------------- loading

export interface PhaseInputPaths {
  /** Project root; every path must resolve inside it. */
  root: string;
  proposal: string;
  plan: string;
  qa_policy: string;
}

export type LoadedPhaseInputs =
  | { ok: true; proposal: unknown; plan: PlanRef; qa_policy: unknown }
  | { ok: false; violations: PhaseCompositionViolation[] };

function readContained(root: string, rel: string, label: string): { bytes: Buffer; rel: string } {
  if (typeof rel !== "string" || rel.length === 0 || rel.includes("\0")) fail("invalid-input", `${label} path must be a non-empty string`);
  const c = checkContained(root, rel, { requireRegularFileLeaf: true });
  if (isRefused(c)) fail("path-not-contained", `${label} ${rel} is not a regular file inside ${root} [${c.code}]`);
  let st: fs.Stats;
  try {
    st = fs.lstatSync(c.realPath);
  } catch {
    fail("invalid-input", `${label} ${rel} does not exist`);
  }
  if (!st.isFile()) fail("path-not-contained", `${label} ${rel} is not a regular file`);
  if (st.size > MAX_INPUT_FILE_BYTES) fail("invalid-input", `${label} ${rel} exceeds ${MAX_INPUT_FILE_BYTES} bytes`);
  return { bytes: fs.readFileSync(c.realPath), rel: path.relative(c.realRoot, c.realPath).split(path.sep).join("/") };
}

function parseYaml(bytes: Buffer, label: string): unknown {
  try {
    return loadYamlApi().load(bytes.toString("utf8"));
  } catch (err) {
    fail("invalid-input", `${label} is not valid YAML: ${(err as Error).message.split("\n")[0]}`);
  }
}

/** Read the team proposal YAML, the plan bytes and the QA policy YAML from inside the project root. */
export function loadPhaseCompositionInputs(paths: PhaseInputPaths): LoadedPhaseInputs {
  try {
    const team = readContained(paths.root, paths.proposal, "team proposal");
    const plan = readContained(paths.root, paths.plan, "plan");
    const qa = readContained(paths.root, paths.qa_policy, "QA policy");
    return {
      ok: true,
      proposal: parseYaml(team.bytes, "team proposal"),
      plan: { path: plan.rel, sha256: crypto.createHash("sha256").update(plan.bytes).digest("hex") },
      qa_policy: parseYaml(qa.bytes, "QA policy"),
    };
  } catch (err) {
    if (err instanceof Abort) return { ok: false, violations: [err.violation] };
    throw err;
  }
}

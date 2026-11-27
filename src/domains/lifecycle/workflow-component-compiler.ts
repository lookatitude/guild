/**
 * workflow-component-compiler.ts — W01 component registry and deterministic
 * compiler. Reusable authored components (`guild.workflow_component.v1`) compile
 * into one C8 WorkflowProjection v2 document plus a compile manifest.
 *
 * The five flat class graphs (`src/surfaces/graphs/*.yaml`) remain the runtime
 * authority; nothing here loads, rewrites or replaces them. A compiled projection
 * is a definition artifact a later package may dispatch.
 *
 * First-release composition is closed: `task`, `sequence`, bounded `repeat` and
 * `call` by typed reference. Parallel joins are refused until cancellation and
 * evidence aggregation are specified. Conditions are a closed declarative set;
 * there is no expression language and nothing is evaluated.
 *
 * Fail-closed order: document shape, reference closure (recursion, depth, size
 * budget) BEFORE expansion, so a fan-out bomb is refused without materialising
 * it; then typed artifact/role/effect checks during expansion; then the C8 v2
 * gate rules on the expanded graph.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { loadYamlApi } from "../kernel";
import { createGuildStorage, type GuildStorage } from "../state";
import { WORKFLOW_CLASSES, type WorkflowClass } from "./workflow-graph-overlay";
import { PROTECTED_PATHS_VERSION, verifyProtectedPaths, type ProtectedPathRule } from "./workflow-protected-paths";

export const WORKFLOW_COMPONENT_SCHEMA_VERSION = "guild.workflow_component.v1" as const;
export const WORKFLOW_COMPILE_MANIFEST_SCHEMA_VERSION = "guild.workflow_compile_manifest.v1" as const;
export const WORKFLOW_PROJECTION_V2_SCHEMA_VERSION = "guild.stack.workflow-projection.v2" as const;
export const WORKFLOW_COMPILER_ID = "guild.workflow_compiler" as const;
export const WORKFLOW_COMPILER_VERSION = "1" as const;
/** Project components live at `storage.definition("components", "<file>.yaml")`. */
export const COMPONENT_DEFINITION_SEGMENT = "components" as const;

/** Caps. Node/edge/component/gate caps are the frozen C8 v2 maxItems. */
export const COMPILER_LIMITS = Object.freeze({
  maxNodes: 1000,
  maxEdges: 5000,
  maxComponents: 100,
  maxProtectedGates: 10,
  maxCallDepth: 8,
  maxStepNesting: 16,
  maxSteps: 100,
  maxRepeatRounds: 10,
  maxTotalRounds: 100,
  maxPorts: 50,
  maxCapabilities: 50,
  maxConditionTerms: 8,
  maxPathStates: 10000,
});

export const COMPONENT_EFFECTS = Object.freeze(["read", "write", "review", "gate", "privileged_operation", "release"] as const);
export type ComponentEffect = (typeof COMPONENT_EFFECTS)[number];
export const COMPONENT_GATE_ROLES = Object.freeze(["d5", "qa", "ops", "d8"] as const);
export type ComponentGateRole = (typeof COMPONENT_GATE_ROLES)[number];
export const COMPONENT_CONDITION_KINDS = Object.freeze(["outcome", "no_unresolved_questions", "obligations_accepted", "artifact_present", "all_of", "any_of"] as const);
export const COMPONENT_STEP_KINDS = Object.freeze(["task", "sequence", "repeat", "call"] as const);

/** Mirrors verify_contracts.py: class-required and release-required gate roles. */
const CLASS_REQUIRED_GATE_ROLES: Readonly<Record<string, readonly ComponentGateRole[]>> = Object.freeze({ product: ["d5", "qa", "d8"] });
const RELEASE_REQUIRED_GATE_ROLES: readonly ComponentGateRole[] = ["d5", "qa", "d8"];
const RELEASE_CLASS_GATE_ROLES: Readonly<Record<string, readonly ComponentGateRole[]>> = Object.freeze({ ops: ["ops"] });

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
// No '.': it is the namespace separator, so a step id cannot forge a path.
const STEP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PORT_TYPE = /^[a-z][a-z0-9_.:-]{0,127}$/;

export interface ComponentRef { id: string; version: string }
export interface ComponentPort { name: string; type: string }

export type ComponentCondition =
  | { kind: "outcome"; equals: string }
  | { kind: "no_unresolved_questions" }
  | { kind: "obligations_accepted" }
  | { kind: "artifact_present"; name: string }
  | { kind: "all_of" | "any_of"; conditions: ComponentCondition[] };

export interface TaskStep {
  kind: "task";
  id: string;
  effect: ComponentEffect;
  role: string;
  capabilities: string[];
  inputs: ComponentPort[];
  outputs: ComponentPort[];
  required?: boolean;
  gate_role?: ComponentGateRole | null;
  within_gate?: ComponentGateRole | null;
}
export interface SequenceStep { kind: "sequence"; id: string; steps: ComponentStep[] }
export interface RepeatStep { kind: "repeat"; id: string; max_rounds: number; until: ComponentCondition; body: ComponentStep }
export interface CallStep { kind: "call"; id: string; component: ComponentRef }
export type ComponentStep = TaskStep | SequenceStep | RepeatStep | CallStep;

export interface ComponentDocument {
  schema_version: typeof WORKFLOW_COMPONENT_SCHEMA_VERSION;
  id: string;
  version: string;
  effects: ComponentEffect[];
  inputs: ComponentPort[];
  outputs: ComponentPort[];
  body: ComponentStep;
}

export type CompileRule =
  | "invalid-component"
  | "duplicate-component"
  | "duplicate-step-id"
  | "unknown-step-kind"
  | "parallel-join-unsupported"
  | "unknown-component"
  | "recursive-composition"
  | "depth-exceeded"
  | "unbounded-repeat"
  | "unbounded-expansion"
  | "bad-condition"
  | "incompatible-artifact"
  | "unsatisfied-input"
  | "unsatisfied-output"
  | "incompatible-role"
  | "undeclared-effect"
  | "namespace-overflow"
  | "unknown-class"
  | "invalid-request"
  | "class-gate-missing"
  | "gate-not-protected"
  | "invalid-gate-scope"
  | ProtectedPathRule;

export interface CompileViolation { rule: CompileRule; detail: string }

export interface CompilePolicy {
  /** Role → capabilities the phase team grants that role. */
  roles: Record<string, string[]>;
}

export interface CompileRequest {
  class: WorkflowClass;
  workflow: { source_id: string; id: string };
  root: ComponentRef;
  policy: CompilePolicy;
}

export interface ProjectionNode {
  id: string;
  component_id: string;
  component_hash: string;
  effect: ComponentEffect;
  gate_role: ComponentGateRole | null;
  within_gate: ComponentGateRole | null;
  role: string;
  capabilities: string[];
  inputs: ComponentPort[];
  outputs: ComponentPort[];
  required: boolean;
}
export interface ProjectionEdge { from: string; to: string; on: string }
export interface ComponentPin { id: string; version: string; sha256: string }

/** C8 WorkflowProjection v2 (frozen A02). Obligations/invocations are runtime overlay: empty at compile. */
export interface WorkflowProjectionV2 {
  schema_version: typeof WORKFLOW_PROJECTION_V2_SCHEMA_VERSION;
  workflow: { source_id: string; kind: "workflow"; id: string; revision: string };
  class: WorkflowClass;
  definition_hash: string;
  compiler_hash: string;
  policy_hash: string;
  expanded_hash: string;
  components: ComponentPin[];
  nodes: ProjectionNode[];
  edges: ProjectionEdge[];
  entry: string;
  protected_gates: string[];
  obligations: never[];
  invocations: never[];
}

export interface NamespaceEntry { node_id: string; call_path: string[]; component_path: string[]; step_id: string }
export interface LoopEntry { id: string; entry: string; exit: string; max_rounds: number; until: ComponentCondition }

export interface CompileManifest {
  schema_version: typeof WORKFLOW_COMPILE_MANIFEST_SCHEMA_VERSION;
  compiler: { id: string; version: string; hash: string };
  class: WorkflowClass;
  workflow: { source_id: string; id: string };
  root: ComponentRef;
  definition_hash: string;
  policy_hash: string;
  expanded_hash: string;
  components: ComponentPin[];
  namespace_map: NamespaceEntry[];
  loops: LoopEntry[];
}

export type CompileResult =
  | { ok: true; projection: WorkflowProjectionV2; manifest: CompileManifest }
  | { ok: false; violations: CompileViolation[] };

// ---------------------------------------------------------------- hashing

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
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

const COMPILER_HASH = sha256Of({
  id: WORKFLOW_COMPILER_ID,
  version: WORKFLOW_COMPILER_VERSION,
  limits: COMPILER_LIMITS,
  step_kinds: COMPONENT_STEP_KINDS,
  condition_kinds: COMPONENT_CONDITION_KINDS,
  edge_outcomes: ["next", "repeat"],
  protected_paths: PROTECTED_PATHS_VERSION,
});

// ---------------------------------------------------------------- shape validation

function isPlain(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function exactKeys(v: Record<string, unknown>, required: string[], optional: string[] = []): string | null {
  for (const k of required) if (!(k in v)) return `missing '${k}'`;
  for (const k of Object.keys(v)) if (!required.includes(k) && !optional.includes(k)) return `unknown key '${k}'`;
  return null;
}

/** Format an untrusted value for a message without invoking its coercion hooks. */
const show = (v: unknown): string => (typeof v === "string" ? v.slice(0, 80) : typeof v === "number" || typeof v === "boolean" || v === null ? `${v}` : typeof v);

class Abort extends Error {
  constructor(readonly violation: CompileViolation) {
    super(violation.detail);
  }
}

function fail(rule: CompileRule, detail: string): never {
  throw new Abort({ rule, detail });
}

const DETACH_MAX_VALUES = 200_000;
const DETACH_MAX_DEPTH = 64;

/**
 * Copy caller input into plain JSON data BEFORE any check reads it. Only own
 * enumerable data properties of plain objects and dense plain arrays survive;
 * accessors, symbols, toJSON hooks and exotic prototypes are refused, so the
 * value validated is exactly the value compiled and hashed.
 */
function detach(value: unknown, rule: CompileRule, where: string): unknown {
  let budget = DETACH_MAX_VALUES;
  const walk = (v: unknown, depth: number, at: string): unknown => {
    if (--budget < 0) fail("unbounded-expansion", `${where} holds more than ${DETACH_MAX_VALUES} values`);
    if (depth > DETACH_MAX_DEPTH) fail(rule, `${at} nests deeper than ${DETACH_MAX_DEPTH}`);
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail(rule, `${at} holds a non-finite number`);
      return v;
    }
    if (typeof v !== "object") fail(rule, `${at} holds a ${typeof v}, which is not JSON data`);
    const isArr = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (isArr ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail(rule, `${at} is not a plain object or array`);
    const keys = Reflect.ownKeys(v as object);
    const len = isArr ? (v as unknown[]).length : 0;
    if (isArr && keys.length !== len + 1) fail(rule, `${at} is a sparse or decorated array`);
    const out: unknown = isArr ? new Array(len) : {};
    for (const k of keys) {
      if (typeof k === "symbol") fail(rule, `${at} carries a symbol key`);
      if (isArr && k === "length") continue;
      if (k === "toJSON" || k === "__proto__") fail(rule, `${at} carries a reserved key '${k}'`);
      const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (!("value" in d) || !d.enumerable) fail(rule, `${at}.${k} is an accessor or hidden property`);
      if (isArr && !/^(0|[1-9][0-9]*)$/.test(k)) fail(rule, `${at} is a decorated array`);
      (out as Record<string, unknown>)[k] = walk(d.value, depth + 1, `${at}.${k}`);
    }
    return out;
  };
  return walk(value, 0, where);
}

function refKey(ref: ComponentRef): string {
  return `${ref.id}@${ref.version}`;
}

function checkPorts(v: unknown, where: string): void {
  if (!Array.isArray(v) || v.length > COMPILER_LIMITS.maxPorts) fail("invalid-component", `${where} must be an array of at most ${COMPILER_LIMITS.maxPorts} ports`);
  const names = new Set<string>();
  for (const p of v) {
    if (!isPlain(p) || exactKeys(p, ["name", "type"]) !== null) fail("invalid-component", `${where} port must be exactly {name, type}`);
    if (typeof p.name !== "string" || !ID.test(p.name)) fail("invalid-component", `${where} port name '${show(p.name)}' is not an id`);
    if (typeof p.type !== "string" || !PORT_TYPE.test(p.type)) fail("invalid-component", `${where} port type '${show(p.type)}' is not a typed artifact`);
    if (names.has(p.name)) fail("invalid-component", `${where} declares port '${p.name}' twice`);
    names.add(p.name);
  }
}

function checkIdList(v: unknown, max: number, where: string): void {
  if (!Array.isArray(v) || v.length > max) fail("invalid-component", `${where} must be an array of at most ${max} ids`);
  if (new Set(v).size !== v.length) fail("invalid-component", `${where} repeats an entry`);
  for (const x of v) if (typeof x !== "string" || !ID.test(x)) fail("invalid-component", `${where} entry '${show(x)}' is not an id`);
}

function checkGateRole(v: unknown, where: string): void {
  if (v !== undefined && v !== null && !(COMPONENT_GATE_ROLES as readonly unknown[]).includes(v)) fail("invalid-component", `${where} '${show(v)}' is not a gate role`);
}

function checkCondition(c: unknown, depth: number, where: string): void {
  if (!isPlain(c) || typeof c.kind !== "string") fail("bad-condition", `${where} must be a declarative condition object, not ${typeof c}`);
  const bad = (why: string): never => fail("bad-condition", `${where}: ${why}`);
  switch (c.kind) {
    case "outcome":
      if (exactKeys(c, ["kind", "equals"]) !== null) bad("outcome takes exactly {kind, equals}");
      if (typeof c.equals !== "string" || !ID.test(c.equals)) bad("outcome 'equals' must be an id");
      return;
    case "no_unresolved_questions":
    case "obligations_accepted":
      if (exactKeys(c, ["kind"]) !== null) bad(`${c.kind} takes no arguments`);
      return;
    case "artifact_present":
      if (exactKeys(c, ["kind", "name"]) !== null) bad("artifact_present takes exactly {kind, name}");
      if (typeof c.name !== "string" || !ID.test(c.name)) bad("artifact_present 'name' must be an id");
      return;
    case "all_of":
    case "any_of": {
      if (depth > 0) bad("combinators do not nest");
      if (exactKeys(c, ["kind", "conditions"]) !== null) bad(`${c.kind} takes exactly {kind, conditions}`);
      const terms = c.conditions;
      if (!Array.isArray(terms) || terms.length === 0 || terms.length > COMPILER_LIMITS.maxConditionTerms) bad(`${c.kind} needs 1..${COMPILER_LIMITS.maxConditionTerms} terms`);
      for (const t of terms as unknown[]) checkCondition(t, depth + 1, where);
      return;
    }
    default:
      bad(`unknown condition kind '${c.kind}'`);
  }
}

function checkStep(s: unknown, depth: number, ids: Set<string>, where: string): void {
  if (depth > COMPILER_LIMITS.maxStepNesting) fail("depth-exceeded", `${where} nests steps deeper than ${COMPILER_LIMITS.maxStepNesting}`);
  if (!isPlain(s) || typeof s.kind !== "string") fail("invalid-component", `${where} step must be an object with a kind`);
  if (s.kind === "parallel") fail("parallel-join-unsupported", `${where}: parallel joins are excluded from the first release`);
  if (!(COMPONENT_STEP_KINDS as readonly string[]).includes(s.kind)) fail("unknown-step-kind", `${where}: step kind '${s.kind}' is not one of ${COMPONENT_STEP_KINDS.join(", ")}`);
  if (typeof s.id !== "string" || !STEP_ID.test(s.id)) fail("invalid-component", `${where}: step id '${show(s.id)}' must match ${STEP_ID}`);
  if (ids.has(s.id)) fail("duplicate-step-id", `${where}: step id '${s.id}' is declared twice in one component`);
  ids.add(s.id);
  const at = `${where}/${s.id}`;
  switch (s.kind) {
    case "task": {
      const k = exactKeys(s, ["kind", "id", "effect", "role", "capabilities", "inputs", "outputs"], ["required", "gate_role", "within_gate"]);
      if (k) fail("invalid-component", `${at}: ${k}`);
      if (!(COMPONENT_EFFECTS as readonly unknown[]).includes(s.effect)) fail("invalid-component", `${at}: effect '${show(s.effect)}' is not one of ${COMPONENT_EFFECTS.join(", ")}`);
      if (typeof s.role !== "string" || !ID.test(s.role)) fail("invalid-component", `${at}: role must be an id`);
      checkIdList(s.capabilities, COMPILER_LIMITS.maxCapabilities, `${at} capabilities`);
      checkPorts(s.inputs, `${at} inputs`);
      checkPorts(s.outputs, `${at} outputs`);
      if (s.required !== undefined && typeof s.required !== "boolean") fail("invalid-component", `${at}: required must be boolean`);
      checkGateRole(s.gate_role, `${at} gate_role`);
      checkGateRole(s.within_gate, `${at} within_gate`);
      return;
    }
    case "sequence": {
      const k = exactKeys(s, ["kind", "id", "steps"]);
      if (k) fail("invalid-component", `${at}: ${k}`);
      if (!Array.isArray(s.steps) || s.steps.length === 0 || s.steps.length > COMPILER_LIMITS.maxSteps) fail("invalid-component", `${at}: sequence needs 1..${COMPILER_LIMITS.maxSteps} steps`);
      for (const c of s.steps as unknown[]) checkStep(c, depth + 1, ids, at);
      return;
    }
    case "repeat": {
      const k = exactKeys(s, ["kind", "id", "body"], ["max_rounds", "until"]);
      if (k) fail("invalid-component", `${at}: ${k}`);
      const m = s.max_rounds;
      if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > COMPILER_LIMITS.maxRepeatRounds) {
        fail("unbounded-repeat", `${at}: max_rounds must be an integer in 1..${COMPILER_LIMITS.maxRepeatRounds}, got ${show(m)}`);
      }
      if (s.until === undefined) fail("bad-condition", `${at}: repeat needs an 'until' condition`);
      checkCondition(s.until, 0, `${at} until`);
      checkStep(s.body, depth + 1, ids, at);
      return;
    }
    case "call": {
      const k = exactKeys(s, ["kind", "id", "component"]);
      if (k) fail("invalid-component", `${at}: ${k}`);
      const ref = s.component;
      if (!isPlain(ref) || exactKeys(ref, ["id", "version"]) !== null || typeof ref.id !== "string" || !ID.test(ref.id) || typeof ref.version !== "string" || !VERSION.test(ref.version)) {
        fail("invalid-component", `${at}: component must be a typed reference {id, version}`);
      }
      return;
    }
  }
}

/** Validate one authored component document. Empty result means valid. */
export function validateComponentDocument(raw: unknown): CompileViolation[] {
  return checkComponent(raw).violations;
}

function checkComponent(raw: unknown): { doc?: ComponentDocument; violations: CompileViolation[] } {
  try {
    const doc = detach(raw, "invalid-component", "component");
    if (!isPlain(doc)) fail("invalid-component", "component is not a mapping");
    const k = exactKeys(doc, ["schema_version", "id", "version", "effects", "inputs", "outputs", "body"]);
    if (k) fail("invalid-component", `component: ${k}`);
    if (doc.schema_version !== WORKFLOW_COMPONENT_SCHEMA_VERSION) fail("invalid-component", `schema_version '${show(doc.schema_version)}' is not ${WORKFLOW_COMPONENT_SCHEMA_VERSION}`);
    if (typeof doc.id !== "string" || !ID.test(doc.id)) fail("invalid-component", `component id '${show(doc.id)}' is not an id`);
    if (typeof doc.version !== "string" || !VERSION.test(doc.version)) fail("invalid-component", `component version '${show(doc.version)}' is invalid`);
    const where = `${doc.id}@${doc.version}`;
    if (!Array.isArray(doc.effects) || doc.effects.length === 0 || new Set(doc.effects).size !== doc.effects.length || !doc.effects.every((e) => (COMPONENT_EFFECTS as readonly unknown[]).includes(e))) {
      fail("invalid-component", `${where}: effects must be a non-empty unique subset of ${COMPONENT_EFFECTS.join(", ")}`);
    }
    checkPorts(doc.inputs, `${where} inputs`);
    checkPorts(doc.outputs, `${where} outputs`);
    checkStep(doc.body, 0, new Set(), where);
    return { doc: doc as unknown as ComponentDocument, violations: [] };
  } catch (err) {
    if (err instanceof Abort) return { violations: [err.violation] };
    throw err;
  }
}

// ---------------------------------------------------------------- registry

interface RegistryEntry { doc: ComponentDocument; sha256: string }

const REGISTRY_FACTORY = Symbol("createComponentRegistry");
// The compiler reads entries from here, never through an instance method, so a
// forged instance or an overridden get() cannot feed it unvalidated documents.
const REGISTRY_ENTRIES = new WeakMap<object, ReadonlyMap<string, Readonly<RegistryEntry>>>();

function registryEntries(registry: unknown): ReadonlyMap<string, Readonly<RegistryEntry>> {
  const entries = typeof registry === "object" && registry !== null ? REGISTRY_ENTRIES.get(registry) : undefined;
  if (!entries) fail("invalid-request", "registry must come from createComponentRegistry");
  return entries;
}

/** Construct through `createComponentRegistry` / `loadComponentRegistry` only; they validate every document. */
export class WorkflowComponentRegistry {
  constructor(token: symbol, entries: Map<string, RegistryEntry>) {
    if (token !== REGISTRY_FACTORY) throw new TypeError("WorkflowComponentRegistry is built by createComponentRegistry, which validates every document");
    REGISTRY_ENTRIES.set(this, new Map([...entries].map(([k, e]) => [k, Object.freeze({ doc: e.doc, sha256: e.sha256 })])));
    Object.freeze(this);
  }
  /** A frozen entry: the document and the hash it was registered under cannot be separated. */
  get(ref: ComponentRef): Readonly<RegistryEntry> | undefined {
    return registryEntries(this).get(refKey(ref));
  }
  /** Sorted `id@version` keys. */
  keys(): string[] {
    return [...registryEntries(this).keys()].sort();
  }
}

export type RegistryResult =
  | { ok: true; registry: WorkflowComponentRegistry }
  | { ok: false; violations: CompileViolation[] };

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v as object)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/** Build a registry from authored documents. `labels` name each doc's source in violations. */
export function createComponentRegistry(docs: readonly unknown[], labels: readonly string[] = []): RegistryResult {
  const violations: CompileViolation[] = [];
  const entries = new Map<string, RegistryEntry>();
  docs.forEach((raw, i) => {
    const label = labels[i] ?? `component[${i}]`;
    const checked = checkComponent(raw);
    if (!checked.doc) {
      for (const v of checked.violations) violations.push({ rule: v.rule, detail: `${label}: ${v.detail}` });
      return;
    }
    const doc = deepFreeze(checked.doc);
    const key = refKey(doc);
    if (entries.has(key)) {
      violations.push({ rule: "duplicate-component", detail: `${label}: ${key} is registered twice` });
      return;
    }
    entries.set(key, { doc, sha256: sha256Of(doc) });
  });
  if (violations.length) return { ok: false, violations };
  return { ok: true, registry: new WorkflowComponentRegistry(REGISTRY_FACTORY, entries) };
}

export interface LoadComponentsOptions {
  cwd?: string;
  storage?: Pick<GuildStorage, "definition">;
}

/** Load project components from the durable definition tree. Absent directory is an empty registry; any bad file fails the load. */
export function loadComponentRegistry(opts: LoadComponentsOptions = {}): RegistryResult {
  const storage = opts.storage ?? createGuildStorage(opts.cwd ?? process.cwd());
  const dir = storage.definition(COMPONENT_DEFINITION_SEGMENT);
  if (!fs.existsSync(dir)) return createComponentRegistry([]);
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
  const docs: unknown[] = [];
  const violations: CompileViolation[] = [];
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      docs.push(loadYamlApi().load(fs.readFileSync(file, "utf8")));
    } catch (err) {
      violations.push({ rule: "invalid-component", detail: `${file}: ${(err as Error).message}` });
    }
  }
  if (violations.length) return { ok: false, violations };
  return createComponentRegistry(docs, files.map((f) => path.join(dir, f)));
}

// ---------------------------------------------------------------- compile

function walkSteps(s: ComponentStep, visit: (s: ComponentStep) => void): void {
  visit(s);
  if (s.kind === "sequence") for (const c of s.steps) walkSteps(c, visit);
  else if (s.kind === "repeat") walkSteps(s.body, visit);
}

function normalisePolicy(policy: unknown): Map<string, string[]> {
  if (!isPlain(policy) || exactKeys(policy, ["roles"]) !== null || !isPlain(policy.roles)) fail("invalid-request", "policy must be exactly {roles: {role: [capability]}}");
  const out = new Map<string, string[]>();
  for (const role of Object.keys(policy.roles).sort()) {
    if (!ID.test(role)) fail("invalid-request", `policy role '${role}' is not an id`);
    const caps = policy.roles[role];
    if (!Array.isArray(caps) || caps.length > COMPILER_LIMITS.maxCapabilities || !caps.every((c) => typeof c === "string" && ID.test(c))) {
      fail("invalid-request", `policy role '${role}' capabilities must be ids`);
    }
    out.set(role, [...new Set(caps as string[])].sort());
  }
  return out;
}

interface Closure {
  order: string[];
  entries: Map<string, RegistryEntry>;
}

/** Resolve the reference closure; refuse unknown refs, recursion, depth, size and round budgets before expansion. */
function resolveClosure(registry: ReadonlyMap<string, Readonly<RegistryEntry>>, root: ComponentRef): Closure {
  const entries = new Map<string, RegistryEntry>();
  const state = new Map<string, "active" | "done">();
  const depth = new Map<string, number>();
  const nodes = new Map<string, number>();
  const rounds = new Map<string, number>();
  const cap = (n: number, max: number) => Math.min(n, max + 1);

  const visit = (ref: ComponentRef, stack: string[]): void => {
    const key = refKey(ref);
    if (state.get(key) === "active") {
      fail("recursive-composition", `component cycle ${[...stack.slice(stack.indexOf(key)), key].join(" -> ")}`);
    }
    if (state.get(key) === "done") return;
    const entry = registry.get(key);
    if (!entry) fail("unknown-component", `${stack.length ? stack[stack.length - 1] : "request"} references ${key}, which is not registered`);
    if (sha256Of(entry.doc) !== entry.sha256) fail("invalid-component", `${key} no longer matches the hash it was registered under`);
    state.set(key, "active");
    entries.set(key, entry);
    if (entries.size > COMPILER_LIMITS.maxComponents) fail("unbounded-expansion", `composition references more than ${COMPILER_LIMITS.maxComponents} components`);

    const measure = (s: ComponentStep): { n: number; r: number; d: number } => {
      switch (s.kind) {
        case "task":
          return { n: 1, r: 1, d: 0 };
        case "call": {
          const ck = refKey(s.component);
          visit(s.component, [...stack, key]);
          return { n: nodes.get(ck)!, r: rounds.get(ck)!, d: depth.get(ck)! + 1 };
        }
        case "sequence": {
          let n = 0, r = 1, d = 0;
          for (const c of s.steps) {
            const m = measure(c);
            n = cap(n + m.n, COMPILER_LIMITS.maxNodes);
            r = Math.max(r, m.r);
            d = Math.max(d, m.d);
          }
          return { n, r, d };
        }
        case "repeat": {
          const m = measure(s.body);
          return { n: m.n, r: cap(m.r * s.max_rounds, COMPILER_LIMITS.maxTotalRounds), d: m.d };
        }
      }
    };
    const m = measure(entry.doc.body);
    if (m.d > COMPILER_LIMITS.maxCallDepth) fail("depth-exceeded", `${key} nests calls ${m.d} deep; the cap is ${COMPILER_LIMITS.maxCallDepth}`);
    if (m.n > COMPILER_LIMITS.maxNodes) fail("unbounded-expansion", `${key} expands past ${COMPILER_LIMITS.maxNodes} nodes`);
    if (m.r > COMPILER_LIMITS.maxTotalRounds) fail("unbounded-expansion", `${key} nests repeats past ${COMPILER_LIMITS.maxTotalRounds} total rounds`);
    depth.set(key, m.d);
    nodes.set(key, m.n);
    rounds.set(key, m.r);
    state.set(key, "done");
  };

  visit(root, []);
  const order = [...entries.keys()].sort((a, b) => {
    const ea = entries.get(a)!.doc, eb = entries.get(b)!.doc;
    return ea.id < eb.id ? -1 : ea.id > eb.id ? 1 : ea.version < eb.version ? -1 : ea.version > eb.version ? 1 : 0;
  });
  return { order, entries };
}

function checkEffects(closure: Closure): void {
  for (const key of closure.order) {
    const doc = closure.entries.get(key)!.doc;
    walkSteps(doc.body, (s) => {
      if (s.kind === "task" && !doc.effects.includes(s.effect)) fail("undeclared-effect", `${key} task '${s.id}' has effect '${s.effect}' outside its declared effects`);
      if (s.kind === "call") {
        const callee = closure.entries.get(refKey(s.component))!.doc;
        const hidden = callee.effects.filter((e) => !doc.effects.includes(e));
        if (hidden.length) fail("undeclared-effect", `${key} calls ${refKey(s.component)}, which can ${hidden.join(", ")} outside ${key}'s declared effects`);
      }
    });
  }
}

interface Expansion {
  nodes: ProjectionNode[];
  edges: ProjectionEdge[];
  namespace: NamespaceEntry[];
  loops: LoopEntry[];
}

function expand(closure: Closure, rootKey: string, roles: ReadonlyMap<string, string[]>): Expansion & { entry: string } {
  const out: Expansion = { nodes: [], edges: [], namespace: [], loops: [] };
  const ns = (callPath: string[], id: string): string => {
    const full = [...callPath, id].join(".");
    if (!ID.test(full)) fail("namespace-overflow", `namespaced id '${full}' exceeds the C8 id pattern`);
    return full;
  };
  const provide = (avail: Map<string, string>, ports: ComponentPort[], where: string): void => {
    for (const p of ports) {
      const prior = avail.get(p.name);
      if (prior !== undefined && prior !== p.type) fail("incompatible-artifact", `${where} produces '${p.name}' as ${p.type}, already ${prior}`);
      avail.set(p.name, p.type);
    }
  };
  const consume = (avail: Map<string, string>, ports: ComponentPort[], where: string): void => {
    for (const p of ports) {
      const have = avail.get(p.name);
      if (have === undefined) fail("unsatisfied-input", `${where} needs '${p.name}' (${p.type}), which nothing earlier produces`);
      if (have !== p.type) fail("incompatible-artifact", `${where} needs '${p.name}' as ${p.type}, but it is ${have}`);
    }
  };

  type Frag = { entry: string; exit: string };
  const run = (s: ComponentStep, key: string, callPath: string[], compPath: string[], avail: Map<string, string>): Frag => {
    const entry = closure.entries.get(key)!;
    switch (s.kind) {
      case "task": {
        const id = ns(callPath, s.id);
        consume(avail, s.inputs, `node ${id}`);
        const granted = roles.get(s.role);
        if (!granted) fail("incompatible-role", `node ${id} needs role '${s.role}', which the phase team does not have`);
        const missing = s.capabilities.filter((c) => !granted.includes(c));
        if (missing.length) fail("incompatible-role", `node ${id} needs ${missing.join(", ")} from role '${s.role}', which grants only [${granted.join(", ")}]`);
        out.nodes.push({
          id,
          component_id: entry.doc.id,
          component_hash: entry.sha256,
          effect: s.effect,
          gate_role: s.gate_role ?? null,
          within_gate: s.within_gate ?? null,
          role: s.role,
          capabilities: [...s.capabilities],
          inputs: s.inputs.map((p) => ({ name: p.name, type: p.type })),
          outputs: s.outputs.map((p) => ({ name: p.name, type: p.type })),
          required: s.required ?? true,
        });
        out.namespace.push({ node_id: id, call_path: [...callPath], component_path: [...compPath], step_id: s.id });
        provide(avail, s.outputs, `node ${id}`);
        return { entry: id, exit: id };
      }
      case "sequence": {
        let first: Frag | null = null;
        let prev: Frag | null = null;
        for (const c of s.steps) {
          const f = run(c, key, callPath, compPath, avail);
          if (prev) out.edges.push({ from: prev.exit, to: f.entry, on: "next" });
          first ??= f;
          prev = f;
        }
        return { entry: first!.entry, exit: prev!.exit };
      }
      case "repeat": {
        const f = run(s.body, key, callPath, compPath, avail);
        out.edges.push({ from: f.exit, to: f.entry, on: "repeat" });
        out.loops.push({ id: ns(callPath, s.id), entry: f.entry, exit: f.exit, max_rounds: s.max_rounds, until: JSON.parse(JSON.stringify(s.until)) as ComponentCondition });
        return f;
      }
      case "call": {
        const ck = refKey(s.component);
        const callee = closure.entries.get(ck)!.doc;
        const at = `call ${ns(callPath, s.id)} -> ${ck}`;
        consume(avail, callee.inputs, at);
        const inner = new Map(callee.inputs.map((p) => [p.name, p.type] as [string, string]));
        const f = run(callee.body, ck, [...callPath, s.id], [...compPath, ck], inner);
        checkOutputs(callee, inner, ck);
        provide(avail, callee.outputs, at);
        return f;
      }
    }
  };
  const checkOutputs = (doc: ComponentDocument, avail: Map<string, string>, key: string): void => {
    for (const p of doc.outputs) {
      const have = avail.get(p.name);
      if (have === undefined) fail("unsatisfied-output", `${key} declares output '${p.name}' that its body never produces`);
      if (have !== p.type) fail("incompatible-artifact", `${key} declares output '${p.name}' as ${p.type}, but its body produces ${have}`);
    }
  };

  const root = closure.entries.get(rootKey)!.doc;
  const avail = new Map(root.inputs.map((p) => [p.name, p.type] as [string, string]));
  const f = run(root.body, rootKey, [], [rootKey], avail);
  checkOutputs(root, avail, rootKey);
  const seenIds = new Set<string>();
  for (const n of out.nodes) {
    if (seenIds.has(n.id)) fail("duplicate-step-id", `expanded node id '${n.id}' is not unique`);
    seenIds.add(n.id);
  }
  if (out.edges.length > COMPILER_LIMITS.maxEdges) fail("unbounded-expansion", `expansion has ${out.edges.length} edges; the cap is ${COMPILER_LIMITS.maxEdges}`);
  return { ...out, entry: f.entry };
}

/** The frozen C8 v2 gate rules (verify_contracts.py), applied to the expanded graph. */
function checkGates(cls: WorkflowClass, x: Expansion & { entry: string }): string[] {
  const roleOwner = new Map<ComponentGateRole, string>();
  for (const n of x.nodes) {
    if (n.effect === "gate" && n.gate_role === null) fail("gate-not-protected", `gate node ${n.id} has no gate_role`);
    if (n.gate_role !== null) {
      if (n.effect !== "gate") fail("gate-not-protected", `node ${n.id} holds gate role ${n.gate_role} without a gate effect`);
      if (!n.required) fail("gate-not-protected", `gate ${n.id} cannot be made skippable (required=false)`);
      if (roleOwner.has(n.gate_role)) fail("gate-not-protected", `gate role ${n.gate_role} is held by both ${roleOwner.get(n.gate_role)} and ${n.id}`);
      roleOwner.set(n.gate_role, n.id);
    }
  }
  for (const n of x.nodes) {
    if (n.within_gate === null) continue;
    if (n.gate_role !== null || !roleOwner.has(n.within_gate)) fail("invalid-gate-scope", `node ${n.id} scopes into gate role ${n.within_gate}, which no gate holds`);
    if (["release", "privileged_operation", "gate"].includes(n.effect)) fail("invalid-gate-scope", `node ${n.id} cannot hold a ${n.effect} effect inside a gate scope`);
  }
  const protectedGates = x.nodes.filter((n) => n.gate_role !== null).map((n) => n.id);
  if (protectedGates.length > COMPILER_LIMITS.maxProtectedGates) fail("unbounded-expansion", `more than ${COMPILER_LIMITS.maxProtectedGates} protected gates`);
  const missingClass = (CLASS_REQUIRED_GATE_ROLES[cls] ?? []).filter((r) => !roleOwner.has(r));
  if (missingClass.length) fail("class-gate-missing", `${cls} compositions require gate roles ${missingClass.join(", ")}`);
  if (x.nodes.some((n) => n.effect === "release")) {
    const missing = [...RELEASE_REQUIRED_GATE_ROLES, ...(RELEASE_CLASS_GATE_ROLES[cls] ?? [])].filter((r) => !roleOwner.has(r));
    if (missing.length) fail("class-gate-missing", `release work requires gate roles ${missing.join(", ")}`);
  }
  const byId = new Map(x.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const e of x.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const gates = new Set(protectedGates);
  const pending: Array<[string, Set<string>]> = [[x.entry, new Set()]];
  const seen = new Set<string>();
  while (pending.length) {
    const [id, before] = pending.pop()!;
    const passed = new Set(before);
    if (gates.has(id)) passed.add(id);
    const stateKey = `${id}|${[...passed].sort().join(",")}`;
    if (seen.has(stateKey)) continue;
    seen.add(stateKey);
    if (seen.size > COMPILER_LIMITS.maxPathStates) fail("unbounded-expansion", "gate path proof exceeded its state budget");
    if (byId.get(id)!.effect === "release") {
      const skipped = protectedGates.filter((g) => !passed.has(g));
      if (skipped.length) fail("release-bypasses-gate", `release node ${id} is reachable without passing ${skipped.join(", ")}`);
    }
    for (const to of out.get(id) ?? []) pending.push([to, passed]);
  }
  return protectedGates;
}

/** Compile one composition into a C8 WorkflowProjection v2 plus its compile manifest. Pure and deterministic. */
export function compileWorkflow(registry: WorkflowComponentRegistry, rawRequest: CompileRequest): CompileResult {
  try {
    const entries = registryEntries(registry);
    const request = detach(rawRequest, "invalid-request", "request") as CompileRequest;
    if (!isPlain(request)) fail("invalid-request", "request is not a mapping");
    if (!(WORKFLOW_CLASSES as readonly unknown[]).includes(request.class)) fail("unknown-class", `'${show(request.class)}' is not one of the five classes`);
    const wf = request.workflow;
    if (!isPlain(wf) || typeof wf.source_id !== "string" || !ID.test(wf.source_id) || typeof wf.id !== "string" || !ID.test(wf.id)) {
      fail("invalid-request", "workflow must be {source_id, id} ids");
    }
    const root = request.root;
    if (!isPlain(root) || exactKeys(root, ["id", "version"]) !== null || typeof root.id !== "string" || typeof root.version !== "string") {
      fail("invalid-component", "root must be a typed reference {id, version}");
    }
    const roles = normalisePolicy(request.policy);
    const closure = resolveClosure(entries, root);
    checkEffects(closure);
    const rootKey = refKey(root);
    const x = expand(closure, rootKey, roles);
    const protectedGates = checkGates(request.class, x);

    const components = closure.order.map((k) => {
      const e = closure.entries.get(k)!;
      return { id: e.doc.id, version: e.doc.version, sha256: e.sha256 };
    });
    const definition_hash = sha256Of({ class: request.class, root: { id: root.id, version: root.version }, components });
    const policy_hash = sha256Of({ roles: Object.fromEntries(roles) });
    const expanded_hash = sha256Of({ nodes: x.nodes, edges: x.edges, entry: x.entry, protected_gates: protectedGates });

    const projection: WorkflowProjectionV2 = {
      schema_version: WORKFLOW_PROJECTION_V2_SCHEMA_VERSION,
      workflow: { source_id: wf.source_id, kind: "workflow", id: wf.id, revision: definition_hash },
      class: request.class,
      definition_hash,
      compiler_hash: COMPILER_HASH,
      policy_hash,
      expanded_hash,
      components,
      nodes: x.nodes,
      edges: x.edges,
      entry: x.entry,
      protected_gates: protectedGates,
      obligations: [],
      invocations: [],
    };
    // W02: post-expansion dominance, gate order, scope and disguise checks on the emitted graph.
    const verified = verifyProtectedPaths(projection);
    if (!verified.ok) return { ok: false, violations: verified.violations };
    const manifest: CompileManifest = {
      schema_version: WORKFLOW_COMPILE_MANIFEST_SCHEMA_VERSION,
      compiler: { id: WORKFLOW_COMPILER_ID, version: WORKFLOW_COMPILER_VERSION, hash: COMPILER_HASH },
      class: request.class,
      workflow: { source_id: wf.source_id, id: wf.id },
      root: { id: root.id, version: root.version },
      definition_hash,
      policy_hash,
      expanded_hash,
      components: components.map((c) => ({ ...c })),
      namespace_map: x.namespace,
      loops: x.loops,
    };
    return { ok: true, projection, manifest };
  } catch (err) {
    if (err instanceof Abort) return { ok: false, violations: [err.violation] };
    throw err;
  }
}

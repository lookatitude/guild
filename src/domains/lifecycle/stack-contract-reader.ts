/**
 * A04 reader-only compatibility checkpoint for the frozen guild-stack contracts.
 *
 * Reads v1 and v2 documents after exact version negotiation; never writes, never
 * activates a v2 producer. v2 acceptance is schema shape plus the A02 semantic
 * rules (a port of contracts/guild-stack/v2/verify_contracts.py semantic_errors,
 * held to parity by tests/fixtures/stack-contract-reader/parity.generated.json).
 */
import { createHash } from "node:crypto";
import v1Bundle from "./stack-contracts.generated.json";
import v2Bundle from "./stack-contracts.v2.generated.json";

type Doc = Record<string, any>;
/** Throws when `value` does not satisfy the schema at `schemaId` (facade validator). */
export type StackSchemaCheck = (schemaId: string, value: unknown) => void;

const V1_PREFIX = "https://guildstack.dev/contracts/guild-stack/v1/";
const V2_PREFIX = "https://guildstack.dev/contracts/guild-stack/v2/";
export const STACK_READER_ID = "guild.stack.reader.a04.v1";
/** Every v2 writer, grant and lifecycle control stays off until V01/D01/Z01. */
export const STACK_V2_WRITERS = "disabled" as const;
export const STACK_V2_ACTIVATION_GATES = Object.freeze(["V01", "D01", "Z01"] as const);

interface Contract { name: string; schema_id: string; schema_version: string; major: "v1" | "v2" }
interface Tables {
  contracts: Contract[]; byVersion: Map<string, Contract>; byUri: Map<string, Doc>; v2NameByUri: Map<string, string>;
  metrics: Map<string, Doc>; operations: Map<string, Doc>; projectionBodies: Set<string>; signedMetrics: Set<string>; v1Operations: Map<string, Doc>;
}
let cached: Tables | null = null;
/** Lazy so bundles that only reach the lifecycle index do not retain the contract JSON. */
function tables(): Tables {
  if (cached) return cached;
  const contracts: Contract[] = [];
  const byUri = new Map<string, Doc>();
  for (const [file, schema] of Object.entries(v1Bundle.schemas as Record<string, Doc>)) {
    byUri.set(schema.$id, schema);
    const version = schema?.properties?.schema_version?.const;
    if (typeof version === "string") contracts.push({ name: file.replace(/\.schema\.json$/, ""), schema_id: schema.$id, schema_version: version, major: "v1" });
  }
  for (const s of Object.values((v2Bundle as Doc).schemas as Record<string, Doc>)) byUri.set(s.$id, s);
  for (const c of (v2Bundle as Doc).schema_registry.contracts as Doc[])
    if (typeof c.schema_version === "string") contracts.push({ name: c.name, schema_id: c.schema_id, schema_version: c.schema_version, major: "v2" });
  const metrics = new Map<string, Doc>(((v2Bundle as Doc).metric_catalog.atomic_measurements as Doc[]).map((m) => [m.id, m]));
  cached = {
    contracts, byUri,
    byVersion: new Map(contracts.map((c) => [c.schema_version, c])),
    v2NameByUri: new Map(Object.entries((v2Bundle as Doc).schemas as Record<string, Doc>).map(([file, s]) => [s.$id, file.replace(/\.schema\.json$/, "")])),
    metrics,
    operations: new Map(((v2Bundle as Doc).operation_catalog.operations as Doc[]).map((o) => [o.id, o])),
    projectionBodies: new Set((v2Bundle as Doc).schema_registry.projection_body_schemas),
    signedMetrics: new Set([...metrics.values()].filter((m) => String(m.formula).includes("paired candidate-baseline")).map((m) => m.id)),
    v1Operations: new Map(((v1Bundle as Doc).catalog.operations as Doc[]).map((o) => [o.id, o])),
  };
  return cached;
}

/** Versions an installed reader can consume. `v1` = rolled-back reader profile. */
export type StackReaderProfile = "v1" | "v1+v2";
export function stackReaderVersions(profile: StackReaderProfile = "v1+v2"): string[] {
  return tables().contracts.filter((c) => profile === "v1+v2" || c.major === "v1").map((c) => c.schema_version).sort();
}

// ---------------------------------------------------------------------------
// RFC 8785 digest (same canonical form as stackCanonical) and Python-equality helpers
// ---------------------------------------------------------------------------
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
/** RFC 8785 input rules: no lone surrogates, finite numbers only (throws like stackCanonical). */
function canonical(value: any): string {
  if (typeof value === "string" && LONE_SURROGATE.test(value)) throw new Error("Invalid Unicode");
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Number is not interoperable JSON");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}
export const stackContractDigest = (value: unknown) => "sha256:" + createHash("sha256").update(canonical(value)).digest("hex");
const eq = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const includes = (list: unknown[], x: unknown) => list.some((y) => eq(x, y));
const truthy = (x: any) => !(x === null || x === undefined || x === false || x === 0 || x === "" || (Array.isArray(x) && x.length === 0) || (typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 0));
const isObj = (x: any): x is Doc => x !== null && typeof x === "object" && !Array.isArray(x);
const has = (o: Doc, keys: string[]) => keys.every((k) => k in o);
/** Python datetime.fromisoformat precision: whole seconds plus microseconds (extra digits truncated). */
function dt(s: string): bigint {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(s);
  const base = m ? Date.parse(m[1] + m[3]) : NaN;
  if (!m || Number.isNaN(base)) throw new Error("unsupported timestamp");
  return BigInt(base) * 1000n + BigInt((m[2] ?? "").slice(0, 6).padEnd(6, "0"));
}
/** Python str.strip(): str.isspace() set, which differs from String.prototype.trim. */
const PY_SPACE = "\t\n\u000b\f\r\u001c\u001d\u001e\u001f \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000";
function pyStrip(x: string): string {
  let a = 0, b = x.length;
  while (a < b && PY_SPACE.includes(x[a])) a++;
  while (b > a && PY_SPACE.includes(x[b - 1])) b--;
  return x.slice(a, b);
}
/**
 * True when the document is outside I-JSON: a non-finite number, an integer JS cannot
 * represent exactly, or a lone surrogate in a string or key. JS and Python semantics diverge there.
 */
function nonInteroperable(o: any, level = 0): boolean {
  if (level > 64) return true;
  if (typeof o === "number") return !Number.isFinite(o) || (Number.isInteger(o) && !Number.isSafeInteger(o));
  if (typeof o === "string") return LONE_SURROGATE.test(o);
  if (Array.isArray(o)) return o.some((x) => nonInteroperable(x, level + 1));
  if (isObj(o)) return Object.entries(o).some(([k, x]) => LONE_SURROGATE.test(k) || nonInteroperable(x, level + 1));
  return false;
}
const isclose = (a: number, b: number, abs = 1e-12) => Math.abs(a - b) <= Math.max(1e-9 * Math.max(Math.abs(a), Math.abs(b)), abs);
const subset = (a: Iterable<string>, b: Set<string>) => [...a].every((x) => b.has(x));

const REQUIRED_GATE_ROLES: Record<string, string[]> = { product: ["d5", "qa", "d8"] };
const RELEASE_GATE_ROLES = ["d5", "qa", "d8"];
const RELEASE_CLASS_GATE_ROLES: Record<string, string[]> = { ops: ["ops"] };
const QA_ASSURANCE_KINDS = new Set(["security", "adversarial_security", "ui", "ux"]);
const UNSIGNED_UNITS = new Set(["count", "tokens", "ms", "usd", "usd_per_outcome", "ms_per_outcome"]);
const USAGE_COUNTERS = ["input_inclusive", "output", "cache_read_subset", "cache_write_subset", "total"];

const usable = (e: any) => e !== null && e !== undefined && e.availability === "available";
const disclosed = (e: any) => e !== null && e !== undefined && (e.availability === "available" || (["expired", "redacted"].includes(e.availability) && truthy(e.reason)));
function inputIdentity(q: Doc): Doc {
  const c = JSON.parse(JSON.stringify(q));
  delete c.versions.formula; delete c.underlying_scalar;
  return c;
}
type Ident = Doc | [string, string | null, string | null] | null;
function bodyIdentity(name: string, b: Doc): Ident {
  const l = b.lineage;
  switch (name) {
    case "entity-evidence": return b.entity;
    case "workflow-projection": return b.workflow;
    case "run-analysis": return b.run;
    case "evaluation-manifest": return b.evaluation;
    case "report-manifest": return b.report;
    case "execution-lineage": case "execution-segment": return [l.source_id, "execution", l.execution_id];
    case "task-assignment": return [l.source_id, "logical_task", l.logical_task_id];
    case "task-attempt": return [l.source_id, "task_attempt", l.attempt_id];
    case "trace-analysis": return [l.source_id, null, null];
    case "logical-run": case "run-binding": return [b.source_id, "run", b.run_id];
    case "followup-transfer": return [b.source_work.source_id, "transfer", b.operation_id];
    case "knowledge-publication": return [b.durable_owner_source_id, null, null];
    case "operation-receipt": return [b.source_id, "operation", b.operation_id];
    case "approval-record": return [b.source_id, "decision", b.decision_id];
    default: return null;
  }
}

/**
 * A02 semantic rules for one shape-valid v2 document. Message text and order
 * match verify_contracts.py so the parity fixture can compare exact lists.
 */
export function stackV2SemanticErrors(name: string, value: Doc, shape: (name: string, value: unknown) => boolean, depth = 0): string[] {
  let errors: string[] = [];
  const assertRule = (ok: boolean, message: string) => { if (!ok) errors.push(message); };
  const coverage = (c: Doc) => {
    if (c.eligible !== null) {
      assertRule(c.covered <= c.eligible, "covered exceeds eligible");
      if (c.missing !== null) assertRule(c.covered + c.missing === c.eligible, "eligible must equal covered plus missing; excluded is outside eligible");
    }
    if (c.state === "complete") assertRule(c.eligible !== null && c.covered === c.eligible && c.missing === 0, "complete requires known full coverage");
    else assertRule(truthy(c.reason), "incomplete coverage needs reason");
    if (c.state === "unavailable") assertRule(c.covered === 0, "unavailable coverage cannot have covered samples");
  };
  const snapshot = (s: Doc) => {
    const gens = new Set<string>(s.source_generations.map((x: Doc) => x.source_id));
    const ids = new Set<string>(s.source_ids);
    assertRule(s.source_generations.length === gens.size && gens.size === ids.size && subset(gens, ids), "snapshot source/generation identity mismatch");
  };
  const query = (q: Doc) => { snapshot(q.snapshot); assertRule(dt(q.window.from) < dt(q.window.to), "window must be nonempty half-open [from,to)"); };
  const axes = (s: Doc) => {
    if (s.outcome === "succeeded") assertRule(s.acceptance === "verified", "success requires verified acceptance");
    if (s.lifecycle === "closed") assertRule(!["pending", "unknown"].includes(s.outcome), "closed cannot have pending/unknown outcome");
  };
  const usage = (u: Doc) => {
    coverage(u.coverage);
    if (u.coverage.state === "unavailable") assertRule(USAGE_COUNTERS.every((k) => u[k] === null), "unavailable usage must report null counters, not zero");
    if (u.input_inclusive !== null)
      for (const k of ["cache_read_subset", "cache_write_subset"]) assertRule(u[k] === null || u[k] <= u.input_inclusive, "cache must be subset of inclusive input");
    const expected = u.input_inclusive === null || u.output === null ? null : u.input_inclusive + u.output;
    assertRule(u.total === expected, "total must be input plus output; cache is not additive");
    if (u.cost_basis === "unavailable") assertRule(u.cost_usd === null, "unavailable cost must be null");
    if (u.cost_basis !== "unavailable") assertRule(u.cost_usd !== null, "available cost basis requires value");
    if (u.cost_basis === "derived_estimate") assertRule(truthy(u.pricing_version), "derived estimate needs pricing version");
    if (u.granularity === "native_session") {
      assertRule(u.inclusion === "session_cumulative" && u.usage_semantics === "provider_session_only.v1", "session accounting cannot claim leaf semantics");
      assertRule(USAGE_COUNTERS.every((k) => u[k] === null), "session-only cost does not synthesize normalized leaf tokens");
      assertRule(["native_estimate", "unavailable"].includes(u.cost_basis), "native session never measured billing");
      if (u.cost_usd !== null)
        assertRule(u.native_baseline_usd !== null && u.native_cumulative_usd !== null && u.native_cumulative_usd >= u.native_baseline_usd && isclose(u.cost_usd, u.native_cumulative_usd - u.native_baseline_usd), "session delta needs non-reset baseline");
    } else assertRule(u.inclusion !== "session_cumulative", "leaf cannot claim cumulative session inclusion");
  };
  const budget = (b: Doc) => {
    assertRule(b.threshold_usd > 0, "paid dispatch threshold must be positive");
    assertRule(b.overshoot_possible === (b.mode === "native_spend_threshold"), "native threshold may overshoot; strict mode requires separate verified qualification");
    assertRule(disclosed(b.qualification), "budget qualification cannot rest on missing or unsupported evidence");
  };
  const walk = (o: any, level = 0): void => {
    if (level > 32) { errors.push("object depth exceeds validation budget"); return; }
    if (isObj(o)) {
      if (has(o, ["eligible", "covered", "excluded", "missing", "state", "reason", "exclusion_reasons"])) coverage(o);
      if (has(o, ["lifecycle", "outcome", "acceptance", "observability"])) axes(o);
      if (has(o, ["start", "end", "duration_ms", "clock"])) {
        assertRule(o.end === null || dt(o.end) >= dt(o.start), "interval cannot end before start");
        assertRule(o.duration_ms === null || o.clock.basis !== "unknown", "unknown clock cannot claim duration");
      }
      if (has(o, ["threshold_usd", "duration_limit_ms", "overshoot_possible", "qualification", "policy_hash", "mode"])) budget(o);
      if (has(o, ["source_id", "run_id", "execution_id", "host_session_id", "attempt_id", "logical_task_id", "request_id"]))
        assertRule(o.attempt_id === null || o.logical_task_id !== null, "attempt requires logical task");
      if (has(o, ["provider", "model", "status", "reason"])) {
        if (o.status === "observed") assertRule(o.model !== null, "observed identity needs observed model");
        if (o.status === "unavailable") assertRule(o.model === null && truthy(o.reason), "unavailable observed identity needs null model and reason");
      }
      for (const x of Object.values(o)) walk(x, level + 1);
    } else if (Array.isArray(o)) for (const x of o) walk(x, level + 1);
  };
  if (depth > 16) return ["nested projection exceeds validation budget"];
  walk(value);
  if ("query" in value) query(value.query);
  if ("snapshot" in value) snapshot(value.snapshot);
  const v = value;
  if (name === "scope-session") {
    const ids = [v.root.source_id, ...v.children.map((x: Doc) => x.source_id)];
    assertRule(ids.length === new Set(ids).size, "duplicate registered source");
    assertRule(v.mode === v.root.root_kind, "scope mode/root mismatch");
    assertRule(v.mode === "workspace" || !truthy(v.children), "project cannot enumerate children");
    assertRule(v.snapshot.source_ids.includes(v.root.source_id) && subset(v.snapshot.source_ids, new Set(ids)), "session snapshot must contain the root and only registered sources");
  } else if (name === "entity-evidence") {
    assertRule(v.evidence.every((x: Doc) => x.source_id === v.entity.source_id), "evidence crosses entity owner");
    assertRule(v.snapshot.source_ids.includes(v.entity.source_id), "entity owner outside its evidence snapshot");
  } else if (name === "read-projection") {
    const allowed = new Set<string>(v.snapshot.source_ids);
    for (const item of v.items) {
      assertRule(allowed.has(item.ref.source_id), "item outside source snapshot");
      const target = tables().v2NameByUri.get(item.body_schema_id);
      assertRule(target !== undefined && tables().projectionBodies.has(target), "body schema is not a public projection document; structured-refuse");
      if (target !== undefined && tables().projectionBodies.has(target)) {
        const nestedOk = shape(target, item.body);
        assertRule(nestedOk, "invalid typed projection body");
        if (nestedOk) {
          errors = errors.concat(stackV2SemanticErrors(target, item.body, shape, depth + 1));
          const bodySnapshot = "snapshot" in item.body ? item.body.snapshot : item.body.query?.snapshot;
          if (truthy(bodySnapshot)) assertRule(eq(bodySnapshot, v.snapshot), "projection cannot mix snapshots/generations");
          const ident = bodyIdentity(target, item.body);
          if (isObj(ident)) assertRule(eq(ident, item.ref), "typed body entity differs from containing ref");
          else if (ident) assertRule(ident[0] === item.ref.source_id && (ident[1] === null || (ident[1] === item.ref.kind && ident[2] === item.ref.id)), "typed body owner/identity differs from containing source-qualified ref");
          else assertRule(bodySnapshot !== null && bodySnapshot !== undefined && bodySnapshot.source_ids.includes(item.ref.source_id), "aggregate body must be scoped to the ref source snapshot");
        }
      }
    }
  } else if (name === "capability-manifest") {
    const keys = v.supported_contracts.map((x: Doc) => canonical([x.schema_id, x.schema_version]));
    assertRule(keys.length === new Set(keys).size, "duplicate capability contract");
    for (const op of v.operations) if (op.availability === "unavailable") assertRule(truthy(op.reason), "unavailable operation needs reason");
  } else if (name === "operation-preview") {
    const owner = v.source_id;
    assertRule(v.authority.controller_source_id === owner, "foreign controller authority");
    assertRule(v.targets.every((x: Doc) => x.source_id === owner) && v.effects.every((x: Doc) => x.target.source_id === owner), "preview writes escape owner");
    assertRule(v.effects.every((x: Doc) => includes(v.targets, x.target)), "effect target is not an exact reviewed preview target/revision");
    const op = tables().operations.get(v.operation);
    assertRule(op !== undefined, "operation is not in the pinned operation catalog");
    if (op) assertRule(v.input_schema_id === op.input_schema_id, "input schema differs from catalog operation input schema");
    const target = tables().v2NameByUri.get(v.input_schema_id);
    assertRule(target !== undefined, "unsupported input schema");
    if (target !== undefined) {
      const nestedOk = shape(target, v.arguments);
      assertRule(nestedOk, "invalid typed operation arguments");
      if (nestedOk) {
        errors = errors.concat(stackV2SemanticErrors(target, v.arguments, shape, depth + 1).map((e) => "arguments: " + e));
        if (op && target === "operation-arguments") {
          const a = v.arguments, auth = v.authority;
          assertRule(a.kind === op.argument_kind, "argument kind differs from catalog operation");
          if (a.target !== null) {
            assertRule(includes(v.targets, a.target), "argument target is not an exact preview target");
            assertRule(a.expected_revision === a.target.revision, "argument expected revision differs from target revision");
          }
          if (a.destination !== null) assertRule(includes([...v.targets, ...v.dependencies], a.destination), "argument destination is not bound by preview");
          for (const k of ["execution_id", "attempt_id"]) if (auth[k] !== null) assertRule(a[k] === auth[k], "argument " + k + " differs from preview authority");
          assertRule(a.policy_hash === v.policy_revision, "argument policy differs from preview policy revision");
          assertRule(eq(a.budget, v.budget), "outer preview budget differs from typed argument budget");
          if (a.budget !== null) assertRule(a.budget.policy_hash === a.policy_hash && a.budget.qualification.source_id === owner, "budget policy or qualification owner differs from preview controller");
          if (a.host_proof !== null) assertRule(a.host_proof.source_id === owner, "host proof is not recorded by the preview controller source");
        }
      }
    }
    assertRule(v.arguments_hash === stackContractDigest(v.arguments), "argument hash mismatch");
    const { preview_hash: _ph, ...rest } = v;
    assertRule(v.preview_hash === stackContractDigest(rest), "preview hash does not bind full authority/content");
  } else if (name === "operation-arguments") {
    if (v.kind === "launch") assertRule(v.budget !== null && v.workflow_hash !== null, "launch requires budget and workflow pin");
    if (["resume", "cancel", "seal"].includes(v.kind)) assertRule(v.target !== null && v.execution_id !== null && v.expected_revision !== null, "resume/cancel/seal must bind exact execution, target and revision");
    if (v.kind === "resume") assertRule(v.host_session_id !== null && v.attempt_id !== null && usable(v.host_proof), "resume requires exact observed host session, attempt and available proof");
    if (v.kind === "cancel") assertRule(v.attempt_id !== null && usable(v.host_proof), "cancel requires exact owned attempt and available proof; no latest fallback");
    if (v.budget !== null) assertRule(usable(v.budget.qualification), "paid dispatch budget requires available qualification evidence");
    if (v.kind === "transfer") assertRule(v.destination !== null && v.target !== null && v.expected_revision !== null, "transfer must bind source revision and destination");
  } else if (name === "approval-record" || name === "operation-receipt") {
    assertRule(v.authority.controller_source_id === v.source_id, "authority owner mismatch");
    if (name === "operation-receipt") {
      assertRule([...v.touched, ...v.evidence].every((x: Doc) => x.source_id === v.source_id), "receipt effects escape owner");
      if (v.effect_kind === "dispatch") assertRule(v.outcome === null, "dispatch receipt is not logical success");
      if (["failed", "recovery_needed"].includes(v.state)) assertRule(v.error !== null, "failed/recovery receipt needs reason");
    }
  } else if (name === "workflow-projection") {
    errors = errors.concat(workflowErrors(v));
  } else if (name === "metric-series") {
    const definition = tables().metrics.get(v.metric_id)!;
    const unit = definition.unit;
    assertRule(v.query.versions.formula === definition.formula_version, "metric formula version differs from pinned registry");
    if (v.metric_id === "M29.series_value") {
      const under = tables().metrics.get(v.underlying_metric_id);
      assertRule(under !== undefined, "M29 alias needs underlying scalar");
      if (under) assertRule(v.unit === under.unit && v.underlying_formula_version === under.formula_version, "M29 underlying unit/formula mismatch");
    } else assertRule(v.underlying_metric_id === null && v.underlying_formula_version === null && v.unit === unit, "scalar unit or unexpected alias mismatch");
    const expectedUnder = v.metric_id !== "M29.series_value" ? null : { metric_id: v.underlying_metric_id, formula_version: v.underlying_formula_version };
    assertRule(eq(v.query.underlying_scalar, expectedUnder), "query identity must carry exactly the M29 underlying scalar (null for ordinary scalars)");
    assertRule(v.usage_semantics === v.query.versions.usage_semantics, "series usage semantics differ from pinned query usage semantics");
    const effective = v.metric_id === "M29.series_value" ? v.underlying_metric_id : v.metric_id;
    const queryHash = stackContractDigest(v.query);
    for (const p of v.points) {
      assertRule(p.drilldown.query_hash === queryHash, "drilldown query identity mismatch");
      if (p.coverage.state !== "complete") assertRule(p.exact_total === null, "incomplete metric cannot claim exact total");
      if (p.coverage.state === "unavailable") assertRule(p.value === null && p.known_subtotal === null && truthy(p.reason), "unavailable metric must be null with reason");
      if (p.denominator === 0) assertRule(p.value === null && truthy(p.reason), "zero denominator is unavailable with an explicit reason, not zero score");
      if (p.value === null) assertRule(truthy(p.reason), "unavailable metric value needs an explicit reason independent of input coverage");
      if (UNSIGNED_UNITS.has(v.unit) && !tables().signedMetrics.has(effective))
        assertRule(["value", "known_subtotal", "exact_total", "numerator"].every((k) => p[k] === null || p[k] >= 0), "unsigned metric cannot be negative");
      if (p.value !== null) {
        if (v.unit === "ratio") assertRule(p.value >= 0 && p.value <= 1, "ratio outside0..1");
        if (v.unit === "count") assertRule(p.value >= 0 && Number.isInteger(p.value), "count must be nonnegative integer");
      }
      assertRule(p.evidence.every((x: Doc) => v.query.snapshot.source_ids.includes(x.source_id)), "metric evidence outside query sources");
      if (effective === "M10.native_estimate_usd") assertRule(p.cost_basis === "native_estimate", "native estimate cannot become measured billing");
      if (effective === "M10.derived_estimate_usd") assertRule(p.cost_basis === "derived_estimate", "derived estimate must retain basis");
      if (effective === "M10.measured_spend_usd") assertRule(p.cost_basis === "measured", "measured series cannot contain estimated cost");
      if (p.cost_basis === "derived_estimate") assertRule(v.pricing !== null && v.pricing.version === v.query.versions.pricing, "derived estimate needs pinned pricing matching query pricing version");
    }
  } else if (["execution-lineage", "execution-segment", "task-assignment", "task-attempt", "trace-analysis"].includes(name)) {
    const l = v.lineage;
    if ("authority" in v) assertRule(v.authority.controller_source_id === l.source_id && v.authority.execution_id === l.execution_id && v.authority.attempt_id === l.attempt_id, "lineage/authority mismatch");
    if (name === "task-assignment" || name === "task-attempt") assertRule(l.attempt_id !== null && l.logical_task_id !== null, "assignment/attempt missing immutable identity");
    const owned: any[] = ({
      "execution-lineage": () => [...(v.evidence ?? []), ...(v.handoffs ?? []).map((h: Doc) => h.evidence)],
      "execution-segment": () => [v.seal_evidence],
      "task-attempt": () => [v.assignment_ref, ...(v.result_refs ?? [])],
      "trace-analysis": () => [v.payload_ref],
    } as Record<string, () => any[]>)[name]?.() ?? [];
    assertRule(owned.every((e) => e === null || e === undefined || e.source_id === l.source_id), "lineage-owned evidence recorded by another source");
    if (name === "task-attempt" && v.state.outcome === "succeeded")
      assertRule(truthy(v.receipt_loss_reconciled) && !truthy(v.uncertain_effects) && v.accepted_by_controller_epoch !== null && v.acceptance_subject_hash !== null, "uncertain/unreconciled task cannot succeed");
    if (name === "trace-analysis") {
      if (["request_started", "request_completed"].includes(v.event_class)) assertRule(l.request_id !== null, "request event missing request id");
      if (truthy(v.usage)) usage(v.usage);
      if (truthy(v.usage) && v.usage.cost_basis === "derived_estimate") assertRule(v.observed_identity.status === "observed", "derived model pricing needs observed model, not requested fallback");
      if (v.observed_identity.status === "unavailable") assertRule(v.observed_identity.model === null && truthy(v.observed_identity.reason), "unobserved model cannot be requested-model fallback");
    }
  } else if (name === "knowledge-publication") {
    assertRule(v.basis.source_worktree_id === v.source_worktree_id, "scan worktree identity mismatch");
    assertRule(v.source_id === v.durable_owner_source_id, "durable publication owner mismatch");
    assertRule(v.source_basis_hash === stackContractDigest(v.basis), "knowledge source basis hash mismatch");
    assertRule(v.manifest.source_id === v.durable_owner_source_id, "publication manifest owner mismatch");
    assertRule(v.channels.length === new Set(v.channels.map((x: Doc) => canonical(x.channel))).size, "duplicate knowledge channel");
    for (const ch of v.channels) {
      assertRule(ch.basis_hash === v.source_basis_hash, "mixed source bases in publication");
      if (ch.state === "current_for_basis") assertRule(v.basis_verified_at !== null && ch.output !== null && ch.output.availability === "available" && ch.output.sha256 === ch.layer_hash, "unverified or missing generation cannot be fresh");
      if (truthy(ch.output) && ch.output.availability !== "available") assertRule(truthy(ch.output.reason), "unavailable generation output needs loss reason");
      if (truthy(ch.output)) assertRule(ch.output.source_id === v.durable_owner_source_id, "channel artifact owner mismatch");
    }
  } else if (name === "logical-run") {
    assertRule(v.controller.source_id === v.source_id, "logical run fixed-controller owner mismatch");
    assertRule(v.execution_refs.every((x: Doc) => x.source_id === v.source_id && x.kind === "execution"), "foreign execution reference");
    assertRule(v.initial_prompt_ref === null || v.initial_prompt_ref.source_id === v.source_id, "initial prompt evidence owner mismatch");
  } else if (name === "run-binding") {
    assertRule(v.controller_source_id === v.source_id, "binding controller moved to another source");
  } else if (name === "followup-transfer") {
    const stages = ["reserved", "target_prepared", "source_committed", "target_activated", "acknowledged"];
    const i = stages.indexOf(v.state);
    if (i >= 2) assertRule(disclosed(v.source_commit), "activation without retained source commit evidence");
    if (i >= 3) assertRule(disclosed(v.target_activation), "activation evidence absent or unavailable");
    if (v.state === "acknowledged") assertRule(disclosed(v.target_ack), "source completion needs retained target ack evidence");
  } else if (name === "run-analysis") {
    const seen = new Set<string>();
    for (const u of v.usage) {
      usage(u);
      const key = canonical(u.accounting_identity);
      assertRule(!seen.has(key), "duplicate accounting identity; normalized ledger keeps only current observation");
      seen.add(key);
      assertRule(u.inclusion !== "parent_inclusive", "normalized usage cannot bill parent-inclusive counters");
    }
    const sessionIds = new Set(v.usage.filter((u: Doc) => u.granularity === "native_session").map((u: Doc) => canonical(u.accounting_identity)));
    assertRule(!v.usage.some((u: Doc) => u.granularity === "leaf_request" && sessionIds.has(canonical(u.parent_accounting_identity))), "normalized ledger cannot overlap session and leaf scopes");
    for (const series of v.metrics) {
      errors = errors.concat(stackV2SemanticErrors("metric-series", series, shape, depth + 1));
      assertRule(eq(inputIdentity(series.query), inputIdentity(v.query)), "nested metric series input identity differs from enclosing analysis");
    }
    assertRule(v.run.kind === "run" && v.query.snapshot.source_ids.includes(v.run.source_id), "analysis source/run mismatch");
    assertRule(v.input_evidence.every((x: Doc) => v.query.snapshot.source_ids.includes(x.source_id)), "analysis input evidence outside query snapshot sources");
  } else if (name === "run-comparison") {
    const keys = v.runs.map((x: Doc) => canonical([x.source_id, x.id]));
    assertRule(keys.length === new Set(keys).size, "duplicate compared run");
    assertRule(v.runs.length === v.analysis_refs.length && v.analysis_refs.length === v.input_versions.length, "comparison input cardinality mismatch");
    assertRule([...v.runs, ...v.analysis_refs].every((x: Doc) => v.query.snapshot.source_ids.includes(x.source_id)), "comparison run or analysis ref outside query snapshot sources");
    if (v.compatibility === "compatible")
      assertRule(v.analysis_refs.every((e: Doc) => e.schema_version === "guild.run_analysis.v2") && v.input_versions.every((x: Doc) => eq(x, v.query.versions)), "incompatible analysis schema/normalizer/semantics/pricing versions cannot be ranked");
    assertRule((v.compatibility === "compatible") === !truthy(v.refusal_reasons), "comparison refusal state mismatch");
    for (const series of v.metrics) {
      errors = errors.concat(stackV2SemanticErrors("metric-series", series, shape, depth + 1));
      assertRule(eq(inputIdentity(series.query), inputIdentity(v.query)), "nested metric series input identity differs from enclosing comparison");
    }
  } else if (name === "evaluation-manifest") {
    const owner = v.evaluation.source_id;
    assertRule(v.evaluation.kind === "evaluation", "evaluation kind mismatch");
    assertRule(v.artifacts.every((x: Doc) => x.source_id === owner && String(x.path).startsWith("artifacts/generated/benchmarks/" + v.evaluation.id + "/")), "evaluation artifact owner/home mismatch");
    assertRule(disclosed(v.receipt), "evaluation receipt cannot rest on missing or unsupported evidence");
    assertRule(v.receipt.source_id === owner && v.budget.qualification.source_id === owner, "evaluation receipt/budget qualification owner mismatch");
    assertRule(v.linked_runs.every((x: Doc) => v.query.snapshot.source_ids.includes(x.source_id)), "evaluation linked run outside query snapshot sources");
  } else if (name === "report-manifest") {
    const owner = v.owner_source_id, ids = v.query.snapshot.source_ids;
    assertRule(v.report.kind === "report" && v.report.source_id === owner, "report owner mismatch");
    assertRule([...v.inputs, ...v.metric_series].every((x: Doc) => ids.includes(x.source_id)), "unlisted report source");
    assertRule(v.outputs.every((x: Doc) => x.source_id === owner && String(x.path).startsWith("artifacts/reports/" + v.report.id + "/")), "report output owner/home mismatch");
    assertRule(v.knowledge_generations.every((x: Doc) => ids.includes(x.source_id)), "report knowledge generation outside query snapshot sources");
    assertRule(disclosed(v.receipt), "report receipt cannot rest on missing or unsupported evidence");
    assertRule(v.receipt.source_id === owner, "report receipt owner mismatch");
    assertRule(v.coverage.state === "complete" || truthy(v.omissions), "incomplete report must disclose omissions");
  } else if (name === "negotiation") {
    const selected = v.selected_schema_version;
    if (v.status === "compatible") {
      const s = tables().byUri.get(v.selected_schema_id);
      assertRule(v.client_supported.includes(selected) && v.server_supported.includes(selected) && s !== undefined && s?.properties?.schema_version?.const === selected && v.error === null, "selected schema/version not supported by both");
    } else assertRule(selected === null && v.selected_schema_id === null && v.error !== null, "unsupported negotiation must refuse explicitly");
  } else if (name === "metric-drilldown") {
    assertRule(v.records.every((x: Doc) => v.snapshot.source_ids.includes(x.source_id)), "drilldown record outside snapshot sources");
  } else if (name === "read-request") {
    assertRule(v.query_hash === stackContractDigest(v.query) && tables().byUri.has(v.result_schema_id), "query hash or requested schema unsupported");
  }
  return errors;
}

function workflowErrors(v: Doc): string[] {
  const errors: string[] = [];
  const assertRule = (ok: boolean, message: string) => { if (!ok) errors.push(message); };
  const nodes = new Map<string, Doc>(v.nodes.map((x: Doc) => [x.id, x]));
  assertRule(nodes.size === v.nodes.length, "duplicate expanded node");
  assertRule(nodes.has(v.entry), "unknown graph entry");
  assertRule(v.edges.every((x: Doc) => nodes.has(x.from) && nodes.has(x.to)), "unknown expanded edge endpoint");
  const gates = new Set<string>(v.protected_gates);
  assertRule(subset(gates, new Set(nodes.keys())), "unknown protected gate");
  const roles = new Map<string, string>();
  for (const n of v.nodes)
    if (n.gate_role !== null) {
      assertRule(n.effect === "gate", "gate role requires gate effect");
      assertRule(gates.has(n.id), "gate-role node must be protected");
      assertRule(!roles.has(n.gate_role), "duplicate gate role");
      roles.set(n.gate_role, n.id);
    }
  const known = [...gates].filter((g) => nodes.has(g));
  assertRule(known.every((g) => nodes.get(g)!.effect === "gate" && nodes.get(g)!.gate_role !== null), "protected gate must be a gate-effect node with a semantic gate role");
  assertRule(known.every((g) => truthy(nodes.get(g)!.required)) && v.nodes.every((n: Doc) => n.gate_role === null || truthy(n.required)), "protected gate cannot be made skippable (required=false)");
  assertRule((REQUIRED_GATE_ROLES[v.class] ?? []).every((r) => roles.has(r)), v.class + " required gate roles missing");
  if (v.nodes.some((n: Doc) => n.effect === "release"))
    assertRule([...RELEASE_GATE_ROLES, ...(RELEASE_CLASS_GATE_ROLES[v.class] ?? [])].every((r) => roles.has(r)), "release effect requires non-waivable protected gate roles in every class");
  for (const n of v.nodes)
    if (n.within_gate !== null) {
      assertRule(n.gate_role === null && roles.has(n.within_gate), "nested gate scope must name an existing protected gate role");
      assertRule(!["release", "privileged_operation", "gate"].includes(n.effect), "nested gate scope cannot hold release, privileged or gate effects");
    }
  const inQa = (id: string) => nodes.has(id) && [nodes.get(id)!.gate_role, nodes.get(id)!.within_gate].includes("qa");
  const pending: Array<[string, Set<string>]> = [[v.entry, new Set()]];
  const seen = new Set<string>();
  while (pending.length && seen.size <= 10000) {
    const [node, before] = pending.pop()!;
    if (!nodes.has(node)) continue;
    const passed = new Set(before);
    if (gates.has(node)) passed.add(node);
    const state = JSON.stringify([node, [...passed].sort()]);
    if (seen.has(state)) continue;
    seen.add(state);
    if (nodes.get(node)!.effect === "release") assertRule(subset(gates, passed), "release path bypasses protected gate");
    for (const e of v.edges) if (e.from === node) pending.push([e.to, passed]);
  }
  assertRule(seen.size <= 10000, "path proof budget exceeded");
  const invs = new Map<string, Doc>(v.invocations.map((x: Doc) => [x.id, x]));
  assertRule(invs.size === v.invocations.length, "duplicate invocation");
  for (const inv of v.invocations) {
    assertRule(inv.round <= inv.max_rounds, "round exceeds bound");
    assertRule(inv.state !== "accepted" || !truthy(inv.unresolved_questions), "exhaustion cannot accept unresolved questions");
    assertRule(inv.definition_hash === v.definition_hash, "invocation definition changed");
    assertRule(nodes.has(inv.node_id), "invocation references unknown node");
  }
  assertRule(v.obligations.length === new Set(v.obligations.map((x: Doc) => x.id)).size, "duplicate obligation");
  for (const ob of v.obligations) {
    const inv = invs.get(ob.invocation_id);
    assertRule(nodes.has(ob.node_id), "obligation references unknown node");
    assertRule(inv !== undefined, "obligation references unknown invocation");
    if (QA_ASSURANCE_KINDS.has(ob.kind)) assertRule(inQa(ob.node_id) && (inv === undefined || inQa(inv.node_id)), "security/adversarial/UI/UX assurance must execute inside the semantic QA gate scope");
    if (inv) {
      assertRule(inv.node_id === ob.node_id, "obligation/invocation node mismatch");
      assertRule(ob.subject_hash === inv.subject_hash, "obligation subject differs from invocation subject");
      assertRule(ob.round <= inv.round, "obligation round beyond invocation round");
    }
    if (ob.status === "accepted") {
      assertRule(inv !== undefined && inv.state === "accepted" && ob.round === inv.round, "accepted obligation needs an accepted invocation at the same round");
      assertRule(truthy(ob.evidence) && ob.evidence.every((e: Doc) => e.availability === "available" && e.source_id === v.workflow.source_id), "accepted obligation needs available workflow-owner evidence");
    }
  }
  return errors;
}

const V1_CLASS_ENTRY: Record<string, string> = { product: "intake", research: "recall", debug: "recall", ops: "ops.first-run", init: "detect" };

/**
 * Frozen v1 semantic rules for one shape-valid v1 document (port of
 * contracts/guild-stack/v1/verify_contracts.py semantic_errors; same messages and order).
 * `check` validates arguments against the catalog operation input schema.
 */
export function stackV1SemanticErrors(name: string, v: Doc, check: (schemaId: string, value: unknown) => boolean): string[] {
  const errors: string[] = [];
  const assertRule = (ok: boolean, message: string) => { if (!ok) errors.push(message); };
  const owned = (refs: Doc[], owner: string) => refs.every((x) => x.source_id === owner);
  if (name === "scope-session") {
    assertRule(v.root.kind === v.mode, "root kind disagrees with mode");
    assertRule(v.mode !== "project" || !truthy(v.children), "project mode cannot federate children");
    const sources = [v.root, ...v.children];
    assertRule(new Set(sources.map((x: Doc) => x.source_id)).size === sources.length, "duplicate source ids");
    assertRule(new Set(sources.map((x: Doc) => x.realpath)).size === sources.length, "aliased physical roots");
    assertRule(v.children.every((x: Doc) => x.kind === "project"), "nested workspace forbidden");
  } else if (name === "read-projection") {
    assertRule(!truthy(v.source_errors) || truthy(v.partial), "source failures must mark partial");
    assertRule(v.total === null || v.total >= v.items.length, "total smaller than page");
  } else if (name === "operation-preview") {
    const { preview_hash: _ph, ...content } = v;
    assertRule(v.preview_hash === stackContractDigest(content), "preview hash does not bind exact content");
    const op = tables().v1Operations.get(v.operation);
    assertRule(op !== undefined, "unknown operation");
    if (op) {
      assertRule(check(op.input_schema, v.arguments), "invalid typed operation arguments");
      assertRule(op.approval !== "required" || truthy(v.approval_required), "required approval bypass");
      assertRule(v.targets.every((x: Doc) => op.target_kinds.includes(x.kind)), "operation target kind mismatch");
    }
    assertRule(owned(v.targets, v.source_id), "target ownership mismatch");
    const refs: Doc[] = [];
    const collect = (x: any): void => {
      if (isObj(x)) { if (has(x, ["source_id", "kind", "id", "revision"])) refs.push(x); for (const c of Object.values(x)) collect(c); }
      else if (Array.isArray(x)) for (const c of x) collect(c);
    };
    collect(v.arguments);
    const key = (x: Doc) => canonical([x.source_id, x.kind, x.id, x.revision]);
    const declared = new Set([...v.targets, ...v.dependencies].map(key));
    assertRule(refs.every((x) => declared.has(key(x))), "argument ref outside reviewed envelope");
    const targetArg = isObj(v.arguments) ? v.arguments.target : undefined;
    assertRule(targetArg === null || targetArg === undefined || new Set(v.targets.map(key)).has(key(targetArg)), "argument target is not a writable target");
    const revs = new Map<string, string>();
    for (const item of [...v.targets, ...v.dependencies]) {
      const identity = canonical([item.source_id, item.kind, item.id]);
      assertRule(!revs.has(identity) || revs.get(identity) === item.revision, "conflicting revisions for same ref");
      revs.set(identity, item.revision);
    }
    assertRule(owned(v.diff.map((x: Doc) => x.target), v.source_id), "diff ownership mismatch");
    const targetKeys = new Set(v.targets.map((x: Doc) => canonical([x.kind, x.id, x.revision])));
    assertRule(v.diff.every((x: Doc) => targetKeys.has(canonical([x.target.kind, x.target.id, x.target.revision]))), "diff outside reviewed targets");
    assertRule(v.policy.decision !== "refused" || !truthy(v.diff), "refused preview carries writable diff");
  } else if (name === "approval-record") {
    assertRule(v.decision === "approved" || truthy(pyStrip(String(v.rationale))), "rejection/return requires rationale");
  } else if (name === "operation-receipt") {
    assertRule(tables().v1Operations.has(v.operation), "unknown receipt operation");
    assertRule(owned([...v.before, ...v.after, ...v.touched], v.source_id), "receipt effects cross owning source");
    assertRule(!["applied", "verified", "handoff"].includes(v.state) || v.error === null, "successful receipt carries error");
    assertRule(!["failed", "recovery_needed"].includes(v.state) || v.error !== null, "failed receipt missing diagnostic");
  } else if (name === "capability-manifest") {
    const ids = v.operations.map((x: Doc) => x.id);
    assertRule(ids.length === new Set(ids).size, "duplicate capability ids");
    for (const op of v.operations) {
      const known = tables().v1Operations.get(op.id);
      assertRule(known !== undefined, "unknown capability");
      if (known) {
        assertRule(op.producer === known.producer && op.effect === known.effect, "capability effect/producer differs from contract");
        assertRule(known.approval !== "required" || op.approval === "required", "manifest weakens approval");
        assertRule(op.target_kinds.every((k: string) => known.target_kinds.includes(k)), "capability widens target kinds");
        assertRule(op.input_schema === known.input_schema && op.output_schema === known.output_schema, "capability schema differs from catalog");
      }
      assertRule(op.availability !== "available" || truthy(op.entry_id), "available capability without executable binding");
      assertRule(op.availability !== "unavailable" || truthy(op.reason), "unavailable capability without reason");
    }
    for (const host of v.host_requirements) assertRule(host.evidence !== "verified" || truthy(host.proof), "verified host missing proof");
  } else if (name === "workflow-projection") {
    const nodes = new Map<string, Doc>(v.nodes.map((n: Doc) => [n.id, n]));
    assertRule(nodes.size === v.nodes.length, "duplicate workflow node");
    assertRule(nodes.has(v.entry), "entry is not a node");
    assertRule(v.edges.every((x: Doc) => nodes.has(x.from) && (nodes.has(x.to) || x.to_class !== null)), "dangling workflow edge");
    if (truthy(v.execution)) assertRule(nodes.has(v.execution.cursor_node), "unknown execution cursor");
    assertRule(v.entry === V1_CLASS_ENTRY[v.class], "noncanonical class entry");
    if (v.class === "product") {
      const gates = ["d5", "product.qa", "d8"];
      assertRule(gates.every((k) => nodes.has(k) && truthy(nodes.get(k)!.required)), "product mandatory gates missing");
      const seen = new Set<string>(), seenNodes = new Set<string>();
      const pending: Array<[string, string[]]> = [[v.entry, []]];
      while (pending.length) {
        const [nodeId, before] = pending.pop()!;
        const state = JSON.stringify([nodeId, before]);
        if (seen.has(state) || !nodes.has(nodeId)) continue;
        seen.add(state); seenNodes.add(nodeId);
        let passed = before;
        if (gates.includes(nodeId)) {
          const position = gates.indexOf(nodeId);
          assertRule(gates.slice(0, position).every((g) => passed.includes(g)), "mandatory gate ordering bypass");
          passed = gates.filter((g) => passed.includes(g) || g === nodeId);
        }
        const outgoing = v.edges.filter((x: Doc) => x.from === nodeId && x.to_class === null);
        const exitsClass = v.edges.some((x: Doc) => x.from === nodeId && x.to_class !== null);
        const terminal = nodes.get(nodeId)!.terminal_outcome;
        const successfulTerminal = !outgoing.length && !exitsClass && !["blocked", "failed", "escalate"].includes(terminal);
        if (successfulTerminal || nodes.get(nodeId)!.station === "ops-runbooks") assertRule(gates.every((g) => passed.includes(g)), "terminal path bypasses mandatory gates");
        for (const edge of outgoing) pending.push([edge.to, passed]);
      }
      assertRule(gates.every((g) => seenNodes.has(g)), "mandatory gate unreachable");
    }
  } else if (name === "metric-series") {
    assertRule(v.covered_samples <= v.sample_count, "coverage exceeds samples");
    assertRule(dt(v.cohort.from) <= dt(v.cohort.to), "reversed cohort window");
    for (const p of v.points) {
      assertRule(p.status !== "unavailable" || (p.value === null && truthy(p.reason)), "unavailable measurement must be null with reason");
      assertRule(p.status !== "measured" || p.value !== null, "measured point cannot be null");
      assertRule(p.denominator !== 0 || p.value === null, "zero denominator cannot yield a score");
    }
  } else if (name === "evaluation-manifest") {
    assertRule(v.evaluation.kind === "evaluation", "evaluation ref has wrong kind");
    assertRule(owned([...v.artifacts, v.receipt], v.evaluation.source_id), "evaluation outputs escape owner");
    const prefix = "artifacts/generated/benchmarks/" + v.evaluation.id + "/";
    assertRule(v.artifacts.every((x: Doc) => String(x.path).startsWith(prefix)), "evaluation output outside evaluation artifact home");
  } else if (name === "report-manifest") {
    const owner = v.owner_source_id;
    assertRule(v.report.kind === "report" && v.report.source_id === owner, "report identity/owner mismatch");
    assertRule(v.inputs.every((x: Doc) => v.input_source_ids.includes(x.source_id)), "unlisted report input source");
    assertRule(owned([...v.outputs.map((x: Doc) => x.evidence), v.receipt], owner), "report outputs escape owner");
    const prefix = "artifacts/reports/" + v.report.id + "/";
    assertRule(v.outputs.every((x: Doc) => String(x.evidence.path).startsWith(prefix)), "report output outside report artifact home");
    assertRule(v.coverage === "complete" || truthy(v.omissions), "incomplete report must disclose omissions");
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Reader surface: negotiation, document read, structured refusal
// ---------------------------------------------------------------------------
export interface StackReaderOptions { check: StackSchemaCheck; profile?: StackReaderProfile }
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function stackRefusal(requestId: string, code: string, message: string): Doc {
  return { schema_version: "guild.stack.refusal.v2", request_id: requestId, code, message: message.slice(0, 4096), retryable: false, expected_snapshot: null, observed_snapshot: null };
}

export function createStackContractReader(opts: StackReaderOptions) {
  const profile = opts.profile ?? "v1+v2";
  const server = stackReaderVersions(profile);
  const ok = (schemaId: string, value: unknown) => { try { opts.check(schemaId, value); return true; } catch { return false; } };
  const shape = (name: string, value: unknown) => ok(V2_PREFIX + name + ".schema.json", value);
  const self = (name: string, doc: Doc) => {
    if (!shape(name, doc) || stackV2SemanticErrors(name, doc, shape).length) throw new Error("reader produced an invalid " + name);
    return doc;
  };
  const requestId = (x: unknown) => (typeof x === "string" && ID.test(x) ? x : "invalid-request");

  /** Exact version intersection in client preference order; no intersection refuses. */
  function negotiate(input: { request_id?: unknown; client_supported?: unknown }): Doc {
    const id = requestId(input?.request_id);
    const client = input?.client_supported;
    if (id !== input?.request_id || !Array.isArray(client) || client.length < 1 || client.length > 100 || client.some((x) => typeof x !== "string" || !x || x.length > 4096) || new Set(client).size !== client.length)
      return self("refusal", stackRefusal(id, "invalid_request", "negotiation needs request_id and 1..100 unique client_supported versions"));
    const selected = (client as string[]).find((x) => server.includes(x)) ?? null;
    const contract = selected ? tables().byVersion.get(selected)! : null;
    return self("negotiation", {
      schema_version: "guild.stack.negotiation.v2", request_id: id, client_supported: client, server_supported: server,
      selected_schema_id: contract?.schema_id ?? null, selected_schema_version: selected,
      status: contract ? "compatible" : "unsupported",
      error: contract ? null : { code: "unsupported_schema", message: "No exact schema version is supported by both reader and client", retryable: false },
    });
  }

  /** Returns the validated document unchanged, or a guild.stack.refusal.v2 document. */
  function read(input: { request_id?: unknown; accept?: unknown; document?: unknown }): Doc {
    const id = requestId(input?.request_id);
    const accept = input?.accept;
    if (id !== input?.request_id || !Array.isArray(accept) || accept.length < 1 || accept.some((x) => typeof x !== "string"))
      return self("refusal", stackRefusal(id, "invalid_request", "read needs request_id and the negotiated accept list"));
    const doc = input.document;
    const version = isObj(doc) && typeof doc.schema_version === "string" ? doc.schema_version : null;
    const contract = version ? tables().byVersion.get(version) : undefined;
    if (!version || !contract || !server.includes(version) || !accept.includes(version))
      return self("refusal", stackRefusal(id, "unsupported_schema", "Document schema_version " + JSON.stringify(version) + " was not negotiated with this reader"));
    if (nonInteroperable(doc))
      return self("refusal", stackRefusal(id, "invalid_request", "Document is not interoperable JSON (non-finite number, unsafe integer or lone surrogate)"));
    if (!ok(contract.schema_id, doc))
      return self("refusal", stackRefusal(id, "invalid_request", "Document violates " + contract.schema_version));
    let errors: string[];
    try {
      errors = contract.major === "v1" ? stackV1SemanticErrors(contract.name, doc as Doc, ok) : stackV2SemanticErrors(contract.name, doc as Doc, shape);
    } catch {
      errors = ["document cannot be evaluated by the semantic validator"];
    }
    if (errors.length) return self("refusal", stackRefusal(id, "invalid_request", contract.schema_version + " semantic refusal: " + errors.slice(0, 5).join("; ")));
    return doc as Doc;
  }
  return { profile, versions: server, negotiate, read };
}

// ---------------------------------------------------------------------------
// Activation barrier: MG3–MG8 need this receipt with exact reader versions
// ---------------------------------------------------------------------------
export interface StackReaderCheckpoint {
  reader_id: string;
  v1_contract_sha256: string;
  v2_contract_sha256: string;
  versions: string[];
  v2_writers: typeof STACK_V2_WRITERS;
  activation_gates: string[];
}
export function stackReaderCheckpoint(profile: StackReaderProfile = "v1+v2"): StackReaderCheckpoint {
  return {
    reader_id: STACK_READER_ID,
    v1_contract_sha256: stackContractDigest(v1Bundle),
    v2_contract_sha256: stackContractDigest(v2Bundle),
    versions: stackReaderVersions(profile),
    v2_writers: STACK_V2_WRITERS,
    activation_gates: [...STACK_V2_ACTIVATION_GATES],
  };
}
/**
 * Reader prerequisite for a migration step. Refuses unless `receipt` is this
 * installed reader's exact checkpoint. Satisfying it never enables a v2 writer.
 */
export function stackReaderPrerequisite(receipt: unknown, requestId = "reader-prerequisite"): { satisfied: true; v2_writers: typeof STACK_V2_WRITERS } | Doc {
  if (!ID.test(requestId)) requestId = "invalid-request";
  if (!isObj(receipt)) return stackRefusal(requestId, "unsupported_capability", "A04 reader checkpoint receipt is missing");
  if (!eq(receipt, stackReaderCheckpoint())) return stackRefusal(requestId, "unsupported_capability", "Installed reader versions differ from the A04 reader checkpoint receipt");
  return { satisfied: true, v2_writers: STACK_V2_WRITERS };
}

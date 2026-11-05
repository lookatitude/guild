/**
 * workflow-protected-paths.ts — W02 post-expansion protected-path verifier for a
 * C8 WorkflowProjection v2 (compiled by W01 or supplied as bytes).
 *
 * Rules, all on the EXPANDED graph and all by dominance from the entry:
 *   - every reachable release node is dominated by every protected gate;
 *   - protected gates keep the canonical order d5 → qa → ops → d8 (each earlier
 *     gate dominates each later one present);
 *   - a privileged operation is dominated by the D5 gate;
 *   - a node scoped `within_gate: R` runs after the gates before R and before R's
 *     gate; a required one lies on every path to R's gate, so it cannot be skipped;
 *   - a node whose capabilities, role or output types are release-like or
 *     privileged must carry that effect, so an effect label cannot hide it;
 *   - a protected gate or release node unreachable from the entry is refused
 *     rather than passing vacuously.
 *
 * Dominance ("every path from entry to T visits G") is computed as "T is not
 * reachable from entry once G is removed": linear per gate, no path-state budget.
 *
 * Graph dominance does not authorize release on its own; a privileged operation
 * still needs a source-qualified operation grant at runtime (R02/R04).
 */

import { classifyActionTokens } from "../security";
import { WORKFLOW_CLASSES } from "./workflow-graph-overlay";

export const PROTECTED_PATHS_VERSION = "guild.protected_paths.v1" as const;

/** Canonical protected gate order. */
export const GATE_ORDER = Object.freeze(["d5", "qa", "ops", "d8"] as const);
type GateRole = (typeof GATE_ORDER)[number];

const EFFECTS = ["read", "write", "review", "gate", "privileged_operation", "release"] as const;
type Effect = (typeof EFFECTS)[number];

/** Mirrors verify_contracts.py (frozen A02). */
const CLASS_REQUIRED_GATE_ROLES: Readonly<Record<string, readonly GateRole[]>> = Object.freeze({ product: ["d5", "qa", "d8"] });
const RELEASE_REQUIRED_GATE_ROLES: readonly GateRole[] = ["d5", "qa", "d8"];
const RELEASE_CLASS_GATE_ROLES: Readonly<Record<string, readonly GateRole[]>> = Object.freeze({ ops: ["ops"] });
export const QA_ASSURANCE_KINDS = Object.freeze(["security", "adversarial_security", "ui", "ux"] as const);

const LIMITS = { nodes: 1000, edges: 5000, gates: 10, list: 50, obligations: 200, values: 200_000, depth: 32 };
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ProtectedPathRule =
  | "invalid-projection"
  | "gate-not-protected"
  | "class-gate-missing"
  | "gate-unreachable"
  | "release-unreachable"
  | "release-bypasses-gate"
  | "gate-order"
  | "privileged-ungated"
  | "invalid-gate-scope"
  | "assurance-outside-gate"
  | "disguised-release"
  | "disguised-privileged";

export interface ProtectedPathViolation { rule: ProtectedPathRule; detail: string }
export type ProtectedPathResult = { ok: true } | { ok: false; violations: ProtectedPathViolation[] };

interface PNode {
  id: string;
  effect: Effect;
  gate_role: GateRole | null;
  within_gate: GateRole | null;
  required: boolean;
  role: string;
  capabilities: string[];
  outputTypes: string[];
}

interface Parsed {
  cls: string;
  nodes: PNode[];
  edges: Array<{ from: string; to: string }>;
  entry: string;
  protectedGates: string[];
  obligations: Array<{ id: string; kind: string; node_id: string }>;
}

class Invalid extends Error {}
const invalid = (why: string): never => {
  throw new Invalid(why);
};

/** Copy into plain JSON data before reading: accessors, symbols, toJSON and exotic prototypes are refused. */
function snapshot(value: unknown): unknown {
  let budget = LIMITS.values;
  const walk = (v: unknown, depth: number, at: string): unknown => {
    if (--budget < 0) invalid(`projection holds more than ${LIMITS.values} values`);
    if (depth > LIMITS.depth) invalid(`${at} nests too deep`);
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : invalid(`${at} is not finite`);
    if (typeof v !== "object") return invalid(`${at} holds a ${typeof v}`);
    const isArr = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (isArr ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) invalid(`${at} is not plain data`);
    const keys = Reflect.ownKeys(v as object);
    if (isArr && keys.length !== (v as unknown[]).length + 1) invalid(`${at} is a sparse or decorated array`);
    const out: Record<string, unknown> | unknown[] = isArr ? [] : {};
    for (const k of keys) {
      if (typeof k === "symbol") invalid(`${at} carries a symbol key`);
      if (isArr && k === "length") continue;
      if (k === "toJSON" || k === "__proto__") invalid(`${at} carries reserved key '${String(k)}'`);
      const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (!("value" in d) || !d.enumerable) invalid(`${at}.${String(k)} is an accessor or hidden property`);
      if (isArr && !/^(0|[1-9][0-9]*)$/.test(k as string)) invalid(`${at} is a decorated array`);
      (out as Record<string, unknown>)[k as string] = walk(d.value, depth + 1, `${at}.${String(k)}`);
    }
    return out;
  };
  return walk(value, 0, "projection");
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isRole = (v: unknown): v is GateRole => (GATE_ORDER as readonly unknown[]).includes(v);

function idList(v: unknown, max: number, at: string): string[] {
  if (!Array.isArray(v) || v.length > max || !v.every((x) => typeof x === "string" && ID.test(x))) invalid(`${at} must be at most ${max} ids`);
  return v as string[];
}

function parse(raw: unknown): Parsed {
  const p = snapshot(raw);
  if (!isObj(p)) return invalid("projection is not a mapping");
  if (!(WORKFLOW_CLASSES as readonly unknown[]).includes(p.class)) invalid(`class '${String(p.class)}' is not one of the five classes`);
  if (!Array.isArray(p.nodes) || p.nodes.length === 0 || p.nodes.length > LIMITS.nodes) invalid(`nodes must hold 1..${LIMITS.nodes} entries`);
  const nodes: PNode[] = (p.nodes as unknown[]).map((n, i) => {
    if (!isObj(n)) return invalid(`nodes[${i}] is not a mapping`);
    if (typeof n.id !== "string" || !ID.test(n.id)) invalid(`nodes[${i}].id is not an id`);
    if (!(EFFECTS as readonly unknown[]).includes(n.effect)) invalid(`node ${String(n.id)} effect '${String(n.effect)}' is not a C8 effect`);
    if (n.gate_role !== null && !isRole(n.gate_role)) invalid(`node ${String(n.id)} gate_role is not a gate role`);
    if (n.within_gate !== null && !isRole(n.within_gate)) invalid(`node ${String(n.id)} within_gate is not a gate role`);
    if (typeof n.required !== "boolean") invalid(`node ${String(n.id)} required must be boolean`);
    if (typeof n.role !== "string" || !ID.test(n.role)) invalid(`node ${String(n.id)} role is not an id`);
    const outputs = n.outputs;
    if (!Array.isArray(outputs) || outputs.length > LIMITS.list || !outputs.every((o) => isObj(o) && typeof o.type === "string")) invalid(`node ${String(n.id)} outputs must be typed ports`);
    return {
      id: n.id as string,
      effect: n.effect as Effect,
      gate_role: n.gate_role as GateRole | null,
      within_gate: n.within_gate as GateRole | null,
      required: n.required as boolean,
      role: n.role as string,
      capabilities: idList(n.capabilities, LIMITS.list, `node ${String(n.id)} capabilities`),
      outputTypes: (outputs as Array<{ type: string }>).map((o) => o.type),
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) invalid("duplicate expanded node id");
  if (!Array.isArray(p.edges) || p.edges.length > LIMITS.edges) invalid(`edges must hold at most ${LIMITS.edges} entries`);
  const edges = (p.edges as unknown[]).map((e, i) => {
    if (!isObj(e) || typeof e.from !== "string" || typeof e.to !== "string") return invalid(`edges[${i}] is not {from, to, on}`);
    if (!ids.has(e.from) || !ids.has(e.to)) invalid(`edge ${e.from} -> ${e.to} names an unknown node`);
    return { from: e.from, to: e.to };
  });
  if (typeof p.entry !== "string" || !ids.has(p.entry)) invalid(`entry '${String(p.entry)}' is not a node`);
  const protectedGates = idList(p.protected_gates, LIMITS.gates, "protected_gates");
  if (new Set(protectedGates).size !== protectedGates.length) invalid("protected_gates repeats an entry");
  const rawObs = p.obligations ?? [];
  if (!Array.isArray(rawObs) || rawObs.length > LIMITS.obligations) invalid(`obligations must hold at most ${LIMITS.obligations} entries`);
  const obligations = (rawObs as unknown[]).map((o, i) => {
    if (!isObj(o) || typeof o.id !== "string" || typeof o.kind !== "string" || typeof o.node_id !== "string") return invalid(`obligations[${i}] lacks id/kind/node_id`);
    return { id: o.id, kind: o.kind, node_id: o.node_id };
  });
  return { cls: p.class as string, nodes, edges, entry: p.entry as string, protectedGates, obligations };
}

/** Verify a C8 v2 projection's protected paths. Pure, deterministic, never throws on bad input. */
export function verifyProtectedPaths(raw: unknown): ProtectedPathResult {
  let g: Parsed;
  try {
    g = parse(raw);
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, violations: [{ rule: "invalid-projection", detail: err.message }] };
    throw err;
  }
  const found = new Map<string, ProtectedPathViolation>();
  const flag = (rule: ProtectedPathRule, detail: string) => found.set(`${rule}\u0000${detail}`, { rule, detail });

  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const succ = new Map<string, string[]>();
  for (const e of g.edges) succ.set(e.from, [...(succ.get(e.from) ?? []), e.to]);
  const reachFrom = (start: string, without: string | null): Set<string> => {
    const seen = new Set<string>();
    if (start === without) return seen;
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const to of succ.get(id) ?? []) if (to !== without && !seen.has(to)) stack.push(to);
    }
    return seen;
  };
  const reach = reachFrom(g.entry, null);
  const withoutCache = new Map<string, Set<string>>();
  const reachWithout = (id: string) => {
    let s = withoutCache.get(id);
    if (!s) withoutCache.set(id, (s = reachFrom(g.entry, id)));
    return s;
  };
  /** Every path from entry to `target` visits `d` (vacuously true for an unreachable target). */
  const dominates = (d: string, target: string) => d === target || !reachWithout(d).has(target);

  // Gate identity: each gate effect carries a role, each role is unique, required and protected.
  const gateOf = new Map<GateRole, string>();
  for (const n of g.nodes) {
    if (n.effect === "gate" && n.gate_role === null) flag("gate-not-protected", `gate node ${n.id} has no gate_role`);
    if (n.gate_role === null) continue;
    if (n.effect !== "gate") flag("gate-not-protected", `node ${n.id} holds gate role ${n.gate_role} without a gate effect`);
    if (!n.required) flag("gate-not-protected", `gate ${n.id} cannot be made skippable (required=false)`);
    if (!g.protectedGates.includes(n.id)) flag("gate-not-protected", `gate ${n.id} (${n.gate_role}) is missing from protected_gates`);
    if (gateOf.has(n.gate_role)) flag("gate-not-protected", `gate role ${n.gate_role} is held by both ${gateOf.get(n.gate_role)} and ${n.id}`);
    else gateOf.set(n.gate_role, n.id);
  }
  for (const id of g.protectedGates) {
    const n = byId.get(id);
    if (!n || n.gate_role === null) flag("gate-not-protected", `protected gate ${id} is not a gate-role node`);
  }
  const missingClass = (CLASS_REQUIRED_GATE_ROLES[g.cls] ?? []).filter((r) => !gateOf.has(r));
  if (missingClass.length) flag("class-gate-missing", `${g.cls} requires gate roles ${missingClass.join(", ")}`);
  const releases = g.nodes.filter((n) => n.effect === "release");
  if (releases.length) {
    const missing = [...RELEASE_REQUIRED_GATE_ROLES, ...(RELEASE_CLASS_GATE_ROLES[g.cls] ?? [])].filter((r) => !gateOf.has(r));
    if (missing.length) flag("class-gate-missing", `release work requires gate roles ${missing.join(", ")}`);
  }

  const gateNodes = g.nodes.filter((n) => n.gate_role !== null).map((n) => n.id);
  for (const id of gateNodes) if (!reach.has(id)) flag("gate-unreachable", `protected gate ${id} is not reachable from entry ${g.entry}`);

  // Disguise: what a node can do (capabilities, role, output types) must match its effect.
  for (const n of g.nodes) {
    const c = classifyActionTokens([...n.capabilities, n.role, ...n.outputTypes]);
    if (c.release.length && n.effect !== "release") flag("disguised-release", `node ${n.id} carries release-like ${c.release.join(", ")} under effect '${n.effect}'`);
    if (c.privileged.length && n.effect !== "privileged_operation" && n.effect !== "release") {
      flag("disguised-privileged", `node ${n.id} carries privileged ${c.privileged.join(", ")} under effect '${n.effect}'`);
    }
  }

  // Release dominance.
  for (const r of releases) {
    if (!reach.has(r.id)) {
      flag("release-unreachable", `release node ${r.id} is not reachable from entry ${g.entry}; its gating cannot be proven`);
      continue;
    }
    const skipped = gateNodes.filter((gid) => !dominates(gid, r.id));
    if (skipped.length) flag("release-bypasses-gate", `release node ${r.id} is reachable without passing ${skipped.join(", ")}`);
  }

  // Canonical gate order.
  const rank = (r: GateRole) => GATE_ORDER.indexOf(r);
  const present = [...gateOf.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const [ra, a] = present[i], [rb, b] = present[j];
      if (reach.has(b) && !dominates(a, b)) flag("gate-order", `gate ${b} (${rb}) is reachable without passing ${a} (${ra}); order is ${GATE_ORDER.join(" -> ")}`);
    }
  }

  // Privileged operations sit behind D5.
  const d5 = gateOf.get("d5");
  for (const n of g.nodes) {
    if (n.effect !== "privileged_operation") continue;
    if (!d5) flag("privileged-ungated", `privileged operation ${n.id} needs a D5 gate and the graph has none`);
    else if (!dominates(d5, n.id)) flag("privileged-ungated", `privileged operation ${n.id} is reachable without passing D5 gate ${d5}`);
  }

  // Gate scopes: run after the earlier gates and before the scoped gate; required ones cannot be skipped.
  for (const n of g.nodes) {
    if (n.within_gate === null) continue;
    const owner = gateOf.get(n.within_gate);
    if (n.gate_role !== null || !owner || ["release", "privileged_operation", "gate"].includes(n.effect)) {
      flag("invalid-gate-scope", `node ${n.id} cannot scope into gate role ${n.within_gate}`);
      continue;
    }
    for (const [r, gid] of present) {
      if (rank(r) < rank(n.within_gate) && !dominates(gid, n.id)) flag("assurance-outside-gate", `${n.id} (in ${n.within_gate}) can run before gate ${gid} (${r})`);
    }
    if (!reachFrom(n.id, null).has(owner) || (reach.has(n.id) && dominates(owner, n.id))) {
      flag("assurance-outside-gate", `${n.id} (in ${n.within_gate}) does not run before its gate ${owner}`);
    }
    if (n.required && reach.has(owner) && !dominates(n.id, owner)) flag("assurance-outside-gate", `required ${n.id} can be skipped on a path to its gate ${owner}`);
  }

  // Supplied obligations: security/adversarial/UI/UX assurance executes inside QA.
  for (const o of g.obligations) {
    if (!(QA_ASSURANCE_KINDS as readonly string[]).includes(o.kind)) continue;
    const n = byId.get(o.node_id);
    if (!n || (n.gate_role !== "qa" && n.within_gate !== "qa")) flag("assurance-outside-gate", `${o.kind} obligation ${o.id} is bound to ${o.node_id}, outside the QA gate scope`);
  }

  if (!found.size) return { ok: true };
  const violations = [...found.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, v]) => v);
  return { ok: false, violations };
}

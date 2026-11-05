/**
 * W02 / AT06 — gate property test. Every executable release path of a compiled
 * or supplied C8 v2 projection is dominated by the required D5/QA/ops/D8 gates in
 * canonical order; security/UI assurance sits inside QA; a gate present off-path
 * or a release action disguised under another effect is still rejected.
 */

import { describe, it, expect } from "bun:test";

import {
  GATE_ORDER,
  verifyProtectedPaths,
  type ProtectedPathResult,
} from "./workflow-protected-paths";
import {
  compileWorkflow,
  createComponentRegistry,
  type CompilePolicy,
  type CompileRequest,
  type CompileResult,
} from "./workflow-component-compiler";
import * as lifecycle from ".";
import * as security from "../security";

const H = (c: string) => `sha256:${c.repeat(64)}`;

// ---------------------------------------------------------------- raw projections

type N = { id: string; effect?: string; gate_role?: string | null; within_gate?: string | null; required?: boolean; capabilities?: string[]; role?: string; outputs?: { name: string; type: string }[] };

function node(n: N) {
  return {
    id: n.id,
    component_id: "c",
    component_hash: H("a"),
    effect: n.effect ?? "write",
    gate_role: n.gate_role ?? null,
    within_gate: n.within_gate ?? null,
    role: n.role ?? "developer",
    capabilities: n.capabilities ?? [],
    inputs: [],
    outputs: n.outputs ?? [],
    required: n.required ?? true,
  };
}
const g = (id: string, role: string) => ({ id, effect: "gate", gate_role: role, role: "owner" });

function projection(cls: string, nodes: N[], edges: [string, string][], entry = nodes[0].id) {
  const ns = nodes.map(node);
  return {
    schema_version: "guild.stack.workflow-projection.v2",
    workflow: { source_id: "source-a", kind: "workflow", id: "wf", revision: H("b") },
    class: cls,
    definition_hash: H("b"),
    compiler_hash: H("c"),
    policy_hash: H("d"),
    expanded_hash: H("e"),
    components: [{ id: "c", version: "1", sha256: H("a") }],
    nodes: ns,
    edges: edges.map(([from, to]) => ({ from, to, on: "next" })),
    entry,
    protected_gates: ns.filter((x) => x.gate_role !== null).map((x) => x.id),
    obligations: [],
    invocations: [],
  };
}

function chain(cls: string, nodes: N[]) {
  const e: [string, string][] = [];
  for (let i = 1; i < nodes.length; i++) e.push([nodes[i - 1].id, nodes[i].id]);
  return projection(cls, nodes, e);
}

const rules = (r: ProtectedPathResult) => (r.ok ? [] : r.violations.map((v) => v.rule));

const PRODUCT_OK: N[] = [
  g("d5", "d5"),
  { id: "build" },
  { id: "sec", effect: "review", within_gate: "qa", role: "reviewer" },
  g("qa", "qa"),
  g("d8", "d8"),
  { id: "ship", effect: "release", role: "owner", capabilities: ["deploy"] },
];

describe("AT06 protected paths — positive", () => {
  it("a product chain d5 → build → sec(in qa) → qa → d8 → release is accepted", () => {
    expect(verifyProtectedPaths(chain("product", PRODUCT_OK))).toEqual({ ok: true });
  });

  it("an ops chain with the ops gate before d8 is accepted; repair loops behind qa are fine", () => {
    const nodes: N[] = [g("d5", "d5"), { id: "build" }, g("qa", "qa"), g("ops", "ops"), g("d8", "d8"), { id: "run", effect: "release", role: "owner" }];
    const p = chain("ops", nodes);
    p.edges.push({ from: "qa", to: "build", on: "repeat" });
    expect(verifyProtectedPaths(p)).toEqual({ ok: true });
  });

  it("the canonical gate order is d5, qa, ops, d8", () => {
    expect([...GATE_ORDER]).toEqual(["d5", "qa", "ops", "d8"]);
  });

  it("both domains expose the W02 surface through their index", () => {
    expect(typeof lifecycle.verifyProtectedPaths).toBe("function");
    expect(typeof lifecycle.compileWorkflow).toBe("function");
    expect(typeof security.classifyActionTokens).toBe("function");
  });
});

describe("AT06 protected paths — negative controls", () => {
  it("a gate present off-path (side branch) does not dominate release", () => {
    const nodes: N[] = [g("d5", "d5"), { id: "build" }, g("qa", "qa"), g("d8", "d8"), { id: "ship", effect: "release", role: "owner" }];
    const p = projection("product", nodes, [["d5", "build"], ["build", "qa"], ["build", "d8"], ["d8", "ship"]]);
    expect(rules(verifyProtectedPaths(p))).toContain("release-bypasses-gate");
  });

  it("a gate reachable only after release does not count", () => {
    const nodes: N[] = [g("d5", "d5"), { id: "build" }, { id: "ship", effect: "release", role: "owner" }, g("qa", "qa"), g("d8", "d8")];
    expect(rules(verifyProtectedPaths(chain("product", nodes)))).toContain("release-bypasses-gate");
  });

  it("cross-class entry: an entry at or past the gates is rejected", () => {
    const p = chain("ops", [g("d5", "d5"), g("qa", "qa"), g("ops", "ops"), g("d8", "d8"), { id: "run", effect: "release", role: "owner" }]);
    expect(rules(verifyProtectedPaths({ ...p, entry: "run" }))).toContain("release-bypasses-gate");
    expect(rules(verifyProtectedPaths({ ...p, entry: "qa" }))).toContain("release-bypasses-gate");
  });

  it("reordered gates are rejected even when release is dominated by all of them", () => {
    const nodes: N[] = [g("d5", "d5"), { id: "build" }, g("d8", "d8"), g("qa", "qa"), { id: "ship", effect: "release", role: "owner" }];
    expect(rules(verifyProtectedPaths(chain("product", nodes)))).toContain("gate-order");
    const opsLate: N[] = [g("d5", "d5"), g("qa", "qa"), g("d8", "d8"), g("ops", "ops"), { id: "run", effect: "release", role: "owner" }];
    expect(rules(verifyProtectedPaths(chain("ops", opsLate)))).toContain("gate-order");
  });

  it("a release-like capability disguised under a write/read/review effect is rejected", () => {
    for (const effect of ["write", "read", "review"]) {
      const nodes: N[] = [g("d5", "d5"), { id: "build", effect, capabilities: ["deploy-prod"] }, g("qa", "qa"), g("d8", "d8")];
      expect(rules(verifyProtectedPaths(chain("product", nodes)))).toContain("disguised-release");
    }
    const byType: N[] = [{ id: "w", outputs: [{ name: "pkg", type: "artifact:release" }] }];
    expect(rules(verifyProtectedPaths(chain("research", byType)))).toContain("disguised-release");
    const byRole: N[] = [{ id: "w", role: "publisher.publish" }];
    expect(rules(verifyProtectedPaths(chain("research", byRole)))).toContain("disguised-release");
  });

  it("a disguised release inside a research class still cannot escape the gates", () => {
    const nodes: N[] = [{ id: "r1", effect: "read" }, { id: "w", effect: "write", capabilities: ["publish"] }];
    const r = verifyProtectedPaths(chain("research", nodes));
    expect(rules(r)).toContain("disguised-release");
  });

  it("a privileged capability under a non-privileged effect is rejected", () => {
    const nodes: N[] = [g("d5", "d5"), { id: "w", effect: "review", capabilities: ["grant-permissions"] }];
    expect(rules(verifyProtectedPaths(chain("research", nodes)))).toContain("disguised-privileged");
  });

  it("a privileged operation must be dominated by the D5 gate", () => {
    const before = chain("research", [{ id: "p", effect: "privileged_operation", capabilities: ["admin"] }, g("d5", "d5")]);
    expect(rules(verifyProtectedPaths(before))).toContain("privileged-ungated");
    const none = chain("debug", [{ id: "p", effect: "privileged_operation" }]);
    expect(rules(verifyProtectedPaths(none))).toContain("privileged-ungated");
    const ok = chain("research", [g("d5", "d5"), { id: "p", effect: "privileged_operation", capabilities: ["admin"] }]);
    expect(verifyProtectedPaths(ok)).toEqual({ ok: true });
  });

  it("security/UI assurance must sit inside QA: before the qa gate, after d5, and on every path to qa when required", () => {
    const after: N[] = [g("d5", "d5"), { id: "build" }, g("qa", "qa"), { id: "sec", effect: "review", within_gate: "qa" }, g("d8", "d8")];
    expect(rules(verifyProtectedPaths(chain("product", after)))).toContain("assurance-outside-gate");
    const early: N[] = [{ id: "sec", effect: "review", within_gate: "qa" }, g("d5", "d5"), g("qa", "qa"), g("d8", "d8")];
    expect(rules(verifyProtectedPaths(chain("product", early)))).toContain("assurance-outside-gate");
    const skippable = projection(
      "product",
      [g("d5", "d5"), { id: "build" }, { id: "sec", effect: "review", within_gate: "qa" }, g("qa", "qa"), g("d8", "d8")],
      [["d5", "build"], ["build", "sec"], ["sec", "qa"], ["build", "qa"], ["qa", "d8"]],
    );
    expect(rules(verifyProtectedPaths(skippable))).toContain("assurance-outside-gate");
  });

  it("an unreachable gate or release node is rejected rather than vacuously passing", () => {
    const p = projection("product", [g("d5", "d5"), { id: "build" }, g("qa", "qa"), g("d8", "d8")], [["d5", "build"], ["build", "d8"]]);
    expect(rules(verifyProtectedPaths(p))).toContain("gate-unreachable");
    const r = projection("research", [{ id: "a" }, { id: "ship", effect: "release", role: "owner" }], []);
    expect(rules(verifyProtectedPaths(r))).toContain("release-unreachable");
  });

  it("dropped, skippable, mislabelled or unknown-effect gates in supplied bytes are rejected", () => {
    const p = chain("product", PRODUCT_OK);
    expect(rules(verifyProtectedPaths({ ...p, protected_gates: ["d5", "d8"] }))).toContain("gate-not-protected");
    const skip = chain("product", PRODUCT_OK);
    (skip.nodes[3] as any).required = false;
    expect(rules(verifyProtectedPaths(skip))).toContain("gate-not-protected");
    const custom = chain("product", PRODUCT_OK);
    (custom.nodes[1] as any).effect = "deploy";
    expect(rules(verifyProtectedPaths(custom))).toContain("invalid-projection");
    const missing = chain("product", PRODUCT_OK.filter((n) => n.id !== "d8"));
    expect(rules(verifyProtectedPaths(missing))).toContain("class-gate-missing");
  });

  it("hostile bytes (accessor, toJSON, unknown edge endpoint, oversize) fail closed without throwing", () => {
    const p: any = chain("product", PRODUCT_OK);
    Object.defineProperty(p, "entry", { get: () => "d5", enumerable: true });
    expect(rules(verifyProtectedPaths(p))).toContain("invalid-projection");
    expect(rules(verifyProtectedPaths({ ...chain("product", PRODUCT_OK), toJSON: () => ({}) }))).toContain("invalid-projection");
    const bad = chain("product", PRODUCT_OK);
    bad.edges.push({ from: "ghost", to: "ship", on: "next" });
    expect(rules(verifyProtectedPaths(bad))).toContain("invalid-projection");
    const big = chain("research", Array.from({ length: 1001 }, (_, i) => ({ id: `n${i}` })));
    expect(rules(verifyProtectedPaths(big))).toContain("invalid-projection");
    expect(rules(verifyProtectedPaths(null))).toContain("invalid-projection");
  });

  it("violations are deterministic: same input, same ordered list", () => {
    const nodes: N[] = [{ id: "x", capabilities: ["deploy", "admin"] }, g("d8", "d8"), g("qa", "qa"), { id: "ship", effect: "release", role: "owner" }];
    const a = JSON.stringify(verifyProtectedPaths(chain("product", nodes)));
    for (let i = 0; i < 3; i++) expect(JSON.stringify(verifyProtectedPaths(chain("product", nodes)))).toBe(a);
  });
});

// ---------------------------------------------------------------- property test

/** Seeded PRNG (mulberry32): the property run is reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Oracle: enumerate (node, gates-passed) states from entry; a release reached without every gate is a bypass. */
function oracleBypass(p: ReturnType<typeof projection>): boolean {
  const gates = new Set(p.protected_gates);
  const out = new Map<string, string[]>();
  for (const e of p.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const effect = new Map(p.nodes.map((n) => [n.id, n.effect]));
  const seen = new Set<string>();
  const stack: [string, string[]][] = [[p.entry, []]];
  while (stack.length) {
    const [id, before] = stack.pop()!;
    const passed = gates.has(id) && !before.includes(id) ? [...before, id].sort() : before;
    const k = `${id}|${passed.join(",")}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (effect.get(id) === "release" && passed.length !== gates.size) return true;
    for (const to of out.get(id) ?? []) stack.push([to, passed]);
  }
  return false;
}

describe("AT06 gate property — generated branches agree with an exhaustive path oracle", () => {
  it("over 2000 seeded random graphs, release-bypasses-gate fires iff some path skips a gate", () => {
    const r = rng(20261105);
    let bypasses = 0, clean = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const nodes: N[] = [g("d5", "d5"), g("qa", "qa"), g("d8", "d8")];
      const extra = 2 + Math.floor(r() * 6);
      for (let i = 0; i < extra; i++) nodes.push({ id: `w${i}` });
      nodes.push({ id: "ship", effect: "release", role: "owner" });
      // Backbone keeps gates in canonical order and everything reachable; random extra edges make branches/loops.
      const order = ["d5", ...nodes.slice(3, 3 + extra).map((n) => n.id), "qa", "d8", "ship"];
      const edges: [string, string][] = [];
      for (let i = 1; i < order.length; i++) edges.push([order[i - 1], order[i]]);
      const extraEdges = Math.floor(r() * 4);
      for (let i = 0; i < extraEdges; i++) {
        const from = nodes[Math.floor(r() * nodes.length)].id;
        const to = nodes[Math.floor(r() * nodes.length)].id;
        edges.push([from, to]);
      }
      const p = projection("product", nodes, edges, "d5");
      const expected = oracleBypass(p);
      const got = rules(verifyProtectedPaths(p)).includes("release-bypasses-gate");
      if (got !== expected) throw new Error(`trial ${trial} disagrees with oracle: ${JSON.stringify(p.edges)}`);
      if (expected) bypasses++; else clean++;
    }
    // Anti-vacuity: the generator produced both outcomes in volume.
    expect(bypasses).toBeGreaterThan(100);
    expect(clean).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------- compiler wiring (nested fragments)

const POLICY: CompilePolicy = { roles: { developer: ["code"], reviewer: ["review"], owner: ["deploy", "admin"] } };

function task(id: string, extra: Record<string, unknown> = {}) {
  return { kind: "task", id, effect: "write", role: "developer", capabilities: ["code"], inputs: [], outputs: [], ...extra };
}
const gate = (id: string, role: string) => task(id, { effect: "gate", gate_role: role, role: "owner", capabilities: [] });
const comp = (id: string, effects: string[], body: unknown) => ({ schema_version: "guild.workflow_component.v1", id, version: "1", effects, inputs: [], outputs: [], body });
const seq = (id: string, steps: unknown[]) => ({ kind: "sequence", id, steps });
const call = (id: string, cid: string) => ({ kind: "call", id, component: { id: cid, version: "1" } });

function compile(docs: unknown[], cls = "product", root = "root"): CompileResult {
  const reg = createComponentRegistry(docs);
  if (!reg.ok) return { ok: false, violations: reg.violations };
  const req: CompileRequest = { class: cls as CompileRequest["class"], workflow: { source_id: "source-a", id: "wf" }, root: { id: root, version: "1" }, policy: POLICY };
  return compileWorkflow(reg.registry, req);
}
const crules = (r: CompileResult) => (r.ok ? [] : r.violations.map((v) => v.rule));

describe("AT06 compiler wiring — nested fragments and custom release effects", () => {
  const SHIP = comp("ship", ["release"], task("go", { effect: "release", role: "owner", capabilities: ["deploy"] }));
  const ASSURE = comp("assure", ["review"], task("sec", { effect: "review", role: "reviewer", capabilities: ["review"], within_gate: "qa" }));

  it("a nested product delivery with assurance inside QA compiles and verifies", () => {
    const root = comp("root", ["write", "review", "gate", "release"], seq("m", [gate("d5", "d5"), task("build"), call("a", "assure"), gate("qa", "qa"), gate("d8", "d8"), call("s", "ship")]));
    const r = compile([root, SHIP, ASSURE]);
    if (!r.ok) throw new Error(JSON.stringify(r.violations));
    expect(verifyProtectedPaths(r.projection)).toEqual({ ok: true });
  });

  it("a release nested two calls deep before QA is refused", () => {
    const inner = comp("inner", ["write", "release"], seq("i", [task("x"), call("s", "ship")]));
    const root = comp("root", ["write", "gate", "release"], seq("m", [gate("d5", "d5"), call("in", "inner"), gate("qa", "qa"), gate("d8", "d8")]));
    expect(crules(compile([root, inner, SHIP]))).toContain("release-bypasses-gate");
  });

  it("a release inside a bounded repeat placed between qa and d8 is refused", () => {
    const loop = comp("loop", ["release"], { kind: "repeat", id: "l", max_rounds: 2, until: { kind: "outcome", equals: "ok" }, body: call("s", "ship") });
    const root = comp("root", ["write", "gate", "release"], seq("m", [gate("d5", "d5"), task("b"), gate("qa", "qa"), call("lp", "loop"), gate("d8", "d8")]));
    expect(crules(compile([root, loop, SHIP]))).toContain("release-bypasses-gate");
  });

  it("a component that hides deploy behind a write effect is refused at compile", () => {
    const sneaky = comp("sneaky", ["write"], task("w", { role: "owner", capabilities: ["deploy"] }));
    const root = comp("root", ["write", "gate"], seq("m", [gate("d5", "d5"), call("x", "sneaky"), gate("qa", "qa"), gate("d8", "d8")]));
    expect(crules(compile([root, sneaky]))).toContain("disguised-release");
  });

  it("reordered gates and assurance after QA are refused at compile", () => {
    const reordered = comp("root", ["write", "gate"], seq("m", [gate("d5", "d5"), task("b"), gate("d8", "d8"), gate("qa", "qa")]));
    expect(crules(compile([reordered]))).toContain("gate-order");
    const late = comp("root", ["write", "review", "gate"], seq("m", [gate("d5", "d5"), task("b"), gate("qa", "qa"), call("a", "assure"), gate("d8", "d8")]));
    expect(crules(compile([late, ASSURE]))).toContain("assurance-outside-gate");
  });

  it("a privileged operation before D5 is refused at compile", () => {
    const root = comp("root", ["privileged_operation", "gate", "write"], seq("m", [task("p", { effect: "privileged_operation", role: "owner", capabilities: ["admin"] }), gate("d5", "d5"), task("b")]));
    expect(crules(compile([root], "research"))).toContain("privileged-ungated");
  });
});

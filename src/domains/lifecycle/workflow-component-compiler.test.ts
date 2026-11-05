/**
 * W01 — component registry and deterministic compiler (AT04 compiler contract,
 * AT05 compiler boundary). The compiler output is checked against the frozen A02
 * C8 WorkflowProjection v2 shape and its semantic rules, restated here so the
 * suite runs in a plugin-only checkout.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { WORKFLOW_CLASSES, loadAllClassGraphs } from ".";
import {
  COMPILER_LIMITS,
  compileWorkflow,
  createComponentRegistry,
  loadComponentRegistry,
  type CompilePolicy,
  type CompileRequest,
  type CompileResult,
} from "./workflow-component-compiler";

const POLICY: CompilePolicy = {
  roles: { developer: ["code"], reviewer: ["review"], owner: [] },
};

function task(id: string, extra: Record<string, unknown> = {}) {
  return { kind: "task", id, effect: "write", role: "developer", capabilities: ["code"], inputs: [], outputs: [], ...extra };
}

const DRAFT = {
  schema_version: "guild.workflow_component.v1",
  id: "draft",
  version: "1",
  effects: ["write"],
  inputs: [{ name: "brief", type: "artifact:brief" }],
  outputs: [{ name: "draft", type: "artifact:draft" }],
  body: task("write", { inputs: [{ name: "brief", type: "artifact:brief" }], outputs: [{ name: "draft", type: "artifact:draft" }] }),
};

const REVIEW = {
  schema_version: "guild.workflow_component.v1",
  id: "review",
  version: "1",
  effects: ["review"],
  inputs: [{ name: "draft", type: "artifact:draft" }],
  outputs: [{ name: "verdict", type: "artifact:verdict" }],
  body: task("check", {
    effect: "review",
    role: "reviewer",
    capabilities: ["review"],
    inputs: [{ name: "draft", type: "artifact:draft" }],
    outputs: [{ name: "verdict", type: "artifact:verdict" }],
  }),
};

const REVIEW_LOOP = {
  schema_version: "guild.workflow_component.v1",
  id: "review-loop",
  version: "1",
  effects: ["write", "review"],
  inputs: [{ name: "brief", type: "artifact:brief" }],
  outputs: [{ name: "draft", type: "artifact:draft" }, { name: "verdict", type: "artifact:verdict" }],
  body: {
    kind: "repeat",
    id: "loop",
    max_rounds: 3,
    until: { kind: "all_of", conditions: [{ kind: "outcome", equals: "approve" }, { kind: "no_unresolved_questions" }] },
    body: {
      kind: "sequence",
      id: "round",
      steps: [
        { kind: "call", id: "d", component: { id: "draft", version: "1" } },
        { kind: "call", id: "r", component: { id: "review", version: "1" } },
      ],
    },
  },
};

const DELIVERY = {
  schema_version: "guild.workflow_component.v1",
  id: "delivery",
  version: "1",
  effects: ["read", "write", "review"],
  inputs: [],
  outputs: [{ name: "verdict", type: "artifact:verdict" }],
  body: {
    kind: "sequence",
    id: "main",
    steps: [
      task("intake", { effect: "read", outputs: [{ name: "brief", type: "artifact:brief" }] }),
      {
        kind: "sequence",
        id: "inner",
        steps: [{ kind: "call", id: "iterate", component: { id: "review-loop", version: "1" } }],
      },
      task("summarise", { effect: "read", inputs: [{ name: "verdict", type: "artifact:verdict" }] }),
    ],
  },
};

const FIXTURE = [DRAFT, REVIEW, REVIEW_LOOP, DELIVERY];

function req(cls: string, root: { id: string; version: string }, policy: CompilePolicy = POLICY): CompileRequest {
  return { class: cls as CompileRequest["class"], workflow: { source_id: "source-a", id: "wf-1" }, root, policy };
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function compileDocs(docs: unknown[], r: CompileRequest): CompileResult {
  const reg = createComponentRegistry(docs);
  if (!reg.ok) return { ok: false, violations: reg.violations };
  return compileWorkflow(reg.registry, r);
}

function rules(result: CompileResult): string[] {
  return result.ok ? [] : result.violations.map((v) => v.rule);
}

// ---- C8 v2 conformance, restated from the frozen A02 schema + verify_contracts.py ----
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const TOP_KEYS = ["schema_version", "workflow", "class", "definition_hash", "compiler_hash", "policy_hash", "expanded_hash", "components", "nodes", "edges", "entry", "protected_gates", "obligations", "invocations"].sort();
const NODE_KEYS = ["id", "component_id", "component_hash", "effect", "gate_role", "within_gate", "role", "capabilities", "inputs", "outputs", "required"].sort();

function assertC8v2(p: Record<string, any>): void {
  expect(Object.keys(p).sort()).toEqual(TOP_KEYS);
  expect(p.schema_version).toBe("guild.stack.workflow-projection.v2");
  expect(Object.keys(p.workflow).sort()).toEqual(["id", "kind", "revision", "source_id"]);
  for (const h of ["definition_hash", "compiler_hash", "policy_hash", "expanded_hash"]) expect(p[h]).toMatch(HASH);
  expect(p.components.length).toBeGreaterThanOrEqual(1);
  expect(p.components.length).toBeLessThanOrEqual(100);
  for (const c of p.components) {
    expect(Object.keys(c).sort()).toEqual(["id", "sha256", "version"]);
    expect(c.id).toMatch(ID);
    expect(c.sha256).toMatch(HASH);
  }
  expect(p.nodes.length).toBeLessThanOrEqual(1000);
  const ids = new Set<string>();
  for (const n of p.nodes) {
    expect(Object.keys(n).sort()).toEqual(NODE_KEYS);
    expect(n.id).toMatch(ID);
    expect(ids.has(n.id)).toBe(false);
    ids.add(n.id);
    expect(n.component_hash).toMatch(HASH);
    expect(["read", "write", "review", "gate", "privileged_operation", "release"]).toContain(n.effect);
  }
  expect(ids.has(p.entry)).toBe(true);
  for (const e of p.edges) {
    expect(Object.keys(e).sort()).toEqual(["from", "on", "to"]);
    expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    expect(e.on).toMatch(ID);
  }
  for (const g of p.protected_gates) {
    const n = p.nodes.find((x: any) => x.id === g);
    expect(n.effect).toBe("gate");
    expect(n.gate_role).not.toBeNull();
    expect(n.required).toBe(true);
  }
  expect(p.obligations).toEqual([]);
  expect(p.invocations).toEqual([]);
}

describe("AT04 compiler contract — nested sequence and bounded repeat", () => {
  it("compiles to a C8 v2 projection with namespaced nodes, loop and manifest", () => {
    const r = compileDocs(FIXTURE, req("research", { id: "delivery", version: "1" }));
    if (!r.ok) throw new Error(JSON.stringify(r.violations));
    assertC8v2(r.projection as any);
    expect(r.projection.nodes.map((n) => n.id)).toEqual(["intake", "iterate.d.write", "iterate.r.check", "summarise"]);
    expect(r.projection.edges).toEqual([
      { from: "iterate.d.write", to: "iterate.r.check", on: "next" },
      { from: "iterate.r.check", to: "iterate.d.write", on: "repeat" },
      { from: "intake", to: "iterate.d.write", on: "next" },
      { from: "iterate.r.check", to: "summarise", on: "next" },
    ]);
    expect(r.projection.entry).toBe("intake");
    expect(r.projection.workflow.revision).toBe(r.projection.definition_hash);
    expect(r.projection.components.map((c) => `${c.id}@${c.version}`)).toEqual(["delivery@1", "draft@1", "review@1", "review-loop@1"]);
    const write = r.projection.nodes.find((n) => n.id === "iterate.d.write")!;
    expect(write.component_id).toBe("draft");
    expect(write.component_hash).toBe(r.projection.components.find((c) => c.id === "draft")!.sha256);

    expect(r.manifest.schema_version).toBe("guild.workflow_compile_manifest.v1");
    expect(r.manifest.expanded_hash).toBe(r.projection.expanded_hash);
    expect(r.manifest.compiler.hash).toBe(r.projection.compiler_hash);
    expect(r.manifest.loops).toEqual([
      {
        id: "iterate.loop",
        entry: "iterate.d.write",
        exit: "iterate.r.check",
        max_rounds: 3,
        until: { kind: "all_of", conditions: [{ kind: "outcome", equals: "approve" }, { kind: "no_unresolved_questions" }] },
      },
    ]);
    expect(r.manifest.namespace_map.find((m) => m.node_id === "iterate.r.check")).toEqual({
      node_id: "iterate.r.check",
      call_path: ["iterate", "r"],
      component_path: ["delivery@1", "review-loop@1", "review@1"],
      step_id: "check",
    });
  });

  it("is byte-stable across repeated runs and registry input order", () => {
    const outs = new Set<string>();
    const orders = [FIXTURE, [...FIXTURE].reverse(), [REVIEW_LOOP, DELIVERY, DRAFT, REVIEW]];
    for (let i = 0; i < 3; i++) {
      for (const docs of orders) {
        const r = compileDocs(clone(docs), req("research", { id: "delivery", version: "1" }));
        if (!r.ok) throw new Error(JSON.stringify(r.violations));
        outs.add(JSON.stringify([r.projection, r.manifest]));
      }
    }
    expect(outs.size).toBe(1);
  });

  it("an unrelated registry entry does not move the definition hash; a component edit does", () => {
    const base = compileDocs(FIXTURE, req("research", { id: "delivery", version: "1" }));
    const extra = compileDocs([...FIXTURE, { ...clone(DRAFT), version: "2" }], req("research", { id: "delivery", version: "1" }));
    const edited = clone(DRAFT) as any;
    edited.body.capabilities = [];
    const changed = compileDocs([edited, REVIEW, REVIEW_LOOP, DELIVERY], req("research", { id: "delivery", version: "1" }));
    if (!base.ok || !extra.ok || !changed.ok) throw new Error("fixture failed");
    expect(extra.projection.definition_hash).toBe(base.projection.definition_hash);
    expect(changed.projection.definition_hash).not.toBe(base.projection.definition_hash);
    const policy = compileDocs(FIXTURE, req("research", { id: "delivery", version: "1" }, { roles: { ...POLICY.roles, extra: [] } }));
    if (!policy.ok) throw new Error("policy fixture failed");
    expect(policy.projection.policy_hash).not.toBe(base.projection.policy_hash);
    expect(policy.projection.expanded_hash).toBe(base.projection.expanded_hash);
  });

  it("negative: direct recursion is rejected", () => {
    const self = { ...clone(DRAFT), id: "self", body: { kind: "sequence", id: "s", steps: [DRAFT.body, { kind: "call", id: "again", component: { id: "self", version: "1" } }] } };
    expect(rules(compileDocs([self], req("research", { id: "self", version: "1" })))).toContain("recursive-composition");
  });

  it("negative: indirect recursion is rejected with the cycle named", () => {
    const a = { ...clone(DRAFT), id: "a", body: { kind: "call", id: "to-b", component: { id: "b", version: "1" } } };
    const b = { ...clone(DRAFT), id: "b", body: { kind: "call", id: "to-a", component: { id: "a", version: "1" } } };
    const r = compileDocs([a, b], req("research", { id: "a", version: "1" }));
    expect(rules(r)).toContain("recursive-composition");
    if (!r.ok) expect(r.violations[0].detail).toContain("a@1 -> b@1 -> a@1");
  });

  it("negative: incompatible artifact type and unsatisfied input are rejected", () => {
    const bad = clone(REVIEW) as any;
    bad.inputs = [{ name: "draft", type: "artifact:spec" }];
    bad.body.inputs = [{ name: "draft", type: "artifact:spec" }];
    expect(rules(compileDocs([DRAFT, bad, REVIEW_LOOP, DELIVERY], req("research", { id: "delivery", version: "1" })))).toContain("incompatible-artifact");
    const missing = clone(DELIVERY) as any;
    missing.body.steps[0].outputs = [];
    expect(rules(compileDocs([DRAFT, REVIEW, REVIEW_LOOP, missing], req("research", { id: "delivery", version: "1" })))).toContain("unsatisfied-input");
  });

  it("negative: incompatible role, capability and concealed effect are rejected", () => {
    const noRole = clone(DRAFT) as any;
    noRole.body.role = "ghost";
    expect(rules(compileDocs([noRole], req("research", { id: "draft", version: "1" })))).toContain("incompatible-role");
    const cap = clone(DRAFT) as any;
    cap.body.capabilities = ["deploy"];
    expect(rules(compileDocs([cap], req("research", { id: "draft", version: "1" })))).toContain("incompatible-role");
    const concealed = clone(REVIEW_LOOP) as any;
    concealed.effects = ["review"];
    expect(rules(compileDocs([DRAFT, REVIEW, concealed], req("research", { id: "review-loop", version: "1" })))).toContain("undeclared-effect");
  });

  it("negative: unbounded and over-budget repeats are rejected", () => {
    for (const max of [undefined, 0, COMPILER_LIMITS.maxRepeatRounds + 1, 1.5, "3"]) {
      const loop = clone(REVIEW_LOOP) as any;
      if (max === undefined) delete loop.body.max_rounds;
      else loop.body.max_rounds = max;
      expect(rules(compileDocs([DRAFT, REVIEW, loop], req("research", { id: "review-loop", version: "1" })))).toContain("unbounded-repeat");
    }
    const outer = clone(REVIEW_LOOP) as any;
    outer.id = "outer";
    outer.body = { kind: "repeat", id: "o", max_rounds: COMPILER_LIMITS.maxRepeatRounds, until: { kind: "outcome", equals: "approve" }, body: { kind: "call", id: "in", component: { id: "review-loop", version: "1" } } };
    const loop10 = clone(REVIEW_LOOP) as any;
    loop10.body.max_rounds = COMPILER_LIMITS.maxRepeatRounds;
    const deep = clone(outer);
    deep.id = "deep";
    deep.body.body.component = { id: "outer", version: "1" };
    expect(rules(compileDocs([DRAFT, REVIEW, loop10, outer, deep], req("research", { id: "deep", version: "1" })))).toContain("unbounded-expansion");
  });

  it("negative: a repeat with no until condition is rejected", () => {
    const loop = clone(REVIEW_LOOP) as any;
    delete loop.body.until;
    expect(rules(compileDocs([DRAFT, REVIEW, loop], req("research", { id: "review-loop", version: "1" })))).toContain("bad-condition");
  });

  it("negative: parallel joins are excluded from the first release", () => {
    const par = { ...clone(DRAFT), id: "par", body: { kind: "parallel", id: "p", join: "all", branches: [DRAFT.body] } };
    expect(rules(compileDocs([par], req("research", { id: "par", version: "1" })))).toContain("parallel-join-unsupported");
  });

  it("negative: an unknown component reference and an untyped reference are rejected", () => {
    const loop = clone(REVIEW_LOOP) as any;
    loop.body.body.steps[1].component = { id: "review", version: "9" };
    expect(rules(compileDocs([DRAFT, REVIEW, loop], req("research", { id: "review-loop", version: "1" })))).toContain("unknown-component");
    const untyped = clone(REVIEW_LOOP) as any;
    untyped.body.body.steps[1].component = "review@1";
    expect(rules(compileDocs([DRAFT, REVIEW, untyped], req("research", { id: "review-loop", version: "1" })))).toContain("invalid-component");
  });
});

function gate(id: string, role: string) {
  return task(id, { effect: "gate", gate_role: role, role: "owner", capabilities: [] });
}

function classComponent(cls: string) {
  const steps: unknown[] = [task("work", { effect: "write" })];
  if (cls === "product") steps.unshift(gate("d5", "d5")), steps.push(gate("qa", "qa"), gate("d8", "d8"));
  if (cls === "ops") steps.push(gate("ops", "ops"));
  return {
    schema_version: "guild.workflow_component.v1",
    id: `${cls}-flow`,
    version: "1",
    effects: ["write", "gate"],
    inputs: [],
    outputs: [],
    body: { kind: "sequence", id: "main", steps },
  };
}

describe("AT05 compiler boundary — class integration, conditions and caps", () => {
  it.each([...WORKFLOW_CLASSES])("compiles a composition for the %s class", (cls) => {
    const r = compileDocs([classComponent(cls)], req(cls, { id: `${cls}-flow`, version: "1" }));
    if (!r.ok) throw new Error(JSON.stringify(r.violations));
    assertC8v2(r.projection as any);
    expect(r.projection.class).toBe(cls);
  });

  it("the five flat class graphs still load and validate unchanged", () => {
    const graphs = loadAllClassGraphs({ ignoreOverlay: true });
    expect(Object.keys(graphs).sort()).toEqual([...WORKFLOW_CLASSES].sort());
  });

  it("negative: a sixth class is refused", () => {
    expect(rules(compileDocs([classComponent("research")], req("marketing", { id: "research-flow", version: "1" })))).toContain("unknown-class");
  });

  it("negative: a product composition missing its class gates is refused", () => {
    expect(rules(compileDocs([classComponent("research")], req("product", { id: "research-flow", version: "1" })))).toContain("class-gate-missing");
  });

  it("negative: a skippable gate, duplicate gate role, or release past a gate is refused", () => {
    const skippable = classComponent("product") as any;
    skippable.body.steps[0].required = false;
    expect(rules(compileDocs([skippable], req("product", { id: "product-flow", version: "1" })))).toContain("gate-not-protected");
    const dup = classComponent("product") as any;
    dup.body.steps.push(gate("qa2", "qa"));
    expect(rules(compileDocs([dup], req("product", { id: "product-flow", version: "1" })))).toContain("gate-not-protected");
    const early = classComponent("product") as any;
    early.effects.push("release");
    early.body.steps.splice(1, 0, task("ship", { effect: "release", role: "owner", capabilities: [] }));
    expect(rules(compileDocs([early], req("product", { id: "product-flow", version: "1" })))).toContain("release-bypasses-gate");
  });

  it.each([
    ["an expression string", "round > 2 && process.exit()"],
    ["an unknown kind", { kind: "js", source: "true" }],
    ["an extra key", { kind: "outcome", equals: "approve", eval: "1" }],
    ["a non-id outcome", { kind: "outcome", equals: "a b" }],
    ["an over-deep combinator", { kind: "all_of", conditions: [{ kind: "all_of", conditions: [{ kind: "no_unresolved_questions" }] }] }],
    ["an empty combinator", { kind: "all_of", conditions: [] }],
  ])("negative: %s condition is refused", (_label, until) => {
    const loop = clone(REVIEW_LOOP) as any;
    loop.body.until = until;
    expect(rules(compileDocs([DRAFT, REVIEW, loop], req("research", { id: "review-loop", version: "1" })))).toContain("bad-condition");
  });

  it("negative: a function-valued condition is refused before validation reads it", () => {
    const loop = clone(REVIEW_LOOP) as any;
    loop.body.until = { kind: "outcome", equals: () => "approve" };
    expect(rules(compileDocs([DRAFT, REVIEW, loop], req("research", { id: "review-loop", version: "1" })))).toContain("invalid-component");
  });

  it("negative: oversized nested expansion is refused before it is materialised", () => {
    // Each level calls the one below twice: 2^20 leaf tasks if expanded.
    const docs: unknown[] = [{ ...clone(DRAFT), id: "l0", inputs: [], outputs: [], body: task("t") }];
    for (let i = 1; i <= 20; i++) {
      docs.push({
        ...clone(DRAFT),
        id: `l${i}`,
        inputs: [],
        outputs: [],
        body: { kind: "sequence", id: "s", steps: [{ kind: "call", id: "a", component: { id: `l${i - 1}`, version: "1" } }, { kind: "call", id: "b", component: { id: `l${i - 1}`, version: "1" } }] },
      });
    }
    const started = Date.now();
    const r = compileDocs(docs, req("research", { id: "l20", version: "1" }));
    expect(rules(r).some((x) => x === "unbounded-expansion" || x === "depth-exceeded")).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
    // Wide but shallow: over the node cap without exceeding depth.
    const wide = { ...clone(DRAFT), id: "wide", inputs: [], outputs: [], body: { kind: "sequence", id: "s", steps: Array.from({ length: 100 }, (_, i) => ({ kind: "call", id: `c${i}`, component: { id: "l4", version: "1" } })) } };
    expect(rules(compileDocs([...docs.slice(0, 5), wide], req("research", { id: "wide", version: "1" })))).toContain("unbounded-expansion");
  });

  it("negative: call depth beyond the cap is refused", () => {
    const docs: unknown[] = [{ ...clone(DRAFT), id: "d0", inputs: [], outputs: [], body: task("t") }];
    for (let i = 1; i <= COMPILER_LIMITS.maxCallDepth + 1; i++) {
      docs.push({ ...clone(DRAFT), id: `d${i}`, inputs: [], outputs: [], body: { kind: "call", id: "c", component: { id: `d${i - 1}`, version: "1" } } });
    }
    expect(rules(compileDocs(docs, req("research", { id: `d${COMPILER_LIMITS.maxCallDepth + 1}`, version: "1" })))).toContain("depth-exceeded");
  });

  it("the compiler module evaluates no dynamic code", () => {
    const src = fs.readFileSync(path.join(__dirname, "workflow-component-compiler.ts"), "utf8");
    expect(src).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(|node:vm|require\(\s*["']vm["']\s*\)/);
  });
});

describe("component registry via the storage resolver", () => {
  it("loads project components from the definition tree and fails closed on a bad file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "w01-components-"));
    try {
      const storage = { definition: (...seg: string[]) => path.join(root, ".guild", ...seg) } as any;
      expect(loadComponentRegistry({ storage }).ok).toBe(true);
      const dir = storage.definition("components");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "draft.yaml"), JSON.stringify(DRAFT));
      fs.writeFileSync(path.join(dir, "review.yml"), JSON.stringify(REVIEW));
      const ok = loadComponentRegistry({ storage });
      if (!ok.ok) throw new Error(JSON.stringify(ok.violations));
      expect(ok.registry.keys()).toEqual(["draft@1", "review@1"]);
      fs.writeFileSync(path.join(dir, "bad.yaml"), "schema_version: guild.workflow_component.v1\nid: bad\n");
      expect(loadComponentRegistry({ storage }).ok).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses duplicate component id@version", () => {
    const r = createComponentRegistry([DRAFT, clone(DRAFT)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.map((v) => v.rule)).toContain("duplicate-component");
  });
});

describe("codex r1 — hostile inputs", () => {
  it("F1: a toJSON hook cannot swap in an unvalidated body", () => {
    const d = clone(DRAFT) as any;
    Object.defineProperty(d, "toJSON", {
      value: () => ({ ...d, body: { kind: "repeat", id: "loop", until: { kind: "outcome", equals: "approve" }, body: d.body } }),
    });
    expect(rules(compileDocs([d], req("research", { id: "draft", version: "1" })))).toContain("invalid-component");
    const cond = clone(REVIEW_LOOP) as any;
    Object.defineProperty(cond.body.until, "toJSON", { value: () => ({ kind: "js", source: "process.exit()" }) });
    expect(compileDocs([DRAFT, REVIEW, cond], req("research", { id: "review-loop", version: "1" })).ok).toBe(false);
    const caps = clone(DRAFT) as any;
    Object.defineProperty(caps.body.capabilities, "toJSON", { value: () => Array.from({ length: 51 }, () => "code") });
    expect(compileDocs([caps], req("research", { id: "draft", version: "1" })).ok).toBe(false);
  });

  it("F1: accessor properties are refused", () => {
    const d = clone(DRAFT) as any;
    let n = 0;
    Object.defineProperty(d.body, "role", { enumerable: true, get: () => (n++ === 0 ? "developer" : "ghost") });
    expect(rules(compileDocs([d], req("research", { id: "draft", version: "1" })))).toContain("invalid-component");
  });

  it("F2: inherited object properties are not roles", () => {
    for (const role of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
      const d = clone(DRAFT) as any;
      d.body.role = role;
      d.body.capabilities = [];
      expect(rules(compileDocs([d], req("research", { id: "draft", version: "1" }, { roles: {} })))).toContain("incompatible-role");
    }
  });

  it("F3: a registry entry cannot be swapped after registration", () => {
    const reg = createComponentRegistry([DRAFT]);
    if (!reg.ok) throw new Error("fixture");
    const entry = reg.registry.get({ id: "draft", version: "1" }) as any;
    const swapped = clone(DRAFT) as any;
    swapped.body.id = "other";
    expect(() => {
      entry.doc = swapped;
    }).toThrow();
    const r = compileWorkflow(reg.registry, req("research", { id: "draft", version: "1" }));
    if (!r.ok) throw new Error(JSON.stringify(r.violations));
    expect(r.projection.nodes.map((x) => x.id)).toEqual(["write"]);
  });
});

describe("codex r2 — registry construction", () => {
  it("the registry cannot be constructed around unvalidated entries", () => {
    const { WorkflowComponentRegistry } = require("./workflow-component-compiler");
    const doc = { ...clone(DRAFT), body: { kind: "repeat", id: "r", until: { kind: "js" }, body: DRAFT.body } };
    expect(() => new WorkflowComponentRegistry(new Map([["draft@1", { doc, sha256: "sha256:" + "0".repeat(64) }]]))).toThrow();
  });
});

describe("codex r3 — forged registries", () => {
  const { WorkflowComponentRegistry } = require("./workflow-component-compiler");
  const bad = { ...clone(DRAFT), body: { kind: "sequence", id: "s", steps: [DRAFT.body, DRAFT.body] } };
  it("a prototype-forged registry is refused", () => {
    const forged = Object.assign(Object.create(WorkflowComponentRegistry.prototype), { get: () => ({ doc: bad, sha256: "sha256:" + "0".repeat(64) }) });
    expect(rules(compileWorkflow(forged, req("research", { id: "draft", version: "1" })))).toContain("invalid-request");
  });
  it("overriding get() on a genuine registry does not change what compiles", () => {
    const reg = createComponentRegistry([DRAFT]);
    if (!reg.ok) throw new Error("fixture");
    try {
      (reg.registry as any).get = () => ({ doc: bad, sha256: "sha256:" + "0".repeat(64) });
    } catch {
      // frozen instance: the override is refused outright
    }
    const proto = Object.getPrototypeOf(reg.registry);
    const original = Object.getOwnPropertyDescriptor(proto, "get")!;
    Object.defineProperty(proto, "get", { value: () => ({ doc: bad, sha256: "sha256:" + "0".repeat(64) }), configurable: true, writable: true });
    let r: CompileResult;
    try {
      r = compileWorkflow(reg.registry, req("research", { id: "draft", version: "1" }));
    } finally {
      Object.defineProperty(proto, "get", original);
    }
    if (!r.ok) throw new Error(JSON.stringify(r.violations));
    expect(r.projection.nodes.map((n) => n.id)).toEqual(["write"]);
  });
});

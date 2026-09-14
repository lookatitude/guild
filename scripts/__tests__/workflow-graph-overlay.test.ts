/**
 * The five authored class graphs are DATA (KTD40/KTD56), so nothing type-checks
 * them at build time. This is what does: every shipped
 * `src/surfaces/graphs/<class>.yaml` must satisfy the frozen
 * `guild.workflow_graph.v1` shape, and the overlay validator must REJECT the two
 * things an overlay is never allowed to do — drop a protected node, or author a
 * sixth class.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

import {
  WORKFLOW_CLASSES,
  PROTECTED_NODE_IDS,
  PROTECTED_NODE_STATIONS,
  PROTECTED_NODE_ROLES,
  RELEASE_ROLE,
  isReleaseShaped,
  CLASS_DEFAULT_ENTRIES,
  RELEASE_GATE,
  validateWorkflowGraphDocument,
  validateWorkflowGraphOverlay,
  applyWorkflowGraphOverlay,
  type WorkflowGraph,
} from "../../src/modules/lifecycle/workflows/workflow-graph-overlay";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const GRAPH_DIR = path.join(PLUGIN_ROOT, "src", "surfaces", "graphs");

function loadGraph(cls: string): WorkflowGraph {
  return yaml.load(fs.readFileSync(path.join(GRAPH_DIR, `${cls}.yaml`), "utf8")) as WorkflowGraph;
}

describe("guild.workflow_graph.v1 — the five authored class graphs", () => {
  it("ships exactly five graph files, one per closed class", () => {
    const files = fs.readdirSync(GRAPH_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
    expect(files).toEqual([...WORKFLOW_CLASSES].sort().map((c) => `${c}.yaml`));
  });

  it.each([...WORKFLOW_CLASSES])("%s.yaml validates against the frozen shape", (cls) => {
    const result = validateWorkflowGraphDocument(loadGraph(cls));
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("marks the KTD42 protected nodes required wherever they appear", () => {
    for (const cls of WORKFLOW_CLASSES) {
      for (const node of loadGraph(cls).nodes ?? []) {
        if ((PROTECTED_NODE_IDS as readonly string[]).includes(node.id)) {
          expect(`${cls}:${node.id}:${node.required}`).toBe(`${cls}:${node.id}:true`);
        }
      }
    }
  });
});

describe("overlay rejection — the two things an overlay may never do", () => {
  it("REJECTS an overlay that drops product qa-before-release", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: (base.nodes ?? []).filter((n) => n.id !== "product.qa"),
      edges: (base.edges ?? []).filter((e) => e.from !== "product.qa" && e.to !== "product.qa"),
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("missing-required-node");
    expect(() => applyWorkflowGraphOverlay(base, overlay)).toThrow(/product\.qa/);
  });

  it.each([...PROTECTED_NODE_IDS])("REJECTS an overlay that drops %s", (protectedId) => {
    for (const cls of WORKFLOW_CLASSES) {
      const base = loadGraph(cls);
      if (!(base.nodes ?? []).some((n) => n.id === protectedId)) continue;
      const overlay: WorkflowGraph = { ...base, nodes: (base.nodes ?? []).filter((n) => n.id !== protectedId) };
      expect(validateWorkflowGraphOverlay(base, overlay).ok).toBe(false);
    }
  });

  // ── codex G-lane r1: the two bypasses an id-presence check waved through ──

  it("REJECTS an overlay that keeps product.qa but routes build -> product.release around it", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      // Every node still present, including product.qa. Only the edge set changes.
      edges: [...(base.edges ?? []), { from: "build", on: "next", to: "product.release" }],
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("bypasses-required-node");
    expect((overlay.nodes ?? []).some((n) => n.id === "product.qa")).toBe(true);
    expect(() => applyWorkflowGraphOverlay(base, overlay)).toThrow(/without passing through/);
  });

  it("REJECTS a bypass routed through an INTERMEDIATE node, not just a direct edge", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: [...(base.nodes ?? []), { id: "hotfix", station: "implementation" }],
      edges: [
        ...(base.edges ?? []),
        { from: "build", on: "skip", to: "hotfix" },
        { from: "hotfix", on: "next", to: "product.release" },
      ],
    };
    expect(validateWorkflowGraphOverlay(base, overlay).ok).toBe(false);
  });

  it("REJECTS an overlay that keeps the qa id but replaces its station with reflect", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: (base.nodes ?? []).map((n) =>
        n.id === "product.qa" ? { ...n, station: "reflect" } : n,
      ),
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("required-node-station-changed");
  });

  it.each(Object.entries(PROTECTED_NODE_STATIONS))(
    "REJECTS a station swap on %s",
    (protectedId, station) => {
      for (const cls of WORKFLOW_CLASSES) {
        const base = loadGraph(cls);
        if (!(base.nodes ?? []).some((n) => n.id === protectedId)) continue;
        expect((base.nodes ?? []).find((n) => n.id === protectedId)?.station).toBe(station);
        const overlay: WorkflowGraph = {
          ...base,
          nodes: (base.nodes ?? []).map((n) =>
            n.id === protectedId ? { ...n, station: "reflect" } : n,
          ),
        };
        expect(validateWorkflowGraphOverlay(base, overlay).ok).toBe(false);
      }
    },
  );

  it("REJECTS an overlay that clears `required` on a protected node", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: (base.nodes ?? []).map((n) =>
        n.id === "d8" ? { ...n, required: false } : n,
      ),
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("required-node-made-skippable");
  });

  it("REJECTS making the interactive ops first run operator-skippable", () => {
    const base = loadGraph("ops");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: (base.nodes ?? []).map((n) =>
        n.id === "ops.first-run" ? { ...n, skip_when: "operator" as const } : n,
      ),
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("required-node-made-skippable");
  });

  it("the shipped product default does NOT bypass its own qa gate", () => {
    const base = loadGraph("product");
    expect(RELEASE_GATE.gate).toBe("product.qa");
    expect(validateWorkflowGraphOverlay(base, base).violations).toEqual([]);
  });

  // ── codex G-lane r2: the walk is entry-relative, and nodes merge field-wise ──

  it("REJECTS an overlay whose entry is product.release (starts the run past every gate)", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = { ...base, entry: "product.release" };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("bypasses-required-node");
    expect(result.violations.some((v) => /downstream of required node/.test(v.detail))).toBe(true);
  });

  it("REJECTS an ops overlay whose entry is ops.release (skips the interactive first run)", () => {
    const base = loadGraph("ops");
    const overlay: WorkflowGraph = { ...base, entry: "ops.release" };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("bypasses-required-node");
  });

  it("REJECTS a spec -> build edge that bypasses D5", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      edges: [...(base.edges ?? []), { from: "spec", on: "skip", to: "build" }],
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "bypasses-required-node" && /'d5'/.test(v.detail))).toBe(true);
  });

  it("REJECTS a product.qa -> product.release edge that bypasses D8", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      edges: [...(base.edges ?? []), { from: "product.qa", on: "skip", to: "product.release" }],
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.rule === "bypasses-required-node" && /'d8'/.test(v.detail))).toBe(true);
  });

  it.each([...WORKFLOW_CLASSES])("ACCEPTS the shipped %s default under the entry-relative walk", (cls) => {
    const base = loadGraph(cls);
    expect(validateWorkflowGraphOverlay(base, base).violations).toEqual([]);
  });

  it("a bare {id: product.qa} overlay node INHERITS the shipped gate and is accepted", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: (base.nodes ?? []).map((n) => (n.id === "product.qa" ? { id: "product.qa" } : n)),
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);

    // The MERGED OUTPUT is the point: a bare id must not strip the gate.
    const merged = applyWorkflowGraphOverlay(base, overlay);
    const qa = (merged.nodes ?? []).find((n) => n.id === "product.qa");
    const shipped = (base.nodes ?? []).find((n) => n.id === "product.qa");
    expect(qa).toBeDefined();
    expect(qa?.station).toBe(PROTECTED_NODE_STATIONS["product.qa"]);
    expect(qa?.station).toBe(shipped?.station);
    expect(qa?.assembler).toBe(shipped?.assembler);
    expect(qa?.required).toBe(true);
  });

  it("an overlay node that explicitly clears required is still REJECTED after the merge", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: (base.nodes ?? []).map((n) =>
        n.id === "product.qa" ? { id: "product.qa", required: false } : n,
      ),
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("required-node-made-skippable");
    expect(() => applyWorkflowGraphOverlay(base, overlay)).toThrow(/clears required/);
  });

  it("a stated overlay field still wins over the inherited default", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: (base.nodes ?? []).map((n) =>
        n.id === "build" ? { id: "build", inner_loop: false } : n,
      ),
    };
    const merged = applyWorkflowGraphOverlay(base, overlay);
    const build = (merged.nodes ?? []).find((n) => n.id === "build");
    expect(build?.inner_loop).toBe(false);
    expect(build?.station).toBe((base.nodes ?? []).find((n) => n.id === "build")?.station);
  });

  // ── codex G-lane r3: the rules are structural, not a list of known moves ──

  it("REJECTS a NEW entry node that does release work behind no gate", () => {
    // The exact probe: invent a node the shipped graph never declared, give it the
    // release role, and enter there. No id-keyed gated set has heard of it.
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      entry: "hotfix",
      nodes: [...(base.nodes ?? []), { id: "hotfix", station: "ops-runbooks", assembler: "operations" }],
      edges: [...(base.edges ?? []), { from: "hotfix", on: "next", to: "harvest" }],
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("release-work-ungated");
    // and it is named by ROLE, not by id
    expect(result.violations.some((v) => /does release work/.test(v.detail))).toBe(true);
  });

  it("REJECTS release work reachable from the entry even when it is not the entry", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: [...(base.nodes ?? []), { id: "hotfix", station: "ops-runbooks", assembler: "operations" }],
      edges: [...(base.edges ?? []), { from: "spec", on: "skip", to: "hotfix" }],
    };
    expect(validateWorkflowGraphOverlay(base, overlay).violations.map((v) => v.rule)).toContain(
      "release-work-ungated",
    );
  });

  it("REJECTS a duplicated protected id, and the merged output never carries both", () => {
    // The exact probe: a hollowed-out decoy beside a clean restatement.
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: [
        ...(base.nodes ?? []).filter((n) => n.id !== "product.qa"),
        { id: "product.qa", station: "reflect", skip_when: "operator" as const },
        { id: "product.qa" },
      ],
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("duplicate-node-id");
    expect(result.violations.map((v) => v.rule)).toContain("protected-node-field-override");
    expect(() => applyWorkflowGraphOverlay(base, overlay)).toThrow(/declares node id 'product\.qa' 2 times/);
  });

  it("REJECTS a duplicated ORDINARY id too (the rule is about the merged graph, not the gate)", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: [...(base.nodes ?? []), { id: "build" }],
    };
    expect(validateWorkflowGraphOverlay(base, overlay).violations.map((v) => v.rule)).toContain(
      "duplicate-node-id",
    );
  });

  it("REJECTS reassigning product.qa's assembler to reflect", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: (base.nodes ?? []).map((n) =>
        n.id === "product.qa" ? { id: "product.qa", assembler: "reflect" } : n,
      ),
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("protected-node-field-override");
    expect(result.violations.some((v) => /'assembler'/.test(v.detail))).toBe(true);
    expect(result.violations.map((v) => v.rule)).toContain("protected-role-reassigned");
  });

  it.each(Object.entries(PROTECTED_NODE_ROLES))(
    "REJECTS an ordinary node wearing %s's role",
    (ownerId, role) => {
      const base = loadGraph("product");
      if (!(base.nodes ?? []).some((n) => n.id === ownerId)) return;
      for (const field of ["station", "assembler"] as const) {
        const overlay: WorkflowGraph = {
          ...base,
          nodes: (base.nodes ?? []).map((n) =>
            n.id === "spec" ? { ...n, [field]: role[field] } : n,
          ),
        };
        const result = validateWorkflowGraphOverlay(base, overlay);
        expect(result.ok).toBe(false);
        expect(result.violations.map((v) => v.rule)).toContain("protected-role-reassigned");
      }
    },
  );

  it("REJECTS an edge whose `from` names no node (P2: strands the gate)", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      edges: [...(base.edges ?? []), { from: "nonexistent", on: "next", to: "product.qa" }],
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("edge-endpoint-unknown");
    expect(result.violations.some((v) => /edge from 'nonexistent'/.test(v.detail))).toBe(true);
  });

  it("REJECTS an overlay that strands a gate out of reach of the entry", () => {
    const base = loadGraph("product");
    // Keep every node, but cut the only routes into the qa gate.
    const overlay: WorkflowGraph = {
      ...base,
      edges: (base.edges ?? []).filter((e) => e.to !== "product.qa"),
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("gate-unreachable");
  });

  it.each([...WORKFLOW_CLASSES])("%s.yaml agrees with the pinned protected + release roles", (cls) => {
    const graph = loadGraph(cls);
    for (const node of graph.nodes ?? []) {
      const owned = PROTECTED_NODE_ROLES[node.id];
      if (owned) {
        // A gate carries its own role...
        expect(`${node.id}:${node.station}/${node.assembler}`).toBe(
          `${node.id}:${owned.station}/${owned.assembler}`,
        );
        continue;
      }
      // ...and nothing else wears it.
      for (const [ownerId, role] of Object.entries(PROTECTED_NODE_ROLES)) {
        if (!(graph.nodes ?? []).some((n) => n.id === ownerId)) continue;
        expect(`${node.id}:${node.station}`).not.toBe(`${node.id}:${role.station}`);
        expect(`${node.id}:${node.assembler}`).not.toBe(`${node.id}:${role.assembler}`);
      }
    }
  });

  it("recognises release-shaped work by role in the shipped graphs", () => {
    const product = loadGraph("product");
    expect(isReleaseShaped((product.nodes ?? []).find((n) => n.id === "product.release"))).toBe(true);
    expect(isReleaseShaped((product.nodes ?? []).find((n) => n.id === "build"))).toBe(false);
    const ops = loadGraph("ops");
    for (const id of ["ops.release", "ops.incident", "ops.monitoring", "ops.maintenance"]) {
      expect(isReleaseShaped((ops.nodes ?? []).find((n) => n.id === id))).toBe(true);
    }
    expect(RELEASE_ROLE.station).toBe("ops-runbooks");
    expect(RELEASE_ROLE.assembler).toBe("operations");
  });

  // ── codex G-lane r4: dominance, cross-class targets, class-scoped ids ──────

  it("REJECTS a reserved gate id borrowed into a class whose default never declared it", () => {
    // The exact probe: ops.first-run dropped into PRODUCT, entered from intake.
    // It is not that class's gate — it is a new node wearing a protected name.
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: [...(base.nodes ?? []), { id: "ops.first-run", station: "ops-runbooks", assembler: "operations" }],
      edges: [...(base.edges ?? []), { from: "intake", on: "skip", to: "ops.first-run" }],
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("protected-role-reassigned");
    expect(result.violations.map((v) => v.rule)).toContain("release-work-ungated");
    expect(() => applyWorkflowGraphOverlay(base, overlay)).toThrow();
  });

  it("still treats ops.first-run as the gate in the OPS class, where the default declares it", () => {
    const ops = loadGraph("ops");
    expect(validateWorkflowGraphOverlay(ops, ops).violations).toEqual([]);
  });

  it("REJECTS a cross-class edge target that lands past the destination's gates", () => {
    // The exact probe: an intake edge to {class: "product", entry: "product.release"}.
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      edges: [
        ...(base.edges ?? []),
        { from: "intake", on: "change_class", to: { class: "product", entry: "product.release" }, change_class: "product" },
      ],
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("cross-class-entry-bypasses-gate");
    // and the traversal SEES it, rather than treating it as an exit
    expect(result.violations.map((v) => v.rule)).toContain("release-work-ungated");
    expect(() => applyWorkflowGraphOverlay(base, overlay)).toThrow();
  });

  it("ACCEPTS the shipped cross-class handoffs, which land on the destination's own entry", () => {
    for (const cls of WORKFLOW_CLASSES) {
      const graph = loadGraph(cls);
      const result = validateWorkflowGraphOverlay(graph, graph);
      expect(`${cls}:${result.violations.map((v) => v.rule).join(",")}`).toBe(`${cls}:`);
    }
  });

  it("resolves a cross-class target against a supplied destination graph", () => {
    const base = loadGraph("product");
    const classDefaults = Object.fromEntries(
      WORKFLOW_CLASSES.map((c) => [c, loadGraph(c)]),
    ) as Record<string, WorkflowGraph>;

    // `reproduce` sits upstream of every debug gate (debug declares none), so a
    // handoff there is legal once the destination graph is in hand.
    const upstream: WorkflowGraph = {
      ...base,
      edges: [
        ...(base.edges ?? []),
        { from: "intake", on: "change_class", to: { class: "debug", entry: "reproduce" }, change_class: "debug" },
      ],
    };
    expect(validateWorkflowGraphOverlay(base, upstream, classDefaults).violations).toEqual([]);
    // Without the destination graph the same target cannot be shown safe.
    expect(validateWorkflowGraphOverlay(base, upstream).violations.map((v) => v.rule)).toContain(
      "cross-class-entry-bypasses-gate",
    );

    // NON-VACUITY: with the destination graph in hand, a target that IS behind a
    // gate is still refused — the supplied-graph path rejects, it does not wave
    // everything through.
    const behindAGate: WorkflowGraph = {
      ...base,
      edges: [
        ...(base.edges ?? []),
        { from: "intake", on: "change_class", to: { class: "product", entry: "d8" }, change_class: "product" },
      ],
    };
    const refused = validateWorkflowGraphOverlay(base, behindAGate, classDefaults);
    expect(refused.violations.map((v) => v.rule)).toContain("cross-class-entry-bypasses-gate");
    expect(refused.violations.some((v) => /behind required node\(s\).*'d5'/.test(v.detail))).toBe(true);
  });

  it("REJECTS an entry that names no node, even in a class with no gates (codex r5 P2)", () => {
    // Reachability is vacuous in `debug` (no gates), so only an explicit
    // existence check can refuse this. Reproduced for research and init too.
    for (const cls of ["debug", "research", "init", "product"]) {
      const base = loadGraph(cls);
      const overlay: WorkflowGraph = { ...base, entry: "nonexistent" };
      const result = validateWorkflowGraphOverlay(base, overlay);
      expect(`${cls}:${result.violations.map((v) => v.rule).join(",")}`).toContain("entry-unknown-node");
      expect(() => applyWorkflowGraphOverlay(base, overlay)).toThrow(/names no node/);
    }
  });

  it("REJECTS a cross-class handoff whose entry names no node in the destination (codex r5 P2)", () => {
    const base = loadGraph("product");
    const classDefaults = Object.fromEntries(
      WORKFLOW_CLASSES.map((c) => [c, loadGraph(c)]),
    ) as Record<string, WorkflowGraph>;
    const overlay: WorkflowGraph = {
      ...base,
      edges: [
        ...(base.edges ?? []),
        { from: "intake", on: "change_class", to: { class: "debug", entry: "nonexistent" }, change_class: "debug" },
      ],
    };
    // debug has an empty gate set, which used to wave the target through.
    const result = validateWorkflowGraphOverlay(base, overlay, classDefaults);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("cross-class-entry-unknown-node");
  });

  it("REJECTS a same-class object target that names a node the overlay deleted (codex r6 P2)", () => {
    // The exact probe: debug minus `recall`, entry moved to `reproduce`, and a
    // handoff back to {class: "debug", entry: "recall"} — the pinned default
    // entry, which the shortcut used to accept before checking existence.
    const base = loadGraph("debug");
    const overlay: WorkflowGraph = {
      ...base,
      entry: "reproduce",
      nodes: (base.nodes ?? []).filter((n) => n?.id !== "recall"),
      edges: [
        ...(base.edges ?? []).filter((e) => e.from !== "recall" && e.to !== "recall"),
        { from: "reproduce", on: "change_class", to: { class: "debug", entry: "recall" }, change_class: "debug" },
      ],
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("cross-class-entry-unknown-node");
    expect(() => applyWorkflowGraphOverlay(base, overlay)).toThrow(/names no node/);
  });

  it("ACCEPTS a new operations node reached only AFTER product.release (P2: dominance, not membership)", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: [...(base.nodes ?? []), { id: "post-release-smoke", station: "ops-runbooks", assembler: "operations" }],
      edges: [
        ...(base.edges ?? []),
        { from: "product.release", on: "next", to: "post-release-smoke" },
        { from: "post-release-smoke", on: "next", to: "harvest" },
      ],
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);

    const merged = applyWorkflowGraphOverlay(base, overlay);
    const added = (merged.nodes ?? []).find((n) => n.id === "post-release-smoke");
    expect(added).toBeDefined();
    expect(added?.assembler).toBe("operations");
    expect((merged.edges ?? []).some((e) => e.from === "product.release" && e.to === "post-release-smoke")).toBe(true);
  });

  it("REJECTS the same node when it is placed BEFORE a gate", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: [...(base.nodes ?? []), { id: "post-release-smoke", station: "ops-runbooks", assembler: "operations" }],
      edges: [
        ...(base.edges ?? []),
        { from: "spec", on: "skip", to: "post-release-smoke" },
        { from: "post-release-smoke", on: "next", to: "harvest" },
      ],
    };
    expect(validateWorkflowGraphOverlay(base, overlay).violations.map((v) => v.rule)).toContain(
      "release-work-ungated",
    );
  });

  it.each([...WORKFLOW_CLASSES])("%s.yaml entry matches the pinned CLASS_DEFAULT_ENTRIES", (cls) => {
    expect(`${cls}:${loadGraph(cls).entry}`).toBe(`${cls}:${CLASS_DEFAULT_ENTRIES[cls]}`);
  });

  it("REJECTS an overlay that authors a sixth class", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = { ...base, class: "experiment" };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("unknown-class");
    expect(validateWorkflowGraphDocument(overlay).ok).toBe(false);
  });

  it("REJECTS a change_class edge that leaves the closed five", () => {
    const base = loadGraph("research");
    const overlay: WorkflowGraph = {
      ...base,
      edges: [...(base.edges ?? []), { from: "recall", on: "change_class", to: { class: "experiment", entry: "x" }, change_class: "experiment" }],
    };
    expect(validateWorkflowGraphOverlay(base, overlay).ok).toBe(false);
  });

  it("REJECTS an edge firing on an outcome outside the decision enum", () => {
    const base = loadGraph("debug");
    const overlay: WorkflowGraph = { ...base, edges: [...(base.edges ?? []), { from: "fix", on: "maybe", to: "verify" }] };
    expect(validateWorkflowGraphOverlay(base, overlay).ok).toBe(false);
  });

  it("ACCEPTS an overlay that only reorders and drops non-required nodes", () => {
    const base = loadGraph("product");
    const overlay: WorkflowGraph = {
      ...base,
      nodes: (base.nodes ?? []).filter((n) => n.id !== "product.release").reverse(),
      edges: (base.edges ?? []).filter((e) => e.from !== "product.release" && e.to !== "product.release"),
    };
    const result = validateWorkflowGraphOverlay(base, overlay);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

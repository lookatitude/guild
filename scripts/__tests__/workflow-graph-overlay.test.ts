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

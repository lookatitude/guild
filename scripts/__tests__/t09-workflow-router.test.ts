/**
 * t09-workflow-router.test.ts — U-LOOP class-graph runtime fixtures
 * (KTD40 / KTD42 / KTD52 / KTD56 / R55 / R64 / R68).
 *
 * The named "Done when" clauses this file pins:
 *   - an unrecognized decision outcome ESCALATES
 *   - a research run does not spawn ideate
 *   - a project overlay that drops product qa before release fails lint
 *   - an overlay that requires loop-plan-review as a graph node fails lint
 *   - the authored registries are not the source of truth: routing reads the graph
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { WORKFLOW_CLASSES, applyWorkflowGraphOverlay, type WorkflowGraph } from "../../src/domains/lifecycle";
import { loadAllClassGraphs, loadClassGraph } from "../../src/domains/lifecycle";
import { bindWorkflowCursor, normalizeWorkflowDecision, readWorkflowCursor, routeWorkflowDecision, routeWorkflowDecisionAtRun, writeWorkflowCursor } from "../../src/domains/lifecycle";

const REPO = path.resolve(__dirname, "..", "..");

let sandbox: string;
beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t09-router-"));
});
afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function product(): WorkflowGraph {
  return loadClassGraph("product", { pluginRoot: REPO, ignoreOverlay: true }).graph;
}

describe("authored class graphs load and merge", () => {
  it("ships exactly the five closed classes and every one loads", () => {
    const all = loadAllClassGraphs({ pluginRoot: REPO, ignoreOverlay: true });
    expect(Object.keys(all).sort()).toEqual([...WORKFLOW_CLASSES].sort());
  });

  it("a research run never reaches an ideate node — the class graph has none", () => {
    const research = loadClassGraph("research", { pluginRoot: REPO, ignoreOverlay: true }).graph;
    const ids = (research.nodes ?? []).map((n) => n.id);
    expect(ids).not.toContain("ideate");
    expect(ids).toContain("packet");
  });

  it("adversarial wrappers are L3, not graph nodes (KTD52 / R64)", () => {
    for (const klass of WORKFLOW_CLASSES) {
      const g = loadClassGraph(klass, { pluginRoot: REPO, ignoreOverlay: true }).graph;
      const ids = (g.nodes ?? []).map((n) => n.id);
      for (const wrapper of ["loop-clarify", "loop-plan-review", "loop-implement"]) {
        expect(ids).not.toContain(wrapper);
      }
    }
  });

  it("an overlay that drops product qa before release is REJECTED", () => {
    const base = product();
    const overlay: WorkflowGraph = {
      ...base,
      nodes: (base.nodes ?? []).filter((n) => n.id !== "product.qa"),
    };
    expect(() => applyWorkflowGraphOverlay(base, overlay)).toThrow(/product\.qa|required/i);
  });

  it("an overlay that requires loop-plan-review as a graph node is REJECTED", () => {
    const base = product();
    const overlay: WorkflowGraph = {
      ...base,
      nodes: [
        ...(base.nodes ?? []),
        { id: "loop-plan-review", station: "runtime-qa", assembler: "quality", required: true },
      ],
    };
    // It wears the qa gate's role, so it is the gate impersonated (KTD42).
    expect(() => applyWorkflowGraphOverlay(base, overlay)).toThrow();
  });
});

describe("guild.workflow_decision.v1 routing", () => {
  const cursor = () => bindWorkflowCursor({
    run_id: "run-1",
    class: "product",
    graph: product(),
    bound_from: "intake",
  });

  it("an unrecognized outcome normalizes to escalate", () => {
    const d = normalizeWorkflowDecision({ run_id: "run-1", node_id: "build", outcome: "continue" });
    expect(d.outcome).toBe("escalate");
    expect(d.reason).toMatch(/unrecognized/);
  });

  it("an unrecognized outcome ESCALATES and does not move the cursor", () => {
    const c = cursor();
    const at = { ...c, node_id: "build" };
    const r = routeWorkflowDecision({
      cursor: at,
      graph: product(),
      decision: { run_id: "run-1", node_id: "build", outcome: "proceed-anyway" },
    });
    expect(r.escalated).toBe(true);
    expect(r.rejection).toBe("unrecognized-outcome");
    expect(r.cursor.node_id).toBe("build");
  });

  it("a legal outcome advances along the authored edge", () => {
    const r = routeWorkflowDecision({
      cursor: { ...cursor(), node_id: "build" },
      graph: product(),
      decision: { run_id: "run-1", node_id: "build", outcome: "next" },
    });
    expect(r.escalated).toBe(false);
    expect(r.cursor.node_id).toBe("product.qa");
  });

  it("an outcome with no authored edge from this node escalates", () => {
    const r = routeWorkflowDecision({
      cursor: { ...cursor(), node_id: "product.qa" },
      graph: product(),
      decision: { run_id: "run-1", node_id: "product.qa", outcome: "change_class", to_class: "ops" },
    });
    expect(r.escalated).toBe(true);
  });

  it("the decision envelope cannot name a node — only an outcome", () => {
    const r = routeWorkflowDecision({
      cursor: { ...cursor(), node_id: "spec" },
      graph: product(),
      // `to` is not part of guild.workflow_decision.v1; it must be ignored.
      decision: { run_id: "run-1", node_id: "spec", outcome: "next", to: "product.release" },
    });
    expect(r.cursor.node_id).toBe("ideate");
  });

  it("change_class enters the destination at ITS entry, never past a gate", () => {
    const graphs = loadAllClassGraphs({ pluginRoot: REPO, ignoreOverlay: true });
    const r = routeWorkflowDecision({
      cursor: { ...cursor(), node_id: "intake" },
      graph: graphs.product,
      classGraphs: graphs,
      decision: { run_id: "run-1", node_id: "intake", outcome: "change_class", to_class: "research" },
    });
    expect(r.escalated).toBe(false);
    expect(r.cursor.class).toBe("research");
    expect(r.cursor.node_id).toBe(graphs.research.entry);
    expect(r.cursor.bound_from).toBe("change_class");
  });

  it("a change_class edge that re-enters a class past its entry is refused", () => {
    const base = product();
    const rigged: WorkflowGraph = {
      ...base,
      edges: [
        ...(base.edges ?? []).filter((e) => !(e.from === "intake" && e.on === "change_class")),
        {
          from: "intake",
          on: "change_class",
          to: { class: "research", entry: "harvest" },
          change_class: "research",
        },
      ],
    };
    const graphs = loadAllClassGraphs({ pluginRoot: REPO, ignoreOverlay: true });
    const r = routeWorkflowDecision({
      cursor: { ...cursor(), node_id: "intake" },
      graph: rigged,
      classGraphs: graphs,
      decision: { run_id: "run-1", node_id: "intake", outcome: "change_class", to_class: "research" },
    });
    expect(r.escalated).toBe(true);
    expect(r.rejection).toBe("change-class-entry-bypass");
  });
});

describe("guild.workflow_cursor.v1 on the run", () => {
  it("round-trips, so a crash-resumed run reads the node it stopped on", () => {
    const runDir = path.join(sandbox, "runs", "run-1");
    const c = bindWorkflowCursor({ run_id: "run-1", class: "debug", graph: loadClassGraph("debug", { pluginRoot: REPO, ignoreOverlay: true }).graph, bound_from: "typed_verb" });
    writeWorkflowCursor(runDir, c);
    expect(readWorkflowCursor(runDir)).toEqual(c);
  });

  it("a corrupt cursor reads as missing rather than resuming at an unnamed node", () => {
    const runDir = path.join(sandbox, "runs", "run-2");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "workflow-cursor.json"), "{not json", "utf8");
    expect(readWorkflowCursor(runDir)).toBeNull();
  });
});

describe("the cursor is the source of truth for the current node (codex G-lane r1 P1)", () => {
  const productGraph = () => product();

  it("the shipped product graph cannot reach release from intake in one step", () => {
    const g = productGraph();
    const oneStep = (g.edges ?? []).filter((e) => e.from === "intake").map((e) => e.to);
    expect(oneStep).not.toContain("product.release");
    expect(oneStep).not.toContain("harvest");
  });

  it("a decision naming source 'product.release' from an intake cursor is REFUSED", () => {
    const runDir = path.join(sandbox, "runs", "run-forge");
    const c = { ...bindWorkflowCursor({ run_id: "run-forge", class: "product" as const, graph: productGraph(), bound_from: "intake" as const }), node_id: "intake" };
    writeWorkflowCursor(runDir, c);

    const r = routeWorkflowDecisionAtRun(runDir, {
      graph: productGraph(),
      // Forged source: the node the run is NOT on. Taking it would have walked the
      // `product.release -> harvest` edge from an intake cursor.
      decision: { run_id: "run-forge", node_id: "product.release", outcome: "next" },
    });

    expect(r.escalated).toBe(true);
    expect(r.rejection).toBe("source-cursor-mismatch");
    expect(r.cursor.node_id).toBe("intake");
    expect(readWorkflowCursor(runDir)!.node_id).toBe("intake");
  });

  it("routing reads the PERSISTED cursor, not one the caller hands over", () => {
    const runDir = path.join(sandbox, "runs", "run-persist");
    const base = bindWorkflowCursor({ run_id: "run-persist", class: "product", graph: productGraph(), bound_from: "intake" });
    writeWorkflowCursor(runDir, { ...base, node_id: "build" });

    const r = routeWorkflowDecisionAtRun(runDir, {
      // A caller-supplied cursor parked on `d8` must be ignored entirely.
      cursor: { ...base, node_id: "d8" },
      graph: productGraph(),
      decision: { run_id: "run-persist", outcome: "next" },
    });

    expect(r.escalated).toBe(false);
    expect(r.cursor.node_id).toBe("product.qa");
    expect(readWorkflowCursor(runDir)!.node_id).toBe("product.qa");
  });

  // codex G-lane r2 P1: no cursor on disk means the run is at the class ENTRY,
  // not wherever the caller says. The fallback to a caller-supplied cursor made
  // the FIRST decision of a run the one request the persisted-cursor rule could
  // not police.
  it("with no persisted cursor a decision naming a source other than the entry is REFUSED", () => {
    const runDir = path.join(sandbox, "runs", "run-cold-forge");
    const base = bindWorkflowCursor({ run_id: "run-cold-forge", class: "product", graph: productGraph(), bound_from: "intake" });

    const r = routeWorkflowDecisionAtRun(runDir, {
      // Both halves of the forgery: a caller cursor parked past the gates AND a
      // decision naming that node as its source.
      cursor: { ...base, node_id: "d8" },
      graph: productGraph(),
      decision: { run_id: "run-cold-forge", node_id: "d8", outcome: "next" },
    });

    expect(r.escalated).toBe(true);
    expect(r.rejection).toBe("source-cursor-mismatch");
    expect(r.cursor.node_id).toBe(productGraph().entry);
    expect(readWorkflowCursor(runDir)!.node_id).toBe(productGraph().entry);
  });

  it("with no persisted cursor a decision naming the ENTRY is routed and the cursor is persisted", () => {
    const runDir = path.join(sandbox, "runs", "run-cold-ok");
    const entry = productGraph().entry as string;

    const r = routeWorkflowDecisionAtRun(runDir, {
      graph: productGraph(),
      decision: { run_id: "run-cold-ok", node_id: entry, outcome: "next" },
    });

    expect(r.escalated).toBe(false);
    expect(r.cursor.node_id).not.toBe(entry);
    expect(readWorkflowCursor(runDir)!.node_id).toBe(r.cursor.node_id);
    expect(r.cursor.class).toBe("product");
  });

  it("an advance is validated against the loaded graph — an invalid graph cannot move the cursor", () => {
    const base = productGraph();
    // A decoy `product.qa` beside the real one: the merged graph has no single
    // answer to "what is product.qa". The `intake -> explore` edge is untouched,
    // and the advance must STILL not be taken — an invalid graph moves nothing.
    const tampered: WorkflowGraph = {
      ...base,
      nodes: [...(base.nodes ?? []), { id: "product.qa", station: "reflect", skip_when: "operator" }],
    };
    const r = routeWorkflowDecision({
      cursor: { ...bindWorkflowCursor({ run_id: "run-1", class: "product", graph: base, bound_from: "intake" }), node_id: "intake" },
      graph: tampered,
      decision: { run_id: "run-1", node_id: "intake", outcome: "next" },
    });
    expect(r.escalated).toBe(true);
    expect(r.rejection).toBe("graph-invalid");
    expect(r.cursor.node_id).toBe("intake");
  });
});

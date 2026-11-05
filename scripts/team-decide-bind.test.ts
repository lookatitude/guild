/**
 * W04 wiring of W03's phaseBinding into the team-decide CLI: `bind` prints the
 * `plan_ref` + `provenance` a phase proposal must carry before approval, read
 * from contained project files and the project's component tree.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { composeProposal, proposalHashOf } from "../src/domains/teams";
import { PHASE_BINDING_PREFIX, composePhase, createComponentRegistry, loadPhaseCompositionInputs } from "../src/domains/lifecycle";
import { main } from "./team-decide";

const COMPONENT = [
  "schema_version: guild.workflow_component.v1",
  "id: research-short",
  'version: "1"',
  "effects: [write]",
  "inputs: []",
  "outputs: []",
  "body: {kind: task, id: survey, effect: write, role: researcher, capabilities: [research], inputs: [], outputs: []}",
  "",
].join("\n");

function proposal() {
  return composeProposal({
    run_id: "run-bind",
    phase: "ideate",
    participants: [{ participant_id: "ana", participation_kind: "worker", role_ref: "researcher", necessity_rationale: "serves research", owned_obligations: ["ob-ana"], depends_on: [], tier: "mid", purpose: "general", capability_scope: ["research"], backend: "team" }],
    obligations: [{ obligation_id: "ob-ana", source: "plan_item", text: "research", disposition: { owners: ["ana"] } }],
  } as never);
}

let root: string;
let out: string;
let err: string;
const w = { o: process.stdout.write, e: process.stderr.write };

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "w04-bind-")));
  for (const d of [".guild/components", ".guild/team", ".guild/plan"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild/components/research-short.yaml"), COMPONENT);
  fs.writeFileSync(path.join(root, ".guild/team/p.ideate.yaml"), JSON.stringify(proposal()));
  fs.writeFileSync(path.join(root, ".guild/plan/p.md"), "# plan\n");
  fs.writeFileSync(path.join(root, ".guild/qa-policy.yaml"), "schema_version: guild.qa_policy.v1\nrequired: []\n");
  out = "";
  err = "";
  process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
});
afterEach(() => {
  process.stdout.write = w.o;
  process.stderr.write = w.e;
});

const ARGS = (over: Record<string, string> = {}) => {
  const f: Record<string, string> = { cwd: root, phase: "ideate", class: "research", "source-id": "project", "workflow-id": "research-wf", component: "research-short@1", proposal: ".guild/team/p.ideate.yaml", plan: ".guild/plan/p.md", "qa-policy": ".guild/qa-policy.yaml", ...over };
  return ["bind", ...Object.entries(f).flatMap(([k, v]) => [`--${k}`, v])];
};

describe("team-decide bind", () => {
  it("prints the binding that makes the proposal compose", () => {
    expect(main(ARGS())).toBe(0);
    const b = JSON.parse(out) as { plan_ref: { path: string; sha256: string }; provenance: string; proposal: Record<string, unknown> };
    expect(b.plan_ref.path).toBe(".guild/plan/p.md");
    expect(b.provenance.startsWith(PHASE_BINDING_PREFIX)).toBe(true);
    // The returned proposal carries exactly that binding under a recomputed hash, and composes.
    const loaded = loadPhaseCompositionInputs({ root, proposal: ".guild/team/p.ideate.yaml", plan: ".guild/plan/p.md", qa_policy: ".guild/qa-policy.yaml" });
    if (!loaded.ok) throw new Error("load");
    const p = b.proposal;
    expect(p.plan_ref).toEqual(b.plan_ref);
    expect(p.provenance).toBe(b.provenance);
    expect(p.proposal_hash).toBe(proposalHashOf(p as never));
    expect(p.proposal_hash).not.toBe((loaded.proposal as Record<string, unknown>).proposal_hash);
    const reg = createComponentRegistry([require("js-yaml").load(COMPONENT)]);
    if (!reg.ok) throw new Error("reg");
    const c = composePhase(reg.registry, { phase: "ideate", class: "research", workflow: { source_id: "project", id: "research-wf" }, root: { id: "research-short", version: "1" }, proposal: p, plan: loaded.plan, qa_policy: loaded.qa_policy });
    expect(c.ok).toBe(true);
  });

  it("a changed plan changes the binding", () => {
    expect(main(ARGS())).toBe(0);
    const first = JSON.parse(out).provenance;
    out = "";
    fs.writeFileSync(path.join(root, ".guild/plan/p.md"), "# plan v2\n");
    expect(main(ARGS())).toBe(0);
    expect(JSON.parse(out).provenance).not.toBe(first);
  });

  it("refuses escaping paths, unknown components and missing flags", () => {
    expect(main(ARGS({ plan: "../outside.md" }))).toBe(3);
    expect(err).toContain("path-not-contained");
    err = "";
    expect(main(ARGS({ component: "nope@1" }))).toBe(3);
    expect(err).toContain("unknown-component");
    expect(main(ARGS({ component: "research-short" }))).toBe(1);
    // A component file symlinked out of the project is refused, not read.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "w04-bind-out-"));
    fs.writeFileSync(path.join(outside, "ext.yaml"), COMPONENT.replace("research-short", "external"));
    fs.symlinkSync(path.join(outside, "ext.yaml"), path.join(root, ".guild/components/external.yaml"));
    err = "";
    expect(main(ARGS())).toBe(3);
    expect(err).toContain("path-not-contained");
    const noPhase = ARGS().filter((a, i, all) => a !== "--phase" && all[i - 1] !== "--phase");
    expect(main(noPhase)).toBe(1);
  });
});

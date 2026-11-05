/**
 * W03 — compose the phase workflow and the phase team together (AT21).
 *
 * Fixture: project A runs a short research chain and a draft → quality-QA
 * implementation chain; project B runs research → external validation →
 * architect as a bounded loop and an implementation chain whose QA policy needs
 * security and UX assurance. The composition must explain role/capability
 * obligations with exact versions and hashes, keep participant approval
 * required, and never let a role label authorise release or bypass approval.
 */

import { describe, it, expect } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { composeProposal, recordDecision } from "../teams";
import { createComponentRegistry, type WorkflowComponentRegistry } from "./workflow-component-compiler";
import {
  PHASE_COMPOSITION_SCHEMA_VERSION,
  QA_POLICY_SCHEMA_VERSION,
  composePhase,
  loadPhaseCompositionInputs,
  phaseDispatchGate,
  verifyPhaseComposition,
  type PhaseCompositionInput,
  type PhaseCompositionResult,
} from "./phase-composition";

// ---------------------------------------------------------------- fixtures

function task(id: string, extra: Record<string, unknown> = {}) {
  return { kind: "task", id, effect: "write", role: "developer", capabilities: ["code"], inputs: [], outputs: [], ...extra };
}
function gate(id: string, role: string) {
  return task(id, { effect: "gate", gate_role: role, role: "owner", capabilities: [] });
}
function component(id: string, effects: string[], body: unknown, version = "1") {
  return { schema_version: "guild.workflow_component.v1", id, version, effects, inputs: [], outputs: [], body };
}
function seq(id: string, steps: unknown[]) {
  return { kind: "sequence", id, steps };
}
function call(id: string, ref: string, version = "1") {
  return { kind: "call", id, component: { id: ref, version } };
}

const RESEARCH_SHORT = component("research-short", ["write"], task("survey", { role: "researcher", capabilities: ["research"] }));
const RESEARCH = component("research", ["write"], task("investigate", { role: "researcher", capabilities: ["research"] }));
const EXTERNAL_VALIDATION = component("external-validation", ["review"], task("validate", { effect: "review", role: "validator", capabilities: ["validate"] }));
const ARCHITECT = component("architect", ["write"], task("design", { role: "architect", capabilities: ["design"] }));
const RESEARCH_LOOP = component("research-loop", ["write", "review"], {
  kind: "repeat",
  id: "loop",
  max_rounds: 3,
  until: { kind: "all_of", conditions: [{ kind: "outcome", equals: "approve" }, { kind: "no_unresolved_questions" }] },
  body: seq("round", [call("r", "research"), call("v", "external-validation"), call("a", "architect")]),
});

function assurance(id: string, kind: string, role: string) {
  return task(id, { effect: "review", role, capabilities: [`assurance:${kind}`], within_gate: "qa", required: true });
}
const IMPL_A = component("impl-a", ["write", "review", "gate"], seq("main", [
  gate("d5", "d5"),
  task("build"),
  assurance("quality", "quality", "qa-reviewer"),
  gate("qa", "qa"),
  gate("d8", "d8"),
]));
const IMPL_B = component("impl-b", ["write", "review", "gate"], seq("main", [
  gate("d5", "d5"),
  task("build"),
  assurance("security", "security", "security-reviewer"),
  assurance("ux", "ux", "ux-reviewer"),
  gate("qa", "qa"),
  gate("d8", "d8"),
]));
// A release node placed before QA: no role label may make it composable.
const IMPL_BYPASS = component("impl-bypass", ["write", "gate", "release"], seq("main", [
  gate("d5", "d5"),
  task("build"),
  task("ship", { effect: "release", role: "release-manager", capabilities: ["ship"] }),
  gate("qa", "qa"),
  gate("d8", "d8"),
]));

const PROJECT_A_DOCS = [RESEARCH_SHORT, IMPL_A];
const PROJECT_B_DOCS = [RESEARCH, EXTERNAL_VALIDATION, ARCHITECT, RESEARCH_LOOP, IMPL_B];

function registry(docs: unknown[]): WorkflowComponentRegistry {
  const r = createComponentRegistry(docs);
  if (!r.ok) throw new Error(JSON.stringify(r.violations));
  return r.registry;
}

type Member = [id: string, role: string, caps: string[] | null, kind?: string];

function proposal(phase: string, members: Member[], runId = "run-w03") {
  const participants = members.map(([id, role, caps, kind]) => ({
    participant_id: id,
    participation_kind: kind ?? "worker",
    role_ref: role,
    necessity_rationale: `serves the ${role} role`,
    owned_obligations: [`ob-${id}`],
    depends_on: [],
    tier: "mid",
    purpose: "general",
    capability_scope: caps,
    backend: "team",
  }));
  return composeProposal({
    run_id: runId,
    phase,
    participants,
    obligations: participants.map((p) => ({
      obligation_id: p.owned_obligations[0],
      source: "plan_item",
      text: `work owned by ${p.participant_id}`,
      disposition: { owners: [p.participant_id] },
    })),
  } as never);
}

const BARE_SHA = new RegExp("^[0-9a-f]{64}$");
const PREFIXED_SHA = new RegExp("^sha256" + "[:][0-9a-f]{64}$");

const PLAN = { path: ".guild/plan/w03.md", sha256: "a".repeat(64) };

const TEAM_A_RESEARCH: Member[] = [["ana", "researcher", ["research"]]];
const TEAM_B_RESEARCH: Member[] = [
  ["bo", "researcher", ["research"]],
  ["val", "validator", ["validate"], "reviewer_cross_host"],
  ["arc", "architect", ["design"]],
];
const TEAM_A_IMPL: Member[] = [
  ["dev", "developer", ["code"]],
  ["qar", "qa-reviewer", ["assurance:quality"], "reviewer_local"],
  ["lead", "owner", []],
];
const TEAM_B_IMPL: Member[] = [
  ["dev", "developer", ["code"]],
  ["sec", "security-reviewer", ["assurance:security"], "reviewer_cross_host"],
  ["uxr", "ux-reviewer", ["assurance:ux"], "reviewer_local"],
  ["lead", "owner", []],
];

function qa(required: string[]) {
  return { schema_version: QA_POLICY_SCHEMA_VERSION, required };
}

function input(over: Partial<PhaseCompositionInput> & Pick<PhaseCompositionInput, "class" | "root" | "proposal">): PhaseCompositionInput {
  return {
    phase: (over.proposal as { phase: string }).phase,
    workflow: { source_id: "project", id: `${over.root.id}-wf` },
    plan: PLAN,
    qa_policy: qa([]),
    ...over,
  };
}

const A_RESEARCH = () => input({ class: "research", root: { id: "research-short", version: "1" }, proposal: proposal("ideate", TEAM_A_RESEARCH) });
const B_RESEARCH = () => input({ class: "research", root: { id: "research-loop", version: "1" }, proposal: proposal("ideate", TEAM_B_RESEARCH) });
const A_IMPL = () => input({ class: "product", root: { id: "impl-a", version: "1" }, proposal: proposal("build", TEAM_A_IMPL), qa_policy: qa(["quality"]) });
const B_IMPL = () => input({ class: "product", root: { id: "impl-b", version: "1" }, proposal: proposal("build", TEAM_B_IMPL), qa_policy: qa(["security", "ux"]) });

function ok(r: PhaseCompositionResult) {
  if (!r.ok) throw new Error(JSON.stringify(r.violations));
  return r;
}
function rules(r: PhaseCompositionResult): string[] {
  return r.ok ? [] : r.violations.map((v) => v.rule);
}
function sha256(v: unknown): string {
  const canon = (x: unknown): string =>
    Array.isArray(x) ? `[${x.map(canon).join(",")}]`
    : x && typeof x === "object" ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon((x as Record<string, unknown>)[k])}`).join(",")}}`
    : JSON.stringify(x);
  return `sha256:${crypto.createHash("sha256").update(canon(v)).digest("hex")}`;
}
function approve(p: object) {
  return recordDecision(p, {
    decision: "approve",
    decided_by: { kind: "operator", id: "miguel" },
    decision_channel: "terminal_prompt",
    decided_at: "2026-11-05T00:00:00Z",
  } as never);
}

// ---------------------------------------------------------------- AT21

describe("AT21 · phase composition — two projects, distinct chains and QA policies", () => {
  it("project A and project B resolve different research and implementation chains", () => {
    const aR = ok(composePhase(registry(PROJECT_A_DOCS), A_RESEARCH())).composition;
    const bR = ok(composePhase(registry(PROJECT_B_DOCS), B_RESEARCH())).composition;
    const aI = ok(composePhase(registry(PROJECT_A_DOCS), A_IMPL())).composition;
    const bI = ok(composePhase(registry(PROJECT_B_DOCS), B_IMPL())).composition;

    for (const c of [aR, bR, aI, bI]) expect(c.schema_version).toBe(PHASE_COMPOSITION_SCHEMA_VERSION);
    expect(aR.workflow.components.map((c) => `${c.id}@${c.version}`)).toEqual(["research-short@1"]);
    expect(bR.workflow.components.map((c) => `${c.id}@${c.version}`).sort()).toEqual(
      ["architect@1", "external-validation@1", "research-loop@1", "research@1"],
    );
    expect(aR.workflow.definition_hash).not.toBe(bR.workflow.definition_hash);
    expect(aI.workflow.definition_hash).not.toBe(bI.workflow.definition_hash);
    expect(bR.workflow.loops).toEqual([{ id: "loop", max_rounds: 3 }]);
    expect(aR.workflow.loops).toEqual([]);

    // Distinct QA policies resolve to distinct, node-bound QA obligations.
    expect(aI.qa_obligations).toEqual([{ kind: "quality", node_ids: ["quality"] }]);
    expect(bI.qa_obligations).toEqual([
      { kind: "security", node_ids: ["security"] },
      { kind: "ux", node_ids: ["ux"] },
    ]);
    expect(aI.qa_policy_hash).not.toBe(bI.qa_policy_hash);
  });

  it("the proposal explains role/capability obligations with exact versions and hashes", () => {
    const r = ok(composePhase(registry(PROJECT_B_DOCS), B_RESEARCH()));
    const c = r.composition;
    expect(c.workflow.definition_hash).toBe(r.projection.definition_hash);
    expect(c.workflow.policy_hash).toBe(r.projection.policy_hash);
    expect(c.workflow.expanded_hash).toBe(r.projection.expanded_hash);
    expect(c.workflow.compiler_hash).toBe(r.projection.compiler_hash);
    for (const pin of c.workflow.components) expect(pin.sha256).toMatch(PREFIXED_SHA);
    expect(c.plan).toEqual(PLAN);
    expect(c.team.proposal_hash).toMatch(BARE_SHA);
    expect(c.composition_hash).toMatch(PREFIXED_SHA);

    const validator = c.role_obligations.find((o) => o.role === "validator")!;
    expect(validator.participants).toEqual(["val"]);
    expect(validator.granted).toEqual(["validate"]);
    expect(validator.nodes).toEqual([
      expect.objectContaining({ node_id: "v.validate", component: "external-validation@1", effect: "review", capabilities: ["validate"] }),
    ]);
    expect(c.role_obligations.map((o) => o.role)).toEqual(["architect", "researcher", "validator"]);
    for (const o of c.role_obligations) for (const n of o.nodes) expect(n.component_hash).toMatch(PREFIXED_SHA);
  });

  it("review independence is reported for every review and gate node", () => {
    const c = ok(composePhase(registry(PROJECT_B_DOCS), B_IMPL())).composition;
    const ids = c.review_independence.map((r) => r.node_id);
    expect(ids).toEqual(expect.arrayContaining(["security", "ux", "d5", "qa", "d8"]));
    for (const r of c.review_independence) {
      expect(r.independent).toBe(true);
      expect(r.reviewers.length).toBeGreaterThan(0);
      for (const id of r.reviewers) expect(r.authors).not.toContain(id);
    }
  });

  it("negative: a review node served only by the authoring role is refused", () => {
    const selfReview = component("impl-self", ["write", "review", "gate"], seq("main", [
      gate("d5", "d5"),
      task("build"),
      task("check", { effect: "review", role: "developer", capabilities: ["code"], within_gate: "qa", required: true }),
      gate("qa", "qa"),
      gate("d8", "d8"),
    ]));
    const r = composePhase(registry([selfReview]), input({ class: "product", root: { id: "impl-self", version: "1" }, proposal: proposal("build", TEAM_A_IMPL) }));
    expect(rules(r)).toContain("review-not-independent");
  });

  it("is deterministic: participant order and registry order do not change the bytes", () => {
    const base = ok(composePhase(registry(PROJECT_B_DOCS), B_IMPL())).composition;
    for (let i = 0; i < 3; i++) {
      const docs = [...PROJECT_B_DOCS].reverse();
      const team = i % 2 ? [...TEAM_B_IMPL].reverse() : TEAM_B_IMPL;
      const again = ok(composePhase(registry(docs), { ...B_IMPL(), proposal: proposal("build", team) })).composition;
      expect(again.workflow).toEqual(base.workflow);
      expect(again.role_obligations).toEqual(base.role_obligations);
      expect(again.review_independence).toEqual(base.review_independence);
    }
    const twice = ok(composePhase(registry(PROJECT_B_DOCS), B_IMPL())).composition;
    expect(JSON.stringify(twice)).toBe(JSON.stringify(base));
  });
});

describe("AT21 · approval — every participant stays behind the existing team approval", () => {
  it("dispatch is refused without a recorded approve decision", () => {
    const i = A_IMPL();
    const reg = registry(PROJECT_A_DOCS);
    const c = ok(composePhase(reg, i)).composition;
    expect(c.approval.required).toBe(true);
    expect(c.approval.participants).toEqual(["dev", "lead", "qar"]);
    const v = phaseDispatchGate(reg, i, c, null);
    expect(v.allowed).toBe(false);
  });

  it("an approve decision over the exact proposal authorises dispatch", () => {
    const i = A_IMPL();
    const reg = registry(PROJECT_A_DOCS);
    const c = ok(composePhase(reg, i)).composition;
    expect(phaseDispatchGate(reg, i, c, approve(i.proposal)).allowed).toBe(true);
  });

  it("negative: a role label cannot authorise release or bypass approval", () => {
    // Reserved authority capabilities on a team role are refused outright.
    for (const cap of ["release", "approve", "d8", "qa", "privileged"]) {
      const team: Member[] = [...TEAM_A_IMPL, ["rm", "release-manager", [cap]]];
      const r = composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), proposal: proposal("build", team) });
      expect(rules(r)).toContain("role-claims-authority");
    }
    // A release-manager role with a plain capability still cannot place release before QA.
    const team: Member[] = [...TEAM_A_IMPL, ["rm", "release-manager", ["ship"]]];
    const bypass = composePhase(registry([IMPL_BYPASS]), input({ class: "product", root: { id: "impl-bypass", version: "1" }, proposal: proposal("build", team) }));
    expect(rules(bypass).some((r) => r === "release-bypasses-gate" || r === "gate-order")).toBe(true);
    // An "approver" participant is not an approval.
    const approverTeam: Member[] = [...TEAM_A_IMPL, ["appr", "approver", ["review"]]];
    const i = { ...A_IMPL(), proposal: proposal("build", approverTeam) };
    const c = ok(composePhase(registry(PROJECT_A_DOCS), i)).composition;
    expect(phaseDispatchGate(registry(PROJECT_A_DOCS), i, c, null).allowed).toBe(false);
    expect(c.unbound_participants).toEqual(["appr"]);
  });

  it("role approval cannot authorise new operations or create extra QA gates", () => {
    const base = ok(composePhase(registry(PROJECT_A_DOCS), A_IMPL()));
    const wider: Member[] = [...TEAM_A_IMPL, ["ops", "operator", ["deploy", "assurance:security"]], ["q2", "qa-lead", ["assurance:ux"]]];
    const more = ok(composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), proposal: proposal("build", wider) }));
    expect(more.projection.nodes).toEqual(base.projection.nodes);
    expect(more.projection.expanded_hash).toBe(base.projection.expanded_hash);
    expect(more.composition.workflow.protected_gates).toEqual(base.composition.workflow.protected_gates);
    expect(more.composition.qa_obligations).toEqual(base.composition.qa_obligations);
    expect(more.composition.unbound_participants).toEqual(["ops", "q2"]);
    // The QA policy may only name assurance kinds; it cannot declare gates or nodes.
    for (const bad of [
      { schema_version: QA_POLICY_SCHEMA_VERSION, required: ["quality"], gates: ["qa2"] },
      { schema_version: QA_POLICY_SCHEMA_VERSION, required: ["extra_gate"] },
      { schema_version: QA_POLICY_SCHEMA_VERSION, required: ["quality", "quality"] },
      { schema_version: "guild.qa_policy.v0", required: [] },
    ]) {
      expect(rules(composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), qa_policy: bad as never }))).toContain("invalid-qa-policy");
    }
    // A stricter policy is served by existing QA nodes or refused; it never adds a gate.
    expect(rules(composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), qa_policy: qa(["security"]) }))).toContain("qa-obligation-unserved");
  });

  it("negative: a decision approving another proposal or phase does not carry over", () => {
    const i = A_IMPL();
    const reg = registry(PROJECT_A_DOCS);
    const c = ok(composePhase(reg, i)).composition;
    const other = proposal("build", [...TEAM_A_IMPL, ["x", "advisor", null, "advisor"]]);
    expect(phaseDispatchGate(reg, { ...i, proposal: other }, c, approve(other)).allowed).toBe(false);
    expect(phaseDispatchGate(reg, i, c, approve(other)).allowed).toBe(false);
    const otherPhase = proposal("qa", TEAM_A_IMPL);
    expect(phaseDispatchGate(reg, i, c, approve(otherPhase)).allowed).toBe(false);
    const otherRun = proposal("build", TEAM_A_IMPL, "run-other");
    expect(phaseDispatchGate(reg, i, c, approve(otherRun)).allowed).toBe(false);
  });

  it("negative: a tampered composition is refused", () => {
    const i = A_IMPL();
    const reg = registry(PROJECT_A_DOCS);
    const c = ok(composePhase(reg, i)).composition;
    const d = approve(i.proposal);
    const forged = JSON.parse(JSON.stringify(c));
    forged.approval.required = false;
    expect(phaseDispatchGate(reg, i, forged, d).allowed).toBe(false);
    // Re-hashing a forgery does not help: the gate recomposes from sources.
    const dropped = JSON.parse(JSON.stringify(c));
    dropped.workflow.protected_gates = ["d5", "d8"];
    const { composition_hash: _h, ...body } = dropped;
    void _h;
    dropped.composition_hash = sha256(body);
    expect(phaseDispatchGate(reg, i, dropped, d).allowed).toBe(false);
    const extra = { ...JSON.parse(JSON.stringify(c)), dispatch_override: true };
    expect(phaseDispatchGate(reg, i, extra, d).allowed).toBe(false);
    expect(phaseDispatchGate(reg, i, c, d).allowed).toBe(true);
  });
});

describe("AT21 · scope expansion recomposes", () => {
  it("a changed plan, team or component set requires recomposition", () => {
    const i = A_IMPL();
    const reg = registry(PROJECT_A_DOCS);
    const c = ok(composePhase(reg, i)).composition;
    expect(verifyPhaseComposition(reg, i, c)).toEqual({ current: true, changed: [] });

    const plan = verifyPhaseComposition(reg, { ...i, plan: { ...PLAN, sha256: "b".repeat(64) } }, c);
    expect(plan).toEqual({ current: false, changed: ["plan"] });

    const widened = { ...i, proposal: proposal("build", [...TEAM_A_IMPL, ["sec", "security-reviewer", ["assurance:security"]]]) };
    const team = verifyPhaseComposition(reg, widened, c);
    expect(team.current).toBe(false);
    expect(team.changed).toContain("team");
    expect(phaseDispatchGate(reg, widened, c, approve(widened.proposal)).allowed).toBe(false);

    const bumped = component("impl-a", IMPL_A.effects, IMPL_A.body, "2");
    const reg2 = registry([RESEARCH_SHORT, IMPL_A, bumped]);
    const wf = verifyPhaseComposition(reg2, { ...i, root: { id: "impl-a", version: "2" } }, c);
    expect(wf.current).toBe(false);
    expect(wf.changed).toContain("workflow");

    const policy = verifyPhaseComposition(reg, { ...i, qa_policy: qa([]) }, c);
    expect(policy).toEqual({ current: false, changed: ["qa_policy"] });
  });

  it("an expansion that the team cannot serve is refused, not silently narrowed", () => {
    const r = composePhase(registry(PROJECT_B_DOCS), { ...B_IMPL(), proposal: proposal("build", TEAM_A_IMPL) });
    expect(rules(r)).toContain("incompatible-role");
  });
});

describe("AT21 · untrusted overlay and team input", () => {
  it("negative: a team proposed for another phase is refused", () => {
    const r = composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), phase: "ideate" });
    expect(rules(r)).toContain("team-phase-mismatch");
  });

  it("negative: a malformed or hostile team proposal is refused", () => {
    const base = A_IMPL().proposal as Record<string, unknown>;
    const unknownKey = { ...JSON.parse(JSON.stringify(base)), max_team_size: 3 };
    expect(rules(composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), proposal: unknownKey }))).toContain("invalid-team");
    const accessor = JSON.parse(JSON.stringify(base));
    let reads = 0;
    Object.defineProperty(accessor.participants[0], "role_ref", { enumerable: true, get: () => (reads++ ? "owner" : "developer") });
    expect(rules(composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), proposal: accessor }))).toContain("invalid-team");
    const steady = JSON.parse(JSON.stringify(base));
    Object.defineProperty(steady.participants[0], "role_ref", { enumerable: true, get: () => "developer" });
    expect(rules(composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), proposal: steady }))).toContain("invalid-team");
    const edited = JSON.parse(JSON.stringify(base));
    edited.participants[0].capability_scope = ["code", "extra"];
    expect(rules(composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), proposal: edited }))).toContain("invalid-team");
    const proto = JSON.parse(JSON.stringify(base));
    proto.participants[0].role_ref = "__proto__";
    expect(composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), proposal: proto }).ok).toBe(false);
    expect(rules(composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), proposal: null as never }))).toContain("invalid-team");
  });

  it("negative: a malformed plan reference is refused", () => {
    for (const plan of [{ path: "x", sha256: "nothex" }, { path: "", sha256: "a".repeat(64) }, { path: "x", sha256: "a".repeat(64), extra: 1 }]) {
      expect(rules(composePhase(registry(PROJECT_A_DOCS), { ...A_IMPL(), plan: plan as never }))).toContain("invalid-request");
    }
  });

  it("loads team YAML, plan and QA policy from inside the project root only", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "w03-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "w03-out-"));
    try {
      const i = A_IMPL();
      fs.mkdirSync(path.join(root, ".guild", "team"), { recursive: true });
      fs.mkdirSync(path.join(root, ".guild", "plan"), { recursive: true });
      fs.writeFileSync(path.join(root, ".guild", "team", "w03.build.yaml"), JSON.stringify(i.proposal));
      fs.writeFileSync(path.join(root, ".guild", "plan", "w03.md"), "# plan\n");
      fs.writeFileSync(path.join(root, ".guild", "qa-policy.yaml"), `schema_version: ${QA_POLICY_SCHEMA_VERSION}\nrequired: [quality]\n`);
      const loaded = loadPhaseCompositionInputs({
        root,
        proposal: ".guild/team/w03.build.yaml",
        plan: ".guild/plan/w03.md",
        qa_policy: ".guild/qa-policy.yaml",
      });
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.violations));
      expect(loaded.plan.path).toBe(".guild/plan/w03.md");
      expect(loaded.plan.sha256).toMatch(BARE_SHA);
      const c = ok(composePhase(registry(PROJECT_A_DOCS), { ...i, proposal: loaded.proposal, plan: loaded.plan, qa_policy: loaded.qa_policy }));
      expect(c.composition.qa_obligations).toEqual([{ kind: "quality", node_ids: ["quality"] }]);

      fs.writeFileSync(path.join(outside, "team.yaml"), JSON.stringify(i.proposal));
      fs.symlinkSync(path.join(outside, "team.yaml"), path.join(root, ".guild", "team", "link.yaml"));
      for (const p of ["../" + path.basename(outside) + "/team.yaml", path.join(outside, "team.yaml"), ".guild/team/link.yaml"]) {
        const r = loadPhaseCompositionInputs({ root, proposal: p, plan: ".guild/plan/w03.md", qa_policy: ".guild/qa-policy.yaml" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.violations.map((v) => v.rule)).toContain("path-not-contained");
      }
      fs.writeFileSync(path.join(root, ".guild", "team", "bad.yaml"), "a: !!js/function 'function(){}'\n");
      const bad = loadPhaseCompositionInputs({ root, proposal: ".guild/team/bad.yaml", plan: ".guild/plan/w03.md", qa_policy: ".guild/qa-policy.yaml" });
      expect(bad.ok).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

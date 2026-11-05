/**
 * W02 / AT07 — assurance state machine. Review source A, repair to B, restart,
 * attempt acceptance: evidence for B is required; source, obligation, round,
 * authority and subject hash are checked at acceptance; an unknown mutation
 * invalidates every required obligation. Negative control: a valid A receipt
 * re-used (or relabelled) for B is refused.
 */

import { describe, it, expect } from "bun:test";

import * as review from ".";
import {
  applyMutation,
  beginInvocation,
  checkAcceptance,
  createAssuranceLedger,
  recordVerdict,
  restoreLedger,
  serializeLedger,
  subjectHash,
  toProjectionAssurance,
  type AssuranceLedger,
  type AssuranceResult,
  type EvidenceRef,
  type ObligationSpec,
  type SubjectManifest,
  type VerdictReceipt,
} from "./assurance-ledger";

const H = (c: string) => `sha256:${c.repeat(64)}`;

const PROJECTION = {
  workflow: { source_id: "source-a", kind: "workflow", id: "wf", revision: H("1") },
  definition_hash: H("1"),
  compiler_hash: H("2"),
  policy_hash: H("3"),
  expanded_hash: H("4"),
  nodes: [
    { id: "build", gate_role: null, within_gate: null },
    { id: "sec", gate_role: null, within_gate: "qa" },
    { id: "ux", gate_role: null, within_gate: "qa" },
    { id: "qa", gate_role: "qa", within_gate: null },
    { id: "lint", gate_role: null, within_gate: null },
  ],
};

const A: SubjectManifest = {
  source_id: "source-a",
  source_revision: H("a"),
  artifacts: [
    { name: "src", sha256: H("5") },
    { name: "ui", sha256: H("6") },
    { name: "docs", sha256: H("7") },
  ],
};
/** Repair: `src` changes. */
const B: SubjectManifest = { ...A, source_revision: H("b"), artifacts: [{ name: "src", sha256: H("8") }, A.artifacts[1], A.artifacts[2]] };

const OBLIGATIONS: ObligationSpec[] = [
  { id: "ob-sec", kind: "security", node_id: "sec", required: true, authority: "security-reviewer", scope: ["src"], max_rounds: 3 },
  { id: "ob-ux", kind: "ux", node_id: "ux", required: true, authority: "ux-reviewer", scope: ["ui"], max_rounds: 3 },
  { id: "ob-lint", kind: "quality", node_id: "lint", required: false, authority: "linter", scope: ["docs"], max_rounds: 3 },
];

const DEF = { projection: PROJECTION, obligations: OBLIGATIONS };

function ok<T>(r: AssuranceResult<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.violations));
  return r.value;
}
const rules = (r: AssuranceResult<unknown>) => (r.ok ? [] : r.violations.map((v) => v.rule));

function evidence(tag: string, source = "source-a"): EvidenceRef[] {
  return [{ source_id: source, path: `reviews/${tag}.json`, sha256: H(tag), schema_version: "guild.review.v1", observed_at: "2026-11-05T00:00:00Z", availability: "available", reason: null }];
}

function receipt(l: AssuranceLedger, obligation_id: string, invocation_id: string, tag: string, extra: Partial<VerdictReceipt> = {}): VerdictReceipt {
  const ob = l.obligations.find((o) => o.id === obligation_id)!;
  const inv = l.invocations.find((i) => i.id === invocation_id)!;
  return { source_id: "source-a", obligation_id, invocation_id, round: inv.round, authority: ob.authority, subject_hash: l.subject_hash, verdict: "accept", evidence: evidence(tag), ...extra };
}

/** Review A: every obligation accepted against subject A. */
function reviewedA(): AssuranceLedger {
  let l = ok(createAssuranceLedger({ projection: PROJECTION, subject: A, obligations: OBLIGATIONS }));
  for (const [ob, inv, tag] of [["ob-sec", "inv-sec-1", "c"], ["ob-ux", "inv-ux-1", "d"], ["ob-lint", "inv-lint-1", "e"]] as const) {
    l = ok(beginInvocation(l, { obligation_id: ob, invocation_id: inv }));
    l = ok(recordVerdict(l, receipt(l, ob, inv, tag)));
  }
  return l;
}

describe("AT07 assurance state machine — review A, repair B, restart, accept", () => {
  it("A is fully accepted against A", () => {
    const l = reviewedA();
    expect(checkAcceptance(l, A, DEF)).toEqual({ ok: true, accepted: ["ob-lint", "ob-sec", "ob-ux"] });
  });

  it("repair to B invalidates the affected obligation; after restart evidence for B is required", () => {
    const repaired = ok(applyMutation(reviewedA(), { subject: B, changed: ["src"] }));
    const sec = repaired.obligations.find((o) => o.id === "ob-sec")!;
    expect(sec.status).toBe("invalidated");
    expect(sec.invalidated_by).toBe("mutation");
    // Unaffected scope keeps its acceptance (reuse when the declared input subset still matches exactly).
    expect(repaired.obligations.find((o) => o.id === "ob-ux")!.status).toBe("accepted");

    const restarted = ok(restoreLedger(serializeLedger(repaired), B, DEF));
    const blocked = checkAcceptance(restarted, B, DEF);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.blockers).toEqual([{ obligation_id: "ob-sec", reason: "not-accepted:invalidated" }]);

    let l = ok(beginInvocation(restarted, { obligation_id: "ob-sec", invocation_id: "inv-sec-2" }));
    expect(l.invocations.find((i) => i.id === "inv-sec-2")!.round).toBe(2);
    l = ok(recordVerdict(l, receipt(l, "ob-sec", "inv-sec-2", "f")));
    expect(checkAcceptance(l, B, DEF)).toEqual({ ok: true, accepted: ["ob-lint", "ob-sec", "ob-ux"] });
    // And B's acceptance does not carry back to A.
    expect(checkAcceptance(l, A, DEF).ok).toBe(false);
  });

  it("negative control: the valid A receipt re-used for B is refused, as-is or relabelled", () => {
    let l = ok(createAssuranceLedger({ projection: PROJECTION, subject: A, obligations: OBLIGATIONS }));
    l = ok(beginInvocation(l, { obligation_id: "ob-sec", invocation_id: "inv-sec-1" }));
    const receiptA = receipt(l, "ob-sec", "inv-sec-1", "c");
    l = ok(recordVerdict(l, receiptA));
    l = ok(applyMutation(l, { subject: B, changed: ["src"] }));

    expect(rules(recordVerdict(l, receiptA))).toContain("stale-invocation");
    expect(rules(recordVerdict(l, { ...receiptA, subject_hash: l.subject_hash }))).toContain("stale-invocation");
    l = ok(beginInvocation(l, { obligation_id: "ob-sec", invocation_id: "inv-sec-2" }));
    // A's verdict relabelled onto the new invocation: same evidence bytes, new subject.
    const relabelled = { ...receiptA, invocation_id: "inv-sec-2", round: 2, subject_hash: l.subject_hash };
    expect(rules(recordVerdict(l, relabelled))).toContain("evidence-reused");
    // A's subject hash on the new invocation.
    expect(rules(recordVerdict(l, { ...relabelled, evidence: evidence("f"), subject_hash: subjectHash(l.workflow, A) }))).toContain("subject-mismatch");
    expect(checkAcceptance(l, B, DEF).ok).toBe(false);
  });

  it("source, obligation, round and authority are each checked when a verdict is recorded", () => {
    let l = ok(createAssuranceLedger({ projection: PROJECTION, subject: A, obligations: OBLIGATIONS }));
    l = ok(beginInvocation(l, { obligation_id: "ob-sec", invocation_id: "inv-sec-1" }));
    const good = receipt(l, "ob-sec", "inv-sec-1", "c");
    expect(rules(recordVerdict(l, { ...good, source_id: "source-b" }))).toContain("foreign-source");
    expect(rules(recordVerdict(l, { ...good, evidence: evidence("c", "source-b") }))).toContain("missing-evidence");
    expect(rules(recordVerdict(l, { ...good, obligation_id: "ob-ux" }))).toContain("invocation-mismatch");
    expect(rules(recordVerdict(l, { ...good, obligation_id: "ob-nope" }))).toContain("unknown-obligation");
    expect(rules(recordVerdict(l, { ...good, round: 2 }))).toContain("round-mismatch");
    expect(rules(recordVerdict(l, { ...good, authority: "security-reviewer-2" }))).toContain("authority-mismatch");
    expect(rules(recordVerdict(l, { ...good, evidence: [] }))).toContain("missing-evidence");
    expect(rules(recordVerdict(l, { ...good, evidence: [{ ...evidence("c")[0], availability: "missing" }] }))).toContain("missing-evidence");
    expect(rules(recordVerdict(l, { ...good, invocation_id: "inv-ghost" }))).toContain("unknown-invocation");
    const done = ok(recordVerdict(l, good));
    expect(rules(recordVerdict(done, good))).toContain("stale-invocation");
  });

  it("an unknown mutation invalidates every required obligation, including unaffected scopes", () => {
    const l = ok(applyMutation(reviewedA(), { subject: B, changed: "unknown" }));
    for (const id of ["ob-sec", "ob-ux"]) {
      const o = l.obligations.find((x) => x.id === id)!;
      expect(o.status).toBe("invalidated");
      expect(o.invalidated_by).toBe("unknown-mutation");
    }
    const r = checkAcceptance(l, B, DEF);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.map((b) => b.obligation_id)).toEqual(["ob-sec", "ob-ux"]);
  });

  it("an under-declared mutation (changed set omits a real change) is treated as unknown", () => {
    const uiChanged: SubjectManifest = { ...B, artifacts: [B.artifacts[0], { name: "ui", sha256: H("9") }, A.artifacts[2]] };
    const l = ok(applyMutation(reviewedA(), { subject: uiChanged, changed: ["src"] }));
    expect(l.obligations.find((o) => o.id === "ob-ux")!.invalidated_by).toBe("unknown-mutation");
    expect(l.obligations.find((o) => o.id === "ob-sec")!.invalidated_by).toBe("unknown-mutation");
  });

  it("restart with a subject that moved after the last ledger write invalidates everything (unknown basis)", () => {
    const restarted = ok(restoreLedger(serializeLedger(reviewedA()), B, DEF));
    for (const o of restarted.obligations.filter((x) => x.required)) expect(o.invalidated_by).toBe("restart-subject-mismatch");
    expect(checkAcceptance(restarted, B, DEF).ok).toBe(false);
  });

  it("acceptance re-checks the subject at the boundary: an unrecorded change blocks every required obligation", () => {
    const r = checkAcceptance(reviewedA(), B, DEF);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers).toEqual([{ obligation_id: "ob-sec", reason: "subject-changed" }, { obligation_id: "ob-ux", reason: "subject-changed" }]);
  });

  it("restore fails closed on corrupt, foreign or hostile bytes", () => {
    const text = serializeLedger(reviewedA());
    expect(rules(restoreLedger(text.replace('"accepted"', '"pending"'), A, DEF))).toContain("ledger-corrupt");
    expect(rules(restoreLedger("{", A, DEF))).toContain("ledger-corrupt");
    expect(rules(restoreLedger(JSON.stringify({ ...JSON.parse(text), extra: 1 }), A, DEF))).toContain("ledger-corrupt");
    expect(rules(restoreLedger(text, { ...A, source_id: "source-b" }, DEF))).toContain("foreign-source");
    expect(rules(restoreLedger("x".repeat(5_000_000), A, DEF))).toContain("ledger-corrupt");
  });

  it("restore re-proves internal consistency, not only the hash", () => {
    const parsed = JSON.parse(serializeLedger(reviewedA()));
    parsed.obligations[0].accepted.round = 7;
    const { ledger_hash: _drop, ...body } = parsed;
    const forged = JSON.stringify({ ...body, ledger_hash: review.assuranceLedgerHash(body) });
    expect(rules(restoreLedger(forged, A, DEF))).toContain("ledger-corrupt");
  });

  it("rounds are bounded: exhaustion blocks instead of accepting", () => {
    let l = ok(createAssuranceLedger({ projection: PROJECTION, subject: A, obligations: [{ ...OBLIGATIONS[0], max_rounds: 1 }] }));
    l = ok(beginInvocation(l, { obligation_id: "ob-sec", invocation_id: "i1" }));
    expect(rules(beginInvocation(l, { obligation_id: "ob-sec", invocation_id: "i2" }))).toContain("round-cap");
    expect(rules(beginInvocation(l, { obligation_id: "ob-sec", invocation_id: "i1" }))).toContain("duplicate-invocation");
  });

  it("creation enforces QA scope for security/UI kinds, the workflow source and known scopes", () => {
    const outside = { ...OBLIGATIONS[0], node_id: "build" };
    expect(rules(createAssuranceLedger({ projection: PROJECTION, subject: A, obligations: [outside] }))).toContain("assurance-outside-gate");
    expect(rules(createAssuranceLedger({ projection: PROJECTION, subject: { ...A, source_id: "source-b" }, obligations: OBLIGATIONS }))).toContain("foreign-source");
    expect(rules(createAssuranceLedger({ projection: PROJECTION, subject: A, obligations: [{ ...OBLIGATIONS[0], scope: ["nope"] }] }))).toContain("invalid-ledger");
    expect(rules(createAssuranceLedger({ projection: PROJECTION, subject: A, obligations: [OBLIGATIONS[0], OBLIGATIONS[0]] }))).toContain("invalid-ledger");
  });

  it("the ledger is deterministic and frozen", () => {
    expect(serializeLedger(reviewedA())).toBe(serializeLedger(reviewedA()));
    expect(Object.isFrozen(reviewedA().obligations[0])).toBe(true);
  });

  it("projects onto C8 v2 obligations/invocations that satisfy the frozen semantic rules", () => {
    const l = ok(applyMutation(reviewedA(), { subject: B, changed: ["src"] }));
    const c8 = ok(toProjectionAssurance(l));
    const invs = new Map(c8.invocations.map((i) => [i.id, i]));
    for (const o of c8.obligations) {
      const inv = invs.get(o.invocation_id)!;
      expect(inv.node_id).toBe(o.node_id);
      expect(o.subject_hash).toBe(inv.subject_hash);
      expect(o.round).toBeLessThanOrEqual(inv.round);
      expect(inv.definition_hash).toBe(PROJECTION.definition_hash);
      if (o.status === "accepted") {
        expect(inv.state).toBe("accepted");
        expect(o.evidence.every((e) => e.availability === "available" && e.source_id === "source-a")).toBe(true);
      }
    }
    expect(c8.obligations.find((o) => o.id === "ob-sec")!.status).toBe("invalidated");
  });

  it("the review domain exposes the ledger through its index", () => {
    expect(typeof review.createAssuranceLedger).toBe("function");
    expect(typeof review.checkAcceptance).toBe("function");
  });
});

describe("AT07 codex r1 regressions", () => {
  it("F2: restore and acceptance judge requiredness/authority/policy by the trusted definition", () => {
    const parsed = JSON.parse(serializeLedger(ok(createAssuranceLedger({ projection: PROJECTION, subject: A, obligations: OBLIGATIONS }))));
    for (const o of parsed.obligations) o.required = false;
    const { ledger_hash: _h, ...body } = parsed;
    const forged = JSON.stringify({ ...body, ledger_hash: review.assuranceLedgerHash(body) });
    expect(rules(restoreLedger(forged, A, DEF))).toContain("definition-changed");
    const l = reviewedA();
    const newAuthority = { projection: PROJECTION, obligations: OBLIGATIONS.map((o) => (o.id === "ob-sec" ? { ...o, authority: "other" } : o)) };
    const r = checkAcceptance(l, A, newAuthority);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.every((b) => b.reason === "definition-changed")).toBe(true);
    const newPolicy = { projection: { ...PROJECTION, policy_hash: H("f") }, obligations: OBLIGATIONS };
    expect(checkAcceptance(l, A, newPolicy).ok).toBe(false);
    expect(rules(restoreLedger(serializeLedger(l), A, newPolicy))).toContain("definition-changed");
  });

  it("F3: after an unknown invalidation and restart, the old receipt cannot be re-spent on a new round", () => {
    let l = ok(applyMutation(reviewedA(), { subject: B, changed: "unknown" }));
    l = ok(restoreLedger(serializeLedger(l), B, DEF));
    l = ok(beginInvocation(l, { obligation_id: "ob-ux", invocation_id: "inv-ux-2" }));
    const old = { ...receipt(l, "ob-ux", "inv-ux-2", "d") };
    expect(rules(recordVerdict(l, old))).toContain("evidence-reused");
  });

  it("F4: an unknown mutation invalidates even when the manifest is unchanged", () => {
    const l = ok(applyMutation(reviewedA(), { subject: A, changed: "unknown" }));
    expect(l.obligations.filter((o) => o.required).every((o) => o.status === "invalidated")).toBe(true);
    expect(checkAcceptance(l, A, DEF).ok).toBe(false);
  });

  it("F5: hostile coercion objects in restored bytes fail closed without throwing", () => {
    const parsed = JSON.parse(serializeLedger(reviewedA()));
    parsed.obligations[0].status = { toString: 0 };
    expect(rules(restoreLedger(JSON.stringify(parsed), A, DEF))).toContain("ledger-corrupt");
  });

  it("F6: a deleted scoped artifact blocks new rounds instead of minting an unrestorable acceptance", () => {
    const gone: SubjectManifest = { ...B, artifacts: [A.artifacts[1], A.artifacts[2]] };
    const l = ok(applyMutation(reviewedA(), { subject: gone, changed: ["src"] }));
    expect(rules(beginInvocation(l, { obligation_id: "ob-sec", invocation_id: "inv-sec-2" }))).toContain("scope-missing");
    expect(restoreLedger(serializeLedger(l), gone, DEF).ok).toBe(true);
  });
});

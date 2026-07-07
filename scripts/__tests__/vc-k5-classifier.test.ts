/**
 * scripts/__tests__/vc-k5-classifier.test.ts
 *
 * VC-K5 dual-output — converts the deferred-runtime-test register entry
 * (P7C-consolidated-validation.md §D, owner P7C-gate-001) from design-only to
 * executable + tested. Exercises the ONE specific-vs-systemic classifier
 * (IFACE-CLASSIFIER-1 — P3-learning-loop.md §"P3 · Interfaces").
 *
 * Canonical behavioral test (continuous-knowledge-and-learning-loop.md
 * §194-196): a red-team run where a skill AND its template are BOTH deficient
 * produces (a) a per-instance one-skill proposal AND (b) a
 * `skill_template: systemic-proposal` — dual output through the single
 * classifier, not either-or.
 */
import { spawnSync } from "child_process";
import * as path from "path";
import { classifyProposal } from "../classify-proposal";

const SCRIPT = path.resolve(__dirname, "..", "classify-proposal.ts");
const ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;

function runCli(args: string[]): { status: number; out: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8", env: ENV, timeout: 60000 });
  return { status: r.status ?? -1, out: r.stdout ?? "" };
}

describe("classify-proposal.ts — IFACE-CLASSIFIER-1 (VC-K5 dual output)", () => {
  test("≥3 distinct subjects + same signature + approval → systemic dual output (BOTH tokens)", () => {
    const res = classifyProposal({
      distinct_subject_count: 3,
      same_run: false,
      same_signature: true,
      user_approved: true,
      target: "skill",
      subject: "guild-backend",
    });
    expect(res.verdict).toBe("systemic");
    // (a) the per-instance one-skill proposal is present...
    expect(res.outputs).toContain("skill_def: proposal:guild-backend");
    // ...AND (b) the systemic template token is present — dual output, not either-or.
    expect(res.outputs).toContain("skill_template: systemic-proposal");
    expect(res.outputs).toHaveLength(2);
  });

  test("≥2 distinct subjects in one run + same signature + approval → systemic (the OR leg)", () => {
    const res = classifyProposal({
      distinct_subject_count: 2,
      same_run: true,
      same_signature: true,
      user_approved: true,
    });
    expect(res.verdict).toBe("systemic");
    expect(res.outputs).toContain("skill_template: systemic-proposal");
  });

  test("1 subject → specific only (no systemic token)", () => {
    const res = classifyProposal({
      distinct_subject_count: 1,
      same_run: true,
      same_signature: true,
      user_approved: true,
      subject: "guild-backend",
    });
    expect(res.verdict).toBe("specific");
    expect(res.outputs).toEqual(["skill_def: proposal:guild-backend"]);
    expect(res.outputs).not.toContain("skill_template: systemic-proposal");
  });

  test("≥3 subjects but NO user_approved → specific (interactive gate not passed)", () => {
    const res = classifyProposal({
      distinct_subject_count: 3,
      same_run: true,
      same_signature: true,
      user_approved: false,
    });
    expect(res.verdict).toBe("specific");
    expect(res.outputs).not.toContain("skill_template: systemic-proposal");
  });

  test("≥3 subjects but signature differs → specific (signature gate not met)", () => {
    const res = classifyProposal({
      distinct_subject_count: 5,
      same_run: true,
      same_signature: false,
      user_approved: true,
    });
    expect(res.verdict).toBe("specific");
    expect(res.outputs).not.toContain("skill_template: systemic-proposal");
  });

  test("2 distinct subjects across DIFFERENT runs → specific (count gate not met)", () => {
    const res = classifyProposal({
      distinct_subject_count: 2,
      same_run: false,
      same_signature: true,
      user_approved: true,
    });
    expect(res.verdict).toBe("specific");
    expect(res.outputs).not.toContain("skill_template: systemic-proposal");
  });

  test("target=agent surfaces the agent_template systemic token", () => {
    const res = classifyProposal({
      distinct_subject_count: 3,
      same_run: false,
      same_signature: true,
      user_approved: true,
      target: "agent",
      subject: "guild-security",
    });
    expect(res.verdict).toBe("systemic");
    expect(res.outputs).toContain("agent_def: proposal:guild-security");
    expect(res.outputs).toContain("agent_template: systemic-proposal");
  });

  test("CLI shim is genuinely executable (dual output on stdout)", () => {
    const { status, out } = runCli([
      "--distinct=3",
      "--same-signature",
      "--user-approved",
      "--subject=guild-backend",
    ]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.verdict).toBe("systemic");
    expect(j.outputs).toContain("skill_def: proposal:guild-backend");
    expect(j.outputs).toContain("skill_template: systemic-proposal");
  });
});

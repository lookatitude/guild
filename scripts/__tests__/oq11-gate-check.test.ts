/**
 * scripts/__tests__/oq11-gate-check.test.ts
 *
 * OQ11 non-interactive hard-fail — converts the deferred-runtime-test register
 * entry (P7C-consolidated-validation.md §D, owner P7C-gate-001) from
 * design-only to executable + tested. Exercises the gate-check against the
 * OQ11 contract (guild.md §"Non-interactive / CI behaviour (OQ11)").
 *
 * Both register legs are covered: (1) the hard-fail trace — non-interactive
 * bare /guild with no --auto-approve + no named phase exits non-zero; and
 * (2) the complementary trace proving autonomy is NOT granted on that path.
 */
import { spawnSync } from "child_process";
import * as path from "path";
import { checkGate } from "../oq11-gate-check";

const SCRIPT = path.resolve(__dirname, "..", "oq11-gate-check.ts");
const ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;

function runCli(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8", env: ENV, timeout: 60000 });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe("oq11-gate-check.ts — non-interactive hard-fail (OQ11)", () => {
  test("non-interactive + [] auto_approve + no named phase → HARD-FAIL, exit nonzero, autonomy NOT granted", () => {
    const res = checkGate({ interactive: false, auto_approve: [], named_phase: false, gate: "plan" });
    expect(res.hard_fail).toBe(true);
    expect(res.exit_code).not.toBe(0);
    expect(res.autonomy_granted).toBe(false); // complementary trace: autonomy NOT granted
  });

  test("+ named phase → proceeds (deterministic CI explicit-verb path)", () => {
    const res = checkGate({ interactive: false, auto_approve: [], named_phase: true, gate: "plan" });
    expect(res.hard_fail).toBe(false);
    expect(res.exit_code).toBe(0);
    expect(res.autonomy_granted).toBe(true); // EXPLICIT grant via named phase
  });

  test("+ auto-approve covering the gate → proceeds", () => {
    const res = checkGate({ interactive: false, auto_approve: ["spec", "plan"], named_phase: false, gate: "plan" });
    expect(res.hard_fail).toBe(false);
    expect(res.exit_code).toBe(0);
    expect(res.autonomy_granted).toBe(true); // EXPLICIT grant via --auto-approve
  });

  test("auto-approve=all covers any gate → proceeds", () => {
    const res = checkGate({ interactive: false, auto_approve: ["all"], named_phase: false, gate: "build" });
    expect(res.hard_fail).toBe(false);
    expect(res.exit_code).toBe(0);
  });

  test("auto-approve covering a DIFFERENT gate does NOT cover this one → HARD-FAIL", () => {
    const res = checkGate({ interactive: false, auto_approve: ["spec"], named_phase: false, gate: "build" });
    expect(res.hard_fail).toBe(true);
    expect(res.exit_code).not.toBe(0);
    expect(res.autonomy_granted).toBe(false);
  });

  test("interactive → proceeds (gate handled by human prompt; no autonomy granted)", () => {
    const res = checkGate({ interactive: true, auto_approve: [], named_phase: false, gate: "plan" });
    expect(res.hard_fail).toBe(false);
    expect(res.exit_code).toBe(0);
    expect(res.autonomy_granted).toBe(false); // human is asked — not an autonomy grant
  });

  test("CLI hard-fails (exit nonzero) on the bare non-interactive path + prints the actionable message", () => {
    const { status, out, err } = runCli(["--gate=plan", "--non-interactive"]);
    expect(status).not.toBe(0);
    const j = JSON.parse(out);
    expect(j.hard_fail).toBe(true);
    expect(j.autonomy_granted).toBe(false);
    expect(err).toMatch(/will not implicitly grant autonomy/);
    expect(err).toMatch(/interactive gate 'plan' reached in a non-interactive context/);
  });

  test("CLI proceeds (exit 0) when the phase is named", () => {
    const { status, out } = runCli(["--gate=plan", "--non-interactive", "--named-phase"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.hard_fail).toBe(false);
    expect(j.autonomy_granted).toBe(true);
  });

  test("CLI proceeds (exit 0) when --auto-approve covers the gate", () => {
    const { status, out } = runCli(["--gate=plan", "--non-interactive", "--auto-approve=spec,plan,build"]);
    expect(status).toBe(0);
    expect(JSON.parse(out).hard_fail).toBe(false);
  });
});

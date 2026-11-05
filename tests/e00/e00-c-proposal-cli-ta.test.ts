/**
 * E00-C · TC72 proposal-parser correction — the controller CLI `start --proposal`
 * accepts the canonical writeProposal YAML (what every real caller and the TC
 * fixture persist) and still accepts JSON text of the same proposal, reaching the
 * same domain decision. Bytes that are not one mapping refuse proposal_unparseable
 * before any claim, launch record or worker spawn. Runs on source and on the
 * compiled runtime facade so the packaged CLI cannot drift from the source.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { parseYaml } from "../../src/domains/state";
import { teardownOwned } from "./support/e00-harness";
import { buildTcRoot, type TcRoot } from "./tc/tc-fixture";

afterEach(teardownOwned);

const PLUGIN = path.resolve(__dirname, "../..");
const RUNNERS = [
  // test-preload points process.execPath at node, so raw source runs through the repo-local tsx.
  { name: "source", argv: [path.join(PLUGIN, "scripts/node_modules/.bin/tsx"), path.join(PLUGIN, "scripts/task-cell-controller.ts")] },
  { name: "compiled", argv: ["node", path.join(PLUGIN, "runtime/scripts/task-cell-controller.js")] },
] as const;

function start(argv: readonly string[], t: TcRoot, proposalPath: string, policy = "isolated_worker") {
  const r = spawnSync(argv[0], [...argv.slice(1),
    "start", "--root", t.root, "--run", t.runId, "--phase", "build", "--worker-trust-policy", policy,
    "--lanes", t.lanesPath, "--team-plan", t.teamPlanPath, "--proposal", proposalPath,
  ], { cwd: t.root, encoding: "utf8", env: { ...process.env, PATH: `${t.bin}:${process.env.PATH}` } });
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(r.stdout); } catch { body = null; }
  return { status: r.status, stderr: r.stderr, body };
}

/** Nothing of a started cell exists: no controller state, no launch record, no worker ran. */
function expectNothingStarted(t: TcRoot): void {
  expect(fs.existsSync(path.join(t.runDir, "controller"))).toBe(false);
  expect(fs.existsSync(path.join(t.root, ".tc-worker-env.json"))).toBe(false);
}

for (const runner of RUNNERS) {
  describe(`controller CLI --proposal (${runner.name})`, () => {
    it("the canonical writeProposal YAML parses to the exact proposal identity and reaches the domain decision", () => {
      const t = buildTcRoot([{ id: "T1", role: "backend" }], { ackCli: "/nonexistent", node: "node" });
      expect(t.proposalPath.endsWith(".yaml")).toBe(true);
      expect(parseYaml(fs.readFileSync(t.proposalPath, "utf8"))).toEqual(t.proposal);
      const r = start(runner.argv, t, t.proposalPath);
      expect(r.stderr).not.toContain("is not valid JSON");
      expect(r.body).not.toBeNull();
      expect(r.body!.ok).toBe(false);
      expect(r.body!.reason).toBe("worker_principal_unavailable");
      expectNothingStarted(t);
    });

    it("JSON text of the same proposal reaches the same decision", () => {
      const t = buildTcRoot([{ id: "T1", role: "backend" }], { ackCli: "/nonexistent", node: "node" });
      const jsonPath = path.join(path.dirname(t.lanesPath), "proposal.json");
      fs.writeFileSync(jsonPath, JSON.stringify(t.proposal, null, 2) + "\n");
      const yaml = start(runner.argv, t, t.proposalPath);
      const json = start(runner.argv, t, jsonPath);
      expect(json.status).toBe(yaml.status);
      expect(json.body).toEqual(yaml.body);
    });

    for (const [label, bytes] of [
      ["malformed YAML", "excluded_roles: [\n"],
      ["a scalar", "guild.team_proposal.v2\n"],
      ["a sequence", "- run_id: run-e00-tc\n"],
      ["empty bytes", ""],
    ] as const) {
      it(`${label} refuses proposal_unparseable with exit 2 before any claim or spawn`, () => {
        const t = buildTcRoot([{ id: "T1", role: "backend" }], { ackCli: "/nonexistent", node: "node" });
        const bad = path.join(path.dirname(t.lanesPath), "bad-proposal.yaml");
        fs.writeFileSync(bad, bytes);
        const r = start(runner.argv, t, bad);
        expect(r.status).toBe(2);
        expect(r.body).toEqual({ ok: false, reason: "proposal_unparseable" });
        expectNothingStarted(t);
      });
    }

    // cooperative_local passes the principal check, so the parsed object reaches verifyTeamAuthority/dispatchGate.
    for (const [label, mutate] of [
      ["an unknown key (closed schema)", (p: Record<string, any>) => ({ ...p, max_participants: 1 })],
      ["bytes changed after approval (hash join)", (p: Record<string, any>) => ({ ...p, participants: p.participants.map((x: Record<string, any>, i: number) => i === 0 ? { ...x, necessity_rationale: "changed" } : x) })],
    ] as const) {
      it(`a parseable proposal with ${label} is refused by the team gate before any claim or spawn`, () => {
        const t = buildTcRoot([{ id: "T1", role: "backend" }], { ackCli: "/nonexistent", node: "node" });
        const approve = spawnSync(runner.argv[0], [...runner.argv.slice(1), "approve-oracles", "--root", t.root, "--run", t.runId, "--phase", "build", "--decided-by", "e00-operator"], { cwd: t.root, encoding: "utf8" });
        expect(approve.status).toBe(0);
        const forged = path.join(path.dirname(t.lanesPath), "forged-proposal.json");
        fs.writeFileSync(forged, JSON.stringify(mutate(t.proposal), null, 2) + "\n");
        const r = start(runner.argv, t, forged, "cooperative_local");
        expect(r.status).toBe(2);
        expect(r.body).toMatchObject({ ok: false, reason: "oracle_plan_unapproved" });
        expect(String(r.body!.detail)).toContain("does not approve the proposal");
        expectNothingStarted(t);
      });
    }
  });
}

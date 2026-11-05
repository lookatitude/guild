/**
 * tests/e00/tc/tc-fixture.ts — temp-root builder for the TC tier.
 *
 * F1 (round 1): team authority goes through the EXISTING contracts via
 * support/team-authority-fixture.ts (C-R1: the approved plan JSON carries
 * work_items and is bound by the proposal's spec_ref, root Q3). The oracle plan
 * pins that DISTINCT approved plan file in approved_plan_ref and the persisted
 * decision in team_decision_ref. Every root is owned (teardownOwned) and its own binding is
 * minted through mintRunBinding; nothing here forges review or broker evidence.
 */
import * as fs from "fs";
import * as path from "path";

import { mintRunBinding } from "../../../src/domains/lifecycle";
import { composeStationTeam } from "../../../src/domains/teams";
import { ownedTempDir, sha256 } from "../support/e00-harness";
import { writeApprovedTeam } from "../support/team-authority-fixture";
import { TEST_PROFILE_HASH, TEST_TYPE_HASH, adoptDefinition } from "../support/adopted-definition";

export const TC_RUN = "run-e00-tc";
export const TC_LEAD = "lead-binding-tc";
export const TC_REVIEWER = "tc-review";
export const TC_WORKER = path.join(__dirname, "fixture-worker.mjs");

export interface TcLane { id: string; role: string; deps?: string[]; reviewer?: boolean }

export interface TcRoot {
  root: string;
  runId: string;
  bindingRef: string;
  runDir: string;
  bin: string;
  proposalPath: string;
  decisionPath: string;
  approvedPlanPath: string;
  oraclePlanPath: string;
  proposal: Record<string, any>;
  /** Absolute --lanes / --team-plan start inputs (C-R1 declared CLI). */
  lanesPath: string;
  teamPlanPath: string;
  /** sha256 of the adopted lane-role definition bytes (E00-L Q3). */
  adoptedDefinitionSha256: string;
}

/**
 * Copy a fixture root for the copied-tree qualification case. A live Unix socket
 * (the tmux shim's root-local server socket) cannot be copied (ERR_FS_CP_SOCKET),
 * so ONLY socket entries are excluded; every regular file, including all .guild
 * proof, is copied byte for byte. Returns the root-relative paths excluded.
 */
export function copyDurableTree(src: string, dst: string): string[] {
  const excluded: string[] = [];
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (from) => {
      if (fs.lstatSync(from).isSocket()) {
        excluded.push(path.relative(src, from));
        return false;
      }
      return true;
    },
  });
  return excluded.sort();
}

export function buildTcRoot(lanes: TcLane[], opts: { mode?: string; ackCli: string; node: string; packageId?: string | null }): TcRoot {
  const root = ownedTempDir("guild-e00-tc-");
  const runId = TC_RUN;
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const bindingRef = mintRunBinding({ root, run_id: runId }).binding_ref;
  const runDir = path.join(root, ".guild", "runs", runId);

  const bin = path.join(root, ".tc-bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\nexec "${opts.node}" "${TC_WORKER}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, ".tc-worker-mode.json"), JSON.stringify({
    mode: opts.mode ?? "normal",
    ackCli: opts.ackCli,
    packageId: opts.packageId ?? null,
    // F3: the worker scans env byte windows of this LENGTH against this DIGEST; the nonce itself never leaves binding.json.
    nonceSha256: sha256(bindingRef),
    nonceLength: Buffer.byteLength(bindingRef, "utf8"),
  }));

  const approvedPlanRel = ".guild/plan/e00-tc.plan.json";
  const team = writeApprovedTeam(root, runId, lanes, { reviewerId: TC_REVIEWER, planRel: approvedPlanRel });
  const { proposalPath, decisionPath, proposal } = team;

  const oracleDir = path.join(runDir, "oracle-plan");
  fs.mkdirSync(oracleDir, { recursive: true });
  const oraclePlan = {
    schema_version: "guild.task_oracle_plan.v1",
    approved_plan_ref: team.approvedPlanRef,
    team_decision_ref: team.teamDecisionRef,
    lead_binding_id: TC_LEAD,
    acceptance_policy_version: "E00.1",
    lanes: lanes.map((l) => ({
      logical_task_id: l.id,
      authorities_required: l.reviewer ? ["deterministic_floor", "team_lead", "reviewer_cell"] : ["deterministic_floor", "team_lead"],
      reviewer_participant_id: l.reviewer ? TC_REVIEWER : null,
      done_when: [
        { id: "artifact", oracle: "artifact_exists", target: JSON.stringify({ path: `src/out/${l.id}.txt`, sha256: null }) },
        { id: "check", oracle: "command", target: JSON.stringify({ argv: [opts.node, "-e", "process.exit(0)"], cwd: "src", timeout_ms: 60000 }) },
        ...(l.deps ?? []).map((d) => ({ id: `dep-${d}`, oracle: "acceptance_record", target: JSON.stringify({ logical_task_id: d }) })),
      ],
    })),
  };
  const oraclePlanPath = path.join(oracleDir, "build.json");
  fs.writeFileSync(oraclePlanPath, JSON.stringify(oraclePlan, null, 2) + "\n");

  // E00-L Q3: each lane role is a legitimate test-owned adoption (committed bytes + durably
  // committed adoption manifest) that the real resolver accepts; lanes repeat its hashes.
  const roles = [...new Set(lanes.map((l) => l.role))];
  if (roles.length !== 1) throw new Error("tc-fixture: one adopted worker role per root (adoption manifest has one entry)");
  const adopted = adoptDefinition(root, roles[0]!);

  // C-R1 declared start inputs (r1-interface.json cli.start): --lanes LaneSpec[] and --team-plan guild.team_plan.v1.
  const inputs = path.join(root, ".tc-inputs");
  fs.mkdirSync(inputs);
  const laneSpecs = lanes.map((l) => {
    const contextRel = `.guild/context/${runId}/${l.role}-${l.id}.md`;
    fs.mkdirSync(path.dirname(path.join(root, contextRel)), { recursive: true });
    fs.writeFileSync(path.join(root, contextRel), `# context ${l.id}\n`);
    return {
      logical_task_id: l.id, worker_role: l.role,
      specialist: { type_id: l.role, type_version: "1", type_hash: `sha256:${TEST_TYPE_HASH}`, profile_id: l.role, profile_hash: `sha256:${TEST_PROFILE_HASH}` },
      host: { host_id: "claude-code-cli", adapter_id: "claude-code-cli@1", host_capabilities_hash: "sha256:caps", host_family: "anthropic" },
      model: { tier: "mid", model_id: null },
      context_bundle_id: contextRel, objective: `implement ${l.id}`, non_goals: [], scope_paths: ["src"],
      acceptance_tests: ["tc fixture"], dependencies: l.deps ?? [],
      projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
      budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
      autonomy_policy: "supervised", deadline: null,
    };
  });
  const lanesPath = path.join(inputs, "lanes.json");
  fs.writeFileSync(lanesPath, JSON.stringify(laneSpecs, null, 2) + "\n");
  const teamPlanPath = path.join(inputs, "team-plan.json");
  fs.writeFileSync(teamPlanPath, JSON.stringify(composeStationTeam("build", {}, { tierIndex: {} }), null, 2) + "\n");
  return { root, runId, bindingRef, runDir, bin, proposalPath, decisionPath, approvedPlanPath: path.join(root, approvedPlanRel), oraclePlanPath, proposal, lanesPath, teamPlanPath, adoptedDefinitionSha256: adopted.sha256 };
}

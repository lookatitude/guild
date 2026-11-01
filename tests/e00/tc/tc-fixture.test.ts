/**
 * E00-T0 · F1 (round 1) — the TC fixture's team authority is valid under the
 * EXISTING contracts today (runs at TA, not gated on a package): the persisted
 * proposal and decision pass dispatchGate, the oracle plan pins a distinct
 * approved plan and the persisted decision by exact bytes, and the reviewer slot
 * is a reviewer_cross_host participant separate from the lead binding. The
 * copied-tree helper copies every proof byte while a live owned tmux socket exists.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { loadPersistedDecisions, preDispatchGate } from "../../../src/domains/teams";
import { listProcesses, ownedTempDir, sha256, teardownOwned, walkFiles } from "../support/e00-harness";
import { TC_LEAD, TC_REVIEWER, buildTcRoot, copyDurableTree } from "./tc-fixture";
import { installTmuxShim, resolveRealTmux, tmuxOn } from "./tmux-shim";

afterEach(teardownOwned);

describe("F1 TC fixture authority (control)", () => {
  it("persists a valid proposal and approve decision that pass dispatchGate", () => {
    const t = buildTcRoot([{ id: "T1", role: "backend" }, { id: "T2", role: "backend", deps: ["T1"] }], { ackCli: "/nonexistent", node: "node" });
    const decisions = loadPersistedDecisions(t.root, t.runId, "build");
    expect(decisions.map((d) => [d.source_path, d.valid])).toEqual([[t.decisionPath, true]]);
    expect(fs.existsSync(t.proposalPath)).toBe(true);
    const proposal = t.proposal;
    expect(decisions[0].decision).toMatchObject({ run_id: t.runId, phase: "build", decision: "approve", proposal_hash: proposal.proposal_hash });
    expect(preDispatchGate(proposal, decisions).allowed).toBe(true);
    const reviewer = proposal.participants.find((p: { participant_id: string }) => p.participant_id === TC_REVIEWER);
    expect(reviewer).toMatchObject({ participation_kind: "reviewer_cross_host", role_ref: "security-auditor" });
    expect(proposal.participants.some((p: { participant_id: string }) => p.participant_id === TC_LEAD)).toBe(false);
  });

  it("pins a distinct approved plan and the persisted decision by exact bytes", () => {
    const t = buildTcRoot([{ id: "T1", role: "backend" }], { ackCli: "/nonexistent", node: "node" });
    const plan = JSON.parse(fs.readFileSync(t.oraclePlanPath, "utf8"));
    expect(plan.approved_plan_ref.path).not.toBe(plan.team_decision_ref.path);
    expect(plan.approved_plan_ref.sha256).toBe(sha256(fs.readFileSync(path.join(t.root, plan.approved_plan_ref.path))));
    expect(plan.team_decision_ref.sha256).toBe(sha256(fs.readFileSync(path.join(t.root, plan.team_decision_ref.path))));
    expect(path.join(t.root, plan.team_decision_ref.path)).toBe(t.decisionPath);
  });

  it("gives the worker only a nonce digest, never the nonce", () => {
    const t = buildTcRoot([{ id: "T1", role: "backend" }], { ackCli: "/nonexistent", node: "node" });
    const mode = fs.readFileSync(path.join(t.root, ".tc-worker-mode.json"));
    expect(mode.includes(Buffer.from(t.bindingRef))).toBe(false);
    expect(JSON.parse(mode.toString("utf8")).nonceSha256).toBe(sha256(t.bindingRef));
  });
});

describe.skipIf(resolveRealTmux() === null)("copied-tree fixture (control for the TC copied-tree case)", () => {
  it("copies a TC root with a live owned tmux server: only the socket is excluded and every .guild proof file is byte-identical", async () => {
    const t = buildTcRoot([{ id: "T1", role: "backend" }], { ackCli: "/nonexistent", node: "node" });
    const shim = installTmuxShim(t.root, t.bin);
    expect(spawnSync(path.join(t.bin, "tmux"), ["new-session", "-d", "-s", "live", "sleep 600"], { encoding: "utf8" }).status).toBe(0);
    expect(fs.lstatSync(shim.socket).isSocket()).toBe(true);
    const plain = ownedTempDir("guild-e00-tc-copy-plain-");
    let plainError = "";
    try {
      fs.cpSync(t.root, plain, { recursive: true });
    } catch (e) {
      plainError = (e as NodeJS.ErrnoException).code ?? "threw";
    }
    expect(plainError).toBe("ERR_FS_CP_SOCKET");
    const copy = ownedTempDir("guild-e00-tc-copy-");
    expect(copyDurableTree(t.root, copy)).toEqual([path.join(".tc-tmux", "sock")]);
    const proof = walkFiles(path.join(t.root, ".guild"));
    expect(proof.length).toBeGreaterThan(0);
    for (const f of proof) {
      expect(sha256(fs.readFileSync(path.join(copy, path.relative(t.root, f))))).toBe(sha256(fs.readFileSync(f)));
    }
    expect(walkFiles(path.join(copy, ".guild")).length).toBe(proof.length);
    expect(tmuxOn(shim, ["has-session", "-t", "live"]).status).toBe(0);
    expect((listProcesses() ?? []).some((r) => r.command.includes(`-S ${shim.socket}`))).toBe(true);
  });
});

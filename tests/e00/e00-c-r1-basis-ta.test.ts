/**
 * E00-T0-C-R1 · TA checks for the reviewed source basis and team authority
 * verifiers C declared in evidence/e00-c/r1-interface.json (sha256 7ef50e55...):
 * verifySourceBasisReview, reverifyReviewedBasis, verifyTeamAuthority and
 * requiredAuthoritiesFor, imported from the SOURCE module (not the package facade).
 *
 * Mechanics only (CD16): every basis here is a fake, self-consistent fixture in an
 * owned OS-temp root (approved proposal + decision through the existing teams
 * contracts, a guild.source_basis_review_request.v1 and its five evidence files).
 * It proves the verifier's checks, never a real review; the genuine source-basis
 * invocation and the installed positive stay TC (root supplies them later).
 * Each refusal case changes exactly one fact of the control fixture.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { ownedTempDir, requireExport, sha256, teardownOwned } from "./support/e00-harness";
import { writeApprovedTeam } from "./support/team-authority-fixture";

afterEach(teardownOwned);

const SOURCE = "src/domains/dispatch/task-cell-controller.ts";
const UID = process.getuid?.() ?? -1;
const BASIS_RUN = "run-e00-basis";
const REVIEWER = "basis-review";
const PACKET = "basis-pkt-1";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const OTHER_COMMIT = "fedcba9876543210fedcba9876543210fedcba98";

interface BasisFiles {
  request: Record<string, any>;
  candidate: Record<string, any>;
  packet: string;
  adapterExit: Record<string, any>;
  result: Record<string, any>;
  invocation: Record<string, any>;
}

interface BasisOpts {
  /** Edit the JSON/text facts before files are written; joins are computed AFTER this. */
  facts?: (f: BasisFiles) => void;
  /** Edit the written root after all files exist (breaks joins on purpose). */
  after?: (b: Basis) => void;
}

interface Basis {
  root: string;
  input: { root: string; proposalPath: string; decisionPath: string; requestPath: string };
  evidenceDir: string;
  proposalHash: string;
}

function buildBasis(opts: BasisOpts = {}): Basis {
  const root = ownedTempDir("guild-e00-basis-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  const team = writeApprovedTeam(root, BASIS_RUN, [{ id: "B1", role: "backend" }], { reviewerId: REVIEWER, planRel: ".guild/plan/basis.json" });
  const evidenceDir = `.guild/runs/${BASIS_RUN}/review/${PACKET}`;
  const requestPath = `.guild/runs/${BASIS_RUN}/basis-request.json`;
  const files: BasisFiles = {
    request: {
      schema_version: "guild.source_basis_review_request.v1", request_id: "basis-req-1", packet_id: PACKET,
      reviewer_participant_id: REVIEWER, participation_kind: "reviewer_cross_host", role_ref: "security-auditor",
      proposal_sha256: team.proposal.proposal_hash, reviewed_commit: COMMIT, reviewed: { host_family: "anthropic" }, evidence_dir: evidenceDir,
    },
    candidate: { reviewer_participant_id: REVIEWER, reviewer_role: "security-auditor", packet_id: PACKET, reviewed_commit: COMMIT },
    packet: "source basis packet\n",
    adapterExit: {
      exit: 0, reviewer_family: "openai", author_family: "anthropic", independence: "cross_family", served_model: "fixture-model",
      started_at: "2026-10-26T12:00:00.000Z", finished_at: "2026-10-26T12:05:00.000Z",
    },
    result: { schema_version: "review_result.v1", packet_id: PACKET, verdict: "satisfied", blocking_findings: [], verification: ["fixture"], limits: ["mechanics only"] },
    invocation: {
      schema_version: "guild.review_invocation.v1", invocation_id: "basis-inv-1", packet_id: PACKET, request_id: "basis-req-1",
      reviewer_participant_id: REVIEWER, participation_kind: "reviewer_cross_host", role_ref: "security-auditor",
      started_at: "2026-10-26T12:00:00.000Z", finished_at: "2026-10-26T12:05:00.000Z", exit: 0,
      reviewer_family: "openai", author_family: "anthropic", independence: "cross_family", requested_model: "fixture-model", served_model: "fixture-model",
    },
  };
  opts.facts?.(files);
  const write = (rel: string, body: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
    return { path: rel, sha256: sha256(fs.readFileSync(path.join(root, rel))) };
  };
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  const requestRef = write(requestPath, json(files.request));
  const dir = files.request.evidence_dir as string;
  const candidateRef = write(`${dir}/candidate.json`, json(files.candidate));
  const packetRef = write(`${dir}/packet.txt`, files.packet);
  const exitRef = write(`${dir}/adapter-exit.json`, json(files.adapterExit));
  if (files.result.artifact_sha256_reviewed === undefined) files.result.artifact_sha256_reviewed = candidateRef.sha256;
  const resultRef = write(`${dir}/result.json`, json(files.result));
  const inv = { ...files.invocation, request: requestRef, candidate: candidateRef, packet: packetRef, result: resultRef, adapter_exit: exitRef };
  write(`${dir}/invocation.json`, json(inv));
  // The verifier requires result.json mtime <= invocation.json mtime.
  const t = new Date("2026-10-26T12:06:00.000Z");
  fs.utimesSync(path.join(root, dir, "result.json"), t, t);
  const b: Basis = {
    root,
    input: { root, proposalPath: path.relative(root, team.proposalPath), decisionPath: path.relative(root, team.decisionPath), requestPath },
    evidenceDir: dir,
    proposalHash: team.proposal.proposal_hash,
  };
  opts.after?.(b);
  return b;
}

type Verify = (i: unknown) => { ok: boolean; reason?: string; pins?: Record<string, any> };

async function verify(b: Basis, expectedCommit: string | null = COMMIT, input: unknown = b.input) {
  const fn = await requireExport<Verify>(SOURCE, "verifySourceBasisReview");
  return fn({ basis: input, expectedCommit, operatorUid: UID });
}

describe("C-R1 F1 · verifySourceBasisReview (TA mechanics, fake basis evidence)", () => {
  it("control: a self-consistent basis verifies and pins every file by its current hash", async () => {
    const b = buildBasis();
    const v = await verify(b);
    expect(v.ok).toBe(true);
    const pins = v.pins!;
    expect(pins.root).toBe(fs.realpathSync(b.root));
    expect(pins.commit).toBe(COMMIT);
    for (const k of ["proposal", "decision", "request", "candidate", "packet", "adapter_exit", "invocation", "result"]) {
      expect(pins[k].sha256).toBe(sha256(fs.readFileSync(path.join(pins.root, pins[k].path))));
    }
    expect(pins.invocation.invocation_id).toBe("basis-inv-1");
  });

  it("a null package source_commit refuses source_commit_absent", async () => {
    expect(await verify(buildBasis(), null)).toMatchObject({ ok: false, reason: "source_commit_absent" });
  });

  const refusals: Array<[string, BasisOpts, { expected?: string; input?: (b: Basis) => unknown }?]> = [
    ["the package source_commit is another commit", {}, { expected: OTHER_COMMIT }],
    ["candidate.reviewed_commit differs from the request (joins recomputed)", { facts: (f) => { f.candidate.reviewed_commit = OTHER_COMMIT; } }],
    ["request.reviewed_commit differs from the candidate (joins recomputed)", { facts: (f) => { f.request.reviewed_commit = OTHER_COMMIT; } }],
    ["request.reviewed_commit is not 40 lowercase hex", { facts: (f) => { f.request.reviewed_commit = COMMIT.toUpperCase(); f.candidate.reviewed_commit = COMMIT.toUpperCase(); } }],
    ["the request is bound to another proposal hash", { facts: (f) => { f.request.proposal_sha256 = "0".repeat(64); } }],
    ["the reviewer is a worker participant, not reviewer_cross_host", { facts: (f) => {
      for (const o of [f.request, f.candidate, f.invocation]) o.reviewer_participant_id = "b1";
    } }],
    ["the request role_ref differs from the slot role_ref", { facts: (f) => { f.request.role_ref = "backend"; f.invocation.role_ref = "backend"; } }],
    ["reviewer and author are the same family", { facts: (f) => { f.adapterExit.reviewer_family = "anthropic"; f.invocation.reviewer_family = "anthropic"; } }],
    ["the author family is not the request's reviewed host family", { facts: (f) => { f.request.reviewed.host_family = "google"; } }],
    ["the broker exit is nonzero", { facts: (f) => { f.adapterExit.exit = 1; f.invocation.exit = 1; } }],
    ["the result is not satisfied", { facts: (f) => {
      f.result.verdict = "issues";
      f.result.blocking_findings = [{ id: "B1", path: "src/x.ts", line: 1, title: "t", trigger: "t", impact: "i", required: "r" }];
    } }],
    ["the result reviewed other bytes than the candidate", { facts: (f) => { f.result.artifact_sha256_reviewed = "0".repeat(64); } }],
    ["the candidate was edited after the invocation pinned it", { after: (b) => fs.appendFileSync(path.join(b.root, b.evidenceDir, "candidate.json"), " ") }],
    ["result.json is newer than invocation.json", { after: (b) => {
      const later = new Date(Date.now() + 60_000);
      fs.utimesSync(path.join(b.root, b.evidenceDir, "result.json"), later, later);
    } }],
    ["the invocation_id is reused by another packet in the basis run", { after: (b) => {
      const other = path.join(b.root, ".guild", "runs", BASIS_RUN, "review", "other-pkt");
      fs.mkdirSync(other, { recursive: true });
      fs.writeFileSync(path.join(other, "invocation.json"), JSON.stringify({ invocation_id: "basis-inv-1", packet_id: "other-pkt" }));
    } }],
    ["the decision bytes were edited (decision no longer approves the proposal)", { after: (b) => {
      const p = path.join(b.root, b.input.decisionPath);
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("approve", "reject"));
    } }],
    ["the request is a TaskCell review request, not a source-basis request", { facts: (f) => { f.request.schema_version = "guild.task_cell_review_request.v1"; } }],
    ["the request file is a symlink", { after: (b) => {
      const p = path.join(b.root, b.input.requestPath);
      fs.renameSync(p, `${p}.real`);
      fs.symlinkSync(`${p}.real`, p);
    } }],
    ["the descriptor points the decision at the proposal file", {}, { input: (b) => ({ ...b.input, decisionPath: b.input.proposalPath }) }],
    ["the descriptor uses an absolute request path", {}, { input: (b) => ({ ...b.input, requestPath: path.join(b.root, b.input.requestPath) }) }],
    ["the descriptor request path escapes the basis root", {}, { input: (b) => {
      // A byte-identical request that really lives outside the basis root.
      const outside = ownedTempDir("guild-e00-basis-out-");
      fs.copyFileSync(path.join(b.root, b.input.requestPath), path.join(outside, "request.json"));
      return { ...b.input, requestPath: path.relative(b.root, path.join(outside, "request.json")) };
    } }],
    ["the basis root is relative", {}, { input: (b) => ({ ...b.input, root: path.relative(process.cwd(), b.root) }) }],
  ];
  for (const [label, opts, extra] of refusals) {
    it(`refuses basis_unreviewed when ${label}`, async () => {
      const b = buildBasis(opts);
      const v = await verify(b, extra?.expected ?? COMMIT, extra?.input ? extra.input(b) : b.input);
      expect(v).toMatchObject({ ok: false, reason: "basis_unreviewed" });
    });
  }
});

describe("C-R1 F1 · reverifyReviewedBasis (TA mechanics)", () => {
  async function pinned() {
    const b = buildBasis();
    const v = await verify(b);
    expect(v.ok).toBe(true);
    const re = await requireExport<(p: unknown, c: string | null, u: number) => boolean>(SOURCE, "reverifyReviewedBasis");
    return { b, pins: v.pins!, re };
  }

  it("control: unchanged pins re-verify for the same commit", async () => {
    const { pins, re } = await pinned();
    expect(re(pins, COMMIT, UID)).toBe(true);
  });

  it("an edited pinned file fails re-verification", async () => {
    const { b, pins, re } = await pinned();
    fs.appendFileSync(path.join(b.root, b.evidenceDir, "packet.txt"), "x");
    expect(re(pins, COMMIT, UID)).toBe(false);
  });

  it("a current package commit other than the pinned commit fails", async () => {
    const { pins, re } = await pinned();
    expect(re(pins, OTHER_COMMIT, UID)).toBe(false);
    expect(re(pins, null, UID)).toBe(false);
  });

  it("absent or altered pins fail", async () => {
    const { pins, re } = await pinned();
    expect(re(null, COMMIT, UID)).toBe(false);
    expect(re({ ...pins, commit: OTHER_COMMIT }, COMMIT, UID)).toBe(false);
  });
});

describe("C-R1 F2 · verifyTeamAuthority and requiredAuthoritiesFor (TA mechanics)", () => {
  it("requiredAuthoritiesFor is the closed set implied by the reviewer participant", async () => {
    const req = await requireExport<(r: string | null) => string[]>(SOURCE, "requiredAuthoritiesFor");
    expect(req(null)).toEqual(["deterministic_floor", "team_lead"]);
    expect(req(REVIEWER)).toEqual(["deterministic_floor", "team_lead", "reviewer_cell"]);
  });

  function authorityRoot(lanes: Array<{ id: string; role: string }>) {
    const root = ownedTempDir("guild-e00-auth-");
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    const team = writeApprovedTeam(root, BASIS_RUN, lanes, { reviewerId: REVIEWER, planRel: ".guild/plan/auth.json" });
    const plan = {
      schema_version: "guild.task_oracle_plan.v1", approved_plan_ref: team.approvedPlanRef, team_decision_ref: team.teamDecisionRef,
      lead_binding_id: "lead-binding-auth", acceptance_policy_version: "E00.1",
      lanes: lanes.map((l) => ({ logical_task_id: l.id, authorities_required: ["deterministic_floor", "team_lead"], reviewer_participant_id: null, done_when: [] })),
    };
    return { root, team, plan };
  }

  it("control: an approved proposal yields membership logical_task_id -> owner role, duplicate roles kept as distinct lanes", async () => {
    const fn = await requireExport<(i: unknown) => { ok: boolean; membership?: Map<string, string> }>(SOURCE, "verifyTeamAuthority");
    const { root, team, plan } = authorityRoot([{ id: "T1", role: "backend" }, { id: "T2", role: "backend" }]);
    const v = fn({ cwd: root, runId: BASIS_RUN, phase: "build", plan, proposal: team.proposal });
    expect(v.ok).toBe(true);
    expect([...(v.membership ?? new Map()).entries()].sort()).toEqual([["T1", "backend"], ["T2", "backend"]]);
  });

  it("an absent proposal refuses oracle_plan_unapproved", async () => {
    const fn = await requireExport<(i: unknown) => { ok: boolean; reason?: string }>(SOURCE, "verifyTeamAuthority");
    const { root, plan } = authorityRoot([{ id: "T1", role: "backend" }]);
    expect(fn({ cwd: root, runId: BASIS_RUN, phase: "build", plan, proposal: null })).toMatchObject({ ok: false, reason: "oracle_plan_unapproved" });
  });

  it("a proposal other than the one the team decision approves refuses oracle_plan_unapproved", async () => {
    const fn = await requireExport<(i: unknown) => { ok: boolean; reason?: string }>(SOURCE, "verifyTeamAuthority");
    const { root, team, plan } = authorityRoot([{ id: "T1", role: "backend" }]);
    const other = { ...team.proposal, proposal_hash: "0".repeat(64) };
    expect(fn({ cwd: root, runId: BASIS_RUN, phase: "build", plan, proposal: other })).toMatchObject({ ok: false, reason: "oracle_plan_unapproved" });
  });
});

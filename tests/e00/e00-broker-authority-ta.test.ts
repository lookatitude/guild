/**
 * E00-T0 · F4 (round 1) · EAT04 / CD12 (a)-(f) at TA — reviewer_cell authority
 * derivation over ONE fully joined, approved cross-host broker evidence set and
 * focused forgeries of each required identity, hash, independence and
 * invocation join. The evidence here is an injected TA fixture in a temp root:
 * MECHANICS ONLY. It never stands in for a genuine broker invocation; actual TC
 * qualification uses a genuine broker run (tc/e00-installed-package.tc.test.ts).
 *
 * The approved proposal is a real guild.team_proposal.v2 from composeProposal.
 *
 * Proposed test contract (handoff; r12 places CD12 in the controller and
 * review-invocation.ts but names no derivation entry point):
 *   deriveReviewerCellAuthority({ cwd, requestPath, proposal, reviewedHostFamily, operatorUid, knownInvocationIds })
 *     -> { decision: "accepted" | "rejected" | "awaiting" | "review_refused", reason: string | null,
 *          gate_conditions?: { parses, packet_id_match, sha256_match, satisfied, no_blockers } }
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { composeProposal } from "../../src/domains/teams";
import { ownedTempDir, requireExport, sha256, teardownOwned } from "./support/e00-harness";

afterEach(teardownOwned);

const RUN = "run-e00-broker";
const PACKET = `${RUN}-T1-a1-review`;

function proposal(reviewerKind: "reviewer_cross_host" | "worker" = "reviewer_cross_host") {
  const participants = [
    { participant_id: "t1", participation_kind: "worker", role_ref: "backend", necessity_rationale: "owns T1", owned_obligations: ["ob-t1"], depends_on: [], tier: "mid", purpose: "implementation", capability_scope: null, backend: "team" },
    { participant_id: "e00-review", participation_kind: reviewerKind, role_ref: "security-auditor", necessity_rationale: "cross-family review of T1", owned_obligations: ["ob-review"], depends_on: ["t1"], tier: "powerful", purpose: "adversarial-security", capability_scope: null, backend: "team" },
  ];
  return composeProposal({
    run_id: RUN, phase: "build", participants,
    obligations: participants.map((p) => ({ obligation_id: p.owned_obligations[0], source: "plan_item", text: `work owned by ${p.participant_id}`, disposition: { owners: [p.participant_id] } })),
    excluded_roles: [],
  } as never);
}

type Mutation = (e: Evidence) => void;

interface Evidence {
  root: string;
  dir: string;
  request: Record<string, any>;
  candidate: Record<string, any>;
  result: Record<string, any>;
  adapterExit: Record<string, any>;
  invocation: Record<string, any>;
  packetText: string;
  receipt: Buffer;
}

function baseEvidence(): Evidence {
  const root = ownedTempDir("guild-e00-broker-");
  const dir = path.join(root, ".guild", "runs", RUN, "review", PACKET);
  fs.mkdirSync(dir, { recursive: true });
  const receipt = Buffer.from("retained receipt bytes\n");
  const receiptRel = `.guild/runs/${RUN}/task-cells/T1/attempts/1/instances/T1.a1.i1/receipt.md`;
  fs.mkdirSync(path.dirname(path.join(root, receiptRel)), { recursive: true });
  fs.writeFileSync(path.join(root, receiptRel), receipt);
  const request = {
    schema_version: "guild.task_cell_review_request.v1", request_id: "req-1", packet_id: PACKET,
    reviewer_participant_id: "e00-review", participation_kind: "reviewer_cross_host", role_ref: "security-auditor",
    proposal_sha256: "", retained_receipt: { path: receiptRel, sha256: sha256(receipt) },
    reviewed: { cell_id: "cell-T1", logical_task_id: "T1", instance_id: "T1.a1.i1", worker_role: "backend", host_family: "anthropic" },
    evidence_dir: path.relative(root, dir),
  };
  const candidate = { packet_id: PACKET, reviewer_participant_id: "e00-review", reviewer_role: "security-auditor", retained_receipt: { ...request.retained_receipt } };
  const adapterExit = { exit: 0, reviewer_family: "openai", author_family: "anthropic", independence: "cross_family", served_model: "m-served", started_at: "2026-10-26T13:00:00.000Z", finished_at: "2026-10-26T13:05:00.000Z" };
  return { root, dir, request, candidate, result: {}, adapterExit, invocation: {}, packetText: "review packet\n", receipt };
}

/** Write every file with consistent joins, applying `mutate` at the stage it targets. */
function materialize(e: Evidence, mutate: { before?: Mutation; after?: Mutation; omit?: string[]; symlink?: string } = {}): string {
  const p = proposal(e.request.participation_kind === "reviewer_cross_host" ? "reviewer_cross_host" : "worker");
  e.request.proposal_sha256 = p.proposal_hash;
  const candidateBytes = Buffer.from(JSON.stringify(e.candidate));
  e.result = { schema_version: "review_result.v1", packet_id: PACKET, artifact_sha256_reviewed: sha256(candidateBytes), verdict: "satisfied", blocking_findings: [], verification: ["reviewed T1"], limits: ["fixture"], ...e.result };
  mutate.before?.(e);
  const files: Record<string, Buffer> = {
    "request.json": Buffer.from(JSON.stringify(e.request)),
    "candidate.json": Buffer.from(JSON.stringify(e.candidate)),
    "packet.txt": Buffer.from(e.packetText),
    "result.json": Buffer.from(JSON.stringify(e.result)),
    "adapter-exit.json": Buffer.from(JSON.stringify(e.adapterExit)),
  };
  const ref = (n: string) => ({ path: path.relative(e.root, path.join(e.dir, n)), sha256: sha256(files[n]) });
  e.invocation = {
    schema_version: "guild.review_invocation.v1", invocation_id: "inv-1", packet_id: PACKET, request_id: e.request.request_id,
    reviewer_participant_id: e.request.reviewer_participant_id, participation_kind: e.request.participation_kind, role_ref: e.request.role_ref,
    request: ref("request.json"), candidate: ref("candidate.json"), packet: ref("packet.txt"), result: ref("result.json"), adapter_exit: ref("adapter-exit.json"),
    requested_model: "m-requested", ...e.adapterExit,
  };
  mutate.after?.(e);
  files["invocation.json"] = Buffer.from(JSON.stringify(e.invocation));
  for (const [n, b] of Object.entries(files)) {
    if (mutate.omit?.includes(n)) continue;
    if (mutate.symlink === n) {
      const real = path.join(e.root, `real-${n}`);
      fs.writeFileSync(real, b);
      fs.symlinkSync(real, path.join(e.dir, n));
    } else {
      fs.writeFileSync(path.join(e.dir, n), b);
    }
  }
  if (mutate.after) {
    // `after` mutations edit file bytes post-join: rewrite the touched files without re-hashing.
    fs.writeFileSync(path.join(e.dir, "candidate.json"), JSON.stringify(e.candidate));
    fs.writeFileSync(path.join(e.dir, "result.json"), JSON.stringify(e.result));
    fs.writeFileSync(path.join(e.dir, "adapter-exit.json"), JSON.stringify(e.adapterExit));
    fs.writeFileSync(path.join(e.dir, "invocation.json"), JSON.stringify(e.invocation));
  }
  return path.join(e.dir, "request.json");
}

async function derive(e: Evidence, requestPath: string, opts: { knownInvocationIds?: string[]; reviewedHostFamily?: string } = {}) {
  const fn = await requireExport<(o: unknown) => Record<string, any>>("src/domains/dispatch/index.ts", "deriveReviewerCellAuthority");
  return fn({
    cwd: e.root, requestPath, proposal: proposal(e.request.participation_kind === "reviewer_cross_host" ? "reviewer_cross_host" : "worker"),
    reviewedHostFamily: opts.reviewedHostFamily ?? "anthropic", operatorUid: process.getuid?.() ?? 0,
    knownInvocationIds: opts.knownInvocationIds ?? [],
  });
}

describe("CD12 positive: one fully joined approved cross-host broker result (mechanics-only)", () => {
  it("derives reviewer_cell accepted with all five gate conditions", async () => {
    const e = baseEvidence();
    const out = await derive(e, materialize(e));
    expect(out).toMatchObject({ decision: "accepted", reason: null, gate_conditions: { parses: true, packet_id_match: true, sha256_match: true, satisfied: true, no_blockers: true } });
  });
});

describe("CD12 awaiting and rejected outcomes", () => {
  it("missing invocation record leaves reviewer_cell awaiting (review_invocation_absent)", async () => {
    const e = baseEvidence();
    expect(await derive(e, materialize(e, { omit: ["invocation.json"] }))).toMatchObject({ decision: "awaiting", reason: "review_invocation_absent" });
  });

  it("an issues verdict with a blocking finding is rejected", async () => {
    const e = baseEvidence();
    e.result = { verdict: "issues", blocking_findings: [{ id: "B1", path: "x", line: 1, title: "t", trigger: "t", impact: "i", required: "r" }] };
    expect((await derive(e, materialize(e))).decision).toBe("rejected");
  });
});

describe("CD12 forgeries are review_refused, never accepted", () => {
  const cases: Array<[string, (e: Evidence) => Parameters<typeof materialize>[1], { knownInvocationIds?: string[]; reviewedHostFamily?: string }?, string?]> = [
    ["candidate names another participant", (e) => { e.candidate.reviewer_participant_id = "someone-else"; return {}; }],
    ["candidate reviewer_role equals participation_kind instead of role_ref", (e) => { e.candidate.reviewer_role = "reviewer_cross_host"; return {}; }],
    ["request slot is not reviewer_cross_host", (e) => { e.request.participation_kind = "worker"; return {}; }],
    ["candidate does not pin the retained receipt sha256", (e) => { e.candidate.retained_receipt = { ...e.candidate.retained_receipt, sha256: "0".repeat(64) }; return {}; }],
    ["candidate bytes changed after the invocation pinned them", () => ({ after: (x) => { x.candidate.extra = "edited"; } })],
    ["invocation result hash does not match the result bytes", () => ({ after: (x) => { x.invocation.result = { ...x.invocation.result, sha256: "f".repeat(64) }; } })],
    ["invocation_id already used by another request", () => ({}), { knownInvocationIds: ["inv-1"] }],
    ["reviewer and author are the same family", (e) => { e.adapterExit.reviewer_family = "anthropic"; return {}; }],
    ["author family is not the reviewed instance's host family", () => ({}), { reviewedHostFamily: "google" }],
    ["invocation exit differs from adapter exit", () => ({ after: (x) => { x.invocation.exit = 1; } })],
    ["started_at is not before finished_at", (e) => { e.adapterExit.started_at = "2026-10-26T13:10:00.000Z"; return {}; }],
    ["result file is a symlink", () => ({ symlink: "result.json" })],
    ["result carries a property outside review_result.v1", (e) => { e.result = { notes: "extra" }; return {}; }],
  ];
  for (const [label, arrange, opts] of cases) {
    it(`refuses: ${label}`, async () => {
      const e = baseEvidence();
      const req = materialize(e, arrange(e) ?? {});
      const out = await derive(e, req, opts ?? {});
      expect(out.decision).toBe("review_refused");
      expect(typeof out.reason).toBe("string");
    });
  }

  it("a nonzero broker exit with a canonical satisfied result is refused broker_exit_nonzero", async () => {
    const e = baseEvidence();
    e.adapterExit.exit = 1;
    expect(await derive(e, materialize(e))).toMatchObject({ decision: "review_refused", reason: "broker_exit_nonzero" });
  });
});

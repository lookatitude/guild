/**
 * E00-T0 · source-basis r1 review findings F1/F2 · independent red regressions
 * against the SOURCE modules (never the package facade or a dist fallback).
 *
 * F1 (task-cell-artifact-join.ts verifyPrereleaseBusJoins): a join may hold only
 * when the LATEST bus event for the canonical path is itself the matching
 * publication (canonical topic and the file's current hash). Lifecycles come from
 * the existing runtime on an owned temp root with its own minted binding; later
 * events are written through the canonical publishTaskCellFile / publish helpers.
 *
 * F2 (task-cell-controller.ts verifyBrokerReview via verifySourceBasisReview and
 * deriveReviewerCellAuthority): request.evidence_dir must be the request's
 * canonical run/packet review directory, physically contained in the root through
 * every ancestor. Evidence elsewhere must not grant authority, which also keeps it
 * inside the invocation-reuse scan.
 *
 * Mechanics only (CD16): every review here is a fake, self-consistent fixture in
 * an owned OS-temp root. It proves the verifier's checks, never a real review, and
 * qualifies nothing. Refusals keep the existing strict reasons (basis_unreviewed /
 * review_refused / prerelease_bus_join_missing); no new reason names are assumed.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import {
  FIXED_NOW, acceptLane, driveLane, makeRuntime, ownedTempDir, requireExport, sha256, teardownOwned, tempRoot, type TempRoot,
} from "./support/e00-harness";
import { writeApprovedTeam } from "./support/team-authority-fixture";

afterEach(teardownOwned);

const DISPATCH = "src/domains/dispatch/index.ts";
const JOIN = "src/domains/dispatch/task-cell-artifact-join.ts";
const BUS = "src/domains/dispatch/artifact-bus.ts";
const CONTROLLER = "src/domains/dispatch/task-cell-controller.ts";
const UID = process.getuid?.() ?? -1;

// ── F1 · pre-release bus join must bind to the latest publication ────────────

type Join = { kind: string; path: string | null; sha256: string | null; reason: string | null; cas_ok: boolean };
type Ids = { run_id: string; logical_task_id: string; attempt: number; instance_id: string };

async function lifecycle() {
  const root = tempRoot("guild-e00-sbr1-join-");
  const rt = makeRuntime(root);
  const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend" });
  expect((await acceptLane(rt, d.instance)).ok).toBe(true);
  expect((await rt.runtime.terminate(d.instance)).ok).toBe(true);
  const ids: Ids = { run_id: root.runId, logical_task_id: "T1", attempt: 1, instance_id: d.instance.instance_id };
  return { root, ids };
}

async function joins(root: TempRoot, ids: Ids, kinds: string[]): Promise<Join[]> {
  const verify = await requireExport<(cwd: string, ids: Ids, kinds: string[]) => Join[]>(JOIN, "verifyPrereleaseBusJoins");
  return verify(root.cwd, ids, kinds);
}

async function joinOf(root: TempRoot, ids: Ids, kind: string): Promise<Join> {
  return (await joins(root, ids, [kind]))[0];
}

/** Publish the file's CURRENT bytes on `path` through the canonical helper (kind/ids pick the topic). */
async function publishAs(root: TempRoot, ids: Ids, kind: string, rel: string): Promise<void> {
  const pub = await requireExport<(i: unknown) => { seq: number } | null>(JOIN, "publishTaskCellFile");
  const ev = pub({ cwd: root.cwd, ids, kind, relativePath: rel, hostId: "claude-code-cli", role: "task-cell-runtime", bindingRef: root.bindingRef, now: () => FIXED_NOW });
  expect(ev).not.toBeNull();
}

/** Publish other bytes on `path` (a later conflicting hash), then restore the original bytes. */
async function publishOtherBytes(root: TempRoot, ids: Ids, kind: string, rel: string): Promise<void> {
  const abs = path.join(root.cwd, rel);
  const original = fs.readFileSync(abs);
  fs.writeFileSync(abs, Buffer.concat([original, Buffer.from("\n")]));
  await publishAs(root, ids, kind, rel);
  fs.writeFileSync(abs, original);
}

async function busEvents(root: TempRoot): Promise<Array<Record<string, any>>> {
  const read = await requireExport<(dir: string) => Array<Record<string, any>>>(BUS, "readBusLog");
  return read(path.join(root.cwd, ".guild", "runs", root.runId));
}

/** Retract `rel` on the topic its own latest publication used (observed from the log, not recomputed). */
async function retract(root: TempRoot, rel: string): Promise<void> {
  const publish = await requireExport<(dir: string, i: unknown) => unknown>(BUS, "publish");
  const last = (await busEvents(root)).filter((e) => e.path === rel && e.event === "artifact.published").at(-1)!;
  const ev = publish(path.join(root.cwd, ".guild", "runs", root.runId), {
    runId: root.runId, topic: last.topic, event: "artifact.retracted", artifactPath: rel,
    publisher: { host_id: "claude-code-cli", role: "task-cell-runtime" }, identity: { kind: "runtime", binding_ref: root.bindingRef }, now: () => FIXED_NOW,
  });
  expect(ev).not.toBeNull();
}

async function lastEventFor(root: TempRoot, rel: string) {
  return (await busEvents(root)).filter((e) => e.path === rel).at(-1)!;
}

describe("F1 controls · the latest matching publication holds (must stay green)", () => {
  it("C-F1-1 a plain accepted lifecycle joins acceptance, assignment and handoff", async () => {
    const { root, ids } = await lifecycle();
    const out = await joins(root, ids, ["acceptance", "assignment", "handoff"]);
    expect(out.map((j) => [j.kind, j.reason, j.cas_ok])).toEqual([["acceptance", null, true], ["assignment", null, true], ["handoff", null, true]]);
  });

  it("C-F1-2 a later re-publication of the same bytes on the canonical topic still holds", async () => {
    const { root, ids } = await lifecycle();
    const rel = (await joinOf(root, ids, "acceptance")).path!;
    await publishAs(root, ids, "acceptance", rel);
    expect(await joinOf(root, ids, "acceptance")).toMatchObject({ reason: null, cas_ok: true });
  });

  it("C-F1-3 a legitimate update (new bytes published on the canonical topic) holds for the new hash", async () => {
    const { root, ids } = await lifecycle();
    const rel = (await joinOf(root, ids, "acceptance")).path!;
    fs.appendFileSync(path.join(root.cwd, rel), "\n");
    await publishAs(root, ids, "acceptance", rel);
    const j = await joinOf(root, ids, "acceptance");
    expect({ reason: j.reason, sha: j.sha256 }).toEqual({ reason: null, sha: sha256(fs.readFileSync(path.join(root.cwd, rel))) });
  });

  it("C-F1-4 a conflicting publication superseded by a later matching re-publication holds", async () => {
    const { root, ids } = await lifecycle();
    const rel = (await joinOf(root, ids, "acceptance")).path!;
    await publishOtherBytes(root, ids, "acceptance", rel);
    await publishAs(root, ids, "acceptance", rel);
    expect(await joinOf(root, ids, "acceptance")).toMatchObject({ reason: null, cas_ok: true });
  });

  it("C-F1-5 a retraction followed by a matching re-publication holds", async () => {
    const { root, ids } = await lifecycle();
    const rel = (await joinOf(root, ids, "acceptance")).path!;
    await retract(root, rel);
    await publishAs(root, ids, "acceptance", rel);
    expect(await joinOf(root, ids, "acceptance")).toMatchObject({ reason: null, cas_ok: true });
  });

  it("C-F1-6 a retraction as the latest event refuses prerelease_bus_join_missing", async () => {
    const { root, ids } = await lifecycle();
    const rel = (await joinOf(root, ids, "acceptance")).path!;
    await retract(root, rel);
    expect((await lastEventFor(root, rel)).event).toBe("artifact.retracted");
    expect((await joinOf(root, ids, "acceptance")).reason).toBe("prerelease_bus_join_missing");
  });
});

describe("F1 reds · an earlier matching publication must not survive a later conflicting one", () => {
  const reds: Array<[string, string, (root: TempRoot, ids: Ids, rel: string) => Promise<void>]> = [
    ["R-F1-1 acceptance: later event with a different hash (file and CAS restored to the earlier bytes)", "acceptance",
      (root, ids, rel) => publishOtherBytes(root, ids, "acceptance", rel)],
    ["R-F1-2 acceptance: later event with the same hash on another kind's topic", "acceptance",
      (root, ids, rel) => publishAs(root, ids, "terminal", rel)],
    ["R-F1-3 acceptance: later event with the same hash on another instance's acceptance topic", "acceptance",
      (root, ids, rel) => publishAs(root, { ...ids, instance_id: `${ids.instance_id}-other` }, "acceptance", rel)],
    ["R-F1-4 acceptance: later event with both a different topic and a different hash", "acceptance",
      (root, ids, rel) => publishOtherBytes(root, ids, "terminal", rel)],
    ["R-F1-5 assignment: later event with a different hash", "assignment",
      (root, ids, rel) => publishOtherBytes(root, ids, "assignment", rel)],
    ["R-F1-6 handoff: later event with the same hash on another kind's topic", "handoff",
      (root, ids, rel) => publishAs(root, ids, "terminal", rel)],
  ];
  for (const [label, kind, conflict] of reds) {
    it(`${label} refuses prerelease_bus_join_missing`, async () => {
      const { root, ids } = await lifecycle();
      const before = await joinOf(root, ids, kind);
      expect(before.reason).toBeNull();
      const rel = before.path!;
      await conflict(root, ids, rel);
      // Preconditions: the file bytes are the earlier matching publication's, and the latest event is a
      // non-retraction publication that does not match them on topic or hash.
      const now = sha256(fs.readFileSync(path.join(root.cwd, rel)));
      const latest = await lastEventFor(root, rel);
      const earlier = (await busEvents(root)).filter((e) => e.path === rel && e.sha256 === now);
      expect({ file_unchanged: now === before.sha256, latest_kind: latest.event, latest_matches: latest.sha256 === now && latest.topic === earlier[0]?.topic })
        .toEqual({ file_unchanged: true, latest_kind: "artifact.published", latest_matches: false });
      expect(await joinOf(root, ids, kind)).toMatchObject({ kind, reason: "prerelease_bus_join_missing" });
    });
  }
});

// ── F2 · review evidence must stay in the request's canonical review directory ──

const BASIS_RUN = "run-e00-basis";
const REVIEWER = "basis-review";
const PACKET = "basis-pkt-1";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const CANONICAL = `.guild/runs/${BASIS_RUN}/review/${PACKET}`;

interface Basis {
  root: string;
  input: { root: string; proposalPath: string; decisionPath: string; requestPath: string };
  /** Physical directory holding the five evidence files. */
  evidenceAbs: string;
}

interface Place {
  /** The request.evidence_dir string (default: the canonical relative directory). */
  evidenceDir?: (root: string) => string;
  /** Prepare the filesystem before the evidence files are written (symlinked ancestors etc.). */
  prepare?: (root: string) => void;
  invocationId?: string;
}

/** A self-consistent basis whose five evidence files live at resolve(root, evidence_dir), every join recomputed there. */
function buildBasis(place: Place = {}): Basis {
  const root = ownedTempDir("guild-e00-sbr1-basis-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  const team = writeApprovedTeam(root, BASIS_RUN, [{ id: "B1", role: "backend" }], { reviewerId: REVIEWER, planRel: ".guild/plan/basis.json" });
  place.prepare?.(root);
  const evidenceDir = place.evidenceDir ? place.evidenceDir(root) : CANONICAL;
  const evidenceAbs = path.resolve(root, evidenceDir);
  const requestPath = `.guild/runs/${BASIS_RUN}/basis-request.json`;
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  const write = (abs: string, body: string) => {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return { path: path.relative(root, abs), sha256: sha256(fs.readFileSync(abs)) };
  };
  const request = {
    schema_version: "guild.source_basis_review_request.v1", request_id: "basis-req-1", packet_id: PACKET,
    reviewer_participant_id: REVIEWER, participation_kind: "reviewer_cross_host", role_ref: "security-auditor",
    proposal_sha256: team.proposal.proposal_hash, reviewed_commit: COMMIT, reviewed: { host_family: "anthropic" }, evidence_dir: evidenceDir,
  };
  const requestRef = write(path.join(root, requestPath), json(request));
  const candidateRef = write(path.join(evidenceAbs, "candidate.json"),
    json({ reviewer_participant_id: REVIEWER, reviewer_role: "security-auditor", packet_id: PACKET, reviewed_commit: COMMIT }));
  const packetRef = write(path.join(evidenceAbs, "packet.txt"), "source basis packet\n");
  const exit = {
    exit: 0, reviewer_family: "openai", author_family: "anthropic", independence: "cross_family", served_model: "fixture-model",
    started_at: "2026-10-26T12:00:00.000Z", finished_at: "2026-10-26T12:05:00.000Z",
  };
  const exitRef = write(path.join(evidenceAbs, "adapter-exit.json"), json(exit));
  const resultRef = write(path.join(evidenceAbs, "result.json"), json({
    schema_version: "review_result.v1", packet_id: PACKET, artifact_sha256_reviewed: candidateRef.sha256, verdict: "satisfied",
    blocking_findings: [], verification: ["fixture"], limits: ["mechanics only"],
  }));
  write(path.join(evidenceAbs, "invocation.json"), json({
    schema_version: "guild.review_invocation.v1", invocation_id: place.invocationId ?? "basis-inv-1", packet_id: PACKET, request_id: "basis-req-1",
    reviewer_participant_id: REVIEWER, participation_kind: "reviewer_cross_host", role_ref: "security-auditor",
    requested_model: "fixture-model", ...exit,
    request: requestRef, candidate: candidateRef, packet: packetRef, result: resultRef, adapter_exit: exitRef,
  }));
  const t = new Date("2026-10-26T12:06:00.000Z");
  fs.utimesSync(path.join(evidenceAbs, "result.json"), t, t);
  return {
    root, evidenceAbs,
    input: { root, proposalPath: path.relative(root, team.proposalPath), decisionPath: path.relative(root, team.decisionPath), requestPath },
  };
}

/** Another packet's consumed invocation record at `dir` (reuse probe). */
function consumedInvocation(dir: string, invocationId: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "invocation.json"), JSON.stringify({ invocation_id: invocationId, packet_id: path.basename(dir) }));
}

type Verdict = { ok: boolean; reason?: string; pins?: Record<string, any> };

async function verifyBasis(b: Basis, input: unknown = b.input): Promise<Verdict> {
  const fn = await requireExport<(i: unknown) => Verdict>(CONTROLLER, "verifySourceBasisReview");
  return fn({ basis: input, expectedCommit: COMMIT, operatorUid: UID });
}

/** Physical location of the evidence relative to the real basis root (".." prefix = outside). */
function physicalRel(b: Basis): string {
  return path.relative(fs.realpathSync(b.root), fs.realpathSync(b.evidenceAbs));
}

describe("F2 controls · canonical, physically contained evidence (must stay green)", () => {
  it("C-F2-1 canonical evidence_dir verifies and pins the canonical evidence paths", async () => {
    const b = buildBasis();
    const v = await verifyBasis(b);
    expect(v.ok).toBe(true);
    expect(v.pins!.result.path).toBe(path.join(CANONICAL, "result.json"));
    expect(physicalRel(b)).toBe(CANONICAL);
  });

  it("C-F2-2 the basis root named through a symlink alias still verifies (root is realpath'd, evidence contained)", async () => {
    const b = buildBasis();
    const alias = path.join(ownedTempDir("guild-e00-sbr1-alias-"), "root-alias");
    fs.symlinkSync(b.root, alias);
    expect((await verifyBasis(b, { ...b.input, root: alias })).ok).toBe(true);
  });

  it("C-F2-3 other packets in the canonical run with distinct invocation ids do not block a canonical review", async () => {
    const b = buildBasis();
    consumedInvocation(path.join(b.root, ".guild", "runs", BASIS_RUN, "review", "other-pkt"), "other-inv");
    expect((await verifyBasis(b)).ok).toBe(true);
  });

  it("C-F2-4 a canonical review reusing another canonical packet's invocation id refuses basis_unreviewed", async () => {
    const b = buildBasis();
    consumedInvocation(path.join(b.root, ".guild", "runs", BASIS_RUN, "review", "other-pkt"), "basis-inv-1");
    expect(await verifyBasis(b)).toMatchObject({ ok: false, reason: "basis_unreviewed" });
  });

  it("C-F2-5 outside evidence reusing a canonical packet's invocation id refuses basis_unreviewed", async () => {
    const outside = ownedTempDir("guild-e00-sbr1-out-");
    const b = buildBasis({
      evidenceDir: () => path.join(outside, PACKET),
      prepare: (root) => consumedInvocation(path.join(root, ".guild", "runs", BASIS_RUN, "review", "other-pkt"), "basis-inv-1"),
    });
    expect(await verifyBasis(b)).toMatchObject({ ok: false, reason: "basis_unreviewed" });
  });
});

describe("F2 reds · evidence outside the canonical review directory must not grant authority", () => {
  const reds: Array<[string, Place, (b: Basis) => void]> = [
    ["R-F2-1 absolute evidence_dir in an outside owned directory", (() => {
      const holder: { dir?: string } = {};
      return { evidenceDir: () => (holder.dir ??= path.join(ownedTempDir("guild-e00-sbr1-out-"), PACKET)) };
    })(), (b) => expect(physicalRel(b).startsWith("..")).toBe(true)],
    ["R-F2-2 relative evidence_dir that traverses out of the basis root", {
      evidenceDir: (root) => path.relative(root, path.join(ownedTempDir("guild-e00-sbr1-out-"), PACKET)),
    }, (b) => expect(physicalRel(b).startsWith("..")).toBe(true)],
    ["R-F2-3 contained but non-canonical directory in the same run", {
      evidenceDir: () => `.guild/runs/${BASIS_RUN}/not-review/${PACKET}`,
    }, (b) => expect(physicalRel(b)).toBe(`.guild/runs/${BASIS_RUN}/not-review/${PACKET}`)],
    ["R-F2-4 canonical-shaped directory in ANOTHER run, whose sibling packet already consumed this invocation id", {
      evidenceDir: () => `.guild/runs/run-e00-other/review/${PACKET}`,
      prepare: (root) => consumedInvocation(path.join(root, ".guild", "runs", "run-e00-other", "review", "consumed-pkt"), "basis-inv-1"),
    }, (b) => expect(physicalRel(b)).toBe(`.guild/runs/run-e00-other/review/${PACKET}`)],
    ["R-F2-5 outside directory whose sibling packet already consumed this invocation id", (() => {
      const holder: { dir?: string } = {};
      return {
        evidenceDir: () => {
          if (!holder.dir) {
            holder.dir = ownedTempDir("guild-e00-sbr1-out-");
            consumedInvocation(path.join(holder.dir, "consumed-pkt"), "basis-inv-1");
          }
          return path.join(holder.dir, PACKET);
        },
      };
    })(), (b) => expect(fs.existsSync(path.join(path.dirname(b.evidenceAbs), "consumed-pkt", "invocation.json"))).toBe(true)],
    ["R-F2-6 canonical evidence_dir string whose review ancestor is a symlink to an outside directory", {
      prepare: (root) => {
        const outside = ownedTempDir("guild-e00-sbr1-out-");
        fs.mkdirSync(path.join(root, ".guild", "runs", BASIS_RUN), { recursive: true });
        fs.symlinkSync(outside, path.join(root, ".guild", "runs", BASIS_RUN, "review"));
      },
    }, (b) => {
      expect(fs.lstatSync(path.join(b.root, ".guild", "runs", BASIS_RUN, "review")).isSymbolicLink()).toBe(true);
      expect(physicalRel(b).startsWith("..")).toBe(true);
    }],
    ["R-F2-7 canonical evidence_dir string whose packet directory is a symlink to an outside directory", {
      prepare: (root) => {
        const outside = ownedTempDir("guild-e00-sbr1-out-");
        fs.mkdirSync(path.join(root, ".guild", "runs", BASIS_RUN, "review"), { recursive: true });
        fs.symlinkSync(outside, path.join(root, CANONICAL));
      },
    }, (b) => {
      expect(fs.lstatSync(path.join(b.root, CANONICAL)).isSymbolicLink()).toBe(true);
      expect(physicalRel(b).startsWith("..")).toBe(true);
    }],
  ];
  for (const [label, place, precondition] of reds) {
    it(`${label} refuses basis_unreviewed`, async () => {
      const b = buildBasis(place);
      precondition(b);
      expect(await verifyBasis(b)).toMatchObject({ ok: false, reason: "basis_unreviewed" });
    });
  }
});

// ── F2 · the same shared verifier on the TaskCell reviewer_cell path ─────────

const TC_RUN = "run-e00-broker";
const TC_PACKET = `${TC_RUN}-T1-a1-review`;
const TC_CANONICAL = `.guild/runs/${TC_RUN}/review/${TC_PACKET}`;

async function taskCellProposal() {
  const { composeProposal } = await import("../../src/domains/teams");
  const participants = [
    { participant_id: "t1", participation_kind: "worker", role_ref: "backend", necessity_rationale: "owns T1", owned_obligations: ["ob-t1"], depends_on: [], tier: "mid", purpose: "implementation", capability_scope: null, backend: "team" },
    { participant_id: "e00-review", participation_kind: "reviewer_cross_host", role_ref: "security-auditor", necessity_rationale: "cross-family review of T1", owned_obligations: ["ob-review"], depends_on: ["t1"], tier: "powerful", purpose: "adversarial-security", capability_scope: null, backend: "team" },
  ];
  return composeProposal({
    run_id: TC_RUN, phase: "build", participants,
    obligations: participants.map((p) => ({ obligation_id: p.owned_obligations[0], source: "plan_item", text: `work owned by ${p.participant_id}`, disposition: { owners: [p.participant_id] } })),
    excluded_roles: [],
  } as never) as { proposal_hash: string };
}

/** A fully joined TaskCell review whose evidence files live at resolve(root, evidence_dir). */
async function taskCellReview(place: Place = {}) {
  const root = ownedTempDir("guild-e00-sbr1-tc-");
  place.prepare?.(root);
  const evidenceDir = place.evidenceDir ? place.evidenceDir(root) : TC_CANONICAL;
  const dir = path.resolve(root, evidenceDir);
  fs.mkdirSync(dir, { recursive: true });
  const proposal = await taskCellProposal();
  const receipt = Buffer.from("retained receipt bytes\n");
  const receiptRel = `.guild/runs/${TC_RUN}/task-cells/T1/attempts/1/instances/T1.a1.i1/receipt.md`;
  fs.mkdirSync(path.dirname(path.join(root, receiptRel)), { recursive: true });
  fs.writeFileSync(path.join(root, receiptRel), receipt);
  const retained = { path: receiptRel, sha256: sha256(receipt) };
  const request = {
    schema_version: "guild.task_cell_review_request.v1", request_id: "req-1", packet_id: TC_PACKET,
    reviewer_participant_id: "e00-review", participation_kind: "reviewer_cross_host", role_ref: "security-auditor",
    proposal_sha256: proposal.proposal_hash, retained_receipt: retained,
    reviewed: { cell_id: "cell-T1", logical_task_id: "T1", instance_id: "T1.a1.i1", worker_role: "backend", host_family: "anthropic" },
    evidence_dir: evidenceDir,
  };
  const requestAbs = path.join(root, `.guild/runs/${TC_RUN}/review-requests/${TC_PACKET}.json`);
  fs.mkdirSync(path.dirname(requestAbs), { recursive: true });
  const candidate = Buffer.from(JSON.stringify({ packet_id: TC_PACKET, reviewer_participant_id: "e00-review", reviewer_role: "security-auditor", retained_receipt: retained }));
  const exit = { exit: 0, reviewer_family: "openai", author_family: "anthropic", independence: "cross_family", served_model: "m-served", started_at: "2026-10-26T13:00:00.000Z", finished_at: "2026-10-26T13:05:00.000Z" };
  const files: Record<string, Buffer> = {
    "candidate.json": candidate,
    "packet.txt": Buffer.from("review packet\n"),
    "result.json": Buffer.from(JSON.stringify({ schema_version: "review_result.v1", packet_id: TC_PACKET, artifact_sha256_reviewed: sha256(candidate), verdict: "satisfied", blocking_findings: [], verification: ["reviewed T1"], limits: ["fixture"] })),
    "adapter-exit.json": Buffer.from(JSON.stringify(exit)),
  };
  const requestBytes = Buffer.from(JSON.stringify(request));
  fs.writeFileSync(requestAbs, requestBytes);
  const ref = (n: string) => ({ path: path.relative(root, path.join(dir, n)), sha256: sha256(files[n]) });
  files["invocation.json"] = Buffer.from(JSON.stringify({
    schema_version: "guild.review_invocation.v1", invocation_id: "inv-1", packet_id: TC_PACKET, request_id: "req-1",
    reviewer_participant_id: "e00-review", participation_kind: "reviewer_cross_host", role_ref: "security-auditor",
    request: { path: path.relative(root, requestAbs), sha256: sha256(requestBytes) },
    candidate: ref("candidate.json"), packet: ref("packet.txt"), result: ref("result.json"), adapter_exit: ref("adapter-exit.json"),
    requested_model: "m-requested", ...exit,
  }));
  for (const [n, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), bytes);
  const t = new Date("2026-10-26T13:06:00.000Z");
  fs.utimesSync(path.join(dir, "result.json"), t, t);
  const derive = await requireExport<(o: unknown) => Record<string, any>>(DISPATCH, "deriveReviewerCellAuthority");
  return {
    root, dir,
    derive: () => derive({ cwd: root, requestPath: requestAbs, proposal, reviewedHostFamily: "anthropic", operatorUid: UID, knownInvocationIds: [] }),
  };
}

describe("F2 TaskCell reviewer_cell · shared verifier containment", () => {
  it("C-F2-T1 control: canonical TaskCell evidence derives accepted", async () => {
    const r = await taskCellReview();
    expect(r.derive()).toMatchObject({ decision: "accepted", reason: null });
  });

  it("R-F2-T1 absolute evidence_dir in an outside owned directory is review_refused", async () => {
    const outside = ownedTempDir("guild-e00-sbr1-out-");
    const r = await taskCellReview({ evidenceDir: () => path.join(outside, TC_PACKET) });
    expect(path.relative(r.root, r.dir).startsWith("..")).toBe(true);
    expect(r.derive().decision).toBe("review_refused");
  });

  it("R-F2-T2 canonical evidence_dir string whose review ancestor is a symlink to an outside directory is review_refused", async () => {
    const r = await taskCellReview({
      prepare: (root) => {
        const outside = ownedTempDir("guild-e00-sbr1-out-");
        fs.mkdirSync(path.join(root, ".guild", "runs", TC_RUN), { recursive: true });
        fs.symlinkSync(outside, path.join(root, ".guild", "runs", TC_RUN, "review"));
      },
    });
    expect(path.relative(r.root, fs.realpathSync(r.dir)).startsWith("..")).toBe(true);
    expect(r.derive().decision).toBe("review_refused");
  });
});

// ═══ Supplement r2 (source-basis-r1-pre-fix-decisions.json; appended, the 27 cases above are unchanged) ═══
//
// F1 shared paths. team_plan is phase-scoped (every instance of the phase republishes the station
// composer's plan under its own task-cell topic, as the controller does through publishTaskCellFile)
// and context is task-scoped (a retry attempt republishes it). Legitimate shared publication of the
// SAME bytes must keep holding; a stale publication superseded on the path by another hash, or on its
// own topic by another hash or a retraction, must refuse. The retry republication is made through the
// canonical publishTaskCellFile helper with attempt-2 coordinates (mechanics, no second attempt driven).
//
// F2 authority root. The source-basis proposal, decision and request are read through readRootFile;
// a symlinked ancestor that leaves the basis root must refuse like the evidence directory, while the
// same relocation through a real in-root directory, a whole-root alias, and the existing awaiting
// outcomes for missing evidence stay as they are.

async function sharedPhase() {
  const root = tempRoot("guild-e00-sbr1-shared-");
  const rt = makeRuntime(root);
  const ids: Ids[] = [];
  for (const id of ["T1", "T2"]) {
    const d = await driveLane(root, rt, { logicalTaskId: id, role: "backend" });
    expect((await acceptLane(rt, d.instance)).ok).toBe(true);
    expect((await rt.runtime.terminate(d.instance)).ok).toBe(true);
    ids.push({ run_id: root.runId, logical_task_id: id, attempt: 1, instance_id: d.instance.instance_id });
  }
  const teams = await import("../../src/domains/teams");
  const plan = teams.composeStationTeam("build", {}, { tierIndex: {} });
  const writePlan = () => path.relative(root.cwd, teams.writeTeamPlan(root.cwd, root.runId, plan, { now: () => FIXED_NOW }));
  const planRel = writePlan();
  for (const i of ids) await publishAs(root, i, "team_plan", planRel);
  const [j1, j2] = [await joinOf(root, ids[0], "team_plan"), await joinOf(root, ids[1], "team_plan")];
  // Preconditions: both instances resolve the one phase-scoped plan path, and both join today.
  expect({ p1: j1.path, p2: j2.path, r1: j1.reason, r2: j2.reason }).toEqual({ p1: planRel, p2: planRel, r1: null, r2: null });
  return { root, ids, planRel, writePlan };
}

/** The topic a publication on `rel` used, observed from the log (needle: an instance id or "station/"). */
async function observedTopic(root: TempRoot, rel: string, needle: string): Promise<string> {
  const e = (await busEvents(root)).filter((x) => x.path === rel && x.event === "artifact.published" && String(x.topic).includes(needle)).at(-1);
  expect(e).toBeDefined();
  return e!.topic;
}

/** Append an event on `rel` under an observed topic through the canonical bus publish (same publisher shape as the runtime). */
async function publishOnTopic(root: TempRoot, rel: string, topicName: string, event: "artifact.published" | "artifact.retracted", role = "task-cell-runtime") {
  const publish = await requireExport<(dir: string, i: unknown) => unknown>(BUS, "publish");
  const ev = publish(path.join(root.cwd, ".guild", "runs", root.runId), {
    runId: root.runId, topic: topicName, event, artifactPath: rel,
    ...(event === "artifact.published" ? { content: fs.readFileSync(path.join(root.cwd, rel)) } : {}),
    publisher: { host_id: "claude-code-cli", role }, identity: { kind: "runtime", binding_ref: root.bindingRef }, now: () => FIXED_NOW,
  });
  expect(ev).not.toBeNull();
}

/** Run `act` with other bytes in `rel`, then restore the original bytes (the earlier publication stays current on disk). */
async function withOtherBytes(root: TempRoot, rel: string, act: () => Promise<void>) {
  const abs = path.join(root.cwd, rel);
  const original = fs.readFileSync(abs);
  fs.writeFileSync(abs, Buffer.concat([original, Buffer.from("\n")]));
  await act();
  fs.writeFileSync(abs, original);
  return sha256(original);
}

const retryIds = (i: Ids): Ids => ({ ...i, attempt: 2, instance_id: `${i.instance_id}-retry` });

describe("F1 r2 controls · legitimate shared publication of the same bytes (must stay green)", () => {
  it("C-F1-S1 two instances of one phase share the team_plan path and both join", async () => {
    const { root, ids, planRel } = await sharedPhase();
    const own = await Promise.all(ids.map((i) => observedTopic(root, planRel, i.instance_id)));
    expect(own[0] === own[1]).toBe(false);
    expect((await joins(root, ids[0], ["team_plan"]))[0].reason).toBeNull();
    expect((await joins(root, ids[1], ["team_plan"]))[0].reason).toBeNull();
  });

  it("C-F1-S2 a station-composer republish of the same plan bytes after both instances keeps both joins", async () => {
    const { root, ids, planRel, writePlan } = await sharedPhase();
    const before = sha256(fs.readFileSync(path.join(root.cwd, planRel)));
    writePlan();
    const latest = await lastEventFor(root, planRel);
    expect({ same_bytes: sha256(fs.readFileSync(path.join(root.cwd, planRel))) === before, station: String(latest.topic).includes("/station/"), sha: latest.sha256 === before })
      .toEqual({ same_bytes: true, station: true, sha: true });
    expect([(await joinOf(root, ids[0], "team_plan")).reason, (await joinOf(root, ids[1], "team_plan")).reason]).toEqual([null, null]);
  });

  it("C-F1-S3 a retry attempt republishing the same context bytes keeps the first attempt's context join", async () => {
    const { root, ids } = await lifecycle();
    const before = await joinOf(root, ids, "context");
    expect(before.reason).toBeNull();
    await publishAs(root, retryIds(ids), "context", before.path!);
    expect(String((await lastEventFor(root, before.path!)).topic)).toContain(retryIds(ids).instance_id);
    expect(await joinOf(root, ids, "context")).toMatchObject({ reason: null, sha256: before.sha256 });
  });

  it("C-F1-S4 a retraction as the latest event on the shared plan path refuses both instances", async () => {
    const { root, ids, planRel } = await sharedPhase();
    await publishOnTopic(root, planRel, await observedTopic(root, planRel, "station/"), "artifact.retracted", "station-composer");
    expect([(await joinOf(root, ids[0], "team_plan")).reason, (await joinOf(root, ids[1], "team_plan")).reason])
      .toEqual(["prerelease_bus_join_missing", "prerelease_bus_join_missing"]);
  });
});

describe("F1 r2 reds · stale shared publications must refuse", () => {
  it("R-F1-S1 team_plan: a later different-hash publication by the other instance refuses both instances", async () => {
    const { root, ids, planRel } = await sharedPhase();
    const kept = await withOtherBytes(root, planRel, () => publishAs(root, ids[1], "team_plan", planRel));
    expect({ file: sha256(fs.readFileSync(path.join(root.cwd, planRel))) === kept, latest_differs: (await lastEventFor(root, planRel)).sha256 !== kept })
      .toEqual({ file: true, latest_differs: true });
    expect([(await joinOf(root, ids[0], "team_plan")).reason, (await joinOf(root, ids[1], "team_plan")).reason])
      .toEqual(["prerelease_bus_join_missing", "prerelease_bus_join_missing"]);
  });

  it("R-F1-S2 team_plan: a later different-hash station-composer publication refuses the instance join", async () => {
    const { root, ids, planRel } = await sharedPhase();
    const station = await observedTopic(root, planRel, "station/");
    const kept = await withOtherBytes(root, planRel, () => publishOnTopic(root, planRel, station, "artifact.published", "station-composer"));
    const latest = await lastEventFor(root, planRel);
    expect({ station: latest.topic === station, latest_differs: latest.sha256 !== kept }).toEqual({ station: true, latest_differs: true });
    expect((await joinOf(root, ids[0], "team_plan")).reason).toBe("prerelease_bus_join_missing");
  });

  it("R-F1-S3 team_plan: own topic superseded by another hash refuses even after the other instance republishes the current bytes", async () => {
    const { root, ids, planRel } = await sharedPhase();
    const kept = await withOtherBytes(root, planRel, () => publishAs(root, ids[0], "team_plan", planRel));
    await publishAs(root, ids[1], "team_plan", planRel);
    const own = (await busEvents(root)).filter((e) => e.path === planRel && String(e.topic).includes(ids[0].instance_id)).at(-1)!;
    expect({ path_latest_current: (await lastEventFor(root, planRel)).sha256 === kept, own_latest_stale: own.sha256 !== kept }).toEqual({ path_latest_current: true, own_latest_stale: true });
    expect((await joinOf(root, ids[1], "team_plan")).reason).toBeNull();
    expect((await joinOf(root, ids[0], "team_plan")).reason).toBe("prerelease_bus_join_missing");
  });

  it("R-F1-S4 team_plan: own topic retracted refuses even after the other instance republishes the current bytes", async () => {
    const { root, ids, planRel } = await sharedPhase();
    await publishOnTopic(root, planRel, await observedTopic(root, planRel, ids[0].instance_id), "artifact.retracted");
    await publishAs(root, ids[1], "team_plan", planRel);
    const own = (await busEvents(root)).filter((e) => e.path === planRel && String(e.topic).includes(ids[0].instance_id)).at(-1)!;
    expect({ own_latest: own.event, path_latest: (await lastEventFor(root, planRel)).event }).toEqual({ own_latest: "artifact.retracted", path_latest: "artifact.published" });
    expect((await joinOf(root, ids[1], "team_plan")).reason).toBeNull();
    expect((await joinOf(root, ids[0], "team_plan")).reason).toBe("prerelease_bus_join_missing");
  });

  it("R-F1-S5 context: a retry republishing a different hash refuses the first attempt's context join", async () => {
    const { root, ids } = await lifecycle();
    const rel = (await joinOf(root, ids, "context")).path!;
    const kept = await withOtherBytes(root, rel, () => publishAs(root, retryIds(ids), "context", rel));
    expect((await lastEventFor(root, rel)).sha256 === kept).toBe(false);
    expect((await joinOf(root, ids, "context")).reason).toBe("prerelease_bus_join_missing");
  });

  it("R-F1-S6 context: own topic superseded by another hash refuses even after the retry republishes the current bytes", async () => {
    const { root, ids } = await lifecycle();
    const rel = (await joinOf(root, ids, "context")).path!;
    const kept = await withOtherBytes(root, rel, () => publishAs(root, ids, "context", rel));
    await publishAs(root, retryIds(ids), "context", rel);
    expect((await lastEventFor(root, rel)).sha256 === kept).toBe(true);
    expect((await joinOf(root, ids, "context")).reason).toBe("prerelease_bus_join_missing");
  });
});

type DescriptorKey = "proposalPath" | "decisionPath" | "requestPath";

/**
 * Move one descriptor file of a canonical basis into `.guild/relocated-<key>/`, either a real in-root
 * directory or a symlink to an owned outside directory. A relocated request is re-pinned in invocation.json
 * (only its path changes; result.json stays older than invocation.json), so every other join holds.
 */
function relocate(b: Basis, key: DescriptorKey, viaOutsideLink: boolean): Basis {
  const dirRel = `.guild/relocated-${key}`;
  if (viaOutsideLink) fs.symlinkSync(ownedTempDir("guild-e00-sbr1-out-"), path.join(b.root, dirRel));
  else fs.mkdirSync(path.join(b.root, dirRel));
  const from = b.input[key];
  const to = `${dirRel}/${path.basename(from)}`;
  fs.writeFileSync(path.join(b.root, to), fs.readFileSync(path.join(b.root, from)));
  fs.rmSync(path.join(b.root, from));
  if (key === "requestPath") {
    const invAbs = path.join(b.root, CANONICAL, "invocation.json");
    const inv = JSON.parse(fs.readFileSync(invAbs, "utf8"));
    inv.request = { path: to, sha256: sha256(fs.readFileSync(path.join(b.root, to))) };
    fs.writeFileSync(invAbs, JSON.stringify(inv, null, 2) + "\n");
  }
  return { ...b, input: { ...b.input, [key]: to } };
}

const DESCRIPTOR_KEYS: DescriptorKey[] = ["proposalPath", "decisionPath", "requestPath"];

describe("F2 r2 controls · same authority root, real directories and existing awaiting outcomes (must stay green)", () => {
  for (const key of DESCRIPTOR_KEYS) {
    it(`C-F2-R-${key} relocated through a real in-root directory still verifies`, async () => {
      const b = relocate(buildBasis(), key, false);
      expect(fs.lstatSync(path.join(b.root, path.dirname(b.input[key]))).isSymbolicLink()).toBe(false);
      expect((await verifyBasis(b)).ok).toBe(true);
    });
  }

  it("C-F2-R-alias all three relocated through real directories and named through a whole-root alias still verify", async () => {
    let b = buildBasis();
    for (const key of DESCRIPTOR_KEYS) b = relocate(b, key, false);
    const alias = path.join(ownedTempDir("guild-e00-sbr1-alias-"), "root-alias");
    fs.symlinkSync(b.root, alias);
    expect((await verifyBasis(b, { ...b.input, root: alias })).ok).toBe(true);
  });

  it("C-F2-A1 basis evidence without invocation.json stays basis_unreviewed through the awaiting outcome", async () => {
    const b = buildBasis();
    fs.rmSync(path.join(b.root, CANONICAL, "invocation.json"));
    const v = await verifyBasis(b) as Verdict & { detail?: string };
    expect({ ok: v.ok, reason: v.reason, awaiting: String(v.detail).includes("awaiting") }).toEqual({ ok: false, reason: "basis_unreviewed", awaiting: true });
  });

  it("C-F2-A2 TaskCell evidence without invocation.json is awaiting review_invocation_absent", async () => {
    const r = await taskCellReview();
    fs.rmSync(path.join(r.dir, "invocation.json"));
    expect(r.derive()).toMatchObject({ decision: "awaiting", reason: "review_invocation_absent" });
  });

  it("C-F2-A3 TaskCell evidence without result.json is awaiting review_evidence_absent:result.json", async () => {
    const r = await taskCellReview();
    fs.rmSync(path.join(r.dir, "result.json"));
    expect(r.derive()).toMatchObject({ decision: "awaiting", reason: "review_evidence_absent:result.json" });
  });
});

describe("F2 r2 reds · readRootFile must not follow a symlinked ancestor out of the basis root", () => {
  for (const key of DESCRIPTOR_KEYS) {
    it(`R-F2-R-${key} relocated under a symlinked ancestor that leaves the basis root refuses basis_unreviewed`, async () => {
      const b = relocate(buildBasis(), key, true);
      const real = fs.realpathSync(b.root);
      expect({
        link: fs.lstatSync(path.join(b.root, path.dirname(b.input[key]))).isSymbolicLink(),
        outside: path.relative(real, fs.realpathSync(path.join(b.root, b.input[key]))).startsWith(".."),
        lexically_inside: !path.relative(b.root, path.resolve(b.root, b.input[key])).startsWith(".."),
      }).toEqual({ link: true, outside: true, lexically_inside: true });
      expect(await verifyBasis(b)).toMatchObject({ ok: false, reason: "basis_unreviewed" });
    });
  }
});

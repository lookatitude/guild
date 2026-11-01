/**
 * E00-T0 · TC tier — executable installed-package cases (authored at T0,
 * EXECUTED by E00-Q). Gate: E00_TC_PACKAGE_ROOT=<absolute installed package
 * root built from root's reviewed clean basis (CD22)>. Without it every case is
 * reported "not executed" (bun skip); nothing here is claimed as run. With the
 * gate open, a missing root/Q-supplied input FAILS its cases (never skips).
 *
 * Inputs supplied by root / E00-Q (never fabricated here):
 *   E00_TC_PACKAGE_ROOT    installed package (gate)
 *   E00_TC_REVIEWED_BASIS  absolute path to the GENUINE guild.source_basis_descriptor.v1
 *                          {root, proposal_path, decision_path, request_path} of the
 *                          satisfied source-basis review whose reviewed_commit is the
 *                          package source_commit (F2, C-R1 r1-interface.json)
 *   E00_TC_BROKER_COMMAND  executable for root's GENUINE broker path:
 *                          `<cmd> --request <abs review request> --out <abs dir>` writes
 *                          candidate.json, packet.txt, result.json, adapter-exit.json and
 *                          invocation.json (F4); TC qualification never uses fake evidence
 *   E00_TC_NODE            optional node binary (default `node`)
 *
 * Mechanism (no production test mode): the packaged task-cell-controller's
 * unchanged `command claude` pane launch resolves to tc/fixture-worker.mjs via a
 * PATH shim. Team authority comes from the existing proposal/decision contracts
 * (tc-fixture.ts, F1). Faults are file-mode changes in this test's own temp root
 * at deterministic synchronization points (F5): the team_lead `decide` for
 * pre-release mode faults, the test-owned tmux shim's kill-pane barrier for the
 * post-final terminal fault, and tc/fs-fault-preload.cjs (loaded only into that
 * case's controller `start` child) for the failed-original-append / reconciled
 * publish / failed-sidecar sequence. Each root gets its own isolated tmux server via
 * tc/tmux-shim.ts; teardown closes and confirms it, and signals only verified
 * owned children (F8).
 *
 * CLI (C declared, evidence/e00-c/r1-interface.json cli; every subcommand takes an
 * absolute --root and never uses the cwd; no flag has a success default):
 *   start --root --run --phase --worker-trust-policy --lanes --team-plan --proposal
 *         [--package-root <abs> --reviewed-basis <abs guild.source_basis_descriptor.v1>]
 *   status --root --run --consumer-policy [--consumer-context same_run|release:<abs file>]
 *   record-loss --root --run; approve-oracles --root --run --phase --decided-by
 *   decide --root --run --instance --lead-binding-id --decision accepted|rejected
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { readVerifiedReleasePackageIdentity } from "../../../src/domains/distribution";
import { FULL_RUNGS, ownChild, ownedTempDir, sha256, teardownOwned } from "../support/e00-harness";
import { TC_LEAD, buildTcRoot, copyDurableTree, type TcLane, type TcRoot } from "./tc-fixture";
import { installTmuxShim, type TmuxShim } from "./tmux-shim";

afterEach(teardownOwned);

const PKG = process.env["E00_TC_PACKAGE_ROOT"] ?? "";
const enabled = PKG.length > 0 && path.isAbsolute(PKG) && fs.existsSync(PKG);
const NODE = process.env["E00_TC_NODE"] ?? "node";
const SOURCE_CONTROLLER = path.resolve(__dirname, "..", "..", "..", "scripts", "task-cell-controller.ts");
const FAULT_PRELOAD = path.join(__dirname, "fs-fault-preload.cjs");
const T = 300_000;

const script = (pkg: string, id: string) => path.join(pkg, "runtime", "scripts", `${id}.js`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requireInput(name: "E00_TC_REVIEWED_BASIS" | "E00_TC_BROKER_COMMAND"): string {
  const v = process.env[name] ?? "";
  if (!path.isAbsolute(v) || !fs.existsSync(v)) throw new Error(`TC input ${name} not supplied by root/Q (absolute existing path required)`);
  return v;
}

interface Tc extends TcRoot { env: Record<string, string>; pkg: string; tmux: TmuxShim }

function hermetic(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GUILD_") && !k.startsWith("E00_") && k !== "TMUX" && k !== "TMUX_PANE" && v !== undefined) env[k] = v;
  return env;
}

function tc(lanes: TcLane[], opts: { mode?: string; approve?: boolean; pkg?: string } = {}): Tc {
  const pkg = opts.pkg ?? PKG;
  const base = buildTcRoot(lanes, { mode: opts.mode, ackCli: script(pkg, "task-cell-ack"), node: NODE });
  const tmux = installTmuxShim(base.root, base.bin);
  // CD21: the controller may hold the binding in its own spawn env; F3 asserts it never reaches the worker.
  const env = { ...hermetic(), PATH: `${base.bin}:${process.env["PATH"]}`, GUILD_RUN_ID: base.runId, GUILD_RUN_BINDING_REF: base.bindingRef };
  const t: Tc = { ...base, env, pkg, tmux };
  if (opts.approve !== false) expect(cli(t, ["approve-oracles", "--run", t.runId, "--phase", "build", "--decided-by", "tc-operator"]).status).toBe(0);
  return t;
}

/** Insert the declared absolute --root right after the subcommand (the cwd is never the root). */
const withRoot = (args: string[], root: string) => [args[0], "--root", root, ...args.slice(1)];

function cli(t: Tc, args: string[], root = t.root) {
  const r = spawnSync(NODE, [script(t.pkg, "task-cell-controller"), ...withRoot(args, root)], { cwd: root, env: t.env, encoding: "utf8", timeout: 120000 });
  return { status: r.status, stdout: r.stdout ?? "", out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function status(t: Tc, policy = "cooperative_local", context?: string, root = t.root): Record<string, any> {
  const r = cli(t, ["status", "--run", t.runId, "--consumer-policy", policy, ...(context ? ["--consumer-context", context] : [])], root);
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

/**
 * Declared `start` arguments (without --root). Installed runs pass --package-root
 * and the genuine basis descriptor; `pkg: null` / `basis: null` omit them explicitly.
 */
interface StartOpts { policy?: string; pkg?: string | null; basis?: string | null }
function startArgs(t: Tc, o: StartOpts = {}): string[] {
  const pkg = o.pkg === undefined ? t.pkg : o.pkg;
  const basis = o.basis === undefined ? requireInput("E00_TC_REVIEWED_BASIS") : o.basis;
  return [
    "start", "--run", t.runId, "--phase", "build", "--worker-trust-policy", o.policy ?? "cooperative_local",
    "--lanes", t.lanesPath, "--team-plan", t.teamPlanPath, "--proposal", t.proposalPath,
    ...(pkg ? ["--package-root", pkg] : []), ...(basis ? ["--reviewed-basis", basis] : []),
  ];
}

function startAsync(t: Tc, o: StartOpts = {}, controller = script(t.pkg, "task-cell-controller"), runner = NODE, extraEnv: Record<string, string> = {}): ChildProcess {
  return ownChild(spawn(runner, [controller, ...withRoot(startArgs(t, o), t.root)], { cwd: t.root, env: { ...t.env, ...extraEnv }, stdio: "ignore" }), t.root);
}

function decideAwaiting(t: Tc, s: Record<string, any>, before?: (inst: Record<string, any>) => void): void {
  for (const inst of s.instances ?? []) {
    if (inst.awaiting !== "team_lead") continue;
    before?.(inst);
    cli(t, ["decide", "--run", t.runId, "--instance", inst.instance_id, "--lead-binding-id", TC_LEAD, "--decision", "accepted"]);
  }
}

/** Drive until the controller exits or `done(status)` holds; answers team_lead awaits through `decide`. */
async function drive(t: Tc, child: ChildProcess, o: { limitMs?: number; done?: (s: Record<string, any>) => boolean; beforeDecide?: (inst: Record<string, any>) => void } = {}) {
  let exited = false;
  child.on("exit", () => { exited = true; });
  const until = Date.now() + (o.limitMs ?? 240_000);
  let s: Record<string, any> = {};
  while (Date.now() < until && !exited) {
    await sleep(1000);
    s = status(t);
    decideAwaiting(t, s, o.beforeDecide);
    if (o.done?.(s)) break;
  }
  if (!exited) child.kill("SIGTERM");
  return status(t);
}

async function waitFor(file: () => string | null, limitMs = 120_000, stepMs = 20): Promise<string> {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    const f = file();
    if (f && fs.existsSync(f)) return f;
    await sleep(stepMs);
  }
  throw new Error("TC: waited for a file that never appeared");
}

function firstFileIn(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const first = fs.readdirSync(dir).sort()[0];
  return first === undefined ? null : path.join(dir, first);
}

function findFile(dir: string, name: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { recursive: true }) as string[]) if (path.basename(e) === name) return path.join(dir, e);
  return null;
}

function allFiles(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[]).map((e) => path.join(dir, e)).filter((p) => fs.lstatSync(p).isFile());
}

function audit(t: Tc) {
  const r = spawnSync(NODE, [script(t.pkg, "task-cell-audit"), "--cwd", t.root, "--run-id", t.runId], { encoding: "utf8", timeout: 120000 });
  return { status: r.status, body: JSON.parse(r.stdout || "{}") };
}

function dropBusLines(t: Tc, predicate: (line: string) => boolean): number {
  const log = path.join(t.runDir, "bus", "log.jsonl");
  const lines = fs.readFileSync(log, "utf8").split("\n");
  const kept = lines.filter((l) => !predicate(l));
  fs.writeFileSync(log, kept.join("\n"));
  return lines.length - kept.length;
}

const busLog = (t: Tc) => path.join(t.runDir, "bus", "log.jsonl");
const eventsFile = (t: Tc) => path.join(t.runDir, "task-cell-telemetry", "events.jsonl");
const admitted = (t: Tc, id: string) => findFile(path.join(t.runDir, "task-cells", id), "assignment.json") !== null;
const inst = (s: Record<string, any>, id: string) => (s.instances ?? []).find((i: { logical_task_id: string }) => i.logical_task_id === id);

async function positive(lanes: TcLane[] = [{ id: "T1", role: "backend" }]) {
  const t = tc(lanes);
  const s = await drive(t, startAsync(t));
  return { t, s };
}

// ── F2 reviewed-basis forgeries (built from the genuine root/Q basis, never from scratch) ──

/** The genuine guild.source_basis_descriptor.v1 and the files it names (read-only). */
function genuineBasis() {
  const descriptorPath = requireInput("E00_TC_REVIEWED_BASIS");
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  if (descriptor.schema_version !== "guild.source_basis_descriptor.v1" || !path.isAbsolute(descriptor.root)) {
    throw new Error("E00_TC_REVIEWED_BASIS is not an absolute-root guild.source_basis_descriptor.v1");
  }
  const at = (rel: string) => path.join(descriptor.root, rel);
  const request = JSON.parse(fs.readFileSync(at(descriptor.request_path), "utf8"));
  const inv = JSON.parse(fs.readFileSync(path.join(at(request.evidence_dir), "invocation.json"), "utf8"));
  const file = (ref: { path: string }) => at(ref.path);
  return { descriptorPath, descriptor, at, request, inv, file };
}

const BASIS_FILE: Record<string, string> = { candidate: "candidate.json", packet: "packet.txt", result: "result.json", adapter_exit: "adapter-exit.json" };

/**
 * Relocate the genuine basis into the TC root and return a descriptor for the copy.
 * `mutate` edits bytes (request, candidate, packet, result, adapter_exit); `rehash`
 * decides whether the invocation joins are recomputed. The invocation is written
 * last so result.json is never newer than it. The genuine basis is never written.
 */
function relocatedBasis(t: Tc, mutate: (files: Record<string, Buffer>) => void, rehash: boolean): string {
  const { descriptor, at, inv, file } = genuineBasis();
  const files: Record<string, Buffer> = { request: fs.readFileSync(at(descriptor.request_path)) };
  for (const k of Object.keys(BASIS_FILE)) files[k] = fs.readFileSync(file(inv[k]));
  mutate(files);
  const base = path.join(".guild", "runs", t.runId, "review", "relocated-basis");
  // Evidence goes where the verifier binds it, .guild/runs/<proposal.run_id>/review/<request.packet_id>/,
  // derived from the copied proposal and request (no basis fact is re-authored).
  const yaml = require("js-yaml") as { load: (text: string) => unknown };
  const proposalRunId = (yaml.load(fs.readFileSync(at(descriptor.proposal_path), "utf8")) as { run_id?: unknown }).run_id;
  const packetId = JSON.parse(files.request.toString("utf8")).packet_id;
  if (typeof proposalRunId !== "string" || typeof packetId !== "string") throw new Error("genuine basis proposal.run_id or request.packet_id is not a string");
  const evidence = path.join(".guild", "runs", proposalRunId, "review", packetId);
  fs.mkdirSync(path.join(t.root, base), { recursive: true });
  fs.mkdirSync(path.join(t.root, evidence), { recursive: true });
  const put = (rel: string, bytes: Buffer) => { fs.writeFileSync(path.join(t.root, rel), bytes); return rel; };
  const proposalRel = put(path.join(base, "proposal.json"), fs.readFileSync(at(descriptor.proposal_path)));
  const decisionRel = put(path.join(base, "decision.json"), fs.readFileSync(at(descriptor.decision_path)));
  const req = JSON.parse(files.request.toString("utf8"));
  req.evidence_dir = evidence;
  const requestBytes = Buffer.from(JSON.stringify(req, null, 2) + "\n");
  const requestRel = put(path.join(base, "request.json"), requestBytes);
  const out = { ...inv, request: { path: requestRel, sha256: rehash ? sha256(requestBytes) : inv.request.sha256 } };
  for (const [k, name] of Object.entries(BASIS_FILE)) {
    const rel = put(path.join(evidence, name), files[k]);
    out[k] = { path: rel, sha256: rehash ? sha256(files[k]) : inv[k].sha256 };
  }
  put(path.join(evidence, "invocation.json"), Buffer.from(JSON.stringify(out, null, 2) + "\n"));
  const descriptorOut = path.join(t.root, base, "descriptor.json");
  fs.writeFileSync(descriptorOut, JSON.stringify({ schema_version: "guild.source_basis_descriptor.v1", root: t.root, proposal_path: proposalRel, decision_path: decisionRel, request_path: requestRel }));
  return descriptorOut;
}

describe.skipIf(!enabled)("TC · EAT06 installed package surface", () => {
  it("lives outside the checkout and ships task-cell-controller, task-cell-ack and task-cell-api", () => {
    const checkout = path.resolve(__dirname, "..", "..", "..");
    expect(path.relative(checkout, fs.realpathSync(PKG)).startsWith("..")).toBe(true);
    for (const id of ["task-cell-controller", "task-cell-ack", "task-cell-api"]) expect(fs.existsSync(script(PKG, id))).toBe(true);
  });

  it("task-cell-api exposes the facade and not createTaskCellController", () => {
    const api = require(script(PKG, "task-cell-api")) as Record<string, unknown>;
    for (const fn of ["startTaskCellController", "readControllerStatus", "recordControllerLoss", "approveOraclePlan", "recordAuthorityDecision", "submitObservedHandoff", "writeAckClaim", "isQualifiedDownstreamRelease", "findQualifiedRunAcceptances"]) {
      expect(typeof api[fn]).toBe("function");
    }
    expect(api["createTaskCellController"]).toBeUndefined();
  });

  it("identity reads through readVerifiedReleasePackageIdentity with a non-null source_commit", () => {
    const id = readVerifiedReleasePackageIdentity(PKG) as unknown as Record<string, unknown>;
    expect(typeof id["release_id"]).toBe("string");
    expect(typeof id["source_commit"]).toBe("string");
  });

  for (const [label, damage] of [
    ["mismatched chunk", (p: string) => fs.appendFileSync(script(p, "task-cell-api"), "\n// tamper\n")],
    ["deleted chunk", (p: string) => fs.rmSync(script(p, "task-cell-api"))],
  ] as const) {
    it(`a ${label} fails identity and refuses start without a claim`, () => {
      const copy = ownedTempDir("guild-e00-tc-pkg-");
      fs.cpSync(PKG, copy, { recursive: true });
      damage(copy);
      expect(() => readVerifiedReleasePackageIdentity(copy)).toThrow();
      const t = tc([{ id: "T1", role: "backend" }], { approve: false });
      const r = spawnSync(NODE, [script(copy, "task-cell-controller"), ...withRoot(startArgs(t, { pkg: copy }), t.root)], { cwd: t.root, env: t.env, encoding: "utf8", timeout: 60000 });
      expect(r.status).not.toBe(0);
      expect(fs.existsSync(path.join(t.runDir, "controller", "controller.json"))).toBe(false);
    });
  }
});

describe.skipIf(!enabled)("TC · start refusals (EAT01-I, CD5, CD8, CD22)", () => {
  it("isolated_worker refuses worker_principal_unavailable and writes no TaskCell record", () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const r = cli(t, startArgs(t, { policy: "isolated_worker" }));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("worker_principal_unavailable");
    expect(fs.existsSync(path.join(t.runDir, "task-cells"))).toBe(false);
  });

  it("an unapproved oracle plan refuses oracle_plan_unapproved with no claim", () => {
    const t = tc([{ id: "T1", role: "backend" }], { approve: false });
    const r = cli(t, startArgs(t));
    expect(r.out).toContain("oracle_plan_unapproved");
    expect(fs.existsSync(path.join(t.runDir, "controller", "controller.json"))).toBe(false);
  });

  const basisRefusals: Array<[string, (t: Tc) => string | null]> = [
    ["absent reviewed-basis proof", () => null],
    ["forged proof: genuine invocation with a broken result hash join", (t) => relocatedBasis(t, (f) => { f.result = Buffer.concat([f.result, Buffer.from(" ")]); }, false)],
    ["consistent proof naming another commit", (t) => {
      const commit = String((readVerifiedReleasePackageIdentity(PKG) as unknown as Record<string, unknown>)["source_commit"]);
      return relocatedBasis(t, (f) => {
        const text = f.candidate.toString("utf8");
        if (!text.includes(commit)) throw new Error("genuine candidate does not name the package source_commit");
        f.candidate = Buffer.from(text.split(commit).join("1".repeat(commit.length)));
        const result = JSON.parse(f.result.toString("utf8"));
        result.artifact_sha256_reviewed = sha256(f.candidate);
        f.result = Buffer.from(JSON.stringify(result));
      }, true);
    }],
  ];
  for (const [label, args] of basisRefusals) {
    it(`${label}: refuses basis_unreviewed and writes no TaskCell record`, () => {
      const t = tc([{ id: "T1", role: "backend" }]);
      const r = cli(t, startArgs(t, { basis: args(t) }));
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("basis_unreviewed");
      expect(fs.existsSync(path.join(t.runDir, "task-cells"))).toBe(false);
    });
  }

  it("two concurrent starts: exactly one claim, the other refuses controller_already_claimed", async () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    startAsync(t);
    const b = spawnSync(NODE, [script(PKG, "task-cell-controller"), ...withRoot(startArgs(t), t.root)], { cwd: t.root, env: t.env, encoding: "utf8", timeout: 60000 });
    await waitFor(() => path.join(t.runDir, "controller", "controller.json"));
    expect(`${b.stdout}${b.stderr}`).toContain("controller_already_claimed");
    expect(fs.readdirSync(path.join(t.runDir, "controller")).filter((f) => f === "controller.json").length).toBe(1);
  }, T);
});

describe.skipIf(!enabled)("TC · cooperative accepted path (EAT01-C, EAT02, EAT04, EAT06, EAT08)", () => {
  it("qualifies one lane as cooperative_local on the reviewed basis with pre.json, final.json and a closed audit", async () => {
    const { t, s } = await positive();
    expect(s.counts).toMatchObject({ total: 1, mechanically_accepted: 1, qualified_released: 1 });
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "accepted", qualified_release: true, release_telemetry_state: "complete", cleanup_state: "complete" });
    expect(s.principal).toMatchObject({ mode: "cooperative_same_uid", worker_trust_policy: "cooperative_local", provider: "cooperative_local" });
    expect(s.qualification.state).toBe("qualified");
    const id = readVerifiedReleasePackageIdentity(PKG) as unknown as { release_id: string; current_package: string; package_digests: Record<string, string>; source_commit: string };
    expect(s.identity.package_identity).toEqual({ id: id.release_id, sha256: id.package_digests[id.current_package] });
    expect(s.identity.source_revision).toBe(id.source_commit);
    expect(findFile(path.join(t.runDir, "controller"), "pre.json")).not.toBeNull();
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).not.toBeNull();
    expect(audit(t).status).toBe(0);
  }, T);

  it("the worker pane environment carries neither GUILD_RUN_BINDING_REF nor the nonce (secret-safe check)", async () => {
    const { t } = await positive();
    const check = JSON.parse(fs.readFileSync(path.join(t.root, ".tc-worker-env.json"), "utf8"));
    expect(check).toMatchObject({ binding_ref_env_present: false, nonce_digest_supplied: true, nonce_digest_matched: false, assignment_locator_absolute: true });
  }, T);

  it("records controller_observed origin with native_task_completed=false and an unverified matching notice", async () => {
    const { t } = await positive();
    // X3 preconditions: the packaged hook ran in the pane (synthetic fixture event) and wrote the notice before any
    // ack claim or controller ack existed (durable pre-ACK order receipt -> hook, no timing assumption). The worker's
    // post-ACK observations are diagnostic only: teardown may end the worker before it records them.
    const hookResult = JSON.parse(fs.readFileSync(path.join(t.root, ".tc-hook-result.json"), "utf8"));
    expect(hookResult).toMatchObject({
      invocation: "synthetic_fixture_event", hook_present: true, hook_ran: true, hook_exit: 0, hook_timed_out: false, notice_present_after_hook: true,
      ack_claim_present_at_hook: false, controller_ack_present_at_hook: false, steps: { receipt: 1, hook: 2 } });
    expect(hookResult.events.slice(0, 2).map((e: { event: string }) => e.event)).toEqual(["receipt_written", "hook_completed"]);
    const controllerAck = JSON.parse(fs.readFileSync(findFile(t.runDir, "assignment-ack.json")!, "utf8"));
    const origin = JSON.parse(fs.readFileSync(findFile(t.runDir, "handoff-origin.json")!, "utf8"));
    expect(Date.parse(origin.observed_at) >= Date.parse(controllerAck.acknowledged_at)).toBe(true);
    expect(origin).toMatchObject({ origin_kind: "controller_observed", native_task_completed: false });
    expect(origin.reported_claims.map((c: { claim_status: string }) => c.claim_status)).toEqual(["unverified"]);
  }, T);

  it("refuses a wrong-instance notice claim without changing provenance", async () => {
    const t = tc([{ id: "T1", role: "backend" }], { mode: "bad-notice" });
    await drive(t, startAsync(t));
    // X3 precondition: the packaged hook wrote the notice and the fixture changed only its instance_id.
    expect(JSON.parse(fs.readFileSync(path.join(t.root, ".tc-hook-result.json"), "utf8"))).toMatchObject({ hook_exit: 0, notice_present_after_hook: true, changed_fields: ["instance_id"] });
    const origin = JSON.parse(fs.readFileSync(findFile(t.runDir, "handoff-origin.json")!, "utf8"));
    expect(origin.native_task_completed).toBe(false);
    expect(origin.reported_claims.map((c: { claim_status: string }) => c.claim_status)).toEqual(["refused"]);
  }, T);

  it("no system-produced sink carries the binding nonce", async () => {
    const { t } = await positive();
    const nonce = Buffer.from(t.bindingRef);
    const hits = allFiles(t.root).filter((f) => !f.endsWith(path.join("runs", t.runId, "binding.json")) && fs.readFileSync(f).includes(nonce));
    expect(hits.map((f) => path.relative(t.root, f))).toEqual([]);
  }, T);

  it("does not qualify the same record for an isolated_worker consumer or a release context", async () => {
    const { t } = await positive();
    expect(inst(status(t, "isolated_worker"), "T1").qualified_release).toBe(false);
    const ctx = path.join(t.root, "tc-context.json");
    fs.writeFileSync(ctx, JSON.stringify(status(t).qualification.producer_context));
    expect(inst(status(t, "cooperative_local", `release:${ctx}`), "T1").qualified_release).toBe(false);
  }, T);

  it("two lanes: the dependent is admitted with the upstream accepted_artifact_ref and team_result roles match", async () => {
    const { t, s } = await positive([{ id: "T1", role: "backend" }, { id: "T2", role: "backend", deps: ["T1"] }]);
    expect(s.counts).toMatchObject({ total: 2, qualified_released: 2 });
    const t2 = JSON.parse(fs.readFileSync(findFile(path.join(t.runDir, "task-cells", "T2"), "assignment.json")!, "utf8"));
    const t1Acc = path.relative(t.root, findFile(path.join(t.runDir, "task-cells", "T1"), "handoff-acceptance.json")!);
    expect(t2.dependencies).toEqual([{ logical_task_id: "T1", accepted_artifact_ref: t1Acc }]);
    const result = JSON.parse(fs.readFileSync(path.join(t.runDir, "team-result", "build.json"), "utf8"));
    expect(result.lanes.map((l: { role: string }) => l.role)).toEqual(["backend", "backend"]);
    expect(audit(t).status).toBe(0);
  }, T);

  it("publishes team_plan per instance at the canonical path and never reads a decoy", async () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const decoy = path.join(t.root, ".guild", "team-plan", "build.json");
    fs.mkdirSync(path.dirname(decoy), { recursive: true });
    fs.writeFileSync(decoy, "{\"decoy\":true}\n");
    await drive(t, startAsync(t));
    const canonical = `.guild/runs/${t.runId}/team-plan/build.json`;
    const log = fs.readFileSync(busLog(t), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const perInstance = log.filter((e) => /^status\/task-cell\/T1\/1\/[^/]+\/team_plan$/.test(e.topic));
    expect(perInstance.length).toBe(1);
    expect(perInstance[0].path).toBe(canonical);
    expect(log.some((e) => e.path === ".guild/team-plan/build.json")).toBe(false);
    expect(fs.readFileSync(decoy, "utf8")).toBe("{\"decoy\":true}\n");
  }, T);

  it("source-run controller over the same fixture stays mechanics_only (CD16)", async () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const s = await drive(t, startAsync(t, { pkg: null, basis: null }, SOURCE_CONTROLLER, "bun"), { limitMs: 120_000 });
    expect(s.qualification.state).toBe("mechanics_only");
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).toBeNull();
    expect((s.instances ?? []).every((i: { qualified_release: unknown }) => i.qualified_release === false)).toBe(true);
  }, T);

  it("a worker that never claims the ack is force-terminated timed_out with no acceptance", async () => {
    const t = tc([{ id: "T1", role: "backend" }], { mode: "no-ack" });
    const s = await drive(t, startAsync(t));
    expect(inst(s, "T1")).toMatchObject({ attempt_terminal_state: "timed_out", mechanical_acceptance: "none", qualified_release: false });
  }, T);
});

describe.skipIf(!enabled)("TC · broker reviewer_cell authority (F4, CD12)", () => {
  /** Wait for the review request, run the GENUINE broker into `out`, return the request. */
  async function genuineBroker(t: Tc, out: string): Promise<Record<string, any>> {
    const cmd = requireInput("E00_TC_BROKER_COMMAND");
    const reqPath = await waitFor(() => firstFileIn(path.join(t.runDir, "controller", "review-requests")), 180_000, 200);
    const req = JSON.parse(fs.readFileSync(reqPath, "utf8"));
    fs.mkdirSync(out, { recursive: true });
    const r = spawnSync(cmd, ["--request", reqPath, "--out", out], { cwd: t.root, encoding: "utf8", timeout: 600_000 });
    if (r.status !== 0) throw new Error(`genuine broker command exited ${r.status}`);
    return req;
  }

  /** Genuine broker evidence, optionally mutated in staging before it reaches evidence_dir. */
  async function reviewedRun(mutate?: (files: Record<string, Buffer>) => void) {
    const t = tc([{ id: "T1", role: "backend", reviewer: true }]);
    const child = startAsync(t);
    const decider = setInterval(() => decideAwaiting(t, status(t)), 1500);
    try {
      const staging = path.join(t.root, ".tc-broker-staging");
      const req = await genuineBroker(t, staging);
      const files: Record<string, Buffer> = {};
      for (const n of fs.readdirSync(staging)) files[n] = fs.readFileSync(path.join(staging, n));
      mutate?.(files);
      const evidenceDir = path.join(t.root, req.evidence_dir);
      fs.mkdirSync(evidenceDir, { recursive: true });
      for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(evidenceDir, n), b);
      const s = await drive(t, child, { limitMs: 180_000, done: (s) => inst(s, "T1")?.attempt_terminal_state != null || /review_refused|broker_exit_nonzero/.test(JSON.stringify(s)) });
      return { t, s };
    } finally {
      clearInterval(decider);
    }
  }

  it("a genuine approved cross-host broker result grants reviewer_cell and the lane qualifies", async () => {
    const { t, s } = await reviewedRun();
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "accepted", qualified_release: true });
    const acc = JSON.parse(fs.readFileSync(findFile(t.runDir, "handoff-acceptance.json")!, "utf8"));
    expect(acc.reviewer_cell_id ?? null).toBeNull();
    expect(acc.authorities_observed.map((a: { authority: string; decision: string }) => `${a.authority}:${a.decision}`).sort()).toEqual(["deterministic_floor:accepted", "reviewer_cell:accepted", "team_lead:accepted"]);
    const pre = JSON.parse(fs.readFileSync(findFile(path.join(t.runDir, "controller"), "pre.json")!, "utf8"));
    expect(pre.review).toMatchObject({ source: "broker", participation_kind: "reviewer_cross_host", role_ref: "security-auditor", exit: 0, result_schema_valid: true, gate_conditions: { parses: true, packet_id_match: true, sha256_match: true, satisfied: true, no_blockers: true } });
    expect(fs.existsSync(path.join(t.runDir, "task-cells", "tc-review"))).toBe(false);
  }, 900_000);

  it("a reviewer slot with no broker evidence leaves the lane awaiting reviewer_cell", async () => {
    const t = tc([{ id: "T1", role: "backend", reviewer: true }]);
    const s = await drive(t, startAsync(t), { limitMs: 180_000, done: (s) => inst(s, "T1")?.awaiting === "reviewer_cell" });
    expect(inst(s, "T1")).toMatchObject({ awaiting: "reviewer_cell", mechanical_acceptance: "none" });
  }, T);

  const forgeries: Array<[string, (f: Record<string, Buffer>) => void]> = [
    ["candidate bytes are edited after the genuine invocation pinned them", (f) => { f["candidate.json"] = Buffer.concat([f["candidate.json"], Buffer.from(" ")]); }],
    ["the invocation names another participant", (f) => { const i = JSON.parse(f["invocation.json"].toString()); i.reviewer_participant_id = "someone-else"; f["invocation.json"] = Buffer.from(JSON.stringify(i)); }],
    ["invocation and adapter exit claim a same-family reviewer", (f) => {
      for (const n of ["invocation.json", "adapter-exit.json"]) { const x = JSON.parse(f[n].toString()); x.reviewer_family = x.author_family; f[n] = Buffer.from(JSON.stringify(x)); }
    }],
    ["invocation and adapter exit report a nonzero exit", (f) => {
      for (const n of ["invocation.json", "adapter-exit.json"]) { const x = JSON.parse(f[n].toString()); x.exit = 1; f[n] = Buffer.from(JSON.stringify(x)); }
    }],
  ];
  for (const [label, mutate] of forgeries) {
    it(`refuses reviewer_cell when ${label}`, async () => {
      const { s } = await reviewedRun(mutate);
      expect(inst(s, "T1").mechanical_acceptance).toBe("none");
      expect(inst(s, "T1").qualified_release).toBe(false);
      expect(JSON.stringify(s)).toMatch(/review_refused|broker_exit_nonzero/);
    }, 900_000);
  }
});

describe.skipIf(!enabled)("TC · pre-release faults block release and admission (F5, CD17, CD24)", () => {
  async function faultBeforeT1Decide(apply: (t: Tc) => void) {
    const t = tc([{ id: "T1", role: "backend" }, { id: "T2", role: "backend", deps: ["T1"] }]);
    let applied = false;
    const s = await drive(t, startAsync(t), {
      limitMs: 240_000,
      beforeDecide: (i) => { if (i.logical_task_id === "T1" && !applied) { apply(t); applied = true; } },
      done: (s) => applied && inst(s, "T1")?.release_telemetry_state !== undefined && !["complete", "unknown"].includes(inst(s, "T1").release_telemetry_state) || /acceptance_publication_failed/.test(JSON.stringify(s)),
    });
    if (!applied) throw new Error("fault was never applied: T1 never awaited team_lead");
    return { t, s };
  }

  it("persistent acceptance bus-publish failure: no final.json, not qualified, dependent never admitted", async () => {
    const { t, s } = await faultBeforeT1Decide((t) => fs.chmodSync(busLog(t), 0o444));
    expect(findFile(t.runDir, "handoff-acceptance.json")).not.toBeNull();
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).toBeNull();
    expect(inst(s, "T1").qualified_release).toBe(false);
    expect(JSON.stringify(s)).toContain("acceptance_publication_failed");
    expect(admitted(t, "T2")).toBe(false);
  }, T);

  it("lifecycle marker without its event line: lifecycle_event_incomplete, not qualified, dependent never admitted", async () => {
    const { t, s } = await faultBeforeT1Decide((t) => fs.chmodSync(eventsFile(t), 0o444));
    expect(inst(s, "T1")).toMatchObject({ qualified_release: false, release_telemetry_state: "lifecycle_event_incomplete" });
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).toBeNull();
    expect(admitted(t, "T2")).toBe(false);
    // C-R2: the historical accepted fact stays accepted (release blocked), never force-failed.
    expect(JSON.parse(fs.readFileSync(findFile(path.join(t.runDir, "task-cells", "T1"), "handoff-acceptance.json")!, "utf8")).downstream_release_at).not.toBeNull();
    expect(inst(s, "T1").mechanical_acceptance).toBe("accepted");
    expect(inst(s, "T1").attempt_terminal_state).not.toBe("failed");
  }, T);

  it("lifecycle marker CREATE failure: no marker, lifecycle_event_incomplete, not qualified, dependent never admitted", async () => {
    let markersAtFault = -1;
    const { t, s } = await faultBeforeT1Decide((t) => {
      const ids = path.join(t.runDir, "task-cell-telemetry", "event-ids");
      markersAtFault = fs.readdirSync(ids).length;
      fs.chmodSync(ids, 0o555);
    });
    expect(fs.readdirSync(path.join(t.runDir, "task-cell-telemetry", "event-ids")).length).toBe(markersAtFault);
    expect(findFile(t.runDir, "handoff-acceptance.json")).not.toBeNull();
    expect(inst(s, "T1")).toMatchObject({ qualified_release: false, release_telemetry_state: "lifecycle_event_incomplete" });
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).toBeNull();
    expect(admitted(t, "T2")).toBe(false);
  }, T);

  it("reconciliation SIDECAR write failure after a reconciled publish: reconciliation_sidecar_missing, not qualified, dependent never admitted", async () => {
    // Direct fault control, no timing: the preload fails exactly the controller's first
    // acceptance bus append (the original publish) and every sidecar create (EACCES).
    // The reconciled publish of the same persisted bytes is not faulted.
    const t = tc([{ id: "T1", role: "backend" }, { id: "T2", role: "backend", deps: ["T1"] }]);
    const planFile = path.join(t.root, ".tc-fault-plan.json");
    fs.writeFileSync(planFile, JSON.stringify({ root: t.root, runId: t.runId, failFirstAcceptanceAppend: true, sidecarEacces: true }));
    const child = startAsync(t, {}, undefined, undefined, { NODE_OPTIONS: `--require ${FAULT_PRELOAD}`, E00_TC_FAULT_PLAN: planFile });
    const s = await drive(t, child, { limitMs: 240_000, done: (s) => !["complete", "unknown", undefined].includes(inst(s, "T1")?.release_telemetry_state) });
    const log = fs.readFileSync(path.join(t.root, ".tc-fault-log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(log[0]).toMatchObject({ kind: "preload_active", entry: "task-cell-controller.js" });
    const accFile = findFile(path.join(t.runDir, "task-cells", "T1"), "handoff-acceptance.json")!;
    const accSha = sha256(fs.readFileSync(accFile));
    const failed = log.filter((e) => e.kind === "acceptance_append_failed");
    const reconciled = log.filter((e) => e.kind === "acceptance_append_ok");
    expect(failed.map((e) => e.sha256)).toEqual([accSha]);
    expect(reconciled.map((e) => e.sha256)).toEqual([accSha]);
    expect(Date.parse(reconciled[0].ts)).toBeGreaterThanOrEqual(Date.parse(failed[0].ts));
    const busEvents = fs.readFileSync(busLog(t), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.event === "artifact.published" && e.path === path.relative(t.root, accFile));
    expect(busEvents.map((e) => e.sha256)).toEqual([accSha]);
    const sidecarFails = log.filter((e) => e.kind === "sidecar_write_failed");
    expect(sidecarFails.length).toBeGreaterThan(0);
    for (const e of sidecarFails) expect(e.path.startsWith(path.join(".guild", "runs", t.runId, "controller", "reconciliations", inst(s, "T1").instance_id) + path.sep)).toBe(true);
    const sideDir = path.join(t.runDir, "controller", "reconciliations", inst(s, "T1").instance_id);
    expect(fs.existsSync(sideDir) ? fs.readdirSync(sideDir) : []).toEqual([]);
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "accepted", qualified_release: false, release_telemetry_state: "reconciliation_sidecar_missing" });
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).toBeNull();
    expect(admitted(t, "T2")).toBe(false);
  }, T);
});

describe.skipIf(!enabled)("TC · post-final terminal fault is cleanup-only (F5, CD25)", () => {
  it("terminal publication fails after final.json: qualification, final.json and the admitted dependent unchanged; cleanup incomplete; closed audit fails", async () => {
    // Barrier: the shim holds T1's kill-pane. runtime.terminate kills the pane BEFORE
    // sealTerminalAttempt writes and publishes, so the fault lands between final.json
    // and terminal publication on every run, independent of controller speed.
    const t = tc([{ id: "T1", role: "backend" }, { id: "T2", role: "backend", deps: ["T1"] }]);
    fs.writeFileSync(t.tmux.holdFile, "");
    const child = startAsync(t);
    const decider = setInterval(() => decideAwaiting(t, status(t)), 1000);
    let t2Assignment: Buffer;
    let finalBytes: Buffer;
    let finalPath: string;
    try {
      await waitFor(() => t.tmux.arrivedFile, 240_000, 20);
      finalPath = findFile(path.join(t.runDir, "controller"), "final.json")!;
      expect(finalPath).not.toBeNull();
      expect(fs.readFileSync(busLog(t), "utf8").includes("/terminal\"")).toBe(false);
      // CD11: dependents are admitted after final.json and before cleanup.
      t2Assignment = fs.readFileSync(await waitFor(() => findFile(path.join(t.runDir, "task-cells", "T2"), "assignment.json"), 60_000, 50));
      finalBytes = fs.readFileSync(finalPath);
      fs.chmodSync(busLog(t), 0o444);
    } finally {
      clearInterval(decider);
      fs.rmSync(t.tmux.holdFile, { force: true });
    }
    await waitFor(() => findFile(path.join(t.runDir, "task-cells", "T1"), "terminal.json"), 60_000, 50);
    const s = await drive(t, child, { limitMs: 120_000, done: (s) => !["pending", "unknown", undefined].includes(inst(s, "T1")?.cleanup_state) });
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "accepted", qualified_release: true });
    expect(["terminal_publication_incomplete", "terminal_reconciliation_incomplete"]).toContain(inst(s, "T1").cleanup_state);
    expect(fs.readFileSync(finalPath).equals(finalBytes)).toBe(true);
    expect(fs.readFileSync(findFile(path.join(t.runDir, "task-cells", "T2"), "assignment.json")!).equals(t2Assignment)).toBe(true);
    expect(audit(t).status).not.toBe(0);
  }, T);
});

describe.skipIf(!enabled)("TC · read-time re-verification after final.json (CD17b, CD25)", () => {
  it("removing the acceptance bus event makes current qualification false; facts stay", async () => {
    const { t } = await positive();
    expect(dropBusLines(t, (l) => l.includes("handoff-acceptance.json") && l.includes("artifact.published"))).toBeGreaterThan(0);
    expect(inst(status(t), "T1")).toMatchObject({ mechanical_acceptance: "accepted", qualified_release: false, release_telemetry_state: "prerelease_bus_join_missing" });
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).not.toBeNull();
  }, T);

  it("removing the per-instance team_plan event reads prerelease_bus_join_missing", async () => {
    const { t } = await positive();
    expect(dropBusLines(t, (l) => /status\/task-cell\/T1\/1\/[^/"]+\/team_plan/.test(l))).toBeGreaterThan(0);
    expect(inst(status(t), "T1")).toMatchObject({ qualified_release: false, release_telemetry_state: "prerelease_bus_join_missing" });
  }, T);

  for (const name of ["handoff-origin.json", "team_lead.json"]) {
    it(`an altered ${name} fails qualification and the closed audit`, async () => {
      const { t } = await positive();
      fs.appendFileSync(findFile(t.runDir, name)!, " ");
      expect(inst(status(t), "T1").qualified_release).toBe(false);
      expect(audit(t).status).not.toBe(0);
    }, T);
  }

  it("an unlisted reconciliation sidecar reads reconciliation_manifest_incomplete", async () => {
    const { t, s } = await positive();
    const dir = path.join(t.runDir, "controller", "reconciliations", inst(s, "T1").instance_id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "acceptance.json"), JSON.stringify({ kind: "acceptance" }));
    expect(inst(status(t), "T1")).toMatchObject({ qualified_release: false, release_telemetry_state: "reconciliation_manifest_incomplete" });
  }, T);

  it("a copied tree never qualifies under the copy's root (checks 3-4)", async () => {
    const { t } = await positive();
    const copy = ownedTempDir("guild-e00-tc-copy-");
    // Exactly the sockets observed in the source at copy time are excluded (positive()
    // may already have removed the last pane and its socket); all proof bytes are copied.
    const observedSockets = (fs.readdirSync(t.root, { recursive: true }) as string[])
      .filter((rel) => fs.lstatSync(path.join(t.root, rel)).isSocket()).sort();
    expect(observedSockets.every((rel) => !rel.startsWith(".guild"))).toBe(true);
    expect(copyDurableTree(t.root, copy).sort()).toEqual(observedSockets);
    for (const f of allFiles(path.join(t.root, ".guild"))) {
      expect(sha256(fs.readFileSync(path.join(copy, path.relative(t.root, f))))).toBe(sha256(fs.readFileSync(f)));
    }
    expect(inst(status(t, "cooperative_local", undefined, copy), "T1").qualified_release).toBe(false);
  }, T);
});

describe.skipIf(!enabled)("TC · controller loss (CD5, CD6, CD11)", () => {
  it("SIGKILL after spawn: start refuses controller_loss_unrecorded; record-loss seals; later start refuses controller_lost", async () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const child = startAsync(t);
    await waitFor(() => firstFileIn(path.join(t.runDir, "controller", "handles")));
    await sleep(2000);
    child.kill("SIGKILL");
    await sleep(500);
    expect(cli(t, startArgs(t)).out).toContain("controller_loss_unrecorded");
    const loss = cli(t, ["record-loss", "--run", t.runId]);
    expect(loss.status).toBe(0);
    expect(loss.out).toMatch(/sealed_controller_lost|teardown_unconfirmed|teardown_degraded/);
    expect(status(t).loss_recorded).toBe(true);
    expect(cli(t, startArgs(t)).out).toContain("controller_lost");
    expect(cli(t, ["record-loss", "--run", t.runId]).status).toBe(0);
    const obs = fs.readdirSync(path.join(t.runDir, "controller", "loss"), { recursive: true }) as string[];
    expect(obs.filter((f) => /observation-\d+\.json$/.test(f)).length).toBe(2);
  }, T);

  for (const marker of ["pre.json", "handoff-acceptance.json", "final.json"]) {
    it(`death when ${marker} appears: no qualified release without a verified final.json`, async () => {
      const t = tc([{ id: "T1", role: "backend" }]);
      const child = startAsync(t);
      const decider = setInterval(() => decideAwaiting(t, status(t)), 1500);
      try {
        await waitFor(() => findFile(t.runDir, marker), 240_000);
      } finally {
        clearInterval(decider);
      }
      child.kill("SIGKILL");
      await sleep(500);
      const finalBefore = findFile(path.join(t.runDir, "controller"), "final.json");
      cli(t, ["record-loss", "--run", t.runId]);
      expect(findFile(path.join(t.runDir, "controller"), "final.json")).toBe(finalBefore);
      if (finalBefore === null) expect(inst(status(t), "T1").qualified_release).toBe(false);
      if (marker !== "final.json") expect(audit(t).status).not.toBe(0);
    }, T);
  }
});

// ── C-R1 (G-lane:E00-C r1 F1, F3-F6; root Q1-Q4). Installed-package cases, NOT
// executed until E00-Q supplies E00_TC_PACKAGE_ROOT and the genuine basis/broker.

/** Run a lane set under the fs fault preload with `plan` keys; returns status, fault log and root. */
async function faultRun(lanes: TcLane[], plan: Record<string, unknown>, done: (s: Record<string, any>) => boolean) {
  const t = tc(lanes);
  const planFile = path.join(t.root, ".tc-fault-plan.json");
  fs.writeFileSync(planFile, JSON.stringify({ root: t.root, runId: t.runId, ...plan }));
  const child = startAsync(t, {}, undefined, undefined, { NODE_OPTIONS: `--require ${FAULT_PRELOAD}`, E00_TC_FAULT_PLAN: planFile });
  const s = await drive(t, child, { limitMs: 240_000, done });
  const log = fs.readFileSync(path.join(t.root, ".tc-fault-log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  expect(log[0]).toMatchObject({ kind: "preload_active", entry: "task-cell-controller.js" });
  return { t, s, log };
}

const terminalOf = (t: Tc, id: string) => {
  const f = findFile(path.join(t.runDir, "task-cells", id), "terminal.json");
  return f === null ? null : JSON.parse(fs.readFileSync(f, "utf8"));
};
const acceptanceOf = (t: Tc, id: string) => {
  const f = findFile(path.join(t.runDir, "task-cells", id), "handoff-acceptance.json");
  return f === null ? null : { file: f, bytes: fs.readFileSync(f), record: JSON.parse(fs.readFileSync(f, "utf8")) };
};

describe.skipIf(!enabled)("TC · C-R1 F1 reviewed source basis is joined before the claim and pinned in it", () => {
  it("the claim pins reviewed_basis with reviewed_commit equal to the package source_commit and every basis file by hash", async () => {
    const { t } = await positive();
    const claim = JSON.parse(fs.readFileSync(path.join(t.runDir, "controller", "controller.json"), "utf8"));
    const commit = String((readVerifiedReleasePackageIdentity(PKG) as unknown as Record<string, unknown>)["source_commit"]);
    const pins = claim.reviewed_basis;
    expect(pins).toBeDefined();
    expect(pins.commit).toBe(commit);
    expect(/^[0-9a-f]{40}$/.test(pins.commit)).toBe(true);
    expect(pins.root).toBe(fs.realpathSync(genuineBasis().descriptor.root));
    // Declared ReviewedBasisPins: the BASIS proposal + decision, request and every evidence file, by hash.
    for (const k of ["proposal", "decision", "request", "candidate", "packet", "adapter_exit", "invocation", "result"]) {
      expect(path.isAbsolute(pins[k].path)).toBe(false);
      expect(pins[k].sha256).toBe(sha256(fs.readFileSync(path.join(pins.root, pins[k].path))));
    }
    expect(typeof pins.invocation.invocation_id).toBe("string");
  }, T);

  it("a basis whose request names another commit than its candidate refuses basis_unreviewed with no claim", () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const commit = String((readVerifiedReleasePackageIdentity(PKG) as unknown as Record<string, unknown>)["source_commit"]);
    const forged = relocatedBasis(t, (f) => {
      const text = f.request.toString("utf8");
      if (!text.includes(commit)) throw new Error("genuine basis request does not name the package source_commit");
      f.request = Buffer.from(text.split(commit).join("2".repeat(commit.length)));
    }, true);
    const r = cli(t, startArgs(t, { basis: forged }));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("basis_unreviewed");
    expect(fs.existsSync(path.join(t.runDir, "controller", "controller.json"))).toBe(false);
  });

  it("the installed public facade (task-cell-api) start with a valid port and rung shape but no basis refuses basis_unreviewed with no worker action and no writes", () => {
    // Mechanics-only placeholders that satisfy the declared TaskCellWorkerPort shape and the
    // resolved rung plan (the same plain-data plan the TA harness uses), so start reaches the
    // basis check. Invariant (root clarification, r12): no claim, no filesystem mutation, no
    // worker action (spawn, deliver, terminate). Read-only probes (isAvailable, ready) may run
    // in any order and are only recorded; zero reads is incidental, not a contract.
    const t = tc([{ id: "T1", role: "backend" }]);
    const api = path.join(PKG, "runtime", "scripts", "task-cell-api.js");
    const rootBytes = () => allFiles(t.root).map((f) => `${path.relative(t.root, f)}:${sha256(fs.readFileSync(f))}`).sort();
    const before = rootBytes();
    const probe = [
      `const api = require(${JSON.stringify(api)});`,
      "const reads = [], actions = [];",
      "const act = (n) => () => { actions.push(n); return { ok: false, reason: 'placeholder_port_action' }; };",
      "const worker = { mode: 'native', losses: [], isAvailable: () => { reads.push('isAvailable'); return true; }, ready: () => { reads.push('ready'); return { ok: true, reason: null }; }, spawn: act('spawn'), notifyAssignment: act('notifyAssignment'), terminate: act('terminate') };",
      `const r = api.startTaskCellController({ cwd: ${JSON.stringify(t.root)}, runId: ${JSON.stringify(t.runId)}, phase: "build", workerTrustPolicy: "cooperative_local", packageRoot: ${JSON.stringify(PKG)}, proposal: ${JSON.stringify(t.proposal)}, worker, rungPlan: ${JSON.stringify(FULL_RUNGS)} });`,
      "if (r && r.ok && r.controller) r.controller.close();",
      "process.stdout.write(JSON.stringify({ ok: r.ok, reason: r.reason ?? null, reads, actions }));",
    ].join("\n");
    const r = spawnSync(NODE, ["-e", probe], { cwd: t.root, env: t.env, encoding: "utf8", timeout: 60000 });
    const out = JSON.parse(r.stdout || "{}");
    expect(out).toMatchObject({ ok: false, reason: "basis_unreviewed", actions: [] });
    expect((out.reads as string[]).every((n) => n === "isAvailable" || n === "ready")).toBe(true);
    expect(fs.existsSync(path.join(t.runDir, "controller", "controller.json"))).toBe(false);
    expect(rootBytes()).toEqual(before);
  });

  it("a pinned basis file edited after start makes the current release unqualified (re-verified on read)", async () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const relocated = relocatedBasis(t, () => undefined, true);
    const s = await drive(t, startAsync(t, { basis: relocated }));
    expect(inst(s, "T1").qualified_release).toBe(true);
    const relocatedRequest = JSON.parse(fs.readFileSync(path.join(t.root, JSON.parse(fs.readFileSync(relocated, "utf8")).request_path), "utf8"));
    fs.appendFileSync(path.join(t.root, relocatedRequest.evidence_dir, "candidate.json"), " ");
    expect(inst(status(t), "T1").qualified_release).toBe(false);
  }, T);
});

describe.skipIf(!enabled)("TC · C-R1 F3 a reconciled validation sidecar is carried into final.json", () => {
  it("first validation publish fails: the reconciled validation sidecar is listed in final.json and the lane qualifies", async () => {
    const { t, s, log } = await faultRun([{ id: "T1", role: "backend" }], { failFirstValidationAppend: true },
      (s) => inst(s, "T1")?.attempt_terminal_state != null);
    expect(log.filter((e) => e.kind === "validation_append_failed").length).toBe(1);
    expect(log.filter((e) => e.kind === "validation_append_ok").length).toBe(1);
    const iid = inst(s, "T1").instance_id;
    const sidecar = path.join(t.runDir, "controller", "reconciliations", iid, "validation.json");
    expect(fs.existsSync(sidecar)).toBe(true);
    const final = JSON.parse(fs.readFileSync(findFile(path.join(t.runDir, "controller"), "final.json")!, "utf8"));
    expect(final.reconciliation_manifest).toContainEqual({ kind: "validation", path: path.relative(t.root, sidecar), sha256: sha256(fs.readFileSync(sidecar)) });
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "accepted", qualified_release: true });
    expect(audit(t).status).toBe(0);
  }, T);
});

describe.skipIf(!enabled)("TC · C-R1 F4 a post-acceptance sidecar failure keeps the accepted fact and cleans up unforced", () => {
  it("acceptance reconciled, sidecar write fails: accepted bytes unchanged, terminal is the unforced terminated, not failed", async () => {
    const { t, s, log } = await faultRun([{ id: "T1", role: "backend" }, { id: "T2", role: "backend", deps: ["T1"] }],
      { failFirstAcceptanceAppend: true, sidecarEacces: true },
      (s) => inst(s, "T1")?.attempt_terminal_state != null);
    const acc = acceptanceOf(t, "T1")!;
    expect(log.filter((e) => e.kind === "acceptance_append_failed").map((e) => e.sha256)).toEqual([sha256(acc.bytes)]);
    expect(acc.record.downstream_release_at).not.toBeNull();
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "accepted", qualified_release: false, attempt_terminal_state: "terminated" });
    expect(terminalOf(t, "T1")).toMatchObject({ terminal_state: "terminated" });
    expect(JSON.stringify(terminalOf(t, "T1"))).not.toContain("controller_error");
    expect(JSON.stringify(s)).toContain("reconciliation_sidecar_missing");
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).toBeNull();
    expect(admitted(t, "T2")).toBe(false);
  }, T);
});

describe.skipIf(!enabled)("TC · C-R1 F5 an absent acceptance after I/O failure is retried at most 3 times, then durably rejected", () => {
  const settled = (s: Record<string, any>) => inst(s, "T1")?.attempt_terminal_state != null;

  it("one failed accepting write: reclassified absent, retried, accepted and qualified", async () => {
    const { t, s, log } = await faultRun([{ id: "T1", role: "backend" }], { failAcceptedWrites: 1 }, settled);
    expect(log.filter((e) => e.kind === "accepted_write_failed").length).toBe(1);
    expect(log.filter((e) => e.kind === "accepted_write_ok").length).toBe(1);
    expect(acceptanceOf(t, "T1")!.record.downstream_release_at).not.toBeNull();
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "accepted", qualified_release: true });
  }, T);

  it("persistent accepting-write failure: exactly 4 attempts (initial + 3 retries), then a durable rejection preserving the accepted observations, and termination", async () => {
    const { t, s, log } = await faultRun([{ id: "T1", role: "backend" }, { id: "T2", role: "backend", deps: ["T1"] }], { failAcceptedWrites: 1000 }, settled);
    expect(log.filter((e) => e.kind === "accepted_write_failed").length).toBe(4);
    expect(log.filter((e) => e.kind === "rejection_write_ok").length).toBe(1);
    const rec = acceptanceOf(t, "T1")!.record;
    expect(rec.downstream_release_at).toBeNull();
    expect(rec.termination_authorized_at).not.toBeNull();
    // Root Q4: no authority is invented as having voted rejected.
    expect(rec.authorities_observed.length).toBeGreaterThan(0);
    expect(rec.authorities_observed.every((o: { decision: string }) => o.decision === "accepted")).toBe(true);
    const term = terminalOf(t, "T1");
    expect(term).not.toBeNull();
    expect(term.reason).toEqual(expect.any(String));
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "rejected", qualified_release: false });
    expect(admitted(t, "T2")).toBe(false);
  }, T);

  it("persistent rejection-write failure stays fail-closed: no acceptance or rejection record, never reported rejected or qualified", async () => {
    const { t, s, log } = await faultRun([{ id: "T1", role: "backend" }, { id: "T2", role: "backend", deps: ["T1"] }],
      { failAcceptedWrites: 1000, failRejectionWrites: true },
      (s) => /acceptance|rejection/.test(String(inst(s, "T1")?.failure_reason ?? inst(s, "T1")?.awaiting ?? "")) || inst(s, "T1")?.attempt_terminal_state != null);
    expect(log.filter((e) => e.kind === "accepted_write_failed").length).toBe(4);
    expect(log.some((e) => e.kind === "rejection_write_failed")).toBe(true);
    expect(acceptanceOf(t, "T1")).toBeNull();
    expect(inst(s, "T1").mechanical_acceptance).toBe("none");
    expect(inst(s, "T1").qualified_release).toBe(false);
    expect(admitted(t, "T2")).toBe(false);
  }, T);
});

describe.skipIf(!enabled)("TC · C-R1 F6 a release consumer context is complete and verified on every read", () => {
  // Root-confirmed CD23 release context fields; every value is taken from the real status, never invented.
  const FIELDS = ["package_root", "root_id", "source_id", "source_revision", "package_identity", "provider", "host_profile_id", "run_id", "instance_ids"] as const;

  async function released() {
    const { t, s } = await positive();
    expect(inst(s, "T1").qualified_release).toBe(true);
    const now = status(t);
    const producer = now.qualification.producer_context;
    const complete: Record<string, unknown> = {
      package_root: fs.realpathSync(PKG),
      root_id: now.identity.root_id,
      source_id: producer.source_id,
      source_revision: producer.source_revision,
      package_identity: producer.package_identity,
      provider: producer.provider,
      host_profile_id: producer.host_profile_id,
      run_id: now.identity.run_id,
      instance_ids: (now.instances ?? []).map((i: { instance_id: string }) => i.instance_id),
    };
    for (const k of FIELDS) expect(complete[k] === null || complete[k] === undefined).toBe(false);
    let n = 0;
    const qualifies = (ctx: Record<string, unknown>) => {
      const f = path.join(t.root, `tc-release-${++n}.json`);
      fs.writeFileSync(f, JSON.stringify(ctx));
      return inst(status(t, "cooperative_local", `release:${f}`), "T1").qualified_release;
    };
    return { t, complete, qualifies };
  }

  it("control: the complete context read from the real status qualifies", async () => {
    const { complete, qualifies } = await released();
    expect(qualifies(complete)).toBe(true);
  }, T);

  it("omitting any one of the nine fields never qualifies", async () => {
    const { complete, qualifies } = await released();
    for (const k of FIELDS) {
      const { [k]: _omitted, ...partial } = complete;
      expect({ omitted: k, qualified: qualifies(partial) }).toEqual({ omitted: k, qualified: false });
    }
  }, T);

  it("a wrong value in any field never qualifies", async () => {
    const { complete, qualifies } = await released();
    const copy = ownedTempDir("guild-e00-tc-pkgcopy-");
    fs.cpSync(PKG, copy, { recursive: true });
    fs.appendFileSync(script(copy, "task-cell-controller"), "\n// altered\n");
    const pid = complete.package_identity as { id: string; sha256: string };
    const wrong: Record<(typeof FIELDS)[number], unknown> = {
      package_root: copy,
      root_id: "root-other",
      source_id: "source:root-other",
      source_revision: "0".repeat(40),
      package_identity: { id: pid.id, sha256: "0".repeat(64) },
      provider: "isolated_worker",
      host_profile_id: "0".repeat(64),
      run_id: "run-other",
      instance_ids: ["instance-other"],
    };
    for (const k of FIELDS) {
      expect({ field: k, qualified: qualifies({ ...complete, [k]: wrong[k] }) }).toEqual({ field: k, qualified: false });
    }
  }, T);
});

// ── C-R2 (G-lane:E00-C r2 C-r2-F1/F2/F3 recovery contract). Installed-package cases,
// NOT executed until E00-Q supplies the package, genuine basis and L's port. Faults come
// from tc/fs-fault-preload.cjs in the controller child only (deterministic controls in
// fs-fault-preload.test.ts); no package or host qualification is inferred from them.

describe.skipIf(!enabled)("TC · C-R2 post-state recovery (event step and final.json faults)", () => {
  const settledOr = (id: string, word: string) => (s: Record<string, any>) =>
    inst(s, id)?.attempt_terminal_state != null || JSON.stringify(inst(s, id) ?? {}).includes(word);

  it("C-r2-F1: the handoff_validated event line fails after validation is persisted and published: lifecycle_event_incomplete, not failed, release blocked", async () => {
    const { t, s, log } = await faultRun([{ id: "T1", role: "backend" }, { id: "T2", role: "backend", deps: ["T1"] }],
      { failEventAppend: { event_name: "handoff_validated", logical_task_id: "T1" } }, settledOr("T1", "lifecycle_event_incomplete"));
    expect(log.filter((e) => e.kind === "event_append_failed")).toHaveLength(1);
    expect(findFile(path.join(t.runDir, "task-cells", "T1"), "handoff-validation.json")).not.toBeNull();
    expect(JSON.stringify(inst(s, "T1"))).toContain("lifecycle_event_incomplete");
    expect(inst(s, "T1").attempt_terminal_state).not.toBe("failed");
    expect(inst(s, "T1").qualified_release).toBe(false);
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).toBeNull();
    expect(admitted(t, "T2")).toBe(false);
  }, T);

  it("C-r2-F2: the terminated event line fails after final.json: cleanup lifecycle_event_incomplete with terminal published; release facts unchanged", async () => {
    const { t, s, log } = await faultRun([{ id: "T1", role: "backend" }, { id: "T2", role: "backend", deps: ["T1"] }],
      { failEventAppend: { event_name: "terminated", logical_task_id: "T1" } },
      (s) => !["pending", "unknown", undefined].includes(inst(s, "T1")?.cleanup_state));
    expect(log.filter((e) => e.kind === "event_append_failed")).toHaveLength(1);
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "accepted", qualified_release: true, attempt_terminal_state: "terminated", cleanup_state: "lifecycle_event_incomplete" });
    const terminal = path.relative(t.root, findFile(path.join(t.runDir, "task-cells", "T1"), "terminal.json")!);
    const bus = fs.readFileSync(busLog(t), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(bus.filter((e) => e.event === "artifact.published" && e.path === terminal)).toHaveLength(1);
    const cleanup = JSON.parse(fs.readFileSync(findFile(path.join(t.runDir, "controller", "cleanup"), "cleanup.json")!, "utf8"));
    expect(cleanup).toMatchObject({ terminal_published: true, terminal_telemetry_state: "lifecycle_event_incomplete", terminal_reconciliation: null });
    const final = findFile(path.join(t.runDir, "controller"), "final.json")!;
    expect(cleanup.final_sha256).toBe(sha256(fs.readFileSync(final)));
    expect(admitted(t, "T2")).toBe(true);
    expect(audit(t).status).not.toBe(0);
  }, T);

  it("C-r2-F3: every final.json create fails: no final file, cleanup.final_sha256 null, accepted fact kept, unforced terminated, dependent not admitted", async () => {
    const { t, s, log } = await faultRun([{ id: "T1", role: "backend" }, { id: "T2", role: "backend", deps: ["T1"] }],
      { failFinalWrites: true }, (s) => inst(s, "T1")?.attempt_terminal_state != null);
    expect(log.filter((e) => e.kind === "final_write_failed").length).toBeGreaterThanOrEqual(3);
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).toBeNull();
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "accepted", qualified_release: false, attempt_terminal_state: "terminated" });
    const cleanup = JSON.parse(fs.readFileSync(findFile(path.join(t.runDir, "controller", "cleanup"), "cleanup.json")!, "utf8"));
    expect(cleanup.final_sha256).toBeNull();
    expect(admitted(t, "T2")).toBe(false);
  }, T);
});

// ── C-R3 (G-lane:E00-C r3 C-r3-F1). Installed public facade with a transport double:
// mechanics only, NOT a replacement for the ordinary CLI transport positives above.
// NOT executed until E00-Q supplies the package and genuine basis. No tmux server.

describe.skipIf(!enabled)("TC · C-R3 terminal lane state only after a confirmed teardown (installed task-cell-api, transport double)", () => {
  function ackTimeoutLane(t: Tc, refuseTerminate: boolean): Record<string, any> {
    const api = path.join(PKG, "runtime", "scripts", "task-cell-api.js");
    const { descriptor } = genuineBasis();
    const lane = { ...JSON.parse(fs.readFileSync(t.lanesPath, "utf8"))[0], ready_timeout_ms: 0, ack_timeout_ms: 0 };
    const probe = [
      `const api = require(${JSON.stringify(api)});`,
      "const actions = [];",
      // The double never claims the ack; terminate() confirms or refuses (TaskCellWorkerPort contract).
      `const worker = { mode: 'native', losses: [], isAvailable: () => true, ready: () => ({ ok: true, reason: null }), spawn: () => { actions.push('spawn'); return { ok: true, reason: null }; }, notifyAssignment: () => { actions.push('notify'); return { ok: true, reason: null }; }, terminate: () => { actions.push('terminate'); return ${refuseTerminate} ? { ok: false, reason: 'transport double: teardown refused' } : { ok: true, reason: null }; } };`,
      `const r = api.startTaskCellController({ cwd: ${JSON.stringify(t.root)}, runId: ${JSON.stringify(t.runId)}, phase: "build", workerTrustPolicy: "cooperative_local", packageRoot: ${JSON.stringify(PKG)}, proposal: ${JSON.stringify(t.proposal)}, worker, rungPlan: ${JSON.stringify(FULL_RUNGS)}, sleep: async () => {}, reviewedBasis: { root: ${JSON.stringify(descriptor.root)}, proposalPath: ${JSON.stringify(descriptor.proposal_path)}, decisionPath: ${JSON.stringify(descriptor.decision_path)}, requestPath: ${JSON.stringify(descriptor.request_path)} } });`,
      "if (!r.ok) { process.stdout.write(JSON.stringify({ start: r.reason })); process.exit(0); }",
      "(async () => {",
      `  r.controller.writeStationPlan(${JSON.stringify(JSON.parse(fs.readFileSync(t.teamPlanPath, "utf8")))});`,
      `  const out = await r.controller.runLane(${JSON.stringify(lane)});`,
      "  r.controller.close();",
      "  process.stdout.write(JSON.stringify({ out, actions }));",
      "})().catch((e) => { process.stdout.write(JSON.stringify({ error: String(e && e.message) })); });",
    ].join("\n");
    const res = spawnSync(NODE, ["-e", probe], { cwd: t.root, env: t.env, encoding: "utf8", timeout: 120000 });
    return JSON.parse(res.stdout || "{}");
  }
  const attemptT1 = (t: Tc) => JSON.parse(fs.readFileSync(findFile(path.join(t.runDir, "task-cells", "T1"), "attempt.json")!, "utf8"));

  it("control: ack timeout with a confirmed teardown reports timed_out and seals timed_out", () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const r = ackTimeoutLane(t, false);
    expect(r.out).toMatchObject({ state: "timed_out" });
    expect(r.actions).toContain("terminate");
    expect(attemptT1(t).terminal_state).toBe("timed_out");
  });

  it("ack timeout with a refused teardown reports no terminal state; the attempt stays orphaned and unsealed", () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const r = ackTimeoutLane(t, true);
    expect(r.actions).toContain("terminate");
    const attempt = attemptT1(t);
    expect(attempt.terminal_state ?? null).toBeNull();
    expect(attempt.orphaned).toBe(true);
    expect(findFile(path.join(t.runDir, "task-cells", "T1"), "terminal.json")).toBeNull();
    expect(["timed_out", "rejected", "failed", "terminated", "cancelled"]).not.toContain(r.out?.state);
    expect(inst(status(t), "T1").attempt_terminal_state ?? null).toBeNull();
  });
});

// ── C-R4 (G-lane:E00-C r4 C-r4-F1 and R4-A1). Installed task-cell-api with a transport
// double: mechanics-only TEST CONTEXT for the cleanup settlement; the genuine basis and
// the installed package's real preflight decide qualification. NOT executed until E00-Q
// supplies the package and genuine basis. No tmux server, source factory or preflight
// override; the ordinary CLI transport positives above are unchanged.

/** The double's probe source: it acks via the installed task-cell-ack CLI (synchronously inside
 * notifyAssignment, so the ack stays first), writes the oracle artifact and receipt, runs the packaged
 * TaskCompleted hook in an unbound worker-equivalent child (X2), records the team_lead decision via
 * the installed `decide` CLI, and confirms or refuses terminate(). */
const DOUBLE_PROBE = String.raw`
const fs = require("fs"), path = require("path"), cp = require("child_process"), crypto = require("crypto");
const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const api = require(cfg.api);
const actions = [];
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
function work(assignmentAbs) {
  const bytes = fs.readFileSync(assignmentAbs), a = JSON.parse(bytes.toString("utf8"));
  if (cp.spawnSync(cfg.node, [cfg.ackCli, "--assignment", assignmentAbs], { cwd: path.join(cfg.root, "src"), stdio: "ignore" }).status !== 0) throw new Error("ack CLI failed");
  for (const item of a.done_when || []) if (item.oracle === "artifact_exists") { const o = path.join(cfg.root, JSON.parse(item.target).path); fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, "tc artifact\n"); }
  const produced = new Date().toISOString();
  const receipt = ["---", "schema_version: guild.handoff_receipt.v1", "ids:", "  initiative_id: null", "  run_id: " + a.run_id, "  task_id: " + a.logical_task_id, "  task_run_id: " + a.task_run_id,
    "specialist: " + a.worker_role, "host:", "  selected: " + a.host_id, "  degraded: false", "  native_ref: null", "  independence: weak", "scope:", "  objective: " + JSON.stringify(a.objective),
    "  in_scope: " + JSON.stringify(a.scope_paths), "  out_of_scope_touched: []", "status: completed", "changed_files: []", "evidence:", "  - kind: command", "    ref: " + JSON.stringify(a.acceptance_tests[0] || "tc"), "    result: pass",
    "assumptions: []", "open_risks: []", "followups: []", "produced_at: " + produced, "---", "", "## changed_files", "- none", "", "## opens_for", "- lead", "", "## assumptions", "- none", "",
    "## evidence", "- tc transport double", "", "## followups", "- none", "", "` + "```" + String.raw`guild.handoff.v2",
    JSON.stringify({ schema_version: "guild.handoff.v2", task_id: a.logical_task_id, tier: "mid", status: "done", summary: "tc transport double lane", artifacts: [], issues: [] }), "` + "```" + String.raw`", ""].join("\n");
  const rp = path.join(cfg.root, ".guild", "runs", a.run_id, "handoffs", a.worker_role + "-" + a.logical_task_id + ".md");
  fs.mkdirSync(path.dirname(rp), { recursive: true }); fs.writeFileSync(rp, receipt);
  // X2: the notice comes only from the packaged TaskCompleted hook (synthetic fixture event, never a native witness).
  // Worker-equivalent child env: the private binding ref is dropped in this child only, and the public identity and the
  // producer-form absolute assignment come from the current assignment; the parent, ack and decide env are untouched.
  const hookEnv = { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: a.run_id, GUILD_TASK_ID: a.logical_task_id, GUILD_SPECIALIST: a.worker_role,
    GUILD_TASK_ASSIGNMENT: assignmentAbs, GUILD_TASK_CELL_INSTANCE_ID: a.instance_id };
  delete hookEnv.GUILD_RUN_BINDING_REF;
  const np = path.join(cfg.root, ".guild", "runs", a.run_id, "outbox", a.instance_id, "task-completed-notice.json");
  const h = cp.spawnSync(cfg.node, [path.join(cfg.pkg, "hooks", "agent-team", "dist", "task-completed.js")], { cwd: cfg.root, env: hookEnv, stdio: ["pipe", "ignore", "ignore"], timeout: 120000,
    input: JSON.stringify({ hook_event_name: "TaskCompleted", cwd: cfg.root, task_id: a.logical_task_id, teammate_name: a.worker_role, team_name: "tc-double", session_id: "tc-double" }) });
  fs.writeFileSync(path.join(cfg.root, ".tc-double-hook-result.json"), JSON.stringify({ invocation: "synthetic_fixture_event", hook_exit: h.status, notice_present: fs.existsSync(np), receipt_sha256: sha(receipt) }) + "\n");
}
const worker = { mode: "native", losses: [], isAvailable: () => true, ready: () => ({ ok: true, reason: null }),
  spawn: () => { actions.push("spawn"); return { ok: true, reason: null }; },
  notifyAssignment: (i) => { actions.push("notify"); work(path.resolve(cfg.root, i.assignment_path)); return { ok: true, reason: null }; },
  terminate: () => { actions.push("terminate"); return cfg.refuseTerminate ? { ok: false, reason: "transport double: teardown refused" } : { ok: true, reason: null }; } };
const decided = new Set();
const sleep = async () => {
  const cells = path.join(cfg.root, ".guild", "runs", cfg.runId, "task-cells");
  if (!fs.existsSync(cells)) return;
  for (const rel of fs.readdirSync(cells, { recursive: true })) {
    if (path.basename(String(rel)) !== "handoff-validation.json") continue;
    const iid = path.basename(path.dirname(path.join(cells, String(rel))));
    if (decided.has(iid)) continue;
    decided.add(iid);
    cp.spawnSync(cfg.node, [cfg.controllerCli, "decide", "--root", cfg.root, "--run", cfg.runId, "--instance", iid, "--lead-binding-id", cfg.lead, "--decision", "accepted"], { stdio: "ignore", env: process.env });
  }
};
const r = api.startTaskCellController({ cwd: cfg.root, runId: cfg.runId, phase: "build", workerTrustPolicy: "cooperative_local", packageRoot: cfg.pkg, proposal: cfg.proposal,
  worker, rungPlan: cfg.rungPlan, sleep, reviewedBasis: cfg.basis });
if (!r.ok) { process.stdout.write(JSON.stringify({ start: r.reason })); process.exit(0); }
(async () => {
  r.controller.writeStationPlan(cfg.teamPlan);
  const out = await r.controller.runLane(cfg.lane);
  r.controller.close();
  process.stdout.write(JSON.stringify({ out, actions }));
})().catch((e) => { process.stdout.write(JSON.stringify({ error: String(e && e.message) })); });
`;

/** Run one lane through the installed facade with the transport double; optional fault preload plan. */
function doubleLane(t: Tc, o: { refuseTerminate: boolean; faultPlan?: Record<string, unknown> }): Record<string, any> {
  const dir = path.join(t.root, ".tc-probe");
  fs.mkdirSync(dir, { recursive: true });
  // Named task-cell-controller.js so tc/fs-fault-preload.cjs applies when a fault plan is given.
  const probe = path.join(dir, "task-cell-controller.js");
  fs.writeFileSync(probe, DOUBLE_PROBE);
  const { descriptor } = genuineBasis();
  const cfg = {
    api: path.join(PKG, "runtime", "scripts", "task-cell-api.js"), controllerCli: script(PKG, "task-cell-controller"), ackCli: script(PKG, "task-cell-ack"),
    node: NODE, root: t.root, runId: t.runId, pkg: PKG, proposal: t.proposal, rungPlan: FULL_RUNGS, lead: TC_LEAD, refuseTerminate: o.refuseTerminate,
    basis: { root: descriptor.root, proposalPath: descriptor.proposal_path, decisionPath: descriptor.decision_path, requestPath: descriptor.request_path },
    teamPlan: JSON.parse(fs.readFileSync(t.teamPlanPath, "utf8")),
    lane: { ...JSON.parse(fs.readFileSync(t.lanesPath, "utf8"))[0], ready_timeout_ms: 60_000, ack_timeout_ms: 60_000, receipt_timeout_ms: 60_000, review_timeout_ms: 60_000 },
  };
  const cfgPath = path.join(dir, "cfg.json");
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const env = { ...t.env };
  if (o.faultPlan) {
    const planFile = path.join(t.root, ".tc-fault-plan.json");
    fs.writeFileSync(planFile, JSON.stringify({ root: t.root, runId: t.runId, ...o.faultPlan }));
    Object.assign(env, { NODE_OPTIONS: `--require ${FAULT_PRELOAD}`, E00_TC_FAULT_PLAN: planFile });
  }
  const res = spawnSync(NODE, [probe, cfgPath], { cwd: t.root, env, encoding: "utf8", timeout: 240_000 });
  return JSON.parse(res.stdout || "{}");
}

describe.skipIf(!enabled)("TC · C-R4 accepted-fact cleanup settles from actual state (installed task-cell-api, transport double)", () => {
  const attemptT1 = (t: Tc) => JSON.parse(fs.readFileSync(findFile(path.join(t.runDir, "task-cells", "T1"), "attempt.json")!, "utf8"));
  const handleT1 = (t: Tc, iid: string) => JSON.parse(fs.readFileSync(path.join(t.runDir, "controller", "handles", `${iid}.json`), "utf8"));

  it("R4-A1: a valid post-final release keeps qualified_release true despite a refused cleanup; pending teardown is exposed and the closed audit fails", () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const r = doubleLane(t, { refuseTerminate: true });
    expect(r.out).toMatchObject({ state: "terminating", awaiting: "teardown", qualified_release: true });
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).not.toBeNull();
    expect(attemptT1(t)).toMatchObject({ orphaned: true });
    expect(attemptT1(t).terminal_state ?? null).toBeNull();
    expect(inst(status(t), "T1")).toMatchObject({ mechanical_acceptance: "accepted", qualified_release: true });
    expect(handleT1(t, r.out.instance_id)).toMatchObject({ runtime_state: "terminating", awaiting: "teardown" });
    expect(audit(t).status).not.toBe(0);
  });

  it("C-r4-F1: an accepted fact whose final.json cannot be written, with a refused cleanup, reports actual terminating/orphaned/awaiting teardown", () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const r = doubleLane(t, { refuseTerminate: true, faultPlan: { failFinalWrites: true } });
    const log = fs.readFileSync(path.join(t.root, ".tc-fault-log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(log.some((e) => e.kind === "final_write_failed")).toBe(true);
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).toBeNull();
    expect(JSON.parse(fs.readFileSync(findFile(path.join(t.runDir, "task-cells", "T1"), "handoff-acceptance.json")!, "utf8")).downstream_release_at).not.toBeNull();
    expect(r.out).toMatchObject({ state: "terminating", awaiting: "teardown", qualified_release: false });
    expect(attemptT1(t)).toMatchObject({ orphaned: true });
    expect(attemptT1(t).terminal_state ?? null).toBeNull();
    expect(handleT1(t, r.out.instance_id)).toMatchObject({ runtime_state: "terminating", awaiting: "teardown" });
  });
});

// ── C-R5 (G-lane:E00-C r5 C-r5-F1/F2). Installed-package cases over the ordinary CLI
// transport; NOT executed until E00-Q supplies the clean package and genuine basis.

describe.skipIf(!enabled)("TC · C-R5 closed audit verifies cleanup; a post-seal cleanup failure stays physically confirmed", () => {
  const cleanupFile = (t: Tc) => findFile(path.join(t.runDir, "controller", "cleanup"), "cleanup.json")!;

  it("C-r5-F1: removing cleanup.json from a closed, qualified run makes the installed closed audit fail", async () => {
    const { t } = await positive();
    expect(audit(t).status).toBe(0);
    fs.rmSync(cleanupFile(t));
    expect(audit(t).status).not.toBe(0);
  }, T);

  it("C-r5-F1: a missing terminated event line fails the closed audit even when cleanup.json is forged complete", async () => {
    const { t, log } = await faultRun([{ id: "T1", role: "backend" }], { failEventAppend: { event_name: "terminated", logical_task_id: "T1" } },
      (s) => !["pending", "unknown", undefined].includes(inst(s, "T1")?.cleanup_state));
    expect(log.filter((e) => e.kind === "event_append_failed")).toHaveLength(1);
    const f = cleanupFile(t);
    const c = JSON.parse(fs.readFileSync(f, "utf8"));
    fs.writeFileSync(f, JSON.stringify({ ...c, cleanup_state: "complete", terminal_telemetry_state: "complete" }, null, 2) + "\n");
    expect(audit(t).status).not.toBe(0);
  }, T);

  it("C-r5-F2: a cleanup step failing after the physical seal leaves the lane terminal with no pending teardown", async () => {
    const { t, s, log } = await faultRun([{ id: "T1", role: "backend" }], { failFirstHandleWriteAfterSeal: true },
      (s) => inst(s, "T1")?.attempt_terminal_state != null && !["pending", "unknown", undefined].includes(inst(s, "T1")?.cleanup_state));
    expect(log.filter((e) => e.kind === "handle_write_failed_after_seal")).toHaveLength(1);
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "accepted", attempt_terminal_state: "terminated" });
    expect(inst(s, "T1").awaiting ?? null).not.toBe("teardown");
    const handle = JSON.parse(fs.readFileSync(path.join(t.runDir, "controller", "handles", `${inst(s, "T1").instance_id}.json`), "utf8"));
    expect(handle).toMatchObject({ runtime_state: "terminated", awaiting: null });
  }, T);
});

// ── C-R6 (bounded review r6 F1). Installed-package case; NOT executed until E00-Q
// supplies the clean package and genuine basis.

describe.skipIf(!enabled)("TC · C-R6 the installed closed audit verifies final_sha256 against an existing final.json", () => {
  it("C-r6-F1: setting cleanup.json final_sha256 to null while final.json exists makes the installed closed audit fail", async () => {
    const { t } = await positive();
    expect(audit(t).status).toBe(0);
    const f = findFile(path.join(t.runDir, "controller", "cleanup"), "cleanup.json")!;
    expect(findFile(path.join(t.runDir, "controller"), "final.json")).not.toBeNull();
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), final_sha256: null }, null, 2) + "\n");
    expect(audit(t).status).not.toBe(0);
  }, T);
});

// ── E00-L (L5/Q3/Q4). Installed-package case over the ordinary CLI transport; NOT executed
// until E00-Q supplies the clean package and genuine basis (activation needs the package).

describe.skipIf(!enabled)("TC · E00-L the installed worker receives the exact adopted definition bytes", () => {
  it("the fixture worker's --append-system-prompt-file bytes and the launch evidence both hash to the adopted definition", async () => {
    const { t } = await positive();
    const check = JSON.parse(fs.readFileSync(path.join(t.root, ".tc-worker-env.json"), "utf8"));
    expect(check).toMatchObject({ definition_injection_present: true, definition_injection_absolute: true, definition_injection_sha256: t.adoptedDefinitionSha256 });
    const launch = findFile(path.join(t.runDir, "controller"), "launch") === null
      ? null
      : (fs.readdirSync(path.join(t.runDir, "controller", "launch")).find((n) => n.endsWith(".launch.json")) ?? null);
    expect(launch).not.toBeNull();
    const ev = JSON.parse(fs.readFileSync(path.join(t.runDir, "controller", "launch", launch!), "utf8"));
    expect(ev.definition_injection).toMatchObject({ flag: "--append-system-prompt-file", sha256: t.adoptedDefinitionSha256 });
  }, T);
});

// ── E00-L r1 (L-T0-1 / L-T0-2) POST-FIX. Installed ordinary-CLI case under a C-locale,
// bash-default-shell controller env; NOT executed until E00-Q supplies the package and basis.

describe.skipIf(!enabled)("TC · E00-L r1 the installed controller completes a lane under LC_ALL=C and SHELL=/bin/bash", () => {
  it("captures the pane identity, observes the declared host ready, and completes cleanup", async () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const s = await drive(t, startAsync(t, {}, script(t.pkg, "task-cell-controller"), NODE, { LC_ALL: "C", LANG: "C", SHELL: "/bin/bash" }));
    expect(s.counts).toMatchObject({ total: 1, mechanically_accepted: 1 });
    expect(inst(s, "T1")).toMatchObject({ mechanical_acceptance: "accepted", cleanup_state: "complete" });
    const launchDir = path.join(t.runDir, "controller", "launch");
    const launch = fs.readdirSync(launchDir).find((n) => n.endsWith(".launch.json"));
    expect(launch).toBeDefined();
    const ev = JSON.parse(fs.readFileSync(path.join(launchDir, launch!), "utf8"));
    expect(ev.state ?? null).not.toBe("identity_unknown");
    expect(ev.pane.pane_id).toMatch(/^%\d+$/);
  }, T);
});

// ── E00 C10/L owner lifetime and H5 qualified release. Installed-package cases over the
// ordinary CLI; NOT executed until E00-Q supplies the clean package and genuine basis.

describe.skipIf(!enabled)("TC · E00 owner lifetime: the installed controller keeps supervising while an unknown-spawn worker may live", () => {
  it("unknown spawn settles as an orphan awaiting teardown; the owner process stays alive with fresh heartbeats; the pane stays live; no station result", async () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    fs.writeFileSync(t.tmux.malformCreate, "");
    const child = startAsync(t);
    let exited = false;
    child.on("exit", () => { exited = true; });
    try {
      const until = Date.now() + 120_000;
      let s: Record<string, any> = {};
      while (Date.now() < until) {
        await sleep(1000);
        s = status(t);
        if (inst(s, "T1")?.awaiting === "teardown") break;
      }
      // Precondition: the unknown spawn really happened and a real pane is live.
      expect(inst(s, "T1")).toMatchObject({ awaiting: "teardown", attempt_terminal_state: null, qualified_release: false });
      const panes = spawnSync(t.tmux.realTmux, ["-S", t.tmux.socket, "list-panes", "-a", "-F", "#{pane_id}"], { encoding: "utf8" });
      expect(panes.stdout.split("\n").filter(Boolean).length).toBe(1);
      // Owner lifetime: across three heartbeat periods the process is alive and the heartbeat advances.
      const hb = path.join(t.runDir, "controller", "heartbeat.json");
      const seen = new Set<string>();
      for (let i = 0; i < 4; i++) {
        const h = JSON.parse(fs.readFileSync(hb, "utf8"));
        expect({ exited, state: h.state }).toEqual({ exited: false, state: "supervising" });
        seen.add(h.heartbeat_at);
        await sleep(5_500);
      }
      expect(seen.size).toBeGreaterThan(1);
      expect(fs.existsSync(path.join(t.runDir, "team-result"))).toBe(false);
    } finally {
      fs.rmSync(t.tmux.malformCreate, { force: true });
      if (!exited) child.kill("SIGTERM");
    }
  }, T);
});

describe.skipIf(!enabled)("TC · H5 qualified E00 release: the installed TeammateIdle hook reports downstream=released", () => {
  it("after the installed positive lane, the package's own hook prints downstream=released with termination authorized", async () => {
    const { t, s } = await positive();
    const i = inst(s, "T1");
    expect(i).toMatchObject({ qualified_release: true });
    const r = spawnSync(NODE, [path.join(t.pkg, "hooks", "agent-team", "dist", "teammate-idle.js")], {
      input: JSON.stringify({ session_id: t.runId.replace(/^run-/, ""), cwd: t.root, hook_event_name: "TeammateIdle", teammate_name: "backend", team_name: "guild-team" }),
      cwd: t.root, env: { ...t.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }, encoding: "utf8", timeout: 60_000,
    });
    expect(r.stdout).toMatch(/\[LANE-ACCEPTED\]/);
    expect(r.stdout).toMatch(new RegExp(`\\[TERMINATE-AUTHORIZED\\][^\\n]*instance=${i.instance_id} downstream=released`));
  }, T);
});

// ── C11 loss observation (implementation/e00/loss-process-observation-interface.v1.json).
// Installed-package case over the ordinary CLI; NOT executed until E00-Q supplies the
// clean package and genuine basis.

describe.skipIf(!enabled)("TC · C11 loss: an unavailable process table never seals a live worker", () => {
  it("SIGKILL owner, live worker pane, failing ps first on PATH: record-loss exits 0, the attempt stays nonterminal/orphaned, the pane stays live", async () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const child = startAsync(t);
    await waitFor(() => firstFileIn(path.join(t.runDir, "controller", "handles")));
    await sleep(2000);
    child.kill("SIGKILL");
    await sleep(500);
    const faultBin = path.join(t.root, ".fault-bin");
    fs.mkdirSync(faultBin, { recursive: true });
    fs.writeFileSync(path.join(faultBin, "ps"), "#!/bin/sh\necho 'ps: sysctl: Operation not permitted' >&2\nexit 1\n", { mode: 0o755 });
    const env = { ...t.env, PATH: `${faultBin}:${t.env["PATH"]}` };
    // Activation: the ps the CLI resolves really fails with an error.
    const probe = spawnSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { env, encoding: "utf8" });
    expect({ status: probe.status, err: /Operation not permitted/.test(probe.stderr ?? "") }).toEqual({ status: 1, err: true });
    const panesBefore = spawnSync(t.tmux.realTmux, ["-S", t.tmux.socket, "list-panes", "-a", "-F", "#{pane_id}"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    expect(panesBefore.length).toBeGreaterThan(0);
    const loss = spawnSync(NODE, [script(t.pkg, "task-cell-controller"), ...withRoot(["record-loss", "--run", t.runId], t.root)], { cwd: t.root, env, encoding: "utf8", timeout: 120000 });
    expect(loss.status).toBe(0);
    expect(loss.stdout ?? "").not.toMatch(/sealed_controller_lost|process_gone_server_changed/);
    const s = status(t);
    expect(inst(s, "T1")).toMatchObject({ attempt_terminal_state: null, cleanup_state: "orphaned" });
    const panesAfter = spawnSync(t.tmux.realTmux, ["-S", t.tmux.socket, "list-panes", "-a", "-F", "#{pane_id}"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    expect(panesAfter).toEqual(panesBefore);
  }, T);
});

// ── C11-A3 / C12 owner proof through the installed record-loss CLI. Gated; NOT executed
// until E00-Q supplies the clean package and genuine basis.

function faultBinWith(t: Tc, name: "ps" | "sysctl", body: string): Record<string, string> {
  const dir = path.join(t.root, `.fault-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { ...t.env, PATH: `${dir}:${t.env["PATH"]}` };
}
const recordLoss = (t: Tc, env: Record<string, string>) =>
  spawnSync(NODE, [script(t.pkg, "task-cell-controller"), ...withRoot(["record-loss", "--run", t.runId], t.root)], { cwd: t.root, env, encoding: "utf8", timeout: 120000 });

describe.skipIf(!enabled)("TC · C11-A3/C12 owner proof via the installed record-loss CLI", () => {
  it("live installed owner with a failing ps: record-loss refuses controller_not_dead; the worker pane stays live", async () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const child = startAsync(t);
    try {
      await waitFor(() => firstFileIn(path.join(t.runDir, "controller", "handles")));
      const env = faultBinWith(t, "ps", "echo 'ps: sysctl: Operation not permitted' >&2\nexit 1");
      const probe = spawnSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { env, encoding: "utf8" });
      expect(probe.status).toBe(1);
      const panesBefore = spawnSync(t.tmux.realTmux, ["-S", t.tmux.socket, "list-panes", "-a", "-F", "#{pane_id}"], { encoding: "utf8" }).stdout;
      const loss = recordLoss(t, env);
      expect(`${loss.stdout}${loss.stderr}`).toContain("controller_not_dead");
      expect(fs.existsSync(path.join(t.runDir, "controller", "loss"))).toBe(false);
      expect(spawnSync(t.tmux.realTmux, ["-S", t.tmux.socket, "list-panes", "-a", "-F", "#{pane_id}"], { encoding: "utf8" }).stdout).toBe(panesBefore);
    } finally {
      child.kill("SIGTERM");
    }
  }, T);

  it("SIGKILLed installed owner with a failing current-boot sysctl: absent owner pid is dead; record-loss proceeds", async () => {
    const t = tc([{ id: "T1", role: "backend" }]);
    const child = startAsync(t);
    await waitFor(() => firstFileIn(path.join(t.runDir, "controller", "handles")));
    await sleep(2000);
    child.kill("SIGKILL");
    await sleep(500);
    const env = faultBinWith(t, "sysctl", "echo 'sysctl: unknown oid' >&2\nexit 1");
    expect(spawnSync("sysctl", ["-n", "kern.bootsessionuuid"], { env, encoding: "utf8" }).status).toBe(1);
    const loss = recordLoss(t, env);
    expect(loss.status).toBe(0);
    expect(status(t).loss_recorded).toBe(true);
  }, T);
});

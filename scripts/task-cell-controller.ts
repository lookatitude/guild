#!/usr/bin/env -S npx tsx
/**
 * scripts/task-cell-controller.ts — the E00 TaskCell controller CLI (CD5–CD8, CD12, CD14).
 *
 * Usage (every subcommand takes an absolute --root; the cwd is never used):
 *   task-cell-controller start          --root <abs> --run <id> --phase <station> --worker-trust-policy <cooperative_local|isolated_worker>
 *                                       --lanes <abs LaneSpec[] JSON> --team-plan <abs guild.team_plan.v1> --proposal <abs guild.team_proposal.v2>
 *                                       [--package-root <abs> --reviewed-basis <abs guild.source_basis_descriptor.v1>]
 *   task-cell-controller status         --root <abs> --run <id> --consumer-policy <cooperative_local|isolated_worker>
 *                                       [--consumer-context same_run|release:<context.json>] [--view-version <v>]
 *   task-cell-controller record-loss    --root <abs> --run <id>
 *   task-cell-controller approve-oracles --root <abs> --run <id> --phase <station> --decided-by <operator>
 *   task-cell-controller decide         --root <abs> --run <id> --instance <id> --lead-binding-id <id>
 *                                       --decision <accepted|rejected> [--reason <text>]
 *
 * Stdout: one JSON object. Exit: 0 ok · 1 usage · 2 refused.
 *
 * `status` performs zero writes. `record-loss` runs only on dead-owner proof and
 * re-verifies pane pid + start before any kill; the kill itself is the tmux
 * server-side identity-bound action (terminateBoundPane), so a replacement server
 * behind the same socket is never killed.
 * `start` composes the controller-owned tmux worker port and drives the approved
 * lanes in dependency order, staying alive (owner + heartbeat) while any spawned
 * worker is not terminal. Stopping it then leaves a dead owner for record-loss.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  approveOraclePlan,
  readControllerStatus,
  recordAuthorityDecision,
  recordControllerLoss,
  startTaskCellController,
  type LossTeardownPort,
  type ReviewedBasisInput,
  type TaskCellController,
} from "../src/domains/dispatch";
import { familyForHostId, rungKeyForSession, rungPlanForFamily } from "../src/adapters";
import { resolveAdoptedDefinition } from "./lib/capability/definition-ref-for-dispatch";
import { durableGuildDir } from "./lib/state/storage";
import {
  observeProcessStart,
  terminateBoundPane,
  tmuxPanePid,
  tmuxServerIdentity,
  TmuxTaskCellWorkerPort,
} from "./lib/host/tmux-backend";

// The pure read-only resolver lives with the other definition readers; re-exported
// so existing importers of this CLI module keep resolving it.
export { resolveAdoptedDefinition };

type LaneSpec = Parameters<TaskCellController["runLane"]>[0];
type LaneOutcome = Awaited<ReturnType<TaskCellController["runLane"]>>;

type Args = Record<string, string>;

const SUBCOMMANDS = ["start", "status", "record-loss", "approve-oracles", "decide"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

export function parseControllerArgs(argv: string[]): { sub: Subcommand; args: Args } | { error: string } {
  const [sub, ...rest] = argv;
  if (!(SUBCOMMANDS as readonly string[]).includes(sub ?? "")) return { error: `usage: task-cell-controller <${SUBCOMMANDS.join("|")}> ...` };
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) return { error: `unexpected argument: ${a}` };
    const eq = a.indexOf("=");
    if (eq > 0) args[a.slice(2, eq)] = a.slice(eq + 1);
    else if (rest[i + 1] !== undefined && !rest[i + 1].startsWith("--")) args[a.slice(2)] = rest[++i];
    else return { error: `missing value for ${a}` };
  }
  if (!args["root"] || !path.isAbsolute(args["root"])) return { error: "--root <absolute Guild root> is required" };
  if (!args["run"]) return { error: "--run <run id> is required" };
  return { sub: sub as Subcommand, args };
}

/**
 * The scripts-layer teardown record-loss maps per CD6. Server identity is tmux's own
 * pid + #{start_time} (the form the worker port records), and the kill is the
 * server-side identity-bound action: without the recorded identity it never kills.
 */
export function tmuxLossTeardown(): LossTeardownPort {
  // C12 contract: serverIdentity/panePid map every read failure to null; only
  // processStart throws on an unavailable observation (null is proven absence).
  const orNull = <T>(read: () => T | null): T | null => {
    try {
      return read();
    } catch {
      return null;
    }
  };
  return {
    serverIdentity: () => orNull(() => tmuxServerIdentity()),
    panePid: (paneId) => orNull(() => tmuxPanePid(paneId)),
    terminatePane: (paneId, expected) => {
      if (!expected) {
        return { ok: false, confirmed: false, degraded: false, polls: 0, error: "no recorded identity; no kill", identity_check: "unavailable" as const };
      }
      const r = terminateBoundPane(paneId, expected);
      return { ok: r.ok, confirmed: r.confirmed, degraded: r.degraded, polls: r.polls, error: r.error ?? null, identity_check: r.identity_check };
    },
    processStart: (pid) => {
      const o = observeProcessStart(pid);
      if (o.kind === "observed") return o.start;
      if (o.kind === "absent") return null;
      throw new Error(`process observation unavailable for pid ${pid}: ${o.detail}`);
    },
  };
}

const TERMINAL_LANE_STATES = new Set(["terminated", "rejected", "failed", "timed_out", "cancelled"]);

/** Refusals on the approved lane inputs, decided before any claim is written. */
export function validateLaneInputs(lanes: unknown): { ok: true; lanes: LaneSpec[]; family: string } | { ok: false; reason: string; detail: string } {
  if (!Array.isArray(lanes) || lanes.length === 0) return { ok: false, reason: "lanes_invalid", detail: "--lanes must be a non-empty LaneSpec[]" };
  const ids = new Set<string>();
  const families = new Set<string>();
  for (const lane of lanes as LaneSpec[]) {
    if (!lane || typeof lane.logical_task_id !== "string" || lane.logical_task_id.length === 0) {
      return { ok: false, reason: "lanes_invalid", detail: "every lane needs a logical_task_id" };
    }
    if (ids.has(lane.logical_task_id)) return { ok: false, reason: "lanes_invalid", detail: `duplicate logical_task_id ${lane.logical_task_id}` };
    ids.add(lane.logical_task_id);
    const family = familyForHostId(lane.host?.host_id);
    if (!family) return { ok: false, reason: "host_unknown", detail: `${lane.logical_task_id}: host ${lane.host?.host_id} is not a registry host` };
    families.add(family);
  }
  if (families.size !== 1) return { ok: false, reason: "host_family_mixed", detail: [...families].join(",") };
  // CD13: a dependency names a logical task of this station, never a role.
  for (const lane of lanes as LaneSpec[]) {
    for (const dep of lane.dependencies ?? []) {
      if (!ids.has(dep)) return { ok: false, reason: "dependency_not_logical_task", detail: `${lane.logical_task_id} depends on ${dep}` };
    }
  }
  return { ok: true, lanes: lanes as LaneSpec[], family: [...families][0]! };
}

/** The packaged ack CLI beside this one (compiled .js, or the .ts source under its own runtime). */
function ackArgv(): string[] {
  const js = path.join(__dirname, "task-cell-ack.js");
  return [process.execPath, fs.existsSync(js) ? js : path.join(__dirname, "task-cell-ack.ts")];
}

/**
 * Drive every approved lane: a lane runs only once each dependency lane holds a
 * qualified release (no prewarm); lanes whose dependencies can no longer qualify
 * are reported blocked, which writes nothing.
 */
export async function driveStation(controller: TaskCellController, lanes: readonly LaneSpec[]): Promise<LaneOutcome[]> {
  const outcomes = new Map<string, LaneOutcome>();
  let pending = [...lanes];
  while (pending.length > 0) {
    const ready = pending.find((lane) => lane.dependencies.every((d) => outcomes.get(d)?.qualified_release === true));
    if (!ready) {
      for (const lane of pending) outcomes.set(lane.logical_task_id, await controller.runLane(lane));
      break;
    }
    outcomes.set(ready.logical_task_id, await controller.runLane(ready));
    pending = pending.filter((lane) => lane !== ready);
  }
  return lanes.map((lane) => outcomes.get(lane.logical_task_id)!);
}

/** A spawned worker whose lane is not in a terminal D5 state (or is orphaned) keeps the owner alive. */
export function controlledNonterminal(outcomes: readonly LaneOutcome[]): LaneOutcome[] {
  return outcomes.filter((o) => o.instance_id !== null && (!TERMINAL_LANE_STATES.has(o.state) || o.orphaned === true));
}

function readJsonArg(file: string | undefined, label: string): unknown {
  if (!file) throw Object.assign(new Error(`--${label} is required`), { usage: true });
  if (!path.isAbsolute(file)) throw Object.assign(new Error(`--${label} must be an absolute path`), { usage: true });
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** guild.source_basis_descriptor.v1 → ReviewedBasisInput (paths stay relative to the basis root). */
export function readBasisDescriptor(file: string): ReviewedBasisInput {
  const d = readJsonArg(file, "reviewed-basis") as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" && (d[k] as string).length > 0 ? (d[k] as string) : null);
  const root = str("root");
  if (d["schema_version"] !== "guild.source_basis_descriptor.v1" || !root || !path.isAbsolute(root) ||
      !str("proposal_path") || !str("decision_path") || !str("request_path")) {
    throw Object.assign(new Error("--reviewed-basis is not a guild.source_basis_descriptor.v1"), { usage: true });
  }
  return { root, proposalPath: str("proposal_path")!, decisionPath: str("decision_path")!, requestPath: str("request_path")! };
}

export async function runController(sub: Subcommand, args: Args): Promise<{ code: number; body: unknown }> {
  const root = args["root"];
  const runId = args["run"];
  const refused = (body: { ok?: unknown }) => ({ code: body.ok === false ? 2 : 0, body });
  switch (sub) {
    case "status": {
      const ctx = args["consumer-context"];
      let consumerContext: { mode: "same_run" } | { mode: "release"; context: never } = { mode: "same_run" };
      if (ctx && ctx !== "same_run") {
        if (!ctx.startsWith("release:")) return { code: 1, body: { ok: false, reason: "consumer_context_invalid" } };
        consumerContext = { mode: "release", context: JSON.parse(fs.readFileSync(ctx.slice("release:".length), "utf8")) as never };
      }
      const policy = args["consumer-policy"];
      if (policy !== "cooperative_local" && policy !== "isolated_worker") return { code: 1, body: { ok: false, reason: "consumer_policy_required" } };
      try {
        return { code: 0, body: readControllerStatus({ cwd: root, runId, consumerPolicy: policy, consumerContext, viewVersion: args["view-version"] }) };
      } catch (error) {
        return { code: 2, body: { ok: false, reason: (error as { reason?: string }).reason ?? (error as Error).message } };
      }
    }
    case "record-loss":
      return refused(recordControllerLoss({ cwd: root, runId, teardown: tmuxLossTeardown() }) as { ok?: unknown });
    case "approve-oracles":
      return refused(approveOraclePlan({ cwd: root, runId, phase: args["phase"] ?? "", decidedBy: args["decided-by"] ?? "" }));
    case "decide": {
      const decision = args["decision"];
      if (decision !== "accepted" && decision !== "rejected") return { code: 1, body: { ok: false, reason: "decision_invalid" } };
      return refused(recordAuthorityDecision({
        cwd: root, runId, instanceId: args["instance"] ?? "", leadBindingId: args["lead-binding-id"] ?? "",
        decision, reason: args["reason"] ?? null,
      }));
    }
    case "start": {
      // Validate inputs first so a usage error or input refusal writes nothing.
      const lanesInput = readJsonArg(args["lanes"], "lanes");
      const teamPlan = readJsonArg(args["team-plan"], "team-plan");
      const proposal = readJsonArg(args["proposal"], "proposal");
      const policy = args["worker-trust-policy"];
      if (policy !== "cooperative_local" && policy !== "isolated_worker") return { code: 1, body: { ok: false, reason: "worker_trust_policy_required" } };
      const packageRoot = args["package-root"] ?? null;
      if (packageRoot !== null && !path.isAbsolute(packageRoot)) return { code: 1, body: { ok: false, reason: "package_root_not_absolute" } };
      const reviewedBasis = args["reviewed-basis"] ? readBasisDescriptor(args["reviewed-basis"]) : null;
      const lanes = validateLaneInputs(lanesInput);
      if (!lanes.ok) return { code: 2, body: lanes };
      // KTD28: rungs come from the registry family of the approved lanes' host, never a label.
      const rungPlan = rungPlanForFamily(rungKeyForSession({ host_family: lanes.family, surface: lanes.lanes[0]!.host.host_id }), { verify_check_available: false });
      const runDir = path.join(durableGuildDir(root), "runs", runId);
      const launchDir = path.join(runDir, "controller", "launch");
      const worker = new TmuxTaskCellWorkerPort({
        cwd: root,
        sessionName: `guild-tc-${createHash("sha256").update(`${root}\0${runId}`).digest("hex").slice(0, 12)}`,
        snapshotDir: launchDir,
        ackArgv: ackArgv(),
        resolveDefinition: (instance) => resolveAdoptedDefinition(root, instance.worker_role),
        // The same canonical receipt path the controller polls (CD11 step 8).
        receiptPath: (instance) => path.join(runDir, "handoffs", `${instance.worker_role}-${instance.logical_task_id}.md`),
        recordLaunch: (instanceId, evidence) => {
          fs.mkdirSync(launchDir, { recursive: true, mode: 0o700 });
          fs.writeFileSync(path.join(launchDir, `${instanceId}.launch.json`), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        },
      });
      const started = startTaskCellController({
        cwd: root, runId, phase: args["phase"] ?? "", workerTrustPolicy: policy,
        packageRoot, reviewedBasis, proposal: proposal as never, worker, rungPlan, substrate: "tmux",
      });
      if (!started.ok) return refused(started as { ok: false });
      const controller = started.controller;
      const claimId = controller.claim.controller_instance_id;
      try {
        controller.writeStationPlan(teamPlan);
      } catch (error) {
        controller.close("failed_closed");
        return { code: 2, body: { ok: false, reason: (error as { reason?: string }).reason ?? "team_plan_refused", detail: (error as Error).message, controller_instance_id: claimId } };
      }
      const outcomes = await driveStation(controller, lanes.lanes);
      const live = controlledNonterminal(outcomes);
      if (live.length === 0) {
        let teamResult: string | null = null;
        if (outcomes.some((o) => o.instance_id !== null)) teamResult = controller.writeStationResult();
        controller.close("closed");
        return { code: 0, body: { ok: true, controller_instance_id: claimId, team_result: teamResult, outcomes } };
      }
      // A worker is still non-terminal or orphaned: keep the exclusive owner and its
      // heartbeat alive, visibly. Ending this process leaves a dead owner whose loss
      // is recorded only through record-loss; nothing here re-adopts or restarts.
      process.stdout.write(JSON.stringify({ ok: true, controller_instance_id: claimId, supervising: live, outcomes }, null, 2) + "\n");
      await new Promise<never>(() => { setInterval(() => undefined, 60_000); });
      throw new Error("unreachable");
    }
  }
}

async function main(): Promise<number> {
  const parsed = parseControllerArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    return 1;
  }
  try {
    const out = await runController(parsed.sub, parsed.args);
    process.stdout.write(JSON.stringify(out.body, null, 2) + "\n");
    return out.code;
  } catch (error) {
    process.stderr.write(`task-cell-controller: ${(error as Error).message}\n`);
    return (error as { usage?: boolean }).usage ? 1 : 2;
  }
}

if (require.main === module) {
  void main().then((code) => process.exit(code));
}

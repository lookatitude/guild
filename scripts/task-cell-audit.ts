#!/usr/bin/env -S npx tsx
/**
 * Usage: task-cell-audit --cwd <root> --run-id <id> [--open] [--consumer-policy <cooperative_local|isolated_worker>]
 *
 * The closed TaskCell audit. Every run gets the canonical artifact join (bus/CAS,
 * station plan/result, identity, dependencies, and for E00 instances cleanup).
 * An E00 controller run (controller/controller.json present) additionally reports,
 * as separate facts: CD17b qualification of every mechanical acceptance (re-verified
 * now, same_run context), and the controller-loss record. A closed E00 audit passes
 * only when the join passes AND every accepted instance qualifies; cleanup failures
 * fail it through the join without changing qualification.
 * Exit: 0 ok · 1 audit failed · 2 usage.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  auditTaskCellArtifactJoin,
  findRunAcceptances,
  isQualifiedDownstreamRelease,
} from "../src/domains/dispatch";
import { durableGuildDir } from "./lib/state/storage";

function fail(message: string): never {
  process.stderr.write(`[task-cell-audit] ${message}\n`);
  process.exit(2);
}

function readJson(abs: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Loss facts: the one-time marker and every observation, read only. */
function lossFacts(controllerDir: string): { marker: boolean; observations: Array<{ path: string; attempts: unknown }> } {
  const marker = fs.existsSync(controllerDir) && fs.readdirSync(controllerDir).some((n) => /^loss-.+\.json$/.test(n));
  const observations: Array<{ path: string; attempts: unknown }> = [];
  const lossRoot = path.join(controllerDir, "loss");
  if (fs.existsSync(lossRoot)) {
    for (const owner of fs.readdirSync(lossRoot).sort()) {
      const dir = path.join(lossRoot, owner);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const name of fs.readdirSync(dir).filter((n) => n.startsWith("observation-")).sort()) {
        observations.push({ path: path.join(dir, name), attempts: readJson(path.join(dir, name))?.["attempts"] ?? null });
      }
    }
  }
  return { marker, observations };
}

function main(argv: string[]): void {
  let cwd = ".";
  let runId: string | null = null;
  let requireClosed = true;
  let consumerPolicy: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
    else if (arg === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (arg === "--open") requireClosed = false;
    else if (arg === "--consumer-policy" && i + 1 < argv.length) consumerPolicy = argv[++i];
    else fail(`unknown or incomplete argument: ${arg}`);
  }
  if (!runId || !/^[A-Za-z0-9_.-]+$/.test(runId)) fail("--run-id <safe-id> is required");
  if (consumerPolicy !== null && consumerPolicy !== "cooperative_local" && consumerPolicy !== "isolated_worker") {
    fail("--consumer-policy must be cooperative_local or isolated_worker");
  }
  const root = path.resolve(cwd);
  const audit = auditTaskCellArtifactJoin({ cwd: root, runId, requireClosed });

  const controllerDir = path.join(durableGuildDir(root), "runs", runId, "controller");
  const claim = readJson(path.join(controllerDir, "controller.json"));
  if (!claim) {
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
    process.exit(audit.ok ? 0 : 1);
  }

  // The audit's consumer policy is explicit, or the producing run's own recorded policy.
  const policy = consumerPolicy ?? (typeof claim["worker_trust_policy"] === "string" ? (claim["worker_trust_policy"] as string) : null);
  const qualification = findRunAcceptances(root, runId)
    .filter((ra) => ra.acceptance.downstream_release_at !== null)
    .map((ra) => {
      if (policy !== "cooperative_local" && policy !== "isolated_worker") {
        return { instance_id: ra.ids.instance_id, logical_task_id: ra.ids.logical_task_id, qualified_release: false, reason: "consumer_policy_unknown" };
      }
      const verdict = isQualifiedDownstreamRelease(root, ra, { policy, context: { mode: "same_run" } });
      return {
        instance_id: ra.ids.instance_id,
        logical_task_id: ra.ids.logical_task_id,
        qualified_release: verdict.qualified_release,
        reason: verdict.reason,
      };
    });
  const allQualified = qualification.every((q) => q.qualified_release);
  const e00 = {
    controller_instance_id: claim["controller_instance_id"] ?? null,
    consumer_policy: policy,
    consumer_policy_source: consumerPolicy !== null ? "argument" : "controller_claim",
    qualification,
    loss: lossFacts(controllerDir),
  };
  const ok = audit.ok && (!requireClosed || allQualified);
  process.stdout.write(`${JSON.stringify({ ...audit, ok, join_ok: audit.ok, e00 }, null, 2)}\n`);
  process.exit(ok ? 0 : 1);
}

main(process.argv.slice(2));

#!/usr/bin/env -S npx tsx
/** Installed-host TaskCell lifecycle conformance matrix (G9). */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  TASK_CELL_HOST_CONFORMANCE_SCHEMA,
  buildTaskCellHostConformanceMatrix,
  runTaskCellHostConformance,
  verifyTaskCellHostConformanceReceipt,
  type HostProbeInvocation,
  type HostProbeInvocationInput,
  type HostProbePreflight,
  type HostProbeRunner,
  type NormalizedHostHandoff,
  type TaskCellHostConformanceReceipt,
} from "../src/modules/dispatch/workflows/task-cell-host-conformance";
import type { TaskCellMechanicsMode } from "../src/modules/dispatch/workflows/task-cell-runtime";
import { normalizeResult } from "./lib/result-normalizer";

interface CliArgs {
  hosts: string[];
  cwd: string;
  run_id: string;
  wrapper: string;
  output: string;
  receipt_files: string[];
}

export function parseArgs(argv: string[]): CliArgs | { error: string } {
  const hosts: string[] = [];
  let cwd = process.cwd();
  let runId = `run-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "")}-task-cell-host-conformance`;
  let wrapper = path.resolve(__dirname, "guild-run.ts");
  let output: string | undefined;
  const receiptFiles: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--host" && next) hosts.push(next), i += 1;
    else if (arg === "--hosts" && next) hosts.push(...next.split(",").map((item) => item.trim()).filter(Boolean)), i += 1;
    else if (arg === "--cwd" && next) cwd = path.resolve(next), i += 1;
    else if (arg === "--run-id" && next) runId = next, i += 1;
    else if (arg === "--wrapper" && next) wrapper = path.resolve(next), i += 1;
    else if (arg === "--output" && next) output = path.resolve(next), i += 1;
    else if (arg === "--receipt" && next) receiptFiles.push(path.resolve(next)), i += 1;
    else return { error: `unknown or incomplete argument: ${arg}` };
  }
  const uniqueHosts = [...new Set(hosts)];
  if (uniqueHosts.length === 0 && receiptFiles.length === 0) return { error: "at least one --host/--hosts or --receipt value is required" };
  if (!/^[A-Za-z0-9_.-]+$/.test(runId)) return { error: "--run-id must be a safe path segment" };
  return {
    hosts: uniqueHosts,
    cwd,
    run_id: runId,
    wrapper,
    output: output ?? path.join(cwd, ".guild", "runs", runId, "task-cell-host-conformance", "matrix.json"),
    receipt_files: receiptFiles,
  };
}

function recordObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readJson(file: string): unknown | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function parseStdoutJson(stdout: string): unknown | null {
  try { return JSON.parse(stdout); } catch { return null; }
}

function collectDegradation(plan: Record<string, unknown>): string[] {
  const reasons = new Set<string>();
  const launch = recordObject(plan.launch);
  if (launch?.degraded === true && typeof launch.reason === "string") reasons.add(launch.reason);
  const adapter = recordObject(plan.host_adapter);
  for (const key of ["preflight", "model_params", "dispatch"]) {
    const operation = recordObject(adapter?.[key]);
    const receipt = recordObject(operation?.receipt);
    const degradation = recordObject(receipt?.degradation_receipt);
    if (receipt?.status === "degraded" && typeof receipt.reason === "string") reasons.add(receipt.reason);
    if (degradation?.degraded === true && typeof degradation.reason === "string") reasons.add(degradation.reason);
  }
  return [...reasons];
}

function mechanicsMode(plan: Record<string, unknown>): TaskCellMechanicsMode {
  const adapter = recordObject(plan.host_adapter);
  const dispatch = recordObject(adapter?.dispatch);
  const receipt = recordObject(dispatch?.receipt);
  const degradation = recordObject(receipt?.degradation_receipt);
  const rung = degradation?.rung;
  if (["native", "wrapped", "bridged", "emulated", "degraded"].includes(String(rung))) {
    return rung as TaskCellMechanicsMode;
  }
  return collectDegradation(plan).length === 0 ? "native" : "degraded";
}

export class GuildRunHostProbeRunner implements HostProbeRunner {
  constructor(private readonly wrapper: string) {}

  private spawn(args: string[], cwd: string) {
    return spawnSync("npx", ["tsx", this.wrapper, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  preflight(input: { host: string; cwd: string; run_id: string }): HostProbePreflight {
    const result = this.spawn([
      "--host", input.host,
      "--mode", "read_only",
      "--cwd", input.cwd,
      "--prompt", "installed-host TaskCell conformance preflight",
      "--contract", "guild.handoff.v2",
      "--dry-run",
    ], input.cwd);
    const plan = recordObject(parseStdoutJson(result.stdout ?? ""));
    const adapter = recordObject(plan?.host_adapter);
    const boundary = recordObject(adapter?.boundary);
    const errors: string[] = [];
    if (result.error) errors.push(result.error.message);
    if (result.status !== 0) errors.push(`guild-run preflight exited ${result.status ?? 127}`);
    if (!plan) errors.push("guild-run preflight did not emit a JSON plan");
    if (boundary?.disposition !== "succeeded") errors.push("host adapter boundary did not bind the requested host");
    const boundHostId = typeof boundary?.host_id === "string" ? boundary.host_id : null;
    const snapshotHash = typeof boundary?.capability_snapshot_hash === "string" ? boundary.capability_snapshot_hash : null;
    if (!boundHostId) errors.push("preflight omitted the bound host id");
    if (!snapshotHash) errors.push("preflight omitted the capability snapshot hash");
    const launch = recordObject(plan?.launch);
    return {
      ok: errors.length === 0,
      requested_host: input.host,
      bound_host_id: boundHostId,
      capability_snapshot_hash: snapshotHash,
      mechanics_mode: plan ? mechanicsMode(plan) : "degraded",
      launch_requested: typeof launch?.requested === "string" ? launch.requested : null,
      launch_effective: typeof launch?.effective === "string" ? launch.effective : null,
      degradation_reasons: plan ? collectDegradation(plan) : [],
      evidence: plan,
      errors,
    };
  }

  invoke(input: HostProbeInvocationInput): HostProbeInvocation {
    const recordAbs = path.resolve(input.cwd, input.record_path);
    const result = this.spawn([
      "--host", input.host,
      "--mode", "read_only",
      "--cwd", input.cwd,
      "--prompt", input.prompt,
      "--contract", "guild.handoff.v2",
      "--max-repair", "1",
      "--record", recordAbs,
    ], input.cwd);
    const wrapperRecord = readJson(recordAbs);
    const normalized = normalizeResult(result.stdout ?? "", "guild.handoff.v2");
    const errors = [...normalized.errors];
    if (result.error) errors.push(result.error.message);
    return {
      exit: result.status ?? 127,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      wrapper_record: wrapperRecord,
      handoff: normalized.ok ? normalized.value as NormalizedHostHandoff : null,
      errors,
    };
  }
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    return 1;
  }
  fs.mkdirSync(parsed.cwd, { recursive: true });
  const runner = new GuildRunHostProbeRunner(parsed.wrapper);
  const receipts: TaskCellHostConformanceReceipt[] = [];
  for (const file of parsed.receipt_files) {
    const verified = verifyTaskCellHostConformanceReceipt({ cwd: parsed.cwd, receiptFile: file, expectedRunId: parsed.run_id });
    if (!verified.valid || !verified.receipt) {
      throw new Error(`invalid TaskCell host conformance receipt ${file}: ${verified.errors.join("; ")}`);
    }
    receipts.push(verified.receipt);
  }
  for (const host of parsed.hosts) {
    const fresh = await runTaskCellHostConformance({ cwd: parsed.cwd, run_id: parsed.run_id, host, runner });
    const file = path.resolve(parsed.cwd, fresh.receipt_path);
    const verified = verifyTaskCellHostConformanceReceipt({ cwd: parsed.cwd, receiptFile: file, expectedRunId: parsed.run_id });
    if (!verified.valid || !verified.receipt) {
      throw new Error(`fresh TaskCell host receipt failed re-verification ${file}: ${verified.errors.join("; ")}`);
    }
    receipts.push(verified.receipt);
  }
  const matrix = buildTaskCellHostConformanceMatrix(receipts);
  fs.mkdirSync(path.dirname(parsed.output), { recursive: true });
  fs.writeFileSync(parsed.output, JSON.stringify(matrix, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify({ ...matrix, matrix_path: parsed.output }, null, 2) + "\n");
  return matrix.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    process.stderr.write(String(error instanceof Error ? error.stack ?? error.message : error) + "\n");
    process.exit(1);
  });
}

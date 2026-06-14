#!/usr/bin/env -S npx tsx
/**
 * scripts/guild-run.ts  (the `guild-run <host>` wrapper, SC-5)
 *
 * L3 — the generated cross-host run wrapper. Builds the pure invocation plan
 * (lib/guild-run-wrapper.ts) for a host from its guild.host_capabilities.v1 row,
 * writes any required instruction files, SPAWNS the host CLI, captures
 * session id / stdout / stderr / exit, and — when a structured result is
 * requested — normalizes it against a Guild contract with BOUNDED REPAIR,
 * FAIL-CLOSING on persistent invalidity (lib/result-normalizer.ts, SC-6).
 *
 * This CLI is the only I/O surface of L3; all decision logic is in the two pure
 * libs it composes, so the behavior is unit-tested independently (L6).
 *
 * Usage:
 *   npx tsx scripts/guild-run.ts --host claude|codex [--mode <mode>] \
 *       [--cwd <dir>] [--writable <a:b>] [--bootstrap-file <path>] \
 *       [--prompt <text> | --prompt-file <path>] [--contract <wire>] \
 *       [--max-repair <n>] [--resume <sessionId>] [--record <path>] [--dry-run]
 *
 *   --contract   Request a structured result of this wire schema_version and
 *                normalize it (e.g. guild.handoff.v2, review_result.v1).
 *   --dry-run    Print the resolved plan as JSON and exit (no spawn). Useful for
 *                inspecting argv/injection/degradation without launching a host.
 *
 * Exit: 0 ok · 2 result failed-closed (invalid after bounded repair) ·
 *       3 host process exited non-zero · 1 usage / IO error.
 *
 * Owned by tooling-engineer (L3).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  planWrapperInvocation,
  type WrapperRequest,
  type WrapperPlan,
} from "./lib/guild-run-wrapper";
import { normalizeWithRepair, type BoundedRepairResult } from "./lib/result-normalizer";
import type { PermissionMode } from "./lib/host-capabilities-schema";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  host: string;
  mode: PermissionMode;
  cwd: string;
  writableRoots: string[];
  bootstrap?: string;
  prompt?: string;
  contract?: string;
  maxRepair: number;
  resume?: string;
  record?: string;
  dryRun: boolean;
}

const VALID_MODES = new Set<PermissionMode>([
  "read_only",
  "ask",
  "accept_edits",
  "auto",
  "bypass_all",
]);

export function parseArgs(argv: string[]): CliArgs | { error: string } {
  let host: string | undefined;
  let mode: PermissionMode = "ask";
  let cwd = process.cwd();
  const writableRoots: string[] = [];
  let bootstrap: string | undefined;
  let prompt: string | undefined;
  let contract: string | undefined;
  let maxRepair = 2;
  let resume: string | undefined;
  let record: string | undefined;
  let dryRun = false;

  const next = (i: number): string | undefined => argv[i + 1];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host" && next(i) !== undefined) host = argv[++i];
    else if (a === "--mode" && next(i) !== undefined) mode = argv[++i] as PermissionMode;
    else if (a === "--cwd" && next(i) !== undefined) cwd = path.resolve(argv[++i]);
    else if (a === "--writable" && next(i) !== undefined) writableRoots.push(...argv[++i].split(":"));
    else if (a === "--bootstrap-file" && next(i) !== undefined) bootstrap = fs.readFileSync(argv[++i], "utf8");
    else if (a === "--prompt" && next(i) !== undefined) prompt = argv[++i];
    else if (a === "--prompt-file" && next(i) !== undefined) prompt = fs.readFileSync(argv[++i], "utf8");
    else if (a === "--contract" && next(i) !== undefined) contract = argv[++i];
    else if (a === "--max-repair" && next(i) !== undefined) maxRepair = Number(argv[++i]);
    else if (a === "--resume" && next(i) !== undefined) resume = argv[++i];
    else if (a === "--record" && next(i) !== undefined) record = path.resolve(argv[++i]);
    else if (a === "--dry-run") dryRun = true;
    else return { error: `unknown or incomplete argument: ${a}` };
  }

  if (!host) return { error: "--host is required (claude | codex)" };
  if (!VALID_MODES.has(mode)) return { error: `--mode must be one of ${[...VALID_MODES].join(", ")}` };
  if (!Number.isInteger(maxRepair) || maxRepair < 0) return { error: "--max-repair must be a non-negative integer" };

  const out: CliArgs = { host, mode, cwd, writableRoots, maxRepair, dryRun };
  if (bootstrap !== undefined) out.bootstrap = bootstrap;
  if (prompt !== undefined) out.prompt = prompt;
  if (contract !== undefined) out.contract = contract;
  if (resume !== undefined) out.resume = resume;
  if (record !== undefined) out.record = record;
  return out;
}

// ---------------------------------------------------------------------------
// Capture helpers
// ---------------------------------------------------------------------------

/** Best-effort session-id extraction from host stdout (UUID or `session_id` JSON field). */
export function extractSessionId(stdout: string): string | null {
  const jsonField = /"session_id"\s*:\s*"([^"]+)"/.exec(stdout);
  if (jsonField && jsonField[1]) return jsonField[1];
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.exec(stdout);
  return uuid ? uuid[0] : null;
}

/** Receipt paths the host may have written, recognized by the standard handoff dir shape. */
export function extractReceiptPaths(stdout: string): string[] {
  const out = new Set<string>();
  const re = /\.guild\/runs\/[^\s"']+\/handoffs\/[^\s"']+\.md/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stdout)) !== null) out.add(m[0]);
  return [...out];
}

// ---------------------------------------------------------------------------
// Host round-trip
// ---------------------------------------------------------------------------

interface RunOutcome {
  stdout: string;
  stderr: string;
  exit: number;
}

/** Spawn the host with a given argv (synchronous; captures stdio). */
function spawnHost(plan: WrapperPlan, args: string[]): RunOutcome {
  const res = spawnSync(plan.command, args, {
    cwd: plan.cwd,
    env: { ...process.env, ...plan.env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    return { stdout: res.stdout ?? "", stderr: String(res.error.message), exit: 127 };
  }
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", exit: res.status ?? 0 };
}

/**
 * Re-spawn the host for a bounded repair round. The repair prompt REPLACES the
 * prompt positional/`-p` arg from the original argv; everything else is preserved.
 */
function rebuildArgsWithPrompt(plan: WrapperPlan, repairPrompt: string): string[] {
  const args = [...plan.args];
  if (plan.host === "claude") {
    const idx = args.lastIndexOf("-p");
    if (idx >= 0 && idx + 1 < args.length) args[idx + 1] = repairPrompt;
    else args.push("-p", repairPrompt);
  } else {
    // prompt is the last positional for codex `exec`.
    args[args.length - 1] = repairPrompt;
  }
  return args;
}

interface Backup {
  abs: string;
  /** Whether a file existed at this path before the wrapper wrote it. */
  existed: boolean;
  /** Its prior content (raw bytes, when existed). */
  prior: Buffer | null;
  /** Exactly the bytes the wrapper wrote — used to detect concurrent edits on restore. */
  wrote: Buffer;
}

/**
 * Restore (or remove) instruction files written for a run, leaving cwd as found —
 * but NEVER clobber a concurrent edit: comparison is BYTE-EXACT (Buffer.equals),
 * so a change that happens to decode equivalently is still detected. A failed
 * restore WARNS (it is best-effort cleanup and must not throw, but it is never
 * silent).
 */
function restoreInstructionFiles(backups: Backup[]): void {
  for (const b of backups) {
    try {
      let current: Buffer | null = null;
      try {
        current = fs.readFileSync(b.abs);
      } catch {
        current = null;
      }
      if (current !== null && !current.equals(b.wrote)) {
        process.stderr.write(
          `guild-run: ${b.abs} was modified during the run; leaving it in place (not restoring) to avoid clobbering a concurrent edit.\n`
        );
        continue;
      }
      if (b.existed && b.prior !== null) fs.writeFileSync(b.abs, b.prior);
      else fs.rmSync(b.abs, { force: true });
    } catch (err) {
      process.stderr.write(`guild-run: WARNING — could not restore ${b.abs}: ${String(err)}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    return 1;
  }

  const request: WrapperRequest = {
    host: parsed.host,
    mode: parsed.mode,
    cwd: parsed.cwd,
    writableRoots: parsed.writableRoots,
  };
  if (parsed.bootstrap !== undefined) request.bootstrap = parsed.bootstrap;
  if (parsed.prompt !== undefined) request.prompt = parsed.prompt;
  if (parsed.contract !== undefined) request.structuredOutput = { wire_schema_version: parsed.contract };
  if (parsed.resume !== undefined) request.resume = { sessionId: parsed.resume };

  let plan: WrapperPlan;
  try {
    plan = planWrapperInvocation(request);
  } catch (err) {
    process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    return 1;
  }

  if (parsed.dryRun) {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    return 0;
  }

  // Write instruction files (e.g. Codex AGENTS.md) before launch — NON-DESTRUCTIVELY.
  // Any pre-existing file at the target path is preserved and restored after the
  // run (the wrapper must never silently clobber the user's working-dir files).
  const backups: Backup[] = [];
  for (const f of plan.bootstrap.files) {
    const abs = path.isAbsolute(f.path) ? f.path : path.join(plan.cwd, f.path);
    const wrote = Buffer.from(f.content, "utf8");
    let existed = false;
    let prior: Buffer | null = null;
    try {
      prior = fs.readFileSync(abs);
      existed = true;
    } catch (err) {
      // ONLY a genuine absence (ENOENT) is "no prior file". An existing-but-
      // unreadable file (EACCES/EISDIR/…) must NOT be silently overwritten —
      // abort and roll back.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        process.stderr.write(
          `guild-run: instruction-file target ${abs} exists but is unreadable (${(err as NodeJS.ErrnoException).code}); refusing to overwrite.\n`
        );
        restoreInstructionFiles(backups);
        return 1;
      }
      existed = false;
    }
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, wrote);
      backups.push({ abs, existed, prior, wrote });
    } catch (err) {
      process.stderr.write(`guild-run: cannot write instruction file ${abs}: ${String(err)}\n`);
      // Roll back anything already written before bailing.
      restoreInstructionFiles(backups);
      return 1;
    }
  }

  let initial: RunOutcome;
  let normalized: BoundedRepairResult | null = null;
  try {
    initial = spawnHost(plan, plan.args);
    if (parsed.contract) {
      normalized = normalizeWithRepair(
        initial.stdout,
        parsed.contract,
        (repairPrompt) => spawnHost(plan, rebuildArgsWithPrompt(plan, repairPrompt)).stdout,
        { maxRounds: parsed.maxRepair }
      );
    }
  } finally {
    restoreInstructionFiles(backups);
  }
  const sessionId = extractSessionId(initial.stdout);
  const receiptPaths = extractReceiptPaths(initial.stdout);

  const record = {
    schema_version: "guild.run_wrapper_record.v1",
    host: plan.host,
    command: plan.command,
    args: plan.args,
    cwd: plan.cwd,
    launch_mode: plan.launch,
    bootstrap_method: plan.bootstrap.method,
    session_id: sessionId,
    exit: initial.exit,
    receipt_paths: receiptPaths,
    contract: parsed.contract ?? null,
    normalized: normalized
      ? {
          ok: normalized.ok,
          wire_schema_version: normalized.wire_schema_version,
          rounds_used: normalized.rounds_used,
          failed_closed: normalized.failed_closed,
          errors: normalized.errors,
        }
      : null,
  };

  if (parsed.record) {
    try {
      fs.mkdirSync(path.dirname(parsed.record), { recursive: true });
      fs.writeFileSync(parsed.record, JSON.stringify(record, null, 2) + "\n");
    } catch (err) {
      process.stderr.write(`guild-run: cannot write record ${parsed.record}: ${String(err)}\n`);
    }
  }

  // Stream the host's own output through, then the wrapper record on stderr.
  process.stdout.write(initial.stdout);
  if (initial.stderr) process.stderr.write(initial.stderr);
  process.stderr.write("guild-run: " + JSON.stringify(record) + "\n");

  if (initial.exit !== 0) return 3;
  if (normalized && !normalized.ok) return 2; // fail-closed: invalid result after bounded repair.
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

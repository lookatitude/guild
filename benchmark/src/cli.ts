#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadCase } from "./case-loader.js";
import { importFixture, loadRunRecord } from "./artifact-importer.js";
import { compareSets } from "./compare.js";
import { persistScore, scoreRun } from "./scorer.js";
import { serverDefaultsFromEnv, startServer } from "./server.js";
import { formatDryRunReport, planRun, runBenchmark } from "./runner.js";
import {
  formatContinueDryRun,
  formatStartDryRun,
  formatStatusReport,
  loopAbort,
  loopContinue,
  loopRollback,
  loopStart,
  loopStatus,
} from "./loop.js";
// v1.4.0 — global flag plumbing for adversarial-loops control surface.
// Parsing only at this layer (T3a-backend-config); the dispatcher consumers
// (T3b/T3c) read the resolved values via `resolveV14Config`.
import {
  ConfigError,
  parseAutoApprove,
  parseLoopCap,
  parseLoops,
  parseStatusline,
  resolveV14Config,
  type V14Config,
} from "./v1.4-config.js";
import type {
  Case,
  LoopAbortOptions,
  LoopContinueOptions,
  LoopRollbackOptions,
  LoopStartOptions,
  LoopStatusOptions,
  RunOptions,
} from "./types.js";

interface ParsedArgs {
  command: string;
  flags: Map<string, string>;
  positional: string[];
}

const DEFAULT_RUNS_DIR = resolve(process.cwd(), "runs");

/**
 * Flags that NEVER take a value — bare presence is the boolean-true
 * signal. Without this whitelist, `--statusline help` would parse as
 * `flags.statusline = "help"` and consume the subcommand. Keep this
 * list small and explicit; v1.4 added `--statusline` as the only
 * boolean global flag.
 *
 * Subcommand-local boolean flags (e.g. `--dry-run`, `--cleanup`,
 * `--confirm`, mode flags `--start` / `--continue` / etc.) also never
 * take a value; including them here makes `<subcommand> --dry-run
 * --case foo` parse correctly even when the user omits the `=`.
 */
const BOOLEAN_FLAGS = new Set<string>([
  // v1.4 globals
  "statusline",
  // Subcommand mode flags
  "start",
  "continue",
  "status",
  "abort",
  "rollback",
  // Common boolean flags
  "dry-run",
  "cleanup",
  "confirm",
  "help",
]);

function parseArgs(argv: string[]): ParsedArgs {
  // v1.4.0 — global flags (`--loops`, `--loop-cap`, `--auto-approve`,
  // `--statusline`) may appear BEFORE the subcommand. The subcommand
  // is the first non-flag argv entry; everything else (flags + later
  // positionals) accumulates. v1.3 callers that pass
  // `<subcommand> --flag` continue to work unchanged because the
  // first non-flag arg is still the subcommand.
  //
  // Known boolean flags (BOOLEAN_FLAGS) NEVER consume the next argv
  // entry — bare `--flag` is always boolean-true; `--flag=value` is
  // also accepted (value goes through the parser's normal path).
  let command = "";
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
      } else {
        const flagName = a.slice(2);
        // Boolean flags are bare; do not consume the next argv entry.
        if (BOOLEAN_FLAGS.has(flagName)) {
          flags.set(flagName, "true");
          continue;
        }
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags.set(flagName, next);
          i += 1;
        } else {
          flags.set(flagName, "true");
        }
      }
    } else if (command === "") {
      // First non-flag arg is the subcommand (preserves v1.3 behaviour).
      command = a;
    } else {
      positional.push(a);
    }
  }
  return { command, flags, positional };
}

async function commandScore(args: ParsedArgs): Promise<void> {
  const runId = args.flags.get("run-id");
  if (!runId) throw new Error("score: --run-id <id> is required");
  const runsDir = resolve(args.flags.get("runs-dir") ?? DEFAULT_RUNS_DIR);
  const fixture = args.flags.get("fixture");
  const casePath = args.flags.get("case");

  if (fixture) {
    await importFixture({ fixturePath: fixture, runsDir, runId });
  }

  const runDir = resolve(runsDir, runId);
  if (!existsSync(runDir)) {
    throw new Error(
      `Run directory not found: ${runDir}. Pass --fixture <path> to import one first.`,
    );
  }
  const record = await loadRunRecord(runDir);
  const caseFile = casePath ? await loadCase(casePath) : await resolveCaseForRun(record.run.case_slug);
  const { score, metrics } = scoreRun(record, caseFile);
  await persistScore(runDir, score, metrics);

  process.stdout.write(
    `score: wrote ${runDir}/score.json (status=${score.status} guild_score=${score.guild_score})\n`,
  );
}

async function resolveCaseForRun(slug: string): Promise<Case> {
  const candidates = [
    resolve(process.cwd(), "cases", `${slug}.yaml`),
    resolve(process.cwd(), "cases", `${slug}.yml`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return loadCase(c);
  }
  throw new Error(
    `Could not locate case YAML for slug "${slug}". Pass --case <path> explicitly.`,
  );
}

async function commandCompare(args: ParsedArgs): Promise<void> {
  const baseline = args.flags.get("baseline");
  const candidate = args.flags.get("candidate");
  if (!baseline) throw new Error("compare: --baseline <set> is required");
  if (!candidate) throw new Error("compare: --candidate <set> is required");
  const runsDir = resolve(args.flags.get("runs-dir") ?? DEFAULT_RUNS_DIR);
  const outputPath = args.flags.get("output");
  const result = await compareSets({
    runsDir,
    baseline,
    candidate,
    ...(outputPath ? { outputPath } : {}),
  });
  process.stdout.write(
    `compare: wrote ${result.outputPath} (status=${result.comparison.status} guild_score_delta=${result.comparison.guild_score_delta.delta})\n`,
  );
  if (result.comparison.skipped_runs.length > 0) {
    const ids = result.comparison.skipped_runs.map((s) => s.run_id).join(", ");
    process.stderr.write(
      `compare: WARNING — ${result.comparison.skipped_runs.length} run(s) skipped (no score.json): ${ids}\n` +
        `compare: WARNING — run \`benchmark score --run-id <id>\` on each before re-comparing for full coverage.\n`,
    );
  }
  // v1.2 — F9: cross-run_kind sets produce misleading deltas because the
  // lifecycle-dependent components (outcome/delegation/gates) score 0 on
  // raw_model runs by design. If either side mixes kinds OR the two sides
  // disagree on kind, surface a clear WARNING so the operator notices
  // before reading the table.
  const km = result.comparison.kind_mix;
  const baselineMixed = km.baseline_raw_model > 0 && km.baseline_guild_lifecycle > 0;
  const candidateMixed = km.candidate_raw_model > 0 && km.candidate_guild_lifecycle > 0;
  const sidesDisagree =
    (km.baseline_raw_model > 0 && km.candidate_guild_lifecycle > 0 && km.candidate_raw_model === 0) ||
    (km.baseline_guild_lifecycle > 0 && km.candidate_raw_model > 0 && km.candidate_guild_lifecycle === 0);
  if (baselineMixed || candidateMixed || sidesDisagree) {
    process.stderr.write(
      `compare: WARNING — cross-run_kind comparison detected ` +
        `(baseline raw=${km.baseline_raw_model}/lifecycle=${km.baseline_guild_lifecycle}, ` +
        `candidate raw=${km.candidate_raw_model}/lifecycle=${km.candidate_guild_lifecycle}).\n` +
        `compare: WARNING — outcome/delegation/gates components are 0 on raw_model runs by design; deltas are not comparable across kinds.\n`,
    );
  }
}

// Live runner. argv: --case <slug> [--run-id <id>] [--dry-run] [--cleanup]
//                  [--runs-dir <path>] [--cases-dir <path>]
// Exit codes per architect §4.1 + §6.4: 0 pass, 1 fail, 124 timeout, 2 errored.
async function commandRun(args: ParsedArgs): Promise<never> {
  const caseSlug = args.flags.get("case");
  if (!caseSlug || caseSlug === "true") {
    process.stderr.write("run: --case <slug> is required\n");
    process.exit(2);
  }
  const runsDir = resolve(args.flags.get("runs-dir") ?? DEFAULT_RUNS_DIR);
  const casesDir = resolve(
    args.flags.get("cases-dir") ?? resolve(process.cwd(), "cases"),
  );
  const runIdFlag = args.flags.get("run-id");
  const dryRunFlag = args.flags.get("dry-run");
  const cleanupFlag = args.flags.get("cleanup");

  const opts: RunOptions = {
    caseSlug,
    ...(runIdFlag && runIdFlag !== "true" ? { runId: runIdFlag } : {}),
    dryRun: dryRunFlag === "true" || dryRunFlag === "",
    cleanup: cleanupFlag === "true" || cleanupFlag === "",
  };

  if (opts.dryRun === true) {
    const plan = await planRun(opts, { runsDir, casesDir });
    process.stdout.write(formatDryRunReport(plan));
    process.exit(0);
  }

  const result = await runBenchmark(opts, { runsDir, casesDir });
  process.stdout.write(
    `run: ${result.run_id} status=${result.status} wall_clock_ms=${result.wall_clock_ms}\n`,
  );
  switch (result.status) {
    case "pass":
      process.exit(0);
    case "fail":
      process.exit(1);
    case "timeout":
      process.exit(124);
    case "errored":
    default:
      process.exit(2);
  }
}

// `benchmark loop` — P4 learning-loop orchestrator. Five modes,
// mutually exclusive:
//   --start    --case <slug> [--baseline-run-id <id>] [--dry-run]
//   --continue --baseline-run-id <id> --apply <proposal-id> [--dry-run]
//   --status   --baseline-run-id <id>
//   --abort    --baseline-run-id <id> [--dry-run]      (v1.2 — F1)
//   --rollback --baseline-run-id <id> --candidate-id <id> [--dry-run | --confirm]   (v1.3 — F2)
//
// Exit codes (architect §4.1 + §6.4): 0 ok, 1 fail, 124 timeout, 2 errored.
// Dry-run flow per ADR-005 §Decision: never spawns claude, returns 0.
async function commandLoop(args: ParsedArgs): Promise<never> {
  const runsDir = resolve(args.flags.get("runs-dir") ?? DEFAULT_RUNS_DIR);
  const casesDir = resolve(args.flags.get("cases-dir") ?? resolve(process.cwd(), "cases"));
  const ctx = { runsDir, casesDir };

  const isStart = args.flags.get("start") !== undefined;
  const isContinue = args.flags.get("continue") !== undefined;
  const isStatus = args.flags.get("status") !== undefined;
  const isAbort = args.flags.get("abort") !== undefined;
  const isRollback = args.flags.get("rollback") !== undefined;
  const modeCount = [isStart, isContinue, isStatus, isAbort, isRollback].filter(Boolean).length;
  if (modeCount === 0) {
    process.stderr.write(
      "loop: one of --start, --continue, --status, --abort, --rollback is required\n",
    );
    process.exit(2);
  }
  if (modeCount > 1) {
    process.stderr.write(
      "loop: --start, --continue, --status, --abort, --rollback are mutually exclusive\n",
    );
    process.exit(2);
  }

  const dryRunFlag = args.flags.get("dry-run");
  const dryRun = dryRunFlag === "true" || dryRunFlag === "";

  try {
    if (isStart) {
      const caseSlug = args.flags.get("case");
      if (!caseSlug || caseSlug === "true") {
        process.stderr.write("loop --start: --case <slug> is required\n");
        process.exit(2);
      }
      const baselineRunId = args.flags.get("baseline-run-id");
      const opts: LoopStartOptions = {
        caseSlug,
        ...(baselineRunId && baselineRunId !== "true" ? { baselineRunId } : {}),
        dryRun,
      };
      const result = await loopStart(opts, ctx);
      if ("kind" in result && result.kind === "start") {
        process.stdout.write(formatStartDryRun(result));
        process.exit(0);
      }
      // Live result.
      const live = result as { manifestPath: string; baselineRunId: string };
      process.stdout.write(
        `loop --start: baseline_run_id=${live.baselineRunId} manifest=${live.manifestPath}\n`,
      );
      process.exit(0);
    }

    if (isContinue) {
      const baselineRunId = args.flags.get("baseline-run-id");
      const proposalId = args.flags.get("apply");
      if (!baselineRunId || baselineRunId === "true") {
        process.stderr.write("loop --continue: --baseline-run-id <id> is required\n");
        process.exit(2);
      }
      if (!proposalId || proposalId === "true") {
        process.stderr.write("loop --continue: --apply <proposal-id> is required\n");
        process.exit(2);
      }
      const opts: LoopContinueOptions = { baselineRunId, proposalId, dryRun };
      const result = await loopContinue(opts, ctx);
      if ("kind" in result && result.kind === "continue") {
        process.stdout.write(formatContinueDryRun(result));
        process.exit(0);
      }
      const live = result as {
        manifestPath: string;
        candidateRunId: string;
        comparisonPath: string;
        kept: boolean | null;
      };
      const keptStr = live.kept === null ? "n/a" : live.kept ? "true" : "false";
      process.stdout.write(
        `loop --continue: candidate_run_id=${live.candidateRunId} comparison=${live.comparisonPath} kept=${keptStr}\n`,
      );
      process.exit(0);
    }

    if (isAbort) {
      // v1.2 — F1: structured abort. Refuses on completed/aborted state;
      // mutates only the manifest state field + drops the lockfile.
      const baselineRunId = args.flags.get("baseline-run-id");
      if (!baselineRunId || baselineRunId === "true") {
        process.stderr.write("loop --abort: --baseline-run-id <id> is required\n");
        process.exit(2);
      }
      const opts: LoopAbortOptions = { baselineRunId, dryRun };
      const report = await loopAbort(opts, ctx);
      if (dryRun) {
        process.stdout.write(
          `loop --abort --dry-run\n` +
            `  manifest_path        : ${report.manifestPath}\n` +
            `  manifest_state_before: ${report.manifestStateBefore}\n` +
            `  manifest_state_after : ${report.manifestStateAfter}\n` +
            `  lockfile_path        : ${report.lockfilePath}\n` +
            `  lockfile_existed     : ${report.lockfileExisted}\n`,
        );
        process.exit(0);
      }
      process.stdout.write(
        `loop --abort: baseline_run_id=${baselineRunId} state=aborted` +
          (report.lockfileExisted ? " (lockfile cleared)" : "") +
          "\n",
      );
      process.exit(0);
    }

    if (isRollback) {
      // v1.3 — F2: structured rollback. Refuses unless state="completed";
      // shells out to `git revert --no-edit <plugin_ref_after>` under
      // --confirm and flips state to "rolled-back". Default --dry-run.
      const baselineRunId = args.flags.get("baseline-run-id");
      const candidateId = args.flags.get("candidate-id");
      if (!baselineRunId || baselineRunId === "true") {
        process.stderr.write("loop --rollback: --baseline-run-id <id> is required\n");
        process.exit(2);
      }
      if (!candidateId || candidateId === "true") {
        process.stderr.write("loop --rollback: --candidate-id <id> is required\n");
        process.exit(2);
      }
      const confirmFlag = args.flags.get("confirm");
      const confirm = confirmFlag === "true" || confirmFlag === "";
      // Mutual exclusion: --confirm forces live; otherwise default --dry-run.
      const rollbackDryRun = confirm ? false : true;
      const opts: LoopRollbackOptions = {
        baselineRunId,
        candidateId,
        dryRun: rollbackDryRun,
        confirm,
      };
      const report = await loopRollback(opts, ctx);
      if (rollbackDryRun) {
        process.stdout.write(
          `loop --rollback --dry-run\n` +
            `  manifest_path        : ${report.manifestPath}\n` +
            `  manifest_state_before: ${report.manifestStateBefore}\n` +
            `  manifest_state_after : ${report.manifestStateAfter}\n` +
            `  candidate_id         : ${report.candidateId}\n` +
            `  plugin_ref_after     : ${report.pluginRefAfter}\n` +
            `  host_repo_root       : ${report.hostRepoRoot}\n` +
            `  would_run            : git -C ${report.hostRepoRoot} revert --no-edit ${report.pluginRefAfter}\n` +
            `  lockfile_path        : ${report.lockfilePath}\n` +
            `  lockfile_existed     : ${report.lockfileExisted}\n` +
            `\n` +
            `(dry-run: no git command run; manifest unchanged. Pass --confirm to apply.)\n`,
        );
        process.exit(0);
      }
      process.stdout.write(
        `loop --rollback: baseline_run_id=${baselineRunId} state=rolled-back ` +
          `candidate_id=${candidateId} reverted=${report.pluginRefAfter}` +
          (report.lockfileExisted ? " (lockfile cleared)" : "") +
          "\n",
      );
      process.exit(0);
    }

    // --status
    const baselineRunId = args.flags.get("baseline-run-id");
    if (!baselineRunId || baselineRunId === "true") {
      process.stderr.write("loop --status: --baseline-run-id <id> is required\n");
      process.exit(2);
    }
    const opts: LoopStatusOptions = { baselineRunId };
    // P4-polish: --diff <proposal-id> switches to diff mode (F1.1 (b)).
    const diffFlag = args.flags.get("diff");
    if (diffFlag !== undefined) {
      if (diffFlag === "true" || diffFlag.length === 0) {
        process.stderr.write(
          "loop --status: --diff requires a proposal_id argument (e.g., --diff <proposal-id>)\n",
        );
        process.exit(2);
      }
      opts.diffProposalId = diffFlag;
    }
    const report = await loopStatus(opts, ctx);
    process.stdout.write(formatStatusReport(report));
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      `loop: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }
}

async function commandServe(args: ParsedArgs): Promise<void> {
  const runsDir = resolve(args.flags.get("runs-dir") ?? DEFAULT_RUNS_DIR);
  const casesDir = resolve(args.flags.get("cases-dir") ?? resolve(process.cwd(), "cases"));
  const uiDistFlag = args.flags.get("ui-dist") ?? resolve(process.cwd(), "ui", "dist");
  const uiDistDir = existsSync(uiDistFlag) ? uiDistFlag : undefined;
  const portFlag = args.flags.get("port");
  const defaults = serverDefaultsFromEnv();
  const port = portFlag ? Number.parseInt(portFlag, 10) : defaults.port;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`serve: --port must be a valid TCP port (1-65535); got ${portFlag}`);
  }
  const handle = await startServer({
    runsDir,
    casesDir,
    port,
    hostname: defaults.hostname,
    ...(uiDistDir ? { uiDistDir } : {}),
  });
  process.stdout.write(
    [
      `serve: listening on http://${handle.hostname}:${handle.port}`,
      `  runs-dir: ${runsDir}`,
      `  cases-dir: ${casesDir}`,
      uiDistDir
        ? `  ui-dist: ${uiDistDir} (production-mode static fallback enabled)`
        : "  ui-dist: <not built> — non-/api paths return 404 (run `cd benchmark/ui && npm run build`)",
      "",
    ].join("\n"),
  );
  // Keep the process alive; SIGINT / SIGTERM close cleanly.
  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`\nserve: received ${signal}, closing...\n`);
    await handle.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

function printUsage(): void {
  process.stdout.write(
    [
      "benchmark — Guild benchmark factory CLI",
      "",
      "Usage:",
      "  benchmark score    --run-id <id> [--fixture <path>] [--case <path>] [--runs-dir <path>]",
      "  benchmark compare  --baseline <set> --candidate <set> [--runs-dir <path>] [--output <path>]",
      "  benchmark serve    [--port <n>] [--runs-dir <path>] [--cases-dir <path>] [--ui-dist <path>]",
      "                          (binds 127.0.0.1; BENCHMARK_PORT env or --port; default 3055)",
      "  benchmark run      --case <slug> [--run-id <id>] [--dry-run] [--cleanup]",
      "                          [--runs-dir <path>] [--cases-dir <path>]",
      "                          (--dry-run prints the resolved plan; never spawns claude)",
      "  benchmark loop     --start    --case <slug> [--baseline-run-id <id>] [--dry-run]",
      "                     --continue --baseline-run-id <id> --apply <proposal-id> [--dry-run]",
      "                     --status   --baseline-run-id <id> [--diff <proposal-id>]",
      "                     --abort    --baseline-run-id <id> [--dry-run]",
      "                     --rollback --baseline-run-id <id> --candidate-id <id> [--dry-run | --confirm]",
      "                          (P4 learning loop; never auto-applies; --dry-run never spawns;",
      "                           --diff extracts fenced diff/patch blocks from a proposal body;",
      "                           --rollback flips a completed manifest to rolled-back via `git revert`)",
      "",
    ].join("\n"),
  );
}

/**
 * v1.4.0 — validate the new global flags before subcommand dispatch.
 *
 * Behaviour (architect contract):
 *   - `--loops` / `--loop-cap` / `--auto-approve` are global; they apply
 *     to every subcommand.
 *   - Invalid value → write the architect's exact stderr line + exit 2.
 *   - Valid flags pre-empt env mirrors (CLI-overrides-env via the
 *     resolver in v1.4-config.ts).
 *   - The fully-resolved config is returned so subcommand handlers /
 *     T3b/T3c consumers can read it. v1.3 callers that pass none of
 *     these flags continue to work unchanged.
 *
 * The flags are NOT removed from `args.flags` after validation — that
 * keeps existing per-subcommand `args.flags.get(...)` behaviour stable.
 */
function validateV14Flags(args: ParsedArgs): V14Config {
  // Validate eagerly so the error message points at the offending flag
  // (the resolver would still throw, but cli-level validation gives us
  // the cleanest "exit 2 with exact stderr" spec compliance).
  const loopsRaw = args.flags.get("loops");
  const loopCapRaw = args.flags.get("loop-cap");
  const autoApproveRaw = args.flags.get("auto-approve");
  // `--statusline` (v1.4 audit doc §"--statusline (default off) gates the
  // status-line script"). Bare `--statusline` with no value is "true"
  // per parseArgs convention; explicit `--statusline=0|1|""` takes the
  // value path.
  const statuslineRaw = args.flags.get("statusline");
  try {
    if (loopsRaw !== undefined && loopsRaw !== "true") {
      parseLoops(loopsRaw);
    } else if (loopsRaw === "true") {
      // Bare `--loops` with no value is an invalid value (empty/`true`).
      parseLoops("true");
    }
    if (loopCapRaw !== undefined && loopCapRaw !== "true") {
      parseLoopCap(loopCapRaw);
    } else if (loopCapRaw === "true") {
      parseLoopCap("");
    }
    if (autoApproveRaw !== undefined && autoApproveRaw !== "true") {
      parseAutoApprove(autoApproveRaw);
    } else if (autoApproveRaw === "true") {
      parseAutoApprove("");
    }
    // Statusline: bare `--statusline` (`raw === "true"`) is opt-in and
    // valid. Explicit `--statusline=foo` (raw is the value) goes through
    // the parser; the parser accepts only "" / "0" / "1".
    if (statuslineRaw !== undefined && statuslineRaw !== "true") {
      parseStatusline(statuslineRaw);
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
  // Resolve the full v1.4 config for downstream consumers (T3b/T3c).
  // Env-only vars (GUILD_LOG_RETENTION) are validated here too — invalid
  // env still exits 2. `--statusline` is now CLI-overridable so its
  // resolver also takes the CLI value.
  try {
    return resolveV14Config(
      {
        ...(loopsRaw !== undefined && loopsRaw !== "true" ? { loops: loopsRaw } : {}),
        ...(loopCapRaw !== undefined && loopCapRaw !== "true"
          ? { loopCap: loopCapRaw }
          : {}),
        ...(autoApproveRaw !== undefined && autoApproveRaw !== "true"
          ? { autoApprove: autoApproveRaw }
          : {}),
        ...(statuslineRaw !== undefined ? { statusline: statuslineRaw } : {}),
      },
      process.env,
    );
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  // v1.4.0 — global flag validation. Returns the fully-resolved config so
  // future T3b/T3c dispatcher code can consume it. v1.3 paths that pass
  // none of the new flags see a fully-default config and proceed unchanged.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _v14 = validateV14Flags(args);
  void _v14;
  switch (args.command) {
    case "score":
      await commandScore(args);
      return;
    case "compare":
      await commandCompare(args);
      return;
    case "serve":
      await commandServe(args);
      return;
    case "run":
      await commandRun(args);
      return;
    case "loop":
      await commandLoop(args);
      return;
    case "":
    case "--help":
    case "-h":
    case "help":
      printUsage();
      return;
    default:
      process.stderr.write(`Unknown command: ${args.command}\n\n`);
      printUsage();
      process.exit(1);
  }
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

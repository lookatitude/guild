/**
 * scripts/station-compose.ts
 *
 * G6b-1 (task-cell-runtime P0.6, ADDITIVE) — the deterministic station-team
 * composer CLI. Mirrors `roster-resolve.ts` conventions (`--cwd`, JSON on stdout,
 * fail-closed non-zero exits) and drives the G6a composer through the G6b-1
 * signals contract.
 *
 *   npx tsx scripts/station-compose.ts <station> \
 *       [--signals <file.json | ->] [--cwd .] [--plugin-root <dir>] \
 *       [--run-id <id> --emit] \
 *       [--independence] [--adversarial-value] [--disciplines <n>] \
 *       [--fanout-override <mode> --override-by <who> --override-reason <why>]
 *
 * G8 fan-out (all optional): `--independence` / `--adversarial-value` /
 * `--disciplines <n>` supply the decomposition signals the composer scores the cell
 * fan-out mode from (signal-gated, not cost-gated); `--fanout-override` FORCES the
 * mode and is recorded traceably (all three override flags travel together).
 *
 * Flow:
 *   1. Read + fail-closed validate the `guild.station_signals.v1` block from
 *      `--signals` (a file path, or `-` for stdin). Absent ⇒ all-false signals.
 *   2. Build the composer config's tier index by REUSING roster-resolve's
 *      `guild.roster.v1` enumeration (`buildTierIndex(resolveRoster(...))`) — the
 *      D4 tier source; never a hand-maintained tier table.
 *   3. `composeStationTeam(station, signals, config)` → print the
 *      `guild.team_plan.v1` JSON to stdout.
 *   4. With `--emit --run-id <id>`: also `writeTeamPlan(cwd, runId, plan)` to the
 *      canonical run tree.
 *
 * Fail-closed: an unknown station, a malformed signals block, or `--emit` without
 * `--run-id` exits non-zero with a clear stderr line — never a silent empty team.
 *
 * Plugin root resolution mirrors roster-resolve.ts:
 *   --plugin-root > GUILD_PLUGIN_ROOT > CLAUDE_PLUGIN_ROOT > parent of this dir.
 */

import * as fs from "fs";
import * as path from "path";

import { resolveRoster } from "./lib/roster";
import {
  buildTierIndex,
  composeStationTeam,
  isStation,
  STATIONS,
  type CellFanout,
  type DecompositionSignals,
  type FanoutOverride,
  type StationSignals,
} from "../src/modules/teams/workflows/station-composer";
import {
  emptyStationSignalsV1,
  signalsOf,
  validateStationSignalsV1,
  writeTeamPlan,
} from "../src/modules/teams/workflows/station-signals";

function fail(msg: string): never {
  process.stderr.write(`[station-compose] ${msg}\n`);
  process.exit(1);
}

function readSignalsSource(src: string): string {
  if (src === "-") {
    try {
      return fs.readFileSync(0, "utf8"); // fd 0 = stdin
    } catch {
      fail("could not read signals from stdin");
    }
  }
  try {
    return fs.readFileSync(src, "utf8");
  } catch {
    fail(`could not read signals file: ${src}`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  let station: string | null = null;
  let signalsSrc: string | null = null;
  let cwd = ".";
  let pluginRoot: string | null = null;
  let runId: string | null = null;
  let emit = false;
  // G8 fan-out inputs (all optional; absent ⇒ mode scored purely from signals).
  let independence = false;
  let adversarialValue = false;
  let disciplineCount: number | null = null;
  let overrideMode: string | null = null;
  let overrideBy: string | null = null;
  let overrideReason: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--signals" && i + 1 < argv.length) signalsSrc = argv[++i];
    else if (a === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
    else if (a === "--plugin-root" && i + 1 < argv.length) pluginRoot = argv[++i];
    else if (a === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (a === "--emit") emit = true;
    else if (a === "--independence") independence = true;
    else if (a === "--adversarial-value") adversarialValue = true;
    else if (a === "--disciplines" && i + 1 < argv.length) disciplineCount = Number(argv[++i]);
    else if (a === "--fanout-override" && i + 1 < argv.length) overrideMode = argv[++i];
    else if (a === "--override-by" && i + 1 < argv.length) overrideBy = argv[++i];
    else if (a === "--override-reason" && i + 1 < argv.length) overrideReason = argv[++i];
    else if (!a.startsWith("--") && station === null) station = a;
    else fail(`unknown argument: ${a}`);
  }

  if (station === null) {
    fail(`missing <station> — must be one of: ${STATIONS.join(", ")}`);
  }
  if (!isStation(station)) {
    fail(`unknown station "${station}" — must be one of: ${STATIONS.join(", ")}`);
  }
  if (emit && runId === null) {
    fail("--emit requires --run-id <id>");
  }
  if (disciplineCount !== null && (!Number.isInteger(disciplineCount) || disciplineCount < 0)) {
    fail("--disciplines must be a non-negative integer");
  }
  // A fan-out override is all-or-nothing: mode + who + why must travel together so
  // the recorded override is always traceable.
  const overrideFlags = [overrideMode, overrideBy, overrideReason].filter((x) => x !== null).length;
  if (overrideFlags > 0 && overrideFlags < 3) {
    fail("--fanout-override requires --override-by <who> and --override-reason <why> (all three together)");
  }
  const CELL_FANOUT_VALUES = ["lead_only", "lead_plus_one", "lead_plus_many"];
  if (overrideMode !== null && !CELL_FANOUT_VALUES.includes(overrideMode)) {
    fail(`--fanout-override must be one of: ${CELL_FANOUT_VALUES.join(", ")}`);
  }
  // An override must be TRACEABLE — blank by/reason would compose a plan the
  // validator rejects, so reject it here with a clear message before composing.
  if (overrideMode !== null && (overrideBy!.trim() === "" || overrideReason!.trim() === "")) {
    fail("--override-by and --override-reason must be non-empty (an override must be traceable)");
  }

  // (1) Signals — validated fail-closed; absent ⇒ all-false envelope.
  let signals: StationSignals;
  if (signalsSrc === null) {
    signals = signalsOf(emptyStationSignalsV1());
  } else {
    const raw = readSignalsSource(signalsSrc);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail(`malformed signals JSON from ${signalsSrc === "-" ? "stdin" : signalsSrc}`);
    }
    const block = validateStationSignalsV1(parsed);
    if (!block) {
      fail(
        "invalid guild.station_signals.v1 block — every signal must be a known boolean key (see StationSignals)"
      );
    }
    signals = signalsOf(block);
  }

  // (2) Tier index — REUSE the roster enumeration (D4); never re-enumerate.
  const resolvedPluginRoot =
    pluginRoot ??
    process.env["GUILD_PLUGIN_ROOT"] ??
    process.env["CLAUDE_PLUGIN_ROOT"] ??
    path.resolve(__dirname, "..");
  const resolution = resolveRoster({
    projectRoot: path.resolve(cwd),
    pluginRoot: resolvedPluginRoot,
  });
  const tierIndex = buildTierIndex(resolution);

  // (3) Compose — deterministic; prints the team_plan JSON. G8 fan-out inputs are
  // threaded through only when supplied (absent ⇒ mode scored purely from signals).
  let decompositionSignals: DecompositionSignals | undefined;
  if (independence || adversarialValue || disciplineCount !== null) {
    decompositionSignals = {
      ...(independence ? { independence: true } : {}),
      ...(adversarialValue ? { adversarial_value: true } : {}),
      ...(disciplineCount !== null ? { distinct_discipline_count: disciplineCount } : {}),
    };
  }
  let fanoutOverride: FanoutOverride | undefined;
  if (overrideMode !== null) {
    fanoutOverride = {
      mode: overrideMode as CellFanout,
      by: overrideBy as string,
      reason: overrideReason as string,
    };
  }
  const plan = composeStationTeam(station, signals, {
    tierIndex,
    ...(decompositionSignals ? { decompositionSignals } : {}),
    ...(fanoutOverride ? { fanoutOverride } : {}),
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);

  // (4) Optional emission to the canonical run tree.
  if (emit && runId !== null) {
    try {
      const p = writeTeamPlan(path.resolve(cwd), runId, plan);
      process.stderr.write(`[station-compose] emitted team_plan: ${p}\n`);
    } catch (err) {
      fail(`emit failed: ${(err as Error).message}`);
    }
  }
}

main();

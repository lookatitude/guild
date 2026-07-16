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
 *       [--run-id <id> --emit]
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

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--signals" && i + 1 < argv.length) signalsSrc = argv[++i];
    else if (a === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
    else if (a === "--plugin-root" && i + 1 < argv.length) pluginRoot = argv[++i];
    else if (a === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (a === "--emit") emit = true;
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

  // (3) Compose — deterministic; prints the team_plan JSON.
  const plan = composeStationTeam(station, signals, { tierIndex });
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

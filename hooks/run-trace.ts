#!/usr/bin/env -S npx tsx
/**
 * hooks/run-trace.ts — CLI entry for the run-trace lib (Lane B3).
 *
 * The hook entrypoints (run-trace-start.ts / run-trace-close.ts) consume the lib
 * directly. This CLI is the seam for the COMMAND / SKILL legs that run outside a
 * native hook event:
 *
 *   start — uniform run-record path (A2 rollout seam):
 *       npx tsx hooks/run-trace.ts start --command=/guild:learn [--cwd <root>]
 *             [--run-class=full|lightweight] [--initiative=<id>]
 *     Default run-class is "full". Behavior splits by run-class:
 *       --run-class=full (default): starts the run ONLY and leaves run.yaml
 *         OPEN. The Stop hook (run-trace-close) closes it at session end, once
 *         work has actually happened. Writes NO provenance.json inline — closing
 *         inline would make the Stop hook skip the already-closed run and record
 *         empty touched/artifact data (P1).
 *       --run-class=lightweight: a point-in-time snapshot (status/stats/wiki
 *         query) that legitimately starts AND closes at once. Writes run.yaml +
 *         provenance.json under .guild/runs/ ONLY — never wiki/decisions/indexes
 *         — AND appends the matching run_closed line to logs/v1.4-events.jsonl.
 *     --initiative=<id> records the scalar initiative attachment (NN#5: recorded
 *     only, never creates a .guild/initiatives/ dir).
 *     The OQ6 record_status_runs gate is NOT applied here — A2 applies it
 *     before invoking this for /guild:status.
 *     Prints the run-id on stdout.
 *
 *     U3/U6 wiring (plugin-audit-remediation G3c): `start` ALWAYS runs the
 *     run-start preflight (lib/run-trace.ts resolvePreflightSnapshot →
 *     scripts/lib/runstart-preflight.ts runStartPreflight) before starting the
 *     run, and threads the resulting ResolvedSettingsSnapshot into
 *     startRunOnly/startAndCloseRun so B2's startRun writes
 *     .guild/runs/<id>/resolved-settings.json + run.yaml's settings_ref block.
 *     This is deterministic-code, not command prose: no command/skill needs to
 *     call runStartPreflight itself anymore — this CLI is the sole caller.
 *     Best-effort: a preflight failure degrades to no snapshot (logged WARN to
 *     stderr) rather than blocking run start. Non-interactive: needsTmuxPrompt
 *     is never acted on here (no operator to ask) — the resolved default is
 *     recorded in the snapshot as-is; a one-line NOTE goes to stderr instead.
 *

 *   status — convenience alias for `start --run-class=lightweight
 *             --command=/guild:status` WITH the OQ6 gate applied:
 *       npx tsx hooks/run-trace.ts status [--cwd <root>]
 *     Prints the run-id, or nothing when record_status_runs:false.
 *
 *   skipped — SC-G skipped-files sink (Lane A1):
 *       npx tsx hooks/run-trace.ts skipped --run-id <id> [--cwd <root>] < entries.json
 *     stdin is a JSON array of {path, reason, rule, can_manually_include,
 *     summary_produced} entries. Prints the written file path on stdout.
 *
 * Flag parsing: --foo=bar and --foo bar are both supported for all flags.
 *
 * Exit: 0 on success / no-op; 1 only on a usage error.
 *
 * Runner: bundled to dist/run-trace.js via esbuild (hooks/package.json).
 */

import { resolveGuildRoot } from "./lib/guild-root.js";
import {
  defaultResolveHost,
  recordStatusLightweight,
  recordPhase,
  resolveRunStartPreflight,
  startAndCloseRun,
  startRunOnly,
  writeSkippedFiles,
  type SkippedFileEntry,
} from "./lib/run-trace.js";

/**
 * Parse --name=value OR --name value. Returns undefined when absent.
 * Handles both forms so callers can use either style.
 */
function flag(argv: string[], name: string): string | undefined {
  // --name=value form
  const prefix = `--${name}=`;
  const eqMatch = argv.find((a) => a.startsWith(prefix));
  if (eqMatch) return eqMatch.slice(prefix.length);
  // --name value form
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : undefined;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

const USAGE =
  "usage: run-trace.ts <start|status|phase|skipped> [--cwd <root>] [--run-id <id>]\n" +
  "  start   --command=/guild:plan [--phase=<p>] [--run-class=full|lightweight] [--cwd <root>]\n" +
  "  status  [--cwd <root>]   (alias: start --run-class=lightweight + OQ6 gate)\n" +
  "  phase   --phase=<init|ideate|plan|build|qa|ops> [--run-id <id>] [--binding-ref <nonce>] [--cwd <root>]\n" +
  "  skipped --run-id <id>    [--binding-ref <nonce>] [--cwd <root>] < entries.json\n" +
  "  (rework F1: a writer addressing a run explicitly must present the run's\n" +
  "   binding nonce — --binding-ref or the GUILD_RUN_BINDING_REF env envelope;\n" +
  "   without it the write is refused: binding_rejected.)\n";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const cwd = flag(argv, "cwd") ?? process.env["GUILD_CWD"] ?? process.cwd();
  const root = resolveGuildRoot(cwd);

  // ── start — uniform record path (A2 rollout seam) ──────────────────────────
  if (sub === "start") {
    const command = flag(argv, "command") ?? "/guild:learn";
    const runClassRaw = flag(argv, "run-class");
    const runClass: "full" | "lightweight" =
      runClassRaw === "lightweight" ? "lightweight" : "full";
    // --initiative=<id> threads into startRun as the scalar attachment (NN#5:
    // recorded only, never creates a .guild/initiatives/ dir). Without this the
    // run always records initiative:null and an --initiative-attached command is
    // stored as a one-off (retention one-off-90d), detached from its initiative.
    const initiative = flag(argv, "initiative") ?? null;
    // T0: phase commands seed their phase when they START a full run.
    const phase = flag(argv, "phase") ?? null;

    // U3/U6 (audit fix): compute the resolved-settings snapshot deterministically
    // here — the CLI is the actual production caller of runStartPreflight now.
    // Best-effort: resolveRunStartPreflight never throws; a preflight failure
    // degrades to `undefined` (this run starts snapshot-less) rather than
    // blocking run start. Uses `cwd` (not `root`) — same operand
    // runStartPreflight documents everywhere else (the settings inheritance
    // chain resolves from the invocation cwd; `root` is only the .guild/ write base).
    const preflight = resolveRunStartPreflight(cwd);
    const snapshot = preflight?.snapshot;
    const session_identity = preflight?.session_identity;

    // Split by run-class:
    //   full (default) — start ONLY, leave run.yaml OPEN. The Stop hook
    //     (run-trace-close) closes it at session end once work has happened.
    //     Closing inline here would skip the Stop-hook close and record empty
    //     touched/artifact data (P1).
    //   lightweight — a point-in-time snapshot run (status/stats/wiki-query)
    //     that legitimately starts AND closes at once.
    const runId =
      runClass === "lightweight"
        ? startAndCloseRun(root, defaultResolveHost, {
            command,
            cwd,
            run_class: "lightweight",
            initiative,
            snapshot,
            session_identity,
          })
        : startRunOnly(root, defaultResolveHost, {
            command,
            cwd,
            run_class: "full",
            initiative,
            phase, // T0: seed run.yaml phase: + first phases_log entry (canonical-validated downstream)
            snapshot,
            session_identity,
          });
    if (runId) process.stdout.write(runId + "\n");
    process.exit(0);
  }

  // ── phase — T0 join-an-open-run phase writer ────────────────────────────────
  // A phase command that JOINS an already-open full run records its phase here
  // (vs. seeding it via `start --phase`). Best-effort: prints nothing, exit 0.
  if (sub === "phase") {
    const phase = flag(argv, "phase");
    if (!phase) {
      process.stderr.write(
        "[run-trace] usage: phase --phase=<init|ideate|plan|build|qa|ops> [--run-id <id>] [--cwd <root>]\n",
      );
      process.exit(1);
    }
    const runId = flag(argv, "run-id");
    const bindingRef = flag(argv, "binding-ref");
    recordPhase(root, phase, {
      ...(runId ? { runId } : {}),
      ...(bindingRef ? { binding_ref: bindingRef } : {}),
    });
    process.exit(0);
  }

  // ── status — convenience alias with OQ6 gate ────────────────────────────────
  if (sub === "status") {
    const runId = recordStatusLightweight(root, defaultResolveHost, { cwd });
    if (runId) process.stdout.write(runId + "\n");
    process.exit(0);
  }

  // ── skipped — SC-G sink ─────────────────────────────────────────────────────
  if (sub === "skipped") {
    const runId = flag(argv, "run-id") ?? process.env["GUILD_RUN_ID"];
    if (!runId) {
      process.stderr.write("[run-trace] usage: skipped --run-id <id> [--cwd <root>] < entries.json\n");
      process.exit(1);
    }
    const raw = await readStdin();
    let entries: SkippedFileEntry[] = [];
    try {
      const parsed = JSON.parse(raw.trim() || "[]");
      if (Array.isArray(parsed)) entries = parsed as SkippedFileEntry[];
    } catch {
      process.stderr.write("[run-trace] skipped: invalid JSON on stdin; writing empty set.\n");
    }
    const bindingRef = flag(argv, "binding-ref");
    const out = writeSkippedFiles(root, runId, entries, {
      ...(bindingRef ? { binding_ref: bindingRef } : {}),
    });
    if (out === null) {
      // T3b (§5): the write was refused — binding_rejected already went to
      // stderr; surface the fail-closed result non-zero to the caller.
      process.exit(1);
    }
    process.stdout.write(out + "\n");
    process.exit(0);
  }

  process.stderr.write("[run-trace] " + USAGE);
  process.exit(1);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[run-trace] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});

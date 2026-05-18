#!/usr/bin/env -S npx tsx
/**
 * scripts/new-run-id.ts
 *
 * Generates a fresh run-id for one /guild invocation, writes it to the
 * sentinel file `.guild/runs/current-run-id`, writes minimal run metadata,
 * and prints it to stdout.
 *
 * The sentinel file is the preferred run-id source for hooks running inside
 * the same Claude session but belonging to distinct /guild invocations.
 * capture-telemetry.ts reads it as priority-2 fallback (after GUILD_RUN_ID
 * env var, before run-<session_id>).
 *
 * Usage (from /guild Phase 1 via Bash tool):
 *   RUN_ID=$(npx tsx scripts/new-run-id.ts [--cwd <path>])
 *   echo "run-id: $RUN_ID"
 *
 * Stdout:  The run-id string (e.g. "run-20260501-a3f2c1d8")
 * Stderr:  Errors only.
 * Exit:    0 on success, 1 on write failure.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

function parseCwd(argv: string[]): string {
  const idx = argv.indexOf("--cwd");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return process.env["GUILD_CWD"] ?? process.cwd();
}

function generateRunId(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const suffix = crypto.randomBytes(4).toString("hex"); // 8 hex chars
  return `run-${date}-${suffix}`;
}

function main(): void {
  const cwd = parseCwd(process.argv.slice(2));
  const runId = generateRunId();

  const runsDir = path.join(cwd, ".guild", "runs");
  const sentinelPath = path.join(runsDir, "current-run-id");
  const runDir = path.join(runsDir, runId);
  const metadataPath = path.join(runDir, "metadata.json");

  try {
    fs.mkdirSync(runsDir, { recursive: true });
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(sentinelPath, runId, "utf8");
    fs.writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          schema_version: 1,
          run_id: runId,
          invocation: "/guild",
          started_at: new Date().toISOString(),
          cwd: path.resolve(cwd),
          current_run_sentinel: path.relative(cwd, sentinelPath),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  } catch (err) {
    process.stderr.write(
      `[new-run-id] ERROR: could not write sentinel ${sentinelPath}: ${
        err instanceof Error ? err.message : String(err)
      }\n`
    );
    process.exit(1);
  }

  process.stdout.write(runId + "\n");
}

main();

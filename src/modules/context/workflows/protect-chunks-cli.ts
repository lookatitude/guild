/**
 * src/modules/context/workflows/protect-chunks-cli.ts
 *
 * CLI implementation for the D-RECALL protect-chunks pipe. The executable
 * legacy entrypoint remains scripts/lib/protect-chunks.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { protectChunks, type RawRecallHit } from "./recall-protect";

export function runProtectChunksCli(): void {
  const argv = process.argv.slice(2);
  let hitsFile = "";
  let runId = "";
  let runDir = "";
  let cwd = process.env["GUILD_CWD"] ?? process.cwd();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if ((arg === "--hits-file" || arg === "--hits") && argv[i + 1]) { hitsFile = argv[++i]!; }
    else if (arg === "--run-id" && argv[i + 1]) { runId = argv[++i]!; }
    else if (arg === "--run-dir" && argv[i + 1]) { runDir = argv[++i]!; }
    else if (arg === "--cwd" && argv[i + 1]) { cwd = argv[++i]!; }
    else if (arg.startsWith("--hits-file=")) { hitsFile = arg.slice("--hits-file=".length); }
    else if (arg.startsWith("--hits=")) { hitsFile = arg.slice("--hits=".length); }
    else if (arg.startsWith("--run-id=")) { runId = arg.slice("--run-id=".length); }
    else if (arg.startsWith("--run-dir=")) { runDir = arg.slice("--run-dir=".length); }
    else if (arg.startsWith("--cwd=")) { cwd = arg.slice("--cwd=".length); }
  }

  if (runId && !runDir) {
    runDir = path.join(cwd, ".guild", "runs", runId);
  }

  let rawJson: string;
  if (hitsFile) {
    try {
      rawJson = fs.readFileSync(hitsFile, "utf8");
    } catch (e) {
      process.stderr.write(
        `[protect-chunks] ERROR: cannot read --hits-file "${hitsFile}": ${String(e)}\n`,
      );
      process.exit(1);
    }
  } else {
    try {
      rawJson = fs.readFileSync(0, "utf8");
    } catch (e) {
      process.stderr.write(
        `[protect-chunks] ERROR: cannot read stdin: ${String(e)}\n`,
      );
      process.exit(1);
    }
  }

  let rawHits: RawRecallHit[];
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(parsed)) throw new Error("input must be a JSON array");
    rawHits = parsed as RawRecallHit[];
  } catch (e) {
    process.stderr.write(
      `[protect-chunks] ERROR: invalid JSON input — expected RawRecallHit[]: ${String(e)}\n`,
    );
    process.exit(1);
  }

  const result = protectChunks(rawHits, {
    ...(runDir && runId ? { runDir, runId } : {}),
    callerTool: "protect-chunks",
  });

  process.stdout.write(JSON.stringify(result) + "\n");
}

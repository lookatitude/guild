#!/usr/bin/env -S npx tsx
/**
 * scripts/lib/protect-chunks.ts
 *
 * D-RECALL (Wave-3 security) — thin CLI wrapper around protectChunks().
 *
 * Reads RawRecallHit[] JSON from stdin (or --hits-file <path>), runs the
 * shared probe→quarantine→classify→wrap pipeline (recall-protect.ts), and
 * prints { chunks: ProtectedChunk[], directive: string | null } to stdout.
 *
 * This is the pipe-through entry point for the two raw recall paths that do
 * NOT go through wiki-recall.ts:
 *   - guild-memory MCP BM25 (hits from wiki_search tool output)
 *   - fsScan direct read    (hits from file-system scanner)
 *
 * Skills wire the pipe:
 *   guild-memory MCP → convert results to RawRecallHit[] → pipe here
 *   fsScan          → convert file content to RawRecallHit[] → pipe here
 *
 * Usage:
 *   # From stdin (guild-memory or fsScan converts its output to RawRecallHit[]):
 *   echo '[{"source_path":".guild/wiki/x.md","content":"..."}]' | \
 *     npx tsx scripts/lib/protect-chunks.ts [--run-id <id>] [--cwd <repo-root>]
 *
 *   # From a hits file:
 *   npx tsx scripts/lib/protect-chunks.ts \
 *     --hits-file /tmp/hits.json --run-id <id> --cwd <repo-root>
 *
 * Stdout: { chunks: ProtectedChunk[], directive: string | null }  (JSON, newline-terminated)
 * Stderr: errors only (prefixed [protect-chunks] ERROR:)
 * Exit 0 on success; exit 1 on I/O or parse error.
 *
 * Bundle invariant (guaranteed by protectChunks): every chunk is
 *   [QUARANTINED: …] / <guild:recall trust_tier>…</guild:recall> / operator-unwrapped.
 *   NEVER a raw snippet.
 *
 * Note: runDir is derived from --cwd + --run-id when --run-dir is absent.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { protectChunks, type RawRecallHit } from "./recall-protect";

if (require.main === module) {
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

  // Derive runDir from cwd + run-id when only run-id is given.
  if (runId && !runDir) {
    runDir = path.join(cwd, ".guild", "runs", runId);
  }

  // Read raw hits from file or stdin.
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
    // Block-read stdin (fd 0) — correct for a synchronous pipe consumer.
    try {
      rawJson = fs.readFileSync(0, "utf8");
    } catch (e) {
      process.stderr.write(
        `[protect-chunks] ERROR: cannot read stdin: ${String(e)}\n`,
      );
      process.exit(1);
    }
  }

  // Parse and validate input.
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

  // Run the shared D-RECALL choke-point.
  const result = protectChunks(rawHits, {
    ...(runDir && runId ? { runDir, runId } : {}),
    callerTool: "protect-chunks",
  });

  process.stdout.write(JSON.stringify(result) + "\n");
}

#!/usr/bin/env -S npx tsx
/**
 * hooks/comms-format-lint.ts
 *
 * Runner:    node ${CLAUDE_PLUGIN_ROOT}/hooks/dist/comms-format-lint.js
 *            (compiled via esbuild; see package.json "build" script)
 *            For dev/test: npx tsx hooks/comms-format-lint.ts
 *
 * Event:     PostToolUse — matcher: Write | Edit
 *
 * Justification for PostToolUse (Write|Edit):
 *   The hook fires immediately after each file write or edit, giving the user
 *   instant local advisory on the just-written file. The file path is available
 *   directly from tool_input.file_path — no git diff resolution needed, making
 *   this the tightest signal with minimal noise (only fires when files change,
 *   never on prompts or reads). A Stop hook would surface findings only at
 *   session end and would need to reconstruct which files were written.
 *
 * Purpose:
 *   U5a — non-blocking local advisory arm of the comms-format lint.
 *   Imports and calls lintCommsFormat() from the tooling-engineer's lint core
 *   (plugin/scripts/comms/comms-format-lint.ts), passes only the just-written
 *   file path, and prints any findings as advisory warnings.
 *
 *   WARN ONLY: always exits 0. Never blocks. enforce=false (never passed).
 *   U5b will flip to enforce=true; this hook must not anticipate that.
 *
 * Imports from scripts: the pattern is established by hooks/lib/run-trace.ts
 *   which imports from ../../scripts/lib/run-lifecycle.js. From hooks/ root,
 *   the scripts package is one level up at ../scripts/.
 *
 * Stdin:   JSON — Claude Code PostToolUse hook payload.
 * Stdout:  Silent — Claude Code may consume stdout.
 * Stderr:  Advisory WARN lines for each finding; OK banner when none.
 * Exit:    Always 0 — lint findings must NEVER block tool execution (U5a).
 *
 * Owner: hook-engineer (U5a).
 */

import * as path from "path";
import { lintCommsFormat, type CommsLintFinding } from "../scripts/comms/comms-format-lint.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface PostToolUsePayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; [key: string]: unknown };
  tool_response?: unknown;
}

// ── Stdin reader ───────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

// ── Finding printer ────────────────────────────────────────────────────────

function printFindings(findings: CommsLintFinding[]): void {
  if (findings.length === 0) {
    // Silent on clean — no OK banner to avoid stdout noise in normal operation.
    return;
  }
  for (const f of findings) {
    const loc = f.line !== undefined ? `:${f.line}` : "";
    // Print to stderr — Claude Code only consumes stdout for hook control signals.
    process.stderr.write(
      `[comms-format-lint] WARN [check-${f.check}] ${f.file}${loc}: ${f.message}\n`
    );
  }
  process.stderr.write(
    `[comms-format-lint] ${findings.length} warning(s) — non-blocking (U5a warn mode)\n`
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const raw = await readStdin();

  let payload: PostToolUsePayload = {};
  try {
    payload = JSON.parse(raw.trim()) as PostToolUsePayload;
  } catch {
    // Invalid JSON — no-op. The hook must not block on malformed payloads.
    process.exit(0);
  }

  // Only act on Write and Edit tool events.
  const toolName = payload.tool_name ?? "";
  if (toolName !== "Write" && toolName !== "Edit") {
    process.exit(0);
  }

  // Extract the written/edited file path from tool_input.
  const filePath = payload.tool_input?.file_path;
  if (typeof filePath !== "string" || filePath.trim() === "") {
    // No path — nothing to lint.
    process.exit(0);
  }

  // Resolve to absolute path.
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd(), filePath);

  // Call the lint core — enforce=false (U5a warn mode; never pass enforce=true here).
  let findings: CommsLintFinding[] = [];
  try {
    findings = lintCommsFormat({ paths: [absolutePath] });
  } catch (err) {
    // Lint failures must not block the tool.
    process.stderr.write(
      `[comms-format-lint] WARN: lint core threw — ${
        err instanceof Error ? err.message : String(err)
      }\n`
    );
    process.exit(0);
  }

  printFindings(findings);

  // U5a: always exit 0 unconditionally.
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[comms-format-lint] WARN: unexpected error — ${
      err instanceof Error ? err.message : String(err)
    }\n`
  );
  // Always exit 0 — never block.
  process.exit(0);
});

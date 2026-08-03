#!/usr/bin/env -S npx tsx
/**
 * hooks/comms-format-lint.ts
 *
 * Runner:    node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/comms-format-lint.js
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
 *   U5b — CONSERVATIVE opt-in enforce mode: blocks ONLY on check-(a) violations
 *         (ambiguous receipt: no/duplicate/invalid embedded guild.handoff.v2 block)
 *         when GUILD_COMMS_FORMAT_ENFORCE=1. check-(b) and check-(c) are ALWAYS
 *         advisory (exit 0) regardless of enforce mode — they are stylistic, not
 *         a hard machine-contract break.
 *
 *   Imports and calls lintCommsFormat() from the tooling-engineer's lint core
 *   (plugin/scripts/comms/comms-format-lint.ts), passes only the just-written
 *   file path, and prints any findings as advisory warnings or (in enforce mode
 *   for check-a) a hard block.
 *
 * Enforce opt-in (U5b):
 *   Set GUILD_COMMS_FORMAT_ENFORCE=1 to enable enforce mode. Default (absent or
 *   any value other than "1") is warn-only, preserving exact U5a behavior.
 *   This is intentionally opt-in: the default must NEVER block. Only flip ON
 *   after all receipt emitters pass warn-mode clean (deps: U5a, U6).
 *
 * Block mechanism (PostToolUse, U5b):
 *   A PostToolUse hook signals a block by exiting with code 2. Claude Code
 *   surfaces the stderr output as an error to the user. No stdout JSON needed
 *   (that is the PreToolUse permissionDecision mechanism; PostToolUse uses
 *   exit codes: 0 = allow/advisory, 2 = block, other non-zero = error).
 *   Only check-(a) on an in-scope receipt uses exit 2; everything else exits 0.
 *
 * Resilience contract (U5b invariant):
 *   Bad stdin / missing file / lint throw → exit 0. The hook NEVER blocks on
 *   its own errors. Conservative: when in doubt, advise and let the write through.
 *
 * Imports from scripts: the pattern is established by hooks/lib/run-trace.ts
 *   which imports from ../../scripts/lib/run-lifecycle.js. From hooks/ root,
 *   the scripts package is one level up at ../scripts/.
 *
 * Stdin:   JSON — Claude Code PostToolUse hook payload.
 * Stdout:  Silent — Claude Code may consume stdout.
 * Stderr:  Advisory WARN lines for each finding; BLOCK line + reason on exit 2.
 * Exit:    0  — warn-only (U5a default) OR enforce ON but no check-(a) violation.
 *          2  — enforce ON (GUILD_COMMS_FORMAT_ENFORCE=1) AND check-(a) violation
 *               on an in-scope receipt. (PostToolUse block convention.)
 *
 * Owner: hook-engineer (U5a → U5b).
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

// ── Enforce mode reader ────────────────────────────────────────────────────

/**
 * Returns true iff enforce mode is explicitly opted in via env var.
 * Opt-in: GUILD_COMMS_FORMAT_ENFORCE=1 (exactly "1").
 * Default: absent or any other value → warn-only (U5a behavior).
 *
 * This intentionally requires an exact "1" so that an empty, unset, or
 * accidental value like "true"/"yes" does NOT flip enforce on. Strict
 * opt-in prevents silent activation across environments.
 */
function isEnforceEnabled(): boolean {
  return process.env["GUILD_COMMS_FORMAT_ENFORCE"] === "1";
}

// ── Finding printer ────────────────────────────────────────────────────────

/**
 * Print all findings to stderr as advisory WARNs.
 * In enforce mode, check-(a) findings are also marked as BLOCK candidates —
 * the actual exit code is decided in main() after all findings are collected.
 *
 * Returns whether any check-(a) findings were found (used by main() to
 * decide whether to exit 2 in enforce mode).
 */
function printFindings(findings: CommsLintFinding[], enforceMode: boolean): boolean {
  if (findings.length === 0) {
    // Silent on clean — no OK banner to avoid stdout noise in normal operation.
    return false;
  }

  let hasCheckA = false;
  for (const f of findings) {
    const loc = f.line !== undefined ? `:${f.line}` : "";
    // Print to stderr — Claude Code only consumes stdout for hook control signals.
    process.stderr.write(
      `[comms-format-lint] WARN [check-${f.check}] ${f.file}${loc}: ${f.message}\n`
    );
    if (f.check === "a") {
      hasCheckA = true;
    }
  }

  if (enforceMode && hasCheckA) {
    // Emit the BLOCK summary line to stderr so the user sees exactly why the
    // hook blocked. Exit code 2 is set in main() after this returns.
    // check-(b) and check-(c) findings are already printed above as WARNs;
    // they do NOT contribute to the block decision even in enforce mode.
    const checkAFindings = findings.filter((f) => f.check === "a");
    process.stderr.write(
      `[comms-format-lint] BLOCK: enforce mode active (GUILD_COMMS_FORMAT_ENFORCE=1) ` +
        `— ${checkAFindings.length} check-a violation(s) detected.\n` +
        `  Receipts must embed exactly ONE valid \`guild.handoff.v2\` JSON block ` +
        `(communication-format-policy §"Handoff contract", OD-2).\n` +
        `  To suppress this block, fix the receipt or set GUILD_COMMS_FORMAT_ENFORCE=0.\n`
    );
    return true;
  }

  const mode = enforceMode ? "enforce mode (check-b/c advisory only)" : "U5a warn mode";
  process.stderr.write(
    `[comms-format-lint] ${findings.length} warning(s) — non-blocking (${mode})\n`
  );
  return false;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Read enforce mode once at entry — checked after findings are collected.
  const enforceMode = isEnforceEnabled();

  const raw = await readStdin();

  let payload: PostToolUsePayload = {};
  try {
    payload = JSON.parse(raw.trim()) as PostToolUsePayload;
  } catch {
    // Invalid JSON — no-op. The hook must not block on malformed payloads.
    // Resilience contract: bad stdin → exit 0 even in enforce mode.
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
    // No path — nothing to lint. Resilience: missing path → exit 0.
    process.exit(0);
  }

  // Resolve to absolute path.
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd(), filePath);

  // Call the lint core. enforce flag is passed to the core for future use but
  // the exit-code decision is made HERE (not in the core) for U5b — the hook
  // owns the block vs. warn distinction.
  let findings: CommsLintFinding[] = [];
  try {
    findings = lintCommsFormat({ paths: [absolutePath], enforce: enforceMode });
  } catch (err) {
    // Lint failures must not block the tool.
    // Resilience contract: lint throw → exit 0 even in enforce mode.
    process.stderr.write(
      `[comms-format-lint] WARN: lint core threw — ${
        err instanceof Error ? err.message : String(err)
      }\n`
    );
    process.exit(0);
  }

  const shouldBlock = printFindings(findings, enforceMode);

  if (shouldBlock) {
    // U5b enforce path: exit 2 signals a PostToolUse block to Claude Code.
    // CONSERVATIVE: only check-(a) findings trigger this path. check-(b)/(c)
    // are always advisory and printFindings() never returns true for them.
    // This is the ONLY place in this hook that exits non-zero.
    process.exit(2);
  }

  // U5a default (enforce OFF) or enforce ON but no check-(a) violation:
  // always exit 0.
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[comms-format-lint] WARN: unexpected error — ${
      err instanceof Error ? err.message : String(err)
    }\n`
  );
  // Resilience contract: unexpected errors → always exit 0. Never block on
  // the hook's own failures (even in enforce mode).
  process.exit(0);
});

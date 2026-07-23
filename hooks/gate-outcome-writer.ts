#!/usr/bin/env -S npx tsx
/**
 * hooks/gate-outcome-writer.ts
 *
 * Event:   PostToolUse (matcher: Write|Edit)
 * Purpose: G5(b) (v23x-deferred-followups rf-wi-05, origin oir-wi-58) — the
 *          missing writer for run.yaml's `gates:` block. `buildRunManifest`
 *          (src/modules/lifecycle/workflows/run-lifecycle.ts) writes
 *          `gates: {}` once at run start and NOTHING ever updated it.
 *          hooks/lib/reanchor.ts's `readRunYamlFacts`/`deriveNextGate` (the
 *          re-anchor header's next-gate pointer) already READS this map and
 *          treats a `{ outcome: "pass"|"passed"|"success"|"succeeded" }`
 *          entry as a passed gate — that reader has had nothing to read
 *          until now.
 *
 *          This hook observes the review/verify-done BOUNDARY: `guild:review`
 *          writes `.guild/runs/<run-id>/review.md`, `guild:verify-done` writes
 *          `.guild/runs/<run-id>/verify.md` (both skills, not scripts — the
 *          Write of that exact file IS the observable boundary). On such a
 *          write, this hook re-reads the artifact and records a gate outcome
 *          via `appendGateOutcome`.
 *
 *          Deliberately CONSERVATIVE: a gate outcome is written ONLY when the
 *          report's own pass/fail signal is unambiguous, per each skill's
 *          documented contract:
 *            - verify.md (skills/meta/verify-done/SKILL.md §Output): "Overall
 *              status — `pass` or `fail`."
 *            - review.md (skills/meta/review/SKILL.md): no single top-line
 *              verdict: "Output per lane: ✓ pass ... ✗ fail" glyphs — a ✗
 *              anywhere means the lane review is not clean.
 *          An AMBIGUOUS report (neither signal found) writes NOTHING — a
 *          wrongly recorded "pass" would let deriveNextGate advance past a
 *          gate that did not really pass, which is worse than the current
 *          always-`{}` state. Never blocks the tool call: best-effort,
 *          exit 0 always.
 *
 * Stdin:   JSON — Claude Code PostToolUse hook payload.
 * Stdout:  Silent.
 * Stderr:  Diagnostics only.
 * Exit:    Always 0.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGuildRoot } from "./lib/guild-root.js";
import { appendGateOutcome } from "../src/modules/lifecycle/workflows/run-lifecycle.js";

interface GateWriterPayload {
  tool_name?: string;
  tool_input?: { file_path?: string };
  cwd?: string;
}

function readCurrentRunId(cwd: string): string | undefined {
  const sentinelPath = path.join(resolveGuildRoot(cwd), ".guild", "runs", "current-run-id");
  try {
    const value = fs.readFileSync(sentinelPath, "utf8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveRunId(cwd: string): string | undefined {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.length > 0) return envRunId;
  return readCurrentRunId(cwd);
}

/** The two gate-report artifacts this hook watches, and the gate token each records. */
const GATE_REPORTS: Record<string, string> = {
  "review.md": "review",
  "verify.md": "verify-done",
};

/**
 * Parse an unambiguous pass/fail signal out of a gate report body. Returns
 * null when the signal is ambiguous — callers must NOT write a guess.
 * Exported for direct unit testing of the parser in isolation.
 */
export function parseGateOutcome(gate: string, content: string): "pass" | "fail" | null {
  if (gate === "verify-done") {
    // skills/meta/verify-done/SKILL.md §Output: "Overall status — `pass` or `fail`."
    // The token may sit on the SAME line ("Overall status: pass") or the NEXT
    // one (a markdown heading "## Overall status" followed by "pass" below) —
    // [\s\S] (not [^\n]) lets the bounded lookahead cross that one newline.
    const m = content.match(/overall\s*status\b[\s\S]{0,40}?\b(pass|fail)\b/i);
    if (m) return m[1].toLowerCase() as "pass" | "fail";
  }
  // Shared fallback (also review.md's ONLY signal — its contract has no single
  // "overall status" line): skills/meta/review/SKILL.md's ✓/✗ per-lane glyphs.
  // A ✗ ANYWHERE means at least one lane failed review — conservative: any
  // failing lane fails the gate as a whole.
  if (content.includes("✗")) return "fail";
  if (content.includes("✓")) return "pass";
  return null;
}

const realFs = {
  readFile(p: string): string | null {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
  writeFile(p: string, contents: string): void {
    fs.writeFileSync(p, contents, "utf8");
  },
};

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

export async function main(): Promise<void> {
  const raw = await readStdin();
  let payload: GateWriterPayload = {};
  try {
    if (raw.trim().length > 0) {
      const parsed: unknown = JSON.parse(raw.trim());
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as GateWriterPayload;
      }
    }
  } catch {
    process.stderr.write("warn: [gate-outcome-writer] invalid JSON on stdin; skipping.\n");
    return;
  }

  const toolName = payload.tool_name;
  if (toolName !== "Write" && toolName !== "Edit") return;
  const filePath = payload.tool_input?.file_path;
  if (typeof filePath !== "string" || filePath.length === 0) return;

  const basename = path.basename(filePath);
  const gate = GATE_REPORTS[basename];
  if (gate === undefined) return;

  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const runId = resolveRunId(cwd);
  if (typeof runId !== "string" || runId.length === 0) return;

  const root = resolveGuildRoot(cwd);
  const expectedDir = path.join(root, ".guild", "runs", runId);
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  // Path-anchor: the write must be INSIDE THIS run's own dir — never record a
  // gate for a report belonging to a DIFFERENT run just because the basename
  // happens to match.
  if (path.dirname(abs) !== expectedDir) return;

  let content: string;
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch (err) {
    process.stderr.write(
      `warn: [gate-outcome-writer] could not read ${abs}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return;
  }

  const outcome = parseGateOutcome(gate, content);
  if (outcome === null) {
    process.stderr.write(
      `[gate-outcome-writer] ${basename}: no unambiguous pass/fail signal — gates: left unrecorded.\n`,
    );
    return;
  }

  try {
    const recorded = appendGateOutcome(realFs, root, runId, gate, {
      posture: "auto",
      outcome,
      codex_review: "unknown",
    });
    if (!recorded) {
      process.stderr.write(
        "warn: [gate-outcome-writer] appendGateOutcome did not record (missing/invalid run.yaml?).\n",
      );
    }
  } catch (err) {
    process.stderr.write(
      `warn: [gate-outcome-writer] write failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

if (
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("gate-outcome-writer.ts") ||
    process.argv[1].endsWith("gate-outcome-writer.js"))
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `fatal: [gate-outcome-writer] ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(0);
  });
}

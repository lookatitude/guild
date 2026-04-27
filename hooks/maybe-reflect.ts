#!/usr/bin/env -S npx tsx
/**
 * hooks/maybe-reflect.ts
 *
 * Events:  Stop  |  SubagentStop                   (v1.3 — F12 widened)
 * Purpose: Fires guild:reflect ONLY if the §13.2 heuristic gate is satisfied.
 *
 * Stop branch (the original /guild lifecycle path):
 *   ✓  ≥ 1 specialist dispatched  → SubagentStop with non-empty specialist field
 *   ✓  ≥ 1 file edited            → PostToolUse with tool "Write" or "Edit"
 *   ✓  No error event             → all events have ok: true
 *
 * SubagentStop branch (v1.3 — F12 widened — dev-team work):
 *   ✓  process.env.GUILD_ENABLE_DEVTEAM_REFLECT === "1"   (operator opt-in; default off)
 *   ✓  ≥ 3 SubagentStop dispatches accumulated in the run's events.ndjson
 *       (counted from the existing capture-telemetry.ts log — no new state file)
 *   ✓  .guild/spec/<slug>.md exists for the active task
 *       (slug from GUILD_SPEC_SLUG env var; falls back to "any spec exists")
 *
 * If gate fails → no-op (silent, exit 0). Prevents spurious reflections on
 * non-task sessions (§15.2 risk: "Stop hook fires on non-task sessions") and
 * trivial dev-team work that doesn't deserve a reflection.
 *
 * Design note (F12 dispatch counter):
 * ---------------------------------------------------------------------
 * The ≥ 3 dispatch threshold reads from the existing events.ndjson rather
 * than introducing a new state file (e.g., `.guild/runs/<id>/agent-team/
 * counter.json`). Reasoning:
 *   - capture-telemetry.ts already appends one event per SubagentStop
 *     with the agent's name in `specialist` (see hooks/capture-telemetry.ts).
 *   - A separate counter file would be a second write surface (more code,
 *     two-source-of-truth coherence problem, extra cleanup).
 *   - Counting from events.ndjson is O(events) per gate evaluation but
 *     events lists are bounded by the run length, and gate evaluation
 *     happens at most once per SubagentStop, so the cost is fine.
 * ---------------------------------------------------------------------
 *
 * If gate passes:
 *   1. Attempt to run scripts/trace-summarize.ts (tooling-engineer ships in P5 Task 3).
 *      If that script is missing, produce a compact stub summary from events.ndjson.
 *      Either way, write .guild/runs/<run-id>/summary.md.
 *   2. Emit one line to stdout telling the orchestrator to invoke guild:reflect:
 *        GUILD_REFLECT run_id=<run-id>
 *      The orchestrator reads this and invokes guild:reflect.
 *
 * Run-id resolution (priority order):
 *   1. GUILD_RUN_ID env var
 *   2. stdin payload session_id field
 *   3. fallback: "session-<date>"
 *
 * Working directory resolution (priority order):
 *   1. GUILD_CWD env var
 *   2. stdin payload cwd field
 *   3. process.cwd()
 *
 * Stdin:   JSON — Claude Code Stop or SubagentStop hook payload.
 * Stdout:  Either empty (gate failed) or "GUILD_REFLECT run_id=<id>" (gate passed).
 * Stderr:  Diagnostic messages only.
 * Exit:    Always 0.
 *
 * Runner:  npx -y tsx hooks/maybe-reflect.ts
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

// ── Types ──────────────────────────────────────────────────────────────────

interface HookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  stop_reason?: string;
}

interface TelemetryEvent {
  ts: string;
  event: string;
  tool: string;
  specialist: string;
  payload_digest: string;
  ok: boolean;
  ms: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Read all stdin into a string. */
async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

/** Load and parse events.ndjson; returns empty array if missing or unparseable. */
function loadEvents(eventsFile: string): TelemetryEvent[] {
  if (!fs.existsSync(eventsFile)) return [];
  const content = fs.readFileSync(eventsFile, "utf8");
  const events: TelemetryEvent[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as TelemetryEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

/**
 * Heuristic gate — all three conditions must hold:
 *   1. ≥ 1 specialist dispatched (SubagentStop with non-empty specialist)
 *   2. ≥ 1 file edited (PostToolUse with tool "Write" or "Edit")
 *   3. No error event (all ok: true)
 */
function gateCheck(events: TelemetryEvent[]): boolean {
  if (events.length === 0) return false;

  const hasSpecialist = events.some(
    (e) => e.event === "SubagentStop" && e.specialist && e.specialist.trim().length > 0
  );
  const hasFileEdit = events.some(
    (e) =>
      e.event === "PostToolUse" &&
      (e.tool === "Write" || e.tool === "Edit")
  );
  const hasError = events.some((e) => e.ok === false);

  return hasSpecialist && hasFileEdit && !hasError;
}

/**
 * v1.3 — F12: dev-team SubagentStop gate. Fires only when ALL three
 * guards hold; default-off via the env var.
 *
 *   1. process.env.GUILD_ENABLE_DEVTEAM_REFLECT === "1"  (operator opt-in)
 *   2. ≥ 3 SubagentStop dispatches in events.ndjson      (threshold filter)
 *   3. .guild/spec/<slug>.md exists                      (something to reflect against)
 *
 * Slug resolution: GUILD_SPEC_SLUG env var first; if unset, falls back to
 * "any *.md exists under .guild/spec/" (the orchestrator may not always
 * export the slug per dispatch). Returns true only when a spec is locatable.
 */
function devteamSubagentGateCheck(
  events: TelemetryEvent[],
  cwd: string,
): { passed: boolean; reason: string } {
  // Guard 1 — operator opt-in. Default off.
  if (process.env["GUILD_ENABLE_DEVTEAM_REFLECT"] !== "1") {
    return { passed: false, reason: "GUILD_ENABLE_DEVTEAM_REFLECT != 1" };
  }
  // Guard 2 — dispatch threshold. Count SubagentStop events with a
  // non-empty specialist field; trivial work (< 3 dispatches) doesn't
  // warrant a reflection.
  const dispatchCount = events.filter(
    (e) =>
      e.event === "SubagentStop" &&
      typeof e.specialist === "string" &&
      e.specialist.trim().length > 0,
  ).length;
  if (dispatchCount < 3) {
    return {
      passed: false,
      reason: `dispatch count ${dispatchCount} < 3`,
    };
  }
  // Guard 3 — spec lookup. Reflections are only meaningful when there's
  // a written spec to reflect against. GUILD_SPEC_SLUG wins; otherwise
  // "any spec.md exists" is the conservative fallback.
  const specDir = path.join(cwd, ".guild", "spec");
  const slug = process.env["GUILD_SPEC_SLUG"];
  if (slug && slug.trim().length > 0) {
    const specPath = path.join(specDir, `${slug}.md`);
    if (!fs.existsSync(specPath)) {
      return { passed: false, reason: `spec not found: ${specPath}` };
    }
  } else {
    if (!fs.existsSync(specDir)) {
      return { passed: false, reason: `spec dir not found: ${specDir}` };
    }
    let anySpec = false;
    try {
      const entries = fs.readdirSync(specDir);
      anySpec = entries.some((name) => name.endsWith(".md"));
    } catch {
      anySpec = false;
    }
    if (!anySpec) {
      return { passed: false, reason: `no *.md spec under ${specDir}` };
    }
  }
  return { passed: true, reason: "all guards met" };
}

/**
 * Produce a compact stub summary from events and write it to summary.md.
 * Used when scripts/trace-summarize.ts is not yet available.
 */
function writeStubSummary(runDir: string, runId: string, events: TelemetryEvent[]): void {
  const specialists = [
    ...new Set(events.map((e) => e.specialist).filter(Boolean)),
  ];
  const tools = [...new Set(events.map((e) => e.tool).filter(Boolean))];
  const editCount = events.filter(
    (e) => e.tool === "Write" || e.tool === "Edit"
  ).length;
  const totalMs = events.reduce((acc, e) => acc + (e.ms ?? 0), 0);

  const lines = [
    `# Run summary: ${runId}`,
    "",
    `Generated: ${new Date().toISOString()} (stub — trace-summarize.ts not yet available)`,
    "",
    "## Specialists dispatched",
    specialists.length > 0 ? specialists.map((s) => `- ${s}`).join("\n") : "- (none)",
    "",
    "## Tool activity",
    `- Total events: ${events.length}`,
    `- File edits: ${editCount}`,
    `- Unique tools: ${tools.join(", ") || "(none)"}`,
    `- Total duration: ${totalMs}ms`,
    "",
    "## Outcome",
    "Gate passed: specialist dispatched, file edited, no errors.",
    "",
    "<!-- fallback summary from maybe-reflect.ts — scripts/trace-summarize.ts was unavailable at this cwd. Install/restore scripts/trace-summarize.ts for the richer summary that guild:reflect prefers. -->",
  ];

  const summaryPath = path.join(runDir, "summary.md");
  fs.writeFileSync(summaryPath, lines.join("\n") + "\n", "utf8");
  process.stderr.write(`[maybe-reflect] wrote fallback summary to ${summaryPath}\n`);
}

/**
 * Attempt to run scripts/trace-summarize.ts.
 * If it exists and succeeds, it writes summary.md itself.
 * Returns true if the real summarizer ran, false if it's missing (use stub).
 */
function tryRealSummarizer(cwd: string, runId: string): boolean {
  const summarizerPath = path.join(cwd, "scripts", "trace-summarize.ts");
  if (!fs.existsSync(summarizerPath)) return false;

  const result = spawnSync(
    "npx",
    ["tsx", summarizerPath, "--run-id", runId, "--cwd", cwd],
    {
      cwd,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env },
    }
  );

  if (result.status !== 0) {
    process.stderr.write(
      `[maybe-reflect] trace-summarize.ts exited ${result.status}: ${result.stderr ?? ""}\n`
    );
    return false;
  }
  return true;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const raw = await readStdin();

  let payload: HookPayload = {};
  try {
    payload = JSON.parse(raw.trim()) as HookPayload;
  } catch {
    // Invalid JSON is fine — no-op silently
    process.stderr.write("[maybe-reflect] WARN: invalid JSON on stdin; treating as non-task stop.\n");
    process.exit(0);
  }

  // Resolve run context — same convention as hooks/capture-telemetry.ts:
  // `run-<session_id>` by default; GUILD_RUN_ID env var wins when set
  // (agent-team launcher exports it per pane for convergence).
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const sessionId = payload.session_id;
  const runId =
    process.env["GUILD_RUN_ID"] ??
    (sessionId ? `run-${sessionId}` : `run-session-${new Date().toISOString().slice(0, 10)}`);

  // Load telemetry events
  const eventsFile = path.join(cwd, ".guild", "runs", runId, "events.ndjson");
  const events = loadEvents(eventsFile);

  // v1.3 — F12: branch on hook_event_name. SubagentStop gets the dev-team
  // gate (opt-in env var + dispatch threshold + spec presence); Stop gets
  // the original heuristic gate (specialist + edit + no error).
  const hookEvent = payload.hook_event_name ?? "Stop";

  if (hookEvent === "SubagentStop") {
    const result = devteamSubagentGateCheck(events, cwd);
    if (!result.passed) {
      process.stderr.write(
        `[maybe-reflect] dev-team gate failed for run ${runId}: ${result.reason} — skipping reflection.\n`,
      );
      process.exit(0);
    }
    // Dev-team gate passed — fall through to summary + reflect marker.
  } else {
    // Stop event — apply the original heuristic gate.
    if (!gateCheck(events)) {
      // Gate failed — no-op, no stdout, exit 0
      process.stderr.write(
        `[maybe-reflect] gate failed for run ${runId} — skipping reflection.\n`,
      );
      process.exit(0);
    }
  }

  // Gate passed — produce summary, then tell orchestrator to reflect
  const runDir = path.join(cwd, ".guild", "runs", runId);

  const usedRealSummarizer = tryRealSummarizer(cwd, runId);
  if (!usedRealSummarizer) {
    writeStubSummary(runDir, runId, events);
  }

  // Emit reflect marker to stdout — orchestrator reads this line
  process.stdout.write(`GUILD_REFLECT run_id=${runId}\n`);
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[maybe-reflect] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(0); // Always exit 0
});

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
 * Stderr:  Diagnostic messages + (self-build only) the codex-skip DISCIPLINE banner.
 * Exit:    0 in all normal paths. EXCEPTION (self-build only): exits 2 when the
 *          codex adversarial-review skip streak reaches >= 3 consecutive
 *          reflections (FU-E) — the loudest honest escalation a Stop hook has,
 *          paired with the .guild/codex-skip-streak.json blocking sentinel.
 *
 * Runner:  npx -y tsx hooks/maybe-reflect.ts
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

import { resolveGuildRoot } from "./lib/guild-root.js";

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
  const specDir = path.join(resolveGuildRoot(cwd), ".guild", "spec");
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

// ── Codex-skip discipline guard (FU-E) ──────────────────────────────────────

/** Consecutive skip count at which the guard hard-fails. Matches the banner. */
const CODEX_SKIP_THRESHOLD = 3;

/** Non-zero exit code emitted when the threshold is breached. */
const CODEX_SKIP_EXIT_CODE = 2;

/**
 * Marker contract — a reflection "records a codex-review skip" if ANY of:
 *
 *   1. Frontmatter field (CANONICAL, machine-readable — emit this going
 *      forward):                    codex_review: SKIPPED
 *   2. Legacy proposals list:       skill_improvement: [..., guild:codex-review, ...]
 *   3. Body marker (for prose-style reflections):  <!-- codex_review: SKIPPED -->
 *
 * (1) is what new reflections SHOULD write — guild:reflect must emit
 * `codex_review: SKIPPED` (or `codex_review: RAN`) in frontmatter on every
 * self-build run. (2) and (3) are accepted for backward/forward compatibility
 * with the formats already on disk.
 */
function reflectionRecordsCodexSkip(content: string): boolean {
  // (1) Canonical frontmatter field.
  if (/^\s*codex_review:\s*SKIPPED\s*$/im.test(content)) return true;
  // (3) Body / prose marker.
  if (/<!--\s*codex_review:\s*SKIPPED\s*-->/i.test(content)) return true;
  // (2) Legacy skill_improvement list naming guild:codex-review.
  const m = content.match(/skill_improvement:\s*\[([^\]]*)\]/);
  if (m && m[1].includes("guild:codex-review")) return true;
  return false;
}

/**
 * Count the streak of CONSECUTIVE most-recent reflections (newest first by
 * mtime) that record a codex-review skip. A reflection that explicitly does
 * NOT record a skip (i.e. codex review ran) breaks the streak — that is the
 * honest meaning of "consecutive skips".
 *
 * `armed` is true only in self-build context (plugin/CLAUDE.md present with the
 * orientation banner). Outside self-build the guard never fires.
 */
function evaluateCodexSkipGuard(guildRoot: string): {
  armed: boolean;
  streak: number;
} {
  try {
    const claudeMd = path.join(guildRoot, "plugin", "CLAUDE.md");
    if (!fs.existsSync(claudeMd)) return { armed: false, streak: 0 };
    // Confirm it's the Guild orientation file, not some other plugin/CLAUDE.md.
    let armed = false;
    try {
      armed = fs
        .readFileSync(claudeMd, "utf8")
        .includes("Guild — repo orientation");
    } catch {
      armed = false;
    }
    if (!armed) return { armed: false, streak: 0 };

    const reflectionsDir = path.join(guildRoot, ".guild", "reflections");
    if (!fs.existsSync(reflectionsDir)) return { armed: true, streak: 0 };

    const files = fs
      .readdirSync(reflectionsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(reflectionsDir, f))
      .map((p) => {
        let mtime = 0;
        try {
          mtime = fs.statSync(p).mtimeMs;
        } catch {
          mtime = 0;
        }
        return { path: p, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    let streak = 0;
    for (const { path: p } of files) {
      let content = "";
      try {
        content = fs.readFileSync(p, "utf8");
      } catch {
        // unreadable file breaks the streak (can't confirm a skip)
        break;
      }
      if (reflectionRecordsCodexSkip(content)) {
        streak += 1;
      } else {
        break; // first non-skip reflection ends the consecutive run
      }
    }
    return { armed: true, streak };
  } catch {
    // Never let the guard's own failure block the hook.
    return { armed: false, streak: 0 };
  }
}

/**
 * Persist the blocking sentinel the NEXT G-gate reads. Atomic-ish: a plain
 * write is fine here (single-writer, idempotent content). The gate refuses
 * while `blocked: true`.
 */
function writeCodexSkipSentinel(guildRoot: string, streak: number): void {
  try {
    const guildDir = path.join(guildRoot, ".guild");
    fs.mkdirSync(guildDir, { recursive: true });
    const sentinel = path.join(guildDir, "codex-skip-streak.json");
    const data = {
      schema_version: "guild.codex_skip_streak.v1",
      streak,
      threshold: CODEX_SKIP_THRESHOLD,
      blocked: true,
      updated_at: new Date().toISOString(),
      reason:
        "codex adversarial review skipped on >= 3 consecutive self-build reflections (FU-E)",
      clear_by:
        "run guild:codex-review at the next gate, OR record a reflection without a codex_review: SKIPPED marker, OR delete this file after an explicit operator override",
    };
    fs.writeFileSync(sentinel, JSON.stringify(data, null, 2) + "\n", "utf8");
    process.stderr.write(
      `[maybe-reflect] wrote codex-skip sentinel: ${sentinel}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[maybe-reflect] WARN: failed to write codex-skip sentinel: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
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
  // Walk up from cwd to find the repo root — ensures .guild/ always lands at
  // the nearest .git / .guild ancestor, never in a subdirectory.
  const guildRoot = resolveGuildRoot(cwd);

  // Signal 2 (cross-run): codex-skip discipline guard on self-build runs (FU-E).
  //
  // Contract (SessionStart banner): "three consecutive skips trigger a hard
  // fail at the gate (maybe-reflect.ts checks the reflection trail)."
  //
  // A Stop hook fires AFTER the turn — it cannot retroactively fail a gate that
  // already passed. The honest enforcement a Stop hook CAN deliver is:
  //   (a) a persisted sentinel (.guild/codex-skip-streak.json) that the NEXT
  //       G-gate reads and refuses on, and
  //   (b) a loud stderr DISCIPLINE banner + NON-ZERO exit so the skip is
  //       impossible to miss in the transcript.
  // Both fire at the >= 3 consecutive-skip threshold. Below threshold we record
  // the streak quietly (no sentinel, exit continues normally).
  //
  // This guard ONLY arms in self-build context (cwd has plugin/CLAUDE.md with
  // the orientation banner) so it never disturbs a consuming repo's session.
  const codexGuard = evaluateCodexSkipGuard(guildRoot);
  if (codexGuard.armed && codexGuard.streak >= CODEX_SKIP_THRESHOLD) {
    writeCodexSkipSentinel(guildRoot, codexGuard.streak);
    process.stderr.write(
      "\n[maybe-reflect] ⚠⚠⚠ DISCIPLINE HARD-FAIL ⚠⚠⚠\n" +
      `[maybe-reflect] codex adversarial review has been SKIPPED on ${codexGuard.streak}\n` +
      "[maybe-reflect] consecutive self-build reflections (>= 3 threshold reached).\n" +
      "[maybe-reflect] A blocking sentinel was written to:\n" +
      "[maybe-reflect]   .guild/codex-skip-streak.json  (blocked: true)\n" +
      "[maybe-reflect] The NEXT G-gate (G-spec/G-plan/G-lane) must REFUSE to pass\n" +
      "[maybe-reflect] until codex review runs or the streak is cleared. To clear:\n" +
      "[maybe-reflect]   1. wire codex (`codex --version` + `codex login`, or OPENAI_API_KEY) and run\n" +
      "[maybe-reflect]      `guild:codex-review` at the gate, OR\n" +
      "[maybe-reflect]   2. record a reflection WITHOUT a codex_review: SKIPPED marker\n" +
      "[maybe-reflect]      (a real review breaks the consecutive streak), OR\n" +
      "[maybe-reflect]   3. delete .guild/codex-skip-streak.json after an explicit\n" +
      "[maybe-reflect]      operator override.\n" +
      "[maybe-reflect] See plugin/CLAUDE.md §'Codex adversarial review'.\n\n"
    );
    // Non-zero exit is the loudest honest escalation a Stop hook has. It does
    // NOT run the reflect path — the discipline failure takes precedence over
    // emitting a reflect marker for this turn.
    process.exit(CODEX_SKIP_EXIT_CODE);
  }

  const sessionId = payload.session_id;
  const runId =
    process.env["GUILD_RUN_ID"] ??
    (sessionId ? `run-${sessionId}` : `run-session-${new Date().toISOString().slice(0, 10)}`);

  // Load telemetry events — always read from the resolved root
  const eventsFile = path.join(guildRoot, ".guild", "runs", runId, "events.ndjson");
  const events = loadEvents(eventsFile);

  // v1.3 — F12: branch on hook_event_name. SubagentStop gets the dev-team
  // gate (opt-in env var + dispatch threshold + spec presence); Stop gets
  // the original heuristic gate (specialist + edit + no error).
  const hookEvent = payload.hook_event_name ?? "Stop";

  if (hookEvent === "SubagentStop") {
    const result = devteamSubagentGateCheck(events, guildRoot);
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
  const runDir = path.join(guildRoot, ".guild", "runs", runId);

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

/**
 * hooks/lib/run-trace.ts
 *
 * Lane B3 (hook-engineer) — the hook leg of the run-lifecycle SPINE.
 *
 * This module is the SINK + EMIT layer that wires B2's run-lifecycle library
 * (scripts/lib/run-lifecycle.ts) into Guild's hook layer. It owns three things
 * the B1 contract (run-lifecycle-contract.md §7) assigns to B3:
 *
 *   1. run_started / run_closed guild.trace_event.v1 lines (SC-B).
 *      Emitted into <runDir>/logs/v1.4-events.jsonl — the EXACT file the
 *      provenance pointer references (terminal_trace_event.log_ref =
 *      ".guild/runs/<run-id>/logs/v1.4-events.jsonl"). These two lifecycle
 *      events are NOT members of the v1.4 closed event-type union (the 12
 *      phase/tool/loop/gate events in lib/v1.4/log-jsonl.ts) — they are the
 *      FROZEN guild.trace_event.v1 lifecycle markers. We therefore append them
 *      with a dedicated raw-append path to the same JSONL file rather than
 *      through appendEvent(), whose validator would reject a non-union event.
 *
 *   2. The OQ6 lightweight /guild:status path (SC-B). recordStatusLightweight()
 *      always-records a run_class:"lightweight" run (run.yaml + provenance.json
 *      under .guild/runs/ ONLY), gated behind readRecordStatusRuns(root). When
 *      settings.json record_status_runs:false, the call is a no-op (returns null)
 *      and reverts /guild:status to pure-read.
 *
 *   3. The SC-G skipped-files sink. writeSkippedFiles() persists the
 *      {path, reason, rule, can_manually_include, summary_produced} entries to
 *      <runDir>/learn/skipped-files.json. The learn skill (Lane A1) POPULATES the
 *      decisions; B3 provides only the sink + the provenance.coverage pointer.
 *
 * Ordering (B1 §7 + B2 handoff note): closeRun() mints the terminal
 * trace-event POINTER (event_id + at) into provenance.json. closeRun does NOT
 * return that event_id, so emitRunClosed() calls closeRun first, then reads the
 * minted pointer back off provenance.json and appends the run_closed line
 * carrying the SAME event_id. The provenance pointer and the JSONL line are thus
 * guaranteed to reference each other by a single id — there is no second random
 * id. (The line is appended immediately after the write, before this call
 * returns, so any reader that sees provenance also sees the line.)
 *
 * Host-neutrality: emitRunClosed / recordStatusLightweight take a resolveHost
 * binding and construct B2's env via createRealEnv(root, resolveHost) — NOT a
 * bare-literal env (B2 risk note: bare-literal envs fall back to process.cwd()
 * for the close-root resolution). The default binding (defaultResolveHost) reads
 * the canonical GUILD_HOST resolution — never hard-codes claude.
 *
 * Runner: bundled to dist/ via esbuild (see hooks/package.json build). The hook
 * entry scripts (run-trace-start.ts on UserPromptSubmit, run-trace-close.ts on
 * Stop) import this module.
 *
 * Always non-throwing at the I/O boundary — a trace failure must NEVER block a
 * session (same discipline as capture-telemetry.ts).
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

import {
  createRunLifecycle,
  createRealEnv,
  readRecordStatusRuns,
  type RunLifecycleEnv,
  type TargetKind,
} from "../../scripts/lib/run-lifecycle.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** The host-adapter binding B2's createRealEnv consumes. Host-neutral. */
export type ResolveHost = RunLifecycleEnv["resolveHost"];

/** A single SC-G skipped-file decision (the learn skill produces these). */
export interface SkippedFileEntry {
  /** Repo-relative (or absolute) path that was skipped. */
  path: string;
  /** Human-readable reason the file was skipped. */
  reason: string;
  /** The rule that caused the skip (e.g. ".gitignore", "binary", "size-cap"). */
  rule: string;
  /** Whether the operator could force-include it on a re-run. */
  can_manually_include: boolean;
  /** Whether a cheap summary was still produced for it. */
  summary_produced: boolean;
}

/** A FROZEN guild.trace_event.v1 lifecycle marker line. */
interface TraceEventV1 {
  schema_version: "guild.trace_event.v1";
  event_id: string;
  event_name: "run_started" | "run_closed";
  run_id: string;
  at: string;
}

// ── Path helpers (mirror B2's run-lifecycle layout, .guild base = root) ───────

function runDir(root: string, runId: string): string {
  return path.join(root, ".guild", "runs", runId);
}

/** The terminal_trace_event.log_ref target — the exact file the pointer names. */
function liveLogPath(root: string, runId: string): string {
  return path.join(runDir(root, runId), "logs", "v1.4-events.jsonl");
}

function provenancePath(root: string, runId: string): string {
  return path.join(runDir(root, runId), "provenance.json");
}

function skippedFilesPath(root: string, runId: string): string {
  return path.join(runDir(root, runId), "learn", "skipped-files.json");
}

// ── Run-id resolution (reconciles the legacy + B2 sentinel locations) ─────────

/**
 * Resolve the active run-id for trace emission. Precedence:
 *   1. GUILD_RUN_ID env (tests / orchestrator / agent-team launcher).
 *   2. .guild/runs/current-run-id  — the LEGACY sentinel (scripts/new-run-id.ts,
 *      read by capture-telemetry / pre-/post-tool-use today).
 *   3. .guild/current-run-id       — B2's run-lifecycle sentinel location.
 *
 * NOTE (divergence flagged to B2/operator): B2's startRun writes the sentinel to
 * .guild/current-run-id, while the existing hook ecosystem reads
 * .guild/runs/current-run-id. We read BOTH so the hook leg works regardless of
 * which entrypoint started the run; legacy location wins to avoid regressing
 * existing telemetry resolution.
 */
export function resolveRunIdForTrace(
  root: string,
  env: { GUILD_RUN_ID?: string },
): string | null {
  const fromEnv = env.GUILD_RUN_ID;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();

  const legacy = readSentinel(path.join(root, ".guild", "runs", "current-run-id"));
  if (legacy) return legacy;

  const b2 = readSentinel(path.join(root, ".guild", "current-run-id"));
  if (b2) return b2;

  return null;
}

function readSentinel(p: string): string | null {
  try {
    const v = fs.readFileSync(p, "utf8").trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

// ── Default host binding (host-neutral; never claude-pinned in logic) ─────────

/**
 * The default resolveHost binding for the hook leg. Mirrors the canonical
 * GUILD_HOST resolution used by write-host-capability.ts's resolveHostKind
 * (which is private) WITHOUT importing the heavy capability builder — the hook
 * leg only needs the resolved HostKind, never the full advertisement. Stays
 * host-neutral: it records whatever GUILD_HOST asks for and never assumes claude
 * unless GUILD_HOST is unset/auto (the documented expected-host default, same as
 * resolveHostKind).
 */
export function defaultResolveHost(requested: string): ReturnType<ResolveHost> {
  const raw = (process.env["GUILD_HOST"] ?? requested ?? "").trim().toLowerCase();
  const resolved =
    raw === "codex"
      ? "codex"
      : raw === "gemini"
        ? "gemini"
        : raw === "pi"
          ? "pi"
          : "claude";
  return { requested, resolved };
}

// ── Raw guild.trace_event.v1 append (lifecycle markers — outside v1.4 union) ──

function appendTraceLine(file: string, event: TraceEventV1): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
}

function readTraceLines(file: string): TraceEventV1[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as TraceEventV1);
  } catch {
    return [];
  }
}

// ── 1. run_started (SC-B) ─────────────────────────────────────────────────────

/**
 * Emit the run_started guild.trace_event.v1 line into the run's
 * logs/v1.4-events.jsonl. Idempotent: a run_started already present for this run
 * short-circuits (so a UserPromptSubmit-per-run emit never double-fires).
 * Best-effort; never throws.
 */
export function emitRunStarted(
  root: string,
  runId: string,
  opts: { now?: string } = {},
): void {
  try {
    const file = liveLogPath(root, runId);
    if (readTraceLines(file).some((e) => e.event_name === "run_started")) return;
    appendTraceLine(file, {
      schema_version: "guild.trace_event.v1",
      event_id: `evt-${crypto.randomUUID()}`,
      event_name: "run_started",
      run_id: runId,
      at: opts.now ?? new Date().toISOString(),
    });
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: emitRunStarted failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

// ── 2. run_closed (SC-B) — closeRun first, then the matching JSONL line ───────

/**
 * Close the run via B2's closeRun (writes provenance.json + the terminal-event
 * POINTER + flips run.yaml.status), THEN append the run_closed line carrying the
 * SAME event_id the provenance pointer references (B1 ordering note). Best-effort.
 */
export function emitRunClosed(
  root: string,
  runId: string,
  resolveHost: ResolveHost,
  opts: {
    status?: "closed" | "failed" | "resumable";
    touched?: Parameters<ReturnType<typeof createRunLifecycle>["closeRun"]>[1]["touched"];
    coverage?: { scanned_count: number; skipped_count: number; skipped_files_ref: string };
    final_learning_checkpoint?: string | null;
    artifacts?: Record<string, string>;
  } = {},
): void {
  try {
    const lifecycle = createRunLifecycle(createRealEnv(root, resolveHost));
    lifecycle.closeRun(runId, {
      status: opts.status ?? "closed",
      touched: opts.touched,
      coverage: opts.coverage,
      final_learning_checkpoint: opts.final_learning_checkpoint,
      artifacts: opts.artifacts,
    });

    // Read back the pointer closeRun minted and append the matching line.
    const prov = JSON.parse(fs.readFileSync(provenancePath(root, runId), "utf8")) as {
      terminal_trace_event?: { event_id?: string; at?: string };
    };
    const pointer = prov.terminal_trace_event;
    if (!pointer || typeof pointer.event_id !== "string") {
      process.stderr.write(
        `[run-trace] WARN: provenance.json missing terminal_trace_event pointer for ${runId}\n`,
      );
      return;
    }
    appendTraceLine(liveLogPath(root, runId), {
      schema_version: "guild.trace_event.v1",
      event_id: pointer.event_id,
      event_name: "run_closed",
      run_id: runId,
      at: typeof pointer.at === "string" ? pointer.at : new Date().toISOString(),
    });
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: emitRunClosed failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

// ── 3a. startAndCloseRun — shared primitive (full OR lightweight) ─────────────

/** Options for the uniform start + immediate-close path (A2 rollout seam). */
export interface StartAndCloseOpts {
  /** Entry command token, e.g. "/guild:learn", "/guild:status". Default "/guild:learn". */
  command?: string;
  /** Absolute cwd at entry. Defaults to root. */
  cwd?: string;
  /** SC-A target_kind. Default "existing_guild_project". */
  target_kind?: TargetKind;
  /**
   * "full" (default) — a normal lifecycle run; the run stays open for the
   * session and is closed via the Stop hook. When passed to startAndCloseRun
   * the run is started AND immediately closed (so the CLI can record it as a
   * point-in-time trace). "lightweight" — writes run.yaml + provenance.json
   * under .guild/runs/ ONLY; final_learning_checkpoint is always null (B2
   * enforces this). For read-only commands (/guild:status, /guild:stats,
   * /guild:wiki query-only) that should leave a trace but never mutate durable
   * store.
   */
  run_class?: "full" | "lightweight";
  /**
   * Optional initiative attachment slug (e.g. from `--initiative=<id>`). NN#5:
   * recording the scalar attachment MUST NOT create any .guild/initiatives/
   * dir — B2's startRun records it as run.yaml.initiative_attachment +
   * provenance.json.initiative only. Default null (one-off run).
   */
  initiative?: string | null;
}

/**
 * Start a run ONLY (write run.yaml status:open + the run-id sentinel) and return
 * the run-id, leaving the run OPEN. This is the correct path for a FULL lifecycle
 * command's `start`: the run must stay open for the session so the Stop hook
 * (run-trace-close.ts → emitRunClosed) closes it once work has actually happened.
 * Closing inline (startAndCloseRun) would flip run.yaml to `closed` + write
 * provenance.json BEFORE any work — the Stop hook would then skip the
 * already-closed run, and the recorded run would carry empty touched/artifact
 * data. (P1.)
 *
 * NN#5: an `initiative` slug is recorded as the scalar attachment ONLY — B2's
 * startRun never creates a .guild/initiatives/ dir.
 *
 * Best-effort; returns null on error (never throws).
 */
export function startRunOnly(
  root: string,
  resolveHost: ResolveHost,
  opts: StartAndCloseOpts = {},
): string | null {
  try {
    const lifecycle = createRunLifecycle(createRealEnv(root, resolveHost));
    return lifecycle.startRun(buildStartRunOpts(root, opts));
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: startRunOnly failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

/**
 * Assemble the B2 StartRunOpts from the B3 StartAndCloseOpts. Single place that
 * derives the run-class-dependent policy labels + threads the initiative scalar.
 */
function buildStartRunOpts(
  root: string,
  opts: StartAndCloseOpts,
): Parameters<ReturnType<typeof createRunLifecycle>["startRun"]>[0] {
  const runClass = opts.run_class ?? "full";
  const command = opts.command ?? "/guild:learn";
  const cwd = opts.cwd ?? root;
  const targetKind = opts.target_kind ?? "existing_guild_project";

  // Derive a human-readable tier/scan label appropriate for the run class.
  const tierPolicy =
    runClass === "lightweight"
      ? "n/a (read-only lightweight run)"
      : "default (full run)";
  const scanPolicy = runClass === "lightweight" ? "n/a (no scan)" : "default";
  const ignorePolicy = runClass === "lightweight" ? "n/a (no scan)" : "default";
  const phase =
    runClass === "lightweight"
      ? command.replace(/^\/guild:/, "") // e.g. "status", "stats", "wiki"
      : null;

  return {
    command,
    arguments: {},
    cwd,
    root,
    target_kind: targetKind,
    workspace: { is_workspace: false, root },
    project: runClass === "lightweight" ? command.replace(/^\/guild:/, "") : "project",
    host_requested: process.env["GUILD_HOST"] ?? "auto",
    model_tier_policy: tierPolicy,
    ignore_policy: ignorePolicy,
    scan_policy: scanPolicy,
    initiative: opts.initiative ?? null, // NN#5: scalar record ONLY, never a dir
    phase,
    run_class: runClass,
  };
}

/**
 * Start + immediately close a run and return the run-id. This is the shared
 * primitive that both recordStatusLightweight and the `start` CLI sub-command's
 * LIGHTWEIGHT branch call — the single place that enforces "lightweight ⇒
 * runs/-only, no durable writes". A lightweight snapshot run (status/stats/wiki
 * query) legitimately starts AND closes at once: there is no deferred work.
 *
 * The close reuses emitRunClosed (NOT a bare lifecycle.closeRun), so the inline
 * lightweight close ALSO appends the matching `run_closed` line into
 * logs/v1.4-events.jsonl carrying the SAME event_id the provenance pointer
 * references. A bare closeRun would write the provenance pointer but leave the
 * JSONL line missing, so any reader following the pointer would find nothing.
 * (P2a.)
 *
 * NEVER applies the OQ6 record_status_runs gate — that gate is the caller's
 * responsibility (recordStatusLightweight gates; the raw CLI start sub-command
 * does not, per A2 contract: A2 gates status invocations itself).
 *
 * Best-effort; returns null on error (never throws).
 */
export function startAndCloseRun(
  root: string,
  resolveHost: ResolveHost,
  opts: StartAndCloseOpts = {},
): string | null {
  try {
    const lifecycle = createRunLifecycle(createRealEnv(root, resolveHost));
    const runId = lifecycle.startRun(buildStartRunOpts(root, opts));
    // Close via emitRunClosed so the run_closed JSONL line is appended with the
    // event_id matching the provenance pointer (P2a). For lightweight runs B2
    // enforces final_learning_checkpoint:null and the write-set stays runs/-only.
    emitRunClosed(root, runId, resolveHost, { status: "closed" });
    return runId;
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: startAndCloseRun failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

// ── 3b. OQ6 lightweight /guild:status path (SC-B) ─────────────────────────────

/**
 * Always-record the /guild:status run as a lightweight run, gated behind
 * settings.json record_status_runs (default true). When false, returns null and
 * writes NOTHING (pure-read rollback). Convenience wrapper over startAndCloseRun
 * with run_class:"lightweight" + the OQ6 gate applied.
 *
 * Returns the run-id on the recorded path, or null when the gate disabled it.
 */
export function recordStatusLightweight(
  root: string,
  resolveHost: ResolveHost,
  opts: { cwd?: string; target_kind?: TargetKind } = {},
): string | null {
  // OQ6 rollback gate — false reverts /guild:status to pure-read (no run).
  if (!readRecordStatusRuns(root)) return null;
  return startAndCloseRun(root, resolveHost, {
    command: "/guild:status",
    cwd: opts.cwd,
    target_kind: opts.target_kind,
    run_class: "lightweight",
  });
}

// ── 4. SC-G skipped-files sink ────────────────────────────────────────────────

/**
 * Persist the SC-G skipped-files decisions to
 * .guild/runs/<run-id>/learn/skipped-files.json. The learn skill (Lane A1)
 * supplies the entries; this writer is the sink + the file the
 * provenance.coverage.skipped_files_ref pointer names. Returns the written path.
 */
export function writeSkippedFiles(
  root: string,
  runId: string,
  entries: SkippedFileEntry[],
): string {
  const out = skippedFilesPath(root, runId);
  const body = {
    schema_version: "guild.skipped_files.v1",
    run_id: runId,
    generated_at: new Date().toISOString(),
    skipped_count: entries.length,
    skipped: entries,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(body, null, 2) + "\n", "utf8");
  return out;
}

/** The .guild-relative pointer for provenance.coverage.skipped_files_ref. */
export function skippedFilesRef(runId: string): string {
  return `.guild/runs/${runId}/learn/skipped-files.json`;
}

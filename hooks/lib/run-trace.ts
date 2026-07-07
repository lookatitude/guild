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
  appendPhase,
  isCanonicalPhase,
  type RunLifecycleEnv,
  type TargetKind,
} from "../../scripts/lib/run-lifecycle.js";

import { writeCheckpoint } from "../emit-learning-checkpoint.js";
import { PHASE_TOKEN_TO_CHECKPOINT } from "./learning-backstop.js";
import { resolveHeartbeatTimeoutMs } from "./heartbeat.js";
// Deterministic classification at phase close: build the ArtifactSet from the run's
// already-written artifacts and run the pure 12-target classifier, so the checkpoint
// carries a REAL verdict (not all-none) WITHOUT depending on the model running a CLI.
import { classifyPhase, type ArtifactSet, type HandoffV2Block } from "../../scripts/lib/learning-signatures.js";
import { extractHandoffEnvelope } from "./handoff-v2.js";

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
  /**
   * T0 (G-PHASE-COMPOSE): entry phase token for a FULL run. When set to a
   * canonical phase ({init,ideate,plan,build,qa,ops}), it seeds run.yaml's
   * `phase:` + the first `phases_log` entry. For lightweight runs the phase is
   * always the command token (unchanged); this field is honored on full runs only.
   * A non-canonical token is ignored (seeded null) — validation is single-sourced
   * to isCanonicalPhase. Default undefined → null seed (legacy behavior).
   */
  phase?: string | null;
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
/**
 * Self-heal multiplier (#13). The finalize grace window is the MOST-PERMISSIVE
 * lane-idle timeout (`resolveHeartbeatTimeoutMs(root, "powerful")` — 20 min by
 * default, or an explicit `defaults.heartbeat_timeout_ms` override) times this
 * factor. The window is deliberately MUCH larger than any single timeout so the
 * guard only ever finalizes a LONG-abandoned run, never an active-but-slow one
 * (a 19-min powerful-tier think, a long in-flight tool call, a brief operator
 * wait). Bias is intentional: leaving an orphan open a while longer is cheap;
 * closing a live run loses its real terminal context.
 */
const STALE_RUN_GRACE_MULTIPLIER = 3;

/**
 * Newest liveness signal (epoch ms) for a run: the freshest mtime across its
 * trace files AND the repo's OWN structured-heartbeat surface
 * (`<runDir>/in-progress/*` — written per active lane on every PostToolUse). An
 * active run with live lanes keeps these fresh even when the top-level event log
 * is momentarily quiet. Returns 0 when no signal exists.
 */
function newestRunActivityMs(root: string, runId: string): number {
  const dir = runDir(root, runId);
  const candidates = [
    liveLogPath(root, runId),
    path.join(dir, "events.ndjson"),
    path.join(dir, "run.yaml"),
  ];
  try {
    const inProgress = path.join(dir, "in-progress");
    for (const name of fs.readdirSync(inProgress)) {
      candidates.push(path.join(inProgress, name)); // structured heartbeats + legacy .log
    }
  } catch {
    /* no in-progress dir — fine */
  }
  let newest = 0;
  for (const p of candidates) {
    try {
      newest = Math.max(newest, fs.statSync(p).mtimeMs);
    } catch {
      /* file absent — skip */
    }
  }
  return newest;
}

/**
 * Self-heal interrupted sessions (issue #13). Before a new run claims the
 * current-run-id sentinel, finalize the IMMEDIATELY-PRIOR sentinel run IF it is
 * (a) still `status: open` AND (b) abandoned — no liveness signal (trace mtimes
 * OR structured heartbeat) within the conservative grace window.
 *
 * The staleness guard is load-bearing and deliberately conservative: a genuinely
 * active run (an in-flight `/guild:build` with live lanes while the operator runs
 * `/guild:status`) keeps a fresh event log or heartbeat and is LEFT OPEN. Only a
 * run whose owning session died long ago is closed. Best-effort and never-throwing
 * (a failure here must never block the new run). O(1) — checks only the one
 * sentinel run, not every run dir (this runs on every command start).
 *
 * Residual limitation (accepted): a SOLO main run with no lanes that sits idle —
 * e.g. waiting on the operator — longer than the grace window has no liveness
 * signal and would be finalized. The window is sized (3× the max lane timeout, 60
 * min default) so this is rare, and the cost is bounded: the run's artifacts
 * remain; only a synthetic terminal status is written.
 */
function closeStalePriorOpenRun(
  root: string,
  resolveHost: ResolveHost,
  now: () => number = Date.now,
): void {
  try {
    // Resolve the run the SENTINEL currently points to (the prior run, before the
    // new run claims it). Pass {} so env GUILD_RUN_ID never short-circuits the
    // sentinel read — the staleness guard below protects any genuinely-live run.
    const priorId = resolveRunIdForTrace(root, {});
    if (!priorId) return;
    // run.yaml must exist and be status:open (already-closed / missing → nothing to do).
    let runYaml: string;
    try {
      runYaml = fs.readFileSync(path.join(runDir(root, priorId), "run.yaml"), "utf8");
    } catch {
      return; // no run.yaml (legacy/host-adapter dir) — not ours to finalize
    }
    if (!/^status:\s*open\b/m.test(runYaml)) return;

    const lastActivityMs = newestRunActivityMs(root, priorId);
    if (lastActivityMs === 0) return; // no activity signal at all — leave it alone

    // Grace = the most-permissive lane timeout (powerful, or explicit config) × margin.
    const graceMs = resolveHeartbeatTimeoutMs(root, "powerful") * STALE_RUN_GRACE_MULTIPLIER;
    if (now() - lastActivityMs <= graceMs) return; // within grace — DO NOT close

    // Abandoned + open → finalize through the normal close path (terminal record + provenance).
    emitRunClosed(root, priorId, resolveHost, { status: "closed" });
  } catch {
    /* best-effort self-heal — never block a new run start */
  }
}

export function startRunOnly(
  root: string,
  resolveHost: ResolveHost,
  opts: StartAndCloseOpts = {},
): string | null {
  try {
    closeStalePriorOpenRun(root, resolveHost);
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
  // T0: full runs honor a passed canonical phase (seeds run.yaml phase: + the first
  // phases_log entry); lightweight runs keep the command-token phase (unchanged).
  // A non-canonical full-run token is ignored (null seed) — validation single-sourced.
  const phase =
    runClass === "lightweight"
      ? command.replace(/^\/guild:/, "") // e.g. "status", "stats", "wiki"
      : opts.phase && isCanonicalPhase(opts.phase)
        ? opts.phase
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
 * DETERMINISTIC per-phase learning checkpoint emitter (METRIC 2 fix).
 *
 * Called immediately after `appendPhase` succeeds in `recordPhase` so that
 * EVERY canonical phase close produces a real `guild.learning_checkpoint.v1`
 * YAML without relying on model-prose skill invocations.
 *
 * Behaviour:
 *  - Translates the canonical lifecycle token (init/ideate/plan/build/qa/ops)
 *    to the checkpoint vocabulary via PHASE_TOKEN_TO_CHECKPOINT.
 *  - Skips silently when the checkpoint file already exists (idempotent; a
 *    model-emitted checkpoint is never overwritten by this path).
 *  - Writes an all-`none` 12-target verdict when no GUILD_CHECKPOINT_ARTIFACTS_JSON
 *    is present — behaviour-neutral for phases with no externally classified
 *    artifacts. When the env var IS present the CLI path (not this function) is
 *    responsible; here we always write all-none.
 *  - evidenceRef points at run.yaml#phases_log — the deterministic trigger source.
 *  - Fail-open: any I/O error is logged to stderr and swallowed; the lifecycle
 *    must never be blocked by a checkpoint write.
 */
/**
 * Build the ArtifactSet the 12-target classifier reads, from the run's already-written
 * artifacts at phase close: handoff receipts (guild.handoff.v2 envelopes) + provenance
 * `touched`. Fail-open per source — a missing file/dir contributes nothing (→ those targets
 * stay `none`, conservative). `changedFiles` is intentionally omitted (not deterministically
 * available in a hook); targets gated only on changed-files therefore stay `none`.
 */
function buildPhaseArtifacts(root: string, runId: string): ArtifactSet {
  const artifacts: ArtifactSet = { runId };
  // handoffs/*.md → parsed guild.handoff.v2 blocks + raw texts
  try {
    const hDir = path.join(runDir(root, runId), "handoffs");
    const blocks: HandoffV2Block[] = [];
    const texts: string[] = [];
    for (const f of fs.readdirSync(hDir)) {
      if (!f.endsWith(".md")) continue;
      const content = fs.readFileSync(path.join(hDir, f), "utf8");
      texts.push(content);
      const env = extractHandoffEnvelope(content);
      if (env && typeof env === "object") blocks.push(env as HandoffV2Block);
    }
    if (blocks.length) artifacts.handoffBlocks = blocks;
    if (texts.length) artifacts.handoffTexts = texts;
  } catch { /* no handoffs → none */ }
  // provenance.json `touched`
  try {
    const prov = JSON.parse(fs.readFileSync(provenancePath(root, runId), "utf8"));
    if (prov && typeof prov.touched === "object") artifacts.provenanceTouched = prov.touched;
  } catch { /* no provenance → none */ }
  return artifacts;
}

function emitPhaseCheckpoint(root: string, runId: string, phase: string): void {
  try {
    const checkpointPhase = PHASE_TOKEN_TO_CHECKPOINT[phase];
    if (checkpointPhase === undefined) return; // unknown token — skip silently

    // Idempotent: do not overwrite a model-emitted or previously backstopped checkpoint.
    const checkpointFile = path.join(
      root, ".guild", "runs", runId, "learning",
      `${checkpointPhase}-${runId}.yaml`,
    );
    if (fs.existsSync(checkpointFile)) return;

    // Deterministically CLASSIFY this phase from its already-written artifacts, so the
    // checkpoint carries a real verdict (the no-loss crux). Fail-open: any error → all-none.
    let decisions;
    try {
      const verdict = classifyPhase(buildPhaseArtifacts(root, runId));
      decisions = verdict as unknown as Record<string, string>; // PhaseVerdict ≡ CheckpointDecisions (12 string keys)
    } catch {
      decisions = undefined; // → writeCheckpoint defaults to all-none
    }

    writeCheckpoint({
      runId,
      phase: checkpointPhase,
      evidenceRef: `.guild/runs/${runId}/run.yaml#phases_log`,
      guildRoot: root,
      decisions: decisions as never,
    });
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: emitPhaseCheckpoint(${phase}) failed (fail-open): ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/**
 * T0 (G-PHASE-COMPOSE): record the active phase for the current (or given) FULL
 * run by appending a `phases_log` entry + rewriting run.yaml's top-level `phase:`.
 * This is the "join an already-open run" writer — phase commands call it at intake
 * when the run was started by an earlier command in the same session.
 *
 * After the phases_log write, emitPhaseCheckpoint() is called to produce a
 * deterministic per-phase `guild.learning_checkpoint.v1` record (METRIC 2).
 * The checkpoint write is fail-open and never blocks the lifecycle.
 *
 * Best-effort + non-throwing (same posture as the other run-trace writers): a
 * missing run / non-canonical token / unreadable run.yaml simply yields null and
 * records nothing. Validation (canonical-set) lives in appendPhase.
 *
 * @param root   The .guild/ owning repo root (resolveGuildRoot(cwd)).
 * @param phase  Canonical phase token ({init,ideate,plan,build,qa,ops}).
 * @param opts   runId override (else resolved from the current-run-id sentinel via
 *               resolveRunIdForTrace) + an env seam for GUILD_RUN_ID (tests).
 * @returns the runId whose phase was recorded, or null if nothing was recorded.
 */
export function recordPhase(
  root: string,
  phase: string,
  opts: { runId?: string; env?: { GUILD_RUN_ID?: string } } = {},
): string | null {
  try {
    const runId = opts.runId ?? resolveRunIdForTrace(root, opts.env ?? process.env);
    if (!runId) return null;
    const lifecycleEnv = createRealEnv(root, defaultResolveHost);
    if (!appendPhase(lifecycleEnv, root, runId, phase)) return null;
    // METRIC 2: deterministic emit — a healthy phase close always produces its
    // real checkpoint without the model running a CLI (deterministic-code-not-prose).
    emitPhaseCheckpoint(root, runId, phase);
    return runId;
  } catch {
    return null; // best-effort: phase recording never breaks the lifecycle
  }
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
    closeStalePriorOpenRun(root, resolveHost); // #13: self-heal a stale orphan before claiming the sentinel
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

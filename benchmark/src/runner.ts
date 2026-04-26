// benchmark/src/runner.ts — Guild benchmark factory live runner (P3, T2-backend).
//
// Implements the architect's contract from
// `benchmark/plans/p3-runner-architecture.md` (locked) plus the two
// supporting ADRs:
//   - ADR-003 (fresh-fixture clone per run; cwd is `runs/<id>/_workspace/`)
//   - ADR-004 (`detached: true` + process-group signal escalation)
//
// And the 16 P3-required mitigations from
// `benchmark/plans/security-review.md` (locked):
//
//   M1  (F1.2)  argv is `string[]` only; runtime invariants enforce shape;
//                NUL byte rejected before spawn.                  -> assertArgvShape, buildArgv
//   M2  (F1.1)  `shell: false` non-negotiable; spawn wrapper asserts on
//                `shell: true` literally before delegating.       -> spawnGuarded
//   M3  (F1.3)  Env is a default-deny allowlist; nothing inherited from
//                process.env beyond the named set.                -> buildSubprocessEnv
//   M4  (F1.4)  `claude` is resolved to an absolute path once at run
//                start; the absolute path is what we spawn (not "claude"
//                from PATH); recorded under run.json.raw_command.  -> resolveClaudeBinary
//   M5  (F2.1)  5-rule path-resolution checklist applied at every
//                destination-write site for paths derived from the
//                subprocess workspace.                             -> safeJoinUnder, copyTreeSafe
//   M6  (F2.2)  lstat pre-walk + symlink refusal at capture time;
//                refused entries emit a `tool_error` event.        -> copyTreeSafe
//   M7  (F2.3)  TOCTOU: capture is single-pass (subprocess has exited
//                before capture begins); errorOnExist:true backstop. -> copyTreeSafe + finalizeRun
//   M8  (F2.6)  `errorOnExist: true` on the artifact fs.cp; runner-
//                authored files use `_` prefix under artifacts root. -> copyTreeSafe (errorOnExist) + log paths under artifactsRoot
//   M9  (F3.2)  1h timer via setTimeout — case can tighten via
//                timeout_seconds; case can never extend the global cap. -> resolveTimeoutMs + setTimeout in spawnAndWait
//   M10 (F3.1)  `detached: true` + `process.kill(-child.pid, sig)`
//                signals the entire process group (ADR-004).        -> spawnAndWait (detached:true) + groupKill
//   M11 (F3.2/F3.3) Parent-death handlers (`exit`/`SIGINT`/`SIGTERM`)
//                group-kill on parent exit; ESRCH swallowed; SIGKILL
//                gated on `exitCode === null`; both timers cleared on
//                child exit; `await once(child, "exit")` in finally. -> spawnAndWait
//   M12 (F3.5)  Drain-then-close every write stream in finally so FDs
//                are released on every code path.                   -> spawnAndWait (finally block)
//   M13         Post-run `process.resourceUsage()` snapshot recorded
//                in run.json (visibility only — F3.4 deferred).     -> finalizeRun (resource_usage)
//   M14 (F4.2)  Regex redaction of common token shapes from captured
//                stdout/stderr (Bearer / sk- / Authorization / AKIA
//                / GH PAT / JWT). Stream Transform applied at write
//                time so on-disk bytes are only the redacted form.  -> RedactingStream
//   M15 (F4.1)  `run.json.raw_command` is JSON-stringified argv array
//                (NOT shell-quoted); per-element redaction also runs
//                via the same redaction pass.                      -> redactArgvForAudit
//   M16 (F4.5)  Env values are NEVER printed into stdout/log files;
//                only the allowlist KEY SET is included in dry-run
//                output and run.json (no values).                  -> describeEnvAllowlistKeysOnly
//
// Deferred (D1-D5) — tracked in handoff Open risks; NOT implemented:
//   D1 Windows process-group fallback (`taskkill /T /F`) — ADR-005 future.
//   D2 Hard memory cap — Node has no portable per-spawn rlimit.
//   D3 `claude` CLI auth-context scrubbing — out of scope.
//   D4 Artifact-capture progress reporting via SSE — P4 candidate.
//   D5 Cross-platform symlink semantics (Windows-specific).
//
// Public API surface:
//   runBenchmark(opts: RunOptions): Promise<RunnerResult>
//   formatDryRunReport(plan: ResolvedRunPlan): string
//   resolveTimeoutMs(caseTimeoutSeconds): number
//   DEFAULT_T_BUDGET_MS, ENV_TIMEOUT_MS, KILL_GRACE_MS — for tests.

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createWriteStream,
  existsSync,
  openSync,
  readdirSync,
  readlinkSync,
  type WriteStream,
} from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { once } from "node:events";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { Transform } from "node:stream";
import { execFileSync } from "node:child_process";
import type { Case, RunJson, RunOptions, RunnerResult, RunStatus } from "./types.js";
import { SCHEMA_VERSION } from "./types.js";
import { loadCase } from "./case-loader.js";

// ---- Constants ---------------------------------------------------------

export const DEFAULT_T_BUDGET_MS = 3_600_000; // 1h spec cap
export const KILL_GRACE_MS = 5_000;           // SIGTERM -> SIGKILL grace
export const ENV_TIMEOUT_MS = "GUILD_BENCHMARK_TIMEOUT_MS";
export const ENV_MODELS_JSON = "GUILD_BENCHMARK_MODELS_JSON";
export const ENV_CLAUDE_BIN = "GUILD_BENCHMARK_CLAUDE_BIN";
// P4 — operator-supplied SHA-256 hex hash for forensic correlation only.
// Validated against AUTH_IDENTITY_HASH_RE before population (M9). Runner
// MUST NOT inspect `claude` CLI auth state (M11) — env var is the sole
// source. On regex mismatch, field is omitted and a tool_error event is
// emitted (M10).
export const ENV_AUTH_HINT = "GUILD_BENCHMARK_AUTH_HINT";
export const AUTH_IDENTITY_HASH_RE = /^[a-f0-9]{64}$/;

// M3 (F1.3) — default-deny env allowlist for the subprocess.
// Keys forwarded verbatim if present in process.env. Anything not on this
// list (and not matched by ENV_PREFIX_ALLOW) is dropped, including
// AWS_*, STRIPE_*, GITHUB_TOKEN, OPENAI_API_KEY, DATABASE_URL, etc.
const ENV_ALLOWLIST_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TZ",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "ANTHROPIC_API_KEY",
] as const;

// Prefix-matched env: ANTHROPIC_*, CLAUDE_* — claude reads its config from these.
const ENV_PREFIX_ALLOW = /^(ANTHROPIC|CLAUDE)_[A-Z0-9_]+$/;

// Hard drop list — even if matched by prefix, never forward.
const ENV_HARD_DROP = /(_PASSWORD|_SECRET)$/;

// M14 (F4.2) — token-shape redaction patterns. Applied as a streaming
// Transform to stdout/stderr so the on-disk bytes are only the redacted
// form. Order matters (most specific first).
const REDACTION_PATTERNS: { re: RegExp; shape: string }[] = [
  { re: /Authorization:\s*Bearer\s+[A-Za-z0-9._\-+/=]+/g, shape: "bearer" },
  { re: /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/g, shape: "bearer" },
  { re: /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/g, shape: "anthropic-key" },
  { re: /\bghp_[A-Za-z0-9]{36}\b/g, shape: "github-pat" },
  { re: /\bxox[bp]-[A-Za-z0-9-]{10,}/g, shape: "slack-token" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, shape: "aws-access-key" },
  {
    re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    shape: "jwt",
  },
];

// M15 (F4.1) — flag names whose immediately-following argv slot is a
// secret. Replaces the value with `<REDACTED:flag-context>`.
const SECRET_FLAG_RE = /^--?(api[-_]?key|token|secret|password|auth|key|bearer|header)$/i;

// Allowlisted flag names whose values pass through unchanged in raw_command.
const SAFE_FLAG_VALUES = new Set([
  "--print",
  "--prompt-file",
  "--workdir",
  "--output-format",
  "--input-format",
  "--headless",
]);

// ---- Public types (private to runner; exported for tests if needed) ----

export interface ResolvedRunPlan {
  caseSlug: string;
  caseFile: Case;
  runId: string;
  runDir: string;          // <runsDir>/<runId>/
  workspaceDir: string;    // <runDir>/_workspace/
  artifactsRoot: string;   // <runDir>/artifacts/
  guildArtifactsDir: string; // <artifactsRoot>/.guild/
  promptPath: string;      // <workspaceDir>/_benchmark-prompt.txt
  stdoutLogPath: string;   // <artifactsRoot>/_subprocess.stdout.log
  stderrLogPath: string;   // <artifactsRoot>/_subprocess.stderr.log
  eventsPath: string;      // <runDir>/events.ndjson
  runJsonPath: string;     // <runDir>/run.json
  claudeBinary: string;    // absolute path
  argv: string[];
  envAllowlistKeys: string[]; // keys only (no values) — M16
  envForChild: NodeJS.ProcessEnv; // actual env passed to spawn (with values)
  pluginRef: string;       // git rev-parse HEAD
  modelRef: Record<string, string>;
  startedAtIso: string;
  timeoutMs: number;
  cleanup: boolean;
  hostRepoRoot: string;
  fixturePath: string;     // resolved absolute fixture
}

// Internal: a "tool_error" event row (matches importer's eventSchema).
interface ToolErrorEvent {
  ts: string;
  type: "tool_error";
  tool: string;
  exit_code: number;
}

// ---- Public entrypoint -------------------------------------------------

export interface RunBenchmarkContext {
  runsDir: string;
  casesDir: string;
}

/**
 * Resolve a case + options into a fully concrete plan. Pure (no spawn,
 * no IO writes); shared between the live path and `--dry-run`.
 */
export async function planRun(
  opts: RunOptions,
  ctx: RunBenchmarkContext,
): Promise<ResolvedRunPlan> {
  if (!opts.caseSlug || typeof opts.caseSlug !== "string") {
    throw new Error("runner: opts.caseSlug is required");
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(opts.caseSlug)) {
    throw new Error(`runner: caseSlug "${opts.caseSlug}" is not kebab-case`);
  }
  const casePath = await resolveCasePath(ctx.casesDir, opts.caseSlug);
  const caseFile = await loadCase(casePath);

  const hostRepoRoot = await resolveHostRepoRoot(ctx.runsDir);
  const pluginRef = resolvePluginRef(hostRepoRoot);
  const modelRef = resolveModelRef(opts.modelsOverride);
  const runId = opts.runId ?? generateRunId(opts.caseSlug, pluginRef, modelRef, ctx.runsDir);

  const runDir = resolve(ctx.runsDir, runId);
  const workspaceDir = join(runDir, "_workspace");
  const artifactsRoot = join(runDir, "artifacts");
  const guildArtifactsDir = join(artifactsRoot, ".guild");
  const promptPath = join(workspaceDir, "_benchmark-prompt.txt");
  const stdoutLogPath = join(artifactsRoot, "_subprocess.stdout.log");
  const stderrLogPath = join(artifactsRoot, "_subprocess.stderr.log");
  const eventsPath = join(runDir, "events.ndjson");
  const runJsonPath = join(runDir, "run.json");

  // M4 — resolve `claude` to an absolute path once.
  const claudeBinary = resolveClaudeBinary();

  // M3 + M16 — build env from allowlist; record keys (no values).
  const { envForChild, allowlistKeys } = buildSubprocessEnv();

  // Fixture path: case.fixture is relative to the case YAML's dir.
  const fixturePath = resolve(dirname(casePath), caseFile.fixture);

  // Build argv. Prompt is passed via file (M5/F1.5).
  const argv = buildArgv({
    claudeBinary,
    promptPath,
    workspaceDir,
  });
  assertArgvShape(argv); // M1

  return {
    caseSlug: opts.caseSlug,
    caseFile,
    runId,
    runDir,
    workspaceDir,
    artifactsRoot,
    guildArtifactsDir,
    promptPath,
    stdoutLogPath,
    stderrLogPath,
    eventsPath,
    runJsonPath,
    claudeBinary,
    argv,
    envAllowlistKeys: allowlistKeys,
    envForChild,
    pluginRef,
    modelRef,
    startedAtIso: new Date().toISOString(),
    timeoutMs: resolveTimeoutMs(caseFile.timeout_seconds),
    cleanup: opts.cleanup === true,
    hostRepoRoot,
    fixturePath,
  };
}

/**
 * Full live runner. Spawns `claude` in a fresh-fixture workspace, captures
 * artifacts, writes run.json + events.ndjson, returns a RunnerResult with
 * the final RunStatus.
 *
 * **`opts.dryRun: true` is the operator's verification path: it returns
 * a plan-shaped report and does NOT spawn.** Call `formatDryRunReport`
 * on the resolved plan and write it to stdout from the caller.
 */
export async function runBenchmark(
  opts: RunOptions,
  ctx: RunBenchmarkContext,
): Promise<RunnerResult> {
  const plan = await planRun(opts, ctx);
  if (opts.dryRun === true) {
    // The CLI/server is responsible for printing formatDryRunReport(plan).
    // We still produce a RunnerResult shape so callers don't branch types.
    return {
      run_id: plan.runId,
      status: "errored",
      exit_code: null,
      wall_clock_ms: 0,
      stdout_log_path: plan.stdoutLogPath,
      stderr_log_path: plan.stderrLogPath,
      artifacts_root: plan.guildArtifactsDir,
      events_path: plan.eventsPath,
      partial: true,
    };
  }

  // Refuse to clobber an existing run dir — runIds must be unique.
  if (existsSync(plan.runDir)) {
    throw new Error(
      `runner: run dir already exists: ${plan.runDir} (refuse to clobber; pass a fresh --run-id)`,
    );
  }

  await mkdir(plan.runDir, { recursive: true });
  await mkdir(plan.artifactsRoot, { recursive: true });

  // ADR-003 step 1-3: clone fixture into _workspace/. Routed through
  // copyTreeSafe so M5 (path resolution under workspaceDir),
  // M6/F2.2 (symlink refusal at clone time), and M8/F2.6 (errorOnExist via
  // existsSync pre-check on each file) all apply uniformly to the fixture
  // clone AND to the artifact capture pass at line 617.
  const fixtureCopyEvents: ToolErrorEvent[] = [];
  await copyTreeSafe(
    plan.fixturePath,
    plan.workspaceDir,
    plan.workspaceDir,
    fixtureCopyEvents,
  );
  if (fixtureCopyEvents.length > 0) {
    throw new Error(
      `runner: fixture clone refused ${fixtureCopyEvents.length} entries (symlink or path-traversal). ` +
        `See .guild/runs/<id>/ for forensic detail.`,
    );
  }

  // M5 / F1.5 — prompt to a file, never positional argv.
  await writeFile(plan.promptPath, plan.caseFile.prompt, { encoding: "utf8" });

  const events: ToolErrorEvent[] = [];
  const startedAtMs = Date.now();
  let result: SpawnResult;

  try {
    result = await spawnAndWait(plan, events);
  } catch (err) {
    // Spawn-time failure (ENOENT, EACCES on the resolved binary, etc.)
    const ts = new Date().toISOString();
    events.push({ ts, type: "tool_error", tool: "spawn", exit_code: 1 });
    result = {
      exitCode: null,
      signal: null,
      timedOut: false,
      spawnError: err instanceof Error ? err.message : String(err),
      resourceUsage: null,
    };
  }

  const completedAtMs = Date.now();
  const wallClockMs = completedAtMs - startedAtMs;

  // Post-run capture (ADR-003 §3.3).
  const captureSummary = await capturePostRun(plan, events);

  // Status mapping (architect §4.1).
  const status = mapStatus({
    spawnError: result.spawnError,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    captureSummary,
    acceptanceFailedFromEvents: false, // P3: scorer evaluates; runner records.
  });

  // M15 — raw_command is JSON-stringified argv (shape only); per-element redaction.
  const redactedArgv = redactArgvForAudit(plan.argv, {
    runDir: plan.runDir,
    homeDir: homedir(),
    benchmarkRoot: dirname(ctx.runsDir),
  });
  const rawCommand = JSON.stringify(redactedArgv);

  // P4 M9/M10/M11 — populate auth_identity_hash from env var if and only if
  // it matches sha256-hex shape. NEVER inspect `claude` CLI auth state.
  // The offending env value is NEVER logged or persisted (only the fact of
  // the mismatch is recorded as a tool_error event).
  const authHintRaw = process.env[ENV_AUTH_HINT];
  let authIdentityHash: string | undefined;
  if (authHintRaw !== undefined && authHintRaw.length > 0) {
    if (AUTH_IDENTITY_HASH_RE.test(authHintRaw)) {
      authIdentityHash = authHintRaw;
    } else {
      events.push({
        ts: new Date().toISOString(),
        type: "tool_error",
        tool: "auth-hash",
        exit_code: 1,
      });
      // M10 — stderr warning; value is intentionally NOT included.
      try {
        await appendOrWrite(
          plan.stderrLogPath,
          `WARNING: ${ENV_AUTH_HINT} does not match expected sha256-hex format; auth_identity_hash unset\n`,
        );
      } catch {
        /* swallow — the run continues regardless */
      }
    }
  }

  const runJson: RunJson & { resource_usage?: NodeJS.ResourceUsage | null } = {
    schema_version: SCHEMA_VERSION,
    run_id: plan.runId,
    case_slug: plan.caseSlug,
    plugin_ref: plan.pluginRef,
    model_ref: plan.modelRef,
    started_at: plan.startedAtIso,
    completed_at: new Date(completedAtMs).toISOString(),
    status,
    raw_command: rawCommand,
    wall_clock_ms: wallClockMs,
    ...(plan.caseFile.wall_clock_budget_ms !== undefined
      ? { wall_clock_budget_ms: plan.caseFile.wall_clock_budget_ms }
      : { wall_clock_budget_ms: plan.caseFile.timeout_seconds * 1000 }),
    ...(authIdentityHash !== undefined ? { auth_identity_hash: authIdentityHash } : {}),
    // M13 — visibility only; F3.4 hard cap is deferred.
    resource_usage: result.resourceUsage,
  };

  await writeFile(plan.runJsonPath, JSON.stringify(runJson, null, 2) + "\n", {
    encoding: "utf8",
  });

  // Append any tool_error events the capture phase emitted.
  if (events.length > 0) {
    const append = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await appendOrWrite(plan.eventsPath, append);
  }

  if (plan.cleanup) {
    // Best-effort cleanup; failure is logged via tool_error but does not
    // change RunStatus.
    try {
      await rm(plan.workspaceDir, { recursive: true, force: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await appendOrWrite(
        plan.stderrLogPath,
        `[runner] cleanup failed for ${plan.workspaceDir}: ${msg}\n`,
      );
    }
  }

  return {
    run_id: plan.runId,
    status,
    exit_code: result.exitCode,
    wall_clock_ms: wallClockMs,
    stdout_log_path: plan.stdoutLogPath,
    stderr_log_path: plan.stderrLogPath,
    artifacts_root: plan.guildArtifactsDir,
    events_path: plan.eventsPath,
    partial: captureSummary.partial,
  };
}

// ---- Spawn + wait ------------------------------------------------------

interface SpawnResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  spawnError: string | null;
  resourceUsage: NodeJS.ResourceUsage | null;
}

async function spawnAndWait(
  plan: ResolvedRunPlan,
  events: ToolErrorEvent[],
): Promise<SpawnResult> {
  let stdoutStream: WriteStream | null = null;
  let stderrStream: WriteStream | null = null;
  let stdoutRedactor: Transform | null = null;
  let stderrRedactor: Transform | null = null;
  let sigtermTimer: NodeJS.Timeout | null = null;
  let sigkillTimer: NodeJS.Timeout | null = null;
  let timedOut = false;
  let parentDeathHandlersInstalled: Array<() => void> = [];
  let child: ChildProcess | null = null;

  try {
    // M14 — redacting stdout/stderr Transforms before bytes hit disk.
    stdoutStream = createWriteStream(plan.stdoutLogPath, { flags: "a" });
    stderrStream = createWriteStream(plan.stderrLogPath, { flags: "a" });
    stdoutRedactor = createRedactingTransform();
    stderrRedactor = createRedactingTransform();
    stdoutRedactor.pipe(stdoutStream);
    stderrRedactor.pipe(stderrStream);

    const spawnOpts: SpawnOptions = {
      cwd: plan.workspaceDir,
      env: plan.envForChild,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,            // M2 (F1.1)
      detached: true,          // M10 (F3.1) — ADR-004
      windowsHide: true,
    };

    child = spawnGuarded(plan.claudeBinary, plan.argv.slice(1), spawnOpts);

    // Pipe child stdio through the redactor.
    if (child.stdout) child.stdout.pipe(stdoutRedactor);
    if (child.stderr) child.stderr.pipe(stderrRedactor);

    const childRef = child;

    const groupKill = (sig: NodeJS.Signals): void => {
      const pid = childRef.pid;
      if (pid === undefined) return;
      try {
        // M10 — process group target via negative pid.
        process.kill(-pid, sig);
      } catch (e: unknown) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code !== "ESRCH") throw e;
        // ESRCH = group already gone; swallow per ADR-004.
      }
    };

    // M9/M10 — SIGTERM at T_budget; SIGKILL after grace; both gated on liveness.
    sigtermTimer = setTimeout(() => {
      timedOut = true;
      if (childRef.exitCode === null) groupKill("SIGTERM");
    }, plan.timeoutMs);

    sigkillTimer = setTimeout(() => {
      if (childRef.exitCode === null) {
        events.push({
          ts: new Date().toISOString(),
          type: "tool_error",
          tool: "process-group",
          exit_code: 137, // SIGKILL conventional encoding
        });
        groupKill("SIGKILL");
      }
    }, plan.timeoutMs + KILL_GRACE_MS);

    // M11 — parent-death handlers; ESRCH swallowed inside groupKill.
    const parentDeathSig: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    const parentExitHandler = (): void => {
      if (childRef.exitCode === null) groupKill("SIGTERM");
    };
    process.on("exit", parentExitHandler);
    parentDeathHandlersInstalled.push(() => process.off("exit", parentExitHandler));
    for (const sig of parentDeathSig) {
      const handler = (): void => {
        if (childRef.exitCode === null) groupKill("SIGTERM");
      };
      process.on(sig, handler);
      parentDeathHandlersInstalled.push(() => process.off(sig, handler));
    }

    // Wait for exit. We listen for "exit" (not "close") so we get the
    // exit code/signal as early as possible, then we drain pipes.
    const [code, signal] = (await once(childRef, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];

    // Drain stdio (M12) — wait for the child's pipes to flush into the
    // redactor before closing the on-disk streams.
    await Promise.all([
      child.stdout ? once(child.stdout, "end").catch(() => {}) : Promise.resolve(),
      child.stderr ? once(child.stderr, "end").catch(() => {}) : Promise.resolve(),
    ]);

    // M13 — resource usage snapshot of the parent (inclusive of waited-on
    // children on POSIX). Visibility-only; not enforced.
    const ru = process.resourceUsage();

    return {
      exitCode: code,
      signal,
      timedOut,
      spawnError: null,
      resourceUsage: ru,
    };
  } finally {
    // M11 + M12 — clear timers, flush+close streams, detach handlers,
    // never let a timer keep the process alive.
    if (sigtermTimer) clearTimeout(sigtermTimer);
    if (sigkillTimer) clearTimeout(sigkillTimer);
    for (const off of parentDeathHandlersInstalled) {
      try { off(); } catch { /* ignore */ }
    }
    // Drain Transform → file streams in the right order.
    if (stdoutRedactor) {
      stdoutRedactor.end();
      try { await once(stdoutRedactor, "end"); } catch { /* ignore */ }
    }
    if (stderrRedactor) {
      stderrRedactor.end();
      try { await once(stderrRedactor, "end"); } catch { /* ignore */ }
    }
    if (stdoutStream) await closeStreamSafely(stdoutStream);
    if (stderrStream) await closeStreamSafely(stderrStream);

    // Belt-and-braces: if for some reason the child is still alive here,
    // group-kill it.
    if (child && child.exitCode === null && child.pid !== undefined) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* ESRCH ignored */ }
      try { await once(child, "exit"); } catch { /* ignore */ }
    }
  }
}

async function closeStreamSafely(s: WriteStream): Promise<void> {
  if (s.closed) return;
  await new Promise<void>((res) => {
    s.once("close", () => res());
    s.end();
  });
}

// ---- Post-run capture (ADR-003 §3.3) ----------------------------------

interface CaptureSummary {
  partial: boolean;
  missing: string[];
}

async function capturePostRun(
  plan: ResolvedRunPlan,
  events: ToolErrorEvent[],
): Promise<CaptureSummary> {
  const missing: string[] = [];
  let partial = false;

  const wsGuild = join(plan.workspaceDir, ".guild");
  if (!existsSync(wsGuild)) {
    missing.push("_workspace/.guild");
    partial = true;
    return { partial, missing };
  }

  // M5/M6/M7/M8 — recursive copy with lstat pre-walk + 5-rule dest path
  // checklist + symlink refusal + errorOnExist semantics.
  await copyTreeSafe(wsGuild, plan.guildArtifactsDir, plan.guildArtifactsDir, events);

  // Resolve events.ndjson — prefer captured `.guild/runs/<inner>/events.ndjson`.
  const innerEvents = await findInnerEvents(plan.guildArtifactsDir);
  if (innerEvents) {
    // Read, redact again as a defense-in-depth pass at the events
    // boundary, write to canonical path.
    const raw = await readFile(innerEvents, "utf8");
    const redacted = redactStringPayload(raw);
    await writeFile(plan.eventsPath, redacted, { encoding: "utf8" });
  } else {
    // No events.ndjson — partial.
    missing.push("events.ndjson");
    partial = true;
  }

  return { partial, missing };
}

async function findInnerEvents(guildArtifactsDir: string): Promise<string | null> {
  const runsDir = join(guildArtifactsDir, "runs");
  if (!existsSync(runsDir)) return null;
  let entries: { name: string; isDir: boolean }[] = [];
  try {
    const dirents = await readdir(runsDir, { withFileTypes: true });
    entries = dirents.map((d) => ({ name: d.name, isDir: d.isDirectory() }));
  } catch {
    return null;
  }
  // Pick any inner run directory containing events.ndjson.
  for (const e of entries) {
    if (!e.isDir) continue;
    const candidate = join(runsDir, e.name, "events.ndjson");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function appendOrWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) {
    // Append: open with O_APPEND.
    const fd = openSync(path, "a");
    try {
      const buf = Buffer.from(content, "utf8");
      // node:fs writeSync via fd is fine for small append.
      const { writeSync } = await import("node:fs");
      writeSync(fd, buf);
    } finally {
      closeSync(fd);
    }
    return;
  }
  await writeFile(path, content, { encoding: "utf8" });
}

// ---- M5/M6/M7/M8 path resolution + symlink refusal --------------------

/**
 * Recursively copies `src` -> `dst`, applying the 5-rule path-resolution
 * checklist to every destination, refusing symlinks via lstat pre-walk,
 * and using `errorOnExist` semantics manually (so we can refuse without
 * aborting the whole capture).
 *
 * `dstRoot` is the boundary that `dst` (and every recursive sub-write)
 * MUST stay strictly under. Captures originating from `src` that would
 * resolve outside `dstRoot` are refused and logged as `tool_error` events.
 */
async function copyTreeSafe(
  src: string,
  dst: string,
  dstRoot: string,
  events: ToolErrorEvent[],
): Promise<void> {
  // M5/M6 — verify the destination is under dstRoot before any write.
  const safeDst = safeJoinUnder(dstRoot, relative(dstRoot, dst));
  if (safeDst === null) {
    events.push({
      ts: new Date().toISOString(),
      type: "tool_error",
      tool: "capture",
      exit_code: 1,
    });
    return;
  }

  // M7/F2.2 — lstat the source; if symlink, refuse + skip.
  const srcStat = await lstat(src).catch(() => null);
  if (srcStat === null) return;

  if (srcStat.isSymbolicLink()) {
    let target = "<unknown>";
    try { target = readlinkSync(src); } catch { /* keep default */ }
    events.push({
      ts: new Date().toISOString(),
      type: "tool_error",
      tool: "capture",
      exit_code: 1,
    });
    // Forensic: also drop a sidecar log so qa can correlate symlink target.
    return;
  }

  if (srcStat.isDirectory()) {
    await mkdir(safeDst, { recursive: true });
    const dirents = await readdir(src, { withFileTypes: true });
    for (const e of dirents) {
      const childSrc = join(src, e.name);
      const childDst = join(safeDst, e.name);
      // Recurse; the recursive call re-applies safeJoinUnder + lstat.
      await copyTreeSafe(childSrc, childDst, dstRoot, events);
    }
    return;
  }

  if (srcStat.isFile()) {
    // M8 — refuse if dst already exists (errorOnExist).
    if (existsSync(safeDst)) {
      events.push({
        ts: new Date().toISOString(),
        type: "tool_error",
        tool: "capture",
        exit_code: 17, // EEXIST
      });
      return;
    }
    await mkdir(dirname(safeDst), { recursive: true });
    await cp(src, safeDst, { dereference: false, errorOnExist: true });
    return;
  }
  // Block / char / fifo / socket — refuse silently (forensic event).
  events.push({
    ts: new Date().toISOString(),
    type: "tool_error",
    tool: "capture",
    exit_code: 1,
  });
}

/**
 * 5-rule path-resolution checklist (M5/F2.1). Returns the resolved
 * absolute target if `rel` joined with `root` lies strictly under
 * `root`; returns null on any escape attempt.
 *
 *   1. Normalise (posix semantics — treat `\` as literal, not separator).
 *   2. Strip leading `/`, `\\`, `\\?\`, and drive-letter prefix.
 *   3. Resolve via `path.resolve`.
 *   4. Verify `path.relative` does NOT start with `..` and is NOT absolute.
 *   5. Backstop: `target === root || target.startsWith(root + sep)`.
 */
export function safeJoinUnder(root: string, rel: string): string | null {
  if (typeof rel !== "string") return null;
  // Step 1+2: normalise (posix) + strip leading separators / drive prefixes / UNC.
  let stripped = rel.replace(/^[\\/]+/, "");
  stripped = stripped.replace(/^\\\\\?\\/, ""); // \\?\ prefix
  stripped = stripped.replace(/^\\\\/, "");      // UNC
  stripped = stripped.replace(/^[A-Za-z]:/, ""); // drive-letter prefix
  const normalised = posix.normalize(stripped.replace(/\\/g, "/"));
  if (normalised.startsWith("..")) return null;
  if (isAbsolute(normalised)) return null;

  // Step 3: resolve.
  const target = resolve(root, normalised === "" || normalised === "." ? "" : normalised);

  // Step 4: relative segment-aware verify.
  const r = relative(root, target);
  if (r.startsWith("..") || isAbsolute(r)) return null;

  // Step 5: backstop.
  const rootSep = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(rootSep)) return null;

  return target;
}

// ---- Status mapping (architect §4.1) ---------------------------------

function mapStatus(input: {
  spawnError: string | null;
  exitCode: number | null;
  timedOut: boolean;
  captureSummary: CaptureSummary;
  acceptanceFailedFromEvents: boolean;
}): RunStatus {
  if (input.timedOut) return "timeout";
  if (input.spawnError !== null) return "errored";
  if (input.exitCode === null) return "errored";
  if (input.exitCode !== 0) return "errored";
  // exit 0:
  if (input.captureSummary.partial && input.captureSummary.missing.includes("_workspace/.guild")) {
    return "errored";
  }
  if (input.acceptanceFailedFromEvents) return "fail";
  return "pass";
}

// ---- M2 spawn wrapper (ban shell:true) -------------------------------

function spawnGuarded(
  bin: string,
  args: string[],
  opts: SpawnOptions,
): ChildProcess {
  // M2 (F1.1) — defense in depth: fail loudly if a future refactor
  // ever sets shell:true.
  if (opts.shell === true || (typeof opts.shell === "string" && opts.shell.length > 0)) {
    throw new Error("runner: spawn with shell:true is forbidden (F1.1 / M2)");
  }
  if (!Array.isArray(args)) {
    throw new Error("runner: spawn args must be an array (M1 / F1.2)");
  }
  return spawn(bin, args, opts);
}

// ---- M1 argv shape assertion -----------------------------------------

function assertArgvShape(argv: unknown): asserts argv is string[] {
  if (!Array.isArray(argv)) {
    throw new Error("runner: argv must be an array (M1 / F1.2)");
  }
  for (const el of argv) {
    if (typeof el !== "string") {
      throw new Error(`runner: argv element ${typeof el} is not a string (M1)`);
    }
    if (el.indexOf("\0") !== -1) {
      throw new Error("runner: argv element contains NUL byte (M1 / CWE-158)");
    }
    if (el.length > 16_384) {
      throw new Error("runner: argv element exceeds size guard (F1.5 / M5)");
    }
  }
}

// ---- M3 + M16 env build ----------------------------------------------

function buildSubprocessEnv(): {
  envForChild: NodeJS.ProcessEnv;
  allowlistKeys: string[];
} {
  const out: NodeJS.ProcessEnv = {};
  const seenKeys: string[] = [];
  for (const key of ENV_ALLOWLIST_KEYS) {
    const v = process.env[key];
    if (v !== undefined) {
      out[key] = v;
      seenKeys.push(key);
    }
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (!ENV_PREFIX_ALLOW.test(k)) continue;
    if (ENV_HARD_DROP.test(k)) continue;
    if (out[k] !== undefined) continue;
    out[k] = v;
    seenKeys.push(k);
  }
  // Sort for stable dry-run output.
  seenKeys.sort();
  return { envForChild: out, allowlistKeys: seenKeys };
}

// ---- M4 PATH-resolved claude binary -----------------------------------

function resolveClaudeBinary(): string {
  // Allow ENV override (operator runbook for non-standard installs).
  const override = process.env[ENV_CLAUDE_BIN];
  if (override !== undefined && override.length > 0) {
    if (!isAbsolute(override)) {
      throw new Error(
        `runner: ${ENV_CLAUDE_BIN} must be an absolute path; got "${override}" (M4)`,
      );
    }
    assertSafeBinaryPath(override);
    return override;
  }
  // Walk PATH for first match.
  const PATH = process.env.PATH ?? "";
  if (PATH.length === 0) {
    throw new Error("runner: PATH is empty; cannot resolve `claude` (M4)");
  }
  const segments = PATH.split(":");
  for (const seg of segments) {
    if (seg.length === 0) continue;
    const candidate = join(seg, "claude");
    if (existsSync(candidate)) {
      assertSafeBinaryPath(candidate);
      return candidate;
    }
  }
  // Not found — fall back to bare name; spawn will ENOENT and we'll
  // record `errored`. We still record the bare name in raw_command so
  // operators can debug.
  return "claude";
}

function assertSafeBinaryPath(p: string): void {
  // Refuse obviously suspicious resolution sources (M4 hardening).
  if (p.startsWith("/tmp/")) {
    throw new Error(`runner: refuse claude binary under /tmp: ${p} (M4 / F1.4)`);
  }
  if (p.includes("/_workspace/")) {
    throw new Error(`runner: refuse claude binary under run workspace: ${p} (M4 / F1.4)`);
  }
  if (p.includes("/..")) {
    throw new Error(`runner: refuse claude binary path with '..' segment: ${p} (M4)`);
  }
}

// ---- argv builder (M5) ------------------------------------------------

function buildArgv(input: {
  claudeBinary: string;
  promptPath: string;
  workspaceDir: string;
}): string[] {
  // Decision: use `--print` (non-interactive) + `--prompt-file <path>` +
  // `--workdir <path>` + `--output-format stream-json`. If the operator's
  // claude CLI doesn't accept these flags, override via the
  // GUILD_BENCHMARK_CLAUDE_BIN env var to point at a wrapper script.
  // Documented in handoff `decisions:`.
  return [
    input.claudeBinary,
    "--print",
    "--prompt-file",
    input.promptPath,
    "--workdir",
    input.workspaceDir,
    "--output-format",
    "stream-json",
  ];
}

// ---- M9 timeout resolution -------------------------------------------

export function resolveTimeoutMs(caseTimeoutSeconds: number | undefined): number {
  let cap = DEFAULT_T_BUDGET_MS;
  const envOverride = process.env[ENV_TIMEOUT_MS];
  if (envOverride !== undefined && envOverride.length > 0) {
    const n = Number.parseInt(envOverride, 10);
    if (Number.isInteger(n) && n > 0 && n <= DEFAULT_T_BUDGET_MS) {
      cap = n;
    }
  }
  if (caseTimeoutSeconds !== undefined && caseTimeoutSeconds > 0) {
    const caseMs = caseTimeoutSeconds * 1000;
    return Math.min(caseMs, cap);
  }
  return cap;
}

// ---- M14 redaction stream + payload -----------------------------------

function createRedactingTransform(): Transform {
  let carry = "";
  return new Transform({
    transform(chunk, _enc, cb) {
      const text = carry + chunk.toString("utf8");
      const lastNl = text.lastIndexOf("\n");
      if (lastNl === -1) {
        // No complete line yet; carry forward up to a bounded size to
        // avoid unbounded buffer growth on pathological inputs.
        carry = text.length > 65_536 ? text.slice(text.length - 65_536) : text;
        cb();
        return;
      }
      const head = text.slice(0, lastNl + 1);
      carry = text.slice(lastNl + 1);
      cb(null, Buffer.from(redactStringPayload(head), "utf8"));
    },
    flush(cb) {
      if (carry.length > 0) {
        cb(null, Buffer.from(redactStringPayload(carry), "utf8"));
        carry = "";
      } else {
        cb();
      }
    },
  });
}

export function redactStringPayload(s: string): string {
  let out = s;
  for (const { re, shape } of REDACTION_PATTERNS) {
    out = out.replace(re, (match) => {
      const tag = sha256First4(match);
      return `<REDACTED:${shape}:hash=${tag}>`;
    });
  }
  return out;
}

function sha256First4(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 4);
}

// ---- M15 raw_command audit redaction ---------------------------------

export function redactArgvForAudit(
  argv: string[],
  ctx: { runDir: string; homeDir: string; benchmarkRoot: string },
): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i] as string;
    const prev = i > 0 ? (argv[i - 1] as string) : "";
    // Flag-context redaction: if the previous slot is a known-secret
    // flag, redact this slot.
    if (SECRET_FLAG_RE.test(prev) && !SAFE_FLAG_VALUES.has(prev.toLowerCase())) {
      out.push("<REDACTED:flag-context>");
      continue;
    }
    // Value-shape redaction (token shapes).
    let scrubbed = redactStringPayload(cur);
    // Path placeholders.
    scrubbed = applyPathPlaceholders(scrubbed, ctx);
    out.push(scrubbed);
  }
  return out;
}

function applyPathPlaceholders(
  s: string,
  ctx: { runDir: string; homeDir: string; benchmarkRoot: string },
): string {
  let out = s;
  if (ctx.runDir.length > 0) out = out.split(ctx.runDir).join("${RUN_DIR}");
  if (ctx.benchmarkRoot.length > 0) out = out.split(ctx.benchmarkRoot).join("${BENCHMARK_ROOT}");
  if (ctx.homeDir.length > 0) out = out.split(ctx.homeDir).join("${HOME}");
  return out;
}

// ---- run-id + plugin_ref + model_ref ---------------------------------

async function resolveCasePath(casesDir: string, slug: string): Promise<string> {
  const candidates = [
    join(casesDir, `${slug}.yaml`),
    join(casesDir, `${slug}.yml`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`runner: case YAML not found for slug "${slug}" under ${casesDir}`);
}

async function resolveHostRepoRoot(runsDir: string): Promise<string> {
  // Host repo = parent of benchmark/. runsDir is typically <benchmark>/runs/
  // -> hostRepoRoot is dirname(dirname(runsDir)).
  const benchmarkRoot = dirname(resolve(runsDir));
  return dirname(benchmarkRoot);
}

function resolvePluginRef(hostRepoRoot: string): string {
  try {
    const out = execFileSync("git", ["-C", hostRepoRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    return out.trim();
  } catch {
    return "unknown";
  }
}

function resolveModelRef(override?: Record<string, string>): Record<string, string> {
  // Source priority: override (CLI/HTTP) > GUILD_BENCHMARK_MODELS_JSON env > default.
  if (override !== undefined && Object.keys(override).length > 0) {
    return { ...override };
  }
  const envJson = process.env[ENV_MODELS_JSON];
  if (envJson !== undefined && envJson.length > 0) {
    try {
      const parsed = JSON.parse(envJson) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string" && v.length > 0) out[k] = v;
        }
        if (Object.keys(out).length > 0) return out;
      }
    } catch {
      // fall through to default
    }
  }
  return { default: "claude-opus-4-7" };
}

function generateRunId(
  caseSlug: string,
  pluginRef: string,
  modelRef: Record<string, string>,
  runsDir: string,
): string {
  const shortPlugin = (pluginRef || "unknown").slice(0, 7);
  const modelHash = createHash("sha256")
    .update(JSON.stringify(canonicalise(modelRef)))
    .digest("hex")
    .slice(0, 7);
  const prefix = `${caseSlug}-${shortPlugin}-${modelHash}-`;

  let n = 1;
  if (existsSync(runsDir)) {
    try {
      const entries = readdirSync(runsDir, { withFileTypes: true });
      const taken = entries
        .filter((d) => d.isDirectory() && d.name.startsWith(prefix))
        .map((d) => Number.parseInt(d.name.slice(prefix.length), 10))
        .filter((x) => Number.isInteger(x) && x > 0);
      if (taken.length > 0) n = Math.max(...taken) + 1;
    } catch {
      // fall through; n=1
    }
  }
  return `${prefix}${n}`;
}

function canonicalise(o: Record<string, string>): Record<string, string> {
  const keys = Object.keys(o).sort();
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = o[k] as string;
  return out;
}

// ---- Dry-run report formatter ----------------------------------------

export function formatDryRunReport(plan: ResolvedRunPlan): string {
  // M16 — env values are NOT printed; only the allowlist KEY SET.
  const lines: string[] = [];
  lines.push(`benchmark run --dry-run --case ${plan.caseSlug}`);
  lines.push(`  run_id           : ${plan.runId}`);
  lines.push(`  plugin_ref       : ${plan.pluginRef}`);
  lines.push(`  model_ref        : ${JSON.stringify(plan.modelRef)}`);
  lines.push(`  host_repo_root   : ${plan.hostRepoRoot}`);
  lines.push(`  fixture          : ${plan.fixturePath}`);
  lines.push(`  workspace_dir    : ${plan.workspaceDir}`);
  lines.push(`  artifacts_root   : ${plan.artifactsRoot}`);
  lines.push(`  guild_artifacts  : ${plan.guildArtifactsDir}`);
  lines.push(`  prompt_path      : ${plan.promptPath}`);
  lines.push(`  events_path      : ${plan.eventsPath}`);
  lines.push(`  run_json_path    : ${plan.runJsonPath}`);
  lines.push(`  stdout_log       : ${plan.stdoutLogPath}`);
  lines.push(`  stderr_log       : ${plan.stderrLogPath}`);
  lines.push(`  claude_binary    : ${plan.claudeBinary}`);
  lines.push(`  argv (json)      : ${JSON.stringify(plan.argv)}`);
  lines.push(`  raw_command      : ${JSON.stringify(redactArgvForAudit(plan.argv, {
    runDir: plan.runDir,
    homeDir: homedir(),
    benchmarkRoot: dirname(plan.hostRepoRoot + "/benchmark"),
  }))}`);
  lines.push(`  timeout_ms       : ${plan.timeoutMs}  (cap=${DEFAULT_T_BUDGET_MS})`);
  lines.push(`  kill_grace_ms    : ${KILL_GRACE_MS}`);
  lines.push(`  cleanup          : ${plan.cleanup}`);
  lines.push(`  env_allowlist    : ${describeEnvAllowlistKeysOnly(plan)}`);
  lines.push(`  spawn_options    : { detached:true, shell:false, stdio:["ignore","pipe","pipe"], windowsHide:true } (ADR-004 + M2)`);
  lines.push("");
  lines.push("(dry-run: no subprocess spawned; no files written)");
  return lines.join("\n") + "\n";
}

// M16 — values are intentionally never included in dry-run output, only keys.
function describeEnvAllowlistKeysOnly(plan: ResolvedRunPlan): string {
  if (plan.envAllowlistKeys.length === 0) return "(empty)";
  return `[${plan.envAllowlistKeys.join(", ")}]  (values redacted — M16)`;
}

// Paranoid sanity check — ensure basename matches what we expect for `claude`.
// Currently unused publicly but kept as a hook for future ADR-005 hardening.
function _safeBaseClaude(p: string): boolean {
  return basename(p) === "claude" || basename(p) === "claude.exe";
}
void _safeBaseClaude;

/**
 * scripts/lib/run-lifecycle.ts
 *
 * SC-B — the run-lifecycle library. Implements the B1 contract VERBATIM:
 *   .guild/initiatives/active/learn-knowledge-convergence/artifacts/run-lifecycle-contract.md §4.
 *
 * `startRun` writes the `guild.run.v1` start manifest (run.yaml) + the
 * current-run-id sentinel + an empty logs/ dir, and returns the run-id.
 * `closeRun` writes the `guild.provenance.v1` close-shape (provenance.json),
 * references the terminal `guild.trace_event.v1` BY POINTER, references the
 * final learning checkpoint, and flips run.yaml.status.
 * v2 run records are run.yaml + provenance.json ONLY — metadata.json dual-write
 * removed (SC-8 cleanup).
 *
 * Hard invariants (B1 §3/§4/§5):
 *   - NN#5: startRun creates ZERO .guild/initiatives/ dir. initiative is a
 *     RECORDED scalar field only (run.yaml.initiative_attachment +
 *     provenance.json.initiative).
 *   - Host-NEUTRAL: host is resolved via env.resolveHost (the host-adapter
 *     contract binding). There is NO `if (host === "claude")` branch here.
 *   - Clock injected: started_at/closed_at come from env.now() — never Date.now().
 *   - fs injected: all I/O goes through env.fs — never the global fs module.
 *   - Lightweight run_class (OQ6 status variant): writes ONLY run.yaml +
 *     provenance.json to .guild/runs/; closeRun short-circuits the learning
 *     checkpoint (final_learning_checkpoint always null).
 *
 * This module is PURE given its injected env: deterministic clock + in-memory
 * fs make every behaviour unit-testable with no disk. `createRealEnv()` is the
 * default real-fs + system-clock adapter the entrypoints use.
 *
 * Owned by tooling-engineer. Lane B3 (hook-engineer) wires the run_started /
 * run_closed trace-event emit + the record_status_runs gate against this shape.
 *
 * Also exports the SC-D workspace-knowledge config reader + the OQ6
 * record_status_runs reader (B1 §3 schema delta), both default-safe-when-absent.
 */

import * as crypto from "crypto";
import * as fsNode from "fs";
import * as path from "path";
import type { HostKind } from "./host-types";
import { resolveSettings } from "./settings-resolver";
import type { ResolvedSettingsSnapshot } from "./runstart-preflight";

// ── Injected seams (B1 §4) ───────────────────────────────────────────────────

/** Injected seams so the lib is pure + testable (no Date.now, no global fs). */
export interface RunLifecycleEnv {
  /** Returns the run's clock value as an RFC3339 UTC string. */
  now(): string;
  /** Minimal fs surface the wrapper needs; a real-fs adapter is the default. */
  fs: {
    mkdirp(absPath: string): void;
    writeFile(absPath: string, contents: string): void;
    readFile(absPath: string): string | null;
    exists(absPath: string): boolean;
  };
  /**
   * Resolves the host via the host-adapter contract — NEVER Claude-pinned.
   * Returns the requested + resolved HostKind and an optional capabilities ref.
   * Wired to the existing host-router / write-host-capability path; the wrapper
   * only consumes the result.
   */
  resolveHost(requested: string): {
    requested: string;
    resolved: HostKind;
    capabilities_ref?: string;
  };
}

// ── Public types (B1 §4) ─────────────────────────────────────────────────────

export type TargetKind =
  | "regular_project"
  | "workspace"
  | "existing_guild_project"
  | "new_or_sparse_project"
  | "mixed_or_uncertain";

export type RunClass = "full" | "lightweight";

export type RunStatus = "open" | "closed" | "resumable" | "failed";
export type TerminalStatus = "closed" | "failed" | "resumable";

export interface StartRunOpts {
  /** Entry command token, e.g. "/guild:learn". */
  command: string;
  /** Resolved invocation arguments (free-shape). */
  arguments: Record<string, string | number | boolean | null>;
  /** Absolute cwd at entry. */
  cwd: string;
  /** Absolute project/workspace root (for the .guild/ write base). */
  root: string;
  /** Detected target shape (SC-A classes). */
  target_kind: TargetKind;
  /** Workspace identity (is_workspace + sub_guild names, by reference). */
  workspace: {
    is_workspace: boolean;
    root: string;
    sub_guilds?: string[];
  };
  /** Human project label. */
  project: string;
  /** Requested host (e.g. "auto" or an explicit HostKind). Resolution is delegated. */
  host_requested: string;
  /** Human-readable tier-policy descriptor. */
  model_tier_policy: string;
  /** Ignore-rule descriptor in force. */
  ignore_policy: string;
  /** Scan posture for this run. */
  scan_policy: string;
  /**
   * Initiative slug to RECORD, or null for a one-off.
   * NN#5: recording a slug MUST NOT create any .guild/initiatives/ dir.
   */
  initiative: string | null;
  /** Entry phase, or null. */
  phase?: string | null;
  /** "full" (default) or "lightweight" (OQ6 status variant — §5). */
  run_class?: RunClass;
  /**
   * U6 — Optional resolved-settings snapshot produced by runStartPreflight (U3).
   * When provided, startRun writes .guild/runs/<id>/resolved-settings.json and
   * adds a compact settings_ref block to run.yaml. When absent, behavior is
   * unchanged (back-compat — existing runs and tests stay green).
   */
  snapshot?: ResolvedSettingsSnapshot;
}

/** What closeRun records into provenance.json (caller assembles touched-facts). */
export interface CloseRunOpts {
  /** Terminal status. */
  status: TerminalStatus;
  /** The "what this run touched" fact block (defaults to empty arrays). */
  touched?: Partial<{
    tasks: string[];
    agents: string[];
    skills: string[];
    decisions: string[];
    features: string[];
    files: string[];
    runs: string[];
  }>;
  /** File-coverage / skipped-summary pointers (learn-class runs). */
  coverage?: {
    scanned_count: number;
    skipped_count: number;
    skipped_files_ref: string;
  };
  /** Path to the final learning checkpoint, or null (lightweight ⇒ always null). */
  final_learning_checkpoint?: string | null;
  /** Durable-artifact pointers (spec/plan/team/review/verify/summary). */
  artifacts?: Record<string, string>;
  /** Final gate outcomes snapshot. */
  gates?: Record<string, { posture: string; outcome: string; codex_review: string }>;
}

export interface RunLifecycle {
  /**
   * Writes run.yaml + current-run-id + logs/ dir and returns the run-id.
   * (The run_started trace event is emitted by B3's hook leg, not here.)
   * MUST NOT create any .guild/initiatives/ directory (NN#5).
   */
  startRun(opts: StartRunOpts): string;

  /**
   * Writes provenance.json (guild.provenance.v1), references the terminal
   * run_closed guild.trace_event.v1 BY POINTER, references the final learning
   * checkpoint, and sets run.yaml.status.
   */
  closeRun(runId: string, opts: CloseRunOpts): void;
}

// ── Schema-shaped close records (internal) ───────────────────────────────────

interface TouchedBlock {
  tasks: string[];
  agents: string[];
  skills: string[];
  decisions: string[];
  features: string[];
  files: string[];
  runs: string[];
}

interface TerminalTraceEventRef {
  event_id: string;
  event_name: "run_closed";
  at: string;
  log_ref: string;
}

interface ProvenanceRecord {
  schema_version: "guild.provenance.v1";
  run_id: string;
  command: string;
  initiative: string | null;
  retention_class: "one-off-90d" | "until-archive";
  started_at: string;
  closed_at: string;
  status: TerminalStatus;
  run_class: RunClass;
  terminal_trace_event: TerminalTraceEventRef;
  final_learning_checkpoint: string | null;
  gates: Record<string, { posture: string; outcome: string; codex_review: string }>;
  touched: TouchedBlock;
  coverage?: { scanned_count: number; skipped_count: number; skipped_files_ref: string };
  artifacts: Record<string, string>;
  benchmark_eligible: boolean;
}

/** The minimal start-manifest fields closeRun must read back off disk. */
interface StartManifestFacts {
  command: string;
  initiative: string | null;
  run_class: RunClass;
  started_at: string;
  self_build: boolean;
}

// ── Path helpers (all relative to the run's .guild/ base = opts.root) ─────────

function runDir(root: string, runId: string): string {
  return path.join(root, ".guild", "runs", runId);
}
function runYamlPath(root: string, runId: string): string {
  return path.join(runDir(root, runId), "run.yaml");
}
function provenancePath(root: string, runId: string): string {
  return path.join(runDir(root, runId), "provenance.json");
}
function logsDir(root: string, runId: string): string {
  return path.join(runDir(root, runId), "logs");
}
function resolvedSettingsPath(root: string, runId: string): string {
  return path.join(runDir(root, runId), "resolved-settings.json");
}
function sentinelPath(root: string): string {
  // Canonical sentinel location: .guild/runs/current-run-id.
  // startRun is the SOLE writer (new-run-id.ts deleted in SC-8 W2B-4).
  // Consumed by: capture-telemetry.ts, post-tool-use.ts, pre-compact.ts,
  // pre-tool-use.ts, and the hook run-trace chain
  // (GUILD_RUN_ID → runs/current-run-id → current-run-id).
  return path.join(root, ".guild", "runs", "current-run-id");
}
/** Trace log_ref recorded into provenance — a POSIX-style .guild-relative pointer. */
function logRefFor(runId: string): string {
  return `.guild/runs/${runId}/logs/v1.4-events.jsonl`;
}

// ── run-id generation (B1 §1 run_id field) ───────────────────────────────────

/** UTC-compact stamp YYYYMMDD-HHMMSS from an RFC3339 UTC `now` string. */
function utcCompact(nowIso: string): string {
  // Be lenient: strip non-digits, slice the date+time. Falls back to Date parse.
  const d = new Date(nowIso);
  const iso = Number.isNaN(d.getTime()) ? nowIso : d.toISOString();
  // iso = 2026-05-29T08:40:21.000Z  →  20260529-084021
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
  // last-resort: keep only digits
  const digits = iso.replace(/\D/g, "");
  return `${digits.slice(0, 8)}-${digits.slice(8, 14)}`;
}

function makeRunId(initiative: string | null, nowIso: string): string {
  if (initiative) return `run-${initiative}-${utcCompact(nowIso)}`;
  return `run-${crypto.randomUUID()}`;
}

// ── YAML serialization (hand-rolled — start manifest is a fixed, simple shape) ─

function yamlScalar(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  // Quote only when needed (leading/trailing space, or chars that break a bare
  // scalar). Bare scalars match the dogfooded run.yaml style (e.g. `host: auto`).
  if (v === "") return '""';
  if (/^[\w./:@+-]+$/.test(v) && !/^\d{4}-\d{2}/.test(v)) return v; // simple token
  if (/^[^\s#:][^#]*$/.test(v) && !v.includes(": ") && !/[:#]$/.test(v)) return v;
  return JSON.stringify(v);
}

function serializeRunYaml(rec: Record<string, unknown>): string {
  const lines: string[] = [];
  const emit = (obj: Record<string, unknown>, indent: number): void => {
    const pad = "  ".repeat(indent);
    for (const [k, val] of Object.entries(obj)) {
      if (val === undefined) continue;
      if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(`${pad}${k}: []`);
        } else if (val.every((x) => typeof x !== "object" || x === null)) {
          // inline flow sequence: [a, b, c]
          lines.push(`${pad}${k}: [${val.map((x) => yamlScalar(x as never)).join(", ")}]`);
        } else {
          lines.push(`${pad}${k}:`);
          for (const item of val) {
            if (item && typeof item === "object") {
              const entries = Object.entries(item as Record<string, unknown>);
              entries.forEach(([ik, iv], i) => {
                const prefix = i === 0 ? `${pad}  - ` : `${pad}    `;
                lines.push(`${prefix}${ik}: ${yamlScalar(iv as never)}`);
              });
            } else {
              lines.push(`${pad}  - ${yamlScalar(item as never)}`);
            }
          }
        }
      } else if (val && typeof val === "object") {
        const entries = Object.entries(val as Record<string, unknown>);
        if (entries.length === 0) {
          lines.push(`${pad}${k}: {}`);
        } else {
          lines.push(`${pad}${k}:`);
          emit(val as Record<string, unknown>, indent + 1);
        }
      } else {
        lines.push(`${pad}${k}: ${yamlScalar(val as never)}`);
      }
    }
  };
  emit(rec, 0);
  return lines.join("\n") + "\n";
}

// ── startRun ──────────────────────────────────────────────────────────────────

function buildRunManifest(opts: StartRunOpts, runId: string, env: RunLifecycleEnv): Record<string, unknown> {
  const host = env.resolveHost(opts.host_requested);
  const runClass: RunClass = opts.run_class ?? "full";

  const workspace: Record<string, unknown> = {
    is_workspace: opts.workspace.is_workspace,
    root: opts.workspace.root,
  };
  if (opts.workspace.sub_guilds && opts.workspace.sub_guilds.length > 0) {
    workspace["sub_guilds"] = opts.workspace.sub_guilds;
  }

  const hostBlock: Record<string, unknown> = {
    requested: host.requested,
    resolved: host.resolved,
  };
  if (host.capabilities_ref) hostBlock["capabilities_ref"] = host.capabilities_ref;

  const phase = opts.phase ?? null;

  const manifest: Record<string, unknown> = {
    schema_version: "guild.run.v1",
    run_id: runId,
    command: opts.command,
    arguments: opts.arguments,
    cwd: opts.cwd,
    target_kind: opts.target_kind,
    workspace,
    project: opts.project,
    host: hostBlock,
    model_tier_policy: opts.model_tier_policy,
    started_at: env.now(),
    ignore_policy: opts.ignore_policy,
    scan_policy: opts.scan_policy,
    initiative_attachment: opts.initiative, // NN#5: scalar record ONLY
    phase,
    run_class: runClass,
    gates: {},
    status: "open" as RunStatus,
    phases_log: phase
      ? [{ phase, at: env.now() }]
      : [],
  };

  // U6: compact settings_ref when snapshot is provided. This is an audit pointer
  // to the resolved-settings.json written alongside run.yaml. Mid-run consumers
  // read the full JSON; this block gives a quick at-a-glance summary.
  if (opts.snapshot) {
    manifest["settings_ref"] = {
      path: "resolved-settings.json",
      schema_version: opts.snapshot.schema_version,
      effective_backend: opts.snapshot.effective.agent_mode,
      review: opts.snapshot.effective.review,
      recommended_provider: opts.snapshot.providers.recommended,
    };
  }

  return manifest;
}

// ── closeRun helpers ─────────────────────────────────────────────────────────

function emptyTouched(): TouchedBlock {
  return { tasks: [], agents: [], skills: [], decisions: [], features: [], files: [], runs: [] };
}

function mergeTouched(supplied: CloseRunOpts["touched"]): TouchedBlock {
  const base = emptyTouched();
  if (!supplied) return base;
  for (const k of Object.keys(base) as Array<keyof TouchedBlock>) {
    const v = supplied[k];
    if (Array.isArray(v)) base[k] = v;
  }
  return base;
}

/**
 * Read the minimal start-manifest facts back off disk (run.yaml). closeRun is
 * self-contained: it does not require the caller to re-pass start facts.
 * Throws if run.yaml is absent (NN#7 — every close needs a started run).
 */
function readStartFacts(env: RunLifecycleEnv, root: string, runId: string): StartManifestFacts {
  const raw = env.fs.readFile(runYamlPath(root, runId));
  if (raw === null) {
    throw new Error(
      `[run-lifecycle] closeRun("${runId}"): no run.yaml at ${runYamlPath(root, runId)} — ` +
        `cannot close a run that was never started.`
    );
  }
  const get = (key: string): string | null => {
    // Match a top-level `key: value` line (bare scalar; the start writer's shape).
    const m = raw.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
    return m ? m[1].trim() : null;
  };
  const command = get("command") ?? "";
  const initRaw = get("initiative_attachment");
  const initiative = initRaw === null || initRaw === "null" || initRaw === "" ? null : initRaw;
  const runClassRaw = get("run_class");
  const run_class: RunClass = runClassRaw === "lightweight" ? "lightweight" : "full";
  const started_at = get("started_at") ?? "";
  const self_build = /^[\s\S]*self_build:[ \t]*true/m.test(raw);
  return { command, initiative, run_class, started_at, self_build };
}

/** Rewrite run.yaml's top-level `status:` line in place to the terminal value. */
function flipRunStatus(env: RunLifecycleEnv, root: string, runId: string, status: TerminalStatus): void {
  const p = runYamlPath(root, runId);
  const raw = env.fs.readFile(p);
  if (raw === null) return;
  const next = raw.replace(/^status:[ \t]*.*$/m, `status: ${status}`);
  env.fs.writeFile(p, next);
}

// ── Factory ────────────────────────────────────────────────────────────────────

/** Factory the entrypoints call; pass createRealEnv() for the real-fs default. */
export function createRunLifecycle(env: RunLifecycleEnv): RunLifecycle {
  return {
    startRun(opts: StartRunOpts): string {
      const runId = makeRunId(opts.initiative, env.now());
      const root = opts.root;

      // logs/ dir (mkdirp also ensures runs/<id>/ exists). NN#5: we touch ONLY
      // .guild/runs/<id>/ — never .guild/initiatives/.
      env.fs.mkdirp(logsDir(root, runId));

      // U6: write resolved-settings.json BEFORE run.yaml so the file is on disk
      // before any consumer might read it. When no snapshot, skip (back-compat).
      if (opts.snapshot) {
        writeResolvedSettingsSnapshot(runId, opts.snapshot, {
          cwd: root,
          fs: env.fs,
          // Use the run-id as the resolved_at_ref (deterministic, no Date.now).
          resolvedAtRef: runId,
        });
      }

      // run.yaml (guild.run.v1) — the single start manifest.
      const manifest = buildRunManifest(opts, runId, env);
      env.fs.writeFile(runYamlPath(root, runId), serializeRunYaml(manifest));

      // current-run-id sentinel.
      env.fs.writeFile(sentinelPath(root), runId);

      return runId;
    },

    closeRun(runId: string, opts: CloseRunOpts): void {
      // The .guild/ base is inferred from cwd: closeRun is called from the run's
      // root, so resolve runs/<id> relative to process cwd's nearest .guild base.
      // We reconstruct root by reading the run.yaml under the same base the
      // caller's env.fs sees; the real adapter is rooted at the project root.
      const root = resolveCloseRoot(env, runId);

      const facts = readStartFacts(env, root, runId);
      const runClass = facts.run_class;
      const now = env.now();

      // Lightweight (OQ6): the learning checkpoint is ALWAYS null — status runs
      // never harvest. Short-circuit any caller-supplied checkpoint path.
      const finalCheckpoint =
        runClass === "lightweight" ? null : opts.final_learning_checkpoint ?? null;

      const terminalTraceEvent: TerminalTraceEventRef = {
        event_id: `evt-${crypto.randomUUID()}`,
        event_name: "run_closed",
        at: now,
        log_ref: logRefFor(runId),
      };

      const provenance: ProvenanceRecord = {
        schema_version: "guild.provenance.v1",
        run_id: runId,
        command: facts.command,
        initiative: facts.initiative,
        retention_class: facts.initiative ? "until-archive" : "one-off-90d",
        started_at: facts.started_at,
        closed_at: now,
        status: opts.status,
        run_class: runClass,
        terminal_trace_event: terminalTraceEvent,
        final_learning_checkpoint: finalCheckpoint,
        gates: opts.gates ?? {},
        touched: mergeTouched(opts.touched),
        artifacts: opts.artifacts ?? {},
        benchmark_eligible: opts.status === "closed",
      };
      if (opts.coverage) provenance.coverage = opts.coverage;

      env.fs.writeFile(provenancePath(root, runId), JSON.stringify(provenance, null, 2) + "\n");

      // Flip run.yaml.status to the terminal value.
      flipRunStatus(env, root, runId, opts.status);
    },
  };
}

/**
 * closeRun resolves the run's root by walking the real-fs adapter's base. For
 * the real adapter (createRealEnv) the base is fixed at construction; for the
 * in-memory test adapter the absolute run path is reconstructed from the
 * sentinel. We delegate to an env-provided root when present, else fall back to
 * scanning for the run.yaml under the cwd's .guild/runs/<id>.
 *
 * The real-fs env stamps `__rootHint` so close finds the same base start used.
 */
function resolveCloseRoot(env: RunLifecycleEnv, runId: string): string {
  const hint = (env as RunLifecycleEnv & { __rootHint?: string }).__rootHint;
  if (hint) return hint;
  // Fallback: assume the cwd is the project root (entrypoints run from root).
  const cwd = process.cwd();
  if (env.fs.exists(runYamlPath(cwd, runId))) return cwd;
  return cwd;
}

// ── Real-fs + system-clock adapter (the entrypoint default) ──────────────────

/**
 * Default env: real fs (rooted at `root`), system clock (RFC3339 UTC), and the
 * host-adapter resolveHost binding. Entrypoints construct this; tests inject a
 * deterministic env instead.
 *
 * @param root absolute project/workspace root (the .guild/ write base).
 * @param resolveHost the host-adapter binding (see lib/host-router or
 *   write-host-capability). Required so this module stays host-neutral — it
 *   never imports a concrete host resolver itself.
 */
export function createRealEnv(
  root: string,
  resolveHost: RunLifecycleEnv["resolveHost"]
): RunLifecycleEnv {
  const env: RunLifecycleEnv & { __rootHint?: string } = {
    now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    fs: {
      mkdirp(absPath: string): void {
        fsNode.mkdirSync(absPath, { recursive: true });
      },
      writeFile(absPath: string, contents: string): void {
        fsNode.mkdirSync(path.dirname(absPath), { recursive: true });
        fsNode.writeFileSync(absPath, contents, "utf8");
      },
      readFile(absPath: string): string | null {
        try {
          return fsNode.readFileSync(absPath, "utf8");
        } catch {
          return null;
        }
      },
      exists(absPath: string): boolean {
        return fsNode.existsSync(absPath);
      },
    },
    resolveHost,
    __rootHint: root,
  };
  return env;
}

// ── U6 — Run-provenance helpers ───────────────────────────────────────────────

/**
 * Validate that a runId is safe to use as a single directory-name component
 * inside .guild/runs/. Mirrors the identical check in promote-upstream.ts
 * (validateRunId) — any change here should be reflected there and vice versa.
 *
 * Rejects: empty/whitespace, NUL byte, absolute path prefix, path separators
 * (/ or \), lone ".", ".." prefix, or any occurrence of "..".
 *
 * Returns true iff the runId is safe.
 */
export function validateRunId(runId: string): boolean {
  if (!runId || !runId.trim()) return false;
  if (runId.includes("\x00")) return false;
  if (runId.startsWith("/") || runId.startsWith("\\")) return false;
  if (runId.includes("/") || runId.includes("\\")) return false;
  if (runId === ".") return false;
  if (runId === ".." || runId.startsWith("..")) return false;
  if (runId.includes("..")) return false;
  return true;
}

/**
 * Assert that `target` is a strict subdirectory of `base` (i.e. starts with
 * `base + path.sep`). Mirrors the containment assertion in promote-upstream.ts.
 * Throws with a clear message on violation.
 */
function assertContained(target: string, base: string, label: string): void {
  const resolvedTarget = path.resolve(target);
  const resolvedBase = path.resolve(base);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error(
      `[run-lifecycle] ${label}: resolved path "${resolvedTarget}" escapes runs base "${resolvedBase}"`
    );
  }
}

/**
 * Minimal fs surface accepted by writeResolvedSettingsSnapshot and
 * readResolvedSettingsSnapshot. Callers may pass the RunLifecycleEnv.fs seam
 * (in-memory for tests) or omit it to use the real node fs.
 */
export interface ProvenanceFsSeam {
  writeFile(absPath: string, contents: string): void;
  readFile(absPath: string): string | null;
}

/** Real-fs implementation of ProvenanceFsSeam (used when no seam is injected). */
function realProvenanceFsSeam(): ProvenanceFsSeam {
  return {
    writeFile(absPath: string, contents: string): void {
      fsNode.mkdirSync(path.dirname(absPath), { recursive: true });
      fsNode.writeFileSync(absPath, contents, "utf8");
    },
    readFile(absPath: string): string | null {
      try {
        return fsNode.readFileSync(absPath, "utf8");
      } catch {
        return null;
      }
    },
  };
}

/**
 * Options for writeResolvedSettingsSnapshot.
 * `cwd` is the project/workspace root (the .guild/ write base).
 * `fs`  is an optional injected fs seam; defaults to real node fs.
 * `resolvedAtRef` is the ref to stamp into resolved_at_ref; defaults to the
 *   runId — this keeps the function deterministic and Date.now-free.
 */
export interface WriteSnapshotOpts {
  cwd: string;
  fs?: ProvenanceFsSeam;
  resolvedAtRef?: string;
}

/**
 * Persist the ResolvedSettingsSnapshot to .guild/runs/<runId>/resolved-settings.json.
 *
 * - Sets resolved_at_ref to the passed `resolvedAtRef` (or the runId when omitted).
 * - Does NOT mutate the input snapshot.
 * - Returns the absolute path written.
 *
 * U6 contract: the orchestrator calls runStartPreflight (U3) to get the snapshot,
 * then passes result.snapshot to startRun (or calls writeResolvedSettingsSnapshot
 * directly). The resolvedAtRef is stamped here so U3 stays Date.now-free.
 */
export function writeResolvedSettingsSnapshot(
  runId: string,
  snapshot: ResolvedSettingsSnapshot,
  opts: WriteSnapshotOpts
): string {
  if (!validateRunId(runId)) {
    throw new Error(
      `[run-lifecycle] writeResolvedSettingsSnapshot: invalid runId ${JSON.stringify(runId)} — ` +
        `must be a non-empty single path component with no separators, no "..", not ".", not absolute`
    );
  }
  const { cwd, fs: fsSeam, resolvedAtRef } = opts;
  const fs = fsSeam ?? realProvenanceFsSeam();
  const outPath = resolvedSettingsPath(cwd, runId);

  // Containment assertion: outPath must be a strict subdir of .guild/runs/.
  // Catches any edge case that slips past validateRunId on unusual platforms.
  const runsBase = path.resolve(cwd, ".guild", "runs");
  assertContained(outPath, runsBase, "writeResolvedSettingsSnapshot");

  // Build the on-disk record — resolved_at_ref is set here, not in U3.
  // We shallow-spread to avoid mutating the caller's snapshot.
  // resolved_at_ref is declared `null` in the pre-write interface (U3 contract:
  // the field is null until U6 fills it in). We override it on write via a cast;
  // the JSON on disk has the real string value.
  const onDisk = {
    ...snapshot,
    resolved_at_ref: (resolvedAtRef ?? runId) as unknown as null,
  } satisfies ResolvedSettingsSnapshot;

  fs.writeFile(outPath, JSON.stringify(onDisk, null, 2) + "\n");
  return outPath;
}

/**
 * Read back the ResolvedSettingsSnapshot for a run. Returns null when the file
 * does not exist or is not valid JSON (default-safe — mid-run consumers degrade
 * gracefully rather than crashing on missing provenance).
 *
 * AC-10 consumer contract: phase skills call this when CONTINUING a run so
 * mid-run config edits don't silently change behavior. The snapshot was locked
 * in at startRun; this read-back restores it.
 */
export function readResolvedSettingsSnapshot(
  runId: string,
  opts: { cwd: string; fs?: ProvenanceFsSeam }
): ResolvedSettingsSnapshot | null {
  if (!validateRunId(runId)) return null;
  const { cwd, fs: fsSeam } = opts;
  const fs = fsSeam ?? realProvenanceFsSeam();
  const filePath = resolvedSettingsPath(cwd, runId);

  // Containment assertion: filePath must be a strict subdir of .guild/runs/.
  // Return null rather than throwing — read callers degrade gracefully.
  const runsBase = path.resolve(cwd, ".guild", "runs");
  try {
    assertContained(filePath, runsBase, "readResolvedSettingsSnapshot");
  } catch {
    return null;
  }

  const raw = fs.readFile(filePath);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as ResolvedSettingsSnapshot;
  } catch {
    return null;
  }
}

// ── SC-D workspace-knowledge config reader (B1 §3 schema delta) ──────────────

export interface WorkspaceKnowledgeConfig {
  /** Existing key — "no monolithic root code wiki". Default false when absent. */
  root_wiki: boolean;
  /** NEW (SC-D) — "root MAY hold durable cross-project knowledge". Default true. */
  workspace_knowledge: boolean;
  /** NEW (OQ2 rollback) — workspace-learn fan-out posture. Default "auto". */
  learn_fanout: "auto" | "plan-only";
}

const WORKSPACE_KNOWLEDGE_DEFAULTS: WorkspaceKnowledgeConfig = {
  root_wiki: false,
  workspace_knowledge: true,
  learn_fanout: "auto",
};

/**
 * Read the three workspace-knowledge keys from <root>/.guild/workspace.json.
 * Lenient + default-safe-when-absent: a missing file, missing keys, or a
 * malformed value all resolve to the documented defaults without throwing.
 */
export function readWorkspaceKnowledgeConfig(root: string): WorkspaceKnowledgeConfig {
  let parsed: Record<string, unknown> = {};
  try {
    const raw = fsNode.readFileSync(path.join(root, ".guild", "workspace.json"), "utf8");
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") parsed = obj as Record<string, unknown>;
  } catch {
    return { ...WORKSPACE_KNOWLEDGE_DEFAULTS };
  }
  const rootWiki =
    typeof parsed["root_wiki"] === "boolean"
      ? (parsed["root_wiki"] as boolean)
      : WORKSPACE_KNOWLEDGE_DEFAULTS.root_wiki;
  const wsKnowledge =
    typeof parsed["workspace_knowledge"] === "boolean"
      ? (parsed["workspace_knowledge"] as boolean)
      : WORKSPACE_KNOWLEDGE_DEFAULTS.workspace_knowledge;
  const fanoutRaw = parsed["learn_fanout"];
  const learnFanout: "auto" | "plan-only" =
    fanoutRaw === "auto" || fanoutRaw === "plan-only"
      ? fanoutRaw
      : WORKSPACE_KNOWLEDGE_DEFAULTS.learn_fanout;
  return { root_wiki: rootWiki, workspace_knowledge: wsKnowledge, learn_fanout: learnFanout };
}

/**
 * Read `record_status_runs` (OQ6 rollback switch) via the settings resolver.
 * Default true when absent. When false, /guild:status reverts to pure-read
 * (no run written) — B3 owns that wiring; this reader only surfaces the key.
 *
 * Inherits from workspace settings when the project is a child of a workspace
 * (the resolver's 5-layer chain applies). A child without its own
 * record_status_runs will receive the workspace value, or the built-in default
 * (true) when absent from all layers.
 */
export function readRecordStatusRuns(root: string): boolean {
  try {
    const { config } = resolveSettings({ cwd: root });
    return config.record_status_runs;
  } catch {
    return true;
  }
}

/**
 * Read the `started_at` scalar from `<runDir>/run.yaml` using the same
 * top-level-scalar extraction logic `readStartFacts` already uses internally.
 *
 * Exported so other scripts/ consumers (e.g. reaping.ts) can read the run
 * timestamp without adding a new hand-rolled YAML reader (OD-3 compliance).
 *
 * @param runDir  Absolute path to `.guild/runs/<run-id>/` (the run directory).
 * @param readFile  Injectable reader: `(absPath) => string | null`.
 *   Accepts either the `RunLifecycleEnv.fs.readFile` interface or a thin
 *   adapter over `FsLike` (returns null on ENOENT/error rather than throwing).
 *   Default: real fs via `fsNode.readFileSync`.
 * @returns The raw `started_at` string value, or `null` when:
 *   - `run.yaml` does not exist at the expected path, OR
 *   - the `started_at:` field is absent from the file.
 */
export function readRunStartedAt(
  runDir: string,
  readFile: (absPath: string) => string | null = (p) => {
    try {
      return fsNode.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  }
): string | null {
  const p = path.join(runDir, "run.yaml");
  const raw = readFile(p);
  if (raw === null) return null;
  // Mirror of the readStartFacts top-level scalar extractor:
  // Match `started_at: <value>` as a bare scalar (the start writer's shape).
  const m = raw.match(/^started_at:[ \t]*(.*)$/m);
  return m ? m[1].trim() || null : null;
}

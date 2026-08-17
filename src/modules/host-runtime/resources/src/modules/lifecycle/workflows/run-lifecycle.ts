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

import { checkContained, isRefused, isWithin } from "../../kernel";
import type { HostKind } from "../../host-runtime";
import {
  buildSessionContext,
  writeSessionContext,
  type ExecutionTargetBlock,
  type HostHandshakeIdentity,
  type NativeAdapterIdentity,
} from "../../host-runtime";
import { resolveSettings } from "../../config";
import { parseYaml, replaceTopLevelLine, resolveGuildRoot } from "../../state";
import { assertWritableBinding, closeRunBinding, mintRunBinding } from "./run-binding";
import type { ResolvedSettingsSnapshot } from "./runstart-preflight";
import { scrubbedWrite, type ScrubbedWriteResult, type ScrubSurface } from "../../security";
import { emitTraceEvent, makeAnalysisTraceEvent, type GuildTraceAnalysisV2 } from "../../telemetry";

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
    /**
     * HK-06: scrub-then-write for the provenance.json durable surface.
     * When present, `closeRun` uses this INSTEAD of `writeFile` for provenance.
     * Fail-CLOSED: on scrub failure the file MUST NOT land on disk.
     * Tests inject a fake (`{ written: false, blocked: true }` to force-fail).
     * Real env: wired to `scrubbedWrite(surface:"provenance", ...)` from
     * hooks/lib/security/scrubbed-write.
     */
    scrubbedWriteDurable?(
      outPath: string,
      contents: string,
      surface: ScrubSurface,
      runDir: string,
      runId: string,
    ): ScrubbedWriteResult;
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
  /** Optional behavior-neutral semantic trace seam; the real adapter appends to the canonical log. */
  emitAnalysisEvent?(event: GuildTraceAnalysisV2, runDir: string): boolean;
}

// ── Public types (B1 §4) ─────────────────────────────────────────────────────

export type TargetKind =
  | "regular_project"
  | "workspace"
  | "existing_guild_project"
  | "new_or_sparse_project"
  | "mixed_or_uncertain";

export type RunClass = "full" | "lightweight";
export type RunScope = "initiative" | "independent";
export type AttachmentSource = "user_selected" | "inferred" | "resumed" | "independent" | "command_created";
export type AttachmentConfidence = "low" | "medium" | "high";

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
  /** Minimal grouping key for a non-initiative run; defaults to the derived run slug. */
  independent_run_group?: string | null;
  /** Run-relative pointer to the redacted/frozen entry prompt payload, when retained. */
  entry_prompt_ref?: string | null;
  /** Why the initiative/independent attachment was selected. */
  attachment_source?: AttachmentSource;
  /** Confidence of an inferred attachment; explicit selections default high. */
  attachment_confidence?: AttachmentConfidence;
  /** Immutable plugin build identity supplied by the invoking adapter. */
  plugin_identity?: {
    version: string;
    ref: string;
    command_surface_version?: string;
  };
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
  /**
   * T3 (guild.session_context.v1): adapter-injected identity inputs for the
   * run's immutable session context. When absent, the context records the
   * honest terminal `unknown` identity (§3) — it NEVER defaults to claude.
   */
  session_identity?: {
    envelope_host?: string;
    env?: Record<string, string | undefined>;
    native_adapter?: NativeAdapterIdentity | null;
    handshake?: HostHandshakeIdentity | null;
    execution_target?: Partial<ExecutionTargetBlock>;
    active_model?: string | null;
  };
}

/** What closeRun records into provenance.json (caller assembles touched-facts). */
export interface CloseRunOpts {
  /** Terminal status. */
  status: TerminalStatus;
  /**
   * T3 (guild.session_context.v1 §5, rework F2): the run's minted binding
   * nonce — REQUIRED. Every close is FULLY verified (fail closed on
   * absent/malformed/not-minted/closed/mismatch). There is no "fresh run" or
   * legacy exemption: a caller that cannot present the nonce is refused.
   */
  binding_ref: string;
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
function pluginConfigSnapshotPath(root: string, runId: string): string {
  return path.join(runDir(root, runId), "plugin-config-snapshot.json");
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

/**
 * The one creation-time run-id contract. A canonical id is date-first so
 * lexical directory order is chronological and always carries a non-empty
 * semantic slug.
 */
const CANONICAL_RUN_ID_RE = /^run-(\d{8})-(\d{6})-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/;

export function isCanonicalRunId(runId: string): boolean {
  const match = CANONICAL_RUN_ID_RE.exec(runId);
  if (!match) return false;
  const [, date, time] = match;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const second = Number(time.slice(4, 6));
  const stamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return stamp.getUTCFullYear() === year
    && stamp.getUTCMonth() === month - 1
    && stamp.getUTCDate() === day
    && stamp.getUTCHours() === hour
    && stamp.getUTCMinutes() === minute
    && stamp.getUTCSeconds() === second;
}

export function assertCanonicalRunId(runId: string): string {
  if (!isCanonicalRunId(runId)) {
    throw new Error(
      `canonical run id required (run-<yyyymmdd-hhmmss>-<slug>); received ${JSON.stringify(runId)}`,
    );
  }
  return runId;
}

function runSlug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

function deriveRunSlug(opts: StartRunOpts): string {
  const brief = typeof opts.arguments["brief"] === "string"
    ? opts.arguments["brief"] as string
    : "";
  const command = opts.command.replace(/^\/?guild:/, "");
  for (const candidate of [opts.initiative ?? "", brief, command, opts.project]) {
    const slug = runSlug(candidate);
    if (slug) return slug;
  }
  // A UUID is deliberately the final semantic fallback, never the whole id.
  return crypto.randomUUID();
}

/** Shared formatter for lifecycle creation and degraded read-only hook lookup. */
export function makeCanonicalRunId(nowIso: string, slugSource: string): string {
  const slug = runSlug(slugSource) || crypto.randomUUID();
  return assertCanonicalRunId(`run-${utcCompact(nowIso)}-${slug}`);
}

function makeRunId(opts: StartRunOpts, nowIso: string): string {
  return makeCanonicalRunId(nowIso, deriveRunSlug(opts));
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

function buildRunManifest(
  opts: StartRunOpts,
  runId: string,
  env: RunLifecycleEnv,
  written: { resolvedSettings: boolean; pluginConfig: boolean },
): Record<string, unknown> {
  const host = env.resolveHost(opts.host_requested);
  const runClass: RunClass = opts.run_class ?? "full";
  const runScope: RunScope = opts.initiative ? "initiative" : "independent";
  const independentGroup = runScope === "independent"
    ? (opts.independent_run_group?.trim() || deriveRunSlug(opts))
    : null;
  const attachmentSource: AttachmentSource = opts.attachment_source ??
    (runScope === "initiative" ? "user_selected" : "independent");

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
    run_scope: runScope,
    initiative_attachment: opts.initiative, // NN#5: scalar record ONLY
    independent_run_group: independentGroup,
    entry_prompt_ref: opts.entry_prompt_ref ?? null,
    config_snapshot_ref: written.pluginConfig ? "plugin-config-snapshot.json" : null,
    attachment_resolution: {
      scope: runScope,
      initiative_id: opts.initiative,
      independent_group_id: independentGroup,
      source: attachmentSource,
      confidence: opts.attachment_confidence ?? (attachmentSource === "inferred" ? "medium" : "high"),
    },
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
  if (opts.snapshot && written.resolvedSettings) {
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
  // Parse run.yaml via the shared js-yaml parser (OD-3). `get` String()-coerces
  // each top-level scalar (null when absent), matching the old raw-text shape;
  // the normalisation below (initiative_attachment "null"→null, run_class
  // default) is unchanged and absorbs js-yaml's typing.
  const doc = parseYaml(raw);
  const obj =
    doc !== null && typeof doc === "object" && !Array.isArray(doc)
      ? (doc as Record<string, unknown>)
      : {};
  const get = (key: string): string | null => {
    const v = obj[key];
    return v === undefined || v === null ? null : String(v);
  };
  const command = get("command") ?? "";
  const initRaw = get("initiative_attachment");
  const initiative = initRaw === null || initRaw === "null" || initRaw === "" ? null : initRaw;
  const runClassRaw = get("run_class");
  const run_class: RunClass = runClassRaw === "lightweight" ? "lightweight" : "full";
  const started_at = get("started_at") ?? "";
  const self_build = obj["self_build"] === true;
  return { command, initiative, run_class, started_at, self_build };
}

/** Rewrite run.yaml's top-level `status:` line in place to the terminal value. */
function flipRunStatus(env: RunLifecycleEnv, root: string, runId: string, status: TerminalStatus): void {
  const p = runYamlPath(root, runId);
  const raw = env.fs.readFile(p);
  if (raw === null) return;
  // Byte-preserving single-line rewrite via the shared helper (OD-3) — swaps
  // only the top-level `status:` line, every other byte untouched.
  const next = replaceTopLevelLine(raw, "status", `status: ${status}`).text;
  env.fs.writeFile(p, next);
}

// ── T0 (G-PHASE-COMPOSE): full-run phase recording ───────────────────────────
//
// The canonical lifecycle phase set. A token outside this set is REJECTED by
// appendPhase (and the T1 team-file builders) so a bad phase can never become a
// phases_log entry or a `<slug>.<phase>.yaml` filename segment. Shared constant —
// every lane that touches a phase token imports it (G-plan MAJOR-3 / §6.9).
export const CANONICAL_PHASES = Object.freeze(["init", "ideate", "plan", "build", "qa", "ops"] as const);
export type CanonicalPhase = (typeof CANONICAL_PHASES)[number];

/** True iff `p` is one of the six canonical lifecycle phases. */
export function isCanonicalPhase(p: string): p is CanonicalPhase {
  return (CANONICAL_PHASES as readonly string[]).includes(p);
}

/**
 * Append a phase entry to run.yaml's `phases_log` AND rewrite the top-level
 * `phase:` line, in place — the same atomic line-rewrite posture as flipRunStatus.
 *
 * ADDITIVE: `phase`/`phases_log` are not read by readStartFacts or closeRun, so
 * this is side-effect-free for existing close logic — the fields THEY read are
 * byte-unchanged. Validates `phase` against CANONICAL_PHASES; a non-canonical
 * token is REJECTED (no write, returns false) — never silently filed. A missing/
 * corrupt run.yaml is a no-op (returns false; never throws).
 *
 * @returns true iff a phase entry was recorded.
 */
export function appendPhase(
  env: RunLifecycleEnv,
  root: string,
  runId: string,
  phase: string,
): boolean {
  if (!isCanonicalPhase(phase)) return false; // reject — never write a bad token
  const p = runYamlPath(root, runId);
  const raw = env.fs.readFile(p);
  if (raw === null) return false; // missing/corrupt → no-op
  const at = env.now();

  // 1. Rewrite the top-level `phase:` scalar (tolerate its absence on old
  //    manifests). The shared helper matches `phase:` at column 0 only — it
  //    cannot match `phases_log:` ("phase:" ≠ "phases…") nor an indented block
  //    item ("  - phase:"). A no-op (returns the text unchanged) when absent.
  let next = replaceTopLevelLine(raw, "phase", `phase: ${phase}`).text;

  // 2. Append a { phase, at } entry to the phases_log block.
  next = appendToPhasesLog(next, phase, at);
  env.fs.writeFile(p, next);
  return true;
}

/**
 * Insert a `{ phase, at }` item into run.yaml's `phases_log` via targeted line
 * surgery (no full YAML parse — preserves every other field byte-for-byte, same
 * principle as flipRunStatus). Handles the empty-inline form (`phases_log: []`),
 * the block form, and the (defensive) missing-key case.
 */
function appendToPhasesLog(raw: string, phase: string, at: string): string {
  const lines = raw.split("\n");
  const itemLines = [`  - phase: ${phase}`, `    at: ${at}`];
  // Column-0 `phases_log:` key (startsWith excludes indented block items, same
  // as the old `^phases_log:` anchor — no OD-3 key-regex literal).
  const idx = lines.findIndex((l) => l.startsWith("phases_log:"));

  if (idx === -1) {
    // No phases_log key (older manifest) — append a fresh block before the trailing
    // empty line the serializer leaves (raw ends with "\n").
    const insertAt =
      lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    lines.splice(insertAt, 0, "phases_log:", ...itemLines);
    return lines.join("\n");
  }

  if (lines[idx].slice("phases_log:".length).trim() === "[]") {
    // Empty inline `[]` → convert to a block carrying the first item.
    lines.splice(idx, 1, "phases_log:", ...itemLines);
    return lines.join("\n");
  }

  // Block form: the array items are the indented, non-empty lines after the key.
  // The block ends at the first column-0 line (next top-level key, e.g. settings_ref:)
  // or a blank line (the serializer's trailing "") or EOF. Insert before that.
  let end = idx + 1;
  while (end < lines.length && /^\s/.test(lines[end]) && lines[end].trim() !== "") {
    end++;
  }
  lines.splice(end, 0, ...itemLines);
  return lines.join("\n");
}

// ── Factory ────────────────────────────────────────────────────────────────────

/** Factory the entrypoints call; pass createRealEnv() for the real-fs default. */
export function createRunLifecycle(env: RunLifecycleEnv): RunLifecycle {
  return {
    startRun(opts: StartRunOpts): string {
      const nowIso = env.now();
      const preferredRunId = makeRunId(opts, nowIso);
      const root = opts.root;
      // Canonical IDs are second-granularity by contract. Concurrent/repeated
      // starts with the same semantic slug must never collide or rebind an
      // existing run, so a UUID tail is used only for this last-resort case.
      const runId = env.fs.exists(runDir(root, preferredRunId))
        ? makeCanonicalRunId(nowIso, `${deriveRunSlug(opts)}-${crypto.randomUUID()}`)
        : preferredRunId;

      // guild.session_context.v1 §5 (rework F2): mint the run's binding FIRST —
      // before ANY other write lands under the run dir. Run start mints the
      // binding before any write; there is no window in which run records
      // exist without a verifiable binding. The nonce is revoked at close.
      const binding = mintRunBinding({ root, run_id: runId, fs: env.fs });

      // logs/ dir (mkdirp also ensures runs/<id>/ exists). NN#5: we touch ONLY
      // .guild/runs/<id>/ — never .guild/initiatives/.
      env.fs.mkdirp(logsDir(root, runId));

      // U6: write resolved-settings.json BEFORE run.yaml so the file is on disk
      // before any consumer might read it. When no snapshot, skip (back-compat).
      let resolvedSettingsWritten = false;
      let pluginConfigWritten = false;
      if (opts.snapshot) {
        writeResolvedSettingsSnapshot(runId, opts.snapshot, {
          cwd: root,
          fs: env.fs,
          // Use the run-id as the resolved_at_ref (deterministic, no Date.now).
          resolvedAtRef: runId,
        });
        resolvedSettingsWritten = env.fs.exists(resolvedSettingsPath(root, runId));
        writePluginConfigSnapshot(runId, opts.snapshot, opts, env);
        pluginConfigWritten = env.fs.exists(pluginConfigSnapshotPath(root, runId));
      }

      // run.yaml (guild.run.v1) — the single start manifest.
      const manifest = buildRunManifest(opts, runId, env, {
        resolvedSettings: resolvedSettingsWritten,
        pluginConfig: pluginConfigWritten,
      });
      env.fs.writeFile(runYamlPath(root, runId), serializeRunYaml(manifest));

      // §1: the immutable session context — written once at start, restored
      // verbatim on resume. Identity comes from the adapter-injected inputs;
      // absent inputs record the honest terminal `unknown` (§3), never a
      // claude default.
      const identity = opts.session_identity ?? {};
      writeSessionContext(
        root,
        buildSessionContext({
          run_id: runId,
          started_at: env.now(),
          envelope_host: identity.envelope_host,
          env: identity.env,
          native_adapter: identity.native_adapter,
          handshake: identity.handshake,
          execution_target: identity.execution_target,
          active_model: identity.active_model,
          run_binding: { binding_ref: binding.binding_ref, state: binding.state },
        }),
        env.fs
      );

      // current-run-id sentinel — interactive command intake ONLY (§5): it may
      // locate a candidate run for a user-typed command; it never authorizes a
      // write and never serves as a fallback binding.
      env.fs.writeFile(sentinelPath(root), runId);

      // RTE P2: semantic lifecycle identity events are additive and
      // behavior-neutral. Test/embedded adapters may omit the seam; the real
      // adapter appends validated events to the canonical v1.4 log.
      if (env.emitAnalysisEvent) {
        const runScope: RunScope = opts.initiative ? "initiative" : "independent";
        const independentGroup = runScope === "independent"
          ? (opts.independent_run_group?.trim() || deriveRunSlug(opts))
          : null;
        const eventBase = {
          ts: env.now(),
          run_id: runId,
          lane_id: "",
          actor_type: "system" as const,
          actor_id: "run-lifecycle",
          status: "ok" as const,
          initiative_id: opts.initiative ?? undefined,
          run_scope: runScope,
          config_snapshot_ref: pluginConfigWritten ? "plugin-config-snapshot.json" : undefined,
        };
        env.emitAnalysisEvent(makeAnalysisTraceEvent({ ...eventBase, event_class: "run_started" }), runDir(root, runId));
        env.emitAnalysisEvent(
          makeAnalysisTraceEvent({
            ...eventBase,
            event_class: "run_attachment_resolved",
            signature: `${runScope}:${opts.initiative ?? independentGroup}`,
          }),
          runDir(root, runId),
        );
        if (pluginConfigWritten) {
          env.emitAnalysisEvent(
            makeAnalysisTraceEvent({
              ...eventBase,
              event_class: "config_snapshot_written",
              payload_ref: "plugin-config-snapshot.json",
              redaction: "redacted",
            }),
            runDir(root, runId),
          );
        }
      }

      return runId;
    },

    closeRun(runId: string, opts: CloseRunOpts): void {
      // The .guild/ base is inferred from cwd: closeRun is called from the run's
      // root, so resolve runs/<id> relative to process cwd's nearest .guild base.
      // We reconstruct root by reading the run.yaml under the same base the
      // caller's env.fs sees; the real adapter is rooted at the project root.
      const root = resolveCloseRoot(env);

      // §5 fail-closed gate (rework F2): the caller-threaded nonce is ALWAYS
      // fully verified — absent, malformed, not-minted, closed, or mismatched
      // bindings all throw BindingRejectedError before any mutation. No
      // migration posture (fresh-run, open-unreferenced, legacy) authorizes a
      // close: a legacy run is migrated (mint via run start tooling) or refused.
      assertWritableBinding({ root, run_id: runId, binding_ref: opts.binding_ref, fs: env.fs });

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

      // HK-06: route provenance.json through scrubbedWrite (fail-CLOSED).
      // When the seam is absent (legacy / test env without HK-06), fall through
      // to the generic writeFile (backward compat — no existing test breaks).
      const provPath = provenancePath(root, runId);
      const provenanceContent = JSON.stringify(provenance, null, 2) + "\n";
      if (env.fs.scrubbedWriteDurable) {
        const runDir = path.join(root, ".guild", "runs", runId);
        const result = env.fs.scrubbedWriteDurable(provPath, provenanceContent, "provenance", runDir, runId);
        if (result.blocked) {
          process.stderr.write(
            `[run-lifecycle] WARN: provenance.json write BLOCKED by secret scrub ` +
              `(fail-CLOSED) for run ${runId}. Security event emitted.\n`,
          );
        }
      } else {
        env.fs.writeFile(provPath, provenanceContent);
      }

      // Flip run.yaml.status to the terminal value.
      flipRunStatus(env, root, runId, opts.status);

      // §5: revoke the binding at run close — post-close writes fail closed.
      closeRunBinding({ root, run_id: runId, fs: env.fs });
      // G5(a) (v23x-deferred-followups rf-wi-05, origin oir-wi-58): clear the
      // current-run-id sentinel IFF it still points at the run being closed.
      // Before this, closeRun never touched the sentinel — every one of its
      // readers (capture-telemetry.ts, pre-tool-use.ts, pre-compact.ts,
      // post-tool-use.ts, reanchor.ts, lifecycle-gate.ts) had to independently
      // reimplement a "prove freshness" workaround because a CLOSED run's id
      // stayed armed until the NEXT startRun overwrote it. Every sentinel
      // reader already treats an empty/whitespace-only file identically to a
      // missing one (`value.length > 0 ? value : undefined`), so writing ""
      // is a safe, effective clear — no reader needs to change.
      // Guarded on identity so an out-of-order close (closing an OLDER run
      // while a NEWER one is current) can never clobber the newer sentinel.
      const sp = sentinelPath(root);
      const currentSentinel = env.fs.readFile(sp);
      if (currentSentinel !== null && currentSentinel.trim() === runId) {
        env.fs.writeFile(sp, "");
      }
      if (env.emitAnalysisEvent) {
        env.emitAnalysisEvent(
          makeAnalysisTraceEvent({
            ts: now,
            run_id: runId,
            lane_id: "",
            event_class: "run_closed",
            actor_type: "system",
            actor_id: "run-lifecycle",
            run_scope: facts.initiative ? "initiative" : "independent",
            initiative_id: facts.initiative ?? undefined,
            status: opts.status === "closed" ? "ok" : "incomplete",
          }),
          runDir(root, runId),
        );
      }
    },
  };
}

/**
 * closeRun resolves the run's root by walking the real-fs adapter's base. For
 * the real adapter (createRealEnv) the base is fixed at construction; for the
 * in-memory test adapter the absolute run path is reconstructed from the
 * sentinel. We delegate to an env-provided root when present, else fall back
 * to `resolveGuildRoot(process.cwd())` — the only candidate root available
 * without a hint.
 *
 * FIX (dead conditional): this used to end with
 * `if (env.fs.exists(runYamlPath(cwd, runId))) return cwd; return cwd;` —
 * both branches returned the identical value, so the existence check was
 * pure dead code. There is only one fallback candidate (there is nothing to
 * branch to), and `readStartFacts` — called immediately after this — already
 * throws a clear, specific error when `run.yaml` is absent at the resolved
 * root, so no informational value was lost by dropping the check.
 *
 * The real-fs env stamps `__rootHint` so close finds the same base start used.
 */
function resolveCloseRoot(env: RunLifecycleEnv): string {
  const hint = (env as RunLifecycleEnv & { __rootHint?: string }).__rootHint;
  if (hint) return hint;
  // Walk up from process.cwd() to the nearest .git/.guild anchor so a
  // sub-directory cwd can never resolve to a nested .guild/ base.
  // Decision: .guild/wiki/decisions/telemetry-anchors-to-repo-root-not-cwd.md
  return resolveGuildRoot(process.cwd());
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
      // HK-06: real scrubbedWrite wired for provenance.json (fail-CLOSED).
      scrubbedWriteDurable(
        outPath: string,
        contents: string,
        surface: ScrubSurface,
        runDir: string,
        runId: string,
      ): ScrubbedWriteResult {
        return scrubbedWrite(outPath, contents, { surface, runDir, runId });
      },
    },
    resolveHost,
    emitAnalysisEvent: (event, activeRunDir) => emitTraceEvent(event, activeRunDir),
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
 * Assert that `target` is a strict subdirectory of `base`.
 *
 * MIGRATED to the shared path-containment primitive, and this one was a real
 * defect rather than a tidy-up. The version here was PURELY LEXICAL —
 * `path.resolve` plus `startsWith(base + path.sep)` — which is string algebra and
 * knows nothing about symlinks: a symlinked `.guild/runs` walked straight through
 * it while it reported success, guarding a `mkdirSync` + write. That is exactly the
 * defect the resolver lane rated CRITICAL, sitting in a tenth home nobody had swept.
 *
 * It was found by the rail's `lexical-guard` signal, which exists precisely for
 * this: the climb and bounded-write signals find code someone has ALREADY fixed
 * once (reaching for `realpath` means they already knew). A purely lexical guard is
 * the state BEFORE anyone knows.
 *
 * `policy: "physical"` matches this file's contract: a run tree whose realpath is
 * load-bearing provenance must be physically real.
 */
function assertContained(target: string, cwd: string, label: string): void {
  // THE ROOT IS THE PROJECT ROOT, NOT THE RUNS BASE — and the difference is the
  // whole of task #33.
  //
  // Passing `runsBase` made `.guild/runs` the primitive's ROOT, and the primitive
  // permits its own root to be a symlink (it is resolved separately, so its
  // link-ness is already accounted for). So `.guild/runs -> /elsewhere` was
  // ACCEPTED here while `station-signals.ts` and `promote-upstream.ts` refused the
  // identical shape. Two peer writers into one run tree, two strictnesses.
  //
  // THE DECISION, AND THE EVIDENCE FOR IT. `station-signals.ts` has refused a
  // symlinked `.guild`, `.guild/runs`, run root and kind dir since before any of
  // this migration, deliberately and with its reason written down: a bare
  // `mkdirSync(runsContainer, {recursive:true})` follows the link and "makes the
  // external target the authoritative realpath". Run records are provenance, and
  // provenance whose location is redirectable is not provenance.
  //
  // `run-lifecycle.ts` and `promote-upstream.ts` were both purely LEXICAL before
  // migration — blind to symlinks, neither permitting nor refusing. So the
  // permissive reading here was never a contract this file kept; it was an artifact
  // of the root I chose while migrating it. One writer thought about this and
  // refused; two were blind. The considered answer wins.
  const r = checkContained(cwd, target, { policy: "physical" });
  if (isRefused(r)) {
    throw new Error(
      `[run-lifecycle] ${label}: resolved path "${path.resolve(target)}" escapes the ` +
        `project root "${path.resolve(cwd)}" [${r.code}] — ${r.detail}`
    );
  }
  // The original also required a STRICT subdirectory of the RUNS BASE — which is
  // now a different path from the containment root, so it is spelled explicitly.
  // Containment permits equality; this rule does not.
  const runsBase = path.resolve(cwd, ".guild", "runs");
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === runsBase || !isWithin(resolvedTarget, runsBase)) {
    throw new Error(
      `[run-lifecycle] ${label}: resolved path "${resolvedTarget}" is not a strict ` +
        `subdirectory of the runs base "${runsBase}"`
    );
  }
}

/**
 * Minimal fs surface accepted by writeResolvedSettingsSnapshot and
 * readResolvedSettingsSnapshot. Callers may pass the RunLifecycleEnv.fs seam
 * (in-memory for tests) or omit it to use the real node fs.
 *
 * NOTE: mirrors the `scrubbedWriteDurable?` on RunLifecycleEnv.fs so that
 * startRun can pass `env.fs` directly — createRealEnv wires that field, which
 * means the resolved-settings.json write is scrubbed on the REAL start-run path.
 */
export interface ProvenanceFsSeam {
  writeFile(absPath: string, contents: string): void;
  readFile(absPath: string): string | null;
  /**
   * HK-06: scrub-then-write for provenance-class files (resolved-settings.json).
   * When present, `writeResolvedSettingsSnapshot` uses this INSTEAD of `writeFile`.
   * Fail-CLOSED: on scrub failure the file MUST NOT land on disk.
   * Signature mirrors RunLifecycleEnv.fs.scrubbedWriteDurable so startRun can
   * pass env.fs directly (createRealEnv already wires this field).
   * Tests inject a fake; real seam wires the real `scrubbedWrite`.
   */
  scrubbedWriteDurable?(
    outPath: string,
    contents: string,
    surface: ScrubSurface,
    runDir: string,
    runId: string,
  ): ScrubbedWriteResult;
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
    // HK-06: real scrubbed write wired for resolved-settings.json (fail-CLOSED).
    scrubbedWriteDurable(outPath: string, contents: string, surface: ScrubSurface, runDir: string, runId: string): ScrubbedWriteResult {
      return scrubbedWrite(outPath, contents, { surface, runDir, runId });
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
  assertContained(outPath, cwd, "writeResolvedSettingsSnapshot");

  // Build the on-disk record — resolved_at_ref is set here, not in U3.
  // We shallow-spread to avoid mutating the caller's snapshot.
  // resolved_at_ref is declared `null` in the pre-write interface (U3 contract:
  // the field is null until U6 fills it in). We override it on write via a cast;
  // the JSON on disk has the real string value.
  const onDisk = {
    ...snapshot,
    resolved_at_ref: (resolvedAtRef ?? runId) as unknown as null,
  } satisfies ResolvedSettingsSnapshot;

  const serialized = JSON.stringify(onDisk, null, 2) + "\n";
  // HK-06: route resolved-settings.json through scrubbedWrite.
  // Uses scrubbedWriteDurable (same seam as RunLifecycleEnv.fs + createRealEnv),
  // so the real start-run path IS scrubbed — not just injected-seam tests.
  if (fs.scrubbedWriteDurable) {
    const runDir = path.join(cwd, ".guild", "runs", runId);
    const result = fs.scrubbedWriteDurable(outPath, serialized, "config", runDir, runId);
    if (result.blocked) {
      process.stderr.write(
        `[run-lifecycle] WARN: resolved-settings.json write BLOCKED by secret scrub ` +
          `(fail-CLOSED) for run ${runId}. Security event emitted.\n`,
      );
    }
  } else {
    fs.writeFile(outPath, serialized);
  }
  return outPath;
}

function hashOptionalFile(env: RunLifecycleEnv, file: string): string | null {
  const raw = env.fs.readFile(file);
  return raw === null ? null : crypto.createHash("sha256").update(raw).digest("hex");
}

function derivePluginIdentity(start: StartRunOpts, env: RunLifecycleEnv): {
  version: string;
  ref: string;
  commandSurfaceVersion: string | null;
} {
  const pluginManifestPath = path.join(start.root, ".claude-plugin", "plugin.json");
  const pluginManifest = env.fs.readFile(pluginManifestPath);
  let manifestVersion: string | null = null;
  if (pluginManifest !== null) {
    try {
      const parsed = JSON.parse(pluginManifest) as Record<string, unknown>;
      manifestVersion = typeof parsed["version"] === "string" ? parsed["version"] : null;
    } catch {
      // A malformed manifest must not make run start fail; the immutable hash
      // remains useful while the version truthfully degrades to unknown.
    }
  }
  const manifestHash = pluginManifest === null
    ? null
    : crypto.createHash("sha256").update(pluginManifest).digest("hex");
  const commandSurfaceHash = hashOptionalFile(env, path.join(start.root, "command-src", "command-registry.json"));
  return {
    version: start.plugin_identity?.version ?? manifestVersion ?? "unknown",
    ref: start.plugin_identity?.ref ?? (manifestHash ? `sha256:${manifestHash}` : "unknown"),
    commandSurfaceVersion: start.plugin_identity?.command_surface_version ??
      (commandSurfaceHash ? `sha256:${commandSurfaceHash}` : null),
  };
}

/**
 * Freeze the analysis-facing plugin/config identity alongside resolved settings.
 * The record intentionally contains only the closed-key resolved snapshot,
 * hashes, and capability categories; it is scrubbed through the same fail-closed
 * config surface as resolved-settings.json.
 */
export function writePluginConfigSnapshot(
  runId: string,
  snapshot: ResolvedSettingsSnapshot,
  start: StartRunOpts,
  env: RunLifecycleEnv,
): string {
  if (!validateRunId(runId)) {
    throw new Error(`[run-lifecycle] writePluginConfigSnapshot: invalid runId ${JSON.stringify(runId)}`);
  }
  const outPath = pluginConfigSnapshotPath(start.root, runId);
  assertContained(outPath, start.root, "writePluginConfigSnapshot");
  const host = env.resolveHost(start.host_requested);
  const identity = start.session_identity ?? {};
  const pluginIdentity = derivePluginIdentity(start, env);
  const record = {
    schema_version: "guild.plugin_config_snapshot.v1",
    run_id: runId,
    captured_at: env.now(),
    effective: snapshot.effective,
    config_source_layers: snapshot.source_chain,
    plugin: {
      version: pluginIdentity.version,
      ref: pluginIdentity.ref,
    },
    host_adapter: {
      requested: host.requested,
      resolved: host.resolved,
      capabilities_ref: host.capabilities_ref ?? null,
    },
    registry_hashes: {
      skills: hashOptionalFile(env, path.join(start.root, ".guild", "skills", "registry.yaml")),
      agents: hashOptionalFile(env, path.join(start.root, ".guild", "agents", "registry.yaml")),
    },
    command_surface_version: pluginIdentity.commandSurfaceVersion,
    redaction_policy: "scrubbed-config-v1",
    environment_capabilities: {
      dispatch: snapshot.dispatch,
      execution_target: identity.execution_target ?? null,
      native_adapter: identity.native_adapter
        ? {
            family: identity.native_adapter.family,
            surface: identity.native_adapter.surface,
            adapter_id: identity.native_adapter.adapter_id,
            adapter_version: identity.native_adapter.adapter_version,
          }
        : null,
      handshake: identity.handshake
        ? { family: identity.handshake.family, surface: identity.handshake.surface ?? null }
        : null,
      active_model: identity.active_model ?? null,
    },
  };
  const serialized = JSON.stringify(record, null, 2) + "\n";
  if (env.fs.scrubbedWriteDurable) {
    const result = env.fs.scrubbedWriteDurable(
      outPath,
      serialized,
      "config",
      runDir(start.root, runId),
      runId,
    );
    if (result.blocked) {
      process.stderr.write(
        `[run-lifecycle] WARN: plugin-config-snapshot.json write BLOCKED by secret scrub ` +
          `(fail-CLOSED) for run ${runId}. Analysis eligibility will remain false.\n`,
      );
    }
  } else {
    env.fs.writeFile(outPath, serialized);
  }
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
    assertContained(filePath, cwd, "readResolvedSettingsSnapshot");
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

// ── G5(b) — run.yaml `gates:` writer ─────────────────────────────────────────
//
// (v23x-deferred-followups rf-wi-05, origin oir-wi-58). `buildRunManifest`
// writes `gates: {}` once at start and NOTHING ever updated it — a repo-wide
// grep for a gates: writer other than the start manifest and closeRun's
// provenance.json write (a DIFFERENT file) found none. hooks/lib/reanchor.ts's
// `readRunYamlFacts`/`deriveNextGate` (the re-anchor header's next-gate
// pointer) already READS run.yaml's `gates:` map and treats any entry whose
// `outcome` is a canonical success as PASSED — that reader has had nothing to
// read until now. `appendGateOutcome` is the missing writer.

/** The record shape recorded per gate — mirrors CloseRunOpts["gates"]'s value type. */
export interface GateOutcomeRecord {
  posture: string;
  outcome: string;
  codex_review: string;
}

/** Gate token shape: lower-kebab, matches reanchor.ts's GATE_SEQUENCE_BY_PHASE tokens. */
const GATE_TOKEN = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Targeted line-surgery for run.yaml's `gates:` block — same posture as
 * `flipRunStatus`/`appendToPhasesLog`: every other byte of run.yaml is left
 * untouched. Returns null when there is no `gates:` key at all (never
 * fabricate the key on a manifest that doesn't have it).
 */
function writeGateBlock(raw: string, gate: string, rec: GateOutcomeRecord): string | null {
  const lines = raw.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("gates:"));
  if (idx === -1) return null;

  const entryLines = [
    `    posture: ${yamlScalar(rec.posture)}`,
    `    outcome: ${yamlScalar(rec.outcome)}`,
    `    codex_review: ${yamlScalar(rec.codex_review)}`,
  ];
  const gateKeyLine = `  ${gate}:`;

  // Case A: `gates: {}` inline empty map — convert to a block for this ONE gate.
  if (lines[idx].slice("gates:".length).trim() === "{}") {
    lines.splice(idx, 1, "gates:", gateKeyLine, ...entryLines);
    return lines.join("\n");
  }

  // Case B: block form already exists. Its items are every indented,
  // non-blank line immediately after `gates:`, ending at the first column-0
  // line (next top-level key) or EOF — same boundary rule appendToPhasesLog
  // uses for phases_log.
  let end = idx + 1;
  while (end < lines.length && /^\s/.test(lines[end]) && lines[end].trim() !== "") {
    end++;
  }

  // An existing entry for this SAME gate is REPLACED (idempotent re-record),
  // not duplicated — a re-run gate corrects the record.
  const gateIdx = lines.findIndex((l, i) => i > idx && i < end && l === gateKeyLine);
  if (gateIdx !== -1) {
    let bodyEnd = gateIdx + 1;
    while (bodyEnd < end && /^\s{4,}/.test(lines[bodyEnd])) bodyEnd++;
    lines.splice(gateIdx, bodyEnd - gateIdx, gateKeyLine, ...entryLines);
    return lines.join("\n");
  }

  // No existing entry for this gate — append before the block's end.
  lines.splice(end, 0, gateKeyLine, ...entryLines);
  return lines.join("\n");
}

/**
 * Record a gate outcome into run.yaml's `gates:` block. Fail-open on a
 * missing/corrupt run.yaml or an invalid gate token (returns false, never
 * throws) — same posture as `appendPhase`.
 *
 * `fs` accepts the same minimal read/write seam `writeResolvedSettingsSnapshot`
 * uses (`ProvenanceFsSeam`, read+write only — no scrub requirement: run.yaml's
 * OTHER line-surgery writers, `flipRunStatus`/`appendPhase`, are plain
 * unscrubbed writes too).
 *
 * @returns true iff a gate entry was recorded.
 */
export function appendGateOutcome(
  fs: Pick<ProvenanceFsSeam, "readFile" | "writeFile">,
  root: string,
  runId: string,
  gate: string,
  record: GateOutcomeRecord,
): boolean {
  if (!GATE_TOKEN.test(gate)) return false; // reject a bad token — never write it
  const p = runYamlPath(root, runId);
  const raw = fs.readFile(p);
  if (raw === null) return false;
  const next = writeGateBlock(raw, gate, record);
  if (next === null) return false;
  fs.writeFile(p, next);
  return true;
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
  // Parse via the shared js-yaml parser (OD-3); `started_at` stays a string
  // under the default JSON schema. Empty/absent → null (unchanged contract).
  const doc = parseYaml(raw);
  const obj =
    doc !== null && typeof doc === "object" && !Array.isArray(doc)
      ? (doc as Record<string, unknown>)
      : {};
  const v = obj["started_at"];
  if (v === undefined || v === null) return null;
  return String(v).trim() || null;
}

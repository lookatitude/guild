/**
 * src/modules/config/workflows/session-binding.ts — `guild.session_binding.v1` (KTD22).
 *
 * The run record is the ONLY home for host and model identity. Every new `/guild`
 * session detects the host family and model family from the T0 process, writes
 * this envelope once, and every dispatch in that run copies its ids from here.
 *
 * Three rules the shape enforces:
 *
 *   1. IMMUTABLE for the run. A crash resume re-reads the binding; it never
 *      re-detects, because in-flight assignments already named a host.
 *   2. A mid-run host change is REFUSED with a continuation offer — continue as a
 *      new run on this host, or return to the original host. Never a silent rebind.
 *   3. UNKNOWN IS UNKNOWN. A host Guild cannot identify does not resolve to Claude
 *      defaults; evidence stays `unknown` and the tier map stays empty, so the
 *      caller degrades honestly instead of dispatching to the wrong provider.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The binding file inside a run record. */
export const SESSION_BINDING_FILE = "session-binding.json";

export type EvidenceGrade = "available" | "advertised" | "unknown";

export interface PromptComposeRef {
  dialect_id: string;
  overlay_ids: string[];
  hash: string;
}

export interface SessionBinding {
  schema_version: "guild.session_binding.v1";
  /** THIS run — never the initiative. */
  run_id: string;
  host_family: string;
  /** Adapter id / surface tuple this host presents. */
  surface: string;
  detected_at: string;
  models: { cheap?: string; mid?: string; powerful?: string };
  model_family: string;
  prompt_compose: PromptComposeRef;
  evidence: { cheap: EvidenceGrade; mid: EvidenceGrade; powerful: EvidenceGrade };
}

/** The honest unknown: not Claude, not empty-but-usable. */
export const UNKNOWN_HOST_FAMILY = "unknown";
export const UNKNOWN_MODEL_FAMILY = "unknown";

// ── Detection ────────────────────────────────────────────────────────────────

export interface DetectedSession {
  host_family: string;
  surface: string;
  model_family: string;
  evidence: SessionBinding["evidence"];
  /** Which signal identified the host; `"none"` when nothing did. */
  signal: string;
}

/**
 * Host family → model family. Deliberately a FAMILY map: it names no product, so
 * it stays correct when a provider ships a new model, and it is the only thing a
 * dialect fragment may key on.
 */
const HOST_TO_MODEL_FAMILY: Readonly<Record<string, string>> = Object.freeze({
  claude: "anthropic",
  codex: "openai",
  copilot: "openai",
  cursor: "openai",
  gemini: "google",
  antigravity: "google",
});

/**
 * Environment signals, most specific first. Each row is (env var, host family).
 * An unrecognised value never falls through to a default host.
 */
const ENV_SIGNALS: ReadonlyArray<{ env: string; family?: string; fromValue?: boolean }> = Object.freeze([
  { env: "GUILD_HOST_FAMILY", fromValue: true },
  { env: "CLAUDE_PLUGIN_ROOT", family: "claude" },
  { env: "CLAUDECODE", family: "claude" },
  { env: "CODEX_HOME", family: "codex" },
  { env: "CODEX_SANDBOX", family: "codex" },
  { env: "CURSOR_TRACE_ID", family: "cursor" },
  { env: "GEMINI_CLI", family: "gemini" },
]);

const KNOWN_FAMILIES = new Set([...Object.keys(HOST_TO_MODEL_FAMILY), "cline", "zed", "aider", "windsurf", "pi"]);

/**
 * Detect the host family of the T0 process. Pure over `env`, so a fixture can pin
 * a Claude session and a Codex continuation without spawning either.
 */
export function detectSession(env: NodeJS.ProcessEnv = process.env): DetectedSession {
  for (const sig of ENV_SIGNALS) {
    const raw = env[sig.env];
    if (raw === undefined || raw === "") continue;
    const family = sig.fromValue ? raw.trim().toLowerCase() : sig.family!;
    if (sig.fromValue && !KNOWN_FAMILIES.has(family)) {
      // An explicit-but-unrecognised family is still UNKNOWN. Honouring a typo as
      // a host is how an initiative silently dispatches to the wrong provider.
      return unknownSession(`${sig.env}=${raw} (unrecognised family)`);
    }
    return {
      host_family: family,
      surface: env["GUILD_HOST_SURFACE"]?.trim() || family,
      model_family: HOST_TO_MODEL_FAMILY[family] ?? UNKNOWN_MODEL_FAMILY,
      // Family detection alone is `advertised`: the host says what it is. A live
      // catalog probe is what upgrades a tier to `available` (capability domain).
      evidence: { cheap: "advertised", mid: "advertised", powerful: "advertised" },
      signal: sig.env,
    };
  }
  return unknownSession("none");
}

function unknownSession(signal: string): DetectedSession {
  return {
    host_family: UNKNOWN_HOST_FAMILY,
    surface: UNKNOWN_HOST_FAMILY,
    model_family: UNKNOWN_MODEL_FAMILY,
    evidence: { cheap: "unknown", mid: "unknown", powerful: "unknown" },
    signal,
  };
}

/** True when the detection produced no usable host — the caller must degrade. */
export function isUnknownHost(d: Pick<DetectedSession, "host_family">): boolean {
  return d.host_family === UNKNOWN_HOST_FAMILY;
}

// ── Read / write on the run record ───────────────────────────────────────────

export function sessionBindingPath(runDir: string): string {
  return path.join(runDir, SESSION_BINDING_FILE);
}

export function readSessionBinding(runDir: string): SessionBinding | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionBindingPath(runDir), "utf8")) as SessionBinding;
    return parsed?.schema_version === "guild.session_binding.v1" ? parsed : null;
  } catch {
    return null;
  }
}

/** The one refusal text, so the race path and the read path cannot drift apart. */
function refusal(existing: SessionBinding, thisHost: string): string {
  return (
    `run ${existing.run_id} is bound to host family '${existing.host_family}'; ` +
    `this session is '${thisHost}'. Guild does not rebind a run in flight — ` +
    `in-flight assignments already named a host.\n` +
    `  Continue as a NEW run on this host:  guild resume --new-run\n` +
    `  Or return to the original host ('${existing.host_family}') and resume this run.`
  );
}

export type BindResult =
  | { ok: true; binding: SessionBinding; created: boolean }
  | { ok: false; reason: "host_changed_mid_run"; message: string; existing: SessionBinding };

export interface BindSessionOptions {
  runDir: string;
  runId: string;
  detected: DetectedSession;
  promptCompose: PromptComposeRef;
  /** Tier→model map from the adapter. Empty for an unknown host — never guessed. */
  models?: SessionBinding["models"];
  now?: () => Date;
}

/**
 * Bind this session to this run.
 *
 * - No binding yet → write one and return `created: true`.
 * - Binding exists for the SAME host family → return it unchanged (crash resume).
 * - Binding exists for a DIFFERENT host family → refuse with the continuation offer.
 */
export function bindSession(opts: BindSessionOptions): BindResult {
  const existing = readSessionBinding(opts.runDir);
  if (existing) {
    if (existing.host_family !== opts.detected.host_family) {
      return {
        ok: false,
        reason: "host_changed_mid_run",
        existing,
        message: refusal(existing, opts.detected.host_family),
      };
    }
    return { ok: true, binding: existing, created: false };
  }

  const now = (opts.now ?? (() => new Date()))().toISOString();
  const binding: SessionBinding = {
    schema_version: "guild.session_binding.v1",
    run_id: opts.runId,
    host_family: opts.detected.host_family,
    surface: opts.detected.surface,
    detected_at: now,
    // An unknown host gets NO tier map. An empty map is a blocked dispatch; a
    // guessed map is a wrong one.
    models: isUnknownHost(opts.detected) ? {} : (opts.models ?? {}),
    model_family: opts.detected.model_family,
    prompt_compose: opts.promptCompose,
    evidence: opts.detected.evidence,
  };

  fs.mkdirSync(opts.runDir, { recursive: true });
  const created = createExclusive(sessionBindingPath(opts.runDir), binding);
  if (created) return { ok: true, binding, created: true };

  // Someone else won the race between the read above and this write. Re-read and
  // answer from THEIR binding, which is now the run's identity: same host family
  // is a resume, a different one is the refusal with the continuation offer. A
  // last-write-wins rename here would have let the loser silently overwrite the
  // winner and rebind a run mid-flight (codex G-lane r1 P1-5).
  const winner = readSessionBinding(opts.runDir);
  if (winner === null) {
    // The file exists but is unreadable or malformed. Refuse rather than clobber:
    // an unparseable binding is an operator problem, not a licence to rebind.
    return {
      ok: false,
      reason: "host_changed_mid_run",
      existing: binding,
      message:
        `run ${opts.runId} already has a session binding that cannot be read. ` +
        `Guild will not overwrite it. Inspect ${sessionBindingPath(opts.runDir)}, ` +
        `or continue as a NEW run on this host: guild resume --new-run`,
    };
  }
  if (winner.host_family !== opts.detected.host_family) {
    return { ok: false, reason: "host_changed_mid_run", existing: winner, message: refusal(winner, opts.detected.host_family) };
  }
  return { ok: true, binding: winner, created: false };
}

/**
 * Create `file` only if it does not exist, atomically.
 *
 * `wx` is the whole point: `open(O_CREAT|O_EXCL)` is one syscall, so of two
 * processes reaching it at the same instant exactly one creates the file and the
 * other gets EEXIST. The previous write went through a SHARED temp filename plus
 * `rename`, which is last-write-wins AND lets two binds interleave on the same
 * temp path — two hosts could both believe they had bound the run.
 *
 * Returns true when THIS caller created the file.
 */
function createExclusive(file: string, binding: SessionBinding): boolean {
  try {
    fs.writeFileSync(file, `${JSON.stringify(binding, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

// ── The one call a run-start entrypoint makes ────────────────────────────────

/**
 * Compose the session's prompt reference and bind it to `runId` on the run record.
 *
 * `writeFile` is the caller's fs seam so run-lifecycle can keep its single
 * injected writer (and its fixtures keep working); when omitted the real fs is
 * used. `composeHash` lets the caller pass the hash `composePrompt` produced —
 * config does not import the prompting domain, so the hash arrives as a value.
 */
/**
 * The caller's filesystem, when it has one of its own (run-lifecycle drives an
 * in-memory fs in its fixtures and must see this file in the same map as the rest
 * of the run record).
 *
 * `exists` is REQUIRED alongside `writeFile`: a seam cannot offer `O_EXCL`, so the
 * seam path is check-then-write. That is sound HERE and only here — `startRun`
 * mints a fresh, collision-guarded run id before it binds, so no second process is
 * writing this run's binding at creation time. The race the contract cares about is
 * two hosts binding an ALREADY EXISTING run, and that path goes through
 * `bindSession`, which is exclusive.
 */
export interface BindFsSeam {
  exists(absPath: string): boolean;
  writeFile(absPath: string, contents: string): void;
  /** Optional: without it an existing binding cannot be read back through the seam. */
  readFile?(absPath: string): string | null;
}

export interface BindForRunOptions {
  runDir: string;
  runId: string;
  env?: NodeJS.ProcessEnv;
  promptCompose?: PromptComposeRef;
  models?: SessionBinding["models"];
  /** Both members or neither; passing `writeFile` without `exists` is refused. */
  fs?: BindFsSeam;
}

export function bindSessionForRun(opts: BindForRunOptions): BindResult {
  const detected = detectSession(opts.env ?? process.env);
  const promptCompose: PromptComposeRef =
    opts.promptCompose ?? { dialect_id: "dialect:none", overlay_ids: [], hash: "" };
  const seam = opts.fs;

  // No seam → the real filesystem, and the exclusive create with it.
  if (seam === undefined) {
    return bindSession({ runDir: opts.runDir, runId: opts.runId, detected, promptCompose, models: opts.models });
  }

  const file = sessionBindingPath(opts.runDir);
  if (seam.exists(file)) {
    // Already bound in the caller's fs: same host resumes, a different host is
    // refused with the continuation offer — never a silent rebind.
    const raw = seam.readFile?.(file) ?? null;
    let existing: SessionBinding | null = null;
    try {
      const parsed = raw === null ? null : (JSON.parse(raw) as SessionBinding);
      existing = parsed?.schema_version === "guild.session_binding.v1" ? parsed : null;
    } catch {
      existing = null;
    }
    if (existing && existing.host_family !== detected.host_family) {
      return { ok: false, reason: "host_changed_mid_run", existing, message: refusal(existing, detected.host_family) };
    }
    if (existing) return { ok: true, binding: existing, created: false };
  }

  const binding: SessionBinding = {
    schema_version: "guild.session_binding.v1",
    run_id: opts.runId,
    host_family: detected.host_family,
    surface: detected.surface,
    detected_at: new Date().toISOString(),
    models: isUnknownHost(detected) ? {} : (opts.models ?? {}),
    model_family: detected.model_family,
    prompt_compose: promptCompose,
    evidence: detected.evidence,
  };
  seam.writeFile(file, `${JSON.stringify(binding, null, 2)}\n`);
  return { ok: true, binding, created: true };
}

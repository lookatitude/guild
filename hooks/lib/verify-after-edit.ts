/**
 * hooks/lib/verify-after-edit.ts — the `verify.after_edit` adapter rung (R36 /
 * R45 / KTD28 / KTD30), hook side.
 *
 * KTD28's closed matrix:
 *
 *     hooks | verify.after_edit → wrapped if a check command exists,
 *           |                     else skip-recorded.
 *
 * So the rung is three-valued and the third value is NOT a pass:
 *
 *   native         the host fires a real tool-completion hook (Claude Code's
 *                  PostToolUse) AND the project declares a check. The hook
 *                  itself spawns it.
 *   wrapped        no native hook event, but a check command exists, so a
 *                  wrapper drives the same spawn (`GUILD_VERIFY_RUNG=wrapped`).
 *   skip-recorded  no check command to run. RECORDED as a loss on disk; the
 *                  outer qa gate still sees it. Never a silent pass (KTD28).
 *
 * Four invariants this module exists to hold:
 *
 *  1. **Green costs zero tokens.** A passing check writes NOTHING to stdout. The
 *     budget is 250ms and 0 assistant tokens (R45); the record goes to disk.
 *  2. **A fail is legible but capped.** stderr carries a KTD26-capped excerpt
 *     taken from the tail of the log; the full check output is on disk at the
 *     path the excerpt names, COMPLETE and never truncated there.
 *  3. **An oracle that cannot RUN is a failure, not a pass.** A declared check
 *     whose command does not exist, exits by signal, or times out settles
 *     `fail`. So does a MALFORMED check table: a table that declares
 *     `args: ["-e", "…", 1]` is not a check, and coercing it to `[]` would run
 *     bare `node`, exit 0, and record a pass for an oracle nobody specified
 *     (codex G-lane r1). Unverified fails closed (KTD5) — it is never guessed.
 *  4. **The oracle's output never sits in memory.** It is streamed straight to
 *     the log file descriptor, so a 2 MiB test log lands complete on disk
 *     instead of killing the spawn with `ENOBUFS` and reporting the oracle
 *     unrunnable (codex G-lane r1).
 *
 * No durable path is constructed here: the caller passes the config file and the
 * run directory as absolute paths. That keeps the durable-path law (KTD15) in
 * the one place that already owns it and keeps this module a pure rung.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { KTD26_TOKEN_CAP, truncateWithPointer } from "./token-cap.js";

/** The project-declared check table. Read, never written, by this module. */
export const VERIFY_CHECKS_SCHEMA = "guild.verify_checks.v1" as const;

/** The durable filename the caller joins under the root's durable dir. */
export const VERIFY_CHECKS_FILENAME = "verify.json";

/** The one oracle id this rung settles (a `done_when[]` oracle kind, KTD30). */
export const VERIFY_AFTER_EDIT_ID = "verify.after_edit" as const;

/** R45: a green inner verify is budgeted at 250ms end to end. */
export const VERIFY_AFTER_EDIT_BUDGET_MS = 250;

/** Default wall-clock ceiling for one check spawn. A project may override it. */
export const VERIFY_SPAWN_TIMEOUT_MS = 30_000;

/** The rung record schema — the "recorded" half of skip-recorded. */
export const RUNG_RECORD_SCHEMA = "guild.rung_record.v1" as const;

/** How much of the log tail the capped stderr excerpt is built from. */
export const LOG_TAIL_BYTES = 64 * 1024;

export type VerifyRung = "native" | "wrapped" | "skip-recorded";

/** Matches the `guild.progress_ledger.v1` item states this rung can settle. */
export type VerifyState = "pass" | "fail" | "skip-recorded";

export interface VerifyCheckSpec {
  command: string;
  args: string[];
  timeout_ms: number;
}

/**
 * The three outcomes of reading the check table, kept distinct on purpose.
 *
 * `absent` and `invalid` are NOT the same thing and must not route the same way:
 * no table declared is a recorded skip, while a table that IS declared and is
 * malformed is a failure. Collapsing them to `null` is what let a bad `args`
 * array become a passing oracle.
 */
export type VerifyCheckRead =
  | { kind: "ok"; spec: VerifyCheckSpec }
  | { kind: "absent" }
  | { kind: "invalid"; field: string };

/**
 * Read `checks["verify.after_edit"]` out of a `guild.verify_checks.v1` file.
 *
 * Fail-CLOSED on shape, and specific about which field is wrong: every field is
 * validated rather than defaulted, because a default is a guess and a guessed
 * oracle is exactly what KTD5 forbids.
 */
export function readVerifyCheck(configPath: string): VerifyCheckRead {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch {
    return { kind: "absent" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid", field: "document (not JSON)" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "invalid", field: "document (not an object)" };
  }
  const doc = parsed as Record<string, unknown>;
  if (doc["schema_version"] !== VERIFY_CHECKS_SCHEMA) {
    return { kind: "invalid", field: "schema_version" };
  }
  const checks = doc["checks"];
  if (checks === null || typeof checks !== "object" || Array.isArray(checks)) {
    return { kind: "invalid", field: "checks" };
  }
  const entry = (checks as Record<string, unknown>)[VERIFY_AFTER_EDIT_ID];
  // A valid table that simply does not declare THIS oracle is `absent`: the
  // project has a check table and no after-edit check, which is a recorded skip.
  if (entry === undefined) return { kind: "absent" };
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return { kind: "invalid", field: `checks["${VERIFY_AFTER_EDIT_ID}"]` };
  }
  const spec = entry as Record<string, unknown>;
  const command = spec["command"];
  if (typeof command !== "string" || command.length === 0) {
    return { kind: "invalid", field: "command" };
  }
  const rawArgs = spec["args"];
  let args: string[] = [];
  if (rawArgs !== undefined) {
    if (!Array.isArray(rawArgs) || !rawArgs.every((a) => typeof a === "string")) {
      return { kind: "invalid", field: "args" };
    }
    args = rawArgs as string[];
  }
  const rawTimeout = spec["timeout_ms"];
  let timeout_ms = VERIFY_SPAWN_TIMEOUT_MS;
  if (rawTimeout !== undefined) {
    if (typeof rawTimeout !== "number" || !Number.isFinite(rawTimeout) || rawTimeout <= 0) {
      return { kind: "invalid", field: "timeout_ms" };
    }
    timeout_ms = rawTimeout;
  }
  return { kind: "ok", spec: { command, args, timeout_ms } };
}

/**
 * Which rung is in force.
 *
 * `GUILD_VERIFY_RUNG` is how a non-native host states its own rung: a wrapper
 * that has no tool-completion event sets `wrapped`, and a host adapter whose
 * hooks rung is absent sets `skip-recorded` so the loss is recorded even though
 * nothing spawned it. Absent env on a host that IS firing this hook is `native`.
 *
 * No check ⇒ `skip-recorded` regardless of env: there is nothing to run, and
 * claiming `native` for a rung with no command would report a capability the
 * host does not have (KTD5: unverified fails closed).
 */
export function resolveVerifyRung(
  env: NodeJS.ProcessEnv,
  hasCheck: boolean,
): VerifyRung {
  if (!hasCheck) return "skip-recorded";
  const declared = env["GUILD_VERIFY_RUNG"];
  if (declared === "skip-recorded" || declared === "wrapped" || declared === "native") {
    return declared;
  }
  return "native";
}

export interface RungRecord {
  schema_version: typeof RUNG_RECORD_SCHEMA;
  rung_id: string;
  rung: VerifyRung | string;
  state: VerifyState | string;
  reason: string;
  updated_at: string;
  /** Present when a check ran. */
  exit_code?: number | null;
  duration_ms?: number;
  /** Present when the full output was written. */
  log_path?: string;
  /** Bytes of oracle output on disk. The log is complete, so this is all of it. */
  log_bytes?: number;
}

export interface VerifyOutcome {
  rung: VerifyRung;
  state: VerifyState;
  /** True iff a check process was actually spawned. */
  ran: boolean;
  exit_code: number | null;
  /**
   * Machine-readable why: `check-passed`, `check-failed: exit N`,
   * `no-declared-check`, `host-declared-skip-recorded`,
   * `malformed-check-table: <field>`, `oracle-unrunnable: <detail>`.
   */
  reason: string;
  /** KTD26-capped text for stderr. Empty on a pass. */
  stderr_excerpt: string;
  /** Where the full, COMPLETE check output landed, when a check ran. */
  log_path: string | null;
  /** Byte count of that log. */
  log_bytes: number;
  /** Where the rung record landed, when a run directory was available. */
  record_path: string | null;
  duration_ms: number;
}

export interface RunVerifyAfterEditInput {
  /** Absolute path to the `guild.verify_checks.v1` file. */
  configPath: string;
  /** Working directory the check runs in (the Guild root). */
  cwd: string;
  /** Absolute run directory. Absent ⇒ nothing is recorded to a run tree. */
  runDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  /**
   * Seam for tests; production uses `spawnSync` with the log fd as stdout and
   * stderr. A test double receives the same descriptor so it can write to it.
   */
  spawn?: (
    command: string,
    args: string[],
    opts: { cwd: string; timeout: number; env: NodeJS.ProcessEnv; stdio: Array<"ignore" | number> },
  ) => SpawnSyncReturns<string>;
}

/** Latest-only (KTD32): the record is REPLACED, never appended to. */
function writeRungRecord(runDir: string, record: RungRecord): string | null {
  try {
    const dir = path.join(runDir, "rungs");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "verify-after-edit.json");
    fs.writeFileSync(p, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return p;
  } catch {
    return null;
  }
}

/**
 * Where the oracle's output is streamed.
 *
 * Under the run tree when there is one. Otherwise an OS temp file, because the
 * alternative is buffering the output in memory, and that is the `ENOBUFS`
 * failure this function exists to avoid. `GuildStorage.temporary()` is the right
 * home once a hook can afford the state barrel; `os.tmpdir()` keeps this module
 * free of a durable path either way.
 */
function openLog(runDir: string | undefined): { fd: number; logPath: string } | null {
  try {
    // One log PER INVOCATION, created exclusively (`wx`). Two checks on the same
    // run overlap whenever two edits land within one oracle's runtime; a shared
    // name let the second (passing) check truncate and then unlink the first
    // (failing) check's evidence (codex G-lane r2). The name carries the wall
    // clock, the pid and a nonce so it is unique across processes; the record's
    // `log_path` names exactly the file this invocation wrote.
    const name = `after-edit.${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString("hex")}.log`;
    const logPath =
      runDir === undefined
        ? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "guild-verify-")), name)
        : path.join(runDir, "verify", name);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    return { fd: fs.openSync(logPath, "wx"), logPath };
  } catch {
    return null;
  }
}

function byteSize(logPath: string): number {
  try {
    return fs.statSync(logPath).size;
  } catch {
    return 0;
  }
}

/**
 * The last `LOG_TAIL_BYTES` of the log.
 *
 * A tail, not the whole file: the excerpt is capped at 2000 tokens anyway, and
 * reading a 2 MiB log into memory to throw 99% of it away would reintroduce the
 * buffering this streaming path removed.
 */
function readLogTail(logPath: string): string {
  let fd: number | null = null;
  try {
    const size = byteSize(logPath);
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const length = size - start;
    if (length <= 0) return "";
    const buf = Buffer.alloc(length);
    fd = fs.openSync(logPath, "r");
    fs.readSync(fd, buf, 0, length, start);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* nothing to do */
      }
    }
  }
}

/**
 * Run (or record the absence of) the project's after-edit check.
 *
 * Never throws: this is called from a hook that must exit 0 whatever happens.
 * The verdict is in the return value, and on disk.
 */
export function runVerifyAfterEdit(input: RunVerifyAfterEditInput): VerifyOutcome {
  const env = input.env ?? process.env;
  const now = input.now ?? (() => new Date().toISOString());
  const read = readVerifyCheck(input.configPath);

  const finish = (o: Omit<VerifyOutcome, "record_path">): VerifyOutcome => {
    const record: RungRecord = {
      schema_version: RUNG_RECORD_SCHEMA,
      rung_id: VERIFY_AFTER_EDIT_ID,
      rung: o.rung,
      state: o.state,
      reason: o.reason,
      updated_at: now(),
      exit_code: o.exit_code,
      duration_ms: o.duration_ms,
      ...(o.log_path === null ? {} : { log_path: o.log_path, log_bytes: o.log_bytes }),
    };
    const record_path = input.runDir === undefined ? null : writeRungRecord(input.runDir, record);
    return { ...o, record_path };
  };

  // A DECLARED-but-malformed table is a failure, not a skip and never a pass.
  // Nothing is spawned: there is no command this table can be said to name.
  if (read.kind === "invalid") {
    const rung = resolveVerifyRung(env, true);
    return finish({
      rung: rung === "skip-recorded" ? "native" : rung,
      state: "fail",
      ran: false,
      exit_code: null,
      reason: `malformed-check-table: ${read.field}`,
      stderr_excerpt:
        `guild: ${VERIFY_AFTER_EDIT_ID} check table is malformed ` +
        `(${read.field}) — a declared oracle that cannot be read is a FAILURE, not a pass.\n`,
      log_path: null,
      log_bytes: 0,
      duration_ms: 0,
    });
  }

  const rung = resolveVerifyRung(env, read.kind === "ok");

  if (read.kind === "absent" || rung === "skip-recorded") {
    // The recorded loss. `skip-recorded` is a ledger state (KTD30), so the outer
    // qa gate sees a cell that was never inner-verified rather than a green one.
    return finish({
      rung: "skip-recorded",
      state: "skip-recorded",
      ran: false,
      exit_code: null,
      reason: read.kind === "absent" ? "no-declared-check" : "host-declared-skip-recorded",
      stderr_excerpt: "",
      log_path: null,
      log_bytes: 0,
      duration_ms: 0,
    });
  }

  const spec = read.spec;
  const log = openLog(input.runDir);
  const spawnFn =
    input.spawn ?? ((c, a, o) => spawnSync(c, a, { ...o, encoding: "utf8" }));
  const startedNs = process.hrtime.bigint();
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnFn(spec.command, spec.args, {
      cwd: input.cwd,
      timeout: spec.timeout_ms,
      env: env as NodeJS.ProcessEnv,
      // The oracle's stdout AND stderr go straight to the log fd. Nothing is
      // buffered, so `maxBuffer` cannot be exceeded however large the output.
      stdio: log === null ? ["ignore", "ignore", "ignore"] : ["ignore", log.fd, log.fd],
    });
  } catch (err) {
    const duration_ms = Number(process.hrtime.bigint() - startedNs) / 1e6;
    if (log !== null) closeQuietly(log.fd);
    return finish({
      rung,
      state: "fail",
      ran: false,
      exit_code: null,
      reason: `oracle-unrunnable: ${err instanceof Error ? err.message : String(err)}`,
      stderr_excerpt: `guild: ${VERIFY_AFTER_EDIT_ID} could not be run (${
        err instanceof Error ? err.message : String(err)
      }). A declared oracle that cannot run is a FAILURE, not a pass.\n`,
      log_path: log === null ? null : log.logPath,
      log_bytes: log === null ? 0 : byteSize(log.logPath),
      duration_ms,
    });
  }
  const duration_ms = Number(process.hrtime.bigint() - startedNs) / 1e6;
  if (log !== null) closeQuietly(log.fd);

  const logPath = log === null ? null : log.logPath;
  const logBytes = logPath === null ? 0 : byteSize(logPath);

  const excerpt = (headline: string): string => {
    const tail = logPath === null ? "" : readLogTail(logPath);
    const body =
      `${headline}\n$ ${spec.command} ${spec.args.join(" ")}\n` +
      (logPath === null ? "" : `--- tail of ${logPath} ---\n${tail}`);
    return truncateWithPointer({
      text: body,
      cap: KTD26_TOKEN_CAP,
      // `pointer`, not `logPath`: the log was STREAMED and is complete. Handing
      // the cap a logPath would make it rewrite the file from this tail.
      ...(logPath === null ? {} : { pointer: logPath }),
      label: VERIFY_AFTER_EDIT_ID,
    }).text;
  };

  // A spawn that never produced a status (ENOENT, signal, timeout) did not
  // ORACLE anything. Fail closed with the reason on the record.
  if (result.error !== undefined || result.status === null) {
    const why =
      result.error !== undefined
        ? result.error.message
        : `terminated by signal ${String(result.signal)}`;
    return finish({
      rung,
      state: "fail",
      ran: false,
      exit_code: null,
      reason: `oracle-unrunnable: ${why}`,
      stderr_excerpt: excerpt(`guild: ${VERIFY_AFTER_EDIT_ID} could not be run (${why}).`),
      log_path: logPath,
      log_bytes: logBytes,
      duration_ms,
    });
  }

  if (result.status === 0) {
    // Green. Zero stdout, zero stderr, zero assistant tokens (R36/R45). The
    // log of a passing check is noise in the run tree, so it goes.
    if (logPath !== null) {
      try {
        fs.rmSync(logPath, { force: true });
      } catch {
        /* a leftover empty log is harmless */
      }
    }
    return finish({
      rung,
      state: "pass",
      ran: true,
      exit_code: 0,
      reason: "check-passed",
      stderr_excerpt: "",
      log_path: null,
      log_bytes: 0,
      duration_ms,
    });
  }

  // Red. The complete output is already on disk; stderr gets a capped tail.
  return finish({
    rung,
    state: "fail",
    ran: true,
    exit_code: result.status,
    reason: `check-failed: exit ${result.status}`,
    stderr_excerpt: excerpt(`guild: ${VERIFY_AFTER_EDIT_ID} failed (exit ${result.status}).`),
    log_path: logPath,
    log_bytes: logBytes,
    duration_ms,
  });
}

function closeQuietly(fd: number): void {
  try {
    fs.closeSync(fd);
  } catch {
    /* nothing to do */
  }
}

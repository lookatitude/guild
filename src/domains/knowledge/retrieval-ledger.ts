/**
 * src/domains/knowledge/retrieval-ledger.ts — K05 retrieval instrumentation and
 * explicit knowledge-use links (M26 producer).
 *
 * Every instrumented query writes, under `runs/<run_id>/knowledge/`:
 *   retrieval/<query_id>.started.json  before the producer runs
 *   retrieval/<query_id>.json          when it completes (hit, miss or error)
 *   uses/<use_id>.json                 one explicit downstream use of one result
 *
 * Records are immutable (exclusive link from a temp file) and every write goes
 * through the kernel containment check against the run directory. The raw query
 * is never stored: the record keeps a hash of the scrubbed text, and a preview
 * only when the caller opts in, scrubbed by the T01 capture scrubber.
 *
 * A use link names the record's byte hash and the hash of the result it used,
 * so a use of a tampered record, of a result the query never returned, or of a
 * query with no record is refused at write and excluded (and counted) at read.
 *
 * The reader never turns missing into zero: no ledger is `unavailable`; a query
 * that started without completing, or a record that fails validation, makes
 * coverage incomplete. Unsupported use capture makes only the use ratio
 * unavailable; hit and latency stay observed.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { isRefused, prepareContainedWrite } from "../kernel";
import { scrubTraceText, traceStringIsUnsafe } from "../telemetry/trace-capture-v3";
import { readPublicationRecord } from "./publication";
import type { ChannelState } from "./source-basis";

export const RETRIEVAL_RECORD_SCHEMA = "guild.knowledge.retrieval.v1" as const;
export const RETRIEVAL_STARTED_SCHEMA = "guild.knowledge.retrieval_started.v1" as const;
export const KNOWLEDGE_USE_SCHEMA = "guild.knowledge.use.v1" as const;
export const USE_CAPTURE_SCHEMA = "guild.knowledge.use_capture.v1" as const;

export const RETRIEVAL_LIMITS = Object.freeze({
  max_results: 200,
  max_ref_bytes: 512,
  max_preview_bytes: 256,
  /** Larger queries are not scrubbed (cost); they carry no hash and no preview. */
  max_scrub_query_bytes: 64 * 1024,
  max_record_bytes: 256 * 1024,
  max_files: 20_000,
});

export type RetrievalEntryPoint = "recall_api" | "recall_cli" | "phase_start" | "memory_adapter";
export type UseCapture = "supported" | "unsupported";
export type LaunchPath = "stack_launch" | "non_stack";
export type RetrievalStatus = "hit" | "miss" | "error";
export type ConsumerKind = "handoff" | "artifact" | "task" | "prompt" | "decision";

const ENTRY_POINTS: readonly RetrievalEntryPoint[] = ["recall_api", "recall_cli", "phase_start", "memory_adapter"];
const CONSUMER_KINDS: readonly ConsumerKind[] = ["handoff", "artifact", "task", "prompt", "decision"];
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Query and use ids carry no dot, so `<id>.started.json` and `<id>.capture.json` never collide with a record. */
const QID_RE = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/;
const MODE_RE = /^[a-z][a-z0-9_:-]{0,63}$/;
const ERROR_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const SHA_RE = /^sha256:[a-f0-9]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const isIso = (v: unknown) => typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));

/** An identifier that is path-safe and that the capture scrubber would not change (no token, secret or literal). */
function safeId(v: unknown, literals: readonly string[] = []): v is string {
  return typeof v === "string" && ID_RE.test(v) && !traceStringIsUnsafe(v, literals);
}
const safeQid = (v: unknown, literals: readonly string[] = []): v is string => safeId(v, literals) && QID_RE.test(v as string);
const isSha = (v: unknown): v is string => typeof v === "string" && SHA_RE.test(v);
const isStr = (v: unknown): v is string => typeof v === "string";

export interface RetrievalClock {
  wall: () => string;
  monotonicNs: () => bigint;
}

const SYSTEM_CLOCK: RetrievalClock = {
  wall: () => new Date().toISOString(),
  monotonicNs: () => process.hrtime.bigint(),
};

/** Identifies the monotonic clock: readings compare only within one process. */
const PROCESS_CLOCK_REF = crypto
  .createHash("sha256")
  .update(`${os.hostname()}|${process.pid}|${Date.now() - Math.round(process.uptime() * 1000)}`)
  .digest("hex")
  .slice(0, 16);

export interface RetrievalIdentityInput {
  kind: "retry" | "mirror";
  of: string;
}

export interface RetrievalContext {
  runDir: string;
  run_id: string;
  /** Used when no publication names the source. */
  source_id?: string;
  entry_point: RetrievalEntryPoint;
  /** Requested query mode (a token, never query text). */
  mode: string;
  use_capture: UseCapture;
  /** Default: `stack_launch` when the environment carries a Stack run binding. */
  launch_path?: LaunchPath;
  identity?: RetrievalIdentityInput;
  /** Explicit id (tests, replay); default a fresh random id. */
  query_id?: string;
  capture_preview?: boolean;
  private_literals?: readonly string[];
  /** Owner `.guild/indexes`: binds the record to the published recall generation. Absent: `unbound`. */
  indexesDir?: string;
  /** Why the store is unbound, when `indexesDir` is absent. */
  unbound_reason?: string;
  task_id?: string;
  clock?: RetrievalClock;
}

export interface RetrievalItem {
  ref: string;
  content: string;
}

export type GenerationState = "published" | "unpublished" | "export_unknown" | "unreadable" | "unbound";

/** What the producer actually read. Only bytes it read can name a generation. */
export interface RetrievalEvidence {
  /** sha256 of the `knowledge-recall.json` bytes the query parsed; null when it read none. */
  recall_export_sha256: string | null;
}

export interface RetrievalGeneration {
  state: GenerationState;
  generation: string | null;
  publication_sha256: string | null;
  recall_channel_state: ChannelState | null;
  reason: string | null;
}

export interface RetrievalRecord {
  schema_version: typeof RETRIEVAL_RECORD_SCHEMA;
  query_id: string;
  run_id: string;
  source_id: string;
  task_id: string | null;
  entry_point: RetrievalEntryPoint;
  launch_path: LaunchPath;
  mode: string;
  identity: { kind: "original" | "retry" | "mirror"; of: string | null; attempt: number };
  query: {
    sha256: string | null;
    bytes: number;
    redacted: boolean;
    truncated: boolean;
    withheld: boolean;
    preview: string | null;
    redaction_version: string;
  };
  generation: RetrievalGeneration;
  clock: {
    controller_started_at: string;
    controller_completed_at: string;
    monotonic: { clock: "process.hrtime"; clock_ref: string; start_ns: string; end_ns: string };
    duration_ms: number;
  };
  outcome: { status: RetrievalStatus; result_count: number | null; error_code: string | null };
  results: Array<{ ordinal: number; ref: string | null; ref_sha256: string }>;
  results_truncated: boolean;
  /** Over every returned result, including those past the stored cap. */
  all_results_sha256: string;
  /** False when any returned ref was withheld: distinct results may share a fingerprint. */
  results_identity_verifiable: boolean;
  results_digest: string;
  use_capture: UseCapture;
}

interface StartedMarker {
  schema_version: typeof RETRIEVAL_STARTED_SCHEMA;
  query_id: string;
  run_id: string;
  entry_point: RetrievalEntryPoint;
  started_at: string;
}

export interface KnowledgeUseRecord {
  schema_version: typeof KNOWLEDGE_USE_SCHEMA;
  use_id: string;
  query_id: string;
  run_id: string;
  retrieval_sha256: string;
  result: { ordinal: number; ref_sha256: string };
  consumer: { kind: ConsumerKind; id: string };
  recorded_at: string;
}

export type RetrievalLoss = "invalid_context" | "record_conflict" | "write_failed" | "containment" | "start_not_written";

export interface CompleteResult {
  record: RetrievalRecord | null;
  loss: RetrievalLoss | null;
}

export interface RetrievalHandle {
  query_id: string;
  complete: (items: readonly RetrievalItem[], evidence?: RetrievalEvidence) => CompleteResult;
  fail: (code: string) => CompleteResult;
}

// ── paths and writes ─────────────────────────────────────────────────────────

export function retrievalDir(runDir: string): string {
  return path.join(runDir, "knowledge", "retrieval");
}

export function usesDir(runDir: string): string {
  return path.join(runDir, "knowledge", "uses");
}

const sha = (b: Buffer | string): string => `sha256:${crypto.createHash("sha256").update(b).digest("hex")}`;

type WriteOutcome = "written" | "identical" | "conflict" | "containment" | "failed";

/**
 * Create `target` exactly once, inside `root`. A temp file is linked into place,
 * so the name never holds torn bytes and a second writer cannot replace it.
 */
function writeOnce(root: string, target: string, bytes: Buffer): WriteOutcome {
  const prep = prepareContainedWrite(root, target, { requireRegularFileLeaf: true });
  if (isRefused(prep)) return prep.code === "mkdir-failed" ? "failed" : "containment";
  const dest = prep.realPath;
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    try {
      fs.linkSync(tmp, dest);
      return "written";
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return existingOutcome(root, target, bytes);
      return "failed";
    }
  } catch {
    return "failed";
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ }
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

function existingOutcome(root: string, target: string, bytes: Buffer): WriteOutcome {
  const cur = readContained(root, target);
  if (cur === null) return "failed";
  return cur.equals(bytes) ? "identical" : "conflict";
}

/** Bytes of a regular file inside `root`, or null (absent, symlink leaf, escaping ancestor, oversized). */
function readContained(root: string, file: string): Buffer | null {
  try {
    const realRoot = fs.realpathSync(root);
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > RETRIEVAL_LIMITS.max_record_bytes) return null;
    const real = fs.realpathSync(file);
    if (!real.startsWith(realRoot + path.sep)) return null;
    return fs.readFileSync(real);
  } catch {
    return null;
  }
}

// ── capture ──────────────────────────────────────────────────────────────────

/**
 * Which published recall generation a query read: named only when the bytes the
 * query parsed equal that generation's `knowledge-recall.json` artifact.
 */
export function generationForEvidence(
  indexesDir: string | undefined,
  evidence: RetrievalEvidence | undefined,
  unboundReason: string | undefined,
  literals: readonly string[] = [],
): RetrievalGeneration & { source_id: string | null } {
  const none = (state: GenerationState, reason: string) => ({ state, generation: null, publication_sha256: null, recall_channel_state: null, reason, source_id: null });
  if (!indexesDir) return none("unbound", unboundReason ?? "producer is not bound to a published knowledge store");
  const readSha = evidence?.recall_export_sha256 ?? null;
  if (!isSha(readSha)) return none("unbound", "the query read no published channel");
  try {
    const cur = readPublicationRecord(indexesDir);
    if (!cur) return none("unpublished", "no knowledge generation is published");
    const source_id = safeId(cur.record.source_id, literals) ? cur.record.source_id : null;
    const channel = cur.record.channels.find((c) => c.channel === "recall") ?? null;
    const channelState = channel && CHANNEL_STATES.includes(channel.state) ? channel.state : null;
    if (cur.manifest.artifacts["knowledge-recall.json"]?.sha256 !== readSha) {
      return { state: "export_unknown", generation: null, publication_sha256: null, recall_channel_state: channelState, reason: "the bytes read are not the current generation's recall artifact", source_id };
    }
    return {
      state: "published",
      generation: cur.pointer.generation,
      publication_sha256: cur.pointer.publication_sha256,
      recall_channel_state: channelState,
      reason: channel ? "recall channel state as published" : "generation has no recall channel",
      source_id,
    };
  } catch {
    return none("unreadable", "the publication could not be read");
  }
}

function sanitizeQuery(query: string, ctx: RetrievalContext): RetrievalRecord["query"] {
  const bytes = Buffer.byteLength(query, "utf8");
  const base = { bytes, redaction_version: "guild.trace-scrub.v1" };
  if (bytes > RETRIEVAL_LIMITS.max_scrub_query_bytes) {
    return { ...base, sha256: null, redacted: false, truncated: false, withheld: true, preview: null };
  }
  const literals = ctx.private_literals ?? [];
  const full = scrubTraceText(query, RETRIEVAL_LIMITS.max_scrub_query_bytes * 6, literals);
  if (full === null) return { ...base, sha256: null, redacted: false, truncated: false, withheld: true, preview: null };
  let preview: string | null = null;
  let truncated = false;
  if (ctx.capture_preview) {
    const p = scrubTraceText(query, RETRIEVAL_LIMITS.max_preview_bytes, literals);
    preview = p?.content ?? null;
    truncated = p?.truncated ?? false;
    if (preview !== null && Buffer.byteLength(preview, "utf8") > RETRIEVAL_LIMITS.max_preview_bytes) preview = null;
  }
  return { ...base, sha256: sha(full.content), redacted: full.redacted, truncated, withheld: preview === null && !!ctx.capture_preview, preview };
}

function resultEntries(items: readonly RetrievalItem[], literals: readonly string[], limit: number = RETRIEVAL_LIMITS.max_results): RetrievalRecord["results"] {
  return items.slice(0, limit).map((it, ordinal) => {
    const ref = typeof it.ref === "string" ? it.ref : "";
    const content = typeof it.content === "string" ? it.content : "";
    const safe = ref.length > 0 && Buffer.byteLength(ref, "utf8") <= RETRIEVAL_LIMITS.max_ref_bytes && !traceStringIsUnsafe(ref, literals);
    // The ref enters the fingerprint only when it is safe to store; content is the
    // project's own wiki/graph text, hashed so a use can name the exact result.
    const ref_sha256 = sha(JSON.stringify([safe ? ref : null, ordinal, sha(content)]));
    return { ordinal, ref: safe ? ref : null, ref_sha256 };
  });
}

function resultsDigest(results: RetrievalRecord["results"], resultCount: number | null, status: RetrievalStatus, allResults: string): string {
  return sha(JSON.stringify({ status, result_count: resultCount, results, all_results_sha256: allResults }));
}

function validContext(ctx: RetrievalContext): boolean {
  return (
    typeof ctx.runDir === "string" && path.isAbsolute(ctx.runDir) &&
    safeId(ctx.run_id, ctx.private_literals) &&
    ENTRY_POINTS.includes(ctx.entry_point) &&
    MODE_RE.test(ctx.mode ?? "") &&
    (ctx.use_capture === "supported" || ctx.use_capture === "unsupported") &&
    (ctx.query_id === undefined || safeQid(ctx.query_id, ctx.private_literals)) &&
    (ctx.identity === undefined || ((ctx.identity.kind === "retry" || ctx.identity.kind === "mirror") && safeQid(ctx.identity.of, ctx.private_literals) && ctx.identity.of !== ctx.query_id))
  );
}

function launchPathOf(ctx: RetrievalContext): LaunchPath {
  if (ctx.launch_path) return ctx.launch_path;
  return (process.env["GUILD_RUN_BINDING_REF"] ?? "") !== "" ? "stack_launch" : "non_stack";
}

function attemptOf(ctx: RetrievalContext): number {
  if (ctx.identity?.kind !== "retry") return 1;
  const prior = loadRecord(ctx.runDir, ctx.identity.of);
  return (prior?.record.identity.attempt ?? 1) + 1;
}

/**
 * Start one instrumented query: writes the start marker and reads the clocks.
 * Null only when the context is invalid (nothing can be recorded).
 */
export function beginRetrieval(query: string, ctx: RetrievalContext): RetrievalHandle | null {
  if (!validContext(ctx)) return null;
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  const query_id = ctx.query_id ?? `q-${crypto.randomBytes(16).toString("hex")}`;
  const startedAt = clock.wall();
  const startNs = clock.monotonicNs();
  const sanitized = sanitizeQuery(typeof query === "string" ? query : "", ctx);
  const dir = retrievalDir(ctx.runDir);

  const marker: StartedMarker = {
    schema_version: RETRIEVAL_STARTED_SCHEMA,
    query_id,
    run_id: ctx.run_id,
    entry_point: ctx.entry_point,
    started_at: startedAt,
  };
  // A fresh run directory is created under its existing parent, through containment.
  // The root is the nearest existing of `runs/` and the `.guild` dir above it.
  if (!fs.existsSync(ctx.runDir)) {
    const root = [path.dirname(ctx.runDir), path.dirname(path.dirname(ctx.runDir))].find((d) => fs.existsSync(d));
    if (root) prepareContainedWrite(root, path.join(ctx.runDir, "knowledge", "retrieval", "probe"));
  }
  const startOutcome = writeOnce(ctx.runDir, path.join(dir, `${query_id}.started.json`), Buffer.from(JSON.stringify(marker)));
  const startLoss: RetrievalLoss | null = startOutcome === "written" ? null : startOutcome === "containment" ? "containment" : startOutcome === "conflict" || startOutcome === "identical" ? "record_conflict" : "start_not_written";

  /** A query that ran but could not be recorded under its id leaves a fresh, unmatched start marker. */
  const markLost = () => {
    const lostId = `q-${crypto.randomBytes(16).toString("hex")}`;
    writeOnce(ctx.runDir, path.join(dir, `${lostId}.started.json`), Buffer.from(JSON.stringify({ ...marker, query_id: lostId })));
  };
  if (startLoss === "record_conflict") markLost();

  let done = false;
  const finish = (status: RetrievalStatus, items: readonly RetrievalItem[], errorCode: string | null, evidence?: RetrievalEvidence): CompleteResult => {
    if (done) return { record: null, loss: "record_conflict" };
    done = true;
    const endNs = clock.monotonicNs();
    const completedAt = clock.wall();
    if (startLoss) {
      // The query ran: leave an unmatched marker so coverage cannot read complete.
      if (startLoss !== "record_conflict") markLost();
      return { record: null, loss: startLoss };
    }
    const literals = ctx.private_literals ?? [];
    // A failed query asserts no generation: there is no evidence of what it read.
    const gen1 = status === "error"
      ? generationForEvidence(ctx.indexesDir, undefined, ctx.unbound_reason ?? "the query failed", literals)
      : generationForEvidence(ctx.indexesDir, evidence, ctx.unbound_reason, literals);
    const { source_id: pubSource, ...generation } = gen1;
    const results = status === "error" ? [] : resultEntries(items, literals);
    const every = status === "error" ? [] : resultEntries(items, literals, Number.MAX_SAFE_INTEGER);
    const allResults = sha(JSON.stringify(every.map((e) => e.ref_sha256)));
    const identityVerifiable = every.every((e) => e.ref !== null);
    const resultCount = status === "error" ? null : items.length;
    const record: RetrievalRecord = {
      schema_version: RETRIEVAL_RECORD_SCHEMA,
      query_id,
      run_id: ctx.run_id,
      source_id: pubSource ?? (safeId(ctx.source_id, literals) ? ctx.source_id : "local"),
      task_id: safeId(ctx.task_id, ctx.private_literals) ? ctx.task_id : null,
      entry_point: ctx.entry_point,
      launch_path: launchPathOf(ctx),
      mode: ctx.mode,
      identity: ctx.identity ? { kind: ctx.identity.kind, of: ctx.identity.of, attempt: attemptOf(ctx) } : { kind: "original", of: null, attempt: 1 },
      query: sanitized,
      generation,
      clock: {
        controller_started_at: startedAt,
        controller_completed_at: completedAt,
        monotonic: { clock: "process.hrtime", clock_ref: PROCESS_CLOCK_REF, start_ns: startNs.toString(), end_ns: endNs.toString() },
        duration_ms: endNs >= startNs ? Number((endNs - startNs) / 1000n) / 1000 : 0,
      },
      outcome: { status, result_count: resultCount, error_code: errorCode },
      results,
      results_truncated: status !== "error" && items.length > results.length,
      all_results_sha256: allResults,
      results_identity_verifiable: identityVerifiable,
      results_digest: resultsDigest(results, resultCount, status, allResults),
      use_capture: ctx.use_capture,
    };
    const bytes = Buffer.from(JSON.stringify(record));
    const out = writeOnce(ctx.runDir, path.join(dir, `${query_id}.json`), bytes);
    if (out === "written" || out === "identical") {
      // Explicit evidence that use capture is open for this query: without it, the
      // reader cannot tell an observed empty use set from lost use files.
      if (ctx.use_capture === "supported" && status !== "error") {
        const marker = { schema_version: USE_CAPTURE_SCHEMA, query_id, retrieval_sha256: sha(bytes) };
        writeOnce(ctx.runDir, path.join(usesDir(ctx.runDir), `${query_id}.capture.json`), Buffer.from(JSON.stringify(marker)));
      }
      return { record, loss: null };
    }
    if (out === "conflict") markLost();
    return { record: null, loss: out === "conflict" ? "record_conflict" : out === "containment" ? "containment" : "write_failed" };
  };

  return {
    query_id,
    complete: (items, evidence) => finish(items.length > 0 ? "hit" : "miss", items, null, evidence),
    fail: (code) => finish("error", [], ERROR_CODE_RE.test(code) ? code : "producer_error"),
  };
}

/**
 * Run `producer` as one instrumented query. Telemetry never changes the
 * producer's result or error; a capture failure is reported as `loss`.
 */
export function instrumentRetrieval<T>(
  query: string,
  ctx: RetrievalContext,
  producer: () => T,
  toItems: (result: T) => readonly RetrievalItem[] = (r) => r as unknown as readonly RetrievalItem[],
  evidenceOf?: (result: T) => RetrievalEvidence,
): { result: T; record: RetrievalRecord | null; loss: RetrievalLoss | null } {
  let handle: RetrievalHandle | null = null;
  try {
    handle = beginRetrieval(query, ctx);
  } catch {
    handle = null;
  }
  let result: T;
  try {
    result = producer();
  } catch (err) {
    try { handle?.fail("producer_threw"); } catch { /* telemetry never masks the producer error */ }
    throw err;
  }
  if (!handle) return { result, record: null, loss: "invalid_context" };
  try {
    const done = handle.complete(toItems(result), evidenceOf?.(result));
    return { result, ...done };
  } catch {
    return { result, record: null, loss: "write_failed" };
  }
}

// ── explicit use links ───────────────────────────────────────────────────────

export type UseRefusal = "invalid" | "dangling" | "record_invalid" | "use_unsupported" | "not_in_results" | "conflict" | "write_failed";

export type UseResult = { ok: true; use_id: string; written: boolean } | { ok: false; code: UseRefusal; detail: string };

function useIdOf(queryId: string, ordinal: number, kind: string, id: string): string {
  return `u-${crypto.createHash("sha256").update(JSON.stringify([queryId, ordinal, kind, id])).digest("hex").slice(0, 32)}`;
}

/** Record that `consumer` used result `ordinal` of query `query_id`. Idempotent per (query, result, consumer). */
export function recordKnowledgeUse(input: {
  runDir: string;
  query_id: string;
  ordinal: number;
  consumer: { kind: ConsumerKind; id: string };
  /** The capture's private-literal policy; a consumer id carrying one is refused. */
  private_literals?: readonly string[];
  clock?: Pick<RetrievalClock, "wall">;
}): UseResult {
  const { runDir, query_id, ordinal, consumer } = input;
  if (
    typeof runDir !== "string" || !path.isAbsolute(runDir) || !safeQid(query_id, input.private_literals) ||
    !Number.isInteger(ordinal) || ordinal < 0 ||
    !consumer || !CONSUMER_KINDS.includes(consumer.kind) || !safeId(consumer.id, input.private_literals)
  ) {
    return { ok: false, code: "invalid", detail: "query id, ordinal or consumer is not a safe identifier" };
  }
  const loaded = loadRecord(runDir, query_id);
  if (loaded === null) {
    return fs.existsSync(path.join(retrievalDir(runDir), `${query_id}.json`))
      ? { ok: false, code: "record_invalid", detail: "the retrieval record fails validation" }
      : { ok: false, code: "dangling", detail: "no retrieval record for this query" };
  }
  const { record, sha256 } = loaded;
  if (record.use_capture !== "supported") return { ok: false, code: "use_unsupported", detail: "this retrieval path does not capture use" };
  // The capture marker written with the record must bind these exact bytes.
  try {
    const m = JSON.parse(readContained(runDir, path.join(usesDir(runDir), `${query_id}.capture.json`))?.toString("utf8") ?? "null") as Record<string, unknown> | null;
    if (!m || m["schema_version"] !== USE_CAPTURE_SCHEMA || m["query_id"] !== query_id || m["retrieval_sha256"] !== sha256) {
      return { ok: false, code: "record_invalid", detail: "the record bytes are not the ones captured" };
    }
  } catch {
    return { ok: false, code: "record_invalid", detail: "the capture marker is unreadable" };
  }
  const result = record.results[ordinal];
  if (record.outcome.status !== "hit" || !result) return { ok: false, code: "not_in_results", detail: "the query did not return this result" };
  const use_id = useIdOf(query_id, ordinal, consumer.kind, consumer.id);
  const target = path.join(usesDir(runDir), `${use_id}.json`);
  const existing = readContained(runDir, target);
  if (existing !== null) {
    const prior = parseUse(existing);
    return prior && prior.use_id === use_id && prior.retrieval_sha256 === sha256
      ? { ok: true, use_id, written: false }
      : { ok: false, code: "conflict", detail: "a different use is recorded under this id" };
  }
  const use: KnowledgeUseRecord = {
    schema_version: KNOWLEDGE_USE_SCHEMA,
    use_id,
    query_id,
    run_id: record.run_id,
    retrieval_sha256: sha256,
    result: { ordinal, ref_sha256: result.ref_sha256 },
    consumer: { kind: consumer.kind, id: consumer.id },
    recorded_at: (input.clock ?? SYSTEM_CLOCK).wall(),
  };
  const out = writeOnce(runDir, target, Buffer.from(JSON.stringify(use)));
  if (out === "written") return { ok: true, use_id, written: true };
  if (out === "identical") return { ok: true, use_id, written: false };
  if (out === "conflict") {
    const prior = parseUse(readContained(runDir, target));
    if (prior && prior.use_id === use_id && prior.retrieval_sha256 === sha256) return { ok: true, use_id, written: false };
    return { ok: false, code: "conflict", detail: "a different use is recorded under this id" };
  }
  return { ok: false, code: "write_failed", detail: out };
}

// ── validation ───────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrOrNull = (v: unknown) => v === null || typeof v === "string";
const keysExactly = (o: Record<string, unknown>, keys: readonly string[]) => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => k.includes(x));
};

const GENERATION_STATES: readonly GenerationState[] = ["published", "unpublished", "export_unknown", "unreadable", "unbound"];
const CHANNEL_STATES: readonly ChannelState[] = ["current_for_basis", "pending", "stale", "unknown"];

const RECORD_KEYS = ["schema_version", "query_id", "run_id", "source_id", "task_id", "entry_point", "launch_path", "mode", "identity", "query", "generation", "clock", "outcome", "results", "results_truncated", "all_results_sha256", "results_identity_verifiable", "results_digest", "use_capture"] as const;

function validRecord(r: unknown, queryId: string): r is RetrievalRecord {
  if (!isObj(r) || !keysExactly(r, RECORD_KEYS) || r["schema_version"] !== RETRIEVAL_RECORD_SCHEMA) return false;
  if (r["query_id"] !== queryId || !safeQid(queryId) || !safeId(r["run_id"]) || !safeId(r["source_id"])) return false;
  if (!(r["task_id"] === null || safeId(r["task_id"]))) return false;
  if (!ENTRY_POINTS.includes(r["entry_point"] as RetrievalEntryPoint)) return false;
  if (r["launch_path"] !== "stack_launch" && r["launch_path"] !== "non_stack") return false;
  if (!isStr(r["mode"]) || !MODE_RE.test(r["mode"])) return false;
  if (r["use_capture"] !== "supported" && r["use_capture"] !== "unsupported") return false;
  const id = r["identity"];
  if (!isObj(id) || !["original", "retry", "mirror"].includes(id["kind"] as string) || !Number.isInteger(id["attempt"]) || (id["attempt"] as number) < 1) return false;
  if (!keysExactly(id, ["kind", "of", "attempt"]) || (id["kind"] === "original" ? id["of"] !== null || id["attempt"] !== 1 : !safeQid(id["of"]) || id["of"] === queryId)) return false;
  const q = r["query"];
  if (!isObj(q) || !keysExactly(q, ["sha256", "bytes", "redacted", "truncated", "withheld", "preview", "redaction_version"])) return false;
  if (!(q["sha256"] === null || isSha(q["sha256"])) || !isStrOrNull(q["preview"])) return false;
  if (!Number.isInteger(q["bytes"]) || (q["bytes"] as number) < 0 || q["redaction_version"] !== "guild.trace-scrub.v1") return false;
  if (typeof q["redacted"] !== "boolean" || typeof q["truncated"] !== "boolean" || typeof q["withheld"] !== "boolean") return false;
  if (typeof q["preview"] === "string" && (Buffer.byteLength(q["preview"], "utf8") > RETRIEVAL_LIMITS.max_preview_bytes || traceStringIsUnsafe(q["preview"], []))) return false;
  const g = r["generation"];
  if (!isObj(g) || !keysExactly(g, ["state", "generation", "publication_sha256", "recall_channel_state", "reason"])) return false;
  if (!GENERATION_STATES.includes(g["state"] as GenerationState) || !(g["generation"] === null || isSha(g["generation"]))) return false;
  if (!(g["publication_sha256"] === null || isSha(g["publication_sha256"])) || !isStrOrNull(g["reason"])) return false;
  if (typeof g["reason"] === "string" && traceStringIsUnsafe(g["reason"], [])) return false;
  if (!(g["recall_channel_state"] === null || CHANNEL_STATES.includes(g["recall_channel_state"] as ChannelState))) return false;
  if ((g["state"] === "published") !== (g["publication_sha256"] !== null)) return false;
  if ((g["state"] === "published") !== (g["generation"] !== null)) return false;
  const c = r["clock"];
  if (!isObj(c) || !keysExactly(c, ["controller_started_at", "controller_completed_at", "monotonic", "duration_ms"])) return false;
  if (!isIso(c["controller_started_at"]) || !isIso(c["controller_completed_at"])) return false;
  if (typeof c["duration_ms"] !== "number" || !Number.isFinite(c["duration_ms"]) || (c["duration_ms"] as number) < 0) return false;
  const mono = c["monotonic"];
  if (!isObj(mono) || !keysExactly(mono, ["clock", "start_ns", "end_ns", "clock_ref"]) || mono["clock"] !== "process.hrtime" || !isStr(mono["clock_ref"]) || !/^[a-f0-9]{16}$/.test(mono["clock_ref"])) return false;
  if (!isStr(mono["start_ns"]) || !isStr(mono["end_ns"]) || !/^\d{1,30}$/.test(mono["start_ns"]) || !/^\d{1,30}$/.test(mono["end_ns"])) return false;
  const durationNs = BigInt(String(mono["end_ns"])) - BigInt(String(mono["start_ns"]));
  if (durationNs < 0n || Number(durationNs / 1000n) / 1000 !== c["duration_ms"]) return false;
  const o = r["outcome"];
  if (!isObj(o) || !keysExactly(o, ["status", "result_count", "error_code"]) || typeof r["results_truncated"] !== "boolean") return false;
  const results = r["results"];
  if (!Array.isArray(results) || results.length > RETRIEVAL_LIMITS.max_results) return false;
  for (let i = 0; i < results.length; i++) {
    const e = results[i];
    if (!isObj(e) || !keysExactly(e, ["ordinal", "ref", "ref_sha256"]) || e["ordinal"] !== i || !isSha(e["ref_sha256"]) || !isStrOrNull(e["ref"])) return false;
    if (typeof e["ref"] === "string" && traceStringIsUnsafe(e["ref"], [])) return false;
  }
  const status = o["status"];
  if (status === "error") {
    if (o["result_count"] !== null || !isStr(o["error_code"]) || !ERROR_CODE_RE.test(o["error_code"]) || results.length !== 0 || r["results_truncated"] !== false) return false;
  } else {
    const n = o["result_count"];
    if (o["error_code"] !== null || !Number.isInteger(n) || (n as number) < 0) return false;
    if ((status === "hit") !== ((n as number) > 0) || (status !== "hit" && status !== "miss")) return false;
    if (results.length !== Math.min(n as number, RETRIEVAL_LIMITS.max_results)) return false;
    if (r["results_truncated"] !== ((n as number) > results.length)) return false;
  }
  if (!isSha(r["all_results_sha256"]) || typeof r["results_identity_verifiable"] !== "boolean") return false;
  if (r["results_identity_verifiable"] === true && (results as Array<Record<string, unknown>>).some((e) => e["ref"] === null)) return false;
  return r["results_digest"] === resultsDigest(results as RetrievalRecord["results"], o["result_count"] as number | null, status as RetrievalStatus, r["all_results_sha256"]);
}

function loadRecord(runDir: string, queryId: string): { record: RetrievalRecord; sha256: string } | null {
  if (!safeQid(queryId)) return null;
  const bytes = readContained(runDir, path.join(retrievalDir(runDir), `${queryId}.json`));
  if (bytes === null) return null;
  try {
    const r = JSON.parse(bytes.toString("utf8")) as unknown;
    return validRecord(r, queryId) ? { record: r, sha256: sha(bytes) } : null;
  } catch {
    return null;
  }
}

function parseUse(bytes: Buffer | null): KnowledgeUseRecord | null {
  if (bytes === null) return null;
  try {
    const u = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!isObj(u) || u["schema_version"] !== KNOWLEDGE_USE_SCHEMA) return null;
    if (!keysExactly(u, ["schema_version", "use_id", "query_id", "run_id", "retrieval_sha256", "result", "consumer", "recorded_at"])) return null;
    const res = u["result"];
    const con = u["consumer"];
    if (!safeQid(u["query_id"]) || !safeId(u["run_id"]) || !safeQid(u["use_id"]) || !SHA_RE.test(String(u["retrieval_sha256"])) || !isIso(u["recorded_at"])) return null;
    if (!isObj(res) || !keysExactly(res, ["ordinal", "ref_sha256"]) || !Number.isInteger(res["ordinal"]) || !isSha(res["ref_sha256"])) return null;
    if (!isObj(con) || !keysExactly(con, ["kind", "id"]) || !CONSUMER_KINDS.includes(con["kind"] as ConsumerKind) || !safeId(con["id"])) return null;
    return u as unknown as KnowledgeUseRecord;
  } catch {
    return null;
  }
}

// ── ledger read and M26 normalization ────────────────────────────────────────

export interface LedgerCoverage {
  eligible: number;
  covered: number;
  excluded: number;
  missing: number;
  state: "complete" | "partial" | "unavailable";
  reason: string | null;
  exclusion_reasons: Array<{ code: string; count: number }>;
}

export interface LedgerValue {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  coverage: LedgerCoverage;
  reason: string | null;
}

export interface LedgerGroup {
  /** Published generation the queries read; null when none was named. */
  generation: string | null;
  metrics: {
    query_count: LedgerValue;
    duplicate_count: LedgerValue;
    error_count: LedgerValue;
    retrieval_hit_ratio: LedgerValue;
    retrieval_latency_mean_ms: LedgerValue;
    retrieval_latency_p50_ms: LedgerValue;
    retrieval_latency_p95_ms: LedgerValue;
    retrieval_use_ratio: LedgerValue;
  };
}

export type LedgerLossCode = "started_not_completed" | "invalid_record" | "unverified_mirror" | "unverified_retry" | "dangling_use" | "forged_use" | "invalid_use" | "file_cap";

export interface RetrievalLedger {
  state: "available" | "unavailable";
  reason: string | null;
  records: RetrievalRecord[];
  uses: KnowledgeUseRecord[];
  losses: Array<{ code: LedgerLossCode; count: number }>;
  groups: LedgerGroup[];
}

function coverage(eligible: number, covered: number, exclusions: Record<string, number>, reason: string): LedgerCoverage {
  const excluded = Object.values(exclusions).reduce((a, b) => a + b, 0);
  const missing = Math.max(0, eligible - covered - excluded);
  const exclusion_reasons = Object.entries(exclusions).filter(([, n]) => n > 0).map(([code, count]) => ({ code, count })).sort((a, b) => (a.code < b.code ? -1 : 1));
  return {
    eligible, covered, excluded, missing,
    state: missing === 0 ? "complete" : covered === 0 ? "unavailable" : "partial",
    reason: missing === 0 ? null : reason,
    exclusion_reasons,
  };
}

const count = (n: number, cov: LedgerCoverage): LedgerValue => ({ value: cov.covered === 0 && cov.missing > 0 ? null : n, numerator: null, denominator: null, coverage: cov, reason: cov.reason });
const ratio = (num: number, den: number, cov: LedgerCoverage, reason: string | null = null): LedgerValue =>
  den === 0 ? { value: null, numerator: null, denominator: null, coverage: cov, reason: reason ?? "no covered queries" } : { value: num / den, numerator: num, denominator: den, coverage: cov, reason: reason ?? cov.reason };

/** Nearest-rank percentile over sorted values. */
function nearestRank(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

function listJson(dir: string, root: string): { names: string[]; capped: boolean; omitted: number } | null {
  try {
    const real = fs.realpathSync(dir);
    if (!real.startsWith(fs.realpathSync(root) + path.sep)) return { names: [], capped: true, omitted: 1 };
    const names = fs.readdirSync(real).filter((n) => n.endsWith(".json")).sort();
    return { names: names.slice(0, RETRIEVAL_LIMITS.max_files), capped: names.length > RETRIEVAL_LIMITS.max_files, omitted: Math.max(0, names.length - RETRIEVAL_LIMITS.max_files) };
  } catch (err) {
    // Absent is "nothing recorded"; anything else (unreadable) is unknown evidence.
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? null : { names: [], capped: true, omitted: 1 };
  }
}

/** Read and verify one run's retrieval ledger and normalize M26 per generation. */
export function readRetrievalLedger(runDir: string): RetrievalLedger {
  const listing = listJson(retrievalDir(runDir), runDir);
  if (listing === null) {
    return { state: "unavailable", reason: "no retrieval ledger for this run", records: [], uses: [], losses: [], groups: [] };
  }
  const losses = new Map<LedgerLossCode, number>();
  const lose = (c: LedgerLossCode, n = 1) => losses.set(c, (losses.get(c) ?? 0) + n);
  if (listing.capped) lose("file_cap", listing.omitted);

  // Queries known to exist without a verifiable record. Their generation is
  // unknown, so they make every group's coverage incomplete.
  let unattributed = 0;
  const started = new Set<string>();
  const recordIds: string[] = [];
  for (const n of listing.names) {
    if (n.endsWith(".started.json")) {
      const id = n.slice(0, -".started.json".length);
      if (safeQid(id)) started.add(id);
      else { lose("invalid_record"); unattributed++; }
    } else {
      const id = n.slice(0, -".json".length);
      if (safeQid(id)) recordIds.push(id);
      else { lose("invalid_record"); unattributed++; }
    }
  }

  const records: RetrievalRecord[] = [];
  const shaOf = new Map<string, string>();
  for (const id of recordIds) {
    const loaded = loadRecord(runDir, id);
    if (loaded) {
      records.push(loaded.record);
      shaOf.set(id, loaded.sha256);
    } else {
      lose("invalid_record");
      unattributed++;
    }
  }
  if (listing.capped) unattributed += listing.omitted;
  const have = new Set(recordIds);
  for (const id of started) {
    if (!have.has(id)) {
      lose("started_not_completed");
      unattributed++;
    }
  }

  const byId = new Map(records.map((r) => [r.query_id, r]));
  const sameScope = (a: RetrievalRecord, b: RetrievalRecord) =>
    a.run_id === b.run_id && a.source_id === b.source_id && a.mode === b.mode && a.query.sha256 !== null && a.query.sha256 === b.query.sha256;
  const verifiedMirror = (r: RetrievalRecord): boolean => {
    if (r.identity.kind !== "mirror") return false;
    const o = byId.get(r.identity.of!);
    return !!o && o.query_id !== r.query_id && o.identity.kind !== "mirror" && sameScope(o, r) &&
      o.results_identity_verifiable && r.results_identity_verifiable &&
      o.results_digest === r.results_digest && o.generation.generation === r.generation.generation;
  };
  const verifiedRetry = (r: RetrievalRecord): boolean => {
    const o = byId.get(r.identity.of!);
    return !!o && o.query_id !== r.query_id && o.identity.kind !== "mirror" && sameScope(o, r) && r.identity.attempt === o.identity.attempt + 1;
  };
  for (const r of records) {
    if (r.identity.kind === "mirror" && !verifiedMirror(r)) lose("unverified_mirror");
    if (r.identity.kind === "retry" && !verifiedRetry(r)) lose("unverified_retry");
  }

  // Uses: each must bind a valid record's bytes and one of its returned results.
  const uses: KnowledgeUseRecord[] = [];
  const usedQueries = new Set<string>();
  const captureOpen = new Set<string>();
  const ulist = listJson(usesDir(runDir), runDir);
  let useDefects = 0;
  if (ulist?.capped) { lose("file_cap", ulist.omitted); useDefects += ulist.omitted; }
  const unames = ulist?.names ?? [];
  for (const n of [...unames.filter((x) => x.endsWith(".capture.json")), ...unames.filter((x) => !x.endsWith(".capture.json"))]) {
    const bytes = readContained(runDir, path.join(usesDir(runDir), n));
    if (n.endsWith(".capture.json")) {
      const qid = n.slice(0, -".capture.json".length);
      try {
        const m = JSON.parse(bytes?.toString("utf8") ?? "null") as Record<string, unknown> | null;
        if (m && keysExactly(m, ["schema_version", "query_id", "retrieval_sha256"]) && m["schema_version"] === USE_CAPTURE_SCHEMA && m["query_id"] === qid && m["retrieval_sha256"] === shaOf.get(qid)) captureOpen.add(qid);
        else { lose("invalid_use"); useDefects++; }
      } catch { lose("invalid_use"); useDefects++; }
      continue;
    }
    const u = parseUse(bytes);
    if (!u || `${u.use_id}.json` !== n) { lose("invalid_use"); useDefects++; continue; }
    const rec = byId.get(u.query_id);
    if (!rec) { lose(have.has(u.query_id) ? "forged_use" : "dangling_use"); useDefects++; continue; }
    const res = rec.results[u.result.ordinal];
    const genuine =
      u.retrieval_sha256 === shaOf.get(u.query_id) && captureOpen.has(u.query_id) && u.run_id === rec.run_id && rec.use_capture === "supported" && rec.outcome.status === "hit" &&
      !!res && res.ref_sha256 === u.result.ref_sha256 && u.use_id === useIdOf(u.query_id, u.result.ordinal, u.consumer.kind, u.consumer.id);
    if (!genuine) { lose("forged_use"); useDefects++; continue; }
    uses.push(u);
    // A use of a verified mirror is a use of the query it mirrors.
    usedQueries.add(verifiedMirror(rec) ? rec.identity.of! : u.query_id);
  }

  const genKeys = new Set<string | null>(records.map((r) => r.generation.generation));
  if (unattributed > 0 && genKeys.size === 0) genKeys.add(null);
  const groups: LedgerGroup[] = [...genKeys]
    .sort((a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1))
    .map((gen) => {
      const inGen = records.filter((r) => r.generation.generation === gen);
      const lost = unattributed;
      const mirrors = inGen.filter(verifiedMirror);
      const originals = inGen.filter((r) => !verifiedMirror(r));
      const completed = originals.filter((r) => r.outcome.status !== "error");
      const errors = originals.length - completed.length;
      const hits = completed.filter((r) => r.outcome.status === "hit").length;
      const lat = completed.map((r) => r.clock.duration_ms).sort((a, b) => a - b);
      const latSum = lat.reduce((a, b) => a + b, 0);
      const lossReason = "queries started or recorded without a verifiable record";

      const qCov = coverage(completed.length + lost, completed.length, {}, lossReason);
      const dCov = coverage(inGen.length + lost, inGen.length, {}, lossReason);
      const eCov = coverage(originals.length + lost, originals.length, {}, lossReason);
      const hCov = coverage(originals.length + lost, completed.length, { error: errors }, lossReason);
      const supported = completed.filter((r) => r.use_capture === "supported");
      // Covered for use: capture open (marker bound to the record) and every
      // returned result linkable (not truncated).
      const useCovered = supported.filter((r) => captureOpen.has(r.query_id) && !r.results_truncated);
      const uReason = supported.length === 0 && completed.length > 0
        ? "producer does not support explicit use capture"
        : useCovered.length < supported.length ? "use capture evidence missing or results truncated" : lossReason;
      const uCov = coverage(completed.length + lost, useCovered.length, {}, uReason);
      const used = useCovered.filter((r) => usedQueries.has(r.query_id)).length;
      const p = (v: number | null): LedgerValue => ({ value: v, numerator: null, denominator: null, coverage: hCov, reason: v === null ? "no completed queries" : hCov.reason });
      return {
        generation: gen,
        metrics: {
          query_count: count(completed.length, qCov),
          duplicate_count: count(mirrors.length, dCov),
          error_count: count(errors, eCov),
          retrieval_hit_ratio: ratio(hits, completed.length, hCov),
          retrieval_latency_mean_ms: completed.length === 0 ? ratio(0, 0, hCov) : { value: latSum / completed.length, numerator: latSum, denominator: completed.length, coverage: hCov, reason: hCov.reason },
          retrieval_latency_p50_ms: p(nearestRank(lat, 0.5)),
          retrieval_latency_p95_ms: p(nearestRank(lat, 0.95)),
          // Unverifiable use evidence could belong to any query: the use ratio is
          // then unknown, while hit and latency stay observed.
          retrieval_use_ratio: useDefects > 0
            ? { value: null, numerator: null, denominator: null, coverage: coverage(completed.length + lost, 0, {}, "use evidence could not be verified"), reason: "use evidence could not be verified; hit and latency remain observed" }
            : useCovered.length === 0
            ? { value: null, numerator: null, denominator: null, coverage: uCov, reason: completed.length > 0 ? `${uReason}; hit and latency remain observed` : "no completed queries" }
            : ratio(used, useCovered.length, uCov),
        },
      };
    });

  return {
    state: "available",
    reason: null,
    records,
    uses,
    losses: [...losses.entries()].map(([code, n]) => ({ code, count: n })).sort((a, b) => (a.code < b.code ? -1 : 1)),
    groups,
  };
}

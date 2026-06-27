/**
 * scripts/lib/artifact-bus.ts
 *
 * The generalized **artifact bus** — the publish/consume substrate from
 * `v2-review-broker-and-artifact-bus.md §Group 1` (D-BUS-1..3). Ships the three
 * contracts the gap analysis flagged as `[post-v2]`:
 *
 *   - `guild.bus_event.v1`      — one NDJSON line in `bus/log.jsonl` (publish = append)
 *   - `guild.cas_meta.v1`       — content-addressed artifact header, `bus/cas/<aa>/<sha>.meta.yaml`
 *   - `guild.bus_subscriber.v1` — subscription registration, `bus/subscribers/<id>.yaml`
 *
 * Distinct from `bus-emit.ts` (the shipped `guild.agent_bus_event.v1` lifecycle
 * stream): different schema, different log, different reader (D-BUS-1 resolves G-E).
 *
 * v2.0 is **filesystem-canonical** (D-XHOST): co-located hosts share one `.guild/`
 * tree, so publish/consume/CAS are pure filesystem with no transport. The
 * `callback: webhook-url` subscriber path is the genuine remote-network carrier
 * (separate-machine HTTP pull) — recognized here but its transport is the
 * documented D-XHOST remote seam, not a filesystem operation.
 *
 * Concurrency: the log append + monotonic `seq` is taken under an mkdir-lock
 * (CR-D); CAS + subscriber writes are atomic temp-then-rename.
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import * as yaml from "js-yaml";

// ── Schema constants ───────────────────────────────────────────────────────

export const BUS_EVENT_SCHEMA = "guild.bus_event.v1" as const;
export const CAS_META_SCHEMA = "guild.cas_meta.v1" as const;
export const BUS_SUBSCRIBER_SCHEMA = "guild.bus_subscriber.v1" as const;

/** Topic type prefix — `<type>/<scope>/<resource>`. */
export const TOPIC_TYPES = [
  "handoff",
  "status",
  "context",
  "review",
  "approval",
  "heartbeat",
] as const;
export type TopicType = (typeof TOPIC_TYPES)[number];

/** Event values are the ADR's canonical `artifact.<kind>` forms (D-BUS-1, D-BUS-4). */
export const BUS_EVENT_KINDS = [
  "artifact.published",
  "artifact.streaming",
  "artifact.closed",
  "artifact.retracted",
] as const;
export type BusEventKind = (typeof BUS_EVENT_KINDS)[number];
export type SubscriberCallback = "hook" | "poll" | "webhook-url";

export interface BusPublisher {
  host_id: string;
  role: string;
}

export interface BusEventV1 {
  schema_version: typeof BUS_EVENT_SCHEMA;
  seq: number;
  topic: string;
  event: BusEventKind;
  artifact_id: string;
  sha256: string | null;
  path: string | null;
  byte_offset: number | null;
  publisher: BusPublisher;
  ts: string;
}

export interface CasMetaV1 {
  schema_version: typeof CAS_META_SCHEMA;
  sha256: string;
  type: TopicType;
  topic: string;
  run_id: string;
  writer: BusPublisher;
  path: string | null;
  created_at: string;
  ref_count: number;
}

export interface BusSubscriberV1 {
  schema_version: typeof BUS_SUBSCRIBER_SCHEMA;
  subscriber_id: string;
  host_id: string;
  topics: string[];
  callback: SubscriberCallback;
  created_at: string;
}

// ── Paths ──────────────────────────────────────────────────────────────────

export function busDir(runDir: string): string {
  return path.join(runDir, "bus");
}
export function busLogPath(runDir: string): string {
  return path.join(busDir(runDir), "log.jsonl");
}
export function casMetaPath(runDir: string, sha256: string): string {
  return path.join(busDir(runDir), "cas", sha256.slice(0, 2), `${sha256}.meta.yaml`);
}
export function subscriberPath(runDir: string, subscriberId: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(subscriberId)) {
    throw new Error(`unsafe subscriber_id: ${JSON.stringify(subscriberId)}`);
  }
  return path.join(busDir(runDir), "subscribers", `${subscriberId}.yaml`);
}

// ── Hashing ────────────────────────────────────────────────────────────────

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

// ── Topic helpers ──────────────────────────────────────────────────────────

/** A topic is a `<type>/<scope>/<resource>` triple with a known type prefix. */
export function isValidTopic(topic: string): boolean {
  const parts = topic.split("/");
  if (parts.length < 3) return false;
  if (!(TOPIC_TYPES as readonly string[]).includes(parts[0])) return false;
  return parts.every((p) => p.length > 0);
}

/** The artifact `type` of a topic is its first segment. */
export function topicType(topic: string): TopicType | null {
  const t = topic.split("/")[0];
  return (TOPIC_TYPES as readonly string[]).includes(t) ? (t as TopicType) : null;
}

/**
 * Glob match a subscriber topic pattern against a concrete topic. `*` matches a
 * single whole segment; `**` (only as the final segment) matches the rest.
 * Examples: `handoff/backend/*` ✓ `handoff/backend/T2`; `handoff/**` ✓ any handoff.
 */
export function matchTopic(pattern: string, topic: string): boolean {
  const pp = pattern.split("/");
  const tp = topic.split("/");
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === "**") return i === pp.length - 1; // trailing ** swallows the rest
    if (i >= tp.length) return false;
    if (pp[i] === "*") continue; // one-segment wildcard
    if (pp[i] !== tp[i]) return false;
  }
  return pp.length === tp.length;
}

// ── Validators (fail-closed; never throw) ──────────────────────────────────

function isPublisher(v: unknown): v is BusPublisher {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as BusPublisher).host_id === "string" &&
    typeof (v as BusPublisher).role === "string"
  );
}

export function validateBusEventV1(obj: unknown): BusEventV1 | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o.schema_version !== BUS_EVENT_SCHEMA) return null;
  if (typeof o.seq !== "number" || !Number.isInteger(o.seq) || o.seq < 0) return null;
  if (typeof o.topic !== "string" || !isValidTopic(o.topic)) return null;
  if (!(BUS_EVENT_KINDS as readonly string[]).includes(o.event as string)) return null;
  if (typeof o.artifact_id !== "string" || o.artifact_id.length === 0) return null;
  if (!(o.sha256 === null || typeof o.sha256 === "string")) return null;
  if (!(o.path === null || typeof o.path === "string")) return null;
  if (!(o.byte_offset === null || typeof o.byte_offset === "number")) return null;
  if (!isPublisher(o.publisher)) return null;
  if (typeof o.ts !== "string" || o.ts.length === 0) return null;
  return {
    schema_version: BUS_EVENT_SCHEMA,
    seq: o.seq,
    topic: o.topic,
    event: o.event as BusEventKind,
    artifact_id: o.artifact_id,
    sha256: (o.sha256 as string | null) ?? null,
    path: (o.path as string | null) ?? null,
    byte_offset: (o.byte_offset as number | null) ?? null,
    publisher: o.publisher as BusPublisher,
    ts: o.ts,
  };
}

export function validateCasMetaV1(obj: unknown): CasMetaV1 | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o.schema_version !== CAS_META_SCHEMA) return null;
  if (typeof o.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(o.sha256)) return null;
  if (!(TOPIC_TYPES as readonly string[]).includes(o.type as string)) return null;
  if (typeof o.topic !== "string" || !isValidTopic(o.topic)) return null;
  if (typeof o.run_id !== "string" || o.run_id.length === 0) return null;
  if (!isPublisher(o.writer)) return null;
  if (!(o.path === null || typeof o.path === "string")) return null;
  if (typeof o.created_at !== "string" || o.created_at.length === 0) return null;
  if (typeof o.ref_count !== "number" || !Number.isInteger(o.ref_count) || o.ref_count < 0) return null;
  return {
    schema_version: CAS_META_SCHEMA,
    sha256: o.sha256,
    type: o.type as TopicType,
    topic: o.topic,
    run_id: o.run_id,
    writer: o.writer as BusPublisher,
    path: (o.path as string | null) ?? null,
    created_at: o.created_at,
    ref_count: o.ref_count,
  };
}

export function validateBusSubscriberV1(obj: unknown): BusSubscriberV1 | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o.schema_version !== BUS_SUBSCRIBER_SCHEMA) return null;
  if (typeof o.subscriber_id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(o.subscriber_id)) return null;
  if (typeof o.host_id !== "string" || o.host_id.length === 0) return null;
  if (!Array.isArray(o.topics) || o.topics.length === 0 || !o.topics.every((t) => typeof t === "string" && t.length > 0)) {
    return null;
  }
  if (!["hook", "poll", "webhook-url"].includes(o.callback as string)) return null;
  if (typeof o.created_at !== "string" || o.created_at.length === 0) return null;
  return {
    schema_version: BUS_SUBSCRIBER_SCHEMA,
    subscriber_id: o.subscriber_id,
    host_id: o.host_id,
    topics: o.topics as string[],
    callback: o.callback as SubscriberCallback,
    created_at: o.created_at,
  };
}

// ── Atomic write + mkdir-lock (CR-D) ───────────────────────────────────────

function atomicWrite(target: string, data: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${sha256(target + data).slice(0, 8)}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}

/** Thrown when the bus lock cannot be acquired within the deadline (fail-closed). */
export class BusLockTimeout extends Error {
  constructor(runDir: string) {
    super(`artifact-bus: could not acquire ${path.join(busDir(runDir), ".lock")} within timeout`);
    this.name = "BusLockTimeout";
  }
}

/** Synchronous ~1ms sleep (no busy-burn) — Atomics.wait on a throwaway buffer. */
function sleepMs(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SharedArrayBuffer unavailable — fall through to a tight retry */
  }
}

/**
 * Exclusive lock for the seq+append critical section. Atomic `O_CREAT|O_EXCL`
 * lock file — only one holder at a time, and the lock is **only ever removed by
 * its own holder** (in `finally`). There is deliberately NO stale/dead reclaim:
 * any reclaim must momentarily inspect or move the lock, which opens a window for
 * a third acquirer — so we don't. Acquisition is therefore the single source of
 * mutual exclusion. FAILS CLOSED: on timeout it THROWS (publisher returns null,
 * retries) rather than entering the section. The critical section is a few
 * syscalls (microseconds), so contention clears fast; the only way to wedge the
 * bus is a holder crash *inside* that microsecond window — a non-corrupting,
 * loud failure (subsequent publishes return null) recoverable by removing the
 * lone `bus/.lock`, never a silent double-write.
 */
function withLock<T>(runDir: string, fn: () => T): T {
  const lock = path.join(busDir(runDir), ".lock");
  fs.mkdirSync(busDir(runDir), { recursive: true });
  const deadline = Date.now() + 5000;
  let fd: number | null = null;
  for (;;) {
    try {
      fd = fs.openSync(lock, "wx"); // atomic exclusive create — the ONLY acquire path
      fs.writeSync(fd, String(process.pid));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; // real error (perm/IO)
      if (Date.now() > deadline) throw new BusLockTimeout(runDir);
      sleepMs(2); // held by another publisher — wait and retry
    }
  }
  try {
    return fn();
  } finally {
    try {
      if (fd !== null) fs.closeSync(fd);
      fs.unlinkSync(lock); // removes OUR lock (no reclaim ⇒ it is always ours)
    } catch {
      /* already released */
    }
  }
}

// ── CAS — content-addressed artifact headers (D-BUS-3) ──────────────────────

/**
 * Idempotent content-addressed write: hash `content`, write the `cas_meta.v1`
 * header at `bus/cas/<aa>/<sha>.meta.yaml` (skip if present), return the sha.
 * The CAS indexes the META; the artifact body stays at `meta.path`.
 */
export function casPut(
  runDir: string,
  content: string | Buffer,
  meta: { type: TopicType; topic: string; runId: string; writer: BusPublisher; path: string | null; now: () => string },
): string {
  const hash = sha256(content);
  const out = casMetaPath(runDir, hash);
  const record: CasMetaV1 = {
    schema_version: CAS_META_SCHEMA,
    sha256: hash,
    type: meta.type,
    topic: meta.topic,
    run_id: meta.runId,
    writer: meta.writer,
    path: meta.path,
    created_at: meta.now(),
    ref_count: 1,
  };
  // Idempotent + race-free create (D-BUS-3 "skip if present"): write a temp file
  // then hard-LINK it into place. linkSync is atomic and fails with EEXIST if the
  // target already exists — so concurrent identical publishes never overwrite each
  // other's CAS header (the existsSync+rename window is gone). Reference counting is
  // by the bus entries citing the sha (`refCount()`), not by mutating this file.
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.tmp-${process.pid}-${sha256(out + record.created_at).slice(0, 8)}`;
  fs.writeFileSync(tmp, yaml.dump(record));
  try {
    fs.linkSync(tmp, out); // atomic; EEXIST ⇒ another publisher already indexed it
  } catch (e) {
    // Only EEXIST is the benign idempotent case (entry already present). Any other
    // link error (EACCES, ENOSPC, …) is a real failure — rethrow so a failed CAS
    // write is never silently reported as success. (`finally` cleans up the temp.)
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* temp already gone */
    }
  }
  return hash;
}

/**
 * GC ref-count for a CAS entry = the number of non-retracted bus events citing
 * its sha (D-BUS-3, "two lanes emitting an identical bundle write one CAS entry
 * referenced by two bus entries"). Derived from the log, so it can never drift.
 */
export function refCount(runDir: string, sha256Hex: string): number {
  return readBusLog(runDir).filter(
    (e) => e.sha256 === sha256Hex && e.event !== "artifact.retracted",
  ).length;
}

export function casGet(runDir: string, sha256Hex: string): CasMetaV1 | null {
  try {
    return validateCasMetaV1(yaml.load(fs.readFileSync(casMetaPath(runDir, sha256Hex), "utf8")));
  } catch {
    return null;
  }
}

/** Verify candidate content matches a CAS entry's address (tamper detection). */
export function casVerify(runDir: string, sha256Hex: string, content: string | Buffer): boolean {
  return sha256(content) === sha256Hex && casGet(runDir, sha256Hex) !== null;
}

// ── Publish / read (D-BUS-1) ────────────────────────────────────────────────

export interface PublishInput {
  runId: string;
  topic: string;
  /** published (default) | streaming | closed | retracted. */
  event?: BusEventKind;
  /** The artifact body — CAS-hashed. Omit for a retraction/streaming-marker with no body. */
  content?: string | Buffer;
  /** On-disk path of the artifact body (recorded in the event + CAS meta). */
  artifactPath?: string | null;
  /** Streaming chunk byte offset (D-BUS-4); null for whole artifacts. */
  byteOffset?: number | null;
  publisher: BusPublisher;
  now: () => string;
}

/**
 * Publish one artifact: hash + CAS-index the body (when present), then append a
 * `bus_event.v1` line to `bus/log.jsonl` with a monotonic per-run `seq`. The
 * append + seq are taken under the bus lock so concurrent publishers never reuse
 * a seq. Returns the written event, or null if the topic is invalid (fail-closed).
 */
export function publish(runDir: string, input: PublishInput): BusEventV1 | null {
  if (!isValidTopic(input.topic)) return null;
  const type = topicType(input.topic)!;
  const event = input.event ?? "artifact.published";
  // Fail-closed: reject an unknown event kind before any write.
  if (!(BUS_EVENT_KINDS as readonly string[]).includes(event)) return null;
  if (typeof input.runId !== "string" || input.runId.length === 0) return null;
  if (!input.publisher || typeof input.publisher.host_id !== "string" || typeof input.publisher.role !== "string") {
    return null;
  }
  let hash: string | null = null;
  if (input.content !== undefined && event !== "artifact.retracted") {
    hash = casPut(runDir, input.content, {
      type,
      topic: input.topic,
      runId: input.runId,
      writer: input.publisher,
      path: input.artifactPath ?? null,
      now: input.now,
    });
  }
  try {
    return withLock(runDir, () => {
      const seq = nextSeq(runDir);
      const record: BusEventV1 = {
        schema_version: BUS_EVENT_SCHEMA,
        seq,
        topic: input.topic,
        event,
        artifact_id: `${input.topic.replace(/\//g, ":")}:${input.runId}`,
        sha256: hash,
        path: input.artifactPath ?? null,
        byte_offset: input.byteOffset ?? null,
        publisher: input.publisher,
        ts: input.now(),
      };
      // Validate the assembled record before it touches disk (no invalid line ever written).
      if (!validateBusEventV1(record)) return null;
      fs.mkdirSync(busDir(runDir), { recursive: true });
      fs.appendFileSync(busLogPath(runDir), JSON.stringify(record) + "\n");
      return record;
    });
  } catch (err) {
    if (err instanceof BusLockTimeout) return null; // contended → caller retries
    throw err;
  }
}

/** Next monotonic seq = (max existing seq) + 1. Called under the bus lock. */
function nextSeq(runDir: string): number {
  const events = readBusLog(runDir);
  return events.reduce((m, e) => Math.max(m, e.seq), -1) + 1;
}

/** Read + validate every event in `bus/log.jsonl` (malformed lines skipped). */
export function readBusLog(runDir: string): BusEventV1[] {
  let raw: string;
  try {
    raw = fs.readFileSync(busLogPath(runDir), "utf8");
  } catch {
    return [];
  }
  const out: BusEventV1[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = validateBusEventV1(JSON.parse(line));
      if (ev) out.push(ev);
    } catch {
      /* skip malformed line (lenient reader) */
    }
  }
  return out;
}

/** Poll path: events with seq strictly greater than `sinceSeq`. */
export function tailBusLog(runDir: string, sinceSeq: number): BusEventV1[] {
  return readBusLog(runDir).filter((e) => e.seq > sinceSeq);
}

// ── Subscribers + fan-out (D-BUS-2) ─────────────────────────────────────────

export function registerSubscriber(
  runDir: string,
  sub: Omit<BusSubscriberV1, "schema_version" | "created_at"> & { now: () => string },
): BusSubscriberV1 | null {
  const record: BusSubscriberV1 = {
    schema_version: BUS_SUBSCRIBER_SCHEMA,
    subscriber_id: sub.subscriber_id,
    host_id: sub.host_id,
    topics: sub.topics,
    callback: sub.callback,
    created_at: sub.now(),
  };
  if (!validateBusSubscriberV1(record)) return null;
  atomicWrite(subscriberPath(runDir, record.subscriber_id), yaml.dump(record));
  return record;
}

export function readSubscribers(runDir: string): BusSubscriberV1[] {
  const dir = path.join(busDir(runDir), "subscribers");
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: BusSubscriberV1[] = [];
  for (const name of entries) {
    if (!name.endsWith(".yaml")) continue;
    try {
      const sub = validateBusSubscriberV1(yaml.load(fs.readFileSync(path.join(dir, name), "utf8")));
      if (sub) out.push(sub);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/**
 * Resolve which subscribers an event should fire: any whose topic glob matches.
 * The caller fires the callback (the `TaskCompleted` hook fires `hook`; a `poll`
 * subscriber tails the log itself; `webhook-url` is the deferred D-XHOST remote
 * seam). Returns matches partitioned by callback kind for the hook to act on.
 */
export function fanout(
  runDir: string,
  event: BusEventV1,
): { hook: BusSubscriberV1[]; poll: BusSubscriberV1[]; webhook: BusSubscriberV1[] } {
  const matched = readSubscribers(runDir).filter((s) =>
    s.topics.some((pat) => matchTopic(pat, event.topic)),
  );
  return {
    hook: matched.filter((s) => s.callback === "hook"),
    poll: matched.filter((s) => s.callback === "poll"),
    webhook: matched.filter((s) => s.callback === "webhook-url"),
  };
}

const FANOUT_CURSOR = ".fanout-cursor";
const FANOUT_LOG = "fanout.jsonl";

/**
 * D-BUS-2 push fan-out, driven by the `TaskCompleted` hook: process every bus
 * event newer than the persisted cursor, match it against the subscriber registry,
 * and record one fan-out delivery per matched `hook` subscriber to `bus/fanout.jsonl`
 * (the orchestrator/hook IS the handler — this is the notification record). `poll`
 * subscribers tail the log themselves (no push); `webhook-url` is the deferred
 * D-XHOST remote seam (recorded as `deferred`, never called from a hook). Cursor is
 * advanced under the bus lock so concurrent hook invocations don't double-deliver.
 * Best-effort + non-throwing — returns counts, swallows a lock-timeout.
 */
export function processFanout(
  runDir: string,
  now: () => string,
): { processed: number; delivered: number; deferred: number } {
  if (!fs.existsSync(busLogPath(runDir))) return { processed: 0, delivered: 0, deferred: 0 };
  try {
    return withLock(runDir, () => {
      const cursorPath = path.join(busDir(runDir), FANOUT_CURSOR);
      let cursor = -1;
      try {
        cursor = Number(fs.readFileSync(cursorPath, "utf8").trim());
        if (!Number.isFinite(cursor)) cursor = -1;
      } catch {
        /* no cursor yet */
      }
      const fresh = readBusLog(runDir).filter((e) => e.seq > cursor);
      let delivered = 0;
      let deferred = 0;
      let maxSeq = cursor;
      const lines: string[] = [];
      for (const ev of fresh) {
        maxSeq = Math.max(maxSeq, ev.seq);
        const out = fanout(runDir, ev);
        for (const s of out.hook) {
          lines.push(JSON.stringify({ seq: ev.seq, topic: ev.topic, subscriber_id: s.subscriber_id, callback: "hook", status: "delivered", ts: now() }));
          delivered += 1;
        }
        for (const s of out.webhook) {
          lines.push(JSON.stringify({ seq: ev.seq, topic: ev.topic, subscriber_id: s.subscriber_id, callback: "webhook-url", status: "deferred", ts: now() }));
          deferred += 1;
        }
      }
      if (lines.length > 0) fs.appendFileSync(path.join(busDir(runDir), FANOUT_LOG), lines.join("\n") + "\n");
      if (maxSeq > cursor) atomicWrite(cursorPath, String(maxSeq));
      return { processed: fresh.length, delivered, deferred };
    });
  } catch (err) {
    if (err instanceof BusLockTimeout) return { processed: 0, delivered: 0, deferred: 0 };
    throw err;
  }
}

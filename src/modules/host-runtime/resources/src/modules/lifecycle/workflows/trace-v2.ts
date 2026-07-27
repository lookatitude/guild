// CANONICAL: Guild telemetry recorder — v2 fields (F-3 / ADR v2-observability §F-3).
// Single source of truth; scripts import this copy via ../hooks/lib/v1.4/.
// Do not re-vendor.

/**
 * hooks/lib/trace-v2.ts
 *
 * guild.trace_event.v2 + guild.trace_payload.v1 — the OBSERVABILITY extension
 * (D-OBS-1 additive fields · D-OBS-6 deterministic span ids · D-OBS-2 payload
 * sidecar). Shared by the events.ndjson channel (capture-telemetry.ts) and the
 * v1.4 structured-log channel (lib/v1.4/log-jsonl.ts appendEvent).
 *
 * ── BIND BY POINTER ──
 *   - ADR: ADR: v2-observability-and-replay (workspace wiki)
 *     (D-OBS-1 additive event fields · D-OBS-2 payload sidecar · D-OBS-6
 *      deterministic hook-side span ids).
 *   - Contracts registered in contract-map §B-post:
 *       guild.trace_event.v2   — additive sibling of the FROZEN v1 trace event.
 *                                 The v1 field set is UNCHANGED; every v2 field
 *                                 below is OPTIONAL and absence is valid. A v2
 *                                 field is NEVER serialized as null (omit it).
 *       guild.trace_payload.v1 — the redacted structured sidecar body that
 *                                 payload_ref points at.
 *   - Redaction gatekeeper: this module never re-implements redaction. Callers
 *     inject the composed gatekeeper (hooks/lib/v1.4/redact-log.ts redactField
 *     ∘ hooks/lib/security/secrets.ts applySecretsPolicy). Raw provider prompts
 *     are NEVER stored — only the already-scrubbed structured body is written.
 *
 * Pure + dependency-light: the only side effect is writePayloadSidecar's file
 * write under <runDir>/logs/payloads/. Everything else is deterministic and
 * unit-testable with injected env.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/** Contract identity constants (bound by pointer, see header). */
export const TRACE_EVENT_SCHEMA = "guild.trace_event.v2" as const;
export const TRACE_PAYLOAD_SCHEMA = "guild.trace_payload.v1" as const;

/** Whole-sidecar byte guard so a single event cannot balloon the run dir (§10.5). */
export const SIDECAR_MAX_BYTES = 16 * 1024; // 16 KiB

/**
 * guild.trace_event.v2 token sub-object. Present ONLY on LLM-call events
 * (D-OBS-1). Every field is optional; a tokens object with no numeric field
 * collapses to `undefined` (omitted) rather than `{}`.
 */
export interface TraceTokens {
  input?: number;
  output?: number;
  cached?: number;
  cost_usd?: number;
}

/**
 * The additive guild.trace_event.v2 field set. All optional; merged onto the
 * frozen v1 event by the caller. Undefined fields are pruned before serialize.
 */
export interface TraceV2Fields {
  span_id?: string;
  parent_span_id?: string;
  tier?: string;
  model?: string;
  tokens?: TraceTokens;
  payload_ref?: string;
}

// ── span_id (D-OBS-6) ────────────────────────────────────────────────────────

/**
 * Deterministic hook-side span id: sha256(run_id|event_type|ts|actor_id)
 * sliced to the first 16 hex chars. Stable for identical inputs so the same
 * event re-derives the same span across re-reads; distinct events (different
 * ts/type/actor) get distinct spans. actor_id falls back to "main" for the
 * top-level session.
 */
export function genSpanId(
  runId: string,
  eventType: string,
  ts: string,
  actorId: string,
): string {
  const material = `${runId}|${eventType}|${ts}|${actorId || "main"}`;
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 16);
}

// ── token extraction ─────────────────────────────────────────────────────────

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Normalize a payload-supplied token/usage object to the canonical
 * {input,output,cached,cost_usd} shape. Accepts both the canonical keys and the
 * Anthropic-style usage keys (input_tokens / output_tokens /
 * cache_read_input_tokens). Returns undefined when no numeric field is present
 * so the caller omits the `tokens` object entirely.
 */
export function normalizeTokens(raw: unknown): TraceTokens | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: TraceTokens = {};
  const input = num(r["input"]) ?? num(r["input_tokens"]);
  const output = num(r["output"]) ?? num(r["output_tokens"]);
  const cached =
    num(r["cached"]) ?? num(r["cache_read_input_tokens"]) ?? num(r["cached_tokens"]);
  const cost = num(r["cost_usd"]) ?? num(r["cost"]);
  if (input !== undefined) out.input = input;
  if (output !== undefined) out.output = output;
  if (cached !== undefined) out.cached = cached;
  if (cost !== undefined) out.cost_usd = cost;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Event types for which `tokens` is meaningful (an LLM actually ran). tokens is
 * attached only when the event is an LLM-call AND the payload carried usage.
 */
const LLM_CALL_EVENTS: ReadonlySet<string> = new Set([
  "SubagentStop",
  "loop_round_start",
  "loop_round_end",
  "codex_review_round",
  "specialist_dispatch",
  "specialist_receipt",
]);

export function isLlmCallEvent(eventType: string): boolean {
  return LLM_CALL_EVENTS.has(eventType);
}

// ── v2 field resolution ──────────────────────────────────────────────────────

export interface ResolveTraceOpts {
  runId: string;
  eventType: string;
  ts: string;
  actorId: string;
  /** Defaults to process.env; injectable for tests. */
  env?: NodeJS.ProcessEnv;
  /** Fallback model when GUILD_MODEL is unset (e.g. payload.model). */
  payloadModel?: string;
  /** Already gated to LLM-call events by the caller; omitted otherwise. */
  tokens?: TraceTokens;
  /** Relative sidecar pointer when a payload sidecar was written. */
  payloadRef?: string;
}

function envStr(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Resolve the guild.trace_event.v2 additive fields from env + payload.
 *   span_id        — always (deterministic).
 *   parent_span_id — GUILD_PARENT_SPAN_ID (env-threaded).
 *   tier           — GUILD_TIER.
 *   model          — GUILD_MODEL, else payloadModel.
 *   tokens         — opts.tokens (caller pre-gates to LLM calls).
 *   payload_ref    — opts.payloadRef.
 * Returns only defined fields (undefined keys are absent, never null).
 */
export function resolveTraceV2Fields(opts: ResolveTraceOpts): TraceV2Fields {
  const env = opts.env ?? process.env;
  const out: TraceV2Fields = {
    span_id: genSpanId(opts.runId, opts.eventType, opts.ts, opts.actorId),
  };
  const parent = envStr(env, "GUILD_PARENT_SPAN_ID");
  if (parent !== undefined) out.parent_span_id = parent;
  const tier = envStr(env, "GUILD_TIER");
  if (tier !== undefined) out.tier = tier;
  const model = envStr(env, "GUILD_MODEL") ?? opts.payloadModel;
  if (typeof model === "string" && model.length > 0) out.model = model;
  if (opts.tokens !== undefined) out.tokens = opts.tokens;
  if (typeof opts.payloadRef === "string" && opts.payloadRef.length > 0) {
    out.payload_ref = opts.payloadRef;
  }
  return out;
}

/** Strip undefined values so they never serialize (absence valid, no null). */
export function pruneUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

// ── payload sidecar (D-OBS-2) ────────────────────────────────────────────────

/** Absolute path of the per-event redacted payload sidecar. */
export function payloadSidecarPath(runDir: string, evtId: string): string {
  return path.join(runDir, "logs", "payloads", `${evtId}.json`);
}

/** Relative payload_ref pointer stored on the trace event. */
export function payloadRef(evtId: string): string {
  return `logs/payloads/${evtId}.json`;
}

/** Recursively apply the injected redactor to every string leaf of `value`. */
function redactDeep(value: unknown, redact: (s: string) => string): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, redact);
    }
    return out;
  }
  return value;
}

export interface PayloadSidecarInput {
  runId: string;
  spanId: string;
  parentSpanId?: string;
  eventType: string;
  ts: string;
  actorId: string;
  /** Structured body. Every string leaf is run through `redact` before write. */
  body: Record<string, unknown>;
}

/**
 * Write a guild.trace_payload.v1 sidecar under <runDir>/logs/payloads/<evt-id>.json.
 * The body is redacted via the injected gatekeeper before write — raw provider
 * prompts are never stored. Returns the relative payload_ref on success, or
 * undefined on any failure (telemetry must never block).
 *
 * @param redact composed redaction gatekeeper (built-ins ∘ secrets_policy).
 */
export function writePayloadSidecar(
  runDir: string,
  evtId: string,
  input: PayloadSidecarInput,
  redact: (s: string) => string,
): string | undefined {
  try {
    const record: Record<string, unknown> = {
      schema_version: TRACE_PAYLOAD_SCHEMA,
      evt_id: evtId,
      span_id: input.spanId,
      run_id: input.runId,
      event: input.eventType,
      ts: input.ts,
      actor_id: input.actorId || "main",
      body: redactDeep(input.body, redact),
    };
    if (input.parentSpanId !== undefined) record["parent_span_id"] = input.parentSpanId;

    let serialized = JSON.stringify(record);
    // Whole-sidecar guard: if redaction still left an oversized body, drop it
    // to a truncation marker rather than ballooning the run dir (§10.5).
    if (Buffer.byteLength(serialized, "utf8") > SIDECAR_MAX_BYTES) {
      record["body"] = { truncated: true, reason: "sidecar exceeded SIDECAR_MAX_BYTES" };
      serialized = JSON.stringify(record);
    }

    const file = payloadSidecarPath(runDir, evtId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serialized + "\n", "utf8");
    return payloadRef(evtId);
  } catch {
    return undefined;
  }
}

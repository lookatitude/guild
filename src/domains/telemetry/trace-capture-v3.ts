/**
 * src/domains/telemetry/trace-capture-v3.ts — T01 bounded trace capture with
 * provenance (`guild.trace.analysis.v3`, storage `runs/<run_id>/trace.jsonl`).
 *
 * Input is a host observation (`guild.host_trace_observation.v1`): untrusted
 * bytes a host adapter forwards. Output is an append-only v3 trace, scrubbed
 * prompt/handoff/dispatch sidecars, and a capture manifest of loss counters.
 *
 * Provenance: every lineage join (session, task, attempt, instance, goal, pins)
 * comes from the caller's TraceAuthority, which lifecycle builds from the R01
 * records. A host may only name ids the authority already holds; a foreign run,
 * a foreign execution, or an id bound elsewhere refuses. Requested and observed
 * model are separate: the observed identity exists only when the provider
 * reported both provider and model, and it never falls back to the requested one.
 *
 * Capture safety: content is scrubbed to a fixed point, then truncated to the
 * sidecar cap, then scrubbed again. The original is not retained; hashes are
 * over the persisted scrubbed bytes. Hidden reasoning keys are dropped and
 * counted. Any identity string that the scrubber would change refuses the event.
 * Oversized or malformed observations, refusals, host-reported drops, torn
 * appends, the event cap and retention expiry are counted as losses and make
 * coverage incomplete; a drop of unknown size makes the denominator unknown.
 *
 * Replay: event ids derive from source/run/execution/host-session/host event id.
 * An identical replay is a no-op; the same id with different content refuses.
 *
 * Usage: request_completed usage is normalized by the execution's host family
 * (from the authority, never from the observation): input is inclusive, cache
 * read/write are subsets of it, reasoning is a subset of output, total is
 * input + output. Missing counters are null, never zero. Price stays unavailable.
 *
 * Activation stays gated: nothing here is wired into a launcher or hook.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { checkContained, isRefused, prepareContainedWrite } from "../kernel";
import { redact, redactHomeDirPaths, redactKeyValueSecrets, redactTokenShapes } from "../security";
import type { DispatchBackend } from "./guild-trace-events";
import {
  TRACE_ANALYSIS_V3_SCHEMA,
  TRACE_ID_RE,
  cpLength,
  isRfc3339,
  compareTraceInstants,
  validateTraceAnalysisV3,
  type TraceAnalysisV3,
  type TraceCoverage,
  type TraceEventClass,
  type TraceEvidence,
  type TraceLineage,
  type TracePins,
  type TraceUsage,
} from "./trace-analysis-v3";

export { validateTraceAnalysisV3 } from "./trace-analysis-v3";

export const HOST_TRACE_OBSERVATION_SCHEMA = "guild.host_trace_observation.v1" as const;
export const TRACE_SIDECAR_SCHEMA = "guild.trace.sidecar.v1" as const;
export const TRACE_SIDECAR_TOMBSTONE_SCHEMA = "guild.trace.sidecar_tombstone.v1" as const;
export const TRACE_CAPTURE_MANIFEST_SCHEMA = "guild.trace.capture_manifest.v1" as const;
export const TRACE_REDACTION_VERSION = "guild.trace-scrub.v1" as const;

export const TRACE_CAPTURE_LIMITS = Object.freeze({
  max_host_event_bytes: 256 * 1024,
  max_sidecar_bytes: 32 * 1024,
  max_trace_events: 100_000,
  max_json_depth: 16,
  lock_wait_ms: 2_000,
  stale_lock_ms: 30_000,
});
export type TraceCaptureLimits = { -readonly [K in keyof typeof TRACE_CAPTURE_LIMITS]: number };

/** Every dispatch path a capture accepts: the v1 DispatchBackend set plus TaskCell and Stack launch. */
export const DISPATCH_CAPTURE_PATHS = Object.freeze(["agent", "cmux", "tmux", "remote", "task_cell", "stack_launch", "unknown"] as const);
export type DispatchCapturePath = (typeof DISPATCH_CAPTURE_PATHS)[number];
// Compile-time: a DispatchBackend added in v1 must be added here too.
const _dispatchCovered: Exclude<DispatchBackend, DispatchCapturePath> extends never ? true : never = true;
void _dispatchCovered;

/** Host event classes. `loss` is writer-only. */
const HOST_KINDS: readonly TraceEventClass[] = ["prompt", "dispatch", "request_started", "request_completed", "handoff", "phase", "obligation", "transfer", "knowledge", "retrieval"];
const CONTENT_KINDS = new Set<TraceEventClass>(["prompt", "dispatch", "handoff"]);
const HIDDEN_REASONING_KEYS = new Set(["reasoning", "thinking", "reasoning_content", "reasoning_text", "encrypted_reasoning", "redacted_thinking", "chain_of_thought"]);
const OBSERVATION_KEYS = new Set([
  "schema_version", "host_event_id", "kind", "at", "actor_id", "correlation", "requested_model", "content", "response",
  "dispatch", "operation_id", "component_invocation_id", "interval",
]);
const CORRELATION_KEYS = ["run_id", "execution_id", "host_session_id", "goal_id", "logical_task_id", "attempt_id", "agent_instance_id", "request_id"] as const;

// ── Authority (built by lifecycle from R01 records) ──────────────────────────

export interface TraceAuthorityExecution {
  execution_id: string; host_id: string; host_session_id: string | null; pins: TracePins;
  admission: "active" | "reconcile_only" | "revoked" | "sealed";
}
export interface TraceAuthorityAssignment {
  execution_id: string; logical_task_id: string; attempt_id: string; agent_instance_id: string | null; pins: TracePins; goal_ids: string[];
}
export interface TraceAuthority {
  source_id: string; run_id: string; initiative_id: string | null;
  executions: TraceAuthorityExecution[]; assignments: TraceAuthorityAssignment[];
  /** Grant ids and other private values that must never reach a sidecar, trace or export. */
  private_literals: string[];
}

// ── Results ──────────────────────────────────────────────────────────────────

export type TraceCaptureRefusalCode =
  | "oversize_host_event" | "malformed_host_event" | "foreign_run" | "foreign_execution" | "execution_not_admitted"
  | "correlation_conflict" | "replay_conflict" | "secret_in_identity" | "trace_cap_reached" | "capture_busy" | "write_refused";

export type CaptureResult =
  | { status: "captured"; event: TraceAnalysisV3 }
  | { status: "duplicate"; event_id: string }
  | { status: "refused"; code: TraceCaptureRefusalCode; detail: string };

export interface TraceCaptureManifest {
  schema_version: typeof TRACE_CAPTURE_MANIFEST_SCHEMA;
  source_id: string; run_id: string;
  /** Informational counters. Coverage is derived from the durable trace, not from these. */
  events_written: number;
  duplicates: number;
  losses: Record<string, number>;
  upstream_drop_unknown: boolean;
}

export interface TraceCapture {
  observe(raw: string | Uint8Array): CaptureResult;
  /** Record telemetry the host reports it dropped; `null` means the count is unknown. */
  recordUpstreamLoss(input: { dropped: number | null }): CaptureResult;
}

class Refusal extends Error {
  constructor(readonly code: TraceCaptureRefusalCode, detail: string) { super(detail); }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const sha = (s: string | Uint8Array) => crypto.createHash("sha256").update(s).digest("hex");
const revision = (s: string) => `sha256:${sha(s)}`;
const HASH_VALUE_RE = /^sha256:[a-f0-9]{64}$/;
const isId = (v: unknown): v is string => typeof v === "string" && TRACE_ID_RE.test(v);
const isBoundedStr = (v: unknown): v is string => typeof v === "string" && cpLength(v) >= 1 && cpLength(v) <= 4096;
const safeCount = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

function depthWithin(v: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[v, 0]];
  while (stack.length) {
    const [node, d] = stack.pop()!;
    if (node === null || typeof node !== "object") continue;
    if (d >= max) return false;
    for (const x of Object.values(node as object)) stack.push([x, d + 1]);
  }
  return true;
}

function guildRel(runId: string, ...parts: string[]): string {
  return ["runs", runId, ...parts].join("/");
}
const TRACE_FILE = "trace.jsonl";
const MANIFEST_FILE = "trace-capture-manifest.json";
const LOCK_FILE = "trace.lock";
const SIDECAR_DIR = "trace-sidecars";

/** Credential and hidden-reasoning key names whose values never persist. */
const SENSITIVE_KEY_SRC =
  "(?:[A-Za-z0-9]+[_-])*(?:password|passwd|passphrase|secret|api[_-]?key|apikey|token|authorization|credential|credentials|private[_-]?key|client[_-]?secret|cookie|reasoning|thinking|chain[_-]?of[_-]?thought|redacted[_-]?thinking|encrypted[_-]?reasoning)(?:[_-][A-Za-z0-9]+)*";
const CREDENTIAL_KEY_RE = new RegExp(`^${SENSITIVE_KEY_SRC}$`, "i");
const QUOTED_KEY_RE = new RegExp(`(["'])(${SENSITIVE_KEY_SRC})\\1\\s*:\\s*`, "gi");
const REDACTED_VALUE = '"[REDACTED]"';
/** Content nested deeper than this is withheld rather than parsed. */
const MAX_CONTENT_DEPTH = 64;

/** End index of the JSON-ish value starting at `i`: a quoted string, a bracketed compound, or a bare scalar. Iterative. */
function valueEnd(s: string, i: number): number {
  const c = s[i];
  if (c === '"' || c === "'") {
    for (let j = i + 1; j < s.length; j++) { if (s[j] === "\\") j++; else if (s[j] === c) return j + 1; }
    return s.length;
  }
  if (c === "{" || c === "[") {
    let depth = 0;
    let quote: string | null = null;
    for (let j = i; j < s.length; j++) {
      const ch = s[j]!;
      if (quote) { if (ch === "\\") j++; else if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "{" || ch === "[") depth++;
      else if ((ch === "}" || ch === "]") && --depth === 0) return j + 1;
    }
    return s.length;
  }
  let j = i;
  while (j < s.length && !/[,}\]\s]/.test(s[j]!)) j++;
  return j;
}

/** An unquoted sensitive key followed by a quoted or compound value (`api_key: { … }`). */
const UNQUOTED_KEY_RE = new RegExp(`\\b(${SENSITIVE_KEY_SRC})\\s*[:=]\\s*(?=[{\\["'])`, "gi");

/** Replace the value after every quoted sensitive key, in JSON or in prose, whatever its type. */
function redactQuotedKeys(s: string): string {
  return redactValuesAfter(redactValuesAfter(s, QUOTED_KEY_RE), UNQUOTED_KEY_RE);
}

function redactValuesAfter(s: string, keyRe: RegExp): string {
  const re = new RegExp(keyRe.source, keyRe.flags);
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    if (start >= s.length || s.startsWith(REDACTED_VALUE, start)) continue;
    const end = valueEnd(s, start);
    if (end === start) continue;
    out += s.slice(last, start) + REDACTED_VALUE;
    last = end;
    re.lastIndex = end;
  }
  return out + s.slice(last);
}

/** Bracket depth outside quoted strings. Iterative. */
function bracketDepth(s: string): number {
  let depth = 0;
  let max = 0;
  let quote: string | null = null;
  for (let j = 0; j < s.length; j++) {
    const ch = s[j]!;
    if (quote) { if (ch === "\\") j++; else if (ch === quote) quote = null; }
    else if (ch === '"') quote = ch;
    else if (ch === "{" || ch === "[") max = Math.max(max, ++depth);
    else if (ch === "}" || ch === "]") depth--;
  }
  return max;
}

/** Content that is a JSON document: redact credential-keyed values by DECODED key name, any value type. */
function redactStructured(s: string, privateLiterals: readonly string[], level: number): string {
  const t = s.trim();
  if (!(t.startsWith("{") || t.startsWith("[")) || bracketDepth(t) > MAX_CONTENT_DEPTH) return s;
  let doc: unknown;
  try { doc = JSON.parse(t); } catch { return s; }
  let changed = false;
  // Decoded keys and string values are scrubbed too: escapes cannot hide a secret,
  // and a string holding serialized JSON is inspected (bounded by `level`).
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const x = scrubOnce(v, privateLiterals, level + 1);
      if (x !== v) changed = true;
      return x;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (!isObj(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const key = scrubOnce(k, privateLiterals, MAX_SERIALIZED_LEVELS);
      if (key !== k) changed = true;
      if (CREDENTIAL_KEY_RE.test(k) && x !== "[REDACTED]" && x !== null) { changed = true; out[key] = "[REDACTED]"; }
      else out[key] = walk(x);
    }
    return out;
  };
  const red = walk(doc);
  return changed ? JSON.stringify(red) : s;
}

/** One scrub pass: quoted credentials, secret patterns, token shapes, key=value secrets, home paths, private literals. */
/** Serialized JSON nested inside JSON strings is inspected this many levels deep. */
const MAX_SERIALIZED_LEVELS = 3;

/**
 * A PEM/PGP private key block, BEGIN to END inclusive (any label: RSA, EC, OPENSSH,
 * ENCRYPTED, PGP … BLOCK). With no END it runs to the end of the string: a decoded
 * JSON field when content is JSON, the whole content otherwise. Never leaves a tail.
 */
// The END label must match the BEGIN label; an unrelated END (e.g. PUBLIC KEY) does not stop it.
const PEM_PRIVATE_KEY_BLOCK_RE = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?)-----[\s\S]*?(?:-----END \1-----|$)/gi;
const PEM_REDACTED = "<PEM-PRIVATE-KEY-REDACTED>";

/** Thrown when serialized JSON nests past MAX_SERIALIZED_LEVELS: the content cannot be inspected, so it is withheld. */
class TooDeepToInspect extends Error {}

const parsesAsJsonCompound = (s: string): boolean => {
  const t = s.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  if (bracketDepth(t) > MAX_CONTENT_DEPTH) return true;
  try { return typeof JSON.parse(t) === "object"; } catch { return false; }
};

const nextOpen = (s: string, from: number) => {
  const a = s.indexOf("{", from);
  const b = s.indexOf("[", from);
  return a === -1 ? b : b === -1 ? a : Math.min(a, b);
};

/** Embedded JSON fragments inspected per string; content with more is withheld. */
const MAX_EMBEDDED_FRAGMENTS = 1000;

/** True when the string holds a JSON object or array, whole or as a fragment inside prose. Bounded count. */
function containsJsonCompound(s: string): boolean {
  if (parsesAsJsonCompound(s)) return true;
  let seen = 0;
  for (let i = nextOpen(s, 0); i !== -1; i = nextOpen(s, i + 1), seen++) {
    // Fail closed: past the fragment budget the string counts as holding JSON.
    if (seen >= MAX_EMBEDDED_FRAGMENTS) return true;
    if (parsesAsJsonCompound(s.slice(i, valueEnd(s, i)))) return true;
  }
  return false;
}

/** Decode and scrub JSON fragments (objects and arrays) embedded in prose (`note {"k":"\u0061"} end`). Bounded count. */
function redactEmbeddedJson(s: string, privateLiterals: readonly string[], level: number): string {
  let out = "";
  let last = 0;
  let seen = 0;
  for (let i = nextOpen(s, 0); i !== -1; i = nextOpen(s, i + 1)) {
    if (i < last) continue;
    // Fail closed: fragments past the budget cannot be inspected, so the content is withheld.
    if (seen >= MAX_EMBEDDED_FRAGMENTS) throw new TooDeepToInspect();
    const end = valueEnd(s, i);
    const seg = s.slice(i, end);
    seen++;
    const red = redactStructured(seg, privateLiterals, level);
    if (red !== seg) { out += s.slice(last, i) + red; last = end; i = end - 1; }
  }
  return out + s.slice(last);
}

function scrubOnce(s: string, privateLiterals: readonly string[], level = 0): string {
  if (level >= MAX_SERIALIZED_LEVELS && containsJsonCompound(s)) throw new TooDeepToInspect();
  let out = s;
  if (level < MAX_SERIALIZED_LEVELS) {
    const t = s.trim();
    out = t.startsWith("{") || t.startsWith("[") ? redactStructured(s, privateLiterals, level) : s;
    if (out === s) out = redactEmbeddedJson(s, privateLiterals, level);
  }
  // Before the shared scrubber, which only replaces the BEGIN marker and would leave the key body.
  out = out.replace(PEM_PRIVATE_KEY_BLOCK_RE, PEM_REDACTED);
  out = redactQuotedKeys(out);
  out = redact(out).out;
  out = redactTokenShapes(out);
  out = redactKeyValueSecrets(out);
  out = redactHomeDirPaths(out);
  for (const lit of privateLiterals) if (lit.length > 0) out = out.split(lit).join("<PRIVATE-REDACTED>");
  return out;
}

/** Scrub to a fixed point; `null` when it does not converge (the caller withholds). */
function scrub(s: string, privateLiterals: readonly string[]): string | null {
  let cur = s;
  try {
    for (let i = 0; i < 4; i++) {
      const next = scrubOnce(cur, privateLiterals);
      if (next === cur) return cur;
      cur = next;
    }
  } catch (error) {
    if (error instanceof TooDeepToInspect) return null;
    throw error;
  }
  return null;
}

/** True when the scrubber would change the string: it carries a secret, token, home path or private literal. */
export function traceStringIsUnsafe(s: string, privateLiterals: readonly string[]): boolean {
  try {
    return scrubOnce(s, privateLiterals) !== s;
  } catch (error) {
    if (error instanceof TooDeepToInspect) return true;
    throw error;
  }
}

/** Schema fields whose values are sha256 hashes; only these are exempt from the secret heuristics. */
const HASH_FIELDS = new Set(["sha256", "prompt_hash", "assignment", "definition", "configuration", "workflow", "policy"]);

/** A JSON value is unsafe when any key or string carries a private literal, or any non-hash-field string would be scrubbed. */
function jsonIsUnsafe(v: unknown, privateLiterals: readonly string[], key: string | null = null): boolean {
  if (typeof v === "string") {
    if (privateLiterals.some((lit) => lit.length > 0 && v.includes(lit))) return true;
    if (key !== null && HASH_FIELDS.has(key) && HASH_VALUE_RE.test(v)) return false;
    return traceStringIsUnsafe(v, privateLiterals);
  }
  if (Array.isArray(v)) return v.some((x) => jsonIsUnsafe(x, privateLiterals, null));
  if (isObj(v)) return Object.entries(v).some(([k, x]) => traceStringIsUnsafe(k, privateLiterals) || jsonIsUnsafe(x, privateLiterals, k));
  return false;
}

/** Bytes a string occupies once JSON-encoded (escapes included, quotes excluded). */
const encodedBytes = (s: string) => Buffer.byteLength(JSON.stringify(s), "utf8") - 2;

function truncateUtf8(s: string, maxBytes: number): string {
  if (encodedBytes(s) <= maxBytes) return s;
  let bytes = 0;
  let out = "";
  for (const ch of s) {
    const n = encodedBytes(ch);
    if (bytes + n > maxBytes) break;
    bytes += n;
    out += ch;
  }
  return out;
}

/** Cut a trailing prefix of a private literal that truncation may have left behind. */
function cutLiteralPrefixTail(s: string, privateLiterals: readonly string[]): string {
  for (const lit of privateLiterals) {
    for (let k = lit.length - 1; k >= 4; k--) if (s.endsWith(lit.slice(0, k))) return s.slice(0, s.length - k);
  }
  return s;
}

interface ScrubbedPayload { content: string; truncated: boolean; redacted: boolean; original_bytes: number }

function scrubPayload(raw: string, maxBytes: number, privateLiterals: readonly string[]): ScrubbedPayload | null {
  const original_bytes = Buffer.byteLength(raw, "utf8");
  if (bracketDepth(raw) > MAX_CONTENT_DEPTH) return null;
  let cur = scrub(raw, privateLiterals);
  if (cur === null) return null;
  const redacted = cur !== raw;
  let truncated = false;
  for (let i = 0; i < 3 && encodedBytes(cur) > maxBytes; i++) {
    truncated = true;
    const cut = cutLiteralPrefixTail(truncateUtf8(cur, maxBytes), privateLiterals);
    cur = scrub(cut, privateLiterals);
    if (cur === null) return null;
  }
  if (encodedBytes(cur) > maxBytes) return null;
  return { content: cur, truncated, redacted, original_bytes };
}


function hiddenReasoningKeysIn(v: unknown): string[] {
  const found: string[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (isObj(x)) for (const [k, y] of Object.entries(x)) { if (HIDDEN_REASONING_KEYS.has(k)) found.push(k); walk(y); }
  };
  walk(v);
  return found;
}

function coverageOf(eligible: number, covered: number, exclusions: Record<string, number>, reason: string | null, partial = false): TraceCoverage {
  const missing = eligible - covered;
  const excluded = Object.values(exclusions).reduce((a, b) => a + b, 0);
  const exclusion_reasons = Object.entries(exclusions).filter(([, n]) => n > 0).map(([code, count]) => ({ code, count })).sort((a, b) => (a.code < b.code ? -1 : 1));
  return {
    eligible, covered, excluded, missing,
    state: missing === 0 ? "complete" : covered === 0 && !partial ? "unavailable" : "partial",
    reason: missing === 0 ? null : reason ?? "capture incomplete",
    exclusion_reasons,
  };
}

// ── Usage normalization ──────────────────────────────────────────────────────

type UsageFamily = "anthropic_messages" | "openai_responses" | "unknown";
/** Native usage semantics per host family. A host not listed has unknown semantics. */
const USAGE_FAMILY_BY_HOST: Readonly<Record<string, UsageFamily>> = Object.freeze({
  claude: "anthropic_messages",
  codex: "openai_responses",
});

function normalizeUsage(family: UsageFamily, raw: unknown, ids: { observation_id: string; accounting_identity: string }): TraceUsage {
  let input: number | null = null;
  let output: number | null = null;
  let cacheRead: number | null = null;
  let cacheWrite: number | null = null;
  let reason: string | null = null;
  if (family === "unknown") reason = "host usage semantics unknown";
  else if (!isObj(raw)) reason = "provider did not report usage";
  else if (family === "anthropic_messages") {
    // Anthropic input_tokens excludes cache reads and writes; inclusive input adds them.
    const base = safeCount(raw["input_tokens"]);
    cacheRead = safeCount(raw["cache_read_input_tokens"]);
    cacheWrite = safeCount(raw["cache_creation_input_tokens"]);
    input = base !== null && cacheRead !== null && cacheWrite !== null ? base + cacheRead + cacheWrite : null;
    output = safeCount(raw["output_tokens"]);
  } else {
    // OpenAI input_tokens already includes cached input; reasoning is part of output.
    input = safeCount(raw["input_tokens"]);
    const details = isObj(raw["input_tokens_details"]) ? raw["input_tokens_details"] : {};
    cacheRead = safeCount(details["cached_tokens"]) ?? safeCount(raw["cached_input_tokens"]);
    output = safeCount(raw["output_tokens"]);
  }
  if (input !== null && ((cacheRead !== null && cacheRead > input) || (cacheWrite !== null && cacheWrite > input))) {
    cacheRead = null;
    cacheWrite = null;
    reason = "cache subset exceeds inclusive input";
  }
  if ((input !== null && !Number.isSafeInteger(input)) || (input !== null && output !== null && !Number.isSafeInteger(input + output))) {
    input = output = cacheRead = cacheWrite = null;
    reason = "usage counters overflow";
  }
  const total = input !== null && output !== null ? input + output : null;
  const known = [input, output, cacheRead, cacheWrite].some((x) => x !== null);
  const complete = total !== null && reason === null;
  const coverage: TraceCoverage = complete
    ? { eligible: 1, covered: 1, excluded: 0, missing: 0, state: "complete", reason: null, exclusion_reasons: [] }
    : { eligible: 1, covered: 0, excluded: 0, missing: 1, state: known ? "partial" : "unavailable", reason: reason ?? "provider reported partial usage", exclusion_reasons: [] };
  return {
    granularity: "leaf_request", observation_id: ids.observation_id, revision: 0, final: true,
    accounting_identity: ids.accounting_identity, parent_accounting_identity: null, inclusion: "leaf_exclusive",
    input_inclusive: known ? input : null, output: known ? output : null, cache_read_subset: known ? cacheRead : null,
    cache_write_subset: known ? cacheWrite : null, total: known ? total : null,
    cost_usd: null, cost_basis: "unavailable", currency: "USD", pricing_version: null,
    usage_semantics: known ? "inclusive_input_cache_subset.v1" : "unknown",
    coverage, native_baseline_usd: null, native_cumulative_usd: null,
  };
}

// ── Contained I/O ────────────────────────────────────────────────────────────

function containedPath(root: string, guildRelPath: string): string {
  const rel = path.join(".guild", guildRelPath);
  const prepared = prepareContainedWrite(root, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(prepared)) throw new Refusal("write_refused", `trace write refused (${prepared.code}): ${guildRelPath}`);
  return prepared.realPath;
}

function readContained(root: string, guildRelPath: string): string | null {
  const rel = path.join(".guild", guildRelPath);
  const checked = checkContained(root, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(checked) || !fs.existsSync(checked.realPath)) return null;
  const fd = fs.openSync(checked.realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function writeFileOnce(abs: string, bytes: string): "written" | "identical" {
  try {
    const fd = fs.openSync(abs, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
    try {
      fs.writeSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return "written";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (fs.readFileSync(fd, "utf8") === bytes) return "identical";
    } finally {
      fs.closeSync(fd);
    }
    throw new Refusal("replay_conflict", `${path.basename(abs)} already holds different bytes`);
  }
}

function writeReplace(abs: string, bytes: string): void {
  const tmp = `${abs}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
  try {
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, abs);
}

const sleepMs = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock<T>(root: string, runId: string, limits: TraceCaptureLimits, fn: () => T): T {
  const lock = containedPath(root, guildRel(runId, LOCK_FILE));
  const deadline = Date.now() + limits.lock_wait_ms;
  for (;;) {
    try {
      const fd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Cooperative local trust: a lock older than stale_lock_ms belongs to a dead writer.
      try {
        if (Date.now() - fs.lstatSync(lock).mtimeMs > limits.stale_lock_ms) { fs.rmSync(lock, { force: true }); continue; }
      } catch { continue; }
      if (Date.now() > deadline) throw new Refusal("capture_busy", "trace lock held by another writer");
      sleepMs(10);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

function emptyManifest(authority: { source_id: string; run_id: string }): TraceCaptureManifest {
  return {
    schema_version: TRACE_CAPTURE_MANIFEST_SCHEMA, source_id: authority.source_id, run_id: authority.run_id,
    events_written: 0, duplicates: 0, losses: {}, upstream_drop_unknown: false,
  };
}

function readManifest(root: string, runId: string, sourceId: string): TraceCaptureManifest {
  const raw = readContained(root, guildRel(runId, MANIFEST_FILE));
  if (raw === null) return emptyManifest({ source_id: sourceId, run_id: runId });
  const m = JSON.parse(raw) as TraceCaptureManifest;
  if (m.schema_version !== TRACE_CAPTURE_MANIFEST_SCHEMA || m.run_id !== runId) throw new Refusal("write_refused", "capture manifest belongs to another run");
  return m;
}

const bump = (m: TraceCaptureManifest, code: string, n = 1) => { m.losses[code] = (m.losses[code] ?? 0) + n; };

/**
 * Trace-level coverage derived from the durable trace. Each observation event is
 * eligible and covered only when its capture is complete and its payload is still
 * retained intact; each loss event adds its own eligible count (null = unknown).
 * Losses with no event (cap reached, torn appends, unreadable lines) add from the
 * manifest and from what this read saw.
 */
export function traceCoverageOf(events: readonly TraceAnalysisV3[], m: TraceCaptureManifest, seen: { torn_tail: boolean; invalid_lines: number }): TraceCoverage {
  // `unrecorded` counts losses no trace event could carry (cap reached).
  let eligible: number | null = m.upstream_drop_unknown ? null : (m.losses["unrecorded"] ?? 0) + (m.losses["torn_tail"] ?? 0) + (seen.torn_tail ? 1 : 0) + seen.invalid_lines;
  let covered = 0;
  const lost = new Map<string, number>();
  const note = (k: string, n = 1) => lost.set(k, (lost.get(k) ?? 0) + n);
  for (const k of ["unrecorded", "torn_tail"]) if (m.losses[k]) note(k, m.losses[k]!);
  if (seen.torn_tail) note("torn_tail_unrecovered");
  if (seen.invalid_lines) note("invalid_lines", seen.invalid_lines);
  for (const e of events) {
    if (e.event_class === "loss") {
      const n = e.capture.eligible;
      eligible = eligible === null || n === null ? null : eligible + n;
      if (n !== 0) note(n === null ? "loss_unknown_size" : "loss_events", n ?? 1);
      continue;
    }
    if (eligible !== null) eligible += 1;
    const payloadOk = e.payload_ref === null || e.payload_ref.availability === "available" || e.payload_ref.availability === "redacted";
    if (e.capture.state === "complete" && payloadOk) covered++;
    else note(payloadOk ? "capture_incomplete" : `payload_${e.payload_ref!.availability}`);
  }
  const missing = eligible === null ? null : eligible - covered;
  const complete = eligible !== null && missing === 0;
  const summary = [...lost.entries()].map(([k, n]) => `${k}=${n}`).sort().join(",");
  return {
    eligible, covered, excluded: m.duplicates, missing,
    state: complete ? "complete" : covered === 0 && (eligible === null || eligible > 0) ? "unavailable" : "partial",
    reason: complete ? null : eligible === null ? `unknown loss size; ${summary}` : `losses: ${summary}`,
    exclusion_reasons: m.duplicates > 0 ? [{ code: "duplicate_replay", count: m.duplicates }] : [],
  };
}

// ── Capture ──────────────────────────────────────────────────────────────────

interface TraceState {
  offset: number;
  count: number;
  /** event_id → digest of the event without its sequence. */
  digests: Map<string, string>;
  /** `${execution}\0${request}` → bound task/attempt/instance. */
  requests: Map<string, string>;
}

const eventDigest = (e: TraceAnalysisV3) => sha(JSON.stringify({ ...e, sequence: 0 }));
const requestBinding = (l: TraceLineage) => JSON.stringify([l.logical_task_id, l.attempt_id, l.agent_instance_id]);

/** Read new trace lines from `offset`; cut a torn tail (no trailing newline) under the lock. */
function refreshState(root: string, runId: string, state: TraceState, manifest: TraceCaptureManifest, abs: string): void {
  if (!fs.existsSync(abs)) return;
  const fd = fs.openSync(abs, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
  try {
    const size = fs.fstatSync(fd).size;
    if (size < state.offset) throw new Refusal("write_refused", `${runId} trace shrank under the writer`);
    if (size === state.offset) return;
    const buf = Buffer.alloc(size - state.offset);
    fs.readSync(fd, buf, 0, buf.length, state.offset);
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl !== buf.length - 1) {
      fs.ftruncateSync(fd, state.offset + lastNl + 1);
      fs.fsyncSync(fd);
      bump(manifest, "torn_tail");
    }
    const text = buf.subarray(0, lastNl + 1).toString("utf8");
    state.offset += lastNl + 1;
    for (const line of text.split("\n")) {
      if (!line) continue;
      state.count++;
      let e: TraceAnalysisV3;
      try { e = JSON.parse(line) as TraceAnalysisV3; } catch { continue; }
      if (!validateTraceAnalysisV3(e).ok) continue;
      state.digests.set(e.event_id, eventDigest(e));
      if (e.lineage.request_id !== null) state.requests.set(`${e.lineage.execution_id}\u0000${e.lineage.request_id}`, requestBinding(e.lineage));
    }
  } finally {
    fs.closeSync(fd);
  }
}

export interface OpenTraceCaptureOptions {
  root: string;
  authority: TraceAuthority;
  execution_id: string;
  now?: () => Date;
  limits?: Partial<TraceCaptureLimits>;
}

export function openTraceCapture(opts: OpenTraceCaptureOptions): TraceCapture {
  const { root, authority } = opts;
  const limits: TraceCaptureLimits = { ...TRACE_CAPTURE_LIMITS, ...opts.limits };
  const now = opts.now ?? (() => new Date());
  const exec = authority.executions.find((e) => e.execution_id === opts.execution_id);
  if (!exec) throw new Error(`execution ${opts.execution_id} is not in run ${authority.run_id}`);
  const runId = authority.run_id;
  const literals = [...authority.private_literals].sort((a, b) => b.length - a.length);
  const family: UsageFamily = USAGE_FAMILY_BY_HOST[exec.host_id] ?? "unknown";
  const state: TraceState = { offset: 0, count: 0, digests: new Map(), requests: new Map() };

  const lossEvent = (sequence: number, code: string, cov: TraceCoverage): TraceAnalysisV3 => ({
    schema_version: TRACE_ANALYSIS_V3_SCHEMA,
    event_id: `loss-${sha(`${authority.source_id}\u0000${runId}\u0000${exec.execution_id}\u0000${sequence}\u0000${code}`).slice(0, 32)}`,
    sequence, event_class: "loss", at: now().toISOString(),
    lineage: baseLineage(), operation_id: null, component_invocation_id: null, actor_id: "guild-trace-capture",
    pins: exec.pins, requested_model: null,
    observed_identity: { provider: null, model: null, status: "unavailable", reason: "loss record carries no model" },
    usage: null, payload_ref: null, prompt_hash: null, redaction_version: TRACE_REDACTION_VERSION, capture: cov, interval: null,
  });

  function baseLineage(): TraceLineage {
    return {
      source_id: authority.source_id, run_id: runId, execution_id: exec!.execution_id, host_session_id: exec!.host_session_id,
      initiative_id: authority.initiative_id, goal_id: null, logical_task_id: null, attempt_id: null, agent_instance_id: null, request_id: null,
    };
  }

  /** Run one capture step under the lock with fresh state and manifest. */
  function transact(fn: (m: TraceCaptureManifest, append: (e: TraceAnalysisV3) => void) => CaptureResult): CaptureResult {
    try {
      return withLock(root, runId, limits, () => {
        const manifest = readManifest(root, runId, authority.source_id);
        const traceAbs = containedPath(root, guildRel(runId, TRACE_FILE));
        refreshState(root, runId, state, manifest, traceAbs);
        const append = (e: TraceAnalysisV3) => {
          const verdict = validateTraceAnalysisV3(e);
          if (!verdict.ok) throw new Error(`trace writer produced an invalid event: ${verdict.errors.join("; ")}`);
          const line = `${JSON.stringify(e)}\n`;
          const fd = fs.openSync(traceAbs, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o644);
          try {
            fs.writeSync(fd, line);
            fs.fsyncSync(fd);
          } finally {
            fs.closeSync(fd);
          }
          state.offset += Buffer.byteLength(line, "utf8");
          state.count++;
          state.digests.set(e.event_id, eventDigest(e));
          if (e.lineage.request_id !== null) state.requests.set(`${e.lineage.execution_id}\u0000${e.lineage.request_id}`, requestBinding(e.lineage));
          manifest.events_written++;
        };
        let result: CaptureResult;
        try {
          result = fn(manifest, append);
        } catch (error) {
          if (!(error instanceof Refusal)) throw error;
          bump(manifest, error.code);
          if (error.code === "trace_cap_reached" || state.count >= limits.max_trace_events) bump(manifest, "unrecorded");
          else {
            append(lossEvent(state.count, error.code, { eligible: 1, covered: 0, excluded: 0, missing: 1, state: "unavailable", reason: `observation refused: ${error.code}`, exclusion_reasons: [] }));
          }
          result = { status: "refused", code: error.code, detail: error.message };
        }
        writeReplace(containedPath(root, guildRel(runId, MANIFEST_FILE)), `${JSON.stringify(manifest, null, 2)}\n`);
        return result;
      });
    } catch (error) {
      if (error instanceof Refusal) return { status: "refused", code: error.code, detail: error.message };
      throw error;
    }
  }

  function parseObservation(raw: string | Uint8Array): { o: Record<string, unknown>; exclusions: Record<string, number> } {
    const bytes = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
    if (bytes > limits.max_host_event_bytes) throw new Refusal("oversize_host_event", `host observation exceeds ${limits.max_host_event_bytes} bytes`);
    let o: unknown;
    try {
      o = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
    } catch {
      throw new Refusal("malformed_host_event", "host observation is not JSON");
    }
    if (!isObj(o) || !depthWithin(o, limits.max_json_depth)) throw new Refusal("malformed_host_event", "host observation is not a bounded object");
    const exclusions: Record<string, number> = {};
    const hidden = hiddenReasoningKeysIn(o).length;
    if (hidden) exclusions["hidden_reasoning_excluded"] = hidden;
    const unknown = Object.keys(o).filter((k) => !OBSERVATION_KEYS.has(k) && !HIDDEN_REASONING_KEYS.has(k)).length;
    if (unknown) exclusions["unknown_field_dropped"] = unknown;
    const bad = (why: string) => { throw new Refusal("malformed_host_event", why); };
    if (o["schema_version"] !== HOST_TRACE_OBSERVATION_SCHEMA) bad("unsupported observation schema");
    if (!isId(o["host_event_id"])) bad("host_event_id is not an id");
    if (typeof o["kind"] !== "string" || !HOST_KINDS.includes(o["kind"] as TraceEventClass)) bad("unsupported kind");
    if (typeof o["at"] !== "string" || !isRfc3339(o["at"])) bad("at is not a date-time");
    if (!isId(o["actor_id"])) bad("actor_id is not an id");
    const c = o["correlation"];
    if (!isObj(c)) return bad("correlation missing");
    for (const k of Object.keys(c)) if (!(CORRELATION_KEYS as readonly string[]).includes(k)) bad(`unknown correlation field ${k}`);
    for (const k of CORRELATION_KEYS) if (own(c, k) && c[k] !== null && !isId(c[k])) bad(`correlation.${k} is not an id`);
    if (!isId(c["run_id"]) || !isId(c["execution_id"])) bad("correlation needs run_id and execution_id");
    for (const k of ["operation_id", "component_invocation_id"]) if (own(o, k) && o[k] !== null && !isId(o[k])) bad(`${k} is not an id`);
    if (own(o, "requested_model") && o["requested_model"] !== null && !isBoundedStr(o["requested_model"])) bad("requested_model is not a bounded string");
    if (own(o, "content") && typeof o["content"] !== "string") bad("content is not a string");
    if (own(o, "response") && o["response"] !== null && !isObj(o["response"])) bad("response is not an object");
    if (own(o, "dispatch")) {
      const d = o["dispatch"];
      if (!isObj(d) || !(DISPATCH_CAPTURE_PATHS as readonly unknown[]).includes(d["backend"])) bad("dispatch backend is not a known dispatch path");
    }
    if (own(o, "interval") && o["interval"] !== null) {
      const iv = o["interval"];
      if (!isObj(iv) || typeof iv["start"] !== "string" || !isRfc3339(iv["start"])) bad("interval.start is not a date-time");
      const end = (iv as Record<string, unknown>)["end"];
      if (end !== undefined && end !== null && (typeof end !== "string" || !isRfc3339(end) || compareTraceInstants(end, (iv as any).start) < 0)) bad("interval.end is invalid");
    }
    if ((o["kind"] === "request_started" || o["kind"] === "request_completed") && !isId(c["request_id"])) bad("request event needs request_id");
    return { o, exclusions };
  }

  /** Resolve every lineage join against the authority; the host may only confirm ids it holds. */
  function resolveLineage(c: Record<string, unknown>): { lineage: TraceLineage; pins: TracePins } {
    if (c["run_id"] !== runId) throw new Refusal("foreign_run", "observation names another run");
    if (c["execution_id"] !== exec!.execution_id) throw new Refusal("foreign_execution", "observation names another execution");
    if (exec!.admission === "revoked" || exec!.admission === "sealed") throw new Refusal("execution_not_admitted", `execution is ${exec!.admission}`);
    const given = (k: string) => (own(c, k) && c[k] !== null ? (c[k] as string) : null);
    const conflict = (why: string) => { throw new Refusal("correlation_conflict", why); };
    if (given("host_session_id") !== null && given("host_session_id") !== exec!.host_session_id) conflict("host session differs from the execution's");
    const lineage = baseLineage();
    let pins = exec!.pins;
    const mine = authority.assignments.filter((a) => a.execution_id === exec!.execution_id);
    const attemptId = given("attempt_id");
    const taskId = given("logical_task_id");
    const instanceId = given("agent_instance_id");
    const goalId = given("goal_id");
    if (attemptId !== null) {
      const a = mine.find((x) => x.attempt_id === attemptId);
      if (!a) return conflict("attempt is not assigned in this execution");
      if (taskId !== null && taskId !== a.logical_task_id) conflict("task differs from the attempt's assignment");
      if (instanceId !== null && instanceId !== a.agent_instance_id) conflict("agent instance differs from the attempt's assignment");
      if (goalId !== null && !a.goal_ids.includes(goalId)) conflict("goal is not a contribution of the attempt");
      Object.assign(lineage, {
        logical_task_id: a.logical_task_id, attempt_id: a.attempt_id, agent_instance_id: a.agent_instance_id,
        goal_id: goalId ?? (a.goal_ids.length === 1 ? a.goal_ids[0]! : null),
      });
      pins = a.pins;
    } else if (taskId !== null || instanceId !== null || goalId !== null) {
      // Every supplied id must hold on ONE assignment; ids from different assignments never combine.
      const fits = mine.filter((a) =>
        (taskId === null || a.logical_task_id === taskId) &&
        (instanceId === null || a.agent_instance_id === instanceId) &&
        (goalId === null || a.goal_ids.includes(goalId)));
      if (fits.length === 0) conflict("no assignment in this execution holds every supplied id");
      const only = fits.length === 1 ? fits[0]! : null;
      Object.assign(lineage, {
        logical_task_id: taskId, agent_instance_id: instanceId,
        goal_id: goalId ?? (only && only.goal_ids.length === 1 ? only.goal_ids[0]! : null),
      });
      // Pins come from the assignment when the match is unique or all matches agree; else the execution's.
      const pinSets = new Set(fits.map((a) => JSON.stringify(a.pins)));
      if (pinSets.size === 1) pins = fits[0]!.pins;
    }
    const requestId = given("request_id");
    if (requestId !== null) {
      lineage.request_id = requestId;
      const prior = state.requests.get(`${exec!.execution_id}\u0000${requestId}`);
      if (prior !== undefined && prior !== requestBinding(lineage)) conflict("request id is bound to another task/attempt/instance");
    }
    return { lineage, pins };
  }

  function observe(raw: string | Uint8Array): CaptureResult {
    return transact((manifest, append) => {
      const { o, exclusions } = parseObservation(raw);
      const kind = o["kind"] as TraceEventClass;
      const { lineage, pins } = resolveLineage(o["correlation"] as Record<string, unknown>);
      const eventId = `ev-${sha([authority.source_id, runId, exec!.execution_id, exec!.host_session_id ?? "", o["host_event_id"]].join("\u0000")).slice(0, 32)}`;
      const at = o["at"] as string;

      // Payload: scrub, bound, persist as a sidecar. The original is never retained.
      let payload_ref: TraceEvidence | null = null;
      let prompt_hash: string | null = null;
      let sidecarBytes: string | null = null;
      let eligible = 0;
      let covered = 0;
      let captureReason: string | null = null;
      let truncated = false;
      if (own(o, "content")) {
        if (!CONTENT_KINDS.has(kind)) exclusions["content_not_captured_for_kind"] = 1;
        else {
          eligible = 1;
          const scrubbed = scrubPayload(o["content"] as string, limits.max_sidecar_bytes, literals);
          if (scrubbed === null) {
            captureReason = "payload withheld: scrub did not converge within the size bound";
          } else {
            truncated = scrubbed.truncated;
            if (!truncated) covered = 1;
            else captureReason = `payload truncated to ${limits.max_sidecar_bytes} bytes`;
            const sidecar = {
              schema_version: TRACE_SIDECAR_SCHEMA, event_id: eventId, kind,
              ...(kind === "dispatch" ? { dispatch_backend: (o["dispatch"] as { backend?: string } | undefined)?.backend ?? "unknown" } : {}),
              redaction_version: TRACE_REDACTION_VERSION, hash_basis: "persisted_scrubbed_utf8", original_retained: false,
              original_bytes: scrubbed.original_bytes, persisted_bytes: Buffer.byteLength(scrubbed.content, "utf8"),
              truncated: scrubbed.truncated, redacted: scrubbed.redacted, content: scrubbed.content,
            };
            sidecarBytes = `${JSON.stringify(sidecar, null, 2)}\n`;
            const reasons = [scrubbed.redacted ? "scrubbed before persistence" : null, scrubbed.truncated ? `truncated from ${scrubbed.original_bytes} bytes` : null].filter(Boolean);
            payload_ref = {
              source_id: authority.source_id, path: guildRel(runId, SIDECAR_DIR, `${eventId}.json`), sha256: revision(sidecarBytes),
              schema_version: TRACE_SIDECAR_SCHEMA, observed_at: at,
              availability: reasons.length ? "redacted" : "available", reason: reasons.length ? reasons.join("; ") : null,
            };
            if (kind === "prompt") prompt_hash = revision(scrubbed.content);
          }
        }
      } else if (kind === "prompt" || kind === "handoff") {
        eligible = 1;
        captureReason = "payload not reported by the host";
      } else if (kind === "dispatch") {
        // A dispatch with no content still records its path in a sidecar.
        const sidecar = {
          schema_version: TRACE_SIDECAR_SCHEMA, event_id: eventId, kind,
          dispatch_backend: (o["dispatch"] as { backend?: string } | undefined)?.backend ?? "unknown",
          redaction_version: TRACE_REDACTION_VERSION, hash_basis: "persisted_scrubbed_utf8", original_retained: false,
          original_bytes: 0, persisted_bytes: 0, truncated: false, redacted: false, content: "",
        };
        sidecarBytes = `${JSON.stringify(sidecar, null, 2)}\n`;
        payload_ref = {
          source_id: authority.source_id, path: guildRel(runId, SIDECAR_DIR, `${eventId}.json`), sha256: revision(sidecarBytes),
          schema_version: TRACE_SIDECAR_SCHEMA, observed_at: at, availability: "available", reason: null,
        };
      }

      // Identity: observed only when the provider reported both provider and model.
      const response = isObj(o["response"]) ? o["response"] : null;
      const provider = response && isBoundedStr(response["provider"]) ? response["provider"] : null;
      const model = response && isBoundedStr(response["model"]) ? response["model"] : null;
      const isModelEvent = kind === "request_completed";
      const observed_identity = isModelEvent && provider !== null && model !== null
        ? { provider, model, status: "observed" as const, reason: null }
        : { provider: null, model: null, status: "unavailable" as const, reason: isModelEvent ? "provider did not report provider and model" : "not a model response" };

      const usage = isModelEvent
        ? normalizeUsage(family, response ? response["usage"] : null, {
            observation_id: eventId,
            accounting_identity: `acct-${sha([authority.source_id, runId, exec!.execution_id, lineage.request_id].join("\u0000")).slice(0, 32)}`,
          })
        : null;

      const iv = isObj(o["interval"]) ? o["interval"] : null;
      const interval = iv
        ? {
            start: iv["start"] as string, end: typeof iv["end"] === "string" ? iv["end"] : null, duration_ms: null,
            // Host wall clocks are not the controller clock: no duration is claimed.
            clock: { domain: `host-${exec!.host_id}`.slice(0, 128), basis: "unknown" as const, comparable: false, skew_bound_ms: null },
          }
        : null;

      const event: TraceAnalysisV3 = {
        schema_version: TRACE_ANALYSIS_V3_SCHEMA, event_id: eventId, sequence: state.count, event_class: kind, at, lineage,
        operation_id: (o["operation_id"] as string | undefined) ?? null,
        component_invocation_id: (o["component_invocation_id"] as string | undefined) ?? null,
        actor_id: o["actor_id"] as string, pins,
        requested_model: (o["requested_model"] as string | undefined) ?? null,
        observed_identity, usage, payload_ref, prompt_hash, redaction_version: TRACE_REDACTION_VERSION,
        capture: coverageOf(eligible, covered, exclusions, captureReason, truncated), interval,
      };

      if (jsonIsUnsafe(event, literals)) throw new Refusal("secret_in_identity", "an identity field carries a secret, token, home path or private value");
      const verdict = validateTraceAnalysisV3(event);
      if (!verdict.ok) throw new Refusal("malformed_host_event", "observation does not normalize to a valid v3 event");

      const prior = state.digests.get(eventId);
      if (prior !== undefined) {
        if (prior !== eventDigest(event)) throw new Refusal("replay_conflict", "event id replayed with different content");
        manifest.duplicates++;
        return { status: "duplicate", event_id: eventId };
      }
      if (state.count >= limits.max_trace_events) throw new Refusal("trace_cap_reached", `trace holds ${limits.max_trace_events} events`);
      if (sidecarBytes !== null) writeFileOnce(containedPath(root, payload_ref!.path), sidecarBytes);
      append(event);
      if (truncated) bump(manifest, "payload_truncated");
      if (eligible === 1 && sidecarBytes === null) bump(manifest, own(o, "content") ? "payload_withheld" : "payload_missing");
      return { status: "captured", event };
    });
  }

  function recordUpstreamLoss(input: { dropped: number | null }): CaptureResult {
    const n = input.dropped;
    if (n !== null && (!Number.isSafeInteger(n) || n < 0)) return { status: "refused", code: "malformed_host_event", detail: "dropped is not a count" };
    return transact((manifest, append) => {
      if (n === null) {
        manifest.upstream_drop_unknown = true;
        bump(manifest, "upstream_dropped_unknown");
      } else bump(manifest, "upstream_dropped", n);
      if (state.count >= limits.max_trace_events) {
        // No event can carry this loss: account it in the manifest instead.
        bump(manifest, "trace_cap_reached");
        if (n !== null) bump(manifest, "unrecorded", n);
        return { status: "refused", code: "trace_cap_reached", detail: `trace holds ${limits.max_trace_events} events` };
      }
      const e = lossEvent(state.count, "upstream_dropped", {
        eligible: n, covered: 0, excluded: 0, missing: n, state: n === 0 ? "complete" : "unavailable",
        reason: n === 0 ? null : n === null ? "host reported dropped telemetry of unknown size" : "host reported dropped telemetry", exclusion_reasons: [],
      });
      append(e);
      return { status: "captured", event: e };
    });
  }

  return { observe, recordUpstreamLoss };
}

// ── Retention ────────────────────────────────────────────────────────────────

/** Expire one sidecar: the content is deleted, the safe hash and reason stay in a tombstone. */
export function expireTraceSidecar(root: string, runId: string, eventId: string, reason: string, now: () => Date = () => new Date()): void {
  if (!isId(eventId) || !isBoundedStr(reason) || traceStringIsUnsafe(reason, [])) throw new Error("expireTraceSidecar: invalid event id or reason");
  const limits = { ...TRACE_CAPTURE_LIMITS };
  const result = withLock(root, runId, limits, () => {
    const rel = guildRel(runId, SIDECAR_DIR, `${eventId}.json`);
    const bytes = readContained(root, rel);
    if (bytes === null) return "absent" as const;
    const manifestRaw = readContained(root, guildRel(runId, MANIFEST_FILE));
    if (manifestRaw === null) throw new Error(`${runId} has no capture manifest`);
    const manifest = JSON.parse(manifestRaw) as TraceCaptureManifest;
    const tomb = { schema_version: TRACE_SIDECAR_TOMBSTONE_SCHEMA, event_id: eventId, sha256: revision(bytes), expired_at: now().toISOString(), reason };
    writeFileOnce(containedPath(root, guildRel(runId, SIDECAR_DIR, `${eventId}.expired.json`)), `${JSON.stringify(tomb, null, 2)}\n`);
    fs.rmSync(containedPath(root, rel), { force: true });
    bump(manifest, "retention_expired");
    writeReplace(containedPath(root, guildRel(runId, MANIFEST_FILE)), `${JSON.stringify(manifest, null, 2)}\n`);
    return "expired" as const;
  });
  if (result === "absent") throw new Error(`no sidecar for ${eventId}`);
}

// ── Read ─────────────────────────────────────────────────────────────────────

export interface TraceRead {
  events: TraceAnalysisV3[];
  invalid_lines: number;
  manifest: TraceCaptureManifest;
  coverage: TraceCoverage;
}

/** Read the trace with each payload's current availability resolved (expired, missing or tampered). */
export function readTrace(root: string, runId: string): TraceRead {
  const raw = readContained(root, guildRel(runId, TRACE_FILE)) ?? "";
  const torn_tail = raw.length > 0 && !raw.endsWith("\n");
  const complete = torn_tail ? raw.slice(0, raw.lastIndexOf("\n") + 1) : raw;
  const events: TraceAnalysisV3[] = [];
  let invalid_lines = 0;
  for (const line of complete.split("\n")) {
    if (!line) continue;
    let e: TraceAnalysisV3;
    try { e = JSON.parse(line) as TraceAnalysisV3; } catch { invalid_lines++; continue; }
    if (!validateTraceAnalysisV3(e).ok || e.lineage.run_id !== runId) { invalid_lines++; continue; }
    if (e.payload_ref) {
      const ref = e.payload_ref;
      const tomb = readContained(root, ref.path.replace(/\.json$/, ".expired.json"));
      const bytes = readContained(root, ref.path);
      if (tomb !== null) {
        const t = JSON.parse(tomb) as { sha256?: string; reason?: string };
        e.payload_ref = { ...ref, availability: "expired", reason: t.sha256 === ref.sha256 && isBoundedStr(t.reason) ? t.reason : "sidecar expired" };
      } else if (bytes === null) e.payload_ref = { ...ref, availability: "missing", reason: "sidecar absent" };
      else if (revision(bytes) !== ref.sha256) e.payload_ref = { ...ref, availability: "missing", reason: "sidecar bytes do not match the recorded hash" };
    }
    events.push(e);
  }
  const sourceId = events[0]?.lineage.source_id ?? "unknown";
  const manifest = readManifest(root, runId, sourceId);
  if (raw === "" && readContained(root, guildRel(runId, MANIFEST_FILE)) === null) {
    // No capture has run: that is unknown coverage, not an empty complete one.
    return { events, invalid_lines, manifest, coverage: { eligible: null, covered: 0, excluded: 0, missing: null, state: "unavailable", reason: "no capture recorded for this run", exclusion_reasons: [] } };
  }
  return { events, invalid_lines, manifest, coverage: traceCoverageOf(events, manifest, { torn_tail, invalid_lines }) };
}

// ── Export ───────────────────────────────────────────────────────────────────

const EXPORT_PATH_RE = (runId: string) =>
  new RegExp(`^runs/${runId.replace(/[.]/g, "\\.")}/(?:trace\\.jsonl|trace-capture-manifest\\.json|trace-sidecars/(?:ev|loss)-[a-f0-9]{32}(?:\\.expired)?\\.json)$`);
const SIDECAR_KEYS = new Set(["schema_version", "event_id", "kind", "dispatch_backend", "redaction_version", "hash_basis", "original_retained", "original_bytes", "persisted_bytes", "truncated", "redacted", "content"]);
const TOMBSTONE_KEYS = new Set(["schema_version", "event_id", "sha256", "expired_at", "reason"]);

/** The shareable trace files of a run (`.guild`-relative). Bindings, grants and lineage records are never in it. */
export function traceExportSet(root: string, runId: string): string[] {
  const out: string[] = [];
  for (const f of [TRACE_FILE, MANIFEST_FILE]) if (readContained(root, guildRel(runId, f)) !== null) out.push(guildRel(runId, f));
  const dirRel = path.join(".guild", guildRel(runId, SIDECAR_DIR));
  const checked = checkContained(root, dirRel, { policy: "physical" });
  if (!isRefused(checked) && fs.existsSync(checked.realPath)) {
    for (const f of fs.readdirSync(checked.realPath).sort()) out.push(guildRel(runId, SIDECAR_DIR, f));
  }
  return out;
}

/**
 * Audit what a run would export: only trace files, closed sidecar shapes, no
 * hidden reasoning keys, and no string the scrubber would change or that
 * carries a private literal.
 */
export function auditTraceExport(root: string, runId: string, opts: { private_literals: string[]; paths?: string[] }): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  const allowed = EXPORT_PATH_RE(runId);
  const literals = [...opts.private_literals].sort((a, b) => b.length - a.length);
  for (const rel of opts.paths ?? traceExportSet(root, runId)) {
    if (!allowed.test(rel)) { findings.push(`${rel}: outside the trace export set`); continue; }
    const bytes = readContained(root, rel);
    if (bytes === null) { findings.push(`${rel}: unreadable`); continue; }
    const docs: unknown[] = [];
    try {
      if (rel.endsWith(".jsonl")) for (const line of bytes.split("\n")) { if (line) docs.push(JSON.parse(line)); }
      else docs.push(JSON.parse(bytes));
    } catch {
      findings.push(`${rel}: not JSON`);
      continue;
    }
    for (const d of docs) {
      if (hiddenReasoningKeysIn(d).length) findings.push(`${rel}: hidden reasoning key`);
      if (rel.includes(`/${SIDECAR_DIR}/`) && isObj(d)) {
        const keys = rel.endsWith(".expired.json") ? TOMBSTONE_KEYS : SIDECAR_KEYS;
        for (const k of Object.keys(d)) if (!keys.has(k)) findings.push(`${rel}: unexpected field ${k}`);
      }
      if (rel.endsWith(".jsonl") && !validateTraceAnalysisV3(d).ok) findings.push(`${rel}: invalid trace event`);
      if (jsonIsUnsafe(d, literals)) findings.push(`${rel}: unscrubbed secret, token, home path or private value`);
    }
  }
  return { ok: findings.length === 0, findings };
}

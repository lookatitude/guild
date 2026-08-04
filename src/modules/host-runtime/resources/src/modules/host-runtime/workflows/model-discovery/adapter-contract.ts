/**
 * src/modules/host-runtime/workflows/model-discovery/adapter-contract.ts
 *
 * Common discovery-adapter contract — guild.model_catalog.v1 §6 (lane T4,
 * run-20260730-131020-dynamic-host-model-routing).
 *
 * Every adapter is: read-only, non-paid, bounded (default 3 s budget),
 * secret-safe, schema-validating (provider output is DATA, never executed),
 * redacted on failure (closed failure-reason vocabulary — no raw provider
 * output), versioned with a declared tool-version range (out-of-range ⇒
 * `unsupported`, never a guess), and fail-soft to honest `unknown`.
 *
 * IO is INJECTED. No adapter in this module opens a network connection or
 * spawns a subprocess by itself; the host wiring (T6) supplies a DiscoveryIo.
 * An absent IO capability resolves to an honest `unsupported` receipt.
 *
 * This module deliberately imports nothing from src/modules/capability —
 * capability depends on host-runtime, not the reverse. Adapters emit RAW
 * provider-shaped entries; capability/workflows/model-catalog.ts owns
 * normalization into guild.model_catalog.v1 and all evidence-state semantics.
 */

import { makeFingerprint } from "../session-context";

// ── Shared discovery vocabulary (catalog §1) ─────────────────────────────────

export type DiscoveryMethod =
  | "native_list"
  | "contract_api_list"
  | "debug_catalog"
  | "picker"
  | "static_hint"
  | "none";

export type DiscoveryStatus = "ok" | "partial" | "timeout" | "error" | "unsupported";

/**
 * Closed, redacted failure vocabulary (catalog §1: failure_reason is
 * "REDACTED; schema-validated; no raw provider output").
 */
export const FAILURE_REASONS = Object.freeze([
  "timeout_budget_exceeded",
  "parse_rejected",
  "io_unavailable",
  "tool_version_out_of_range",
  "subprocess_failed",
  "http_error",
  "auth_unavailable",
  "surface_absent",
] as const);
export type FailureReason = (typeof FAILURE_REASONS)[number];

export function isFailureReason(value: unknown): value is FailureReason {
  return typeof value === "string" && (FAILURE_REASONS as readonly string[]).includes(value);
}

/** Listing sources that are authenticated target-native surfaces. */
export type ListingSource = "native_list" | "contract_api_list" | "debug_catalog" | "picker" | "static_hint";

// ── Raw adapter output (normalized by capability/model-catalog.ts) ───────────

export interface RawModelEntry {
  canonical_id: string;
  display_name?: string;
  aliases?: string[];
  /** Only when provider-stated or resolved by the adapter's versioned mapping table. */
  model_family?: string;
  /** Provider order preserved VERBATIM (matrix §5 [C5][P3]). */
  reasoning_efforts?: string[];
  default_effort?: string | null;
  provider_priority?: number | null;
  provider_default?: boolean;
  visibility?: "listed" | "hidden";
  deprecation?: { upgrade_to: string | null; migration_note: string | null };
  /** Superset capability object; keys follow the Claude /v1/models capability schema. */
  capabilities?: Record<string, unknown>;
  evidence_source: ListingSource;
  /**
   * True ONLY when the listing surface's CONTRACT states account availability
   * for this target (today: the Claude API `GET /v1/models` row alone).
   */
  contract_states_availability: boolean;
}

export interface RawDiscoveryResult {
  adapter_id: string;
  adapter_version: string;
  target_id: string;
  method: DiscoveryMethod;
  source_ref: string;
  status: DiscoveryStatus;
  latency_ms: number;
  failure_reason: FailureReason | null;
  models: RawModelEntry[];
}

// ── Injected IO seam ─────────────────────────────────────────────────────────

export interface DiscoveryIo {
  /** JSON-RPC call against an already-running app-server (e.g. codex `model/list`). */
  jsonRpcCall?(method: string, params: Record<string, unknown>): Promise<unknown>;
  /** Capture stdout of a read-only local command (argv form — never shell-interpolated). */
  execCapture?(argv: string[]): Promise<{ stdout: string }>;
  /** Authenticated read-only GET returning parsed JSON. */
  httpGetJson?(url: string, headers: Record<string, string>): Promise<unknown>;
  /** RFC3339 clock (injected so fixtures stay deterministic). */
  nowIso(): string;
  /** Monotonic ms clock for latency accounting. */
  monotonicMs(): number;
}

/** An IO with no capabilities: every networked/subprocess seam resolves honest-unavailable. */
export function nullIo(nowIso = "1970-01-01T00:00:00Z"): DiscoveryIo {
  return { nowIso: () => nowIso, monotonicMs: () => 0 };
}

export class DiscoveryBudgetExceeded extends Error {
  constructor() {
    super("discovery budget exceeded");
    this.name = "DiscoveryBudgetExceeded";
  }
}

export class DiscoveryParseRejected extends Error {
  constructor(detail: string) {
    // Detail is a SCHEMA-level description (field names only) — never raw provider bytes.
    super(`provider output rejected by schema validation: ${detail}`);
    this.name = "DiscoveryParseRejected";
  }
}

export const DEFAULT_DISCOVERY_BUDGET_MS = 3000;

/** Race a discovery IO promise against the budget; loser is discarded. */
export async function withBudget<T>(work: Promise<T>, budgetMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DiscoveryBudgetExceeded()), budgetMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Adapter shape + versioned tool-version gate ──────────────────────────────

export interface ToolVersionRange {
  /** Inclusive minimum tool version (semver-ish x.y.z compare). */
  min: string;
  /** Exclusive maximum tool version. */
  maxExclusive: string;
}

export interface DiscoveryAdapter {
  adapter_id: string;
  adapter_version: string;
  target_id: string;
  method: DiscoveryMethod;
  /** Declared supported (tool_version) range; out-of-range ⇒ `unsupported`. */
  tool_versions: ToolVersionRange | null;
  discover(io: DiscoveryIo, opts?: { budgetMs?: number; toolVersion?: string }): Promise<RawDiscoveryResult>;
}

/** Numeric-dotted version compare; unparseable segments compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^[^0-9]*/, "").split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.replace(/^[^0-9]*/, "").split(".").map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function toolVersionInRange(toolVersion: string | undefined, range: ToolVersionRange | null): boolean {
  if (!range) return true;
  if (!toolVersion) return false; // unknown version ⇒ honest unsupported, never a guess
  return compareVersions(toolVersion, range.min) >= 0 && compareVersions(toolVersion, range.maxExclusive) < 0;
}

/** Honest failure receipt shared by every adapter's degrade path. */
export function failureResult(
  adapter: Pick<DiscoveryAdapter, "adapter_id" | "adapter_version" | "target_id" | "method">,
  status: Exclude<DiscoveryStatus, "ok" | "partial">,
  failureReason: FailureReason,
  latencyMs: number,
  sourceRef: string
): RawDiscoveryResult {
  if (!isFailureReason(failureReason)) throw new Error("failure_reason outside the closed vocabulary");
  return {
    adapter_id: adapter.adapter_id,
    adapter_version: adapter.adapter_version,
    target_id: adapter.target_id,
    method: adapter.method,
    source_ref: sourceRef,
    status,
    latency_ms: latencyMs,
    failure_reason: failureReason,
    models: [],
  };
}

/**
 * Run one adapter with the common guards: tool-version gate, budget, and
 * error normalization into the closed failure vocabulary. Never throws; the
 * degrade path is an honest receipt (fail-soft to cache/unknown is the cache
 * layer's job).
 */
export async function runAdapter(
  adapter: DiscoveryAdapter,
  io: DiscoveryIo,
  opts: { budgetMs?: number; toolVersion?: string } = {}
): Promise<RawDiscoveryResult> {
  const budgetMs = opts.budgetMs ?? DEFAULT_DISCOVERY_BUDGET_MS;
  const started = io.monotonicMs();
  const elapsed = () => Math.max(0, io.monotonicMs() - started);
  if (!toolVersionInRange(opts.toolVersion, adapter.tool_versions)) {
    return failureResult(adapter, "unsupported", "tool_version_out_of_range", elapsed(), adapter.adapter_id);
  }
  try {
    return await withBudget(adapter.discover(io, { ...opts, budgetMs }), budgetMs);
  } catch (err) {
    if (err instanceof DiscoveryBudgetExceeded) {
      return failureResult(adapter, "timeout", "timeout_budget_exceeded", elapsed(), adapter.adapter_id);
    }
    if (err instanceof DiscoveryParseRejected) {
      return failureResult(adapter, "error", "parse_rejected", elapsed(), adapter.adapter_id);
    }
    return failureResult(adapter, "error", "subprocess_failed", elapsed(), adapter.adapter_id);
  }
}

// ── Non-reversible target fingerprints (session_context §6) ──────────────────

// The fingerprint primitives are OWNED by T3's session-context workflow
// (makeFingerprint / loadOrCreateFingerprintSalt in
// src/modules/host-runtime/workflows/session-context.ts) — deliberately not
// duplicated here. This module adds only the unknown-safe convenience wrapper
// adapters need when an identity dimension is unobservable.

/** Fingerprint when observable; the literal `unknown` when not (never omitted, never guessed). */
export function fingerprintOrUnknown(raw: string | null | undefined, salt: string): string {
  if (raw == null || raw === "") return "unknown";
  return makeFingerprint(raw, salt);
}

/**
 * src/modules/capability/workflows/model-catalog.ts
 *
 * guild.model_catalog.v1 — normalization, evidence states/transitions, and
 * purpose-aware eligibility (lane T4,
 * run-20260730-131020-dynamic-host-model-routing; frozen contract at
 * .guild/runs/<run-id>/contracts/guild.model_catalog.v1.md).
 *
 * Core invariants owned here:
 *  - Evidence states are CLOSED: available | advertised | unknown | unavailable.
 *  - Entitlement truth is target-scoped: NO cross-target projection, ever (§2).
 *  - Public docs / static hints / unauthenticated lists fill metadata only and
 *    emit at most `advertised` — they can never produce `available` (§4).
 *  - Transitions are append-only evidence EVENTS on a target log; a frozen run
 *    snapshot is never rewritten (SC-8). TTL expiry means STALE, never
 *    `unavailable`.
 *  - A dispatch upgrades only the exact (target, model) pair actually served,
 *    and only when the served identity is provider-reported (§4).
 *  - Eligibility is the closed, purpose-aware §5 matrix.
 */

import {
  DiscoveryMethod,
  DiscoveryStatus,
  FailureReason,
  RawDiscoveryResult,
  RawModelEntry,
} from "../../host-runtime";
import {
  DEFAULT_CATALOG_TTL_SECONDS,
  MODEL_CATALOG_SCHEMA_VERSION,
} from "./catalog-cache";
import { sealSet } from "../../kernel";

// ── Closed vocabularies ──────────────────────────────────────────────────────

export const EVIDENCE_STATES = Object.freeze(["available", "advertised", "unknown", "unavailable"] as const);
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export type EvidenceConfidence = "high" | "medium" | "low";
export type CatalogTier = "cheap" | "mid" | "powerful" | "unknown";
export type PurposeClass = "general" | "research" | "review";

export interface ModelEvidence {
  state: EvidenceState;
  source: string;
  confidence: EvidenceConfidence;
  as_of: string;
}

export interface CatalogModel {
  canonical_id: string;
  aliases: string[];
  model_family: string;
  capabilities: Record<string, unknown>;
  reasoning_efforts: string[];
  default_effort: string | null;
  tier: CatalogTier;
  provider_priority: number | null;
  catalog_index: number;
  provider_default: boolean;
  visibility: "listed" | "hidden";
  deprecation: { upgrade_to: string | null; migration_note: string | null };
  evidence: ModelEvidence;
  dispatch_evidence: {
    last_success_at: string | null;
    last_failure_at: string | null;
    last_failure_class: string | null;
  } | null;
}

export interface CatalogTarget {
  target_id: string;
  family: string;
  surface: string;
  provider_kind: string;
  auth_mode: string;
  account_fingerprint: string;
  endpoint_fingerprint: string;
  org_fingerprint: string;
  tool_version: string;
  adapter_id: string;
  adapter_version: string;
}

export interface CatalogDiscovery {
  method: DiscoveryMethod;
  source_ref: string;
  discovered_at: string;
  ttl_seconds: number;
  status: DiscoveryStatus;
  latency_ms: number;
  failure_reason: FailureReason | null;
}

export interface CatalogSnapshot {
  schema_version: typeof MODEL_CATALOG_SCHEMA_VERSION;
  target: CatalogTarget;
  discovery: CatalogDiscovery;
  generation: number;
  models: CatalogModel[];
}

// ── Purpose-aware eligibility (§5, closed) ───────────────────────────────────

/** Map the full purpose vocabulary onto the §5 matrix's three purpose classes. */
export function purposeClassFor(purpose: string): PurposeClass {
  if (purpose === "research") return "research";
  if (["advisory", "adversarial", "security", "adversarial-security", "review"].includes(purpose)) {
    return "review";
  }
  return "general";
}

/**
 * The closed §5 eligibility matrix. `advertised` is attemptable ONLY as the
 * operator's normal requested work for the general class with
 * `allow_advertised_attempt: true`; research and review purposes never accept
 * anything below `available`. `unknown`/`unavailable` are never eligible.
 */
export function eligibleForPurpose(input: {
  evidence_state: string;
  purpose_class: string;
  allow_advertised_attempt: boolean;
}): boolean {
  if (input.evidence_state === "available") return true;
  if (input.evidence_state === "advertised") {
    return purposeClassFor(input.purpose_class) === "general" && input.allow_advertised_attempt === true;
  }
  return false;
}

// ── Evidence state derivation for listings (§3/§4/§6) ────────────────────────

/** Sources that are authenticated target-native listing surfaces. */
const AUTHENTICATED_LISTING_SOURCES = new Set(["contract_api_list", "native_list", "debug_catalog", "picker"]);
/** Sources that can NEVER prove entitlement, whatever flags they carry (§4 hard rule). */
const METADATA_ONLY_SOURCES = new Set(["static_hint", "public_doc", "unauthenticated_list"]);

/**
 * Row-keyed listing authority (§6, closed) — the SINGLE place that decides
 * what a listing can ground per target row. `available_grounding` names the
 * exact (adapter_id, source) pair whose listing CONTRACT states account
 * availability; every other row is `null` — no adapter-supplied flag, source
 * label, or forged result can promote a listing past `ceiling` for its row.
 * Consulted by evidenceStateForListing (normalization) AND
 * appendEvidenceEvent (transitions). An unregistered target fails CLOSED to
 * the no-grounding row.
 */
export interface ListingAuthorityRow {
  /** Maximum evidence state ANY listing can ground for this target row. */
  ceiling: Extract<EvidenceState, "available" | "advertised">;
  /** The exact adapter+source whose contract grounds `available`; null = none exists. */
  available_grounding: { adapter_id: string; source: string } | null;
}

const NO_LISTING_GROUNDING: ListingAuthorityRow = Object.freeze({
  ceiling: "advertised" as const,
  available_grounding: null,
});

export const LISTING_AUTHORITY: Readonly<Record<string, ListingAuthorityRow>> = Object.freeze({
  // The ONLY row carrying the /v1/models availability contract (matrix §3 [C2]).
  "claude-api": Object.freeze({
    ceiling: "available" as const,
    available_grounding: Object.freeze({ adapter_id: "claude-api-models", source: "contract_api_list" }),
  }),
  // Interactive-only picker; honest-unknown row — a picker listing can NEVER ground available.
  "claude-cli-subscription": NO_LISTING_GROUNDING,
  "claude-app": NO_LISTING_GROUNDING,
  "claude-web": NO_LISTING_GROUNDING,
  // Gateways: gateway-NATIVE evidence only, none evidenced today (§6 gateway rule) —
  // a listing caps at static-hint/native advertised; only §4 dispatch evidence upgrades.
  "claude-gateway-bedrock": NO_LISTING_GROUNDING,
  "claude-gateway-vertex": NO_LISTING_GROUNDING,
  "claude-gateway-foundry": NO_LISTING_GROUNDING,
  // Codex auth-list surfaces: entitlement semantics contractually undefined.
  "codex-app-server": NO_LISTING_GROUNDING,
  "codex-cli-chatgpt": NO_LISTING_GROUNDING,
  "codex-cli-api-key": NO_LISTING_GROUNDING,
  "openai-api": NO_LISTING_GROUNDING,
});

/** The authority row for a target — unregistered targets fail closed (no grounding). */
export function listingAuthorityFor(targetId: string | undefined): ListingAuthorityRow {
  if (targetId === undefined) return NO_LISTING_GROUNDING;
  return LISTING_AUTHORITY[targetId] ?? NO_LISTING_GROUNDING;
}

/** Non-empty-string check shared by the triple validators. */
function isPresent(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * MODULE-PRIVATE (T4-R2-001): true only when this exact (target row, adapter,
 * source) triple is the one whose listing contract grounds `available`. Every
 * component of the authority triple is REQUIRED — there is no adapter-absent
 * or target-absent leniency, and this predicate is deliberately NOT exported:
 * the only public paths to an evidence state are evidenceStateForListing and
 * appendEvidenceEvent, both of which demand the complete triple.
 */
function listingCanGroundAvailable(input: {
  target_id: string;
  adapter_id: string;
  source: string;
}): boolean {
  const grounding = listingAuthorityFor(input.target_id).available_grounding;
  if (!grounding) return false;
  return grounding.source === input.source && grounding.adapter_id === input.adapter_id;
}

/**
 * Evidence state a LISTING grounds. The decision is a closed target-row +
 * adapter decision (LISTING_AUTHORITY), NOT a caller-controlled boolean:
 * `available` requires (a) the exact (target_id, adapter_id, source) row
 * grounding — today the claude-api `contract_api_list` adapter alone — AND
 * (b) the adapter's contract_states_availability attestation. Every other
 * listing — picker, native_list, debug_catalog, public docs, static hints —
 * emits at most `advertised`, whatever flags it carries.
 *
 * The full authority triple is MANDATORY (T4-R2-001): there is no bare
 * source-only form — a call without a non-empty target_id AND adapter_id
 * throws rather than derive any state. Unregistered targets fail closed to
 * `advertised`.
 */
export function evidenceStateForListing(input: {
  source: string;
  contract_states_availability: boolean;
  target_id: string;
  adapter_id: string;
}): EvidenceState {
  if (!isPresent(input.source) || !isPresent(input.target_id) || !isPresent(input.adapter_id)) {
    throw new Error(
      "model-catalog: evidenceStateForListing requires the complete (target_id, adapter_id, source) " +
        "authority triple — the bare source-only form was removed (T4-R2-001)"
    );
  }
  if (METADATA_ONLY_SOURCES.has(input.source)) return "advertised";
  if (!AUTHENTICATED_LISTING_SOURCES.has(input.source)) return "advertised";
  if (input.contract_states_availability !== true) return "advertised";
  return listingCanGroundAvailable({
    target_id: input.target_id,
    adapter_id: input.adapter_id,
    source: input.source,
  })
    ? "available"
    : "advertised";
}

/** Listing confidence: authenticated surfaces high; metadata-only sources low. */
export function confidenceForListing(source: string): EvidenceConfidence {
  return AUTHENTICATED_LISTING_SOURCES.has(source) ? "high" : "low";
}

// ── Dispatch upgrades (§4) ───────────────────────────────────────────────────

/**
 * A successful NORMAL dispatch upgrades only the exact (target, model) pair
 * actually served — and only when the served identity is provider-reported.
 * An `actual_model: unknown` outcome upgrades NOTHING.
 */
export function dispatchUpgrade(input: {
  result: string;
  actual_model: string | null | undefined;
  requested_model?: string;
}): { upgrades: boolean; model: string | null } {
  const served = input.actual_model;
  if (input.result !== "served" || served == null || served === "" || served === "unknown") {
    return { upgrades: false, model: null };
  }
  return { upgrades: true, model: served };
}

// ── Append-only transitions on the target evidence log (§4; SC-8) ────────────

/** The closed legality table for evidence transitions. */
export const LEGAL_EVIDENCE_TRANSITIONS: ReadonlySet<string> = sealSet([
  "unknown->advertised",
  "unknown->available",
  "advertised->available",
  "advertised->unavailable",
  "available->unavailable",
  "advertised->unknown",
  "available->unknown",
  "unavailable->unknown",
]);

/** Transitions that do NOT end in `available` — no grounding evidence needed. */
export type NonAvailableEvidenceTransition =
  | "unknown->advertised"
  | "advertised->unavailable"
  | "available->unavailable"
  | "advertised->unknown"
  | "available->unknown"
  | "unavailable->unknown";

/** The two legal promotions into `available` — always grounding-gated. */
export type AvailableEvidenceTransition = "unknown->available" | "advertised->available";

interface EvidenceEventBase {
  model: string;
  as_of?: string;
  [extra: string]: unknown;
}

/**
 * `->available` events are a TYPED DISCRIMINATED UNION (T4-R2-001): either a
 * §4 dispatch receipt carrying the served target's identity, or listing
 * evidence carrying the complete (target_id, adapter_id, source) authority
 * triple. There is no third shape — a sourceless, targetless, or adapterless
 * promotion is unrepresentable in the type and rejected at runtime.
 */
export type DispatchReceiptAvailableEvent = EvidenceEventBase & {
  transition: AvailableEvidenceTransition;
  source: "dispatch_receipt";
  /** The exact target the dispatch was served on (§4: pair-scoped upgrade). */
  target_id: string;
};

export type ListingAvailableEvent = EvidenceEventBase & {
  transition: AvailableEvidenceTransition;
  /** Listing source label; must be the event row's contract-availability source. */
  source: string;
  /** Target row the event belongs to — ->available is always row-gated. */
  target_id: string;
  /** Adapter that produced the listing evidence — row-grounding is triple-exact. */
  adapter_id: string;
};

export type NonAvailableEvidenceEvent = EvidenceEventBase & {
  transition: NonAvailableEvidenceTransition;
  source?: string;
  target_id?: string;
  adapter_id?: string;
};

export type EvidenceEvent =
  | NonAvailableEvidenceEvent
  | DispatchReceiptAvailableEvent
  | ListingAvailableEvent;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Freeze a run's catalog snapshot (SC-8): the returned snapshot is deeply
 * immutable — an active run keeps resolving against it — while `target_log`
 * is the separate, mutable append-only evidence log later events land on.
 */
export function freezeSnapshot<T extends Record<string, unknown>>(
  snapshot: T
): T & { target_log: EvidenceEvent[] } {
  const log: EvidenceEvent[] = [];
  const frozen = { ...snapshot, target_log: log };
  for (const key of Object.keys(snapshot)) {
    deepFreeze(frozen[key]);
  }
  Object.freeze(frozen);
  return frozen as T & { target_log: EvidenceEvent[] };
}

/**
 * Append an evidence event to a target log — the ONLY exported transition
 * path (T4-R2-001). Validates the transition against the closed table; every
 * `->available` event must be one of the two typed grounded shapes:
 *  - a §4 dispatch receipt (`source: "dispatch_receipt"`) carrying the served
 *    target's identity (non-empty target_id), or
 *  - listing evidence carrying the COMPLETE (target_id, adapter_id, source)
 *    authority triple that the event row's LISTING_AUTHORITY entry grounds —
 *    the same row-keyed ceiling table normalization consults, so no adapter
 *    can out-promote its row through the transition path either.
 * A `->available` event with no source, no target row, or (for listings) no
 * adapter is rejected — the round-2 bare-form fallbacks are gone. Never
 * touches any frozen snapshot.
 */
export function appendEvidenceEvent(log: EvidenceEvent[], event: EvidenceEvent): EvidenceEvent[] {
  if (!Array.isArray(log)) throw new Error("model-catalog: target_log is not an array");
  if (!LEGAL_EVIDENCE_TRANSITIONS.has(event.transition)) {
    throw new Error(`model-catalog: illegal evidence transition ${JSON.stringify(event.transition)}`);
  }
  if (event.transition.endsWith("->available")) {
    const source: unknown = event.source;
    const targetId: unknown = event.target_id;
    const adapterId: unknown = event.adapter_id;
    if (!isPresent(source)) {
      throw new Error(
        "model-catalog: ->available requires grounding evidence — a sourceless promotion is illegal (T4-R2-001)"
      );
    }
    if (!isPresent(targetId)) {
      throw new Error(
        `model-catalog: ->available is target-row-scoped — event source ${JSON.stringify(source)} ` +
          "carries no target_id (T4-R2-001)"
      );
    }
    if (source !== "dispatch_receipt") {
      if (!isPresent(adapterId)) {
        throw new Error(
          `model-catalog: a listing-sourced ->available requires the complete (target_id, adapter_id, source) ` +
            `authority triple — ${JSON.stringify(source)} for target ${JSON.stringify(targetId)} ` +
            "carries no adapter_id (T4-R2-001); only a dispatch receipt or the row's contract-availability listing grounds available"
        );
      }
      if (!listingCanGroundAvailable({ target_id: targetId, adapter_id: adapterId, source })) {
        throw new Error(
          `model-catalog: ->available requires a dispatch receipt or the target row's contract-availability listing, got ` +
            `${JSON.stringify(source)} via adapter ${JSON.stringify(adapterId)} for target ${JSON.stringify(targetId)}`
        );
      }
    }
  }
  log.push(event);
  return log;
}

// ── Target-scoped truth (§2) + honest-unknown defaults (§6) ──────────────────

/**
 * Cross-target projection is forbidden without exception: an entitlement or
 * availability claim is truth only for the exact target tuple that produced it.
 */
export function projectionAllowed(input: { from_target: string; to_target: string }): boolean {
  return input.from_target === input.to_target;
}

/**
 * Absent evidence, EVERY target resolves honest `unknown` (§3: unknown = "no
 * honest evidence"). This includes — normatively, per the §6 adapter rows —
 * the three gateways and the claude-cli/app/web targets, which have no
 * evidenced availability-listing surface at all today.
 */
export function defaultEvidenceStateForTarget(_targetId: string): EvidenceState {
  return "unknown";
}

// ── Versioned tier mapping (§1: `unknown` when unmapped — never guessed) ─────

export const TIER_MAPPING_VERSION = "tier-map-v1-2026-07-30";

/** Exact-prefix rows, most-specific first; anything unmatched is `unknown`. */
const TIER_MAP: ReadonlyArray<{ prefix: string; tier: CatalogTier }> = [
  { prefix: "claude-haiku-", tier: "cheap" },
  { prefix: "claude-sonnet-", tier: "mid" },
  { prefix: "claude-opus-", tier: "powerful" },
  { prefix: "claude-fable-", tier: "powerful" },
  { prefix: "claude-fable", tier: "powerful" },
  { prefix: "gpt-5.6-sol", tier: "powerful" },
  { prefix: "gpt-5.6-terra", tier: "mid" },
  { prefix: "gpt-5.6-luna", tier: "cheap" },
  { prefix: "gpt-5.5", tier: "powerful" },
  { prefix: "gpt-5.4-mini", tier: "cheap" },
  { prefix: "gpt-5.4", tier: "mid" },
  { prefix: "gpt-5.3-codex-spark", tier: "cheap" },
];

export function tierForCanonicalId(canonicalId: string): CatalogTier {
  for (const row of TIER_MAP) {
    if (canonicalId.startsWith(row.prefix)) return row.tier;
  }
  return "unknown";
}

// ── Normalization: raw adapter output → guild.model_catalog.v1 ───────────────

export interface NormalizeOptions {
  target: CatalogTarget;
  discoveredAt: string;
  generation: number;
  ttlSeconds?: number;
}

function normalizeModel(
  raw: RawModelEntry,
  index: number,
  asOf: string,
  row: { target_id: string; adapter_id: string }
): CatalogModel {
  const state = evidenceStateForListing({
    source: raw.evidence_source,
    contract_states_availability: raw.contract_states_availability,
    target_id: row.target_id,
    adapter_id: row.adapter_id,
  });
  return {
    canonical_id: raw.canonical_id,
    aliases: raw.aliases ?? [],
    model_family: raw.model_family ?? "unknown",
    capabilities: raw.capabilities ?? {},
    reasoning_efforts: raw.reasoning_efforts ?? [], // provider order VERBATIM
    default_effort: raw.default_effort ?? null,
    tier: tierForCanonicalId(raw.canonical_id),
    provider_priority: raw.provider_priority ?? null,
    catalog_index: index, // 0-based provider listing position, as returned
    provider_default: raw.provider_default === true,
    visibility: raw.visibility ?? "listed",
    deprecation: raw.deprecation ?? { upgrade_to: null, migration_note: null },
    evidence: {
      state,
      source: raw.evidence_source,
      confidence: confidenceForListing(raw.evidence_source),
      as_of: asOf,
    },
    dispatch_evidence: null,
  };
}

/**
 * Normalize one raw discovery result into a guild.model_catalog.v1 snapshot.
 * Failed/unsupported discoveries keep their honest receipt; their models list
 * carries at most static-hint `advertised` metadata and the target's evidence
 * posture stays `unknown` (defaultEvidenceStateForTarget).
 */
export function normalizeDiscovery(raw: RawDiscoveryResult, opts: NormalizeOptions): CatalogSnapshot {
  if (raw.target_id !== opts.target.target_id) {
    // §2: a snapshot is truth only for the target that produced it.
    throw new Error(
      `model-catalog: discovery target ${JSON.stringify(raw.target_id)} does not match snapshot target ${JSON.stringify(opts.target.target_id)}`
    );
  }
  return {
    schema_version: MODEL_CATALOG_SCHEMA_VERSION,
    target: {
      ...opts.target,
      adapter_id: raw.adapter_id,
      adapter_version: raw.adapter_version,
    },
    discovery: {
      method: raw.method,
      source_ref: raw.source_ref,
      discovered_at: opts.discoveredAt,
      ttl_seconds: opts.ttlSeconds ?? DEFAULT_CATALOG_TTL_SECONDS,
      status: raw.status,
      latency_ms: raw.latency_ms,
      failure_reason: raw.failure_reason,
    },
    generation: opts.generation,
    models: raw.models.map((m, i) =>
      normalizeModel(m, i, opts.discoveredAt, {
        target_id: opts.target.target_id,
        adapter_id: raw.adapter_id,
      })
    ),
  };
}

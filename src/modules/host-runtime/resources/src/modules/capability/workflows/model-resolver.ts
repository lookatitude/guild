/**
 * src/modules/capability/workflows/model-resolver.ts
 *
 * guild.model_resolution.v1 — deterministic resolver + frozen-fallback receipts
 * (frozen contract: run-20260730-131020-dynamic-host-model-routing contracts;
 * SC-6, SC-9). Lane T5.
 *
 * Owns:
 *   - §2 total catalog order, selector expansion, route selection
 *     (route_unbound fails closed), candidate assembly + ordered filtering;
 *   - §3 frozen-fallback honesty: the chain is materialized at resolution time
 *     and later catalog/settings changes never alter it;
 *   - §4 closed failure taxonomy (only the eligible classes advance the chain);
 *   - §5 provider-side substitution classes (requested vs actual_model are
 *     ALWAYS separate; provider_silent ⇒ actual_model "unknown", NEVER the
 *     requested model);
 *   - §8 receipt lifecycle: frozen core + append-only outcome, finalized
 *     exactly once; unfinalized-at-resume receipts finalize as `interrupted`.
 *
 * Determinism (§2 guarantee): given byte-identical inputs, two conforming
 * implementations produce identical selection, fallbacks, rejections,
 * rule_path, and fallback_hash. No wall-clock enters the frozen core.
 */

import * as fs from "fs";
import * as path from "path";

import {
  canonicalYaml,
  codePointCompare,
  selfReferentialHash,
  sha256Hex,
} from "../../teams";
import { eligibleForPurpose } from "./model-catalog";
import {
  parseSelector,
  purposeComplexityFloor,
  purposeTierFloor,
  maxComplexity,
  validateModelPolicy,
  isReviewClassPurpose,
  type ModelPolicyV2,
  type PolicyComplexity,
  type PolicyPurpose,
  type PolicyRoute,
  type PolicySelectorEntry,
  type ParsedSelector,
} from "./model-policy";

// ── §4 closed failure taxonomy ───────────────────────────────────────────────

/** failure_class → does an eligible failure advance the frozen chain? */
export const FALLBACK_FAILURE_TAXONOMY: Readonly<Record<string, boolean>> = Object.freeze({
  model_overloaded: true,
  model_unavailable: true,
  server_nonretryable: true,
  auth_error: false,
  billing_error: false,
  rate_limited: false,
  request_invalid: false,
  transport_error: false,
  policy_refusal: false,
});

export const RESOLUTION_STATUSES = Object.freeze([
  "served",
  "fallback_served",
  "exhausted",
  "user_declined",
  "failed_closed",
  "interrupted",
] as const);
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

export type SubstitutionClass =
  | "none"
  | "provider_content_fallback"
  | "provider_server_fallback"
  | "provider_silent";

// ── Receipt shapes ───────────────────────────────────────────────────────────

export interface FrozenFallbackEntry {
  model: string;
  effort?: string | null;
  evidence_state?: string;
  source?: "preferred" | "fallback" | "provider_default";
  independence_note?: string | null;
}

export interface AttemptRecord {
  model: string;
  effort?: string | null;
  result: "served" | "failed";
  failure_class?: string | null;
  substitution_class?: SubstitutionClass | null;
  actual_model?: string | null;
}

export interface ResolutionReceipt {
  schema_version?: string;
  run_id?: string;
  dispatch_id?: string;
  refs?: Record<string, { path_or_id: string; sha256: string }>;
  request?: Record<string, unknown> | null;
  selection?: Record<string, unknown> | null;
  fallbacks: FrozenFallbackEntry[];
  fallback_hash?: string;
  rejections?: Array<{ model: string; reason: string }>;
  review?: Record<string, unknown>;
  rule_path?: string[];
  resolution_core_hash_algorithm?: string;
  resolution_core_hash_scope?: string;
  resolution_core_hash?: string;
  outcome: {
    attempted: AttemptRecord[];
    actual_model?: string;
    degradation?: { kind: string; note: string } | null;
    user_confirmation?: Record<string, unknown> | null;
    status?: ResolutionStatus;
  };
  finalized_at?: string | null;
  receipt_hash_algorithm?: string;
  receipt_hash_scope?: string;
  receipt_hash?: string | null;
  [k: string]: unknown;
}

// ── Catalog snapshot shapes (guild.model_catalog.v1 §1, structurally typed) ──

export interface CatalogSnapshotModel {
  canonical_id: string;
  aliases?: string[];
  model_family?: string;
  capabilities?: Record<string, unknown>;
  reasoning_efforts?: string[];
  default_effort?: string | null;
  tier?: string;
  provider_priority?: number | null;
  catalog_index?: number;
  provider_default?: boolean;
  evidence?: { state?: string };
  [k: string]: unknown;
}

// ── §2 total catalog order (normative) ───────────────────────────────────────

/**
 * Ascending by (provider_priority with null ordered LAST, catalog_index,
 * canonical_id in UTF-8 byte order). catalog_index is unique per snapshot, so
 * the order is total; the id tie-break keeps it total across merged views.
 */
export function totalCatalogOrder(models: CatalogSnapshotModel[]): CatalogSnapshotModel[] {
  return [...models].sort((a, b) => {
    const pa = a.provider_priority ?? null;
    const pb = b.provider_priority ?? null;
    if (pa !== pb) {
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb;
    }
    const ia = a.catalog_index ?? Number.MAX_SAFE_INTEGER;
    const ib = b.catalog_index ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return codePointCompare(a.canonical_id ?? "", b.canonical_id ?? "");
  });
}

/** §2 selector expansion against the FROZEN snapshot only (grammar: policy §1a). */
export function expandSelector(
  parsed: ParsedSelector,
  orderedModels: CatalogSnapshotModel[]
): CatalogSnapshotModel[] {
  if (parsed.form === "id") {
    return orderedModels.filter((m) => m.canonical_id === parsed.canonical_id);
  }
  if (parsed.form === "alias") {
    return orderedModels.filter((m) => Array.isArray(m.aliases) && m.aliases.includes(parsed.alias));
  }
  return orderedModels.filter((m) => {
    if (parsed.model_family !== undefined && m.model_family !== parsed.model_family) return false;
    if (parsed.tier !== undefined && m.tier !== parsed.tier) return false;
    return true;
  });
}

// ── Route selection (§2; shape + condition semantics: policy §1b) ────────────

export interface RouteSelectionResult {
  index: number;
  route: PolicyRoute & Record<string, unknown>;
  /** Every evaluated row's condition result, in listed order (rule_path input). */
  evaluations: Array<{ index: number; complexity_match: boolean; condition_result: boolean }>;
  condition_input: string | null;
}

function evaluateCondition(
  condition: { kind?: string; model_family?: string | null } | undefined,
  producerModelFamily: string | null | undefined
): boolean {
  if (!condition || condition.kind === "always") return true;
  // An unknown/absent producer model_family makes BOTH non-always kinds false.
  if (
    producerModelFamily === undefined ||
    producerModelFamily === null ||
    producerModelFamily === "unknown"
  ) {
    return false;
  }
  if (condition.kind === "producer_model_family_is") {
    return producerModelFamily === condition.model_family;
  }
  if (condition.kind === "producer_model_family_is_not") {
    return producerModelFamily !== condition.model_family;
  }
  return false; // unknown kind never matches (validator rejects it upstream)
}

/**
 * First-match route selection in LISTED order. No matching row ⇒ fail closed
 * with `route_unbound` — never a silent default (impossible for a
 * validator-accepted policy; reaching it is a contract violation).
 */
export function selectRoute(input: {
  routes: Array<PolicyRoute & Record<string, unknown>>;
  effective_complexity: PolicyComplexity;
  producer_model_family?: string | null;
}): RouteSelectionResult {
  const evaluations: RouteSelectionResult["evaluations"] = [];
  const conditionInput =
    input.producer_model_family === undefined ? null : input.producer_model_family;
  for (let i = 0; i < input.routes.length; i++) {
    const row = input.routes[i];
    const complexityMatch =
      row.complexity === "any" || row.complexity === input.effective_complexity;
    const conditionResult = evaluateCondition(
      row.condition as { kind?: string; model_family?: string | null } | undefined,
      input.producer_model_family
    );
    evaluations.push({ index: i, complexity_match: complexityMatch, condition_result: conditionResult });
    if (complexityMatch && conditionResult) {
      return { index: i, route: row, evaluations, condition_input: conditionInput };
    }
  }
  throw new Error(
    `route_unbound: no route row matches effective_complexity "${input.effective_complexity}" ` +
      `(fail closed — a validator-accepted policy cannot reach this; contract violation)`
  );
}

// ── Frozen chain + receipt lifecycle (§3, §8) ────────────────────────────────

/**
 * Test/observability seam: a module-level "live catalog" that
 * simulateCatalogChange mutates. Frozen chains deep-copy their entries, so a
 * live-catalog change NEVER alters an already-frozen receipt (§3).
 */
const liveCatalog = new Map<string, CatalogSnapshotModel>();

export function simulateCatalogChange(change: { remove?: string; upsert?: CatalogSnapshotModel }): void {
  if (change.remove) liveCatalog.delete(change.remove);
  if (change.upsert) liveCatalog.set(change.upsert.canonical_id, change.upsert);
}

/** §2 fallback_hash over a frozen fallbacks array (canonical YAML, sha256). */
export function fallbackHash(fallbacks: FrozenFallbackEntry[]): string {
  return sha256Hex(canonicalYaml(fallbacks as unknown as Record<string, unknown>[]));
}

/**
 * Freeze a fallback chain into a receipt skeleton. The chain is deep-copied at
 * freeze time — the only permitted substitution set for this dispatch.
 */
export function freezeChain(input: { fallbacks: FrozenFallbackEntry[] } & Record<string, unknown>): ResolutionReceipt {
  const frozenFallbacks = JSON.parse(JSON.stringify(input.fallbacks ?? [])) as FrozenFallbackEntry[];
  const receipt: ResolutionReceipt = {
    ...input,
    fallbacks: frozenFallbacks,
    fallback_hash: fallbackHash(frozenFallbacks),
    outcome: { attempted: [] },
    finalized_at: null,
    receipt_hash: null,
  };
  Object.freeze(receipt.fallbacks);
  receipt.fallbacks.forEach((f) => Object.freeze(f));
  return receipt;
}

function chainModels(receipt: ResolutionReceipt): Set<string> {
  const models = new Set<string>();
  const sel = receipt.selection as { model?: string } | null | undefined;
  if (sel && typeof sel.model === "string") models.add(sel.model);
  for (const f of receipt.fallbacks ?? []) models.add(f.model);
  return models;
}

function assertNotFinalized(receipt: ResolutionReceipt, action: string): void {
  if (receipt.finalized_at) {
    throw new Error(`receipt is finalized and immutable — cannot ${action} (§8 lifecycle)`);
  }
}

/**
 * §4: does this failure class advance the frozen chain? Unknown classes are a
 * contract violation (closed taxonomy) and throw.
 */
export function advanceChain(
  receipt: ResolutionReceipt,
  failure: { failure_class: string }
): { advanced: boolean; failure_class: string; next_model: string | null } {
  const advances = FALLBACK_FAILURE_TAXONOMY[failure.failure_class];
  if (advances === undefined) {
    throw new Error(
      `failure_class "${failure.failure_class}" is outside the closed §4 taxonomy — fail closed`
    );
  }
  // The frozen fallbacks array EXCLUDES the selected model (survivors.slice(1)),
  // so the next model is the FIRST fallback not yet attempted — never an
  // attempt-count offset into the array (the selected model's own failed
  // attempt lives in outcome.attempted, and off-by-one indexing skips f1).
  // Exhaustion is reached only after the LAST fallback has been attempted.
  const attemptedModels = new Set((receipt.outcome?.attempted ?? []).map((a) => a.model));
  const chain = receipt.fallbacks ?? [];
  const next = advances ? chain.find((f) => !attemptedModels.has(f.model)) ?? null : null;
  return {
    advanced: advances,
    failure_class: failure.failure_class,
    next_model: next ? next.model : null,
  };
}

const SUBSTITUTION_CLASSES: readonly SubstitutionClass[] = [
  "none",
  "provider_content_fallback",
  "provider_server_fallback",
  "provider_silent",
];

/**
 * §5 honesty: every SERVED attempt carries a consistent
 * (substitution_class, requested, actual_model) triple:
 *   - the class is REQUIRED (omitted/serialized-null on a served attempt is a
 *     dishonest record);
 *   - `none` asserts actual_model === requested — a substitution can never
 *     hide behind it;
 *   - `provider_silent` asserts actual_model is the literal "unknown" (the
 *     provider did not report; the requested model is NEVER assumed served);
 *   - the reported-fallback classes require a provider-reported actual_model
 *     that differs from the requested one.
 * Enforced at recordAttempt AND re-checked at finalizeReceipt so a
 * hand-appended attempt cannot become authoritative receipt evidence.
 */
function assertServedTripleConsistent(
  attempt: Pick<AttemptRecord, "model" | "substitution_class" | "actual_model">,
  where: string
): void {
  const cls = attempt.substitution_class;
  if (cls === undefined || cls === null) {
    throw new Error(
      `${where}: served attempt for "${attempt.model}" has no substitution_class — every served attempt ` +
        `carries exactly one closed §5 class (${SUBSTITUTION_CLASSES.join("|")}); an unreported ` +
        `substitution is provider_silent, never an omitted field`
    );
  }
  if (!SUBSTITUTION_CLASSES.includes(cls)) {
    throw new Error(`${where}: substitution_class "${String(cls)}" is outside the closed §5 set`);
  }
  const actual = attempt.actual_model ?? "unknown";
  if (cls === "none" && actual !== attempt.model) {
    throw new Error(
      `${where}: substitution_class "none" asserts actual_model === requested ("${attempt.model}") but ` +
        `actual_model is "${actual}" — a substitution the provider did not report is provider_silent with ` +
        `actual_model "unknown" (§5)`
    );
  }
  if (cls === "provider_silent" && actual !== "unknown") {
    throw new Error(
      `${where}: provider_silent means the provider did not report the served model — actual_model must be ` +
        `the literal "unknown", got "${actual}" (§5)`
    );
  }
  if (
    (cls === "provider_content_fallback" || cls === "provider_server_fallback") &&
    (actual === "unknown" || actual === attempt.model)
  ) {
    throw new Error(
      `${where}: ${cls} requires a provider-reported actual_model differing from the requested ` +
        `"${attempt.model}" (got "${actual}") — unreported is provider_silent, unchanged is none (§5)`
    );
  }
}

/**
 * Append one attempt to the append-only outcome. Rejects any model outside the
 * frozen chain (§3 — no out-of-receipt substitution), any write after
 * finalization, and any served attempt whose §5 substitution triple is
 * inconsistent or incomplete.
 */
export function recordAttempt(receipt: ResolutionReceipt, attempt: AttemptRecord): ResolutionReceipt {
  assertNotFinalized(receipt, "record an attempt");
  if (!chainModels(receipt).has(attempt.model)) {
    throw new Error(
      `out-of-receipt substitution: model "${attempt.model}" is not in the frozen fallback chain — ` +
        `any model change must advance the frozen chain or be a recorded provider-side substitution (§3)`
    );
  }
  if (attempt.result !== "served" && attempt.result !== "failed") {
    throw new Error(`attempt.result must be served|failed (got "${String(attempt.result)}")`);
  }
  if (attempt.result === "failed") {
    const fc = attempt.failure_class;
    if (!fc || FALLBACK_FAILURE_TAXONOMY[fc] === undefined) {
      throw new Error(`failed attempts REQUIRE a closed §4 failure_class (got "${String(fc)}")`);
    }
  }
  const entry: AttemptRecord = {
    model: attempt.model,
    effort: attempt.effort ?? null,
    result: attempt.result,
    failure_class: attempt.result === "failed" ? attempt.failure_class : null,
    substitution_class: attempt.result === "served" ? (attempt.substitution_class ?? null) : null,
    actual_model: attempt.result === "served" ? (attempt.actual_model ?? "unknown") : null,
  };
  if (entry.result === "served") {
    assertServedTripleConsistent(entry, "recordAttempt");
  }
  receipt.outcome.attempted.push(entry);
  return receipt;
}

/**
 * §5 — classify a SERVED attempt. `actual_model` is provider-reported ONLY;
 * when the provider does not report/verify the served model it is the literal
 * "unknown" — NEVER the requested model.
 */
export function classifyServedAttempt(input: {
  requested_model: string;
  provider_reported_model: string | null;
  mechanism?: string;
}): { substitution_class: SubstitutionClass; actual_model: string; requested_model: string } {
  const reported = input.provider_reported_model;
  if (reported === null || reported === undefined || reported === "") {
    return {
      requested_model: input.requested_model,
      substitution_class: "provider_silent",
      actual_model: "unknown",
    };
  }
  if (reported === input.requested_model) {
    return { requested_model: input.requested_model, substitution_class: "none", actual_model: reported };
  }
  const mechanism = input.mechanism ?? "";
  const cls: SubstitutionClass =
    mechanism === "content_classifier"
      ? "provider_content_fallback"
      : mechanism === "fallbacks_param" || mechanism === "server_fallback"
        ? "provider_server_fallback"
        : // A reported substitution with no stated mechanism is still a
          // provider-side substitution; classify by the conservative content
          // class so it is never masked as `none`.
          "provider_content_fallback";
  return { requested_model: input.requested_model, substitution_class: cls, actual_model: reported };
}

/**
 * Finalization — exactly once (§8). Sets outcome.status, finalized_at and
 * receipt_hash (SHA-256 over the canonical YAML of the ENTIRE receipt with the
 * receipt_hash field omitted) in one step; the receipt is immutable afterwards.
 */
export function finalizeReceipt(
  receipt: ResolutionReceipt,
  opts: { status: ResolutionStatus; at?: string }
): ResolutionReceipt {
  if (receipt.finalized_at) {
    throw new Error("receipt already finalized — finalization happens exactly once (§8)");
  }
  if (!(RESOLUTION_STATUSES as readonly string[]).includes(opts.status)) {
    throw new Error(`outcome.status "${String(opts.status)}" outside the closed union`);
  }
  // §5 re-validation: finalization is the last honesty gate — a served attempt
  // appended outside recordAttempt (or mutated since) may not become
  // authoritative evidence with a missing or contradictory substitution triple.
  (receipt.outcome.attempted ?? []).forEach((a, i) => {
    if (a.result === "served") {
      assertServedTripleConsistent(a, `finalizeReceipt: outcome.attempted[${i}]`);
    }
  });
  receipt.outcome.status = opts.status;
  const served = [...receipt.outcome.attempted].reverse().find((a) => a.result === "served");
  if (served && receipt.outcome.actual_model === undefined) {
    // NEVER assumed = requested: copy the served attempt's provider-bound value.
    receipt.outcome.actual_model = served.actual_model ?? "unknown";
  }
  receipt.finalized_at = opts.at ?? new Date().toISOString();
  receipt.receipt_hash_algorithm = "sha256";
  receipt.receipt_hash_scope = "canonical_yaml_with_receipt_hash_field_omitted";
  delete (receipt as Record<string, unknown>)["receipt_hash"];
  receipt.receipt_hash = selfReferentialHash(
    receipt as unknown as Record<string, unknown>,
    "receipt_hash"
  );
  return receipt;
}

/**
 * Resume/interruption (§8): an unfinalized receipt found when its run resumes
 * (or closes) finalizes as `interrupted`, preserving all appended evidence
 * verbatim. Continuing work is a NEW dispatch, never an in-place resume.
 */
export function finalizeInterrupted(receipt: ResolutionReceipt, opts?: { at?: string }): ResolutionReceipt {
  return finalizeReceipt(receipt, { status: "interrupted", at: opts?.at });
}

// ── Recompute-and-verify (the ONE consumer-side trust gate over receipts) ────

export type ReceiptVerification =
  | { ok: true; receipt: ResolutionReceipt; finalized: boolean }
  | { ok: false; reason: string };

/**
 * Verify a receipt by RECOMPUTATION against this module's own canonical
 * hashing — never by string presence. A consumer (inspection, review
 * provenance, M2 gating) must treat any `ok: false` receipt as ABSENT:
 *   - the frozen core must recompute to `resolution_core_hash` byte-exactly;
 *   - a receipt claiming finalization must carry BOTH `finalized_at` and a
 *     `receipt_hash` that recomputes over the entire receipt (§8) — a forged
 *     or tampered hash is a verification failure, not an unknown;
 *   - `finalized` is true ONLY when the full finalization triple verifies.
 * Pure: no I/O, no clock, input never mutated.
 */
export function verifyResolutionReceipt(value: unknown): ReceiptVerification {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "not_an_object" };
  }
  const r = value as ResolutionReceipt;
  if (r.schema_version !== "guild.model_resolution.v1") {
    return { ok: false, reason: "schema_version_mismatch" };
  }
  if (typeof r.resolution_core_hash !== "string" || r.resolution_core_hash.length === 0) {
    return { ok: false, reason: "core_hash_absent" };
  }
  if (coreHash(r) !== r.resolution_core_hash) {
    return { ok: false, reason: "core_hash_mismatch" };
  }
  const finalizedAt = r.finalized_at;
  const receiptHash = r.receipt_hash;
  const claimsFinalization =
    (finalizedAt !== null && finalizedAt !== undefined) ||
    (receiptHash !== null && receiptHash !== undefined);
  if (!claimsFinalization) return { ok: true, receipt: r, finalized: false };
  if (typeof finalizedAt !== "string" || typeof receiptHash !== "string") {
    return { ok: false, reason: "finalization_partial" };
  }
  const recomputed = selfReferentialHash(
    r as unknown as Record<string, unknown>,
    "receipt_hash"
  );
  if (recomputed !== receiptHash) return { ok: false, reason: "receipt_hash_mismatch" };
  return { ok: true, receipt: r, finalized: true };
}

// ── §2 full resolution (deterministic; no wall-clock in the core) ────────────

export interface ResolveRequest {
  purpose: PolicyPurpose;
  purpose_origin?: string;
  dispatch_ancestry?: string[];
  rejected_labels?: Array<Record<string, unknown>>;
  requested_complexity?: PolicyComplexity;
  effective_complexity?: PolicyComplexity;
  forced_floor_reason?: string | null;
}

export interface ResolveInputs {
  session_context: unknown;
  catalog_snapshot: unknown;
  policy: unknown;
  request?: ResolveRequest;
  run_id?: string;
  dispatch_id?: string;
  /** Freeze-time producer facts (review-class purposes only; §1 review). */
  producer?: {
    host_family?: string;
    host_family_trust?: string;
    model_family?: string;
    model_family_source?: string;
    resolution_ref?: { dispatch_id: string; receipt_hash: string };
  };
}

function contentRef(name: string, value: unknown): { path_or_id: string; sha256: string } {
  const bytes =
    typeof value === "string" ? value : canonicalYaml(value as Record<string, unknown>);
  return { path_or_id: `inline:${name}`, sha256: sha256Hex(bytes) };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function coreHash(receipt: ResolutionReceipt): string {
  const core: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(receipt)) {
    if (
      k === "outcome" ||
      k === "finalized_at" ||
      k === "receipt_hash" ||
      k === "receipt_hash_algorithm" ||
      k === "receipt_hash_scope" ||
      k === "resolution_core_hash"
    )
      continue;
    if (v === undefined) continue;
    core[k] = v;
  }
  return sha256Hex(canonicalYaml(core));
}

function failClosedCore(
  inputs: ResolveInputs,
  reason: string,
  rulePath: string[]
): ResolutionReceipt {
  const receipt: ResolutionReceipt = {
    schema_version: "guild.model_resolution.v1",
    run_id: inputs.run_id ?? "unbound",
    dispatch_id: inputs.dispatch_id ?? "unbound",
    refs: {
      session_context: contentRef("session_context", inputs.session_context),
      catalog_snapshot: contentRef("catalog_snapshot", inputs.catalog_snapshot),
      policy: contentRef("policy", inputs.policy),
    },
    request: null,
    selection: null,
    fallbacks: [],
    fallback_hash: fallbackHash([]),
    rejections: [],
    rule_path: [...rulePath, `fail_closed:${reason}`],
    failed_closed: reason,
    outcome: { attempted: [] },
    finalized_at: null,
    receipt_hash: null,
  };
  receipt.resolution_core_hash_algorithm = "sha256";
  receipt.resolution_core_hash_scope = "canonical_yaml_with_resolution_core_hash_field_omitted";
  receipt.resolution_core_hash = coreHash(receipt);
  return receipt;
}

/**
 * Full §2 resolution: purpose floors → route selection → candidate assembly →
 * ordered filtering → selection + frozen chain + fallback_hash, producing the
 * frozen receipt CORE (outcome empty until execution). Malformed/unbound inputs
 * yield a DETERMINISTIC fail-closed core (never a silent default) — the
 * fail-closed path is itself receipt evidence.
 */
export function resolve(inputs: ResolveInputs): ResolutionReceipt {
  const rulePath: string[] = [];

  const policyObj = asObject(inputs.policy);
  if (policyObj === null) {
    return failClosedCore(inputs, "policy_unparsable", rulePath);
  }
  const policyRejects = validateModelPolicy(policyObj);
  if (policyRejects.length > 0) {
    return failClosedCore(inputs, "policy_invalid", [
      ...rulePath,
      ...policyRejects.slice(0, 5).map((r) => `policy_reject:${r}`),
    ]);
  }
  const policy = policyObj as unknown as ModelPolicyV2;

  const request = inputs.request;
  if (!request || typeof request.purpose !== "string") {
    return failClosedCore(inputs, "purpose_unbound", rulePath);
  }
  const purposePolicy = policy.purposes[request.purpose];
  if (!purposePolicy) {
    return failClosedCore(inputs, `purpose_unconfigured:${request.purpose}`, rulePath);
  }

  const catalogObj = asObject(inputs.catalog_snapshot);
  const models = Array.isArray(catalogObj?.["models"])
    ? (catalogObj["models"] as CatalogSnapshotModel[])
    : null;
  if (!models) {
    return failClosedCore(inputs, "catalog_snapshot_unparsable", rulePath);
  }

  // §3 tier floors are catalog-resolvable only now — re-validate WITH the
  // frozen snapshot so a research/review-class route whose selectors resolve to
  // a sub-powerful catalog model fails closed as policy_invalid (it never
  // resolves anything, whatever effective_complexity was recorded).
  const catalogRejects = validateModelPolicy(policyObj, { catalog_models: models });
  if (catalogRejects.length > 0) {
    return failClosedCore(inputs, "policy_invalid", [
      ...rulePath,
      ...catalogRejects.slice(0, 5).map((r) => `policy_reject:${r}`),
    ]);
  }

  // Step 4 — purpose floors BEFORE generic complexity routing.
  const requested: PolicyComplexity = request.requested_complexity ?? "easy";
  const effective: PolicyComplexity = maxComplexity(
    maxComplexity(requested, purposeComplexityFloor(request.purpose)),
    purposePolicy.min_effective_complexity
  );

  // Step 5 — route selection (first matching row; route_unbound fails closed).
  const producerFamily =
    inputs.producer?.model_family ?? (isReviewClassPurpose(request.purpose) ? "unknown" : undefined);
  let routeSel: RouteSelectionResult;
  try {
    routeSel = selectRoute({
      routes: purposePolicy.routes as Array<PolicyRoute & Record<string, unknown>>,
      effective_complexity: effective,
      producer_model_family: producerFamily,
    });
  } catch (e) {
    return failClosedCore(inputs, "route_unbound", [
      ...rulePath,
      `route_selection:${(e as Error).message}`,
    ]);
  }
  for (const ev of routeSel.evaluations) {
    rulePath.push(
      `route[${ev.index}]:complexity_match=${ev.complexity_match},condition=${ev.condition_result}`
    );
  }
  rulePath.push(`route_selected:${routeSel.index}`);
  const route = routeSel.route;

  // Candidate assembly — reads ONLY the selected route.
  const ordered = totalCatalogOrder(models);
  interface Candidate {
    entry: CatalogSnapshotModel;
    source: "preferred" | "fallback" | "provider_default";
    selectorIndex: number;
    selectorEffort: string | null;
    requiredCapabilities: string[];
  }
  const candidates: Candidate[] = [];
  const expandList = (entries: PolicySelectorEntry[], source: "preferred" | "fallback"): void => {
    entries.forEach((sel, idx) => {
      const parsed = parseSelector(sel.selector);
      const matches = expandSelector(parsed, ordered);
      rulePath.push(`${source}[${idx}]:${sel.selector}->${matches.length}`);
      for (const m of matches) {
        candidates.push({
          entry: m,
          source,
          selectorIndex: idx,
          selectorEffort: sel.effort ?? null,
          requiredCapabilities: sel.capabilities ?? [],
        });
      }
    });
  };
  expandList(route.preferred ?? [], "preferred");
  expandList(route.fallbacks ?? [], "fallback");
  if ((route.provider_default ?? "forbid") === "allow_last_resort") {
    const pd = ordered.find((m) => m.provider_default === true);
    if (pd) {
      rulePath.push(`provider_default:${pd.canonical_id}`);
      candidates.push({
        entry: pd,
        source: "provider_default",
        selectorIndex: -1,
        selectorEffort: null,
        requiredCapabilities: [],
      });
    }
  }
  // Deduplicate by canonical_id keeping the FIRST occurrence.
  const seen = new Set<string>();
  const deduped = candidates.filter((c) => {
    if (seen.has(c.entry.canonical_id)) return false;
    seen.add(c.entry.canonical_id);
    return true;
  });

  // Step 6 — ordered filtering with recorded rejections (closed reasons).
  const rejections: Array<{ model: string; reason: string }> = [];
  const survivors: Candidate[] = [];
  // §3 purpose tier floor (research + review-class ⇒ powerful): belt-and-braces
  // behind the catalog-aware validation above — the resolver itself never
  // selects a sub-floor model on a floored purpose, even if a policy reached
  // this point without the validator's catalog leg.
  const tierFloor = purposeTierFloor(request.purpose);
  for (const c of deduped) {
    if (tierFloor !== null && c.entry.tier !== tierFloor) {
      rejections.push({ model: c.entry.canonical_id, reason: "policy" });
      continue;
    }
    const caps = (c.entry.capabilities ?? {}) as Record<string, unknown>;
    const missingCap = c.requiredCapabilities.find((k) => !caps[k]);
    if (missingCap !== undefined) {
      rejections.push({ model: c.entry.canonical_id, reason: "capability" });
      continue;
    }
    const evidenceState = c.entry.evidence?.state ?? "unknown";
    const eligible = eligibleForPurpose({
      evidence_state: evidenceState,
      purpose_class: request.purpose,
      allow_advertised_attempt: policy.allow_advertised_attempt === true,
    });
    if (!eligible) {
      rejections.push({ model: c.entry.canonical_id, reason: "evidence" });
      continue;
    }
    survivors.push(c);
  }

  if (survivors.length === 0) {
    return failClosedCore(inputs, "no_eligible_candidate", [
      ...rulePath,
      ...rejections.map((r) => `reject:${r.model}:${r.reason}`),
    ]);
  }

  // Step 7 — selection = FIRST surviving candidate; effort resolution.
  const first = survivors[0];
  const efforts = first.entry.reasoning_efforts ?? [];
  let effort: string | null;
  let effortDegraded = false;
  if (first.selectorEffort && efforts.includes(first.selectorEffort)) {
    effort = first.selectorEffort;
  } else if (first.selectorEffort) {
    effort = first.entry.default_effort ?? null;
    effortDegraded = true;
  } else {
    effort = first.entry.default_effort ?? null;
  }

  const independenceNote = (candidateFamily: string | undefined): string | null => {
    if (!isReviewClassPurpose(request.purpose)) return null;
    const fam = candidateFamily ?? "unknown";
    if (
      producerFamily === undefined ||
      producerFamily === null ||
      producerFamily === "unknown" ||
      fam === "unknown"
    ) {
      return "producer_or_candidate_family_unknown:weak";
    }
    return fam === producerFamily ? "same_family_as_producer:weak" : "cross_family";
  };

  // Step 8 — FREEZE selection + the remaining survivors as the chain.
  const frozenFallbacks: FrozenFallbackEntry[] = survivors.slice(1).map((c) => ({
    model: c.entry.canonical_id,
    effort:
      c.selectorEffort && (c.entry.reasoning_efforts ?? []).includes(c.selectorEffort)
        ? c.selectorEffort
        : c.entry.default_effort ?? null,
    evidence_state: c.entry.evidence?.state ?? "unknown",
    source: c.source,
    independence_note: independenceNote(c.entry.model_family),
  }));

  const receipt: ResolutionReceipt = {
    schema_version: "guild.model_resolution.v1",
    run_id: inputs.run_id ?? "unbound",
    dispatch_id: inputs.dispatch_id ?? "unbound",
    refs: {
      session_context: contentRef("session_context", inputs.session_context),
      catalog_snapshot: contentRef("catalog_snapshot", inputs.catalog_snapshot),
      policy: contentRef("policy", inputs.policy),
    },
    request: {
      purpose: request.purpose,
      purpose_origin: request.purpose_origin ?? "unbound",
      dispatch_ancestry: request.dispatch_ancestry ?? [],
      rejected_labels: request.rejected_labels ?? [],
      requested_complexity: requested,
      effective_complexity: effective,
      forced_floor_reason: request.forced_floor_reason ?? null,
    },
    selection: {
      target_id: (asObject(inputs.session_context)?.["target_id"] as string) ?? "unknown",
      model: first.entry.canonical_id,
      effort,
      evidence_state: first.entry.evidence?.state ?? "unknown",
      route: {
        index: routeSel.index,
        complexity: route.complexity,
        condition_kind: (route.condition?.kind ?? "always") as string,
        condition_model_family: route.condition?.model_family ?? null,
        condition_input: routeSel.condition_input,
      },
      source: first.source,
    },
    fallbacks: frozenFallbacks,
    fallback_hash: fallbackHash(frozenFallbacks),
    rejections,
    rule_path: [
      ...rulePath,
      `selected:${first.entry.canonical_id}:${first.source}[${first.selectorIndex}]`,
    ],
    outcome: { attempted: [] },
    finalized_at: null,
    receipt_hash: null,
  };
  if (isReviewClassPurpose(request.purpose)) {
    receipt.review = {
      requested_independence: purposePolicy.independence,
      producer: {
        host_family: inputs.producer?.host_family ?? "unknown",
        host_family_trust: inputs.producer?.host_family_trust ?? "asserted",
        model_family: inputs.producer?.model_family ?? "unknown",
        model_family_source: inputs.producer?.model_family_source ?? "unknown",
        resolution_ref: inputs.producer?.resolution_ref ?? null,
      },
    };
  }
  if (effortDegraded) {
    receipt.outcome.degradation = {
      kind: "effort",
      note: `selector effort "${first.selectorEffort}" not in entry reasoning_efforts; used default`,
    };
  }
  Object.freeze(receipt.fallbacks);
  receipt.fallbacks.forEach((f) => Object.freeze(f));
  receipt.resolution_core_hash_algorithm = "sha256";
  receipt.resolution_core_hash_scope = "canonical_yaml_with_resolution_core_hash_field_omitted";
  receipt.resolution_core_hash = coreHash(receipt);
  return receipt;
}

// ── Receipt persistence (module map: receipts under the bound run dir) ───────

/**
 * Persist a receipt under an EXPLICITLY bound run directory (never a sentinel
 * lookup — T3 run-binding discipline). Fails closed on a run_id mismatch.
 * Atomic write (temp + rename).
 */
export function persistResolutionReceipt(runDir: string, receipt: ResolutionReceipt): string {
  const runId = path.basename(runDir);
  if (!receipt.run_id || receipt.run_id !== runId) {
    throw new Error(
      `run_binding_mismatch: receipt.run_id "${String(receipt.run_id)}" does not match the bound run dir "${runId}" — refusing to write`
    );
  }
  if (!receipt.dispatch_id || receipt.dispatch_id === "unbound") {
    throw new Error("run_binding_mismatch: receipt has no dispatch_id — refusing to write");
  }
  const dir = path.join(runDir, "resolution");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${receipt.dispatch_id}.receipt.yaml`);
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, canonicalYaml(receipt as unknown as Record<string, unknown>), "utf8");
  fs.renameSync(tmp, target);
  return target;
}

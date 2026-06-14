/**
 * scripts/lib/result-contracts.ts
 *
 * L0 FOUNDATION — the result-contract REGISTRY (lane item (e)). The single,
 * closed enumeration of which Guild orchestration-result contracts EXIST today
 * versus which are DEFERRED (no producer yet). This is L3's closed target set:
 * Phase-1 normalizers target exactly the `exists` contracts, nothing more.
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §Result contracts
 *   docs/knowledge/decisions/guild-inventory-and-parity-contracts.md (this lane's ADR)
 *
 * This module is a REGISTRY, not a redefinition. It re-exports the existing
 * validators by reference; it never re-implements them. Deferred contracts have
 * NO schema designed here on purpose — "designing schemas ahead of their
 * producers is premature churn" (spec §Out of scope).
 *
 * ── TWO VERIFIED CORRECTIONS (load-bearing — read before writing any normalizer) ──
 *
 *  1. WIRE-STRING PREFIX IS INCONSISTENT.
 *     The canonical machine `schema_version` string differs per contract:
 *       - handoff:        "guild.handoff.v2"   (carries the `guild.` prefix)
 *       - review_result:  "review_result.v1"   (NO `guild.` prefix)
 *     The ADR/spec PROSE tables loosely write "guild.review_result.v1", but the
 *     real validator (verify-gate-pass.ts parseReviewResult) accepts ONLY the
 *     bare "review_result.v1". A normalizer/fixture that emits or checks
 *     "guild.review_result.v1" will MIS-KEY and fail silently. Target the REAL
 *     strings in `wire_schema_version` below — never the prose label.
 *
 *  2. THE LENIENT READER PATH.
 *     review_result.v1's reader lives at `plugin/scripts/verify-gate-pass.ts`
 *     (function `parseReviewResult`), NOT under `scripts/lib/` as some spec prose
 *     loosely says. `source_path` below is the verified location.
 *
 * Owned by plugin-architect (L0); consumed by L3 (normalizers) + L6 (tests).
 */

import { validateHandoffV2 } from "../../hooks/lib/handoff-v2";
import { parseReviewResult } from "../verify-gate-pass";

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

export type ContractStatus = "exists" | "deferred";
export type ValidatorKind = "strict" | "lenient" | "none";

export interface ResultContractEntry {
  /**
   * The canonical `schema_version` string EXACTLY as it appears on the wire.
   * THIS is the key normalizers and fixtures must use. (See correction #1.)
   */
  wire_schema_version: string;
  /** Producer status — `exists` are the only Phase-1 normalizer targets. */
  status: ContractStatus;
  /** Validator strictness for existing contracts; "none" for deferred. */
  validator_kind: ValidatorKind;
  /** Verified repo-relative source of the type/validator (or "" when deferred). */
  source_path: string;
  /** Human-readable purpose (ADR §Result contracts table). */
  purpose: string;
  /** For deferred contracts: the phase/producer that will introduce it. */
  deferred_until?: string;
}

// ---------------------------------------------------------------------------
// THE REGISTRY (closed set)
// ---------------------------------------------------------------------------

/** The two contracts with a real producer/validator today — L3's target set. */
export const EXISTING_CONTRACTS: ResultContractEntry[] = [
  {
    wire_schema_version: "guild.handoff.v2",
    status: "exists",
    validator_kind: "strict",
    source_path: "plugin/hooks/lib/handoff-v2.ts",
    purpose: "Specialist lane result (dispatch envelope).",
  },
  {
    wire_schema_version: "review_result.v1", // NOTE: no `guild.` prefix (correction #1).
    status: "exists",
    validator_kind: "lenient",
    source_path: "plugin/scripts/verify-gate-pass.ts", // correction #2.
    purpose: "Advisory/adversarial review result (gate-pass binding).",
  },
];

/**
 * Contracts named in the ADR table that have NO producer yet. Do NOT design
 * these ahead of their producer (premature churn). Listed so L3 has a closed
 * negative set and L6 can assert Phase-1 normalizers do NOT cover them.
 */
export const DEFERRED_CONTRACTS: ResultContractEntry[] = [
  {
    wire_schema_version: "guild.phase_result.v1",
    status: "deferred",
    validator_kind: "none",
    source_path: "",
    purpose: "Phase close summary and gate predicate.",
    deferred_until: "the phase that first emits a phase-close result.",
  },
  {
    wire_schema_version: "guild.permission_receipt.v1",
    status: "deferred",
    validator_kind: "none",
    source_path: "",
    purpose: "Requested/selected host mode and gate policy.",
    deferred_until: "migration step 10 (phase-scoped permission policy).",
  },
  {
    wire_schema_version: "guild.host_event.v1",
    status: "deferred",
    validator_kind: "none",
    source_path: "",
    purpose: "Normalized hook/tool/session event.",
    deferred_until: "when a normalized host event is first emitted.",
  },
  {
    wire_schema_version: "guild.qa_result.v1",
    status: "deferred",
    validator_kind: "none",
    source_path: "",
    purpose: "Test matrix execution, gaps, failures, release predicate.",
    deferred_until: "qa / product-loop phase.",
  },
];

/** Full registry (exists + deferred). */
export const RESULT_CONTRACTS: ResultContractEntry[] = [
  ...EXISTING_CONTRACTS,
  ...DEFERRED_CONTRACTS,
];

/** The set of wire schema_version strings a Phase-1 normalizer is allowed to target. */
export const PHASE1_NORMALIZER_TARGETS: ReadonlySet<string> = new Set(
  EXISTING_CONTRACTS.map((c) => c.wire_schema_version)
);

// ---------------------------------------------------------------------------
// Bound validators (by reference — NOT redefined here)
// ---------------------------------------------------------------------------

/**
 * The existing validators, bound by their wire schema_version. L3 normalizers
 * dispatch through this map; they MUST NOT re-implement validation. A wire string
 * absent from this map is, by definition, not a Phase-1 target — the normalizer
 * fails closed (ADR §Result contracts: "fail with an explicit schema error
 * rather than silently accepting prose").
 */
export const CONTRACT_VALIDATORS: Record<
  string,
  (value: unknown) => { valid: boolean; errors: string[] }
> = {
  "guild.handoff.v2": validateHandoffV2,
  // parseReviewResult returns { result, reasons }; adapt to the { valid, errors } shape.
  "review_result.v1": (value: unknown) => {
    // The lenient reader consumes raw JSON text; accept either a pre-parsed
    // object (stringify it) or a string. Either way, delegate to the one true reader.
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    const { result, reasons } = parseReviewResult(raw);
    return { valid: result !== null, errors: reasons };
  },
};

/** Lookup a registry entry by its wire schema_version. */
export function findContract(wireSchemaVersion: string): ResultContractEntry | undefined {
  return RESULT_CONTRACTS.find((c) => c.wire_schema_version === wireSchemaVersion);
}

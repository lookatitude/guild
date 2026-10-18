/**
 * src/domains/distribution/result-contracts.ts
 *
 * L0 FOUNDATION — the result-contract REGISTRY (lane item (e)). The single,
 * closed enumeration of which Guild orchestration-result contracts EXIST today
 * versus which are DEFERRED (no producer yet). This is L3's closed target set:
 * Phase-1 normalizers target exactly the `exists` contracts, nothing more.
 *
 * Contract authority (SoT):
 *   ADR: universal-host-plugin-architecture (workspace wiki) §Result contracts
 *   ADR: guild-inventory-and-parity-contracts (workspace wiki) (this lane's ADR)
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

import { validateHandoffV2 } from "./handoff-v2";
import { sealSet, deepFreeze } from "../kernel";
import { parseReviewResult } from "./review-result";
import {
  validatePhaseResultV1,
  validatePermissionReceiptV1,
  validateHostEventV1,
  validateQaResultV1,
} from "./result-contracts-v2";

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
  /**
   * The non-test source file that consumes this contract by wire string, and the
   * function it calls. Only contracts with a live caller are normalizer targets.
   */
  live_caller?: { path: string; call: string };
  /** A validator with no producer or caller: kept for reading old records, never a target. */
  legacy_only?: true;
}

// ---------------------------------------------------------------------------
// THE REGISTRY (closed set)
// ---------------------------------------------------------------------------

/**
 * The orchestration-result contracts with a real validator. Only the first two
 * have live callers (handoff.v2, review_result.v1) and are normalizer targets.
 * The other four (validators in `result-contracts-v2.ts`) have no producer or
 * caller: they are `legacy_only` and the normalizer refuses them.
 */
export const EXISTING_CONTRACTS: readonly ResultContractEntry[] = deepFreeze([
  {
    wire_schema_version: "guild.handoff.v2",
    status: "exists",
    validator_kind: "strict",
    source_path: "plugin/hooks/lib/handoff-v2.ts",
    purpose: "Specialist lane result (dispatch envelope).",
    live_caller: { path: "scripts/task-cell-host-conformance.ts", call: "normalizeResult" },
  },
  {
    wire_schema_version: "review_result.v1", // NOTE: no `guild.` prefix (correction #1).
    status: "exists",
    validator_kind: "lenient",
    source_path: "plugin/scripts/verify-gate-pass.ts", // correction #2.
    purpose: "Advisory/adversarial review result (gate-pass binding).",
    live_caller: { path: "scripts/verify-gate-pass.ts", call: "parseReviewResult" },
  },
  {
    wire_schema_version: "guild.phase_result.v1",
    status: "exists",
    validator_kind: "strict",
    source_path: "plugin/src/domains/distribution/result-contracts-v2.ts",
    purpose: "Phase close summary and gate predicate.",
    legacy_only: true,
  },
  {
    wire_schema_version: "guild.permission_receipt.v1",
    status: "exists",
    validator_kind: "strict",
    source_path: "plugin/src/domains/distribution/result-contracts-v2.ts",
    purpose: "Requested/selected host mode and gate policy.",
    legacy_only: true,
  },
  {
    wire_schema_version: "guild.host_event.v1",
    status: "exists",
    validator_kind: "strict",
    source_path: "plugin/src/domains/distribution/result-contracts-v2.ts",
    purpose: "Normalized hook/tool/session event.",
    legacy_only: true,
  },
  {
    wire_schema_version: "guild.qa_result.v1",
    status: "exists",
    validator_kind: "strict",
    source_path: "plugin/src/domains/distribution/result-contracts-v2.ts",
    purpose: "Test matrix execution, gaps, failures, release predicate.",
    legacy_only: true,
  },
]);

/**
 * No result contracts remain deferred — the four formerly-deferred contracts now
 * ship (above). Kept as an empty closed set so downstream code (`RESULT_CONTRACTS`,
 * the L6 negative-set assertions) keeps a stable shape.
 */
export const DEFERRED_CONTRACTS: readonly ResultContractEntry[] = Object.freeze([]);

/** Full registry (exists + deferred). */
export const RESULT_CONTRACTS: readonly ResultContractEntry[] = Object.freeze([
  ...EXISTING_CONTRACTS,
  ...DEFERRED_CONTRACTS,
]);

/** The wire strings a Phase-1 normalizer may target: contracts with a live caller, never legacy-only ones. */
export const PHASE1_NORMALIZER_TARGETS: ReadonlySet<string> = sealSet(
  EXISTING_CONTRACTS.filter((c) => c.live_caller !== undefined && c.legacy_only !== true).map((c) => c.wire_schema_version),
  "PHASE1_NORMALIZER_TARGETS",
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
  // The four legacy-only contracts (result-contracts-v2.ts) — bound, never targets.
  "guild.phase_result.v1": validatePhaseResultV1,
  "guild.permission_receipt.v1": validatePermissionReceiptV1,
  "guild.host_event.v1": validateHostEventV1,
  "guild.qa_result.v1": validateQaResultV1,
};

/** Lookup a registry entry by its wire schema_version. */
export function findContract(wireSchemaVersion: string): ResultContractEntry | undefined {
  return RESULT_CONTRACTS.find((c) => c.wire_schema_version === wireSchemaVersion);
}

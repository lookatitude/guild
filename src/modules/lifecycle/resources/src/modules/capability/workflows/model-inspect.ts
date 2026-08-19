/**
 * src/modules/capability/workflows/model-inspect.ts
 *
 * M0 read-only inspection service (module-map §1; lane T6, rework round 2).
 * Surfaces identity trust, target evidence, catalog age, policy path, selected
 * model/effort, frozen fallbacks, actual model, and independence/degradation —
 * with HONEST UNKNOWNS — from artifacts other lanes already produced. It
 * consumes the frozen contracts (guild.session_context.v1,
 * guild.model_catalog.v1, guild.model_resolution.v1) and NEVER mutates
 * anything:
 *
 *   - this MODULE is PURE (no fs, no clock, no env, no telemetry): data in,
 *     deep-frozen report out; inputs are never written to; an inspection call
 *     creates or appends NO file anywhere (T6-R1-F1 — the former
 *     emitInspectionTrace was removed; any persistence of an inspection report
 *     is a separate, run-binding-verified writer: inspection-persist.ts);
 *   - receipts are trusted ONLY after RECOMPUTE-AND-VERIFY through T5's
 *     verifyResolutionReceipt (T6-R1-F2): a receipt whose frozen core or
 *     receipt_hash does not recompute is treated as ABSENT (surfaced in
 *     `unknowns`), and `finalized` is the verifier's verdict — never a
 *     string-presence check;
 *   - selection/fallbacks/actual_model are ECHOES of the verified receipt —
 *     nothing is invented, an unfinalized receipt proves nothing (resolution
 *     §8), and `actual_model` is never derived from the requested model (§5);
 *   - independence appears ONLY from a WRITTEN §7a adjudication block that is
 *     HASH-BOUND to the verified finalized receipt (its producer_ref or
 *     reviewer_ref receipt_hash must equal the verified receipt's own hash) —
 *     a caller-supplied {independence: "strong"} fragment is rejected (§7a
 *     forbids provisional or unbound verdicts).
 *
 * The command UX (`guild models inspect`) is lane T6b; this module is the
 * service it delegates to.
 */

import { verifyResolutionReceipt } from "./model-resolver";
import { validateWrittenAdjudication } from "./independence-predicates";
import type { RoutingFlags } from "./routing-rollout";

export const MODEL_INSPECTION_SCHEMA = "guild.model_inspection.v1" as const;

// ── Report shape ─────────────────────────────────────────────────────────────

export interface InspectionCatalogModelRow {
  canonical_id: string;
  tier: string;
  evidence_state: string;
}

export interface InspectionCatalogBlock {
  state: "ok" | "absent" | "discovery_disabled" | "inspect_disabled";
  target_id: string | null;
  discovered_at: string | null;
  age_seconds: number | null;
  ttl_seconds: number | null;
  stale: boolean | null;
  generation: number | null;
  models: InspectionCatalogModelRow[] | null;
}

export interface ModelInspectionV1 {
  schema_version: typeof MODEL_INSPECTION_SCHEMA;
  state: "ok" | "inspect_disabled";
  generated_at: string;
  run_id: string;
  host: { family: string; surface: string };
  identity: { source: string; trust: string; confidence: string; evidence: string };
  target: { target_id: string; provider_kind: string; auth_mode: string };
  catalog: InspectionCatalogBlock;
  policy: { present: boolean; policy_hash: string | null; rule_path: string[] | null };
  selection: { model: string; effort: string | null; evidence_state: string } | null;
  fallbacks: { chain: unknown[]; fallback_hash: string } | null;
  outcome: { finalized: boolean; status: string; actual_model: string };
  independence: {
    adjudicated: boolean;
    independence: "strong" | "weak" | null;
    note: string;
  };
  degradation: { kind: string; note: string } | null;
  flags: RoutingFlags;
  /** Every field this report could NOT bind — surfaced, never papered over. */
  unknowns: string[];
}

export interface BuildInspectionInput {
  /** guild.session_context.v1-shaped record (unknown-safe). */
  session_context: unknown;
  /** guild.model_catalog.v1 snapshot, or null/undefined when none exists. */
  catalog_snapshot?: unknown | null;
  /** guild.model_policy.v2 object, or null (policy_hash then stays unbound). */
  policy?: unknown | null;
  /**
   * guild.model_resolution.v1 receipt, or null. Trusted ONLY after T5's
   * verifyResolutionReceipt recomputes its hashes; a non-verifying receipt is
   * treated as absent (recorded in `unknowns`).
   */
  receipt?: unknown | null;
  /**
   * A WRITTEN §7a `independence_adjudication` block (resolution §7a shape,
   * e.g. from buildIndependenceAdjudication). Accepted ONLY when it is a full
   * closed-shape block AND hash-bound to the verified finalized receipt above.
   * A bare {independence} fragment is rejected — no independence value exists.
   */
  adjudication?: unknown | null;
  flags: RoutingFlags;
  /** Caller-supplied RFC3339 clock — this module never reads wall time. */
  now: string;
}

// ── helpers (pure) ───────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function parseRfc3339Seconds(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

// T7-H2: the §7a WRITTEN-block shape used to be validated by a PRIVATE copy
// here. It is now single-sourced in independence-predicates.ts (still a pure,
// I/O-free module, so this file's purity contract is unchanged) because the
// run-state persistence guard needs the SAME check — two copies of a security
// shape drift.
const validateAdjudicationBlock = validateWrittenAdjudication;

// ── the service ──────────────────────────────────────────────────────────────

/**
 * Build the read-only inspection report. Pure and deterministic; the returned
 * object is deep-frozen so no consumer can turn the display surface into a
 * mutation channel. Every unbindable field lands in `unknowns`.
 */
export function buildModelInspection(input: BuildInspectionInput): ModelInspectionV1 {
  const unknowns: string[] = [];
  const flags = { ...input.flags };

  const sc = asRecord(input.session_context) ?? {};
  const runId = str(sc["run_id"], "unknown");
  if (runId === "unknown") unknowns.push("run_id");

  const hostBlock = asRecord(sc["host"]);
  const host = {
    family: str(hostBlock?.["family"], "unknown"),
    surface: str(hostBlock?.["surface"], "unknown"),
  };
  if (host.family === "unknown") unknowns.push("host");

  const idBlock = asRecord(sc["identity"]);
  const identity = {
    source: str(idBlock?.["source"], "none"),
    // Unknown-safe: absent trust degrades to asserted, never upgrades (T3).
    trust: idBlock?.["trust"] === "verified" ? "verified" : "asserted",
    confidence: str(idBlock?.["confidence"], "low"),
    evidence: str(idBlock?.["evidence"], "unknown"),
  };
  if (!idBlock) unknowns.push("identity");

  const targetBlock = asRecord(sc["execution_target"]);
  const target = {
    target_id: str(targetBlock?.["target_id"], "unknown"),
    provider_kind: str(targetBlock?.["provider_kind"], "unknown"),
    auth_mode: str(targetBlock?.["auth_mode"], "unknown"),
  };
  if (target.target_id === "unknown") unknowns.push("target");

  const inspectOff = flags["model_routing.inspect"] !== "on";
  if (inspectOff) {
    // ADR M0 rollback: the display surface disappears; nothing else changes.
    return deepFreeze({
      schema_version: MODEL_INSPECTION_SCHEMA,
      state: "inspect_disabled",
      generated_at: input.now,
      run_id: runId,
      host,
      identity,
      target,
      catalog: {
        state: "inspect_disabled",
        target_id: null,
        discovered_at: null,
        age_seconds: null,
        ttl_seconds: null,
        stale: null,
        generation: null,
        models: null,
      },
      policy: { present: false, policy_hash: null, rule_path: null },
      selection: null,
      fallbacks: null,
      outcome: { finalized: false, status: "not_inspected", actual_model: "unknown" },
      independence: {
        adjudicated: false,
        independence: null,
        note: "inspection disabled (model_routing.inspect off)",
      },
      degradation: null,
      flags,
      unknowns: ["inspection_disabled"],
    }) as ModelInspectionV1;
  }

  // ── catalog block (honest states; age from the snapshot's own record) ──────
  let catalog: InspectionCatalogBlock;
  const snapshot = asRecord(input.catalog_snapshot);
  if (flags["model_routing.discovery"] !== "on") {
    // Never a stale claim: a present snapshot must not be sold as live.
    catalog = {
      state: "discovery_disabled",
      target_id: null,
      discovered_at: null,
      age_seconds: null,
      ttl_seconds: null,
      stale: null,
      generation: null,
      models: null,
    };
    unknowns.push("catalog");
  } else if (!snapshot) {
    catalog = {
      state: "absent",
      target_id: null,
      discovered_at: null,
      age_seconds: null,
      ttl_seconds: null,
      stale: null,
      generation: null,
      models: null,
    };
    unknowns.push("catalog");
  } else {
    const discovery = asRecord(snapshot["discovery"]);
    const discoveredAt = typeof discovery?.["discovered_at"] === "string"
      ? (discovery["discovered_at"] as string)
      : null;
    const ttl = typeof discovery?.["ttl_seconds"] === "number" ? (discovery["ttl_seconds"] as number) : null;
    const nowS = parseRfc3339Seconds(input.now);
    const thenS = parseRfc3339Seconds(discoveredAt);
    const age = nowS !== null && thenS !== null ? nowS - thenS : null;
    if (age === null) unknowns.push("catalog_age");
    const models = Array.isArray(snapshot["models"])
      ? (snapshot["models"] as unknown[]).map((m) => {
          const row = asRecord(m) ?? {};
          const evidence = asRecord(row["evidence"]);
          return {
            canonical_id: str(row["canonical_id"], "unknown"),
            tier: str(row["tier"], "unknown"),
            evidence_state: str(evidence?.["state"], "unknown"),
          };
        })
      : null;
    catalog = {
      state: "ok",
      target_id: str(asRecord(snapshot["target"])?.["target_id"], "unknown"),
      discovered_at: discoveredAt,
      age_seconds: age,
      ttl_seconds: ttl,
      stale: age !== null && ttl !== null ? age > ttl : null,
      generation: typeof snapshot["generation"] === "number" ? (snapshot["generation"] as number) : null,
      models,
    };
  }

  // ── receipt echoes — VERIFIED receipts only (T6-R1-F2) ─────────────────────
  // The receipt is trusted only after T5 recomputes its hashes. A supplied
  // receipt that fails verification is treated as ABSENT for every downstream
  // field and surfaced honestly; nothing in it (selection, outcome,
  // actual_model) may reach the report.
  let receipt: Record<string, unknown> | null = null;
  let receiptFinalized = false;
  let verifiedReceiptHash: string | null = null;
  if (input.receipt !== null && input.receipt !== undefined) {
    const verdict = verifyResolutionReceipt(input.receipt);
    if (verdict.ok === true) {
      receipt = verdict.receipt as unknown as Record<string, unknown>;
      receiptFinalized = verdict.finalized;
      verifiedReceiptHash = verdict.finalized
        ? (verdict.receipt.receipt_hash as string)
        : null;
    } else {
      // ts-jest may not narrow the discriminated union through the module
      // boundary; the rejected member is explicit here.
      const rejected = verdict as { ok: false; reason: string };
      unknowns.push(`receipt_unverified:${rejected.reason}`);
    }
  }

  const refs = asRecord(receipt?.["refs"]);
  const policyRef = asRecord(refs?.["policy"]);
  const policyPresent = input.policy !== null && input.policy !== undefined;
  const policy = {
    present: policyPresent,
    policy_hash: str(policyRef?.["sha256"], "") || null,
    rule_path: Array.isArray(receipt?.["rule_path"]) ? (receipt!["rule_path"] as string[]) : null,
  };
  if (!policyPresent) unknowns.push("policy");

  const selectionBlock = asRecord(receipt?.["selection"]);
  const selection = selectionBlock
    ? {
        model: str(selectionBlock["model"], "unknown"),
        effort: typeof selectionBlock["effort"] === "string" ? (selectionBlock["effort"] as string) : null,
        evidence_state: str(selectionBlock["evidence_state"], "unknown"),
      }
    : null;
  if (!selection) unknowns.push("selection");

  const fallbacks =
    receipt && Array.isArray(receipt["fallbacks"]) && typeof receipt["fallback_hash"] === "string"
      ? { chain: receipt["fallbacks"] as unknown[], fallback_hash: receipt["fallback_hash"] as string }
      : null;

  // §8: consumers trust finalized receipts only — and "finalized" is the
  // VERIFIER's verdict (recomputed receipt_hash), never string presence. An
  // unverified or unfinalized receipt's outcome proves nothing, so
  // actual_model stays the literal "unknown".
  const outcomeBlock = asRecord(receipt?.["outcome"]);
  const outcome = receiptFinalized
    ? {
        finalized: true,
        status: str(outcomeBlock?.["status"], "unknown"),
        actual_model: str(outcomeBlock?.["actual_model"], "unknown"),
      }
    : { finalized: false, status: "pending", actual_model: "unknown" };
  if (outcome.actual_model === "unknown") unknowns.push("actual_model");

  // §7a: independence exists ONLY as a WRITTEN adjudication block, and only
  // when that block is HASH-BOUND to the verified finalized receipt inspected
  // here (one of its backward refs carries this receipt's recomputed hash).
  // A caller fragment, an unbound block, or a block over an unverified /
  // unfinalized receipt yields NO independence value — never provisional.
  const adjudicationBlock = validateAdjudicationBlock(input.adjudication);
  let independence: ModelInspectionV1["independence"];
  if (input.adjudication === null || input.adjudication === undefined) {
    independence = {
      adjudicated: false,
      independence: null,
      note: "no adjudication block written — no independence value exists (§7a: never provisional)",
    };
  } else if (!adjudicationBlock) {
    independence = {
      adjudicated: false,
      independence: null,
      note:
        "supplied independence value rejected: not a written §7a adjudication block " +
        "(closed shape with producer_ref/reviewer_ref receipt hashes + predicate_trace)",
    };
  } else if (verifiedReceiptHash === null) {
    independence = {
      adjudicated: false,
      independence: null,
      note:
        "adjudication block rejected: no verified finalized receipt to bind it to " +
        "(§7a blocks are written only after both receipts verify as finalized)",
    };
  } else if (
    adjudicationBlock.producer_ref.receipt_hash !== verifiedReceiptHash &&
    adjudicationBlock.reviewer_ref.receipt_hash !== verifiedReceiptHash
  ) {
    independence = {
      adjudicated: false,
      independence: null,
      note:
        "adjudication block rejected: neither backward ref matches this dispatch's " +
        "verified receipt_hash (hash-bound §7a adjudication required)",
    };
  } else {
    independence = {
      adjudicated: true,
      independence: adjudicationBlock.independence,
      note: adjudicationBlock.predicate_trace,
    };
  }
  if (!independence.adjudicated) unknowns.push("independence");

  const degradationBlock = asRecord(outcomeBlock?.["degradation"]);
  const degradation =
    receiptFinalized && degradationBlock
      ? { kind: str(degradationBlock["kind"], "unknown"), note: str(degradationBlock["note"], "") }
      : null;

  return deepFreeze({
    schema_version: MODEL_INSPECTION_SCHEMA,
    state: "ok",
    generated_at: input.now,
    run_id: runId,
    host,
    identity,
    target,
    catalog,
    policy,
    selection,
    fallbacks,
    outcome,
    independence,
    degradation,
    flags,
    unknowns,
  }) as ModelInspectionV1;
}

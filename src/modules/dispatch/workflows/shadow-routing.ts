/**
 * src/modules/dispatch/workflows/shadow-routing.ts
 *
 * M1 shadow resolution + M2 opt-in model selection behind the ADR rollout
 * flags (module-map §1 "Shadow/opt-in wiring behind rollout flags"; lane T6,
 * rework round 2).
 *
 * M1 (`model_routing.shadow`): the full T5 resolver runs IN SHADOW next to the
 * current (legacy) dispatch selection. Its receipt is content-hashed
 * (resolution_core_hash) and a `guild.shadow_comparison.v1` record makes the
 * shadow-vs-legacy pair comparable — with ZERO dispatch effect. Shadow output
 * persists run-local only, and ONLY through the T3/T3b run-binding contract:
 * `persistShadowArtifacts` requires the caller-threaded binding envelope and
 * calls assertWritableBinding BEFORE any write (T6-R1-F4) — basename matching
 * is not authorization; the target dir derives from the VERIFIED binding.
 *
 * M2 (`model_routing.enabled` + the routing-rollout gate): the v2 receipt's
 * frozen selection drives dispatch ONLY when gateM2 — computed HERE from
 * loaded-and-verified evidence refs, never accepted from a caller
 * (T6-R1-F3) — is active. Anything else — flag off, gate un-evidenced,
 * resolver fail-closed — yields the legacy selection byte-identically, with
 * the honest reason recorded. Rollback is flags-off: legacy bytes and
 * persisted run snapshots are never rewritten.
 *
 * User-prompt arbitration (resolution §6) is wired through the T5
 * confirmation-arbiter over the EXACT 6-tuple key; nothing here dedupes on a
 * weaker key. Review provenance consumes T5's verifyResolutionReceipt — a
 * receipt is served evidence only after its hashes RECOMPUTE (T6-R1-F2).
 */

import * as fs from "fs";
import * as path from "path";

import {
  gateM2,
  type M2EvidenceRefs,
  type M2Gate,
  type RoutingFlags,
} from "../../capability";
import {
  resolve as resolveModel,
  verifyResolutionReceipt,
  type ResolutionReceipt,
  type ResolveInputs,
} from "../../capability";
import {
  assertWritableBinding,
} from "../../lifecycle";
import type { ReviewServedEvidence } from "../../review";
import {
  selfReferentialHash,
} from "../../teams";

// ── M1: shadow resolution ────────────────────────────────────────────────────

export const SHADOW_COMPARISON_SCHEMA = "guild.shadow_comparison.v1" as const;

export interface ShadowComparisonV1 {
  schema_version: typeof SHADOW_COMPARISON_SCHEMA;
  run_id: string;
  dispatch_id: string;
  shadow: {
    model: string | null;
    effort: string | null;
    resolution_core_hash: string | null;
    failed_closed: string | null;
  };
  legacy: { model: string; source: string };
  /** True iff the shadow produced a selection AND it equals the legacy model. */
  match: boolean;
  /** False when the shadow failed closed — an incomparable data point, honestly. */
  comparable: boolean;
  /** SHA-256 over the canonical YAML with this field omitted (team-contracts §1). */
  comparison_hash: string;
}

export interface LegacySelection {
  model: string;
  /** Provenance label of the current dispatch path (e.g. "tier_map:powerful"). */
  source?: string;
}

export interface ShadowRunResult {
  ran: boolean;
  reason: string;
  receipt?: ResolutionReceipt;
  comparison?: ShadowComparisonV1;
}

/**
 * Run the resolver in shadow (M1). NEVER changes the dispatched model: the
 * legacy selection is read-only input and the return value carries evidence
 * only. Deterministic: no wall-clock enters the comparison record.
 */
export function runShadowResolution(input: {
  flags: RoutingFlags;
  resolveInputs: ResolveInputs;
  legacy: LegacySelection;
}): ShadowRunResult {
  if (input.flags["model_routing.shadow"] !== "on") {
    return { ran: false, reason: "model_routing.shadow is off (M1 not graduated for this scope)" };
  }
  const receipt = resolveModel(input.resolveInputs);
  const failedClosed = typeof receipt["failed_closed"] === "string" ? (receipt["failed_closed"] as string) : null;
  const selection = receipt.selection as Record<string, unknown> | null;
  const shadowModel = !failedClosed && selection && typeof selection["model"] === "string"
    ? (selection["model"] as string)
    : null;
  const comparison: Omit<ShadowComparisonV1, "comparison_hash"> = {
    schema_version: SHADOW_COMPARISON_SCHEMA,
    run_id: String(receipt.run_id ?? "unbound"),
    dispatch_id: String(receipt.dispatch_id ?? "unbound"),
    shadow: {
      model: shadowModel,
      effort: !failedClosed && selection && typeof selection["effort"] === "string"
        ? (selection["effort"] as string)
        : null,
      resolution_core_hash: typeof receipt.resolution_core_hash === "string"
        ? receipt.resolution_core_hash
        : null,
      failed_closed: failedClosed,
    },
    legacy: { model: input.legacy.model, source: input.legacy.source ?? "legacy" },
    match: shadowModel !== null && shadowModel === input.legacy.model,
    comparable: shadowModel !== null,
  };
  const comparison_hash = selfReferentialHash(
    { ...comparison, comparison_hash: "" } as unknown as Record<string, unknown>,
    "comparison_hash"
  );
  return {
    ran: true,
    reason: "shadow resolution recorded (no dispatch effect)",
    receipt,
    comparison: { ...comparison, comparison_hash },
  };
}

/** The caller-threaded T3/T3b write authorization (run_id + minted nonce). */
export interface ShadowBindingEnvelope {
  run_id: string;
  /** The minted nonce; absent/empty is REJECTED (binding_absent), never a bypass. */
  binding_ref: string | undefined;
}

/**
 * Persist shadow artifacts RUN-LOCAL under the VERIFIED binding's own run tree
 * (`<root>/.guild/runs/<run_id>/shadow/`, atomic temp+rename).
 *
 * Authorization is the T3/T3b run-binding contract, NOT path matching
 * (T6-R1-F4): the caller MUST thread the run's minted binding envelope, and
 * assertWritableBinding verifies it against the run's own binding record
 * BEFORE any write — absent/malformed/closed/mismatched bindings throw
 * BindingRejectedError and nothing reaches disk. The receipt/comparison must
 * be bound to the SAME run as the envelope; the target directory derives from
 * the verified binding (a caller cannot aim a shadow write at another run's
 * tree). Nothing else in the run dir is touched (the `resolution/` receipts of
 * the real dispatch path are never rewritten).
 */
export function persistShadowArtifacts(
  root: string,
  result: ShadowRunResult,
  binding: ShadowBindingEnvelope
): { receiptPath: string | null; comparisonPath: string | null } {
  if (!result.ran || !result.receipt || !result.comparison) {
    return { receiptPath: null, comparisonPath: null };
  }
  if (
    result.receipt.run_id !== binding.run_id ||
    result.comparison.run_id !== binding.run_id
  ) {
    throw new Error(
      `run_binding_mismatch: shadow artifacts for run "${String(result.receipt.run_id)}" ` +
        `cannot be written under binding for run "${binding.run_id}" — refusing`
    );
  }
  // §5 fail-closed gate: verify the minted nonce BEFORE anything reaches disk.
  const verified = assertWritableBinding({
    root,
    run_id: binding.run_id,
    binding_ref: binding.binding_ref,
  });
  const dispatchId = String(result.receipt.dispatch_id);
  const dir = path.join(root, ".guild", "runs", verified.run_id, "shadow");
  fs.mkdirSync(dir, { recursive: true });
  const writeAtomic = (target: string, body: string): void => {
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, body, "utf8");
    fs.renameSync(tmp, target);
  };
  const receiptPath = path.join(dir, `${dispatchId}.shadow-receipt.json`);
  const comparisonPath = path.join(dir, `${dispatchId}.shadow-comparison.json`);
  writeAtomic(receiptPath, JSON.stringify(result.receipt, null, 2) + "\n");
  writeAtomic(comparisonPath, JSON.stringify(result.comparison, null, 2) + "\n");
  return { receiptPath, comparisonPath };
}

// ── M2: opt-in selection behind the gate ─────────────────────────────────────

export interface DispatchModelSelection {
  source: "legacy" | "v2";
  model: string;
  effort: string | null;
  dispatch_id?: string;
  resolution_core_hash?: string;
  /** Present only on source "v2" — the frozen receipt driving this dispatch. */
  receipt?: ResolutionReceipt;
  reason: string;
}

/**
 * Select the dispatch model. The M2 gate is computed HERE from evidence REFS
 * that gateM2 loads and verifies — there is no injectable gate object
 * (T6-R1-F3): with `model_routing.enabled` off, no caller-supplied value can
 * make this select v2. v2 drives ONLY when the verified gate is active AND
 * the resolver produced a frozen selection; every other path returns the
 * legacy selection unchanged with an honest reason (never a silent
 * substitution, resolution §3).
 */
export function selectDispatchModel(input: {
  flags: RoutingFlags;
  m2Evidence: M2EvidenceRefs | null;
  resolveInputs: ResolveInputs;
  legacy: LegacySelection;
}): DispatchModelSelection {
  const gate = gateM2(input.flags, input.m2Evidence);
  const legacyOut: DispatchModelSelection = {
    source: "legacy",
    model: input.legacy.model,
    effort: null,
    reason: "",
  };
  if (!gate.active) {
    return { ...legacyOut, reason: `v2 routing inactive: ${gate.reason}` };
  }
  const receipt = resolveModel(input.resolveInputs);
  const failedClosed = typeof receipt["failed_closed"] === "string" ? (receipt["failed_closed"] as string) : null;
  const selection = receipt.selection as Record<string, unknown> | null;
  if (failedClosed || !selection || typeof selection["model"] !== "string") {
    return {
      ...legacyOut,
      reason: `v2 resolver fail-closed (${failedClosed ?? "no selection"}) — legacy selection retained, nothing substituted silently`,
    };
  }
  return {
    source: "v2",
    model: selection["model"] as string,
    effort: typeof selection["effort"] === "string" ? (selection["effort"] as string) : null,
    dispatch_id: String(receipt.dispatch_id),
    resolution_core_hash: typeof receipt.resolution_core_hash === "string" ? receipt.resolution_core_hash : undefined,
    receipt,
    reason: gate.reason,
  };
}

/**
 * The ONE dispatch-side entry: runs M1 shadow (when flagged) and the M2
 * selection (when gated) over the same frozen inputs. The gate is derived
 * internally from verified evidence refs. Shadow evidence and the selection
 * are independent — a shadow disagreement changes nothing.
 */
export function planDispatchModel(input: {
  flags: RoutingFlags;
  m2Evidence: M2EvidenceRefs | null;
  resolveInputs: ResolveInputs;
  legacy: LegacySelection;
}): { selection: DispatchModelSelection; shadow: ShadowRunResult; gate: M2Gate } {
  const gate = gateM2(input.flags, input.m2Evidence);
  const shadow = runShadowResolution({
    flags: input.flags,
    resolveInputs: input.resolveInputs,
    legacy: input.legacy,
  });
  const selection = selectDispatchModel({
    flags: input.flags,
    m2Evidence: input.m2Evidence,
    resolveInputs: input.resolveInputs,
    legacy: input.legacy,
  });
  return { selection, shadow, gate };
}

// ── §6 exact-key confirmation wiring ─────────────────────────────────────────

/**
 * Build the EXACT confirmation 6-tuple from a frozen receipt (resolution §6).
 * Every component is required; the T5 arbiter fails closed on a partial key,
 * so prompts can only ever dedupe on byte-identical tuples.
 */
export function confirmationKeyForReceipt(receipt: ResolutionReceipt): Record<string, string> {
  const refs = (receipt.refs ?? {}) as Record<string, { path_or_id: string; sha256: string }>;
  const selection = receipt.selection as Record<string, unknown> | null;
  const request = receipt.request as Record<string, unknown> | null;
  return {
    run_id: String(receipt.run_id ?? ""),
    purpose: typeof request?.["purpose"] === "string" ? (request["purpose"] as string) : "",
    target_id: typeof selection?.["target_id"] === "string" ? (selection["target_id"] as string) : "",
    policy_hash: refs["policy"]?.sha256 ?? "",
    catalog_hash: refs["catalog_snapshot"]?.sha256 ?? "",
    fallback_hash: typeof receipt.fallback_hash === "string" ? receipt.fallback_hash : "",
  };
}

// ── Review-broker provenance (resolution §7–§7a; T5 opens_for → T6) ─────────

/**
 * Served evidence for `planReviewPairing` from a VERIFIED FINALIZED receipt
 * only: the receipt must pass T5's verifyResolutionReceipt — its frozen core
 * AND its receipt_hash must RECOMPUTE (T6-R1-F2); a forged/tampered receipt
 * and every unfinalized receipt (including every M1 shadow receipt) return
 * null — they prove nothing (§8), so they can never ground a strong pairing.
 * The family is derived from the SERVED model against the receipt's OWN
 * frozen snapshot models (never from the requested model); unmatched ⇒ the
 * literal "unknown".
 */
export function servedEvidenceFromReceipt(
  receipt: ResolutionReceipt,
  frozenSnapshotModels?: Array<{ canonical_id: string; model_family?: string }>
): ReviewServedEvidence | null {
  const verdict = verifyResolutionReceipt(receipt);
  if (!verdict.ok || !verdict.finalized) return null;
  const verified = verdict.receipt;
  const status = verified.outcome?.status;
  if (status !== "served" && status !== "fallback_served") return null;
  const served = typeof verified.outcome.actual_model === "string" ? verified.outcome.actual_model : "unknown";
  let family = "unknown";
  if (served !== "unknown" && Array.isArray(frozenSnapshotModels)) {
    const row = frozenSnapshotModels.find((m) => m.canonical_id === served);
    if (row && typeof row.model_family === "string" && row.model_family.length > 0) {
      family = row.model_family;
    }
  }
  return {
    served_model: served,
    served_model_family: family,
    finalized: true,
    status: String(status),
  };
}

/**
 * src/modules/capability/workflows/independence-predicates.ts
 *
 * Deterministic two-axis review-independence predicates
 * (guild.model_resolution.v1 §7–§7a; SC-7). Lanes T5+T6.
 *
 * strong(P, R) requires ALL of:
 *   - both SERVED models provider-bound (finalized receipt, status served or
 *     fallback_served, actual_model ≠ unknown);
 *   - VERIFIED host trust on BOTH sides (asserted / inferred / low-confidence /
 *     absent ⇒ weak — the gate requires === "verified", it never tests for a
 *     specific bad value, so a stripped/undefined trust field fails closed);
 *   - known + differing host_family on the host axis;
 *   - known + differing served-model model_family on the model axis (ALWAYS
 *     derived from the SERVED model, never the requested one).
 *
 * The two axes are stored separately and NEVER compared across each other.
 * An unknown producer family is safe and real: it degrades to weak; it is
 * never guessed. Same-family fallback may run as a fresh-context review but
 * MUST be adjudicated weak and can never satisfy a strong-review claim.
 *
 * CONTRACT: pure, total, deterministic over its inputs. No I/O, no clock.
 */

export interface ReviewPartyFacts {
  /** Verified dispatch substrate/provider boundary (session_context). */
  host_family?: string;
  /** T3 identity trust: only the literal "verified" passes (fail closed). */
  host_trust?: string;
  /** The SERVED model (finalized receipt outcome.actual_model); "unknown" when unbound. */
  served_model?: string;
  /** Catalog family of the SERVED model; "unknown" when neither source binds it. */
  served_model_family?: string;
  /** True only when the party's resolution receipt is FINALIZED (§8). */
  finalized?: boolean;
  /** The finalized receipt's outcome.status. */
  status?: string;
}

export interface IndependenceAdjudication {
  independence: "strong" | "weak";
  predicate_trace: string;
  producer_served_model: string;
  reviewer_served_model: string;
  producer_model_family: string;
  reviewer_model_family: string;
}

const known = (x: unknown): boolean => typeof x === "string" && x.length > 0 && x !== "unknown";

function finalServed(p: ReviewPartyFacts): boolean {
  return p.finalized === true && (p.status === "served" || p.status === "fallback_served");
}

function boundActual(p: ReviewPartyFacts): boolean {
  return finalServed(p) && known(p.served_model);
}

function verified(p: ReviewPartyFacts): boolean {
  // T3 verified-only trust semantics: gate on === "verified" so an omitted or
  // stripped trust field degrades exactly like an asserted one (fail closed).
  return p.host_trust === "verified";
}

/**
 * Adjudicate independence for a producer/reviewer pair of freeze-verified
 * facts. Every term is evaluated and recorded in predicate_trace; the verdict
 * is strong ONLY when every term passes — otherwise weak (never an error).
 */
export function adjudicateIndependence(input: {
  producer: ReviewPartyFacts;
  reviewer: ReviewPartyFacts;
}): IndependenceAdjudication {
  const p = input?.producer ?? {};
  const r = input?.reviewer ?? {};

  const terms: Array<{ name: string; pass: boolean }> = [
    { name: "bound_actual(producer)", pass: boundActual(p) },
    { name: "bound_actual(reviewer)", pass: boundActual(r) },
    { name: "verified(host(producer))", pass: verified(p) },
    { name: "verified(host(reviewer))", pass: verified(r) },
    { name: "known(host_family(producer))", pass: known(p.host_family) },
    { name: "known(host_family(reviewer))", pass: known(r.host_family) },
    {
      name: "host_family(producer) != host_family(reviewer)",
      pass: known(p.host_family) && known(r.host_family) && p.host_family !== r.host_family,
    },
    { name: "known(served_family(producer))", pass: known(p.served_model_family) },
    { name: "known(served_family(reviewer))", pass: known(r.served_model_family) },
    {
      name: "served_family(producer) != served_family(reviewer)",
      pass:
        known(p.served_model_family) &&
        known(r.served_model_family) &&
        p.served_model_family !== r.served_model_family,
    },
  ];

  const allPass = terms.every((t) => t.pass);
  const trace = terms.map((t) => `${t.name}=${t.pass ? "PASS" : "FAIL"}`).join("; ");

  return {
    independence: allPass ? "strong" : "weak",
    predicate_trace: `${trace} => ${allPass ? "strong" : "weak"}`,
    producer_served_model: known(p.served_model) ? (p.served_model as string) : "unknown",
    reviewer_served_model: known(r.served_model) ? (r.served_model as string) : "unknown",
    producer_model_family: known(p.served_model_family) ? (p.served_model_family as string) : "unknown",
    reviewer_model_family: known(r.served_model_family) ? (r.served_model_family as string) : "unknown",
  };
}

// ── §7a WRITTEN-block shape (the SINGLE source, T7-H2) ──────────────────────
//
// `model-inspect.ts` used to carry a PRIVATE copy of this validator. Two
// consumers now need it — the inspection service and the run-state persistence
// guard — so the shape lives here, once, next to the predicate it certifies.
// (The dot-guild scrub share-set taught this lesson the expensive way: a
// security shape duplicated across two call sites drifts.)

const ADJUDICATION_SHA256_HEX = /^[0-9a-f]{64}$/;

export interface AdjudicationRef {
  dispatch_id: string;
  receipt_hash: string;
}

/** A validated, WRITTEN §7a block — never a caller fragment. */
export interface WrittenAdjudication {
  producer_ref: AdjudicationRef;
  reviewer_ref: AdjudicationRef;
  independence: "strong" | "weak";
  predicate_trace: string;
}

function asAdjudicationRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function validateAdjudicationRef(v: unknown): AdjudicationRef | null {
  const o = asAdjudicationRecord(v);
  if (!o) return null;
  const dispatch_id = o["dispatch_id"];
  const receipt_hash = o["receipt_hash"];
  if (typeof dispatch_id !== "string" || dispatch_id.length === 0) return null;
  if (typeof receipt_hash !== "string" || !ADJUDICATION_SHA256_HEX.test(receipt_hash)) return null;
  return { dispatch_id, receipt_hash };
}

/**
 * Validate a value as a WRITTEN §7a adjudication block (closed shape). A
 * fragment — anything missing the backward receipt refs, the verdict, or the
 * term-by-term predicate trace — is rejected: it is not an adjudication,
 * whatever independence value it asserts. §7a admits NO provisional strong,
 * so a bare `{independence: "strong"}` can never satisfy this.
 */
export function validateWrittenAdjudication(v: unknown): WrittenAdjudication | null {
  const o = asAdjudicationRecord(v);
  if (!o) return null;
  const producer_ref = validateAdjudicationRef(o["producer_ref"]);
  const reviewer_ref = validateAdjudicationRef(o["reviewer_ref"]);
  if (!producer_ref || !reviewer_ref) return null;
  const independence = o["independence"];
  if (independence !== "strong" && independence !== "weak") return null;
  const predicate_trace = o["predicate_trace"];
  if (typeof predicate_trace !== "string" || predicate_trace.length === 0) return null;
  return { producer_ref, reviewer_ref, independence, predicate_trace };
}

/**
 * Build the §7a `independence_adjudication` block for a broker gate record —
 * written exactly once, ONLY after both referenced receipts verify as
 * finalized. Callers (review broker, lane T6) supply the backward refs; this
 * helper only assembles the closed shape around the deterministic verdict.
 */
export function buildIndependenceAdjudication(input: {
  producer_ref: { dispatch_id: string; receipt_hash: string };
  reviewer_ref: { dispatch_id: string; receipt_hash: string };
  producer: ReviewPartyFacts;
  reviewer: ReviewPartyFacts;
  requested_independence: "none" | "prefer_cross_family" | "require_cross_family";
}): Record<string, unknown> {
  if (!input.producer.finalized || !input.reviewer.finalized) {
    throw new Error(
      "adjudication_premature: the §7a block is written ONLY after BOTH receipts are finalized"
    );
  }
  const verdict = adjudicateIndependence({ producer: input.producer, reviewer: input.reviewer });
  return {
    producer_ref: input.producer_ref,
    reviewer_ref: input.reviewer_ref,
    producer_served_model: verdict.producer_served_model,
    reviewer_served_model: verdict.reviewer_served_model,
    producer_model_family: verdict.producer_model_family,
    reviewer_model_family: verdict.reviewer_model_family,
    requested_independence: input.requested_independence,
    independence: verdict.independence,
    predicate_trace: verdict.predicate_trace,
  };
}

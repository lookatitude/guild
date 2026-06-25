/**
 * lib/learning-candidate.ts — the typed `learning_candidate` shape (deferred
 * item 9; docs/v2/05-knowledge-memory.md §Candidate queue).
 *
 * The shipped harvest queue is `guild.harvest_candidates.v1` (wiki / decision /
 * reflection / evolution buckets). This is the refined typed candidate: a closed
 * 7-value `type` + scope + evidence_refs + confidence/impact + a
 * `recommended_destination`, plus the promotion gate the policy binds to it.
 *
 * Promotion policy (unchanged, one path): low-risk repo facts with direct
 * evidence are auto-PROPOSED (never auto-promoted); decisions / standards /
 * skill changes need human approval; secrets never promote; failed hypotheses
 * (assumption / unknown) stay run-local. Nothing here writes the wiki — it only
 * classifies + routes; promotion remains the human-gated ingest/decisions path.
 */

export const LEARNING_CANDIDATE_SCHEMA = "guild.learning_candidate.v1";

/** Closed 7-value candidate type. */
export const LEARNING_CANDIDATE_TYPES = [
  "fact",
  "decision",
  "assumption",
  "unknown",
  "standard",
  "skill_improvement",
  "eval_fixture",
] as const;
export type LearningCandidateType = (typeof LEARNING_CANDIDATE_TYPES)[number];

export type Confidence = "high" | "medium" | "low";
export type Impact = "high" | "medium" | "low";
export type CandidateScope = "run" | "repo" | "workspace";

/** Where a promoted candidate is routed (informational; the gate decides if). */
export type RecommendedDestination =
  | "wiki"
  | "wiki:standards"
  | "decision"
  | "skill"
  | "eval"
  | "run_local";

/** The gate the promotion policy binds — never an auto-write. */
export type PromotionGate = "auto_propose" | "human_approval" | "never" | "run_local";

export interface LearningCandidate {
  schema_version: typeof LEARNING_CANDIDATE_SCHEMA;
  type: LearningCandidateType;
  summary: string;
  scope: CandidateScope;
  evidence_refs: string[];
  confidence: Confidence;
  impact: Impact;
  recommended_destination: RecommendedDestination;
  promotion_gate: PromotionGate;
}

const SET = new Set<string>(LEARNING_CANDIDATE_TYPES);

/** Destination routing by type (pure). */
export function recommendedDestination(type: LearningCandidateType): RecommendedDestination {
  switch (type) {
    case "fact": return "wiki";
    case "standard": return "wiki:standards";
    case "decision": return "decision";
    case "skill_improvement": return "skill";
    case "eval_fixture": return "eval";
    case "assumption":
    case "unknown": return "run_local";
  }
}

/**
 * Promotion gate by the binding policy (pure). `containsSecret` short-circuits to
 * "never". Failed hypotheses stay run-local; high-significance kinds need human
 * approval; only low-risk evidenced repo facts + eval fixtures auto-propose.
 */
export function promotionGate(
  type: LearningCandidateType,
  confidence: Confidence,
  evidenceRefs: string[],
  scope: CandidateScope,
  containsSecret = false,
): PromotionGate {
  if (containsSecret) return "never";
  switch (type) {
    case "assumption":
    case "unknown":
      return "run_local"; // failed/unconfirmed hypotheses stay run-local
    case "decision":
    case "standard":
    case "skill_improvement":
      return "human_approval"; // goals/standards/architecture/security/skill changes
    case "eval_fixture":
      return "auto_propose"; // low-risk test material
    case "fact":
      // low-risk repo fact WITH direct evidence → auto-propose; else human.
      return scope !== "run" && evidenceRefs.length > 0 && confidence !== "low"
        ? "auto_propose"
        : "human_approval";
  }
}

/** Build a fully-typed candidate, deriving destination + gate from the policy. */
export function makeLearningCandidate(input: {
  type: LearningCandidateType;
  summary: string;
  scope?: CandidateScope;
  evidence_refs?: string[];
  confidence?: Confidence;
  impact?: Impact;
  containsSecret?: boolean;
}): LearningCandidate {
  const scope = input.scope ?? "repo";
  const evidence_refs = input.evidence_refs ?? [];
  const confidence = input.confidence ?? "medium";
  return {
    schema_version: LEARNING_CANDIDATE_SCHEMA,
    type: input.type,
    summary: input.summary,
    scope,
    evidence_refs,
    confidence,
    impact: input.impact ?? "medium",
    recommended_destination: recommendedDestination(input.type),
    promotion_gate: promotionGate(input.type, confidence, evidence_refs, scope, input.containsSecret),
  };
}

/** Structural + closed-enum validation. */
export function isValidLearningCandidate(x: unknown): x is LearningCandidate {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  return (
    c["schema_version"] === LEARNING_CANDIDATE_SCHEMA &&
    typeof c["type"] === "string" && SET.has(c["type"]) &&
    typeof c["summary"] === "string" && c["summary"] !== "" &&
    Array.isArray(c["evidence_refs"]) &&
    typeof c["recommended_destination"] === "string" &&
    typeof c["promotion_gate"] === "string"
  );
}

// ── Derivation from the shipped guild.harvest_candidates.v1 queue ──────────────

interface RawHarvest {
  wiki_candidates?: unknown;
  decision_candidates?: unknown;
}
interface RawWiki { title?: string; confidence?: string; source_refs?: string[]; category?: string }
interface RawDecision { decision?: string; confidence?: string; source_refs?: string[] }

const CONF = (c: string | undefined): Confidence =>
  c === "high" || c === "low" ? c : "medium";

/**
 * Best-effort upgrade of a `guild.harvest_candidates.v1` payload into typed
 * learning_candidates. decision_candidates → type "decision"; wiki_candidates →
 * "standard" when their category is `standards`, else "fact". Lossless on the
 * fields that map; the policy fills destination + gate.
 */
export function deriveLearningCandidates(harvest: unknown): LearningCandidate[] {
  const h = (harvest ?? {}) as RawHarvest;
  const out: LearningCandidate[] = [];
  if (Array.isArray(h.wiki_candidates)) {
    for (const w of h.wiki_candidates as RawWiki[]) {
      const type: LearningCandidateType = w?.category === "standards" ? "standard" : "fact";
      out.push(makeLearningCandidate({
        type,
        summary: w?.title ?? "(untitled wiki candidate)",
        evidence_refs: Array.isArray(w?.source_refs) ? w.source_refs : [],
        confidence: CONF(w?.confidence),
      }));
    }
  }
  if (Array.isArray(h.decision_candidates)) {
    for (const d of h.decision_candidates as RawDecision[]) {
      out.push(makeLearningCandidate({
        type: "decision",
        summary: d?.decision ?? "(untitled decision candidate)",
        evidence_refs: Array.isArray(d?.source_refs) ? d.source_refs : [],
        confidence: CONF(d?.confidence),
      }));
    }
  }
  return out;
}

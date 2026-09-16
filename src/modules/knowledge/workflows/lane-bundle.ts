/**
 * lane-bundle.ts — the context firewall's two sizes (KTD26 / KTD45 / R42 / R57).
 *
 * The context-manager writes TWO objects per assignment, and the whole point is
 * that only one of them ever goes up:
 *
 *   - the specialist's ON-DISK bundle, ≤6k tokens: Universal + Role + Task + Terms.
 *     The worker reads this file. T1 and T0 never do.
 *   - `guild.lane_bundle.v1`, ≤1200 tokens: the working-set card (≤400) plus
 *     CITATIONS (path, line, one-line gist) plus glossary terms (≤200). This is
 *     what T1/T0 see.
 *
 * The rule the fixture pins is "T0 context never contains a 6k specialist bundle",
 * and it is easy to state and easy to violate by accident — the 6k text is right
 * there in the same process, and "just include the bundle" is one line. So the
 * violation is made CHECKABLE rather than merely forbidden: `assertNoSpecialistBundle`
 * takes whatever a parent is about to be handed and refuses anything carrying the
 * bundle's marker heading or exceeding the lane cap. A caller that wants to send
 * the 6k file upward has to delete a check to do it.
 *
 * Citations, not dumps: `hits` carry a path and a gist, never file content. The
 * worker may Read a cited path; the parent must not. That asymmetry is the reason
 * the lane bundle stays small no matter how large the evidence is.
 */

import * as crypto from "node:crypto";

import { GLOSSARY_TERM_TOKEN_CAP, type Glossary, type MatchedTerms, matchTerms, renderTermsChapter } from "./glossary";
import {
  WORKING_SET_TOKEN_CAP,
  estimateTokens,
  type WorkingSet,
} from "./working-set";

export const LANE_BUNDLE_SCHEMA = "guild.lane_bundle.v1" as const;

/** KTD26: the whole bundle a parent sees. */
export const LANE_BUNDLE_TOKEN_CAP = 1200;
/** KTD45: the specialist's on-disk bundle. */
export const SPECIALIST_BUNDLE_TOKEN_CAP = 6000;

/** The heading that marks a specialist on-disk bundle wherever it turns up. */
export const SPECIALIST_BUNDLE_MARKER = "<!-- guild.specialist_bundle.v1 -->";

export interface LaneBundleHit {
  path: string;
  line?: number;
  /** One line. If this needs a paragraph, it is a dump, not a citation. */
  gist: string;
  score: number;
}

export interface LaneBundle {
  schema_version: typeof LANE_BUNDLE_SCHEMA;
  bundle_id: string;
  cell_id: string;
  fingerprint: string;
  working_set: WorkingSet;
  hits: LaneBundleHit[];
  terms: Array<{ term: string; definition: string }>;
  card_tokens: number;
}

export interface BuildLaneBundleInput {
  cell_id: string;
  working_set: WorkingSet;
  hits: readonly LaneBundleHit[];
  /** The assignment text glossary terms are matched against. */
  assignment_text?: string;
  glossary?: Glossary;
  /** Pre-matched terms, when the caller already ran `matchTerms`. */
  matched_terms?: MatchedTerms;
}

function bundleId(cellId: string, fingerprint: string): string {
  return crypto.createHash("sha256").update(`${cellId}\n${fingerprint}`, "utf8").digest("hex").slice(0, 16);
}

function fingerprintOf(ws: WorkingSet): string {
  const f = ws.fingerprint;
  return crypto
    .createHash("sha256")
    .update(`${f.wiki_mtime}\n${f.git_head}\n${f.open_questions_hash}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

function bundleTokens(b: Omit<LaneBundle, "card_tokens">): number {
  // The card's own token count is what the parent pays: the working-set card as
  // JSON, plus one line per citation, plus the term definitions.
  const hitText = b.hits.map((h) => `${h.path}${h.line ? `:${h.line}` : ""} ${h.gist}`).join("\n");
  const termText = b.terms.map((t) => `${t.term}: ${t.definition}`).join("\n");
  return b.working_set.card_tokens + estimateTokens(hitText) + estimateTokens(termText);
}

/**
 * Build a `guild.lane_bundle.v1` within budget.
 *
 * Trimming order is CITATIONS FIRST, lowest score first. The working-set card and
 * the glossary terms both have their own sub-caps and are already minimal; the
 * citation list is the elastic part, and the lowest-scoring hit is by construction
 * the one the worker is least likely to open.
 */
export function buildLaneBundle(input: BuildLaneBundleInput): LaneBundle {
  const fingerprint = fingerprintOf(input.working_set);
  const matched =
    input.matched_terms ??
    (input.glossary
      ? matchTerms(input.assignment_text ?? "", input.glossary, GLOSSARY_TERM_TOKEN_CAP)
      : { terms: [], tokens: 0, dropped: [] });

  const bundle: LaneBundle = {
    schema_version: LANE_BUNDLE_SCHEMA,
    bundle_id: bundleId(input.cell_id, fingerprint),
    cell_id: input.cell_id,
    fingerprint,
    working_set: input.working_set,
    hits: [...input.hits].sort((a, b) => b.score - a.score),
    terms: matched.terms,
    card_tokens: 0,
  };

  bundle.card_tokens = bundleTokens(bundle);
  while (bundle.card_tokens > LANE_BUNDLE_TOKEN_CAP && bundle.hits.length > 0) {
    bundle.hits.pop();
    bundle.card_tokens = bundleTokens(bundle);
  }
  return bundle;
}

export type BundleViolation =
  | "lane-bundle-over-cap"
  | "working-set-over-cap"
  | "glossary-terms-over-cap"
  | "specialist-bundle-in-parent-context";

export interface BundleCheck {
  ok: boolean;
  violations: Array<{ rule: BundleViolation; detail: string }>;
}

/** Check a bundle against all three caps. */
export function validateLaneBundle(bundle: LaneBundle): BundleCheck {
  const violations: BundleCheck["violations"] = [];
  if (bundle.card_tokens > LANE_BUNDLE_TOKEN_CAP) {
    violations.push({
      rule: "lane-bundle-over-cap",
      detail: `lane bundle is ~${bundle.card_tokens} tokens (cap ${LANE_BUNDLE_TOKEN_CAP})`,
    });
  }
  if (bundle.working_set.card_tokens > WORKING_SET_TOKEN_CAP) {
    violations.push({
      rule: "working-set-over-cap",
      detail: `working-set card is ~${bundle.working_set.card_tokens} tokens (cap ${WORKING_SET_TOKEN_CAP})`,
    });
  }
  const termTokens = estimateTokens(bundle.terms.map((t) => `${t.term}: ${t.definition}`).join("\n"));
  if (termTokens > GLOSSARY_TERM_TOKEN_CAP) {
    violations.push({
      rule: "glossary-terms-over-cap",
      detail: `glossary terms are ~${termTokens} tokens (cap ${GLOSSARY_TERM_TOKEN_CAP})`,
    });
  }
  return { ok: violations.length === 0, violations };
}

export interface SpecialistBundleInput {
  universal: string;
  role: string;
  task: string;
  terms?: MatchedTerms;
}

/**
 * Render the specialist's on-disk bundle. Carries the marker so that if it is ever
 * handed to a parent, `assertNoSpecialistBundle` can say so by inspection rather
 * than by guessing from size alone.
 *
 * Over-budget TRUNCATES the task chapter, and deliberately not the Terms chapter:
 * terms are already capped at 200 and are the cheapest thing in the file, while an
 * over-long task section is the thing that actually blew the budget.
 */
export function renderSpecialistBundle(input: SpecialistBundleInput): { text: string; tokens: number } {
  const termsChapter = input.terms ? renderTermsChapter(input.terms) : "";
  const compose = (task: string): string =>
    [SPECIALIST_BUNDLE_MARKER, `## Universal\n\n${input.universal}`, `## Role\n\n${input.role}`, `## Task\n\n${task}`, termsChapter]
      .filter((s) => s !== "")
      .join("\n\n") + "\n";

  let task = input.task;
  let text = compose(task);
  let tokens = estimateTokens(text);
  while (tokens > SPECIALIST_BUNDLE_TOKEN_CAP && task.length > 0) {
    // 4 chars ≈ 1 token: cut the overshoot plus a small margin, then re-measure.
    const overshootChars = (tokens - SPECIALIST_BUNDLE_TOKEN_CAP) * 4 + 64;
    task = task.slice(0, Math.max(0, task.length - overshootChars));
    text = compose(task);
    tokens = estimateTokens(text);
  }
  return { text, tokens };
}

/**
 * Refuse a specialist bundle that is on its way into a parent's context (R57).
 *
 * Both tests matter. The marker catches the honest mistake of passing the file
 * through. The size check catches the dishonest one of stripping the marker: a
 * "citation list" over the lane cap is the 6k file wearing a different name.
 */
export function assertNoSpecialistBundle(payload: unknown, where = "parent context"): void {
  const text =
    typeof payload === "string" ? payload : payload === undefined ? "" : JSON.stringify(payload);
  if (text.includes(SPECIALIST_BUNDLE_MARKER)) {
    throw new Error(
      `guild.lane_bundle.v1 violation: a specialist on-disk bundle reached ${where}; parents see citations, not sources (R57)`,
    );
  }
  if (estimateTokens(text) > LANE_BUNDLE_TOKEN_CAP) {
    throw new Error(
      `guild.lane_bundle.v1 violation: ~${estimateTokens(text)} tokens reached ${where} (cap ${LANE_BUNDLE_TOKEN_CAP})`,
    );
  }
}

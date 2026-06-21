/**
 * scripts/lib/ingest-importance.ts
 *
 * Write-time importance-at-ingest 1–5 scorer (docs/v2/05-knowledge-memory.md
 * §Importance-at-ingest). The 1–5 score is the MACHINE-FACING recall-ranking
 * weight — distinct from, and never conflated with, the human-curation
 * `importance: critical|high|medium|low` frontmatter grade (§Two importance axes).
 *
 * Two halves, both pure:
 *   - the SCORER: `ingestImportanceScore(category)` maps a wiki category to the
 *     1–5 weight (ADR→5 / contract→4 / summary→3 / context→2 design table);
 *   - the PERSISTENCE: `stampRecallImportance` / `parseRecallImportance` write &
 *     read the score as a `recall_importance:` frontmatter key, so recall reads a
 *     STABLE stored value at query time instead of re-deriving it every call —
 *     the "write-time scorer" the spec named as the missing implementer.
 *
 * `resolveRecallImportance` is the read-back resolver recall uses: persisted
 * value when present + valid, else the category-derived score (so an un-stamped
 * corpus behaves exactly as before this lane — byte-identical fallback).
 *
 * Frontmatter edits are SURGICAL (single-line insert/update), never a yaml.dump
 * round-trip (which would reformat the whole block — see frontmatter.ts §note).
 */

import { splitFrontmatter } from "./frontmatter";

/** The frontmatter key the persisted 1–5 machine recall weight is stored under. */
export const RECALL_IMPORTANCE_KEY = "recall_importance";
/** When this key is truthy in a page's frontmatter, the stamper never touches it. */
export const RECALL_IMPORTANCE_PINNED_KEY = "recall_importance_pinned";

/** Valid persisted scores: integers 1–5. */
export function isValidScore(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

/**
 * Write-time importance score (1–5) for a wiki page by its category — the
 * machine-facing recall weight from the ADR→5 / contract→4 / summary→3 /
 * context→2 design table (docs/v2/05 §Importance-at-ingest), mapped onto Guild's
 * `.guild/wiki/<category>/` convention. Pure + deterministic. Unknown/absent
 * category → 3 (the neutral middle, == the default importanceGate).
 */
export function ingestImportanceScore(category: string | undefined): number {
  switch ((category ?? "").toLowerCase()) {
    case "decisions": case "decision": case "adr":
      return 5;
    case "standards": case "standard": case "contracts": case "contract":
      return 4;
    case "recipes": case "recipe": case "concepts": case "concept": case "guides": case "guide":
      return 3;
    case "context": case "notes": case "note": case "log": case "changelog": case "index": case "sources": case "source":
      return 2;
    default:
      return 3;
  }
}

/** Read the persisted 1–5 score from a page's frontmatter, or undefined when absent/invalid. */
export function parseRecallImportance(content: string): number | undefined {
  const { frontmatter } = splitFrontmatter(content);
  if (frontmatter === null) return undefined;
  const m = new RegExp(`^${RECALL_IMPORTANCE_KEY}:[ \\t]*(\\d+)[ \\t]*$`, "m").exec(frontmatter);
  if (!m) return undefined;
  const n = Number(m[1]);
  return isValidScore(n) ? n : undefined;
}

/** True when the page is pinned (`recall_importance_pinned: true`) — the stamper must skip it. */
export function isRecallImportancePinned(content: string): boolean {
  const { frontmatter } = splitFrontmatter(content);
  if (frontmatter === null) return false;
  return new RegExp(`^${RECALL_IMPORTANCE_PINNED_KEY}:[ \\t]*true[ \\t]*$`, "m").test(frontmatter);
}

/**
 * The score recall should USE for a page: the persisted frontmatter value when
 * present + valid, else the category-derived score. This is the read-back path —
 * an un-stamped corpus resolves identically to pre-lane behavior.
 */
export function resolveRecallImportance(content: string, category: string | undefined): number {
  return parseRecallImportance(content) ?? ingestImportanceScore(category);
}

export interface StampResult {
  /** The (possibly unchanged) content. */
  content: string;
  /** Did the content actually change? (idempotent no-op ⇒ false) */
  changed: boolean;
  /** Why it was skipped, when changed=false and it wasn't already correct. */
  skipped?: "pinned" | "already" | "no-frontmatter-nocreate";
}

/**
 * Persist the 1–5 score into a page's `recall_importance:` frontmatter key,
 * SURGICALLY (single-line insert or update — never a yaml.dump reformat).
 *
 * Policy (write-once-at-ingest, author-respecting):
 *   - `recall_importance_pinned: true` ⇒ never touch (author override).
 *   - key absent ⇒ insert it (the write-time assignment).
 *   - key present:
 *       - `force=false` (default) ⇒ leave as-is (already assigned at ingest), even
 *         if the value differs — re-grading is an explicit `force` action.
 *       - `force=true` ⇒ update to the new score.
 *   - no frontmatter block: create a minimal one unless `createFrontmatter=false`.
 *
 * @throws never — pure string transform.
 */
export function stampRecallImportance(
  content: string,
  score: number,
  opts: { force?: boolean; createFrontmatter?: boolean } = {},
): StampResult {
  const force = opts.force ?? false;
  const createFrontmatter = opts.createFrontmatter ?? true;
  if (!isValidScore(score)) {
    // refuse to write an out-of-range score; treat as no-op
    return { content, changed: false, skipped: "already" };
  }
  if (isRecallImportancePinned(content)) return { content, changed: false, skipped: "pinned" };

  const { frontmatter, body } = splitFrontmatter(content);

  if (frontmatter === null) {
    if (!createFrontmatter) return { content, changed: false, skipped: "no-frontmatter-nocreate" };
    const block = `---\n${RECALL_IMPORTANCE_KEY}: ${score}\n---\n\n`;
    return { content: block + content, changed: true };
  }

  const lineRe = new RegExp(`^(${RECALL_IMPORTANCE_KEY}:)[ \\t]*\\d+[ \\t]*$`, "m");
  if (lineRe.test(frontmatter)) {
    if (!force) return { content, changed: false, skipped: "already" };
    const existing = parseRecallImportance(content);
    if (existing === score) return { content, changed: false, skipped: "already" };
    const newFm = frontmatter.replace(lineRe, `$1 ${score}`);
    return { content: rebuild(newFm, body), changed: true };
  }

  // key absent in an existing block → append a line (preserve trailing newline shape)
  const sep = frontmatter.endsWith("\n") ? "" : "\n";
  const newFm = `${frontmatter}${sep}${RECALL_IMPORTANCE_KEY}: ${score}`;
  return { content: rebuild(newFm, body), changed: true };
}

/** Reassemble a document from a frontmatter block + body. */
function rebuild(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

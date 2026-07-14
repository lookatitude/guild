/**
 * tests/integration/lib/trigger-matcher.ts
 *
 * A deterministic, substring/keyword TRIGGER-clause matcher for skill and
 * specialist `description:` frontmatter fields. This is the v1 matcher the
 * paired-eval runner (tests/integration/paired-eval-runner.test.ts) uses to
 * turn the 61+ collision fixtures under tests/trigger/{core,meta}/evals.json,
 * tests/boundary/evals.json, and every per-skill evals.json under skills/
 * from dead-weight JSON into an actual, running assertion.
 *
 * MATCHER LIMITS (read before trusting a "pass"):
 *   - This is a keyword/phrase heuristic, NOT semantic understanding. It
 *     mirrors scripts/shadow-mode.ts's wouldTrigger() heuristic (same
 *     quoted-phrase-first, keyword-fallback design), reimplemented here
 *     standalone so the tests/ project stays decoupled from scripts/.
 *   - A description's quoted example phrases ("let's implement", "fix this
 *     bug", …) are matched as literal substrings — a prompt containing that
 *     exact wording (or a close paraphrase) matches; a semantically
 *     equivalent prompt using entirely different words will NOT match.
 *   - Bare (unquoted) significant words in a TRIGGER/DO NOT TRIGGER clause are
 *     also extracted as single-keyword fallback matchers — this is the
 *     "substring/keyword heuristic" the audit explicitly accepts as good
 *     enough for v1.
 *   - CORPUS DOCUMENT-FREQUENCY FLOOR (the fix for the biggest false-positive
 *     class this matcher hit in its first live run): every skill/specialist
 *     description mentions "Guild", "specialist", etc. incidentally — if
 *     those words were extracted as literal DO-NOT-TRIGGER keywords, nearly
 *     every real Guild-related prompt would be wrongly blocked from nearly
 *     every skill. `buildCorpusStopwords()` computes document frequency
 *     across the WHOLE description corpus and `parseDescription()` excludes
 *     any word appearing in more than `docFreqThreshold` of documents from
 *     keyword extraction on BOTH sides. The threshold (default 35%, not the
 *     more intuitive 20%) was tuned empirically: near-universal filler words
 *     ("guild" 48%, "specialist" 59%, "pulled" 46%) sit well above true
 *     domain words that are simply common because many skills share a
 *     concern ("review" 24.8%, "backend" 24%, "security" 21.6%, "marketing"
 *     22.4%) — a 20% floor wrongly caught "review" and made guild:review
 *     unable to match its own core TRIGGER vocabulary; 35% separates the two
 *     classes cleanly in this corpus. A quoted example phrase is never
 *     frequency-filtered (a full multi-word phrase match is a strong,
 *     deliberate author signal on its own).
 *   - DO NOT TRIGGER always wins over TRIGGER when both match (mirrors
 *     shadow-mode.ts: a DO NOT TRIGGER hit short-circuits to false).
 *   - Cross-skill/cross-specialist "which one wins" determination (used for
 *     the tests/trigger and tests/boundary tiers) is INCLUSIVE, not exclusive:
 *     the runner asserts the expected skill/specialist is AMONG the matches,
 *     not that it is the unique match — several descriptions share overlapping
 *     vocabulary on purpose (e.g. "API" appears in both architect's and
 *     backend's DO NOT TRIGGER / TRIGGER clauses), so "exactly one winner" is
 *     not a claim this heuristic can honestly make.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface ParsedTrigger {
  /** Quoted example phrases from the TRIGGER clause (lowercased). */
  triggerPhrases: string[];
  /** Bare significant keywords from the TRIGGER clause (lowercased). */
  triggerKeywords: string[];
  /** Quoted example phrases from the DO NOT TRIGGER clause (lowercased). */
  doNotTriggerPhrases: string[];
  /** Bare significant keywords from the DO NOT TRIGGER clause (lowercased). */
  doNotTriggerKeywords: string[];
}

// ── Stopwords (mirrors scripts/shadow-mode.ts's tokenizer) ──────────────────

const STOPWORDS = new Set([
  "the", "and", "for", "this", "that", "with", "from", "into", "onto",
  "not", "any", "all", "own", "its", "per", "via", "are", "was", "were",
  "has", "have", "had", "will", "shall", "does", "not", "trigger", "triggers",
  "triggering", "when", "then", "than", "such", "each", "these", "those",
  "which", "while", "about", "over", "under", "after", "before", "between",
  "other", "some", "none", "never", "always", "only", "also", "more",
]);

// ── Clause splitting ─────────────────────────────────────────────────────────

/**
 * Mask backtick-quoted spans (replace their content with spaces, preserving
 * length/offsets) so a marker search below can skip them without disturbing
 * the string indices used to slice the ORIGINAL description afterward.
 *
 * A handful of descriptions talk ABOUT the trigger-clause mechanism itself,
 * meta-referentially, inside backticks — e.g. guild:create-skill's own
 * description says "trigger boundary scan with `DO NOT TRIGGER` edits gated
 * via `guild:evolve-skill`" well before its OWN real "TRIGGER for ..."
 * marker. An unmasked search anchors on that meta-reference and truncates
 * the real clause down to a near-empty fragment. Masking only backtick spans
 * (not requiring a specific connector word after TRIGGER) is deliberately
 * narrow: an earlier attempt required "for"/"on"/"when"/":" immediately
 * after the word and that broke real markers phrased differently ("DO NOT
 * TRIGGER directly at the ops phase..., for the other runbook classes..." —
 * ops-incident/ops-maintenance/ops-monitoring — measured: masking backticks
 * nets fewer failures than requiring a connector).
 */
function maskBacktickSpans(s: string): string {
  return s.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
}

/**
 * Split a `description:` string into its TRIGGER clause and DO NOT TRIGGER
 * clause. Case-insensitive; finds the first "TRIGGER" occurrence that is NOT
 * part of "DO NOT TRIGGER" and NOT inside a backtick span (see
 * maskBacktickSpans), and the first "DO NOT TRIGGER" occurrence outside a
 * backtick span. Returns "" for either clause when not present in the
 * description (a malformed/missing clause — surfaced by the runner as zero
 * keywords, never thrown).
 */
export function splitTriggerClauses(description: string): { triggerText: string; doNotTriggerText: string } {
  if (!description) return { triggerText: "", doNotTriggerText: "" };

  const masked = maskBacktickSpans(description);

  const doNotMatch = /DO NOT TRIGGER/i.exec(masked);
  const doNotStart = doNotMatch ? doNotMatch.index : -1;

  let triggerStart = -1;
  const triggerRe = /TRIGGER/gi;
  let m: RegExpExecArray | null;
  while ((m = triggerRe.exec(masked))) {
    const preceding = masked.slice(Math.max(0, m.index - 8), m.index);
    if (!/DO NOT\s*$/i.test(preceding)) {
      triggerStart = m.index;
      break;
    }
  }

  // Slice from the ORIGINAL (unmasked) description — indices are identical
  // since masking preserves length.
  let triggerText = "";
  if (triggerStart >= 0) {
    const end = doNotStart >= 0 && doNotStart > triggerStart ? doNotStart : description.length;
    triggerText = description.slice(triggerStart, end);
  }

  const doNotTriggerText = doNotStart >= 0 ? description.slice(doNotStart) : "";

  return { triggerText, doNotTriggerText };
}

// ── Tokenization ─────────────────────────────────────────────────────────────

/**
 * TWO widely-used placeholder conventions across this repo's descriptions,
 * both meaning "any object noun substitutes here", neither of which a real
 * prompt ever contains literally:
 *   1. A trailing standalone `X` — "let's plan X", "add observability for X".
 *   2. An angle-bracket token, anywhere in the phrase — "create a new skill
 *      for <capability>", "prepare the brief for <role>".
 * Left as-is, the phrase only matches a prompt containing that literal
 * marker text, which never happens. This truncates the phrase at the FIRST
 * placeholder marker (angle-bracket, checked first since it can appear
 * mid-phrase; trailing bare "X" checked second) so the phrase becomes a
 * PREFIX match — a real prompt substituting the object still contains that
 * prefix. Only a WORD-BOUNDARY-anchored trailing "x" is stripped (never a
 * word ending in "x" like "box"/"fix"/"matrix").
 */
function stripTrailingPlaceholder(phrase: string): string {
  const angleIdx = phrase.indexOf("<");
  const truncated = angleIdx >= 0 ? phrase.slice(0, angleIdx) : phrase;
  return truncated.replace(/\s+x$/i, "").trim();
}

function extractQuotedPhrases(clause: string): string[] {
  const phrases: string[] = [];
  const re = /"([^"]{2,})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clause))) phrases.push(stripTrailingPlaceholder(m[1].toLowerCase()));
  // A placeholder truncated down to a near-empty prefix is too loose a
  // matcher (would match almost any prompt) — require ≥4 chars post-truncation.
  return phrases.filter((p) => p.length >= 4);
}

/**
 * Tokenize into raw significant words: length ≥3, alphabetic-with-hyphens,
 * static-stopword-filtered.
 *
 * NOTE: an earlier revision of this function stripped parenthetical asides
 * `(...)` first, on the theory that this codebase's DO NOT TRIGGER convention
 * cross-references a sibling skill by name in parens (e.g. learn-diff's "the
 * deep graph (guild:learn-graph)"), and that sibling's vocabulary shouldn't
 * block the excluding skill's own overlapping domain terms. That fix reduced
 * cross-tier failures but INCREASED same-skill should_not_trigger failures by
 * more (measured: 252 → 255 total failures) — parenthetical asides are, more
 * often in this corpus, exactly where the precise disambiguating detail lives
 * (e.g. backend's "(architect — backend implements after architect's
 * contract sketch)" — "architect" there is a genuinely load-bearing negative
 * signal). Net negative; reverted. Left as a documented non-fix so a future
 * pass doesn't re-attempt it without the measurement.
 */
function tokenize(clause: string): string[] {
  return clause
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w));
}

/**
 * Bare significant words, deliberately scanning the WHOLE clause including the
 * text inside quoted example phrases — NOT just the text outside them. A real
 * prompt commonly paraphrases a quoted example ("what are Guild's operating
 * principles?" vs the quoted "what are Guild's principles") in a way that
 * breaks an exact-substring phrase match but still shares the load-bearing
 * word ("principles"); keeping quoted-phrase words in the keyword pool too is
 * what catches that paraphrase.
 *
 * `corpusStopwords` (see buildCorpusStopwords) is OPTIONAL and filters out
 * words so common across the whole description corpus that they carry no
 * discriminating signal (see file header) — pass an empty set to disable.
 */
function extractKeywords(clause: string, corpusStopwords: ReadonlySet<string>): string[] {
  const words = tokenize(clause).filter((w) => !corpusStopwords.has(w));
  return Array.from(new Set(words));
}

/**
 * Compute the set of words that appear in more than `docFreqThreshold`
 * (default 0.2 = 20%) of the given description corpus — words this common
 * carry no discriminating signal (every description mentions "Guild",
 * "specialist", etc. incidentally) and must not become blocking DO-NOT-
 * TRIGGER keywords or trivially-true TRIGGER keywords for every skill.
 *
 * Pure: counts each word once per document (not per occurrence).
 */
export function buildCorpusStopwords(descriptions: string[], docFreqThreshold = 0.35): Set<string> {
  const docCount = descriptions.length;
  if (docCount === 0) return new Set();
  const df = new Map<string, number>();
  for (const desc of descriptions) {
    const seen = new Set(tokenize(desc));
    for (const w of seen) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [w, count] of df) {
    if (count / docCount > docFreqThreshold) out.add(w);
  }
  return out;
}

/**
 * Parse a `description:` string into its trigger/do-not-trigger phrase +
 * keyword sets. `corpusStopwords` (from buildCorpusStopwords, computed once
 * over the WHOLE description corpus) filters keyword extraction on BOTH
 * sides — quoted phrases are never frequency-filtered. Omit for a
 * corpus-free call (keyword extraction then only applies the static
 * STOPWORDS list — used by unit tests against a single synthetic
 * description).
 *
 * SELF-OVERLAP RESOLUTION: the exact same word legitimately appears in BOTH a
 * description's own TRIGGER and DO NOT TRIGGER clauses for reasons unrelated
 * to being a deliberate blocking term — e.g. guild-principles' TRIGGER clause
 * quotes "what are Guild's principles" while its DO NOT TRIGGER clause
 * explains an exception where "a principles review is overkill"; "principles"
 * is a bare keyword in both. Since wouldTrigger() makes DO NOT TRIGGER an
 * absolute veto, an unresolved overlap would mean THIS skill's own TRIGGER
 * examples can never fire it. Any word appearing in both keyword sets is
 * removed from doNotTriggerKeywords (kept in triggerKeywords) — within one
 * description, ambiguous self-overlap resolves in favor of the author's
 * explicit TRIGGER intent, not the incidental DO NOT TRIGGER mention.
 */
export function parseDescription(
  description: string,
  corpusStopwords: ReadonlySet<string> = new Set(),
): ParsedTrigger {
  const { triggerText, doNotTriggerText } = splitTriggerClauses(description);
  const triggerKeywords = extractKeywords(triggerText, corpusStopwords);
  const triggerKeywordSet = new Set(triggerKeywords);
  const doNotTriggerKeywords = extractKeywords(doNotTriggerText, corpusStopwords).filter(
    (w) => !triggerKeywordSet.has(w),
  );
  return {
    triggerPhrases: extractQuotedPhrases(triggerText),
    triggerKeywords,
    doNotTriggerPhrases: extractQuotedPhrases(doNotTriggerText),
    doNotTriggerKeywords,
  };
}

// ── Matching ──────────────────────────────────────────────────────────────────

/**
 * Would this parsed description's owner trigger on `prompt`?
 * DO NOT TRIGGER phrase/keyword hits short-circuit to false (mirrors
 * shadow-mode.ts's wouldTrigger — a DO NOT TRIGGER signal always wins).
 */
export function wouldTrigger(prompt: string, parsed: ParsedTrigger): boolean {
  const lower = prompt.toLowerCase();
  for (const p of parsed.doNotTriggerPhrases) if (lower.includes(p)) return false;
  for (const k of parsed.doNotTriggerKeywords) if (lower.includes(k)) return false;
  for (const p of parsed.triggerPhrases) if (lower.includes(p)) return true;
  for (const k of parsed.triggerKeywords) if (lower.includes(k)) return true;
  return false;
}

/**
 * d5-permission-content.ts — the D5 content classifier (permissions are proposal-only).
 *
 * D5 is a CONTENT class, not a target token (codex G-lane r1 #1). It lives in the
 * security domain because every automatic writer of a prompt-loaded file must call it:
 * the evolve writer (`evolve-apply`), its rollback (`compact-history`), and the
 * knowledge-domain harvest span-replace. The evolve domain re-exports it unchanged.
 */

/**
 * Heading words that make a heading a permissions block. Matched case-insensitively
 * on the span's OWN heading AND on every heading NESTED inside either side of the
 * delta.
 *
 * Two rounds of review moved this rule outward twice. The target token was never the
 * right question (r1 #1): a `--target=playbook --auto` delta rewriting a playbook's
 * `## Permissions` heading is a permission edit that happens to live in a playbook.
 * Neither was the span's TOP heading (r2 #1): a span called `## Rule` that contains
 * `### Permissions` / `Shell execution: blocked.` is the same edit one level down, and
 * reading only the outer heading waved it straight through.
 */
const PERMISSION_HEADING_RE =
  /(^|[^a-z0-9])(permissions?|approval|approvals|allowed[- ]tools|allowlist|denylist|allow|deny)([^a-z0-9]|$)/i;

/** Frontmatter keys that declare permissions. Present on either side ⇒ D5. */
const PERMISSION_KEY_RE = /^[ \t]*(permissions?|allowed[-_]tools|allow|deny|tools)[ \t]*:/im;

/**
 * A permission NOUN. Bare modality is not a signal — `without` on its own matched
 * "Return a response without a stack trace" and classified an error-handling span as
 * permissions (r2 #3). A sentence has to be ABOUT permission before its modality
 * means anything.
 *
 * `block` is the one word here that is ordinary English elsewhere, so it is excluded
 * when used intransitively (`block on <something>`): "the build must not block on
 * lint" is a CI statement, not a permission grant.
 */
const PERMISSION_NOUN_RE =
  /\boperator[ \t]+clicks?\b|\b(approvals?|approved?|approve|permissions?|permit(?:s|ted)?|allowed[- ]tools|allowlist|denylist|allow(?:s|ed|ing)?|den(?:y|ies|ied)|gate(?:s|d)?|confirm(?:s|ed|ation)?|consent|authoriz(?:e|es|ed|ation)|forbidden|prohibited|sandbox(?:ed|ing)?|privileges?)\b|\bblock(?:s|ed|ing)?\b(?![ \t]+on\b)/i;

/** Modality that asserts or removes a requirement. Only meaningful beside a noun. */
const MODALITY_RE =
  /\b(must|never|always|shall|should|require[sd]?|need(?:s|ed)?|no|without|skip(?:s|ping)?|bypass(?:es|ing|ed)?|auto[- ]?approve[d]?|unattended|do not|don't|cannot|can't|refuse[sd]?)\b/i;

/**
 * A bare permission STATE declaration — `Shell execution: blocked.`, `Network: denied`,
 * `Writes are allowed`. No modal verb, and still exactly the sentence D5 exists to
 * protect, so it is its own signature rather than a modality case.
 *
 * Every word here is a permission state IN ITSELF. `required` used to be in this list
 * and it is not a permission state — it is generic modality, and it made "A request ID
 * is required." read as a permissions change (r3 #3). A requirement only concerns D5
 * when what is required is a permission, which is the noun+modality rule's job.
 */
const PERMISSION_STATE_RE =
  /(:[ \t]*|(?:\bis\b|\bare\b)[ \t]+)(blocked|allowed|denied|permitted|forbidden|prohibited|auto[- ]?approved|unrestricted|sandboxed)\b/i;

export type PermissionContentReason =
  | "heading"
  | "nested_heading"
  | "frontmatter_key"
  | "approval_language";

export interface PermissionContentVerdict {
  /** True ⇒ proposal-only on EVERY target, auto or not. */
  isPermissionEdit: boolean;
  reason?: PermissionContentReason;
  detail?: string;
}

/**
 * Tokens that end in a period without ending a sentence. A split after one of
 * these separated `approval` from `required` in "Operator approval from Dr. Smith
 * is required" and let the replacement through (r5 #2). The list is closed and
 * lower-cased for the comparison; a period followed by a LOWER-case word is
 * likewise not a sentence end (authored sentences start upper-case or with a
 * digit/quote/symbol).
 */
const NON_TERMINAL_ABBREVIATIONS: ReadonlySet<string> = new Set([
  "dr.", "mr.", "mrs.", "ms.", "prof.", "sr.", "jr.", "st.", "vs.", "etc.", "e.g.", "i.e.",
  "cf.", "no.", "fig.", "approx.", "dept.", "inc.", "ltd.", "co.", "u.s.", "u.k.", "a.m.", "p.m.",
]);

/** Split one unwrapped block into sentences without breaking at abbreviations. */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  const words = text.split(/[ \t]+/);
  let current: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    current.push(w);
    if (!/[.!?]["')\]]*$/.test(w)) continue;
    const next = words[i + 1];
    if (next === undefined) break;
    const bare = w.replace(/^["'(\[]+/, "").replace(/["')\]]+$/, "").toLowerCase();
    if (NON_TERMINAL_ABBREVIATIONS.has(bare)) continue;
    // A single capital letter with a period is an initial ("J. Smith").
    if (/^[A-Z]\.$/.test(w)) continue;
    // The next word starts lower-case: not a new sentence.
    if (/^[a-z]/.test(next)) continue;
    out.push(current.join(" "));
    current = [];
  }
  if (current.length > 0) out.push(current.join(" "));
  return out;
}

/**
 * Split markdown into SENTENCE units for the noun+modality test.
 *
 * The first cut split on every newline, so a soft-wrapped sentence —
 *
 *     Always require
 *     operator approval before shell execution.
 *
 * — was two units, neither of which had both a noun and modality, and the delta
 * applied under `auto:true` (r3 #1). Markdown wraps prose wherever the author's editor
 * happened to wrap it, so a line is not a unit of meaning.
 *
 * The rule:
 *
 *   1. group lines into BLOCKS. A blank line, a heading, a list marker, a table row,
 *      or a fence delimiter starts a new block, because each of those is its own
 *      thought and joining across them would invent sentences nobody wrote;
 *   2. join the lines inside a paragraph block with a space (unwrapping the author's
 *      soft breaks);
 *   3. split each block on sentence terminators.
 *
 * A list item is its own unit. A table row is emitted BOTH whole and per cell, because
 * `| approval | required |` carries its noun and its modality in different cells and
 * neither cell alone says anything.
 *
 * Fenced code is skipped: a code block is not prose and its contents are not claims.
 */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const unit of blockUnits(text)) out.push(...unit.sentences);
  return out;
}

/** One prose block: the whole unwrapped block plus its sentences. */
export interface BlockUnit {
  /** The block joined into one line (list marker / heading marks stripped). */
  whole: string;
  /** The block split into sentences (table rows: the row then each cell). */
  sentences: string[];
  /** True when the block came from inside a code fence (only with `includeFenced`). */
  fenced: boolean;
}

/**
 * The block-level view of `sentences()`. The D5 classifier reads BOTH: a noun and
 * its modality that sit in one authored block can never be separated by a
 * sentence-splitting mistake (r6: "(Dr." defeated the abbreviation list; every
 * splitter has another such case). The cost is a block that carries a permission
 * noun in one sentence and a modality in another being proposal-only — one extra
 * operator click on a heuristic that is documented as one.
 */
export function blockUnits(text: string, opts: { includeFenced?: boolean } = {}): BlockUnit[] {
  const lines = text.split("\n");
  const blocks: Array<{ lines: string[]; fenced: boolean }> = [];
  let current: string[] = [];
  let fencedLines: string[] = [];
  // The OPENING fence delimiter, or null outside a fence. CommonMark closes a
  // fence only with the same character run at least as long as the opener; a
  // `~~~` line inside a backtick fence is content, not a close. Toggling on
  // either marker skipped every prose line after such an example (r4 #2).
  let fence: string | null = null;

  const flush = () => {
    if (current.length > 0) blocks.push({ lines: current, fenced: false });
    current = [];
  };
  // Fenced text is NOT prose for `sentences()`, but the D5 classifier reads it
  // anyway (`includeFenced`): every fence-parsing rule has a case where a line that
  // looks like a delimiter is inline code (r7: "```Operator approval``` is required"),
  // and the only way markdown structure can never HIDE a permission sentence is to
  // classify what the parser would have skipped. The cost is a code example that
  // mentions approval being proposal-only — one operator click.
  const flushFenced = () => {
    if (fencedLines.length > 0 && opts.includeFenced) blocks.push({ lines: fencedLines, fenced: true });
    fencedLines = [];
  };

  for (const line of lines) {
    const fenceMatch = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const rest = fenceMatch[2];
      if (fence === null) {
        // An opener may carry an info string (```text). It opens a fence. An
        // info string containing a backtick is not an opener at all (CommonMark
        // §4.5): "```Operator approval``` is required" is inline code in a
        // paragraph and stays prose.
        if (marker[0] === "`" && rest.includes("`")) {
          current.push(line);
          continue;
        }
        flush();
        fence = marker;
        continue;
      }
      // A CLOSER carries nothing but whitespace after the run (CommonMark §4.5);
      // "```example" inside an open backtick fence is content, not a close
      // (r5 #1: treating it as a close made the real closer re-open the fence).
      if (marker[0] === fence[0] && marker.length >= fence.length && rest.trim() === "") {
        fence = null;
        flushFenced();
        continue;
      }
      fencedLines.push(line);
      continue;
    }
    if (fence !== null) {
      fencedLines.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    const isHeading = /^[ \t]*#{1,6}[ \t]+/.test(line);
    const isListItem = /^[ \t]*([-*+]|\d+[.)])[ \t]+/.test(line);
    const isTableRow = /^[ \t]*\|/.test(line);
    if (isHeading || isTableRow) {
      flush();
      blocks.push({ lines: [line], fenced: false });
      continue;
    }
    if (isListItem) {
      // A list item OPENS a block: its wrapped continuation lines belong to the
      // same item until a blank line or the next marker (r4 #1).
      flush();
      current.push(line);
      continue;
    }
    current.push(line);
  }
  flush();
  // An unterminated fence still holds text the classifier must see.
  flushFenced();

  const out: BlockUnit[] = [];
  for (const { lines: block, fenced } of blocks) {
    if (fenced) {
      const whole = block.map((l) => l.trim()).filter((l) => l !== "").join(" ");
      if (whole !== "") out.push({ whole, sentences: splitSentences(whole).map((t) => t.trim()).filter((t) => t !== ""), fenced: true });
      continue;
    }
    const first = block[0];
    if (/^[ \t]*\|/.test(first)) {
      // A table row: the whole row, then each cell. A separator row (`|---|---|`)
      // carries no prose and is dropped.
      const cells = first
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c !== "");
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      out.push({ whole: cells.join(" "), sentences: [cells.join(" "), ...cells], fenced: false });
      continue;
    }
    // Strip the list marker so the item reads as a sentence.
    const joined = block
      .map((l) => l.trim())
      .join(" ")
      .replace(/^[ \t]*([-*+]|\d+[.)])[ \t]+/, "")
      .replace(/^[ \t]*#{1,6}[ \t]+/, "")
      .trim();
    const pieces: string[] = [];
    for (const piece of splitSentences(joined)) {
      const t = piece.trim();
      if (t !== "") pieces.push(t);
    }
    if (joined !== "") out.push({ whole: joined, sentences: pieces, fenced: false });
  }
  return out;
}

/** Every markdown heading TEXT inside a block, at any level. */
function headingsIn(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Is this sentence ABOUT a permission, and does it assert or remove one?
 *
 * Both halves are required, in the SAME sentence. The noun alone is a description
 * ("the approval lives in settings"); the modality alone is any English sentence, and
 * `must` / `required` / `never` on their own turned "A request ID is required." into a
 * permissions change (r3 #3).
 */
export function isPermissionSentence(sentence: string): boolean {
  // Markdown emphasis and code marks are not word characters to the author but
  // `_` is one to `\b`: "_required_" and "`approval`" slipped every tier (r8).
  // Strip them to spaces before matching, so the vocabulary is matched on words.
  const plain = sentence.replace(/[_*~`]+/g, " ");
  if (PERMISSION_STATE_RE.test(plain)) return true;
  return PERMISSION_NOUN_RE.test(plain) && MODALITY_RE.test(plain);
}

/**
 * Classify a delta by its CONTENT, not its target token (D5).
 *
 * Four independent signatures over the WHOLE span — the outer heading, any nested
 * heading, a frontmatter permission key, and a permission sentence — on BOTH the
 * current and the proposed bytes. Any one is enough.
 *
 * Deliberately over-inclusive on the permission side and deliberately narrow on
 * modality: a false positive costs one operator click on a candidate, a false negative
 * is an unattended run widening its own permissions, and a classifier that fires on
 * the bare word "without" is one nobody can leave switched on.
 *
 * It is a HEURISTIC, not a parser. A permissions change phrased without any of these
 * shapes will pass it; the receipt records that limit.
 */
export function classifyPermissionContent(input: {
  span?: string;
  beforeSpan?: string;
  replacement?: string;
}): PermissionContentVerdict {
  const span = input.span ?? "";
  const before = input.beforeSpan ?? "";
  const after = input.replacement ?? "";

  if (PERMISSION_HEADING_RE.test(span)) {
    return {
      isPermissionEdit: true,
      reason: "heading",
      detail: `the span '${span}' names a permissions/approval block`,
    };
  }

  for (const [side, text] of [["current", before], ["proposed", after]] as const) {
    // NESTED headings, at any level, anywhere in the span (r2 #1).
    for (const heading of headingsIn(text)) {
      if (PERMISSION_HEADING_RE.test(heading)) {
        return {
          isPermissionEdit: true,
          reason: "nested_heading",
          detail: `the ${side} span contains a nested '${heading}' permissions block`,
        };
      }
    }
    if (PERMISSION_KEY_RE.test(text)) {
      return {
        isPermissionEdit: true,
        reason: "frontmatter_key",
        detail: `the ${side} text declares a permissions key`,
      };
    }
  }

  // "Changes an approval requirement": a permission sentence on either side, and the
  // two sides differ. Identical sides are not an edit.
  if (before.trim() !== after.trim()) {
    for (const [side, text] of [["current", before], ["proposed", after]] as const) {
      // Sentences first (the precise unit), then each WHOLE block, then the whole
      // span collapsed to one line. Fenced text is included. The three tiers are
      // deliberately redundant: a noun and a modality that sit ANYWHERE in the
      // span make the delta proposal-only, whatever the tokenizer made of the
      // markdown between them (rounds 3–7 each found one more structure case;
      // this closes the class at the price of an operator click on a false hit).
      const units = blockUnits(text, { includeFenced: true });
      const hit =
        units.flatMap((u) => u.sentences).find(isPermissionSentence) ??
        units.map((u) => u.whole).find(isPermissionSentence) ??
        [text.replace(/\s+/g, " ").trim()].find((t) => t !== "" && isPermissionSentence(t));
      if (hit) {
        return {
          isPermissionEdit: true,
          reason: "approval_language",
          detail: `the ${side} span changes what is allowed or requires approval ("${hit.slice(0, 60)}")`,
        };
      }
    }
  }
  return { isPermissionEdit: false };
}

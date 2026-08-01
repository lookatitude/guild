// v1.4.0 adversarial-loops — JSONL log redaction.
//
// Implements the 5-pattern redaction policy from
// `guild-benchmark/plans/v1.4-jsonl-schema.md` §"Redaction policy". Distinct
// from the argv-only redaction in `guild-benchmark/src/runner.ts §178-189`
// (which is scoped to subprocess argv): this module redacts free-text
// fields written into JSONL events (`command_redacted`,
// `result_excerpt_redacted`, `payload_excerpt_redacted`,
// `prompt_excerpt`, `assumption_text`).
//
// Pattern groups, applied in order:
//   1. Token-shape regex — REUSES the literal regex set from runner.ts
//      §178-189 (OAuth/JWT/PAT/AWS/Slack token shapes). Imported below.
//   2. Home-dir absolute paths under sensitive dirs — `.claude`, `.codex`,
//      `.ssh`, `.aws`, `.gnupg`. Replace path suffix with `[REDACTED]`,
//      keep the directory prefix for context.
//   3. Key=value secrets — case-insensitive keys
//      (password|token|api[_-]?key|secret|authorization|bearer)
//      followed by `:` or `=` and a value; replace value with
//      `[REDACTED]`.
//   4. High-entropy strings — base64-like or hex-like sequences ≥ 20
//      chars NOT whitelisted (commit hashes when context says git;
//      run-id strings prefixed `run-`).
//   5. Length truncation — after 1-4 run, any field still > 4 KiB is
//      truncated to exactly 4 KiB and suffixed with `... [TRUNCATED]`.
//
// The architect's contract is explicit that token-shape regex is REUSED
// (do NOT reinvent). The runner's `REDACTION_PATTERNS` is private to
// runner.ts — we keep that surface alone (runner is shipping code) and
// re-declare the same literal regex set here, with a unit test that
// pins the source strings match.

/** Sentinel for token-shape redactions (group 1). */
export const TOKEN_REDACTED = "[REDACTED_TOKEN]";

/** Sentinel for home-dir path suffixes (group 2). */
export const PATH_REDACTED = "[REDACTED]";

/** Sentinel for key=value secrets (group 3). */
export const KV_REDACTED = "[REDACTED]";

/** Sentinel for high-entropy strings (group 4). */
export const HIGH_ENTROPY_REDACTED = "<HIGH_ENTROPY_REDACTED>";

/** Truncation suffix (group 5). */
export const TRUNCATION_SUFFIX = "... [TRUNCATED]";

/** Field-size cap from schema doc §"Encoding rules" #6. */
export const FIELD_SIZE_CAP_BYTES = 4 * 1024; // 4 KiB

// ──────────────────────────────────────────────────────────────────────────
// Group 1 — token-shape regex. REUSED literal regex set from
// `guild-benchmark/src/runner.ts §178-189`. The runner keeps that array
// private; we replicate the literals here. A unit test in
// `redact-log.test.ts` pins the source strings against the runner's
// list so any drift surfaces immediately.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Token-shape patterns. Order matters (most specific first). Every
 * pattern uses `g` flag for global replacement within a single field.
 *
 * Verbatim re-declaration of `runner.ts §178-189`'s REDACTION_PATTERNS
 * list. The schema doc §"Redaction policy" #1 names the prefix list
 * (sk-, eyJ, Bearer, ghp_, etc.) — this is the canonical implementation.
 */
/**
 * DEEP-FROZEN — array AND every RegExp element.
 *
 * CORRECTION (adversarial review, #18). I first left the elements mutable, reasoning
 * that `.exec()`/`.test()` on a frozen `/g` RegExp throws when it writes `lastIndex`.
 * That hazard is real IN GENERAL but does NOT apply here, and I verified the wrong
 * thing: `redactTokenShapes` builds `new RegExp(re.source, re.flags)` — a FRESH CLONE
 * per use — so the frozen original's `lastIndex` is never written. The comment two
 * functions below says exactly that, and I read past it.
 *
 * Leaving the elements extensible was therefore not a justified exception, it was a
 * hole in a security control. Reproduced against the shipped code: with the array
 * frozen, redefining one element's `source` to `(?!)` turned
 * `redactTokenShapes("sk-AAAA…")` from "[REDACTED_TOKEN]" back into the raw secret.
 * Freezing the array alone stops a pattern being ADDED or REMOVED; it does nothing
 * about a pattern being NEUTERED in place.
 */
export const TOKEN_SHAPE_PATTERNS: readonly RegExp[] = Object.freeze([
  Object.freeze(/Authorization:\s*Bearer\s+[A-Za-z0-9._\-+/=]+/g),
  Object.freeze(/\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/g),
  Object.freeze(/\bsk-(ant-)?[A-Za-z0-9_-]{20,}/g),
  Object.freeze(/\bghp_[A-Za-z0-9]{36}\b/g),
  Object.freeze(/\bgh[suor]_[A-Za-z0-9]{36}\b/g),
  Object.freeze(/\bgithub_pat_[A-Za-z0-9_]{82}\b/g),
  Object.freeze(/\bxox[bp]-[A-Za-z0-9-]{10,}/g),
  Object.freeze(/\bAKIA[0-9A-Z]{16}\b/g),
  Object.freeze(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g),
] as const);

/** Apply group 1 — token-shape redaction. */
export function redactTokenShapes(input: string): string {
  let out = input;
  for (const re of TOKEN_SHAPE_PATTERNS) {
    // RegExp objects are stateful via `lastIndex` when `g` is set; passing
    // a fresh instance per replace avoids surprises across multiple fields.
    out = out.replace(new RegExp(re.source, re.flags), TOKEN_REDACTED);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Group 2 — home-dir absolute paths under sensitive directories.
// Schema doc §"Redaction policy" #2:
//   (~|/Users/[^/]+|/home/[^/]+)/(\.claude|\.codex|\.ssh|\.aws|\.gnupg)/[^\s'"]*
// → keep prefix `<HOME>/.<dir>` and replace suffix with `[REDACTED]`.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Sensitive directory names matched as path components. The leading dot
 * is mandatory; e.g., `.claude` matches but `claude` does not.
 */
export const SENSITIVE_HOME_DIRS = Object.freeze([
  ".claude",
  ".codex",
  ".ssh",
  ".aws",
  ".gnupg",
] as const);

/**
 * Home-dir match regex. Captures:
 *   group 1 = home-dir root (`~`, `/Users/<u>`, `/home/<u>`)
 *   group 2 = sensitive subdir (`.claude` etc.)
 *   group 3 = remainder (path tail, file name)
 */
export const HOME_DIR_PATTERN =
  /(~|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/(\.claude|\.codex|\.ssh|\.aws|\.gnupg)\/[^\s'"]+/g;

/** Apply group 2 — home-dir path redaction. */
export function redactHomeDirPaths(input: string): string {
  return input.replace(HOME_DIR_PATTERN, (_match, root: string, dir: string) => {
    return `${root}/${dir}/${PATH_REDACTED}`;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Group 3 — key=value secrets.
// Schema doc §"Redaction policy" #3:
//   (password|token|api[_-]?key|secret|authorization|bearer)
//   \s*[:=]\s*\S+
// → replace VALUE side with `[REDACTED]`, preserving the key name.
// Case-insensitive.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Key=value secret pattern. Captures:
 *   group 1 = key name (preserved in output)
 *   group 2 = separator (`:` or `=`, optional surrounding whitespace)
 *   group 3 = value (replaced with `[REDACTED]`)
 *
 * The key list matches the schema-doc spec verbatim. `api[_-]?key`
 * accepts `api_key`, `api-key`, `apikey`. Case-insensitive.
 */
export const KV_SECRET_PATTERN =
  /\b(password|token|api[_-]?key|secret|authorization|bearer)(\s*[:=]\s*)(\S+)/gi;

/** Apply group 3 — key=value secret redaction. */
export function redactKeyValueSecrets(input: string): string {
  return input.replace(
    KV_SECRET_PATTERN,
    (_match, key: string, sep: string) => `${key}${sep}${KV_REDACTED}`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Group 4 — high-entropy strings.
// Schema doc §"Redaction policy" #4:
//   - base64-like /[A-Za-z0-9+/=]{20,}/
//   - hex-like    /[0-9a-fA-F]{20,}/
//   - whitelist:  SHA-1/SHA-256-shaped commit hashes when context indicates
//                 git, run-id strings prefixed `run-`.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Repo-relative path exemption for group 4.
 *
 * Ordinary source paths (`scripts/learn/extract-structural.ts`) contain
 * ≥20-char `[A-Za-z0-9/]` runs once `-`/`.` split the tail off the match,
 * so the entropy pattern fires on the prefix and mangles the path
 * (`<HIGH_ENTROPY_REDACTED>-structural.ts`). Repo-relative paths are the
 * provenance vocabulary of wiki/handoff frontmatter (`source_refs:`) — they
 * must survive the scrub.
 *
 * A candidate is exempt when the token around the match — expanded over the
 * path charset `[A-Za-z0-9._/-]`, capped at MAX_PATH_TOKEN_LEN per side so a
 * crafted multi-KB token can't make every match rescan the whole document —
 * is shaped like a relative path:
 *   - candidate itself carries no `+`/`=` (base64 markers);
 *   - token starts with a word char (absolute `/…` and `~/…` paths keep
 *     their existing treatment), optionally after `./` or `../`;
 *   - token has ≥2 `/` segments, or 1 segment plus a short file extension;
 *   - every `[/._-]`-delimited word is "wordish": under the 20-char entropy
 *     threshold AND human-word-shaped (lowercase-dominant, few digits, or a
 *     short ALLCAPS word like SKILL/README). Random base64/hex chunks are
 *     case-and-digit mixed, so a secret split into short path segments
 *     (`cache/Zm9vYmFy…/MTIzNDU2….bin`) still fails the exemption and gets
 *     redacted. Residual gap: an all-lowercase, digit-light random chunk can
 *     pass — accepted, consistent with the existing bare-hex 40/64 carve-out.
 */
const PATH_TOKEN_CHAR = /[A-Za-z0-9._/-]/;
const PATH_SHAPE =
  /^(?:\.{1,2}\/)?[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;
const PATH_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
/** Longest plausible real path token; longer expansions bail to "redact". */
const MAX_PATH_TOKEN_LEN = 512;

/**
 * Human-word shape check over ALL `[/._-]`-delimited path segment words.
 *
 * Aggregate rule for no-lowercase words (ALLCAPS / digit-only): 1–2 chars
 * are free (version components: `v2` splits to `2`, dates `01`), 3–8 chars
 * are allowed AT MOST ONCE per token (README, SKILL, 2022) — so a secret
 * chunked into several short ALLCAPS/digit segments
 * (`cache/ABCDEFGH/IJKLMNOP/QRSTUVWX.bin`) fails and stays redacted.
 */
function allWordsWordish(words: string[]): boolean {
  let opaqueBudget = 1;
  for (const word of words) {
    if (word.length === 0 || word.length >= 20) return false;
    let upper = 0;
    let lower = 0;
    let digits = 0;
    for (const ch of word) {
      if (ch >= "a" && ch <= "z") lower++;
      else if (ch >= "A" && ch <= "Z") upper++;
      else digits++;
    }
    if (lower === 0) {
      // ALLCAPS / digit-only word: short initialisms only, one per token.
      if (word.length > 8) return false;
      if (word.length > 2 && --opaqueBudget < 0) return false;
    } else if (upper > 3 || digits > 4) {
      // Mixed-case word: tolerate PascalCase/camelCase, reject base64-ish.
      return false;
    }
  }
  return true;
}

export function isRelativePathToken(
  candidate: string,
  fullInput: string,
  matchIndex: number,
): boolean {
  if (candidate.includes("+") || candidate.includes("=")) return false;
  let start = matchIndex;
  const startFloor = Math.max(0, matchIndex - MAX_PATH_TOKEN_LEN);
  while (start > startFloor && PATH_TOKEN_CHAR.test(fullInput[start - 1])) start--;
  if (start === startFloor && start > 0 && PATH_TOKEN_CHAR.test(fullInput[start - 1])) {
    return false; // token keeps going past the cap — not a plausible path
  }
  let end = matchIndex + candidate.length;
  const endCeil = Math.min(fullInput.length, end + MAX_PATH_TOKEN_LEN);
  while (end < endCeil && PATH_TOKEN_CHAR.test(fullInput[end])) end++;
  if (end === endCeil && end < fullInput.length && PATH_TOKEN_CHAR.test(fullInput[end])) {
    return false;
  }
  const token = fullInput.slice(start, end);
  if (token.length > MAX_PATH_TOKEN_LEN) return false;
  if (!PATH_SHAPE.test(token)) return false;
  const slashCount = token.split("/").length - 1;
  if (slashCount < 2 && !PATH_EXTENSION.test(token)) return false;
  return allWordsWordish(token.split(/[/._-]+/).filter(Boolean));
}

/**
 * Whitelist predicates — return true if the candidate string should NOT
 * be redacted.
 *
 * Implementation: we apply the whitelist at the match site (per-occurrence)
 * because the surrounding context (`run-` prefix, `commit ` prefix, `sha=`)
 * lives outside the candidate but inside the input string.
 */
export function isWhitelistedHighEntropy(
  candidate: string,
  fullInput: string,
  matchIndex: number,
): boolean {
  // run-id prefix: the candidate sits immediately after `run-` in the
  // input. Schema doc allows run-id strings prefixed `run-`.
  if (matchIndex >= 4 && fullInput.slice(matchIndex - 4, matchIndex) === "run-") {
    return true;
  }
  // git commit context: `commit <sha>`, `sha:`, `sha=`, `tree <sha>`,
  // `parent <sha>` are common shapes. Look back for a git-shaped keyword
  // within the previous ~16 chars.
  const lookBackStart = Math.max(0, matchIndex - 16);
  const before = fullInput.slice(lookBackStart, matchIndex).toLowerCase();
  if (
    /\b(commit|sha|tree|parent|head|merge|object|branch)\s*[:=]?\s*$/.test(before)
  ) {
    return true;
  }
  // SHA-1 (40 hex) and SHA-256 (64 hex) without context: we treat
  // 40/64-hex as ambiguous and pass through. This matches the schema
  // doc's "SHA-1/SHA-256-shaped commit hashes" carve-out for the
  // common case of bare hashes in test names / file lists.
  if (/^[0-9a-f]{40}$/.test(candidate) || /^[0-9a-f]{64}$/.test(candidate)) {
    return true;
  }
  // Repo-relative path token: ordinary source paths are provenance metadata
  // (wiki source_refs, handoff file lists) — never secrets by shape alone.
  if (isRelativePathToken(candidate, fullInput, matchIndex)) {
    return true;
  }
  return false;
}

/** High-entropy candidate detector. Combines hex and base64 shapes. */
export const HIGH_ENTROPY_PATTERN = /[A-Za-z0-9+/=]{20,}/g;

/** Apply group 4 — high-entropy redaction with whitelist. */
export function redactHighEntropy(input: string): string {
  return input.replace(HIGH_ENTROPY_PATTERN, (match, offset: number) => {
    if (isWhitelistedHighEntropy(match, input, offset)) {
      return match;
    }
    return HIGH_ENTROPY_REDACTED;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Group 5 — length truncation. Applied AFTER groups 1-4 per schema doc
// §"Encoding rules" #6: "Truncation happens AFTER redaction."
// ──────────────────────────────────────────────────────────────────────────

/**
 * Truncate `input` to `cap` bytes (UTF-8) and append the truncation
 * sentinel. The cap is measured in bytes, not chars, to match the
 * schema's 4 KiB byte limit on JSONL field size.
 *
 * Returns input unchanged if it fits within the cap.
 */
export function truncateToCap(
  input: string,
  cap: number = FIELD_SIZE_CAP_BYTES,
): string {
  // Fast path — single-byte ASCII fits cap entirely.
  const byteLen = Buffer.byteLength(input, "utf8");
  if (byteLen <= cap) return input;

  // Truncate by bytes, then snap to nearest valid UTF-8 boundary by
  // round-tripping through Buffer.
  const buf = Buffer.from(input, "utf8");
  const truncated = buf.slice(0, cap).toString("utf8");
  // Strip any partial trailing surrogate (rare; UTF-8 splitting may
  // produce U+FFFD — drop trailing replacement chars just in case).
  const cleaned = truncated.replace(/\uFFFD+$/u, "");
  return cleaned + TRUNCATION_SUFFIX;
}

// ──────────────────────────────────────────────────────────────────────────
// Composite — run all 5 groups in order on a single field value.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Redact a free-text field value through all 5 pattern groups.
 * Use this for every `command_redacted`, `result_excerpt_redacted`,
 * `payload_excerpt_redacted`, `prompt_excerpt`, `assumption_text`
 * field before serializing the JSONL event.
 *
 * Order matters (architect contract): tokens → paths → kv → entropy →
 * truncation. The first four can interact (e.g., a JWT inside a
 * key=value pair must be caught by group 1 before group 4 redacts it
 * generically).
 */
export function redactField(
  input: string,
  cap: number = FIELD_SIZE_CAP_BYTES,
): string {
  if (typeof input !== "string") return input;
  let out = redactTokenShapes(input);
  out = redactHomeDirPaths(out);
  out = redactKeyValueSecrets(out);
  out = redactHighEntropy(out);
  out = truncateToCap(out, cap);
  return out;
}

/**
 * Set of JSONL field names that carry redactable free-text content.
 * Used by the JSONL writer's pre-serialize sweep.
 */
/**
 * SEALED SET (adversarial review, #18).
 *
 * `ReadonlySet<string>` is a COMPILE-TIME type. At runtime this is an ordinary `Set`
 * with a working `delete`, and `Object.freeze(set)` does NOT freeze Set membership —
 * freeze only seals own properties, while entries live in an internal slot. So the
 * freeze sweep's whole technique is inapplicable here, and the type annotation bought
 * nothing.
 *
 * Reproduced against shipped code: `REDACTABLE_FIELDS.delete("result")` made
 * `redactEventFields` return an API token VERBATIM instead of redacting it — the
 * redactor still ran, still reported success, and simply stopped covering that field.
 *
 * Sealing it means neutering the mutators on the instance, which is the only thing that
 * actually stops the attack. The frozen source array is the declaration of record.
 */
const REDACTABLE_FIELD_NAMES = Object.freeze([
  "command_redacted",
  "result_excerpt_redacted",
  "payload_excerpt_redacted",
  "prompt_excerpt",
  "assumption_text",
  "result",
] as const);

function sealSet<T>(values: readonly T[]): ReadonlySet<T> {
  const set = new Set<T>(values);
  const refuse = (op: string) => () => {
    throw new TypeError(`REDACTABLE_FIELDS is sealed: ${op} would silently narrow redaction coverage`);
  };
  for (const method of ["add", "delete", "clear"] as const) {
    Object.defineProperty(set, method, {
      value: refuse(method),
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }
  return Object.freeze(set);
}

export const REDACTABLE_FIELDS: ReadonlySet<string> = sealSet(REDACTABLE_FIELD_NAMES);

/**
 * Apply field-level redaction to every redactable string in `event`.
 * Returns a NEW object; does not mutate the input. Non-redactable fields
 * pass through unchanged. Non-string values for redactable fields pass
 * through (the schema validator will reject them downstream).
 */
export function redactEventFields<T extends Record<string, unknown>>(
  event: T,
  cap: number = FIELD_SIZE_CAP_BYTES,
): T {
  const out: Record<string, unknown> = { ...event };
  for (const [k, v] of Object.entries(out)) {
    if (REDACTABLE_FIELDS.has(k) && typeof v === "string") {
      out[k] = redactField(v, cap);
    }
  }
  return out as T;
}

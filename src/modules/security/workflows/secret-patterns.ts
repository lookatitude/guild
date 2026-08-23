/**
 * src/modules/security/workflows/secret-patterns.ts
 *
 * CANONICAL single source for `SECRET_PATTERNS` — moved here from
 * `scripts/docs-hygiene/scan.ts` (audit remediation item 16, plugin-audit-remediation
 * G5b) to fix an inverted dependency: the security-critical pattern list previously
 * lived in a self-build docs corpus scanner, and the canonical security module
 * (`scrub-redact.ts`) imported UPWARD from it. Now the security module owns the
 * patterns and `scan.ts` imports downward, matching the layering used everywhere
 * else in this codebase (scripts/ consumes src/modules/, never the reverse).
 *
 * `scan.ts` still re-exports `SECRET_PATTERNS` (unchanged import path for its own
 * existing consumers — sanitized-run-export.ts, config-render.ts) so this move is
 * a pure relocation, not a behavior or call-site change for anything outside
 * scrub-redact.ts.
 */

/**
 * DEEP-FROZEN (adversarial review, #18). A security control whose entries can be
 * REMOVED at runtime is not a control: deleting the first entry made
 * `password=abcdefgh` stop being redacted, with the scrubber still reporting success.
 * The array, every tuple, and every RegExp are frozen — an attacker must be unable to
 * add, remove, reorder, OR neuter a pattern in place.
 *
 * `readonly`/`Array<...>` typing is erased at runtime, which is exactly why this needs
 * Object.freeze rather than a type annotation.
 */
export const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  // NOTE: labels deliberately drop the `=` so the redaction replacement
  // (e.g. `<REDACTED:password-assignment>`) cannot itself re-match the pattern
  // on a subsequent scrub pass. Idempotency depends on this — every label below
  // is checked against every pattern above it, and none re-matches.
  Object.freeze([Object.freeze(/password\s*=\s*["']?[^\s"']{6,}/), "password-assignment"] as const),
  Object.freeze([Object.freeze(/api_key\s*=\s*["']?[^\s"']{6,}/i), "api_key-assignment"] as const),
  Object.freeze([Object.freeze(/secret\s*=\s*["']?[^\s"']{8,}/i), "secret-assignment"] as const),
  Object.freeze([Object.freeze(/AKIA[0-9A-Z]{16}/), "AWS access key"] as const),
  Object.freeze([Object.freeze(/AIza[0-9A-Za-z_-]{35}/), "GCP API key"] as const),
  Object.freeze([Object.freeze(/ghp_[0-9A-Za-z]{36}/), "GitHub personal access token"] as const),
  Object.freeze([Object.freeze(/ghs_[0-9A-Za-z]{36}/), "GitHub server token"] as const),
  Object.freeze([Object.freeze(/-----BEGIN (?:RSA |EC )?PRIVATE KEY/), "PEM private key block"] as const),

  // ── Provider credential / bearer-token forms (T6B-R1-B1) ─────────────────
  // Round-1 review proved the list above blind to the shapes an inspection
  // surface is most likely to echo out of a persisted artifact: an
  // `Authorization: Bearer …` header, a `sk-…` provider key, and the
  // `<something>_token = …` assignment family. A display surface that renders
  // a persisted evidence string verbatim leaked all three past the applier.
  //
  // Every pattern is anchored on the CREDENTIAL PREFIX (not on entropy) so it
  // stays specific, and each replacement label is inert against every pattern
  // in this list (no whitespace/`:`/`=` follows the trigger word in a label),
  // which is what keeps `redact` idempotent.
  Object.freeze([Object.freeze(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i), "bearer-token"] as const),
  Object.freeze([Object.freeze(/\bauthorization\s*:\s*["']?[A-Za-z0-9._~+/=-]{12,}/i), "authorization-header"] as const),
  Object.freeze([Object.freeze(/\b(?:auth|access|refresh|id|api|bearer|session)[-_]?token\s*[:=]\s*["']?[^\s"',]{8,}/i), "token-assignment"] as const),
  // OpenAI/Anthropic-style provider keys: sk-…, sk-proj-…, sk-ant-….
  Object.freeze([Object.freeze(/\bsk-[A-Za-z0-9_-]{12,}/), "provider-api-key"] as const),
  Object.freeze([Object.freeze(/\bxox[abprs]-[A-Za-z0-9-]{10,}/), "Slack token"] as const),
  Object.freeze([Object.freeze(/\bgh[uor]_[0-9A-Za-z]{36}/), "GitHub token"] as const),
  Object.freeze([Object.freeze(/\bglpat-[0-9A-Za-z_-]{20}/), "GitLab personal access token"] as const),
  Object.freeze([Object.freeze(/\bnpm_[0-9A-Za-z]{36}/), "npm token"] as const),
  Object.freeze([Object.freeze(/\bhf_[0-9A-Za-z]{34}/), "HuggingFace token"] as const),

  // ── Personally identifying forms retained by public evidence projections ─
  // Task objectives and handoff prose are operator-authored and can contain
  // direct contact details or tenant identifiers. Those artifacts are copied
  // into migration evidence, so the share scrubber must recognize them before
  // publication. Keep the patterns prefix-shaped and their labels inert so the
  // redaction remains deterministic and idempotent.
  Object.freeze([Object.freeze(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i), "email-address"] as const),
  Object.freeze([Object.freeze(/\b(?:acct|cus|cust|usr)_[A-Za-z0-9][A-Za-z0-9_-]{4,}\b/i), "customer-identifier"] as const),
  Object.freeze([Object.freeze(/\b(?:customer|account|user)[_-]?id\s*[:=]\s*["']?[A-Za-z0-9][A-Za-z0-9._-]{3,}/i), "customer-identifier"] as const),

  // High-entropy string heuristic: 40+ hex chars (SHA-like)
  Object.freeze([Object.freeze(/\b[0-9a-f]{40,}\b/), "high-entropy hex string (potential secret)"] as const),
] as const);

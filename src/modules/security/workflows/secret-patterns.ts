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

export const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // NOTE: labels deliberately drop the `=` so the redaction replacement
  // (e.g. `<REDACTED:password-assignment>`) cannot itself re-match the pattern
  // on a subsequent scrub pass. Idempotency depends on this — every label below
  // is checked against every pattern above it, and none re-matches.
  [/password\s*=\s*["']?[^\s"']{6,}/, "password-assignment"],
  [/api_key\s*=\s*["']?[^\s"']{6,}/i, "api_key-assignment"],
  [/secret\s*=\s*["']?[^\s"']{8,}/i, "secret-assignment"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/AIza[0-9A-Za-z_-]{35}/, "GCP API key"],
  [/ghp_[0-9A-Za-z]{36}/, "GitHub personal access token"],
  [/ghs_[0-9A-Za-z]{36}/, "GitHub server token"],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY/, "PEM private key block"],

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
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i, "bearer-token"],
  [/\bauthorization\s*:\s*["']?[A-Za-z0-9._~+/=-]{12,}/i, "authorization-header"],
  [/\b(?:auth|access|refresh|id|api|bearer|session)[-_]?token\s*[:=]\s*["']?[^\s"',]{8,}/i,
    "token-assignment"],
  // OpenAI/Anthropic-style provider keys: sk-…, sk-proj-…, sk-ant-….
  [/\bsk-[A-Za-z0-9_-]{12,}/, "provider-api-key"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bgh[uor]_[0-9A-Za-z]{36}/, "GitHub token"],
  [/\bglpat-[0-9A-Za-z_-]{20}/, "GitLab personal access token"],
  [/\bnpm_[0-9A-Za-z]{36}/, "npm token"],
  [/\bhf_[0-9A-Za-z]{34}/, "HuggingFace token"],

  // High-entropy string heuristic: 40+ hex chars (SHA-like)
  [/\b[0-9a-f]{40,}\b/, "high-entropy hex string (potential secret)"],
];

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
  // on a subsequent scrub pass. Idempotency depends on this.
  [/password\s*=\s*["']?[^\s"']{6,}/, "password-assignment"],
  [/api_key\s*=\s*["']?[^\s"']{6,}/i, "api_key-assignment"],
  [/secret\s*=\s*["']?[^\s"']{8,}/i, "secret-assignment"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/AIza[0-9A-Za-z_-]{35}/, "GCP API key"],
  [/ghp_[0-9A-Za-z]{36}/, "GitHub personal access token"],
  [/ghs_[0-9A-Za-z]{36}/, "GitHub server token"],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY/, "PEM private key block"],
  // High-entropy string heuristic: 40+ hex chars (SHA-like)
  [/\b[0-9a-f]{40,}\b/, "high-entropy hex string (potential secret)"],
];

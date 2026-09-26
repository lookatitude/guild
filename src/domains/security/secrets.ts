/**
 * hooks/lib/security/secrets.ts
 *
 * Secrets-scrubbing extension (priority 4 / D-SECRETS). Layers the operator's
 * `secrets_policy.redaction_patterns` ON TOP of the built-in 5-group redaction
 * (hooks/lib/v1.4/redact-log.ts — token-shape, home-dir, key=value, high-
 * entropy, truncation). Built-ins always run first; the custom patterns are an
 * additive operator-defined sweep.
 *
 * ── BIND BY POINTER ──
 * `secrets_policy.*` schema + defaults live in scripts/read-guild-config.ts
 * (SecretsPolicyBlock / validateSecretsPolicy). The 5-group redaction lives in
 * hooks/lib/v1.4/redact-log.ts (redactField). This module composes those two —
 * it does NOT re-implement either.
 *
 * Fail modes (D-SECRETS):
 *   - fail_mode_telemetry (local gitignored .guild/ writes): default "open" —
 *     on a scrub failure (e.g. an invalid custom regex) warn + record + still
 *     write the built-in-redacted value.
 *   - fail_mode_durable (shared-git writes): default "closed" — on a scrub
 *     failure, callers MUST block the write. This module surfaces `ok=false`
 *     so the durable caller can fail closed; it never decides the write itself.
 */

import { redactField } from "./redact-log.js";
import type { SecretsPolicy } from "./config.js";

export interface ScrubResult {
  /** The scrubbed value (built-ins always applied; custom patterns best-effort). */
  value: string;
  /** False ⇒ at least one custom pattern failed to compile/apply. */
  ok: boolean;
  /** Compile/apply failures (pattern → message) for diagnostics + events. */
  failures: string[];
}

/**
 * Apply built-in redaction then the operator's custom `redaction_patterns`.
 * Pure. Invalid custom regexes are skipped (recorded in `failures`, ok=false)
 * so a bad pattern degrades to built-in-only scrubbing instead of throwing.
 */
export function applySecretsPolicy(
  value: unknown,
  policy: SecretsPolicy,
  opts?: { noTruncate?: boolean }
): ScrubResult {
  if (typeof value !== "string") {
    return { value: typeof value === "string" ? value : String(value ?? ""), ok: true, failures: [] };
  }
  // Group 1-5: built-in redaction always runs first. `redactField`'s default cap
  // (FIELD_SIZE_CAP_BYTES = 4 KiB) is for TRACE-LOG FIELDS — it must NOT clip a whole
  // DOCUMENT (handoff / wiki / review). Document-scrub callers pass noTruncate so the
  // secret-redaction still runs but the 4 KiB truncation is skipped (was silently
  // clipping handoffs at 4111 bytes = 4096 + "... [TRUNCATED]").
  let out = redactField(value, opts?.noTruncate ? Number.POSITIVE_INFINITY : undefined);
  const failures: string[] = [];
  for (const pat of policy.redaction_patterns) {
    let re: RegExp;
    try {
      re = new RegExp(pat, "g");
    } catch (err) {
      failures.push(`${pat}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    try {
      out = out.replace(re, "[REDACTED]");
    } catch (err) {
      failures.push(`${pat}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { value: out, ok: failures.length === 0, failures };
}

/**
 * Decide what a TELEMETRY (local gitignored) writer should do with a scrub
 * result, honoring `fail_mode_telemetry`:
 *   - "open"   (default): always emit the scrubbed value; surface `warn` on failure.
 *   - "closed":           on failure, suppress the field (emit undefined) so a
 *                         possibly-unscrubbed value never lands in telemetry.
 * The built-in redaction has already run, so even the "open" failure path is
 * not raw — it is built-in-redacted minus the failed custom pattern.
 */
export function resolveTelemetryField(
  scrub: ScrubResult,
  policy: SecretsPolicy,
): { value: string | undefined; warn: boolean } {
  if (scrub.ok) return { value: scrub.value, warn: false };
  if (policy.fail_mode_telemetry === "closed") return { value: undefined, warn: true };
  return { value: scrub.value, warn: true }; // "open"
}

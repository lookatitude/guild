/**
 * scripts/lib/host-profiles-validate.ts
 *
 * P2-Wave-1 LW1-6 (SC-W1-7 / ADR step 14) — the SINGLE source of truth for
 * `host_profiles` strict entry-shape validation. Extracted here so BOTH the
 * --validate path (`read-guild-config.ts` / `config-cmd.ts`) AND the normal
 * resolve path (`settings-resolver.ts` `sparseHostProfiles`) reuse the SAME
 * rules instead of duplicating them (Codex G-lane MUST-FIX item3, dual-mirror drift).
 *
 * Closed contract for one entry: `{ models?: { cheap?, mid?, powerful? }, enabled? }`.
 *   - host_id MUST be a known registry id (HOST_IDS — the single SoT).
 *   - entry MUST be a plain object; only `models` / `enabled` keys allowed.
 *   - `enabled` (if present) MUST be a boolean.
 *   - `models` (if present) MUST be an object; only `cheap`/`mid`/`powerful`,
 *     each a non-empty string.
 *
 * `validateHostProfiles` REPORTS rejects (used by --validate, fail-loud).
 * `filterHostProfiles` DROPS anything that would reject (used by the resolver,
 * fail-CLOSED: a malformed entry/sub-key is omitted, never passed through to
 * consumers). Both are pure and never throw. No I/O, no clock.
 */

import { HOST_IDS } from "./host-registry-schema";

/** Closed registry host-id set (single SoT — host-registry-schema.ts HOST_IDS). */
const KNOWN_HOST_IDS = new Set<string>(HOST_IDS);

/** Closed entry-shape key set. */
export const VALID_HOST_PROFILE_ENTRY_KEYS = new Set(["models", "enabled"]);
/** Closed per-tier model key set. */
export const VALID_HOST_PROFILE_MODEL_KEYS = new Set(["cheap", "mid", "powerful"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * STRICT validation of a `host_profiles` block — returns human-readable reject messages
 * (empty ⇒ valid). The fail-LOUD path (`config validate` / read-guild-config).
 */
export function validateHostProfiles(hp: Record<string, unknown>): string[] {
  const rejects: string[] = [];
  for (const [hostId, entry] of Object.entries(hp)) {
    if (!KNOWN_HOST_IDS.has(hostId)) {
      rejects.push(
        `unknown host_profiles host_id "${hostId}" (closed key set — valid: ${[...KNOWN_HOST_IDS].join("|")})`
      );
      continue;
    }
    if (!isPlainObject(entry)) {
      rejects.push(`host_profiles["${hostId}"] must be an object { models?, enabled? }`);
      continue;
    }
    const e = entry as Record<string, unknown>;
    for (const ek of Object.keys(e)) {
      if (!VALID_HOST_PROFILE_ENTRY_KEYS.has(ek)) {
        rejects.push(
          `unknown host_profiles["${hostId}"] key "${ek}" (closed entry shape — only models, enabled)`
        );
      }
    }
    if (e["enabled"] !== undefined && typeof e["enabled"] !== "boolean") {
      rejects.push(`host_profiles["${hostId}"].enabled must be a boolean (got ${JSON.stringify(e["enabled"])})`);
    }
    if (e["models"] !== undefined) {
      if (!isPlainObject(e["models"])) {
        rejects.push(`host_profiles["${hostId}"].models must be an object { cheap?, mid?, powerful? }`);
      } else {
        const m = e["models"] as Record<string, unknown>;
        for (const mk of Object.keys(m)) {
          if (!VALID_HOST_PROFILE_MODEL_KEYS.has(mk)) {
            rejects.push(
              `unknown host_profiles["${hostId}"].models key "${mk}" (closed key set — only cheap, mid, powerful)`
            );
          } else if (typeof m[mk] !== "string" || !(m[mk] as string).trim()) {
            rejects.push(`host_profiles["${hostId}"].models.${mk} must be a non-empty string (got ${JSON.stringify(m[mk])})`);
          }
        }
      }
    }
  }
  return rejects;
}

/**
 * FAIL-CLOSED filter of a `host_profiles` block for the RESOLVE path: returns a NEW
 * block containing only entries that pass `validateHostProfiles` whole-entry (same SoT
 * rules). A malformed entry — unknown host_id, non-object entry, unknown entry key
 * (e.g. `host_profiles.claude.bogus_key`), non-boolean `enabled`, or any malformed
 * `models` sub-key — is DROPPED entirely, never passed through. Pure; never throws.
 *
 * Whole-entry drop (not per-sub-key salvage) is the conservative choice: the resolver
 * must NEVER emit malformed host_profiles content, and a partially-mangled entry has no
 * trustworthy meaning.
 */
export function filterHostProfiles(
  raw: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [hostId, entry] of Object.entries(raw)) {
    // Validate this entry in isolation; keep it only when it is fully clean.
    if (validateHostProfiles({ [hostId]: entry }).length === 0) {
      out[hostId] = entry as Record<string, unknown>;
    }
  }
  return out;
}

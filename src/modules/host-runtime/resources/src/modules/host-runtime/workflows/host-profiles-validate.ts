/**
 * src/modules/host-runtime/workflows/host-profiles-validate.ts
 *
 * P2-Wave-1 LW1-6 - the single source of truth for `host_profiles` strict
 * entry-shape validation.
 *
 * Closed contract for one entry: `{ models?: { cheap?, mid?, powerful? }, enabled? }`.
 * Both exported helpers are pure and never throw.
 */

import { HOST_IDS } from "./host-registry-schema";
import { normalizeHostId } from "./host-id-namespace";

/** Closed registry host-id set (single SoT - host-registry-schema.ts HOST_IDS). */
const KNOWN_HOST_IDS = new Set<string>(HOST_IDS);

/** Closed entry-shape key set. */
export const VALID_HOST_PROFILE_ENTRY_KEYS = new Set(["models", "enabled"]);
/** Closed per-tier model key set. */
export const VALID_HOST_PROFILE_MODEL_KEYS = new Set(["cheap", "mid", "powerful"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Strict validation of a `host_profiles` block. Returns human-readable reject
 * messages; an empty array means valid.
 */
export function validateHostProfiles(hp: Record<string, unknown>): string[] {
  const rejects: string[] = [];
  for (const [hostId, entry] of Object.entries(hp)) {
    const canonicalHostId = normalizeHostId(hostId);
    if (!canonicalHostId) {
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
 * Fail-closed filter of a `host_profiles` block for the resolve path. A malformed
 * entry is dropped entirely, never passed through.
 */
export function filterHostProfiles(
  raw: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [hostId, entry] of Object.entries(raw)) {
    if (validateHostProfiles({ [hostId]: entry }).length === 0) {
      const canonicalHostId = normalizeHostId(hostId);
      if (canonicalHostId) out[canonicalHostId] = entry as Record<string, unknown>;
    }
  }
  return out;
}

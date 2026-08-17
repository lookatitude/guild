/**
 * src/modules/config/workflows/tier-model.ts
 *
 * Single unpack point for models.tiers values:
 *   string | { model, effort?, reasoning?, thinking?, verbosity? } | null.
 */

import { normalizeHostId } from "../../host-runtime";

/** Object form of a tier->host model value. Closed key set: model, effort, reasoning, thinking, verbosity. */
export interface TierModelSpec {
  /** Model name for this tier on this host (required in the object form). */
  model: string;
  /** Optional host effort axis (e.g. "low" | "medium" | "high" -- host-defined). */
  effort?: string;
  /** Optional host reasoning axis (host-defined). */
  reasoning?: string;
  /** Optional host thinking axis (host-defined). */
  thinking?: string;
  /** Optional host verbosity axis (host-defined). */
  verbosity?: string;
}

/** A tier->host value: plain model string, object form, or null (no model). */
export type TierHostValue = string | TierModelSpec | null;

/** Normalized result of unpacking a TierHostValue (G-11). */
export interface ResolvedTierModel {
  /** Model name, or null when the slot is empty/absent/malformed. */
  model: string | null;
  /** Present only when the object form supplied it. */
  effort?: string;
  /** Present only when the object form supplied it. */
  reasoning?: string;
  /** Present only when the object form supplied it. */
  thinking?: string;
  /** Present only when the object form supplied it. */
  verbosity?: string;
}

/** Normalize one tier->host value. */
function normalizeTierValue(v: unknown): ResolvedTierModel {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? { model: t } : { model: null };
  }
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o["model"] === "string" && o["model"].trim()) {
      const out: ResolvedTierModel = { model: (o["model"] as string).trim() };
      if (typeof o["effort"] === "string") out.effort = o["effort"] as string;
      if (typeof o["reasoning"] === "string") out.reasoning = o["reasoning"] as string;
      if (typeof o["thinking"] === "string") out.thinking = o["thinking"] as string;
      if (typeof o["verbosity"] === "string") out.verbosity = o["verbosity"] as string;
      return out;
    }
  }
  return { model: null };
}

/**
 * resolveTierModel -- THE single place the models.tiers value union is unpacked
 * (G-11 / SC-6).
 *
 * Accepts any tiers-shaped record (tolerant -- undefined/partial/malformed input
 * yields { model: null }, never throws):
 *   - canonical host-map form: tiers[tier][host] = string | object | null
 *   - legacy flat form: tiers[tier] = "model-name"
 */
export function resolveTierModel(
  tiers: unknown,
  tier: "cheap" | "mid" | "powerful",
  host: string
): ResolvedTierModel {
  if (typeof tiers !== "object" || tiers === null || Array.isArray(tiers)) {
    return { model: null };
  }
  const entry = (tiers as Record<string, unknown>)[tier];
  if (entry === null || entry === undefined) return { model: null };
  if (typeof entry === "string") return normalizeTierValue(entry);
  if (typeof entry !== "object" || Array.isArray(entry)) return { model: null };
  const hostMap = entry as Record<string, unknown>;
  const canonical = normalizeHostId(host);
  if (canonical && canonical in hostMap) return normalizeTierValue(hostMap[canonical]);
  return normalizeTierValue(hostMap[host]);
}

/**
 * src/modules/capability/workflows/tier-defaults.ts
 *
 * W4 D2 — `tierDefaults()`: the SINGLE-SOURCE runtime tier→model map.
 *
 * Audit A2 found tier→model defaults hand-typed ×3:
 *   1. scripts/lib/capability/rank.ts    `getDefaultModelTierMap()` — switch over all HostKinds
 *   2. scripts/write-host-capability.ts  `DEFAULT_TIER_MODELS`      — flat {cheap,mid,powerful}
 *   3. scripts/score-tier.ts             `DEFAULT_TIERS`            — per-host nested map
 *
 * This module replaces all three with a pure runtime computation from the
 * HOST_REGISTRY_ROWS entries (which already carry per-host model tier slots in
 * `capabilities.models.{cheap,mid,powerful}.model`). No codegen, no committed
 * artifact — every caller imports `tierDefaults` and gets the computed map.
 *
 * Decision (M2/M6): the registry rows are the single source of truth. Adding a
 * host means ONE edit: add a row to HOST_REGISTRY_ROWS. Zero edits to any of the
 * former three hard-coded maps.
 *
 * Behavior-neutral proof: the computed map equals the prior hand-typed maps for
 * all 9 hosts (verified by the parity test in
 * scripts/__tests__/rearch-tier-defaults-parity.test.ts — anti-vacuous).
 *
 * CONTRACT: pure synchronous function. No I/O, no clock, never throws.
 * Owned by tooling-engineer (W4); consumed by rank.ts, write-host-capability.ts,
 * score-tier.ts.
 */

import {
  HOST_REGISTRY_ROWS,
  HOST_IDS,
  type HostId,
  type HostRegistryEntry,
} from "../../host-runtime";
import { HOSTKIND_TO_REGISTRY_ID } from "../../host-runtime";
import type { HostKind } from "../../host-runtime";
import type { Tier } from "./router";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Tier→model map for a single host. null = no Guild-mapped model at this tier. */
export type HostTierMap = Record<Tier, string | null>;

// ---------------------------------------------------------------------------
// Core: compute from registry rows
// ---------------------------------------------------------------------------

/**
 * Claude's built-in defaults — the base ladder every host falls back to when
 * the registry has no non-null model at a tier. This matches the prior
 * hard-coded `{cheap: "haiku", mid: "sonnet", powerful: "opus"}` shared by all
 * three former duplication sites.
 *
 * Kept here (not re-read from the registry) so the constant is a compile-time
 * fact that does not require the Claude row to be present at import time.
 * The parity test verifies this matches the Claude registry row.
 */
export const CLAUDE_TIER_FALLBACK: Record<Tier, string> = {
  cheap: "haiku",
  mid: "sonnet",
  powerful: "opus",
};

/**
 * Compute the per-host tier→model map from the registry rows. For each HostKind
 * that resolves to a registry row:
 *   - If the row's `capabilities.models.<tier>.model` is non-null, use it.
 *   - Otherwise `null` — HONEST (G4b): the registry row exists and says "no
 *     Guild-mapped model at this tier" (e.g. codex-cli today), so that IS the
 *     answer. Silently backfilling a Claude model name here was the "router
 *     hands a codex lane model:'sonnet'" bug the host-reachability audit found;
 *     `defaultTiersMap()` below already got this right and never regressed —
 *     this function had drifted from it (the "two diverged capability truths").
 * A HostKind with NO registry row at all (fully dropped/unmapped, e.g. a legacy
 * "gemini" string cast past the type system) still falls back to
 * `CLAUDE_TIER_FALLBACK` — there is no other signal to consult for a host the
 * registry has never heard of.
 *
 * `descriptors` defaults to `HOST_REGISTRY_ROWS` (the production design-time rows).
 * Pass a custom map to inject a synthetic host in tests.
 *
 * Returns a Record keyed by `HostKind` (the legacy consumer side), not by `HostId`.
 */
export function tierDefaults(
  descriptors: Record<string, HostRegistryEntry> = HOST_REGISTRY_ROWS,
): Record<HostKind, Record<Tier, string | null>> {
  const result = {} as Record<HostKind, Record<Tier, string | null>>;

  // Walk every HostKind and resolve via the registry.
  for (const [hk, registryId] of Object.entries(HOSTKIND_TO_REGISTRY_ID) as [HostKind, HostId | null][]) {
    const row = registryId !== null ? descriptors[registryId] : undefined;
    if (!row) {
      // No registry row at all — the one remaining case where the Claude fallback
      // still applies (nothing else to consult).
      result[hk] = { ...CLAUDE_TIER_FALLBACK };
      continue;
    }
    result[hk] = {
      cheap: row.capabilities?.models?.cheap?.model ?? null,
      mid: row.capabilities?.models?.mid?.model ?? null,
      powerful: row.capabilities?.models?.powerful?.model ?? null,
    };
  }

  return result;
}

/**
 * Convenience: the tier→model map for a single `HostKind`.
 * Replaces the inline `claudeDefaults` returned for every host in
 * `getDefaultModelTierMap()` (rank.ts).
 *
 * When the host has no registry row (gemini, dropped D10), falls back to
 * CLAUDE_TIER_FALLBACK — same behavior as the prior exhaustive switch. When the
 * host HAS a registry row with a null model at a tier, that null is preserved
 * (G4b) — see `tierDefaults()`'s doc comment.
 */
export function tierDefaultsForHost(
  host: HostKind,
  descriptors: Record<string, HostRegistryEntry> = HOST_REGISTRY_ROWS,
): Record<Tier, string | null> {
  const computed = tierDefaults(descriptors);
  return computed[host] ?? { ...CLAUDE_TIER_FALLBACK };
}

/**
 * Flat default tier models for the REFERENCE (Claude) host.
 * Replaces `DEFAULT_TIER_MODELS` in write-host-capability.ts.
 * Runtime-computed from the Claude registry row; no hand-typed literals.
 */
export function defaultTierModels(
  descriptors: Record<string, HostRegistryEntry> = HOST_REGISTRY_ROWS,
): Record<"cheap" | "mid" | "powerful", string> {
  const row = descriptors["claude-code-cli"];
  return {
    cheap:    row?.capabilities?.models?.cheap?.model    ?? CLAUDE_TIER_FALLBACK.cheap,
    mid:      row?.capabilities?.models?.mid?.model      ?? CLAUDE_TIER_FALLBACK.mid,
    powerful: row?.capabilities?.models?.powerful?.model ?? CLAUDE_TIER_FALLBACK.powerful,
  };
}

/**
 * The TRANSPOSED tier-first shape consumed by score-tier.ts `DEFAULT_TIERS`.
 * Shape: `{ cheap: Record<HostKind, string|null>, mid: …, powerful: … }`.
 *
 * Replaces the `DEFAULT_TIERS` hand-typed literal in score-tier.ts. Registry rows
 * for hosts with no Guild-mapped model at a tier carry `null` (e.g. codex); the
 * function propagates `null` here so callers (via `resolveTierModel`) still observe
 * "no model at this tier" for those slots — same semantics as the prior literal.
 *
 * Only the HostKind values that appear in HOSTKIND_TO_REGISTRY_ID are included.
 * "gemini" maps to null (D10 dropped) — its slot is null for all tiers.
 */
export function defaultTiersMap(
  descriptors: Record<string, HostRegistryEntry> = HOST_REGISTRY_ROWS,
): Record<Tier, Record<string, string | null>> {
  const hostMap = Object.entries(HOSTKIND_TO_REGISTRY_ID) as [HostKind, HostId | null][];
  const tiers: Tier[] = ["cheap", "mid", "powerful"];
  const result = {} as Record<Tier, Record<string, string | null>>;
  for (const tier of tiers) {
    result[tier] = {};
    for (const [hk, registryId] of hostMap) {
      const row = registryId !== null ? descriptors[registryId] : undefined;
      const model = row?.capabilities?.models?.[tier]?.model ?? null;
      // Hosts with null model in the registry: preserve null (not the claude fallback).
      // This matches the prior DEFAULT_TIERS shape where codex/gemini slots were null.
      result[tier][hk] = model;
    }
  }
  return result;
}

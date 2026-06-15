/**
 * scripts/lib/host-registry.ts
 *
 * P1-L7 — the RUNTIME host registry: the single source of truth that unifies host
 * identity, detection, and the **independent capability columns** for the routing
 * surfaces. It wraps the design-time `guild.host_registry.v1` rows (L0
 * `host-registry-schema.ts`) and the legacy↔registry namespace reconciliation (L0
 * `host-id-namespace.ts`) behind a small accessor API that `provider-detect.ts`
 * (today) and `host-router.ts` / `team-backend.ts` (forward) read instead of
 * hardcoding per-host facts.
 *
 * WHY (ADR §capability matrix): the detect-only assumption used to be a single
 * boolean `ProviderSpec.hasAdapter` (provider-detect.ts). P1 splits that into three
 * INDEPENDENT columns on the registry row — `installability`, `result_adapter`,
 * `dispatch_selectable`. This module exposes those columns so a consumer reads a
 * COLUMN, never a host NAME. The first consumer (L7 scope) is `provider-detect.ts`:
 * its `hasAdapter` is now sourced from `result_adapter` via `resultAdapterForFamily`.
 *
 * BEHAVIOR-PRESERVING (SC-4): the column values for Claude/Codex are byte-aligned
 * with today's literals (claude → no adapter; codex → adapter; gemini/pi/antigravity
 * → detect-only), and the family collapse used to resolve a HostKind to a row is the
 * SAME collapse `resolveAuthorHost()` already performs (proven in `host-id-namespace`).
 * So `route()` + `selectReviewer()` produce byte-identical decisions pre/post — the
 * A/B in `__tests__/host-registry-ab.test.ts` over the L0 `routing-ab-contract`.
 *
 * CONTRACT: pure synchronous accessors over frozen design-time data. No I/O, no
 * clock, never throws. Owned by tooling-engineer (P1-L7).
 */

import {
  HOST_REGISTRY_ROWS,
  HOST_IDS,
  type HostId,
  type HostFamilyId,
  type HostRegistryEntry,
  type Installability,
} from "./host-registry-schema";
import {
  hostKindToRegistryId,
  registryIdToCanonicalHostKind,
  isDroppedHostKind,
  HOSTKIND_TO_REGISTRY_ID,
} from "./host-id-namespace";
import type { HostKind } from "./host-types";

// Re-export the L0 reconciliation so consumers import the registry as one entry point.
export {
  hostKindToRegistryId,
  registryIdToCanonicalHostKind,
  isDroppedHostKind,
  HOSTKIND_TO_REGISTRY_ID,
};
export { HOST_REGISTRY_ROWS, HOST_IDS };
export type { HostId, HostFamilyId, HostRegistryEntry, Installability };

// ---------------------------------------------------------------------------
// Row accessors (by registry id)
// ---------------------------------------------------------------------------

/** The registry row for a `HostId`, or `null` if the id is not in the registry. */
export function getRegistryEntry(id: HostId | string): HostRegistryEntry | null {
  return (HOST_REGISTRY_ROWS as Record<string, HostRegistryEntry>)[id] ?? null;
}

/**
 * The registry row for a legacy `HostKind`, resolved through the L0 namespace map
 * (`antigravity-2 → antigravity`, `claude-* → claude`, …; `gemini → null`, D10).
 * Returns `null` for a host with no registry row.
 */
export function getRegistryEntryForHostKind(
  hk: HostKind | string
): HostRegistryEntry | null {
  const id = hostKindToRegistryId(hk);
  return id === null ? null : getRegistryEntry(id);
}

// ---------------------------------------------------------------------------
// Independent-column accessors (the hasAdapter replacement + siblings)
// ---------------------------------------------------------------------------

// family → row index (each registry family appears on exactly one row).
const FAMILY_TO_ROW: Record<string, HostRegistryEntry> = (() => {
  const out: Record<string, HostRegistryEntry> = {};
  for (const id of HOST_IDS) {
    const row = HOST_REGISTRY_ROWS[id];
    out[row.family] = row;
  }
  return out;
})();

/**
 * Does a cross-review / RESULT adapter exist for this host FAMILY today? This is
 * the `result_adapter` column — the direct, behavior-preserving replacement for the
 * old `ProviderSpec.hasAdapter` flag. A family with no registry row (e.g. `gemini`,
 * dropped D10; or `unknown`) has no adapter → `false` (matches today's detect-only
 * posture). Never throws.
 */
export function resultAdapterForFamily(family: HostFamilyId | string): boolean {
  return FAMILY_TO_ROW[family]?.result_adapter ?? false;
}

/** `result_adapter` for a registry `HostId` (false when the id is unknown). */
export function resultAdapterForHostId(id: HostId | string): boolean {
  return getRegistryEntry(id)?.result_adapter ?? false;
}

/** `result_adapter` for a legacy `HostKind` (false when the host has no row). */
export function resultAdapterForHostKind(hk: HostKind | string): boolean {
  return getRegistryEntryForHostKind(hk)?.result_adapter ?? false;
}

/**
 * Can a lane be dispatched / selected on this host (the `dispatch_selectable`
 * column)? Forward-compatible accessor for L6 renderers / L8 role wiring. Unknown
 * id ⇒ `false`. Never throws.
 */
export function dispatchSelectableForHostId(id: HostId | string): boolean {
  return getRegistryEntry(id)?.dispatch_selectable ?? false;
}

/**
 * Can a Guild package be installed for this host (the `installability` column:
 * `native | target | none`)? Unknown id ⇒ `"none"`. Never throws.
 */
export function installabilityForHostId(id: HostId | string): Installability {
  return getRegistryEntry(id)?.installability ?? "none";
}

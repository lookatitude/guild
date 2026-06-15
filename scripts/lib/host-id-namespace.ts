/**
 * scripts/lib/host-id-namespace.ts
 *
 * P1-L0 FOUNDATION — namespace reconciliation contract between the **legacy
 * `HostKind`** union (`host-types.ts` — 9 surfaces incl. `antigravity-2`, `gemini`,
 * the claude-* desktop/web/connector variants) and the **P1 registry `HostId`**
 * namespace (`host-registry-schema.ts` — `claude|codex|.agents|pi|antigravity`).
 *
 * Authored to CLEAR the L0 followup carried by P1-L7 (registry unification): L7 must
 * route the legacy host knowledge through the registry **behavior-preserving** for
 * Claude/Codex, but the two id namespaces diverge (legacy `antigravity-2` vs registry
 * `antigravity`; registry adds `.agents`, which is NOT a `HostKind`; registry drops
 * `gemini` per D10). This module makes the mapping a single, importable, test-writable
 * contract so L7 does not have to re-derive or guess it.
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-p1-l0-foundation-contracts.md §Namespace reconciliation
 *   .guild/plan/universal-host-p1.md (P1-L7 — behavior-preserving)
 *
 * BEHAVIOR-PRESERVING ALIGNMENT (load-bearing): the family collapse here is
 * byte-aligned with the existing `resolveAuthorHost()` (provider-detect.ts:229–236):
 * `antigravity*→antigravity`, `claude*→claude`, `codex*→codex`. So routing that today
 * resolves a host's family via `resolveAuthorHost` resolves the SAME family via the
 * registry id's family — the A/B over Claude/Codex (SC-4) is unaffected.
 *
 * CONTRACT: pure functions only. No I/O, no clock, never throws.
 *
 * Owned by plugin-architect (P1-L0); consumed by L7 (registry unify).
 */

import { HostKind } from "./host-types";
import { HostId } from "./host-registry-schema";

// ---------------------------------------------------------------------------
// Legacy HostKind → registry HostId
// ---------------------------------------------------------------------------

/**
 * Explicit, exhaustive map of every legacy `HostKind` to its registry `HostId`
 * (or `null` when the host has no registry row — `gemini`, dropped per D10).
 *
 * The exhaustive literal doubles as documentation: extending `HostKind` without
 * adding an entry here is caught by `hostKindToRegistryId`'s prefix fallback, but the
 * map is the authoritative, reviewable enumeration.
 */
export const HOSTKIND_TO_REGISTRY_ID: Record<HostKind, HostId | null> = {
  claude: "claude",
  "claude-code-desktop": "claude", // claude family surface
  "claude-code-web": "claude", // claude family surface
  "claude-ai-connector": "claude", // claude family surface (remote MCP control plane)
  codex: "codex",
  "codex-app": "codex", // codex family surface
  pi: "pi",
  "antigravity-2": "antigravity", // legacy id `antigravity-2` ⇒ registry id `antigravity`
  gemini: null, // DROPPED (D10) — no registry row; routing degrades/records (matches today: detect-only, not selectable)
};

/**
 * Map a legacy `HostKind` to its registry `HostId`. Returns `null` for a host with
 * no registry row (`gemini`, D10). Prefix-collapse (mirrors `resolveAuthorHost`) is
 * the fallback for any future `claude-*` / `codex-*` / `antigravity*` surface so a
 * new variant maps correctly without a map edit. Never throws.
 */
export function hostKindToRegistryId(hk: HostKind | string): HostId | null {
  if (hk in HOSTKIND_TO_REGISTRY_ID) {
    return HOSTKIND_TO_REGISTRY_ID[hk as HostKind];
  }
  // Prefix fallback — byte-aligned with provider-detect.ts resolveAuthorHost().
  const s = String(hk);
  if (s.startsWith("antigravity")) return "antigravity";
  if (s.startsWith("claude")) return "claude";
  if (s.startsWith("codex")) return "codex";
  if (s === "pi") return "pi";
  if (s.startsWith("gemini")) return null; // dropped (D10)
  return null; // unknown ⇒ no registry row (safe: forces degrade/record, never a false capability)
}

// ---------------------------------------------------------------------------
// Registry HostId → canonical legacy HostKind
// ---------------------------------------------------------------------------

/**
 * Map a registry `HostId` to its CANONICAL legacy `HostKind` (the primary surface),
 * or `null` when the registry id has NO `HostKind` — namely `.agents`, which is a
 * universal-package emission target (family `agents`), not a dispatch `HostKind`.
 * Note the asymmetry: `claude`/`codex` each fan out to several `HostKind` surfaces;
 * this returns the canonical one. Never throws.
 */
export function registryIdToCanonicalHostKind(id: HostId | string): HostKind | null {
  switch (id) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "pi":
      return "pi";
    case "antigravity":
      return "antigravity-2"; // registry `antigravity` ⇒ canonical legacy id `antigravity-2`
    case ".agents":
      return null; // emission target only — no HostKind surface
    default:
      return null;
  }
}

/** True iff the legacy `HostKind` is dropped from the P1 registry (gemini, D10). */
export function isDroppedHostKind(hk: HostKind | string): boolean {
  return hostKindToRegistryId(hk) === null && String(hk).startsWith("gemini");
}

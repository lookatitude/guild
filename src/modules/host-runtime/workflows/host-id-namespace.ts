/**
 * src/modules/host-runtime/workflows/host-id-namespace.ts
 *
 * P1-L0 FOUNDATION - namespace reconciliation contract between the legacy
 * `HostKind` union (`host-types.ts` - the `antigravity-2` and claude-* desktop/web/
 * connector variants; the `gemini` surface was sunset 2026-06-14) and the P1 registry `HostId`
 * namespace (`host-registry-schema.ts` - v2 canonical ids such as
 * `claude-code-cli`, `codex-cli`, and `agents-file`).
 *
 * Authored to CLEAR the L0 followup carried by P1-L7 (registry unification): L7 must
 * route the legacy host knowledge through the registry behavior-preserving for
 * Claude/Codex, but the two id namespaces diverge (legacy `antigravity-2` vs registry
 * `antigravity`; registry adds `.agents`, which is NOT a `HostKind`; registry drops
 * `gemini` per D10). This module makes the mapping a single, importable, test-writable
 * contract so L7 does not have to re-derive or guess it.
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-p1-l0-foundation-contracts.md Section Namespace reconciliation
 *   .guild/plan/universal-host-p1.md (P1-L7 - behavior-preserving)
 *
 * BEHAVIOR-PRESERVING ALIGNMENT (load-bearing): the family collapse here is
 * byte-aligned with the existing `resolveAuthorHost()` (provider-detect.ts:229-236):
 * `antigravity*->antigravity`, `claude*->claude`, `codex*->codex`. So routing that today
 * resolves a host's family via `resolveAuthorHost` resolves the SAME family via the
 * registry id's family - the A/B over Claude/Codex (SC-4) is unaffected.
 *
 * CONTRACT: pure functions only. No I/O, no clock, never throws.
 *
 * Owned by plugin-architect (P1-L0); consumed by L7 (registry unify).
 */

import type { HostKind } from "./host-types";
import { HOST_IDS, type HostId } from "./host-registry-schema";

// ---------------------------------------------------------------------------
// Legacy HostKind -> registry HostId
// ---------------------------------------------------------------------------

/**
 * Explicit, exhaustive map of every legacy `HostKind` to its registry `HostId`.
 * (`gemini` was a dropped host with no registry row; it was sunset 2026-06-14 and
 * removed from `HostKind`, so it no longer appears here. A legacy `"gemini"` string
 * input still resolves to `null` via the fallback + `isDroppedHostKind`.)
 *
 * The exhaustive literal doubles as documentation: extending `HostKind` without
 * adding an entry here is caught by `hostKindToRegistryId`'s prefix fallback, but the
 * map is the authoritative, reviewable enumeration.
 */
export const HOSTKIND_TO_REGISTRY_ID: Record<HostKind, HostId | null> = {
  claude: "claude-code-cli",
  "claude-code-desktop": "claude-code-app", // legacy desktop alias
  "claude-code-web": "claude-code-web",
  "claude-ai-connector": "claude-ai-connector", // remote MCP control plane
  codex: "codex-cli",
  "codex-app": "codex-app",
  pi: "pi-cli",
  "antigravity-2": "antigravity-cli",
};

/**
 * Map a legacy `HostKind` to its registry `HostId`. Returns `null` for a host with
 * no registry row (including a legacy `"gemini"` string — the sunset host). Prefix-
 * collapse (mirrors `resolveAuthorHost`) is the fallback for any future `claude-*` /
 * `codex-*` / `antigravity*` surface so a new variant maps correctly without a map
 * edit. Never throws.
 */
export function hostKindToRegistryId(hk: HostKind | string): HostId | null {
  if (hk in HOSTKIND_TO_REGISTRY_ID) {
    return HOSTKIND_TO_REGISTRY_ID[hk as HostKind];
  }
  // Prefix fallback - byte-aligned with provider-detect.ts resolveAuthorHost().
  const s = String(hk);
  const normalized = normalizeHostId(s);
  if (normalized) return normalized;
  return null; // unknown / dropped (e.g. "gemini") => no registry row (safe: forces degrade/record)
}

const HOST_ID_SET = new Set<string>(HOST_IDS);

export const LEGACY_HOST_ALIASES: Record<string, HostId> = {
  claude: "claude-code-cli",
  "claude-code-desktop": "claude-code-app",
  codex: "codex-cli",
  "codex-plugin": "codex-cli",
  agents: "agents-file",
  ".agents": "agents-file",
  pi: "pi-cli",
  antigravity: "antigravity-cli",
  "antigravity-2": "antigravity-cli",
};

/**
 * Normalize a canonical host id or legacy alias into the v2 canonical HostId.
 * Returns null for unknown or intentionally dropped hosts such as Gemini.
 */
export function normalizeHostId(value: string): HostId | null {
  const s = value.trim();
  if (HOST_ID_SET.has(s)) return s as HostId;
  return LEGACY_HOST_ALIASES[s] ?? null;
}

// ---------------------------------------------------------------------------
// Registry HostId -> canonical legacy HostKind
// ---------------------------------------------------------------------------

/**
 * Map a registry `HostId` to its CANONICAL legacy `HostKind` (the primary surface),
 * or `null` when the registry id has NO `HostKind` - namely `.agents`, which is a
 * universal-package emission target (family `agents`), not a dispatch `HostKind`.
 * Note the asymmetry: `claude`/`codex` each fan out to several `HostKind` surfaces;
 * this returns the canonical one. Never throws.
 */
export function registryIdToCanonicalHostKind(id: HostId | string): HostKind | null {
  switch (id) {
    case "claude-code-cli":
      return "claude";
    case "codex-cli":
      return "codex";
    case "pi-cli":
      return "pi";
    case "antigravity-cli":
      return "antigravity-2"; // registry `antigravity` => canonical legacy id `antigravity-2`
    case "claude-code-app":
      return "claude-code-desktop";
    case "claude-code-web":
      return "claude-code-web";
    case "codex-app":
      return "codex-app";
    case "claude-ai-connector":
      return "claude-ai-connector";
    case "agents-file":
      return null; // emission target only - no HostKind surface
    default:
      return null;
  }
}

/**
 * True iff a legacy host string is the dropped `gemini` host (sunset 2026-06-14 in
 * favour of Antigravity — no registry row). `gemini` is no longer a `HostKind` member,
 * so this only fires for a raw legacy `"gemini"` string input; retained as the explicit
 * drop guard the registry re-exports.
 */
export function isDroppedHostKind(hk: HostKind | string): boolean {
  return hostKindToRegistryId(hk) === null && String(hk).startsWith("gemini");
}

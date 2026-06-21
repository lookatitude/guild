/**
 * scripts/lib/capability/tiebreak.ts
 *
 * Deterministic tiebreak ordering for the host router (§2 decomposition).
 * Extracted from host-router.ts (W3 god-file split).
 *
 * Usage: internal to capability/rank.ts and capability/router.ts.
 * Depends: core/contracts (via host-registry), shared/ — no host/ imports.
 */

import type { HostKind } from "../host-types";
import { isClaudeHost } from "./rank";

/**
 * Numeric ordering of HostKind values for deterministic tiebreak after score.
 * Claude comes first (0), everything else after (1).
 * P1-L7: "is claude" resolved through the registry bridge, not a raw literal.
 */
export function hostKindRank(hostKind: HostKind): number {
  return isClaudeHost(hostKind) ? 0 : 1;
}

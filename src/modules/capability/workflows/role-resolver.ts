/**
 * scripts/lib/role-resolver.ts
 *
 * P1-L8 — the RUNTIME role resolver: turns a live provider detection (provider-detect
 * DetectionResult) into the `available` registry rows on this box, then resolves the
 * three per-run roles through the L0 pure reference `resolveRoles()`. The wired
 * resolver MUST match the reference for the same inputs (SC-5 contract-test).
 *
 * It reads CAPABILITY COLUMNS off the registry rows — never the host name. The DEFAULT
 * Claude+Codex box (codex detected+authed) resolves to host=claude, advisory=claude
 * (local advisor), adversarial=codex (different family, strong) — byte-identical to
 * today's implicit behavior.
 *
 * Consumed by runstart-preflight.ts (records `roles` in the snapshot), the execute-plan
 * advisory call-site (C1: routes advisory advice to roles.advisory.substrate and records
 * it via advisory-record.ts), and the review path (roles.adversarial drives the reviewer).
 *
 * CONTRACT: pure. No I/O, no clock, never throws. Owned by tooling-engineer (P1-L8).
 */

import { HOST_IDS, HOST_REGISTRY_ROWS, type HostRegistryEntry } from "../../host-runtime";
import { resolveRoles, type RoleResolutionSet } from "./role-model-schema";
import { ADVISORY_SUBSTRATES, type AdvisorySubstrate } from "../../../../scripts/lib/advisory-record";
import type { DetectionResult } from "../../host-runtime";

/**
 * The registry rows AVAILABLE on this box, in registry/preference order. A row's
 * family is "available" when it is the resolved author-host family OR a detected
 * provider's family (selectable cross reviewers, or any detected non-host provider).
 * Families with no registry row (e.g. `gemini`, dropped D10) are dropped — matching
 * today's detect-only posture.
 */
export function availableRegistryRows(detection: DetectionResult): HostRegistryEntry[] {
  const families = new Set<string>();
  // The author host family is always available (the host substrate; claude by default).
  if (detection.authorHost && detection.authorHost !== "unknown") {
    families.add(detection.authorHost);
  }
  for (const p of detection.providers) {
    // A provider contributes its family when it can actually be used as a substrate:
    // a selectable cross reviewer, or any detected non-host provider.
    if (p.selectable || (p.detected && p.kind !== "host")) families.add(p.family);
  }
  return HOST_IDS.map((id) => HOST_REGISTRY_ROWS[id]).filter((row) => families.has(row.family));
}

/**
 * Resolve the three per-run roles for a live detection. Delegates the decision to the
 * L0 reference `resolveRoles()` (SC-5: the wired resolver matches the reference).
 */
export function resolveRolesForRun(detection: DetectionResult): RoleResolutionSet {
  return resolveRoles({ available: availableRegistryRows(detection) });
}

/**
 * The advisory substrate to stamp on an AdvisoryRecord (C1 routing). Returns the
 * resolved advisory substrate when it is a known AdvisorySubstrate, else `undefined`
 * — and an ABSENT substrate means the default local advisor ("claude") per
 * advisory-record back-compat. So a default Claude box yields `"claude"` (or absent,
 * equivalently) and a routed advisory yields its substrate id.
 */
export function advisorySubstrateFromRoles(
  roles: RoleResolutionSet
): AdvisorySubstrate | undefined {
  const s = roles.advisory.substrate;
  if (s !== null && (ADVISORY_SUBSTRATES as readonly string[]).includes(s)) {
    return s as AdvisorySubstrate;
  }
  return undefined;
}

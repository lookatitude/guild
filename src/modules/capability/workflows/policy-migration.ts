/**
 * src/modules/capability/workflows/policy-migration.ts
 *
 * Legacy tier-map dual-read + migration PREVIEW (guild.model_policy.v2 §6;
 * SC-12). Lane T5.
 *
 * Two-release window (releases N and N+1): legacy tier maps (settings
 * `models.tiers`, tier-model.ts defaults) are dual-read as LOWER-precedence
 * preferences only:
 *   - explicit v2 `model_policy` values WIN;
 *   - legacy fills ONLY unset GENERIC tier preferences (general /
 *     implementation) — legacy never binds research, review, or security
 *     purposes and never upgrades evidence (availability truth comes from the
 *     catalog alone);
 *   - NO automatic settings writeback: the resolver emits a migration PREVIEW
 *     (what v2 would write), records both sources + conflicts in the
 *     resolution receipt, and leaves legacy bytes unchanged;
 *   - rollback during the window restores legacy behavior with legacy keys
 *     byte-identical (nothing here ever writes, so rollback is trivially
 *     byte-preserving);
 *   - after the window (release N+2, separately approved): legacy keys fail
 *     validation with removal guidance.
 *
 * CONTRACT: read-only. migrationPreview never writes a byte.
 */

import * as fs from "fs";
import * as path from "path";

import {
  OPERATOR_BASELINE_POLICY,
  tierForComplexity,
  type ModelPolicyV2,
  type PolicyComplexity,
  type PolicyPurpose,
  type PolicyRoute,
  type PolicyTier,
} from "./model-policy";

// ── Dual-read resolution ─────────────────────────────────────────────────────

/** Purposes legacy tier maps may fill when the v2 policy leaves them unset (§6). */
export const LEGACY_FILLABLE_PURPOSES: readonly PolicyPurpose[] = Object.freeze(["general", "implementation"]);

export interface LegacyConflict {
  purpose: string;
  effective_complexity: string;
  tier: PolicyTier;
  v2_selectors: string[];
  legacy_model: string;
}

export interface DualReadResolution {
  /** Which source bound the preference for this (purpose, complexity). */
  source: "v2_policy" | "legacy" | "baseline_default";
  /** The winning route (v2/baseline) or the legacy-derived preference. */
  route: PolicyRoute | null;
  /** Every v2-vs-legacy disagreement, recorded for the resolution receipt. */
  conflicts: LegacyConflict[];
  /** Migration guidance emitted whenever a legacy value participated. */
  guidance: string[];
}

/** Extract a legacy tier value as a model string (string or per-host map). */
function legacyModelFor(legacyTiers: Record<string, unknown> | undefined, tier: PolicyTier): string | null {
  const v = legacyTiers?.[tier];
  if (typeof v === "string" && v.length > 0) return v;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const hostValue of Object.values(v as Record<string, unknown>)) {
      if (typeof hostValue === "string" && hostValue.length > 0) return hostValue;
    }
  }
  return null;
}

function findRoute(
  policy: Partial<ModelPolicyV2> | undefined,
  purpose: string,
  complexity: PolicyComplexity
): PolicyRoute | null {
  const routes = (policy?.purposes as Record<string, { routes?: PolicyRoute[] }> | undefined)?.[
    purpose
  ]?.routes;
  if (!Array.isArray(routes)) return null;
  for (const r of routes) {
    if (r && (r.complexity === complexity || r.complexity === "any")) return r;
  }
  return null;
}

/**
 * §6 dual-read precedence for one (purpose, effective_complexity) slot:
 * explicit v2 WINS; legacy fills only unset GENERIC preferences; research and
 * review-class purposes fall back to the validated OPERATOR baseline — never
 * to a legacy map. Conflicts are recorded, never silently swallowed.
 */
export function resolveWithLegacy(input: {
  v2_policy?: Partial<ModelPolicyV2>;
  legacy_tiers?: Record<string, unknown>;
  purpose: string;
  effective_complexity: PolicyComplexity;
}): DualReadResolution {
  const { purpose, effective_complexity } = input;
  const tier: PolicyTier = tierForComplexity(effective_complexity);
  const legacyModel = legacyModelFor(input.legacy_tiers, tier);
  const conflicts: LegacyConflict[] = [];
  const guidance: string[] = [];

  const v2Route = findRoute(input.v2_policy, purpose, effective_complexity);
  if (v2Route) {
    if (legacyModel) {
      conflicts.push({
        purpose,
        effective_complexity,
        tier,
        v2_selectors: (v2Route.preferred ?? []).map((s) => s.selector),
        legacy_model: legacyModel,
      });
      guidance.push(
        `legacy models.tiers.${tier} ("${legacyModel}") is shadowed by the explicit v2 model_policy ` +
          `for ${purpose}/${effective_complexity}; remove the legacy key before the migration window closes`
      );
    }
    return { source: "v2_policy", route: v2Route, conflicts, guidance };
  }

  const isGeneric = (LEGACY_FILLABLE_PURPOSES as readonly string[]).includes(purpose);
  if (isGeneric && legacyModel) {
    guidance.push(
      `legacy models.tiers.${tier} fills the unset generic ${purpose}/${effective_complexity} ` +
        `preference for the migration window only; migrate it to model_policy.purposes.${purpose}`
    );
    return {
      source: "legacy",
      route: {
        complexity: effective_complexity,
        preferred: [{ selector: `id:${legacyModel}`, effort: null, capabilities: [] }],
        fallbacks: [],
        provider_default: "forbid",
      },
      conflicts,
      guidance,
    };
  }

  // Research / review-class / security purposes (and generic slots with no
  // legacy value) bind to the validated operator baseline — NEVER to legacy.
  if (!isGeneric && legacyModel) {
    guidance.push(
      `legacy models.tiers.${tier} is IGNORED for ${purpose} — legacy maps never bind ` +
        `research/review/security purposes (§6)`
    );
  }
  const baselineRoute = findRoute(OPERATOR_BASELINE_POLICY, purpose, effective_complexity);
  return { source: "baseline_default", route: baselineRoute, conflicts, guidance };
}

// ── Migration preview (read-only; never writes) ──────────────────────────────

export interface MigrationPreview {
  /** What a v2 model_policy write WOULD look like (never written by tooling). */
  proposed_model_policy: ModelPolicyV2;
  /** Legacy inputs found, verbatim. */
  legacy_sources: Record<string, unknown>;
  /** v2-vs-legacy disagreements for the generic purposes. */
  conflicts: LegacyConflict[];
  guidance: string[];
  /** Always false — §6 forbids automatic settings writeback. */
  writes_performed: false;
}

/**
 * Compute the migration preview for a repo root. READ-ONLY: parses
 * `.guild/settings.json` when present and never writes a byte back — the §6
 * no-writeback rule is structural (there is no write call in this module's
 * preview path), so legacy bytes stay byte-identical and window rollback is
 * lossless.
 */
export function migrationPreview(input: { root: string }): MigrationPreview {
  const settingsPath = path.join(input.root, ".guild", "settings.json");
  let parsed: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        parsed = raw as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
  }

  const models = parsed["models"];
  const legacyTiers =
    models && typeof models === "object" && !Array.isArray(models)
      ? ((models as Record<string, unknown>)["tiers"] as Record<string, unknown> | undefined)
      : undefined;
  const v2Policy = parsed["model_policy"] as Partial<ModelPolicyV2> | undefined;

  const conflicts: LegacyConflict[] = [];
  const guidance: string[] = [];
  const proposed: ModelPolicyV2 = JSON.parse(
    JSON.stringify(OPERATOR_BASELINE_POLICY)
  ) as ModelPolicyV2;

  for (const purpose of LEGACY_FILLABLE_PURPOSES) {
    for (const complexity of ["easy", "medium", "hard"] as PolicyComplexity[]) {
      const resolved = resolveWithLegacy({
        v2_policy: v2Policy,
        legacy_tiers: legacyTiers,
        purpose,
        effective_complexity: complexity,
      });
      conflicts.push(...resolved.conflicts);
      guidance.push(...resolved.guidance);
      if (resolved.source === "legacy" && resolved.route) {
        const purposeBlock = proposed.purposes[purpose];
        if (purposeBlock) {
          const idx = purposeBlock.routes.findIndex(
            (r) => r.complexity === complexity || r.complexity === "any"
          );
          if (idx >= 0) purposeBlock.routes[idx] = resolved.route;
        }
      }
    }
  }

  return {
    proposed_model_policy: proposed,
    legacy_sources: legacyTiers ? { "models.tiers": legacyTiers } : {},
    conflicts,
    guidance,
    writes_performed: false,
  };
}

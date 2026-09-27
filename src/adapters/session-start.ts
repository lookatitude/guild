/**
 * Session-start surface projection for one host family (KTD28, KTD31).
 *
 * Maps the session's host family onto its adapter map and rung plan, and states
 * the two rungs the hooks read from the environment (T10): `GUILD_VERIFY_RUNG`
 * and `GUILD_COMPACTION_RUNG`. No decision is made here; the plan comes from the
 * dispatch domain and the map from `<family>/map.json`.
 */

import type { RungPlan } from "../domains/dispatch";
import { adapterMapForFamily, rungPlanForFamily, rungRowForFamily, type AdapterMap } from "./rung-matrix";

export interface SurfaceProjection {
  /** The lock family the session resolved to, or null for an unknown host. */
  family: string | null;
  map: AdapterMap | null;
  plan: RungPlan;
  /** Env the hooks read for the two runtime-stated rungs. */
  env: { GUILD_VERIFY_RUNG: string; GUILD_COMPACTION_RUNG: string };
  /** One line for the always-on prefix; empty when nothing is lost. */
  summary: string;
}

export function projectSurfaces(
  hostFamily: string | null | undefined,
  opts: { verify_check_available: boolean },
): SurfaceProjection {
  const row = rungRowForFamily(hostFamily);
  const family = row?.family ?? null;
  const plan = rungPlanForFamily(hostFamily, opts);
  const lost = plan.losses.map((l) => l.rung);
  return {
    family,
    map: family ? adapterMapForFamily(family) : null,
    plan,
    env: { GUILD_VERIFY_RUNG: plan.after_edit, GUILD_COMPACTION_RUNG: plan.compaction },
    summary:
      lost.length === 0
        ? ""
        : `Guild on ${family ?? "an unknown host"}: dispatch ${plan.spawn}, skills ${plan.skills}, ` +
          `commands ${plan.commands}, MCP ${plan.mcp}, compaction ${plan.compaction} ` +
          `(rungs not verified here: ${lost.join(", ")}).`,
  };
}

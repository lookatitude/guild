/**
 * src/modules/dispatch/workflows/specialist-contract.ts
 *
 * Minimal specialist routing contract shared by dispatch and capability routing.
 */

/**
 * Optional model-routing provenance for a dispatched specialist (lane T6).
 * Additive + optional: legacy dispatch paths omit it entirely. `v2` requires
 * an active M2 gate; `v2_shadow` marks a legacy dispatch that carried an M1
 * shadow comparison alongside (no dispatch effect).
 */
export interface SpecialistModelProvenance {
  source: "legacy" | "v2" | "v2_shadow";
  dispatch_id?: string;
  resolution_core_hash?: string;
  shadow_comparison_hash?: string;
  /**
   * The model the v2 resolver FROZE for this dispatch. Present ONLY on
   * `source: "v2"` (an active, evidenced M2 gate) — this is the field the
   * dispatch backends consume to actually spawn the lane at the selected
   * model (`dispatchModelForSpecialist`). On `legacy` / `v2_shadow` it is
   * absent, so every backend keeps its legacy model resolution byte-identical.
   */
  selected_model?: string;
  /** Frozen reasoning effort for `selected_model`, when the receipt carried one. */
  selected_effort?: string | null;
}

export interface SpecialistDispatchContract {
  name: string;
  scope: string;
  dependsOn: string[];
  modelProvenance?: SpecialistModelProvenance;
}

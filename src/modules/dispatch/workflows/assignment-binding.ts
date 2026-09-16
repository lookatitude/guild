/**
 * Where an assignment's host and model ids come from (KTD22, R72).
 *
 * The answer is: THIS RUN'S `guild.session_binding.v1`, and nothing else.
 *
 * Durable config is policy — tiers, floors, budgets, scopes. It deliberately
 * cannot name a host family, a host id, or a concrete model, because the same
 * initiative may continue on a different host tomorrow and a committed file that
 * pinned "claude" would silently mis-route it. The binding is written once at run
 * start from detection, is immutable for that run, and assignments COPY from it.
 *
 * The other half is the honest unknown: `binding.models` is `{}` for a host Guild
 * could not identify. That is a BLOCKED dispatch. It is not a Claude default and
 * it is not an empty-but-usable inventory — guessing a model family here is how a
 * run ends up billing an unrelated provider or silently degrading a powerful lane.
 */
import { readSessionBinding, type SessionBinding } from "../../config";
import { deepFreeze } from "../../kernel";
import type { ModelTier } from "./task-cell-contract";

export type AssignmentBindingBlock =
  | "no_binding"
  | "unknown_host"
  | "no_model_for_tier";

export type AssignmentBindingResult =
  | {
      ok: true;
      host_id: string;
      model_id: string;
      model_tier: ModelTier;
      model_family: string;
      binding: SessionBinding;
    }
  | { ok: false; blocked: AssignmentBindingBlock; reason: string };

/** The honest unknown, spelled the same way the binding writer spells it. */
const UNKNOWN = "unknown";

/**
 * Resolve the host + model ids one assignment must carry, for one tier.
 *
 * Every refusal is `blocked`, never a substitution. A caller that wants to
 * proceed anyway must change the host or bind the run again — it cannot talk
 * this function into a default.
 */
export function resolveAssignmentBinding(input: {
  /** Absolute path of the run record directory. */
  runDir: string;
  tier: ModelTier;
  /** Test seam; defaults to the real reader. */
  read?: (runDir: string) => SessionBinding | null;
}): AssignmentBindingResult {
  const binding = (input.read ?? readSessionBinding)(input.runDir);
  if (!binding) {
    return {
      ok: false,
      blocked: "no_binding",
      reason:
        `no guild.session_binding.v1 on the run record at ${input.runDir} — ` +
        `refusing to dispatch. Assignment host and model ids are copied from the ` +
        `run binding; a run with no binding has no host to name (KTD22).`,
    };
  }
  if (binding.host_family === UNKNOWN || binding.host_family === "") {
    return {
      ok: false,
      blocked: "unknown_host",
      reason:
        `run ${binding.run_id} is bound to host_family '${binding.host_family}' — ` +
        `BLOCKED. An unknown host never resolves to Claude; identify the host, ` +
        `then re-bind the run (KTD22).`,
    };
  }
  const modelId = binding.models?.[input.tier];
  if (typeof modelId !== "string" || modelId.length === 0) {
    return {
      ok: false,
      blocked: "no_model_for_tier",
      reason:
        `run ${binding.run_id} binding carries no ${input.tier}-tier model for host ` +
        `'${binding.host_family}' (models: ${JSON.stringify(binding.models ?? {})}) — ` +
        `BLOCKED. An empty model map is the honest unknown, not a usable inventory.`,
    };
  }
  return {
    ok: true,
    host_id: binding.host_family,
    model_id: modelId,
    model_tier: input.tier,
    model_family: binding.model_family,
    binding,
  };
}

export const ASSIGNMENT_BINDING_CONTRACT = deepFreeze({
  source: "guild.session_binding.v1",
  blocks: ["no_binding", "unknown_host", "no_model_for_tier"],
  never: "config, initiative inventory, or a host default",
});

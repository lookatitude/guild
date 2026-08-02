/**
 * src/modules/capability/workflows/confirmation-arbiter.ts
 *
 * Exact-key user-confirmation arbitration (guild.model_resolution.v1 §6;
 * SC-11). Lane T5.
 *
 * Confirmation state is RUN-LOCAL and claimed atomically over the exact key
 * (run_id, purpose, target_id, policy_hash, catalog_hash, fallback_hash).
 * Byte-identical keys share ONE prompt + ONE decision; ANY differing component
 * is a DIFFERENT question with its own prompt. Approval can never leak to
 * another target, purpose, or degradation shape. No duplicate or contradictory
 * prompts/decisions for one key.
 *
 * CONTRACT: pure in-memory state machine (deterministic; no timers, no I/O) —
 * the dispatch integration (lane T6) owns wiring it to real prompts.
 */

export const CONFIRMATION_KEY_COMPONENTS = [
  "run_id",
  "purpose",
  "target_id",
  "policy_hash",
  "catalog_hash",
  "fallback_hash",
] as const;
export type ConfirmationKeyComponent = (typeof CONFIRMATION_KEY_COMPONENTS)[number];

export type ConfirmationKey = Record<ConfirmationKeyComponent, string>;

export interface ConfirmationDecision {
  key: ConfirmationKey;
  decision: string;
  at?: string | null;
}

export interface RunLocalConfirmationState {
  run_id: string;
  /** canonical key → prompt id (claim order, deterministic). */
  prompts: Map<string, number>;
  /** canonical key → recorded decision (verbatim). */
  decisions: Map<string, ConfirmationDecision>;
  next_prompt_id: number;
}

/** Canonicalize the FULL 6-tuple; every component is REQUIRED (fail closed). */
function canonicalKey(key: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const component of CONFIRMATION_KEY_COMPONENTS) {
    const v = key?.[component];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(
        `confirmation_key_incomplete: component "${component}" is required — a partial key can ` +
          `never claim a confirmation (§6 exact-key rule)`
      );
    }
    // Length-prefix each component so no concatenation of values can collide
    // with a different component split (injective encoding).
    parts.push(`${component}=${v.length}:${v}`);
  }
  return parts.join("|");
}

export function createRunLocalState(runId: string): RunLocalConfirmationState {
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error("confirmation state requires a run_id (run-local, §6)");
  }
  return { run_id: runId, prompts: new Map(), decisions: new Map(), next_prompt_id: 0 };
}

/**
 * Claim the prompt for a key. Byte-identical keys share one prompt_id; any
 * differing component claims a NEW prompt. Idempotent: re-claiming an
 * already-decided key reports already_decided (no duplicate prompt).
 */
export function claimPrompt(
  state: RunLocalConfirmationState,
  key: Record<string, unknown>
): { prompt_id: number; already_decided: boolean } {
  const ck = canonicalKey(key);
  if (!state.prompts.has(ck)) {
    state.prompts.set(ck, state.next_prompt_id);
    state.next_prompt_id += 1;
  }
  return {
    prompt_id: state.prompts.get(ck) as number,
    already_decided: state.decisions.has(ck),
  };
}

/**
 * Record the ONE decision for a key (stored verbatim). A second identical
 * decision is idempotent; a CONTRADICTORY decision for the same key throws —
 * one key, one question, one answer.
 */
export function recordDecision(
  state: RunLocalConfirmationState,
  key: Record<string, unknown>,
  decision: { decision: string; at?: string | null }
): ConfirmationDecision {
  const ck = canonicalKey(key);
  const existing = state.decisions.get(ck);
  if (existing) {
    if (existing.decision !== decision.decision) {
      throw new Error(
        `contradictory_decision: key already decided "${existing.decision}" — refusing "${decision.decision}" ` +
          `(one key, one decision; §6)`
      );
    }
    return existing;
  }
  const record: ConfirmationDecision = {
    key: { ...(key as ConfirmationKey) },
    decision: decision.decision,
    at: decision.at ?? null,
  };
  state.decisions.set(ck, record);
  return record;
}

/** The recorded decision for a key, or null — approval NEVER leaks across keys. */
export function decisionFor(
  state: RunLocalConfirmationState,
  key: Record<string, unknown>
): ConfirmationDecision | null {
  return state.decisions.get(canonicalKey(key)) ?? null;
}

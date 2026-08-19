/**
 * src/modules/dispatch/workflows/confirmation-gate.ts
 *
 * T7-M4 — the PRODUCTION wiring for the §6 exact-key confirmation arbiter
 * (guild.model_resolution.v1 §6; SC-11).
 *
 * WHY THIS EXISTS. `confirmation-arbiter.ts` is a correct, injectively-encoded
 * 6-tuple state machine (length-prefixed components, required-component
 * fail-closed, contradictory-decision refusal) — and the T7 security audit
 * found it had NO production callers at all. Its own header assigned the
 * wiring: *"the dispatch integration (lane T6) owns wiring it to real
 * prompts."* Until that happened, nothing prevented ONE degradation approval
 * from being reused across a different target, purpose, or fallback shape —
 * the exact leak the module exists to stop.
 *
 * WHAT THIS ADDS — and what it deliberately does NOT.
 *   - It does NOT re-implement the key encoding. The canonical 6-tuple key is
 *     private to the arbiter, so this module rehydrates state by REPLAYING the
 *     recorded key objects through `claimPrompt`/`recordDecision` in order.
 *     Byte-identical keys therefore collapse under the arbiter's own encoding,
 *     never a weaker one computed here.
 *   - It does NOT approve anything. There is no code path in this file that
 *     can record an approval; a decision is a USER act recorded through the
 *     phase skill's confirmation surface. This module claims the prompt and
 *     reports whether a decision already exists.
 *
 * STATE. Run-local at `<root>/.guild/runs/<run_id>/confirmations/state.json`.
 * Durable (not merely in-process) because "once per run/purpose" must survive
 * the launcher's per-task loop AND separate launcher processes for one run.
 *
 * WRITE DISCIPLINE. Binding-verified before any write, atomic temp+rename, and
 * — per T7-M3 — no injectable fs seam: authorization and effect share the real
 * filesystem by construction.
 */

import * as fs from "fs";
import * as path from "path";

import { assertWritableBinding } from "../../lifecycle";
import {
  CONFIRMATION_KEY_COMPONENTS,
  claimPrompt,
  createRunLocalState,
  decisionFor,
  recordDecision,
  type ConfirmationKey,
  type RunLocalConfirmationState,
} from "../../capability";

export const CONFIRMATION_STATE_SCHEMA = "guild.confirmation_state.v1" as const;

/** Run-dir-relative directory holding the run's confirmation state. */
export const CONFIRMATION_DIR = "confirmations";

export interface ConfirmationEntry {
  /** The EXACT 6-tuple, projected onto the closed component set (L3-safe). */
  key: ConfirmationKey;
  prompt_id: number;
  decision: { decision: string; at: string | null } | null;
}

export interface ConfirmationStateFile {
  schema_version: typeof CONFIRMATION_STATE_SCHEMA;
  run_id: string;
  entries: ConfirmationEntry[];
}

export function confirmationStatePath(root: string, runId: string): string {
  return path.join(root, ".guild", "runs", runId, CONFIRMATION_DIR, "state.json");
}

/**
 * Project a caller object onto the closed 6-tuple. Anything outside
 * CONFIRMATION_KEY_COMPONENTS is DROPPED rather than retained — the same
 * closed-vocabulary hygiene L3 asks for, applied at the persistence boundary
 * so no caller field can ride into a durable record.
 */
export function projectConfirmationKey(key: Record<string, unknown>): ConfirmationKey {
  const out = {} as ConfirmationKey;
  for (const component of CONFIRMATION_KEY_COMPONENTS) {
    const v = key?.[component];
    // Missing/ill-typed components are left absent on purpose: the arbiter's
    // `canonicalKey` then throws `confirmation_key_incomplete` (fail closed).
    if (typeof v === "string") out[component] = v;
  }
  return out;
}

/** Read the persisted entries; an absent/corrupt file yields none (fail closed to "not decided"). */
export function loadConfirmationEntries(root: string, runId: string): ConfirmationEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(confirmationStatePath(root, runId), "utf8"));
  } catch {
    return [];
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>)["schema_version"] !== CONFIRMATION_STATE_SCHEMA
  ) {
    return [];
  }
  const entries = (parsed as ConfirmationStateFile).entries;
  return Array.isArray(entries) ? entries : [];
}

/**
 * Rebuild the arbiter's in-memory state by REPLAYING the recorded entries
 * through the arbiter itself, in claim order. This is what keeps the exact-key
 * semantics single-sourced: the canonical encoding is never recomputed here.
 */
export function rehydrateState(runId: string, entries: ConfirmationEntry[]): RunLocalConfirmationState {
  const state = createRunLocalState(runId);
  for (const entry of [...entries].sort((a, b) => a.prompt_id - b.prompt_id)) {
    claimPrompt(state, entry.key);
    if (entry.decision) recordDecision(state, entry.key, entry.decision);
  }
  return state;
}

export interface ConfirmationClaim {
  /** Stable prompt id for this EXACT key — byte-identical keys share one. */
  prompt_id: number;
  /** True when this exact key already carries a recorded user decision. */
  already_decided: boolean;
  /** The recorded decision verb, or null when the key is still unanswered. */
  decision: string | null;
  /** Absolute path of the durable state file. */
  statePath: string;
}

/**
 * Claim the prompt for one EXACT confirmation key, durably.
 *
 * Fail-closed by construction: a partial key throws inside the arbiter
 * (`confirmation_key_incomplete`), an unverifiable run binding throws before
 * any write, and an unanswered key reports `already_decided: false` — the
 * caller must then block, never assume approval.
 */
export function claimConfirmation(input: {
  root: string;
  binding: { run_id: string; binding_ref: string };
  key: Record<string, unknown>;
}): ConfirmationClaim {
  const runId = input.binding.run_id;
  const key = projectConfirmationKey(input.key);
  const entries = loadConfirmationEntries(input.root, runId);
  const state = rehydrateState(runId, entries);
  const before = state.next_prompt_id;
  const claim = claimPrompt(state, key);
  const existing = decisionFor(state, key);

  const statePath = confirmationStatePath(input.root, runId);
  if (claim.prompt_id >= before) {
    // A NEW key was claimed — persist it. (A repeat claim of a known key
    // changes nothing on disk, so no write and no binding demand.)
    const verified = assertWritableBinding({
      root: input.root,
      run_id: runId,
      binding_ref: input.binding.binding_ref,
    });
    const next: ConfirmationStateFile = {
      schema_version: CONFIRMATION_STATE_SCHEMA,
      run_id: verified.run_id,
      entries: [...entries, { key, prompt_id: claim.prompt_id, decision: null }],
    };
    const dir = path.dirname(confirmationStatePath(input.root, verified.run_id));
    fs.mkdirSync(dir, { recursive: true });
    const target = confirmationStatePath(input.root, verified.run_id);
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, target);
  }

  return {
    prompt_id: claim.prompt_id,
    already_decided: claim.already_decided,
    decision: existing ? existing.decision : null,
    statePath,
  };
}

/**
 * Record the ONE user decision for an EXACT key, durably.
 *
 * The arbiter owns the semantics: a second identical decision is idempotent, a
 * CONTRADICTORY decision for the same key THROWS (one key, one question, one
 * answer), and a partial key throws before anything is touched. This function
 * only persists what the arbiter accepted.
 *
 * NOT an approval channel for agents: the caller is the phase skill's user
 * confirmation surface. Nothing in the dispatch path calls this — dispatch
 * READS a decision (`claimConfirmation`) and blocks when there is none.
 */
export function recordConfirmationDecision(input: {
  root: string;
  binding: { run_id: string; binding_ref: string };
  key: Record<string, unknown>;
  decision: string;
  at?: string | null;
}): ConfirmationEntry {
  if (typeof input.decision !== "string" || input.decision.length === 0) {
    throw new Error("confirmation decision must be a non-empty verb — a blank answer is not a decision");
  }
  const runId = input.binding.run_id;
  const key = projectConfirmationKey(input.key);
  const entries = loadConfirmationEntries(input.root, runId);
  const state = rehydrateState(runId, entries);
  const claim = claimPrompt(state, key);
  // Throws on a contradictory second answer — the §6 refusal, not ours.
  const recorded = recordDecision(state, key, { decision: input.decision, at: input.at ?? null });

  const verified = assertWritableBinding({
    root: input.root,
    run_id: runId,
    binding_ref: input.binding.binding_ref,
  });
  const entry: ConfirmationEntry = {
    key,
    prompt_id: claim.prompt_id,
    decision: { decision: recorded.decision, at: recorded.at ?? null },
  };
  const merged = entries.filter((e) => e.prompt_id !== claim.prompt_id).concat(entry);
  const next: ConfirmationStateFile = {
    schema_version: CONFIRMATION_STATE_SCHEMA,
    run_id: verified.run_id,
    entries: merged.sort((a, b) => a.prompt_id - b.prompt_id),
  };
  const target = confirmationStatePath(input.root, verified.run_id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, target);
  return entry;
}

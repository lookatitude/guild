/**
 * scripts/lib/result-normalizer.ts
 *
 * L3 — result normalizers for the TWO orchestration-result contracts that EXIST
 * in Phase 1 (SC-6): `guild.handoff.v2` and `review_result.v1`. A host emits a
 * result; the normalizer extracts the fenced JSON, VALIDATES it against the real
 * Guild validator, and on failure issues a BOUNDED repair prompt — then
 * FAIL-CLOSES with an explicit schema error. Prose is NEVER accepted as a result.
 *
 * Contract authority (consumed, never redefined):
 *   scripts/lib/result-contracts.ts   — PHASE1_NORMALIZER_TARGETS + CONTRACT_VALIDATORS
 *                                        (binds validateHandoffV2 + parseReviewResult)
 *   hooks/lib/handoff-v2.ts           — extractHandoffEnvelope (the real fence reader)
 *   docs/knowledge/decisions/guild-inventory-and-parity-contracts.md §Result contracts
 *
 * TWO LOAD-BEARING L0 CORRECTIONS (enforced here, not just documented):
 *   1. The real wire string is `review_result.v1` — NO `guild.` prefix. A caller
 *      passing the prose alias `guild.review_result.v1` is NOT a Phase-1 target →
 *      this normalizer FAILS CLOSED (with a pointed hint), never mis-keys silently.
 *   2. The lenient reader lives at scripts/verify-gate-pass.ts (bound via the
 *      registry's CONTRACT_VALIDATORS); we dispatch through it, never re-implement.
 *
 * PURITY: every function here is pure. The bounded-repair loop is parameterized
 * by a `reask` callback so it is host-agnostic and unit-testable (L6 stubs reask);
 * the actual host round-trip lives in scripts/guild-run.ts.
 *
 * Owned by tooling-engineer (L3); consumes L0; feeds L6.
 */

import {
  CONTRACT_VALIDATORS,
  PHASE1_NORMALIZER_TARGETS,
  findContract,
} from "./result-contracts";
import { extractHandoffEnvelope } from "../../hooks/lib/handoff-v2";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface NormalizeResult {
  ok: boolean;
  /** The wire schema_version this normalization targeted. */
  wire_schema_version: string;
  /** The parsed + validated object (null when invalid / unextractable). */
  value: unknown | null;
  /** Structured failure reasons (validator errors or extraction failure). */
  errors: string[];
  /**
   * A bounded-repair prompt to re-ask the host with, present ONLY when the result
   * was extractable-or-not but invalid AND a repair attempt is warranted. Absent
   * on success and on fail-closed-for-unknown-contract (no point repairing a
   * contract we cannot validate).
   */
  repair_prompt?: string;
}

export interface BoundedRepairResult extends NormalizeResult {
  /** How many repair round-trips were consumed (0 = first output validated). */
  rounds_used: number;
  /** True when the bounded budget was exhausted without a valid result. */
  failed_closed: boolean;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/**
 * Extract a JSON object string for `wire` from raw host output. Strategy:
 *   - guild.handoff.v2 → the real extractHandoffEnvelope (```guild.handoff.v2 fence).
 *   - otherwise → a fenced block tagged with the wire string or ```json, else a
 *     bare top-level {...} object. Returns the JSON TEXT (not parsed), or null.
 */
export function extractJsonText(raw: string, wire: string): string | null {
  if (wire === "guild.handoff.v2") {
    const env = extractHandoffEnvelope(raw);
    if (env !== null) return JSON.stringify(env);
    // fall through to generic extraction (a result may use a plain json fence).
  }

  // Fenced block tagged with the wire string, e.g. ```review_result.v1 ... ```
  const taggedRe = new RegExp(
    "```" + wire.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\n([\\s\\S]*?)```"
  );
  const tagged = taggedRe.exec(raw);
  if (tagged && tagged[1]) return tagged[1].trim();

  // Generic ```json fence.
  const jsonFence = /```(?:json)?\s*\n([\s\S]*?)```/.exec(raw);
  if (jsonFence && jsonFence[1]) {
    const candidate = jsonFence[1].trim();
    if (candidate.startsWith("{")) return candidate;
  }

  // Bare object — accepted ONLY when the ENTIRE output is a single JSON object
  // (no surrounding prose). This honors "prose is never accepted as a result":
  // a valid object embedded inside prose does NOT count (it may be incidental,
  // and the lenient review_result reader would otherwise be gamed by it).
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const bare = extractFirstObject(trimmed);
    if (bare !== null && bare === trimmed) return bare;
  }
  return null;
}

/** Find the first balanced top-level {...} substring, or null. */
function extractFirstObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Single-shot normalize
// ---------------------------------------------------------------------------

/** A common prose alias mis-write the L0 ADR warns about (correction #1). */
const PROSE_ALIASES: Record<string, string> = {
  "guild.review_result.v1": "review_result.v1",
};

/**
 * Normalize one raw host result against `wire`. Fail-closed for any contract not
 * in PHASE1_NORMALIZER_TARGETS (deferred/unknown → no validator → reject, never
 * accept). On extraction or validation failure for a real target, returns
 * ok:false WITH a repair_prompt the caller may re-ask with.
 */
export function normalizeResult(raw: string, wire: string): NormalizeResult {
  if (!PHASE1_NORMALIZER_TARGETS.has(wire)) {
    const hint = PROSE_ALIASES[wire]
      ? ` — did you mean "${PROSE_ALIASES[wire]}"? (the real wire string carries no "guild." prefix)`
      : findContract(wire)
        ? " — this contract is DEFERRED (no producer/validator yet); not a Phase-1 normalizer target"
        : " — unknown contract";
    return {
      ok: false,
      wire_schema_version: wire,
      value: null,
      errors: [
        `fail-closed: "${wire}" has no Phase-1 normalizer${hint}. ` +
          `Targets: ${[...PHASE1_NORMALIZER_TARGETS].join(", ")}.`,
      ],
    };
  }

  const validator = CONTRACT_VALIDATORS[wire];
  // PHASE1_NORMALIZER_TARGETS is derived from the same registry that populates
  // CONTRACT_VALIDATORS, so this is defensive only.
  if (!validator) {
    return {
      ok: false,
      wire_schema_version: wire,
      value: null,
      errors: [`fail-closed: no bound validator for "${wire}"`],
    };
  }

  const jsonText = extractJsonText(raw, wire);
  if (jsonText === null) {
    return {
      ok: false,
      wire_schema_version: wire,
      value: null,
      errors: [`no extractable JSON object for "${wire}" in the host output (prose is not accepted)`],
      repair_prompt: buildRepairPrompt(wire, [
        "no fenced JSON block was found",
      ]),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return {
      ok: false,
      wire_schema_version: wire,
      value: null,
      errors: [`extracted block is not valid JSON: ${String(e instanceof Error ? e.message : e)}`],
      repair_prompt: buildRepairPrompt(wire, ["the fenced block was not valid JSON"]),
    };
  }

  const result = validator(parsed);
  if (result.valid) {
    return { ok: true, wire_schema_version: wire, value: parsed, errors: [] };
  }
  return {
    ok: false,
    wire_schema_version: wire,
    value: null,
    errors: result.errors,
    repair_prompt: buildRepairPrompt(wire, result.errors),
  };
}

// ---------------------------------------------------------------------------
// Repair prompt
// ---------------------------------------------------------------------------

/** Build a bounded, explicit repair prompt enumerating exactly what failed. */
export function buildRepairPrompt(wire: string, errors: string[]): string {
  return [
    `Your previous result did not validate against the \`${wire}\` contract.`,
    `Errors:`,
    ...errors.map((e) => `  - ${e}`),
    ``,
    `Re-emit ONLY a single fenced code block, nothing else:`,
    "```" + wire,
    `{ ... a valid ${wire} object ... }`,
    "```",
    `Do not include prose outside the fence. Fix every error listed above.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Bounded repair loop (host-agnostic — reask is injected)
// ---------------------------------------------------------------------------

export interface BoundedRepairOptions {
  /** Max repair round-trips after the initial attempt (default 2). */
  maxRounds?: number;
}

/** Hard ceiling on repair round-trips — defends against a caller passing Infinity/NaN. */
export const MAX_REPAIR_ROUNDS_CEILING = 10;

/** Clamp an arbitrary caller-supplied round budget to a safe, finite, bounded integer. */
export function clampMaxRounds(value: number | undefined): number {
  const v = value ?? 2;
  if (!Number.isSafeInteger(v) || v < 0) return 2;
  return Math.min(v, MAX_REPAIR_ROUNDS_CEILING);
}

/**
 * Validate `initialRaw`; on failure, re-ask via `reask(repairPrompt)` up to
 * `maxRounds` times. After the budget is exhausted without a valid result, FAIL
 * CLOSED — return ok:false, failed_closed:true, with the explicit schema errors.
 * Never returns a prose/unvalidated value.
 *
 * Pure w.r.t. this module: the only side effect is the injected `reask` callback,
 * which the caller (guild-run.ts) wires to a real host round-trip and L6 stubs.
 */
export function normalizeWithRepair(
  initialRaw: string,
  wire: string,
  reask: (repairPrompt: string) => string,
  opts: BoundedRepairOptions = {}
): BoundedRepairResult {
  const maxRounds = clampMaxRounds(opts.maxRounds);

  let current = normalizeResult(initialRaw, wire);
  if (current.ok) {
    return { ...current, rounds_used: 0, failed_closed: false };
  }
  // Unknown/deferred contracts have no repair_prompt — fail closed immediately.
  if (current.repair_prompt === undefined) {
    return { ...current, rounds_used: 0, failed_closed: true };
  }

  let rounds = 0;
  while (rounds < maxRounds) {
    rounds++;
    const repairPrompt = current.repair_prompt ?? buildRepairPrompt(wire, current.errors);
    const nextRaw = reask(repairPrompt);
    current = normalizeResult(nextRaw, wire);
    if (current.ok) {
      return { ...current, rounds_used: rounds, failed_closed: false };
    }
  }

  return {
    ok: false,
    wire_schema_version: wire,
    value: null,
    errors: [
      `fail-closed after ${rounds} bounded repair round(s): result never validated against "${wire}".`,
      ...current.errors,
    ],
    rounds_used: rounds,
    failed_closed: true,
  };
}

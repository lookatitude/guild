/**
 * src/domains/distribution/review-gate-pass.ts
 *
 * The pure 5-condition gate-pass evaluator (G-6 / SC-2), lifted from
 * scripts/verify-gate-pass.ts so domain callers (the TaskCell controller's broker
 * authority) consume the SAME function the CLI runs. The CLI is now a shim over
 * this module; its stdout/exit contract is unchanged.
 *
 * The five conditions:
 *   1. parses          — the result parses as "review_result.v1" (lenient reader).
 *   2. packet_id_match — result.packet_id matches packetId (when given).
 *   3. sha256_match    — result.artifact_sha256_reviewed == sha256(current bytes).
 *   4. satisfied       — result.verdict == "satisfied" OR forcePass.
 *   5. no_blockers     — blocking_findings is empty.
 */

import { createHash } from "node:crypto";
import { parseReviewResult } from "./review-result";

export interface GatePassConditions {
  parses: boolean;
  packet_id_match: boolean;
  sha256_match: boolean;
  satisfied: boolean;
  no_blockers: boolean;
}

export interface GatePassVerdict {
  pass: boolean;
  conditions: GatePassConditions;
  recomputed_sha256: string;
  reasons: string[];
}

/** SHA-256 hex digest over raw bytes — the same digest the artifact bus uses. */
export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Evaluate the 5-condition gate-pass. Pure: takes the raw result text (or null
 * when the result file was unreadable) + the current artifact bytes.
 */
export function evaluateGatePass(opts: {
  resultRaw: string | null;
  artifactBytes: Buffer;
  packetId?: string;
  forcePass?: boolean;
}): GatePassVerdict {
  const recomputed = sha256Hex(opts.artifactBytes);
  const reasons: string[] = [];

  if (opts.resultRaw === null) {
    reasons.push("result file unreadable");
    return {
      pass: false,
      conditions: {
        parses: false,
        packet_id_match: false,
        sha256_match: false,
        satisfied: opts.forcePass === true,
        no_blockers: false,
      },
      recomputed_sha256: recomputed,
      reasons,
    };
  }

  const { result, reasons: parseReasons } = parseReviewResult(opts.resultRaw);
  if (result === null) {
    reasons.push(...parseReasons.map((r) => `parse: ${r}`));
    return {
      pass: false,
      conditions: {
        parses: false,
        packet_id_match: false,
        sha256_match: false,
        satisfied: opts.forcePass === true,
        no_blockers: false,
      },
      recomputed_sha256: recomputed,
      reasons,
    };
  }

  // Condition 2 — packet binding (vacuous when no expected id was supplied).
  const packetIdMatch =
    opts.packetId === undefined || result.packet_id === opts.packetId;
  if (!packetIdMatch) {
    reasons.push(
      `packet_id mismatch: result has "${result.packet_id}", expected "${opts.packetId}"`
    );
  }

  // Condition 3 — checksum binding (recomputed now, over the current bytes).
  const sha256Match =
    result.artifact_sha256_reviewed.toLowerCase() === recomputed.toLowerCase();
  if (!sha256Match) {
    reasons.push(
      `artifact_sha256_reviewed (${result.artifact_sha256_reviewed}) does not match ` +
        `recomputed sha256 (${recomputed}) — artifact changed mid-review; reject + restart the round`
    );
  }

  // Condition 4 — verdict satisfied OR human force-pass.
  const satisfied = result.verdict === "satisfied" || opts.forcePass === true;
  if (!satisfied) {
    reasons.push(
      `verdict is "${result.verdict}" (not "satisfied") and no --force-pass was given`
    );
  }

  // Condition 5 — no blocking findings remain.
  const noBlockers = result.blocking_findings.length === 0;
  if (!noBlockers) {
    reasons.push(
      `blocking_findings is not empty (${result.blocking_findings.length} remaining)`
    );
  }

  const conditions: GatePassConditions = {
    parses: true,
    packet_id_match: packetIdMatch,
    sha256_match: sha256Match,
    satisfied,
    no_blockers: noBlockers,
  };
  const pass =
    conditions.parses &&
    conditions.packet_id_match &&
    conditions.sha256_match &&
    conditions.satisfied &&
    conditions.no_blockers;
  return { pass, conditions, recomputed_sha256: recomputed, reasons };
}

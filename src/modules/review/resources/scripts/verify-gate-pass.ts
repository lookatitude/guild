#!/usr/bin/env -S npx tsx
/**
 * scripts/verify-gate-pass.ts
 *
 * Deterministic checksum-bound gate-pass verifier (G-6 / SC-2) — the code-side
 * enforcement of the review broker's 5-condition gate-pass rule
 * (skills/meta/review-broker/SKILL.md §"Gate-pass rule (checksum-bound, SK-9)").
 *
 * WHY THIS EXISTS: the gate-pass was previously enforced only in SKILL.md prose
 * (the model "computes" the SHA-256 and "evaluates" five conditions). A security
 * step described only in model prose is unreliable — this CLI makes the
 * computation deterministic; the broker CONSUMES the verdict, never re-derives.
 *
 * No LLM. No network. Same inputs → same output every time.
 *
 * Usage:
 *   npx tsx scripts/verify-gate-pass.ts \
 *     --result <result-round.json> --artifact <artifact-file> \
 *     [--packet-id <id>] [--force-pass]
 *
 * --result     Path to the round's `review_result.v1` envelope
 *              (.guild/runs/<run-id>/review/<gate>/result-<round>.json).
 * --artifact   Path to the CURRENT (post-scrub) artifact bytes. The SHA-256 is
 *              recomputed here over these bytes (node:crypto) — never trusted
 *              from the result.
 * --packet-id  The packet id the broker issued for the round. When given,
 *              condition 2 requires `result.packet_id` to match it exactly;
 *              when omitted, condition 2 is vacuously satisfied (still requires
 *              a parsed result).
 * --force-pass Human force_pass: satisfies condition 4 regardless of verdict.
 *              Conditions 1/2/3/5 still apply — force-pass relaxes the verdict,
 *              never the checksum/blocker gate.
 *
 * The five conditions (mirroring the SKILL.md rule verbatim):
 *   1. parses          — the result parses as `review_result.v1` (lenient
 *                        reader: required fields packet_id,
 *                        artifact_sha256_reviewed, verdict, blocking_findings;
 *                        a present schema_version must equal "review_result.v1").
 *   2. packet_id_match — result.packet_id matches --packet-id (when given).
 *   3. sha256_match    — result.artifact_sha256_reviewed == sha256(current
 *                        artifact bytes), recomputed now.
 *   4. satisfied       — result.verdict == "satisfied" OR --force-pass.
 *   5. no_blockers     — blocking_findings is empty.
 *
 * Stdout: JSON { pass, conditions: { parses, packet_id_match, sha256_match,
 *                satisfied, no_blockers }, recomputed_sha256, reasons[] }
 * Exit:   0 pass · 2 fail · 1 usage error (missing flags / unreadable artifact).
 */

import * as fs from "node:fs";
import { createHash } from "node:crypto";
import {
  parseReviewResult,
  type ReviewResultMinimal,
} from "../src/modules/distribution/workflows/review-result";
export {
  parseReviewResult,
  type ReviewResultMinimal,
} from "../src/modules/distribution/workflows/review-result";

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Pure helpers ─────────────────────────────────────────────────────────────

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

// ── Arg parsing (pure, testable) ─────────────────────────────────────────────

export interface VerifyGatePassArgs {
  resultPath: string;
  artifactPath: string;
  packetId?: string;
  forcePass: boolean;
}

const USAGE =
  "usage: verify-gate-pass.ts --result <result-round.json> --artifact <artifact-file> " +
  "[--packet-id <id>] [--force-pass]";

export function parseVerifyGatePassArgs(
  argv: string[]
): VerifyGatePassArgs | { error: string } {
  let resultPath: string | undefined;
  let artifactPath: string | undefined;
  let packetId: string | undefined;
  let forcePass = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--result" && argv[i + 1] !== undefined) {
      resultPath = argv[++i];
    } else if (arg.startsWith("--result=")) {
      resultPath = arg.slice("--result=".length);
    } else if (arg === "--artifact" && argv[i + 1] !== undefined) {
      artifactPath = argv[++i];
    } else if (arg.startsWith("--artifact=")) {
      artifactPath = arg.slice("--artifact=".length);
    } else if (arg === "--packet-id" && argv[i + 1] !== undefined) {
      packetId = argv[++i];
    } else if (arg.startsWith("--packet-id=")) {
      packetId = arg.slice("--packet-id=".length);
    } else if (arg === "--force-pass") {
      forcePass = true;
    } else {
      return { error: `unknown argument: ${arg}\n${USAGE}` };
    }
  }
  if (!resultPath || !artifactPath) return { error: USAGE };
  const out: VerifyGatePassArgs = { resultPath, artifactPath, forcePass };
  if (packetId !== undefined) out.packetId = packetId;
  return out;
}

// ── CLI entry ────────────────────────────────────────────────────────────────

function main(): number {
  const parsed = parseVerifyGatePassArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    return 1;
  }

  // The artifact MUST be readable — without bytes there is nothing to bind the
  // gate to (usage error, not a gate fail).
  let artifactBytes: Buffer;
  try {
    artifactBytes = fs.readFileSync(parsed.artifactPath);
  } catch {
    process.stderr.write(
      `verify-gate-pass: cannot read artifact: ${parsed.artifactPath}\n`
    );
    return 1;
  }

  // A missing/unreadable result is a GATE FAIL (condition 1), not a usage error
  // — "no result" must never pass a gate.
  let resultRaw: string | null;
  try {
    resultRaw = fs.readFileSync(parsed.resultPath, "utf8");
  } catch {
    resultRaw = null;
  }

  const verdict = evaluateGatePass({
    resultRaw,
    artifactBytes,
    packetId: parsed.packetId,
    forcePass: parsed.forcePass,
  });
  process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  return verdict.pass ? 0 : 2;
}

if (require.main === module) {
  process.exit(main());
}

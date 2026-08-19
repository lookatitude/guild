#!/usr/bin/env -S npx tsx
/**
 * scripts/emit-release-conformance.ts
 *
 * RELEASE-CONFORMANCE EMITTER — FIC-91 / REL-P0 (FIC-74 corrected promotion
 * sequence, §0/B5). The deterministic producer of `guild.release_conformance.v1`
 * — and, optionally, the paired `guild.release_promotion.v1` — that REL-P1 runs
 * against the `next` tip (SHA-T) before a release branch may be cut.
 *
 * WHAT IT DOES, in order, failing closed at each step:
 *   1. verifies the frozen 31-scenario contract by EXACT bytes (SHA-256 pin);
 *   2. reads an explicit evaluator package: the `evidence`
 *      (`NeutralConformanceEvidence`) and `authority`
 *      (`guild.conformance_authority.v1`) inputs — the emitter GATHERS nothing
 *      and can therefore invent nothing;
 *   3. binds both inputs to the requested source commit;
 *   4. re-runs the FULL A21-X integration/assembly decision
 *      (`evaluateTransportedReleaseConformance`, the seam this emitter shares
 *      with the promotion gate): the package's evidence must cover exactly the
 *      31-scenario frozen suite, the six owner packets are re-derived from
 *      source-owned slices and re-joined by the REAL assembler, and the
 *      production `evaluateNeutralConformanceDecision` — including the
 *      trust-root attestation signature verification no claimant can satisfy
 *      on its own — takes the only decision. It refuses otherwise;
 *   5. writes a deterministic record that transports the full evaluator inputs,
 *      so the promotion gate (`check-channel-integrity.ts promotion`) re-runs
 *      the same decision instead of trusting this emitter's verdict.
 *
 * THE FULL-SUITE (31/31) TRUTH — A21-X. Production owns all 31 scenarios
 * through `release-conformance-integration` (six real owner evaluations joined
 * by the real assembler). A record may name 31/31 ONLY when all 31 were
 * genuinely evaluated and assembled AND the production decision is promotable.
 * The historical honest-5/31 evaluator package is therefore no longer an
 * emittable release claim: it refuses at the full-suite coverage check and
 * writes nothing. Because the repository holds no production attestor
 * material, every in-repo emission path fails closed by construction; a
 * promotable 31/31 record remains an operator act with externally provisioned
 * authority.
 *
 * Usage:
 *   npx tsx scripts/emit-release-conformance.ts \
 *     --suite <frozen-contract.json> --package <evaluator-package.json> \
 *     --source-commit <sha> --out <conformance.json> \
 *     [--promotion-out <promotion.json> --version X.Y.Z] [--force]
 *
 * Exit: 0 emitted · 2 refusal (fail closed) · 1 usage/IO error.
 *
 * Deterministic on purpose: no clock reads and no environment reads. The
 * `generated_at` field is TRUTHFUL provenance — a REQUIRED, validated,
 * caller-supplied UTC instant (`--generated-at`), canonicalized to millisecond
 * ISO-8601 — never a defaulted or epoch value masquerading as a generation
 * time. Same inputs (including the supplied instant) produce identical bytes,
 * which is what makes the promotion hash binding auditable.
 *
 * PAIRED-EMISSION TRANSACTION (FIC-92 blocker 1). Both records are serialized
 * first, then STAGED as collision-safe temp files inside their destination
 * directories, then PUBLISHED — without `--force` via hard link (atomic,
 * refuses an existing destination even one that appeared after the pre-flight
 * check), with `--force` via rename (atomic replace). If the second
 * publication fails or collides, the already-published first final is rolled
 * back and every temp is removed, so no TESTED failure or race path leaves a
 * partial pair, and errors are classified truthfully (`output_exists` for a
 * real destination collision, `output_io_error` for I/O failure). HONEST
 * LIMIT: the two publications are two syscalls — a process CRASH between them
 * can still leave the first final behind (per-file link/rename is atomic;
 * the pair is not), which the pre-flight existence check surfaces as
 * `output_exists` on retry. Under `--force` the append-only/rollback
 * guarantees are explicitly forfeited (rename has already replaced the first
 * destination). No stronger crash-atomicity is claimed because the filesystem
 * primitives do not provide it.
 *
 * Owned by tooling-engineer, registered to the distribution module.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomBytes } from "node:crypto";

import {
  FROZEN_SCENARIO_CONTRACT_COUNT,
  FROZEN_SCENARIO_CONTRACT_IDS,
  FROZEN_SCENARIO_CONTRACT_SHA256,
  RELEASE_CONFORMANCE_SCHEMA,
  RELEASE_PROMOTION_SCHEMA,
} from "./check-channel-integrity";
import { NEUTRAL_SCENARIO_SUITE_ID } from "../src/modules/lifecycle/workflows/neutral-conformance-core";
import { evaluateTransportedReleaseConformance } from "../src/modules/distribution/workflows/release-conformance-integration";

export { RELEASE_CONFORMANCE_SCHEMA, RELEASE_PROMOTION_SCHEMA };

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
const BARE_TRIPLE_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const GENERATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export interface EmitOptions {
  suitePath: string;
  packagePath: string;
  sourceCommit: string;
  outPath: string;
  /**
   * REQUIRED truthful generation instant, UTC ISO-8601
   * (`YYYY-MM-DDTHH:MM:SS[.mmm]Z`), canonicalized to millisecond form. There
   * is no default: provenance the tool invents is not provenance.
   */
  generatedAt: string;
  /** Also emit the paired guild.release_promotion.v1, hash-bound to the record. */
  promotionOut?: string;
  /** Required with promotionOut: the bare stable version the record promotes. */
  version?: string;
  /**
   * Overwrite existing outputs. Default: refuse (append-only discipline).
   * Forfeits the pair-rollback guarantee: rename replaces the first
   * destination before the second publishes.
   */
  force?: boolean;
  /**
   * TEST-ONLY seam: invoked after both records are staged and before
   * publication, to open the race window the controls exercise. Never set in
   * production use.
   */
  onStaged?: () => void;
}

export interface EmitOutcome {
  ok: boolean;
  /** `emitted`, or the specific refusal/usage cause. */
  code: string;
  detail: string;
}

function refuse(code: string, detail: string): EmitOutcome {
  return { ok: false, code, detail };
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function emitReleaseConformance(opts: EmitOptions): EmitOutcome {
  if (!COMMIT_SHA_RE.test(opts.sourceCommit)) {
    return refuse("source_commit_malformed", `--source-commit ${JSON.stringify(opts.sourceCommit)} is not a 40-hex commit sha.`);
  }
  if (opts.generatedAt === undefined || opts.generatedAt === null || opts.generatedAt === "") {
    return refuse(
      "generated_at_missing",
      "--generated-at is required: the generation instant is provenance and is never defaulted or invented."
    );
  }
  if (typeof opts.generatedAt !== "string" || !GENERATED_AT_RE.test(opts.generatedAt)) {
    return refuse(
      "generated_at_malformed",
      `--generated-at ${JSON.stringify(opts.generatedAt)} must be UTC ISO-8601 (YYYY-MM-DDTHH:MM:SS[.mmm]Z).`
    );
  }
  // Canonicalize to millisecond form and require an exact round-trip, so an
  // impossible calendar instant (e.g. Feb 30) cannot slip through Date's
  // rollover behaviour.
  const parsedInstant = new Date(opts.generatedAt);
  const canonicalGeneratedAt = Number.isNaN(parsedInstant.getTime()) ? null : parsedInstant.toISOString();
  const normalizedInput = opts.generatedAt.includes(".")
    ? opts.generatedAt
    : opts.generatedAt.replace(/Z$/, ".000Z");
  if (canonicalGeneratedAt === null || canonicalGeneratedAt !== normalizedInput) {
    return refuse(
      "generated_at_malformed",
      `--generated-at ${JSON.stringify(opts.generatedAt)} does not round-trip to a real UTC instant.`
    );
  }

  // 1 — the frozen scenario contract, by exact bytes.
  let suiteBytes: Buffer;
  try {
    suiteBytes = fs.readFileSync(opts.suitePath);
  } catch (err) {
    return refuse("scenario_contract_unreadable", `cannot read ${opts.suitePath}: ${String(err instanceof Error ? err.message : err)}`);
  }
  const suiteSha = sha256Hex(suiteBytes);
  if (suiteSha !== FROZEN_SCENARIO_CONTRACT_SHA256) {
    return refuse(
      "scenario_contract_hash_mismatch",
      `${opts.suitePath} hashes to ${suiteSha}; the frozen ${FROZEN_SCENARIO_CONTRACT_COUNT}-scenario contract is ` +
        `${FROZEN_SCENARIO_CONTRACT_SHA256}. A conformance record may only be emitted against the frozen bytes.`
    );
  }
  let suite: { schema_version?: unknown; contract_id?: unknown; contract_version?: unknown; scenarios?: unknown };
  try {
    suite = JSON.parse(suiteBytes.toString("utf8"));
  } catch {
    return refuse("scenario_contract_malformed", `${opts.suitePath} is not JSON.`);
  }
  const scenarios = Array.isArray(suite.scenarios) ? suite.scenarios : null;
  if (suite.schema_version !== NEUTRAL_SCENARIO_SUITE_ID || scenarios === null || scenarios.length !== FROZEN_SCENARIO_CONTRACT_COUNT) {
    return refuse(
      "scenario_contract_malformed",
      `${opts.suitePath} does not declare ${NEUTRAL_SCENARIO_SUITE_ID} with exactly ${FROZEN_SCENARIO_CONTRACT_COUNT} scenarios.`
    );
  }
  // Defense in depth: the hash pin already fixes the bytes, but the emitted
  // record must NAME the canonical id tuple, so cross-check it explicitly.
  const suiteIds = scenarios.map((s) => (s as { stable_id?: unknown })?.stable_id);
  if (
    suiteIds.length !== FROZEN_SCENARIO_CONTRACT_IDS.length ||
    FROZEN_SCENARIO_CONTRACT_IDS.some((id, index) => suiteIds[index] !== id)
  ) {
    return refuse(
      "scenario_contract_malformed",
      `${opts.suitePath} does not carry the canonical frozen scenario id tuple in order.`
    );
  }

  // 2 — the explicit evaluator package.
  let packageRaw: Buffer;
  try {
    packageRaw = fs.readFileSync(opts.packagePath);
  } catch (err) {
    return refuse("package_unreadable", `cannot read ${opts.packagePath}: ${String(err instanceof Error ? err.message : err)}`);
  }
  let evaluatorPackage: { evidence?: unknown; authority?: unknown };
  try {
    evaluatorPackage = JSON.parse(packageRaw.toString("utf8"));
  } catch {
    return refuse("package_malformed", `${opts.packagePath} is not JSON.`);
  }
  const evidence = evaluatorPackage?.evidence as Record<string, unknown> | undefined;
  const authority = evaluatorPackage?.authority as Record<string, unknown> | undefined;
  if (typeof evidence !== "object" || evidence === null) {
    return refuse("package_malformed", `${opts.packagePath} carries no evidence object.`);
  }
  if (typeof authority !== "object" || authority === null) {
    return refuse("package_malformed", `${opts.packagePath} carries no authority object.`);
  }

  // 3 — source-commit binding: the caller's requested commit must be the one
  //     BOTH the claimant evidence and the independent authority already name.
  const activatedRuntime = (evidence.activated_runtime ?? {}) as Record<string, unknown>;
  const authorityIdentity = (authority.identity ?? {}) as Record<string, unknown>;
  if (activatedRuntime.source_commit !== opts.sourceCommit || authorityIdentity.source_commit !== opts.sourceCommit) {
    return refuse(
      "source_commit_binding_mismatch",
      `--source-commit ${opts.sourceCommit} is not the commit the package binds ` +
        `(evidence.activated_runtime.source_commit=${JSON.stringify(activatedRuntime.source_commit)}, ` +
        `authority.identity.source_commit=${JSON.stringify(authorityIdentity.source_commit)}).`
    );
  }

  // Validate promotion options BEFORE any write, so a refusal writes nothing.
  if (opts.promotionOut !== undefined) {
    if (opts.version === undefined) {
      return refuse("version_missing", "--promotion-out requires --version X.Y.Z.");
    }
    if (!BARE_TRIPLE_RE.test(opts.version)) {
      return refuse(
        "version_not_bare",
        `--version ${JSON.stringify(opts.version)} must be a bare MAJOR.MINOR.PATCH — a stable promotion record ` +
          `never names a prerelease.`
      );
    }
    if (path.resolve(opts.outPath) === path.resolve(opts.promotionOut)) {
      return refuse(
        "output_paths_overlap",
        "--out and --promotion-out must resolve to distinct destinations; one record may not replace the other."
      );
    }
  }
  if (opts.force !== true && fs.existsSync(opts.outPath)) {
    return refuse("output_exists", `${opts.outPath} already exists; evidence records are append-only (use --force to overwrite).`);
  }
  if (opts.force !== true && opts.promotionOut !== undefined && fs.existsSync(opts.promotionOut)) {
    return refuse("output_exists", `${opts.promotionOut} already exists; evidence records are append-only (use --force to overwrite).`);
  }

  // 4 — the FULL A21-X integration/assembly decision (the same seam the
  //     promotion gate re-runs). Nothing here is this script's judgement:
  //     coverage completeness, re-assembly, and the promotion decision are the
  //     integration's and the production core's own.
  const transported = evaluateTransportedReleaseConformance(evidence, authority);
  if (transported.stage === "coverage") {
    return refuse(
      "scenario_coverage_incomplete",
      `the package's evidence does not cover the full ${FROZEN_SCENARIO_CONTRACT_COUNT}-scenario frozen suite: ` +
        `${transported.detail}. A release record may name 31/31 only when all 31 scenarios were genuinely ` +
        `evaluated and assembled, so an incomplete package (including the historical honest 5/31 shape) emits ` +
        `nothing.`
    );
  }
  if (!transported.promotable) {
    return refuse(
      "evaluator_not_promotable",
      `the full integration/assembly decision did not promote (stage=${transported.stage}): ` +
        `${transported.detail}. No conformance record is emitted for a non-promotable decision.`
    );
  }
  const outcome = transported.outcome;
  if (outcome === null) {
    return refuse(
      "evaluator_not_promotable",
      "the integration decision reported promotable without a decision outcome — refusing rather than " +
        "recording an unattributable verdict."
    );
  }

  // 5 — the deterministic record, transporting the full evaluator inputs.
  const record = {
    schema_version: RELEASE_CONFORMANCE_SCHEMA,
    generated_at: canonicalGeneratedAt,
    source_commit: opts.sourceCommit,
    scenario_contract_sha256: FROZEN_SCENARIO_CONTRACT_SHA256,
    scenario_contract: {
      schema_version: suite.schema_version,
      contract_id: suite.contract_id,
      contract_version: suite.contract_version,
      sha256: FROZEN_SCENARIO_CONTRACT_SHA256,
      scenario_count: scenarios.length,
      scenario_ids: [...FROZEN_SCENARIO_CONTRACT_IDS],
    },
    scenario_coverage: {
      evaluator:
        "evaluateTransportedReleaseConformance (src/modules/distribution/workflows/release-conformance-integration.ts, " +
        "A21-X full-suite integration; six re-derived owner packets re-joined by assembleNeutralConformanceEvidence, " +
        "decision by evaluateNeutralConformanceDecision)",
      evaluated_scenario_ids: [...FROZEN_SCENARIO_CONTRACT_IDS],
      evaluated_scenario_count: FROZEN_SCENARIO_CONTRACT_COUNT,
      unevaluated_scenario_count: 0,
      statement:
        `The frozen contract pins ${scenarios.length} scenarios by SHA-256. All ${FROZEN_SCENARIO_CONTRACT_COUNT} ` +
        `scenarios were genuinely evaluated by their six production owner boundaries, assembled by the real ` +
        `assembler, and the production decision promoted the re-assembled aggregate. This record names 31/31 ` +
        `only because that full evaluation and assembly actually ran.`,
    },
    activated_runtime: evidence.activated_runtime,
    evidence,
    authority,
    decision: {
      type: outcome.type,
      disposition: outcome.disposition,
      reason_code: outcome.reason_code ?? null,
      may_promote_conformant: true,
      assertions: outcome.assertions,
    },
  };
  const recordBytes = Buffer.from(JSON.stringify(record, null, 2) + "\n");
  const plan: Array<{ finalPath: string; bytes: Buffer }> = [{ finalPath: opts.outPath, bytes: recordBytes }];
  if (opts.promotionOut !== undefined) {
    const promotion = {
      schema_version: RELEASE_PROMOTION_SCHEMA,
      version: opts.version,
      source_commit: opts.sourceCommit,
      evidence_sha256: sha256Hex(recordBytes),
      decision: "conformance_pass",
    };
    plan.push({ finalPath: opts.promotionOut, bytes: Buffer.from(JSON.stringify(promotion, null, 2) + "\n") });
  }
  return publishReleaseRecordsAllOrNothing(plan, opts.force === true, opts.onStaged);
}

/** Remove a path, tolerating its absence. Best-effort by design: cleanup after
 *  a refusal must never mask the original refusal with its own throw. */
function removeQuietly(target: string): void {
  try {
    fs.unlinkSync(target);
  } catch {
    /* absent or already gone */
  }
}

/**
 * Stage → (race window) → publish, all-or-nothing against every tested
 * failure and race path. See the module header for the exact transactional
 * contract and its honest crash-window limit.
 *
 * EXPORTED as the publication-mechanics seam (A21-X): with every in-repo
 * emission refusing before the write (no promotable full-suite package can
 * exist without external attestor provisioning), this export is what keeps the
 * atomic paired-emission, rollback, and append-only controls EXERCISABLE — the
 * focused suite drives the exact code path `emitReleaseConformance` publishes
 * through. It is not reachable from the CLI or any caller payload, and it
 * accepts only already-serialized bytes: no packet, outcome, authority,
 * required set, or verdict can be injected through it.
 */
export function publishReleaseRecordsAllOrNothing(
  plan: Array<{ finalPath: string; bytes: Buffer }>,
  force: boolean,
  onStaged?: () => void
): EmitOutcome {
  const staged: Array<{ tmpPath: string; finalPath: string }> = [];
  const cleanupTemps = (): void => {
    for (const entry of staged) removeQuietly(entry.tmpPath);
  };

  // STAGE: collision-safe temps inside each destination directory (same
  // filesystem as the final path, so link/rename can be atomic).
  for (const entry of plan) {
    const tmpPath = path.join(
      path.dirname(entry.finalPath),
      `.${path.basename(entry.finalPath)}.tmp-${process.pid.toString(16)}${randomBytes(6).toString("hex")}`
    );
    try {
      fs.writeFileSync(tmpPath, entry.bytes, { flag: "wx" });
    } catch (err) {
      cleanupTemps();
      return refuse(
        "output_io_error",
        `staging ${entry.finalPath} failed: ${String(err instanceof Error ? err.message : err)} — nothing was published.`
      );
    }
    staged.push({ tmpPath, finalPath: entry.finalPath });
  }

  onStaged?.();

  // PUBLISH in order; on any collision or failure, roll back every final this
  // call already published and clean all temps — no partial pair.
  const published: string[] = [];
  const rollback = (): void => {
    for (const finalPath of published) removeQuietly(finalPath);
    cleanupTemps();
  };
  for (const entry of staged) {
    try {
      if (force) {
        fs.renameSync(entry.tmpPath, entry.finalPath);
      } else {
        fs.linkSync(entry.tmpPath, entry.finalPath);
        removeQuietly(entry.tmpPath);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (!force && code === "EEXIST") {
        rollback();
        return refuse(
          "output_exists",
          `${entry.finalPath} appeared before publication; evidence records are append-only — ` +
            `already-published paired records were rolled back and no partial pair remains.`
        );
      }
      const rollbackNote = force && published.length > 0
        ? " NOTE: --force had already replaced an earlier destination; the append-only rollback guarantee is forfeited under --force."
        : " Already-published paired records were rolled back and no partial pair remains.";
      if (!force) rollback();
      else cleanupTemps();
      return refuse(
        "output_io_error",
        `publishing ${entry.finalPath} failed: ${String(err instanceof Error ? err.message : err)}.${rollbackNote}`
      );
    }
    published.push(entry.finalPath);
  }

  return { ok: true, code: "emitted", detail: plan[0].finalPath };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const opts: Partial<EmitOptions> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--suite" && argv[i + 1] !== undefined) opts.suitePath = argv[++i];
    else if (a === "--package" && argv[i + 1] !== undefined) opts.packagePath = argv[++i];
    else if (a === "--source-commit" && argv[i + 1] !== undefined) opts.sourceCommit = argv[++i];
    else if (a === "--generated-at" && argv[i + 1] !== undefined) opts.generatedAt = argv[++i];
    else if (a === "--out" && argv[i + 1] !== undefined) opts.outPath = argv[++i];
    else if (a === "--promotion-out" && argv[i + 1] !== undefined) opts.promotionOut = argv[++i];
    else if (a === "--version" && argv[i + 1] !== undefined) opts.version = argv[++i];
    else if (a === "--force") opts.force = true;
    else {
      process.stderr.write(`unknown argument: ${a}\n${USAGE}`);
      return 1;
    }
  }
  if (!opts.suitePath || !opts.packagePath || !opts.sourceCommit || !opts.outPath || !opts.generatedAt) {
    process.stderr.write(`missing required argument(s)\n${USAGE}`);
    return 1;
  }

  const result = emitReleaseConformance(opts as EmitOptions);
  if (result.ok) {
    process.stdout.write(`emit-release-conformance: emitted ${result.detail}\n`);
    return 0;
  }
  if (["output_exists", "output_io_error", "version_missing", "generated_at_missing"].includes(result.code)) {
    process.stderr.write(`emit-release-conformance: ${result.detail}\n`);
    return 1;
  }
  process.stderr.write(`emit-release-conformance: REFUSED — [${result.code}] ${result.detail}\n`);
  return 2;
}

const USAGE =
  "usage: emit-release-conformance.ts --suite <frozen-contract.json> --package <evaluator-package.json> " +
  "--source-commit <sha> --generated-at <UTC ISO-8601> --out <conformance.json> " +
  "[--promotion-out <promotion.json> --version X.Y.Z] [--force]\n";

if (require.main === module) {
  process.exit(main());
}

// benchmark/src/loop.ts — P4 learning-loop orchestrator (T2-backend).
//
// Implements the architect's two-stage CLI per
// `benchmark/plans/p4-learning-loop-architecture.md §3 + §4 + §5` and
// `adr-005-learning-loop-orchestrator.md §Decision`. The loop is a
// caller of runner.ts; it never spawns `claude` itself, and it never
// writes plugin source. The seam between `--start` and `--continue` is
// the on-disk manifest at `runs/<baseline-run-id>/loop-manifest.json`.
//
// CHANGELOG / mitigation cross-walk (P4-required from
// `benchmark/plans/security-review-p4.md`):
//
//   M1  (F1.1)  Operator-driven only — the loop never auto-applies a
//                proposal. The two-stage CLI (`--start` then
//                `--continue`) is the architectural boundary; this file
//                contains zero code paths that edit plugin source.
//                See: validateContinue() preconditions, no fs.writeFile
//                outside runs/<id>/ and the manifest itself.
//   M2  (F2.1 rule 3) plugin_ref delta — `--continue` re-reads
//                `git rev-parse HEAD` (truth source: git, not the
//                manifest) and rejects on identity match.
//                See: readGitHead() + validateContinue().
//   M3  (F1.1)  `loop --status` prints the verbatim proposal body so
//                the operator can review the literal bytes.
//                See: commandStatus() — body printed without trim.
//   M4  (F1.4 / ADR-003)  Sandboxing inherits ADR-003 fresh-fixture
//                clone via runner.ts; the loop is a caller, not a
//                re-implementer. Both baseline and candidate are
//                fresh-fixture clones by construction.
//                See: callers of runBenchmark() below.
//   M5  (F2.3)  Manifest written with mode 0o600 — owner-read/write
//                only. Re-applied on every write (start + continue)
//                to defend against umask interference.
//                See: writeManifest().
//   M6  (F2.5 / §4.3 rule 1)  state === "awaiting-apply" check; no
//                trim, no lowercase. Strict enum membership.
//                See: validateContinue().
//   M7  (F2.1 / §4.3 rule 3)  plugin_ref_before claim verified via
//                fresh `git rev-parse HEAD`; manifest is not the
//                authority for the comparison.
//                See: validateContinue().
//   M8  (§4.3 rule 5)  schema_version === 1 check; future versions
//                hard reject with a forwards-incompatibility error.
//                See: parseManifest() + validateContinue().
//   M9  (F3.1)  auth_identity_hash regex — runner.ts populates
//                run.json.auth_identity_hash from GUILD_BENCHMARK_AUTH_HINT
//                only when matching ^[a-f0-9]{64}$. Implemented in
//                runner.ts; re-affirmed in this file's CHANGELOG.
//   M10 (F3.1)  tool_error event on regex mismatch — runner.ts emits
//                {tool: "auth-hash"}; loop does not duplicate.
//   M11 (F3.1)  No `claude` CLI auth-state inspection — grep proof in
//                handoff. The loop never reads ~/.claude/, never
//                spawns `claude auth status`. The runner is the only
//                code path that spawns `claude`, and it does so only
//                when not --dry-run.
//   M12 (F4.1)  Keep/discard rule computed server-side in compare.ts;
//                this file passes the manifest into compareSets which
//                then populates reflection_applied.kept and
//                delta_summary.worst_component_delta. Frontend renders
//                the per-component delta table alongside the badge.
//   M13 (F2.1)  proposal_id regex ^[a-zA-Z0-9._-]{1,128}$ — rejects
//                path-traversal patterns (`..`, absolute paths, NUL).
//                Enforced at --apply argument validation AND
//                cross-checked against available_proposals[].
//                See: PROPOSAL_ID_RE + validateContinue().
//   M14 (F2.1)  applied_proposal block written to manifest only after
//                candidate run completes successfully. Atomic via
//                <manifest>.tmp + fs.renameSync.
//                See: completeManifest().
//
// Deferred (D1–D4) — tracked in handoff Open risks; NOT implemented:
//   D1 HMAC signing of the manifest with a per-run nonce.
//   D2 Per-run nonce binding the manifest to the baseline's run.json.
//   D3 Diff-based source_path enforcement (operator commit vs manifest).
//   D4 Pre-apply hook sanity check (`bash -n` etc.).

import { execFileSync } from "node:child_process";
import { existsSync, openSync, closeSync, statSync, chmodSync, renameSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile, unlink, appendFile } from "node:fs/promises";
import { dirname, join, resolve, basename } from "node:path";
import { compareSets } from "./compare.js";
import { runBenchmark, planRun, safeJoinUnder } from "./runner.js";
import type {
  LoopAbortOptions,
  LoopAbortReport,
  LoopContinueOptions,
  LoopManifest,
  LoopManifestProposal,
  LoopManifestState,
  LoopRollbackOptions,
  LoopRollbackReport,
  LoopStartOptions,
  LoopStatusOptions,
} from "./types.js";

// M13 — proposal_id allowlist regex. Rejects `..`, slashes, NUL,
// shell-metacharacters; max 128 chars per security F2.1.
export const PROPOSAL_ID_RE = /^[a-zA-Z0-9._-]{1,128}$/;
// State enum used for strict membership checks (M6, F2.5).
// v1.3 — F2: "rolled-back" added as the terminal state for loopRollback().
const VALID_STATES: ReadonlySet<LoopManifestState> = new Set([
  "awaiting-apply",
  "completed",
  "aborted",
  "rolled-back",
]);

const MANIFEST_FILENAME = "loop-manifest.json";
const REFLECTIONS_REL = "artifacts/.guild/reflections";
const MANIFEST_MODE = 0o600;
const MANIFEST_SCHEMA_VERSION = 1;

export interface LoopContext {
  runsDir: string;
  casesDir: string;
}

// ---- Public entrypoints (called from cli.ts) --------------------------

export interface LoopStartResult {
  manifestPath: string;
  baselineRunId: string;
  manifest: LoopManifest;
}

export interface LoopContinueResult {
  manifestPath: string;
  candidateRunId: string;
  comparisonPath: string;
  kept: boolean | null; // null when comparison status != "ok"
}

/**
 * `loop --start` — runs the baseline, scans reflections, writes the
 * manifest. With `dryRun: true`, resolves the plan and exits without
 * spawning anything.
 */
export async function loopStart(
  opts: LoopStartOptions,
  ctx: LoopContext,
): Promise<LoopStartResult | LoopDryRunReport> {
  if (!opts.caseSlug || typeof opts.caseSlug !== "string") {
    throw new Error("loop --start: --case <slug> is required");
  }

  // Use planRun so dry-run output matches what the runner will see.
  const plan = await planRun(
    {
      caseSlug: opts.caseSlug,
      ...(opts.baselineRunId !== undefined ? { runId: opts.baselineRunId } : {}),
      dryRun: true,
    },
    ctx,
  );

  const baselineRunId = plan.runId;
  const baselineRunDir = join(ctx.runsDir, baselineRunId);
  const manifestPath = join(baselineRunDir, MANIFEST_FILENAME);
  const reflectionsDir = join(baselineRunDir, REFLECTIONS_REL);

  if (opts.dryRun === true) {
    return {
      kind: "start",
      caseSlug: opts.caseSlug,
      baselineRunId,
      baselineRunDir,
      manifestPath,
      reflectionsDir,
      argv: plan.argv,
      pluginRefBefore: plan.pluginRef,
      hostRepoRoot: plan.hostRepoRoot,
    };
  }

  // M2 — capture plugin_ref BEFORE the baseline runs (truth source: git).
  const pluginRefBefore = readGitHead(plan.hostRepoRoot);

  // Baseline run via runner.ts (ADR-003 fresh-fixture; ADR-004 process
  // group). The loop does not duplicate runner logic; it calls.
  const result = await runBenchmark(
    {
      caseSlug: opts.caseSlug,
      ...(opts.baselineRunId !== undefined ? { runId: opts.baselineRunId } : {}),
    },
    ctx,
  );

  // Scan reflections — bounded to runs/<id>/artifacts/.guild/reflections/.
  const proposals = await enumerateProposals(reflectionsDir);

  const manifest: LoopManifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    baseline_run_id: result.run_id,
    case_slug: opts.caseSlug,
    plugin_ref_before: pluginRefBefore,
    available_proposals: proposals,
    started_at: new Date().toISOString(),
    state: "awaiting-apply",
  };

  await writeManifest(manifestPath, manifest);

  return { manifestPath, baselineRunId: result.run_id, manifest };
}

/**
 * `loop --continue` — validates the manifest, runs the candidate, and
 * emits a reflection-annotated comparison. Updates the manifest atomically
 * to state="completed" only after the candidate completes.
 *
 * With `dryRun: true`, validates the manifest, resolves the candidate
 * plan, and exits without spawning anything.
 */
export async function loopContinue(
  opts: LoopContinueOptions,
  ctx: LoopContext,
): Promise<LoopContinueResult | LoopDryRunReport> {
  if (!opts.baselineRunId || typeof opts.baselineRunId !== "string") {
    throw new Error("loop --continue: --baseline-run-id <id> is required");
  }
  if (!opts.proposalId || typeof opts.proposalId !== "string") {
    throw new Error("loop --continue: --apply <proposal-id> is required");
  }

  // M13 — proposal_id allowlist BEFORE any disk read. Defends against
  // attacker-supplied path-traversal even if the manifest were tampered.
  if (!PROPOSAL_ID_RE.test(opts.proposalId)) {
    throw new Error(
      `loop --continue: --apply value "${opts.proposalId}" is not a valid proposal_id ` +
        `(must match ${PROPOSAL_ID_RE.source}; M13 / security F2.1)`,
    );
  }

  const manifestPath = manifestPathFor(ctx.runsDir, opts.baselineRunId);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `loop --continue: manifest not found at ${manifestPath} (run \`loop --start\` first?)`,
    );
  }

  const manifest = await readManifest(manifestPath);
  // M2/M6/M7/M8/M13 — runtime validation rules; rejects on first failure.
  validateContinue(manifest, opts, ctx, manifestPath);

  // Resolve candidate plan (also gives us run-id for dry-run output).
  const candidatePlan = await planRun({ caseSlug: manifest.case_slug, dryRun: true }, ctx);

  // Read host HEAD AFTER validateContinue passes so the recorded
  // plugin_ref_after reflects the operator's post-apply commit.
  const pluginRefAfter = readGitHead(candidatePlan.hostRepoRoot);

  if (opts.dryRun === true) {
    const proposal = manifest.available_proposals.find(
      (p) => p.proposal_id === opts.proposalId,
    );
    return {
      kind: "continue",
      manifestPath,
      manifest,
      proposalId: opts.proposalId,
      proposalSourcePath: proposal?.source_path ?? "(unknown)",
      candidateRunId: candidatePlan.runId,
      candidateRunDir: candidatePlan.runDir,
      pluginRefBefore: manifest.plugin_ref_before,
      pluginRefAfter,
      comparisonPath: defaultComparisonPathFor(
        ctx.runsDir,
        manifest.baseline_run_id,
        candidatePlan.runId,
      ),
    };
  }

  // Acquire single-flight lock on the manifest (F1.6).
  const lockPath = `${manifestPath}.lock`;
  let lockFd: number | null = null;
  try {
    try {
      lockFd = openSync(lockPath, "wx");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EEXIST") {
        throw new Error(
          `loop --continue: another invocation is in flight against ${manifest.baseline_run_id} ` +
            `(lock: ${lockPath}). Remove the lock file if you are sure no other process holds it.`,
        );
      }
      throw err;
    }

    // Spawn candidate via runner.ts. New run-id is generated by planRun
    // (ADR-003 isolation). The runner enforces M1–M16 from P3.
    const candidateResult = await runBenchmark({ caseSlug: manifest.case_slug }, ctx);

    // F1.3 — emit a `loop_apply` audit event into the candidate's
    // events.ndjson. Defence-in-depth audit trail; the manifest's
    // applied_proposal block is the canonical record.
    await appendLoopApplyEvent(candidateResult.events_path, {
      proposal_id: opts.proposalId,
      plugin_ref_before: manifest.plugin_ref_before,
      plugin_ref_after: pluginRefAfter,
    });

    // Compute comparison via compare.ts; manifest passed so it can
    // populate reflection_applied if both run-ids match.
    const partialAppliedManifest: LoopManifest = {
      ...manifest,
      applied_proposal: {
        proposal_id: opts.proposalId,
        source_path:
          manifest.available_proposals.find((p) => p.proposal_id === opts.proposalId)
            ?.source_path ?? "",
        applied_at: new Date().toISOString(),
        plugin_ref_after: pluginRefAfter,
        candidate_run_id: candidateResult.run_id,
      },
      state: "awaiting-apply", // not yet flipped — manifest write happens after
    };

    const compareResult = await compareSets({
      runsDir: ctx.runsDir,
      baseline: manifest.baseline_run_id,
      candidate: candidateResult.run_id,
      manifest: partialAppliedManifest,
    });

    // M14 — atomic manifest update: write completed state only AFTER
    // the candidate has finished and the comparison has been emitted.
    const completedManifest: LoopManifest = {
      ...manifest,
      applied_proposal: partialAppliedManifest.applied_proposal,
      state: "completed",
    };
    await writeManifestAtomic(manifestPath, completedManifest);

    return {
      manifestPath,
      candidateRunId: candidateResult.run_id,
      comparisonPath: compareResult.outputPath,
      kept: compareResult.comparison.reflection_applied?.kept ?? null,
    };
  } finally {
    if (lockFd !== null) {
      try {
        closeSync(lockFd);
      } catch {
        /* ignore */
      }
    }
    try {
      await unlink(lockPath);
    } catch {
      /* lockfile already gone — fine */
    }
  }
}

/**
 * `loop --status` — read-only manifest inspection. Prints state,
 * proposals, applied state, verbatim proposal bodies, and high-trust
 * path WARNINGs. When `opts.diffProposalId` is set, switches to diff
 * mode for the named proposal. No mutation, no spawning.
 */
export async function loopStatus(
  opts: LoopStatusOptions,
  ctx: LoopContext,
): Promise<LoopStatusReport> {
  if (!opts.baselineRunId || typeof opts.baselineRunId !== "string") {
    throw new Error("loop --status: --baseline-run-id <id> is required");
  }
  const manifestPath = manifestPathFor(ctx.runsDir, opts.baselineRunId);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `loop --status: manifest not found at ${manifestPath} (run \`loop --start\` first?)`,
    );
  }
  const manifest = await readManifest(manifestPath);

  // M3 / F1.1 — re-read each proposal body from the artifact tree.
  // Manifest stores only the summary + source_path (kept small +
  // immutable); truth source for the body is the captured `.guild/`.
  const reflectionsDir = join(
    ctx.runsDir,
    manifest.baseline_run_id,
    REFLECTIONS_REL,
  );
  const proposals: ProposalReview[] = [];
  for (const p of manifest.available_proposals) {
    let body = "";
    const safePath = safeJoinUnder(reflectionsDir, `${p.proposal_id}.md`);
    if (safePath !== null) {
      try {
        body = await readFile(safePath, "utf8");
      } catch {
        // Proposal file missing — body stays "". The status report still
        // surfaces the proposal_id + source_path; operator can investigate.
      }
    }
    proposals.push({
      proposal_id: p.proposal_id,
      source_path: p.source_path,
      body,
      highTrustPaths: findHighTrustPaths(body),
    });
  }

  // F1.1 (b) — when --diff requested, pull the named proposal's blocks.
  let diff: LoopStatusDiffResult | undefined;
  if (opts.diffProposalId !== undefined && opts.diffProposalId.length > 0) {
    const review = proposals.find(
      (r) => r.proposal_id === opts.diffProposalId,
    );
    if (review === undefined) {
      throw new Error(
        `loop --status --diff: proposal_id ${opts.diffProposalId} not found in manifest's available_proposals[] ` +
          `(known: ${manifest.available_proposals.map((p) => p.proposal_id).join(", ") || "<none>"})`,
      );
    }
    const blocks = extractDiffBlocks(review.body);
    diff = {
      proposal_id: review.proposal_id,
      source_path: review.source_path,
      diffBlocks: blocks,
      freeform: blocks.length === 0,
    };
  }

  return { manifestPath, manifest, proposals, diff };
}

/**
 * `loop --abort` — flips the manifest state to "aborted" and removes the
 * single-flight lockfile. Refuses if the manifest is already in
 * "completed" state (irreversible) or already in "aborted" state
 * (idempotent — the second call is a no-op error so the operator notices
 * a script-level mistake).
 *
 * v1.2 — F1 closed. P4's manifest schema reserved state="aborted" but
 * never wired the action; v1 workaround was `rm <manifest>`. Structured
 * abort is symmetric with --continue (both transition awaiting-apply →
 * terminal) and lets operators script the abandonment cleanly.
 *
 * No spawn, no compare, no candidate run. Pure state transition + lock
 * cleanup.
 */
export async function loopAbort(
  opts: LoopAbortOptions,
  ctx: LoopContext,
): Promise<LoopAbortReport> {
  if (!opts.baselineRunId || typeof opts.baselineRunId !== "string") {
    throw new Error("loop --abort: --baseline-run-id <id> is required");
  }
  // M13 — same allowlist as --continue's --apply value, applied to the
  // baseline run id so a poisoned id can't escape the runs dir.
  if (!PROPOSAL_ID_RE.test(opts.baselineRunId)) {
    throw new Error(
      `loop --abort: --baseline-run-id "${opts.baselineRunId}" contains illegal characters ` +
        `(allowed: ${PROPOSAL_ID_RE.source})`,
    );
  }
  const manifestPath = manifestPathFor(ctx.runsDir, opts.baselineRunId);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `loop --abort: manifest not found at ${manifestPath} ` +
        `(nothing to abort — run \`loop --start\` first or fix the run-id)`,
    );
  }
  const manifest = await readManifest(manifestPath);

  // Refuse on terminal states. completed = irreversible; aborted =
  // idempotent error so a script mistake is loud, not silent.
  if (manifest.state === "completed") {
    throw new Error(
      `loop --abort: manifest state is "completed"; cannot abort a completed loop ` +
        `(the candidate run already landed). Revert the host repo via \`git revert\` if needed.`,
    );
  }
  if (manifest.state === "aborted") {
    throw new Error(
      `loop --abort: manifest state is already "aborted" at ${manifestPath} ` +
        `(idempotent abort attempted — no-op).`,
    );
  }

  const lockPath = `${manifestPath}.lock`;
  const lockfileExisted = existsSync(lockPath);

  if (opts.dryRun === true) {
    return {
      manifestPath,
      manifestStateBefore: manifest.state,
      manifestStateAfter: "aborted",
      lockfilePath: lockPath,
      lockfileExisted,
    };
  }

  // Atomic rename so a concurrent reader never sees a half-flipped state.
  const aborted: LoopManifest = { ...manifest, state: "aborted" };
  await writeManifestAtomic(manifestPath, aborted);

  // Drop the lockfile if present. Best-effort — if a concurrent --continue
  // is mid-run, the lock will be re-acquired by that process and our
  // unlink races with it. Tolerate ENOENT.
  if (lockfileExisted) {
    try {
      await unlink(lockPath);
    } catch {
      /* race with concurrent --continue or already-removed; ignore */
    }
  }

  return {
    manifestPath,
    manifestStateBefore: manifest.state,
    manifestStateAfter: "aborted",
    lockfilePath: lockPath,
    lockfileExisted,
  };
}

/**
 * `loop --rollback` — flips a "completed" manifest to "rolled-back" after
 * `git revert <plugin_ref_after>` succeeds. Refuses on any other state
 * (you can only rollback a completed application). Default `--dry-run`
 * prints what would happen; `--confirm` shells out to git revert.
 *
 * v1.3 — F2 closed. P4's manifest schema reserved no rollback action;
 * v1.x workaround was a manual `git revert <plugin_ref_after>`. The
 * `loop --rollback` action is symmetric with --abort (both transition a
 * non-awaiting-apply manifest into a terminal state) and lets operators
 * script the un-application cleanly. `p4-learning-loop-architecture.md
 * §6.1` carries the supersession callout.
 *
 * Architecture (per ADR/spec):
 *   - Refuses if state ≠ "completed" (only completed apps can be rolled back).
 *   - M13: --candidate-id validated against PROPOSAL_ID_RE before disk read.
 *   - --dry-run (default): print state transition + git revert shellout.
 *   - --confirm (live): execFileSync git revert; flip state; writeManifestAtomic.
 *   - Refuses live without --confirm (defense against accidental invocation).
 *   - Drops <manifest>.lock if present, mirroring loopAbort.
 */
export async function loopRollback(
  opts: LoopRollbackOptions,
  ctx: LoopContext,
): Promise<LoopRollbackReport> {
  if (!opts.baselineRunId || typeof opts.baselineRunId !== "string") {
    throw new Error("loop --rollback: --baseline-run-id <id> is required");
  }
  if (!opts.candidateId || typeof opts.candidateId !== "string") {
    throw new Error("loop --rollback: --candidate-id <id> is required");
  }
  // M13 — same allowlist as --apply / --abort. Defends against
  // attacker-supplied path-traversal or shell-metacharacter ids that
  // could escape the runs dir or escape the git revert argv.
  if (!PROPOSAL_ID_RE.test(opts.baselineRunId)) {
    throw new Error(
      `loop --rollback: --baseline-run-id "${opts.baselineRunId}" contains illegal characters ` +
        `(allowed: ${PROPOSAL_ID_RE.source})`,
    );
  }
  if (!PROPOSAL_ID_RE.test(opts.candidateId)) {
    throw new Error(
      `loop --rollback: --candidate-id "${opts.candidateId}" is not a valid proposal_id ` +
        `(must match ${PROPOSAL_ID_RE.source}; M13 / security F2.1)`,
    );
  }
  // Default-safe: live mode requires --confirm. --dry-run is the default.
  const isDryRun = opts.dryRun !== false && opts.confirm !== true;
  if (!isDryRun && opts.confirm !== true) {
    throw new Error(
      `loop --rollback: live mode requires --confirm (refusing to git revert without explicit operator opt-in)`,
    );
  }

  const manifestPath = manifestPathFor(ctx.runsDir, opts.baselineRunId);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `loop --rollback: manifest not found at ${manifestPath} ` +
        `(nothing to rollback — fix the run-id or run \`loop --start\` first)`,
    );
  }
  const manifest = await readManifest(manifestPath);

  // Refuse on non-completed states. Only a completed apply can be rolled back.
  if (manifest.state !== "completed") {
    throw new Error(
      `loop --rollback: manifest state is "${manifest.state}"; expected "completed" ` +
        `(you can only rollback a completed application)`,
    );
  }
  // Cross-check: the operator-supplied --candidate-id must match the manifest's
  // applied_proposal.proposal_id. Catches typos and replay attempts.
  const appliedId = manifest.applied_proposal?.proposal_id;
  if (appliedId !== undefined && appliedId !== opts.candidateId) {
    throw new Error(
      `loop --rollback: --candidate-id "${opts.candidateId}" does not match manifest's ` +
        `applied_proposal.proposal_id "${appliedId}"`,
    );
  }
  const pluginRefAfter = manifest.applied_proposal?.plugin_ref_after ?? "";
  if (pluginRefAfter.length === 0) {
    throw new Error(
      `loop --rollback: manifest.applied_proposal.plugin_ref_after is missing; cannot determine git revert target`,
    );
  }

  // Resolve host repo root the same way validateContinue does — so the
  // dry-run output mentions the SAME path that the live shellout would
  // chdir into. dirname(dirname(runsDir)) is the host repo root.
  const candidatePlanRoot = dirname(resolve(ctx.runsDir));
  const hostRepoRoot = dirname(candidatePlanRoot);

  const lockPath = `${manifestPath}.lock`;
  const lockfileExisted = existsSync(lockPath);

  if (isDryRun) {
    return {
      manifestPath,
      manifestStateBefore: manifest.state,
      manifestStateAfter: "rolled-back",
      candidateId: opts.candidateId,
      pluginRefAfter,
      hostRepoRoot,
      lockfilePath: lockPath,
      lockfileExisted,
      confirmed: false,
    };
  }

  // Live mode: shell out to `git revert --no-edit <plugin_ref_after>`.
  // M13 — pluginRefAfter has already been read from the manifest (which
  // itself has been parsed against schema invariants); we DO NOT pass any
  // operator-supplied free-form string into argv. The manifest's
  // plugin_ref_after is git-rev-parse output (40-char SHA), validated by
  // schema discipline at write time.
  try {
    execFileSync(
      "git",
      ["-C", hostRepoRoot, "revert", "--no-edit", pluginRefAfter],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `loop --rollback: git revert failed for ${pluginRefAfter} in ${hostRepoRoot}: ${message} ` +
        `(manifest state unchanged; resolve the conflict manually or run \`git revert --abort\` and retry)`,
    );
  }

  // Atomic state flip — same pattern as loopAbort. Writes via M14
  // tmp+rename so concurrent readers never see a half-flipped state.
  const rolled: LoopManifest = { ...manifest, state: "rolled-back" };
  await writeManifestAtomic(manifestPath, rolled);

  // Drop lockfile if any single-flight --continue lock survived. Mirror
  // loopAbort's tolerance: ENOENT swallowed.
  if (lockfileExisted) {
    try {
      await unlink(lockPath);
    } catch {
      /* race with concurrent --continue or already-removed; ignore */
    }
  }

  return {
    manifestPath,
    manifestStateBefore: manifest.state,
    manifestStateAfter: "rolled-back",
    candidateId: opts.candidateId,
    pluginRefAfter,
    hostRepoRoot,
    lockfilePath: lockPath,
    lockfileExisted,
    confirmed: true,
  };
}

// ---- Dry-run / status report shapes ----------------------------------

export interface LoopStartDryRun {
  kind: "start";
  caseSlug: string;
  baselineRunId: string;
  baselineRunDir: string;
  manifestPath: string;
  reflectionsDir: string;
  argv: string[];
  pluginRefBefore: string;
  hostRepoRoot: string;
}

export interface LoopContinueDryRun {
  kind: "continue";
  manifestPath: string;
  manifest: LoopManifest;
  proposalId: string;
  proposalSourcePath: string;
  candidateRunId: string;
  candidateRunDir: string;
  pluginRefBefore: string;
  pluginRefAfter: string;
  comparisonPath: string;
}

export type LoopDryRunReport = LoopStartDryRun | LoopContinueDryRun;

/**
 * Per-proposal review surface — body verbatim + high-trust path warnings
 * computed at status time (M3 / F1.1, F1.2 acceptance).
 */
export interface ProposalReview {
  proposal_id: string;
  source_path: string;
  body: string;                  // verbatim, no trim, no normalization
  highTrustPaths: string[];      // sorted unique prefixes found in body
}

export interface LoopStatusDiffResult {
  proposal_id: string;
  source_path: string;
  diffBlocks: string[];          // contents of fenced ```diff/```patch/``` blocks
  freeform: boolean;             // true when no diff block found
}

export interface LoopStatusReport {
  manifestPath: string;
  manifest: LoopManifest;
  /**
   * One review entry per `manifest.available_proposals[]`. Body is
   * re-read from disk at status time (the manifest does not store body
   * to keep it small + immutable; truth source is the artifact tree).
   */
  proposals: ProposalReview[];
  /**
   * Set when `loop --status --diff <proposal-id>` was invoked. Otherwise
   * undefined; `formatStatusReport` falls back to its full-report layout.
   */
  diff?: LoopStatusDiffResult;
}

/**
 * High-trust path prefixes — directories whose modification carries
 * disproportionate operator risk. A proposal body referencing any of
 * these triggers a `WARNING:` line in `formatStatusReport` (F1.2 / M3).
 *
 * Order is alphabetical; the WARNING line lists matches in this order
 * so output is deterministic across platforms.
 */
export const HIGH_TRUST_PATH_PREFIXES = [
  ".claude-plugin/",
  "agents/",
  "commands/",
  "hooks/",
  "mcp-servers/",
  "scripts/",
  "skills/",
];

export function findHighTrustPaths(text: string): string[] {
  const matches = new Set<string>();
  for (const prefix of HIGH_TRUST_PATH_PREFIXES) {
    if (text.includes(prefix)) matches.add(prefix);
  }
  return [...matches].sort();
}

/**
 * Extract fenced code blocks tagged `diff` or `patch` (case-insensitive).
 * Untagged ``` ``` blocks are NOT included — operators get a freeform
 * notice instead so they review the full body. Returns an empty array
 * if no tagged blocks are present.
 */
export function extractDiffBlocks(body: string): string[] {
  const re = /```(?:diff|patch)\r?\n([\s\S]*?)\r?\n```/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    blocks.push(m[1] ?? "");
  }
  return blocks;
}

// ---- Manifest IO -----------------------------------------------------

export function manifestPathFor(runsDir: string, baselineRunId: string): string {
  return resolve(runsDir, baselineRunId, MANIFEST_FILENAME);
}

async function writeManifest(manifestPath: string, manifest: LoopManifest): Promise<void> {
  await mkdir(dirname(manifestPath), { recursive: true });
  // M5 — write with explicit 0o600 mode AND re-chmod after write to
  // defend against platform umask interference.
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", {
    encoding: "utf8",
    mode: MANIFEST_MODE,
  });
  try {
    chmodSync(manifestPath, MANIFEST_MODE);
  } catch {
    /* best-effort — non-POSIX filesystems may reject */
  }
}

// v1.2 — F5: exported so the Q7 atomic-rename integration test can
// exercise this primitive directly. The function is otherwise internal
// to loop.ts; the export is for testing only.
export async function writeManifestAtomic(
  manifestPath: string,
  manifest: LoopManifest,
): Promise<void> {
  // M14 — temp-file + atomic rename so a half-written manifest is never
  // visible to a concurrent reader.
  const tmpPath = `${manifestPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(manifest, null, 2) + "\n", {
    encoding: "utf8",
    mode: MANIFEST_MODE,
  });
  try {
    chmodSync(tmpPath, MANIFEST_MODE);
  } catch {
    /* best-effort */
  }
  renameSync(tmpPath, manifestPath);
  try {
    chmodSync(manifestPath, MANIFEST_MODE);
  } catch {
    /* best-effort */
  }
}

async function readManifest(manifestPath: string): Promise<LoopManifest> {
  const raw = await readFile(manifestPath, "utf8");
  return parseManifest(raw, manifestPath);
}

export function parseManifest(raw: string, source: string): LoopManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `loop: manifest at ${source} is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`loop: manifest at ${source} must be a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  // M8 — schema_version strict equality (no coercion).
  if (obj.schema_version !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `loop: manifest at ${source} has schema_version=${String(obj.schema_version)}; ` +
        `expected ${MANIFEST_SCHEMA_VERSION} (forwards-incompatibility; M8)`,
    );
  }
  const requiredStr = (k: string): string => {
    const v = obj[k];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`loop: manifest at ${source} missing required string field "${k}"`);
    }
    return v;
  };
  const baseline_run_id = requiredStr("baseline_run_id");
  const case_slug = requiredStr("case_slug");
  const plugin_ref_before = requiredStr("plugin_ref_before");
  const started_at = requiredStr("started_at");
  const stateRaw = obj.state;
  if (typeof stateRaw !== "string" || !VALID_STATES.has(stateRaw as LoopManifestState)) {
    throw new Error(
      `loop: manifest at ${source} has invalid state "${String(stateRaw)}"; ` +
        `expected one of ${[...VALID_STATES].join(", ")} (M6 / F2.5)`,
    );
  }
  const state = stateRaw as LoopManifestState;
  const proposalsRaw = obj.available_proposals;
  if (!Array.isArray(proposalsRaw)) {
    throw new Error(`loop: manifest at ${source} available_proposals must be an array`);
  }
  const available_proposals: LoopManifestProposal[] = proposalsRaw.map((p, i) => {
    if (p === null || typeof p !== "object" || Array.isArray(p)) {
      throw new Error(
        `loop: manifest at ${source} available_proposals[${i}] is not an object`,
      );
    }
    const pRec = p as Record<string, unknown>;
    const proposal_id = pRec.proposal_id;
    const source_path = pRec.source_path;
    const summary = pRec.summary;
    if (typeof proposal_id !== "string" || !PROPOSAL_ID_RE.test(proposal_id)) {
      throw new Error(
        `loop: manifest at ${source} available_proposals[${i}].proposal_id is not a valid id (M13)`,
      );
    }
    if (typeof source_path !== "string") {
      throw new Error(
        `loop: manifest at ${source} available_proposals[${i}].source_path must be a string`,
      );
    }
    if (typeof summary !== "string") {
      throw new Error(
        `loop: manifest at ${source} available_proposals[${i}].summary must be a string`,
      );
    }
    return { proposal_id, source_path, summary };
  });

  const manifest: LoopManifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    baseline_run_id,
    case_slug,
    plugin_ref_before,
    available_proposals,
    started_at,
    state,
  };

  if (obj.applied_proposal !== undefined) {
    const ap = obj.applied_proposal;
    if (ap === null || typeof ap !== "object" || Array.isArray(ap)) {
      throw new Error(`loop: manifest at ${source} applied_proposal must be an object`);
    }
    const apRec = ap as Record<string, unknown>;
    const apProposalId = apRec.proposal_id;
    if (typeof apProposalId !== "string" || !PROPOSAL_ID_RE.test(apProposalId)) {
      throw new Error(
        `loop: manifest at ${source} applied_proposal.proposal_id invalid (M13)`,
      );
    }
    manifest.applied_proposal = {
      proposal_id: apProposalId,
      source_path: typeof apRec.source_path === "string" ? apRec.source_path : "",
      applied_at: typeof apRec.applied_at === "string" ? apRec.applied_at : "",
      plugin_ref_after:
        typeof apRec.plugin_ref_after === "string" ? apRec.plugin_ref_after : "",
      candidate_run_id:
        typeof apRec.candidate_run_id === "string" ? apRec.candidate_run_id : "",
    };
  }
  if (typeof obj.abort_reason === "string") {
    manifest.abort_reason = obj.abort_reason;
  }

  return manifest;
}

// ---- validateContinue ------------------------------------------------

function validateContinue(
  manifest: LoopManifest,
  opts: LoopContinueOptions,
  ctx: LoopContext,
  manifestPath: string,
): void {
  // M6 — state must be "awaiting-apply" (rejects completed/aborted).
  if (manifest.state !== "awaiting-apply") {
    throw new Error(
      `loop --continue: manifest state is "${manifest.state}"; expected "awaiting-apply" ` +
        `(M6 / F2.5). Did you already complete this loop?`,
    );
  }
  // F2.2 — baseline_run_id ↔ dirname cross-check.
  const dirBaselineRunId = basename(dirname(manifestPath));
  if (manifest.baseline_run_id !== dirBaselineRunId) {
    throw new Error(
      `loop --continue: manifest.baseline_run_id "${manifest.baseline_run_id}" does not match ` +
        `directory "${dirBaselineRunId}" (replay defence; F2.2)`,
    );
  }
  if (manifest.baseline_run_id !== opts.baselineRunId) {
    throw new Error(
      `loop --continue: --baseline-run-id "${opts.baselineRunId}" does not match manifest's ` +
        `baseline_run_id "${manifest.baseline_run_id}"`,
    );
  }
  // M13 — proposal must be in available_proposals.
  const proposal = manifest.available_proposals.find(
    (p) => p.proposal_id === opts.proposalId,
  );
  if (proposal === undefined) {
    if (manifest.available_proposals.length === 0) {
      throw new Error(
        `loop --continue: baseline produced no proposals (available_proposals is empty); ` +
          `re-run baseline or pick a different case`,
      );
    }
    const ids = manifest.available_proposals.map((p) => p.proposal_id).join(", ");
    throw new Error(
      `loop --continue: --apply "${opts.proposalId}" is not in available_proposals ` +
        `[${ids}] (M13)`,
    );
  }
  // F2.2 — proposal `.md` file existence.
  const reflectionsDir = join(ctx.runsDir, manifest.baseline_run_id, REFLECTIONS_REL);
  const proposalMd = safeJoinUnder(reflectionsDir, `${opts.proposalId}.md`);
  if (proposalMd === null || !existsSync(proposalMd)) {
    throw new Error(
      `loop --continue: proposal file ${join(reflectionsDir, `${opts.proposalId}.md`)} ` +
        `not found on disk (replay defence; F2.2)`,
    );
  }
  // M2/M7 — plugin_ref must have changed since --start (truth: git, not manifest).
  const candidatePlanRoot = dirname(resolve(ctx.runsDir));
  const hostRepoRoot = dirname(candidatePlanRoot);
  const currentHead = readGitHead(hostRepoRoot);
  if (currentHead === manifest.plugin_ref_before) {
    throw new Error(
      `loop --continue: host repo HEAD (${currentHead}) equals manifest.plugin_ref_before; ` +
        `did you forget to commit your applied proposal? (M2/M7 / §4.3 rule 3)`,
    );
  }
  if (currentHead === "unknown") {
    throw new Error(
      `loop --continue: cannot read host repo HEAD via 'git rev-parse'; aborting ` +
        `(M2/M7 — refuse to proceed without a verifiable plugin_ref_after)`,
    );
  }
}

// ---- Reflection enumeration (architect §4.4) -------------------------

async function enumerateProposals(
  reflectionsDir: string,
): Promise<LoopManifestProposal[]> {
  if (!existsSync(reflectionsDir)) return [];
  let entries: { name: string; isFile: boolean; isSymlink: boolean }[] = [];
  try {
    const dirents = await readdir(reflectionsDir, { withFileTypes: true });
    entries = dirents.map((d) => ({
      name: d.name,
      isFile: d.isFile(),
      isSymlink: d.isSymbolicLink(),
    }));
  } catch {
    return [];
  }
  const out: LoopManifestProposal[] = [];
  for (const e of entries) {
    if (e.isSymlink) continue; // refuse symlinks (M5/F2.2 carry-forward)
    if (!e.isFile) continue;
    if (!e.name.endsWith(".md")) continue;
    const proposalId = e.name.slice(0, -3);
    if (!PROPOSAL_ID_RE.test(proposalId)) continue; // M13 — skip path-traversal-shaped names
    const safePath = safeJoinUnder(reflectionsDir, e.name);
    if (safePath === null) continue;
    let body: string;
    try {
      body = await readFile(safePath, "utf8");
    } catch {
      continue;
    }
    const { sourcePath, summary } = parseProposalBody(body);
    out.push({
      proposal_id: proposalId,
      source_path: sourcePath,
      summary,
    });
  }
  // Stable sort by proposal_id (deterministic manifest output).
  out.sort((a, b) => (a.proposal_id < b.proposal_id ? -1 : a.proposal_id > b.proposal_id ? 1 : 0));
  return out;
}

/**
 * Parse a proposal `.md`. `source_path` is read from a YAML-style
 * frontmatter line `target:` or `path:` if present; otherwise empty.
 * `summary` is the first non-empty body line (stripped of frontmatter
 * markers + leading `#`), trimmed to <= 160 chars.
 */
export function parseProposalBody(body: string): {
  sourcePath: string;
  summary: string;
} {
  let sourcePath = "";
  let inFrontmatter = false;
  const lines = body.split(/\r?\n/);
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    inFrontmatter = true;
    bodyStart = 1;
    for (let i = 1; i < lines.length; i++) {
      const ln = lines[i] ?? "";
      if (ln.trim() === "---") {
        bodyStart = i + 1;
        inFrontmatter = false;
        break;
      }
      const m = ln.match(/^(target|path):\s*(.+?)\s*$/);
      if (m && sourcePath === "") {
        // Strip surrounding quotes if present.
        let v = m[2] ?? "";
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        sourcePath = v;
      }
    }
    if (inFrontmatter) bodyStart = lines.length; // unterminated frontmatter
  }
  let summary = "";
  for (let i = bodyStart; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed.length === 0) continue;
    summary = trimmed.replace(/^#+\s*/, "");
    break;
  }
  if (summary.length > 160) summary = summary.slice(0, 160);
  return { sourcePath, summary };
}

// ---- Audit event emission --------------------------------------------

interface LoopApplyEvent {
  proposal_id: string;
  plugin_ref_before: string;
  plugin_ref_after: string;
}

async function appendLoopApplyEvent(
  eventsPath: string,
  ev: LoopApplyEvent,
): Promise<void> {
  // F1.3 — defence-in-depth audit echo. The architect's loop_apply event
  // is a tool_error-shaped row (the discriminated union does not yet
  // carry a dedicated loop_apply variant; piggy-back on tool_error for
  // P4, route schema-extension follow-up to qa T4 / future P4-polish).
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    type: "tool_error",
    tool: "loop_apply",
    exit_code: 0,
    proposal_id: ev.proposal_id,
    plugin_ref_before: ev.plugin_ref_before,
    plugin_ref_after: ev.plugin_ref_after,
  });
  try {
    await mkdir(dirname(eventsPath), { recursive: true });
    if (existsSync(eventsPath)) {
      await appendFile(eventsPath, line + "\n", { encoding: "utf8" });
    } else {
      await writeFile(eventsPath, line + "\n", { encoding: "utf8" });
    }
  } catch {
    /* best-effort — manifest is the canonical record */
  }
}

// ---- git HEAD helper -------------------------------------------------

export function readGitHead(repoRoot: string): string {
  try {
    const out = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    return out.trim();
  } catch {
    return "unknown";
  }
}

// ---- Comparison path helper (mirrors compare.ts default) -------------

function defaultComparisonPathFor(
  runsDir: string,
  baseline: string,
  candidate: string,
): string {
  return resolve(runsDir, "_compare", `${baseline}__${candidate}.json`);
}

// ---- Dry-run + status formatters -------------------------------------

export function formatStartDryRun(report: LoopStartDryRun): string {
  const lines: string[] = [];
  lines.push(`benchmark loop --start --dry-run --case ${report.caseSlug}`);
  lines.push(`  baseline_run_id   : ${report.baselineRunId}`);
  lines.push(`  baseline_run_dir  : ${report.baselineRunDir}`);
  lines.push(`  manifest_path     : ${report.manifestPath}`);
  lines.push(`  reflections_dir   : ${report.reflectionsDir}`);
  lines.push(`  plugin_ref_before : ${report.pluginRefBefore}`);
  lines.push(`  host_repo_root    : ${report.hostRepoRoot}`);
  lines.push(`  baseline_argv     : ${JSON.stringify(report.argv)}`);
  lines.push("");
  lines.push("(dry-run: no subprocess spawned; no manifest written)");
  return lines.join("\n") + "\n";
}

export function formatContinueDryRun(report: LoopContinueDryRun): string {
  const lines: string[] = [];
  lines.push(`benchmark loop --continue --dry-run`);
  lines.push(`  manifest_path        : ${report.manifestPath}`);
  lines.push(`  baseline_run_id      : ${report.manifest.baseline_run_id}`);
  lines.push(`  case_slug            : ${report.manifest.case_slug}`);
  lines.push(`  plugin_ref_before    : ${report.pluginRefBefore}`);
  lines.push(`  plugin_ref_after     : ${report.pluginRefAfter}`);
  lines.push(`  apply (proposal_id)  : ${report.proposalId}`);
  lines.push(`  apply (source_path)  : ${report.proposalSourcePath}`);
  lines.push(`  candidate_run_id     : ${report.candidateRunId}`);
  lines.push(`  candidate_run_dir    : ${report.candidateRunDir}`);
  lines.push(`  comparison_path      : ${report.comparisonPath}`);
  lines.push(`  manifest_state_after : completed`);
  lines.push("");
  lines.push("(dry-run: validated manifest; no candidate spawned; manifest unchanged)");
  return lines.join("\n") + "\n";
}

export function formatStatusReport(report: LoopStatusReport): string {
  const m = report.manifest;
  const lines: string[] = [];

  // Diff mode short-circuits the full report (operator asked for one
  // proposal's diff blocks; full state inspection is not the goal).
  if (report.diff !== undefined) {
    const d = report.diff;
    lines.push(
      `benchmark loop --status --baseline-run-id ${m.baseline_run_id} --diff ${d.proposal_id}`,
    );
    lines.push(`  manifest_path : ${report.manifestPath}`);
    lines.push(`  source_path   : ${d.source_path}`);
    lines.push(`  diff_blocks   : ${d.diffBlocks.length}`);
    lines.push("");
    if (d.freeform) {
      lines.push(
        "This proposal is freeform — no machine-readable diff/patch block found.",
      );
      lines.push(
        "Review the body carefully via `loop --status` (full mode) before applying.",
      );
    } else {
      for (let i = 0; i < d.diffBlocks.length; i++) {
        lines.push(`---- diff block ${i + 1} of ${d.diffBlocks.length} ----`);
        lines.push(d.diffBlocks[i] ?? "");
        lines.push("");
      }
    }
    return lines.join("\n") + "\n";
  }

  lines.push(`benchmark loop --status --baseline-run-id ${m.baseline_run_id}`);
  lines.push(`  manifest_path     : ${report.manifestPath}`);
  lines.push(`  state             : ${m.state}`);
  lines.push(`  case_slug         : ${m.case_slug}`);
  lines.push(`  plugin_ref_before : ${m.plugin_ref_before}`);
  lines.push(`  started_at        : ${m.started_at}`);
  lines.push(`  available_proposals (${m.available_proposals.length}):`);

  // F1.2 / M3 — aggregate WARNING across all proposals' high-trust path
  // matches. Single line at the top of the proposals block so operator
  // sees the surface immediately, before reading bodies.
  const aggregateHighTrust = new Set<string>();
  for (const r of report.proposals) {
    for (const h of r.highTrustPaths) aggregateHighTrust.add(h);
  }
  if (aggregateHighTrust.size > 0) {
    const sorted = [...aggregateHighTrust].sort();
    lines.push(
      `  WARNING: high-trust path(s) referenced by one or more proposals: ${sorted.join(", ")}`,
    );
    lines.push(
      `           review the verbatim body below; modifying these surfaces requires extra scrutiny.`,
    );
  }

  // Per-proposal block — summary, source_path, per-proposal WARNING (if
  // any), then VERBATIM body framed by "---- body ----" markers so the
  // operator can grep for body boundaries.
  for (const p of m.available_proposals) {
    lines.push(`    - ${p.proposal_id}`);
    lines.push(`        source_path: ${p.source_path}`);
    lines.push(`        summary:     ${p.summary}`);
    const review = report.proposals.find((r) => r.proposal_id === p.proposal_id);
    if (review !== undefined && review.highTrustPaths.length > 0) {
      lines.push(
        `        WARNING:     proposal references high-trust path(s): ${review.highTrustPaths.join(", ")}`,
      );
    }
    if (review !== undefined) {
      lines.push(`        ---- body (verbatim, ${review.body.length} chars) ----`);
      // Indent each body line by 8 spaces to keep the block scannable
      // inside the tree-style output, but DO NOT alter content otherwise.
      const bodyLines = review.body.split(/\r?\n/);
      for (const bl of bodyLines) lines.push(`        ${bl}`);
      lines.push(`        ---- end body ----`);
    }
  }

  if (m.applied_proposal !== undefined) {
    lines.push(`  applied_proposal:`);
    lines.push(`    proposal_id      : ${m.applied_proposal.proposal_id}`);
    lines.push(`    source_path      : ${m.applied_proposal.source_path}`);
    lines.push(`    applied_at       : ${m.applied_proposal.applied_at}`);
    lines.push(`    plugin_ref_after : ${m.applied_proposal.plugin_ref_after}`);
    lines.push(`    candidate_run_id : ${m.applied_proposal.candidate_run_id}`);
  }
  if (m.state === "awaiting-apply" && m.available_proposals.length > 0) {
    lines.push("");
    lines.push("Next: apply a proposal in your host repo, commit, then run:");
    const firstId = m.available_proposals[0]?.proposal_id ?? "<proposal-id>";
    lines.push(
      `  npm run benchmark -- loop --continue --baseline-run-id ${m.baseline_run_id} --apply ${firstId}`,
    );
    lines.push(
      "  (or `loop --status --diff <proposal-id>` to inspect a proposal's fenced diff blocks)",
    );
  }
  return lines.join("\n") + "\n";
}

// Avoid an unused-import lint; statSync is exposed for future tests.
void statSync;

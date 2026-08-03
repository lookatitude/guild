/**
 * src/modules/capability/workflows/independence-record.ts
 *
 * T7-H2 — the ON-RECORD store for §7a `independence_adjudication` blocks
 * (guild.model_resolution.v1 §7a; SC-7/SC-13).
 *
 * WHY THIS EXISTS. The T7 security audit found that the only `independence`
 * value reaching a persisted, SHAREABLE artifact was an UNVERIFIED one:
 * `router.ts` set `independence: "strong"` unconditionally on every
 * non-degraded route (no producer/reviewer comparison, no identity trust
 * check, no served-model binding — only "a fully-qualifying host was found"),
 * the launcher persisted it into `run-state.json → lanes[<id>].host.independence`,
 * and `run-state.json` is in the share-set AND git re-included. Meanwhile
 * `buildIndependenceAdjudication` — the block writer §7a actually defines —
 * had ZERO production callers, so the honest verdict was never written at all.
 *
 * THE TWO-PART FIX (this module is part 2 of 2):
 *   1. `router.ts` no longer self-asserts strong — it is always "weak" there.
 *   2. A `strong` value may reach a persisted lane record ONLY when a WRITTEN,
 *      hash-bound §7a block exists on record BOUND TO THAT EXACT LANE.
 *      `run-state.ts` enforces that with `assertPersistableIndependence` below,
 *      so the invariant holds for EVERY producer, not just the router.
 *
 * ── WHAT ROUND 1 GOT WRONG (T7R-R1-B2) ──────────────────────────────────────
 * Round 1's guard was RUN-WIDE, not lane-bound: `hasStrongAdjudication(runDir)`
 * asked only "is ANY written block in this run strong?", and `upsertLane` passed
 * nothing but the run dir + the asserted string. So ONE legitimate strong
 * adjudication — say the G-lane broker's Claude/Codex pair — unlocked
 * `independence: "strong"` for EVERY other lane in the run, including lanes with
 * a same-family reviewer, an unverified host, or no review at all. The reviewer's
 * counterexample wrote a valid strong block labelled `lane-a` and then persisted
 * `independence: "strong"` for an unrelated `lane-b` on `selected: pi` /
 * `model: unverified-model`; the write succeeded.
 *
 * ── THE BINDING NOW ─────────────────────────────────────────────────────────
 * Authorization is bound to the EXACT record being written, on three keys that
 * must all match one single block:
 *   (a) the LANE — the block's `producer_ref.dispatch_id` must equal the
 *       run-state lane key being written. A lane's producing dispatch IS that
 *       lane; a block adjudicating some other dispatch says nothing about it.
 *   (b) the PRODUCER receipt hash — exact sha256 equality.
 *   (c) the REVIEWER dispatch id + receipt hash — exact equality.
 * Exactly ONE block may match: two blocks binding the same pair are AMBIGUOUS
 * and refuse (filename order never decides which verdict applies — the same
 * reasoning behind `conflicting_decisions`). The matched block must itself
 * adjudicate `strong`; a matching `weak` block authorizes nothing.
 *
 * The lane record must therefore DECLARE its binding (`host.independence_ref`),
 * which also makes the shared artifact self-auditing: a reader can re-verify the
 * strong claim against the named block instead of trusting the string.
 *
 * LOCATION. Blocks live run-local at
 * `<root>/.guild/runs/<run_id>/independence/<label>.json`, alongside the M0
 * `inspection/` evidence the M2 gate already loads from the same run tree.
 *
 * WRITE DISCIPLINE. `persistIndependenceAdjudication` mirrors
 * `inspection-persist.ts` exactly: binding-verified before any write, target
 * dir derived from the VERIFIED binding's run_id, atomic temp+rename, and —
 * per T7-M3 — NO injectable fs seam, so authorization and effect can never act
 * on different filesystems.
 */

import * as fs from "fs";
import * as path from "path";

// Lazy barrel access (deferred require): a top-level `import … from "../../lifecycle"`
// makes capability/index eagerly initialize the lifecycle barrel, which re-exports
// `require.main`-gated CLI modules (check-lane-liveness, …) that misfire when a hook
// bundle — which reaches capability/index via runstart-preflight — eagerly loads
// them. Deferring to call time (this file's writers only, never a hook path) keeps
// the barrel out of the eager graph. Mirrors settings-reader.ts's lazy capability access.
function lifecycleApi(): typeof import("../../lifecycle") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../../lifecycle");
}
import {
  buildIndependenceAdjudication,
  validateAdjudicationRef,
  validateWrittenAdjudication,
  type AdjudicationRef,
  type ReviewPartyFacts,
  type WrittenAdjudication,
} from "./independence-predicates";

/** Run-dir-relative directory holding written §7a blocks. */
export const INDEPENDENCE_DIR = "independence";

const SAFE_LABEL = /^[A-Za-z0-9_.-]+$/;

/** `<runDir>/independence` — the on-record location for §7a blocks. */
export function independenceDirForRunDir(runDir: string): string {
  return path.join(runDir, INDEPENDENCE_DIR);
}

/**
 * Load every VALID written §7a block from a run directory. Invalid/unparseable
 * files are dropped, never coerced — a fragment is not an adjudication. Never
 * throws: an absent directory yields an empty list (which, for the guard
 * below, means "no strong is persistable" — the fail-closed direction).
 */
export function loadWrittenAdjudications(runDir: string): WrittenAdjudication[] {
  const dir = independenceDirForRunDir(runDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: WrittenAdjudication[] = [];
  for (const name of names) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    const block = validateWrittenAdjudication(parsed);
    if (block) out.push(block);
  }
  return out;
}

/**
 * The binding keys a lane record must declare to persist `independence:
 * "strong"`. `lane_id` is the run-state lane key being written; the refs are the
 * EXACT §7a backward references of the adjudication that produced the verdict.
 */
export interface IndependenceBinding {
  /** The run-state lane key this record is being written for. */
  lane_id: string;
  producer_ref: AdjudicationRef;
  reviewer_ref: AdjudicationRef;
}

/** Validate a caller-supplied binding into its closed, hash-checked shape. */
export function validateIndependenceBinding(v: unknown): IndependenceBinding | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const lane_id = o["lane_id"];
  if (typeof lane_id !== "string" || lane_id.length === 0) return null;
  const producer_ref = validateAdjudicationRef(o["producer_ref"]);
  const reviewer_ref = validateAdjudicationRef(o["reviewer_ref"]);
  if (!producer_ref || !reviewer_ref) return null;
  return { lane_id, producer_ref, reviewer_ref };
}

function sameRef(a: AdjudicationRef, b: AdjudicationRef): boolean {
  return a.dispatch_id === b.dispatch_id && a.receipt_hash === b.receipt_hash;
}

/**
 * Every written block whose producer AND reviewer refs match this binding
 * EXACTLY (dispatch id + sha256 receipt hash on both sides). Returns [] when the
 * binding is unsatisfied — the fail-closed direction. NOT a run-wide scan: a
 * strong block for some other lane/pair never appears here.
 */
export function findBoundAdjudications(
  runDir: string,
  binding: IndependenceBinding,
): WrittenAdjudication[] {
  return loadWrittenAdjudications(runDir).filter(
    (b) => sameRef(b.producer_ref, binding.producer_ref) && sameRef(b.reviewer_ref, binding.reviewer_ref),
  );
}

/**
 * THE PERSISTENCE GUARD (T7-H2 / T7R-R1-B2). Throws when a caller tries to
 * persist `independence: "strong"` into a run's shareable state without a
 * written §7a block bound to THIS EXACT lane and THIS EXACT producer/reviewer
 * receipt pair. `weak` always passes — degrading is never gated.
 *
 * Fail CLOSED and LOUD rather than silently downgrading: a producer asserting
 * an unearned strong is a contract violation the operator must see, and a
 * silent rewrite would be exactly the "never-silent-degradation" breach the
 * rest of this codebase refuses.
 */
export function assertPersistableIndependence(
  runDir: string,
  independence: string | undefined,
  context: string,
  binding: unknown,
): void {
  if (independence !== "strong") return;

  const where = independenceDirForRunDir(runDir);
  const bound = validateIndependenceBinding(binding);
  if (!bound) {
    throw new Error(
      `independence_binding_missing: refusing to persist independence:"strong" for ${context} — ` +
        `the record declares no valid §7a binding {lane_id, producer_ref:{dispatch_id,receipt_hash}, ` +
        `reviewer_ref:{dispatch_id,receipt_hash}} (receipt hashes must be sha256 hex). A strong ` +
        `verdict is persistable only as a claim ON a specific adjudication, never as a bare string. ` +
        `Record the adjudication first (persistIndependenceAdjudication) or persist "weak".`,
    );
  }

  // (a) LANE BINDING. A lane's producing dispatch IS that lane; a block
  // adjudicating some other dispatch says nothing about this one. This is the
  // exact hole the reviewer walked through: lane-a's block authorizing lane-b.
  if (bound.producer_ref.dispatch_id !== bound.lane_id) {
    throw new Error(
      `independence_binding_lane_mismatch: refusing to persist independence:"strong" for ${context} ` +
        `— the declared adjudication's producer dispatch is "${bound.producer_ref.dispatch_id}" but ` +
        `the record being written is lane "${bound.lane_id}". An adjudication of ANOTHER lane's ` +
        `dispatch never authorizes this one, however valid it is. Adjudicate THIS lane's own ` +
        `producer/reviewer receipts or persist "weak".`,
    );
  }

  // (b)+(c) HASH BINDING, and exactly one matching block.
  const matches = findBoundAdjudications(runDir, bound);
  if (matches.length === 0) {
    throw new Error(
      `independence_not_adjudicated: refusing to persist independence:"strong" for ${context} — ` +
        `no WRITTEN, hash-bound guild.model_resolution.v1 §7a independence_adjudication block under ` +
        `${where} matches this record's binding (producer ${bound.producer_ref.dispatch_id}@` +
        `${bound.producer_ref.receipt_hash.slice(0, 12)}…, reviewer ${bound.reviewer_ref.dispatch_id}@` +
        `${bound.reviewer_ref.receipt_hash.slice(0, 12)}…). §7a admits NO provisional strong: a ` +
        `strong review verdict exists only as an adjudicated block binding BOTH parties' finalized ` +
        `receipts. Record the adjudication first (persistIndependenceAdjudication) or persist "weak".`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `independence_adjudication_ambiguous: refusing to persist independence:"strong" for ${context} ` +
        `— ${matches.length} written §7a blocks under ${where} bind the SAME producer/reviewer ` +
        `receipt pair. Which verdict applies is ambiguous, and filename order never decides. ` +
        `Resolve the duplicate blocks and re-adjudicate.`,
    );
  }
  if (matches[0].independence !== "strong") {
    throw new Error(
      `independence_not_adjudicated: refusing to persist independence:"strong" for ${context} — the ` +
        `§7a block bound to this record adjudicated "${matches[0].independence}", not "strong" ` +
        `(${matches[0].predicate_trace}). The persisted value must be the ADJUDICATED one; a caller ` +
        `never upgrades a verdict.`,
    );
  }
}

/**
 * Write ONE §7a adjudication block as run-local, on-record evidence.
 *
 * The verdict is NEVER caller-supplied: it is computed by the canonical
 * `buildIndependenceAdjudication`, which itself refuses to run before BOTH
 * referenced receipts are finalized. This function only decides WHERE the
 * canonical block lands and that a verified run binding authorizes the write.
 */
export function persistIndependenceAdjudication(input: {
  root: string;
  binding: { run_id: string; binding_ref: string };
  /** File label (e.g. the gate or dispatch id); one block per label. */
  label: string;
  producer_ref: { dispatch_id: string; receipt_hash: string };
  reviewer_ref: { dispatch_id: string; receipt_hash: string };
  producer: ReviewPartyFacts;
  reviewer: ReviewPartyFacts;
  requested_independence: "none" | "prefer_cross_family" | "require_cross_family";
}): { absPath: string; ref: string; independence: "strong" | "weak" } {
  const { root, binding, label } = input;
  if (!SAFE_LABEL.test(label)) {
    throw new Error(`adjudication label "${label}" is not a safe path segment — refusing`);
  }
  // Canonical §7a assembly + the premature-write refusal live in the predicate
  // module; nothing is re-implemented here.
  const block = buildIndependenceAdjudication({
    producer_ref: input.producer_ref,
    reviewer_ref: input.reviewer_ref,
    producer: input.producer,
    reviewer: input.reviewer,
    requested_independence: input.requested_independence,
  });
  const validated = validateWrittenAdjudication(block);
  if (!validated) {
    // Defensive: the canonical builder must always emit a valid closed block.
    // If it ever does not, refuse rather than persist an unreadable record.
    throw new Error(
      "adjudication_shape_invalid: buildIndependenceAdjudication produced a block that does not " +
        "validate as a written §7a adjudication — refusing to persist",
    );
  }
  // §5 fail-closed gate: no write without the run's verified open binding.
  // T7-M3: no fs seam — verification and effect share the real filesystem.
  const verified = lifecycleApi().assertWritableBinding({
    root,
    run_id: binding.run_id,
    binding_ref: binding.binding_ref,
  });
  const dir = path.join(root, ".guild", "runs", verified.run_id, INDEPENDENCE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${label}.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(block, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, target);
  return {
    absPath: target,
    ref: path.join(INDEPENDENCE_DIR, `${label}.json`),
    independence: validated.independence,
  };
}

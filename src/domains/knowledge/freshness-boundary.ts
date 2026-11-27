/**
 * freshness-boundary.ts — K02: hooks are hints, the source basis decides.
 *
 * A published layer is current only when a source basis observed NOW equals the
 * basis it was published for. Hook-reported touched paths can schedule work but
 * never prove freshness: a dropped hook leaves no hint and the comparison still
 * finds the drift. A marker without a basis (commit stamp, cached `state`) is
 * `unknown`. A verification larger than the budget is not run and reports
 * `pending`. Only a verified `current_for_basis` admits critical acceptance.
 */

import { freshnessFor, type ChannelState, type InventoryEntry, type SourceBasis } from "./source-basis";

type BasisRef = Pick<SourceBasis, "basis" | "source_basis_hash"> & {
  resolver_unresolved?: readonly string[];
  inventory?: readonly InventoryEntry[];
};

/** Whatever a publisher left behind. Only `source_basis` is evidence. */
export interface FreshnessMarker {
  source_basis?: BasisRef | null;
  [claim: string]: unknown;
}

export interface VerificationBudget {
  max_files: number;
  max_bytes: number;
}

export interface BoundaryInput {
  marker: FreshnessMarker | null;
  /** Hook-observed touched paths since publication. Hints only. */
  hints: readonly string[];
  /** Cheap size of the verification (inventory files and bytes). */
  estimate: { files: number; bytes: number };
  budget: VerificationBudget;
  /** Computes the observed basis. Called only within budget. */
  observe: () => BasisRef;
}

export interface BoundaryVerdict {
  state: ChannelState;
  /** True iff a basis was observed and compared. */
  verified: boolean;
  reason: string;
  /** Inventory paths whose bytes differ from the marker (when both carry inventories). */
  drift: string[];
  /** Drifted paths no hint reported (dropped hooks). */
  hints_missed: string[];
}

function hasBasis(m: FreshnessMarker | null): m is FreshnessMarker & { source_basis: BasisRef } {
  const sb = m?.source_basis;
  return !!sb && typeof sb === "object" && !!sb.basis && typeof sb.basis === "object" && typeof sb.source_basis_hash === "string";
}

function inventoryDrift(a: readonly InventoryEntry[] | undefined, b: readonly InventoryEntry[] | undefined): string[] {
  if (!Array.isArray(a) || !Array.isArray(b)) return [];
  const before = new Map(a.map((e) => [e.path, e.sha256] as const));
  const after = new Map(b.map((e) => [e.path, e.sha256] as const));
  const out = new Set<string>();
  for (const [p, h] of before) if (after.get(p) !== h) out.add(p);
  for (const p of after.keys()) if (!before.has(p)) out.add(p);
  return [...out].sort();
}

export function reconcileBoundary(input: BoundaryInput): BoundaryVerdict {
  const verdict = (state: ChannelState, verified: boolean, reason: string, drift: string[] = []): BoundaryVerdict => {
    const hinted = new Set(input.hints);
    return { state, verified, reason, drift, hints_missed: drift.filter((p) => !hinted.has(p)) };
  };
  if (!hasBasis(input.marker)) return verdict("unknown", false, "marker carries no source basis; its claims are not evidence");
  const { files, bytes } = input.estimate;
  const { max_files, max_bytes } = input.budget;
  if (!(Number.isFinite(files) && Number.isFinite(bytes)) || files > max_files || bytes > max_bytes) {
    return verdict("pending", false, `verification (${files} files, ${bytes} bytes) exceeds budget (${max_files} files, ${max_bytes} bytes)`);
  }
  const observed = input.observe();
  const state = freshnessFor(input.marker.source_basis, observed);
  const drift = state === "stale" ? inventoryDrift(input.marker.source_basis.inventory, observed.inventory) : [];
  const reason =
    state === "current_for_basis"
      ? "observed basis equals published basis"
      : state === "stale"
        ? "observed basis differs from published basis"
        : "basis from another worktree or with unresolved resolver inputs";
  return verdict(state, true, reason, drift);
}

/** Critical acceptance waits for a verified basis equal to the published one. */
export function admitCritical(v: BoundaryVerdict): boolean {
  return v.verified && v.state === "current_for_basis";
}

/**
 * Adopted policy for background (hook-triggered) structural refresh: bounded
 * job count and size, structural channel only. Semantic/deep learning is never
 * scheduled from a hint; a user runs it explicitly.
 */
export const BACKGROUND_STRUCTURAL_POLICY = Object.freeze({
  policy: "guild.learn.background_structural.v1",
  channel: "structural_graph" as const,
  max_jobs: 4,
  max_paths_per_job: 64,
});
export const BACKGROUND_HARD_LIMITS = Object.freeze({ max_jobs: 16, max_paths_per_job: 256 });

export type BackgroundPolicy = {
  policy: string;
  channel: "structural_graph";
  max_jobs: number;
  max_paths_per_job: number;
};

export interface BackgroundPlan {
  jobs: Array<{ channel: "structural_graph"; paths: string[] }>;
  /** Hinted paths beyond the bound; they stay pending until a later run. */
  deferred: string[];
  /** The structural channel stays pending until a verified run publishes. */
  state: "pending";
}

/** Deterministic, bounded job plan from hook hints (order and duplicates ignored). */
export function planBackgroundRefresh(hints: readonly string[], policy: BackgroundPolicy = BACKGROUND_STRUCTURAL_POLICY): BackgroundPlan {
  if (policy.channel !== "structural_graph") throw new Error(`background refresh is structural only; ${String(policy.channel)} learning is explicit`);
  const intOk = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;
  if (!intOk(policy.max_jobs, BACKGROUND_HARD_LIMITS.max_jobs) || !intOk(policy.max_paths_per_job, BACKGROUND_HARD_LIMITS.max_paths_per_job)) {
    throw new Error(`background policy out of bound (max_jobs<=${BACKGROUND_HARD_LIMITS.max_jobs}, max_paths_per_job<=${BACKGROUND_HARD_LIMITS.max_paths_per_job})`);
  }
  const paths = [...new Set(hints.filter((h) => typeof h === "string" && h !== ""))].sort();
  const cap = policy.max_jobs * policy.max_paths_per_job;
  const jobs: BackgroundPlan["jobs"] = [];
  for (let i = 0; i < Math.min(paths.length, cap); i += policy.max_paths_per_job) {
    jobs.push({ channel: "structural_graph", paths: paths.slice(i, Math.min(i + policy.max_paths_per_job, cap)) });
  }
  return { jobs, deferred: paths.slice(cap), state: "pending" };
}

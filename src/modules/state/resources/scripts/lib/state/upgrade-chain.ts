/**
 * scripts/lib/state/upgrade-chain.ts
 *
 * The COLD half of the layout upgrade (U-UPG). `ensure-storage-layout.ts` is the
 * hot half: a marker read that must stay ≤50ms and must not load a single step
 * (KTD29). Everything the chain actually needs — the step catalog, the v1 content
 * converter, and the closed policy-key contract — lives behind this module, which
 * is loaded non-analyzably and only when a root is NOT already current.
 *
 * Why the seam is here rather than in the domain: the state domain must not import
 * the `config` barrel or the host-facing converter. Both edges would drag their
 * transitive fan-out into every bundle that touches storage — measured at 15
 * domains on the `status` entrypoint, against an allowlist of six. So the domain
 * declares what it needs (`V1ContentConverter`, `PolicyClassifier`) and THIS file,
 * which is allowed to see both sides, supplies them.
 *
 * Compiled to `runtime/scripts/upgrade-chain.js`. NOT a CLI: `config migrate`
 * (migrate-guild) and SessionStart (ensure-storage-layout) are the two callers.
 *
 * CONTRACT: no argv parsing, no stdout. It returns a report; the caller prints it.
 */

import { formatUpgradeReport, runUpgrade } from "../../../src/modules/state";
// The closed policy set, imported NARROWLY (not through the config barrel) so the
// compiled chunk carries `policy-keys` + kernel and not all of config's fan-out.
import {
  canonicalPolicyKey,
  findHostIdentity,
  isPolicyKey,
} from "../../../src/modules/config/workflows/policy-keys";
import { planMigration, runMigration } from "../../dot-guild/convert";

/** What `ensureStorageLayout` reports back to its caller. */
export interface UpgradeChainReport {
  state: string;
  marker_written: boolean;
  dirty_paths: string[];
  question: string | null;
  report: string;
}

export interface RunLayoutUpgradeOptions {
  root: string;
  fromVersion: number | null;
  toVersion: number;
  dryRun?: boolean;
}

/**
 * The v1 content converter as step `v1-content` sees it. `workspace: false` is
 * explicit: the chain upgrades THIS root, and a child fan-out is only ever the
 * operator's typed `config migrate --workspace` (§21.1 — the updater never scans).
 */
function v1Converter(opts: { root: string; dryRun: boolean }): {
  classification: string;
  action: string;
  changed: number;
  reportPath?: string;
  error?: string;
} {
  // A dry run goes through the PURE planning entry. `runMigration({mode:"dry-run"})`
  // still writes its report file, and a plan that leaves a file behind is not a plan.
  const result = opts.dryRun
    ? planMigration({ root: opts.root, workspace: false })
    : runMigration({ root: opts.root, mode: "migrate", workspace: false });
  const child = result.children[0];
  if (!child) return { classification: "none", action: "none", changed: 0 };
  return {
    classification: child.detect.classification,
    action: child.action,
    changed: child.artifacts.length,
    reportPath: child.reportPath,
    // Carried, never swallowed. A snapshot-verify abort or a corrupt block is a
    // STEP FAILURE upstream; dropping it here would let the marker be stamped over
    // a tree the converter refused to touch.
    error: child.error,
  };
}

export function runLayoutUpgrade(opts: RunLayoutUpgradeOptions): UpgradeChainReport {
  const result = runUpgrade({
    cwd: opts.root,
    fromVersion: opts.fromVersion,
    toVersion: opts.toVersion,
    dryRun: opts.dryRun === true,
    v1: v1Converter,
    policy: { canonicalPolicyKey, isPolicyKey, findHostIdentity },
  });
  return {
    state: result.state,
    marker_written: result.marker_written,
    dirty_paths: result.dirty_paths,
    question: result.question,
    report: formatUpgradeReport(result),
  };
}

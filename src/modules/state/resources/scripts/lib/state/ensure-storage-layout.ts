/**
 * scripts/lib/state/ensure-storage-layout.ts
 *
 * The SessionStart fast path AND the layout upgrade entry (KTD23 / KTD29, R39).
 * Every write-capable surface calls this before it writes.
 *
 * The budget this file exists to hold: when `storage_layout_version` already
 * equals CURRENT, activation must be a single stat + read of one small file and
 * nothing else — no sqlite, no BM25, no upgrade work, no directory walk (≤50ms,
 * measured by scripts/lint/__tests__/hot-path-budget.test.ts). That is why the
 * chain is behind a lazy `require` inside the non-current branch: the budgeted
 * path never loads a step, a journal, or the v1 converter.
 *
 * Three properties the chain does not get to break:
 *   1. `detect()` stays allocation-cheap and touches exactly one path.
 *   2. The current-layout branch returns BEFORE any step is loaded.
 *   3. A FUTURE layout fails closed; it never down-migrates.
 *
 * WHAT RUNS ON ACTIVATION. `unmarked` and `stale` roots run the upgrade chain for
 * THIS cwd only — no disk scan, no implicit child walk, no auto-commit, and the
 * marker is stamped only after validation. A dirty tracked `.guild/` blocks the
 * durable steps and leaves v1 content in place (compatibility-read); the safe-local
 * steps still run. The report names the exact dirty paths and the retry command.
 *
 * CONTRACT: pure except the single marker read on the budgeted path. The upgrade
 * branch writes, and says so in what it returns.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { resolveGuildRoot } from "../guild-root";

/** Layout this build understands. Raised by the step chain that transfers to it. */
export const CURRENT_LAYOUT_VERSION = 2;

export type LayoutState = "absent" | "unmarked" | "current" | "stale" | "future";

export interface LayoutStatus {
  state: LayoutState;
  /** The version read from the marker, when one was present and parsable. */
  version: number | null;
  /** The resolved Guild root the marker was looked for under. */
  root: string;
  /** The marker path, for the caller's diagnostics. */
  marker: string;
  /**
   * Present only when this call RAN the upgrade chain. `state` is the transaction
   * state (`committed` · `blocked_dirty_durable` · `blocked_confirm` · `failed` …);
   * `report` is the block `config migrate` and the T0 summary print.
   */
  upgrade?: {
    state: string;
    marker_written: boolean;
    dirty_paths: string[];
    question: string | null;
    report: string;
  };
}

/** The marker file. One small JSON document directly under `.guild/`. */
export function markerPath(root: string): string {
  return path.join(root, ".guild", "storage-layout.json");
}

/**
 * Read the layout marker. Never throws; an unreadable or malformed marker is
 * `unmarked`, which the chain treats as "run the v1 detection steps".
 */
export function detect(cwd: string = process.cwd()): LayoutStatus {
  const root = resolveGuildRoot(cwd);
  const marker = markerPath(root);
  if (!fs.existsSync(path.join(root, ".guild"))) {
    return { state: "absent", version: null, root, marker };
  }
  let version: number | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(marker, "utf8")) as { storage_layout_version?: unknown };
    if (typeof parsed.storage_layout_version === "number") version = parsed.storage_layout_version;
  } catch {
    version = null;
  }
  if (version === null) return { state: "unmarked", version, root, marker };
  if (version === CURRENT_LAYOUT_VERSION) return { state: "current", version, root, marker };
  return { state: version > CURRENT_LAYOUT_VERSION ? "future" : "stale", version, root, marker };
}

/**
 * The upgrade chain, loaded LAZILY and NON-ANALYZABLY.
 *
 * Non-analyzable on purpose (the same trick `capability-profile` uses for its
 * evidence chunk): a literal specifier would let esbuild inline the whole chain —
 * the step catalog, the v1 converter and the config policy contract — back into
 * THIS bundle, and this bundle is the ≤50ms SessionStart entry. Measured: inlining
 * it took `runtime/scripts/ensure-storage-layout.js` to 1.4 MB and widened the
 * `status` require-graph from 2 domains to 15.
 *
 * Compiled sibling first (the shipped `runtime/scripts/` layout), then the source
 * module (tsx / jest).
 */
type UpgradeChunk = typeof import("./upgrade-chain");
let upgradeChunk: UpgradeChunk | null = null;
function upgradeChain(): UpgradeChunk {
  if (upgradeChunk === null) {
    const candidates = [
      path.join(__dirname, "upgrade-chain.js"),
      path.join(__dirname, "lib", "state", "upgrade-chain"),
      path.join(__dirname, "upgrade-chain"),
    ];
    const spec = candidates.find((c) => fs.existsSync(c) || fs.existsSync(`${c}.ts`)) ?? candidates[2];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    upgradeChunk = require(spec) as UpgradeChunk;
  }
  return upgradeChunk;
}

export interface EnsureOptions {
  /** Compute the plan and write nothing — `config migrate --mode=dry-run`. */
  dryRun?: boolean;
  /** Skip the chain entirely and only report (`--mode=skip`). */
  detectOnly?: boolean;
}

/**
 * The entry every write-capable surface calls.
 *
 *   current            → return immediately (the budgeted path; nothing is loaded)
 *   future             → fail closed (KTD23: never down-migrate)
 *   absent             → no `.guild/` here; nothing to upgrade
 *   unmarked / stale   → run (or resume) the upgrade chain for THIS cwd
 */
export function ensureStorageLayout(cwd: string = process.cwd(), opts: EnsureOptions = {}): LayoutStatus {
  const status = detect(cwd);
  if (status.state === "current") return status;
  if (status.state === "future") {
    throw new Error(
      `guild: .guild/ is layout ${status.version}, this build understands ${CURRENT_LAYOUT_VERSION}. ` +
        `Upgrade Guild; a newer layout is never down-migrated (${status.marker}).`,
    );
  }
  if (status.state === "absent" || opts.detectOnly === true) return status;

  // Lazy on purpose: the budgeted branch above has already returned.
  const chain = upgradeChain();
  const result = chain.runLayoutUpgrade({
    root: status.root,
    fromVersion: status.version,
    toVersion: CURRENT_LAYOUT_VERSION,
    dryRun: opts.dryRun === true,
  });

  const after = detect(cwd);
  return { ...after, upgrade: result };
}

// ---------------------------------------------------------------------------
// CLI — compiled to runtime/scripts/ensure-storage-layout.js and spawned by
// hooks/bootstrap.sh. Silent on the happy path; 0 tokens of stdout.
// ---------------------------------------------------------------------------

/**
 * Is THIS module the process entry?
 *
 * NOT `require.main === module`. This module is imported by other CLIs
 * (`config migrate`, `status`), and esbuild inlines an imported module's top
 * level into the IMPORTER's bundle — where `require.main === module` is true.
 * That made `migrate-guild.js --root=<other>` silently run a full upgrade on
 * `process.cwd()` and `process.exit(0)` before its own main ever ran. Observed,
 * not theorised: it rewrote a working tree it was never pointed at.
 *
 * `process.argv[1]` is the script node (or tsx) was actually asked to run, so it
 * stays false inside any bundle this module is merely a part of.
 */
function isProcessEntry(): boolean {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry === "") return false;
  return /(^|[\\/])ensure-storage-layout(\.[cm]?[jt]s)?$/.test(entry);
}

if (isProcessEntry()) {
  const cwdArg = process.argv.find((a) => a.startsWith("--cwd="));
  const cwd = cwdArg ? cwdArg.slice("--cwd=".length) : process.cwd();
  try {
    const status = ensureStorageLayout(cwd, {
      dryRun: process.argv.includes("--dry-run"),
      detectOnly: process.argv.includes("--detect-only"),
    });
    if (process.argv.includes("--print")) {
      process.stdout.write(JSON.stringify(status) + "\n");
    } else if (status.upgrade && status.upgrade.state !== "committed") {
      // A blocked or failed upgrade is the ONE thing activation may not swallow:
      // the root is now reading v1 content and the operator has to know why.
      process.stderr.write(`${status.upgrade.report}\n`);
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}

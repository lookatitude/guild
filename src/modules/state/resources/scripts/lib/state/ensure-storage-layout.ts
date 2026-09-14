/**
 * scripts/lib/state/ensure-storage-layout.ts
 *
 * The SessionStart fast path (KTD29 / KTD23). T02 lands ONLY the marker read and
 * the compiled entry; T07 owns `CURRENT_LAYOUT_VERSION = 2`, the versioned step
 * chain, the journal outside `.guild`, and the dirty-durable block.
 *
 * The budget this file exists to hold: when `storage_layout_version` already
 * equals CURRENT, activation must be a single stat + read of one small file and
 * nothing else — no sqlite, no BM25, no upgrade work, no directory walk (≤50ms,
 * measured by scripts/lint/__tests__/hot-path-budget.test.ts).
 *
 * T07 contract — keep these three properties when the step chain lands:
 *   1. `detect()` stays allocation-cheap and touches exactly one path.
 *   2. The current-layout branch returns BEFORE any step is loaded.
 *   3. A FUTURE layout fails closed; it never down-migrates.
 *
 * CONTRACT: pure except for the single marker read. No clock, no network, no write.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { resolveGuildRoot } from "../guild-root";

/** T07 raises this to 2 with the step chain. T02 ships the read only. */
export const CURRENT_LAYOUT_VERSION = 1;

export type LayoutState = "absent" | "unmarked" | "current" | "stale" | "future";

export interface LayoutStatus {
  state: LayoutState;
  /** The version read from the marker, when one was present and parsable. */
  version: number | null;
  /** The resolved Guild root the marker was looked for under. */
  root: string;
  /** The marker path, for the caller's diagnostics. */
  marker: string;
}

/** The marker file. One small JSON document directly under `.guild/`. */
export function markerPath(root: string): string {
  return path.join(root, ".guild", "storage-layout.json");
}

/**
 * Read the layout marker. Never throws; an unreadable or malformed marker is
 * `unmarked`, which T07's chain treats as "run the v1 detection steps".
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
 * The entry every write-capable surface calls. T02 behaviour:
 *   current            → return immediately (the budgeted path)
 *   future             → fail closed (KTD23: never down-migrate)
 *   absent/unmarked/stale → return the status and let the caller proceed
 *                           unchanged; T07 replaces this branch with the chain.
 */
export function ensureStorageLayout(cwd: string = process.cwd()): LayoutStatus {
  const status = detect(cwd);
  if (status.state === "future") {
    throw new Error(
      `guild: .guild/ is layout ${status.version}, this build understands ${CURRENT_LAYOUT_VERSION}. ` +
        `Upgrade Guild; a newer layout is never down-migrated (${status.marker}).`,
    );
  }
  return status;
}

// ---------------------------------------------------------------------------
// CLI — compiled to runtime/scripts/ensure-storage-layout.js and spawned by
// hooks/bootstrap.sh. Silent on the happy path; 0 tokens of stdout.
// ---------------------------------------------------------------------------

if (require.main === module) {
  const cwdArg = process.argv.find((a) => a.startsWith("--cwd="));
  const cwd = cwdArg ? cwdArg.slice("--cwd=".length) : process.cwd();
  try {
    const status = ensureStorageLayout(cwd);
    if (process.argv.includes("--print")) {
      process.stdout.write(JSON.stringify(status) + "\n");
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}

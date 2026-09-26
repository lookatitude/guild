/**
 * Backward-compatible public and CLI entrypoint.
 *
 * The degraded filesystem recall reader lives in src/modules/context so the
 * reorg can move internals without breaking imports from scripts/lib/fs-scanner
 * or `npx tsx scripts/lib/fs-scanner.ts`.
 */

import * as fsScannerImpl from "../../src/domains/knowledge/fs-scanner";

export const fsScan = fsScannerImpl.fsScan;
export const runFsScannerCli = fsScannerImpl.runFsScannerCli;
export type {
  FsScanHit,
  FsScanResult,
  FsScanOpts,
} from "../../src/domains/knowledge/fs-scanner";

if (typeof module !== "undefined" && require.main === module) {
  runFsScannerCli();
}

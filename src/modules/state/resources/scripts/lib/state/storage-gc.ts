#!/usr/bin/env node
/**
 * scripts/lib/state/storage-gc.ts
 *
 * The compiled entry behind `/guild:maintain gc` (T04 left that row with no
 * handler). Two sweeps, one report:
 *
 *   scratch  — Guild OS-temp older than the TTL; removed only with `--apply`.
 *   durable  — KTD15 debris under `.guild/`; REPORTED, never deleted.
 *
 *   node runtime/scripts/storage-gc.js [--cwd=<dir>] [--apply] [--ttl-hours=24] [--json]
 *
 * Deliberately not a delete-everything button: the durable side has no delete
 * path, so a mis-typed `--apply` can never cost a user their knowledge (R2).
 */

import { ensureStorageLayout } from "./ensure-storage-layout";
import { formatGcReport, runStorageGc } from "../../../src/modules/state";

export { formatGcReport, runStorageGc };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const cwd = opt("cwd") ?? process.cwd();
  const ttlRaw = opt("ttl-hours");
  const ttlHours = ttlRaw === undefined ? undefined : Number(ttlRaw);
  if (ttlHours !== undefined && (!Number.isFinite(ttlHours) || ttlHours < 0)) {
    process.stderr.write(`--ttl-hours must be a non-negative number (got ${ttlRaw})\n`);
    process.exit(2);
  }
  try {
    // KTD23: a write-capable entry bootstraps the layout before it touches anything.
    ensureStorageLayout(cwd);
    const report = runStorageGc(cwd, { apply: argv.includes("--apply"), ttlHours });
    process.stdout.write(
      (argv.includes("--json") ? JSON.stringify(report, null, 2) : formatGcReport(report)) + "\n",
    );
    process.exit(0);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}

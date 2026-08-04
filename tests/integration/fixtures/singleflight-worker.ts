/**
 * tests/integration/fixtures/singleflight-worker.ts — lane T4 rework rounds 2–3
 * (G-lane findings T4-R1-004, T4-R2-002).
 *
 * Child-process body for the REAL cross-process singleflight probe. Each
 * worker is a separate OS process that opens the same file-backed store, mints
 * the SAME CatalogCacheKey from the identity JSON via createCacheKey (round 3:
 * raw string keys no longer exist on the protocol surface), and runs
 * singleflightDiscover with a deliberately slow discovery. The discovery
 * appends one line to discoveries.log, so the parent test can assert exactly
 * ONE discovery ran across all processes; the final snapshot is printed to
 * stdout so the parent can assert byte-identical shared results.
 *
 * argv: <storeDir> <identityJson> <runId> <discoverMs> <label>
 */

import * as fs from "fs";
import * as path from "path";

import {
  CacheKeyIdentity,
  createCacheKey,
  createStore,
  singleflightDiscover,
} from "../../../src/modules/capability/workflows/catalog-cache";

const [storeDir, identityJson, runId, discoverMsStr, label] = process.argv.slice(2);

async function main(): Promise<void> {
  const store = createStore(storeDir);
  const identity = JSON.parse(identityJson) as CacheKeyIdentity;
  const key = createCacheKey(identity, runId || undefined);
  const outcome = await singleflightDiscover(
    store,
    key,
    async () => {
      // Every discovery execution leaves an audit line — the parent asserts count === 1.
      fs.appendFileSync(path.join(storeDir, "discoveries.log"), `${label}\n`, "utf8");
      await new Promise((resolve) => setTimeout(resolve, Number(discoverMsStr)));
      return {
        generation: 0, // singleflightDiscover assigns the monotonic generation
        body: `discovered-by-${label}`,
        discovery: { discovered_at: new Date().toISOString(), ttl_seconds: 600 },
      };
    },
    { lockWaitMs: 20_000, pollIntervalMs: 25 }
  );
  process.stdout.write(
    JSON.stringify({
      label,
      key_kind: key.kind,
      key_hash: key.hash,
      role: outcome.role,
      discovery_ran: outcome.discovery_ran,
      snapshot: outcome.snapshot,
    })
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(String(err?.stack ?? err));
    process.exit(1);
  }
);

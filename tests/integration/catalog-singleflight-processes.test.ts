/**
 * tests/integration/catalog-singleflight-processes.test.ts — lane T4 rework
 * round 2 (G-lane finding T4-R1-004; permanent reviewer probe).
 *
 * REAL cross-process singleflight: two separate OS processes hit the same
 * file-backed store key with overlapping slow discoveries. The contract
 * (guild.model_catalog.v1 §7) requires them to coalesce — the per-target lock
 * is acquired BEFORE discovery begins (lock → check fresh → discover →
 * CAS-write → release) — so exactly one discovery runs and every process
 * receives the byte-identical published snapshot. Round-1 defect: both
 * processes ran discovery (discovery_count=2) and returned their own bodies.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  CacheKeyIdentity,
  createCacheKey,
} from "../../src/modules/capability/workflows/catalog-cache";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const TSX_BIN = path.join(PLUGIN_ROOT, "tests", "node_modules", ".bin", "tsx");
const WORKER = path.join(__dirname, "fixtures", "singleflight-worker.ts");

/** Known-org identity — both processes mint the SAME reusable key from it. */
function sharedIdentity(): CacheKeyIdentity {
  return {
    target_id: "claude-api",
    family: "claude",
    surface: "api",
    provider_kind: "anthropic_api",
    auth_mode: "api_key",
    account_fingerprint: "fp-acct-2proc",
    endpoint_fingerprint: "fp-endp-2proc",
    org_fingerprint: "fp-org-2proc",
    tool_version: "claude-cli 2.1.220",
    adapter_id: "claude-api-models",
    adapter_version: "1.0.0",
  };
}

interface WorkerOutput {
  label: string;
  key_kind: string;
  key_hash: string;
  role: string;
  discovery_ran: boolean;
  snapshot: Record<string, unknown>;
}

function runWorker(storeDir: string, identity: CacheKeyIdentity, discoverMs: number, label: string): Promise<WorkerOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [WORKER, storeDir, JSON.stringify(identity), "", String(discoverMs), label], {
      cwd: PLUGIN_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`worker ${label} exited ${code}: ${stderr}`));
      try {
        resolve(JSON.parse(stdout) as WorkerOutput);
      } catch {
        reject(new Error(`worker ${label} emitted unparseable stdout: ${stdout}`));
      }
    });
  });
}

describe("cross-process singleflight (two real OS processes, one key)", () => {
  test(
    "REGRESSION (T4-R1-004): concurrent processes coalesce — exactly one discovery, byte-identical shared snapshot",
    async () => {
      const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-singleflight-2proc-"));
      const identity = sharedIdentity();
      // The parent mints the same reusable key locally for its filesystem asserts.
      const key = createCacheKey(identity);
      expect(key.kind).toBe("reusable");
      // 1500 ms discovery >> process startup skew, so if BOTH processes were
      // able to discover (the round-1 defect) their windows would overlap and
      // the log would show two lines.
      const [a, b] = await Promise.all([
        runWorker(storeDir, identity, 1500, "proc-a"),
        runWorker(storeDir, identity, 1500, "proc-b"),
      ]);
      // Both processes minted the identical reusable key from the identity.
      expect(a.key_kind).toBe("reusable");
      expect(a.key_hash).toBe(key.hash);
      expect(b.key_hash).toBe(key.hash);

      const logPath = path.join(storeDir, "discoveries.log");
      const discoveries = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
      expect(discoveries).toHaveLength(1); // ONE discovery across both processes

      // Both processes hold the byte-identical published snapshot…
      expect(JSON.stringify(a.snapshot)).toBe(JSON.stringify(b.snapshot));
      // …which is the winner's, not each process's own body.
      expect(a.snapshot.body).toBe(`discovered-by-${discoveries[0]}`);
      expect([a, b].filter((w) => w.discovery_ran)).toHaveLength(1);
      const loser = [a, b].find((w) => !w.discovery_ran)!;
      expect(["coalesced", "cached"]).toContain(loser.role);

      // The store holds exactly one committed entry for the key, generation 1,
      // scope-stamped from the ReusableCacheKey (never caller-supplied).
      const entry = JSON.parse(fs.readFileSync(path.join(storeDir, `${key.hash}.json`), "utf8"));
      expect(entry.generation).toBe(1);
      expect(entry.cache_meta.run_scope).toBe("shared");
      expect(fs.existsSync(path.join(storeDir, `${key.hash}.json.lock`))).toBe(false); // released
    },
    60_000
  );
});

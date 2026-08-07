/**
 * C4 — Collision-safe cache key + deterministic race simulation
 * (model_catalog §7; SC-11, SC-13).
 *
 * Contract: one key per full target tuple (+ tool/adapter versions +
 * run_scope); unknown-org quarantine (run-local salt); atomic temp+rename;
 * singleflight; monotonic generation; CAS publication (stale writer rejected);
 * lock timeout degrades read-side to newest valid cache else honest unknown —
 * never blocks, never triggers a paid probe.
 *
 * EXPECTED TO FAIL TODAY: src/modules/capability/workflows/catalog-cache.ts
 * does not exist (lane T4). Race fixtures are DETERMINISTIC simulations
 * (explicit interleavings — no wall-clock, no threads, no network).
 */

import {
  requireContractModule,
  referenceTargetTuple,
  referenceCacheKey,
  TARGET_TUPLE_COMPONENTS,
} from "./_helpers";

const CACHE_MODULE = "src/modules/capability/workflows/catalog-cache";
const LANE = "T4-catalog-discovery";

describe("C4 model_catalog §7 — cache key + concurrency", () => {
  /** The public constructor input: reference tuple minus the derived fields. */
  function referenceIdentity(): Record<string, string> {
    const { v: _v, run_scope: _rs, ...identity } = referenceTargetTuple();
    return identity;
  }

  describe("collision-safe key construction (T4-R2-002: sealed createCacheKey factory)", () => {
    test("FAILING-TODAY: cache module exists with createCacheKey/publishSnapshot/readSnapshot — and NO permissive buildCacheKey", () => {
      const mod: any = requireContractModule(CACHE_MODULE, LANE);
      expect(typeof mod.createCacheKey).toBe("function");
      expect(typeof mod.publishSnapshot).toBe("function");
      expect(typeof mod.readSnapshot).toBe("function");
      // The round-2 bypass surface is GONE, not deprecated.
      expect(mod.buildCacheKey).toBeUndefined();
      expect(mod.buildCacheKeyForRun).toBeUndefined();
    });

    test.each([...TARGET_TUPLE_COMPONENTS].filter((c) => c !== "run_scope"))(
      "FAILING-TODAY: changing identity component %s rotates the key",
      (component) => {
        const mod: any = requireContractModule(CACHE_MODULE, LANE);
        const base = referenceIdentity();
        const changed = { ...base, [component]: `${base[component]}-CHANGED` };
        expect(mod.createCacheKey(changed, "run-aaaa").hash).not.toBe(mod.createCacheKey(base, "run-aaaa").hash);
      }
    );

    test("FAILING-TODAY: run_scope rotates the key too — but ONLY via derivation (run id under unknown-org quarantine), never caller-supplied", () => {
      const mod: any = requireContractModule(CACHE_MODULE, LANE);
      const unknownOrg = { ...referenceIdentity(), org_fingerprint: "unknown" };
      const keyRunA = mod.createCacheKey(unknownOrg, "run-aaaa");
      const keyRunB = mod.createCacheKey(unknownOrg, "run-bbbb");
      expect(keyRunA.kind).toBe("run_local");
      expect(keyRunA.hash).not.toBe(keyRunB.hash);
      // And the resolver derives run_scope: <run_id> when org is unknown,
      // literal "shared" only for a real observed digest.
      expect(mod.runScopeFor({ org_fingerprint: "unknown", run_id: "run-aaaa" })).toBe("run-aaaa");
      expect(mod.runScopeFor({ org_fingerprint: "fp-org-0001", run_id: "run-aaaa" })).toBe("shared");
    });

    test("FAILING-TODAY REGRESSION (T4-R2-002): the round-2 bypass probe throws at construction — no unknown-org reusable key exists", () => {
      const mod: any = requireContractModule(CACHE_MODULE, LANE);
      const unknownOrg = { ...referenceIdentity(), org_fingerprint: "unknown" };
      // The EXACT round-2 probe: unknown org + caller-supplied run_scope, no run_id.
      expect(() => mod.createCacheKey({ ...unknownOrg, run_scope: "fixed-caller-scope" })).toThrow(
        /quarantine/
      );
      // No run identity at all: unrepresentable.
      expect(() => mod.createCacheKey(unknownOrg)).toThrow(/quarantine/);
      // A known org yields the reusable kind; unknown org can never reach it.
      expect(mod.createCacheKey(referenceIdentity()).kind).toBe("reusable");
      expect(mod.createCacheKey(unknownOrg, "run-aaaa").kind).toBe("run_local");
    });

    test("FAILING-TODAY REGRESSION (T4-R2-002 round 4): the round-3 TOCTOU probe — a non-idempotent org_fingerprint getter can never mint a shared key with a hashed-unknown org", () => {
      const mod: any = requireContractModule(CACHE_MODULE, LANE);
      const toctou = () => {
        let reads = 0;
        const identity: Record<string, unknown> = { ...referenceIdentity() };
        delete identity.org_fingerprint;
        Object.defineProperty(identity, "org_fingerprint", {
          enumerable: true,
          get: () => (++reads === 1 ? "fp-observed" : "unknown"),
        });
        return identity;
      };
      // Fresh instances for run-a and run-b, exactly as the round-3 probe ran:
      // accessor-backed identities are rejected at construction, so neither
      // run obtains ANY key — a shared reusable one least of all.
      expect(() => mod.createCacheKey(toctou(), "run-aaaa")).toThrow(/quarantine/);
      expect(() => mod.createCacheKey(toctou(), "run-bbbb")).toThrow(/accessor-backed/);
    });

    test("[control] the reference key builder distinguishes every tuple component (anti-vacuity)", () => {
      const base = referenceTargetTuple();
      const baseKey = referenceCacheKey(base);
      for (const component of TARGET_TUPLE_COMPONENTS) {
        const changed = { ...base, [component]: `${base[component]}-CHANGED` };
        expect(referenceCacheKey(changed)).not.toBe(baseKey);
      }
    });

    test("[control] injected known-bad key builder (omits auth_mode) collides and is caught", () => {
      const badKey = (t: Record<string, string>) => {
        const { auth_mode: _dropped, ...rest } = t;
        return referenceCacheKey(rest as Record<string, string>);
      };
      const apiKeyTarget = referenceTargetTuple();
      const subTarget = { ...apiKeyTarget, auth_mode: "subscription" };
      // The bad builder collides across auth modes — the exact defect class
      // the per-component rotation table exists to catch.
      expect(badKey(apiKeyTarget)).toBe(badKey(subTarget));
      expect(referenceCacheKey(apiKeyTarget)).not.toBe(referenceCacheKey(subTarget));
    });
  });

  describe("deterministic race simulation (stale writers, CAS, lock timeout)", () => {
    /** A minted key per salt — the protocol surface accepts ONLY minted keys. */
    function mintedKey(mod: any, salt: string): unknown {
      return mod.createCacheKey({ ...referenceIdentity(), account_fingerprint: `fp-acct-${salt}` });
    }

    test("FAILING-TODAY: a stale writer (older generation) is rejected by CAS publication and discarded", () => {
      const mod: any = requireContractModule(CACHE_MODULE, LANE);
      const store = mod.createStore();
      const key = mintedKey(mod, "cas");
      // Interleaving: writer-new publishes generation 2 BEFORE writer-old
      // (holding generation 1's derivation) attempts publication.
      expect(mod.publishSnapshot(store, key, { generation: 2, body: "new" }).published).toBe(true);
      const stale = mod.publishSnapshot(store, key, { generation: 1, body: "old" });
      expect(stale.published).toBe(false);
      expect(stale.reason).toBe("stale_writer");
      expect(mod.readSnapshot(store, key).body).toBe("new");
    });

    test("FAILING-TODAY: two hosts on the SAME key singleflight — one discovery, one shared result", () => {
      const mod: any = requireContractModule(CACHE_MODULE, LANE);
      const store = mod.createStore();
      let discoveries = 0;
      const discover = () => {
        discoveries += 1;
        return { generation: 1, body: "discovered" };
      };
      // Deterministic interleaving: both callers enter before either publishes.
      const [a, b] = mod.singleflight(store, mintedKey(mod, "sf"), [discover, discover]);
      expect(a.body).toBe("discovered");
      expect(b.body).toBe("discovered");
      expect(discoveries).toBe(1);
    });

    test("FAILING-TODAY: lock timeout degrades read-side to newest valid cache, else honest unknown — never a paid probe", () => {
      const mod: any = requireContractModule(CACHE_MODULE, LANE);
      const store = mod.createStore();
      const key = mintedKey(mod, "cached");
      mod.publishSnapshot(store, key, { generation: 1, body: "cached" });
      const withCache = mod.readUnderLockTimeout(store, key);
      expect(withCache).toEqual(expect.objectContaining({ degraded: true, body: "cached" }));
      const withoutCache = mod.readUnderLockTimeout(store, mintedKey(mod, "empty"));
      expect(withoutCache).toEqual(expect.objectContaining({ degraded: true, evidence_state: "unknown" }));
      expect(withoutCache.probe_issued).toBe(false);
    });

    test("FAILING-TODAY REGRESSION (T4-R2-002): the protocol surface rejects raw strings and structural key forgeries", () => {
      const mod: any = requireContractModule(CACHE_MODULE, LANE);
      const store = mod.createStore();
      expect(() => mod.publishSnapshot(store, "raw-key", { generation: 1 })).toThrow(/minted/);
      const forged = { kind: "reusable", hash: "f".repeat(64), run_scope: "shared" };
      expect(() => mod.readSnapshot(store, forged)).toThrow(/minted/);
    });

    test("[control] reference CAS semantics distinguish stale vs fresh writers (anti-vacuity)", () => {
      const published = new Map<string, { generation: number; body: string }>();
      const cas = (key: string, snap: { generation: number; body: string }) => {
        const cur = published.get(key);
        if (cur && cur.generation >= snap.generation) return { published: false, reason: "stale_writer" };
        published.set(key, snap);
        return { published: true };
      };
      expect(cas("k1", { generation: 2, body: "new" }).published).toBe(true);
      expect(cas("k1", { generation: 1, body: "old" })).toEqual({ published: false, reason: "stale_writer" });
      expect(published.get("k1")!.body).toBe("new");
      // Known-bad last-write-wins semantics are caught by the same fixture:
      const lastWriteWins = new Map<string, { generation: number; body: string }>();
      lastWriteWins.set("k1", { generation: 2, body: "new" });
      lastWriteWins.set("k1", { generation: 1, body: "old" });
      expect(lastWriteWins.get("k1")!.body).not.toBe("new");
    });
  });

  describe("share/scrub coverage (module-map §1 — both legs)", () => {
    test("FAILING-TODAY: .guild/indexes/model-catalog/ is covered by BOTH scrub legs (scrub.ts redaction + audit.ts coverage)", () => {
      // Workspace lesson: the dot-guild share-set is duplicated in scrub.ts
      // (redacts) AND audit.ts (policy-gate coverage); updating one leaves CI
      // red. This pins that the cache dir lands in both.
      const fs = require("fs");
      const path = require("path");
      const { PLUGIN_ROOT } = require("./_helpers");
      const scrubPath = path.join(PLUGIN_ROOT, "scripts", "dot-guild", "scrub.ts");
      const auditPath = path.join(PLUGIN_ROOT, "scripts", "dot-guild", "audit.ts");
      // Both legs must exist (they do today) AND both must cover the new
      // model-catalog cache dir (they do not — the T4 change adds it to BOTH).
      expect(fs.existsSync(scrubPath)).toBe(true);
      expect(fs.existsSync(auditPath)).toBe(true);
      expect(fs.readFileSync(scrubPath, "utf8")).toContain("model-catalog");
      expect(fs.readFileSync(auditPath, "utf8")).toContain("model-catalog");
    });
  });
});

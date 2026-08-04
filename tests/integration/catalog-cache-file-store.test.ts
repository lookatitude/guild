/**
 * tests/integration/catalog-cache-file-store.test.ts — lane T4
 * (run-20260730-131020-dynamic-host-model-routing; rework rounds 1–3).
 *
 * REAL-PATH cache verification: the FILE-backed store (temp-write + rename,
 * per-key lock, CAS, corruption fail-soft) on a real tmp directory — the
 * in-memory seam the C4 contract fixtures exercise proves the protocol, this
 * suite proves the production path. Plus: byte-parity of the hand-rolled
 * canonical-YAML with the js-yaml reference, the catalog §7 cached-inspection
 * budget (500 ms p95), and the T4-R2-002 sealed key surface: CatalogCacheKey
 * is minted ONLY by createCacheKey; ReusableCacheKey has no public
 * constructor; caller-supplied run_scope is unrepresentable.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import * as yaml from "js-yaml";

import * as catalogCache from "../../src/modules/capability/workflows/catalog-cache";
import {
  CACHED_INSPECTION_BUDGET_MS,
  CacheKeyIdentity,
  CatalogCacheKey,
  MODEL_CATALOG_CACHE_REL,
  ReusableCacheKey,
  UnknownOrgQuarantineViolation,
  canonicalYamlFlat,
  createCacheKey,
  createStore,
  invalidateKey,
  isModelCatalogCachePath,
  isReusableCacheKey,
  isRunLocalCacheKey,
  isSnapshotStale,
  modelCatalogCacheDir,
  nextGeneration,
  publishSnapshot,
  purgeRunLocalEntries,
  readSnapshot,
  readUnderLockTimeout,
  runScopeFor,
  singleflight,
  singleflightDiscover,
} from "../../src/modules/capability/workflows/catalog-cache";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-catalog-cache-"));
}

function refYaml(map: Record<string, string>): string {
  const dumped = yaml.dump(map, { sortKeys: true, flowLevel: -1, indent: 2, lineWidth: -1, noRefs: true });
  return dumped.endsWith("\n") ? dumped : `${dumped}\n`;
}

/** The full hashed tuple, as the §7 contract serializes it (reference form). */
function refTuple(): Record<string, string> {
  return {
    v: "guild.model_catalog.v1",
    target_id: "claude-api",
    family: "claude",
    surface: "api",
    provider_kind: "anthropic_api",
    auth_mode: "api_key",
    account_fingerprint: "fp-acct-0001",
    endpoint_fingerprint: "fp-endp-0001",
    org_fingerprint: "fp-org-0001",
    tool_version: "claude-cli 2.1.220",
    adapter_id: "claude-api-models",
    adapter_version: "1.0.0",
    run_scope: "shared",
  };
}

/** The public constructor input: the identity tuple (no v, no run_scope). */
function refIdentity(): CacheKeyIdentity {
  const { v: _v, run_scope: _rs, ...identity } = refTuple();
  return identity as CacheKeyIdentity;
}

/** Distinct minted reusable keys for store-protocol tests. */
function mkKey(salt: string): CatalogCacheKey {
  return createCacheKey({ ...refIdentity(), account_fingerprint: `fp-acct-${salt}` });
}

// ── Canonical YAML parity with the contract-fixture reference (js-yaml) ──────

describe("canonical YAML byte-parity with the js-yaml reference (team-contracts §1)", () => {
  test("reference tuple and every -CHANGED variant serialize byte-identically", () => {
    const base = refTuple();
    expect(canonicalYamlFlat(base)).toBe(refYaml(base));
    for (const component of Object.keys(base)) {
      const changed = { ...base, [component]: `${base[component]}-CHANGED` };
      expect(canonicalYamlFlat(changed)).toBe(refYaml(changed));
    }
  });

  test("quoting edge values match js-yaml exactly", () => {
    const edgy: Record<string, string> = {
      empty: "",
      floaty: "1.0",
      inty: "42",
      expo: "1e3",
      hexy: "0x1A",
      booly: "true",
      noish: "no",
      nully: "null",
      tilde: "~",
      spacey: "claude-cli 2.1.220",
      dotted: "0.146.0",
      unknown: "unknown",
      dashy: "run-aaaa-bbbb",
      coloned: "a:b",
      colonspace: "a: b",
      hashy: "value #comment",
      leaddash: "-lead",
      quoted: "it's",
    };
    expect(canonicalYamlFlat(edgy)).toBe(refYaml(edgy));
  });

  test("createCacheKey byte-matches the contract fixtures' reference key builder (known org ⇒ run_scope shared)", () => {
    const referenceKey = crypto.createHash("sha256").update(refYaml(refTuple()), "utf8").digest("hex");
    const key = createCacheKey(refIdentity());
    expect(key.kind).toBe("reusable");
    expect(key.hash).toBe(referenceKey);
  });

  test("a missing component serializes as the literal `unknown` — absence can never collide with a real value", () => {
    const withUnknown = createCacheKey({ ...refIdentity(), tool_version: "unknown" });
    const { tool_version: _omitted, ...partial } = refIdentity();
    const withMissing = createCacheKey(partial as never);
    expect(withMissing.hash).toBe(withUnknown.hash);
    expect(withMissing.hash).not.toBe(createCacheKey(refIdentity()).hash);
  });
});

// ── T4-R2-002: sealed key construction — the quarantine is TYPE-enforced ─────

describe("sealed cache-key surface (T4-R2-002 encapsulation, permanent reviewer probes)", () => {
  const unknownOrgIdentity = (): CacheKeyIdentity => ({ ...refIdentity(), org_fingerprint: "unknown" });

  test("REGRESSION (T4-R1-003): identical unknown-org identities under run-a/run-b can never share a key", () => {
    const keyA = createCacheKey(unknownOrgIdentity(), "run-a");
    const keyB = createCacheKey(unknownOrgIdentity(), "run-b");
    expect(keyA.kind).toBe("run_local");
    expect(keyA.hash).not.toBe(keyB.hash);
    // And the write/read probe on a REAL store: run-a's publication is invisible to run-b.
    const store = createStore(tmpDir());
    expect(publishSnapshot(store, keyA, { generation: 1, body: "run-a" }).published).toBe(true);
    expect(readSnapshot(store, keyB)).toBeNull();
    expect(readSnapshot(store, keyA)!.body).toBe("run-a");
  });

  test("an unknown-org identity with NO run identity cannot construct any key", () => {
    expect(() => createCacheKey(unknownOrgIdentity())).toThrow(UnknownOrgQuarantineViolation);
    expect(() => createCacheKey(unknownOrgIdentity(), "")).toThrow(/quarantine/);
    const { org_fingerprint: _omitted, ...missingOrg } = unknownOrgIdentity();
    expect(() => createCacheKey(missingOrg as never)).toThrow(UnknownOrgQuarantineViolation);
  });

  test("REGRESSION (T4-R2-002): the round-2 bypass probe — caller-supplied run_scope is unrepresentable AND throws", () => {
    // Compile-time leg: run_scope is not part of the public identity type.
    // @ts-expect-error — run_scope was removed from the constructor surface (T4-R2-002)
    const probe = () => createCacheKey({ ...unknownOrgIdentity(), run_scope: "fixed-caller-scope" });
    // Runtime leg: the exact round-2 probe shape (unknown org, no run_id,
    // fixed caller scope) throws at construction instead of returning a
    // reusable key…
    expect(probe).toThrow(UnknownOrgQuarantineViolation);
    // …and run_scope smuggling is rejected even WITH a run_id, and even for a
    // known org — the scope is derived, never caller-supplied.
    expect(() =>
      createCacheKey({ ...unknownOrgIdentity(), run_scope: "fixed-caller-scope" } as never, "run-a")
    ).toThrow(UnknownOrgQuarantineViolation);
    expect(() => createCacheKey({ ...refIdentity(), run_scope: "custom" } as never)).toThrow(
      UnknownOrgQuarantineViolation
    );
    expect(() => createCacheKey({ ...refIdentity(), run_id: "run-a" } as never)).toThrow(/never be caller-supplied/);
  });

  test("REGRESSION (T4-R2-002): ReusableCacheKey has no public constructor — forgeries fail to compile and are rejected at runtime", () => {
    // Compile-time leg: the brand symbol is module-private, so a structural
    // literal cannot satisfy the type.
    // @ts-expect-error — ReusableCacheKey carries a module-private brand; createCacheKey is the only constructor
    const forgedTyped: ReusableCacheKey = { kind: "reusable", hash: "f".repeat(64), run_scope: "shared" };
    void forgedTyped;
    // Runtime leg: casts, clones, and raw strings are all rejected by the
    // minted-key check on every protocol operation.
    const store = createStore(tmpDir());
    const forged = { kind: "reusable", hash: "f".repeat(64), run_scope: "shared" } as unknown as ReusableCacheKey;
    expect(() => publishSnapshot(store, forged, { generation: 1 })).toThrow(/minted CatalogCacheKey/);
    expect(() => readSnapshot(store, forged)).toThrow(/minted CatalogCacheKey/);
    const real = mkKey("clone-probe");
    const clone = JSON.parse(JSON.stringify(real)) as CatalogCacheKey; // structural clone, brand lost
    expect(() => readSnapshot(store, clone)).toThrow(/minted CatalogCacheKey/);
    expect(() => readSnapshot(store, "raw-string-key" as never)).toThrow(/minted CatalogCacheKey/);
  });

  test("REGRESSION (T4-R2-002 round 4): the round-3 TOCTOU probe — a non-idempotent org_fingerprint getter can never mint a key", () => {
    // The EXACT round-3 probe: a type-valid CacheKeyIdentity whose
    // org_fingerprint getter returns an observed digest on its FIRST read and
    // `unknown` on every later read. It compiles with ZERO diagnostics — no
    // expect-error marker needed, that is the point: previously it was
    // classified known-org at one read and HASHED as `unknown` at another,
    // minting the same reusable/shared key for run-a and run-b.
    const toctouIdentity = (): CacheKeyIdentity => {
      let reads = 0;
      const { org_fingerprint: _omitted, ...rest } = refIdentity();
      const identity = { ...rest } as Record<string, unknown>;
      Object.defineProperty(identity, "org_fingerprint", {
        enumerable: true,
        get(): string {
          reads += 1;
          return reads === 1 ? "fp-observed" : "unknown";
        },
      });
      return identity as CacheKeyIdentity;
    };
    // Accessor-backed identities are rejected at construction — BOTH runs
    // throw, so two runs cannot obtain the same key (or any key) this way.
    expect(() => createCacheKey(toctouIdentity(), "run-a")).toThrow(UnknownOrgQuarantineViolation);
    expect(() => createCacheKey(toctouIdentity(), "run-b")).toThrow(/accessor-backed/);
    expect(() => createCacheKey(toctouIdentity())).toThrow(/quarantine/);
  });

  test("REGRESSION (T4-R2-002 round 4): an inherited (prototype) getter bypasses the descriptor check but is neutralized by the single-read snapshot", () => {
    // Defense-in-depth leg: a getter the own-descriptor rejection cannot see.
    // Every identity component is materialized EXACTLY ONCE at entry, so the
    // one observed value drives BOTH the quarantine classification AND the
    // hash — classified-known-but-hashed-unknown is unrepresentable.
    const inherited = (first: string, later: string, counter: { reads: number }): CacheKeyIdentity => {
      const { org_fingerprint: _omitted, ...rest } = refIdentity();
      const proto = {};
      Object.defineProperty(proto, "org_fingerprint", {
        enumerable: true,
        get(): string {
          counter.reads += 1;
          return counter.reads === 1 ? first : later;
        },
      });
      return Object.assign(Object.create(proto), rest) as CacheKeyIdentity;
    };
    // unknown-first: the single read sees `unknown` ⇒ quarantined run-local,
    // distinct per run — two runs can never share it — and the getter fired ONCE.
    const countA = { reads: 0 };
    const keyA = createCacheKey(inherited("unknown", "fp-observed", countA), "run-a");
    expect(countA.reads).toBe(1);
    expect(keyA.kind).toBe("run_local");
    const countB = { reads: 0 };
    const keyB = createCacheKey(inherited("unknown", "fp-observed", countB), "run-b");
    expect(keyA.hash).not.toBe(keyB.hash);
    // observed-first: the single read sees the observed digest ⇒ reusable, and
    // the HASHED org is that SAME observed digest (byte-identical to the plain
    // data identity) — never `unknown`.
    const countC = { reads: 0 };
    const keyC = createCacheKey(inherited("fp-observed", "unknown", countC), "run-a");
    expect(countC.reads).toBe(1);
    expect(keyC.kind).toBe("reusable");
    expect(keyC.hash).toBe(createCacheKey({ ...refIdentity(), org_fingerprint: "fp-observed" }).hash);
    expect(keyC.hash).not.toBe(createCacheKey({ ...refIdentity(), org_fingerprint: "unknown" }, "run-a").hash);
  });

  test("REGRESSION (T4-R2-002 round 4): a non-string identity component is rejected before any classification or hashing", () => {
    const nonString = {
      ...refIdentity(),
      org_fingerprint: { toString: () => "fp-observed" },
    } as unknown as CacheKeyIdentity;
    expect(() => createCacheKey(nonString, "run-a")).toThrow(/plain string/);
  });

  test("the discriminated union is honest: known org ⇒ reusable/shared; unknown org ⇒ run_local/run id", () => {
    const reusable = createCacheKey(refIdentity(), "run-a");
    expect(reusable.kind).toBe("reusable");
    expect(reusable.run_scope).toBe("shared");
    expect(isReusableCacheKey(reusable)).toBe(true);
    expect(isRunLocalCacheKey(reusable)).toBe(false);
    // Reusable keys are run-independent: same identity, any run, same hash.
    expect(createCacheKey(refIdentity(), "run-b").hash).toBe(reusable.hash);
    const runLocal = createCacheKey({ ...refIdentity(), org_fingerprint: "unknown" }, "run-a");
    expect(runLocal.kind).toBe("run_local");
    expect(runLocal.run_scope).toBe("run-a");
    expect(isRunLocalCacheKey(runLocal)).toBe(true);
    expect(Object.isFrozen(reusable)).toBe(true);
  });

  test("the module's public runtime surface is exactly the sealed export set (no bypass symbols)", () => {
    expect(Object.keys(catalogCache).sort()).toEqual([
      "CACHED_INSPECTION_BUDGET_MS",
      "CACHE_KEY_COMPONENTS",
      "DEFAULT_CATALOG_TTL_SECONDS",
      "MODEL_CATALOG_CACHE_DIRNAME",
      "MODEL_CATALOG_CACHE_REL",
      "MODEL_CATALOG_CACHE_REL_SEGMENTS",
      "MODEL_CATALOG_SCHEMA_VERSION",
      "UNCACHED_DISCOVERY_BUDGET_MS",
      "UnknownOrgQuarantineViolation",
      "canonicalYamlFlat",
      "createCacheKey",
      "createStore",
      "invalidateKey",
      "isModelCatalogCachePath",
      "isReusableCacheKey",
      "isRunLocalCacheKey",
      "isSnapshotStale",
      "modelCatalogCacheDir",
      "nextGeneration",
      "publishSnapshot",
      "purgeRunLocalEntries",
      "readSnapshot",
      "readUnderLockTimeout",
      "runScopeFor",
      "sha256Hex",
      "singleflight",
      "singleflightDiscover",
    ]);
    // The round-2 bypass symbols are gone from the surface entirely.
    expect((catalogCache as Record<string, unknown>).buildCacheKey).toBeUndefined();
    expect((catalogCache as Record<string, unknown>).buildCacheKeyForRun).toBeUndefined();
  });
});

// ── run_scope + cache path helpers ───────────────────────────────────────────

describe("run-scope quarantine + cache path constants", () => {
  test("runScopeFor: unknown/absent org → run-local; observed digest → shared", () => {
    expect(runScopeFor({ org_fingerprint: "unknown", run_id: "run-x" })).toBe("run-x");
    expect(runScopeFor({ org_fingerprint: null, run_id: "run-x" })).toBe("run-x");
    expect(runScopeFor({ org_fingerprint: "fp-org-0001", run_id: "run-x" })).toBe("shared");
  });

  test("cache dir constants agree with the scrub-leg path", () => {
    expect(MODEL_CATALOG_CACHE_REL).toBe(".guild/indexes/model-catalog");
    expect(modelCatalogCacheDir("/ws")).toBe(path.join("/ws", ".guild", "indexes", "model-catalog"));
    expect(isModelCatalogCachePath(".guild/indexes/model-catalog/abc.json")).toBe(true);
    expect(isModelCatalogCachePath(".guild/indexes/other/abc.json")).toBe(false);
  });
});

// ── REAL file-backed store ───────────────────────────────────────────────────

describe("file-backed store: atomic publication, CAS, locks, corruption fail-soft", () => {
  test("publish is atomic temp-write + rename; no temp residue; read round-trips; scope stamped from the key", () => {
    const dir = tmpDir();
    const store = createStore(dir);
    const k1 = mkKey("atomic");
    const res = publishSnapshot(store, k1, { generation: 1, body: "v1" });
    expect(res.published).toBe(true);
    expect(fs.existsSync(path.join(dir, `${k1.hash}.json`))).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith(".tmp-"))).toEqual([]);
    expect(readSnapshot(store, k1)).toMatchObject({ generation: 1, body: "v1", cache_meta: { run_scope: "shared" } });
  });

  test("CAS on the real filesystem: stale writer rejected, newest snapshot survives", () => {
    const store = createStore(tmpDir());
    const k1 = mkKey("cas");
    expect(publishSnapshot(store, k1, { generation: 2, body: "new" }).published).toBe(true);
    const stale = publishSnapshot(store, k1, { generation: 1, body: "old" });
    expect(stale).toEqual({ published: false, reason: "stale_writer" });
    expect(readSnapshot(store, k1)!.body).toBe("new");
    expect(nextGeneration(store, k1)).toBe(3);
  });

  test("singleflight on the file store: one discovery, shared result", () => {
    const store = createStore(tmpDir());
    const k1 = mkKey("sf");
    let discoveries = 0;
    const discover = () => {
      discoveries += 1;
      return { generation: 1, body: "discovered" };
    };
    const [a, b, c] = singleflight(store, k1, [discover, discover, discover]);
    expect(discoveries).toBe(1);
    expect(a.body).toBe("discovered");
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  test("REGRESSION (T4-R1-004): singleflightDiscover acquires the lock BEFORE discovery — overlapping callers coalesce, one discovery", async () => {
    const store = createStore(tmpDir());
    const k1 = mkKey("sfd");
    let discoveries = 0;
    const slowDiscover = async () => {
      discoveries += 1;
      await new Promise((r) => setTimeout(r, 120));
      return { generation: 0, body: "winner-body" };
    };
    // Both callers enter concurrently against the same empty key with
    // overlapping discovery windows — the exact reviewer two-writer probe shape.
    const [a, b] = await Promise.all([
      singleflightDiscover(store, k1, slowDiscover, { lockWaitMs: 5000, pollIntervalMs: 5 }),
      singleflightDiscover(store, k1, slowDiscover, { lockWaitMs: 5000, pollIntervalMs: 5 }),
    ]);
    expect(discoveries).toBe(1); // never duplicated
    const roles = [a.role, b.role].sort();
    expect(roles).toEqual(["coalesced", "winner"]);
    expect((a.snapshot as { body?: string }).body).toBe("winner-body");
    expect(a.snapshot).toEqual(b.snapshot); // byte-identical shared result
    expect([a, b].filter((o) => o.discovery_ran)).toHaveLength(1);
  });

  test("singleflightDiscover: fresh snapshot short-circuits (cached role), stale snapshot re-discovers under the lock", async () => {
    const store = createStore(tmpDir());
    const k1 = mkKey("fresh");
    publishSnapshot(store, k1, { generation: 1, body: "old" });
    const cached = await singleflightDiscover(store, k1, () => {
      throw new Error("must not discover");
    });
    expect(cached.role).toBe("cached");
    expect(cached.discovery_ran).toBe(false);
    const refreshed = await singleflightDiscover(
      store,
      k1,
      () => ({ generation: 0, body: "new" }),
      { isFresh: () => false }
    );
    expect(refreshed.role).toBe("winner");
    expect((refreshed.snapshot as { body?: string }).body).toBe("new");
    expect(refreshed.snapshot.generation).toBe(2); // monotonic over the stale entry
  });

  test("singleflightDiscover: lock-wait exhaustion degrades to newest valid cache else honest unknown — never blocks, never probes", async () => {
    const dir = tmpDir();
    const store = createStore(dir, { lockStealAgeMs: 60_000 });
    const k1 = mkKey("locked");
    fs.mkdirSync(path.join(dir, `${k1.hash}.json.lock`)); // a live foreign writer holds the lock
    const started = Date.now();
    const out = await singleflightDiscover(
      store,
      k1,
      () => {
        throw new Error("must not discover under a foreign lock");
      },
      { lockWaitMs: 100, pollIntervalMs: 10 }
    );
    expect(Date.now() - started).toBeLessThan(5000); // bounded, not indefinite
    expect(out.role).toBe("degraded");
    expect(out.discovery_ran).toBe(false);
    expect(out.snapshot).toMatchObject({ degraded: true, probe_issued: false, evidence_state: "unknown" });
  });

  test("held lock: publish degrades to lock_timeout; read-side degrades to newest cache, else honest unknown; abandoned lock is stolen", () => {
    const dir = tmpDir();
    const store = createStore(dir, { lockStealAgeMs: 60_000 });
    const k1 = mkKey("steal");
    const kNone = mkKey("none");
    publishSnapshot(store, k1, { generation: 1, body: "cached" });

    // A concurrent writer holds the lock (fresh mtime).
    const lock = path.join(dir, `${k1.hash}.json.lock`);
    fs.mkdirSync(lock);
    expect(publishSnapshot(store, k1, { generation: 2, body: "blocked" })).toEqual({
      published: false,
      reason: "lock_timeout",
    });
    // Read side never blocks on the lock: newest valid cache, else honest unknown.
    expect(readUnderLockTimeout(store, k1)).toMatchObject({ degraded: true, probe_issued: false, body: "cached" });
    expect(readUnderLockTimeout(store, kNone)).toMatchObject({
      degraded: true,
      probe_issued: false,
      evidence_state: "unknown",
    });

    // Abandoned lock (older than steal age) is stolen and publication proceeds.
    const old = (Date.now() - 120_000) / 1000;
    fs.utimesSync(lock, old, old);
    expect(publishSnapshot(store, k1, { generation: 2, body: "recovered" }).published).toBe(true);
    expect(readSnapshot(store, k1)!.body).toBe("recovered");
  });

  test("corrupted entry fails soft to no-valid-cache (honest unknown), never throws", () => {
    const dir = tmpDir();
    const store = createStore(dir);
    const kBad = mkKey("bad");
    fs.writeFileSync(path.join(dir, `${kBad.hash}.json`), "{not json", "utf8");
    expect(readSnapshot(store, kBad)).toBeNull();
    expect(readUnderLockTimeout(store, kBad)).toMatchObject({ degraded: true, evidence_state: "unknown" });
  });

  test("unsafe raw keys are rejected at the storage seam before touching the filesystem", () => {
    const store = createStore(tmpDir());
    // Minted keys are always sha256 hex; the raw seam still hard-rejects
    // path-escaping names as defense in depth.
    expect(() => store.casPublish("../escape", { generation: 1 })).toThrow(/unsafe cache key/);
  });

  test("TTL staleness marks re-discovery, and run-local purge removes only quarantined entries (scope from the KEY)", () => {
    const store = createStore(tmpDir());
    const snap = {
      generation: 1,
      discovery: { discovered_at: "2026-07-30T13:00:00Z", ttl_seconds: 600 },
    };
    expect(isSnapshotStale(snap, "2026-07-30T13:05:00Z")).toBe(false);
    expect(isSnapshotStale(snap, "2026-07-30T13:10:01Z")).toBe(true); // stale ≠ unavailable

    const kShared = createCacheKey(refIdentity());
    const kRun = createCacheKey({ ...refIdentity(), org_fingerprint: "unknown" }, "run-aaaa");
    publishSnapshot(store, kShared, { generation: 1 });
    // Even a caller LYING about its scope is overridden by the key's stamp.
    publishSnapshot(store, kRun, { generation: 1, cache_meta: { run_scope: "shared" } });
    expect(readSnapshot(store, kRun)!.cache_meta).toMatchObject({ run_scope: "run-aaaa" });
    expect(purgeRunLocalEntries(store, "run-aaaa")).toBe(1);
    expect(readSnapshot(store, kShared)).not.toBeNull();
    expect(readSnapshot(store, kRun)).toBeNull();

    invalidateKey(store, kShared);
    expect(readSnapshot(store, kShared)).toBeNull();
  });
});

// ── Cached-inspection budget: 500 ms p95 over a fixture corpus (catalog §7) ──

describe("cached inspection budget (500 ms p95, fixture corpus)", () => {
  test("p95 of key-build + cached read stays under budget across a 60-target corpus", () => {
    const dir = tmpDir();
    const store = createStore(dir);
    // Corpus: 60 distinct target tuples with realistic snapshot bodies
    // (7-model catalogs shaped like the live [P3] capture).
    const appServerFixture = JSON.parse(
      fs.readFileSync(path.join(__dirname, "fixtures", "codex-app-server-model-list.result.json"), "utf8")
    );
    for (let i = 0; i < 60; i += 1) {
      const key = createCacheKey({ ...refIdentity(), account_fingerprint: `fp-acct-${i}` });
      publishSnapshot(store, key, {
        generation: 1,
        schema_version: "guild.model_catalog.v1",
        discovery: { discovered_at: "2026-07-30T13:00:00Z", ttl_seconds: 600 },
        models: appServerFixture.data,
      });
    }
    const samples: number[] = [];
    for (let i = 0; i < 300; i += 1) {
      const identity = { ...refIdentity(), account_fingerprint: `fp-acct-${i % 60}` };
      const start = process.hrtime.bigint();
      const key = createCacheKey(identity);
      const snap = readSnapshot(store, key);
      const stale = isSnapshotStale(snap as never, "2026-07-30T13:05:00Z");
      const end = process.hrtime.bigint();
      expect(snap).not.toBeNull();
      expect(stale).toBe(false);
      samples.push(Number(end - start) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThan(CACHED_INSPECTION_BUDGET_MS);
  });
});

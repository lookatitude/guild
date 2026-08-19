/**
 * src/modules/capability/workflows/catalog-cache.ts
 *
 * Target-keyed atomic catalog cache — guild.model_catalog.v1 §7 (lane T4,
 * run-20260730-131020-dynamic-host-model-routing).
 *
 * One cache entry per execution target per adapter build. The key is a sha256
 * over the canonical-YAML serialization (team-contracts §1: keys sorted in
 * code-point order, block style, 2-space indent, LF, one trailing newline) of
 * the FULL session_context §2 target tuple + tool/adapter versions + run_scope.
 * Every component is REQUIRED; an unknown component serializes as the literal
 * string `unknown` — never omitted — so absence can never collide with a real
 * value.
 *
 * Unknown-org quarantine (§7, normative): `org_fingerprint: unknown` is an
 * absence marker, not a scope identity. While it is `unknown`, run_scope is the
 * run id, making every entry run-local; a real observed org digest uses the
 * literal `shared` scope. Snapshots are never migrated between keys.
 *
 * Concurrency: atomic temp-write + rename, per-key lock, monotonic generation,
 * compare-and-swap publication (stale writer rejected + discarded), lock
 * timeout degrading read-side to newest valid cache else honest `unknown` —
 * never blocking, never issuing a paid probe.
 *
 * Cache location: `.guild/indexes/model-catalog/` under the consuming
 * workspace root. Entries are runtime-local machine state: excluded from the
 * git-shared set (all four repo .gitignores) and guarded by BOTH scrub-policy
 * legs (scripts/dot-guild/scrub.ts + audit.ts).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ── Contract constants ───────────────────────────────────────────────────────

export const MODEL_CATALOG_SCHEMA_VERSION = "guild.model_catalog.v1";
/** TTL after which a snapshot is STALE (re-discover); never fabricates `unavailable`. */
export const DEFAULT_CATALOG_TTL_SECONDS = 600;
/** Uncached discovery budget (catalog §6/§7). */
export const UNCACHED_DISCOVERY_BUDGET_MS = 3000;
/** Cached inspection budget: p95 over a fixture corpus (catalog §7). */
export const CACHED_INSPECTION_BUDGET_MS = 500;

/** Cache dir name + repo-relative segments — single source for the scrub legs. */
export const MODEL_CATALOG_CACHE_DIRNAME = "model-catalog";
export const MODEL_CATALOG_CACHE_REL_SEGMENTS = Object.freeze([".guild", "indexes", MODEL_CATALOG_CACHE_DIRNAME] as const);
export const MODEL_CATALOG_CACHE_REL = MODEL_CATALOG_CACHE_REL_SEGMENTS.join("/");

/** Absolute cache dir for a workspace root. */
export function modelCatalogCacheDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ...MODEL_CATALOG_CACHE_REL_SEGMENTS);
}

/** True when a repo-relative path is inside the model-catalog cache dir. */
export function isModelCatalogCachePath(rel: string): boolean {
  const norm = rel.split(path.sep).join("/");
  return norm === MODEL_CATALOG_CACHE_REL || norm.startsWith(`${MODEL_CATALOG_CACHE_REL}/`);
}

// ── Canonical YAML (team-contracts §1) for the flat key tuple ────────────────

/**
 * YAML plain-scalar ambiguity: values a YAML 1.1 parser would read as a
 * non-string (bool/null/number/timestamp-ish) or that carry indicator
 * characters must be single-quoted, byte-matching js-yaml's
 * `dump({sortKeys: true})` output for the same flat string map (asserted
 * against the js-yaml reference in tests/integration/catalog-cache-file-store).
 */
const YAML_KEYWORD = /^(?:null|Null|NULL|~|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/;
const YAML_NUMBER = /^[-+]?(?:0b[0-1_]+|0o[0-7_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?|\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
const YAML_SEXAGESIMAL = /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?$/;

function needsQuote(value: string): boolean {
  if (value.length === 0) return true;
  if (YAML_KEYWORD.test(value) || YAML_NUMBER.test(value) || YAML_SEXAGESIMAL.test(value)) return true;
  if (/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true;
  if (/\s$/.test(value)) return true;
  if (value.includes(": ") || value.endsWith(":")) return true;
  if (value.includes(" #")) return true;
  if (/[\n\t\x00-\x1f\x7f-\x9f\u00a0\u2028\u2029]/.test(value)) return true;
  return false;
}

function yamlScalar(value: string): string {
  if (!needsQuote(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

/** Canonical YAML for a flat string→string map: sorted keys, `k: v` lines, LF, trailing newline. */
export function canonicalYamlFlat(map: Record<string, string>): string {
  const keys = Object.keys(map).sort();
  return keys.map((k) => `${k}: ${yamlScalar(map[k])}\n`).join("");
}

export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ── Cache key (catalog §7, exact construction) ───────────────────────────────

/** The REQUIRED hashed components, besides the schema tag `v`. */
export const CACHE_KEY_COMPONENTS = Object.freeze([
  "target_id",
  "family",
  "surface",
  "provider_kind",
  "auth_mode",
  "account_fingerprint",
  "endpoint_fingerprint",
  "org_fingerprint",
  "tool_version",
  "adapter_id",
  "adapter_version",
  "run_scope",
] as const);

/** The full identity tuple minus run_scope — the ONLY public constructor input. */
export type CacheKeyIdentity = Record<Exclude<(typeof CACHE_KEY_COMPONENTS)[number], "run_scope">, string>;

/**
 * run_scope derivation (§7): the literal `shared` for a real observed org
 * digest; the run id while `org_fingerprint` is the literal `unknown`
 * (unknown-org quarantine — entries are run-local, never cross-run).
 */
export function runScopeFor(input: { org_fingerprint?: string | null; run_id: string }): string {
  if (orgIsUnknown(input.org_fingerprint ?? undefined)) return input.run_id;
  return "shared";
}

/** True when the org component is the §7 absence marker (missing/empty/literal unknown). */
function orgIsUnknown(org: string | undefined): boolean {
  return org == null || org === "" || org === "unknown";
}

export class UnknownOrgQuarantineViolation extends Error {
  constructor(detail: string) {
    super(
      `catalog-cache: unknown-org quarantine (§7) — ${detail}. An unknown org_fingerprint ` +
        `must never participate in a reusable cache identity; supply run_id so the key is run-local.`
    );
    this.name = "UnknownOrgQuarantineViolation";
  }
}

// ── Branded key union (T4-R2-002): no public constructor for ReusableKey ─────

/**
 * Compile-time brand: the symbol is module-private, so no code outside this
 * module can write an object literal satisfying ReusableCacheKey /
 * RunLocalCacheKey — createCacheKey is the only constructor.
 */
const CATALOG_CACHE_KEY_BRAND: unique symbol = Symbol("guild.catalog-cache.key");

/** Runtime brand: every key createCacheKey mints is registered here; the
 * store path rejects anything else, so a structural forgery (cast, clone,
 * JSON round-trip) throws instead of reaching the cache. */
const MINTED_KEYS = new WeakSet<object>();

/**
 * A cross-run REUSABLE cache identity. Constructible ONLY via createCacheKey,
 * and only when org_fingerprint is a real observed digest — an unknown-org
 * tuple can never yield this type (§7 quarantine, type-enforced).
 */
export interface ReusableCacheKey {
  readonly kind: "reusable";
  /** sha256 content address over the canonical identity tuple (run_scope=shared). */
  readonly hash: string;
  readonly run_scope: "shared";
  readonly [CATALOG_CACHE_KEY_BRAND]: true;
}

/** A run-local (unknown-org quarantined) cache identity; purged at run close. */
export interface RunLocalCacheKey {
  readonly kind: "run_local";
  readonly hash: string;
  /** The owning run id — the §7 quarantine scope. */
  readonly run_scope: string;
  readonly [CATALOG_CACHE_KEY_BRAND]: true;
}

export type CatalogCacheKey = ReusableCacheKey | RunLocalCacheKey;

export function isReusableCacheKey(key: CatalogCacheKey): key is ReusableCacheKey {
  return MINTED_KEYS.has(key) && key.kind === "reusable";
}

export function isRunLocalCacheKey(key: CatalogCacheKey): key is RunLocalCacheKey {
  return MINTED_KEYS.has(key) && key.kind === "run_local";
}

/** Reject anything that did not come out of createCacheKey (runtime brand). */
function assertMintedKey(key: CatalogCacheKey): void {
  if (key == null || typeof key !== "object" || !MINTED_KEYS.has(key)) {
    throw new Error(
      "catalog-cache: not a minted CatalogCacheKey — keys are constructed ONLY by createCacheKey " +
        "(T4-R2-002); raw strings, structural clones, and casts are rejected"
    );
  }
}

/** The identity components (CACHE_KEY_COMPONENTS minus the derived run_scope). */
type IdentityComponent = Exclude<(typeof CACHE_KEY_COMPONENTS)[number], "run_scope">;

/** A validated, frozen, plain-primitive materialization of a caller identity. */
type IdentitySnapshot = Readonly<Record<IdentityComponent, string>>;

/**
 * TOCTOU seal (T4-R2-002): materialize EVERY identity component EXACTLY ONCE
 * into a validated plain-string snapshot BEFORE any quarantine decision or
 * hashing. Both the org classification and the hash derive from this one
 * frozen snapshot — the caller's object is never re-read afterward, so a
 * non-idempotent accessor cannot present an observed org to the quarantine
 * check and `unknown` to the hash. Defense in depth: an own accessor-backed
 * component is rejected outright (a cache identity must be plain data); an
 * inherited/proxied accessor is neutralized by the single read.
 */
function snapshotIdentity(identity: CacheKeyIdentity): IdentitySnapshot {
  const snap = {} as Record<IdentityComponent, string>;
  for (const component of CACHE_KEY_COMPONENTS) {
    if (component === "run_scope") continue;
    const desc = Object.getOwnPropertyDescriptor(identity, component);
    if (desc !== undefined && (desc.get !== undefined || desc.set !== undefined)) {
      throw new UnknownOrgQuarantineViolation(
        `identity component ${JSON.stringify(component)} is accessor-backed — a cache identity must be ` +
          "plain data so classification and hashing cannot observe different values"
      );
    }
    const value = (identity as Record<string, unknown>)[component]; // the ONE read of this component
    if (value == null || value === "") {
      snap[component] = "unknown";
      continue;
    }
    if (typeof value !== "string") {
      throw new UnknownOrgQuarantineViolation(
        `identity component ${JSON.stringify(component)} must be a plain string`
      );
    }
    snap[component] = value;
  }
  return Object.freeze(snap);
}

/** sha256 over the canonical YAML of the sealed snapshot — never re-reads the caller object. */
function hashKeyTuple(snapshot: IdentitySnapshot, runScope: string): string {
  const hashed: Record<string, string> = { v: MODEL_CATALOG_SCHEMA_VERSION };
  for (const component of CACHE_KEY_COMPONENTS) {
    hashed[component] = component === "run_scope" ? runScope : snapshot[component];
  }
  return sha256Hex(canonicalYamlFlat(hashed));
}

/** Identity keys a caller must never smuggle in — run_scope/v are derived, run_id is the second arg. */
const NON_IDENTITY_KEYS = ["run_scope", "run_id", "v"] as const;

/**
 * THE cache-key constructor (T4-R2-002) — the only path to a CatalogCacheKey.
 *
 *  - A real observed org digest ⇒ ReusableCacheKey (run_scope literal
 *    `shared`, run-independent). ReusableCacheKey has no other constructor.
 *  - An unknown/absent org_fingerprint ⇒ RunLocalCacheKey, and a non-empty
 *    runId is UNCONDITIONALLY required (run_scope := runId). Absent a run
 *    identity, construction throws — an unknown-org key two run contexts
 *    could share is unrepresentable.
 *  - run_scope is derived internally, NEVER caller-supplied: a run_scope (or
 *    run_id / v) property smuggled into the identity object throws instead of
 *    participating in the hash. Missing/empty identity components serialize
 *    as the literal `unknown` (absence never collides with a real value);
 *    any component change rotates the key (invalidation = key rotation).
 *  - TOCTOU seal (T4-R2-002): the caller identity is materialized ONCE into a
 *    frozen plain-string snapshot at entry; the quarantine classification and
 *    the hash BOTH derive from that single snapshot, so a non-idempotent
 *    accessor can never be classified as one org and hashed as another.
 */
export function createCacheKey(identity: CacheKeyIdentity, runId?: string): CatalogCacheKey {
  for (const smuggled of NON_IDENTITY_KEYS) {
    const value = (identity as Record<string, unknown>)[smuggled];
    if (value != null && value !== "") {
      throw new UnknownOrgQuarantineViolation(
        `${JSON.stringify(smuggled)} is not an identity component — run_scope is derived internally ` +
          "(literal `shared` for a known org; the run id under quarantine) and can never be caller-supplied"
      );
    }
  }
  // Single materialization point — no identity component is read after this line.
  const snapshot = snapshotIdentity(identity);
  if (snapshot.org_fingerprint === "unknown") {
    if (runId == null || runId === "") {
      throw new UnknownOrgQuarantineViolation("an unknown-org identity requires a non-empty run_id");
    }
    const key: RunLocalCacheKey = Object.freeze({
      kind: "run_local" as const,
      hash: hashKeyTuple(snapshot, runId),
      run_scope: runId,
      [CATALOG_CACHE_KEY_BRAND]: true as const,
    });
    MINTED_KEYS.add(key);
    return key;
  }
  const key: ReusableCacheKey = Object.freeze({
    kind: "reusable" as const,
    hash: hashKeyTuple(snapshot, "shared"),
    run_scope: "shared" as const,
    [CATALOG_CACHE_KEY_BRAND]: true as const,
  });
  MINTED_KEYS.add(key);
  return key;
}

// ── Stores: shared interface, in-memory + file-backed ────────────────────────

export interface StoredSnapshot {
  generation: number;
  [field: string]: unknown;
}

export type PublishResult =
  | { published: true }
  | { published: false; reason: "stale_writer" | "lock_timeout" | "invalid_snapshot" };

export interface CatalogStore {
  readonly kind: "memory" | "file";
  read(key: string): StoredSnapshot | null;
  casPublish(key: string, snapshot: StoredSnapshot): PublishResult;
  remove(key: string): void;
  listKeys(): string[];
  /**
   * Non-blocking per-key mutex acquire (cross-process on the file store).
   * Non-reentrant: a second acquire of a held key returns false — that is
   * what lets concurrent singleflight callers detect contention and coalesce.
   */
  tryLock(key: string): boolean;
  /** Release a lock THIS store instance holds; a no-op otherwise. */
  unlock(key: string): void;
}

class MemoryStore implements CatalogStore {
  readonly kind = "memory" as const;
  private entries = new Map<string, StoredSnapshot>();
  private locked = new Set<string>();

  read(key: string): StoredSnapshot | null {
    return this.entries.get(key) ?? null;
  }

  casPublish(key: string, snapshot: StoredSnapshot): PublishResult {
    if (typeof snapshot?.generation !== "number" || !Number.isFinite(snapshot.generation)) {
      return { published: false, reason: "invalid_snapshot" };
    }
    const current = this.entries.get(key);
    // CAS: an older (or equal) generation can never overwrite a newer snapshot.
    if (current && current.generation >= snapshot.generation) {
      return { published: false, reason: "stale_writer" };
    }
    this.entries.set(key, snapshot);
    return { published: true };
  }

  remove(key: string): void {
    this.entries.delete(key);
  }

  listKeys(): string[] {
    return [...this.entries.keys()];
  }

  tryLock(key: string): boolean {
    if (this.locked.has(key)) return false;
    this.locked.add(key);
    return true;
  }

  unlock(key: string): void {
    this.locked.delete(key);
  }
}

export interface FileStoreOptions {
  /** A per-key lock older than this is considered abandoned and stolen. */
  lockStealAgeMs?: number;
  /** Injectable clock (ms) for deterministic lock-age tests. */
  now?: () => number;
}

let tmpSequence = 0;

const SAFE_KEY = /^[A-Za-z0-9._-]+$/;

class FileStore implements CatalogStore {
  readonly kind = "file" as const;
  private readonly lockStealAgeMs: number;
  private readonly now: () => number;
  /** Keys whose cross-process lock THIS instance currently holds. */
  private held = new Set<string>();

  constructor(readonly rootDir: string, opts: FileStoreOptions = {}) {
    this.lockStealAgeMs = opts.lockStealAgeMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    fs.mkdirSync(rootDir, { recursive: true });
  }

  private entryPath(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`catalog-cache: unsafe cache key ${JSON.stringify(key)}`);
    return path.join(this.rootDir, `${key}.json`);
  }

  private lockPath(key: string): string {
    return `${this.entryPath(key)}.lock`;
  }

  tryLock(key: string): boolean {
    if (this.held.has(key)) return false; // non-reentrant by contract
    const lock = this.lockPath(key);
    try {
      fs.mkdirSync(lock);
      this.held.add(key);
      return true;
    } catch {
      // Held elsewhere. Steal only when abandoned (older than the steal age).
      try {
        const age = this.now() - fs.statSync(lock).mtimeMs;
        if (age > this.lockStealAgeMs) {
          fs.rmdirSync(lock);
          fs.mkdirSync(lock);
          this.held.add(key);
          return true;
        }
      } catch {
        // Lock vanished between checks — retry once.
        try {
          fs.mkdirSync(lock);
          this.held.add(key);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  unlock(key: string): void {
    if (!this.held.has(key)) return; // never release a lock another process holds
    this.held.delete(key);
    try {
      fs.rmdirSync(this.lockPath(key));
    } catch {
      // Already released/stolen — nothing to do.
    }
  }

  read(key: string): StoredSnapshot | null {
    // Reads never take the lock: rename publication is atomic, so a reader
    // always sees either the previous or the new complete entry.
    try {
      const raw = fs.readFileSync(this.entryPath(key), "utf8");
      const parsed = JSON.parse(raw) as StoredSnapshot;
      if (typeof parsed?.generation !== "number") return null;
      return parsed;
    } catch {
      return null; // absent or corrupted ⇒ fail-soft to "no valid cache"
    }
  }

  casPublish(key: string, snapshot: StoredSnapshot): PublishResult {
    if (typeof snapshot?.generation !== "number" || !Number.isFinite(snapshot.generation)) {
      return { published: false, reason: "invalid_snapshot" };
    }
    // Re-entrant with singleflightDiscover: when this instance already holds
    // the per-key lock (acquired BEFORE discovery), publish under it and leave
    // it held — the outer flow releases. Otherwise acquire/release locally.
    const alreadyHeld = this.held.has(key);
    if (!alreadyHeld && !this.tryLock(key)) return { published: false, reason: "lock_timeout" };
    try {
      const current = this.read(key);
      if (current && current.generation >= snapshot.generation) {
        return { published: false, reason: "stale_writer" };
      }
      // Atomic publication: temp-write in the same dir + rename.
      tmpSequence += 1;
      const tmp = path.join(this.rootDir, `.tmp-${process.pid}-${tmpSequence}-${key}`);
      fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      fs.renameSync(tmp, this.entryPath(key));
      return { published: true };
    } finally {
      if (!alreadyHeld) this.unlock(key);
    }
  }

  remove(key: string): void {
    try {
      fs.rmSync(this.entryPath(key), { force: true });
    } catch {
      // Best-effort removal.
    }
  }

  listKeys(): string[] {
    try {
      return fs
        .readdirSync(this.rootDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -".json".length));
    } catch {
      return [];
    }
  }
}

/**
 * Create a catalog store. With no argument: a deterministic in-memory store
 * (contract-fixture simulations). With a directory: the real file-backed
 * store rooted there (production path: `modelCatalogCacheDir(workspaceRoot)`).
 */
export function createStore(rootDir?: string, opts?: FileStoreOptions): CatalogStore {
  return rootDir ? new FileStore(rootDir, opts) : new MemoryStore();
}

// ── Store-agnostic protocol operations (typed-key surface, T4-R2-002) ────────
// Every protocol operation takes a minted CatalogCacheKey — the reusable
// (shared) path is reachable ONLY through a ReusableCacheKey, which an
// unknown-org identity can never construct. The published entry's
// cache_meta.run_scope is stamped FROM THE KEY, never trusted from the
// caller, so a run-local key's publication is always purgeable at run close.

/** Stamp the snapshot's persisted scope from the key (caller values overridden). */
function stampScope(key: CatalogCacheKey, snapshot: StoredSnapshot): StoredSnapshot {
  const meta = (snapshot as { cache_meta?: Record<string, unknown> }).cache_meta;
  return { ...snapshot, cache_meta: { ...(meta ?? {}), run_scope: key.run_scope } };
}

/** CAS publication — a stale writer (generation ≤ published) is rejected + discarded. */
export function publishSnapshot(store: CatalogStore, key: CatalogCacheKey, snapshot: StoredSnapshot): PublishResult {
  assertMintedKey(key);
  return store.casPublish(key.hash, stampScope(key, snapshot));
}

/** Newest valid snapshot under the key, else null. Never blocks on the write lock. */
export function readSnapshot(store: CatalogStore, key: CatalogCacheKey): StoredSnapshot | null {
  assertMintedKey(key);
  return store.read(key.hash);
}

/** Next monotonic generation for a key (publisher-side helper). */
export function nextGeneration(store: CatalogStore, key: CatalogCacheKey): number {
  assertMintedKey(key);
  const current = store.read(key.hash);
  return (current?.generation ?? 0) + 1;
}

/**
 * Per-key singleflight, deterministic in-process form: when multiple callers
 * need the same key, exactly one discovery runs; every caller receives the
 * one shared published result. If a valid snapshot already exists it is
 * shared without any discovery. Follows the same lock discipline as the
 * production seam — lock BEFORE discovery, publish, release — degrading to
 * the newest valid cache (else honest unknown) when the lock is contended.
 * The cross-process production seam is `singleflightDiscover`.
 */
export function singleflight(
  store: CatalogStore,
  key: CatalogCacheKey,
  discoverers: Array<() => StoredSnapshot>
): StoredSnapshot[] {
  assertMintedKey(key);
  if (discoverers.length === 0) return [];
  const existing = store.read(key.hash);
  if (existing) return discoverers.map(() => existing);
  if (!store.tryLock(key.hash)) {
    // Contended and synchronous — cannot wait: degrade per the §7 lock-timeout rule.
    const degraded = degradedRead(store, key.hash) as unknown as StoredSnapshot;
    return discoverers.map(() => degraded);
  }
  try {
    const recheck = store.read(key.hash); // the previous holder may have published
    if (recheck) return discoverers.map(() => recheck);
    const discovered = discoverers[0]();
    store.casPublish(key.hash, stampScope(key, discovered));
    const shared = store.read(key.hash) ?? discovered;
    return discoverers.map(() => shared);
  } finally {
    store.unlock(key.hash);
  }
}

// ── Cross-process singleflight (the §7 production seam) ──────────────────────

export interface SingleflightOptions {
  /** Bounded total wait for the per-key lock before degrading (§7: never blocks a run indefinitely). */
  lockWaitMs?: number;
  /** Contention poll interval. */
  pollIntervalMs?: number;
  /** Freshness predicate for an existing snapshot (default: any valid snapshot is fresh). */
  isFresh?: (snapshot: StoredSnapshot) => boolean;
  /** Injectable clock + sleeper for deterministic tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SingleflightOutcome {
  snapshot: StoredSnapshot | (Record<string, unknown> & { degraded: true; probe_issued: false });
  /**
   * cached    — a fresh snapshot existed; no lock, no discovery.
   * winner    — this caller held the lock and ran the one discovery.
   * coalesced — another writer held the lock; this caller consumed its publication.
   * degraded  — lock wait exhausted with nothing published: newest valid cache, else honest unknown.
   */
  role: "cached" | "winner" | "coalesced" | "degraded";
  /** True only for the winner — the probes assert exactly one per key across processes. */
  discovery_ran: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Cross-process per-target singleflight (catalog §7): acquire the per-key
 * bounded lock BEFORE discovery begins — lock → check fresh → discover →
 * CAS-write → release. Concurrent processes on the same key coalesce on the
 * winner's publication or wait for the lock; on lock-wait exhaustion the
 * caller degrades to the newest valid cache else an honest `unknown` receipt
 * — it never duplicates a running discovery, never interleaves writes, never
 * blocks indefinitely, and never issues a paid probe.
 */
export async function singleflightDiscover(
  store: CatalogStore,
  key: CatalogCacheKey,
  discover: () => Promise<StoredSnapshot> | StoredSnapshot,
  opts: SingleflightOptions = {}
): Promise<SingleflightOutcome> {
  assertMintedKey(key);
  const hash = key.hash;
  const lockWaitMs = opts.lockWaitMs ?? UNCACHED_DISCOVERY_BUDGET_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? 25;
  const isFresh = opts.isFresh ?? (() => true);
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  const fresh = (): StoredSnapshot | null => {
    const snap = store.read(hash);
    return snap && isFresh(snap) ? snap : null;
  };

  const cached = fresh();
  if (cached) return { snapshot: cached, role: "cached", discovery_ran: false };

  // Acquire the per-key lock BEFORE discovery; while contended, coalesce on
  // the lock holder's publication instead of re-discovering.
  const deadline = now() + lockWaitMs;
  let locked = store.tryLock(hash);
  while (!locked) {
    const published = fresh();
    if (published) return { snapshot: published, role: "coalesced", discovery_ran: false };
    if (now() >= deadline) return { snapshot: degradedRead(store, hash), role: "degraded", discovery_ran: false };
    await sleep(pollIntervalMs);
    locked = store.tryLock(hash);
  }

  try {
    // Double-check under the lock: the previous holder may have published.
    const published = fresh();
    if (published) return { snapshot: published, role: "coalesced", discovery_ran: false };
    const discovered = await discover();
    const current = store.read(hash);
    const snapshot: StoredSnapshot = stampScope(key, {
      ...discovered,
      generation: (current?.generation ?? 0) + 1,
    });
    store.casPublish(hash, snapshot);
    const shared = store.read(hash) ?? snapshot;
    return { snapshot: shared, role: "winner", discovery_ran: true };
  } finally {
    store.unlock(hash);
  }
}

/** Shared hash-level degradation body (read side of the §7 lock-timeout rule). */
function degradedRead(
  store: CatalogStore,
  hash: string
): { degraded: true; probe_issued: false; [field: string]: unknown } {
  const cached = store.read(hash);
  if (cached) return { ...cached, degraded: true, probe_issued: false };
  return { degraded: true, probe_issued: false, evidence_state: "unknown" };
}

/**
 * Read-side lock-timeout degradation (catalog §7): when a discovery/lock path
 * cannot complete in budget, degrade to the newest valid cache — else an
 * honest-`unknown` receipt. Never blocks a run; never issues a (paid) probe.
 */
export function readUnderLockTimeout(
  store: CatalogStore,
  key: CatalogCacheKey
): { degraded: true; probe_issued: false; [field: string]: unknown } {
  assertMintedKey(key);
  return degradedRead(store, key.hash);
}

// ── Staleness + run-local purge ──────────────────────────────────────────────

/**
 * TTL expiry marks a snapshot STALE for re-discovery within its key. It never
 * fabricates an `unavailable` evidence state (catalog §4 hard rule).
 */
export function isSnapshotStale(
  snapshot: { discovery?: { discovered_at?: string; ttl_seconds?: number } },
  nowIso: string
): boolean {
  const at = snapshot.discovery?.discovered_at;
  if (!at) return true;
  const discoveredMs = Date.parse(at);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(discoveredMs) || !Number.isFinite(nowMs)) return true;
  const ttl = (snapshot.discovery?.ttl_seconds ?? DEFAULT_CATALOG_TTL_SECONDS) * 1000;
  return nowMs - discoveredMs > ttl;
}

/** Explicit invalidation within one identity: drop the entry (rotation handles identity changes). */
export function invalidateKey(store: CatalogStore, key: CatalogCacheKey): void {
  assertMintedKey(key);
  store.remove(key.hash);
}

/**
 * Purge run-local (unknown-org quarantined) entries for a closed run: any
 * stored snapshot whose cache_meta.run_scope equals the run id is eligible for
 * purge at run close (§7). Shared entries are untouched.
 */
export function purgeRunLocalEntries(store: CatalogStore, runId: string): number {
  let purged = 0;
  for (const key of store.listKeys()) {
    const snap = store.read(key);
    const scope = (snap as { cache_meta?: { run_scope?: string } } | null)?.cache_meta?.run_scope;
    if (scope === runId) {
      store.remove(key);
      purged += 1;
    }
  }
  return purged;
}

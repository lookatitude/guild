/**
 * publication.ts — K03: atomic generation publication with a dual CAS.
 *
 * Owner indexes publish as immutable generations:
 *
 *   indexes/publication/generations/<hex>/   artifacts + manifest.json + publication.json
 *   indexes/publication/CURRENT              pointer {generation, publication_sha256}
 *   indexes/publication/lock/                publisher lock (owner pid + host + token)
 *   indexes/<artifact>                       legacy export: a copy, never evidence
 *
 * A writer publishes under the lock only when BOTH hold: the destination is still
 * the generation (and layer digest) it built from, and the source basis observed
 * now equals the basis its layers were built for. A moved destination is rebased
 * (the writer re-merges its layer onto the current generation) or refused, so a
 * stale structural job cannot erase a newer semantic layer. Readers follow the
 * pointer and verify every byte against the manifest, so they see one complete
 * generation or an error, never a mix. Only unreferenced generations are reclaimed.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkContained, isRefused, prepareContainedWrite } from "../kernel";
import type { DecisionPublicationRefs, EntityRef } from "./decision-propagation";
import { basisDigest, freshnessFor, type ChannelState, type InventoryEntry, type PublicationBasis, type Sha256 } from "./source-basis";

export type { Sha256 } from "./source-basis";

export type LayerChannel = "structural_graph" | "semantic_graph" | "recall";

/** What a job asserts about the bytes its layers were built from. */
export interface BasisRef {
  basis: PublicationBasis;
  source_basis_hash: Sha256;
  resolver_unresolved?: readonly string[];
  inventory?: readonly InventoryEntry[];
}

export type PublicationArtifacts = Record<string, Buffer | undefined>;

export interface LayerSpec {
  /** Artifact file holding the layer. Several layers may be views over one file. */
  artifact: string;
  /** Digest of this layer's view over the artifact set. */
  digest: (artifacts: PublicationArtifacts) => Sha256;
}

export interface PublicationIdentity {
  source_id: string;
  durable_owner_source_id: string;
  publication_scope_source_id: string;
}

export interface Pointer {
  schema_version: "guild.knowledge_publication_pointer.v1";
  generation: Sha256;
  destination_layer_digest: Sha256;
  publication_sha256: Sha256;
}

interface Evidence {
  source_id: string;
  path: string;
  sha256: Sha256;
  schema_version: string;
  observed_at: string;
  availability: "available";
  reason: null;
}

export interface ChannelRecord {
  /** `project_memory` is K04's decision-dependent memory state; it has no artifact (`output: null`). */
  channel: LayerChannel | "project_memory";
  state: ChannelState;
  basis_hash: Sha256;
  layer_hash: Sha256;
  output: Evidence | null;
  reason: string | null;
}

/** C13 `knowledge-publication.schema.json` (A02 frozen, bundle v2). */
export interface KnowledgePublicationRecord {
  schema_version: "guild.stack.knowledge-publication.v1";
  source_id: string;
  source_worktree_id: string;
  durable_owner_source_id: string;
  publication_scope_source_id: string;
  basis: PublicationBasis;
  source_basis_hash: Sha256;
  basis_verified_at: string | null;
  generation: Sha256;
  previous_generation: Sha256 | null;
  destination_layer_digest: Sha256;
  manifest: Evidence;
  channels: ChannelRecord[];
  decision_refs: EntityRef[];
  replan_required: EntityRef[];
}

export interface GenerationManifest {
  schema_version: "guild.knowledge_publication_manifest.v1";
  generation: Sha256;
  previous_generation: Sha256 | null;
  artifacts: Record<string, { sha256: Sha256; bytes: number }>;
  /** `unknown_reason`: the layer's provenance is not a source build; carried until rebuilt. */
  layers: Record<string, { artifact: string; layer_hash: Sha256; basis_hash: Sha256; unknown_reason?: string }>;
  source_basis: { basis: PublicationBasis; source_basis_hash: Sha256; inventory: InventoryEntry[] };
  /** Artifacts copied to `indexes/<name>` for legacy readers. */
  exports: string[];
  /** K04: decision refs bound into the generation id, so a reused generation cannot carry stale ones. */
  decisions?: DecisionPublicationRefs;
}

export interface PinnedGeneration {
  pointer: Pointer;
  record: KnowledgePublicationRecord;
  manifest: GenerationManifest;
  artifacts: PublicationArtifacts;
}

export type PublishFaultStep = string;

export interface PublishJob {
  /** Owner `.guild/indexes`. Containment root for every write. */
  indexesDir: string;
  identity: PublicationIdentity;
  /** Layer views for every channel this owner publishes. */
  layers: Partial<Record<LayerChannel, LayerSpec>>;
  /** Channels this job rebuilt for `basis`. Others are carried from the destination. */
  channels: LayerChannel[];
  /** Destination the artifacts were built from (null: no publication yet). */
  base: Pick<Pointer, "generation" | "destination_layer_digest"> | null;
  /** Source basis the job's layers were built for. */
  basis: BasisRef;
  /** Observes the source basis now. Called under the lock. */
  observe: () => BasisRef | null;
  /** Artifacts the job writes (whole files, built from `base`). */
  artifacts: Record<string, Buffer | string>;
  /** Re-merge the job's layer inputs onto a newer destination. Absent ⇒ refuse. */
  rebase?: (current: PinnedGeneration) => Record<string, Buffer | string>;
  /**
   * Layers this job does not own must survive its artifacts. Called under the
   * lock with the destination's artifacts (null: nothing published) and the
   * job's final artifacts; a returned reason refuses the publication.
   */
  /**
   * How each declared channel was produced. `rebuilt` (default): from the source
   * for `basis`. `derived`: a transform of the destination's layer, which keeps
   * that layer's provenance. `ingested`: built elsewhere; published `unknown`.
   */
  provenance?: Partial<Record<LayerChannel, "rebuilt" | "derived" | "ingested">>;
  /** Reason recorded for an `ingested` channel (why its basis is not the source basis). */
  provenanceReason?: Partial<Record<LayerChannel, string>>;
  preserve?: (destination: PublicationArtifacts | null, next: PublicationArtifacts) => string | null;
  /** Artifacts to mirror at `indexes/<name>` after the pointer moves. */
  exports?: string[];
  /**
   * K04: the owner's decision refs, read under the lock. Throwing refuses the
   * publication (`invalid`): a record must not claim "no replan" it cannot prove.
   */
  decisions?: () => DecisionPublicationRefs | null;
  now?: () => string;
  lockTimeoutMs?: number;
  /** Generations kept behind the current one. */
  keep?: number;
  /** Test seam: called after each step; throwing simulates a crash there. */
  fault?: (step: PublishFaultStep) => void;
}

export type PublishResult =
  | { status: "published"; generation: Sha256; rebases: number; reused: boolean }
  | {
      status: "refused";
      reason: "destination_moved" | "source_drift" | "source_unknown" | "lock_timeout" | "containment" | "invalid" | "undeclared_layer_change";
      detail: string;
    };

/** Crash points AT36 drives, in publication order. */
export const PUBLICATION_FAULT_STEPS: readonly PublishFaultStep[] = Object.freeze([
  "lock_acquired",
  "artifact:knowledge-graph.json",
  "artifact:knowledge-recall.json",
  "layers_written",
  "manifest_written",
  "record_written",
  "generation_renamed",
  "successor_claimed",
  "pointer_tmp_written",
  "pointer_renamed",
  "export:knowledge-graph.json",
  "export:knowledge-recall.json",
  "reclaimed",
]);

const ARTIFACT_NAME = /^[a-z0-9][a-z0-9._-]{0,127}\.json$/;
const GEN_DIR = /^[a-f0-9]{64}$/;
const HOST = crypto.createHash("sha256").update(os.hostname()).digest("hex").slice(0, 12);

export function publicationDir(indexesDir: string): string {
  return path.join(indexesDir, "publication");
}

function generationsDir(indexesDir: string): string {
  return path.join(publicationDir(indexesDir), "generations");
}

function sha(bytes: Buffer | string): Sha256 {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function hex(g: Sha256): string {
  return g.slice("sha256:".length);
}

function isGenerationHash(v: unknown): v is Sha256 {
  return typeof v === "string" && v.startsWith("sha256:") && GEN_DIR.test(v.slice(7));
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function fsyncPath(p: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(p, "r");
    fs.fsyncSync(fd);
  } catch {
    /* directory fsync is unsupported on some filesystems */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writeDurable(p: string, bytes: Buffer | string, mode = 0o644): void {
  const fd = fs.openSync(p, "wx", mode);
  try {
    fs.writeSync(fd, typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Physical containment: no symlink anywhere below the owner indexes dir. */
function contained(indexesDir: string, target: string, leafFile = false): string | null {
  const r = checkContained(indexesDir, target, { policy: "physical", requireRegularFileLeaf: leafFile });
  return isRefused(r) ? `${r.code}: ${r.detail}` : null;
}

function ensureDir(indexesDir: string, dir: string): void {
  const r = prepareContainedWrite(indexesDir, path.join(dir, ".probe"), { policy: "physical" });
  if (isRefused(r)) throw new PublicationError("containment", `${r.code}: ${r.detail}`);
}

/** Remove `target` only if it and every ancestor up to the indexes dir are physically contained. */
function removeContained(indexesDir: string, target: string): void {
  if (contained(indexesDir, path.dirname(target))) return;
  let st: fs.Stats;
  try {
    st = fs.lstatSync(target);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) fs.unlinkSync(target);
  else fs.rmSync(target, { recursive: true, force: true });
}

export class PublicationError extends Error {
  constructor(
    readonly code: "containment" | "corrupt" | "invalid",
    detail: string,
  ) {
    super(`publication ${code}: ${detail}`);
  }
}

// ── Lock ────────────────────────────────────────────────────────────────────

interface LockOwner {
  pid: number;
  host: string;
  token: string;
  acquired_at: string;
}

export type LockResult = { ok: true; release: () => void; token: string; holds: () => boolean } | { ok: false; detail: string };

function readOwner(lockDir: string): LockOwner | null {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8")) as LockOwner;
    return o && typeof o.pid === "number" && typeof o.token === "string" ? o : null;
  } catch {
    return null;
  }
}

/**
 * Create `dir` already holding its owner record: a populated temp dir renamed
 * into place. rename(2) onto an existing non-empty dir fails, so the name is
 * never observable without an owner and an ownerless lock is never reclaimed.
 */
function createOwned(parent: string, name: string): LockOwner | null {
  const owner: LockOwner = { pid: process.pid, host: HOST, token: crypto.randomUUID(), acquired_at: new Date().toISOString() };
  const tmp = path.join(parent, `.${name}.${owner.token}`);
  fs.mkdirSync(tmp);
  try {
    writeDurable(path.join(tmp, "owner.json"), JSON.stringify(owner));
    fs.renameSync(tmp, path.join(parent, name));
    return owner;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTEMPTY" || code === "EEXIST" || code === "EPERM" || code === "EISDIR") return null;
    throw err;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Stale iff the same-host owner is provably dead. An unreadable owner is never stale. */
function staleToken(dir: string): string | null {
  const owner = readOwner(dir);
  return owner && owner.host === HOST && !pidAlive(owner.pid) ? owner.token : null;
}

/**
 * Move `dir` out of the way only if it still carries `token`. If the moved dir
 * holds another token (a peer replaced it in between), it is put back.
 */
function removeIfToken(parent: string, name: string, token: string): boolean {
  const dir = path.join(parent, name);
  const grave = path.join(parent, `.${name}.dead.${crypto.randomUUID()}`);
  try {
    fs.renameSync(dir, grave);
  } catch {
    return false;
  }
  if (readOwner(grave)?.token !== token) {
    try {
      fs.renameSync(grave, dir);
    } catch {
      /* a newer owner took the name; the moved dir belonged to nobody live */
    }
    return false;
  }
  fs.rmSync(grave, { recursive: true, force: true });
  return true;
}

/** Reclaim a dead owner's lock under a reclaim mutex (itself owned, pid-checked). */
function reclaimStaleLock(pubDir: string): void {
  const mutexOwner = createOwned(pubDir, "lock.reclaim");
  if (!mutexOwner) {
    const t = staleToken(path.join(pubDir, "lock.reclaim"));
    if (t) removeIfToken(pubDir, "lock.reclaim", t);
    return;
  }
  try {
    const t = staleToken(path.join(pubDir, "lock"));
    if (t) removeIfToken(pubDir, "lock", t);
  } finally {
    removeIfToken(pubDir, "lock.reclaim", mutexOwner.token);
  }
}

export function acquirePublisherLock(pubDir: string, opts: { timeoutMs?: number } = {}): LockResult {
  const lockDir = path.join(pubDir, "lock");
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  fs.mkdirSync(pubDir, { recursive: true });
  for (let wait = 5; ; wait = Math.min(wait * 2, 100)) {
    let owner: LockOwner | null;
    try {
      owner = createOwned(pubDir, "lock");
    } catch (err) {
      return { ok: false, detail: String(err) };
    }
    if (owner) {
      const token = owner.token;
      let released = false;
      return {
        ok: true,
        token,
        holds: () => readOwner(lockDir)?.token === token,
        release: () => {
          if (released) return;
          released = true;
          removeIfToken(pubDir, "lock", token);
        },
      };
    }
    if (staleToken(lockDir)) reclaimStaleLock(pubDir);
    if (Date.now() >= deadline) return { ok: false, detail: `publisher lock held: ${JSON.stringify(readOwner(lockDir))}` };
    sleep(wait);
  }
}

// ── Read ────────────────────────────────────────────────────────────────────

function parsePointer(file: string, indexesDir: string): Pointer {
  const bad = contained(indexesDir, file, true);
  if (bad) throw new PublicationError("containment", bad);
  const ptr = JSON.parse(fs.readFileSync(file, "utf8")) as Pointer;
  if (!isGenerationHash(ptr?.generation) || !isGenerationHash(ptr.publication_sha256)) throw new PublicationError("corrupt", "pointer malformed");
  return ptr;
}

function successorFile(indexesDir: string, parent: Sha256 | null): string {
  return path.join(publicationDir(indexesDir), "successors", parent ? hex(parent) : "root");
}

/**
 * The tip of the generation chain. Each generation has at most one successor
 * (created exclusively, the commit point); CURRENT is a cached hint that may lag
 * after a crash, so the chain is followed from it.
 */
function readPointer(indexesDir: string): Pointer | null {
  const cur = path.join(publicationDir(indexesDir), "CURRENT");
  let ptr: Pointer | null = fs.existsSync(cur) ? parsePointer(cur, indexesDir) : null;
  if (!ptr) {
    const root = successorFile(indexesDir, null);
    if (!fs.existsSync(root)) return null;
    ptr = parsePointer(root, indexesDir);
  }
  for (let i = 0; i < 100_000; i++) {
    const next = successorFile(indexesDir, ptr.generation);
    if (!fs.existsSync(next)) return ptr;
    ptr = parsePointer(next, indexesDir);
  }
  throw new PublicationError("corrupt", "successor chain does not terminate");
}

function readVerified(indexesDir: string, file: string, expected: Sha256): Buffer {
  const bad = contained(indexesDir, file, true);
  if (bad) throw new PublicationError("containment", bad);
  const bytes = fs.readFileSync(file);
  if (sha(bytes) !== expected) throw new PublicationError("corrupt", `hash mismatch for ${path.basename(file)}`);
  return bytes;
}

function loadGeneration(indexesDir: string, generation: Sha256, publicationSha: Sha256 | null): PinnedGeneration {
  const dir = path.join(generationsDir(indexesDir), hex(generation));
  const recBytes = publicationSha
    ? readVerified(indexesDir, path.join(dir, "publication.json"), publicationSha)
    : fs.readFileSync(path.join(dir, "publication.json"));
  const record = JSON.parse(recBytes.toString("utf8")) as KnowledgePublicationRecord;
  if (record.generation !== generation) throw new PublicationError("corrupt", "record names another generation");
  const manBytes = readVerified(indexesDir, path.join(dir, "manifest.json"), record.manifest.sha256);
  const manifest = JSON.parse(manBytes.toString("utf8")) as GenerationManifest;
  if (manifest.generation !== generation) throw new PublicationError("corrupt", "manifest names another generation");
  const artifacts: PublicationArtifacts = {};
  for (const [name, a] of Object.entries(manifest.artifacts)) {
    if (!ARTIFACT_NAME.test(name)) throw new PublicationError("corrupt", `artifact name ${JSON.stringify(name)}`);
    artifacts[name] = readVerified(indexesDir, path.join(dir, name), a.sha256);
  }
  if (generationId(manifest) !== generation) throw new PublicationError("corrupt", "generation id does not match its manifest");
  const pointer: Pointer = {
    schema_version: "guild.knowledge_publication_pointer.v1",
    generation,
    destination_layer_digest: record.destination_layer_digest,
    publication_sha256: sha(recBytes),
  };
  return { pointer, record, manifest, artifacts };
}

function pinFile(indexesDir: string, generation: Sha256): string | null {
  try {
    const dir = path.join(publicationDir(indexesDir), "pins");
    if (contained(indexesDir, dir)) return null;
    fs.mkdirSync(dir, { recursive: true });
    const id = `${process.pid}-${crypto.randomUUID()}`;
    const tmp = path.join(dir, `.tmp-${id}`);
    writeDurable(tmp, JSON.stringify({ pid: process.pid, host: HOST, generation }));
    const f = path.join(dir, `${id}.json`);
    fs.renameSync(tmp, f); // a pin is complete before it is visible
    return f;
  } catch {
    return null;
  }
}

/**
 * The current generation, every byte verified against its manifest, or null when
 * nothing is published. Throws PublicationError on a corrupt or escaping store.
 * `generation` reads a retained older generation instead.
 */
export function readPublication(indexesDir: string, opts: { generation?: Sha256 } = {}): PinnedGeneration | null {
  for (let attempt = 0; ; attempt++) {
    const ptr = opts.generation ? null : readPointer(indexesDir);
    const gen = opts.generation ?? ptr?.generation;
    if (!gen) return null;
    const pin = pinFile(indexesDir, gen);
    try {
      const pg = loadGeneration(indexesDir, gen, ptr?.publication_sha256 ?? null);
      if (ptr && pg.pointer.destination_layer_digest !== ptr.destination_layer_digest) {
        throw new PublicationError("corrupt", "pointer layer digest differs from its record");
      }
      return pg;
    } catch (err) {
      // Reclaimed between pointer read and generation read: re-read the pointer.
      if ((err as NodeJS.ErrnoException).code === "ENOENT" && !opts.generation && attempt < 3) continue;
      if ((err as NodeJS.ErrnoException).code === "ENOENT" && opts.generation) return null;
      throw err;
    } finally {
      if (pin) fs.rmSync(pin, { force: true });
    }
  }
}

/**
 * Pointer + verified C13 record + manifest of the current generation, without
 * reading artifact bytes (cheap enough for an after-edit hook).
 */
export function readPublicationRecord(indexesDir: string): { pointer: Pointer; record: KnowledgePublicationRecord; manifest: GenerationManifest } | null;
export function readPublicationRecord(
  indexesDir: string,
  opts: { manifest: false },
): { pointer: Pointer; record: KnowledgePublicationRecord; manifest: null } | null;
export function readPublicationRecord(
  indexesDir: string,
  opts: { manifest?: boolean } = {},
): { pointer: Pointer; record: KnowledgePublicationRecord; manifest: GenerationManifest | null } | null {
  for (let attempt = 0; ; attempt++) {
    const ptr = readPointer(indexesDir);
    if (!ptr) return null;
    const pin = pinFile(indexesDir, ptr.generation);
    try {
      const dir = path.join(generationsDir(indexesDir), hex(ptr.generation));
      const record = JSON.parse(readVerified(indexesDir, path.join(dir, "publication.json"), ptr.publication_sha256).toString("utf8")) as KnowledgePublicationRecord;
      if (record.generation !== ptr.generation) throw new PublicationError("corrupt", "record names another generation");
      if (opts.manifest === false) return { pointer: ptr, record, manifest: null };
      const manifest = JSON.parse(readVerified(indexesDir, path.join(dir, "manifest.json"), record.manifest.sha256).toString("utf8")) as GenerationManifest;
      if (manifest.generation !== ptr.generation) throw new PublicationError("corrupt", "manifest names another generation");
      return { pointer: ptr, record, manifest };
    } catch (err) {
      // Reclaimed between the pointer read and this read: follow the newer pointer.
      if ((err as NodeJS.ErrnoException).code === "ENOENT" && attempt < 3) continue;
      throw err;
    } finally {
      if (pin) fs.rmSync(pin, { force: true });
    }
  }
}

/** Physical-containment check for sidecar writers (hints, verifications). */
export function publicationSidecarPath(indexesDir: string, kind: "hints" | "verifications", generation: Sha256, ext: ".jsonl" | ".json"): string {
  if (!isGenerationHash(generation)) throw new PublicationError("invalid", "generation id");
  const dir = path.join(publicationDir(indexesDir), kind);
  ensureDir(indexesDir, dir);
  const f = path.join(dir, `${hex(generation)}${ext}`);
  const bad = contained(indexesDir, f, true);
  if (bad) throw new PublicationError("containment", bad);
  return f;
}

export type ExportProvenance = "current" | "lagging" | "bypassed" | "absent" | "unpublished";

/**
 * Where the bytes at `indexes/<name>` came from. `lagging`: an older retained
 * generation's export (a crash between the pointer rename and the export write).
 * `bypassed`: no generation produced them; a writer skipped publication.
 */
export function exportProvenance(indexesDir: string, name: string): { provenance: ExportProvenance; sha256: Sha256 | null } {
  const file = path.join(indexesDir, name);
  let bytes: Buffer;
  try {
    if (contained(indexesDir, file, true)) return { provenance: "bypassed", sha256: null };
    bytes = fs.readFileSync(file);
  } catch {
    return { provenance: "absent", sha256: null };
  }
  const h = sha(bytes);
  const pub = readPublication(indexesDir);
  if (!pub) return { provenance: "unpublished", sha256: h };
  if (pub.manifest.artifacts[name]?.sha256 === h) return { provenance: "current", sha256: h };
  for (const g of safeReaddir(generationsDir(indexesDir))) {
    if (!GEN_DIR.test(g)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(generationsDir(indexesDir), g, "manifest.json"), "utf8")) as GenerationManifest;
      if (m.artifacts?.[name]?.sha256 === h) return { provenance: "lagging", sha256: h };
    } catch {
      /* unreadable generation: not evidence either way */
    }
  }
  return { provenance: "bypassed", sha256: h };
}

/**
 * A legacy export is a copy for old readers. It matches the published generation
 * or it is `unknown`; it never asserts freshness on its own.
 */
export function legacyExportState(indexesDir: string, name: string): { state: "matches_generation" | "unknown"; reason: string } {
  const { provenance } = exportProvenance(indexesDir, name);
  switch (provenance) {
    case "current":
      return { state: "matches_generation", reason: "bytes equal the published generation's artifact" };
    case "lagging":
      return { state: "unknown", reason: "export lags the published generation (an older generation's bytes)" };
    case "bypassed":
      return { state: "unknown", reason: "export bytes are not the published generation's; a writer bypassed publication" };
    case "unpublished":
      return { state: "unknown", reason: "no publication manifest; legacy file carries no evidence" };
    default:
      return { state: "unknown", reason: "export missing" };
  }
}

// ── Publish ─────────────────────────────────────────────────────────────────

function generationId(m: Pick<GenerationManifest, "previous_generation" | "artifacts" | "layers" | "source_basis" | "exports" | "decisions">): Sha256 {
  return basisDigest({
    previous_generation: m.previous_generation,
    artifacts: Object.fromEntries(Object.entries(m.artifacts).map(([k, v]) => [k, v.sha256])),
    layers: m.layers,
    source_basis_hash: m.source_basis.source_basis_hash,
    exports: m.exports,
    ...(m.decisions ? { decisions: m.decisions } : {}),
  });
}

function layerDigest(layers: Record<string, { layer_hash: Sha256 }>): Sha256 {
  return basisDigest(
    Object.entries(layers)
      .map(([c, l]) => [c, l.layer_hash])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}

function toBuffers(a: Record<string, Buffer | string>): PublicationArtifacts {
  const out: PublicationArtifacts = {};
  for (const [k, v] of Object.entries(a)) out[k] = typeof v === "string" ? Buffer.from(v, "utf8") : v;
  return out;
}

function sameBase(base: PublishJob["base"], cur: Pointer | null): boolean {
  if (!base || !cur) return !base && !cur;
  return base.generation === cur.generation && base.destination_layer_digest === cur.destination_layer_digest;
}

function validateJob(job: PublishJob): string | null {
  if (!job.channels.length) return "a job declares at least one channel";
  for (const c of job.channels) if (!job.layers[c]) return `channel ${c} has no layer spec`;
  for (const n of [...Object.keys(job.artifacts), ...(job.exports ?? [])]) if (!ARTIFACT_NAME.test(n)) return `artifact name ${JSON.stringify(n)}`;
  for (const c of job.channels) if (!(job.layers[c]!.artifact in job.artifacts)) return `channel ${c} artifact ${job.layers[c]!.artifact} not written`;
  if (basisDigest(job.basis.basis) !== job.basis.source_basis_hash) return "job basis hash is not the digest of its basis";
  return null;
}

function relFromOwner(indexesDir: string, abs: string): string {
  return path.join(".guild", "indexes", path.relative(indexesDir, abs)).split(path.sep).join("/");
}

/** Remove a dead or own staging dir; never touches a live peer's. */
function reclaimStaging(indexesDir: string): void {
  const sdir = path.join(publicationDir(indexesDir), "successors");
  if (!contained(indexesDir, sdir)) {
    for (const n of safeReaddir(sdir)) {
      const m = /^\.claim-([a-f0-9]{12})-(\d+)-/.exec(n);
      if (m && m[1] === HOST && !pidAlive(Number(m[2]))) removeContained(indexesDir, path.join(sdir, n));
    }
  }
  const gdir = generationsDir(indexesDir);
  let names: string[] = [];
  try {
    names = fs.readdirSync(gdir);
  } catch {
    return;
  }
  for (const n of names) {
    const m = /^\.(?:stage|reclaim)-([a-f0-9]{12})-(\d+)-/.exec(n);
    if (!m) continue;
    if (m[1] === HOST && !pidAlive(Number(m[2]))) removeContained(indexesDir, path.join(gdir, n));
  }
}

/** Generations pinned by live readers; null = a pin could not be read (fail closed: reclaim nothing). */
function livePins(indexesDir: string): Set<string> | null {
  const out = new Set<string>();
  const dir = path.join(publicationDir(indexesDir), "pins");
  if (fs.existsSync(dir) && contained(indexesDir, dir)) return null;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const f = path.join(dir, n);
    const tmp = /^\.tmp-(\d+)-/.exec(n);
    if (tmp) {
      if (!pidAlive(Number(tmp[1]))) removeContained(indexesDir, f);
      continue;
    }
    let pin: { pid: number; host: string; generation: string };
    try {
      pin = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      return null;
    }
    if (pin.host === HOST && !pidAlive(pin.pid)) {
      removeContained(indexesDir, f);
      continue;
    }
    if (!isGenerationHash(pin.generation)) return null;
    out.add(hex(pin.generation));
  }
  return out;
}

/**
 * Remove generations nothing references: not current, not within `keep` steps of
 * its previous chain, not pinned by a live reader. Caller holds the lock (or the
 * store is quiescent). Returns removed generation hex ids.
 */
/** Orphan generations (not on the chain) younger than this may be a peer's in-flight commit. */
export const ORPHAN_GRACE_MS = 10 * 60_000;

/**
 * Remove generations nothing references. Safe against a concurrent publisher
 * even without the lock: only (a) chain ancestors more than `keep` behind the
 * tip and (b) off-chain orphans older than ORPHAN_GRACE_MS are candidates, and a
 * live reader pin protects either. CURRENT is advanced to the tip first so no
 * reader anchor names a reclaimed generation.
 */
export function reclaimGenerations(indexesDir: string, opts: { keep?: number; now?: number } = {}): string[] {
  const keep = opts.keep ?? 3;
  const now = opts.now ?? Date.now();
  const removed: string[] = [];
  const gdir = generationsDir(indexesDir);
  if (contained(indexesDir, gdir) || contained(indexesDir, path.join(publicationDir(indexesDir), "successors"))) return removed;
  const tip = readPointer(indexesDir);
  if (!tip) return removed;
  advanceCurrent(indexesDir, tip);
  const pins = livePins(indexesDir);
  if (!pins) return removed;
  // Backward chain from the tip.
  const chain: string[] = [];
  for (let g: Sha256 | null = tip.generation; g && chain.length < 100_000; ) {
    chain.push(hex(g));
    try {
      g = (JSON.parse(fs.readFileSync(path.join(gdir, hex(g), "publication.json"), "utf8")) as KnowledgePublicationRecord).previous_generation;
    } catch {
      g = null;
    }
  }
  const depth = new Map(chain.map((g, i) => [g, i]));
  for (const n of safeReaddir(gdir)) {
    if (!GEN_DIR.test(n) || pins.has(n)) continue;
    const d = depth.get(n);
    if (d !== undefined && d <= keep) continue;
    if (d === undefined) {
      let age = 0;
      try {
        age = now - fs.statSync(path.join(gdir, n)).mtimeMs;
      } catch {
        continue;
      }
      if (age < ORPHAN_GRACE_MS) continue;
    }
    // Move aside, then re-read pins: a reader that pinned meanwhile keeps it.
    const aside = path.join(gdir, `.reclaim-${HOST}-${process.pid}-${n}`);
    try {
      fs.renameSync(path.join(gdir, n), aside);
    } catch {
      continue;
    }
    const again = livePins(indexesDir);
    if (!again || again.has(n)) {
      try {
        fs.renameSync(aside, path.join(gdir, n));
      } catch {
        /* a peer restored or replaced it */
      }
      continue;
    }
    removeContained(indexesDir, aside);
    // Successor links are never removed: any CURRENT, even a stale or backward
    // one written by a paused process, still resolves forward to the tip.
    for (const side of ["hints", "verifications"]) {
      removeContained(indexesDir, path.join(publicationDir(indexesDir), side, `${n}.jsonl`));
      removeContained(indexesDir, path.join(publicationDir(indexesDir), side, `${n}.json`));
    }
    removed.push(n);
  }
  reclaimStaging(indexesDir);
  return removed;
}

/** Atomically move the CURRENT hint to `tip` when it lags (contained, exclusive temp). */
function advanceCurrent(indexesDir: string, tip: Pointer): void {
  const pubDir = publicationDir(indexesDir);
  const cur = path.join(pubDir, "CURRENT");
  if (contained(indexesDir, cur, true)) return;
  try {
    if ((JSON.parse(fs.readFileSync(cur, "utf8")) as Pointer).generation === tip.generation) return;
  } catch {
    /* absent or unreadable: rewrite */
  }
  const tmp = path.join(pubDir, `.CURRENT.${process.pid}.${crypto.randomUUID()}`);
  writeDurable(tmp, JSON.stringify(tip, null, 2) + "\n");
  fs.renameSync(tmp, cur);
  fsyncPath(pubDir);
}

function channelOrder(c: string): number {
  return ["structural_graph", "semantic_graph", "recall"].indexOf(c);
}

/**
 * Publish one generation. Under the publisher lock: destination CAS (generation
 * and layer digest) with optional rebase, then source CAS (observed basis equals
 * the job basis), then immutable generation → pointer rename → exports → reclaim.
 */
export function publishGeneration(job: PublishJob): PublishResult {
  const invalid = validateJob(job);
  if (invalid) return { status: "refused", reason: "invalid", detail: invalid };
  const pubDir = publicationDir(job.indexesDir);
  const gdir = generationsDir(job.indexesDir);
  try {
    fs.mkdirSync(job.indexesDir, { recursive: true });
    ensureDir(job.indexesDir, gdir);
  } catch (err) {
    return { status: "refused", reason: "containment", detail: String((err as Error).message) };
  }
  const fault = job.fault ?? (() => {});
  const now = job.now ?? (() => new Date().toISOString());

  const lock = acquirePublisherLock(pubDir, { timeoutMs: job.lockTimeoutMs });
  if (!lock.ok) return { status: "refused", reason: "lock_timeout", detail: lock.detail };
  let staging: string | null = null;
  let inflightPin: string | null = null;
  try {
    fault("lock_acquired");
    reclaimStaging(job.indexesDir);

    let base = job.base;
    let rebases = 0;
    for (let round = 0; ; round++) {
    // Destination CAS.
    const current = readPublication(job.indexesDir);
    let artifacts = toBuffers(job.artifacts);
    if (!sameBase(base, current?.pointer ?? null)) {
      if (!job.rebase || !current) {
        return {
          status: "refused",
          reason: "destination_moved",
          detail: `built from ${base?.generation ?? "nothing"}, destination is ${current?.pointer.generation ?? "nothing"}`,
        };
      }
      artifacts = toBuffers(job.rebase(current));
      rebases++;
    }

    // Layers the job does not own survive (checked on the final, possibly rebased, artifacts).
    if (job.preserve) {
      const lost = job.preserve(current?.artifacts ?? null, { ...(current?.artifacts ?? {}), ...artifacts });
      if (lost) return { status: "refused", reason: "undeclared_layer_change", detail: lost };
    }

    // Source CAS. Drift or another worktree refuses; unresolved resolver inputs
    // publish, but nothing is current and the basis is not verified.
    const observed = job.observe();
    const sameShape = (r: BasisRef | null): r is BasisRef => !!r && basisDigest(r.basis) === r.source_basis_hash;
    if (!sameShape(observed) || observed.basis.source_worktree_id !== job.basis.basis.source_worktree_id) {
      return { status: "refused", reason: "source_unknown", detail: "observed basis is missing, malformed or from another worktree" };
    }
    if (observed.source_basis_hash !== job.basis.source_basis_hash) {
      return { status: "refused", reason: "source_drift", detail: `source moved from ${job.basis.source_basis_hash} to ${observed.source_basis_hash}` };
    }
    const unresolved = freshnessFor(job.basis, observed) === "unknown";
    const verifiedAt = now();
    let decisions: DecisionPublicationRefs | null = null;
    try {
      decisions = job.decisions ? job.decisions() : null;
    } catch (err) {
      return { status: "refused", reason: "invalid", detail: `decision refs unreadable: ${(err as Error).message}` };
    }

    // Assemble: job artifacts over the destination's carried ones.
    const all: PublicationArtifacts = { ...(current?.artifacts ?? {}), ...artifacts };
    const declared = new Set<string>(job.channels);
    const layers: GenerationManifest["layers"] = {};
    const carriedReason: Record<string, string> = {};
    const channelSet = new Set<LayerChannel>([
      ...job.channels,
      ...(Object.keys(current?.manifest.layers ?? {}) as LayerChannel[]),
      ...(Object.keys(job.layers) as LayerChannel[]),
    ]);
    for (const c of [...channelSet].sort((a, b) => channelOrder(a) - channelOrder(b))) {
      const spec = job.layers[c];
      const prev = current?.manifest.layers[c];
      if (!spec) {
        if (prev) {
          layers[c] = prev; // a channel this writer has no view over
          if (prev.unknown_reason) carriedReason[c] = prev.unknown_reason;
        }
        continue;
      }
      if (!(spec.artifact in all)) continue;
      const layer_hash = spec.digest(all);
      if (declared.has(c)) {
        const how = job.provenance?.[c] ?? "rebuilt";
        if (how === "rebuilt") {
          layers[c] = { artifact: spec.artifact, layer_hash, basis_hash: job.basis.source_basis_hash };
        } else if (how === "derived" && prev) {
          // A transform of the destination's layer keeps that layer's provenance.
          layers[c] = { artifact: spec.artifact, layer_hash, basis_hash: prev.basis_hash, ...(prev.unknown_reason ? { unknown_reason: prev.unknown_reason } : {}) };
          if (prev.unknown_reason) carriedReason[c] = prev.unknown_reason;
        } else {
          const why =
            how === "derived"
              ? "derived from a layer that was never built from source"
              : (job.provenanceReason?.[c] ?? "ingested layer; the basis it was built for is not recorded");
          layers[c] = { artifact: spec.artifact, layer_hash, basis_hash: job.basis.source_basis_hash, unknown_reason: why };
          carriedReason[c] = why;
        }
      } else if (prev) {
        const why =
          prev.layer_hash !== layer_hash ? "layer changed by a writer that did not rebuild it from source" : prev.unknown_reason;
        layers[c] = { artifact: spec.artifact, layer_hash, basis_hash: prev.basis_hash, ...(why ? { unknown_reason: why } : {}) };
        if (why) carriedReason[c] = why;
      } else {
        // Present in the artifact, never published by a writer that owns it.
        const why = "layer was never published by a writer that builds it";
        layers[c] = { artifact: spec.artifact, layer_hash, basis_hash: job.basis.source_basis_hash, unknown_reason: why };
        carriedReason[c] = why;
      }
    }
    const exportsList = [...new Set(job.exports ?? [])].filter((n) => n in all).sort();
    const manifestBase = {
      previous_generation: current?.pointer.generation ?? null,
      artifacts: Object.fromEntries(
        Object.entries(all)
          .filter((e): e is [string, Buffer] => e[1] !== undefined)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([k, v]) => [k, { sha256: sha(v), bytes: v.length }]),
      ),
      layers,
      source_basis: { basis: job.basis.basis, source_basis_hash: job.basis.source_basis_hash, inventory: [...(job.basis.inventory ?? [])] },
      exports: exportsList,
      ...(decisions ? { decisions } : {}),
    };
    const generation = generationId(manifestBase);
    const finalDir = path.join(gdir, hex(generation));
    const reused = fs.existsSync(finalDir);

    // Pin the in-flight generation (owned by this live process) before it becomes
    // visible, until commit or refusal: GC never reclaims it by age alone.
    inflightPin = pinFile(job.indexesDir, generation);
    if (!inflightPin) return { status: "refused", reason: "containment", detail: "cannot pin the in-flight generation" };
    if (!reused) {
      staging = path.join(gdir, `.stage-${HOST}-${process.pid}-${crypto.randomUUID()}`);
      fs.mkdirSync(staging);
      for (const [name, bytes] of Object.entries(all)) {
        if (!bytes) continue;
        writeDurable(path.join(staging, name), bytes, 0o444);
        fault(`artifact:${name}`);
      }
      fault("layers_written");
      const manifest: GenerationManifest = { schema_version: "guild.knowledge_publication_manifest.v1", generation, ...manifestBase };
      const manBytes = JSON.stringify(manifest, null, 2) + "\n";
      writeDurable(path.join(staging, "manifest.json"), manBytes, 0o444);
      fault("manifest_written");
      const evidence = (p: string, s: Sha256, schema: string): Evidence => ({
        source_id: job.identity.source_id,
        path: relFromOwner(job.indexesDir, p),
        sha256: s,
        schema_version: schema,
        observed_at: verifiedAt,
        availability: "available",
        reason: null,
      });
      const channels: ChannelRecord[] = Object.entries(layers).map(([c, l]) => {
        const current4basis = l.basis_hash === job.basis.source_basis_hash;
        const state: ChannelState = carriedReason[c] || unresolved ? "unknown" : current4basis ? "current_for_basis" : "stale";
        return {
          channel: c as LayerChannel,
          state,
          basis_hash: l.basis_hash,
          layer_hash: l.layer_hash,
          output: evidence(path.join(finalDir, l.artifact), manifestBase.artifacts[l.artifact].sha256, "guild.knowledge_layer_artifact.v1"),
          reason:
            carriedReason[c] ??
            (unresolved ? "resolver inputs outside the basis are unresolved" : current4basis ? null : "layer was built for an older source basis"),
        };
      });
      const record: KnowledgePublicationRecord = {
        schema_version: "guild.stack.knowledge-publication.v1",
        source_id: job.identity.source_id,
        source_worktree_id: job.basis.basis.source_worktree_id,
        durable_owner_source_id: job.identity.durable_owner_source_id,
        publication_scope_source_id: job.identity.publication_scope_source_id,
        basis: job.basis.basis,
        source_basis_hash: job.basis.source_basis_hash,
        basis_verified_at: unresolved ? null : verifiedAt,
        generation,
        previous_generation: manifestBase.previous_generation,
        destination_layer_digest: layerDigest(layers),
        manifest: evidence(path.join(finalDir, "manifest.json"), sha(manBytes), manifest.schema_version),
        channels: decisions
          ? [
              ...channels,
              {
                channel: "project_memory",
                state: decisions.project_memory.state,
                basis_hash: job.basis.source_basis_hash,
                layer_hash: decisions.project_memory.digest,
                output: null,
                reason: decisions.project_memory.reason,
              },
            ]
          : channels,
        decision_refs: decisions?.decision_refs ?? [],
        replan_required: decisions?.replan_required ?? [],
      };
      writeDurable(path.join(staging, "publication.json"), JSON.stringify(record, null, 2) + "\n", 0o444);
      fault("record_written");
      fsyncPath(staging);
      fs.renameSync(staging, finalDir);
      staging = null;
      fsyncPath(gdir);
      fault("generation_renamed");
    }

    const loaded = loadGeneration(job.indexesDir, generation, null);
    const pointer: Pointer = loaded.pointer;

    // Commit: claim the ONE successor slot of the destination generation. The
    // claim is exclusive on the filesystem, so even two publishers that both
    // believe they hold the lock cannot fork the chain or overwrite a layer.
    ensureDir(job.indexesDir, path.join(pubDir, "successors"));
    const claim = successorFile(job.indexesDir, current?.pointer.generation ?? null);
    const badClaim = contained(job.indexesDir, claim, true);
    if (badClaim) return { status: "refused", reason: "containment", detail: badClaim };
    // Written and fsynced under a private name, then hard-linked into place:
    // link(2) is exclusive and the claim is never visible half-written.
    const claimTmp = path.join(path.dirname(claim), `.claim-${HOST}-${process.pid}-${crypto.randomUUID()}`);
    writeDurable(claimTmp, JSON.stringify(pointer, null, 2) + "\n");
    fault("successor_tmp");
    try {
      fs.linkSync(claimTmp, claim);
    } catch (err) {
      fs.rmSync(claimTmp, { force: true });
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Another publisher committed onto the same destination first.
      base = current?.pointer ?? null;
      if (inflightPin) fs.rmSync(inflightPin, { force: true });
      inflightPin = null;
      if (!job.rebase || round >= 3) {
        return { status: "refused", reason: "destination_moved", detail: `successor of ${current?.pointer.generation ?? "root"} already claimed` };
      }
      continue;
    }
    fs.rmSync(claimTmp, { force: true });
    fsyncPath(path.dirname(claim));
    fault("successor_claimed");

    // CURRENT is a cached hint of the chain tip (readers follow successors).
    const tmp = path.join(pubDir, `.CURRENT.${process.pid}.${crypto.randomUUID()}`);
    writeDurable(tmp, JSON.stringify(pointer, null, 2) + "\n");
    fault("pointer_tmp_written");
    const curFile = path.join(pubDir, "CURRENT");
    const badPtr = contained(job.indexesDir, curFile, true);
    if (!badPtr) {
      fs.renameSync(tmp, curFile);
      fsyncPath(pubDir);
    }
    fault("pointer_renamed");

    exportLegacy(job.indexesDir, loaded, fault);
    reclaimGenerations(job.indexesDir, { keep: job.keep });
    fault("reclaimed");
    return { status: "published", generation, rebases, reused };
    }
  } finally {
    if (inflightPin) fs.rmSync(inflightPin, { force: true });
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
    for (const n of safeReaddir(pubDir)) {
      if (n.startsWith(`.CURRENT.${process.pid}.`)) fs.rmSync(path.join(pubDir, n), { force: true });
    }
    lock.release();
  }
}

function safeReaddir(d: string): string[] {
  try {
    return fs.readdirSync(d);
  } catch {
    return [];
  }
}

/** Mirror exported artifacts at `indexes/<name>` (atomic rename; copies only). */
function exportLegacy(indexesDir: string, gen: PinnedGeneration, fault: (s: string) => void): void {
  for (const name of gen.manifest.exports) {
    const bytes = gen.artifacts[name];
    if (!bytes) continue;
    const target = path.join(indexesDir, name);
    const bad = contained(indexesDir, target, true);
    if (bad) throw new PublicationError("containment", bad);
    try {
      if (sha(fs.readFileSync(target)) === gen.manifest.artifacts[name].sha256) {
        fault(`export:${name}`);
        continue;
      }
    } catch {
      /* absent: write it */
    }
    const tmp = path.join(indexesDir, `.${name}.${process.pid}.${crypto.randomUUID()}.tmp`);
    writeDurable(tmp, bytes);
    fs.renameSync(tmp, target);
    fault(`export:${name}`);
  }
}

/**
 * Re-sync legacy exports with the current generation (after a crash between the
 * pointer rename and the export writes). Takes the lock.
 */
export function recoverPublication(indexesDir: string, opts: { lockTimeoutMs?: number; keep?: number } = {}): { recovered: boolean; detail: string } {
  if (!fs.existsSync(publicationDir(indexesDir))) return { recovered: false, detail: "nothing published" };
  const bad = contained(indexesDir, publicationDir(indexesDir));
  if (bad) return { recovered: false, detail: `containment: ${bad}` };
  const lock = acquirePublisherLock(publicationDir(indexesDir), { timeoutMs: opts.lockTimeoutMs });
  if (!lock.ok) return { recovered: false, detail: lock.detail };
  try {
    const cur = readPublication(indexesDir);
    if (!cur) return { recovered: false, detail: "nothing published" };
    exportLegacy(indexesDir, cur, () => {});
    reclaimGenerations(indexesDir, { keep: opts.keep });
    return { recovered: true, detail: `exports match ${cur.pointer.generation}` };
  } finally {
    lock.release();
  }
}

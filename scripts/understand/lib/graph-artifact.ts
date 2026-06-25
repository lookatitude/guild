/**
 * understand/lib/graph-artifact.ts — LANE G6 committable team graph artifact (lib).
 *
 * Pure functions behind the opt-in, committable, compressed structural-graph
 * snapshot (`.guild/indexes/structural-graph.json.zst`). The artifact lets a
 * teammate skip the cold structural pass: on a fresh clone the snapshot is
 * imported (graph + per-file fingerprint cache) and then G4 incremental
 * re-extracts ONLY the local delta (bootstrap-then-incremental, mirroring the
 * reference engine's `graph.db.zst`).
 *
 * File-first, NOT SQLite (goals.md §G6): the uncompressed payload is the
 * canonical JSON graph (plus the fingerprint cache needed to bootstrap
 * incremental), so the snapshot decompresses to a diff-tooling-friendly JSON.
 *
 * Determinism: the artifact is a pure function of (graph, cache). The graph's
 * `generated_from_commit` is NORMALIZED to the commit-independent constant on
 * package, so a snapshot carrying a stale sha re-packages byte-identically.
 * Nonce/timestamp facts live ONLY in the CLI sidecar, never in the artifact.
 *
 * Codec: gzip via Node's built-in `zlib` by default (no new dep; universally
 * available for any teammate decompressing). zstd is selectable when the
 * runtime exposes it. The codec is recorded in the self-describing header, so a
 * snapshot ALWAYS decompresses with the codec it was written with — the `.zst`
 * file name follows the brief; the container is the source of truth.
 *
 * Integrity: a magic + length-prefixed JSON header + SHA-256 over the
 * uncompressed payload. A corrupt/tampered/truncated artifact is REJECTED
 * (typed error) so the CLI can fall back to full extraction without crashing.
 *
 * Security: a leak audit (canonical SECRET_PATTERNS, SoT in docs-hygiene/scan.ts
 * — never re-spelled) runs over the WHOLE uncompressed payload BEFORE packaging.
 * Any finding fails closed: the artifact is NOT produced (`SecretLeakError`), so
 * a secret never reaches a committable file. This is a self-contained
 * package-time gate — it does NOT introduce a run-dir scrub surface, so
 * scrub.ts/audit.ts are untouched (it reuses their canonical pattern source).
 */

import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as crypto from "crypto";
import { validateGraph, CONFIDENCE, DIRECTIONS } from "./schema";
import type { KnowledgeGraph } from "./schema";
import type { StructuralCache } from "./structural";
// SoT for secret regexes (docs-hygiene/scan.ts). Static import — ts-jest
// transforms it and the module's `require.main === module` guard prevents the
// scan from running on import (mirrors scripts/lib/sanitized-run-export.ts).
import { SECRET_PATTERNS } from "../../docs-hygiene/scan";

/** The brief-mandated artifact name under `.guild/indexes/`. */
export const ARTIFACT_BASENAME = "structural-graph.json.zst";

/** Envelope schema for the uncompressed payload. */
export const ARTIFACT_SCHEMA = "guild.structural_graph_artifact.v1" as const;

/**
 * Commit-independent constant stamped on the packaged graph (determinism): the
 * nondeterministic HEAD sha lives ONLY in the CLI sidecar, never in the artifact,
 * so two identical trees at different commits package byte-identically.
 */
const STRUCTURAL_COMMIT = "structural";

/** Container magic — 8 bytes, identifies a Guild structural-graph artifact v01. */
const MAGIC = Buffer.from("GLDSGA01", "ascii");

/** Defensive cap on the JSON header so a corrupt length never allocates wildly. */
const MAX_HEADER_BYTES = 1 << 20; // 1 MiB

export type Codec = "gzip" | "zstd";

export interface ArtifactHeader {
  format: typeof ARTIFACT_SCHEMA;
  codec: Codec;
  /** hex SHA-256 of the uncompressed payload bytes (integrity check). */
  sha256: string;
  /** length of the uncompressed payload in bytes (cheap pre-hash sanity check). */
  uncompressed_bytes: number;
}

/** The uncompressed payload: the canonical graph + the bootstrap fingerprint cache. */
export interface ArtifactEnvelope {
  schema: typeof ARTIFACT_SCHEMA;
  graph: KnowledgeGraph;
  /** Per-file fingerprint cache so import → incremental processes only the local delta. */
  cache: StructuralCache;
}

export interface SecretFinding {
  category: string;
  line: number;
}

/** Thrown when the leak audit finds a secret — packaging fails closed. */
export class SecretLeakError extends Error {
  readonly findings: SecretFinding[];
  constructor(findings: SecretFinding[]) {
    super(
      `structural-graph artifact NOT packaged: ${findings.length} secret finding(s) ` +
        `— [${findings.map((f) => `${f.category}@L${f.line}`).join(", ")}]`,
    );
    this.name = "SecretLeakError";
    this.findings = findings;
  }
}

/** Thrown when an artifact buffer is corrupt/tampered/invalid — caller falls back. */
export class ArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactError";
  }
}

// ---------------------------------------------------------------------------
// Path containment
// ---------------------------------------------------------------------------

/**
 * Resolve `candidate` and assert it stays within `baseDir` (which must exist).
 * Rejects `../` escapes AND symlink escapes — including a symlinked PARENT
 * directory when the final target does not exist yet (Codex FIX-T6.1-r2 #1).
 * Returns the symlink-resolved absolute candidate path (== the lexical resolve
 * for the symlink-free case).
 *
 * Repo-anchor (Codex FIX-T6.1-r3 #1): `baseDir` ITSELF may be a symlink. A
 * caller passes `gp.indexesDir` (`.guild/indexes`) as the containment root; if
 * that directory is a symlink pointing OUTSIDE the repo, `realpathSync(baseDir)`
 * silently relocates the containment root outside the repo and every
 * "contained" write lands outside it. When `repoRoot` is supplied, the
 * realpath of the base is asserted to stay within the realpath of the repo root
 * BEFORE it is trusted as the containment base — a symlinked base that escapes
 * the repo is refused.
 */
export function assertContainedPath(candidate: string, baseDir: string, repoRoot?: string): string {
  const base = fs.realpathSync(baseDir);
  // Repo-anchor the containment base: a symlinked `baseDir` resolving outside the
  // repo root must not become a (relocated) containment root (Codex FIX-T6.1-r3 #1).
  if (repoRoot !== undefined) {
    const realRoot = fs.realpathSync(repoRoot);
    const relToRoot = path.relative(realRoot, base);
    if (relToRoot !== "" && (relToRoot.startsWith("..") || path.isAbsolute(relToRoot))) {
      throw new ArtifactError(`containment base escapes repo root ${realRoot}: ${baseDir}`);
    }
  }
  const resolved = path.resolve(base, candidate);
  const within = (child: string): boolean => {
    const rel = path.relative(base, child);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  // Lexical containment first — cheap reject of absolute / `../` escapes.
  if (!within(resolved)) {
    throw new ArtifactError(`path escapes ${base}: ${candidate}`);
  }
  // Symlink containment (Codex FIX-T6.1-r2 #1): the lexical check above is fooled
  // by a symlinked PARENT — `link/new.json` stays syntactically under base while a
  // write/spawn follows `link` outside. Walk every component from base to the
  // (possibly nonexistent) target, resolving the NEAREST EXISTING ANCESTOR through
  // any symlink BEFORE appending the nonexistent tail, then re-assert containment.
  let real = base;
  let exhausted = false; // once a component is missing, the rest is a literal tail
  for (const seg of path.relative(base, resolved).split(path.sep)) {
    real = path.join(real, seg);
    if (exhausted) continue;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(real);
    } catch {
      exhausted = true; // missing — nothing below it can be a symlink
      continue;
    }
    if (stat.isSymbolicLink()) {
      // Resolve the link (full chain when the target exists; lexical readlink when
      // it dangles) so a symlink hop outside base is caught even for a missing tail.
      try {
        real = fs.realpathSync(real);
      } catch {
        real = path.resolve(path.dirname(real), fs.readlinkSync(real));
      }
    }
  }
  if (!within(real)) {
    throw new ArtifactError(`path resolves outside ${base} via symlink: ${candidate}`);
  }
  return real;
}

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

interface ZstdCapableZlib {
  zstdCompressSync?: (buf: Buffer) => Buffer;
  zstdDecompressSync?: (buf: Buffer) => Buffer;
}

export function zstdAvailable(): boolean {
  const z = zlib as unknown as ZstdCapableZlib;
  return typeof z.zstdCompressSync === "function" && typeof z.zstdDecompressSync === "function";
}

function compress(buf: Buffer, codec: Codec): Buffer {
  if (codec === "zstd") {
    const z = zlib as unknown as ZstdCapableZlib;
    if (typeof z.zstdCompressSync !== "function") {
      throw new ArtifactError("zstd codec requested but unavailable in this runtime");
    }
    return z.zstdCompressSync(buf);
  }
  return zlib.gzipSync(buf);
}

function decompress(buf: Buffer, codec: Codec): Buffer {
  if (codec === "zstd") {
    const z = zlib as unknown as ZstdCapableZlib;
    if (typeof z.zstdDecompressSync !== "function") {
      throw new ArtifactError("artifact is zstd-compressed but this runtime cannot decompress zstd");
    }
    return z.zstdDecompressSync(buf);
  }
  return zlib.gunzipSync(buf);
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/**
 * The canonical uncompressed payload bytes for an envelope. Matches the on-disk
 * JSON convention (2-space indent + trailing newline) so the snapshot
 * decompresses to a clean, diff-tooling-friendly JSON file.
 */
export function envelopeBytes(env: ArtifactEnvelope): Buffer {
  return Buffer.from(JSON.stringify(env, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Leak audit
// ---------------------------------------------------------------------------

/**
 * Mask benign machine-derived hash values (the cache's per-file SHA-256
 * `contentHash` and any 40-char git-sha) so the high-entropy-hex SECRET_PATTERN
 * does not false-positive on every fingerprint. This mirrors scan.ts's OWN
 * high-entropy suppression for known-safe SHA contexts — it neutralizes ONLY the
 * bare-hex heuristic; the `password=`/`api_key=`/AWS/GCP/GitHub/PEM patterns are
 * untouched (a real secret is not a bare quoted hex string). Replacement is
 * same-line so reported line numbers stay accurate.
 */
function maskBenignHashes(text: string): string {
  // Match quoted ("...") OR bare hex tokens — the cache stores fingerprints both
  // ways (serialized payload quotes them; the raw-value corpus does not).
  return text.replace(/\b[0-9a-f]{40,}\b/g, "<hash>");
}

/**
 * Recursively collect every string leaf value in an object. Used so the leak
 * audit sees RAW (un-escaped) values — JSON serialization escapes embedded
 * quotes (e.g. `password = "x"` → `password = \"x\"`), which would otherwise
 * defeat the `[^\s"']{6,}` assignment patterns. We audit both the serialized
 * payload AND every raw value.
 */
export function collectStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStringValues(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectStringValues(v, out);
  }
  return out;
}

/**
 * Scan text with the canonical SECRET_PATTERNS. Returns one finding per matching
 * line per pattern. Used to fail packaging closed before a secret is committed.
 */
export function auditForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = maskBenignHashes(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const [re, label] of SECRET_PATTERNS) {
      // Clone the regex per test so a `g`-flagged pattern's lastIndex never leaks
      // across lines/patterns (the SoT array is shared across callers).
      const probe = new RegExp(re.source, re.flags.replace("g", ""));
      if (probe.test(lines[i])) findings.push({ category: label, line: i + 1 });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Lossless-packaging + cache-shape validation
// ---------------------------------------------------------------------------

/**
 * Order-independent canonical JSON: object keys sorted recursively, array order
 * preserved. Used to compare a graph against its post-validation form so the
 * lossless-packaging check is not fooled by benign top-level key REORDERING
 * inside validateGraph — only genuine mutations/drops (different values, dropped
 * nodes/edges/fields) change the canonical string.
 */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) sorted[k] = norm(o[k]);
      return sorted;
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

/** A repo-relative cache key with no escape: not absolute, no `..` segment, non-empty. */
function isSafeRelKey(rel: string): boolean {
  if (typeof rel !== "string" || rel === "") return false;
  if (path.isAbsolute(rel)) return false;
  return !rel.split(/[/\\]/).some((seg) => seg === "..");
}

/** Every element of the array is a (possibly empty) string. */
function isStringArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** The structural node types a cached symbol node may carry (file is the fileNode). */
const SYMBOL_NODE_TYPES = new Set(["function", "class"]);

/**
 * The FULL `GraphNode` shape the schema requires AND a fresh structural
 * extraction emits (Codex FIX-T6.1-r3 #2). `assembleStructuralGraph()` adds the
 * cached `fileNode` (Pass 1 `addNode(b.fileNode)`) and every `symbolNodes`
 * element (Pass 1 `for (n of b.symbolNodes) addNode(n)`) WHOLESALE into the
 * graph, so a cached node that is missing a schema-required field (or carries a
 * bogus type / empty provenance) would surface a node that `validateGraph` later
 * repairs or drops — diverging the incremental bundle from a full rebuild.
 * Validate every required field so any deviation rejects the artifact → fallback.
 */
function isValidGraphNode(n: unknown, allowedTypes: Set<string>): boolean {
  if (!n || typeof n !== "object" || Array.isArray(n)) return false;
  const r = n as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return false;
  if (typeof r.type !== "string" || !allowedTypes.has(r.type)) return false;
  if (typeof r.name !== "string" || r.name === "") return false;
  // A structural node always carries real provenance (the file path, or
  // `rel#Lx-Ly` for a symbol); never accept empty/non-string source_refs.
  if (!Array.isArray(r.source_refs) || r.source_refs.length === 0) return false;
  if (!r.source_refs.every((s) => typeof s === "string" && s !== "")) return false;
  if (typeof r.confidence !== "string" || !CONFIDENCE.has(r.confidence)) return false;
  return true;
}

/** A cached `fileNode`: full GraphNode shape, type `file`, id keyed to its file. */
function isValidFileNode(n: unknown, rel: string): boolean {
  if (!isValidGraphNode(n, new Set(["file"]))) return false;
  return (n as Record<string, unknown>).id === `file:${rel}`;
}

/**
 * A cached `symbolNodes` element: full GraphNode shape, type `function`/`class`,
 * AND anchored to THIS bundle's `rel` (Codex FIX-T6.1-r4). A structural symbol id
 * is `<type>:<rel>:<name>` and the node `name` IS that id suffix (structural.ts
 * `symbolNodeName`: function name = the suffix after `function:<rel>:`, class name
 * = simpleName == the suffix), so the single id-identity below pins the type
 * prefix, the OWNING FILE, and name-consistency in one check. Every `source_ref`
 * path (the part before `#Lx-Ly`) is also required to be this bundle's file, so a
 * symbol that names a FOREIGN file can never ride in on a bundle keyed to `rel`
 * (it would surface a node/edge that a full rebuild emits from a different bundle).
 */
function isValidSymbolNode(n: unknown, rel: string): boolean {
  if (!isValidGraphNode(n, SYMBOL_NODE_TYPES)) return false;
  const r = n as Record<string, unknown>;
  // id is namespaced `<type>:<rel>:<name>` — pins type prefix + owning file + name.
  if (r.id !== `${r.type as string}:${rel}:${r.name as string}`) return false;
  // every source_ref's path component (before `#Lx-Ly`) is this bundle's file.
  for (const ref of r.source_refs as unknown[]) {
    if (typeof ref !== "string" || ref.split("#")[0] !== rel) return false;
  }
  return true;
}

/**
 * A cached `contains` edge: the FULL `GraphEdge` shape the schema requires
 * (Codex FIX-T6.1-r3 #2). `assembleStructuralGraph()` adds each cached `contains`
 * edge WHOLESALE (Pass 1 `for (e of b.contains) addEdge(e)`), so a malformed edge
 * (bad `type`/`direction`/`weight`, or an endpoint that is not a node in THIS
 * bundle) would surface an invalid or dangling-reference edge in the graph.
 * `nodeIds` is the set of this bundle's node ids (fileNode + symbolNodes) — both
 * endpoints must reference one (bundle cross-consistency).
 */
function isValidContainsEdge(e: unknown, nodeIds: Set<string>): boolean {
  if (!e || typeof e !== "object" || Array.isArray(e)) return false;
  const r = e as Record<string, unknown>;
  if (r.type !== "contains") return false;
  if (typeof r.source !== "string" || r.source === "") return false;
  if (typeof r.target !== "string" || r.target === "") return false;
  if (typeof r.direction !== "string" || !DIRECTIONS.has(r.direction)) return false;
  if (typeof r.weight !== "number" || !Number.isFinite(r.weight) || r.weight < 0 || r.weight > 1) {
    return false;
  }
  // bundle cross-consistency: both endpoints must be nodes this same bundle emits.
  return nodeIds.has(r.source) && nodeIds.has(r.target);
}

/**
 * A cached `classes` element must carry the fields Pass 1 registers (`id`,
 * `simpleName`) and the `bases`/`ifaces` name arrays Pass 2b iterates with
 * `for…of` — a non-array `bases`/`ifaces` throws "not iterable" during assembly.
 */
function isValidClassEntry(c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  const r = c as Record<string, unknown>;
  return (
    typeof r.id === "string" && r.id !== "" &&
    typeof r.simpleName === "string" &&
    isStringArray(r.bases) &&
    isStringArray(r.ifaces)
  );
}

/**
 * A cached `callables` element must carry the fields Pass 1 registers (`id`,
 * `simpleName`) and the `callees` name array Pass 2c iterates with `for…of` —
 * a null element throws on `register(…, c.simpleName, c.id)`, a non-array
 * `callees` throws "not iterable".
 */
function isValidCallableEntry(c: unknown): boolean {
  if (!c || typeof c !== "object") return false;
  const r = c as Record<string, unknown>;
  return (
    typeof r.id === "string" && r.id !== "" &&
    typeof r.simpleName === "string" &&
    isStringArray(r.callees)
  );
}

/**
 * Validate the bootstrap fingerprint cache shape before an imported artifact is
 * accepted (Codex FIX-T6.1 #3). A checksum-valid artifact can still carry a
 * MALFORMED `cache` (tampered, or from a non-conforming producer); writing it
 * would let `--incremental` reuse a broken bundle and diverge from a full
 * rebuild. We reject schema/version/relative-key/content-hash/bundle-shape
 * defects so the CLI falls back to a full extraction instead of bootstrapping
 * garbage. Mirrors structural.ts `isReusableBundle` (shape) + adds key-safety
 * and hash-format checks; kept in THIS lane's file (no edit to structural.ts).
 */
export function validateStructuralCache(cache: unknown): cache is StructuralCache {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return false;
  const c = cache as Record<string, unknown>;
  if (c.schema !== "guild.structural_cache.v1") return false;
  if (typeof c.version !== "string" || c.version === "") return false;
  const files = c.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) return false;
  for (const [rel, bundle] of Object.entries(files as Record<string, unknown>)) {
    if (!isSafeRelKey(rel)) return false;
    if (!bundle || typeof bundle !== "object") return false;
    const b = bundle as Record<string, unknown>;
    if (b.rel !== rel) return false; // entry must be keyed to its own file
    if (typeof b.language !== "string") return false;
    if (typeof b.isCode !== "boolean") return false;
    // content hash: "" (unreadable file) OR a 64-char SHA-256 hex — anything else
    // is a malformed fingerprint that must not become an incremental key.
    if (typeof b.contentHash !== "string") return false;
    if (b.contentHash !== "" && !/^[0-9a-f]{64}$/.test(b.contentHash)) return false;
    // fileNode: full GraphNode shape (it is added wholesale via addNode(b.fileNode)).
    if (!isValidFileNode(b.fileNode, rel)) return false;
    if (
      !Array.isArray(b.symbolNodes) ||
      !Array.isArray(b.contains) ||
      !Array.isArray(b.importSpecs) ||
      !Array.isArray(b.classes) ||
      !Array.isArray(b.callables)
    ) {
      return false;
    }
    // Element-level validation (Codex FIX-T6.1-r2 #2 + r3 #2/#3 + r4): the
    // array-shape checks above pass even when an array holds MALFORMED entries.
    // `refreshStructuralIncremental()` reuses such a bundle and
    // `assembleStructuralGraph()` then emits these nodes/edges WHOLESALE — crashing,
    // diverging from a full rebuild, or surfacing invalid/dangling/mis-sourced
    // edges. Validate the FULL node/edge shape AND deep bundle cross-consistency
    // (id↔kind, id↔name, source_ref↔file, edge topology) so any defect rejects the
    // artifact and the CLI falls back to a full extraction.
    //
    // symbolNodes: full GraphNode shape, anchored to THIS bundle's `rel`; INDEX by id
    // so the classes/callables cross-checks below resolve the ACTUAL symbol node
    // (its kind + name), not merely "some id is present" (Codex FIX-T6.1-r4).
    const symbolById = new Map<string, Record<string, unknown>>();
    for (const n of b.symbolNodes as unknown[]) {
      if (!isValidSymbolNode(n, rel)) return false;
      symbolById.set((n as Record<string, unknown>).id as string, n as Record<string, unknown>);
    }
    // contains edges: full GraphEdge shape + endpoints within this bundle's nodes
    // (fileNode + symbolNodes) — a phantom endpoint would emit a dangling edge.
    const bundleNodeIds = new Set<string>(symbolById.keys());
    bundleNodeIds.add(`file:${rel}`);
    if (!(b.contains as unknown[]).every((e) => isValidContainsEdge(e, bundleNodeIds))) return false;
    if (!(b.importSpecs as unknown[]).every((s) => typeof s === "string")) return false;
    // classes: full shape AND the `id` MUST resolve to a real CLASS symbol node in
    // THIS bundle whose NAME matches the entry's `simpleName` (Codex FIX-T6.1-r4).
    // Pass 1 registers `c.simpleName`→`c.id`; Pass 2b emits inherits/implements edges
    // with `c.id` as the SOURCE. An id that resolves to a FUNCTION node, or whose
    // name disagrees, would register a mis-named symbol and emit a phantom-source /
    // mis-resolved edge that diverges from a full rebuild. (A class symbol node's
    // `name` IS its simpleName, so node.name === c.simpleName is the exact match.)
    for (const c of b.classes as unknown[]) {
      if (!isValidClassEntry(c)) return false;
      const r = c as Record<string, unknown>;
      const node = symbolById.get(r.id as string);
      if (!node || node.type !== "class" || node.name !== r.simpleName) return false;
    }
    // callables: full shape AND the `id` MUST resolve to a real FUNCTION symbol node
    // in THIS bundle whose name's LAST dotted segment matches the entry's `simpleName`
    // (top-level fn: node name == simpleName; method `Cls.method`: node name suffix ==
    // method). Pass 2c emits calls edges with `c.id` as the SOURCE; an id that
    // resolves to a class node — or a mismatched name — would emit a phantom-source /
    // mis-registered edge diverging from a full rebuild (Codex FIX-T6.1-r4).
    for (const c of b.callables as unknown[]) {
      if (!isValidCallableEntry(c)) return false;
      const r = c as Record<string, unknown>;
      const node = symbolById.get(r.id as string);
      if (!node || node.type !== "function") return false;
      if (r.simpleName !== (node.name as string).split(".").pop()) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Package / unpack
// ---------------------------------------------------------------------------

export interface PackageResult {
  artifact: Buffer;
  header: ArtifactHeader;
}

/**
 * Build the committable artifact buffer from a graph + bootstrap cache.
 *
 * Steps: validate the graph (write only validated data) → normalize
 * `generated_from_commit` to the commit-independent constant → leak-audit the
 * whole payload (fail closed on any finding) → compress → frame with a
 * self-describing header + integrity SHA-256.
 *
 * @throws SecretLeakError if the leak audit finds a secret (artifact NOT built).
 * @throws ArtifactError   if the graph fails schema validation.
 */
export function packageGraphArtifact(
  graph: KnowledgeGraph,
  cache: StructuralCache,
  opts: { codec?: Codec } = {},
): PackageResult {
  // Determinism: a stale sha carried by an existing graph is normalized away BEFORE
  // validation so two identical trees at different commits package byte-identically
  // AND the lossless check below compares like-for-like.
  const normalizedInput: KnowledgeGraph = { ...graph, generated_from_commit: STRUCTURAL_COMMIT };
  const validation = validateGraph(normalizedInput);
  if (!validation.success || !validation.data) {
    throw new ArtifactError(`graph failed schema validation: ${validation.fatal ?? "unknown"}`);
  }
  const validated: KnowledgeGraph = { ...validation.data, generated_from_commit: STRUCTURAL_COMMIT };

  // Lossless contract (Codex FIX-T6.1 #2): packaging must store the graph EXACTLY
  // as given (modulo the documented commit normalization). validateGraph can
  // repair/auto-fix/drop nodes, edges, or unknown top-level/project fields; if it
  // would change ANYTHING here, refuse — never silently package a repaired graph
  // behind a "lossless round-trip" claim. A real structural graph is already a
  // validation fixpoint, so this is a no-op for legitimate input.
  if (canonicalJson(validated) !== canonicalJson(normalizedInput)) {
    throw new ArtifactError(
      "graph not losslessly packageable: schema validation would mutate or drop data " +
        "(auto-fix / dropped node|edge|field) — refusing to package a repaired graph",
    );
  }

  const envelope: ArtifactEnvelope = {
    schema: ARTIFACT_SCHEMA,
    graph: validated,
    cache,
  };
  const payload = envelopeBytes(envelope);

  // Security: fail closed BEFORE the secret can reach a committable file. Audit
  // BOTH the serialized payload (catches structural patterns) and every RAW
  // string value (so JSON-escaped quotes can't smuggle an assignment past us).
  const auditCorpus = payload.toString("utf8") + "\n" + collectStringValues(envelope).join("\n");
  const findings = auditForSecrets(auditCorpus);
  if (findings.length > 0) throw new SecretLeakError(findings);

  const codec: Codec = opts.codec ?? "gzip";
  const compressed = compress(payload, codec);
  const header: ArtifactHeader = {
    format: ARTIFACT_SCHEMA,
    codec,
    sha256: crypto.createHash("sha256").update(payload).digest("hex"),
    uncompressed_bytes: payload.length,
  };
  const headerBuf = Buffer.from(JSON.stringify(header), "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(headerBuf.length, 0);
  return { artifact: Buffer.concat([MAGIC, lenBuf, headerBuf, compressed]), header };
}

/**
 * Decode + integrity-check an artifact buffer back into its envelope.
 *
 * Rejects (ArtifactError) on bad magic, truncation, out-of-range header length,
 * malformed header, decompression failure, SHA-256 mismatch (tamper/corruption),
 * non-JSON payload, or a graph that fails schema validation. The CLI catches
 * this and falls back to full extraction — no crash.
 */
export function unpackGraphArtifact(buf: Buffer): { envelope: ArtifactEnvelope; header: ArtifactHeader } {
  if (!Buffer.isBuffer(buf) || buf.length < MAGIC.length + 4) {
    throw new ArtifactError("artifact too short / not a buffer");
  }
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new ArtifactError("bad magic — not a Guild structural-graph artifact");
  }
  const headerLen = buf.readUInt32BE(MAGIC.length);
  if (headerLen <= 0 || headerLen > MAX_HEADER_BYTES) {
    throw new ArtifactError(`header length out of range: ${headerLen}`);
  }
  const headerStart = MAGIC.length + 4;
  const payloadStart = headerStart + headerLen;
  if (payloadStart > buf.length) {
    throw new ArtifactError("artifact truncated — header extends past buffer");
  }

  let header: ArtifactHeader;
  try {
    header = JSON.parse(buf.subarray(headerStart, payloadStart).toString("utf8")) as ArtifactHeader;
  } catch {
    throw new ArtifactError("malformed artifact header (not JSON)");
  }
  if (header.format !== ARTIFACT_SCHEMA) {
    throw new ArtifactError(`unknown artifact format "${header.format}"`);
  }
  if (header.codec !== "gzip" && header.codec !== "zstd") {
    throw new ArtifactError(`unknown codec "${header.codec}"`);
  }
  if (typeof header.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(header.sha256)) {
    throw new ArtifactError("missing/invalid integrity sha256 in header");
  }

  let payload: Buffer;
  try {
    payload = decompress(buf.subarray(payloadStart), header.codec);
  } catch (err) {
    throw new ArtifactError(`decompression failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (
    typeof header.uncompressed_bytes === "number" &&
    header.uncompressed_bytes !== payload.length
  ) {
    throw new ArtifactError(
      `integrity: uncompressed length ${payload.length} != header ${header.uncompressed_bytes}`,
    );
  }
  const actualSha = crypto.createHash("sha256").update(payload).digest("hex");
  if (actualSha !== header.sha256) {
    throw new ArtifactError("integrity: payload sha256 mismatch — artifact corrupt or tampered");
  }

  let envelope: ArtifactEnvelope;
  try {
    envelope = JSON.parse(payload.toString("utf8")) as ArtifactEnvelope;
  } catch {
    throw new ArtifactError("artifact payload is not valid JSON");
  }
  if (!envelope || envelope.schema !== ARTIFACT_SCHEMA || !envelope.graph) {
    throw new ArtifactError("artifact payload is not a structural-graph envelope");
  }

  // Defense in depth: the bootstrapped graph must itself pass schema validation.
  const validation = validateGraph(envelope.graph);
  if (!validation.success || !validation.data) {
    throw new ArtifactError(`artifact graph failed schema validation: ${validation.fatal ?? "unknown"}`);
  }
  // Lossless contract (Codex FIX-T6.1 #2): a genuine Guild artifact was packaged
  // from a validation-fixpoint graph, so re-validation is a no-op. If it would
  // mutate/drop here, the artifact came from a non-conforming producer — reject
  // (→ full-extract fallback) rather than silently bootstrap a repaired graph.
  if (canonicalJson(validation.data) !== canonicalJson(envelope.graph)) {
    throw new ArtifactError("artifact graph is not a validation fixpoint — repaired/dropped on import");
  }
  envelope.graph = validation.data;

  // Cache validation (Codex FIX-T6.1 #3): a checksum-valid artifact can still
  // carry a MALFORMED `cache`. Validate schema/relative-keys/content-hashes/
  // bundle-shapes BEFORE accepting — a defect rejects the artifact so the CLI
  // falls back to a full extraction instead of writing a broken incremental
  // baseline.
  if (!validateStructuralCache(envelope.cache)) {
    throw new ArtifactError("artifact cache is malformed (schema/keys/hashes/bundle shape) — rejected");
  }
  return { envelope, header };
}

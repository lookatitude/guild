/**
 * learn/lib/graph-artifact.ts — LANE G6 committable team graph artifact (lib).
 *
 * Pure functions behind the opt-in, committable, compressed structural-graph
 * snapshot (`.guild/indexes/structural-graph.json.zst`). The artifact lets a
 * teammate skip the cold pass on a fresh clone: the snapshot is imported and the
 * local structural tier is then (re)built locally.
 *
 * ARCHITECTURAL SIMPLIFICATION (FIX-T6.1-r5). Earlier rounds shipped the canonical
 * graph PLUS the per-file structural-cache bundles, then had to comprehensively
 * validate every cached node/edge/bundle element on import (the bundles are added
 * to the graph WHOLESALE by `assembleStructuralGraph`, so a single malformed cached
 * element could crash or silently diverge a reused incremental). That untrusted-cache
 * validation surface is the asymptote rounds 1–5 chased (source-ref format, edge
 * topology, id↔kind/name/file, …). This round removes it ENTIRELY:
 *
 *   - The artifact carries ONLY (a) the canonical graph and (b) a flat per-file
 *     fingerprint map `{ repo-rel-path: content-sha }`. NOT the structural-cache
 *     bundles.
 *   - The graph is already validated comprehensively by `validateGraph` (the SOLE
 *     structural-validation surface now). The fingerprint map is just `path → sha`
 *     strings — trivially validatable as a flat `{string: hex-sha}` map.
 *   - On import the local structural cache is NEVER read from the artifact. It is
 *     rebuilt locally: the importer strips the structural subset from the validated
 *     bootstrap graph and a local model-free re-extraction re-authors it (and seeds
 *     a locally-produced, trusted cache). The expensive LLM-tier nodes/edges/layers/
 *     tour from the snapshot ARE preserved — that is the bootstrap benefit (a fresh
 *     clone skips the LLM pass, not the cheap structural pass). The fingerprint map
 *     is the snapshot baseline for the first incremental diff.
 *
 * File-first, NOT SQLite (goals.md §G6): the uncompressed payload is the canonical
 * JSON graph plus the fingerprint map, so the snapshot decompresses to a clean,
 * diff-tooling-friendly JSON.
 *
 * Determinism: the artifact is a pure function of (graph, fingerprints). The graph's
 * `generated_from_commit` is NORMALIZED to the commit-independent constant on
 * package, so a snapshot carrying a stale sha re-packages byte-identically.
 * Nonce/timestamp facts live ONLY in the CLI sidecar, never in the artifact.
 *
 * Codec: gzip via Node's built-in `zlib` by default (no new dep; universally
 * available for any teammate decompressing). zstd is selectable when the runtime
 * exposes it. The codec is recorded in the self-describing header.
 *
 * Integrity: a magic + length-prefixed JSON header + SHA-256 over the uncompressed
 * payload. A corrupt/tampered/truncated artifact is REJECTED (typed error) so the
 * CLI can fall back to full extraction without crashing.
 *
 * Security: a leak audit (canonical SECRET_PATTERNS, SoT in docs-hygiene/scan.ts —
 * never re-spelled) runs over the WHOLE uncompressed payload BEFORE packaging. Any
 * finding fails closed (`SecretLeakError`), so a secret never reaches a committable
 * file. This is a self-contained package-time gate — it does NOT introduce a run-dir
 * scrub surface, so scrub.ts/audit.ts are untouched (it reuses their canonical
 * pattern source).
 */

import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as crypto from "crypto";
import { validateGraph } from "./schema";
import type { KnowledgeGraph } from "./schema";
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

/**
 * The uncompressed payload: the canonical graph + the flat per-file fingerprint
 * map. NOT the structural-cache bundles (FIX-T6.1-r5) — the local cache is rebuilt
 * locally on import and never trusted from the artifact.
 */
export interface ArtifactEnvelope {
  schema: typeof ARTIFACT_SCHEMA;
  graph: KnowledgeGraph;
  /**
   * Per-file fingerprint map `{ repo-rel-path: content-sha-hex }` — the snapshot
   * baseline for the first incremental diff. Trivially validatable; carries no
   * structural data to trust.
   */
  fingerprints: Record<string, string>;
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
 *
 * `opts.lexicalFinal` (Codex FIX-T6.1-r8): when set, every PARENT component is
 * still resolved through symlinks and containment-checked (so the symlinked-parent
 * escape rejection above still holds), but the FINAL component is NOT
 * dereferenced — the returned path keeps the literal final name. A caller that
 * then DELETES the returned path unlinks the sidecar ITSELF (the link), never the
 * file it points at: a cache sidecar that is a symlink to another *contained*
 * `.guild/indexes` file must not make deletion remove that target.
 */
export function assertContainedPath(
  candidate: string,
  baseDir: string,
  repoRoot?: string,
  opts: { lexicalFinal?: boolean } = {},
): string {
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
  const segs = path.relative(base, resolved).split(path.sep);
  for (let i = 0; i < segs.length; i++) {
    real = path.join(real, segs[i]);
    if (exhausted) continue;
    // lexicalFinal (Codex FIX-T6.1-r8): never dereference the LAST component, so a
    // caller that DELETES this path unlinks the link itself rather than following it
    // to a (possibly in-repo) target. Parents are still resolved + checked above.
    if (opts.lexicalFinal && i === segs.length - 1) continue;
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
 * Mask benign machine-derived hash values (the per-file SHA-256 fingerprints and
 * any 40-char git-sha) so the high-entropy-hex SECRET_PATTERN does not
 * false-positive on every fingerprint. This mirrors scan.ts's OWN high-entropy
 * suppression for known-safe SHA contexts — it neutralizes ONLY the bare-hex
 * heuristic; the `password=`/`api_key=`/AWS/GCP/GitHub/PEM patterns are untouched
 * (a real secret is not a bare quoted hex string). Replacement is same-line so
 * reported line numbers stay accurate.
 */
function maskBenignHashes(text: string): string {
  // Match quoted ("...") OR bare hex tokens — fingerprints appear both ways
  // (serialized payload quotes them; the raw-value corpus does not).
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
// Lossless-packaging + fingerprint-map validation
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

/** A repo-relative key with no escape: not absolute, no `..` segment, non-empty. */
function isSafeRelKey(rel: string): boolean {
  if (typeof rel !== "string" || rel === "") return false;
  if (path.isAbsolute(rel)) return false;
  return !rel.split(/[/\\]/).some((seg) => seg === "..");
}

/** A lowercase hex content digest: SHA-256 (64) is what Guild produces; a 40-hex
 *  git sha is also accepted so an alternate producer's map is not spuriously
 *  rejected. */
const FINGERPRINT_SHA_RE = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * The ENTIRE untrusted-data validation surface that replaces the removed
 * `validateStructuralCache` (FIX-T6.1-r5): the fingerprint map is a flat
 * `{ repo-rel-path: content-sha-hex }` object — every key a safe repo-relative
 * path (no `..`/absolute escape), every value a lowercase hex sha. It carries NO
 * structural nodes/edges, so there is nothing the importer adds to the graph
 * wholesale and nothing to deep-validate; a defect here just rejects the artifact
 * so the CLI falls back to a full extraction. An empty map is valid (a degenerate
 * snapshot with no baseline).
 */
export function validateFingerprintMap(x: unknown): x is Record<string, string> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  for (const [rel, sha] of Object.entries(x as Record<string, unknown>)) {
    if (!isSafeRelKey(rel)) return false;
    if (typeof sha !== "string" || !FINGERPRINT_SHA_RE.test(sha)) return false;
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
 * Build the committable artifact buffer from a graph + per-file fingerprint map.
 *
 * Steps: validate the graph (write only validated data) → normalize
 * `generated_from_commit` to the commit-independent constant → leak-audit the
 * whole payload (fail closed on any finding) → compress → frame with a
 * self-describing header + integrity SHA-256.
 *
 * @throws SecretLeakError if the leak audit finds a secret (artifact NOT built).
 * @throws ArtifactError   if the graph fails schema validation, is not a lossless
 *                         fixpoint, or the fingerprint map is malformed.
 */
export function packageGraphArtifact(
  graph: KnowledgeGraph,
  fingerprints: Record<string, string>,
  opts: { codec?: Codec } = {},
): PackageResult {
  // Defensive symmetry: a producer must hand a well-formed fingerprint map (the
  // importer rejects a malformed one → fallback; refuse to ship one too).
  if (!validateFingerprintMap(fingerprints)) {
    throw new ArtifactError("fingerprint map is malformed (not a flat {rel: hex-sha} map)");
  }

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
    fingerprints,
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
 * non-JSON payload, a graph that fails schema validation / is not a fixpoint, or
 * a malformed fingerprint map. The CLI catches this and falls back to full
 * extraction — no crash.
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

  // The SOLE structural-validation surface (FIX-T6.1-r5): the bootstrapped graph
  // must pass schema validation AND be a fixpoint. A genuine Guild artifact was
  // packaged from a validation-fixpoint graph, so re-validation is a no-op; if it
  // would mutate/drop here, the artifact came from a non-conforming/tampered
  // producer — reject (→ full-extract fallback) rather than silently bootstrap a
  // repaired graph. There is NO cache to deep-validate: the structural tier is
  // rebuilt locally and never trusted from the artifact.
  const validation = validateGraph(envelope.graph);
  if (!validation.success || !validation.data) {
    throw new ArtifactError(`artifact graph failed schema validation: ${validation.fatal ?? "unknown"}`);
  }
  if (canonicalJson(validation.data) !== canonicalJson(envelope.graph)) {
    throw new ArtifactError("artifact graph is not a validation fixpoint — repaired/dropped on import");
  }
  envelope.graph = validation.data;

  // The fingerprint map is the ONLY other untrusted element — a trivial flat
  // `{rel: hex-sha}` shape check. A defect rejects the artifact → full-extract
  // fallback (it never feeds the graph, so no deeper validation is possible or
  // needed).
  if (!validateFingerprintMap(envelope.fingerprints)) {
    throw new ArtifactError("artifact fingerprint map is malformed (not a flat {rel: hex-sha} map) — rejected");
  }
  return { envelope, header };
}

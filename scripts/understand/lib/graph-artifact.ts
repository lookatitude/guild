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
import { validateGraph } from "./schema";
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
 * Rejects `../` escapes and symlink escapes (both base and any existing target
 * are realpath-ed). Returns the realpath-resolved absolute candidate path.
 */
export function assertContainedPath(candidate: string, baseDir: string): string {
  const base = fs.realpathSync(baseDir);
  const resolved = path.resolve(base, candidate);
  const within = (child: string): boolean => {
    const rel = path.relative(base, child);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  if (!within(resolved)) {
    throw new ArtifactError(`path escapes ${base}: ${candidate}`);
  }
  // If the target already exists, follow symlinks and re-check containment.
  if (fs.existsSync(resolved)) {
    const real = fs.realpathSync(resolved);
    if (real !== resolved && !within(real)) {
      throw new ArtifactError(`path resolves outside ${base} via symlink: ${candidate}`);
    }
  }
  return resolved;
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
  const validation = validateGraph(graph);
  if (!validation.success || !validation.data) {
    throw new ArtifactError(`graph failed schema validation: ${validation.fatal ?? "unknown"}`);
  }
  // Determinism: a stale sha carried by an existing graph is normalized away so
  // two identical trees at different commits package byte-identically.
  const normalizedGraph: KnowledgeGraph = {
    ...validation.data,
    generated_from_commit: "structural",
  };

  const envelope: ArtifactEnvelope = {
    schema: ARTIFACT_SCHEMA,
    graph: normalizedGraph,
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
  envelope.graph = validation.data;
  return { envelope, header };
}

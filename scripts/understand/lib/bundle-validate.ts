/**
 * Cache-bundle integrity validator — FIX-T4.1-r5 REDIRECT (single integrity checksum).
 *
 * ── THREAT MODEL (the reason this is integrity, not field-by-field validation) ──
 * The per-file structural cache (`.guild/indexes/*.structural-cache.json`) is a
 * GITIGNORED, project-local runtime artifact — our OWN deterministic extractor
 * output, never committed, exported, or shared. This is ENFORCED, not assumed: an
 * explicit `*.structural-cache.json` deny (globbed at any depth) is appended to the
 * local-only re-deny section of every workspace `.gitignore` (FIX-T4.1-r6), placed
 * AFTER the `!.guild/indexes` re-include so it wins even where the indexes dir is
 * otherwise tracked — a committed-then-tampered cache (the only way the
 * recompute-the-checksum bypass could reach a victim) cannot exist. The
 * ADVERSARIAL shared path is the
 * G6 knowledge-graph artifact, and it ships NO cache: only the graph the extraction
 * write-path already ran `validateGraph` over. So the local cache's trust boundary
 * is PROVENANCE + INTEGRITY — "our own output, for unchanged source content,
 * byte-intact" — NOT adversarial validation of each field against a ground truth.
 *
 * ── Why ONE checksum and not a growing per-field list ──
 * A `FileBundle` carries non-graph RESOLUTION INPUTS that feed cross-file resolution
 * at assemble time but are NOT graph nodes/edges: `isCode`, `importSpecs`,
 * `bases`/`ifaces`, per-callable `callees`, and the `source_ref` line anchors.
 * Validating those "against extraction-derived truth" would mean RE-EXTRACTING the
 * file — which defeats the cache's entire purpose. Earlier rounds (r2–r4) instead
 * hand-enumerated a PARALLEL field list that kept missing fields (a valid-form but
 * wrong line anchor, a flipped `isCode`, an extra `callees` entry, a reordered
 * `importSpecs`) — each of which a per-field shape check accepts yet which diverges
 * from a fresh extraction. This round ENDS the enumeration loop with a single
 * integrity checksum that covers EVERY field at once:
 *
 *   1. On write (`bundlesToCache`): stamp each persisted bundle with
 *      `checksum = SHA-256(canonical-JSON(bundle without its own `checksum` field))`.
 *   2. On reuse: accept the bundle ONLY when all three hold —
 *        (a) the source `contentHash` equals the live file's hash      [reuse caller],
 *        (b) the cache-version stamp matches                           [whole-cache gate],
 *        (c) the recomputed bundle checksum equals the stored one      [here].
 *      ANY mutated field — `isCode`, `callees`, `importSpecs`, `bases`/`ifaces`, a
 *      valid-form wrong anchor, or any graph node/edge field — changes the canonical
 *      JSON, so the checksum diverges → cache invalid → re-extract (incremental ==
 *      full). No per-field enumeration can drift out of date again.
 *   3. `validateGraph` over the bundle's wholesale-emitted graph slice (fileNode +
 *      symbolNodes + `contains`) is kept as DEFENSE-IN-DEPTH so a structurally
 *      invalid graph slice can never be assembled even if integrity somehow held.
 *
 * Provenance (version + contentHash) + integrity (checksum) ⟹ the bundle is OUR
 * deterministic output for this exact source at this exact extractor/config version
 * — i.e. byte-identical to what a fresh extraction would emit, which is the only
 * property `--incremental == full` needs. This is deliberately NOT a defense against
 * an adversary who fully controls the cache file AND recomputes the checksum: that
 * is out of scope precisely because the cache is local-only and the shared G6
 * artifact carries no cache. It IS a complete defense against the real failure modes
 * — staleness, version drift, partial writes, disk corruption, and accidental mutation.
 */
import { createHash } from "crypto";
import { validateGraph } from "./schema";
import type { FileBundle } from "./structural";

/**
 * A persisted cache bundle additionally carries an integrity `checksum` the
 * in-memory `FileBundle` (fresh from `makeBundle`) does not — it is stamped on at
 * serialization time (`bundlesToCache`) and verified on reuse.
 */
export type CachedBundle = FileBundle & { checksum: string };

/**
 * Recursively key-sorted clone → a canonical JSON string independent of property
 * INSERTION order, so the checksum is a pure function of bundle CONTENT (a bundle
 * read back from disk JSON, or re-stamped after reuse, hashes identically).
 */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const r = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r).sort()) out[k] = canonicalize(r[k]);
    return out;
  }
  return v;
}

/**
 * SHA-256 over the canonical JSON of the bundle EXCLUDING its own `checksum` field.
 * Excluding the field lets the checksum live ON the persisted bundle yet verify the
 * rest of it. Deterministic: a pure function of the bundle's content, so two runs —
 * and a reused bundle re-stamped by a later `bundlesToCache` — produce the same hex.
 */
export function bundleChecksum(b: FileBundle | CachedBundle): string {
  const rest: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(b as unknown as Record<string, unknown>)) {
    if (k === "checksum") continue;
    rest[k] = val;
  }
  return createHash("sha256").update(JSON.stringify(canonicalize(rest))).digest("hex");
}

/**
 * Validate ONE cached `FileBundle` keyed to `rel` for reuse. Returns `true` only
 * when the bundle is byte-intact OUR output for `rel`:
 *
 *   1. INTEGRITY — it carries a `checksum` string that EQUALS a recompute over the
 *      rest of the bundle. Any mutated field (graph or non-graph) breaks this, so a
 *      single check covers `isCode`, `importSpecs`, `bases`/`ifaces`, `callees`,
 *      source-ref anchors, and every node/edge field at once.
 *   2. DEFENSE-IN-DEPTH — the wholesale-emitted graph slice (fileNode + symbolNodes
 *      + `contains`) still passes the SAME authoritative validator the extraction
 *      write-path runs (`validateGraph`), so a structurally invalid slice can never
 *      assemble. A fresh extraction's slice passes with ZERO issues; any drop /
 *      auto-correct / fatal rejects the bundle.
 *
 * The source `contentHash` match (live file unchanged) and the cache-version match
 * (same extractor/config/shape) are enforced by the reuse caller and the whole-cache
 * version gate respectively — together with the checksum they prove the bundle is
 * byte-identical to what a fresh extraction of the current file would emit.
 */
export function isValidBundle(rel: string, b: unknown): b is FileBundle {
  if (!b || typeof b !== "object" || Array.isArray(b)) return false;
  const r = b as Record<string, unknown>;
  // Entry must be keyed to its own file (guards a swapped-key cache).
  if (r.rel !== rel) return false;

  // ── 1. Integrity: a stored checksum that matches a recompute over the rest. ──
  if (typeof r.checksum !== "string") return false;
  if (bundleChecksum(b as CachedBundle) !== r.checksum) return false;

  // ── 2. Defense-in-depth: the wholesale-emitted graph slice still validates. ──
  // (Integrity already guarantees the slice is exactly what we wrote — which always
  //  validates — so this never rejects an intact bundle; it is a belt-and-braces net
  //  against a graph slice that is somehow valid-checksum yet invalid-shape.)
  if (!r.fileNode || typeof r.fileNode !== "object") return false;
  if (!Array.isArray(r.symbolNodes) || !Array.isArray(r.contains)) return false;
  const probe = {
    project: { name: "structural-cache-probe", description: "" },
    nodes: [r.fileNode, ...(r.symbolNodes as unknown[])],
    edges: r.contains as unknown[],
    layers: [],
    tour: [],
  };
  const result = validateGraph(probe);
  if (!result.success || result.issues.length > 0) return false;
  return true;
}

/**
 * Shared cache-bundle validator — FIX-T4.1-r4 REDIRECT (single source of truth).
 *
 * The incremental refresh (`structural.ts` `isReusableBundle`) reuses a cached
 * `FileBundle` ONLY if it is byte-identical to what a FRESH extraction of the
 * same file would emit — otherwise `--incremental` diverges from a full rebuild.
 * `assembleStructuralGraph()` adds the bundle's `fileNode` + `symbolNodes` and
 * its `contains` edges WHOLESALE, so any shaped-invalid nested element surfaces a
 * dropped / dangling / mis-sourced / mis-resolved node or edge that DIVERGES.
 *
 * Earlier rounds hand-enumerated a PARALLEL field list that kept missing fields
 * (a symbol's `extractor` / complete `sp`, the file-node contract, the exact
 * source-ref form). This round REPLACES that growing list with a delegation to
 * the SINGLE authoritative validator the extraction write-path itself runs —
 * `validateGraph` (lib/schema.ts) — so there is exactly ONE definition of base
 * node/edge validity that the cache must satisfy:
 *
 *   1. Assemble the bundle's wholesale-emitted nodes (`fileNode` + `symbolNodes`)
 *      and edges (`contains`) into a probe graph and run `validateGraph` on it.
 *      A fresh extraction's elements pass with ZERO issues; any auto-correct OR
 *      drop OR fatal means the cached element is NOT in the canonical shape a
 *      fresh extraction emits → reject → re-extract (incremental == full). Run
 *      over THIS bundle's node set, `validateGraph`'s reference check also drops
 *      a `contains` edge whose endpoint is outside the bundle.
 *
 *   2. Layer the checks `validateGraph` CANNOT express on top (it validates the
 *      base `GraphNode`/`GraphEdge` SHAPE, not the structural superset nor which
 *      bundle an id belongs to):
 *        - the structural SUPERSET it ignores — the `extractor` marker (the
 *          structural-subset filter keys on it, so a missing one makes the node /
 *          edge VANISH from the compared subset → diverge) and the complete
 *          25-key `sp` profile (it rides into the graph; missing/partial diverges);
 *        - the EXACT contracts — `fileNode` reconstructed from `rel`; symbol id
 *          `<type>:<rel>:<name>`; provenance `rel#Lx-Ly`; the exact field set so
 *          no extra/missing key rides wholesale and diverges;
 *        - bundle MEMBERSHIP — ids/source_refs belong to THIS `rel`; class/
 *          callable ids resolve to the right node KIND + name; edge endpoints in
 *          this bundle.
 *
 * Keeping this the ONE definition both reuse paths share prevents incremental and
 * full from diverging.
 */
import { validateGraph } from "./schema";
import { detectLanguage } from "./languages";
import { STRUCTURAL_EXTRACTOR, STRUCTURAL_PROFILE_KEYS } from "./structural";
import type { FileBundle } from "./structural";

/** Every element of the array is a (possibly empty) string. */
function isStringArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** The structural node types a cached symbol node may carry (file is the fileNode). */
const SYMBOL_NODE_TYPES = new Set(["function", "class"]);

/** The EXACT field set a fresh structural symbol node carries (structural.ts `makeBundle`). */
const SYMBOL_NODE_KEYS = ["id", "type", "name", "source_refs", "confidence", "sp", "extractor"];

/** The EXACT field set a fresh structural `contains` edge carries (structural.ts `edge()`). */
const CONTAINS_EDGE_KEYS = ["source", "target", "type", "direction", "weight", "extractor"];

/** `r`'s OWN enumerable key set is EXACTLY `keys` (no missing key, no extra key). */
function hasExactKeys(r: Record<string, unknown>, keys: string[]): boolean {
  if (Object.keys(r).length !== keys.length) return false;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(r, k)) return false;
  }
  return true;
}

/**
 * A complete 25-feature structural profile: an object carrying EXACTLY the
 * `STRUCTURAL_PROFILE_KEYS`, each a finite number — what `computeProfile` emits.
 * `validateGraph` never inspects `sp` (it is not a base GraphNode field), yet the
 * `sp` rides into the graph wholesale, so a missing/partial profile diverges from
 * a full rebuild and must be rejected here.
 */
function isCompleteProfile(sp: unknown): boolean {
  if (!sp || typeof sp !== "object" || Array.isArray(sp)) return false;
  const r = sp as Record<string, unknown>;
  if (Object.keys(r).length !== STRUCTURAL_PROFILE_KEYS.length) return false;
  for (const k of STRUCTURAL_PROFILE_KEYS) {
    const v = r[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
  }
  return true;
}

/**
 * A cached `fileNode` must deep-equal the node `makeBundle` emits for `rel`.
 * EVERY field of that node is a pure function of `rel` (id, type, name,
 * source_refs, confidence, language, extractor), so the FULL contract is pinned
 * by reconstructing the expected node once and comparing — no per-field
 * enumeration to drift, and the exact field set rejects any extra/missing key
 * that would ride wholesale into the graph and diverge.
 */
function isValidFileNode(n: unknown, rel: string): boolean {
  if (!n || typeof n !== "object" || Array.isArray(n)) return false;
  const r = n as Record<string, unknown>;
  const expected: Record<string, unknown> = {
    id: `file:${rel}`,
    type: "file",
    name: rel.split("/").pop() ?? rel,
    source_refs: [rel],
    confidence: "high",
    language: detectLanguage(rel),
    extractor: STRUCTURAL_EXTRACTOR,
  };
  if (!hasExactKeys(r, Object.keys(expected))) return false;
  for (const k of Object.keys(expected)) {
    if (JSON.stringify(r[k]) !== JSON.stringify(expected[k])) return false;
  }
  return true;
}

/**
 * A cached `symbolNodes` element. The base `GraphNode` shape (id/type/name/
 * source_refs/confidence) is validated by `validateGraph` over the probe; here we
 * pin the structural SUPERSET + bundle membership it cannot see:
 *  - EXACT field set so no extra/missing key rides wholesale and diverges,
 *  - type ∈ {function, class}; confidence "high" (what a fresh extraction emits;
 *    a valid-but-different value passes `validateGraph` yet diverges),
 *  - id namespaced `<type>:<rel>:<name>` — pins the type prefix, the OWNING file,
 *    and name-consistency in one identity,
 *  - source_refs is a single `rel#Lx-Ly` line-anchor — a bare `rel`, a `rel#bogus`
 *    fragment, or a FOREIGN file path is rejected (the provenance form a
 *    structural symbol always carries),
 *  - the `extractor` marker (the structural-subset filter keys on it; a missing
 *    marker makes the node VANISH from the compared subset → diverge),
 *  - a complete 25-key `sp` profile (rides into the graph; missing/partial diverges).
 */
function isValidSymbolNode(n: unknown, rel: string): boolean {
  if (!n || typeof n !== "object" || Array.isArray(n)) return false;
  const r = n as Record<string, unknown>;
  if (!hasExactKeys(r, SYMBOL_NODE_KEYS)) return false;
  if (typeof r.type !== "string" || !SYMBOL_NODE_TYPES.has(r.type)) return false;
  if (typeof r.name !== "string" || r.name === "") return false;
  if (r.confidence !== "high") return false;
  if (r.extractor !== STRUCTURAL_EXTRACTOR) return false;
  // id is namespaced `<type>:<rel>:<name>` — pins type prefix + owning file + name.
  if (r.id !== `${r.type}:${rel}:${r.name}`) return false;
  // source_refs: EXACTLY one `rel#Lx-Ly` line-anchor (path == this bundle's file).
  if (!Array.isArray(r.source_refs) || r.source_refs.length !== 1) return false;
  const ref = r.source_refs[0];
  if (typeof ref !== "string") return false;
  const hashIdx = ref.indexOf("#");
  if (hashIdx === -1 || ref.slice(0, hashIdx) !== rel) return false;
  if (!/^L\d+-L\d+$/.test(ref.slice(hashIdx + 1))) return false;
  if (!isCompleteProfile(r.sp)) return false;
  return true;
}

/**
 * A cached `contains` edge. The base `GraphEdge` shape (source/target/type/
 * direction/weight) AND endpoint-resolves-to-a-node are validated by
 * `validateGraph` over the probe (run on THIS bundle's nodes, so a phantom
 * endpoint is dropped → reject). Here we pin the structural superset it ignores:
 *  - EXACT field set so no extra/missing key rides wholesale and diverges,
 *  - type === "contains" (a mis-typed edge would re-route resolution → diverge),
 *  - the `extractor` marker (the structural-subset edge filter keys on it; a
 *    missing marker makes the edge VANISH from the compared subset → diverge),
 *  - both endpoints are nodes THIS bundle emits (kept explicit for the
 *    cross-consistency net, in addition to `validateGraph`'s reference check).
 */
function isValidContainsEdge(e: unknown, nodeIds: Set<string>): boolean {
  if (!e || typeof e !== "object" || Array.isArray(e)) return false;
  const r = e as Record<string, unknown>;
  if (!hasExactKeys(r, CONTAINS_EDGE_KEYS)) return false;
  if (r.type !== "contains") return false;
  if (r.extractor !== STRUCTURAL_EXTRACTOR) return false;
  if (typeof r.source !== "string" || typeof r.target !== "string") return false;
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
 * `simpleName`) and the `callees` name array Pass 2c iterates with `for…of` — a
 * null element throws on `register(…, c.simpleName, c.id)`, a non-array
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
 * Validate ONE cached `FileBundle` keyed to `rel` — the comprehensive,
 * cross-consistent check the reuse path shares. Returns `true` only when the
 * bundle's full node/edge validity (per the authoritative `validateGraph`) AND
 * its structural superset AND its internal cross-references all hold, so reusing
 * it yields output byte-identical to a fresh extraction of the same file.
 *
 * Step 1 delegates base node/edge SHAPE to `validateGraph` (one source of truth).
 * Step 2 layers the structural superset + bundle membership it cannot express:
 *  - `fileNode` deep-equals the contract `makeBundle` emits for `rel`.
 *  - every `symbolNodes` element carries the full structural shape (extractor +
 *    complete `sp`), is OWNED by `rel` (id `<type>:<rel>:<name>`, provenance
 *    `rel#Lx-Ly`), and has no extra/missing field.
 *  - every `contains` edge carries the extractor marker and BOTH endpoints are
 *    nodes THIS bundle emits (fileNode + symbolNodes) — no dangling/phantom/
 *    cross-bundle endpoint.
 *  - every `classes` id resolves to a real CLASS symbol node in this bundle whose
 *    name == `simpleName` (Pass 2b emits inherits/implements with it as SOURCE).
 *  - every `callables` id resolves to a real FUNCTION symbol node in this bundle
 *    whose name's last dotted segment == `simpleName` (Pass 2c emits calls edges
 *    with it as SOURCE).
 *
 * `contentHash` is accepted as "" (an unreadable file) OR a 64-char SHA-256 hex;
 * a reuse caller additionally requires it to match the live file before reuse.
 */
export function isValidBundle(rel: string, b: unknown): b is FileBundle {
  if (!b || typeof b !== "object" || Array.isArray(b)) return false;
  const r = b as Record<string, unknown>;
  // ── Envelope: NOT graph nodes — validateGraph cannot see these. ──
  if (r.rel !== rel) return false; // entry must be keyed to its own file
  if (r.language !== detectLanguage(rel)) return false; // language is a pure fn of rel
  if (typeof r.isCode !== "boolean") return false;
  // content hash: "" (unreadable file) OR a 64-char SHA-256 hex — anything else
  // is a malformed fingerprint that must not become an incremental key.
  if (typeof r.contentHash !== "string") return false;
  if (r.contentHash !== "" && !/^[0-9a-f]{64}$/.test(r.contentHash)) return false;
  if (
    !Array.isArray(r.symbolNodes) ||
    !Array.isArray(r.contains) ||
    !Array.isArray(r.importSpecs) ||
    !Array.isArray(r.classes) ||
    !Array.isArray(r.callables)
  ) {
    return false;
  }

  // ── Step 1: authoritative base shape via the SAME validator the write-path runs.
  // Assemble the wholesale-emitted nodes/edges into a probe graph and validate.
  // A fresh extraction passes with ZERO issues; ANY auto-correct / drop / fatal
  // means the cached element diverges from a fresh extraction → reject. The
  // reference check (run over only THIS bundle's nodes) drops a `contains` edge
  // whose endpoint is outside the bundle.
  const probe = {
    project: { name: "structural-cache-probe", description: "" },
    nodes: [r.fileNode, ...(r.symbolNodes as unknown[])],
    edges: r.contains as unknown[],
    layers: [],
    tour: [],
  };
  const result = validateGraph(probe);
  if (!result.success || result.issues.length > 0) return false;

  // ── Step 2: structural superset + bundle membership validateGraph cannot express.
  if (!isValidFileNode(r.fileNode, rel)) return false;

  // symbolNodes: structural shape + anchored to THIS `rel`; INDEX by id so the
  // classes/callables cross-checks below resolve the ACTUAL symbol node (its kind
  // + name), not merely "some id is present".
  const symbolById = new Map<string, Record<string, unknown>>();
  for (const n of r.symbolNodes as unknown[]) {
    if (!isValidSymbolNode(n, rel)) return false;
    symbolById.set((n as Record<string, unknown>).id as string, n as Record<string, unknown>);
  }

  // contains edges: extractor marker + endpoints within this bundle's nodes
  // (fileNode + symbolNodes) — a phantom/cross-bundle endpoint would emit a
  // dangling or cross-file edge a full rebuild never produces.
  const bundleNodeIds = new Set<string>(symbolById.keys());
  bundleNodeIds.add(`file:${rel}`);
  if (!(r.contains as unknown[]).every((e) => isValidContainsEdge(e, bundleNodeIds))) return false;

  if (!(r.importSpecs as unknown[]).every((s) => typeof s === "string")) return false;

  // classes: full shape AND the `id` MUST resolve to a real CLASS symbol node in
  // THIS bundle whose NAME matches the entry's `simpleName`. Pass 2b emits
  // inherits/implements edges with `c.id` as the SOURCE; an id that resolves to a
  // FUNCTION node, or whose name disagrees, would register a mis-named symbol and
  // emit a phantom-source / mis-resolved edge that diverges from a full rebuild.
  // (A class symbol node's `name` IS its simpleName, so node.name === c.simpleName.)
  for (const c of r.classes as unknown[]) {
    if (!isValidClassEntry(c)) return false;
    const rc = c as Record<string, unknown>;
    const node = symbolById.get(rc.id as string);
    if (!node || node.type !== "class" || node.name !== rc.simpleName) return false;
  }
  // callables: full shape AND the `id` MUST resolve to a real FUNCTION symbol node
  // in THIS bundle whose name's LAST dotted segment matches the entry's
  // `simpleName` (top-level fn: node name == simpleName; method `Cls.method`: node
  // name suffix == method). Pass 2c emits calls edges with `c.id` as the SOURCE;
  // an id that resolves to a class node — or a mismatched name — would emit a
  // phantom-source / mis-registered edge diverging from a full rebuild.
  for (const c of r.callables as unknown[]) {
    if (!isValidCallableEntry(c)) return false;
    const rc = c as Record<string, unknown>;
    const node = symbolById.get(rc.id as string);
    if (!node || node.type !== "function") return false;
    if (rc.simpleName !== (node.name as string).split(".").pop()) return false;
  }
  return true;
}

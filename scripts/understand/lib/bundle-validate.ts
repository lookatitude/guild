/**
 * Shared comprehensive validator for a cached structural `FileBundle`
 * (FIX-T4.1-r3, single source of truth).
 *
 * Two paths reuse a cached bundle and emit its nodes/edges WHOLESALE into the
 * graph without re-deriving them:
 *   - the incremental refresh (`structural.ts` `isReusableBundle` → reuse),
 *   - the artifact bootstrap (`graph-artifact.ts` `validateStructuralCache`).
 *
 * A bundle whose `contentHash` happens to match the file on disk but whose
 * NESTED data is shaped-invalid (a phantom symbol id, a `contains` endpoint
 * outside the bundle, a `source_ref` naming a foreign file, a class id that
 * resolves to a function node, …) would otherwise pass a shallow "is it an
 * array?" guard and let `assembleStructuralGraph()` surface dropped, dangling,
 * mis-sourced, or mis-resolved data that DIVERGES from a full rebuild.
 *
 * `isValidBundle` validates the FULL `GraphNode`/`GraphEdge` schema for every
 * element AND the bundle's cross-consistency (id↔kind, id↔name, id↔owning-file,
 * source_ref↔file, edge topology). Any violation → reject → the caller
 * re-extracts the file, so incremental == full. This is the ONE definition both
 * paths must agree on; keeping it here prevents the two from diverging.
 */
import { CONFIDENCE, DIRECTIONS } from "./schema";
import type { FileBundle } from "./structural";

/** Every element of the array is a (possibly empty) string. */
function isStringArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** The structural node types a cached symbol node may carry (file is the fileNode). */
const SYMBOL_NODE_TYPES = new Set(["function", "class"]);

/**
 * The FULL `GraphNode` shape the schema requires AND a fresh structural
 * extraction emits. `assembleStructuralGraph()` adds the cached `fileNode` and
 * every `symbolNodes` element WHOLESALE into the graph, so a cached node missing
 * a schema-required field (or carrying a bogus type / empty provenance) would
 * surface a node that `validateGraph` later repairs or drops — diverging the
 * incremental bundle from a full rebuild. Validate every required field so any
 * deviation rejects the bundle → re-extract.
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
 * AND anchored to THIS bundle's `rel`. A structural symbol id is
 * `<type>:<rel>:<name>` and the node `name` IS that id suffix (structural.ts
 * `symbolNodeName`: function name = the suffix after `function:<rel>:`, class
 * name = simpleName == the suffix), so the single id-identity below pins the
 * type prefix, the OWNING FILE, and name-consistency in one check. Every
 * `source_ref` path (the part before `#Lx-Ly`) is also required to be this
 * bundle's file, so a symbol that names a FOREIGN file can never ride in on a
 * bundle keyed to `rel` (it would surface a node/edge that a full rebuild emits
 * from a different bundle).
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
 * A cached `contains` edge: the FULL `GraphEdge` shape the schema requires.
 * `assembleStructuralGraph()` adds each cached `contains` edge WHOLESALE (Pass 1
 * `for (e of b.contains) addEdge(e)`), so a malformed edge (bad
 * `type`/`direction`/`weight`, or an endpoint that is not a node in THIS bundle)
 * would surface an invalid or dangling-reference edge in the graph. `nodeIds` is
 * the set of this bundle's node ids (fileNode + symbolNodes) — both endpoints
 * must reference one (bundle cross-consistency).
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
 * cross-consistent check both reuse paths share. Returns `true` only when the
 * bundle's full node/edge schema AND its internal cross-references all hold, so
 * reusing it yields output byte-identical to a fresh extraction of the same file.
 *
 * Cross-consistency enforced (each defends an `assembleStructuralGraph()` step):
 *  - `fileNode` is a valid `file` node whose id is `file:<rel>` (Pass 1 adds it).
 *  - every `symbolNodes` element is a valid `function`/`class` node OWNED by
 *    `rel` (id `<type>:<rel>:<name>`, every `source_ref` path == `rel`).
 *  - every `contains` edge is a valid edge whose BOTH endpoints are nodes THIS
 *    bundle emits (fileNode + symbolNodes) — no dangling/phantom endpoint.
 *  - every `classes` id resolves to a real CLASS symbol node in this bundle whose
 *    name == `simpleName` (Pass 2b emits inherits/implements with it as SOURCE).
 *  - every `callables` id resolves to a real FUNCTION symbol node in this bundle
 *    whose name's last dotted segment == `simpleName` (top-level fn: name ==
 *    simpleName; method `Cls.method`: suffix == method). Pass 2c emits calls
 *    edges with it as SOURCE.
 *
 * `contentHash` is accepted as "" (an unreadable file) OR a 64-char SHA-256 hex;
 * a reuse caller additionally requires it to match the live file before reuse.
 */
export function isValidBundle(rel: string, b: unknown): b is FileBundle {
  if (!b || typeof b !== "object" || Array.isArray(b)) return false;
  const r = b as Record<string, unknown>;
  if (r.rel !== rel) return false; // entry must be keyed to its own file
  if (typeof r.language !== "string") return false;
  if (typeof r.isCode !== "boolean") return false;
  // content hash: "" (unreadable file) OR a 64-char SHA-256 hex — anything else
  // is a malformed fingerprint that must not become an incremental key.
  if (typeof r.contentHash !== "string") return false;
  if (r.contentHash !== "" && !/^[0-9a-f]{64}$/.test(r.contentHash)) return false;
  // fileNode: full GraphNode shape (it is added wholesale via addNode(b.fileNode)).
  if (!isValidFileNode(r.fileNode, rel)) return false;
  if (
    !Array.isArray(r.symbolNodes) ||
    !Array.isArray(r.contains) ||
    !Array.isArray(r.importSpecs) ||
    !Array.isArray(r.classes) ||
    !Array.isArray(r.callables)
  ) {
    return false;
  }
  // symbolNodes: full GraphNode shape, anchored to THIS bundle's `rel`; INDEX by
  // id so the classes/callables cross-checks below resolve the ACTUAL symbol node
  // (its kind + name), not merely "some id is present".
  const symbolById = new Map<string, Record<string, unknown>>();
  for (const n of r.symbolNodes as unknown[]) {
    if (!isValidSymbolNode(n, rel)) return false;
    symbolById.set((n as Record<string, unknown>).id as string, n as Record<string, unknown>);
  }
  // contains edges: full GraphEdge shape + endpoints within this bundle's nodes
  // (fileNode + symbolNodes) — a phantom endpoint would emit a dangling edge.
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

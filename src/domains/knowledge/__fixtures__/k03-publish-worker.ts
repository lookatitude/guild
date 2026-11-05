/**
 * K03 test worker: publishes `count` nodes of one tier, each via the rebase path.
 * Usage: bun k03-publish-worker.ts <indexesDir> <structural|semantic> <worker-id> <count> [exit-at:<step>]
 */
import { basisDigest, type Sha256 } from "../source-basis";
import { publishGeneration, readPublication, type PublicationArtifacts } from "../publication";

const [indexesDir, tier, id, countArg, exitArg] = process.argv.slice(2);
const H = (c: string) => `sha256:${c.repeat(64)}` as Sha256;
const b = {
  commit: null,
  tree: H("1"),
  dirty_blob_manifest: H("2"),
  file_inventory: basisDigest({ tag: "S" }),
  resolver_policy: H("3"),
  scan_policy: H("4"),
  source_worktree_id: "worktree-a",
};
const basis = { basis: b, source_basis_hash: basisDigest(b), inventory: [{ path: "src/a.ts", sha256: basisDigest({ tag: "S", f: "a" }) }] };
type Node = { id: string; tier: string; v: number };
const dec = (x: Buffer | undefined): { nodes: Node[] } => (x ? JSON.parse(x.toString("utf8")) : { nodes: [] });
const view = (t: string) => (a: PublicationArtifacts) => basisDigest(dec(a["knowledge-graph.json"]).nodes.filter((n) => n.tier === t));
const exitAt = exitArg?.startsWith("exit-at:") ? exitArg.slice(8) : null;
const channel = tier === "structural" ? "structural_graph" : "semantic_graph";

for (let k = 0; k < Number(countArg); k++) {
  const base = readPublication(indexesDir);
  const add = (g: { nodes: Node[] }) => JSON.stringify({ nodes: [...g.nodes, { id: `w${id}-${k}`, tier, v: 1 }].sort((x, y) => x.id.localeCompare(y.id)) });
  const r = publishGeneration({
    indexesDir,
    identity: { source_id: "owner-main", durable_owner_source_id: "owner-main", publication_scope_source_id: "owner-main" },
    layers: {
      structural_graph: { artifact: "knowledge-graph.json", digest: view("structural") },
      semantic_graph: { artifact: "knowledge-graph.json", digest: view("semantic") },
    },
    channels: [channel],
    base: base?.pointer ?? null,
    basis,
    observe: () => basis,
    artifacts: { "knowledge-graph.json": add(dec(base?.artifacts["knowledge-graph.json"])) },
    rebase: (cur) => ({ "knowledge-graph.json": add(dec(cur.artifacts["knowledge-graph.json"])) }),
    exports: ["knowledge-graph.json"],
    lockTimeoutMs: 30000,
    fault: (s) => {
      if (s === exitAt) process.exit(97);
    },
  });
  if (r.status !== "published") {
    process.stderr.write(JSON.stringify(r) + "\n");
    process.exit(1);
  }
}

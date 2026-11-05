/**
 * K03 (CW-20) — atomic generation publication. AT35 dual CAS race, AT36 fault
 * injection. Disposable roots only.
 */
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { basisDigest, type Sha256 } from "./source-basis";
import {
  PUBLICATION_FAULT_STEPS,
  publicationDir,
  publishGeneration,
  readPublication,
  reclaimGenerations,
  legacyExportState,
  acquirePublisherLock,
  type BasisRef,
  type PublicationArtifacts,
  type PublishJob,
} from "./publication";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function tmpIndexes(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "k03-pub-"));
  roots.push(r);
  const d = path.join(r, ".guild", "indexes");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const H = (c: string): Sha256 => `sha256:${c.repeat(64)}` as Sha256;

function basis(tag: string, worktree = "worktree-a"): BasisRef {
  const b = {
    commit: null,
    tree: H("1"),
    dirty_blob_manifest: H("2"),
    file_inventory: basisDigest({ tag }),
    resolver_policy: H("3"),
    scan_policy: H("4"),
    source_worktree_id: worktree,
  };
  return { basis: b, source_basis_hash: basisDigest(b), inventory: [{ path: "src/a.ts", sha256: basisDigest({ tag, f: "a" }) }] };
}

/** Graph whose nodes carry a tier; layers are views over the one file. */
type Graph = { nodes: Array<{ id: string; tier: "structural" | "semantic"; v: number }> };
const enc = (g: Graph) => JSON.stringify(g);
const dec = (b: Buffer | undefined): Graph => (b ? (JSON.parse(b.toString("utf8")) as Graph) : { nodes: [] });
const view = (tier: string) => (a: PublicationArtifacts) =>
  basisDigest(dec(a["knowledge-graph.json"]).nodes.filter((n) => n.tier === tier));

const LAYERS = {
  structural_graph: { artifact: "knowledge-graph.json", digest: view("structural") },
  semantic_graph: { artifact: "knowledge-graph.json", digest: view("semantic") },
};

const IDENTITY = { source_id: "owner-main", durable_owner_source_id: "owner-main", publication_scope_source_id: "owner-main" };

/** Replace one tier in a graph (what a stage's merge does). */
function withTier(base: Graph, tier: "structural" | "semantic", nodes: Graph["nodes"]): Graph {
  return { nodes: [...base.nodes.filter((n) => n.tier !== tier), ...nodes].sort((a, b) => a.id.localeCompare(b.id)) };
}

function job(indexesDir: string, over: Partial<PublishJob> & Pick<PublishJob, "channels" | "artifacts">): PublishJob {
  const b = basis("S");
  return {
    indexesDir,
    identity: IDENTITY,
    layers: LAYERS,
    base: readPublication(indexesDir)?.pointer ?? null,
    basis: b,
    observe: () => b,
    exports: ["knowledge-graph.json"],
    now: () => "2026-11-05T00:00:00.000Z",
    ...over,
  };
}

function seed(indexesDir: string): void {
  const g: Graph = { nodes: [{ id: "f1", tier: "structural", v: 1 }, { id: "t1", tier: "semantic", v: 1 }] };
  const r = publishGeneration(job(indexesDir, { channels: ["structural_graph", "semantic_graph"], artifacts: { "knowledge-graph.json": enc(g) } }));
  expect(r.status).toBe("published");
}

describe("AT35 dual CAS race", () => {
  test("stale structural job cannot erase a newer semantic layer; retry rebases its layer inputs", () => {
    const idx = tmpIndexes();
    seed(idx);
    const gen3 = readPublication(idx)!;
    // Structural job starts from gen3 and computes its own structural nodes.
    const structuralNodes: Graph["nodes"] = [{ id: "f1", tier: "structural", v: 2 }, { id: "f2", tier: "structural", v: 1 }];
    const staleGraph = withTier(dec(gen3.artifacts["knowledge-graph.json"]), "structural", structuralNodes);
    // Meanwhile semantic generation 4 publishes on the same source basis.
    const g4 = withTier(dec(gen3.artifacts["knowledge-graph.json"]), "semantic", [{ id: "t1", tier: "semantic", v: 4 }, { id: "t2", tier: "semantic", v: 4 }]);
    expect(publishGeneration(job(idx, { channels: ["semantic_graph"], artifacts: { "knowledge-graph.json": enc(g4) } })).status).toBe("published");
    const gen4 = readPublication(idx)!;

    // Without a rebase the destination CAS refuses.
    const refused = publishGeneration(job(idx, { base: gen3.pointer, channels: ["structural_graph"], artifacts: { "knowledge-graph.json": enc(staleGraph) } }));
    expect(refused.status).toBe("refused");
    expect(refused.status === "refused" && refused.reason).toBe("destination_moved");
    expect(readPublication(idx)!.pointer.generation).toBe(gen4.pointer.generation);

    // With a rebase the structural layer is re-merged onto gen4.
    const rebased = publishGeneration(
      job(idx, {
        base: gen3.pointer,
        channels: ["structural_graph"],
        artifacts: { "knowledge-graph.json": enc(staleGraph) },
        rebase: (cur) => ({ "knowledge-graph.json": enc(withTier(dec(cur.artifacts["knowledge-graph.json"]), "structural", structuralNodes)) }),
      }),
    );
    expect(rebased.status).toBe("published");
    expect(rebased.status === "published" && rebased.rebases).toBe(1);
    const gen5 = readPublication(idx)!;
    const nodes = dec(gen5.artifacts["knowledge-graph.json"]).nodes;
    expect(nodes.filter((n) => n.tier === "semantic").map((n) => `${n.id}@${n.v}`)).toEqual(["t1@4", "t2@4"]);
    expect(nodes.filter((n) => n.tier === "structural").map((n) => `${n.id}@${n.v}`)).toEqual(["f1@2", "f2@1"]);
    expect(gen5.record.previous_generation).toBe(gen4.pointer.generation);
  });

  test("source drift refuses publication even when the destination did not move", () => {
    const idx = tmpIndexes();
    seed(idx);
    const before = readPublication(idx)!.pointer.generation;
    const r = publishGeneration(
      job(idx, { channels: ["structural_graph"], artifacts: { "knowledge-graph.json": enc({ nodes: [] }) }, observe: () => basis("S2") }),
    );
    expect(r.status === "refused" && r.reason).toBe("source_drift");
    expect(readPublication(idx)!.pointer.generation).toBe(before);
  });

  test("a basis from another worktree is refused as unknown, never published current", () => {
    const idx = tmpIndexes();
    seed(idx);
    const r = publishGeneration(
      job(idx, { channels: ["structural_graph"], artifacts: { "knowledge-graph.json": enc({ nodes: [] }) }, observe: () => basis("S", "worktree-b") }),
    );
    expect(r.status === "refused" && r.reason).toBe("source_unknown");
  });

  test("negative control: a source-only CAS publisher passes the stale destination and loses the layer", () => {
    const idx = tmpIndexes();
    seed(idx);
    const gen3 = readPublication(idx)!;
    publishGeneration(job(idx, { channels: ["semantic_graph"], artifacts: { "knowledge-graph.json": enc(withTier(dec(gen3.artifacts["knowledge-graph.json"]), "semantic", [{ id: "t4", tier: "semantic", v: 4 }])) } }));
    // Naive publisher: compares source basis only, writes its gen3-based graph.
    const naive = (graph: Graph, observed: BasisRef, expected: BasisRef): boolean => {
      if (observed.source_basis_hash !== expected.source_basis_hash) return false;
      fs.writeFileSync(path.join(idx, "naive-latest.json"), enc(graph));
      return true;
    };
    const stale = withTier(dec(gen3.artifacts["knowledge-graph.json"]), "structural", [{ id: "f9", tier: "structural", v: 1 }]);
    expect(naive(stale, basis("S"), basis("S"))).toBe(true);
    const lost = !dec(fs.readFileSync(path.join(idx, "naive-latest.json"))).nodes.some((n) => n.id === "t4");
    expect(lost).toBe(true); // the defect AT35 must catch
    // Ours, same inputs: refused.
    const ours = publishGeneration(job(idx, { base: gen3.pointer, channels: ["structural_graph"], artifacts: { "knowledge-graph.json": enc(stale) } }));
    expect(ours.status === "refused" && ours.reason).toBe("destination_moved");
  });

  test("the commit is an exclusive successor claim: a peer that committed under a lost lock forces a rebase", () => {
    const idx = tmpIndexes();
    seed(idx);
    const A = readPublication(idx)!;
    // Peer P commits A→P; then rewind to the moment before P's claim (P's dir exists).
    publishGeneration(job(idx, { channels: ["semantic_graph"], artifacts: { "knowledge-graph.json": enc(withTier(dec(A.artifacts["knowledge-graph.json"]), "semantic", [{ id: "tP", tier: "semantic", v: 1 }])) } }));
    const succ = path.join(publicationDir(idx), "successors", A.pointer.generation.slice(7));
    const pClaim = fs.readFileSync(succ);
    fs.rmSync(succ);
    fs.writeFileSync(path.join(publicationDir(idx), "CURRENT"), JSON.stringify(A.pointer));
    expect(readPublication(idx)!.pointer.generation).toBe(A.pointer.generation);
    const peerLands = (st: string) => {
      if (st === "layers_written" && !fs.existsSync(succ)) fs.writeFileSync(succ, pClaim);
    };
    const structural = (g: Graph) => enc(withTier(g, "structural", [{ id: "fX", tier: "structural", v: 1 }]));
    const refused = publishGeneration(job(idx, { base: A.pointer, channels: ["structural_graph"], artifacts: { "knowledge-graph.json": structural(dec(A.artifacts["knowledge-graph.json"])) }, fault: peerLands }));
    expect(refused.status === "refused" && refused.reason).toBe("destination_moved");
    fs.rmSync(succ);
    fs.writeFileSync(path.join(publicationDir(idx), "CURRENT"), JSON.stringify(A.pointer));
    // The refused attempt left its (unreferenced) generation; drop it so this run stages afresh.
    for (const g of fs.readdirSync(path.join(publicationDir(idx), "generations"))) {
      if (![A.pointer.generation.slice(7), JSON.parse(pClaim.toString()).generation.slice(7)].includes(g)) fs.rmSync(path.join(publicationDir(idx), "generations", g), { recursive: true, force: true });
    }
    const ok = publishGeneration(
      job(idx, {
        base: A.pointer,
        channels: ["structural_graph"],
        artifacts: { "knowledge-graph.json": structural(dec(A.artifacts["knowledge-graph.json"])) },
        rebase: (cur) => ({ "knowledge-graph.json": structural(dec(cur.artifacts["knowledge-graph.json"])) }),
        fault: peerLands,
      }),
    );
    expect(ok.status === "published" && ok.rebases).toBe(1);
    const ids = dec(readPublication(idx)!.artifacts["knowledge-graph.json"]).nodes.map((n) => n.id);
    expect(ids).toContain("tP");
    expect(ids).toContain("fX");
  });

  test("a lagging CURRENT hint is followed through the successor chain", () => {
    const idx = tmpIndexes();
    seed(idx);
    const A = readPublication(idx)!;
    publishGeneration(job(idx, { channels: ["semantic_graph"], artifacts: { "knowledge-graph.json": enc({ nodes: [{ id: "t1", tier: "semantic", v: 9 }] }) } }));
    const B = readPublication(idx)!;
    fs.writeFileSync(path.join(publicationDir(idx), "CURRENT"), JSON.stringify(A.pointer));
    expect(readPublication(idx)!.pointer.generation).toBe(B.pointer.generation);
  });

  test("GC never strands a lagging CURRENT and never deletes a young off-chain generation", () => {
    const idx = tmpIndexes();
    seed(idx);
    for (let v = 2; v <= 8; v++) {
      publishGeneration(job(idx, { channels: ["semantic_graph"], artifacts: { "knowledge-graph.json": enc({ nodes: [{ id: "t1", tier: "semantic", v }] }) } }));
    }
    // A crash after the claim left CURRENT one behind the tip; GC with keep 0 runs next.
    const prev = readPublication(idx)!.record.previous_generation!;
    const lag = readPublication(idx, { generation: prev })!;
    fs.writeFileSync(path.join(publicationDir(idx), "CURRENT"), JSON.stringify(lag.pointer));
    reclaimGenerations(idx, { keep: 0 });
    expect(readPublication(idx)).not.toBeNull();
    // A peer's renamed-but-unclaimed generation (off-chain, young) is kept.
    const gdir = path.join(publicationDir(idx), "generations");
    const fake = "f".repeat(64);
    fs.mkdirSync(path.join(gdir, fake));
    reclaimGenerations(idx, { keep: 0 });
    expect(fs.existsSync(path.join(gdir, fake))).toBe(true);
    reclaimGenerations(idx, { keep: 0, now: Date.now() + 11 * 60_000 });
    expect(fs.existsSync(path.join(gdir, fake))).toBe(false);
  });

  test("a crash inside the successor write never exposes a partial claim", () => {
    const idx = tmpIndexes();
    seed(idx);
    const worker = path.join(__dirname, "__fixtures__", "k03-publish-worker.ts");
    const r = spawnSync("bun", [worker, idx, "structural", "c", "1", "exit-at:successor_tmp"], { encoding: "utf8" });
    expect(r.status === 97 || r.status === 0).toBe(true);
    expect(readPublication(idx)).not.toBeNull();
    for (const n of fs.readdirSync(path.join(publicationDir(idx), "successors"))) {
      if (n.startsWith(".")) continue;
      expect(() => JSON.parse(fs.readFileSync(path.join(publicationDir(idx), "successors", n), "utf8"))).not.toThrow();
    }
  });

  test("a CURRENT moved backward onto a reclaimed generation still resolves to the tip", () => {
    const idx = tmpIndexes();
    seed(idx);
    const A = readPublication(idx)!;
    for (let v = 2; v <= 8; v++) {
      publishGeneration(job(idx, { channels: ["semantic_graph"], artifacts: { "knowledge-graph.json": enc({ nodes: [{ id: "t1", tier: "semantic", v }] }) } }));
    }
    const tip = readPublication(idx)!.pointer.generation;
    expect(fs.existsSync(path.join(publicationDir(idx), "generations", A.pointer.generation.slice(7)))).toBe(false);
    fs.writeFileSync(path.join(publicationDir(idx), "CURRENT"), JSON.stringify(A.pointer)); // a paused GC's stale write
    expect(readPublication(idx)!.pointer.generation).toBe(tip);
  });

  test("a paused publisher's renamed, unclaimed generation is pinned against GC", () => {
    const idx = tmpIndexes();
    seed(idx);
    let survived = false;
    const r = publishGeneration(
      job(idx, {
        channels: ["structural_graph"],
        artifacts: { "knowledge-graph.json": enc({ nodes: [{ id: "f9", tier: "structural", v: 1 }, { id: "t1", tier: "semantic", v: 1 }] }) },
        fault: (st) => {
          if (st !== "generation_renamed") return;
          reclaimGenerations(idx, { keep: 0, now: Date.now() + 60 * 60_000 }); // a lock-free GC, long after
          const gdir = path.join(publicationDir(idx), "generations");
          survived = fs.readdirSync(gdir).filter((n) => !n.startsWith(".")).length >= 2;
        },
      }),
    );
    expect(survived).toBe(true);
    expect(r.status).toBe("published");
    expect(readPublication(idx)).not.toBeNull();
  });

  test("derived and ingested channels keep honest provenance", () => {
    const idx = tmpIndexes();
    seed(idx);
    const b2 = basis("S2");
    // Structural rebuilt for S2; semantic carried from S is stale.
    publishGeneration(job(idx, { channels: ["structural_graph"], artifacts: { "knowledge-graph.json": enc({ nodes: [{ id: "f1", tier: "structural", v: 2 }, { id: "t1", tier: "semantic", v: 1 }] }) }, basis: b2, observe: () => b2 }));
    // A derived semantic transform must not refresh the stale semantic layer.
    publishGeneration(job(idx, { channels: ["semantic_graph"], provenance: { semantic_graph: "derived" }, artifacts: { "knowledge-graph.json": enc({ nodes: [{ id: "f1", tier: "structural", v: 2 }, { id: "t1", tier: "semantic", v: 1 }, { id: "t5", tier: "semantic", v: 1 }] }) }, basis: b2, observe: () => b2 }));
    let ch = Object.fromEntries(readPublication(idx)!.record.channels.map((c) => [c.channel, c.state]));
    expect(ch.semantic_graph).toBe("stale");
    publishGeneration(job(idx, { channels: ["semantic_graph"], provenance: { semantic_graph: "ingested" }, artifacts: { "knowledge-graph.json": enc({ nodes: [{ id: "f1", tier: "structural", v: 2 }, { id: "t7", tier: "semantic", v: 1 }] }) }, basis: b2, observe: () => b2 }));
    ch = Object.fromEntries(readPublication(idx)!.record.channels.map((c) => [c.channel, c.state]));
    expect(ch.semantic_graph).toBe("unknown");
  });

  test("concurrent writer processes: every layer survives, no generation is mixed", () => {
    const idx = tmpIndexes();
    seed(idx);
    const worker = path.join(__dirname, "__fixtures__", "k03-publish-worker.ts");
    const procs = ["structural", "semantic", "structural", "semantic"].map((tier, i) =>
      Bun.spawn(["bun", worker, idx, tier, String(i), "6"], { stdout: "pipe", stderr: "pipe" }),
    );
    const codes = procs.map((p) => p.exited);
    return Promise.all(codes).then(async (exit) => {
      for (const [i, p] of procs.entries()) if (exit[i] !== 0) throw new Error(await new Response(p.stderr).text());
      const pub = readPublication(idx)!;
      const ids = dec(pub.artifacts["knowledge-graph.json"]).nodes.map((n) => n.id);
      for (const i of [0, 1, 2, 3]) for (let k = 0; k < 6; k++) expect(ids).toContain(`w${i}-${k}`);
      // Every retained generation verifies against its manifest.
      for (const g of fs.readdirSync(path.join(publicationDir(idx), "generations"))) {
        if (g.startsWith(".")) continue;
        expect(readPublication(idx, { generation: `sha256:${g}` as Sha256 })).not.toBeNull();
      }
    });
  }, 60000);
});

describe("AT36 publication fault injection", () => {
  for (const step of PUBLICATION_FAULT_STEPS) {
    test(`crash at ${step}: readers see the old or the new complete generation`, () => {
      const idx = tmpIndexes();
      seed(idx);
      const old = readPublication(idx)!;
      const g: Graph = { nodes: [{ id: "f1", tier: "structural", v: 7 }, { id: "t1", tier: "semantic", v: 1 }] };
      const artifacts = { "knowledge-graph.json": enc(g), "knowledge-recall.json": JSON.stringify({ r: 7 }) };
      expect(() =>
        publishGeneration(
          job(idx, {
            channels: ["structural_graph", "recall"],
            artifacts,
            layers: { ...LAYERS, recall: { artifact: "knowledge-recall.json", digest: (a) => basisDigest(a["knowledge-recall.json"]?.toString("utf8") ?? null) } },
            exports: ["knowledge-graph.json", "knowledge-recall.json"],
            fault: (s) => {
              if (s === step) throw new Error(`fault:${s}`);
            },
          }),
        ),
      ).toThrow(`fault:${step}`);
      const now = readPublication(idx)!;
      const isOld = now.pointer.generation === old.pointer.generation;
      if (isOld) {
        expect(now.artifacts["knowledge-graph.json"]!.equals(old.artifacts["knowledge-graph.json"]!)).toBe(true);
      } else {
        expect(dec(now.artifacts["knowledge-graph.json"]).nodes.find((n) => n.id === "f1")!.v).toBe(7);
        expect(now.artifacts["knowledge-recall.json"]!.toString()).toBe(JSON.stringify({ r: 7 }));
      }
      // Pointer moves only at the pointer step; later faults leave the new generation.
      const pointerIdx = PUBLICATION_FAULT_STEPS.indexOf("successor_claimed");
      expect(isOld).toBe(PUBLICATION_FAULT_STEPS.indexOf(step) < pointerIdx);
      // Recovery: the next publish succeeds, the lock was released, legacy export re-synced.
      const next = publishGeneration(job(idx, { channels: ["semantic_graph"], artifacts: { "knowledge-graph.json": now.artifacts["knowledge-graph.json"]! } }));
      expect(next.status).toBe("published");
      const cur = readPublication(idx)!;
      expect(fs.readFileSync(path.join(idx, "knowledge-graph.json")).equals(cur.artifacts["knowledge-graph.json"]!)).toBe(true);
      // No staging dir survives recovery.
      expect(fs.readdirSync(path.join(publicationDir(idx), "generations")).filter((n) => n.startsWith(".")).length).toBe(0);
    });
  }

  test("a real process crash mid-publish leaves the lock reclaimable and the old generation readable", () => {
    const idx = tmpIndexes();
    seed(idx);
    const old = readPublication(idx)!.pointer.generation;
    const worker = path.join(__dirname, "__fixtures__", "k03-publish-worker.ts");
    const r = spawnSync("bun", [worker, idx, "structural", "crash", "1", "exit-at:layers_written"], { encoding: "utf8" });
    expect(r.status).toBe(97);
    expect(fs.existsSync(path.join(publicationDir(idx), "lock"))).toBe(true);
    expect(readPublication(idx)!.pointer.generation).toBe(old);
    const next = publishGeneration(job(idx, { channels: ["semantic_graph"], artifacts: { "knowledge-graph.json": enc({ nodes: [{ id: "t1", tier: "semantic", v: 2 }, { id: "f1", tier: "structural", v: 1 }] }) } }));
    expect(next.status).toBe("published");
  });

  test("a live lock holder is never reclaimed", () => {
    const idx = tmpIndexes();
    const held = acquirePublisherLock(publicationDir(idx), { timeoutMs: 1000 });
    expect(held.ok).toBe(true);
    const second = acquirePublisherLock(publicationDir(idx), { timeoutMs: 150 });
    expect(second.ok).toBe(false);
    if (held.ok) held.release();
    expect(acquirePublisherLock(publicationDir(idx), { timeoutMs: 150 }).ok).toBe(true);
  });

  test("a lock whose owner record is unreadable is never reclaimed by age", () => {
    const idx = tmpIndexes();
    const lock = path.join(publicationDir(idx), "lock");
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "owner.json"), "{");
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(lock, old, old);
    expect(acquirePublisherLock(publicationDir(idx), { timeoutMs: 200 }).ok).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);
  });

  test("reclaim never deletes through a symlinked sidecar dir", () => {
    const idx = tmpIndexes();
    seed(idx);
    const victimDir = fs.mkdtempSync(path.join(os.tmpdir(), "k03-victim-"));
    roots.push(victimDir);
    const old = readPublication(idx)!.pointer.generation.slice(7);
    fs.writeFileSync(path.join(victimDir, `${old}.jsonl`), "keep");
    fs.symlinkSync(victimDir, path.join(publicationDir(idx), "hints"));
    for (let v = 2; v <= 7; v++) {
      publishGeneration(job(idx, { channels: ["semantic_graph"], artifacts: { "knowledge-graph.json": enc({ nodes: [{ id: "t1", tier: "semantic", v }] }) } }));
    }
    expect(fs.existsSync(path.join(publicationDir(idx), "generations", old))).toBe(false);
    expect(fs.readFileSync(path.join(victimDir, `${old}.jsonl`), "utf8")).toBe("keep");
  });

  test("immutable outputs are verified by manifest hashes; a tampered layer is refused", () => {
    const idx = tmpIndexes();
    seed(idx);
    const pub = readPublication(idx)!;
    const gdir = path.join(publicationDir(idx), "generations", pub.pointer.generation.slice(7));
    const f = path.join(gdir, "knowledge-graph.json");
    fs.chmodSync(f, 0o644);
    fs.writeFileSync(f, enc({ nodes: [] }));
    expect(() => readPublication(idx)).toThrow(/hash/);
  });

  test("reclaim removes only unreferenced generations", () => {
    const idx = tmpIndexes();
    seed(idx);
    for (let v = 2; v <= 8; v++) {
      publishGeneration(job(idx, { channels: ["semantic_graph"], artifacts: { "knowledge-graph.json": enc({ nodes: [{ id: "t1", tier: "semantic", v }] }) } }));
    }
    const cur = readPublication(idx)!;
    const gens = () => fs.readdirSync(path.join(publicationDir(idx), "generations")).filter((n) => !n.startsWith("."));
    // Retention keeps current + the previous chain up to `keep`.
    expect(gens().length).toBeLessThanOrEqual(4);
    expect(gens()).toContain(cur.pointer.generation.slice(7));
    // A pin from a live reader protects an old generation.
    const prev = cur.record.previous_generation!;
    const pinDir = path.join(publicationDir(idx), "pins");
    fs.mkdirSync(pinDir, { recursive: true });
    fs.writeFileSync(path.join(pinDir, `${process.pid}-x.json`), JSON.stringify({ pid: process.pid, host: os.hostname(), generation: prev }));
    reclaimGenerations(idx, { keep: 0 });
    expect(gens()).toContain(prev.slice(7));
    expect(gens()).toContain(cur.pointer.generation.slice(7));
    fs.rmSync(pinDir, { recursive: true, force: true });
    reclaimGenerations(idx, { keep: 0 });
    expect(gens()).toEqual([cur.pointer.generation.slice(7)]);
  });

  test("negative control: a legacy writer's direct latest file claiming fresh is rejected", () => {
    const idx = tmpIndexes();
    seed(idx);
    const pub = readPublication(idx)!;
    expect(legacyExportState(idx, "knowledge-graph.json").state).toBe("matches_generation");
    // Legacy writer: writes the latest file directly with a freshness marker.
    fs.writeFileSync(
      path.join(idx, "knowledge-graph.json"),
      JSON.stringify({ nodes: [], source_basis: { basis: basis("S").basis, source_basis_hash: basis("S").source_basis_hash }, state: "current_for_basis" }),
    );
    const st = legacyExportState(idx, "knowledge-graph.json");
    expect(st.state).toBe("unknown");
    expect(st.reason).toMatch(/not the published generation/);
    // Readers still pin the published generation, not the direct file.
    expect(readPublication(idx)!.pointer.generation).toBe(pub.pointer.generation);
    expect(dec(readPublication(idx)!.artifacts["knowledge-graph.json"]).nodes.length).toBe(2);
  });

  test("the publication record is a C13 KnowledgePublication with consistent digests", () => {
    const idx = tmpIndexes();
    seed(idx);
    const { record, pointer } = readPublication(idx)!;
    expect(record.schema_version).toBe("guild.stack.knowledge-publication.v1");
    expect(record.generation).toBe(pointer.generation);
    expect(record.source_basis_hash).toBe(basisDigest(record.basis));
    expect(record.basis_verified_at).toBe("2026-11-05T00:00:00.000Z");
    for (const c of record.channels) {
      expect(c.basis_hash).toBe(record.source_basis_hash);
      expect(c.state).toBe("current_for_basis");
      expect(c.output?.path).toMatch(/^\.guild\/indexes\/publication\/generations\/[a-f0-9]{64}\/knowledge-graph\.json$/);
    }
    expect(record.destination_layer_digest).toBe(
      basisDigest(record.channels.map((c) => [c.channel, c.layer_hash]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
    );
    const keys = Object.keys(record).sort();
    expect(keys).toEqual(
      [
        "basis", "basis_verified_at", "channels", "decision_refs", "destination_layer_digest", "durable_owner_source_id",
        "generation", "manifest", "previous_generation", "publication_scope_source_id", "replan_required", "schema_version",
        "source_basis_hash", "source_id", "source_worktree_id",
      ].sort(),
    );
    expect(record.source_worktree_id).toBe(record.basis.source_worktree_id);
  });

  test("a carried layer built for an older basis is published stale, not current", () => {
    const idx = tmpIndexes();
    seed(idx);
    const b2 = basis("S2");
    const r = publishGeneration(
      job(idx, { channels: ["structural_graph"], artifacts: { "knowledge-graph.json": enc({ nodes: [{ id: "f1", tier: "structural", v: 3 }, { id: "t1", tier: "semantic", v: 1 }] }) }, basis: b2, observe: () => b2 }),
    );
    expect(r.status).toBe("published");
    const ch = Object.fromEntries(readPublication(idx)!.record.channels.map((c) => [c.channel, c]));
    expect(ch.structural_graph.state).toBe("current_for_basis");
    expect(ch.semantic_graph.state).toBe("stale");
    expect(ch.semantic_graph.reason).toMatch(/older source basis/);
  });
});

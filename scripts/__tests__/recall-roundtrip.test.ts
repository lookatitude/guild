/**
 * __tests__/recall-roundtrip.test.ts
 *
 * METRIC 5 (recall_roundtrip): end-to-end round-trip test.
 *
 * Plants:
 *   - ONE real wiki page with a known fact
 *   - ONE knowledge-recall.json projection containing ONE KG node with a
 *     resolvable source_ref
 *
 * Calls recall() ONCE with a query that matches both.
 *
 * Asserts UNCONDITIONALLY (no if-guards — any guard is false-clean):
 *   - source === "combined"
 *   - at least one wiki chunk present (quarantined===false or wrapped)
 *   - at least one KG chunk present (quarantined===false or wrapped)
 *   - the KG chunk's rendered contains the planted source_ref
 *   - both wiki chunk + KG chunk carry source_path
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { recall } from "../lib/recall";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A real fact planted in the wiki. */
const WIKI_FACT = "authentication uses JWT tokens with 24-hour expiry";

/**
 * A real source_ref that will be embedded in the KG node and must appear in
 * the recall output. It is a real string (resolvable in the context of the
 * planted node), not a throwaway token.
 */
const KG_SOURCE_REF = "ADR-007-auth-jwt";

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function mkTmpRepo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-recall-rt-"));
  TEMP_DIRS.push(d);
  return d;
}

function plantWikiPage(repo: string, relPath: string, content: string): void {
  const abs = path.join(repo, ".guild", "wiki", relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

/**
 * Plant a knowledge-recall.json projection with one node that has a resolvable
 * source_ref. Schema: guild.knowledge_links.v2.
 */
function plantKgProjection(
  repo: string,
  node: { id: string; name: string; type: string; confidence: string; source_refs: string[] },
): void {
  const indexesDir = path.join(repo, ".guild", "indexes");
  fs.mkdirSync(indexesDir, { recursive: true });
  const proj = {
    schema_version: "guild.knowledge_links.v2",
    nodes: [
      {
        id: node.id,
        type: node.type,
        name: node.name,
        confidence: node.confidence,
        source_refs: node.source_refs,
      },
    ],
    edges: [],
  };
  fs.writeFileSync(
    path.join(indexesDir, "knowledge-recall.json"),
    JSON.stringify(proj, null, 2),
    "utf8",
  );
}

// ── Round-trip test ───────────────────────────────────────────────────────────

describe("recall — METRIC 5: recall_roundtrip", () => {
  it("plants wiki page + KG node → recall() returns combined with both protected chunks", () => {
    const repo = mkTmpRepo();

    // Plant a wiki page containing the real fact
    plantWikiPage(
      repo,
      "decisions/auth-jwt.md",
      `# Auth JWT decision\n\n${WIKI_FACT}\n\nThis page covers JWT authentication configuration.\n`,
    );

    // Plant a KG projection with a node that has the real source_ref
    plantKgProjection(repo, {
      id: "auth-jwt-node",
      name: "AuthJwtConfig",
      type: "concept",
      confidence: "high",
      source_refs: [KG_SOURCE_REF],
    });

    // Single recall call — query hits both the wiki fact and the KG node name
    const result = recall("authentication JWT tokens AuthJwtConfig", {
      cwd: repo,
      _indexConfig: { enabled: false }, // force file-BM25 (no SQLite index)
    });

    // ── UNCONDITIONAL asserts — no if-guards ───────────────────────────────

    // 1. source must be "combined" (both wiki + KG contributed)
    expect(result.source).toBe("combined");

    // 2. At least one wiki chunk present (source_path does NOT include knowledge-recall.json)
    const wikiChunks = result.chunks.filter(
      (c) => !c.source_path.includes("knowledge-recall.json"),
    );
    expect(wikiChunks.length).toBeGreaterThan(0);

    // 3. At least one KG chunk present (source_path includes knowledge-recall.json)
    const kgChunks = result.chunks.filter((c) =>
      c.source_path.includes("knowledge-recall.json"),
    );
    expect(kgChunks.length).toBeGreaterThan(0);

    // 4. Wiki chunk is protected (quarantined===false = wrapped; never raw)
    for (const chunk of wikiChunks) {
      expect(chunk.quarantined).toBe(false);
      // Wrapped in trust_tier tag OR operator-tier (no tag needed) — never bare
      const isProtected =
        chunk.rendered.includes("<guild:recall trust_tier=") ||
        chunk.trust_tier === "operator";
      expect(isProtected).toBe(true);
    }

    // 5. KG chunk is protected (quarantined===false = wrapped; never raw)
    for (const chunk of kgChunks) {
      expect(chunk.quarantined).toBe(false);
      expect(chunk.rendered).toContain('<guild:recall trust_tier="untrusted">');
    }

    // 6. The KG chunk's rendered CONTAINS the planted source_ref
    const kgChunk = kgChunks[0]!;
    expect(kgChunk.rendered).toContain(KG_SOURCE_REF);

    // 7. Both wiki chunk + KG chunk carry source_path
    expect(wikiChunks[0]!.source_path).toBeTruthy();
    expect(kgChunk.source_path).toBeTruthy();

    // 8. KG chunk source_path points at knowledge-recall.json + node id
    expect(kgChunk.source_path).toContain("knowledge-recall.json#auth-jwt-node");
  });
});

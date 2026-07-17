/**
 * learn/lib/knowledge-links-io.ts — the ONE shared load/append/write helper
 * for `.guild/indexes/knowledge-links.json` (`guild.knowledge_links.v1`).
 *
 * G2b-4 fix: four producers of knowledge-links.json had drifted on the
 * top-level version key — knowledge-links-builder.ts (scripts/) and the
 * emit-learning-checkpoint.ts hook wrote `schema_version`, while
 * learn/lib/domain.ts and knowledge-links-traverse.ts wrote `version`, and
 * traverse's appendBatch silently dropped `schema_version` on rewrite
 * (it only ever wrote its own `version` key). This module is the single
 * source of truth for the on-disk shape:
 *
 *   - ALWAYS WRITES `schema_version` (never `version`).
 *   - READS either `schema_version` (current) or the legacy `version` key
 *     so a knowledge-links.json last written by a pre-fix producer round-trips
 *     without data loss.
 *
 * Consuming producers in this repo (see each file's own doc header for its
 * exact role in the append-only model):
 *   - scripts/knowledge-links-builder.ts   — canonical full rebuild
 *   - learn/lib/domain.ts                  — stage-5 incremental domain edges
 *   - scripts/knowledge-links-traverse.ts  — VC-K2 connectivity + checkpoint
 *     append/tombstone helpers
 *
 * hooks/emit-learning-checkpoint.ts (owned by hook-engineer, outside this
 * module's boundary) already writes `schema_version` directly and is not
 * wired to this helper; a follow-up can migrate it for full consistency.
 *
 * Zero runtime deps beyond Node builtins.
 */

import * as fs from "fs";
import * as path from "path";

export const KNOWLEDGE_LINKS_SCHEMA_VERSION = "guild.knowledge_links.v1" as const;

export interface KnowledgeLink {
  from: string;
  to: string;
  type: string;
  run_id: string;
  /** Tombstone-never-delete (docs/v2/knowledge-memory.md §Invalidation, item 8). */
  tombstoned?: boolean;
  tombstoned_at?: string;
  tombstoned_reason?: string;
}

export interface KnowledgeLinksDoc {
  schema_version: string;
  links: KnowledgeLink[];
}

/**
 * Load knowledge-links.json, standardizing the in-memory shape on
 * `schema_version` while tolerating the legacy `version` key on read (or a
 * missing key entirely). Returns an empty v1 doc if the file is absent,
 * unreadable, or malformed (`links` not an array) — the index is a derived,
 * rebuildable projection (NN#8), so a corrupt file is safe to treat as empty.
 */
export function loadKnowledgeLinksDoc(file: string): KnowledgeLinksDoc {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(parsed["links"])) {
      const schemaVersion =
        typeof parsed["schema_version"] === "string"
          ? (parsed["schema_version"] as string)
          : typeof parsed["version"] === "string"
            ? (parsed["version"] as string)
            : KNOWLEDGE_LINKS_SCHEMA_VERSION;
      return { schema_version: schemaVersion, links: parsed["links"] as KnowledgeLink[] };
    }
  } catch {
    /* absent or corrupt → empty (derived index, safe) */
  }
  return { schema_version: KNOWLEDGE_LINKS_SCHEMA_VERSION, links: [] };
}

/** Write a KnowledgeLinksDoc to disk — ALWAYS as `schema_version` (never `version`). */
export function writeKnowledgeLinksDoc(file: string, doc: KnowledgeLinksDoc): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = {
    schema_version: doc.schema_version || KNOWLEDGE_LINKS_SCHEMA_VERSION,
    links: doc.links,
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n", "utf8");
}

/** Composite dedup key for a knowledge link — from|to|type (run_id excluded by design). */
function linkKey(l: Pick<KnowledgeLink, "from" | "to" | "type">): string {
  return `${l.from}|${l.to}|${l.type}`;
}

export interface AppendBatchResult {
  added: number;
  total: number;
}

/**
 * APPEND-ONLY batch write into knowledge-links.json. Dedupes on
 * `from|to|type` (run_id excluded from the dedup key — the same conceptual
 * edge produced by multiple runs is one edge in the index) so re-runs are
 * idempotent. Always (re)writes `schema_version` — never leaves a legacy
 * `version` key or drops the version key entirely on rewrite.
 */
export function appendKnowledgeLinksBatch(file: string, batch: KnowledgeLink[]): AppendBatchResult {
  const doc = loadKnowledgeLinksDoc(file);
  const existing = new Set(doc.links.map(linkKey));
  let added = 0;
  for (const link of batch) {
    const key = linkKey(link);
    if (!existing.has(key)) {
      existing.add(key);
      doc.links.push(link);
      added++;
    }
  }
  writeKnowledgeLinksDoc(file, { schema_version: KNOWLEDGE_LINKS_SCHEMA_VERSION, links: doc.links });
  return { added, total: doc.links.length };
}

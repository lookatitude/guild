/**
 * refresh-touched.ts — the CHEAP knowledge refresh (KTD50 / R62).
 *
 * After an edit, three things and only three things are rebuilt:
 *
 *   1. the `guild.working_set.v1` card,
 *   2. the BM25 index, INCREMENTALLY, over the wiki plus the touched paths,
 *   3. the TOUCHED SUBSET of the v1 knowledge-links edge layer.
 *
 * What it must not do is the whole point of the function existing, and is enforced
 * by a layout lint (`refresh-touched-scope`) rather than by this comment: a module
 * that mentions `refreshTouched` may not also name the recall projection, the
 * knowledge graph, or the graph validator. The deep semantic tier is EXPLICIT — a
 * user asks for it — because it is minutes of work, and an after-edit hook that
 * quietly triggered it would make every save feel like a build.
 *
 * The line is worth stating precisely because it is easy to blur: this function is
 * allowed to make recall CURRENT. It is not allowed to make recall DEEPER. Adding
 * "just re-run the analyzer for the touched file" is how the cheap path becomes
 * the expensive path one file at a time.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { createGuildStorage, type GuildStorage } from "../state";
import { KNOWLEDGE_LINKS_EDGE_SCHEMA_VERSION } from "./knowledge-links-contract";
import { refreshWikiIndexPaths } from "./wiki-index";
import {
  buildWorkingSetCard,
  computeFingerprint,
  writeWorkingSet,
  type WorkingSet,
} from "./working-set";

export interface RefreshTouchedOptions {
  cwd?: string;
  storage?: GuildStorage;
  /** The phase whose card to refresh. Defaults to the last card written. */
  phase?: string;
  pinned_decision_ids?: readonly string[];
  open_question_ids?: readonly string[];
}

export interface RefreshTouchedResult {
  /** Wiki-relative paths re-indexed. */
  reindexed: string[];
  /** Link ids whose edges were recomputed. */
  relinked: string[];
  card: WorkingSet;
  card_path: string;
}

/** The v1 edge layer this function updates a subset of. */
export function knowledgeLinksPath(storage: GuildStorage): string {
  return storage.cache("indexes", "knowledge-links.json");
}

interface EdgeDoc {
  schema_version?: string;
  links?: Array<{ id?: string; from?: string; to?: string; kind?: string }>;
}

function readEdges(storage: GuildStorage): EdgeDoc {
  const p = knowledgeLinksPath(storage);
  try {
    if (!fs.existsSync(p)) return { schema_version: KNOWLEDGE_LINKS_EDGE_SCHEMA_VERSION, links: [] };
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as EdgeDoc;
    return parsed && Array.isArray(parsed.links)
      ? parsed
      : { schema_version: KNOWLEDGE_LINKS_EDGE_SCHEMA_VERSION, links: [] };
  } catch {
    return { schema_version: KNOWLEDGE_LINKS_EDGE_SCHEMA_VERSION, links: [] };
  }
}

/**
 * Drop the edges that cite a touched path so the next builder run re-derives them.
 *
 * `touched` is a list of CITATION SUFFIXES, not filesystem paths: the edge layer
 * cites `wiki:patterns/a.md` and `file:src/x.ts`, so matching has to be done on the
 * repo-relative and wiki-relative spellings rather than on the absolute path the
 * caller handed in.
 *
 * Dropping rather than re-deriving in place is deliberate. Re-deriving one file's
 * edges needs the analyzer, and the analyzer is exactly the expensive thing this
 * function must not call. Removing the stale edges leaves the layer CORRECT (it
 * never asserts something false) and merely INCOMPLETE until the next explicit
 * build — which is the right trade for a path that runs after every edit.
 */
function pruneTouchedEdges(storage: GuildStorage, touched: readonly string[]): string[] {
  const doc = readEdges(storage);
  const links = doc.links ?? [];
  const suffixes = [...new Set(touched.map((p) => p.replace(/^\.\//, "")).filter((p) => p !== ""))];
  const cites = (v: unknown): boolean =>
    typeof v === "string" && suffixes.some((t) => v === t || v.endsWith(`:${t}`) || v.endsWith(`/${t}`));

  const dropped: string[] = [];
  const kept = links.filter((l) => {
    if (cites(l.from) || cites(l.to)) {
      if (typeof l.id === "string") dropped.push(l.id);
      return false;
    }
    return true;
  });
  if (dropped.length === 0) return [];

  const p = knowledgeLinksPath(storage);
  storage.ensureDir(path.dirname(p));
  fs.writeFileSync(
    p,
    JSON.stringify({ ...doc, schema_version: doc.schema_version ?? KNOWLEDGE_LINKS_EDGE_SCHEMA_VERSION, links: kept }),
    "utf8",
  );
  return dropped;
}

/**
 * Refresh what the given paths invalidated. `paths` are repo-relative; wiki pages
 * are additionally re-indexed for BM25.
 */
export function refreshTouched(
  paths: readonly string[],
  opts: RefreshTouchedOptions = {},
): RefreshTouchedResult {
  const storage = opts.storage ?? createGuildStorage(opts.cwd ?? process.cwd());
  const scope = storage.project ?? storage.workspace;
  const wikiAbs = scope ? scope.knowledge() : null;

  const wikiRel: string[] = [];
  for (const p of paths ?? []) {
    if (typeof p !== "string" || p === "") continue;
    const abs = path.isAbsolute(p) ? p : path.resolve(storage.activeRoot, p);
    if (wikiAbs && abs.startsWith(wikiAbs + path.sep) && abs.endsWith(".md")) {
      wikiRel.push(path.relative(wikiAbs, abs).split(path.sep).join("/"));
    }
  }

  if (wikiRel.length > 0) refreshWikiIndexPaths(wikiRel, { storage });

  // Citation keys: how the edge layer spells these files, not where they live.
  const citationKeys: string[] = [...wikiRel];
  for (const p of paths ?? []) {
    if (typeof p !== "string" || p === "") continue;
    const abs = path.isAbsolute(p) ? p : path.resolve(storage.activeRoot, p);
    citationKeys.push(path.relative(storage.activeRoot, abs).split(path.sep).join("/"));
  }
  const relinked = pruneTouchedEdges(storage, citationKeys);

  const phase = opts.phase ?? "after-edit";
  const card = buildWorkingSetCard({
    phase,
    storage,
    pinned_decision_ids: opts.pinned_decision_ids ?? [],
    open_question_ids: opts.open_question_ids ?? [],
    fingerprint: computeFingerprint({ storage, open_question_ids: opts.open_question_ids ?? [] }),
  });
  const card_path = writeWorkingSet(storage, card);

  return { reindexed: wikiRel, relinked, card, card_path };
}

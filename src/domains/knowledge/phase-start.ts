/**
 * phase-start.ts — phase start is recall (KTD50 / KTD26 / KTD67 / R29 / R57 / R77).
 *
 * The recall CLI's `--phase` leg. One call, three reads, no scan:
 *
 *   1. the `guild.working_set.v1` card, served from cache when its fingerprint
 *      matches and rebuilt (the card only) when it does not;
 *   2. BM25 over the wiki index, through the `recall.backend` policy — `hybrid`
 *      reranks in cache and fails open to BM25 when no embedding model exists;
 *   3. `guild.lane_bundle.v1`: the card, the hits as citations, and the glossary
 *      terms the assignment text actually names (capped).
 *
 * The lane bundle is the only object here a parent may see (KTD26). Its hit gists
 * and glossary terms are wiki text, so they pass the same D-RECALL choke point as
 * recall (`protectChunks`): an injection hit is quarantined to a marker, anything
 * else is wrapped by trust tier with recall tags neutralized. Never raw.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { createGuildStorage, type GuildStorage } from "../state";
import { resolveGlossary, type Glossary } from "./glossary";
import { neutralizeRecallTags, protectChunks, type ProtectChunksOpts } from "./recall-protect";
import { buildLaneBundle, type LaneBundle } from "./lane-bundle";
import { searchWiki, type RecallBackend, type SearchResult } from "./wiki-index";
import { loadWorkingSet } from "./working-set";

export interface PhaseStartOptions {
  cwd: string;
  phase: string;
  /** The TaskCell / lane id the bundle is for. */
  cell_id: string;
  storage?: GuildStorage;
  pinned_decision_ids?: readonly string[];
  open_question_ids?: readonly string[];
  /** Where a quarantine security event lands. No event when absent. */
  runId?: string;
  runDir?: string;
}

export interface PhaseStartResult {
  /** True when the working-set card was served from cache. */
  working_set_fresh: boolean;
  working_set_path: string;
  recall_backend: RecallBackend;
  degraded_reason?: string;
  lane_bundle: LaneBundle;
}

interface RecallPolicy {
  backend: RecallBackend;
  min_score?: number;
  max_hits?: number;
}

/** `recall.backend` + `recall.thresholds.*` from the resolved policy. BM25 on any failure. */
export function resolveRecallPolicy(cwd: string): RecallPolicy {
  try {
    // Lazy require: the pure knowledge path never loads the config resolver.
    const { resolvePolicy, policyValue } = require("../config") as typeof import("../config");
    const resolved = resolvePolicy({ cwd });
    const backend = policyValue(resolved, "recall.backend") === "hybrid" ? "hybrid" : "bm25";
    const min = policyValue(resolved, "recall.thresholds.min_score");
    const max = policyValue(resolved, "recall.thresholds.max_hits");
    return {
      backend,
      ...(typeof min === "number" ? { min_score: min } : {}),
      ...(typeof max === "number" ? { max_hits: max } : {}),
    };
  } catch {
    return { backend: "bm25" };
  }
}

/** One line of wiki text through the D-RECALL pipeline: marker, raw operator line, or wrapped. */
function protectLine(line: string, probe: { source_path: string; content: string }, opts: ProtectChunksOpts): string {
  const [chunk] = protectChunks([probe], opts).chunks;
  if (!chunk || chunk.quarantined) return chunk?.rendered ?? "[QUARANTINED]";
  const safe = neutralizeRecallTags(line);
  return chunk.trust_tier === "operator" ? safe : `<guild:recall trust_tier="${chunk.trust_tier}">${safe}</guild:recall>`;
}

/** The page body a hit cites, for the probe. Empty when unreadable or outside the wiki. */
function pageText(storage: GuildStorage, rel: string): string {
  const root = (storage.project ?? storage.workspace)?.knowledge();
  if (!root) return "";
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs);
  if (back.startsWith("..") || path.isAbsolute(back)) return "";
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

/** The glossary with every term probed and wrapped; an injected term keeps only a marker. */
function protectGlossary(glossary: Glossary, opts: ProtectChunksOpts): Glossary {
  return {
    ...glossary,
    terms: glossary.terms.map((t) => {
      const content = [t.term, ...(t.aliases ?? []), t.definition].join("\n");
      return {
        ...t,
        term: neutralizeRecallTags(t.term),
        definition: protectLine(t.definition, { source_path: "glossary.md", content }, opts),
      };
    }),
  };
}

export function phaseStartRecall(query: string, opts: PhaseStartOptions): PhaseStartResult {
  const storage = opts.storage ?? createGuildStorage(opts.cwd);
  const ws = loadWorkingSet({
    phase: opts.phase,
    storage,
    pinned_decision_ids: opts.pinned_decision_ids ?? [],
    open_question_ids: opts.open_question_ids ?? [],
  });

  const policy = resolveRecallPolicy(opts.cwd);
  // No embedding reranker ships in this cut, so `hybrid` is served as BM25 with
  // the loss recorded — never an error, never a silent pretend-hybrid.
  const search: SearchResult = searchWiki(query, {
    storage,
    backend: policy.backend,
    ...(policy.min_score !== undefined ? { min_score: policy.min_score } : {}),
    ...(policy.max_hits !== undefined ? { max_hits: policy.max_hits } : {}),
  });

  const protect: ProtectChunksOpts = {
    callerTool: "phaseStartRecall",
    ...(opts.runId
      ? { runId: opts.runId, runDir: opts.runDir ?? (storage.project ?? storage.workspace)?.runRecord(opts.runId) }
      : {}),
  };
  const lane_bundle = buildLaneBundle({
    cell_id: opts.cell_id,
    working_set: ws.card,
    // The title comes from the cache index, so it is probed with the page it names.
    hits: search.hits.map((h) => ({
      path: `wiki:${h.rel}`,
      gist: protectLine(h.title, { source_path: h.rel, content: `${h.title}\n${pageText(storage, h.rel)}` }, protect),
      score: h.score,
    })),
    assignment_text: query,
    glossary: protectGlossary(resolveGlossary({ storage }), protect),
  });

  return {
    working_set_fresh: ws.fresh,
    working_set_path: ws.path,
    recall_backend: search.backend,
    ...(search.degraded_reason ? { degraded_reason: search.degraded_reason } : {}),
    lane_bundle,
  };
}

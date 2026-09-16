/**
 * working-set.ts — `guild.working_set.v1` (R29 / KTD50).
 *
 * Phase start is RECALL, not a scan. The working-set card is the cheap thing a
 * phase reads first: which phase we are in, which decision ids are pinned, which
 * questions are open, and a FINGERPRINT that says whether any of that can have
 * changed. When the fingerprint matches the cached card, phase start is a file
 * read and nothing else — specifically it does NOT spawn a brownfield learn and
 * does NOT rewrite `knowledge-recall.json` (R29's fixture).
 *
 * Why a fingerprint rather than an mtime on the card: the card is a DERIVATION of
 * three inputs (the wiki, the commit, the open questions). An mtime on the output
 * tells you when it was written, not whether it is still true. The three-field
 * fingerprint is cheap — a directory stat, a git head read, a hash of ids — and it
 * answers the question that actually matters.
 *
 * Storage class is CACHE (KTD15). This is not durable wiki and it is not a
 * personal memory: deleting it costs one rebuild and nothing else. It may PIN
 * decision ids, never decision rationale — the rationale lives on the wiki page
 * and is recalled when an agent needs history (KTD32). A card that inlined the
 * reasoning would be a context file with a changelog in it.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { createGuildStorage, type GuildStorage } from "../../state";

export const WORKING_SET_SCHEMA = "guild.working_set.v1" as const;

/** Hard cap from KTD26/R42. The card is ≤400 of the lane bundle's 1200. */
export const WORKING_SET_TOKEN_CAP = 400;

export interface WorkingSetFingerprint {
  /** Newest mtime across the wiki tree, ms since epoch. 0 when there is no wiki. */
  wiki_mtime: number;
  /** The resolved commit, or "" when the root is not a git work tree. */
  git_head: string;
  /** sha256 of the sorted open-question ids. */
  open_questions_hash: string;
}

export interface WorkingSet {
  schema_version: typeof WORKING_SET_SCHEMA;
  fingerprint: WorkingSetFingerprint;
  phase: string;
  pinned_decision_ids: string[];
  open_question_ids: string[];
  learn_stamp?: string;
  card_tokens: number;
}

/** The shared 4-chars-per-token estimate every Guild cap is measured with. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      try {
        const m = fs.statSync(p).mtimeMs;
        if (m > newest) newest = m;
      } catch {
        // A file that vanished between readdir and stat contributes nothing.
      }
    }
  };
  walk(dir);
  return Math.floor(newest);
}

function readGitHead(root: string): string {
  try {
    const headFile = path.join(root, ".git", "HEAD");
    const head = fs.readFileSync(headFile, "utf8").trim();
    if (!head.startsWith("ref:")) return head;
    const ref = head.slice(4).trim();
    const refFile = path.join(root, ".git", ref);
    if (fs.existsSync(refFile)) return fs.readFileSync(refFile, "utf8").trim();
    // Packed refs: a resolved head is nice-to-have, and the ref NAME is still a
    // stable-enough fingerprint component for "did the checkout move".
    return ref;
  } catch {
    return "";
  }
}

export function hashOpenQuestions(ids: readonly string[]): string {
  const sorted = [...ids].filter((s) => typeof s === "string").sort();
  return crypto.createHash("sha256").update(sorted.join("\n"), "utf8").digest("hex").slice(0, 32);
}

export interface FingerprintOptions {
  cwd?: string;
  storage?: GuildStorage;
  open_question_ids?: readonly string[];
}

function storageFor(opts: { cwd?: string; storage?: GuildStorage }): GuildStorage {
  return opts.storage ?? createGuildStorage(opts.cwd ?? process.cwd());
}

/** The wiki tree of the active root, or null when this root owns no knowledge. */
function wikiDir(storage: GuildStorage): string | null {
  const scope = storage.project ?? storage.workspace;
  return scope ? scope.knowledge() : null;
}

export function computeFingerprint(opts: FingerprintOptions = {}): WorkingSetFingerprint {
  const storage = storageFor(opts);
  const wiki = wikiDir(storage);
  return {
    wiki_mtime: wiki && fs.existsSync(wiki) ? newestMtime(wiki) : 0,
    git_head: readGitHead(storage.activeRoot),
    open_questions_hash: hashOpenQuestions(opts.open_question_ids ?? []),
  };
}

export function fingerprintsMatch(a: WorkingSetFingerprint, b: WorkingSetFingerprint): boolean {
  return (
    a.wiki_mtime === b.wiki_mtime &&
    a.git_head === b.git_head &&
    a.open_questions_hash === b.open_questions_hash
  );
}

/** Where the card is cached. Rebuildable, so it lives off the repo. */
export function workingSetCardPath(storage: GuildStorage, phase: string): string {
  const safe = phase.replace(/[^A-Za-z0-9._-]/g, "-") || "unknown";
  return storage.cache("working-set", `${safe}.json`);
}

export function readWorkingSet(storage: GuildStorage, phase: string): WorkingSet | null {
  const p = workingSetCardPath(storage, phase);
  try {
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as WorkingSet;
    return parsed && parsed.schema_version === WORKING_SET_SCHEMA ? parsed : null;
  } catch {
    return null;
  }
}

export function writeWorkingSet(storage: GuildStorage, card: WorkingSet): string {
  const p = workingSetCardPath(storage, card.phase);
  storage.ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(card, null, 2) + "\n", "utf8");
  return p;
}

export interface BuildWorkingSetInput {
  phase: string;
  cwd?: string;
  storage?: GuildStorage;
  pinned_decision_ids?: readonly string[];
  open_question_ids?: readonly string[];
  learn_stamp?: string;
}

export interface WorkingSetLoad {
  card: WorkingSet;
  /**
   * `true` when the cached card's fingerprint still matched. A caller that sees
   * `fresh: true` must not spawn learn and must not rebuild the recall projection.
   */
  fresh: boolean;
  path: string;
}

/**
 * Read the card for a phase, rebuilding it only when the fingerprint misses.
 *
 * The rebuild is an INCREMENTAL cache rebuild (R29): the card and nothing else. It
 * is not the entry point to `learn`, and there is deliberately no option here that
 * makes it one.
 */
export function loadWorkingSet(input: BuildWorkingSetInput): WorkingSetLoad {
  const storage = storageFor(input);
  const fingerprint = computeFingerprint({
    storage,
    open_question_ids: input.open_question_ids ?? [],
  });

  const cached = readWorkingSet(storage, input.phase);
  if (cached && fingerprintsMatch(cached.fingerprint, fingerprint)) {
    return { card: cached, fresh: true, path: workingSetCardPath(storage, input.phase) };
  }

  const card = buildWorkingSetCard({ ...input, fingerprint });
  const p = writeWorkingSet(storage, card);
  return { card, fresh: false, path: p };
}

/**
 * Build the card object. Split out from `loadWorkingSet` so the cap can be
 * asserted without touching the filesystem.
 *
 * The cap is enforced by TRIMMING the two id lists, not by throwing: a card over
 * budget is a card with too many pins, and dropping the oldest pins keeps phase
 * start working. Pins are ids, so trimming costs a recall, never information.
 */
export function buildWorkingSetCard(
  input: BuildWorkingSetInput & { fingerprint: WorkingSetFingerprint },
): WorkingSet {
  const card: WorkingSet = {
    schema_version: WORKING_SET_SCHEMA,
    fingerprint: input.fingerprint,
    phase: input.phase,
    pinned_decision_ids: [...(input.pinned_decision_ids ?? [])],
    open_question_ids: [...(input.open_question_ids ?? [])],
    card_tokens: 0,
  };
  if (input.learn_stamp) card.learn_stamp = input.learn_stamp;

  card.card_tokens = estimateTokens(JSON.stringify(card));
  while (card.card_tokens > WORKING_SET_TOKEN_CAP) {
    if (card.open_question_ids.length > 0) card.open_question_ids.pop();
    else if (card.pinned_decision_ids.length > 0) card.pinned_decision_ids.pop();
    else break;
    card.card_tokens = estimateTokens(JSON.stringify(card));
  }
  return card;
}

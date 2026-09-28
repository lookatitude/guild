/**
 * ingest-pause.ts — the wiki-ingest D-PROBE / similarity pause, as state the
 * PreToolUse hook enforces.
 *
 * `ingest-similarity` returning `should_pause: true` used to be a verdict only the
 * skill prose acted on: the following Write still passed PreToolUse. The gate now
 * records a durable marker naming the candidate, and the hook refuses a Write/Edit
 * to that candidate or under this root's wiki while any entry is unresolved. The
 * operator clears an entry through the ingest resume path
 * (`ingest-similarity --clear-pause`), which the hook itself routes to `ask`.
 *
 * The marker is runtime state, off the repo (KTD15): `storage.runtime("security",
 * "ingest-pause.json")`, keyed by the root id, so the CLI and the hook agree on it
 * from the cwd alone with no run id.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { atomicWriteDurable, createGuildStorage, type GuildStorage } from "../state";

export const INGEST_PAUSE_SCHEMA = "guild.ingest_pause.v1" as const;

export interface IngestPauseEntry {
  /** Absolute path of the candidate file the probe paused on. */
  candidate_path: string;
  /** Target wiki category the candidate was headed for. */
  category: string;
  pause_reason: "similarity" | "directive_probe" | "both";
  probe_patterns: string[];
  paused_at: string;
}

export interface IngestPauseFile {
  schema_version: typeof INGEST_PAUSE_SCHEMA;
  entries: IngestPauseEntry[];
}

function storageFor(root: string | GuildStorage): GuildStorage {
  return typeof root === "string" ? createGuildStorage(root) : root;
}

export function ingestPausePath(root: string | GuildStorage): string {
  return storageFor(root).runtime("security", "ingest-pause.json");
}

/** Unresolved entries. An unreadable marker is treated as PAUSED (fail closed). */
export function readIngestPause(root: string | GuildStorage): IngestPauseEntry[] {
  const p = ingestPausePath(root);
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as IngestPauseFile;
    if (parsed?.schema_version === INGEST_PAUSE_SCHEMA && Array.isArray(parsed.entries)) return parsed.entries;
  } catch {
    // fall through
  }
  return [
    {
      candidate_path: p,
      category: "",
      pause_reason: "directive_probe",
      probe_patterns: ["unreadable-pause-marker"],
      paused_at: new Date(0).toISOString(),
    },
  ];
}

function writeEntries(root: string | GuildStorage, entries: IngestPauseEntry[]): void {
  const storage = storageFor(root);
  const p = ingestPausePath(storage);
  if (entries.length === 0) {
    fs.rmSync(p, { force: true });
    return;
  }
  storage.ensureDir(path.dirname(p));
  atomicWriteDurable(p, JSON.stringify({ schema_version: INGEST_PAUSE_SCHEMA, entries }, null, 2) + "\n");
}

export function recordIngestPause(
  root: string | GuildStorage,
  entry: Omit<IngestPauseEntry, "paused_at" | "candidate_path"> & { candidate_path: string },
): IngestPauseEntry {
  const full: IngestPauseEntry = {
    ...entry,
    candidate_path: path.resolve(entry.candidate_path),
    paused_at: new Date().toISOString(),
  };
  const kept = readIngestPause(root).filter(
    (e) => e.candidate_path !== full.candidate_path && !e.probe_patterns.includes("unreadable-pause-marker"),
  );
  writeEntries(root, [...kept, full]);
  return full;
}

/** Operator resume: clear one candidate, or every entry when none is named. */
export function clearIngestPause(root: string | GuildStorage, candidatePath?: string): number {
  const entries = readIngestPause(root);
  const target = candidatePath === undefined ? undefined : path.resolve(candidatePath);
  const kept = target === undefined ? [] : entries.filter((e) => e.candidate_path !== target);
  writeEntries(root, kept);
  return entries.length - kept.length;
}

/**
 * The real path of `p`, whether or not it exists yet.
 *
 * Lexical `path.resolve` let a symlink alias walk past the pause: a `wiki-link` to
 * the wiki directory, or `cand-link.md` to the candidate, resolved to paths the gate did
 * not know (codex G-lane r2 P2). A not-yet-existing target canonicalizes its
 * deepest existing ancestor and keeps the tail; a dangling link is followed by
 * its own text, bounded so a link loop cannot spin.
 */
export function canonicalPath(p: string, hops = 0): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    // not fully resolvable: fall through
  }
  if (hops < 40) {
    try {
      if (fs.lstatSync(abs).isSymbolicLink()) {
        return canonicalPath(path.resolve(path.dirname(abs), fs.readlinkSync(abs)), hops + 1);
      }
    } catch {
      // does not exist: canonicalize the parent instead
    }
  }
  const parent = path.dirname(abs);
  if (parent === abs) return abs;
  return path.join(canonicalPath(parent, hops + 1), path.basename(abs));
}

/** Same file on disk: a hard link is an alias no path comparison can see. */
function sameInode(a: string, b: string): boolean {
  try {
    const x = fs.statSync(a);
    const y = fs.statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}

/**
 * The entry that blocks a write to `targetPath`, or null. A write to the paused
 * candidate itself, or anywhere under this root's wiki, is blocked while any
 * entry stands: the synthesized page lands under the wiki, not at the candidate.
 *
 * Both sides are compared as REAL paths — the marker's candidate and wiki roots,
 * and the tool's target — so a symlinked directory or file alias names the same
 * thing the canonical path does.
 */
export function ingestPauseBlocking(
  root: string | GuildStorage,
  targetPath: string,
): IngestPauseEntry | null {
  const entries = readIngestPause(root);
  if (entries.length === 0) return null;
  const storage = storageFor(root);
  const lexical = path.resolve(storage.activeRoot, targetPath);
  const target = canonicalPath(lexical);
  const direct = entries.find(
    (e) =>
      e.candidate_path === lexical ||
      canonicalPath(e.candidate_path) === target ||
      sameInode(e.candidate_path, target),
  );
  if (direct) return direct;
  const wikiRoots = [storage.project?.knowledge(), storage.workspace?.knowledge()].filter(
    (r): r is string => typeof r === "string",
  );
  for (const wiki of wikiRoots.flatMap((w) => [w, canonicalPath(w)])) {
    for (const t of [lexical, target]) {
      const rel = path.relative(wiki, t);
      if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return entries[0];
    }
  }
  return null;
}

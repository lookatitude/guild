/**
 * publication-boundary.ts — K03: hook hints meet the published generation.
 *
 * The after-edit hook appends the touched paths to the current generation's hint
 * log. A hint makes the published layers `pending`; it never proves anything.
 * `publicationStatus` runs K02's `reconcileBoundary` against the generation's
 * source basis: with an observer within budget it compares the basis now (a
 * dropped hook still shows as drift), records the verification, and plans the
 * bounded structural refresh. Hints logged after a verification are pending again.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  admitCritical,
  planBackgroundRefresh,
  reconcileBoundary,
  type BackgroundPlan,
  type BoundaryVerdict,
  type VerificationBudget,
} from "./freshness-boundary";
import { readPublication, publicationSidecarPath, readPublicationRecord, type BasisRef, type LayerChannel, type Sha256 } from "./publication";
import { sourceWorktreeId, type ChannelState } from "./source-basis";
import { durableGuildDir } from "../state";

/** The hook never verifies: any hint makes the generation pending. */
export const AFTER_EDIT_BUDGET: VerificationBudget = Object.freeze({ max_files: 0, max_bytes: 0 });
/** Hint lines read per status call; more is reported, not read. */
export const MAX_HINT_LINES = 10_000;
const MAX_PATHS_PER_HINT = 256;

export interface HintResult {
  recorded: boolean;
  generation: Sha256 | null;
  reason: string;
  paths: string[];
}

function relInside(root: string, p: string): string | null {
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join("/");
  return posix === ".guild" || posix.startsWith(".guild/") ? null : posix;
}

/**
 * Append touched paths to the current generation's hint log. Ignored when there
 * is no publication or it was built from another worktree (the hint is about
 * other bytes). One O_APPEND line per call; concurrent hooks do not clobber.
 */
export function recordPublicationHints(input: { indexesDir: string; sourceRoot: string; paths: readonly string[]; now?: () => string }): HintResult {
  const none = (reason: string, generation: Sha256 | null = null): HintResult => ({ recorded: false, generation, reason, paths: [] });
  let cur: { pointer: { generation: Sha256 }; record: { source_worktree_id: string } } | null = null;
  try {
    cur = readPublicationRecord(input.indexesDir, { manifest: false });
  } catch (err) {
    return none(`publication unreadable: ${(err as Error).message}`);
  }
  if (!cur) return none("nothing published");
  if (cur.record.source_worktree_id !== sourceWorktreeId(input.sourceRoot)) {
    return none("publication was built from another worktree", cur.pointer.generation);
  }
  const paths = [...new Set(input.paths.map((p) => (typeof p === "string" && p ? relInside(input.sourceRoot, p) : null)).filter((p): p is string => !!p))]
    .sort()
    .slice(0, MAX_PATHS_PER_HINT);
  if (!paths.length) return none("no source paths in the hint", cur.pointer.generation);
  const file = publicationSidecarPath(input.indexesDir, "hints", cur.pointer.generation, ".jsonl");
  fs.appendFileSync(file, JSON.stringify({ at: (input.now ?? (() => new Date().toISOString()))(), paths }) + "\n", { flag: "a" });
  return { recorded: true, generation: cur.pointer.generation, reason: "hint logged; published layers pending", paths };
}

/**
 * After-edit entry point: the owner is the main worktree (K01), the source is the
 * worktree containing `cwd`. Never throws; a failure is a non-recorded hint,
 * which the next basis comparison covers anyway (hints are not evidence).
 */
/**
 * Worktree top and owner (main) root from `.git` on disk, without spawning git:
 * a `.git` dir is a main worktree; a `.git` file names a linked worktree's gitdir,
 * whose `commondir` leads to the main repository.
 */
function worktreeRoots(cwd: string): { top: string; owner: string } | null {
  let dir = path.resolve(cwd);
  for (;;) {
    const dotGit = path.join(dir, ".git");
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(dotGit);
    } catch {
      st = null;
    }
    if (st?.isDirectory()) return { top: dir, owner: dir };
    if (st?.isFile()) {
      const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dotGit, "utf8"));
      if (!m) return null;
      const gitDir = path.resolve(dir, m[1].trim());
      let common = gitDir;
      try {
        common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim());
      } catch {
        /* no commondir: the gitdir is the common dir */
      }
      return { top: dir, owner: path.dirname(common) };
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * After-edit entry point: the owner is the main worktree (K01), the source is the
 * worktree containing `cwd`. Never throws and never spawns a process; a failure
 * is a non-recorded hint, which the next basis comparison covers (hints are not
 * evidence).
 */
export function hintPublicationFromCwd(cwd: string, paths: readonly string[]): HintResult {
  try {
    const roots = worktreeRoots(cwd);
    if (!roots) return { recorded: false, generation: null, reason: "not a git worktree", paths: [] };
    const indexesDir = path.join(durableGuildDir(roots.owner), "indexes");
    const pub = path.join(indexesDir, "publication");
    if (!fs.existsSync(path.join(pub, "CURRENT")) && !fs.existsSync(path.join(pub, "successors", "root"))) {
      return { recorded: false, generation: null, reason: "nothing published", paths: [] };
    }
    return recordPublicationHints({ indexesDir, sourceRoot: roots.top, paths });
  } catch (err) {
    return { recorded: false, generation: null, reason: `hint not recorded: ${(err as Error).message}`, paths: [] };
  }
}

interface Verification {
  schema_version: "guild.knowledge_publication_verification.v1";
  generation: Sha256;
  at: string;
  /** Hint lines this verification covered. Later lines are pending again. */
  hint_lines: number;
  state: ChannelState;
  verified: boolean;
  reason: string;
  drift: string[];
  hints_missed: string[];
}

function readHints(file: string): { lines: number; paths: string[]; truncated: boolean } {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { lines: 0, paths: [], truncated: false };
  }
  const rows = text.split("\n").filter((l) => l.trim() !== "");
  const out = new Set<string>();
  for (const l of rows.slice(0, MAX_HINT_LINES)) {
    try {
      const p = (JSON.parse(l) as { paths?: unknown }).paths;
      if (Array.isArray(p)) for (const x of p) if (typeof x === "string") out.add(x);
    } catch {
      /* a torn line from a crashed hook: skip */
    }
  }
  return { lines: rows.length, paths: [...out].sort(), truncated: rows.length > MAX_HINT_LINES };
}

function readVerification(file: string): Verification | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8")) as Verification;
    return v?.schema_version === "guild.knowledge_publication_verification.v1" ? v : null;
  } catch {
    return null;
  }
}

export interface PublicationStatus {
  generation: Sha256;
  source_worktree_id: string;
  /** Effective per-channel state: the record, downgraded by hints/verification. */
  channels: Array<{ channel: LayerChannel; published_state: ChannelState; state: ChannelState; reason: string | null }>;
  verdict: BoundaryVerdict | null;
  pending_hints: string[];
  hints_truncated: boolean;
  /** Bounded structural refresh for the hinted/drifted paths (never semantic). */
  refresh: BackgroundPlan | null;
  admit_critical: boolean;
}

/**
 * Effective freshness of the current generation. With `observe` (and a budget
 * that admits the generation's inventory) the basis is compared now and the
 * verification is recorded for later readers.
 */
export function publicationStatus(input: {
  indexesDir: string;
  observe?: () => BasisRef;
  budget?: VerificationBudget;
  estimateBytes?: number;
  now?: () => string;
}): PublicationStatus | null {
  const cur = readPublicationRecord(input.indexesDir);
  if (!cur) return null;
  const gen = cur.pointer.generation;
  const hintFile = publicationSidecarPath(input.indexesDir, "hints", gen, ".jsonl");
  const verFile = publicationSidecarPath(input.indexesDir, "verifications", gen, ".json");
  const hints = readHints(hintFile);
  let verification = readVerification(verFile);
  let verdict: BoundaryVerdict | null = null;

  if (input.observe) {
    const inv = cur.manifest.source_basis.inventory ?? [];
    verdict = reconcileBoundary({
      marker: { source_basis: { basis: cur.record.basis, source_basis_hash: cur.record.source_basis_hash, inventory: inv } },
      hints: hints.paths,
      estimate: { files: inv.length, bytes: input.estimateBytes ?? 0 },
      budget: input.budget ?? { max_files: Number.MAX_SAFE_INTEGER, max_bytes: Number.MAX_SAFE_INTEGER },
      observe: input.observe,
    });
    if (verdict.verified) {
      verification = {
        schema_version: "guild.knowledge_publication_verification.v1",
        generation: gen,
        at: (input.now ?? (() => new Date().toISOString()))(),
        hint_lines: hints.lines,
        state: verdict.state,
        verified: true,
        reason: verdict.reason,
        drift: verdict.drift,
        hints_missed: verdict.hints_missed,
      };
      // Unique, exclusive temp beside the contained target (never follows a planted link).
      const tmp = `${verFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(verification, null, 2) + "\n", { flag: "wx" });
      fs.renameSync(tmp, verFile);
    }
  }

  const newHints = hints.lines > (verification?.hint_lines ?? 0);
  const channels = cur.record.channels.map((c) => {
    let state: ChannelState = c.state;
    let reason = c.reason;
    if (c.state === "current_for_basis") {
      if (verdict && !verdict.verified) {
        // This call could not verify (over budget / no basis): say so, do not echo the record.
        state = verdict.state;
        reason = verdict.reason;
      } else if (verification && verification.state !== "current_for_basis") {
        state = verification.state;
        reason = `verified ${verification.at}: ${verification.reason}`;
      } else if (newHints || hints.truncated) {
        state = "pending";
        reason = "edits hinted since the last verification; not yet compared with the source";
      }
    }
    return { channel: c.channel, published_state: c.state, state, reason };
  });
  const drift = verification?.drift ?? [];
  const work = [...new Set([...hints.paths, ...drift])];
  const allCurrent = channels.every((c) => c.state === "current_for_basis");
  // Critical admission also needs the generation's bytes to verify against its manifest.
  let bytesVerified = false;
  if (verdict && admitCritical(verdict) && !newHints && allCurrent) {
    try {
      bytesVerified = readPublication(input.indexesDir)?.pointer.generation === gen;
    } catch {
      bytesVerified = false;
    }
  }
  return {
    generation: gen,
    source_worktree_id: cur.record.source_worktree_id,
    channels,
    verdict,
    pending_hints: newHints ? hints.paths : [],
    hints_truncated: hints.truncated,
    refresh: allCurrent || work.length === 0 ? null : planBackgroundRefresh(work),
    admit_critical: bytesVerified,
  };
}

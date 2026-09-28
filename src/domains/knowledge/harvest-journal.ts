/**
 * harvest-journal.ts — `guild.harvest_journal.v1` (KTD39 / R54).
 *
 * Harvest is a multi-step durable write: probe, write the wiki page, index it for
 * BM25, replace the playbook span, report. A crash between any two of those leaves
 * the root in a state nobody asked for — most sharply between WRITTEN and INDEXED,
 * where a canonical page exists that recall cannot find. The journal makes each
 * step resumable by `op_id`: a resumed harvest reads the last status and continues,
 * rather than re-running the write and producing a second page.
 *
 * It also makes harvest REVERSIBLE. Every op that mutates a durable file records
 * the inverse — the bytes that were there before — in compact history beside the
 * journal. `maintain wiki revert <harvest_id>` replays those inverses. That is
 * KTD48: compact history REPLACES the retired per-version trees, so the rollback is
 * an inverse span rather than a retained copy of the old paragraph in the live file.
 *
 * Storage is RUNTIME, per the T05 seam. The journal is this run's bookkeeping, not
 * durable knowledge: once the ops are `reported`, the wiki page is the artifact and
 * the journal is scaffolding.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { atomicWriteDurable, createGuildStorage, type GuildStorage } from "../state";
// Closed collection: sealed through the kernel primitive the rail trusts.
import { sealSet } from "../kernel";

export const HARVEST_JOURNAL_SCHEMA = "guild.harvest_journal.v1" as const;

export type HarvestTrigger =
  | "methodology_repeat"
  | "redirect_threshold"
  | "new_feature"
  | "harvest"
  | "manual";

export type HarvestStatus =
  | "planned"
  | "probed"
  | "written"
  | "indexed"
  | "reported"
  | "refused"
  | "reverted"
  | "failed"
  | "replan_queued";

export type HarvestRefuseReason =
  | "injection"
  | "probe"
  | "secrets"
  | "lint"
  | "cas"
  /** Target outside this cwd's own wiki / playbooks tree (R67). */
  | "scope"
  /** The op_id is already TERMINAL — a reverted or refused op may not be replayed. */
  | "replay"
  /** A named playbook span the op was asked to replace is not in the file (R53). */
  | "missing_anchor";

export interface HarvestOp {
  op_id: string;
  trigger: HarvestTrigger;
  decision_id?: string;
  wiki_path?: string;
  playbook_path?: string;
  before_hash?: string;
  after_hash?: string;
  /** Prior canonical ids this op replaced. */
  superseded_ids?: string[];
  /** true → T0 must emit `replan` after `indexed` (KTD53). */
  pinned_in_flight?: boolean;
  status: HarvestStatus;
  refuse_reason?: HarvestRefuseReason;
}

export interface HarvestJournal {
  schema_version: typeof HARVEST_JOURNAL_SCHEMA;
  run_id: string;
  ops: HarvestOp[];
}

export interface JournalOptions {
  cwd?: string;
  storage?: GuildStorage;
}

function storageFor(opts: JournalOptions): GuildStorage {
  return opts.storage ?? createGuildStorage(opts.cwd ?? process.cwd());
}

export function harvestJournalPath(storage: GuildStorage, runId: string): string {
  return storage.runtime(runId, "harvest-journal.json");
}

/** Compact history: the inverse of one op, keyed by op id. */
export function harvestHistoryPath(storage: GuildStorage, runId: string, opId: string): string {
  return storage.runtime(runId, "harvest-history", `${opId}.json`);
}

/**
 * The inverse of ONE file touched by an op.
 *
 * `before` / `after` are whole-file bytes for a page the op owns end to end (a
 * decision page). `span` is present when the op rewrote a REGION of a file it does
 * not own — a playbook heading span — and carries the anchor that locates the
 * region plus the exact bytes on either side of the op. Revert uses whichever is
 * present, and in both cases compares the CURRENT bytes against `after` first: an
 * operator edit that landed after the op means the recorded inverse no longer
 * describes this file, and restoring it would delete that edit.
 */
export interface HarvestInverseFile {
  path: string;
  /** Bytes BEFORE the op. `null` means "did not exist". */
  before: string | null;
  /**
   * sha256 of `before`, recorded with it. Revert restores `before` only while it
   * still hashes to this: an edited inverse is refused, never written back.
   */
  before_sha256?: string;
  /**
   * Bytes the op WROTE, exactly as they landed on disk (POST-scrub). A
   * convenience copy filled in after the write; revert never needs it, because
   * `after_sha256` alone identifies what the op put there. Absent on a
   * crash-interrupted op, and its absence is NOT permission to skip the file.
   */
  after?: string | null;
  /**
   * sha256 of the whole-file bytes the op writes. Recorded BEFORE the write (over
   * the exact buffer that is about to be handed to the writer) and re-stamped
   * from disk after it lands. A file entry without it is a PARTIAL inverse:
   * revert refuses rather than guessing what the op did.
   *
   * The hash — never the bytes — is what goes out pre-write, so the journal is
   * still free of unscrubbed content in the window before the scrubbing writer
   * has run.
   */
  after_sha256?: string;
  /** Present when the op replaced a named region rather than the whole file. */
  span?: {
    /** The heading line that locates the region. */
    anchor: string;
    /** The region as it was before the op, INCLUDING the anchor line. */
    before_span: string;
    /** sha256 of `before_span`. Missing or mismatched ⇒ revert refuses. */
    before_sha256?: string;
    /**
     * The region the op wrote, INCLUDING the anchor line, read back from disk
     * after the write. A convenience copy — `after_len` + `after_sha256` are
     * what revert actually uses.
     */
    after_span?: string;
    /**
     * The EXACT byte length of the region the op writes, recorded before the
     * write. Revert takes `after_len` bytes from the anchor and checks the hash;
     * it NEVER re-scans for the next heading, because a replacement that itself
     * contains a same-level heading would end the re-scan early and leave half
     * the op's bytes in the file.
     */
    after_len?: number;
    /** sha256 of those exact bytes. Missing ⇒ partial inverse ⇒ revert refuses. */
    after_sha256?: string;
  };
}

export interface HarvestInverse {
  op_id: string;
  files: HarvestInverseFile[];
}

export function readHarvestJournal(runId: string, opts: JournalOptions = {}): HarvestJournal {
  const storage = storageFor(opts);
  const p = harvestJournalPath(storage, runId);
  try {
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as HarvestJournal;
      if (parsed && parsed.schema_version === HARVEST_JOURNAL_SCHEMA && Array.isArray(parsed.ops)) {
        return parsed;
      }
    }
  } catch {
    // Fall through to an empty journal. An unreadable journal must not block the
    // run, but it also must not be treated as "nothing happened" for REVERT —
    // which is why revert reads compact history by op id, not the journal.
  }
  return { schema_version: HARVEST_JOURNAL_SCHEMA, run_id: runId, ops: [] };
}

/**
 * Write a journal file ATOMICALLY and FSYNC it before returning.
 *
 * Two properties, and the journal needs both:
 *
 *   - DURABLE. The whole inverse-first protocol rests on "the record is on disk
 *     before the durable write starts". A buffered write still sitting in the
 *     page cache when the process dies breaks exactly that ordering.
 *   - ATOMIC. A journal update is a full rewrite of the file (read → append one
 *     op → write it all back), and the previous version opened it with
 *     `"w"` — truncate, THEN write. An interrupt inside that window left a
 *     truncated or half-written journal, so one failed append destroyed the
 *     history of every op before it. A reader then sees an unparseable journal
 *     and falls back to "no ops", which is indistinguishable from "nothing ever
 *     happened" — the same class of silent loss the r3 round closed in revert.
 *
 * `atomicWriteDurable` is the T05 state-module primitive: same-directory temp
 * file (EXDEV-safe) → fsync → rename. An interrupt before the rename leaves the
 * PREVIOUS journal byte-identical on disk; an interrupt after it leaves the new
 * one complete. There is no state in between.
 */
function writeDurable(absPath: string, body: string): void {
  atomicWriteDurable(absPath, body);
}

export function writeHarvestJournal(journal: HarvestJournal, opts: JournalOptions = {}): string {
  const storage = storageFor(opts);
  const p = harvestJournalPath(storage, journal.run_id);
  storage.ensureDir(path.dirname(p));
  writeDurable(p, JSON.stringify(journal, null, 2) + "\n");
  return p;
}

export function newOpId(seed = ""): string {
  return crypto
    .createHash("sha256")
    .update(`${seed}\n${Date.now()}\n${Math.random()}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** Insert or replace one op, then persist. Returns the stored op. */
export function upsertOp(runId: string, op: HarvestOp, opts: JournalOptions = {}): HarvestOp {
  const journal = readHarvestJournal(runId, opts);
  const i = journal.ops.findIndex((o) => o.op_id === op.op_id);
  if (i >= 0) journal.ops[i] = op;
  else journal.ops.push(op);
  writeHarvestJournal(journal, opts);
  return op;
}

export function findOp(runId: string, opId: string, opts: JournalOptions = {}): HarvestOp | null {
  return readHarvestJournal(runId, opts).ops.find((o) => o.op_id === opId) ?? null;
}

export function recordInverse(
  runId: string,
  inverse: HarvestInverse,
  opts: JournalOptions = {},
): string {
  const storage = storageFor(opts);
  const p = harvestHistoryPath(storage, runId, inverse.op_id);
  storage.ensureDir(path.dirname(p));
  writeDurable(p, JSON.stringify(inverse, null, 2) + "\n");
  return p;
}

export function readInverse(
  runId: string,
  opId: string,
  opts: JournalOptions = {},
): HarvestInverse | null {
  const storage = storageFor(opts);
  const p = harvestHistoryPath(storage, runId, opId);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as HarvestInverse;
  } catch {
    return null;
  }
}

/**
 * Terminal statuses. An op that reached one is CLOSED for its op_id: it is never
 * resumed, and never replayed. `reverted` in particular — replaying a reverted
 * op_id re-promoted the content the operator had just undone. Promoting that
 * content again is a NEW op with a new op_id, which re-passes every gate.
 */
export const TERMINAL_STATUSES: ReadonlySet<HarvestStatus> = sealSet<HarvestStatus>([
  "reported",
  "refused",
  "reverted",
  "failed",
]);

export function isTerminalHarvestStatus(status: HarvestStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Statuses from which a crashed op can be picked up again. */
export const RESUMABLE_STATUSES: ReadonlySet<HarvestStatus> = sealSet<HarvestStatus>([
  "planned",
  "probed",
  "written",
  "indexed",
  "replan_queued",
]);

/**
 * The ops a resumed harvest must finish. Terminal statuses (`reported`,
 * `refused`, `reverted`, `failed`) are left alone — a refused op is a DECISION,
 * not an interruption, and resuming it would re-attempt a write the probe already
 * rejected.
 */
export function resumableOps(runId: string, opts: JournalOptions = {}): HarvestOp[] {
  return readHarvestJournal(runId, opts).ops.filter((o) => RESUMABLE_STATUSES.has(o.status));
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

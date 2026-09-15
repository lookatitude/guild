/**
 * src/modules/state/workflows/upgrade-journal.ts
 *
 * `guild.upgrade_journal.v1` — the resumable record of ONE layout upgrade of ONE
 * Guild root (proposal §21.4, KTD23, R39).
 *
 * The journal lives on the PLATFORM STATE root, never under `.guild/`. Two
 * reasons, both hard requirements:
 *
 *   1. `.guild/` is durable truth (KTD15). An in-flight upgrade is not truth; it
 *      is per-user runtime state that must not enter the repo's git diff.
 *   2. The upgrade MOVES durable paths. A journal living inside the tree being
 *      rewritten cannot be trusted to survive its own steps.
 *
 * Resume is by STEP ID, not by offset: replaying a journal means "run every step
 * whose id is not already `completed` or `skipped`". Every step is idempotent, so
 * a crash between the fs write and the journal append re-runs a step that has
 * already done its work and the second run reports `skipped`.
 *
 * CONTRACT: this file owns the journal file and the lock file, and nothing else.
 * It never touches `.guild/`, never spawns a process, and takes its clock from
 * the caller so fixtures are deterministic.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const UPGRADE_JOURNAL_SCHEMA = "guild.upgrade_journal.v1" as const;

/**
 * Transaction state (proposal §21.4). `blocked_confirm` is Guild's addition: the
 * autonomy contract forbids deleting a file that is not classified derived, so a
 * step that wants to stops the chain and asks instead of widening its own licence.
 */
export type UpgradeState =
  | "planned"
  | "running"
  | "blocked_dirty_durable"
  | "blocked_confirm"
  | "validating"
  | "committed"
  | "failed";

/** Terminal disposition of one step. */
export type StepStatus = "completed" | "skipped" | "blocked_dirty" | "blocked_confirm" | "failed";

export interface UpgradeJournalEntry {
  /** Pinned step id from the catalog (spec gap G-b). */
  step_id: string;
  status: StepStatus;
  /** Safe-local steps run even on a dirty tree; durable steps do not. */
  cls: "safe-local" | "durable";
  /** One line, human-readable. Printed by `config migrate`. */
  detail: string;
  /** Repo-relative durable paths the step read, wrote or was blocked on. */
  paths: string[];
  /** Set only for `blocked_confirm`: the exact question the operator answers. */
  question?: string;
  at: string;
}

export interface UpgradeJournal {
  schema_version: typeof UPGRADE_JOURNAL_SCHEMA;
  /** `guildRootId(activeRoot)` — keys the journal to one root, never to a path. */
  root_id: string;
  /** Absolute repo root, for the operator's diagnostics only. */
  root: string;
  from_version: number | null;
  to_version: number;
  state: UpgradeState;
  started_at: string;
  updated_at: string;
  /** Exact dirty tracked paths when `state === "blocked_dirty_durable"`. */
  dirty_paths: string[];
  entries: UpgradeJournalEntry[];
}

/** The journal file for one root. `runtime()` is the platform state root (KTD23). */
export function upgradeJournalPath(runtime: (...segments: string[]) => string): string {
  return runtime("journal", "upgrade", "layout.json");
}

/** The per-root upgrade lock. Also on platform state — never under `.guild/`. */
export function upgradeLockPath(runtime: (...segments: string[]) => string): string {
  return runtime("journal", "upgrade", "layout.lock");
}

function ensureParent(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export function loadJournal(file: string): UpgradeJournal | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as UpgradeJournal;
    if (parsed?.schema_version !== UPGRADE_JOURNAL_SCHEMA) return null;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    // A truncated journal (killed mid-write) is not a resumable journal. Losing it
    // is safe precisely because every step is idempotent: the chain re-runs from
    // the top and each step re-detects that its work is already done.
    return null;
  }
}

export function saveJournal(file: string, journal: UpgradeJournal): void {
  ensureParent(file);
  // Write-then-rename: a crash mid-save leaves the PREVIOUS journal intact rather
  // than a half-written one the next resume would discard.
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function newJournal(opts: {
  rootId: string;
  root: string;
  fromVersion: number | null;
  toVersion: number;
  now: string;
}): UpgradeJournal {
  return {
    schema_version: UPGRADE_JOURNAL_SCHEMA,
    root_id: opts.rootId,
    root: opts.root,
    from_version: opts.fromVersion,
    to_version: opts.toVersion,
    state: "planned",
    started_at: opts.now,
    updated_at: opts.now,
    dirty_paths: [],
    entries: [],
  };
}

/**
 * Step ids already settled in this journal. A step in this set is NOT re-run on
 * resume; anything else is (blocked and failed steps are retried, which is the
 * whole point of `config migrate` being a retry entry).
 */
export function settledSteps(journal: UpgradeJournal): Set<string> {
  const out = new Set<string>();
  for (const e of journal.entries) {
    if (e.status === "completed" || e.status === "skipped") out.add(e.step_id);
  }
  return out;
}

/** Append one entry, replacing any earlier entry for the same step id. */
export function recordStep(journal: UpgradeJournal, entry: UpgradeJournalEntry): UpgradeJournal {
  const entries = journal.entries.filter((e) => e.step_id !== entry.step_id);
  entries.push(entry);
  return { ...journal, entries, updated_at: entry.at };
}

/** The reverse of a journal, for the in-flight rollback R39 names (§21.17). */
export function inverseSteps(journal: UpgradeJournal): UpgradeJournalEntry[] {
  return journal.entries.filter((e) => e.status === "completed").slice().reverse();
}

export interface LockHandle {
  path: string;
  /** Idempotent. Releasing a lock this process does not hold is a no-op. */
  release(): void;
}

/** How long a lock file may sit before a new activation reclaims it. */
export const LOCK_STALE_MS = 15 * 60 * 1000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Acquire the per-root upgrade lock. Returns `null` when another live process
 * holds it — the caller then reports "an upgrade is already running" and does
 * NOT proceed, because two chains over one tree is exactly the ambiguous dual
 * state §21.3 forbids.
 *
 * A lock whose owner is gone, or which is older than `LOCK_STALE_MS`, is
 * reclaimed: an upgrade killed by a closed terminal must not strand the root.
 */
export function acquireLock(file: string, nowMs: number): LockHandle | null {
  ensureParent(file);
  const payload = `${JSON.stringify({ pid: process.pid, at: nowMs })}\n`;
  const claim = (): LockHandle | null => {
    try {
      fs.writeFileSync(file, payload, { encoding: "utf8", flag: "wx" });
      return {
        path: file,
        release: () => {
          try {
            const held = JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: number };
            if (held.pid === process.pid) fs.rmSync(file, { force: true });
          } catch {
            /* already gone, or someone else's — leave it alone */
          }
        },
      };
    } catch {
      return null;
    }
  };

  const first = claim();
  if (first) return first;

  let held: { pid?: number; at?: number };
  try {
    held = JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: number; at?: number };
  } catch {
    held = {};
  }
  const stale =
    typeof held.pid !== "number" ||
    !pidAlive(held.pid) ||
    typeof held.at !== "number" ||
    nowMs - held.at > LOCK_STALE_MS;
  if (!stale) return null;
  fs.rmSync(file, { force: true });
  return claim();
}

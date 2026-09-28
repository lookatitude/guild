/**
 * compact-history.ts — `guild.evolve_history.v1`: what replaced the retired per-version
 * snapshot tree (KTD15 / KTD48 / R60).
 *
 * That design kept a full COPY of every skill body in a durable `.guild/` version tree
 * and rolled back by restoring the copy. Three things were wrong with it, and all three
 * are structural rather than stylistic:
 *
 *   1. It put a growing tree of stale prompt text inside durable `.guild/` — derived
 *      data in the place reserved for knowledge a user would mourn (KTD15).
 *   2. A whole-file restore silently reverts every edit that landed after the
 *      snapshot, including edits nobody asked to undo.
 *   3. It answered "what did the file look like" but never "what did this delta
 *      change", so a rollback could not be span-scoped even in principle.
 *
 * Compact history records the INVERSE SPAN instead: the region bytes as they stood,
 * the region bytes the delta wrote, and the sha256 of each. Rolling back one entry is
 * replacing the current region with `inverse_span` — span-scoped by construction.
 *
 * Two properties this module holds, both borrowed from T09's harvest journal because
 * they were learned the expensive way there:
 *
 *   - INVERSE-FIRST. The record is on disk, fsynced, BEFORE the file it describes is
 *     written. A crash in the window leaves a recorded inverse for a write that may or
 *     may not have happened, which is recoverable; the other ordering leaves a write
 *     nothing can undo, which is not.
 *   - DRIFT REFUSES, IT DOES NOT GUESS. Rollback compares the CURRENT region against
 *     `after_hash` first. A mismatch means someone edited the span after the delta
 *     landed, so the recorded inverse no longer describes this file; restoring it would
 *     delete that edit. The verdict is `blocked_confirm` with the exact path — never a
 *     whole-file rewrite, and never a best-effort restore.
 *
 * Storage is the RUNTIME class through `GuildStorage`, never a `.guild` path this
 * module builds itself (KTD15). It is NOT run-scoped: rollback must work in a later
 * session, and `closeRun` only reclaims `runtime("runs", <run-id>)`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  atomicWriteDurable,
  createGuildStorage,
  type GuildStorage,
} from "../state";
import { assertNotRuntimeTree } from "../kernel";
import { classifyPermissionContent } from "../security";
import {
  sha256,
  type EvolveDeltaPlan,
} from "./evolve-delta";
import {
  EvolveTargetRefusal,
  type EvolveTarget,
} from "./evolve-targets";

export const EVOLVE_HISTORY_SCHEMA = "guild.evolve_history.v1" as const;

/** One applied delta, with everything rollback needs and nothing else. */
export interface EvolveHistoryEntry {
  entry_id: string;
  at: string;
  run_id: string;
  target: EvolveTarget;
  /** Absolute path of the file the delta touched. */
  path: string;
  /** The heading text that named the region. */
  span: string;
  /** The heading LINE — rollback re-locates the region by it. */
  anchor: string;
  /** The region as it stood BEFORE the delta, anchor line included. This IS the inverse. */
  inverse_span: string;
  before_hash: string;
  /** The region the delta wrote, anchor line included. EMPTY for `op: "remove"`. */
  applied_span: string;
  after_hash: string;
  /**
   * Byte offset of `applied_span` in the file as the delta left it.
   *
   * This is the locator, not the anchor. A file with a SECOND heading whose bytes
   * matched the applied span gave the anchor re-scan two equally valid hits and it
   * restored the wrong one, reported `restored`, and popped the entry. And a
   * `remove` deletes the anchor outright, so for that op the offset is the only
   * locator that exists.
   */
  offset: number;
  /** sha256 of every byte BEFORE `offset`. Half of "is the file still what we wrote". */
  head_hash: string;
  /** sha256 of every byte AFTER the region. The other half. */
  tail_hash: string;
  /**
   * Where the anchor LINE starts inside `applied_span`. Normally 0; an `add` at EOF
   * puts a separator newline in front of it. Rollback subtracts this from the anchor's
   * position in the file to find the region start.
   */
  anchor_in_span: number;
  /** The bytes immediately BEFORE the region, for a removal that deleted its anchor. */
  context_before: string;
  /** The bytes immediately AFTER the region, same purpose. */
  context_after: string;
  proposer: "curator" | "operator" | "pipeline";
}

/** How much surrounding text a removal records to re-find its insertion point. */
const REMOVAL_CONTEXT_BYTES = 160;

export interface EvolveHistory {
  schema_version: typeof EVOLVE_HISTORY_SCHEMA;
  /** The rollback key — a skill slug, a playbook basename, a profile role. */
  key: string;
  entries: EvolveHistoryEntry[];
}

export interface HistoryOptions {
  cwd?: string;
  storage?: GuildStorage;
  runId?: string;
  /** The plugin install root, for the AC37 guard. Defaults to the cwd (self-build). */
  pluginRoot?: string;
  /** Injected in tests so an entry id is deterministic. */
  now?: () => Date;
}

function storageFor(opts: HistoryOptions): GuildStorage {
  return opts.storage ?? createGuildStorage(opts.cwd ?? process.cwd());
}

/** One path segment, so a hostile key cannot climb out of the history tree. */
function safeKey(key: string): string {
  const trimmed = String(key ?? "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new EvolveTargetRefusal(
      `unsafe history key '${key}' — must be a single [A-Za-z0-9._-] segment`,
      "scope",
    );
  }
  return trimmed;
}

/**
 * Where one key's compact history lives. `runtime()` is the T05 accessor; this module
 * never joins `.guild` itself, which is what `no-direct-guild-join` greps for.
 */
export function compactHistoryPath(storage: GuildStorage, key: string): string {
  return storage.runtime("evolve-history", `${safeKey(key)}.json`);
}

/**
 * Read one key's compact history, FAILING CLOSED on a file that exists but cannot be
 * parsed.
 *
 * The first cut swallowed the parse error and returned an empty stack, which is
 * indistinguishable from "nothing was ever evolved". The next `recordEvolveDelta`
 * then wrote a one-entry history over the top and every earlier inverse was gone —
 * a truncated write turning into permanent, silent loss of the only undo record.
 *
 * A file that is ABSENT is genuinely an empty stack and is not an error. A file that
 * is PRESENT and unreadable is an error, and the caller must hear about it.
 *
 * @throws EvolveTargetRefusal(`history_unreadable`) when the file exists but is not a
 *   valid `guild.evolve_history.v1`.
 */
export function readCompactHistory(key: string, opts: HistoryOptions = {}): EvolveHistory {
  const storage = storageFor(opts);
  const p = compactHistoryPath(storage, key);
  if (!fs.existsSync(p)) {
    return { schema_version: EVOLVE_HISTORY_SCHEMA, key: safeKey(key), entries: [] };
  }
  let parsed: EvolveHistory | null = null;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8")) as EvolveHistory;
  } catch (err) {
    throw new EvolveTargetRefusal(
      `compact history at ${p} exists but will not parse (${(err as Error).message}); ` +
        `refusing to treat it as an empty stack — that would overwrite every recorded ` +
        `inverse. Repair or move the file, then re-run`,
      "history_unreadable",
    );
  }
  if (
    !parsed ||
    parsed.schema_version !== EVOLVE_HISTORY_SCHEMA ||
    !Array.isArray(parsed.entries)
  ) {
    throw new EvolveTargetRefusal(
      `compact history at ${p} is not a ${EVOLVE_HISTORY_SCHEMA}; refusing to overwrite it`,
      "history_unreadable",
    );
  }
  return parsed;
}

function writeHistory(storage: GuildStorage, history: EvolveHistory): string {
  const p = compactHistoryPath(storage, history.key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  atomicWriteDurable(p, `${JSON.stringify(history, null, 2)}\n`);
  return p;
}

/**
 * Append the inverse for one planned delta — BEFORE the file is written.
 *
 * The plan already carries both hashes and both sets of region bytes, so nothing here
 * re-reads the file: re-reading would open exactly the window this ordering closes.
 *
 * @throws EvolveTargetRefusal if the target file is a runtime tree (AC37). The guard
 *   runs here, at the record step, so a forbidden write is refused before any byte of
 *   history describes it.
 */
export function recordEvolveDelta(
  key: string,
  plan: EvolveDeltaPlan,
  opts: HistoryOptions = {},
): EvolveHistoryEntry {
  const storage = storageFor(opts);
  const cwd = opts.cwd ?? storage.activeRoot;
  assertNotRuntimeTree(path.dirname(path.resolve(plan.delta.path)), opts.pluginRoot ?? cwd, cwd);

  const now = (opts.now ?? (() => new Date()))();
  const history = readCompactHistory(key, opts);
  const entry: EvolveHistoryEntry = {
    entry_id: `${history.entries.length + 1}-${sha256(plan.after_hash + plan.before_hash).slice(0, 8)}`,
    at: now.toISOString(),
    run_id: opts.runId ?? "",
    target: plan.delta.target,
    path: path.resolve(plan.delta.path),
    span: plan.delta.span,
    anchor: plan.anchor,
    inverse_span: plan.before_span,
    before_hash: plan.before_hash,
    applied_span: plan.after_span,
    after_hash: plan.after_hash,
    offset: plan.offset,
    head_hash: plan.head_hash,
    tail_hash: plan.tail_hash,
    anchor_in_span: Math.max(0, plan.after_span.indexOf(plan.anchor)),
    context_before: plan.head.slice(-REMOVAL_CONTEXT_BYTES),
    context_after: plan.tail.slice(0, REMOVAL_CONTEXT_BYTES),
    proposer: plan.delta.proposer,
  };
  history.entries.push(entry);
  writeHistory(storage, history);
  return entry;
}

export type RollbackStatus = "restored" | "blocked_confirm" | "noop";

export interface RollbackStep {
  entry_id: string;
  path: string;
  span: string;
  status: RollbackStatus;
  detail: string;
  /** The question T0 surfaces on `blocked_confirm`. */
  question?: string;
}

export interface RollbackResult {
  key: string;
  requested: number;
  steps: RollbackStep[];
  /** Files actually rewritten. */
  restored: string[];
  status: RollbackStatus;
}

/**
 * Walk `n` entries back, newest first, restoring each inverse span.
 *
 * Stops at the FIRST `blocked_confirm`. History is a stack: restoring entry k-1 while
 * entry k is still applied would leave the file in a state no entry describes, so a
 * blocked step blocks everything older than it too.
 *
 * A restored entry is POPPED from history rather than recorded as a new forward entry.
 * The retired design "snapshotted rollbacks as new versions", which made the stack grow
 * on undo and made a second `rollback` re-apply what the first one removed.
 */
export function rollbackEvolve(
  key: string,
  n = 1,
  opts: HistoryOptions = {},
): RollbackResult {
  const storage = storageFor(opts);
  const cwd = opts.cwd ?? storage.activeRoot;
  const history = readCompactHistory(key, opts);
  const count = Math.max(0, Math.floor(n));
  const steps: RollbackStep[] = [];
  const restored: string[] = [];

  if (history.entries.length === 0 || count === 0) {
    return { key: safeKey(key), requested: count, steps, restored, status: "noop" };
  }

  let blocked = false;
  for (let i = 0; i < count && history.entries.length > 0 && !blocked; i++) {
    const entry = history.entries[history.entries.length - 1];
    const step = restoreOne(entry, cwd, opts.pluginRoot ?? cwd);
    steps.push(step);
    if (step.status === "blocked_confirm") {
      blocked = true;
      break;
    }
    if (step.status === "restored") restored.push(entry.path);
    history.entries.pop();
  }
  writeHistory(storage, history);

  return {
    key: safeKey(key),
    requested: count,
    steps,
    restored,
    status: blocked ? "blocked_confirm" : restored.length > 0 ? "restored" : "noop",
  };
}

function restoreOne(entry: EvolveHistoryEntry, cwd: string, pluginRoot: string): RollbackStep {
  const base = { entry_id: entry.entry_id, path: entry.path, span: entry.span };
  const block = (detail: string, question: string): RollbackStep => ({
    ...base,
    status: "blocked_confirm",
    detail,
    question,
  });

  try {
    assertNotRuntimeTree(path.dirname(entry.path), pluginRoot, cwd);
  } catch (err) {
    return block(
      `refusing to restore into a runtime tree: ${(err as Error).message}`,
      `rollback wants to write ${entry.path}, which is a runtime surface. Promote by hand instead.`,
    );
  }

  let text: string;
  try {
    text = fs.readFileSync(entry.path, "utf8");
  } catch {
    return block(
      "the file this entry describes is gone",
      `rollback cannot read ${entry.path}. Restore the file, then re-run.`,
    );
  }

  // ROLLBACK VERIFIES THE SPAN, NOT THE FILE (codex r2 #2).
  //
  // The previous cut required the recorded head and tail hashes to match, which made
  // every edit ANYWHERE ELSE in the file block a rollback of an untouched span — add a
  // sentence to the intro and the undo stops working. A span replace is span-scoped
  // going forward and it has to be span-scoped coming back.
  //
  // The recorded offset survives as a DISAMBIGUATION HINT, not a precondition.
  const located = locateRegion(text, entry);
  if (located.ok !== true) return block(located.detail, located.question);

  const regionStart = located.start;
  const region = text.slice(regionStart, regionStart + entry.applied_span.length);
  if (sha256(region) !== entry.after_hash) {
    return block(
      "the span drifted after the delta landed; the recorded inverse no longer describes it",
      `the span '${entry.span}' in ${entry.path} changed after this evolve. Restoring would ` +
        `discard that change. Review it, then re-run rollback.`,
    );
  }

  // D5 on the way back too. Every recorded delta was screened when it landed, so a
  // permission edit here means the history was not written by the evolve writer.
  // Rollback is not a side door around proposal-only permissions.
  const d5 = classifyPermissionContent({ span: entry.span, beforeSpan: region, replacement: entry.inverse_span });
  if (d5.isPermissionEdit) {
    return block(
      `permissions are proposal-only (D5): ${d5.detail}`,
      `rollback of '${entry.span}' in ${entry.path} would change permissions. Apply it by hand.`,
    );
  }

  const next =
    text.slice(0, regionStart) +
    entry.inverse_span +
    text.slice(regionStart + entry.applied_span.length);
  atomicWriteDurable(entry.path, next);
  return {
    ...base,
    status: "restored",
    detail:
      entry.applied_span === ""
        ? "re-inserted the removed span at its recorded context"
        : "restored the span from compact history",
  };
}

type RegionHit =
  | { ok: true; start: number }
  | { ok: false; detail: string; question: string };

/**
 * Where the recorded region sits in the file NOW.
 *
 * Two shapes, because a `remove` deletes the very anchor every other op is found by:
 *
 *   - a REPLACE/ADD is found by its anchor line, which must occur exactly once. Zero
 *     matches or two are both "this anchor no longer identifies one span", and the
 *     first cut broke that tie by taking the first hit and restoring the wrong one.
 *   - a REMOVE is found by the bytes that surrounded it, which must join exactly once.
 *     That is what makes a removal's inverse self-sufficient without pinning the whole
 *     file.
 *
 * The recorded offset is consulted only to break a context tie, never as a gate.
 */
function locateRegion(text: string, entry: EvolveHistoryEntry): RegionHit {
  if (entry.applied_span === "") return locateRemoval(text, entry);

  const anchors = allAnchorIndexes(text, entry.anchor);
  if (anchors.length === 0) {
    return {
      ok: false,
      detail: `anchor '${entry.anchor}' is no longer in the file`,
      question: `rollback cannot find the span '${entry.span}' in ${entry.path}. Review it by hand.`,
    };
  }
  if (anchors.length > 1) {
    return {
      ok: false,
      detail: `anchor '${entry.anchor}' appears ${anchors.length} times; it no longer identifies one span`,
      question:
        `the span '${entry.span}' in ${entry.path} is no longer unique. Review it by hand, ` +
        `then re-run rollback.`,
    };
  }
  const start = anchors[0] - (entry.anchor_in_span ?? 0);
  if (start < 0 || start + entry.applied_span.length > text.length) {
    return {
      ok: false,
      detail: "the recorded region no longer fits the file around its anchor",
      question: `the file ${entry.path} changed shape after this evolve. Review it, then re-run rollback.`,
    };
  }
  return { ok: true, start };
}

/**
 * Where a REMOVED span used to sit.
 *
 * A removal deleted its own anchor, so the only locator left is the text that
 * surrounded it. Three attempts, narrowing as they go, because an unrelated edit
 * elsewhere in the file must not block the undo (r2 #2) and the recorded window is
 * wide enough to reach such an edit:
 *
 *   1. both sides joined — the strongest match;
 *   2. the PRECEDING text alone, insert after it;
 *   3. the FOLLOWING text alone, insert before it.
 *
 * Each attempt requires a UNIQUE hit. Ambiguity is broken by the recorded offset only
 * when one candidate lands exactly on it; otherwise it blocks.
 */
function locateRemoval(text: string, entry: EvolveHistoryEntry): RegionHit {
  const beforeCtx = entry.context_before ?? "";
  const afterCtx = entry.context_after ?? "";

  if (beforeCtx === "" && afterCtx === "") {
    // The removal took the whole file. The only sane insertion point is the start.
    return text === ""
      ? { ok: true, start: 0 }
      : {
          ok: false,
          detail: "the removal recorded no surrounding context to re-insert against",
          question: `rollback cannot place the span '${entry.span}' back into ${entry.path}. Review it by hand.`,
        };
  }

  // Three locators, narrowing. Each is tried only when the one before it found
  // NOTHING; the first one that finds anything DECIDES, and it decides `blocked` when
  // what it found is not unique.
  //
  // The previous cut broke a tie by preferring the hit that sat on the recorded
  // offset, and that is exactly the attack: prepend a copy of the remaining file and
  // the duplicate sits at the old offset, so rollback restored into the copy and
  // reported success (r3 #2). A recorded offset cannot disambiguate a file that has
  // been shifted — it is the thing the shift invalidates. So there is no tie-break:
  // ambiguity blocks, and a human says which one.
  const attempts: Array<{ needle: string; insertOffset: number; label: string }> = [];
  if (beforeCtx !== "" && afterCtx !== "") {
    attempts.push({
      needle: beforeCtx + afterCtx,
      insertOffset: beforeCtx.length,
      label: "the text on both sides of the removal",
    });
  }
  if (beforeCtx !== "") {
    attempts.push({
      needle: beforeCtx,
      insertOffset: beforeCtx.length,
      label: "the text preceding the removal",
    });
  }
  if (afterCtx !== "") {
    attempts.push({ needle: afterCtx, insertOffset: 0, label: "the text following the removal" });
  }

  for (const { needle, insertOffset, label } of attempts) {
    const hits = allIndexesOf(text, needle);
    if (hits.length === 0) continue;
    if (hits.length === 1) return { ok: true, start: hits[0] + insertOffset };
    return {
      ok: false,
      detail: `${label} appears ${hits.length} times; the re-insertion point is ambiguous`,
      question:
        `rollback cannot place '${entry.span}' unambiguously in ${entry.path} — the surrounding ` +
        `text now appears ${hits.length} times. Review it by hand, then re-run rollback.`,
    };
  }

  return {
    ok: false,
    detail: "the text that surrounded the removed span is no longer in the file",
    question: `rollback cannot find where '${entry.span}' was removed from ${entry.path}. Review it by hand.`,
  };
}

/** Every index at which the anchor occurs as a WHOLE LINE. */
function allAnchorIndexes(text: string, anchor: string): number[] {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}$`, "gm");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m.index);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/** Every index of a literal substring. */
function allIndexesOf(text: string, needle: string): number[] {
  const out: number[] = [];
  let i = text.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = text.indexOf(needle, i + 1);
  }
  return out;
}

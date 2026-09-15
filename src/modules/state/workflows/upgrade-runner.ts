/**
 * src/modules/state/workflows/upgrade-runner.ts
 *
 * THE LAYOUT UPGRADE CHAIN (U-UPG, R39, KTD23). Detect → lock → journal → steps →
 * validate → stamp. One Guild root, on activation of THIS cwd.
 *
 * The five things this runner refuses to do, each of them a stated constraint:
 *
 *   1. It NEVER scans the disk for Guild roots. The unit is the root resolved from
 *      the cwd it was handed; children are reached only by an explicit
 *      `config migrate --workspace` fan-out the operator typed.
 *   2. It NEVER auto-commits. A durable upgrade is a git-visible diff the operator
 *      reviews. The report says so; the runner does not run git write commands.
 *   3. It NEVER writes the marker before validation. `validate()` runs on the
 *      post-step tree; only a clean validation stamps `storage_layout_version`.
 *   4. It NEVER down-migrates. A marker ahead of this build fails closed at
 *      `ensureStorageLayout`, before a single step is loaded.
 *   5. It NEVER deletes a path that is not classified derived. A step that asks to
 *      returns `blocked_confirm`; the runner records the question and stops.
 *
 * DIRTY DURABLE (§21.3). Safe-local steps always run. A durable step whose declared
 * `affects` prefixes intersect the dirty tracked set under `.guild/` does NOT run:
 * the v1 content stays exactly where it is, the journal records
 * `blocked_dirty_durable` with the exact paths, and the root keeps reading v1
 * (compatibility-read) until the operator commits or stashes and re-runs.
 *
 * CONTRACT: the ONLY process this file spawns is a scoped, read-only
 * `git status --porcelain -- .guild`, through an injectable seam.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { createGuildStorage, type GuildStorage } from "./storage-layout";
import { guildRootId } from "./storage-roots";
import { lstatSafe, readdirSafe } from "./storage-fs";
import { DURABLE_SUBTREES } from "./storage-policy";
import {
  acquireLock,
  loadJournal,
  newJournal,
  recordStep,
  saveJournal,
  settledSteps,
  upgradeJournalPath,
  upgradeLockPath,
  type UpgradeJournal,
  type UpgradeState,
} from "./upgrade-journal";
import {
  UPGRADE_STEPS,
  type PolicyClassifier,
  type UpgradeStepContext,
  type V1ContentConverter,
} from "./upgrade-steps";

/** Repo-relative paths git reports as dirty under `.guild/`, or `null` when unknown. */
export type DirtyProbe = (root: string) => string[] | null;

/**
 * Scoped, read-only git probe. Scoped to `.guild` on purpose: the upgrade has no
 * opinion about the rest of the repo, and widening this to a whole-tree status
 * would make every working branch block the upgrade.
 *
 * UNTRACKED entries (`??`) are dropped: §21.3 protects uncommitted changes to
 * TRACKED knowledge. A `.guild/` that was never committed has nothing to lose to a
 * durable step, and treating it as dirty would block every first upgrade.
 *
 * A repo-less directory (no git at all) reports `[]` — nothing tracked is dirty
 * because nothing is tracked. An UNREADABLE git (git missing, broken index)
 * reports `null`, which the runner treats as "assume dirty" and blocks durable
 * steps: failing closed is the only safe reading of "I could not check".
 */
export function defaultDirtyProbe(root: string): string[] | null {
  if (!fs.existsSync(path.join(root, ".git"))) return [];
  let out: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    out = execFileSync("git", ["status", "--porcelain", "--", ".guild"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  return out
    .split("\n")
    .filter((line) => line.length > 3 && !line.startsWith("??"))
    .map((line) => line.slice(3).trim())
    .map((p) => (p.includes(" -> ") ? p.split(" -> ")[1] : p))
    .map((p) => p.replace(/^"|"$/g, "").replace(/\/+$/, ""))
    .filter((p) => p.length > 0);
}

export interface UpgradeOptions {
  cwd: string;
  /** Target layout. Defaults to the build's CURRENT_LAYOUT_VERSION. */
  toVersion: number;
  fromVersion: number | null;
  /** Compute the plan, write NOTHING (not even the journal). */
  dryRun?: boolean;
  storage?: GuildStorage;
  dirtyProbe?: DirtyProbe;
  now?: () => string;
  nowMs?: () => number;
  /** The v1 converter, injected by the host-facing entry point. */
  v1?: V1ContentConverter;
  /** The closed policy-key contract, injected by the same entry point (KTD29). */
  policy?: PolicyClassifier;
}

export interface UpgradeResult {
  root: string;
  state: UpgradeState;
  from_version: number | null;
  to_version: number;
  /** Written only when the run reached `committed`. */
  marker_written: boolean;
  journal_path: string;
  journal: UpgradeJournal;
  /** Exact dirty tracked paths; non-empty only for `blocked_dirty_durable`. */
  dirty_paths: string[];
  /** Verbatim question when the state is `blocked_confirm`. */
  question: string | null;
  /** Validation failures, when the chain reached `validating` and did not pass. */
  validation_errors: string[];
}

/** The marker, named off the storage API's durable root — never joined by hand (KTD15). */
function markerFile(storage: GuildStorage): string {
  return path.join(storage.root.durable, "storage-layout.json");
}

/** Hash-free snapshot of the profiles that must survive untouched by feedstock. */
function agentProfiles(guildDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const dir = path.join(guildDir, "agents");
  for (const name of readdirSafe(dir)) {
    if (!name.endsWith(".md")) continue;
    const abs = path.join(dir, name);
    const st = lstatSafe(abs);
    if (!st?.isFile()) continue;
    try {
      out.set(name, fs.readFileSync(abs, "utf8"));
    } catch {
      /* unreadable profile: not something the upgrade wrote, so not its business */
    }
  }
  return out;
}

/**
 * Post-step validation (§21.16). Deliberately narrow: it checks the invariants this
 * chain could have broken, not the whole tree. A check it cannot perform is not a
 * pass — it is simply not claimed.
 */
export function validateUpgrade(
  guildDir: string,
  before: { profiles: Map<string, string>; knowledgePages: number },
  /** The canonical knowledge tree, named by the storage API (KTD15). */
  knowledgeDir: string = path.join(guildDir, DURABLE_SUBTREES.knowledge),
  /** Every step the journal recorded for this run. A step that did not settle
   *  successfully is a validation error: the marker is never stamped over it. */
  steps: readonly { step_id: string; status: string }[] = [],
): string[] {
  const errors: string[] = [];

  // The marker means "this root IS layout N". Only `completed` (the step did its
  // work) and `skipped` (the step re-detected that there was nothing to do) settle
  // successfully. `failed`, `blocked_confirm` and `blocked_dirty` do not, and a
  // caller that reaches validation with one of them recorded gets a hard error
  // rather than a stamp.
  for (const step of steps) {
    if (step.status === "completed" || step.status === "skipped") continue;
    errors.push(`step ${step.step_id} did not complete (${step.status}) — refusing to stamp the marker`);
  }

  // Existing specialist profiles are never overwritten with feedstock (U-UPG).
  const after = agentProfiles(guildDir);
  for (const [name, body] of before.profiles) {
    const now = after.get(name);
    if (now === undefined) errors.push(`agents/${name} disappeared during upgrade`);
    else if (now !== body) errors.push(`agents/${name} was rewritten during upgrade (feedstock must never replace it)`);
  }

  // Knowledge is preserved: the upgrade may ADD pages (the glossary) but never lose one.
  const pagesNow = countKnowledgePages(knowledgeDir);
  if (pagesNow < before.knowledgePages) {
    errors.push(`knowledge page count fell from ${before.knowledgePages} to ${pagesNow} — knowledge was lost`);
  }

  // No derived cache may remain under `.guild/` after `caches-out` ran.
  for (const leftover of ["indexes", "index.sqlite"]) {
    if (lstatSafe(path.join(guildDir, leftover))) errors.push(`.guild/${leftover} still present after caches-out`);
  }

  return errors;
}

function countKnowledgePages(dir: string, seen = 0): number {
  let n = seen;
  for (const name of readdirSafe(dir)) {
    const abs = path.join(dir, name);
    const st = lstatSafe(abs);
    if (!st) continue;
    if (st.isDirectory()) n = countKnowledgePages(abs, n);
    else if (st.isFile() && name.endsWith(".md")) n += 1;
  }
  return n;
}

/**
 * Run (or resume) the chain for ONE root.
 *
 * Resume is free: the journal's settled step ids are skipped, and because every
 * step re-detects its own need, a step that ran but was not journaled (crash
 * between the write and the append) reports `skipped` the second time.
 */
export function runUpgrade(opts: UpgradeOptions): UpgradeResult {
  const storage = opts.storage ?? createGuildStorage(opts.cwd);
  const root = storage.activeRoot;
  const guildDir = storage.root.durable;
  const dryRun = opts.dryRun === true;
  const now = opts.now ?? (() => new Date().toISOString());
  const nowMs = opts.nowMs ?? (() => Date.now());
  const journalFile = upgradeJournalPath((...s) => storage.runtime(...s));
  const lockFile = upgradeLockPath((...s) => storage.runtime(...s));

  const base = (state: UpgradeState, journal: UpgradeJournal, extra: Partial<UpgradeResult> = {}): UpgradeResult => ({
    root,
    state,
    from_version: opts.fromVersion,
    to_version: opts.toVersion,
    marker_written: false,
    journal_path: journalFile,
    journal: { ...journal, state },
    dirty_paths: journal.dirty_paths,
    question: null,
    validation_errors: [],
    ...extra,
  });

  let journal =
    loadJournal(journalFile) ??
    newJournal({ rootId: guildRootId(root), root, fromVersion: opts.fromVersion, toVersion: opts.toVersion, now: now() });
  // A journal left over from a DIFFERENT target version is not this upgrade's.
  if (journal.to_version !== opts.toVersion) {
    journal = newJournal({
      rootId: guildRootId(root),
      root,
      fromVersion: opts.fromVersion,
      toVersion: opts.toVersion,
      now: now(),
    });
  }

  // The lock is a WRITE. A dry run inspects without taking it, so `--mode=dry-run`
  // can never block a concurrent real upgrade.
  const lock = dryRun ? null : acquireLock(lockFile, nowMs());
  if (!dryRun && !lock) {
    return base("running", journal);
  }

  try {
    const dirtyRaw = (opts.dirtyProbe ?? defaultDirtyProbe)(root);
    // `null` = could not check. Fail closed: treat the durable surface as dirty.
    const dirty = dirtyRaw ?? [".guild"];
    journal = { ...journal, dirty_paths: dirty, state: "running" };

    const knowledgeDir = (storage.project ?? storage.workspace)!.knowledge();
    const before = { profiles: agentProfiles(guildDir), knowledgePages: countKnowledgePages(knowledgeDir) };
    const settled = settledSteps(journal);
    const ctx: UpgradeStepContext = { root, guildDir, storage, dryRun, now, v1: opts.v1, policy: opts.policy };

    let blockedDirty = false;
    for (const step of UPGRADE_STEPS) {
      if (settled.has(step.id)) continue;

      if (step.cls === "durable") {
        const hits = dirty.filter((p) => step.affects.some((a) => p === a || p.startsWith(`${a}/`) || a.startsWith(p)));
        if (hits.length > 0) {
          blockedDirty = true;
          journal = recordStep(journal, {
            step_id: step.id,
            status: "blocked_dirty",
            cls: step.cls,
            detail: `durable step blocked by uncommitted tracked changes: ${hits.join(", ")}`,
            paths: hits,
            at: now(),
          });
          continue;
        }
      }

      let result;
      try {
        result = step.apply(ctx);
      } catch (e) {
        journal = recordStep(journal, {
          step_id: step.id,
          status: "failed",
          cls: step.cls,
          detail: (e as Error).message,
          paths: [],
          at: now(),
        });
        if (!dryRun) saveJournal(journalFile, { ...journal, state: "failed" });
        return base("failed", journal);
      }

      journal = recordStep(journal, {
        step_id: step.id,
        status: result.status === "blocked_confirm" ? "blocked_confirm" : result.status,
        cls: step.cls,
        detail: result.detail,
        paths: result.paths,
        question: result.question,
        at: now(),
      });

      if (result.status === "blocked_confirm") {
        if (!dryRun) saveJournal(journalFile, { ...journal, state: "blocked_confirm" });
        return base("blocked_confirm", journal, { question: result.question ?? null });
      }
      if (result.status === "failed") {
        if (!dryRun) saveJournal(journalFile, { ...journal, state: "failed" });
        return base("failed", journal);
      }
    }

    if (blockedDirty) {
      if (!dryRun) saveJournal(journalFile, { ...journal, state: "blocked_dirty_durable" });
      return base("blocked_dirty_durable", journal, { dirty_paths: dirty });
    }

    // ── Validation, THEN the marker. Never the other way round (§21.16). ──
    journal = { ...journal, state: "validating", updated_at: now() };
    if (!dryRun) saveJournal(journalFile, journal);
    const errors = dryRun ? [] : validateUpgrade(guildDir, before, knowledgeDir, journal.entries);
    if (errors.length > 0) {
      if (!dryRun) saveJournal(journalFile, { ...journal, state: "failed" });
      return base("failed", journal, { validation_errors: errors });
    }

    if (dryRun) return base("planned", journal);

    fs.mkdirSync(guildDir, { recursive: true });
    fs.writeFileSync(
      markerFile(storage),
      `${JSON.stringify({ storage_layout_version: opts.toVersion, upgraded_at: now() }, null, 2)}\n`,
      "utf8",
    );
    journal = { ...journal, state: "committed", updated_at: now() };
    saveJournal(journalFile, journal);
    return base("committed", journal, { marker_written: true });
  } finally {
    lock?.release();
  }
}

/** One compact block for `config migrate` and the T0 report. Never auto-committed. */
export function formatUpgradeReport(result: UpgradeResult): string {
  const lines: string[] = [
    `layout upgrade ${result.from_version ?? "unmarked"} → ${result.to_version} · ${result.state} · ${result.root}`,
  ];
  for (const e of result.journal.entries) {
    lines.push(`  [${e.status}] ${e.step_id} (${e.cls}) — ${e.detail}`);
  }
  if (result.state === "blocked_dirty_durable") {
    lines.push("  durable steps blocked by uncommitted tracked changes under .guild/:");
    for (const p of result.dirty_paths) lines.push(`    ${p}`);
    lines.push("  commit or stash those paths, then: guild config migrate --mode=migrate");
  }
  if (result.question) lines.push(`  CONFIRM NEEDED: ${result.question}`);
  for (const e of result.validation_errors) lines.push(`  VALIDATION: ${e}`);
  if (result.marker_written) {
    lines.push("  marker stamped. Review the git diff and commit the upgrade as one change (Guild never commits).");
  }
  return lines.join("\n");
}

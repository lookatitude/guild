/**
 * scripts/dot-guild/convert/index.ts — the public converter API + the
 * `/guild:migrate`-style entry function W1c (SessionStart) and the CLI both call.
 *
 * Public surface:
 *   detect(fs, guildDir)                          → DetectResult   (SC-1)
 *   snapshot(fs, clock, guildDir)                 → SnapshotResult (SC-3)
 *   convert(fs, clock, guildDir, dryRun, ref)     → ConvertOutput  (SC-4)
 *   renderReport(child, mode, iso)                → string
 *   runMigration(opts)                            → MigrationResult (the entry point)
 *
 * runMigration is the single callable W1c wires into SessionStart and the explicit
 * command both invoke. It does discovery (per-repo / workspace, SC-5), then per
 * child: detect → (on v1/mixed + mode=migrate) snapshot+verify → convert → report;
 * (mode=dry-run) detect → report-only, write nothing; (mode=skip / v2 / none /
 * corrupt) the appropriate no-op/blocked path. A child failure never aborts another.
 */

import * as path from "path";
import type {
  Fs,
  Clock,
  Mode,
  MigrationResult,
  ChildResult,
  DetectResult,
} from "./types";
import { realFs, realClock, parseJson } from "./seams";
import { detect } from "./detect";
import { snapshot } from "./snapshot";
import { convert } from "./convert";
import { renderReport, reportFileName } from "./report";

export { detect } from "./detect";
export { snapshot } from "./snapshot";
export { convert } from "./convert";
export { renderReport, reportFileName } from "./report";
export { SCHEMA_STAMP_RE } from "./detect";
export { UNMIGRATED_STAMP } from "./keymap";
export * from "./types";

export interface RunMigrationOptions {
  /** Repo root (its `.guild/` is the unit). For a workspace, the root whose children are scanned. */
  root: string;
  mode: Mode;
  /** Injectable seams (default real fs/clock). */
  fs?: Fs;
  clock?: Clock;
  /** When true, treat `root` as a workspace and fan out to children (SC-5). Default: auto-detect. */
  workspace?: boolean;
}

/**
 * The entry point. Returns a structured result; writes the report (and, on
 * migrate, the converted artifacts) via the injected Fs.
 */
export function runMigration(opts: RunMigrationOptions): MigrationResult {
  const fs = opts.fs ?? realFs;
  const clock = opts.clock ?? realClock;
  const mode = opts.mode;

  const units = discoverUnits(fs, opts.root, opts.workspace);
  const children: ChildResult[] = [];
  for (const root of units.roots) {
    try {
      children.push(processChild(fs, clock, root, mode));
    } catch (e) {
      // Child failure must NOT abort siblings (SC-5 independence).
      const guildDir = path.join(root, ".guild");
      children.push({
        root,
        guildDir,
        detect: { classification: "none", m1: false, m2: false, hasUnparseable: false, evidence: [], unparseable: [] },
        action: "error",
        artifacts: [],
        relocated: [],
        conflicts: [],
        reportPath: path.join(guildDir, reportFileName(clock.stamp())),
        reportBody: "",
        error: (e as Error).message,
      });
    }
  }

  return { children, workspace: units.workspace };
}

interface Units {
  roots: string[];
  workspace: boolean;
}

/**
 * Validate that `childRel` (from workspace.json sub_guilds) resolves to an
 * IMMEDIATE child of `root` — depth-1, no `..`, not absolute-outside-root.
 *
 * Returns the resolved absolute path if valid, or null if rejected. Rejecting
 * prevents path-traversal: a crafted workspace.json could otherwise point at
 * an arbitrary directory on disk and cause runMigration to mutate it.
 *
 * Rules (P2 workspace path-traversal fix):
 *   - Must not be absolute (an absolute path is either the root itself or
 *     something entirely outside it).
 *   - After resolving, dirname of the result must equal the resolved root
 *     (i.e. exactly one level deep).
 *   - The basename must not be "." or "..".
 */
function validateImmediateChild(root: string, childRel: string): string | null {
  // Reject bare absolute paths.
  if (path.isAbsolute(childRel)) return null;
  const resolved = path.resolve(root, childRel);
  const resolvedRoot = path.resolve(root);
  // Must be exactly one directory level below root.
  if (path.dirname(resolved) !== resolvedRoot) return null;
  const base = path.basename(resolved);
  if (base === "." || base === "..") return null;
  return resolved;
}

/**
 * Discover the units to migrate (SC-5). One `.guild/` per repo root; never nested,
 * never below depth 1. Workspace discovery uses `.guild/workspace.json` sub_guilds
 * (if present) or the immediate-child `.git`/`.guild` rule.
 */
function discoverUnits(fs: Fs, root: string, forceWorkspace?: boolean): Units {
  const rootGuild = path.join(root, ".guild");
  const workspaceJson = path.join(rootGuild, "workspace.json");

  // Explicit non-workspace (single repo).
  if (forceWorkspace === false) {
    return { roots: [root], workspace: false };
  }

  let childRoots: string[] = [];
  let isWorkspace = forceWorkspace === true;

  if (fs.existsSync(workspaceJson)) {
    const res = parseJson(fs.readFileSync(workspaceJson));
    if (res.ok && res.value && typeof res.value === "object") {
      const sub = (res.value as Record<string, unknown>)["sub_guilds"];
      if (Array.isArray(sub) && sub.length > 0) {
        isWorkspace = true;
        for (const s of sub) {
          const childRel = typeof s === "string" ? s : (s as Record<string, unknown>)?.["path"];
          if (typeof childRel === "string") {
            const validated = validateImmediateChild(root, childRel);
            if (validated) childRoots.push(validated);
            // else: skip and flag — absolute path / ".." escape / depth > 1 is rejected
          }
        }
      }
    }
  }

  // Auto workspace: run the immediate-child depth-1 scan in both
  // explicit-workspace (forceWorkspace=true) and auto-detect (forceWorkspace=undefined).
  // `path.join(root, e.name)` is already depth-1 safe since `e.name` is a simple
  // readdir basename (never `..` or absolute) — no additional path guard needed here.
  if (childRoots.length === 0) {
    // Immediate-child rule (depth-1 only): a child dir with .git AND/OR .guild.
    if (fs.existsSync(root)) {
      let entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>;
      try {
        entries = fs.readdirSync(root);
      } catch {
        entries = [];
      }
      for (const e of entries) {
        if (!e.isDirectory) continue;
        const childRoot = path.join(root, e.name);
        if (fs.existsSync(path.join(childRoot, ".guild")) || fs.existsSync(path.join(childRoot, ".git"))) {
          childRoots.push(childRoot);
        }
      }
      if (childRoots.length > 0) isWorkspace = true;
    }
  }

  // The workspace root `.guild/` is itself one unit (§3 workspace row).
  const roots = isWorkspace ? [root, ...childRoots] : [root];
  // De-dup while preserving order.
  const seen = new Set<string>();
  const uniqueRoots = roots.filter((r) => (seen.has(r) ? false : (seen.add(r), true)));
  return { roots: uniqueRoots, workspace: isWorkspace };
}

/** Process a single repo's `.guild/` end-to-end. */
function processChild(fs: Fs, clock: Clock, root: string, mode: Mode): ChildResult {
  const guildDir = path.join(root, ".guild");
  const det: DetectResult = detect(fs, guildDir);
  const stamp = clock.stamp();
  const reportPath = path.join(guildDir, reportFileName(stamp));

  const base: ChildResult = {
    root,
    guildDir,
    detect: det,
    action: "none",
    artifacts: [],
    relocated: [],
    conflicts: [],
    reportPath,
    reportBody: "",
  };

  // ── none ⇒ silent (no report file; the SessionStart leg stays silent). ─────
  if (det.classification === "none") {
    base.action = "none";
    base.reportBody = renderReport(base, mode, clock.iso());
    return base; // not written to disk (caller/CLI decides; runMigration writes only on action)
  }

  // ── corrupt ⇒ block ALL writes; snapshot allowed; surfaced report. ─────────
  if (det.classification === "corrupt") {
    base.action = "corrupt-blocked";
    if (mode === "migrate") {
      const snap = snapshot(fs, clock, guildDir);
      base.snapshot = snap;
    }
    base.reportBody = renderReport(base, mode, clock.iso());
    writeReport(fs, base);
    return base;
  }

  // ── v2 ⇒ no-op for conversion. Advisory only (local-only deprecated alias). ─
  if (det.classification === "v2") {
    // A truly-v2 tree has no v1 key (else it would be `mixed`). But scan for a
    // local-only deprecated alias advisory is handled by detect (it would set M1
    // ⇒ mixed). So a pure v2 tree here ⇒ true no-op. (CF-W1c-1: silent.)
    base.action = "v2-noop";
    base.reportBody = renderReport(base, mode, clock.iso());
    return base; // silent — no report file, no prompt.
  }

  // ── v1 / mixed ⇒ the actionable path. ─────────────────────────────────────
  if (mode === "skip") {
    base.action = "skip";
    base.reportBody = renderReport(base, mode, clock.iso());
    writeReport(fs, base); // skip still produces its audit trail (P3 fix)
    return base;
  }

  if (mode === "dry-run") {
    base.action = "dry-run";
    // Compute the plan WITHOUT a snapshot and WITHOUT writing anything.
    const out = convert(fs, clock, guildDir, /*dryRun*/ true, "(dry-run — no snapshot)");
    base.artifacts = out.artifacts;
    base.relocated = out.relocated;
    base.conflicts = out.conflicts;
    base.reportBody = renderReport(base, mode, clock.iso());
    writeReport(fs, base); // dry-run STILL emits the report (it writes nothing else)
    return base;
  }

  // mode === "migrate": snapshot+verify FIRST, then convert.
  base.action = "migrate";
  const snap = snapshot(fs, clock, guildDir);
  base.snapshot = snap;
  if (!snap.verified) {
    base.error = `snapshot verify failed at ${snap.mismatch} — conversion aborted (snapshot left for inspection)`;
    base.reportBody = renderReport(base, mode, clock.iso());
    writeReport(fs, base);
    return base;
  }

  const out = convert(fs, clock, guildDir, /*dryRun*/ false, snap.destRel);
  base.artifacts = out.artifacts;
  base.relocated = out.relocated;
  base.conflicts = out.conflicts;
  base.restoreCommand = buildRestore(snap.destRel, out.removed, out.generated);
  base.reportBody = renderReport(base, mode, clock.iso());
  writeReport(fs, base);
  return base;
}

/**
 * §4.1 one-line restore command.
 *
 * P1 fix: a correct rollback must (a) remove GENERATED v2 files that were not in
 * the snapshot (settings.json, .unmigrated-v1.json, run.yaml, provenance.json) AND
 * (b) copy the snapshot over the live tree.  Without (a), `cp -R` does not delete
 * new files absent from the snapshot, leaving the tree mixed/modified after restore.
 *
 * Command: rm the removed + generated files, then copy snapshot back.
 */
function buildRestore(destRel: string, removed: string[], generated: string[]): string {
  const toDelete = [...removed, ...generated];
  const rmPart = toDelete.length
    ? `rm -f ${toDelete.map((p) => `.guild/${p}`).join(" ")} && `
    : "";
  return `${rmPart}cp -R .guild/${destRel}/. .guild/`;
}

/** Write the report file unless the classification is silent (v2/none). */
function writeReport(fs: Fs, child: ChildResult): void {
  // none + v2 are silent: never write a report file (CF-W1c-1).
  if (child.detect.classification === "none" || child.action === "v2-noop") return;
  fs.writeFileSync(child.reportPath, child.reportBody);
}

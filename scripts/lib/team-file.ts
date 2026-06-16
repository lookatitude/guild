/**
 * scripts/lib/team-file.ts
 *
 * T1 (G-PHASE-COMPOSE) — the per-phase team-file resolver + active-phase reader +
 * `.current` pointer I/O. The team artifact moves from one `.guild/team/<slug>.yaml`
 * per slug to one `.guild/team/<slug>.<phase>.yaml` PER PHASE entered, fronted by a
 * back-compat resolver and a convenience `.current` pointer.
 *
 * Design source: audit/dynamic-team-composition.md §5 + phase-compose-plan.md §2/§3.
 * NON-THROWING readers (mirror loadRunState / readResolvedSettingsSnapshot): a
 * missing/corrupt file or a non-canonical token degrades to null/fallback, never an
 * exception. The ONE intentional throw is `teamFilePath` on a non-canonical token —
 * a bad token must never become a filename like `team.../etc.yaml` (G-plan MAJOR-3/§6.9).
 *
 * Phase-token validation is single-sourced to CANONICAL_PHASES (run-lifecycle.ts) —
 * the same set T0's appendPhase enforces.
 *
 * Contract pointers:
 *   - CANONICAL_PHASES / isCanonicalPhase: scripts/lib/run-lifecycle.ts (T0).
 *   - resolveGuildRoot: hooks/lib/guild-root.ts (reused, no new resolver — plan §0).
 *   - phases_log shape: written by run-lifecycle startRun + T0 appendPhase.
 */

import * as fs from "fs";
import * as path from "path";
import { CANONICAL_PHASES, isCanonicalPhase } from "./run-lifecycle";
import { parseYaml } from "./frontmatter";
// Extensionless cross-dir import (scripts/ convention): tsx + ts-jest both resolve
// it to guild-root.ts, which is self-contained (node:fs/node:path only). A `.js`
// suffix here would break ts-jest's commonjs resolver (no .js→.ts remap).
import { resolveGuildRoot } from "../../hooks/lib/guild-root";

// Re-export the canonical set so consumers can import it from the team-file module
// without reaching into run-lifecycle (single import surface for the phase vocabulary).
export { CANONICAL_PHASES, isCanonicalPhase };

// ── Path builders ─────────────────────────────────────────────────────────────

/** `.guild/team/` for a guild root. */
function teamDir(guildRoot: string): string {
  return path.join(guildRoot, ".guild", "team");
}

/**
 * Per-phase team-file path: `.guild/team/<slug>.<phase>.yaml`.
 *
 * THROWS on a non-canonical `phase` (G-plan MAJOR-3): the filesystem-safety guarantee
 * is a property of this builder, not prose around the writer — a bad `phases_log`
 * token can never be turned into a filename. Callers that want tolerant behavior
 * (resolveTeamFile) guard the token BEFORE calling this.
 */
export function teamFilePath(guildRoot: string, slug: string, phase: string): string {
  if (!isCanonicalPhase(phase)) {
    throw new Error(
      `team-file: non-canonical phase "${phase}" — must be one of ${CANONICAL_PHASES.join(", ")}`,
    );
  }
  return path.join(teamDir(guildRoot), `${slug}.${phase}.yaml`);
}

/** Legacy single-file team path: `.guild/team/<slug>.yaml` (read-only back-compat). */
export function legacyTeamFilePath(guildRoot: string, slug: string): string {
  return path.join(teamDir(guildRoot), `${slug}.yaml`);
}

/**
 * C4 (G-PHASE-COMPOSE): recover the slug from a team-file path. Tolerates BOTH the
 * legacy `<slug>.yaml` and the per-phase `<slug>.<phase>.yaml` basename — a trailing
 * `.<canonical-phase>` segment is stripped so both forms yield the same slug. A
 * dotted slug whose trailing segment is NOT a canonical phase (e.g. `v1.2-plan`) is
 * never truncated. Inverse of teamFilePath / legacyTeamFilePath.
 */
export function slugFromTeamPath(teamPath: string): string {
  const base = path.basename(teamPath);
  const noYaml = base.replace(/\.ya?ml$/i, "");
  const lastDot = noYaml.lastIndexOf(".");
  if (lastDot > 0 && isCanonicalPhase(noYaml.slice(lastDot + 1))) {
    return noYaml.slice(0, lastDot);
  }
  return noYaml;
}

/** `.guild/team/<slug>.current` — the convenience phase-pointer mirror. */
function currentPointerPath(guildRoot: string, slug: string): string {
  return path.join(teamDir(guildRoot), `${slug}.current`);
}

// ── `.current` pointer I/O ────────────────────────────────────────────────────

/**
 * Read the `.current` pointer's phase token, or null when absent/corrupt/non-canonical.
 * The pointer is a one-line UTF-8 plaintext file containing `<phase>\n` (NOT a symlink).
 * Tolerant: any read error or non-canonical content → null (the mirror is never authority).
 */
export function readCurrentPhasePointer(guildRoot: string, slug: string): string | null {
  try {
    const raw = fs.readFileSync(currentPointerPath(guildRoot, slug), "utf8").trim();
    return isCanonicalPhase(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Write the `.current` pointer atomically (temp-then-rename), content = `<phase>\n`.
 * VALIDATES the token first (throws on non-canonical — same safety as teamFilePath).
 * Creates `.guild/team/` if absent. Never writes a symlink.
 */
export function writeCurrentPhasePointer(guildRoot: string, slug: string, phase: string): void {
  if (!isCanonicalPhase(phase)) {
    throw new Error(
      `team-file: refusing to write .current with non-canonical phase "${phase}"`,
    );
  }
  const dir = teamDir(guildRoot);
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = currentPointerPath(guildRoot, slug);
  // Atomic temp-then-rename (mirrors writeRunStateAtomic in run-state.ts).
  const tmp = path.join(dir, `.${slug}.current.tmp-${process.pid}`);
  fs.writeFileSync(tmp, `${phase}\n`, "utf8");
  fs.renameSync(tmp, finalPath);
}

// ── Active-phase read (run-state authority — OQ1) ─────────────────────────────

/** `.guild/runs/current-run-id` sentinel content, or null. */
function readSentinelRunId(guildRoot: string): string | null {
  try {
    const v = fs.readFileSync(
      path.join(guildRoot, ".guild", "runs", "current-run-id"),
      "utf8",
    ).trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Read the active phase for a run from run-state (the OQ1 authority).
 *
 * Source: `.guild/runs/<runId>/run.yaml`. Value: the LAST `phases_log[].phase`
 * entry, else the top-level `phase:` field, else null. The token is validated
 * against CANONICAL_PHASES — a corrupt/non-canonical value degrades to null
 * (never a poisoned token). `runId` defaults to the `current-run-id` sentinel.
 *
 * NEVER throws (missing/corrupt run.yaml → null), mirroring loadRunState.
 *
 * @param cwd    A path inside the guild project (guild root resolved from it).
 * @param runId  Optional explicit run id; else read from the sentinel.
 */
export function readActivePhase(cwd: string, runId?: string): string | null {
  try {
    const guildRoot = resolveGuildRoot(cwd);
    const id = runId ?? readSentinelRunId(guildRoot);
    if (!id) return null;
    const runYaml = path.join(guildRoot, ".guild", "runs", id, "run.yaml");
    let raw: string;
    try {
      raw = fs.readFileSync(runYaml, "utf8");
    } catch {
      return null; // missing run.yaml → no active phase
    }

    // Parse run.yaml via the shared js-yaml parser (OD-3). A missing/corrupt
    // manifest yields null (fail-soft) → no active phase, same as before.
    const doc = parseYaml(raw);
    const obj =
      doc !== null && typeof doc === "object" && !Array.isArray(doc)
        ? (doc as Record<string, unknown>)
        : {};

    // 1. Last phases_log entry: the last `{ phase, at }` block item.
    const log = Array.isArray(obj["phases_log"]) ? (obj["phases_log"] as unknown[]) : [];
    const last = log.length > 0 ? log[log.length - 1] : null;
    const lastLogged =
      last !== null && typeof last === "object" && (last as Record<string, unknown>)["phase"] != null
        ? String((last as Record<string, unknown>)["phase"])
        : null;
    if (lastLogged && isCanonicalPhase(lastLogged)) return lastLogged;

    // 2. Fallback: top-level `phase:` scalar.
    const top = obj["phase"] != null ? String(obj["phase"]) : null;
    if (top && isCanonicalPhase(top)) return top;

    return null; // no canonical phase recorded
  } catch {
    return null; // tolerant: any failure → no active phase
  }
}

// ── resolveTeamFile (§2) ──────────────────────────────────────────────────────

/**
 * Resolve the team file a consumer should read for `slug` at `phase`.
 *
 * Precedence (phase-compose-plan.md §2):
 *   1. `phase === null` → substitute the `.current` pointer's phase; if that's also
 *      null, skip to (3).
 *   2. `.guild/team/<slug>.<phase>.yaml` exists  → its ABSOLUTE path. (new world)
 *   3. else `.guild/team/<slug>.yaml` exists      → its ABSOLUTE path. (legacy,
 *                                                    READ-ONLY — never rewritten)
 *   4. else                                       → null. (→ trigger a compose pass)
 *
 * Non-throwing. A non-canonical `phase` is treated as "no per-phase file" (falls
 * through to legacy/null) rather than throwing — a poisoned run-state can't crash a
 * consumer. `null` is the explicit "no team artifact for this phase yet" trigger,
 * NOT an error.
 */
export function resolveTeamFile(
  guildRoot: string,
  slug: string,
  phase: string | null,
): string | null {
  // (1) phase null → consult the .current mirror.
  let effectivePhase = phase;
  if (effectivePhase === null) {
    effectivePhase = readCurrentPhasePointer(guildRoot, slug); // may stay null
  }

  // (2) per-phase file (only when we have a canonical phase).
  if (effectivePhase !== null && isCanonicalPhase(effectivePhase)) {
    const perPhase = teamFilePath(guildRoot, slug, effectivePhase);
    if (safeIsFile(perPhase)) return perPhase;
  }

  // (3) legacy single-file fallback.
  const legacy = legacyTeamFilePath(guildRoot, slug);
  if (safeIsFile(legacy)) return legacy;

  // (4) nothing → compose-pass trigger.
  return null;
}

/** True iff `p` is an existing regular file. Never throws. */
function safeIsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// ── R-016 SSH lane-key join (plan owner → task-id) ───────────────────────────
//
// The canonical lane key everywhere downstream (run-state lanes, resume.json dirs,
// resume-lanes.ts reader, execute-plan re-entry) is the PLAN TASK-ID (e.g.
// `T2-backend`), NOT the specialist name (`backend`). team.yaml — the launcher's
// only input — carries specialist NAMES, not task-ids. The task-id↔owner mapping
// lives solely in `.guild/plan/<slug>.md` (lane blocks: `- task-id: …` / `- owner: …`).
// The SSH `onExhausted` path therefore must JOIN specialist→task-id via the plan so
// its dead-lane checkpoint is keyed identically to the prose path (write↔read symmetry).

/**
 * Parse `.guild/plan/<slug>.md` into an `owner(specialist-name) → task-id[]` map.
 * Plan lane format (skills/meta/plan/SKILL.md): each `## Lane:` block carries
 * `- task-id: <id>` immediately followed by `- owner: <name>`. A specialist may own
 * multiple lanes → multiple task-ids. Tolerant: missing/unreadable plan → empty map;
 * never throws.
 */
export function readPlanOwnerTaskIds(guildRoot: string, slug: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(guildRoot, ".guild", "plan", `${slug}.md`), "utf8");
  } catch {
    return map; // no plan → empty map (reader-side validation handles this)
  }

  // BLOCK-SCOPED parse (hardened, MINOR-C): partition the plan at `## Lane:` headings
  // (tolerating leading indentation), then within EACH block take the FIRST `- task-id:`
  // and the FIRST `- owner:` regardless of their order. Block-scoping prevents
  // cross-block mis-pairing; first-of-each prevents a stray later `- owner:`/`- task-id:`
  // in the same block from grabbing the wrong partner. A block missing either field is
  // skipped (can't form a pair). Per guild:plan's contract: task-id is unique per lane,
  // owner is the exact specialist slug, one owner per lane.
  const lines = raw.split("\n");
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^\s*##\s+Lane:/.test(line)) {
      current = [];
      blocks.push(current);
      continue;
    }
    if (current) current.push(line);
  }

  for (const block of blocks) {
    let taskId: string | null = null;
    let owner: string | null = null;
    for (const line of block) {
      if (taskId === null) {
        const m = line.match(/^\s*-\s*task-id:\s*(\S+)/);
        if (m) { taskId = m[1]; continue; }
      }
      if (owner === null) {
        const m = line.match(/^\s*-\s*owner:\s*(\S+)/);
        if (m) { owner = m[1]; continue; }
      }
      if (taskId !== null && owner !== null) break; // both found — done with this block
    }
    if (taskId && owner) {
      const arr = map.get(owner) ?? [];
      arr.push(taskId);
      map.set(owner, arr);
    }
  }
  return map;
}

/**
 * The set of all task-ids declared in `.guild/plan/<slug>.md` — the authoritative
 * lane-key universe. Used by resume-lanes.ts to validate that a checkpoint's
 * `lane_id` is a REAL plan lane before offering it as resumable (orphan / fallback /
 * name-keyed checkpoints are not in this set → not auto-resumable). Empty when the
 * plan is absent/unreadable (caller decides how to treat "cannot validate").
 */
export function readPlanTaskIdSet(guildRoot: string, slug: string): Set<string> {
  const ids = new Set<string>();
  for (const taskIds of readPlanOwnerTaskIds(guildRoot, slug).values()) {
    for (const id of taskIds) ids.add(id);
  }
  return ids;
}

/**
 * Resolve the dead-lane checkpoint key(s) for a remote specialist that could not be
 * dispatched (SSH transport exhausted). Returns the specialist's plan TASK-ID(s) so
 * the checkpoint is keyed the same way resume-lanes.ts + execute-plan re-entry expect.
 *
 * A specialist that owns several lanes returns ALL its task-ids — an undispatchable
 * specialist means none of its lanes can run, so each is dead-lettered.
 *
 * FALLBACK: when the plan has no task-id for the specialist (plan absent, or the
 * specialist isn't an owner), returns `[specName]` so the dead lane is NEVER silently
 * dropped — but the caller should warn, since a name-keyed checkpoint may not map back
 * to a plan lane on resume.
 */
export function resolveDeadLaneKeys(
  guildRoot: string,
  slug: string,
  specName: string,
): string[] {
  const taskIds = readPlanOwnerTaskIds(guildRoot, slug).get(specName);
  return taskIds && taskIds.length > 0 ? taskIds : [specName];
}

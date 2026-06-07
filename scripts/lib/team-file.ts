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

    // 1. Last phases_log entry: scan all `- phase: <x>` block items, take the last.
    const lines = raw.split("\n");
    let lastLogged: string | null = null;
    for (const line of lines) {
      const m = line.match(/^\s+-\s+phase:\s*(\S+)\s*$/);
      if (m) lastLogged = m[1];
    }
    if (lastLogged && isCanonicalPhase(lastLogged)) return lastLogged;

    // 2. Fallback: top-level `phase:` scalar.
    const top = raw.match(/^phase:\s*(\S+)\s*$/m);
    if (top && isCanonicalPhase(top[1])) return top[1];

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

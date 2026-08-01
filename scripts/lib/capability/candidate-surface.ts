/**
 * scripts/lib/capability/candidate-surface.ts
 *
 * F7 — candidate surfacing. The HARD PRECONDITION on D04's `observe` default.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS FILE DECIDES A CONFIG DEFAULT                                    │
 * │ cap-loc-D04 §Recommendation.5: "Do not ship this default until F7 is      │
 * │ closed. An `observe`-mode install that emits candidates nobody surfaces   │
 * │ is a silent failure." That is why CAPABILITY_RESOLVER_MODE_DEFAULT ships  │
 * │ `legacy` and a test named for the flip carries the post-F7 expectation.   │
 * │ THIS module is F7. Landing it is what makes the flip honest.              │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * WHAT "PENDING" MEANS, AND WHY IT NEEDS NO NEW STATE FILE
 *
 * A candidate is PENDING iff its `proposed_id` is not yet present in the project's
 * live roster. That definition is derived from state that already exists, which is
 * the point: a separate dismissal ledger would be a second source of truth about
 * the same question, and the two would drift the first time someone approved a
 * candidate by hand.
 *
 * The corollary is a boundary, not an omission: **explicit dismissal is not
 * modelled here.** "The operator looked at this and said no" is an adoption event,
 * and adoption belongs to `guild.adoption_manifest.v1` (S3) behind a human gate.
 * This module reports what the project does not yet have; it never records a
 * decision about it.
 *
 * WHY THE NEWEST PROFILE WINS
 *
 * Run directories are named `run-<yyyymmdd-hhmmss>-<slug>`, so a byte-descending
 * sort IS reverse-chronological — no clock, no mtime, no parsing. Older profiles
 * are superseded rather than merged: a candidate the newest Learn no longer
 * proposes has been answered by the evidence, and resurrecting it from an older
 * run would surface a finding the project has since moved past.
 *
 * CONTRACT: READ-ONLY. `/guild:status` is contractually read-only ("Read-only R,
 * writes no file"), so this module opens no file for writing and never creates a
 * directory. No clock, no network, NEVER throws.
 *
 * C5 DUAL-HOME: mirrored under src/modules/capability/resources/. Edit here only.
 */

import * as fs from "fs";
import * as path from "path";

import {
  DEFAULT_SUGGESTION_BUDGET,
  type CapabilityCandidate,
  type ProjectCapabilityProfileV1,
  validateProjectCapabilityProfileV1,
} from "../core/contracts/project-capability-profile";

/** Where profiles live, relative to the project root. */
const RUNS_DIR = ".guild/runs";
const PROFILE_LEAF = path.join("capability", "profile.json");

/** Run-directory shape. Bounded and anchored — a run id names a directory. */
const RUN_DIR_RE = /^run-[0-9]{8}-[0-9]{6}-[a-z0-9][a-z0-9._-]*$/;

/**
 * Hard cap on run directories examined, newest first.
 *
 * `/guild:status` runs on every invocation, so an unbounded scan would make the
 * read-only helper the slowest thing in the command. 50 is far past the point
 * where an older profile could still be the newest one.
 */
export const CANDIDATE_SCAN_LIMIT = 50;

export interface SurfacedCandidate {
  /** The run whose profile proposed it. */
  run_id: string;
  candidate: CapabilityCandidate;
}

export interface CandidateSurface {
  /** The run whose profile was read, or null when there is none. */
  source_run_id: string | null;
  /** Candidates not yet present in the live roster. Ordered as the profile ordered them. */
  pending: SurfacedCandidate[];
  /** Candidates whose `proposed_id` the roster already has — reported, not hidden. */
  satisfied: SurfacedCandidate[];
  /**
   * Why there is nothing to show, when there is nothing to show. Never null-and-
   * silent: "no candidates" and "never profiled" are different facts and a reader
   * that cannot tell them apart will misread a broken pipeline as a clean project.
   */
  empty_reason: EmptyReason | null;
}

export const EMPTY_REASONS = Object.freeze([
  "no_runs_directory",
  "no_profile_found",
  "profile_invalid",
  "profile_has_no_candidates",
  "all_candidates_satisfied",
] as const);
export type EmptyReason = (typeof EMPTY_REASONS)[number];

function safeReadDir(abs: string): string[] {
  try {
    return fs.readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Names of the live roster's definitions: `.guild/agents/<id>.md` and
 * `.guild/skills/<id>/SKILL.md`.
 *
 * Files are the source of truth (D4), so this reads the filesystem rather than
 * `registry.yaml` — the registry is a DERIVED index, and a candidate check that
 * consulted a derived index would go wrong exactly when the index was stale,
 * which is the moment it matters.
 */
export function readLiveRosterIds(projectRoot: string): { agents: Set<string>; skills: Set<string> } {
  const agents = new Set<string>();
  const skills = new Set<string>();
  try {
    for (const e of fs.readdirSync(path.join(projectRoot, ".guild/agents"), {
      withFileTypes: true,
    })) {
      if (e.isFile() && e.name.endsWith(".md")) agents.add(e.name.slice(0, -3));
    }
  } catch {
    /* absent roster — every candidate is pending, which is correct for a new install */
  }
  for (const name of safeReadDir(path.join(projectRoot, ".guild/skills"))) {
    if (fs.existsSync(path.join(projectRoot, ".guild/skills", name, "SKILL.md"))) skills.add(name);
  }
  return { agents, skills };
}

/**
 * Newest-first run ids that have a capability profile. Bounded by
 * `CANDIDATE_SCAN_LIMIT`; malformed directory names are skipped, not guessed at.
 */
export function listProfileRunIds(projectRoot: string): string[] {
  const dirs = safeReadDir(path.join(projectRoot, RUNS_DIR))
    .filter((n) => RUN_DIR_RE.test(n))
    .sort()
    .reverse();
  const out: string[] = [];
  for (const d of dirs) {
    if (out.length >= CANDIDATE_SCAN_LIMIT) break;
    if (fs.existsSync(path.join(projectRoot, RUNS_DIR, d, PROFILE_LEAF))) out.push(d);
  }
  return out;
}

export interface SurfaceOptions {
  /** Resolved `capability.suggestion_budget`; passed straight to S1's validator. */
  suggestionBudget?: number;
}

/**
 * The F7 read. Returns the newest profile's candidates split into pending and
 * already-satisfied. NEVER throws.
 *
 * An INVALID profile is reported as `profile_invalid` rather than skipped in
 * favour of an older one. Falling back would present stale candidates as current
 * — the reader would see a plausible list and never learn the newest run's output
 * was corrupt. Absent is never success (spec README rule 4).
 */
export function surfaceCapabilityCandidates(
  projectRoot: string,
  opts: SurfaceOptions = {}
): CandidateSurface {
  const empty = (empty_reason: EmptyReason, source_run_id: string | null = null): CandidateSurface => ({
    source_run_id,
    pending: [],
    satisfied: [],
    empty_reason,
  });

  try {
    if (!fs.existsSync(path.join(projectRoot, RUNS_DIR))) return empty("no_runs_directory");

    const runIds = listProfileRunIds(projectRoot);
    if (runIds.length === 0) return empty("no_profile_found");

    const runId = runIds[0];
    let profile: ProjectCapabilityProfileV1 | null = null;
    try {
      const raw: unknown = JSON.parse(
        fs.readFileSync(path.join(projectRoot, RUNS_DIR, runId, PROFILE_LEAF), "utf8")
      );
      profile = validateProjectCapabilityProfileV1(raw, {
        suggestionBudget: opts.suggestionBudget ?? DEFAULT_SUGGESTION_BUDGET,
      });
    } catch {
      profile = null;
    }
    if (profile === null) return empty("profile_invalid", runId);
    if (profile.candidates.length === 0) return empty("profile_has_no_candidates", runId);

    const roster = readLiveRosterIds(projectRoot);
    const pending: SurfacedCandidate[] = [];
    const satisfied: SurfacedCandidate[] = [];
    for (const candidate of profile.candidates) {
      const have =
        candidate.kind === "agent"
          ? roster.agents.has(candidate.proposed_id)
          : roster.skills.has(candidate.proposed_id);
      (have ? satisfied : pending).push({ run_id: runId, candidate });
    }

    if (pending.length === 0) {
      return { source_run_id: runId, pending, satisfied, empty_reason: "all_candidates_satisfied" };
    }
    return { source_run_id: runId, pending, satisfied, empty_reason: null };
  } catch {
    return empty("no_profile_found");
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** One line per empty reason. A reader must always learn WHY the list is empty. */
const EMPTY_TEXT: Readonly<Record<EmptyReason, string>> = Object.freeze({
  no_runs_directory: "no runs yet — capability profiling has not run",
  no_profile_found: "no capability profile emitted yet (run /guild:learn)",
  profile_invalid: "the newest capability profile FAILED validation — treat it as absent",
  profile_has_no_candidates: "profiled, no candidates proposed",
  all_candidates_satisfied: "all proposed candidates already exist in the roster",
});

/**
 * Deterministic plain-text block for `/guild:status`.
 *
 * Deterministic because `/guild:status` output is compared in evals — no clock, no
 * absolute paths, stable ordering. Every line is prefixed so the block can be
 * spliced into the command's existing output without a parser.
 */
export function renderCandidateSection(surface: CandidateSurface): string {
  const lines: string[] = ["Capability candidates (report-only — nothing is created without approval):"];

  if (surface.empty_reason !== null) {
    lines.push(`  ${EMPTY_TEXT[surface.empty_reason]}`);
    if (surface.satisfied.length > 0) {
      lines.push(`  (${surface.satisfied.length} already in the roster)`);
    }
    return lines.join("\n");
  }

  lines.push(`  from run ${surface.source_run_id ?? "(unknown)"}`);
  for (const { candidate } of surface.pending) {
    const why = candidate.defer_reason === null ? "" : ` — ${candidate.defer_reason}`;
    lines.push(
      `  • [${candidate.action}] ${candidate.kind} "${candidate.proposed_id}" ` +
        `(confidence ${candidate.confidence}, owner ${candidate.owning_layer})${why}`
    );
  }
  if (surface.satisfied.length > 0) {
    lines.push(`  (${surface.satisfied.length} already in the roster)`);
  }
  lines.push("  Review with /guild:learn, or approve one via /guild:plan — never automatic.");
  return lines.join("\n");
}

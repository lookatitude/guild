#!/usr/bin/env -S npx tsx
/**
 * scripts/workspace/promote-upstream.ts
 *
 * Collects cross-cutting harvest candidates from child repos and stages them as
 * a root-level upstream-promotion manifest for the operator to review.
 *
 * Usage:
 *   npx tsx scripts/workspace/promote-upstream.ts \
 *     --workspace-root <root> [--child <name>] [--run-id <id>]
 *
 * Options:
 *   --workspace-root <path>  Root of the workspace (must contain .guild/workspace.json).
 *   --child <name>           Restrict scan to one child sub_guild. Default: all sub_guilds.
 *   --run-id <id>            ID for the output manifest run dir. Default: upstream-<child|all>.
 *                            MUST be a safe identifier: no path separators, no "..",
 *                            no absolute prefix, no NUL byte.
 *
 * Reads:
 *   <workspaceRoot>/.guild/workspace.json           — discovers sub_guilds[]
 *   <child>/.guild/runs/<run-id>/learn/harvest-candidates.json — candidate source files
 *
 * Writes:
 *   <workspaceRoot>/.guild/runs/<run-id>/upstream-candidates.json
 *   (guild.upstream_candidates.v1 manifest — by-reference only, never copies bodies)
 *
 * Stdout: human summary (counts + gate reminder).
 * Stderr: diagnostics.
 * Exit: 0 success, 1 bad input, 2 internal error.
 *
 * HARD INVARIANTS (never violate):
 *   - Writes NOTHING under docs/knowledge/ — promotion stays the guild:wiki-ingest human gate.
 *   - Never copies body_draft or decision body into staged candidates (by-reference only).
 *   - Never mutates any child .guild/ directory.
 *   - run-id is validated and path-contained before any write.
 */

import * as fs from "fs";
import * as path from "path";
import { atomicWrite } from "../../state";
import { isRefused, isWithin, prepareContainedWrite } from "../../kernel";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A by-reference staged upstream candidate — carries no body content. */
export interface UpstreamCandidate {
  kind: "wiki" | "decision";
  id_or_title: string;
  applies_to?: string[];
  upstream?: boolean;
  source_repo: string;
  /** Relative path to the harvest-candidates.json that sourced this candidate. */
  source_path: string;
  source_refs: string[];
  promotion_gate: string;
}

/** The manifest written at root/.guild/runs/<run-id>/upstream-candidates.json */
interface UpstreamCandidatesManifest {
  schema_version: "guild.upstream_candidates.v1";
  generated_at: string;
  workspace_root: string;
  children_scanned: string[];
  candidates: UpstreamCandidate[];
}

/** guild.workspace.v1 sub_guild entry (minimal fields used). */
interface SubGuildEntry {
  name: string;
  path: string;
}

/** Raw wiki_candidate from guild.harvest_candidates.v1 */
interface RawWikiCandidate {
  title?: string;
  body_draft?: string;
  confidence?: string;
  source_refs?: string[];
  linked_run?: string;
  linked_initiative?: string;
  when_to_revisit?: string;
  promotion_gate?: string;
  applies_to?: string[];
  upstream?: boolean;
}

/** Raw decision_candidate from guild.harvest_candidates.v1 */
interface RawDecisionCandidate {
  decision?: string;
  context?: string;
  alternatives?: string[];
  rationale?: string;
  applicability?: string;
  when_to_revisit?: string;
  source_refs?: string[];
  linked_goals?: string[];
  linked_initiatives?: string[];
  linked_components?: string[];
  confidence?: string;
  promotion_gate?: string;
  applies_to?: string[];
  upstream?: boolean;
}

interface RawHarvestCandidates {
  schema_version?: string;
  run_id?: string;
  wiki_candidates?: unknown;
  decision_candidates?: unknown;
}

// ── Run-id validation (Finding #2) ────────────────────────────────────────────

/**
 * Validate a run-id is safe: no path separators, no ".." components,
 * no absolute prefix, no NUL bytes, no leading ".." in the identifier.
 *
 * Returns true iff the run-id is safe to use as a directory name component.
 */
export function validateRunId(runId: string): boolean {
  // Empty or whitespace-only: path.join(runsBase, "") === runsBase, so the manifest
  // would be written to the runs base dir rather than a subdir. Reject outright.
  if (!runId || !runId.trim()) return false;
  // NUL byte
  if (runId.includes("\x00")) return false;
  // Absolute paths
  if (runId.startsWith("/") || runId.startsWith("\\")) return false;
  // Forward or backward slashes (path separators)
  if (runId.includes("/") || runId.includes("\\")) return false;
  // Single "." resolves to the same dir: path.join(runsBase, ".") === runsBase.
  // Reject so a "." run-id cannot collapse onto the runs base dir.
  if (runId === ".") return false;
  // Pure ".." or starts with ".." (to catch "..foo" style abuse)
  if (runId === ".." || runId.startsWith("..")) return false;
  // Any ".." anywhere in the string (handles "foo..bar" etc.)
  if (runId.includes("..")) return false;
  // Note: "%2e%2e" (URL-encoded "..") is NOT a traversal — path.join does not
  // URL-decode, so it is treated as a harmless literal directory name.
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true iff a candidate is cross-cutting: applies_to.length > 1 OR upstream === true. */
function isCrossCutting(candidate: { applies_to?: string[]; upstream?: boolean }): boolean {
  if (candidate.upstream === true) return true;
  if (Array.isArray(candidate.applies_to) && candidate.applies_to.length > 1) return true;
  return false;
}

/** Read workspace.json and return sub_guilds[]. Returns [] on any error. */
function readSubGuilds(workspaceRoot: string): SubGuildEntry[] {
  const manifestPath = path.join(workspaceRoot, ".guild", "workspace.json");
  if (!fs.existsSync(manifestPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const sgs = raw["sub_guilds"];
    if (!Array.isArray(sgs)) return [];
    return (sgs as Array<Record<string, unknown>>).map((sg) => ({
      name: String(sg["name"] ?? ""),
      path: String(sg["path"] ?? sg["name"] ?? ""),
    }));
  } catch {
    return [];
  }
}

/**
 * Scan a single child directory for all harvest-candidates.json files.
 * Returns all matching file paths.
 */
function findHarvestFiles(childDir: string): string[] {
  const runsDir = path.join(childDir, ".guild", "runs");
  if (!fs.existsSync(runsDir)) return [];
  const results: string[] = [];
  try {
    const runIds = fs.readdirSync(runsDir);
    for (const runId of runIds) {
      const candidate = path.join(runsDir, runId, "learn", "harvest-candidates.json");
      if (fs.existsSync(candidate)) {
        results.push(candidate);
      }
    }
  } catch {
    // unreadable → skip
  }
  return results;
}

/**
 * Parse a single harvest-candidates.json file and extract cross-cutting
 * candidates as UpstreamCandidate objects (by-reference only — no body content).
 *
 * Finding #4: wiki_candidates and decision_candidates are guarded with Array.isArray
 * before iteration — a non-array (null, string, number, object) is treated as
 * empty rather than throwing and aborting the whole scan.
 */
function extractFromHarvestFile(
  harvestPath: string,
  childName: string,
  workspaceRoot: string,
): UpstreamCandidate[] {
  let raw: RawHarvestCandidates;
  try {
    raw = JSON.parse(fs.readFileSync(harvestPath, "utf8")) as RawHarvestCandidates;
  } catch {
    return [];
  }

  // Relative path from workspaceRoot for the source_path field
  const sourcePath = path.relative(workspaceRoot, harvestPath);

  const staged: UpstreamCandidate[] = [];

  // Finding #4: guard with Array.isArray — malformed (non-array) value → skip gracefully
  const wikiCandidates: RawWikiCandidate[] = Array.isArray(raw.wiki_candidates)
    ? (raw.wiki_candidates as RawWikiCandidate[])
    : [];

  const decisionCandidates: RawDecisionCandidate[] = Array.isArray(raw.decision_candidates)
    ? (raw.decision_candidates as RawDecisionCandidate[])
    : [];

  // Wiki candidates
  for (const wc of wikiCandidates) {
    if (!isCrossCutting(wc)) continue;
    const candidate: UpstreamCandidate = {
      kind: "wiki",
      id_or_title: wc.title ?? "(untitled)",
      source_repo: childName,
      source_path: sourcePath,
      source_refs: wc.source_refs ?? [],
      promotion_gate: wc.promotion_gate ?? "guild:wiki-ingest",
    };
    if (Array.isArray(wc.applies_to)) candidate.applies_to = wc.applies_to;
    if (wc.upstream === true) candidate.upstream = true;
    // INVARIANT: never copy body_draft (not included above)
    staged.push(candidate);
  }

  // Decision candidates
  for (const dc of decisionCandidates) {
    if (!isCrossCutting(dc)) continue;
    const candidate: UpstreamCandidate = {
      kind: "decision",
      id_or_title: dc.decision ?? "(untitled decision)",
      source_repo: childName,
      source_path: sourcePath,
      source_refs: dc.source_refs ?? [],
      promotion_gate: dc.promotion_gate ?? "guild:decisions",
    };
    if (Array.isArray(dc.applies_to)) candidate.applies_to = dc.applies_to;
    if (dc.upstream === true) candidate.upstream = true;
    // INVARIANT: never copy context, rationale, alternatives, or any body content
    staged.push(candidate);
  }

  return staged;
}

// ── Core export ───────────────────────────────────────────────────────────────

export interface CollectOptions {
  workspaceRoot: string;
  child?: string;
}

/**
 * Collect upstream candidates from child run harvest files.
 *
 * For each child (or just `opts.child` if given), scans all
 * `<child>/.guild/runs/<run-id>/learn/harvest-candidates.json` files and
 * returns only the cross-cutting candidates as by-reference UpstreamCandidate objects.
 *
 * HARD INVARIANTS:
 *   - Does NOT write to docs/knowledge/ or any child .guild/.
 *   - Returned objects carry NO body_draft / decision body.
 */
export function collectUpstreamCandidates(opts: CollectOptions): UpstreamCandidate[] {
  const { workspaceRoot } = opts;

  // Determine which children to scan
  let children: SubGuildEntry[];
  if (opts.child) {
    // Single child specified — resolve its path from workspace.json or fallback to name
    const all = readSubGuilds(workspaceRoot);
    const found = all.find((sg) => sg.name === opts.child);
    children = found
      ? [found]
      : [{ name: opts.child, path: opts.child }];
  } else {
    children = readSubGuilds(workspaceRoot);
  }

  const all: UpstreamCandidate[] = [];
  for (const child of children) {
    const childDir = path.join(workspaceRoot, child.path);
    const harvestFiles = findHarvestFiles(childDir);
    for (const hf of harvestFiles) {
      const from = extractFromHarvestFile(hf, child.name, workspaceRoot);
      all.push(...from);
    }
  }
  return all;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  workspaceRoot?: string;
  child?: string;
  runId?: string;
} {
  let workspaceRoot: string | undefined;
  let child: string | undefined;
  let runId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workspace-root" && argv[i + 1]) {
      workspaceRoot = argv[++i];
    } else if (arg === "--child" && argv[i + 1]) {
      child = argv[++i];
    } else if (arg === "--run-id" && argv[i + 1]) {
      runId = argv[++i];
    } else if (arg.startsWith("--workspace-root=")) {
      workspaceRoot = arg.slice("--workspace-root=".length);
    } else if (arg.startsWith("--child=")) {
      child = arg.slice("--child=".length);
    } else if (arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
    }
  }

  return { workspaceRoot, child, runId };
}

export function runPromoteUpstreamCli(argv: string[] = process.argv.slice(2)): void {
  const { workspaceRoot: rootArg, child, runId: runIdArg } = parseArgs(argv);
  const workspaceRoot = rootArg ?? process.env["GUILD_CWD"] ?? process.cwd();

  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    process.stderr.write(
      `[promote-upstream] ERROR: --workspace-root "${workspaceRoot}" is not a directory\n`,
    );
    process.exit(1);
  }

  // Default run-id
  const runId = runIdArg ?? `upstream-${child ?? "all"}`;

  // Finding #2: validate run-id before any path join
  if (!validateRunId(runId)) {
    process.stderr.write(
      `[promote-upstream] ERROR: invalid run-id "${runId}" — path traversal or separator detected\n`,
    );
    process.exit(1);
  }

  try {
    const candidates = collectUpstreamCandidates({ workspaceRoot, child });

    const runsBase = path.resolve(workspaceRoot, ".guild", "runs");
    const runsDir = path.join(runsBase, runId);
    const manifestPath = path.join(runsDir, "upstream-candidates.json");

    // THE STRICT-SUBDIRECTORY RULE RUNS FIRST, AND THE ORDER IS THE WHOLE POINT.
    //
    // I had this second, after `prepareContainedWrite`, and that reintroduced
    // VARIANT 2(a) — mkdir before the check — inside the migration whose entire
    // purpose is that ordering. Reproduced: a run-id of `../evil` that slipped
    // `validateRunId` collapses at `path.join` to `<workspaceRoot>/.guild/evil`,
    // which IS inside the workspace root, so the primitive accepted it and created
    // the directory; only then did this rule refuse. The old lexical code refused
    // before any mkdir. A migration that fixes symlink escapes must not pay for it
    // with a side effect the predecessor did not have.
    //
    // It belongs first on its own merits too: it is PURE (no I/O), so there is no
    // reason to do filesystem work before asking it. Containment permits equality;
    // requiring the run dir to sit STRICTLY below the base is this command's rule,
    // not the primitive's, and it catches a run-id that collapses onto the base
    // (".", "", trailing-dot forms) even if `validateRunId` misses it.
    const resolvedRunsDir = path.resolve(runsDir);
    if (!isWithin(resolvedRunsDir, runsBase) || resolvedRunsDir === runsBase) {
      process.stderr.write(
        `[promote-upstream] ERROR: resolved run dir "${resolvedRunsDir}" is not a ` +
          `strict subdirectory of the runs base\n`,
      );
      process.exit(1);
    }

    // MIGRATED to the shared path-containment primitive — THE ELEVENTH HOME of one
    // shape, and the one `run-lifecycle.ts` was pointing at all along ("mirrors the
    // containment assertion in promote-upstream.ts").
    //
    // What was here was PURELY LEXICAL: `path.resolve` plus
    // `startsWith(runsBase + path.sep)`, which is string algebra and knows nothing
    // about symlinks — so a symlinked `.guild/runs` walked straight through it into
    // the `mkdirSync` on the next line. Worse than the tenth home in one respect:
    // the check was INLINE rather than factored into a named helper, which is why
    // the rail that caught the tenth could not see this one. Factoring a check out
    // is what someone does once they have thought about it; the unfactored copies
    // are the likelier ones, and were the invisible ones.
    //
    // `policy: "physical"` for the same reason as the other run-tree writers: a run
    // tree whose realpath is load-bearing provenance must be physically real.
    //
    // This also replaces the bare `mkdirSync`. The real write target is the manifest,
    // so bounding it bounds the directory creation too — pre-check, mkdir, post-check
    // in one call, instead of a check and a mkdir that merely sit next to each other.
    const prepared = prepareContainedWrite(workspaceRoot, manifestPath, {
      policy: "physical",
    });
    if (isRefused(prepared)) {
      process.stderr.write(
        `[promote-upstream] ERROR: resolved run dir "${resolvedRunsDir}" escapes ` +
          `runs base [${prepared.code}] — ${prepared.detail}\n`,
      );
      process.exit(1);
    }


    // Determine scanned children for manifest
    const subGuilds = child
      ? [{ name: child, path: child }]
      : readSubGuilds(workspaceRoot);
    const childrenScanned = subGuilds.map((sg) => sg.name);

    const manifest: UpstreamCandidatesManifest = {
      schema_version: "guild.upstream_candidates.v1",
      generated_at: new Date().toISOString(),
      workspace_root: workspaceRoot,
      children_scanned: childrenScanned,
      candidates,
    };

    // EXDEV fix: atomicWrite writes its temp file in the SAME directory as
    // `manifestPath` (never os.tmpdir()), so the rename is always same-filesystem.
    atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    // Human summary
    const byRepo = new Map<string, number>();
    for (const c of candidates) {
      byRepo.set(c.source_repo, (byRepo.get(c.source_repo) ?? 0) + 1);
    }

    process.stdout.write(`[promote-upstream] Scanned: ${childrenScanned.join(", ") || "(none)"}\n`);
    process.stdout.write(`[promote-upstream] Staged candidates: ${candidates.length}\n`);
    for (const [repo, count] of byRepo) {
      process.stdout.write(`  ${repo}: ${count}\n`);
    }
    process.stdout.write(
      `[promote-upstream] GATE REMINDER: Promotion to docs/knowledge/ happens ONLY via guild:wiki-ingest (human gate). This manifest is by-reference only.\n`,
    );
    process.stdout.write(`[promote-upstream] Manifest: ${manifestPath}\n`);
  } catch (e) {
    process.stderr.write(`[promote-upstream] ERROR: ${(e as Error).message}\n`);
    process.exit(2);
  }
}

// Only run as CLI when invoked directly (compatible with both tsx ESM and ts-jest CJS)
if (require.main === module) {
  runPromoteUpstreamCli();
}

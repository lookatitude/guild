#!/usr/bin/env -S npx tsx
/**
 * src/modules/docs-sync/workflows/check-doc-sync.ts
 *
 * Automated doc-sync check: flags when a changeset touches the plugin's
 * user-facing surface with no matching root docs/knowledge/ change and no
 * escape hatch in the commit messages.
 *
 * Enforces Rule 2 from docs/knowledge/decisions/workspace-knowledge-flow.md:
 *   "When the plugin's user-facing surface changes, the root reference docs
 *    must update in the same rollout."
 *
 * CROSS-REPO ARCHITECTURE (Finding #1):
 *   plugin/commands/ lives in the PLUGIN repo; docs/knowledge/ lives in the
 *   UMBRELLA (root) repo — they are separate git repos. A single-repo diff
 *   can never see both sides. The CLI therefore diffs BOTH repos separately,
 *   normalises all paths, and combines them before calling evaluateDocSync().
 *   The pure evaluateDocSync() function is repo-agnostic — it only inspects
 *   path prefixes of the pre-combined file list.
 *
 * === Local (pre-push hook) ===
 *   npx tsx scripts/workspace/check-doc-sync.ts \
 *     [--plugin-repo <path>] [--root-repo <path>] \
 *     [--plugin-range <range>] [--root-range <range>] [--strict]
 *
 * === CI (PR range) ===
 *   npx tsx scripts/workspace/check-doc-sync.ts \
 *     --plugin-repo /path/to/plugin --root-repo /path/to/workspace-root \
 *     --plugin-range origin/main...HEAD --root-range origin/main...HEAD \
 *     [--strict]
 *
 * Options:
 *   --plugin-repo <path>   Root of the plugin git repo. Default: <workspace-root>/plugin
 *   --root-repo <path>     Root of the umbrella/workspace git repo. Default: workspace-root
 *   --plugin-range <range> Git range for the plugin repo. Default: origin/main...HEAD
 *                          (falls back to HEAD~1..HEAD ONLY if origin/main is unreachable,
 *                          not on any git error — fail-closed).
 *   --root-range <range>   Git range for the root repo. Default: same as --plugin-range.
 *   --workspace-root <p>   Workspace root (used to derive defaults). Default: cwd.
 *   --strict               Exit non-zero when flagged (default: exit 0 with a warning).
 *
 * Exit:
 *   0  Clean, OR flagged but --strict not set (warning printed, then exits 0).
 *   1  Flagged AND --strict set.
 *   2  Internal error (including git failure in non-fallback scenarios).
 *
 * "User-facing surface" (mechanically precise, per Rule 2):
 *   PRIMARY: any changed file under plugin/commands/** or commands/** prefix.
 *   SECONDARY: any changed file listed in userFacingSkillPaths (SKILL.md files
 *   whose frontmatter carries user_facing: true). Skills NOT in that list are
 *   out of scope (model-invoked, not user-typed).
 *
 * Escape: any commit message in the range matching /docs-sync:\s*n\/a/i
 *   satisfies the check — add it to any commit in the pushed range.
 *   Escape is evaluated against commit messages from BOTH repos combined.
 *
 * Summary line suitable for the SessionStart banner:
 *   [doc-sync] CLEAN | [doc-sync] WARN: surface touched, no root-doc update
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { readScalarField } from "../../state";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DocSyncInput {
  /** Files changed in the range (combined from plugin and root repos, normalised). */
  changedFiles: string[];
  /** All commit messages in the range (combined from both repos). */
  commitMessages: string[];
  /**
   * Paths of SKILL.md files that carry `user_facing: true` in their frontmatter.
   * Derived by the CLI from changedFiles — the pure function receives the pre-filtered list.
   */
  userFacingSkillPaths: string[];
}

export interface DocSyncResult {
  flagged: boolean;
  reason: string;
  /** Only the changedFiles that are part of the user-facing surface. */
  surfaceFiles: string[];
}

/**
 * Typed git-wrapper result (Finding #3 — fail-closed).
 * ok:true  → value is the parsed result; error is absent.
 * ok:false → error is the git error message; value is absent.
 *
 * Uses optional fields rather than a discriminated union so that TypeScript
 * narrowing works correctly even under ts-jest CommonJS transforms.
 */
export interface GitResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

// ── Pure core ─────────────────────────────────────────────────────────────────

/** Returns true iff the file path is under the command surface. */
function isCommandFile(filePath: string): boolean {
  // Matches plugin/commands/... or commands/... prefix
  return (
    filePath.startsWith("plugin/commands/") ||
    filePath.startsWith("commands/")
  );
}

/** Returns true iff the file path is a canonical reference-doc: under the umbrella
 *  .guild/wiki/ (v2 KB), the consumer-facing v2 design set docs/v2/ (the single
 *  guideline for plugin/website/benchmark), or the retired docs/knowledge/ (kept
 *  additively for back-compat). A feature change that updates docs/v2/ satisfies
 *  the rollout-coupling gate; the initiative D8 docs leg additionally requires the
 *  docs/v2/ design set specifically (see initiative-workitems.ts). */
function isRootDocFile(filePath: string): boolean {
  return (
    filePath.startsWith(".guild/wiki/") ||
    filePath.includes("/.guild/wiki/") ||
    filePath.startsWith("docs/v2/") ||
    filePath.includes("/docs/v2/") ||
    filePath.startsWith("docs/knowledge/")
  );
}

/**
 * Returns true iff a SKILL.md file's frontmatter has `user_facing: true`.
 * Pure function — receives the file path (for context) and contents (for parsing).
 * Handles both unquoted (true) and quoted ("true", 'true') forms (Finding #7).
 *
 * Uses the shared ROBUST single-line reader (OD-3), NOT a whole-block YAML parse:
 * skill pages routinely carry a YAML-hostile unquoted `description:` (colons/
 * parens) that makes `yaml.load` of the whole block throw — which would silently
 * misclassify every such skill as non-user-facing. `readScalarField` reads the
 * `user_facing` line directly (quote-stripped), tolerating those siblings.
 */
export function isUserFacingSkill(_skillMdPath: string, contents: string): boolean {
  return readScalarField(contents, "user_facing")?.toLowerCase() === "true";
}

/**
 * Pure evaluation function — no shelling out. Deterministic.
 *
 * Input is the COMBINED file list from both plugin and root repos (normalised paths).
 * "User-facing surface touched" = any changedFile is a command file OR in userFacingSkillPaths.
 * "Root docs updated" = any changedFile starts with docs/knowledge/.
 * "Escape present" = any commitMessage matches /docs-sync:\s*n\/a/i.
 * flagged = surfaceTouched && !rootDocsUpdated && !escape.
 */
export function evaluateDocSync(input: DocSyncInput): DocSyncResult {
  const { changedFiles, commitMessages, userFacingSkillPaths } = input;

  const ufSkillSet = new Set(userFacingSkillPaths);

  // Collect which changed files are surface files
  const surfaceFiles = changedFiles.filter(
    (f) => isCommandFile(f) || ufSkillSet.has(f),
  );

  const surfaceTouched = surfaceFiles.length > 0;
  const rootDocsUpdated = changedFiles.some(isRootDocFile);
  const escape = commitMessages.some((msg) => /docs-sync:\s*n\/a/i.test(msg));

  const flagged = surfaceTouched && !rootDocsUpdated && !escape;

  let reason = "";
  if (flagged) {
    reason =
      `User-facing surface changed (${surfaceFiles.length} file(s)) with no root docs/knowledge/ update and no docs-sync: n/a escape.` +
      ` Surface files: ${surfaceFiles.join(", ")}.` +
      ` To fix: update a docs/knowledge/ page in this changeset, or add "docs-sync: n/a <reason>" to any commit message.`;
  }

  return { flagged, reason, surfaceFiles };
}

// ── Git wrappers — typed, fail-closed (Finding #3 + #4) ──────────────────────

/**
 * Run `git diff --name-only <range>` using execFileSync (no shell interpolation — Finding #4).
 * Returns a typed GitResult: ok:true with files array, or ok:false with error string.
 *
 * Finding #3: NEVER returns ok:false silently as [] — callers must handle the error.
 */
export function getChangedFilesResult(range: string, cwd: string): GitResult<string[]> {
  try {
    const out = execFileSync("git", ["diff", "--name-only", range], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
    const files = out.split("\n").map((l) => l.trim()).filter(Boolean);
    return { ok: true, value: files };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Run `git log <range> --format=%B` using execFileSync (no shell interpolation — Finding #4).
 * Returns a typed GitResult: ok:true with messages array, or ok:false with error string.
 *
 * Finding #3: NEVER returns ok:false silently as [] — callers must handle the error.
 *
 * Codex-CI MAJOR-1: the escape-token scan must see ONLY this changeset's commits.
 * `git diff A...B` (three-dot) is correct for the PR's file changes, but `git log A...B`
 * (three-dot) is the SYMMETRIC difference and would also include base-branch commits — a
 * `docs-sync: n/a` on the base side could then falsely suppress the advisory. So for the
 * LOG we translate a three-dot range to two-dot (`A..B` = commits in B not in A = the PR's
 * own commits). Diff keeps three-dot; only the log range is narrowed.
 */
export function getCommitMessagesResult(range: string, cwd: string): GitResult<string[]> {
  // Narrow three-dot → two-dot for the log (symmetric-diff → PR-commits-only).
  const logRange = range.includes("...") ? range.replace("...", "..") : range;
  try {
    const out = execFileSync("git", ["log", logRange, "--format=%B"], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
    const messages = out.split(/\n\n+/).map((m) => m.trim()).filter(Boolean);
    return { ok: true, value: messages };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Check whether `origin/main` is reachable in the given cwd.
 * Used to decide the fallback range — only fall back when origin/main is specifically absent.
 */
function isOriginMainReachable(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/main"], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the effective git range for a repo, falling back to HEAD~1..HEAD ONLY
 * when the requested range is origin/main...HEAD and origin/main is unreachable
 * (Residual B / Finding #3 — not on any arbitrary git error).
 *
 * Returns { range, files, messages, fatal } where:
 *   fatal = false  → git succeeded (or the expected origin/main-unreachable fallback was used).
 *   fatal = true   → unexpected git failure that callers must treat as an error, NOT as CLEAN.
 *
 * Callers MUST check `fatal` and exit 2 rather than proceeding to evaluateDocSync —
 * allowing a git failure to silently produce a CLEAN verdict is fail-open.
 */
function resolveRangeForRepo(
  requestedRange: string,
  cwd: string,
): { range: string; files: string[]; messages: string[]; fatal: boolean } {
  let effectiveRange = requestedRange;
  let filesResult = getChangedFilesResult(requestedRange, cwd);

  // Only fall back if the range is specifically origin/main...HEAD AND origin/main
  // is confirmed unreachable. Any other git failure is fatal.
  if (!filesResult.ok && requestedRange === "origin/main...HEAD") {
    if (!isOriginMainReachable(cwd)) {
      // Expected case: offline / fresh clone without origin/main — use HEAD~1..HEAD
      effectiveRange = "HEAD~1..HEAD";
      filesResult = getChangedFilesResult(effectiveRange, cwd);
      // If the fallback ALSO fails, that is a fatal unexpected error
    }
    // If origin/main IS reachable but diff failed, the error is not the expected case → fatal
  }

  if (!filesResult.ok) {
    // Unexpected git failure (non-fallback, or fallback also failed) → fatal
    process.stderr.write(
      `[check-doc-sync] ERROR: git diff failed in "${cwd}" (range: ${effectiveRange}): ${filesResult.error ?? ""}\n`,
    );
    return { range: effectiveRange, files: [], messages: [], fatal: true };
  }

  const messagesResult = getCommitMessagesResult(effectiveRange, cwd);
  const messages = messagesResult.ok ? (messagesResult.value ?? []) : [];
  if (!messagesResult.ok) {
    // git log failure after a successful diff: treat as fatal to avoid missing escape tokens
    process.stderr.write(
      `[check-doc-sync] ERROR: git log failed in "${cwd}" (range: ${effectiveRange}): ${messagesResult.error ?? ""}\n`,
    );
    return { range: effectiveRange, files: filesResult.value ?? [], messages: [], fatal: true };
  }

  return { range: effectiveRange, files: filesResult.value ?? [], messages, fatal: false };
}

/**
 * For a list of changed files, identify SKILL.md candidates, read their
 * frontmatter, and return only those with user_facing: true.
 * Only called from the CLI path.
 */
export function resolveUserFacingSkillPaths(
  changedFiles: string[],
  cwd: string,
): string[] {
  const skillFiles = changedFiles.filter((f) => f.endsWith("SKILL.md"));
  const result: string[] = [];
  for (const rel of skillFiles) {
    const abs = path.resolve(cwd, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const contents = fs.readFileSync(abs, "utf8");
      if (isUserFacingSkill(rel, contents)) {
        result.push(rel);
      }
    } catch {
      // unreadable → skip
    }
  }
  return result;
}

// ── Cross-repo input gathering (Finding #1) ───────────────────────────────────

export interface CrossRepoOptions {
  pluginRepo: string;
  rootRepo: string;
  pluginRange: string;
  rootRange: string;
}

/**
 * Gather the combined DocSyncInput from TWO separate git repos:
 *   - Plugin repo: diff for commands/** and SKILL.md surface files
 *   - Root repo: diff for docs/knowledge/** changes
 *
 * Normalises plugin-repo paths so that commands/** is always detected by
 * isCommandFile (strips leading "plugin/" prefix if the git diff already
 * returns repo-relative paths like "commands/guild-build.md").
 *
 * Combines changedFiles and commitMessages from BOTH repos before returning.
 * The caller passes this directly to evaluateDocSync().
 *
 * Returns { input, fatal } where fatal=true means an unexpected git failure
 * occurred in at least one repo. The caller MUST exit 2 when fatal=true rather
 * than treating the (possibly empty) input as a valid CLEAN result.
 */
export function gatherCrossRepoInputs(
  opts: CrossRepoOptions,
): { input: DocSyncInput; fatal: boolean } {
  const { pluginRepo, rootRepo, pluginRange, rootRange } = opts;

  // Gather from plugin repo
  const plugin = resolveRangeForRepo(pluginRange, pluginRepo);
  // Gather from root repo
  const root = resolveRangeForRepo(rootRange, rootRepo);

  // Propagate fatal: if either repo had an unexpected git failure, the caller must exit 2
  const fatal = plugin.fatal || root.fatal;

  // Normalise plugin-repo files: git diff inside the plugin repo returns repo-relative
  // paths (e.g. "commands/guild-build.md"). These already match isCommandFile.
  // If the plugin repo root is a subdirectory of the workspace (e.g. workspace/plugin/),
  // we do NOT prepend "plugin/" — the normalisation depends on what the diff returns.
  // Both "commands/..." and "plugin/commands/..." match isCommandFile.
  // Dedup the combined list: in the cross-repo case plugin/root file sets are disjoint,
  // but when both --plugin-repo and --root-repo point at the SAME checkout (the CI
  // advisory mode, where docs/knowledge/ isn't present in the plugin repo) the same
  // paths would otherwise appear twice and inflate the surface-file count/list.
  const allChangedFiles = [...new Set([...plugin.files, ...root.files])];

  // Combine commit messages from both repos (deduped — same reason as above).
  const allMessages = [...new Set([...plugin.messages, ...root.messages])];

  // User-facing skills: only look in the plugin repo
  const userFacingSkillPaths = resolveUserFacingSkillPaths(plugin.files, pluginRepo);

  const input: DocSyncInput = {
    changedFiles: allChangedFiles,
    commitMessages: allMessages,
    userFacingSkillPaths,
  };

  return { input, fatal };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  pluginRepo?: string;
  rootRepo?: string;
  pluginRange: string;
  rootRange?: string;
  strict: boolean;
  workspaceRoot: string;
} {
  const defaultRange = "origin/main...HEAD";
  let pluginRepo: string | undefined;
  let rootRepo: string | undefined;
  let pluginRange = defaultRange;
  let rootRange: string | undefined;
  let strict = false;
  let workspaceRoot = process.env["GUILD_CWD"] ?? process.cwd();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--plugin-repo" && argv[i + 1]) {
      pluginRepo = argv[++i];
    } else if (arg.startsWith("--plugin-repo=")) {
      pluginRepo = arg.slice("--plugin-repo=".length);
    } else if (arg === "--root-repo" && argv[i + 1]) {
      rootRepo = argv[++i];
    } else if (arg.startsWith("--root-repo=")) {
      rootRepo = arg.slice("--root-repo=".length);
    } else if (arg === "--plugin-range" && argv[i + 1]) {
      pluginRange = argv[++i];
    } else if (arg.startsWith("--plugin-range=")) {
      pluginRange = arg.slice("--plugin-range=".length);
    } else if (arg === "--root-range" && argv[i + 1]) {
      rootRange = argv[++i];
    } else if (arg.startsWith("--root-range=")) {
      rootRange = arg.slice("--root-range=".length);
    } else if (arg === "--range" && argv[i + 1]) {
      // Legacy single --range flag: applies to both repos
      pluginRange = argv[++i];
    } else if (arg.startsWith("--range=")) {
      pluginRange = arg.slice("--range=".length);
    } else if (arg === "--strict") {
      strict = true;
    } else if (arg === "--workspace-root" && argv[i + 1]) {
      workspaceRoot = argv[++i];
    } else if (arg.startsWith("--workspace-root=")) {
      workspaceRoot = arg.slice("--workspace-root=".length);
    }
  }

  return { pluginRepo, rootRepo, pluginRange, rootRange, strict, workspaceRoot };
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  const { strict, workspaceRoot } = args;

  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    process.stderr.write(
      `[check-doc-sync] ERROR: --workspace-root "${workspaceRoot}" is not a directory\n`,
    );
    process.exit(2);
  }

  // Resolve repo roots: plugin defaults to <workspace-root>/plugin; root defaults to workspace-root
  const pluginRepo = args.pluginRepo ?? path.join(workspaceRoot, "plugin");
  const rootRepo = args.rootRepo ?? workspaceRoot;
  const effectiveRootRange = args.rootRange ?? args.pluginRange;

  // Validate plugin repo exists (it may not if this is a single-repo checkout)
  const pluginRepoExists = fs.existsSync(pluginRepo) && fs.statSync(pluginRepo).isDirectory();
  const rootRepoExists = fs.existsSync(rootRepo) && fs.statSync(rootRepo).isDirectory();

  if (!rootRepoExists) {
    process.stderr.write(
      `[check-doc-sync] ERROR: root-repo "${rootRepo}" is not a directory\n`,
    );
    process.exit(2);
  }

  // Gather combined inputs from both repos (cross-repo — Finding #1)
  const effectivePluginRepo = pluginRepoExists ? pluginRepo : rootRepo;
  const { input, fatal } = gatherCrossRepoInputs({
    pluginRepo: effectivePluginRepo,
    rootRepo,
    pluginRange: args.pluginRange,
    rootRange: effectiveRootRange,
  });

  // Residual B: unexpected git failure → exit 2, never silently CLEAN
  if (fatal) {
    process.stderr.write(
      `[check-doc-sync] ERROR: unexpected git failure in one or more repos — cannot determine sync status safely. See above errors.\n`,
    );
    process.exit(2);
  }

  const result = evaluateDocSync(input);

  if (result.flagged) {
    process.stdout.write(
      `[doc-sync] WARN: surface touched, no root-doc update\n` +
      `  ${result.reason}\n` +
      `  Plugin range: ${args.pluginRange} (in ${effectivePluginRepo})\n` +
      `  Root range:   ${effectiveRootRange} (in ${rootRepo})\n`,
    );
    if (strict) {
      process.exit(1);
    }
  } else {
    process.stdout.write(
      `[doc-sync] CLEAN (plugin: ${args.pluginRange} | root: ${effectiveRootRange})\n`,
    );
  }
}

// Only run as CLI when invoked directly (compatible with both tsx ESM and ts-jest CJS)
if (require.main === module) {
  main();
}

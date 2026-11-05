/**
 * learn/lib/paths.ts
 *
 * Repo-root resolution with worktree-redirect safety.
 *
 * Per codebase-understanding.md §"Refresh/staleness":
 *   "Worktree-redirect safety: always write to the main repo root, never an
 *    ephemeral worktree."
 *
 * The 4 frozen artifacts live under .guild/ ONLY — never the external
 * plugin's dotfolder (which would re-introduce a runtime dependency).
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { durableGuildDir } from "../../lib/state/ensure-storage-layout";
import {
  computeSourceBasis,
  readContainedFile,
  resolveSourceWorktreeRoot,
  type SourceBasis,
} from "../../../src/domains/knowledge/source-basis";
import { DEFAULT_IGNORE_PATTERNS } from "./ignore";
import { registeredSubGuildPaths, walkRepo } from "./walk";
import { loadTsconfigChain, TSCONFIG_MAX_DEPTH } from "./tsconfig-chain";

export const SCHEMA = {
  codebaseMap: "guild.codebase_map.v1",
  knowledgeGraph: "guild.knowledge_graph.v1",
  diffUnderstanding: "guild.diff_understanding.v1",
  knowledgeLinks: "guild.knowledge_links.v1",
} as const;

/** Parse a leading/anywhere `--cwd <path>` flag, else $GUILD_CWD, else process.cwd(). */
export function parseCwd(argv: string[]): string {
  return parseFlag(argv, "cwd") ?? process.env["GUILD_CWD"] ?? process.cwd();
}

/**
 * `--<name> <v>` or `--<name>=<v>`. A present flag with no value throws: it used
 * to fall through to the default and run against the wrong repo (#270).
 */
export function parseFlag(argv: string[], name: string): string | undefined {
  const eq = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i] === `--${name}` ? argv[i + 1] : argv[i].startsWith(eq) ? argv[i].slice(eq.length) : undefined;
    if (v === undefined && argv[i] !== `--${name}`) continue;
    if (!v || v.startsWith("--")) throw new Error(`--${name} needs a value (--${name} <v> or --${name}=<v>)`);
    return v;
  }
  return undefined;
}

export function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

/**
 * Resolve the canonical MAIN repo root for a given cwd.
 *
 * If cwd is inside a git worktree, `git rev-parse --git-common-dir` points at
 * the main repo's .git; its parent is the main worktree. We always anchor
 * .guild/ writes there so a brownfield scan run from an ephemeral worktree
 * never strands artifacts that vanish on worktree cleanup.
 */
export function resolveMainRepoRoot(cwd: string): string {
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    const abs = path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
    // commonDir is ".../<main>/.git" → main repo root is its parent.
    const root = path.dirname(abs);
    if (fs.existsSync(root)) return root;
  } catch {
    /* not a git repo or git unavailable — fall back to cwd */
  }
  return path.resolve(cwd);
}

export interface GuildPaths {
  /** Durable owner: the MAIN worktree whose `.guild/` holds canonical artifacts. */
  repoRoot: string;
  /** Scanned worktree: the toplevel containing cwd. Learn reads source bytes here. */
  sourceRoot: string;
  guildDir: string;
  indexesDir: string;
  runsDir: string;
  codebaseMap: string;
  knowledgeGraph: string;
  knowledgeLinks: string;
  /** Recall-optimised projection (guild.knowledge_links.v2) written by write-knowledge-links.ts */
  knowledgeRecall: string;
  fingerprint: string;
  partialGraph: string;
}

function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function sameDir(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

export function guildPaths(cwd: string): GuildPaths {
  const repoRoot = resolveMainRepoRoot(cwd);
  const sourceRoot = resolveSourceWorktreeRoot(cwd);
  const guildDir = durableGuildDir(repoRoot);
  const indexesDir = path.join(guildDir, "indexes");
  const runsDir = path.join(guildDir, "runs");
  return {
    repoRoot,
    sourceRoot: sameDir(sourceRoot, repoRoot) ? repoRoot : sourceRoot,
    guildDir,
    indexesDir,
    runsDir,
    codebaseMap: path.join(indexesDir, "codebase-map.json"),
    knowledgeGraph: path.join(indexesDir, "knowledge-graph.json"),
    knowledgeLinks: path.join(indexesDir, "knowledge-links.json"),
    knowledgeRecall: path.join(indexesDir, "knowledge-recall.json"),
    fingerprint: path.join(indexesDir, "understand-fingerprint.json"),
    partialGraph: path.join(indexesDir, "understand-partial-graph.json"),
  };
}

/** Max files walkRepo inventories; part of the declared scan policy. */
const SCAN_MAX_FILES = 20000;

/**
 * C13 source basis of the worktree containing `cwd`, under the learn scan policy
 * (walkRepo: defaults + root .guildignore, regular files only, symlinks not
 * followed, registered sub-guilds skipped, bytes read raw).
 */
export function computeLearnSourceBasis(cwd: string, opts: { maxFiles?: number } = {}): SourceBasis {
  const sourceRoot = resolveSourceWorktreeRoot(cwd);
  const maxFiles = opts.maxFiles ?? SCAN_MAX_FILES;
  const { files, filter, truncated, unreadable, unsupported } = walkRepo(sourceRoot, maxFiles);
  const subGuilds = [...registeredSubGuildPaths(sourceRoot)].sort();
  const guildignore = readContainedFile(sourceRoot, ".guildignore");
  const ignorePath = path.join(sourceRoot, ".guildignore");
  const guildignoreRefused = !guildignore && (isLink(ignorePath) || fs.existsSync(ignorePath));
  const scanPolicy = {
    policy: "guild.learn.scan_policy.v1",
    walker: "walkRepo",
    default_ignore: [...DEFAULT_IGNORE_PATTERNS],
    guildignore: guildignore ? guildignore.toString("utf8") : null,
    sub_guilds_skipped: subGuilds,
    symlinks: "not_followed",
    max_files: maxFiles,
    bytes: "raw",
  };
  const tsconfig = loadTsconfigChain(sourceRoot);
  return computeSourceBasis({
    sourceRoot,
    files,
    inScope: (rel) => !filter.isIgnored(rel) && !subGuilds.some((g) => rel === g || rel.startsWith(`${g}/`)),
    scanPolicy,
    resolverPolicy: {
      policy: "guild.learn.resolver_policy.v1",
      resolver: "structural",
      version: 1,
      tsconfig: `extends chain; contained regular files only; depth<=${TSCONFIG_MAX_DEPTH}`,
    },
    resolverInputs: ["package.json", ...tsconfig.hops.map((h) => h.path), ...tsconfig.probed],
    resolverUnresolved: [
      ...tsconfig.unresolved,
      ...(guildignoreRefused ? [".guildignore: not a contained regular file"] : []),
      // K02: files past the cap are neither inventoried nor compared.
      ...(truncated ? [`scan: max_files (${maxFiles}) exceeded; inventory incomplete`] : []),
      ...unreadable.map((d) => `scan: directory ${d || "."} unreadable; inventory incomplete`),
      ...unsupported.map((p) => `scan: ${JSON.stringify(p)} has a backslash or non-UTF-8 bytes in its name; inventory incomplete`),
    ],
  });
}

/**
 * Files to analyze: always a fresh walk of the scanned worktree. The owner's
 * codebase-map may come from another worktree or an older tree, so it is never
 * the inventory.
 */
export function scannedFileList(gp: GuildPaths): string[] {
  return walkRepo(gp.sourceRoot, SCAN_MAX_FILES).files;
}

/** True when `cwd` scans the owner worktree itself (not a linked lane). */
export function scansOwner(gp: GuildPaths): boolean {
  return sameDir(gp.sourceRoot, gp.repoRoot);
}

/** Deterministic JSON write (stable key order via replacer-free 2-space). */
export function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function readJson<T = unknown>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * source-basis.ts — K01: the scanned worktree is not the publication owner.
 *
 * A learn run reads bytes from ONE source worktree (a lane checkout, or main) and
 * publishes under a durable owner that is resolved separately (the main repo's
 * `.guild/`). This module builds the C13 `publication_basis` for the scanned
 * worktree: commit, tree, dirty blobs, file inventory, scan + resolver policy and
 * an opaque worktree id. The basis is a function of the bytes the scanner reads
 * under the declared policy, so a HEAD-only check cannot stand in for it and a
 * basis taken in one worktree never proves freshness for another.
 */

import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type Sha256 = `sha256:${string}`;

/** C13 `common.schema.json#/$defs/publication_basis` (A02 frozen, bundle v2). */
export interface PublicationBasis {
  commit: string | null;
  tree: Sha256;
  dirty_blob_manifest: Sha256;
  file_inventory: Sha256;
  resolver_policy: Sha256;
  scan_policy: Sha256;
  source_worktree_id: string;
}

export interface InventoryEntry {
  path: string;
  sha256: Sha256;
}

/** A path whose worktree bytes differ from HEAD. `sha256: null` = deleted. */
export interface DirtyEntry {
  path: string;
  sha256: Sha256 | null;
}

export interface SourceBasis {
  /** Absolute realpath of the scanned worktree. Never published: the id is. */
  source_root: string;
  basis: PublicationBasis;
  source_basis_hash: Sha256;
  inventory: InventoryEntry[];
  dirty: DirtyEntry[];
  /** Non-empty ⇒ the resolver depends on bytes the basis cannot see: freshness unknown. */
  resolver_unresolved: string[];
}

export type ChannelState = "current_for_basis" | "pending" | "stale" | "unknown";

/** RFC 8785 (JCS) for the JSON value space this module emits. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported ${typeof value}`);
}

/** C13 digest: `sha256:` + hex sha256 of the JCS bytes (matches build_schemas.py). */
export function basisDigest(value: unknown): Sha256 {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function bytesDigest(bytes: Buffer | string): Sha256 {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function realRoot(root: string): string {
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

/** Opaque, stable id for a worktree root; the absolute path is never published. */
export function sourceWorktreeId(root: string): string {
  return `worktree-${crypto.createHash("sha256").update(realRoot(root), "utf8").digest("hex").slice(0, 32)}`;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/**
 * The worktree that contains `cwd` (`--show-toplevel`), NOT the main worktree.
 * Falls back to `cwd` outside git.
 */
export function resolveSourceWorktreeRoot(cwd: string): string {
  const top = git(cwd, ["rev-parse", "--show-toplevel"])?.trim();
  return realRoot(top ? top : cwd);
}

/**
 * HEAD commit of the worktree at `root`, read from disk: follows a `.git` FILE
 * (linked worktree) to its gitdir, `commondir` to the shared refs, and
 * `packed-refs`. "" when `root` is not a git worktree or HEAD is unborn.
 */
export function readWorktreeHead(root: string): string {
  try {
    const dotGit = path.join(root, ".git");
    let gitDir = dotGit;
    if (fs.statSync(dotGit).isFile()) {
      const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dotGit, "utf8"));
      if (!m) return "";
      gitDir = path.resolve(root, m[1].trim());
    }
    let commonDir = gitDir;
    const commonFile = path.join(gitDir, "commondir");
    if (fs.existsSync(commonFile)) commonDir = path.resolve(gitDir, fs.readFileSync(commonFile, "utf8").trim());

    let ref = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    for (let hop = 0; hop < 5 && ref.startsWith("ref:"); hop++) {
      const name = ref.slice(4).trim();
      const loose = [path.join(gitDir, name), path.join(commonDir, name)].find((p) => fs.existsSync(p));
      if (loose) {
        ref = fs.readFileSync(loose, "utf8").trim();
        continue;
      }
      const packed = path.join(commonDir, "packed-refs");
      if (!fs.existsSync(packed)) return "";
      const line = fs
        .readFileSync(packed, "utf8")
        .split("\n")
        .find((l) => !l.startsWith("#") && !l.startsWith("^") && l.split(" ")[1] === name);
      return line ? line.split(" ")[0] : "";
    }
    return /^[0-9a-f]{40,64}$/.test(ref) ? ref : "";
  } catch {
    return "";
  }
}

type WorktreeEntry =
  | { kind: "file"; bytes: Buffer }
  | { kind: "symlink"; target: string }
  | { kind: "absent" }
  | { kind: "refused" };

/**
 * Read `rel` under `root` without leaving it: absolute paths, `..`/empty
 * segments and any symlinked directory component are refused before a byte is
 * read; a final symlink is reported by its target, never followed.
 */
function readWorktreeEntry(root: string, rel: string): WorktreeEntry {
  if (path.isAbsolute(rel) || rel.includes("\\")) return { kind: "refused" };
  const segs = rel.split("/");
  if (segs.some((seg) => seg === "" || seg === "." || seg === "..")) return { kind: "refused" };
  let cur = root;
  for (let i = 0; i < segs.length; i++) {
    cur = path.join(cur, segs[i]);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch {
      return { kind: "absent" };
    }
    const last = i === segs.length - 1;
    if (st.isSymbolicLink()) return last ? { kind: "symlink", target: fs.readlinkSync(cur) } : { kind: "refused" };
    if (!last && !st.isDirectory()) return { kind: "absent" };
    if (last) return st.isFile() ? { kind: "file", bytes: fs.readFileSync(cur) } : { kind: "refused" };
  }
  return { kind: "refused" };
}

/** Bytes of a regular file inside `root` reached without any symlink, else null. */
export function readContainedFile(root: string, rel: string): Buffer | null {
  const e = readWorktreeEntry(root, rel);
  return e.kind === "file" ? e.bytes : null;
}

function entryDigest(e: WorktreeEntry): Sha256 | null {
  if (e.kind === "file") return bytesDigest(e.bytes);
  if (e.kind === "symlink") return bytesDigest(`symlink:${e.target}`);
  return null;
}

/** git blob id of the entry as HEAD would store it (raw bytes, no filters). */
function gitBlobOid(e: WorktreeEntry, algo: string): { mode: "blob" | "link"; oid: string } | null {
  const body = e.kind === "file" ? e.bytes : e.kind === "symlink" ? Buffer.from(e.target, "utf8") : null;
  if (!body) return null;
  const oid = crypto.createHash(algo).update(`blob ${body.length}\0`).update(body).digest("hex");
  return { mode: e.kind === "symlink" ? "link" : "blob", oid };
}

/** Every HEAD entry as path → {mode, oid}. Empty for unborn HEAD / non-git. */
function headEntries(root: string): Map<string, { mode: "blob" | "link" | "other"; oid: string }> {
  const map = new Map<string, { mode: "blob" | "link" | "other"; oid: string }>();
  const out = git(root, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"]);
  if (out === null) return map;
  for (const rec of out.split("\0")) {
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const p = rec.slice(tab + 1);
    const [mode, , oid] = rec.slice(0, tab).split(" ");
    map.set(p, { mode: mode === "120000" ? "link" : mode.startsWith("100") ? "blob" : "other", oid });
  }
  return map;
}

export interface SourceBasisInput {
  /** Any path inside the worktree to scan. Resolved to its OWN toplevel. */
  sourceRoot: string;
  /** Repo-relative POSIX paths the scanner will read (its declared inventory). */
  files: readonly string[];
  /** True iff the scan policy would include `rel` were it present. */
  inScope: (rel: string) => boolean;
  /** Declared scan policy (ignore rules, symlink rule, caps). Hashed, not interpreted. */
  scanPolicy: unknown;
  /** Declared resolver policy (K02 owns its content). Hashed, not interpreted. */
  resolverPolicy: unknown;
  /**
   * Repo-relative files the resolver reads even when the scan policy excludes
   * them (e.g. tsconfig.json). Their bytes are bound into `resolver_policy`.
   */
  resolverInputs?: readonly string[];
  /** Resolver inputs that could not be read under the containment rules. */
  resolverUnresolved?: readonly string[];
}

export function computeSourceBasis(input: SourceBasisInput): SourceBasis {
  const root = resolveSourceWorktreeRoot(input.sourceRoot);

  const headOid = git(root, ["rev-parse", "--verify", "-q", "HEAD"])?.trim() ?? "";
  const algo = headOid.length === 64 ? "sha256" : "sha1";
  const head = headEntries(root);

  // Dirty = scanned bytes differ from HEAD, or an in-scope HEAD path is gone
  // (deleted, or now only reachable through a symlink). Derived from the inventory and HEAD only: index state never counts.
  const inventory: InventoryEntry[] = [];
  const dirty: DirtyEntry[] = [];
  for (const rel of [...new Set(input.files)].sort()) {
    const e = readWorktreeEntry(root, rel);
    if (e.kind !== "file") continue;
    const sha = bytesDigest(e.bytes);
    inventory.push({ path: rel, sha256: sha });
    const h = head.get(rel);
    const w = gitBlobOid(e, algo)!;
    if (!h || h.mode !== w.mode || h.oid !== w.oid) dirty.push({ path: rel, sha256: sha });
  }
  const scanned = new Set(inventory.map((e) => e.path));
  for (const rel of head.keys()) {
    if (scanned.has(rel) || !input.inScope(rel)) continue;
    const kind = readWorktreeEntry(root, rel).kind;
    if (kind === "absent" || kind === "refused") dirty.push({ path: rel, sha256: null });
  }
  dirty.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));

  const resolverUnresolved = [...new Set(input.resolverUnresolved ?? [])].sort();
  const resolverInputs: Record<string, Sha256 | null> = {};
  for (const rel of [...new Set(input.resolverInputs ?? [])].sort()) {
    const e = readWorktreeEntry(root, rel);
    resolverInputs[rel] = e.kind === "file" ? bytesDigest(e.bytes) : null;
  }

  const commit = git(root, ["rev-parse", "--verify", "-q", "HEAD"])?.trim() || null;
  const treeOid = commit ? git(root, ["rev-parse", "HEAD^{tree}"])?.trim() ?? null : null;

  const basis: PublicationBasis = {
    commit,
    tree: basisDigest({ git_tree: treeOid }),
    dirty_blob_manifest: basisDigest(dirty),
    file_inventory: basisDigest(inventory),
    resolver_policy: basisDigest({ policy: input.resolverPolicy, inputs: resolverInputs, unresolved: resolverUnresolved }),
    scan_policy: basisDigest(input.scanPolicy),
    source_worktree_id: sourceWorktreeId(root),
  };
  return { source_root: root, basis, source_basis_hash: basisDigest(basis), inventory, dirty, resolver_unresolved: resolverUnresolved };
}

type BasisRef = Pick<SourceBasis, "basis" | "source_basis_hash"> & { resolver_unresolved?: readonly string[] };

/**
 * Channel state of a layer published for `published` when the reader observes
 * `observed`. A different worktree is `unknown`, never current: lane output says
 * nothing about main bytes (and vice versa). Unresolved resolver inputs are
 * `unknown` too: bytes outside the basis may have changed.
 */
export function freshnessFor(published: BasisRef, observed: BasisRef | null): ChannelState {
  if (!observed) return "unknown";
  if (published.basis.source_worktree_id !== observed.basis.source_worktree_id) return "unknown";
  if (published.resolver_unresolved?.length || observed.resolver_unresolved?.length) return "unknown";
  return published.source_basis_hash === observed.source_basis_hash ? "current_for_basis" : "stale";
}

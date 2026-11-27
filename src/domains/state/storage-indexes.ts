/**
 * src/domains/state/storage-indexes.ts
 *
 * The one resolver for derived knowledge indexes (codebase map, graph, links,
 * recall, the K03 publication store). Layout 2 (`caches-out`, §21.11) keeps them
 * on the platform cache root, off `.guild/`; a layout 1 or unmarked root keeps
 * `.guild/indexes` unchanged. Depends only on storage-roots/policy so
 * guild-discovery can use it without an import cycle.
 *
 * CONTRACT: reads one marker file and stats; never creates a directory.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { assertClassPlacement } from "./storage-policy";
import { guildRootCacheBase, guildRootId, resolveStorageRoots } from "./storage-roots";

/**
 * Resolve symlinks before the root id is derived.
 *
 * A DURABLE path is inside the repo, so a writer and a reader always agree on it
 * however they spelled the root. A CACHE path is keyed by a hash of the root, so
 * a symlinked temp root and its resolved spelling (one directory on macOS) key two
 * different caches. Resolving first makes the key the directory, not the spelling.
 * A path that does not exist yet is returned unchanged.
 */
export function realRoot(cwd: string): string {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return cwd;
  }
}

/** The layout version a root's `.guild/storage-layout.json` marker records; null when absent or unreadable. */
export function readStorageLayoutVersion(root: string): number | null {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(root, ".guild", "storage-layout.json"), "utf8")) as {
      storage_layout_version?: unknown;
    };
    return typeof doc.storage_layout_version === "number" ? doc.storage_layout_version : null;
  } catch {
    return null;
  }
}

/** `<root>/.guild/indexes`: the layout 1 home, and the read fallback on layout 2 until the next upgrade removes it. */
export function legacyIndexesDir(root: string): string {
  return path.join(root, ".guild", "indexes");
}

/**
 * Where derived knowledge indexes are WRITTEN: the platform cache root on layout
 * 2, `.guild/indexes` on layout 1 / unmarked. Every index reader and writer goes
 * through this (or the read variants below).
 */
export function knowledgeIndexesDir(root: string): string {
  const v = readStorageLayoutVersion(root);
  if (v === null || v < 2) return legacyIndexesDir(root);
  const real = realRoot(root);
  const roots = resolveStorageRoots({ activeRoot: real });
  const abs = path.join(guildRootCacheBase(roots, guildRootId(real)), "indexes");
  assertClassPlacement("cache", abs, roots.durable);
  return abs;
}

/**
 * Where indexes are READ from. A layout 2 root reads the cache dir and falls back
 * to a legacy `.guild/indexes` until the next upgrade's `caches-out` removes it.
 * `probe` is the entry (or any of several) that decides which tree holds the data (default: the K03
 * publication store); a whole tree is chosen so generations are never mixed.
 */
export function knowledgeIndexesReadDir(root: string, probe: string | readonly string[] = "publication"): string {
  const primary = knowledgeIndexesDir(root);
  const legacy = legacyIndexesDir(root);
  const probes = typeof probe === "string" ? [probe] : probe;
  const has = (dir: string): boolean => probes.some((n) => fs.existsSync(path.join(dir, n)));
  if (primary === legacy || has(primary)) return primary;
  return has(legacy) ? legacy : primary;
}

/** One index file for READING: the primary location, else the legacy copy while it still exists. */
export function knowledgeIndexReadPath(root: string, ...segments: string[]): string {
  const primary = path.join(knowledgeIndexesDir(root), ...segments);
  if (fs.existsSync(primary)) return primary;
  const legacy = path.join(legacyIndexesDir(root), ...segments);
  return fs.existsSync(legacy) ? legacy : primary;
}


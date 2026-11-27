/**
 * src/domains/knowledge/legacy-adoption.ts
 *
 * Layout 2 moves derived indexes to the platform cache root. An existing legacy
 * `.guild/indexes` is ADOPTED into it once, as a unit per top-level entry, so a K03
 * publication (generations, pointers, recall layer) keeps its identity. The legacy
 * tree is only read; it stays until the upgrade's `caches-out` removes it.
 *
 *  - regular files and directories only: a symlink is never copied or followed, so
 *    no later write through the cache can reach `.guild/indexes`;
 *  - exclusive: one adoption lock per cache root; presence is re-checked inside it
 *    and an entry is installed with link/rename, which never replaces a cache entry;
 *  - validated: a publication is staged and read back (`readPublication`) before it
 *    is installed. A tree that is invalid or being written now is not adopted
 *    (learn rebuilds it in the cache) and the reason is recorded in `adoption.json`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { knowledgeIndexesDir, legacyIndexesDir } from "../state";
import { readPublication } from "./publication";

export interface AdoptionResult {
  adopted: string[];
  skipped: Array<{ entry: string; reason: string }>;
}

export interface AdoptionOptions {
  /** Test seam: runs after the in-lock presence check, before an entry is installed. */
  beforeInstall?: (entry: string) => void;
  /** How long a loser waits for the lock before proceeding without adopting. */
  lockWaitMs?: number;
}

const STALE_LOCK_MS = 60_000;
const NOT_ADOPTED = /(^|[\\/])(lock|\.claim-[^\\/]*)($|[\\/])/;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lstat(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function takeLock(lock: string, waitMs: number): boolean {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner"), `${process.pid}\n`);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return false;
    }
    const st = lstat(lock);
    let owner = NaN;
    try {
      owner = Number(fs.readFileSync(path.join(lock, "owner"), "utf8").trim());
    } catch {
      /* owner not written yet */
    }
    const dead = Number.isFinite(owner) && !pidAlive(owner);
    if (st && (dead || Date.now() - st.mtimeMs > STALE_LOCK_MS)) {
      fs.rmSync(lock, { recursive: true, force: true });
      continue;
    }
    if (Date.now() >= deadline) return false;
    sleep(25);
  }
}

/** Why a legacy publication must not be adopted now, or null when it may be staged. */
function inFlight(legacyPub: string): string | null {
  if (lstat(path.join(legacyPub, "lock"))) return "a publisher lock is present (publication in flight)";
  try {
    const stale = fs.readdirSync(path.join(legacyPub, "successors")).find((n) => n.startsWith(".claim-"));
    if (stale) return "a successor claim is present (publication in flight)";
  } catch {
    /* no successors dir */
  }
  return null;
}

function install(tmp: string, to: string): void {
  if (fs.lstatSync(tmp).isDirectory()) {
    fs.renameSync(tmp, to); // fails when a non-empty directory appeared meanwhile
  } else {
    fs.linkSync(tmp, to); // EEXIST when a peer or writer created it: never replaces
    fs.rmSync(tmp, { force: true });
  }
}

function record(dest: string, skipped: AdoptionResult["skipped"]): void {
  const file = path.join(dest, "adoption.json");
  try {
    if (skipped.length === 0) {
      fs.rmSync(file, { force: true });
      return;
    }
    fs.writeFileSync(file, JSON.stringify({ schema: "guild.legacy_index_adoption.v1", skipped }, null, 2) + "\n");
  } catch {
    /* advisory */
  }
}

export function adoptLegacyKnowledgeIndexes(root: string, opts: AdoptionOptions = {}): AdoptionResult {
  const result: AdoptionResult = { adopted: [], skipped: [] };
  const dest = knowledgeIndexesDir(root);
  const legacy = legacyIndexesDir(root);
  if (dest === legacy) return result;
  const lroot = lstat(legacy);
  if (!lroot || !lroot.isDirectory()) return result;
  let names: string[];
  try {
    names = fs.readdirSync(legacy).filter((n) => !n.startsWith(".adopt-"));
  } catch {
    return result;
  }
  // Cheap exit: nothing legacy is missing from the cache.
  if (names.every((n) => lstat(path.join(dest, n)) !== null || lstat(path.join(legacy, n))?.isSymbolicLink())) return result;
  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch {
    return result;
  }
  const lock = `${dest}.adopt-lock`;
  if (!takeLock(lock, opts.lockWaitMs ?? 2000)) return result; // lost: proceed without adopting
  try {
    for (const name of names) {
      const from = path.join(legacy, name);
      const to = path.join(dest, name);
      const st = lstat(from);
      if (!st || st.isSymbolicLink() || !(st.isFile() || st.isDirectory())) {
        result.skipped.push({ entry: name, reason: "not a regular file or directory (symlinks are never adopted)" });
        continue;
      }
      if (lstat(to)) continue; // never replace a cache entry
      if (name === "publication") {
        const why = inFlight(from);
        if (why) {
          result.skipped.push({ entry: name, reason: why });
          continue;
        }
      }
      const stage = path.join(dest, `.adopt-${process.pid}-stage`);
      fs.rmSync(stage, { recursive: true, force: true });
      try {
        fs.mkdirSync(stage);
        const tmp = path.join(stage, name);
        fs.cpSync(from, tmp, {
          recursive: true,
          filter: (src) => {
            const s = lstat(src);
            if (!s || s.isSymbolicLink()) return false;
            if (!(s.isFile() || s.isDirectory())) return false;
            return !NOT_ADOPTED.test(path.relative(from, src));
          },
        });
        if (name === "publication") {
          try {
            readPublication(stage);
          } catch (err) {
            result.skipped.push({ entry: name, reason: `legacy publication is not readable: ${(err as Error).message}` });
            continue;
          }
        }
        opts.beforeInstall?.(name);
        if (lstat(to)) continue; // a writer created it meanwhile
        install(tmp, to);
        result.adopted.push(name);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST" && (err as NodeJS.ErrnoException).code !== "ENOTEMPTY") {
          result.skipped.push({ entry: name, reason: `adoption failed: ${(err as Error).message}` });
        }
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
      }
    }
    record(dest, result.skipped);
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
  return result;
}

/**
 * learn/lib/walk.ts — deterministic, ignore-aware file discovery.
 */

import * as fs from "fs";
import * as path from "path";
import { createIgnoreFilter, type IgnoreFilter } from "./ignore";

export interface WalkResult {
  files: string[]; // repo-relative, POSIX-separated, sorted
  filter: IgnoreFilter;
}

/** Recursively list non-ignored files under repoRoot (sorted, deterministic). */
export function walkRepo(repoRoot: string, maxFiles = 20000): WalkResult {
  const filter = createIgnoreFilter(repoRoot);
  const out: string[] = [];

  const visit = (absDir: string) => {
    if (out.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
      if (e.isDirectory()) {
        if (filter.isIgnored(rel) || filter.isIgnored(rel + "/")) continue;
        visit(abs);
      } else if (e.isFile()) {
        if (filter.isIgnored(rel)) continue;
        out.push(rel);
        if (out.length >= maxFiles) return;
      }
    }
  };
  visit(repoRoot);
  out.sort();
  return { files: out, filter };
}

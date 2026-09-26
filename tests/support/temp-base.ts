/**
 * tests/support/temp-base.ts — a temp base with no Guild or git anchor above it.
 *
 * Root discovery climbs until it meets a `.git` or `.guild`. The OS temp dir is
 * the natural base for a "no anchor anywhere" fixture, but a machine can carry a
 * stray `$TMPDIR/.guild` left by an earlier tool, which the climb rightly finds.
 * A fixture that needs a clean climb takes its base from here instead.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** The nearest `.git` / `.guild` at or above `dir`, or null. */
export function anchorAtOrAbove(dir: string): string | null {
  for (let cur = path.resolve(dir); ; cur = path.dirname(cur)) {
    for (const marker of [".git", ".guild"]) {
      if (fs.existsSync(path.join(cur, marker))) return path.join(cur, marker);
    }
    if (path.dirname(cur) === cur) return null;
  }
}

/** The first of the OS temp dir, /tmp and /var/tmp whose climb meets no anchor. */
export function anchorFreeTempBase(): string {
  const candidates = [os.tmpdir(), "/tmp", "/var/tmp"];
  for (const base of candidates) {
    if (fs.existsSync(base) && anchorAtOrAbove(base) === null) return base;
  }
  throw new Error(
    `no anchor-free temp base on this machine: ${candidates
      .map((b) => `${b} -> ${anchorAtOrAbove(b) ?? "missing"}`)
      .join(", ")}`,
  );
}

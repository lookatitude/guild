/**
 * hooks/lib/runs-gitignore.ts — #219: init scaffolds the ignore rule for
 * run-local state.
 *
 * `.guild/runs/` is per-machine telemetry (current-run-id, logs, every new run
 * dir). Committed with a first `/guild:init`, it churns on every later run, so a
 * re-init on an unchanged repo dirties the tree. Init writes `.guild/.gitignore`
 * ignoring `runs/`, which travels with the committed `.guild/` to every clone.
 *
 * Conservative: never clobbers an existing `.guild/.gitignore`, does nothing
 * outside a git work tree, and leaves a repo alone when it already tracks files
 * under `.guild/runs/` (that repo has opted into sharing run records).
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { durableGuildDir } from "../../src/domains/state";

const RULES =
  "# Run-local Guild state (telemetry, current-run-id). Remove to share runs.\n" +
  "/runs/\n";

/** Returns true when it wrote `.guild/.gitignore`. Best-effort; never throws. */
export function ensureRunsGitignored(root: string): boolean {
  try {
    const file = path.join(durableGuildDir(root), ".gitignore");
    if (fs.existsSync(file)) return false;
    const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" });
    if (inside.status !== 0 || inside.stdout.trim() !== "true") return false;
    const tracked = spawnSync("git", ["ls-files", "--", ".guild/runs"], { cwd: root, encoding: "utf8" });
    if (tracked.status !== 0 || tracked.stdout.trim().length > 0) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, RULES, { encoding: "utf8", flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

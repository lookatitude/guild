/**
 * tests/e00/support/e00-admission-snapshot.ts — one observation of a run's emitted
 * attempt-1 state, shared by the test-child preload and the parent test so both sides
 * compare the same shape. Claims are observed by stat only (size, mtime, inode); their
 * nonce-bearing bytes are never opened. Every other file under the attempt dir is hashed.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface AttemptSnapshot { [task: string]: { claim: { size: number; mtimeMs: number; ino: number } | null; files: Record<string, string> } }

export function snapshotAttempts(root: string, runId: string, tasks: readonly string[]): AttemptSnapshot {
  const out: AttemptSnapshot = {};
  for (const task of tasks) {
    const dir = path.join(root, ".guild", "runs", runId, "task-cells", task, "attempts", "1");
    const claimFile = path.join(dir, "launch-claim.json");
    const s = fs.existsSync(claimFile) ? fs.statSync(claimFile) : null;
    const files: Record<string, string> = {};
    const walk = (d: string) => {
      for (const n of fs.existsSync(d) ? fs.readdirSync(d).sort() : []) {
        const p = path.join(d, n);
        if (p === claimFile) continue;
        if (fs.statSync(p).isDirectory()) walk(p);
        else files[path.relative(dir, p)] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      }
    };
    walk(dir);
    out[task] = { claim: s ? { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino } : null, files };
  }
  return out;
}

/** Emitted attempt-1 lanes as recorded on disk: task and the instance its attempt record names. */
export function emittedLanes(root: string, runId: string, tasks: readonly string[]): Array<{ task: string; instance_id: string | null }> {
  return tasks.map((task) => {
    const a = path.join(root, ".guild", "runs", runId, "task-cells", task, "attempts", "1", "attempt.json");
    const rec = fs.existsSync(a) ? JSON.parse(fs.readFileSync(a, "utf8")) as { instance_id?: unknown } : null;
    return { task, instance_id: typeof rec?.instance_id === "string" ? rec.instance_id : null };
  });
}

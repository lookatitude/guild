/**
 * lib/retention.ts — run-record retention enforcement (deferred item 14;
 * docs/v2/06-initiatives.md §Per-run provenance).
 *
 * Each run records a `retention_class` ("one-off-90d" | "until-archive"). This
 * is the deferred cleanup job: identify one-off runs whose 90-day window has
 * elapsed. `until-archive` runs are NEVER expired by age (they live until their
 * initiative is archived). Pure identification + an explicit sweep — the caller
 * supplies `nowMs` (deterministic) and opts into deletion.
 */
import * as fs from "fs";
import * as path from "path";
import { resolveGuildRoot } from "./guild-root";

export type RetentionClass = "one-off-90d" | "until-archive";
export const DEFAULT_RETENTION_DAYS = 90;

export interface RunRetentionInfo {
  run_id: string;
  retention_class: RetentionClass | string;
  closed_at?: string;
  dir: string;
}

/**
 * True iff a run is past its retention window: only `one-off-90d` runs expire,
 * and only once `days` have elapsed since `closed_at`. Missing/!closed_at or
 * `until-archive` → never expired.
 */
export function isExpired(info: { retention_class: string; closed_at?: string }, nowMs: number, days = DEFAULT_RETENTION_DAYS): boolean {
  if (info.retention_class !== "one-off-90d") return false;
  if (!info.closed_at) return false;
  const closedMs = Date.parse(info.closed_at);
  if (Number.isNaN(closedMs)) return false;
  return nowMs - closedMs > days * 86_400_000;
}

/** Scan `.guild/runs/*` provenance.json and return the runs eligible for cleanup. */
export function findExpiredRuns(guildDir: string, nowMs: number, days = DEFAULT_RETENTION_DAYS): RunRetentionInfo[] {
  const runsDir = path.join(guildDir, "runs");
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(runsDir, { withFileTypes: true }); } catch { return []; }
  const out: RunRetentionInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(runsDir, e.name);
    const prov = path.join(dir, "provenance.json");
    if (!fs.existsSync(prov)) continue;
    let p: { run_id?: string; retention_class?: string; closed_at?: string };
    try { p = JSON.parse(fs.readFileSync(prov, "utf8")); } catch { continue; }
    const info = { run_id: p.run_id ?? e.name, retention_class: p.retention_class ?? "until-archive", closed_at: p.closed_at, dir };
    if (isExpired(info, nowMs, days)) out.push(info as RunRetentionInfo);
  }
  return out.sort((a, b) => a.run_id.localeCompare(b.run_id));
}

/**
 * Sweep expired runs. dryRun (default true) only reports; { dryRun: false }
 * removes the run directories. Returns what was (or would be) removed.
 */
export function sweepExpiredRuns(
  guildDir: string,
  nowMs: number,
  opts: { days?: number; dryRun?: boolean } = {},
): { removed: RunRetentionInfo[]; dryRun: boolean } {
  const days = opts.days ?? DEFAULT_RETENTION_DAYS;
  const dryRun = opts.dryRun !== false; // default true — never delete unless explicitly opted in
  const expired = findExpiredRuns(guildDir, nowMs, days);
  if (!dryRun) {
    for (const r of expired) fs.rmSync(r.dir, { recursive: true, force: true });
  }
  return { removed: expired, dryRun };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  // Default: walk up from process.cwd() to the repo root so a sub-directory
  // invocation never creates or targets a nested .guild/.
  // An explicit --guild-dir takes precedence (honored unchanged).
  // Decision: .guild/wiki/decisions/telemetry-anchors-to-repo-root-not-cwd.md
  let guildDir = path.join(resolveGuildRoot(process.cwd()), ".guild");
  let apply = false;
  let nowMs = Date.now();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--guild-dir" && argv[i + 1]) guildDir = path.resolve(argv[++i]);
    else if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--now" && argv[i + 1]) nowMs = Date.parse(argv[++i]!) || nowMs;
  }
  const { removed, dryRun } = sweepExpiredRuns(guildDir, nowMs, { dryRun: !apply });
  process.stdout.write(
    `[retention] ${dryRun ? "DRY-RUN" : "APPLIED"}: ${removed.length} expired one-off run(s)` +
      (removed.length ? `:\n${removed.map((r) => `  ${r.run_id} (closed ${r.closed_at})`).join("\n")}\n` : "\n"),
  );
}

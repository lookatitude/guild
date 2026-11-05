/**
 * E00-T0 · supplement to the frozen H r1 reds (implementation/e00/h-r1-scope-decisions.json Q2), the same
 * F1 readback; not a new formal finding. The frozen 27-case file is unchanged.
 *
 * The real TaskCompleted hook runs ensureStorageLayout (hooks/lib/ensure-layout.ts) BEFORE the unbound E00
 * branch. Per the canonical detect(): no marker or an unparseable marker is "unmarked", a lower version is
 * "stale" (both run the write-capable upgrade chain), a higher version is "future" (refused, no writes), and
 * CURRENT_LAYOUT_VERSION is "current". An unbound E00 callback on an unmarked, malformed or stale root must
 * refuse with ZERO writes (no marker, migration, backup, bus, security record or notice) in the root and in
 * the relocated state/cache roots. Controls: a current initialized clean root stays notice-only; the bound
 * (authorized) path on an unmarked root keeps its migration; a future marker is already refused.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { buildTaskCell, writeTaskCell } from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { hermeticEnv } from "../../hooks/test-support/hermetic-env";
import { ensureStorageLayout } from "../../hooks/lib/ensure-layout";
import { CURRENT_LAYOUT_VERSION } from "../../scripts/lib/state/ensure-storage-layout";
import { PLUGIN, ownedTempDir, receiptBytes, teardownOwned } from "./support/e00-harness";

afterEach(teardownOwned);

const TC_SCRIPT = path.join(PLUGIN, "hooks", "agent-team", "task-completed.ts");
const RUN_ID = "run-e00-h1l";
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

interface Fx { root: string; ext: string; bindingRef: string; c: ReturnType<typeof buildTaskCell>; notice: string; marker: string }
function fixture(): Fx {
  const root = ownedTempDir("guild-e00-h1l-");
  const ext = ownedTempDir("guild-e00-h1l-ext-");
  for (const d of ["state", "cache", "temp"]) fs.mkdirSync(path.join(ext, d), { recursive: true });
  const bindingRef = mintRunBinding({ root, run_id: RUN_ID }).binding_ref;
  const c = buildTaskCell({
    runId: RUN_ID, logicalTaskId: "task-001", taskRunId: "task-001.tr1", attempt: 1, attemptId: "task-001.att1",
    instanceId: "task-001.a1.i1", cellId: "cell-task-001", goalId: "goal-e00", phaseId: "build", stepId: "task-001",
    teamId: "guild-team", workerRole: "backend", specialistTypeId: "backend", specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${RUN_ID}/backend-task-001.md`, contextBundleHash: "sha256:ctx",
    hostId: "claude-code-cli", adapterId: "claude-code-cli@1", hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux", modelTier: "mid", objective: "e00 h1 layout", scopePaths: ["hooks/agent-team"],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: ["npm test -- hook"],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, leadBindingId: "lead-binding-e00",
    now: () => "2026-10-26T13:00:00.000Z",
  });
  (c.assignment as Record<string, unknown>)["done_when_ref"] = {
    oracle_plan_path: `.guild/runs/${RUN_ID}/oracle-plan/build.json`, oracle_plan_sha256: "a".repeat(64), decision_sha256: "b".repeat(64),
  };
  writeTaskCell(root, c, { binding_ref: bindingRef });
  const receipt = path.join(root, ".guild", "runs", RUN_ID, "handoffs", "backend-task-001.md");
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  fs.writeFileSync(receipt, receiptBytes(RUN_ID, c.assignment));
  const notice = path.join(root, ".guild", "runs", RUN_ID, "outbox", c.assignment.instance_id, "task-completed-notice.json");
  return { root, ext, bindingRef, c, notice, marker: path.join(root, ".guild", "storage-layout.json") };
}
function runTC(f: Fx, bound: boolean) {
  const r = spawnSync("npx", ["tsx", TC_SCRIPT], {
    input: JSON.stringify({ session_id: "e00-h1l", cwd: f.root, hook_event_name: "TaskCompleted", task_id: f.c.assignment.logical_task_id,
      task_subject: "e00", teammate_name: f.c.assignment.worker_role, team_name: "guild-team" }),
    encoding: "utf8",
    env: { ...hermeticEnv(), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: RUN_ID, GUILD_TASK_ASSIGNMENT: f.c.assignment.assignment_path,
      GUILD_STATE_HOME: path.join(f.ext, "state"), GUILD_CACHE_HOME: path.join(f.ext, "cache"), GUILD_TEMP_HOME: path.join(f.ext, "temp"),
      ...(bound ? { GUILD_RUN_BINDING_REF: f.bindingRef } : {}) },
    timeout: 60000,
  });
  return { status: r.status, timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" };
}
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n); const s = fs.lstatSync(p); const k = path.relative(dir, p);
      if (s.isSymbolicLink()) out[k] = `link:${fs.readlinkSync(p)}`;
      else if (s.isDirectory()) { out[k] = "dir"; walk(p); }
      else if (s.isFile()) out[k] = sha(fs.readFileSync(p));
      else out[k] = "special";
    }
  };
  walk(dir);
  return out;
}
const delta = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const stateCache = (f: Fx) => ({ ...Object.fromEntries(Object.entries(tree(path.join(f.ext, "state"))).map(([k, v]) => [`state/${k}`, v])),
  ...Object.fromEntries(Object.entries(tree(path.join(f.ext, "cache"))).map(([k, v]) => [`cache/${k}`, v])) });

const INCOMPATIBLE: Array<[string, (f: Fx) => void]> = [
  ["malformed marker (not JSON, detect() reports unmarked)", (f) => { fs.writeFileSync(f.marker, "{ not json\n"); }],
  ["stale marker (an older layout version)", (f) => { fs.writeFileSync(f.marker, JSON.stringify({ storage_layout_version: CURRENT_LAYOUT_VERSION - 1 }) + "\n"); }],
];

describe("H1-F1 layout · an unbound E00 callback never upgrades or writes on a non-current layout", () => {
  // Refinement (h-r1-layout-idempotence-refinement Q2a): no marker plus a valid current-format assignment is a
  // supported pre-marker shape (the frozen CD4 fixtures are unmarked): notice only, no migration or other write.
  it("absent marker with a valid current-format E00 assignment: exit 0, the notice is the only root write, zero state/cache writes", () => {
    const f = fixture();
    fs.rmSync(f.marker, { force: true });
    const rootBefore = tree(f.root); const extBefore = stateCache(f);
    const r = runTC(f, false);
    const noticeRel = path.relative(f.root, f.notice);
    expect(r.timedOut).toBe(false);
    expect({ status: r.status, notice_written: fs.existsSync(f.notice), marker_written: fs.existsSync(f.marker),
      other_root_writes: delta(rootBefore, tree(f.root)).filter((k) => k !== noticeRel && !noticeRel.startsWith(`${k}${path.sep}`)),
      state_cache_delta: delta(extBefore, stateCache(f)) })
      .toEqual({ status: 0, notice_written: true, marker_written: false, other_root_writes: [], state_cache_delta: [] });
  });

  for (const [label, arrange] of INCOMPATIBLE) {
    it(`${label}: zero writes in the root and in state/cache, no marker change, no notice`, () => {
      const f = fixture();
      arrange(f);
      const rootBefore = tree(f.root); const extBefore = stateCache(f);
      const r = runTC(f, false);
      expect(r.timedOut).toBe(false);
      expect({ notice_written: fs.existsSync(f.notice), root_delta: delta(rootBefore, tree(f.root)), state_cache_delta: delta(extBefore, stateCache(f)) })
        .toEqual({ notice_written: false, root_delta: [], state_cache_delta: [] });
    });
  }

  it("guard: a future marker (newer layout) is refused with zero writes and no notice", () => {
    const f = fixture();
    fs.writeFileSync(f.marker, JSON.stringify({ storage_layout_version: CURRENT_LAYOUT_VERSION + 1 }) + "\n");
    const rootBefore = tree(f.root); const extBefore = stateCache(f);
    const r = runTC(f, false);
    expect({ timed_out: r.timedOut, notice_written: fs.existsSync(f.notice), root_delta: delta(rootBefore, tree(f.root)), state_cache_delta: delta(extBefore, stateCache(f)) })
      .toEqual({ timed_out: false, notice_written: false, root_delta: [], state_cache_delta: [] });
  });

  it("control: a current initialized clean root stays notice-only", () => {
    const f = fixture();
    expect(ensureStorageLayout(f.root, "e00-t0-fixture").ok).toBe(true);
    const marker = JSON.parse(fs.readFileSync(f.marker, "utf8")) as { storage_layout_version?: unknown };
    expect(marker.storage_layout_version).toBe(CURRENT_LAYOUT_VERSION);
    const rootBefore = tree(f.root);
    const r = runTC(f, false);
    const noticeRel = path.relative(f.root, f.notice);
    expect({ timed_out: r.timedOut, notice_written: fs.existsSync(f.notice),
      other_root_writes: delta(rootBefore, tree(f.root)).filter((k) => k !== noticeRel && !noticeRel.startsWith(`${k}${path.sep}`)) })
      .toEqual({ timed_out: false, notice_written: true, other_root_writes: [] });
  });

  it("control: the bound (authorized) path on an unmarked root keeps its migration and publishes", () => {
    const f = fixture();
    fs.rmSync(f.marker, { force: true });
    const r = runTC(f, true);
    const marker = fs.existsSync(f.marker) ? (JSON.parse(fs.readFileSync(f.marker, "utf8")) as { storage_layout_version?: unknown }).storage_layout_version : null;
    expect({ status: r.status, migrated_to_current: marker === CURRENT_LAYOUT_VERSION, pointer: fs.existsSync(path.join(f.root, f.c.assignment.handoff_path)) })
      .toEqual({ status: 0, migrated_to_current: true, pointer: true });
  });
});

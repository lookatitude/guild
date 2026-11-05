/**
 * E00-T0 · independent reds for the H r1 findings (review/G-lane-E00-H/result-r1.json,
 * implementation/e00/h-r1-triage-and-test-release.json), authored BEFORE any H source change.
 *
 * H1-F1 an unbound TaskCompleted on a valid E00 assignment writes ONLY its exclusive notice:
 *       the receipt keeps its bytes, mtime and inode even when the scrub would rewrite it (a
 *       redactable canary) or quarantine it (read-only receipt), and no quarantine, security or
 *       bus record appears anywhere in the root. The canary never reaches hook output. Bound and
 *       legacy controls keep their behaviour.
 * H1-F2 an outbox or instance directory that is a symlink never lets the notice land outside the
 *       root; a leaf FIFO or symlink at the notice path is never read or followed.
 * H1-F3 the lane binding guard denies supported Glob, Grep-glob and Bash forms that resolve to
 *       .guild/runs/<run>/binding.json; near-match inputs stay allowed.
 * H1-F4 an identical repeated callback for the same assignment succeeds and keeps the first
 *       notice's bytes (and timestamp); a conflicting or malformed existing notice fails with no
 *       overwrite.
 *
 * Real hooks run as in the frozen H22 files (npx tsx of hooks/agent-team/task-completed.ts and
 * hooks/pre-tool-use.ts) on owned temp roots; private values are compared only as booleans.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { admitLane } from "../../scripts/lib/host/__tests__/admit-lane";
import { buildTaskCell, writeTaskCell } from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { hermeticEnv } from "../../hooks/test-support/hermetic-env";
import { ensureStorageLayout } from "../../hooks/lib/ensure-layout";
import { PLUGIN, ownedTempDir, receiptBytes, teardownOwned } from "./support/e00-harness";

afterEach(teardownOwned);

const TC_SCRIPT = path.join(PLUGIN, "hooks", "agent-team", "task-completed.ts");
const PTU_SCRIPT = path.join(PLUGIN, "hooks", "pre-tool-use.ts");
const RUN_ID = "run-e00-h1";
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

// ── TaskCompleted fixture (same shape as the frozen CD4 file) ──

interface Fx { root: string; bindingRef: string; c: ReturnType<typeof buildTaskCell>; receipt: string; notice: string }
function fixture(o: { e00?: boolean; canary?: string } = {}): Fx {
  const root = ownedTempDir("guild-e00-h1-");
  const bindingRef = mintRunBinding({ root, run_id: RUN_ID }).binding_ref;
  const c = buildTaskCell({
    runId: RUN_ID, logicalTaskId: "task-001", taskRunId: "task-001.tr1", attempt: 1, attemptId: "task-001.att1",
    instanceId: "task-001.a1.i1", cellId: "cell-task-001", goalId: "goal-e00", phaseId: "build", stepId: "task-001",
    teamId: "guild-team", workerRole: "backend", specialistTypeId: "backend", specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${RUN_ID}/backend-task-001.md`, contextBundleHash: "sha256:ctx",
    hostId: "claude-code-cli", adapterId: "claude-code-cli@1", hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux", modelTier: "mid", objective: "e00 h1", scopePaths: ["hooks/agent-team"],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: ["npm test -- hook"],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, leadBindingId: "lead-binding-e00",
    now: () => "2026-10-26T13:00:00.000Z",
  });
  if (o.e00 !== false) {
    (c.assignment as Record<string, unknown>)["done_when_ref"] = {
      oracle_plan_path: `.guild/runs/${RUN_ID}/oracle-plan/build.json`, oracle_plan_sha256: "a".repeat(64), decision_sha256: "b".repeat(64),
    };
  }
  writeTaskCell(root, c, { binding_ref: bindingRef });
  const receipt = path.join(root, ".guild", "runs", RUN_ID, "handoffs", "backend-task-001.md");
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  let body = receiptBytes(RUN_ID, c.assignment);
  if (o.canary) body = body.replace("- runtime collection", `- runtime collection ${o.canary}`);
  fs.writeFileSync(receipt, body);
  const notice = path.join(root, ".guild", "runs", RUN_ID, "outbox", c.assignment.instance_id, "task-completed-notice.json");
  // Provision the current storage layout up front (the hook's own first-write bootstrap), so the
  // F1 tree comparison isolates the TaskCompleted path itself.
  expect(ensureStorageLayout(root, "e00-t0-fixture").ok).toBe(true);
  return { root, bindingRef, c, receipt, notice };
}
function runTC(f: Fx, bound: boolean, timeoutMs = 30000) {
  const r = spawnSync("npx", ["tsx", TC_SCRIPT], {
    input: JSON.stringify({ session_id: "e00-h1", cwd: f.root, hook_event_name: "TaskCompleted", task_id: f.c.assignment.logical_task_id,
      task_subject: "e00", teammate_name: f.c.assignment.worker_role, team_name: "guild-team" }),
    encoding: "utf8",
    env: { ...hermeticEnv(), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: RUN_ID, GUILD_TASK_ASSIGNMENT: f.c.assignment.assignment_path,
      ...(bound ? { GUILD_RUN_BINDING_REF: f.bindingRef } : {}) },
    timeout: timeoutMs,
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" };
}
/** Every entry under `dir`: file -> sha256, symlink -> target, fifo/other -> type, dir -> "dir". */
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
const delta = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const statOf = (p: string) => { const s = fs.statSync(p); return `${s.size}/${s.mtimeMs}/${s.ino}`; };
const awsCanary = () => `AKIA${crypto.randomBytes(12).toString("hex").toUpperCase().slice(0, 16)}`;

// ── H1-F1 ──

describe("H1-F1 · the unbound E00 path writes only its exclusive notice", () => {
  const cases: Array<[string, { canary: boolean; readOnly: boolean }]> = [
    ["plain valid receipt (scrub rewrites in place)", { canary: false, readOnly: false }],
    ["receipt holding a redactable secret canary (scrub would rewrite it)", { canary: true, readOnly: false }],
    ["read-only receipt holding the canary (scrub would quarantine and emit security/bus records)", { canary: true, readOnly: true }],
  ];
  for (const [label, o] of cases) {
    it(`${label}: only the notice is added; receipt bytes/mtime/inode unchanged; no quarantine; canary never in output`, () => {
      const canary = o.canary ? awsCanary() : null;
      const f = fixture({ canary: canary ?? undefined });
      if (o.readOnly) fs.chmodSync(f.receipt, 0o444);
      const before = tree(f.root);
      const rStat = statOf(f.receipt);
      const r = runTC(f, false);
      const changed = delta(before, tree(f.root));
      const noticeRel = path.relative(f.root, f.notice);
      // Precondition: the hook ran to completion (no hang).
      expect(r.timedOut).toBe(false);
      expect({
        notice_written: fs.existsSync(f.notice),
        status_ok: r.status === 0,
        extra_paths: changed.filter((k) => k !== noticeRel && !noticeRel.startsWith(`${k}${path.sep}`) ),
        receipt_unchanged: fs.existsSync(f.receipt) && statOf(f.receipt) === rStat && sha(fs.readFileSync(f.receipt)) === before[path.relative(f.root, f.receipt)],
        quarantined: fs.existsSync(`${f.receipt}.quarantined`),
        canary_in_output: canary !== null && r.out.includes(canary),
      // Scope correction (h-r1-scope-decisions Q1): a clean receipt is notice-only with success; when
      // redaction would be needed the unbound path refuses (nonzero) with zero writes and no notice.
      }).toEqual({ notice_written: !o.canary, status_ok: !o.canary, extra_paths: [], receipt_unchanged: true, quarantined: false, canary_in_output: false });
    });
  }

  it("control: the bound path publishes the pointer and scrubs the canary out of the receipt", () => {
    const canary = awsCanary();
    const f = fixture({ canary });
    const r = runTC(f, true);
    expect({ status: r.status, pointer: fs.existsSync(path.join(f.root, f.c.assignment.handoff_path)), receipt_scrubbed: !fs.readFileSync(f.receipt).includes(canary), canary_in_output: r.out.includes(canary) })
      .toEqual({ status: 0, pointer: true, receipt_scrubbed: true, canary_in_output: false });
  });

  it("control: an unbound legacy assignment keeps its refusal and writes no notice", () => {
    const f = fixture({ e00: false });
    const r = runTC(f, false);
    expect({ refused: r.status !== 0, message: /did not authorize this TaskCompleted write/.test(r.out), notice: fs.existsSync(f.notice) })
      .toEqual({ refused: true, message: true, notice: false });
  });
});

// ── H1-F2 ──

describe("H1-F2 · the notice never lands outside the exact run/instance outbox", () => {
  const parents: Array<[string, (f: Fx) => string]> = [
    ["the run outbox directory", (f) => path.join(f.root, ".guild", "runs", RUN_ID, "outbox")],
    ["the instance outbox directory", (f) => path.dirname(f.notice)],
  ];
  for (const [label, where] of parents) {
    it(`${label} is a symlink to an outside owned directory: nothing is created outside; the hook refuses`, () => {
      const f = fixture();
      const outside = ownedTempDir("guild-e00-h1-outside-");
      const link = where(f);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(outside, link);
      const r = runTC(f, false);
      expect(r.timedOut).toBe(false);
      expect({ outside_entries: fs.readdirSync(outside, { recursive: true }).length, refused: r.status !== 0 }).toEqual({ outside_entries: 0, refused: true });
    });
  }

  const leaves: Array<[string, (f: Fx, outside: string) => void]> = [
    ["a FIFO at the notice path", (f) => { expect(spawnSync("mkfifo", [f.notice]).status).toBe(0); }],
    ["a symlink at the notice path to an outside FIFO", (f, outside) => { const t = path.join(outside, "fifo"); expect(spawnSync("mkfifo", [t]).status).toBe(0); fs.symlinkSync(t, f.notice); }],
    ["a symlink at the notice path to an outside regular file", (f, outside) => { const t = path.join(outside, "file"); fs.writeFileSync(t, "outside-bytes\n"); fs.symlinkSync(t, f.notice); }],
  ];
  for (const [label, arrange] of leaves) {
    it(`${label}: never read or followed (no hang), the hook refuses, the outside target unchanged`, () => {
      const f = fixture();
      const outside = ownedTempDir("guild-e00-h1-outside-");
      fs.mkdirSync(path.dirname(f.notice), { recursive: true });
      arrange(f, outside);
      const outsideBefore = tree(outside);
      const leafBefore = fs.lstatSync(f.notice);
      const r = runTC(f, false, 20000);
      const leafAfter = fs.lstatSync(f.notice);
      expect({ timed_out: r.timedOut, refused: r.status !== 0, outside_unchanged: delta(outsideBefore, tree(outside)).length === 0,
        leaf_kind_unchanged: leafBefore.isFIFO() === leafAfter.isFIFO() && leafBefore.isSymbolicLink() === leafAfter.isSymbolicLink() })
        .toEqual({ timed_out: false, refused: true, outside_unchanged: true, leaf_kind_unchanged: true });
    });
  }
});

// ── H1-F4 ──

describe("H1-F4 · a repeated notice is idempotent; a conflicting one is refused without overwrite", () => {
  it("identical repeated callback for the same assignment: succeeds and keeps the first notice bytes", () => {
    const f = fixture();
    const first = runTC(f, false);
    expect({ first_ok: first.status === 0, notice: fs.existsSync(f.notice) }).toEqual({ first_ok: true, notice: true });
    const bytes = fs.readFileSync(f.notice);
    const second = runTC(f, false);
    expect({ second_ok: second.status === 0, bytes_kept: fs.readFileSync(f.notice).equals(bytes) }).toEqual({ second_ok: true, bytes_kept: true });
  });

  const conflicting: Array<[string, (f: Fx) => string]> = [
    ["a notice for a different assignment", (f) => JSON.stringify({ schema_version: "guild.task_completed_notice.v1", run_id: RUN_ID, assignment_id: "other:1:other", instance_id: f.c.assignment.instance_id, noticed_at: "2026-10-26T13:00:00.000Z" }, null, 2) + "\n"],
    ["a malformed notice", () => "{ not json\n"],
  ];
  for (const [label, body] of conflicting) {
    it(`${label} already present: the hook refuses and the existing bytes stay`, () => {
      const f = fixture();
      fs.mkdirSync(path.dirname(f.notice), { recursive: true });
      const b = body(f);
      fs.writeFileSync(f.notice, b);
      const r = runTC(f, false);
      expect({ timed_out: r.timedOut, refused: r.status !== 0, bytes_kept: fs.readFileSync(f.notice, "utf8") === b }).toEqual({ timed_out: false, refused: true, bytes_kept: true });
    });
  }
});

// ── H1-F3 · PreToolUse binding guard (same healthy-run harness as the frozen CD21 file) ──

const GUARD_RUN = "run-e00-guard";
const INSTANCE = "T1.a1.i-1";
function guardRepo() {
  const tmp = ownedTempDir("guild-e00-h1-guard-");
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".guild", "wiki", "decisions"), { recursive: true });
  const runDir = path.join(repo, ".guild", "runs", GUARD_RUN);
  mintRunBinding({ root: repo, run_id: GUARD_RUN });
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "handoffs"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "run.yaml"), "run_id: x\n");
  fs.writeFileSync(path.join(runDir, "binding-notes.md"), "# notes\n");
  admitLane(repo, GUARD_RUN, "T1", INSTANCE, ["Read", "Grep", "Glob", "Bash", "Write", "Edit"]);
  return { repo, runDir };
}
type HookOutcome = { kind: "allow_empty" } | { kind: "decision"; decision: string; reason: string };
function hook(g: { repo: string; runDir: string }, tool: string, input: Record<string, unknown>): HookOutcome {
  const r = spawnSync("npx", ["tsx", PTU_SCRIPT], {
    input: JSON.stringify({ tool_name: tool, tool_input: input, cwd: g.repo }), encoding: "utf8", cwd: g.repo,
    env: { ...hermeticEnv(), CLAUDE_PLUGIN_ROOT: PLUGIN, GUILD_CWD: g.repo, GUILD_RUN_DIR: g.runDir, GUILD_RUN_ID: GUARD_RUN, GUILD_TASK_ID: "T1", GUILD_TASK_CELL_INSTANCE_ID: INSTANCE },
    timeout: 30000,
  });
  if (r.error) throw new Error(`hook spawn error: ${(r.error as NodeJS.ErrnoException).code ?? r.error.message}`);
  if (r.signal !== null) throw new Error(`hook killed by ${r.signal}`);
  if (r.status !== 0) throw new Error(`hook exited ${r.status}`);
  if (/fatal: \[pre-tool-use\]/.test(r.stderr ?? "")) throw new Error("hook hit its fatal handler (exit 0 masks it)");
  const out = (r.stdout ?? "").trim();
  if (out === "") return { kind: "allow_empty" };
  const lines = out.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length !== 1) throw new Error(`hook emitted ${lines.length} stdout lines; expected one JSON response`);
  const h = (JSON.parse(lines[0]!) as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput;
  if (!h || h["hookEventName"] !== "PreToolUse" || typeof h["permissionDecision"] !== "string") throw new Error("hook stdout is not a PreToolUse hookSpecificOutput");
  return { kind: "decision", decision: h["permissionDecision"] as string, reason: String(h["permissionDecisionReason"] ?? "") };
}
const bindingRefused = (o: HookOutcome) => o.kind === "decision" && o.decision === "deny" && /binding_path_refused/.test(o.reason);

describe("H1-F3 · resolving glob and shell forms naming the private binding are denied", () => {
  const deny: Array<[string, string, (g: { repo: string; runDir: string }) => Record<string, unknown>]> = [
    ["Glob", ".guild/runs/*/binding*.json", (g) => ({ pattern: ".guild/runs/*/binding*.json", path: g.repo })],
    ["Glob", "**/binding.js?n", (g) => ({ pattern: "**/binding.js?n", path: g.repo })],
    ["Glob", "bracket class bindin[g].json", (g) => ({ pattern: ".guild/runs/*/bindin[g].json", path: g.repo })],
    ["Glob", "brace set {run.yaml,binding.json}", (g) => ({ pattern: `.guild/runs/${GUARD_RUN}/{run.yaml,binding.json}`, path: g.repo })],
    ["Grep", "glob filter binding*.json", (g) => ({ pattern: "binding_ref", path: g.runDir, glob: "binding*.json" })],
    ["Bash", "cat .guild/runs/*/binding*.json", () => ({ command: "cat .guild/runs/*/binding*.json" })],
    ["Bash", "cat .guild/runs/<run>/b?nding.json", () => ({ command: `cat .guild/runs/${GUARD_RUN}/b?nding.json` })],
    ["Bash", "cat .guild/runs/*/bind*.json", () => ({ command: "cat .guild/runs/*/bind*.json" })],
  ];
  for (const [tool, label, input] of deny) {
    it(`denies ${tool} (${label})`, () => {
      const g = guardRepo();
      expect(bindingRefused(hook(g, tool, input(g)))).toBe(true);
    });
  }

  const allow: Array<[string, string, (g: { repo: string; runDir: string }) => Record<string, unknown>]> = [
    ["Glob", ".guild/runs/*/run*.yaml", (g) => ({ pattern: ".guild/runs/*/run*.yaml", path: g.repo })],
    ["Glob", ".guild/runs/*/binding-notes.md", (g) => ({ pattern: ".guild/runs/*/binding-notes.md", path: g.repo })],
    ["Grep", "glob filter *.yaml", (g) => ({ pattern: "run_id", path: g.runDir, glob: "*.yaml" })],
    ["Bash", "cat .guild/runs/*/run.yaml", () => ({ command: "cat .guild/runs/*/run.yaml" })],
    ["Bash", "ls .guild/runs/*/handoffs", () => ({ command: "ls .guild/runs/*/handoffs" })],
  ];
  for (const [tool, label, input] of allow) {
    it(`control: does not apply binding_path_refused to ${tool} (${label})`, () => {
      const g = guardRepo();
      expect(bindingRefused(hook(g, tool, input(g)))).toBe(false);
    });
  }

  it("harness control: the literal binding.json Glob form is denied today", () => {
    const g = guardRepo();
    expect(bindingRefused(hook(g, "Glob", { pattern: ".guild/runs/*/binding.json", path: g.repo }))).toBe(true);
  });
});

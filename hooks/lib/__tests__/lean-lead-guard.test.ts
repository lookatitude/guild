/**
 * hooks/lib/__tests__/lean-lead-guard.test.ts
 *
 * Unit + integration tests for the OIR issue #57 advisory guard
 * (hooks/lib/lean-lead-guard.ts) and its Stop-hook wiring
 * (hooks/lean-lead-guard.ts).
 *
 * Everything runs against REAL on-disk fixtures (ephemeral mkdtemp dirs) and
 * the REAL builders this guard depends on in production:
 *   - `upsertLane` (hooks/lib/run-state.ts) to seed run-state.json — the exact
 *     writer the agent-team TaskCreated/TaskCompleted hooks call.
 *   - `appendEvent` (hooks/lib/v1.4/log-jsonl.ts) to append real tool_call /
 *     hook_event JSONL lines — the exact writer post-tool-use.ts/pre-compact.ts
 *     call.
 * No injected seams — the test exercises the exact read path the Stop hook
 * runs in production.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync, spawnSync } from "child_process";

import { upsertLane } from "../run-state";
import { appendEvent, ORPHAN_RESULT_EXCERPT, appendSidecarPre } from "../v1.4/log-jsonl";
import type { ToolCallEvent, HookEvent } from "../v1.4/log-jsonl";
import {
  LEAN_LEAD_MARKER,
  readLeanLeadConfig,
  isOverridden,
  countOpenLanes,
  countHandsOnEdits,
  decideCrossing,
  renderLeanLeadAdvisory,
  evaluateLeanLeadGuard,
} from "../lean-lead-guard";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lean-lead-guard-test-"));
}
function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const RUN_ID = "run-fix-1";

function runDirFor(root: string, runId: string = RUN_ID): string {
  const dir = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSettings(root: string, settings: object): void {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify(settings, null, 2));
}

function seedLane(runDir: string, runId: string, laneId: string, status: string): void {
  upsertLane(runDir, { runId }, laneId, { status: status as never });
}

let tsCounter = 0;
/** Monotonically increasing ISO timestamps so ordering is deterministic. */
function nextTs(): string {
  tsCounter += 1;
  return new Date(1_700_000_000_000 + tsCounter * 1000).toISOString();
}

function appendToolCall(
  runDir: string,
  runId: string,
  opts: { tool: "Edit" | "Write" | "Read"; laneId?: string; ts?: string },
): void {
  const event: ToolCallEvent = {
    ts: opts.ts ?? nextTs(),
    event: "tool_call",
    run_id: runId,
    ...(opts.laneId !== undefined ? { lane_id: opts.laneId } : {}),
    tool: opts.tool,
    command_redacted: "redacted",
    status: "ok",
    latency_ms: 5,
    result_excerpt_redacted: "",
  };
  appendEvent(runDir, event);
}

function appendPreCompact(runDir: string, runId: string, ts?: string, laneId?: string): string {
  const stamp = ts ?? nextTs();
  const event: HookEvent = {
    ts: stamp,
    event: "hook_event",
    run_id: runId,
    hook_name: "PreCompact",
    payload_excerpt_redacted: "",
    latency_ms: 0,
    status: "ok",
    ...(laneId !== undefined ? { lane_id: laneId } : {}),
  };
  appendEvent(runDir, event);
  return stamp;
}

function appendOrphanSentinel(runDir: string, runId: string, ts?: string): void {
  const event: ToolCallEvent = {
    ts: ts ?? nextTs(),
    event: "tool_call",
    run_id: runId,
    tool: "Edit",
    command_redacted: "redacted",
    status: "err",
    latency_ms: -1,
    result_excerpt_redacted: ORPHAN_RESULT_EXCERPT,
  };
  appendEvent(runDir, event);
}

describe("lean-lead-guard — readLeanLeadConfig", () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => cleanup(root));

  it("defaults to enabled=true, threshold=8 with no settings.json", () => {
    expect(readLeanLeadConfig(root)).toEqual({ enabled: true, threshold: 8 });
  });

  it("reads defaults.lean_lead.hands_on_edit_threshold and enabled from settings.json", () => {
    writeSettings(root, { defaults: { lean_lead: { enabled: false, hands_on_edit_threshold: 3 } } });
    expect(readLeanLeadConfig(root)).toEqual({ enabled: false, threshold: 3 });
  });

  it("degrades to defaults on corrupt settings.json", () => {
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "settings.json"), "{not json");
    expect(readLeanLeadConfig(root)).toEqual({ enabled: true, threshold: 8 });
  });

  it("ignores a non-positive/non-numeric/non-integer threshold override", () => {
    writeSettings(root, { defaults: { lean_lead: { hands_on_edit_threshold: -1 } } });
    expect(readLeanLeadConfig(root).threshold).toBe(8);
    writeSettings(root, { defaults: { lean_lead: { hands_on_edit_threshold: "nope" } } });
    expect(readLeanLeadConfig(root).threshold).toBe(8);
    writeSettings(root, { defaults: { lean_lead: { hands_on_edit_threshold: 0 } } });
    expect(readLeanLeadConfig(root).threshold).toBe(8);
    // A fractional threshold (e.g. an operator typo) must NOT floor to 0 and
    // silently defeat every count>=threshold / count/threshold check downstream.
    writeSettings(root, { defaults: { lean_lead: { hands_on_edit_threshold: 0.5 } } });
    expect(readLeanLeadConfig(root).threshold).toBe(8);
  });
});

describe("lean-lead-guard — isOverridden", () => {
  it("is true only when GUILD_LEAN_LEAD_OVERRIDE=1", () => {
    expect(isOverridden({})).toBe(false);
    expect(isOverridden({ GUILD_LEAN_LEAD_OVERRIDE: "0" })).toBe(false);
    expect(isOverridden({ GUILD_LEAN_LEAD_OVERRIDE: "1" })).toBe(true);
  });
});

describe("lean-lead-guard — countOpenLanes", () => {
  let root: string;
  let runDir: string;
  beforeEach(() => {
    root = tmpRoot();
    runDir = runDirFor(root);
  });
  afterEach(() => cleanup(root));

  it("returns 0 when run-state.json is absent", () => {
    expect(countOpenLanes(runDir)).toBe(0);
  });

  it("counts pending/in_progress lanes, excludes terminal statuses", () => {
    seedLane(runDir, RUN_ID, "T1", "in_progress");
    seedLane(runDir, RUN_ID, "T2", "pending");
    seedLane(runDir, RUN_ID, "T3", "done");
    seedLane(runDir, RUN_ID, "T4", "failed");
    seedLane(runDir, RUN_ID, "T5", "dead");
    seedLane(runDir, RUN_ID, "T6", "skipped");
    expect(countOpenLanes(runDir)).toBe(2);
  });
});

describe("lean-lead-guard — countHandsOnEdits", () => {
  let root: string;
  let runDir: string;
  beforeEach(() => {
    tsCounter = 0;
    root = tmpRoot();
    runDir = runDirFor(root);
  });
  afterEach(() => cleanup(root));

  it("counts lead Edit/Write tool_call events (no lane_id) and ignores lane-worker events", async () => {
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Write" });
    appendToolCall(runDir, RUN_ID, { tool: "Read" }); // not hands-on
    appendToolCall(runDir, RUN_ID, { tool: "Edit", laneId: "T1-backend" }); // a lane worker's own edit
    const result = await countHandsOnEdits(runDir, RUN_ID);
    expect(result.count).toBe(2);
    expect(result.anchorTs).toBeNull();
  });

  it("only counts events strictly after the most recent PreCompact boundary", async () => {
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const anchor = appendPreCompact(runDir, RUN_ID);
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const result = await countHandsOnEdits(runDir, RUN_ID);
    expect(result.anchorTs).toBe(anchor);
    expect(result.count).toBe(1);
  });

  it("ignores tool_call and PreCompact events belonging to a DIFFERENT run_id (defense in depth)", async () => {
    // A foreign run's edits and its own compaction anchor must never leak into
    // this run's count/anchor, even if they landed in the same directory.
    appendPreCompact(runDir, "run-other-foreign");
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, "run-other-foreign", { tool: "Edit" });
    appendToolCall(runDir, "run-other-foreign", { tool: "Write" });
    const result = await countHandsOnEdits(runDir, RUN_ID);
    expect(result.count).toBe(1);
    expect(result.anchorTs).toBeNull();
  });

  it("ROUND-3 FIX: a WORKER's own PreCompact (lane_id set) does not anchor the lead's counting window", async () => {
    // pre-compact.ts is globally registered too — it fires inside a
    // dispatched specialist's own session. That worker's compaction has no
    // bearing on the lead's budget and must never anchor it.
    appendToolCall(runDir, RUN_ID, { tool: "Edit" }); // 1 lead edit before any compaction
    appendPreCompact(runDir, RUN_ID, undefined, "T1-backend"); // an unrelated worker's own compaction
    appendToolCall(runDir, RUN_ID, { tool: "Edit" }); // 1 more lead edit after the worker's compaction
    const result = await countHandsOnEdits(runDir, RUN_ID);
    expect(result.anchorTs).toBeNull(); // no LEAD-own compaction has happened
    expect(result.count).toBe(2); // both lead edits count — the worker's compaction is invisible
  });

  it("ROUND-3 FIX: a LEAD-own PreCompact (no lane_id) still anchors normally, even after a worker's own compaction", async () => {
    appendPreCompact(runDir, RUN_ID, undefined, "T1-backend"); // worker's own — ignored
    const leadAnchor = appendPreCompact(runDir, RUN_ID); // the lead's own — this one counts
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const result = await countHandsOnEdits(runDir, RUN_ID);
    expect(result.anchorTs).toBe(leadAnchor);
    expect(result.count).toBe(1);
  });

  it("ROUND-3 FIX: the canonical orphan-sweep sentinel is excluded from the hands-on-edit count", async () => {
    // A stale PreToolUse sidecar entry whose PostToolUse never arrived (a
    // stalled/crashed lane worker's call, most plausibly) flushes as this
    // exact synthetic shape — pre-tool-use.ts never stamped it with
    // attribution, so it is unrecoverably lane-less; it must not be
    // mis-attributed to the lead.
    appendOrphanSentinel(runDir, RUN_ID);
    appendToolCall(runDir, RUN_ID, { tool: "Write" }); // a genuine lead edit, for contrast
    const result = await countHandsOnEdits(runDir, RUN_ID);
    expect(result.count).toBe(1); // only the genuine lead edit — the orphan sentinel is excluded
  });

  it("counts a same-millisecond post-compaction edit correctly via APPEND ORDER, not ts comparison", async () => {
    // Round-2 finding: a ts<=anchorMs comparison would wrongly discard an
    // Edit stamped with the IDENTICAL millisecond as the PreCompact event
    // that precedes it in the log. Ordering must come from array position.
    const sameTs = nextTs();
    appendPreCompact(runDir, RUN_ID, sameTs);
    appendToolCall(runDir, RUN_ID, { tool: "Edit", ts: sameTs });
    const result = await countHandsOnEdits(runDir, RUN_ID);
    expect(result.count).toBe(1);
  });
});

describe("lean-lead-guard — decideCrossing", () => {
  it("fires on the first crossing of the threshold", () => {
    const d = decideCrossing(3, 3, null, null);
    expect(d.shouldFire).toBe(true);
    expect(d.nextState.last_fired_at_count).toBe(3);
  });

  it("does not re-fire when the count has not crossed a new multiple", () => {
    const prior = { schema_version: "guild.lean_lead_advisory.v1" as const, anchor_ts: null, last_fired_at_count: 3 };
    const d = decideCrossing(3, 3, null, prior); // same count, same cycle
    expect(d.shouldFire).toBe(false);
  });

  it("re-fires once the count crosses the NEXT multiple of the threshold", () => {
    const prior = { schema_version: "guild.lean_lead_advisory.v1" as const, anchor_ts: null, last_fired_at_count: 3 };
    const d = decideCrossing(6, 3, null, prior);
    expect(d.shouldFire).toBe(true);
  });

  it("treats a changed anchor_ts (new compaction cycle) as a fresh budget", () => {
    const prior = { schema_version: "guild.lean_lead_advisory.v1" as const, anchor_ts: "old-anchor", last_fired_at_count: 9 };
    // New cycle: only 3 edits since the NEW anchor — still crosses the threshold
    // fresh, even though 9 > 3, because the prior bookkeeping belongs to a
    // discarded cycle.
    const d = decideCrossing(3, 3, "new-anchor", prior);
    expect(d.shouldFire).toBe(true);
  });

  it("fires IMMEDIATELY on the first edit of a fresh post-compaction cycle (no fresh N-edit grace)", () => {
    // anchorTs !== null (a real compaction happened) and no prior bookkeeping
    // for THIS anchor yet — the very first post-compaction edit is already a
    // violation of the "N edits OR any compaction boundary" contract.
    const d = decideCrossing(1, 8, "compact-anchor-1", null);
    expect(d.shouldFire).toBe(true);
    expect(d.nextState.last_fired_at_count).toBe(1);
  });

  it("after the immediate post-compaction fire, falls back to the ordinary every-N cadence", () => {
    const afterFirstFire = {
      schema_version: "guild.lean_lead_advisory.v1" as const,
      anchor_ts: "compact-anchor-1",
      last_fired_at_count: 1,
    };
    // Same cycle, threshold=3: counts 2 (no new multiple past 1) stay silent...
    expect(decideCrossing(2, 3, "compact-anchor-1", afterFirstFire).shouldFire).toBe(false);
    // ...count 4 crosses floor(4/3)=1 > floor(1/3)=0 → fires again.
    expect(decideCrossing(4, 3, "compact-anchor-1", afterFirstFire).shouldFire).toBe(true);
  });

  it("does NOT apply the immediate-fire rule to a run's pre-compaction genesis cycle", () => {
    // anchorTs === null (no compaction has ever happened) — ordinary N-edit
    // budget applies from the start, no compaction boundary to be "fresh" from.
    const d = decideCrossing(1, 8, null, null);
    expect(d.shouldFire).toBe(false);
  });

  it("discards a corrupted prior state whose recorded count EXCEEDS the current count (genesis cycle)", () => {
    // last_fired_at_count=1e9 with a matching (null) anchor but a much
    // smaller current count is internally impossible under honest monotonic
    // counting within one cycle — must self-heal (fall back to the ordinary
    // every-N cadence with priorCount=0), not permanently suppress the guard.
    const corrupted = {
      schema_version: "guild.lean_lead_advisory.v1" as const,
      anchor_ts: null,
      last_fired_at_count: 1_000_000_000,
    };
    const d = decideCrossing(3, 3, null, corrupted);
    expect(d.shouldFire).toBe(true);
  });
});

describe("lean-lead-guard — renderLeanLeadAdvisory", () => {
  it("names the run, count, threshold, and open-lane count, and carries the marker", () => {
    const msg = renderLeanLeadAdvisory("run-abc", 8, 8, 2);
    expect(msg).toContain(LEAN_LEAD_MARKER);
    expect(msg).toContain("run-abc");
    expect(msg).toContain("8 direct lead");
    expect(msg).toContain("threshold 8");
    expect(msg).toContain("2 lane(s)");
    expect(msg).toContain("guild:execute-plan");
    expect(msg).toContain("GUILD_LEAN_LEAD_OVERRIDE=1");
  });
});

describe("lean-lead-guard — evaluateLeanLeadGuard (integration, real fixtures)", () => {
  let root: string;
  let runDir: string;
  beforeEach(() => {
    tsCounter = 0;
    root = tmpRoot();
    runDir = runDirFor(root);
    writeSettings(root, { defaults: { lean_lead: { hands_on_edit_threshold: 3 } } });
  });
  afterEach(() => cleanup(root));

  it("LEAD-ONLY gate (round-2 finding): a specialist pane's own Stop-hook invocation must not fire, and must not consume the fire-once state meant for the lead", async () => {
    seedLane(runDir, RUN_ID, "T1", "in_progress");
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" }); // crosses threshold=3

    // The Stop hook is registered globally, so it ALSO fires inside a
    // dispatched specialist's own pane/subagent session, which shares this
    // SAME run directory. That invocation's OWN env carries GUILD_TASK_ID.
    const workerInvocation = await evaluateLeanLeadGuard(root, RUN_ID, { GUILD_TASK_ID: "T1-backend" });
    expect(workerInvocation.advisory).toBeNull();

    // The advisory-state sentinel must be untouched by the worker's
    // invocation — the lead's own subsequent Stop-hook call must still see
    // the crossing and fire, exactly as if the worker's Stop hook never ran.
    const leadInvocation = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(leadInvocation.advisory).not.toBeNull();
    expect(leadInvocation.advisory).toContain(LEAN_LEAD_MARKER);
  });

  it("LEAD-ONLY gate: GUILD_LANE_ID alone also silences a non-lead invocation", async () => {
    seedLane(runDir, RUN_ID, "T1", "in_progress");
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const { advisory } = await evaluateLeanLeadGuard(root, RUN_ID, { GUILD_LANE_ID: "T1-backend" });
    expect(advisory).toBeNull();
  });

  it("open-lanes gating: silent when there are no open lanes, even past threshold", async () => {
    // No run-state.json at all → zero open lanes by construction.
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const { advisory } = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(advisory).toBeNull();
  });

  it("open-lanes gating: silent when all lanes are terminal", async () => {
    seedLane(runDir, RUN_ID, "T1", "done");
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const { advisory } = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(advisory).toBeNull();
  });

  it("fires once on threshold crossing, and does not re-fire every subsequent turn", async () => {
    seedLane(runDir, RUN_ID, "T1", "in_progress");
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" }); // 3rd edit crosses threshold=3

    const first = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(first.advisory).not.toBeNull();
    expect(first.advisory).toContain(LEAN_LEAD_MARKER);

    // Simulate another Stop-hook turn with no new edits in between.
    const second = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(second.advisory).toBeNull();

    // Cross the NEXT multiple (6) → fires again.
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const third = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(third.advisory).not.toBeNull();
  });

  it("compaction-boundary expiry: the shortcut is ALREADY expired post-compaction — first edit fires immediately", async () => {
    seedLane(runDir, RUN_ID, "T1", "in_progress");
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" }); // crosses threshold=3 pre-compaction
    const before = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(before.advisory).not.toBeNull();

    appendPreCompact(runDir, RUN_ID);

    // The SKILL.md contract is "N edits OR any compaction boundary" — a
    // disjunction, not a fresh N-edit allowance. session-reanchor.ts already
    // re-injected the lean-lead contract into the post-compaction context, so
    // the very FIRST inline edit after that point is already a fresh
    // violation — it must fire immediately, not wait for 3 more edits.
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const firstPostCompactionEdit = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(firstPostCompactionEdit.advisory).not.toBeNull();

    // Having just fired, the guard falls back to the normal every-N cadence
    // for the REST of this cycle — it does not nag on every single turn.
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const secondPostCompactionEdit = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(secondPostCompactionEdit.advisory).toBeNull();

    // Crossing the next multiple (threshold=3 measured from the first fire,
    // i.e. count=4) fires again.
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const thirdAndFourthPostCompactionEdit = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(thirdAndFourthPostCompactionEdit.advisory).not.toBeNull();
  });

  it("override respected: GUILD_LEAN_LEAD_OVERRIDE=1 silences an otherwise-firing crossing", async () => {
    seedLane(runDir, RUN_ID, "T1", "in_progress");
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const { advisory } = await evaluateLeanLeadGuard(root, RUN_ID, { GUILD_LEAN_LEAD_OVERRIDE: "1" });
    expect(advisory).toBeNull();
  });

  it("disabled via defaults.lean_lead.enabled=false stays silent regardless of count/lanes", async () => {
    writeSettings(root, { defaults: { lean_lead: { enabled: false, hands_on_edit_threshold: 1 } } });
    seedLane(runDir, RUN_ID, "T1", "in_progress");
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const { advisory } = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(advisory).toBeNull();
  });

  it("stays under threshold ⇒ silent", async () => {
    seedLane(runDir, RUN_ID, "T1", "in_progress");
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" }); // only 2, threshold is 3
    const { advisory } = await evaluateLeanLeadGuard(root, RUN_ID, {});
    expect(advisory).toBeNull();
  });
});

describe("lean-lead-guard — attribution via the REAL post-tool-use.ts producer (oir-wi-57 fix)", () => {
  // Not appendToolCall's hand-rolled events — this spawns the actual
  // hooks/post-tool-use.ts script (the real tool_call writer) with the
  // REAL env vars a dispatched lane's own process carries in production
  // (GUILD_TASK_ID — GUILD_LANE_ID has zero producers anywhere in this
  // codebase), proving lane_id attribution end-to-end rather than trusting
  // a test-only fixture shape the real producer might not actually emit.
  const POST_TOOL_USE = path.resolve(__dirname, "..", "..", "post-tool-use.ts");
  let tmp: string;
  let runDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lean-lead-ptu-real-"));
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    runDir = path.join(tmp, ".guild", "runs", RUN_ID);
    fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function spawnEdit(extraEnv: Record<string, string>): number {
    const payload = {
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "some/file.ts", old_string: "a", new_string: "b" },
      tool_response: { success: true },
      cwd: tmp,
    };
    const result = spawnSync("npx", ["tsx", POST_TOOL_USE], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, GUILD_CWD: tmp, GUILD_RUN_ID: RUN_ID, ...extraEnv },
      timeout: 30000,
    });
    return result.status ?? 1;
  }

  it("a dispatched lane's own Edit (real GUILD_TASK_ID env) is excluded from the lead's count", async () => {
    expect(spawnEdit({ GUILD_TASK_ID: "T1-backend" })).toBe(0);

    const raw = fs
      .readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const toolCall = raw.find((e) => e.event === "tool_call");
    expect(toolCall.lane_id).toBe("T1-backend"); // the real producer now stamps it

    const result = await countHandsOnEdits(runDir, RUN_ID);
    expect(result.count).toBe(0); // correctly excluded — this was lane work, not the lead's
  });

  it("the lead's own Edit (no GUILD_TASK_ID / GUILD_LANE_ID) is counted", async () => {
    expect(spawnEdit({})).toBe(0);

    const result = await countHandsOnEdits(runDir, RUN_ID);
    expect(result.count).toBe(1);
  });

  it("ROUND-5 REGRESSION (real producer): GUILD_LANE_ID=\"\" (present but blank) does not mask a valid GUILD_TASK_ID", () => {
    // The exact bug: a bare `GUILD_LANE_ID ?? GUILD_TASK_ID` returns "" here
    // (?? only falls through on null/undefined), which would have made this
    // real lane worker's edit look lane-less and get miscounted as the lead's.
    expect(spawnEdit({ GUILD_LANE_ID: "", GUILD_TASK_ID: "T1-backend" })).toBe(0);

    const raw = fs
      .readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const toolCall = raw.find((e) => e.event === "tool_call");
    expect(toolCall.lane_id).toBe("T1-backend");
  });

  it("ROUND-5 REGRESSION (real producer): an UNSAFE GUILD_LANE_ID does not mask a valid GUILD_TASK_ID", () => {
    expect(spawnEdit({ GUILD_LANE_ID: "bad;lane;id", GUILD_TASK_ID: "T1-backend" })).toBe(0);

    const raw = fs
      .readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const toolCall = raw.find((e) => e.event === "tool_call");
    expect(toolCall.lane_id).toBe("T1-backend");
  });

  it("REGRESSION (round-2 finding): a real PAIRED PreToolUse+PostToolUse call for a lane worker still pairs correctly AND carries the attribution", () => {
    // Reproduces the exact production lifecycle a round-1-only fix missed:
    // pre-tool-use.ts (untouched — a sibling lane's file) writes its sidecar
    // "pre" entry keyed by GUILD_LANE_ID only (always absent in production).
    // If post-tool-use.ts's PAIRING key had also broadened to GUILD_TASK_ID,
    // the two would disagree and the lane worker's real edit would fall
    // through as an orphaned pre-entry + a degraded post-only duplicate. This
    // test proves that does NOT happen: pairing succeeds (latency computed,
    // command_redacted populated), status is "ok" (not the orphan-sweep "err"
    // duplicate), and the final event STILL carries the correct lane_id via
    // the separate (non-pairing) attribution override.
    const PRE_TOOL_USE = path.resolve(__dirname, "..", "..", "pre-tool-use.ts");
    const env = { ...process.env, GUILD_CWD: tmp, GUILD_RUN_ID: RUN_ID, GUILD_TASK_ID: "T1-backend" };
    const toolInput = { file_path: "some/file.ts", old_string: "a", new_string: "b" };

    const preResult = spawnSync("npx", ["tsx", PRE_TOOL_USE], {
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: toolInput, cwd: tmp }),
      encoding: "utf8",
      env,
      timeout: 30000,
    });
    expect(preResult.status ?? 1).toBe(0);

    const postResult = spawnSync("npx", ["tsx", POST_TOOL_USE], {
      input: JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: toolInput,
        tool_response: { success: true },
        cwd: tmp,
      }),
      encoding: "utf8",
      env,
      timeout: 30000,
    });
    expect(postResult.status ?? 1).toBe(0);

    const raw = fs
      .readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const toolCalls = raw.filter((e) => e.event === "tool_call");

    expect(toolCalls.length).toBe(1); // no orphan/duplicate — a clean single paired event
    expect(toolCalls[0].status).toBe("ok"); // not the orphan-sweep "err" sentinel
    expect(toolCalls[0].command_redacted.length).toBeGreaterThan(0); // proves the PAIRED path, not post-only
    expect(toolCalls[0].lane_id).toBe("T1-backend"); // still correctly attributed
  });
});

describe("lean-lead-guard — worker-noise exclusion via the REAL producers (oir-wi-57 round-3 fixes)", () => {
  const PRE_COMPACT = path.resolve(__dirname, "..", "..", "pre-compact.ts");
  const POST_TOOL_USE = path.resolve(__dirname, "..", "..", "post-tool-use.ts");
  let tmp: string;
  let runDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lean-lead-worker-noise-"));
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    runDir = path.join(tmp, ".guild", "runs", RUN_ID);
    fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("a REAL PreCompact fired inside a worker's own session (GUILD_TASK_ID set) is stamped with lane_id and does not anchor", async () => {
    const result = spawnSync("npx", ["tsx", PRE_COMPACT], {
      input: JSON.stringify({ hook_event_name: "PreCompact", cwd: tmp }),
      encoding: "utf8",
      env: { ...process.env, GUILD_CWD: tmp, GUILD_RUN_ID: RUN_ID, GUILD_TASK_ID: "T1-backend" },
      timeout: 30000,
    });
    expect(result.status ?? 1).toBe(0);

    const raw = fs
      .readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const hookEvent = raw.find((e) => e.event === "hook_event" && e.hook_name === "PreCompact");
    expect(hookEvent.lane_id).toBe("T1-backend"); // the real producer now stamps it

    const beforeAnchor = await countHandsOnEdits(runDir, RUN_ID);
    expect(beforeAnchor.anchorTs).toBeNull(); // the worker's own compaction never anchors the lead's window
  });

  it("a real orphaned PreToolUse sidecar entry (stale, never paired) flushes via post-tool-use.ts's sweep and is excluded from the count", async () => {
    // Write a REAL stale sidecar "pre" entry directly (pre-tool-use.ts's own
    // shape) — 10 minutes old, well past the 5-minute orphan-sweep window —
    // exactly what a stalled/crashed lane worker's PreToolUse would leave
    // behind with no matching PostToolUse ever arriving.
    const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      tool: "Edit",
      ts_pre: staleTs,
      command_redacted: "stale lane worker edit",
    });

    // Any real PostToolUse invocation runs the orphan sweep unconditionally —
    // use an unrelated Read call so it isn't itself a hands-on edit.
    const result = spawnSync("npx", ["tsx", POST_TOOL_USE], {
      input: JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_input: { file_path: "other/file.ts" },
        tool_response: { success: true },
        cwd: tmp,
      }),
      encoding: "utf8",
      env: { ...process.env, GUILD_CWD: tmp, GUILD_RUN_ID: RUN_ID },
      timeout: 30000,
    });
    expect(result.status ?? 1).toBe(0);

    const raw = fs
      .readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const orphan = raw.find((e) => e.result_excerpt_redacted === ORPHAN_RESULT_EXCERPT);
    expect(orphan).toBeDefined();
    expect(orphan.lane_id).toBeUndefined(); // unrecoverably lane-less — pre-tool-use.ts never attributed it

    const countResult = await countHandsOnEdits(runDir, RUN_ID);
    expect(countResult.count).toBe(0); // excluded — never mis-attributed to the lead
  });
});

describe("lean-lead-guard.js — end-to-end (real bundle)", () => {
  const DIST = path.join(__dirname, "..", "..", "dist");
  const bundle = path.join(DIST, "lean-lead-guard.js");
  let root: string;
  let runDir: string;

  beforeEach(() => {
    tsCounter = 0;
    root = tmpRoot();
    runDir = runDirFor(root);
    writeSettings(root, { defaults: { lean_lead: { hands_on_edit_threshold: 2 } } });
    fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), RUN_ID);
  });
  afterEach(() => cleanup(root));

  function run(payload: object, extraEnv: Record<string, string> = {}): string {
    return execFileSync("node", [bundle], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
    });
  }

  it("bundle exists and contains the marker (dist-grep rail)", () => {
    expect(fs.existsSync(bundle)).toBe(true);
    expect(fs.readFileSync(bundle, "utf8")).toContain(LEAN_LEAD_MARKER);
  });

  it("emits the Stop additionalContext envelope end-to-end when the budget is exceeded", () => {
    seedLane(runDir, RUN_ID, "T1", "in_progress");
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const out = run({ cwd: root });
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("Stop");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(LEAN_LEAD_MARKER);
  });

  it("is silent end-to-end when there are no open lanes", () => {
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const out = run({ cwd: root });
    expect(out.trim()).toBe("");
  });

  it("is silent end-to-end when there is no active run", () => {
    fs.rmSync(path.join(root, ".guild", "runs", "current-run-id"));
    const out = run({ cwd: root });
    expect(out.trim()).toBe("");
  });

  it("LEAD-ONLY gate end-to-end: silent when THIS invocation's own env is a lane worker's", () => {
    seedLane(runDir, RUN_ID, "T1", "in_progress");
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    appendToolCall(runDir, RUN_ID, { tool: "Edit" });
    const out = run({ cwd: root }, { GUILD_TASK_ID: "T1-backend" });
    expect(out.trim()).toBe("");
  });
});

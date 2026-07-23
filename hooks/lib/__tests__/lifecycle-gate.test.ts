/**
 * hooks/lib/__tests__/lifecycle-gate.test.ts
 *
 * Unit + integration tests for the OIR issue #59 lifecycle gate
 * (hooks/lib/lifecycle-gate.ts) and its hook wiring (hooks/lifecycle-gate.ts).
 *
 * Everything runs against REAL on-disk fixtures (ephemeral mkdtemp dirs) and
 * the REAL builders the gate depends on in production:
 *   - `appendEvent` (hooks/lib/v1.4/log-jsonl.ts) writes the actual JSONL trace
 *     lines post-tool-use.ts emits;
 *   - `upsertLane` (hooks/lib/run-state.ts) writes the actual run-state.json
 *     the agent-team TaskCreated/TaskCompleted hooks write;
 *   - run.yaml is materialized in the same shape `startRun` persists, and read
 *     back through the real `reanchor.ts readRunYamlFacts`/`isRunActive`.
 * No injected seams — the tests exercise the exact read path the hooks run in
 * production, and the last block spawns the BUILT dist bundle end-to-end.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import { upsertLane } from "../run-state";
import { appendEvent, ORPHAN_RESULT_EXCERPT } from "../v1.4/log-jsonl";
import type { JsonlEvent, ToolCallEvent } from "../v1.4/log-jsonl";
import {
  CLOSE_GATE_MARKER,
  ENV_OVERRIDE_VAR,
  LIFECYCLE_GATE_MARKER,
  PROMPT_OVERRIDE_TOKEN,
  countAdHocActivityIn,
  decideCrossing,
  evaluateCloseGate,
  evaluateLifecycleGate,
  closeStatePath,
  gateStatePath,
  effectiveThreshold,
  isDriftCurrent,
  isLifecycleSkillCall,
  isOverridden,
  isPastBuildStart,
  hasContent,
  loadCloseState,
  loadGateState,
  readValidatedRunState,
  parseInvokedSkill,
  safeTs,
  readLifecycleGateConfig,
  renderCloseGate,
  renderLifecycleGate,
  validateReceiptEnvelope,
  REQUIRED_RECEIPT_ENVELOPE_KEYS,
} from "../lifecycle-gate";

const RUN_ID = "run-fix-59";
const HOOKS_ROOT = path.resolve(__dirname, "..", "..");

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-gate-test-"));
}
function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

let tsCounter = 0;
/**
 * Monotonically increasing ISO timestamps, anchored a few minutes in the PAST
 * so ordering is deterministic while still landing inside the gate's
 * drift-recency floor (`isDriftCurrent`). A fixed epoch would make every
 * fixture look like historical drift and silence the gate.
 */
const TS_BASE_MS = Date.now() - 5 * 60 * 1000;
function nextTs(): string {
  tsCounter += 1;
  return new Date(TS_BASE_MS + tsCounter * 1000).toISOString();
}

interface RunFixtureOpts {
  runId?: string;
  status?: string;
  phase?: string | null;
  gates?: Record<string, string>;
}

/** Materialize a real run dir + run.yaml in the shape `startRun` persists. */
function makeRun(root: string, opts: RunFixtureOpts = {}): string {
  const runId = opts.runId ?? RUN_ID;
  const runDir = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), runId);

  let gatesBlock = "gates: {}";
  if (opts.gates && Object.keys(opts.gates).length > 0) {
    const lines = ["gates:"];
    for (const [name, outcome] of Object.entries(opts.gates)) {
      lines.push(`  ${name}:`);
      lines.push(`    outcome: ${outcome}`);
    }
    gatesBlock = lines.join("\n");
  }
  const phase = opts.phase === undefined ? "build" : opts.phase;
  fs.writeFileSync(
    path.join(runDir, "run.yaml"),
    [
      "schema_version: guild.run.v1",
      `run_id: ${runId}`,
      "initiative_attachment: null",
      `phase: ${phase ?? "null"}`,
      gatesBlock,
      `status: ${opts.status ?? "open"}`,
      "phases_log: []",
      "settings_ref:",
      "  path: resolved-settings.json",
      "  effective_backend: team",
      "",
    ].join("\n"),
  );
  return runDir;
}

function writeSettings(root: string, settings: object): void {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify(settings, null, 2));
}

function appendToolCall(
  runDir: string,
  opts: {
    tool: ToolCallEvent["tool"];
    laneId?: string;
    runId?: string;
    command?: string;
    orphan?: boolean;
    status?: "ok" | "err";
  },
): void {
  const event: ToolCallEvent = {
    ts: nextTs(),
    event: "tool_call",
    run_id: opts.runId ?? RUN_ID,
    ...(opts.laneId !== undefined ? { lane_id: opts.laneId } : {}),
    tool: opts.tool,
    command_redacted: opts.command ?? "redacted",
    status: opts.orphan ? "err" : (opts.status ?? "ok"),
    latency_ms: opts.orphan ? -1 : 5,
    result_excerpt_redacted: opts.orphan ? ORPHAN_RESULT_EXCERPT : "",
  };
  appendEvent(runDir, event);
}

function appendSkillCall(runDir: string, skill: string, laneId?: string): void {
  appendToolCall(runDir, {
    tool: "Skill",
    command: `Skill {"skill":"${skill}"}`,
    ...(laneId !== undefined ? { laneId } : {}),
  });
}

/** Append N lead-own ad-hoc calls: `mutations` Edits, the rest Bash. */
function appendAdHoc(runDir: string, total: number, mutations: number): void {
  for (let i = 0; i < total; i++) {
    appendToolCall(runDir, { tool: i < mutations ? "Edit" : "Bash" });
  }
}

function seedLane(runDir: string, laneId: string, status: string, receiptRef?: string): void {
  upsertLane(runDir, { runId: RUN_ID }, laneId, {
    status: status as never,
    ...(receiptRef !== undefined ? { receipt_ref: receiptRef } : {}),
  } as never);
}

/** Backdate every file under a dir so `isRunActive`'s activity window sees it as stale. */
function ageTree(dir: string, byMs: number): void {
  const when = new Date(Date.now() - byMs);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) ageTree(full, byMs);
    else fs.utimesSync(full, when, when);
  }
}

/** A well-formed LEAD-COLLECTED receipt: v1 wrapper + one valid guild.handoff.v2
 * block carrying the required key set (status/changed_files/evidence/pr_url/codex). */
function leadReceiptBody(taskId = "lane-a"): string {
  return [
    "---",
    "schema_version: guild.handoff_receipt.v1",
    `task_id: ${taskId}`,
    "---",
    "",
    "## evidence",
    "real",
    "",
    "```guild.handoff.v2",
    JSON.stringify(
      {
        work_item: taskId,
        status: "done",
        pr_url: "https://example.test/pr/1",
        changed_files: ["a.ts"],
        evidence: ["red→green"],
        codex: { verdict: "SATISFIED", rounds: 1 },
      },
      null,
      2,
    ),
    "```",
    "",
  ].join("\n");
}

function writeReceipt(runDir: string, name: string): void {
  const dir = path.join(runDir, "handoffs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), leadReceiptBody(name.replace(/\.md$/, "")));
}

/** Write a receipt with arbitrary raw content (used for malformed-envelope tests). */
function writeRawReceipt(runDir: string, name: string, content: string): void {
  const dir = path.join(runDir, "handoffs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

/** Env with both overrides and worker markers cleared. */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env[ENV_OVERRIDE_VAR];
  delete env["GUILD_LANE_ID"];
  delete env["GUILD_TASK_ID"];
  delete env["GUILD_RUN_DIR"];
  for (const [k, v] of Object.entries(extra)) env[k] = v;
  return env;
}

// ───────────────────────────────────────────────────────────────────────────
// Config + overrides
// ───────────────────────────────────────────────────────────────────────────

describe("lifecycle-gate — readLifecycleGateConfig", () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => cleanup(root));

  it("defaults to enabled=true, threshold=20 with no settings.json", () => {
    expect(readLifecycleGateConfig(root)).toEqual({ enabled: true, threshold: 20 });
  });

  it("reads defaults.lifecycle_gate.{enabled,adhoc_activity_threshold}", () => {
    writeSettings(root, {
      defaults: { lifecycle_gate: { enabled: false, adhoc_activity_threshold: 4 } },
    });
    expect(readLifecycleGateConfig(root)).toEqual({ enabled: false, threshold: 4 });
  });

  it("degrades to defaults on corrupt settings.json", () => {
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "settings.json"), "{not json");
    expect(readLifecycleGateConfig(root)).toEqual({ enabled: true, threshold: 20 });
  });

  it("ignores a fractional / zero / non-numeric threshold", () => {
    for (const bad of [0.5, 0, -3, "8", null]) {
      writeSettings(root, { defaults: { lifecycle_gate: { adhoc_activity_threshold: bad } } });
      expect(readLifecycleGateConfig(root).threshold).toBe(20);
    }
  });
});

describe("lifecycle-gate — isOverridden", () => {
  it("is false with neither override present", () => {
    expect(isOverridden({}, "please keep going")).toBe(false);
  });

  it("honors the session-wide env override only at exactly '1'", () => {
    expect(isOverridden({ [ENV_OVERRIDE_VAR]: "1" }, null)).toBe(true);
    expect(isOverridden({ [ENV_OVERRIDE_VAR]: "true" }, null)).toBe(false);
    expect(isOverridden({ [ENV_OVERRIDE_VAR]: "0" }, null)).toBe(false);
  });

  it("honors the in-prompt token, case-insensitively", () => {
    expect(isOverridden({}, `fix the thing ${PROMPT_OVERRIDE_TOKEN}`)).toBe(true);
    expect(isOverridden({}, "fix the thing [GUILD:GATE-OVERRIDE]")).toBe(true);
    expect(isOverridden({}, "fix the thing guild:gate-override")).toBe(false); // brackets required
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Skill-name matching
// ───────────────────────────────────────────────────────────────────────────

describe("lifecycle-gate — parseInvokedSkill / isLifecycleSkillCall", () => {
  it("parses the skill OUT of the rendered tool_input JSON", () => {
    expect(parseInvokedSkill('Skill {"skill":"guild:review"}')).toBe("guild:review");
    expect(parseInvokedSkill("Skill guild:review")).toBe("guild:review");
    expect(isLifecycleSkillCall('Skill {"skill":"guild:verify-done"}')).toBe(true);
  });

  it("does NOT let a longer sibling skill satisfy a shorter probe", () => {
    // `guild:review-broker` is not the `guild:review` gate.
    expect(isLifecycleSkillCall('Skill {"skill":"guild:review-broker"}')).toBe(false);
  });

  it("does NOT let a mention in an unrelated argument forge a lifecycle touch", () => {
    // The whole point of parsing rather than searching: this is an html-docs
    // call, not a review call, and must never reset the drift counter.
    expect(
      isLifecycleSkillCall('Skill {"skill":"html-docs","args":"later call guild:review"}'),
    ).toBe(false);
    expect(isLifecycleSkillCall('Bash {"command":"echo guild:resume"}')).toBe(false);
  });

  it("returns null for an unparseable payload (never a lifecycle touch)", () => {
    expect(parseInvokedSkill("Skill")).toBeNull();
    expect(parseInvokedSkill("Skill {broken")).toBeNull();
    expect(isLifecycleSkillCall("Skill {broken")).toBe(false);
  });

  it("does NOT count maintenance / read-only skills as a lifecycle touch", () => {
    expect(isLifecycleSkillCall('Skill {"skill":"guild:evolve-skill"}')).toBe(false);
    expect(isLifecycleSkillCall('Skill {"skill":"guild:status"}')).toBe(false);
    expect(isLifecycleSkillCall('Skill {"skill":"html-docs"}')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Trace counting
// ───────────────────────────────────────────────────────────────────────────

describe("lifecycle-gate — countAdHocActivityIn", () => {
  let root: string;
  let runDir: string;
  beforeEach(() => {
    root = tmpRoot();
    runDir = makeRun(root);
  });
  afterEach(() => cleanup(root));

  async function count(): Promise<ReturnType<typeof countAdHocActivityIn>> {
    const { readTraceEvents } = await import("../lifecycle-gate");
    return countAdHocActivityIn(await readTraceEvents(runDir), RUN_ID);
  }

  it("counts lead-own Bash/Edit/Write and splits out the mutating subset", async () => {
    appendAdHoc(runDir, 5, 2);
    const r = await count();
    expect(r.total).toBe(5);
    expect(r.mutations).toBe(2);
    expect(r.anchorSeq).toBe(0);
    expect(r.latestTs).not.toBeNull();
  });

  it("ignores Read/Grep/Glob — only ad-hoc mutation-capable tools count", async () => {
    appendToolCall(runDir, { tool: "Read" });
    appendToolCall(runDir, { tool: "Grep" });
    appendToolCall(runDir, { tool: "Bash" });
    expect((await count()).total).toBe(1);
  });

  it("excludes lane-attributed calls (a dispatched worker's own work)", async () => {
    appendToolCall(runDir, { tool: "Edit", laneId: "lane-a" });
    appendToolCall(runDir, { tool: "Edit" });
    const r = await count();
    expect(r.total).toBe(1);
    expect(r.mutations).toBe(1);
    expect(r.anchorSeq).toBe(0);
  });

  it("excludes the canonical orphan-sweep sentinel", async () => {
    appendToolCall(runDir, { tool: "Edit", orphan: true });
    expect((await count()).total).toBe(0);
  });

  it("excludes events belonging to a different run_id", async () => {
    appendToolCall(runDir, { tool: "Edit", runId: "run-other" });
    expect((await count()).total).toBe(0);
  });

  it("anchors on the LAST lead-own lifecycle Skill call and counts only after it", async () => {
    appendAdHoc(runDir, 4, 4);
    appendSkillCall(runDir, "guild:execute-plan");
    appendAdHoc(runDir, 3, 1);
    const r = await count();
    expect(r.total).toBe(3);
    expect(r.mutations).toBe(1);
    expect(r.anchorSeq).toBe(1);
  });

  it("does NOT anchor on a dispatched worker's own Skill call", async () => {
    appendAdHoc(runDir, 2, 2);
    appendSkillCall(runDir, "guild:review", "lane-a");
    appendAdHoc(runDir, 2, 0);
    expect((await count()).total).toBe(4);
  });

  it("does NOT anchor on a non-lifecycle skill (the forensic guild:evolve-skill case)", async () => {
    appendAdHoc(runDir, 2, 2);
    appendSkillCall(runDir, "guild:evolve-skill");
    appendAdHoc(runDir, 2, 0);
    expect((await count()).total).toBe(4);
  });

  it("anchors on a specialist_dispatch — a lane genuinely went out", async () => {
    appendAdHoc(runDir, 5, 5);
    appendEvent(runDir, {
      ts: nextTs(),
      event: "specialist_dispatch",
      run_id: RUN_ID,
      lane_id: "lane-a",
      specialist: "backend",
      task_id: "t1",
      prompt_excerpt: "do the thing",
    });
    appendAdHoc(runDir, 1, 1);
    expect((await count()).total).toBe(1);
  });
});

describe("lifecycle-gate — untrusted-trace hardening (round-2 probes)", () => {
  let root: string;
  let runDir: string;
  beforeEach(() => {
    root = tmpRoot();
    runDir = makeRun(root);
  });
  afterEach(() => cleanup(root));

  async function count(): Promise<ReturnType<typeof countAdHocActivityIn>> {
    const { readTraceEvents } = await import("../lifecycle-gate");
    return countAdHocActivityIn(await readTraceEvents(runDir), RUN_ID);
  }

  /** Write a raw (possibly schema-invalid) line straight into the live log. */
  function appendRaw(record: object): void {
    fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
    fs.appendFileSync(
      path.join(runDir, "logs", "v1.4-events.jsonl"),
      JSON.stringify(record) + "\n",
    );
  }

  it("a forged FAR-FUTURE lifecycle ts cannot suppress the count (ts is not an ordering key)", async () => {
    appendRaw({
      ts: "9999-12-31T23:59:59.999Z",
      event: "tool_call",
      run_id: RUN_ID,
      tool: "Skill",
      command_redacted: 'Skill {"skill":"guild:resume"}',
      status: "ok",
      latency_ms: 1,
      result_excerpt_redacted: "",
    });
    appendAdHoc(runDir, 6, 3);
    // The forged anchor precedes the real work in APPEND order, so the six
    // later operations still count — a timestamp cannot rewrite history.
    expect((await count()).total).toBe(6);
  });

  it("a schema-INVALID record is dropped by the reader, not trusted", async () => {
    appendAdHoc(runDir, 6, 3);
    appendRaw({ ts: "zzzz", event: "tool_call", run_id: RUN_ID, tool: "Skill" });
    expect((await count()).total).toBe(6);
  });

  it("a lifecycle Skill call with a non-ok status does not anchor", async () => {
    appendAdHoc(runDir, 3, 1);
    appendToolCall(runDir, {
      tool: "Skill",
      command: 'Skill {"skill":"guild:resume"}',
      status: "err",
    });
    appendAdHoc(runDir, 2, 1);
    expect((await count()).total).toBe(5);
  });

  it("a same-millisecond re-entry is a NEW cycle (ordinal, not timestamp)", async () => {
    appendSkillCall(runDir, "guild:resume");
    const first = await count();
    appendSkillCall(runDir, "guild:resume");
    const second = await count();
    expect(second.anchorSeq).toBe(first.anchorSeq + 1);
  });

  it("a FUTURE-dated ad-hoc call cannot poison the recency evidence", async () => {
    // Round-3 probe: taking the plain max ts would let one forged 9999-… record
    // make every later round of genuine current drift look stale forever.
    appendRaw({
      ts: "9999-12-31T23:59:59.999Z",
      event: "tool_call",
      run_id: RUN_ID,
      tool: "Edit",
      command_redacted: "redacted",
      status: "ok",
      latency_ms: 1,
      result_excerpt_redacted: "",
    });
    appendAdHoc(runDir, 6, 3);
    const r = await count();
    expect(r.total).toBe(7); // the forged record still COUNTS as activity...
    expect(r.latestTs).not.toBe("9999-12-31T23:59:59.999Z"); // ...but is not the evidence
    expect(isDriftCurrent(r.latestTs, {}, Date.now())).toBe(true);
  });

  it("isDriftCurrent rejects a FUTURE timestamp (age must be >= 0)", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(isDriftCurrent(future, {}, Date.now())).toBe(false);
    expect(isDriftCurrent(new Date(Date.now() - 1000).toISOString(), {}, Date.now())).toBe(true);
    expect(isDriftCurrent("not-a-date", {}, Date.now())).toBe(false);
    expect(isDriftCurrent(null, {}, Date.now())).toBe(false);
  });

  it("effectiveThreshold drives BOTH the first fire and the re-arm", () => {
    const shellOnly = { total: 60, mutations: 0, anchorSeq: 0, anchorTs: null, latestTs: null };
    const mixed = { total: 60, mutations: 4, anchorSeq: 0, anchorTs: null, latestTs: null };
    expect(effectiveThreshold(shellOnly, 20)).toBe(60);
    expect(effectiveThreshold(mixed, 20)).toBe(20);
    // Shell-only re-arms at 120, NOT at 80 (which the base threshold would give).
    const prior = {
      schema_version: "guild.lifecycle_gate.v1" as const,
      anchor_seq: 0,
      last_fired_at_count: 60,
      pending_correction: false,
    };
    expect(decideCrossing(80, 60, 0, prior).shouldFire).toBe(false);
    expect(decideCrossing(120, 60, 0, prior).shouldFire).toBe(true);
  });

  it("hasContent rejects directories, symlinks and whitespace-only files", () => {
    fs.mkdirSync(path.join(runDir, "review.md"));
    expect(hasContent(path.join(runDir, "review.md"))).toBe(false);

    const real = path.join(runDir, "real.md");
    fs.writeFileSync(real, "verdict: pass\n");
    fs.symlinkSync(real, path.join(runDir, "verify.md"));
    expect(hasContent(path.join(runDir, "verify.md"))).toBe(false);
    expect(hasContent(real)).toBe(true);

    fs.writeFileSync(path.join(runDir, "blank.md"), "   \n\t\n");
    expect(hasContent(path.join(runDir, "blank.md"))).toBe(false);
  });

  it("readValidatedRunState rejects a malformed checkpoint instead of throwing", () => {
    const write = (body: unknown): void =>
      fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify(body));
    write({ schema_version: "guild.run_state.v1", run_id: RUN_ID, lanes: null });
    expect(readValidatedRunState(runDir, RUN_ID)).toBeNull();
    write({ schema_version: "guild.run_state.v1", run_id: RUN_ID, lanes: { a: 7 } });
    expect(readValidatedRunState(runDir, RUN_ID)).toBeNull();
    write({ schema_version: "guild.run_state.v1", run_id: RUN_ID, lanes: { a: { status: 3 } } });
    expect(readValidatedRunState(runDir, RUN_ID)).toBeNull();
    // Wrong run — a stale checkpoint must not lend its lanes to this run.
    write({ schema_version: "guild.run_state.v1", run_id: "run-other", lanes: { a: { status: "done" } } });
    expect(readValidatedRunState(runDir, RUN_ID)).toBeNull();
    // An UNKNOWN status is not from a writer we understand → unavailable.
    write({ schema_version: "guild.run_state.v1", run_id: RUN_ID, lanes: { a: { status: "weird" } } });
    expect(readValidatedRunState(runDir, RUN_ID)).toBeNull();
    write({
      schema_version: "guild.run_state.v1",
      run_id: RUN_ID,
      lanes: { a: { status: "done", receipt_ref: "handoffs/a.md" } },
    });
    expect(readValidatedRunState(runDir, RUN_ID)).toEqual({
      laneStatuses: ["done"],
      receiptRefs: ["handoffs/a.md"],
    });
  });
});

describe("lifecycle-gate — isPastBuildStart", () => {
  const none: JsonlEvent[] = [];

  it("is true for a persisted build/qa/ops phase", () => {
    for (const phase of ["build", "qa", "ops"]) {
      expect(isPastBuildStart(phase, none)).toBe(true);
    }
  });

  it("is false for pre-build phases with no execution evidence", () => {
    for (const phase of ["init", "ideate", "plan", null]) {
      expect(isPastBuildStart(phase, none)).toBe(false);
    }
  });

  it("is true when the trace proves execution began, even at an earlier phase", () => {
    expect(
      isPastBuildStart("plan", [{ event: "specialist_dispatch" } as unknown as JsonlEvent]),
    ).toBe(true);
    expect(
      isPastBuildStart("plan", [
        { event: "phase_start", phase: "execute" } as unknown as JsonlEvent,
      ]),
    ).toBe(true);
  });

  it("is NOT tripped by a pre-build phase_start (brainstorm/plan)", () => {
    expect(
      isPastBuildStart("plan", [{ event: "phase_start", phase: "plan" } as unknown as JsonlEvent]),
    ).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Fire-once arithmetic
// ───────────────────────────────────────────────────────────────────────────

describe("lifecycle-gate — decideCrossing", () => {
  const state = (count: number, seq = 1) => ({
    schema_version: "guild.lifecycle_gate.v1" as const,
    anchor_seq: seq,
    last_fired_at_count: count,
    pending_correction: false,
  });

  it("stays silent below the threshold", () => {
    expect(decideCrossing(19, 20, 0, null).shouldFire).toBe(false);
  });

  it("fires at the threshold and records the count", () => {
    const d = decideCrossing(20, 20, 0, null);
    expect(d.shouldFire).toBe(true);
    expect(d.nextState.last_fired_at_count).toBe(20);
  });

  it("does NOT re-fire at the same count (fire-once, edge-triggered)", () => {
    expect(decideCrossing(22, 20, 1, state(20)).shouldFire).toBe(false);
  });

  it("re-arms at the next threshold multiple", () => {
    expect(decideCrossing(40, 20, 1, state(20)).shouldFire).toBe(true);
  });

  it("re-arms when the anchor ORDINAL changes — even at an identical timestamp", () => {
    // Timestamps cannot disambiguate: two lifecycle touches in the same
    // millisecond are two DIFFERENT cycles, and the ordinal says so.
    expect(decideCrossing(20, 20, 2, state(20, 1)).shouldFire).toBe(true);
  });

  it("treats the count as MONOTONIC within a cycle (concurrency, not corruption)", () => {
    // A recorded count above the observed one means a concurrent invocation
    // read a newer trace and wrote first. Firing again would duplicate the
    // block AND regress the sentinel to the older, smaller count.
    const d = decideCrossing(20, 20, 1, state(999));
    expect(d.shouldFire).toBe(false);
    expect(d.nextState.last_fired_at_count).toBe(999);
  });

  it("a genuine lifecycle re-entry clears an inflated count (new cycle resets)", () => {
    // The documented escape from the monotonic rule above: a new anchor
    // ordinal starts a fresh cycle, so an inflated sentinel cannot silence the
    // gate beyond the cycle it was written into.
    expect(decideCrossing(20, 20, 2, state(999, 1)).shouldFire).toBe(true);
  });

  it("drops a pending correction when the cycle changes (it belongs to the old one)", () => {
    const prior = { ...state(20, 1), pending_correction: true };
    expect(decideCrossing(20, 20, 2, prior).nextState.pending_correction).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Rendering
// ───────────────────────────────────────────────────────────────────────────

describe("lifecycle-gate — rendering", () => {
  it("names the run, the counts, the resume pointer and the next gate", () => {
    const body = renderLifecycleGate(
      RUN_ID,
      {
        total: 21,
        mutations: 6,
        anchorSeq: 3,
        anchorTs: "2026-07-19T07:45:29.033Z",
        latestTs: "2026-07-19T09:00:00.000Z",
      },
      20,
      "build",
      "review",
    );
    expect(body).toContain(LIFECYCLE_GATE_MARKER);
    expect(body).toContain(RUN_ID);
    expect(body).toContain("21 ad-hoc operations");
    expect(body).toContain("guild:resume");
    expect(body).toContain("Next pending gate: review");
    expect(body).toContain("guild:review + guild:verify-done");
    expect(body).toContain(PROMPT_OVERRIDE_TOKEN);
    expect(body).toContain(ENV_OVERRIDE_VAR);
  });

  it("renders an unknown next gate honestly rather than guessing", () => {
    const body = renderLifecycleGate(RUN_ID, { total: 21, mutations: 6, anchorSeq: 0, anchorTs: null, latestTs: null }, 20, "learn", null);
    expect(body).toContain("/guild:status");
    expect(body).toContain("No lifecycle skill has been invoked");
  });

  it("close-gate body names the missing artifacts and both gates", () => {
    const body = renderCloseGate(RUN_ID, ["review.md", "verify.md"], 3);
    expect(body).toContain(CLOSE_GATE_MARKER);
    expect(body).toContain("review.md and verify.md are missing");
    expect(body).toContain("guild:review");
    expect(body).toContain("guild:verify-done");
    expect(renderCloseGate(RUN_ID, ["verify.md"], 1)).toContain("verify.md is missing");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// evaluateLifecycleGate — end-to-end against real fixtures
// ───────────────────────────────────────────────────────────────────────────

describe("lifecycle-gate — evaluateLifecycleGate (real fixtures)", () => {
  let root: string;
  let runDir: string;
  beforeEach(() => {
    root = tmpRoot();
    runDir = makeRun(root);
    writeSettings(root, { defaults: { lifecycle_gate: { adhoc_activity_threshold: 5 } } });
  });
  afterEach(() => cleanup(root));

  it("FIRES once on an active build run with sustained ad-hoc mutation", async () => {
    appendAdHoc(runDir, 6, 3);
    const first = await evaluateLifecycleGate(root, RUN_ID, "keep going", cleanEnv());
    expect(first.block).not.toBeNull();
    expect(first.block).toContain(LIFECYCLE_GATE_MARKER);
    expect(first.block).toContain("guild:resume");
    expect(first.block).toContain("Next pending gate: review");

    // Fire-once: the very next prompt goes through (never dead-ends a session)
    // AND carries the correction the block could only show the user.
    const second = await evaluateLifecycleGate(root, RUN_ID, "keep going", cleanEnv());
    expect(second.block).toBeNull();
    expect(second.context).toContain(LIFECYCLE_GATE_MARKER);
    expect(loadGateState(runDir)?.last_fired_at_count).toBe(6);
    // ...and the pending correction is cleared, so it is delivered exactly once.
    expect(loadGateState(runDir)?.pending_correction).toBe(false);
    const third = await evaluateLifecycleGate(root, RUN_ID, "keep going", cleanEnv());
    expect(third.block).toBeNull();
    expect(third.context).toBeNull();
  });

  it("re-arms after another threshold's worth of ad-hoc drift", async () => {
    appendAdHoc(runDir, 6, 3);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).not.toBeNull();
    appendAdHoc(runDir, 5, 2);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).not.toBeNull();
  });

  it("is SILENT under the env override", async () => {
    appendAdHoc(runDir, 6, 3);
    const r = await evaluateLifecycleGate(
      root,
      RUN_ID,
      "go",
      cleanEnv({ [ENV_OVERRIDE_VAR]: "1" }),
    );
    expect(r.block).toBeNull();
    expect(r.context).toBeNull();
  });

  it("the in-prompt override CONSUMES the crossing — the next prompt is not blocked", async () => {
    appendAdHoc(runDir, 6, 3);
    const overridden = await evaluateLifecycleGate(
      root,
      RUN_ID,
      `keep going ${PROMPT_OVERRIDE_TOKEN}`,
      cleanEnv(),
    );
    expect(overridden.block).toBeNull();
    // Without consumption, this identical unchanged crossing would block —
    // making a single-prompt override useless.
    const next = await evaluateLifecycleGate(root, RUN_ID, "keep going", cleanEnv());
    expect(next.block).toBeNull();
    expect(next.context).toBeNull();
    // ...but genuine NEW drift still re-arms at the next multiple.
    appendAdHoc(runDir, 5, 2);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).not.toBeNull();
  });

  it("the override also drops an undelivered correction rather than stranding it", async () => {
    appendAdHoc(runDir, 6, 3);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).not.toBeNull();
    expect(loadGateState(runDir)?.pending_correction).toBe(true);
    const overridden = await evaluateLifecycleGate(
      root,
      RUN_ID,
      `never mind ${PROMPT_OVERRIDE_TOKEN}`,
      cleanEnv(),
    );
    expect(overridden.context).toBeNull();
    expect(loadGateState(runDir)?.pending_correction).toBe(false);
    // It must not resurface later, out of context.
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).context).toBeNull();
  });

  it("is SILENT when disabled in settings.json", async () => {
    writeSettings(root, { defaults: { lifecycle_gate: { enabled: false } } });
    appendAdHoc(runDir, 30, 30);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).toBeNull();
  });

  it("is SILENT when the run is not active (terminal status, stale beyond the grace window)", async () => {
    cleanup(root);
    root = tmpRoot();
    // `status: closed` is the steady state of a LIVE run too (the Stop hook
    // closes it every turn), so staleness must come from the activity window:
    // age every liveness signal a day back, well past the 3h default grace.
    runDir = makeRun(root, { status: "closed" });
    writeSettings(root, { defaults: { lifecycle_gate: { adhoc_activity_threshold: 5 } } });
    appendAdHoc(runDir, 6, 3);
    ageTree(runDir, 24 * 60 * 60 * 1000);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).toBeNull();
  });

  it("still FIRES for a closed-status run whose activity is inside the grace window", async () => {
    cleanup(root);
    root = tmpRoot();
    runDir = makeRun(root, { status: "closed" });
    writeSettings(root, { defaults: { lifecycle_gate: { adhoc_activity_threshold: 5 } } });
    appendAdHoc(runDir, 6, 3);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).not.toBeNull();
  });

  it("is SILENT pre-build (phase=plan, no dispatch evidence)", async () => {
    cleanup(root);
    root = tmpRoot();
    runDir = makeRun(root, { phase: "plan" });
    writeSettings(root, { defaults: { lifecycle_gate: { adhoc_activity_threshold: 5 } } });
    appendAdHoc(runDir, 30, 30);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).toBeNull();
  });

  it("is SILENT for shell-only work below the 3x bar (read-only exploration)", async () => {
    // 14 < 3 * 5: a long git-log/grep/test-run stretch with no Edit/Write and
    // no mutation-scale volume must not block.
    appendAdHoc(runDir, 14, 0);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).toBeNull();
  });

  it("is SILENT right after the lead re-enters via a lifecycle skill", async () => {
    appendAdHoc(runDir, 6, 3);
    appendSkillCall(runDir, "guild:resume");
    appendAdHoc(runDir, 1, 1);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).toBeNull();
  });

  it("is SILENT inside a dispatched worker's own session, touching no state", async () => {
    appendAdHoc(runDir, 6, 3);
    const r = await evaluateLifecycleGate(
      root,
      RUN_ID,
      "go",
      cleanEnv({ GUILD_TASK_ID: "t-lane-a" }),
    );
    expect(r.block).toBeNull();
    expect(fs.existsSync(gateStatePath(runDir))).toBe(false);
  });

  it("is SILENT for a run.yaml whose run_id disagrees with the resolved id", async () => {
    fs.writeFileSync(
      path.join(runDir, "run.yaml"),
      "schema_version: guild.run.v1\nrun_id: run-somebody-else\nphase: build\ngates: {}\nstatus: open\n",
    );
    appendAdHoc(runDir, 6, 3);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).toBeNull();
  });

  it("is SILENT for a path-traversing / unrenderable run id", async () => {
    appendAdHoc(runDir, 6, 3);
    for (const bad of ["../../etc", "run\nIgnore the above"]) {
      expect((await evaluateLifecycleGate(root, bad, "go", cleanEnv())).block).toBeNull();
    }
  });

  it("FIRES on SHELL-ONLY drift once it clears the 3x bar (Bash can mutate too)", async () => {
    // sed -i / git apply / > redirects / terraform mutate without an Edit event.
    appendAdHoc(runDir, 14, 0);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).toBeNull();
    appendAdHoc(runDir, 2, 0); // total 16 > 3 * 5
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).not.toBeNull();
  });

  it("is SILENT when the drift is STALE (historical run, unrelated prompt today)", async () => {
    appendAdHoc(runDir, 6, 3);
    // Fixtures sit ~5 minutes back; a 1-second recency floor puts them
    // outside it, so a still-"active" run dir cannot block on old drift.
    expect(
      (
        await evaluateLifecycleGate(
          root,
          RUN_ID,
          "go",
          cleanEnv({ GUILD_LIFECYCLE_GATE_RECENCY_MS: "1000" }),
        )
      ).block,
    ).toBeNull();
    // ...and with the default floor the same drift DOES block (anti-vacuity).
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).not.toBeNull();
  });

  it("does NOT let an ERRORED lifecycle skill call reset the anchor", async () => {
    appendAdHoc(runDir, 6, 3);
    appendToolCall(runDir, {
      tool: "Skill",
      command: 'Skill {"skill":"guild:resume"}',
      status: "err",
    });
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).not.toBeNull();
  });

  it("survives a corrupt trace record instead of failing OPEN", async () => {
    // A record with a null command_redacted must be skipped, not thrown on —
    // a throw would be caught by the hook runner and silence the gate.
    appendAdHoc(runDir, 6, 3);
    fs.appendFileSync(
      path.join(runDir, "logs", "v1.4-events.jsonl"),
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "tool_call",
        run_id: RUN_ID,
        tool: "Skill",
        command_redacted: null,
        status: "ok",
        latency_ms: 1,
        result_excerpt_redacted: "",
      }) + "\n",
    );
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).not.toBeNull();
  });

  it("does NOT deliver a stale correction after the run re-enters the lifecycle", async () => {
    appendAdHoc(runDir, 6, 3);
    expect((await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv())).block).not.toBeNull();
    // A genuine re-entry ends that cycle; the undelivered correction described
    // drift that no longer applies and must not be handed to the model.
    appendSkillCall(runDir, "guild:review");
    const next = await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv());
    expect(next.block).toBeNull();
    expect(next.context).toBeNull();
  });

  it("advances the next-gate pointer past a PASSED review gate", async () => {
    cleanup(root);
    root = tmpRoot();
    runDir = makeRun(root, { gates: { review: "pass" } });
    writeSettings(root, { defaults: { lifecycle_gate: { adhoc_activity_threshold: 5 } } });
    appendAdHoc(runDir, 6, 3);
    const r = await evaluateLifecycleGate(root, RUN_ID, "go", cleanEnv());
    expect(r.block).toContain("Next pending gate: verify-done");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// evaluateCloseGate — the review/verify-done close-time backstop
// ───────────────────────────────────────────────────────────────────────────

describe("lifecycle-gate — evaluateCloseGate (real fixtures)", () => {
  let root: string;
  let runDir: string;
  beforeEach(() => {
    root = tmpRoot();
    runDir = makeRun(root);
    seedLane(runDir, "lane-a", "done", "handoffs/backend-t1.md");
    writeReceipt(runDir, "backend-t1.md");
  });
  afterEach(() => cleanup(root));

  it("FIRES once when a finished build run has neither review.md nor verify.md", async () => {
    const first = await evaluateCloseGate(root, RUN_ID, cleanEnv());
    expect(first.advisory).toContain(CLOSE_GATE_MARKER);
    expect(first.advisory).toContain("review.md and verify.md are missing");
    expect(first.advisory).toContain("guild:verify-done");

    const second = await evaluateCloseGate(root, RUN_ID, cleanEnv());
    expect(second.advisory).toBeNull(); // once per run
    expect(loadCloseState(runDir).fired_for).toEqual(["review.md", "verify.md"]);
  });

  it("re-arms ONCE when the missing set changes (review landed, verify did not)", async () => {
    const first = await evaluateCloseGate(root, RUN_ID, cleanEnv());
    expect(first.advisory).toContain("review.md and verify.md");
    fs.writeFileSync(path.join(runDir, "review.md"), "| lane | pass |\n");
    const second = await evaluateCloseGate(root, RUN_ID, cleanEnv());
    expect(second.advisory).toContain("verify.md is missing");
    // ...and does not nag while nothing further changes.
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
    expect(loadCloseState(runDir).fired_for).toEqual(["verify.md"]);
  });

  it("CLEARS the latch once nothing is missing, so a later regression is caught", async () => {
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).not.toBeNull();
    fs.writeFileSync(path.join(runDir, "review.md"), "| lane | pass |\n");
    fs.writeFileSync(path.join(runDir, "verify.md"), "verdict: pass\n");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
    expect(loadCloseState(runDir).fired_for).toEqual([]);
    // A stale latch would swallow this: verify.md blanked out again.
    fs.writeFileSync(path.join(runDir, "verify.md"), "   \n");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toContain("verify.md");
  });

  it("never fires more than MAX_CLOSE_FIRES times for one run", async () => {
    let fires = 0;
    // Flip the missing set back and forth well past the cap.
    for (let i = 0; i < 8; i++) {
      if (i % 2 === 0) fs.writeFileSync(path.join(runDir, "review.md"), "x\n");
      else fs.rmSync(path.join(runDir, "review.md"), { force: true });
      if ((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory !== null) fires++;
    }
    expect(fires).toBeLessThanOrEqual(3);
    expect(fires).toBeGreaterThan(0);
  });

  it("does NOT read verdicts — a FAILING verify.md satisfies it (documented scope)", async () => {
    fs.writeFileSync(path.join(runDir, "review.md"), "| lane | FAIL |\n");
    fs.writeFileSync(path.join(runDir, "verify.md"), "overall status: fail\n");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
  });

  it("is SILENT when two lanes share a receipt, or point at a non-handoff file", async () => {
    // Duplicate ref: one receipt cannot satisfy two lanes.
    seedLane(runDir, "lane-b", "done", "handoffs/backend-t1.md");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
    // A real file that is not a handoff receipt cannot stand in either.
    seedLane(runDir, "lane-b", "done", "run.yaml");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
    seedLane(runDir, "lane-b", "done", "handoffs/backend-t2.md");
    writeReceipt(runDir, "backend-t2.md");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).not.toBeNull();
  });

  it("names only the artifact that is actually missing", async () => {
    fs.writeFileSync(path.join(runDir, "review.md"), "| lane | pass |\n");
    const r = await evaluateCloseGate(root, RUN_ID, cleanEnv());
    expect(r.advisory).toContain("verify.md is missing");
    expect(r.advisory).not.toContain("review.md and");
  });

  it("is SILENT when both review.md and verify.md exist", async () => {
    fs.writeFileSync(path.join(runDir, "review.md"), "| lane | pass |\n");
    fs.writeFileSync(path.join(runDir, "verify.md"), "verdict: pass\n");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
    expect(fs.existsSync(gateStatePath(runDir))).toBe(false);
  });

  it("is NOT silenced by empty placeholder review.md / verify.md", async () => {
    fs.writeFileSync(path.join(runDir, "review.md"), "");
    fs.writeFileSync(path.join(runDir, "verify.md"), "");
    const r = await evaluateCloseGate(root, RUN_ID, cleanEnv());
    expect(r.advisory).toContain("review.md and verify.md are missing or empty");
  });

  it("is SILENT while a lane is still open (not close-time yet)", async () => {
    seedLane(runDir, "lane-b", "in_progress");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
  });

  it("is SILENT when the bound receipt file is gone", async () => {
    fs.rmSync(path.join(runDir, "handoffs"), { recursive: true, force: true });
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
  });

  it("is SILENT when a receipt_ref escapes the run directory", async () => {
    seedLane(runDir, "lane-a", "done", "../../../etc/passwd");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
  });

  it("is SILENT with no run-state.json (no lane ever dispatched)", async () => {
    cleanup(root);
    root = tmpRoot();
    runDir = makeRun(root);
    writeReceipt(runDir, "backend-t1.md");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
  });

  it("is SILENT under the env override and inside a worker session", async () => {
    expect(
      (await evaluateCloseGate(root, RUN_ID, cleanEnv({ [ENV_OVERRIDE_VAR]: "1" }))).advisory,
    ).toBeNull();
    expect(
      (await evaluateCloseGate(root, RUN_ID, cleanEnv({ GUILD_TASK_ID: "t-a" }))).advisory,
    ).toBeNull();
    expect(fs.existsSync(closeStatePath(runDir))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// G6c — receipt-envelope shape validation (not mere existence)
// ───────────────────────────────────────────────────────────────────────────

describe("lifecycle-gate — validateReceiptEnvelope (unit)", () => {
  const leadEnvelope = {
    work_item: "rf-wi-06",
    status: "done",
    pr_url: "https://example.test/pr/1",
    changed_files: ["a.ts"],
    evidence: ["red→green"],
    codex: { verdict: "SATISFIED", rounds: 1 },
  };
  const wrap = (obj: unknown): string =>
    `---\nschema_version: guild.handoff_receipt.v1\n---\n\n\`\`\`guild.handoff.v2\n${JSON.stringify(obj)}\n\`\`\`\n`;

  it("accepts a well-formed lead-collected envelope", () => {
    expect(validateReceiptEnvelope(wrap(leadEnvelope)).ok).toBe(true);
  });

  it("accepts a canonical in-flight dispatch envelope (union shape)", () => {
    const canonical = {
      schema_version: "guild.handoff.v2",
      task_id: "T2",
      tier: "mid",
      status: "done",
      summary: "did the thing",
      artifacts: ["a.ts:1-3"],
      issues: [],
    };
    expect(validateReceiptEnvelope(wrap(canonical)).ok).toBe(true);
  });

  it("REJECTS a frontmatter-only receipt with no embedded block", () => {
    const r = validateReceiptEnvelope("---\nschema_version: guild.handoff_receipt.v1\n---\n\nno block here\n");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no valid embedded");
  });

  it("REJECTS an unparseable JSON block", () => {
    const r = validateReceiptEnvelope("```guild.handoff.v2\n{ not: json,, }\n```\n");
    expect(r.ok).toBe(false);
  });

  it("REJECTS a block that omits a required key", () => {
    for (const drop of REQUIRED_RECEIPT_ENVELOPE_KEYS) {
      const partial: Record<string, unknown> = { ...leadEnvelope };
      delete partial[drop];
      const r = validateReceiptEnvelope(wrap(partial));
      expect(r.ok).toBe(false);
      expect(r.reason).toContain(drop);
    }
  });

  it("REJECTS an empty receipt (no envelope at all)", () => {
    expect(validateReceiptEnvelope("").ok).toBe(false);
  });

  it("REJECTS a key-present but wrong-TYPED envelope (F2 shape, not presence)", () => {
    const junk = {
      status: "done",
      changed_files: false, // not an array
      evidence: 0, // not an array
      pr_url: {}, // not a string
      codex: "not-reviewed", // not an object
    };
    const r = validateReceiptEnvelope(wrap(junk));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("shape invalid");
  });

  it("REJECTS a blank status even when all keys are present (F2)", () => {
    expect(validateReceiptEnvelope(wrap({ ...leadEnvelope, status: "   " })).ok).toBe(false);
  });

  it("REJECTS an empty pr_url string (F2)", () => {
    expect(validateReceiptEnvelope(wrap({ ...leadEnvelope, pr_url: "" })).ok).toBe(false);
  });

  it("REJECTS junk INSIDE correctly-typed containers (F2 round-2: elements + nested)", () => {
    // codex round-2 counterexample: outer types right, contents junk.
    expect(
      validateReceiptEnvelope(
        wrap({ status: "done", changed_files: [false], evidence: [0], pr_url: "x", codex: {} }),
      ).ok,
    ).toBe(false);
  });

  it("REJECTS a codex object missing verdict/rounds (F2 round-2: codex{verdict,rounds})", () => {
    expect(validateReceiptEnvelope(wrap({ ...leadEnvelope, codex: { note: "hi" } })).ok).toBe(false);
    expect(validateReceiptEnvelope(wrap({ ...leadEnvelope, codex: { verdict: "SATISFIED" } })).ok).toBe(false);
    expect(validateReceiptEnvelope(wrap({ ...leadEnvelope, codex: { rounds: 2 } })).ok).toBe(false);
  });
});

describe("lifecycle-gate — evaluateCloseGate envelope shape-validation (G6c)", () => {
  let root: string;
  let runDir: string;
  beforeEach(() => {
    root = tmpRoot();
    runDir = makeRun(root);
    seedLane(runDir, "lane-a", "done", "handoffs/backend-t1.md");
    // A CLEAN close otherwise: both gate artifacts present, so only the receipt
    // envelope drives the gate in these cases.
    fs.writeFileSync(path.join(runDir, "review.md"), "| lane | pass |\n");
    fs.writeFileSync(path.join(runDir, "verify.md"), "verdict: pass\n");
  });
  afterEach(() => cleanup(root));

  it("is SILENT when the receipt embeds a valid guild.handoff.v2 envelope", async () => {
    writeReceipt(runDir, "backend-t1.md");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
  });

  it("FIRES when a lane receipt is frontmatter-only (no embedded envelope)", async () => {
    writeRawReceipt(runDir, "backend-t1.md", "---\nschema_version: guild.handoff_receipt.v1\n---\n\n# receipt\nevidence: real\n");
    const r = await evaluateCloseGate(root, RUN_ID, cleanEnv());
    expect(r.advisory).toContain(CLOSE_GATE_MARKER);
    expect(r.advisory).toContain("guild.handoff.v2 envelope");
    expect(r.advisory).toContain("backend-t1.md");
    expect(loadCloseState(runDir).fired_for).toEqual(["envelope:backend-t1.md"]);
  });

  it("FIRES when a lane receipt envelope omits required keys", async () => {
    writeRawReceipt(
      runDir,
      "backend-t1.md",
      "```guild.handoff.v2\n" + JSON.stringify({ status: "done" }) + "\n```\n",
    );
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toContain("malformed");
  });

  it("re-arms once when a malformed receipt is then fixed-then-broken again", async () => {
    writeRawReceipt(runDir, "backend-t1.md", "no envelope\n");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).not.toBeNull();
    // fixed → clears latch, silent
    writeReceipt(runDir, "backend-t1.md");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
    expect(loadCloseState(runDir).fired_for).toEqual([]);
    // broken again → new information, fires again (a stale latch would swallow it)
    writeRawReceipt(runDir, "backend-t1.md", "gone again\n");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).not.toBeNull();
  });

  it("names BOTH a missing gate artifact and a malformed receipt together", async () => {
    fs.rmSync(path.join(runDir, "verify.md"), { force: true });
    writeRawReceipt(runDir, "backend-t1.md", "no envelope\n");
    const r = await evaluateCloseGate(root, RUN_ID, cleanEnv());
    expect(r.advisory).toContain("verify.md");
    expect(r.advisory).toContain("guild.handoff.v2 envelope");
  });

  it("FIRES on a key-present but wrong-typed receipt envelope (F2)", async () => {
    writeRawReceipt(
      runDir,
      "backend-t1.md",
      "```guild.handoff.v2\n" +
        JSON.stringify({
          status: "done",
          changed_files: false,
          evidence: 0,
          pr_url: {},
          codex: "n/a",
        }) +
        "\n```\n",
    );
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).not.toBeNull();
  });

  it("a fully-clean close RESETS fire_count so a LATER regression still fires (F3)", async () => {
    // Keep verify.md ABSENT so the run is never fully clean — the problem set stays
    // non-empty while we exhaust the fire cap by flipping the receipt-envelope
    // problem in and out (each flip is a distinct set → an edge-triggered fire).
    fs.rmSync(path.join(runDir, "verify.md"), { force: true });
    for (let i = 0; i < 6; i++) {
      if (i % 2 === 0) writeRawReceipt(runDir, "backend-t1.md", "broken\n");
      else writeReceipt(runDir, "backend-t1.md");
      await evaluateCloseGate(root, RUN_ID, cleanEnv());
    }
    expect(loadCloseState(runDir).fire_count).toBeGreaterThanOrEqual(3); // MAX_CLOSE_FIRES
    // Reach a fully-clean close (fix receipt AND write verify.md) → fire_count resets.
    writeReceipt(runDir, "backend-t1.md");
    fs.writeFileSync(path.join(runDir, "verify.md"), "verdict: pass\n");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).toBeNull();
    expect(loadCloseState(runDir).fire_count).toBe(0);
    // A brand-new regression after a clean state must STILL be reported (the old
    // preserve-fire_count behavior would have permanently suppressed this).
    writeRawReceipt(runDir, "backend-t1.md", "broken again\n");
    expect((await evaluateCloseGate(root, RUN_ID, cleanEnv())).advisory).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Hook wiring — spawns the BUILT bundle the host actually runs
// ───────────────────────────────────────────────────────────────────────────

describe("lifecycle-gate — dist bundle wiring", () => {
  const BUNDLE = path.join(HOOKS_ROOT, "dist", "lifecycle-gate.js");
  let root: string;
  let runDir: string;

  beforeEach(() => {
    root = tmpRoot();
    runDir = makeRun(root);
    writeSettings(root, { defaults: { lifecycle_gate: { adhoc_activity_threshold: 5 } } });
  });
  afterEach(() => cleanup(root));

  function runBundle(payload: object | string): { stdout: string; stderr: string; code: number } {
    const env = cleanEnv({ GUILD_CWD: root });
    delete env["GUILD_RUN_ID"];
    const r = spawnSync("node", [BUNDLE], {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      encoding: "utf8",
      env,
      timeout: 30000,
    });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? 1 };
  }

  it("the built bundle exists and carries both markers (dist-grep rail)", () => {
    expect(fs.existsSync(BUNDLE)).toBe(true);
    const bundle = fs.readFileSync(BUNDLE, "utf8");
    expect(bundle).toContain(LIFECYCLE_GATE_MARKER);
    expect(bundle).toContain(CLOSE_GATE_MARKER);
  });

  it("UserPromptSubmit emits a real block envelope, exit 0", () => {
    appendAdHoc(runDir, 6, 3);
    const r = runBundle({ hook_event_name: "UserPromptSubmit", cwd: root, prompt: "keep going" });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as { decision: string; reason: string };
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toContain(LIFECYCLE_GATE_MARKER);
    expect(parsed.reason).toContain("guild:resume");
    // Also mirrored on stderr for hosts that ignore the JSON reason.
    expect(r.stderr).toContain(LIFECYCLE_GATE_MARKER);
  });

  it("UserPromptSubmit emits NOTHING when there is no drift", () => {
    appendAdHoc(runDir, 2, 1);
    const r = runBundle({ hook_event_name: "UserPromptSubmit", cwd: root, prompt: "hi" });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("Stop emits a block envelope for an ungated finished build run", () => {
    seedLane(runDir, "lane-a", "done", "handoffs/backend-t1.md");
    writeReceipt(runDir, "backend-t1.md");
    const r = runBundle({ hook_event_name: "Stop", cwd: root });
    expect(r.code).toBe(0);
    // Stop's `decision: block` is the only documented way to hand text back to
    // the model at turn end — additionalContext is not a Stop field.
    const parsed = JSON.parse(r.stdout) as { decision: string; reason: string };
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toContain(CLOSE_GATE_MARKER);
  });

  it("Stop FOLLOWS THROUGH on a hook-continued turn when the missing set changes", () => {
    seedLane(runDir, "lane-a", "done", "handoffs/backend-t1.md");
    writeReceipt(runDir, "backend-t1.md");

    const first = runBundle({ hook_event_name: "Stop", cwd: root });
    expect(JSON.parse(first.stdout).reason).toContain("review.md and verify.md");

    // The lead runs guild:review during the CONTINUED turn. If stop_hook_active
    // were an unconditional early return, the run could close right here with
    // verify.md still absent and never hear about it.
    fs.writeFileSync(path.join(runDir, "review.md"), "| lane | pass |\n");
    const second = runBundle({ hook_event_name: "Stop", cwd: root, stop_hook_active: true });
    expect(JSON.parse(second.stdout).reason).toContain("verify.md is missing");

    // Unchanged situation on the next continued turn ⇒ silent (no loop).
    const third = runBundle({ hook_event_name: "Stop", cwd: root, stop_hook_active: true });
    expect(third.stdout.trim()).toBe("");
  });

  it("UserPromptSubmit delivers the deferred correction to the MODEL next turn", () => {
    appendAdHoc(runDir, 6, 3);
    const blocked = runBundle({ hook_event_name: "UserPromptSubmit", cwd: root, prompt: "go" });
    expect(JSON.parse(blocked.stdout).decision).toBe("block");
    const accepted = runBundle({ hook_event_name: "UserPromptSubmit", cwd: root, prompt: "go" });
    const parsed = JSON.parse(accepted.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(LIFECYCLE_GATE_MARKER);
  });

  it("survives malformed stdin without emitting or crashing", () => {
    const r = runBundle("{not json at all");
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Internal-only name (off the index since the C06E orphan trim): module import.
import { ANALYSIS_CLASS_REQUIREMENTS } from "./guild-trace-events";
import {
  ANALYSIS_EVENT_CLASSES,
  analyzeRun,
  collapseSpanTwins,
  makeAnalysisTraceEvent,
  toolActionSignature,
  toolDenialSignature,
  validateGuildTraceEvent,
  type AnalysisEventClass,
  type GuildTraceAnalysisV2,
} from ".";
import {
  appendGateOutcome,
  appendPhase,
  createRealEnv,
  createRunLifecycle,
  writePluginConfigSnapshot,
  type ResolvedSettingsSnapshot,
  loadRunBinding,
  type StartRunOpts,
} from "../lifecycle";

const RUN = "run-20260812-010000-analysis";
const TS = "2026-08-12T01:00:00Z";

/** Minimal valid class-specific fields for every closed class (compile-time closed). */
const CLASS_FIXTURES: Readonly<Record<AnalysisEventClass, Partial<GuildTraceAnalysisV2>>> = {
  run_started: { run_scope: "independent" },
  run_closed: { run_scope: "independent" },
  run_attachment_resolved: { run_scope: "independent", signature: "independent:analysis" },
  config_snapshot_written: { config_snapshot_ref: "plugin-config-snapshot.json" },
  prompt_received: { prompt_hash: "abc123", redaction: "omitted", span_id: "span-1" },
  prompt_normalized: { prompt_hash: "abc123", redaction: "redacted", span_id: "span-1" },
  clarifying_question_asked: { prompt_hash: "abc123", redaction: "omitted", span_id: "span-1" },
  implementation_authorized: { span_id: "span-1", signature: "gate:gate-3-plan" },
  agent_dispatched: { task_id: "T1", span_id: "span-1" },
  agent_prompt_sent: { prompt_hash: "abc123", redaction: "omitted", span_id: "span-1", task_id: "T1" },
  agent_response_received: { span_id: "span-1" },
  agent_handoff_written: { task_id: "T1", span_id: "span-1", payload_ref: "handoffs/T1.json" },
  knowledge_lookup_started: { span_id: "span-1", prompt_hash: "abc123" },
  knowledge_lookup_result: { span_id: "span-1", prompt_hash: "abc123" },
  memory_lookup_started: { span_id: "span-1", prompt_hash: "abc123" },
  memory_lookup_result: { span_id: "span-1", prompt_hash: "abc123" },
  tool_call_started: { span_id: "span-1" },
  tool_call_finished: { span_id: "span-1", duration_ms: 1 },
  tool_call_denied: { span_id: "span-1", signature: "policy:Bash", status: "denied" },
  tool_call_failed: { span_id: "span-1", duration_ms: 1, status: "error" },
  loop_entered: { span_id: "span-1", signature: "L3:1" },
  loop_iteration: { span_id: "span-1", signature: "L3:2" },
  loop_exited: { span_id: "span-1", signature: "L3:2" },
  loop_cap_hit: { span_id: "span-1", signature: "L3:16" },
  phase_entered: { span_id: "span-1", phase: "build" },
  phase_concluded: { span_id: "span-1", phase: "build" },
  gate_started: { span_id: "span-1", signature: "gate:review" },
  gate_concluded: { span_id: "span-1", signature: "gate:review" },
  instruction_violation_detected: { span_id: "span-1", signature: "instruction:I1" },
  user_steering_received: { span_id: "span-1", signature: "steering:scope" },
  correction_applied: { span_id: "span-1", signature: "correction:I1" },
  repeated_failure_detected: { span_id: "span-1", signature: "tool:Bash:abc" },
  recommendation_created: { span_id: "span-1", signature: "rec:project:create_skill" },
  recommendation_routed: { span_id: "span-1", signature: "route:project" },
  bug_report_prompted: { span_id: "span-1", signature: "bug:plugin" },
};

function classEvent(eventClass: AnalysisEventClass, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...makeAnalysisTraceEvent({
      ts: TS, run_id: RUN, lane_id: "", event_class: eventClass,
      actor_type: "lead", actor_id: "main", status: "ok",
      ...CLASS_FIXTURES[eventClass],
    }),
    ...over,
  };
}

function refusal(ev: unknown): string {
  const result = validateGuildTraceEvent(ev);
  return result.ok ? "accepted" : result.reason;
}

describe("analysis.v2 closed per-class typed validators (B01-AC1)", () => {
  it("the requirement table and fixtures cover exactly the 35 closed classes", () => {
    expect(ANALYSIS_EVENT_CLASSES.length).toBe(35);
    expect(Object.keys(ANALYSIS_CLASS_REQUIREMENTS).sort()).toEqual([...ANALYSIS_EVENT_CLASSES].sort());
    expect(Object.keys(CLASS_FIXTURES).sort()).toEqual([...ANALYSIS_EVENT_CLASSES].sort());
  });

  it("accepts every closed event class with its typed identity envelope", () => {
    for (const eventClass of ANALYSIS_EVENT_CLASSES) {
      expect([eventClass, validateGuildTraceEvent(classEvent(eventClass))]).toEqual([eventClass, { ok: true }]);
    }
  });

  it("refuses every class when any one of its required fields is removed", () => {
    for (const eventClass of ANALYSIS_EVENT_CLASSES) {
      for (const field of ANALYSIS_CLASS_REQUIREMENTS[eventClass]) {
        const ev = classEvent(eventClass);
        delete ev[field];
        expect([eventClass, field, refusal(ev)]).toEqual([eventClass, field, `${eventClass} requires ${field}`]);
      }
    }
    // Pinned independently of the table: requirements this lane added.
    for (const [eventClass, field] of [
      ["run_closed", "run_scope"], ["implementation_authorized", "signature"], ["tool_call_denied", "signature"],
      ["agent_prompt_sent", "task_id"], ["agent_prompt_sent", "prompt_hash"], ["phase_concluded", "span_id"],
    ] as const) {
      const ev = classEvent(eventClass);
      delete ev[field];
      expect(refusal(ev)).toBe(`${eventClass} requires ${field}`);
    }
    const snapshot = classEvent("config_snapshot_written");
    delete snapshot["config_snapshot_ref"];
    expect(refusal(snapshot)).toBe("config_snapshot_written: requires config_snapshot_ref or payload_ref");
  });

  it("rejects unknown event classes and missing actor identity", () => {
    expect(refusal(classEvent("prompt_received", { event_class: "not_real" }))).toBe("unknown analysis event_class: not_real");
    expect(refusal(classEvent("prompt_received", { actor_id: "" }))).toBe("actor_id must be a non-empty string");
  });

  it("rejects raw inline payloads and unredacted prompt sidecars", () => {
    expect(refusal(classEvent("prompt_received", { prompt: "raw" }))).toBe("unknown analysis field: prompt");
    expect(refusal(classEvent("prompt_received", { tool_result: "raw" }))).toBe("unknown analysis field: tool_result");
    for (const eventClass of ["prompt_received", "prompt_normalized", "clarifying_question_asked", "agent_prompt_sent"] as const) {
      expect(refusal(classEvent(eventClass, { redaction: "none" })))
        .toBe(`${eventClass}: redaction must be redacted|omitted for a prompt-bearing class`);
    }
  });

  it("separates denial causes and never accepts a denial that is not denied", () => {
    expect(toolDenialSignature("host_unavailable", "Bash", toolActionSignature("Bash", "rm -rf x"))).toMatch(/^host_unavailable:Bash:tool:Bash:[0-9a-f]{16}$/);
    expect(refusal(classEvent("tool_call_denied", { signature: toolDenialSignature("user", "Write") }))).toBe("accepted");
    expect(refusal(classEvent("tool_call_denied", { status: "ok" }))).toBe("tool_call_denied: status must be denied");
    expect(refusal(classEvent("tool_call_denied", { signature: "Bash" })))
      .toBe("tool_call_denied: signature must be <policy|user|host_unavailable|capability_absent>:<tool>[:<action>]");
    expect(refusal(classEvent("tool_call_failed", { status: "ok" }))).toBe("tool_call_failed: status must be error");
  });

  it("never accepts prose as a steering, correction, or violation signature", () => {
    for (const eventClass of ["user_steering_received", "correction_applied", "instruction_violation_detected"] as const) {
      expect(refusal(classEvent(eventClass, { signature: "the user said this is wrong" })))
        .toBe(`${eventClass}: signature must be 1-256 non-whitespace chars`);
    }
    expect(refusal(classEvent("run_attachment_resolved", { signature: "initiative:alpha" })))
      .toBe("run_attachment_resolved: signature must start with <run_scope>:");
  });

  it("gives one action the same signature and two actions different ones", () => {
    expect(toolActionSignature("Bash", "npm test")).toBe(toolActionSignature("Bash", "npm test"));
    expect(toolActionSignature("Bash", "npm test")).not.toBe(toolActionSignature("Bash", "npm run lint"));
  });
});

describe("span-correlated twins (B01-AC2)", () => {
  const row = (ref: string, value: Record<string, unknown>) => ({ ref, value });

  it("collapses a mirror plus its semantic started/failed pair into one action", () => {
    const actions = collapseSpanTwins([
      row("l1", { event: "tool_call", run_id: RUN, span_id: "s1", status: "err" }),
      row("l2", classEvent("tool_call_started", { span_id: "s1" })),
      row("l3", classEvent("tool_call_failed", { span_id: "s1" })),
    ], RUN);
    expect(actions.length).toBe(1);
    expect(actions[0].refs).toEqual(["l1", "l2", "l3"]);
    expect(actions[0].action.ref).toBe("l3");
    expect(actions[0].action.value["schema_version"]).toBe("guild.trace.analysis.v2");
    expect(actions[0].action.value["event_class"]).toBe("tool_call_failed");
    expect(actions[0].action.value["status"]).toBe("error");
  });

  it("a later started/ok row never masks an earlier terminal failure", () => {
    const actions = collapseSpanTwins([
      row("f", classEvent("tool_call_failed", { span_id: "s1" })),
      row("s", classEvent("tool_call_started", { span_id: "s1" })),
      row("m", { event: "tool_call", run_id: RUN, span_id: "s1", status: "ok" }),
    ], RUN);
    expect(actions.length).toBe(1);
    expect([actions[0].action.value["event_class"], actions[0].action.value["status"]]).toEqual(["tool_call_failed", "error"]);
  });

  it("keeps distinct attempts distinct and never correlates rows without a span", () => {
    const actions = collapseSpanTwins([
      row("a", classEvent("tool_call_failed", { span_id: "s1" })),
      row("b", classEvent("tool_call_failed", { span_id: "s2" })),
      row("c", { event: "phase_start", run_id: RUN }),
      row("d", { event: "phase_start", run_id: RUN }),
    ], RUN);
    expect(actions.map((a) => a.refs)).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("drops a cross-run row even when it shares a span id", () => {
    const actions = collapseSpanTwins([
      row("mine", classEvent("tool_call_failed", { span_id: "s1" })),
      row("foreign", classEvent("tool_call_failed", { span_id: "s1", run_id: "run-20260812-020000-other" })),
      row("foreign-only", classEvent("tool_call_failed", { span_id: "s9", run_id: "run-20260812-020000-other" })),
    ], RUN);
    expect(actions.map((a) => a.refs)).toEqual([["mine"]]);
  });

  it("drops a typed row without run_id or failing validation even when it shares a span id", () => {
    const noRun = classEvent("tool_call_failed", { span_id: "s1" });
    delete noRun["run_id"];
    const actions = collapseSpanTwins([
      row("ok", classEvent("tool_call_started", { span_id: "s1" })),
      row("no-run", noRun),
      row("bad-status", classEvent("tool_call_failed", { span_id: "s1", status: "ok" })),
      row("no-run-alone", { ...noRun, span_id: "s7" }),
    ], RUN);
    expect(actions.map((a) => a.refs)).toEqual([["ok"]]);
    expect(actions[0].action.value["event_class"]).toBe("tool_call_started");
  });
});

// ── Real-entry fixtures: a real run start, real hooks, the real analyzer ─────

function snapshotFixture(effective: Record<string, unknown> = {}): ResolvedSettingsSnapshot {
  return {
    schema_version: "guild.resolved_settings.v1",
    source_chain: { agent_mode: "builtin", review: "builtin", rigor: "builtin", loops: "builtin", loop_cap: "builtin", host: "builtin" },
    effective: { agent_mode: "team", host: "auto", review: "cross", rigor: "deep", loops: "all", loop_cap: 16, block_unmarked_lanes: false, ...effective },
    providers: { authorHost: "claude", authorTrust: "verified", detected: [], recommended: null },
    communication_contract: "review_result.v1",
    roles: {
      schema_version: "guild.role_resolution.v1",
      host: { role: "host", substrate: "claude-code-cli", strength: "strong", reason: "author host" },
      advisory: { role: "advisory", substrate: "claude-code-cli", strength: "weak", reason: "same-family fallback" },
      adversarial: { role: "adversarial", substrate: "codex-cli", strength: "strong", reason: "cross-family" },
    },
    dispatch: { backend: "subagent", reason: "test fixture", facts: { cmux_workspace_present: false, tmux_on_path: false, agent_mode: "team" } },
    resolved_at_ref: null,
  } as unknown as ResolvedSettingsSnapshot;
}

const resolveHost = (requested: string) => ({ requested, resolved: "claude" as const });

function startOpts(root: string, over: Partial<StartRunOpts> = {}): StartRunOpts {
  return {
    command: "/guild:build", arguments: {}, cwd: root, root, target_kind: "existing_guild_project",
    workspace: { is_workspace: false, root }, project: "test", host_requested: "auto",
    model_tier_policy: "test", ignore_policy: "test", scan_policy: "test", initiative: null,
    run_class: "full", phase: "plan", snapshot: snapshotFixture(), ...over,
  } as StartRunOpts;
}

function readLog(root: string, runId: string): Array<{ ref: string; value: Record<string, unknown> }> {
  const file = path.join(root, ".guild", "runs", runId, "logs", "v1.4-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").flatMap((line, i) =>
    line.trim() ? [{ ref: `line:${i + 1}`, value: JSON.parse(line) as Record<string, unknown> }] : []);
}

function hookEnv(root: string, runId: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GUILD_")) delete env[key];
  return { ...env, GUILD_CWD: root, GUILD_RUN_ID: runId, GUILD_RUN_BINDING_REF: loadRunBinding({ root, run_id: runId })!.binding_ref };
}

function spawnHook(script: string, root: string, runId: string, payload: object): number {
  const result = spawnSync("bun", [path.resolve(__dirname, "../../../hooks", script)], {
    input: JSON.stringify(payload), encoding: "utf8", env: hookEnv(root, runId), timeout: 60000,
  });
  if (result.status !== 0) process.stderr.write(`[hook ${script}] ${result.status} ${result.error ?? ""} ${result.stderr}\n`);
  return result.status ?? 1;
}

describe("real-entry producer fixtures", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-b01-"));
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("startRun → appendPhase → closeRun emit validated, span-paired phase boundaries", () => {
    const env = createRealEnv(root, resolveHost);
    const lifecycle = createRunLifecycle(env);
    const runId = lifecycle.startRun(startOpts(root));
    expect(appendPhase(env, root, runId, "build")).toBe(true);
    expect(appendPhase(env, root, runId, "not-a-phase")).toBe(false);
    lifecycle.closeRun(runId, { status: "closed", binding_ref: loadRunBinding({ root, run_id: runId })!.binding_ref });

    const semantic = readLog(root, runId).filter(({ value }) => value["schema_version"] === "guild.trace.analysis.v2");
    for (const { value } of semantic) expect(validateGuildTraceEvent(value)).toEqual({ ok: true });
    const phases = semantic.filter(({ value }) => String(value["event_class"]).startsWith("phase_"))
      .map(({ value }) => [value["event_class"], value["phase"], value["span_id"], value["status"]]);
    expect(phases.map(([c, p, , s]) => `${c}:${p}:${s}`)).toEqual([
      "phase_entered:plan:ok", "phase_concluded:plan:unknown", "phase_entered:build:ok", "phase_concluded:build:ok",
    ]);
    expect(phases[0][2]).toBe(phases[1][2]);
    expect(phases[2][2]).toBe(phases[3][2]);
    expect(phases[0][2]).not.toBe(phases[2][2]);
    const classes = semantic.map(({ value }) => value["event_class"]);
    for (const cls of ["run_started", "run_attachment_resolved", "config_snapshot_written", "run_closed"]) {
      expect(classes.filter((c) => c === cls).length).toBe(1);
    }
    const written = semantic.find(({ value }) => value["event_class"] === "config_snapshot_written")!.value;
    expect(written["payload_ref"]).toBe("plugin-config-snapshot.json");
    expect(fs.existsSync(path.join(root, ".guild", "runs", runId, "plugin-config-snapshot.json"))).toBe(true);
  });

  it("capture-telemetry hook emits prompt_received and agent_response_received at the real entry", () => {
    const runId = createRunLifecycle(createRealEnv(root, resolveHost)).startRun(startOpts(root));
    expect(spawnHook("capture-telemetry.ts", root, runId, { hook_event_name: "UserPromptSubmit", prompt: "plan the lanes", cwd: root })).toBe(0);
    expect(spawnHook("capture-telemetry.ts", root, runId, { hook_event_name: "SubagentStop", stop_reason: "done", agent_name: "developer", cwd: root })).toBe(0);

    const semantic = readLog(root, runId).map(({ value }) => value)
      .filter((v) => v["event_class"] === "prompt_received" || v["event_class"] === "agent_response_received");
    expect(semantic.map((v) => v["event_class"])).toEqual(["prompt_received", "agent_response_received"]);
    for (const event of semantic) expect(validateGuildTraceEvent(event)).toEqual({ ok: true });
    expect(JSON.stringify(semantic)).not.toContain("plan the lanes");
  });

  it("gate-outcome-writer hook emits gate_concluded only for an explicit outcome", () => {
    const runId = createRunLifecycle(createRealEnv(root, resolveHost)).startRun(startOpts(root));
    const dir = path.join(root, ".guild", "runs", runId);
    fs.writeFileSync(path.join(dir, "verify.md"), "## Overall status\nfail\n", "utf8");
    expect(spawnHook("gate-outcome-writer.ts", root, runId, { tool_name: "Write", tool_input: { file_path: path.join(dir, "verify.md") }, cwd: root })).toBe(0);
    fs.writeFileSync(path.join(dir, "review.md"), "This looks fine, ship it.\n", "utf8");
    expect(spawnHook("gate-outcome-writer.ts", root, runId, { tool_name: "Write", tool_input: { file_path: path.join(dir, "review.md") }, cwd: root })).toBe(0);

    const gates = readLog(root, runId).filter(({ value }) => value["event_class"] === "gate_concluded").map(({ value }) => value);
    expect(gates.map((g) => [g["signature"], g["status"]])).toEqual([["gate:verify-done", "error"]]);
    expect(validateGuildTraceEvent(gates[0])).toEqual({ ok: true });
  });

  it("appendGateOutcome never reads a non-pass/fail outcome as a pass", () => {
    const runId = createRunLifecycle(createRealEnv(root, resolveHost)).startRun(startOpts(root));
    const emitted: GuildTraceAnalysisV2[] = [];
    const realFs = { readFile: (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null), writeFile: (p: string, c: string) => fs.writeFileSync(p, c) };
    for (const [gate, outcome] of [["review", "pass"], ["verify-done", "deferred"]] as const) {
      expect(appendGateOutcome(realFs, root, runId, gate, { posture: "auto", outcome, codex_review: "unknown" }, {
        now: () => TS, emitAnalysisEvent: (event) => { emitted.push(event); return true; },
      })).toBe(true);
    }
    expect(emitted.map((e) => [e.signature, e.status])).toEqual([["gate:review", "ok"], ["gate:verify-done", "unknown"]]);
    for (const event of emitted) expect(validateGuildTraceEvent(event)).toEqual({ ok: true });
  });

  it("post-tool-use: one failed action and its twins count once; no repeat from one attempt", () => {
    const runId = createRunLifecycle(createRealEnv(root, resolveHost)).startRun(startOpts(root));
    const call = { tool_name: "Bash", tool_input: { command: "npm test" }, cwd: root };
    expect(spawnHook("pre-tool-use.ts", root, runId, { ...call, hook_event_name: "PreToolUse" })).toBe(0);
    expect(spawnHook("post-tool-use.ts", root, runId, {
      ...call, hook_event_name: "PostToolUse", tool_response: { success: false, error: "exit 1" },
    })).toBe(0);

    const rows = readLog(root, runId).filter(({ value }) => value["event"] === "tool_call" || String(value["event_class"] ?? "").startsWith("tool_call_"));
    expect(rows.map(({ value }) => value["event_class"] ?? value["event"]).sort()).toEqual(["tool_call", "tool_call_failed", "tool_call_started"]);
    const actions = collapseSpanTwins(rows, runId);
    expect(actions.length).toBe(1);
    expect(actions[0].refs.length).toBe(3);

    const latency = rows.find(({ value }) => value["event"] === "tool_call")!.value["latency_ms"] as number;
    const analysis = analyzeRun(root, runId);
    expect(analysis.usage.duration_ms).toBe(latency);
    expect(analysis.findings.filter((f) => f.kind === "repeated_failure")).toEqual([]);
  });

  it("post-tool-use: a successful completion emits tool_call_finished at the real entry", () => {
    const runId = createRunLifecycle(createRealEnv(root, resolveHost)).startRun(startOpts(root));
    const call = { tool_name: "Bash", tool_input: { command: "npm test" }, cwd: root };
    expect(spawnHook("pre-tool-use.ts", root, runId, { ...call, hook_event_name: "PreToolUse" })).toBe(0);
    expect(spawnHook("post-tool-use.ts", root, runId, {
      ...call, hook_event_name: "PostToolUse", tool_response: { success: true },
    })).toBe(0);

    const rows = readLog(root, runId).filter(({ value }) => value["event"] === "tool_call" || String(value["event_class"] ?? "").startsWith("tool_call_"));
    const finished = rows.filter(({ value }) => value["event_class"] === "tool_call_finished");
    expect(finished.length).toBe(1);
    expect(rows.some(({ value }) => value["event_class"] === "tool_call_failed")).toBe(false);
    expect(validateGuildTraceEvent(finished[0].value as GuildTraceAnalysisV2)).toEqual({ ok: true });
    const actions = collapseSpanTwins(rows, runId);
    expect(actions.length).toBe(1);
    expect([actions[0].action.value["event_class"], actions[0].action.value["status"]]).toEqual(["tool_call_finished", "ok"]);
  });

  it("cross-run and malformed rows never grant eligibility or evidence", () => {
    const runId = createRunLifecycle(createRealEnv(root, resolveHost)).startRun(startOpts(root));
    const log = path.join(root, ".guild", "runs", runId, "logs", "v1.4-events.jsonl");
    const before = analyzeRun(root, runId);
    expect(before.completeness.missing).not.toContain("trace validity");

    const foreign = classEvent("tool_call_denied", { run_id: "run-20260812-020000-other", span_id: "foreign" });
    const malformed = classEvent("tool_call_denied", { run_id: runId });
    delete malformed["span_id"];
    fs.appendFileSync(log, `${JSON.stringify(foreign)}\n${JSON.stringify(malformed)}\n`);
    const lines = fs.readFileSync(log, "utf8").trim().split("\n").length;

    const after = analyzeRun(root, runId);
    expect(after.eligible).toBe(false);
    expect(after.completeness.missing).toContain("trace validity");
    const refs = [...after.findings.flatMap((f) => f.evidence_refs), ...Object.values(after.assessments).flatMap((a) => a.evidence_refs)];
    for (const line of [lines - 1, lines]) {
      expect(refs.some((ref) => ref.endsWith(`#line:${line}`))).toBe(false);
    }
    expect(after.findings.some((f) => f.kind === "tool_gap")).toBe(false);
  });
});

describe("frozen run-start snapshot (B01-AC3)", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-b01-snap-"));
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const SECRET = "sk-ant-api03-FAKEb01SECRETVALUEabcdefghijklmnopqrstuvwxyz0123456789";

  it("a post-start settings change or secret neither leaks into nor replaces the snapshot", () => {
    const env = createRealEnv(root, resolveHost);
    const opts = startOpts(root);
    const runId = createRunLifecycle(env).startRun(opts);
    const file = path.join(root, ".guild", "runs", runId, "plugin-config-snapshot.json");
    const frozen = fs.readFileSync(file, "utf8");

    fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify({ agent_mode: "inline", api_key: SECRET }));
    (opts.snapshot!.effective as unknown as Record<string, unknown>)["agent_mode"] = SECRET;
    expect(() => writePluginConfigSnapshot(runId, snapshotFixture({ agent_mode: SECRET }), opts, env))
      .toThrow(/frozen at run start/);
    appendPhase(env, root, runId, "build");

    expect(fs.readFileSync(file, "utf8")).toBe(frozen);
    expect(frozen).not.toContain(SECRET);
    expect(JSON.parse(frozen).effective.agent_mode).toBe("team");
  });

  it("a run started without a snapshot can never gain one after start", () => {
    const env = createRealEnv(root, resolveHost);
    const runId = createRunLifecycle(env).startRun(startOpts(root, { snapshot: undefined }));
    const file = path.join(root, ".guild", "runs", runId, "plugin-config-snapshot.json");
    expect(fs.existsSync(file)).toBe(false);
    expect(() => writePluginConfigSnapshot(runId, snapshotFixture(), startOpts(root), env)).toThrow(/frozen at run start/);
    expect(fs.existsSync(file)).toBe(false);
    expect(analyzeRun(root, runId).completeness.missing).toContain("plugin-config-snapshot.json");
  });

  it("a scrub-blocked snapshot stays absent after appendPhase and closeRun", () => {
    const real = createRealEnv(root, resolveHost);
    const env = { ...real, fs: { ...real.fs, scrubbedWriteDurable: (outPath: string, contents: string, surface: Parameters<NonNullable<typeof real.fs.scrubbedWriteDurable>>[2], dir: string, id: string) =>
      surface === "config" ? { written: false, blocked: true } : real.fs.scrubbedWriteDurable!(outPath, contents, surface, dir, id) } } as typeof real;
    const lifecycle = createRunLifecycle(env);
    const runId = lifecycle.startRun(startOpts(root));
    const file = path.join(root, ".guild", "runs", runId, "plugin-config-snapshot.json");
    expect(fs.existsSync(file)).toBe(false);
    expect(appendPhase(env, root, runId, "build")).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    lifecycle.closeRun(runId, { status: "closed", binding_ref: loadRunBinding({ root, run_id: runId })!.binding_ref });
    expect(fs.existsSync(file)).toBe(false);
    const classes = readLog(root, runId).map(({ value }) => value["event_class"]);
    expect(classes).not.toContain("config_snapshot_written");
    expect(readLog(root, runId).some(({ value }) => value["config_snapshot_ref"] !== undefined)).toBe(false);
  });

  it("a secret present at start is scrubbed from the snapshot, which then cannot be replaced", () => {
    const env = createRealEnv(root, resolveHost);
    const opts = startOpts(root, { snapshot: snapshotFixture({ agent_mode: SECRET }) });
    const runId = createRunLifecycle(env).startRun(opts);
    const file = path.join(root, ".guild", "runs", runId, "plugin-config-snapshot.json");
    const onDisk = fs.readFileSync(file, "utf8");
    expect(onDisk).not.toContain(SECRET);

    expect(() => writePluginConfigSnapshot(runId, snapshotFixture(), startOpts(root), env)).toThrow(/frozen at run start/);
    expect(fs.readFileSync(file, "utf8")).toBe(onDisk);
    for (const { value } of readLog(root, runId)) expect(JSON.stringify(value)).not.toContain(SECRET);
  });
});

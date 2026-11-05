/**
 * T01 · complete bounded trace and provenance (AT19, AT20).
 *
 * AT19 trace provenance: prompt + assignment + model request + handoff across two
 * hosts that reuse local ids. Every source/run/execution/session/goal/task/
 * attempt/instance/request join comes from the R01 records, and the requested
 * model is recorded apart from the observed one. Negative control: foreign-run
 * correlation or a missing provider id cannot fabricate observed identity.
 *
 * AT20 capture safety: a secret-bearing prompt/handoff, dropped telemetry and an
 * oversized payload. Scrubbing happens before sidecar persistence; the original
 * is not retained and the hash basis is explicit; loss counters and retention
 * make coverage incomplete; private grants never reach the export. Negative
 * control: a raw secret, a private binding file or hidden reasoning in the
 * export fails the audit.
 *
 * In-repo fixtures only: real capture per installed host is proven in V01.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  assignmentEvidencePath,
  createLogicalRun,
  recordExecutionSegment,
  recordRevision,
  recordTaskAssignment,
  recordTaskAttempt,
} from "./execution-identity";
import { TraceAuthorityRefusal, traceAuthorityFor } from "./trace-authority";
import {
  DISPATCH_CAPTURE_PATHS,
  TRACE_CAPTURE_LIMITS,
  auditTraceExport,
  expireTraceSidecar,
  openTraceCapture,
  readTrace,
  traceExportSet,
  validateTraceAnalysisV3,
  type CaptureResult,
} from "../telemetry/trace-capture-v3";

const H = (c: string) => `sha256:${c.repeat(64)}`;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const vendored = JSON.parse(fs.readFileSync(path.join(__dirname, "execution-identity.a02-cases.json"), "utf8")) as {
  cases: { id: string; schema: string; instance: any }[];
};
const base = (schema: string) => clone(vendored.cases.find((c) => c.id === `${schema}-valid`)!.instance);

const RUN = "run-20261026-000000-demo";
const OTHER_RUN = "run-20261026-000001-other";
const STACK_SESSION = "stack-session-1";
const NOW = () => new Date("2026-11-05T12:00:00Z");
const GRANT_A = "grant-private-a1";
const GRANT_B = "grant-private-b1";
const SECRET = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij";

let root: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-t01-trace-")));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function seedRun(runId = RUN): void {
  const m = base("logical-run");
  m.run_id = runId;
  m.initiative_id = "init-1";
  m.initial_prompt_ref = null;
  m.execution_refs = [];
  createLogicalRun(root, m);
  for (const [exec, host] of [["exec-a", "claude"], ["exec-b", "codex"]] as const) {
    const s = base("execution-segment");
    Object.assign(s.lineage, { run_id: runId, execution_id: exec, host_session_id: `hs-${exec}` });
    Object.assign(s, { host_session_id: `hs-${exec}`, original_host_id: host, admission: "active", seal_evidence: null });
    s.interval.end = null;
    s.interval.duration_ms = null;
    s.pins.definition = H(exec === "exec-a" ? "1" : "2");
    recordExecutionSegment(root, s, { stack_session_id: STACK_SESSION });
  }
}

function seedAttempt(exec: "exec-a" | "exec-b", attemptId: string, grant: string, goals: string[] = ["goal-1"], runId = RUN): void {
  const a = base("task-assignment");
  Object.assign(a.lineage, {
    run_id: runId, execution_id: exec, host_session_id: `hs-${exec}`, logical_task_id: "task-1",
    attempt_id: attemptId, agent_instance_id: "agent-1",
  });
  a.original_host_id = exec === "exec-a" ? "claude" : "codex";
  a.grant_id = grant;
  a.goal_contributions = goals.map((g) => {
    const [src, id] = g.includes("/") ? g.split("/") : ["source-a", g];
    return { source_id: src, kind: "goal", id, revision: H("b") };
  });
  a.input_refs = [];
  a.pins.assignment = H(exec === "exec-a" ? "3" : "4");
  recordTaskAssignment(root, a);
  const t = base("task-attempt");
  Object.assign(t.lineage, { ...a.lineage });
  t.assignment_ref = {
    ...t.assignment_ref,
    path: assignmentEvidencePath(runId, attemptId),
    sha256: recordRevision(fs.readFileSync(path.join(root, ".guild", assignmentEvidencePath(runId, attemptId)), "utf8")),
    schema_version: "guild.task_assignment.v3",
  };
  recordTaskAttempt(root, t);
}

function seed(): void {
  seedRun();
  seedAttempt("exec-a", "attempt-a1", GRANT_A);
  seedAttempt("exec-b", "attempt-b1", GRANT_B);
}

/** A host observation as the untrusted bytes a host adapter forwards. */
function obs(over: Record<string, unknown>): string {
  return JSON.stringify({
    schema_version: "guild.host_trace_observation.v1",
    host_event_id: "1",
    kind: "prompt",
    at: "2026-11-05T11:00:00Z",
    actor_id: "agent-1",
    correlation: { run_id: RUN, execution_id: "exec-a", logical_task_id: "task-1", attempt_id: "attempt-a1", agent_instance_id: "agent-1" },
    ...over,
  });
}

const captured = (r: CaptureResult) => {
  if (r.status !== "captured") throw new Error(`expected captured, got ${JSON.stringify(r)}`);
  return r.event;
};
const refusedCode = (r: CaptureResult) => (r.status === "refused" ? r.code : r.status);
const open = (exec: "exec-a" | "exec-b", limits = {}) =>
  openTraceCapture({ root, authority: traceAuthorityFor(root, RUN), execution_id: exec, now: NOW, limits });

// ── AT19 ─────────────────────────────────────────────────────────────────────

describe("AT19 · trace provenance", () => {
  it("joins prompt, model request and handoff across two hosts that reuse local ids", () => {
    seed();
    const a = open("exec-a");
    const b = open("exec-b");
    const promptA = captured(a.observe(obs({ host_event_id: "1", kind: "prompt", content: "implement the parser" })));
    const promptB = captured(b.observe(obs({
      host_event_id: "1", kind: "prompt", content: "review the parser",
      correlation: { run_id: RUN, execution_id: "exec-b", logical_task_id: "task-1", attempt_id: "attempt-b1", agent_instance_id: "agent-1" },
    })));
    const reqA = captured(a.observe(obs({
      host_event_id: "2", kind: "request_completed", requested_model: "claude-opus-4-1",
      correlation: { run_id: RUN, execution_id: "exec-a", attempt_id: "attempt-a1", logical_task_id: "task-1", agent_instance_id: "agent-1", request_id: "req-1" },
      response: { provider: "anthropic", model: "claude-sonnet-4-5", usage: { input_tokens: 60, cache_read_input_tokens: 40, cache_creation_input_tokens: 0, output_tokens: 20 } },
    })));
    const reqB = captured(b.observe(obs({
      host_event_id: "2", kind: "request_completed", requested_model: "gpt-5.6",
      correlation: { run_id: RUN, execution_id: "exec-b", attempt_id: "attempt-b1", logical_task_id: "task-1", agent_instance_id: "agent-1", request_id: "req-1" },
      response: { provider: "openai", model: "gpt-5.6-sol", usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 4 } },
    })));
    const handoff = captured(a.observe(obs({ host_event_id: "3", kind: "handoff", operation_id: "op-handoff-1", content: "handoff: parser done" })));

    for (const e of [promptA, promptB, reqA, reqB, handoff]) expect(validateTraceAnalysisV3(e)).toEqual({ ok: true });
    // Reused local ids stay distinct once source/run/execution qualified.
    expect(new Set([promptA.event_id, promptB.event_id, reqA.event_id, reqB.event_id]).size).toBe(4);
    expect(reqA.lineage).toEqual({
      source_id: "source-a", run_id: RUN, execution_id: "exec-a", host_session_id: "hs-exec-a", initiative_id: "init-1",
      goal_id: "goal-1", logical_task_id: "task-1", attempt_id: "attempt-a1", agent_instance_id: "agent-1", request_id: "req-1",
    });
    expect(reqB.lineage.execution_id).toBe("exec-b");
    expect(reqB.lineage.host_session_id).toBe("hs-exec-b");
    expect(reqB.lineage.attempt_id).toBe("attempt-b1");
    // Pins come from the R01 assignment, not from the host.
    expect(reqA.pins.assignment).toBe(H("3"));
    expect(reqB.pins.assignment).toBe(H("4"));
    expect(handoff.operation_id).toBe("op-handoff-1");
    // Requested and observed identity are recorded separately.
    expect(reqA.requested_model).toBe("claude-opus-4-1");
    expect(reqA.observed_identity).toEqual({ provider: "anthropic", model: "claude-sonnet-4-5", status: "observed", reason: null });
    expect(reqB.observed_identity.model).toBe("gpt-5.6-sol");
    // Anthropic input excludes cache; normalized input is inclusive and cache is a subset.
    expect(reqA.usage).toMatchObject({ input_inclusive: 100, cache_read_subset: 40, cache_write_subset: 0, output: 20, total: 120 });
    // OpenAI input already includes cache; reasoning is a subset of output, never added.
    expect(reqB.usage).toMatchObject({ input_inclusive: 50, cache_read_subset: 0, cache_write_subset: null, output: 10, total: 60 });
    // Unknown price stays explicit.
    expect(reqA.usage).toMatchObject({ cost_usd: null, cost_basis: "unavailable", pricing_version: null });

    const trace = readTrace(root, RUN);
    expect(trace.invalid_lines).toBe(0);
    expect(trace.events.map((e) => e.sequence)).toEqual([0, 1, 2, 3, 4]);
  });

  it("negative control: foreign-run correlation and a missing provider id cannot fabricate identity", () => {
    seed();
    const a = open("exec-a");
    expect(refusedCode(a.observe(obs({ correlation: { run_id: OTHER_RUN, execution_id: "exec-a" } })))).toBe("foreign_run");
    expect(refusedCode(a.observe(obs({ correlation: { run_id: RUN, execution_id: "exec-b" } })))).toBe("foreign_execution");
    // exec-b's attempt claimed under exec-a.
    expect(refusedCode(a.observe(obs({ correlation: { run_id: RUN, execution_id: "exec-a", attempt_id: "attempt-b1", logical_task_id: "task-1" } })))).toBe("correlation_conflict");
    expect(refusedCode(a.observe(obs({ correlation: { run_id: RUN, execution_id: "exec-a", attempt_id: "attempt-a1", logical_task_id: "task-9" } })))).toBe("correlation_conflict");
    expect(refusedCode(a.observe(obs({ correlation: { run_id: RUN, execution_id: "exec-a", host_session_id: "hs-exec-b" } })))).toBe("correlation_conflict");
    expect(refusedCode(a.observe(obs({ correlation: { run_id: RUN, execution_id: "exec-a", attempt_id: "attempt-a1", logical_task_id: "task-1", goal_id: "goal-9" } })))).toBe("correlation_conflict");

    const noProvider = captured(a.observe(obs({
      host_event_id: "5", kind: "request_completed", requested_model: "claude-opus-4-1",
      correlation: { run_id: RUN, execution_id: "exec-a", request_id: "req-5" },
      response: { model: "claude-sonnet-4-5", usage: null },
    })));
    expect(noProvider.observed_identity).toEqual({ provider: null, model: null, status: "unavailable", reason: "provider did not report provider and model" });
    expect(noProvider.requested_model).toBe("claude-opus-4-1");
    // Missing usage is not zero.
    expect(noProvider.usage).toMatchObject({ input_inclusive: null, output: null, total: null, cost_usd: null, usage_semantics: "unknown" });
    expect(noProvider.usage?.coverage.state).toBe("unavailable");

    // A request id rebinding to another attempt in the same execution conflicts.
    seedAttempt("exec-a", "attempt-a2", "grant-private-a2");
    const a2 = open("exec-a");
    expect(refusedCode(a2.observe(obs({
      host_event_id: "6", kind: "request_started",
      correlation: { run_id: RUN, execution_id: "exec-a", attempt_id: "attempt-a2", logical_task_id: "task-1", agent_instance_id: "agent-1", request_id: "req-5" },
    })))).toBe("correlation_conflict");
    // Refusals count as loss: the trace is not complete.
    expect(readTrace(root, RUN).coverage.state).not.toBe("complete");
  });

  it("an identical replay is a no-op and a conflicting replay refuses", () => {
    seed();
    const a = open("exec-a");
    const first = captured(a.observe(obs({ host_event_id: "7", content: "same" })));
    const again = a.observe(obs({ host_event_id: "7", content: "same" }));
    expect(again).toEqual({ status: "duplicate", event_id: first.event_id });
    // A second handle sees the first one's events.
    expect(open("exec-a").observe(obs({ host_event_id: "7", content: "same" })).status).toBe("duplicate");
    expect(refusedCode(a.observe(obs({ host_event_id: "7", content: "different" })))).toBe("replay_conflict");
    expect(readTrace(root, RUN).events.filter((e) => e.event_id === first.event_id)).toHaveLength(1);
  });

  it("captures every dispatch path, not only Stack launch", () => {
    seed();
    const a = open("exec-a");
    DISPATCH_CAPTURE_PATHS.forEach((backend, i) => {
      const e = captured(a.observe(obs({ host_event_id: `d${i}`, kind: "dispatch", dispatch: { backend }, content: `dispatch via ${backend}` })));
      expect(e.event_class).toBe("dispatch");
      const sidecar = JSON.parse(fs.readFileSync(path.join(root, ".guild", e.payload_ref!.path), "utf8"));
      expect(sidecar.dispatch_backend).toBe(backend);
    });
    expect(DISPATCH_CAPTURE_PATHS).toEqual(expect.arrayContaining(["agent", "cmux", "tmux", "remote", "task_cell", "stack_launch", "unknown"]));
    expect(refusedCode(a.observe(obs({ host_event_id: "dx", kind: "dispatch", dispatch: { backend: "carrier-pigeon" } })))).toBe("malformed_host_event");
  });

  it("v1 and absent runs have no v3 trace authority", () => {
    expect(() => traceAuthorityFor(root, RUN)).toThrow(TraceAuthorityRefusal);
  });
});

// ── AT20 ─────────────────────────────────────────────────────────────────────

describe("AT20 · capture safety", () => {
  it("scrubs before sidecar persistence and keeps hash semantics explicit", () => {
    seed();
    const a = open("exec-a");
    const prompt = captured(a.observe(obs({
      host_event_id: "s1", kind: "prompt",
      content: `use key ${SECRET} and password=hunter2hunter2 with grant ${GRANT_A} from /Users/alice/project`,
      reasoning: "hidden chain of thought", thinking: { text: "more hidden" },
    })));
    const handoff = captured(a.observe(obs({ host_event_id: "s2", kind: "handoff", content: `token ${SECRET}` })));
    for (const e of [prompt, handoff]) {
      const bytes = fs.readFileSync(path.join(root, ".guild", e.payload_ref!.path), "utf8");
      expect(bytes).not.toContain(SECRET);
      expect(bytes).not.toContain("hunter2hunter2");
      expect(bytes).not.toContain(GRANT_A);
      expect(bytes).not.toContain("/Users/alice");
      expect(bytes).not.toContain("chain of thought");
      expect(bytes).not.toContain("more hidden");
      const sidecar = JSON.parse(bytes);
      expect(sidecar.original_retained).toBe(false);
      expect(sidecar.hash_basis).toBe("persisted_scrubbed_utf8");
      expect(e.payload_ref!.availability).toBe("redacted");
      expect(e.payload_ref!.reason).toBeTruthy();
      expect(recordRevision(bytes)).toBe(e.payload_ref!.sha256);
    }
    const sidecar = JSON.parse(fs.readFileSync(path.join(root, ".guild", prompt.payload_ref!.path), "utf8"));
    expect(prompt.prompt_hash).toBe(recordRevision(sidecar.content));
    // Hidden reasoning is excluded, and the exclusion is counted.
    expect(prompt.capture.exclusion_reasons).toContainEqual({ code: "hidden_reasoning_excluded", count: 2 });
    expect(prompt.capture.state).toBe("complete");
    const traceBytes = fs.readFileSync(path.join(root, ".guild", "runs", RUN, "trace.jsonl"), "utf8");
    expect(traceBytes).not.toContain(SECRET);
    expect(traceBytes).not.toContain("chain of thought");
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A, GRANT_B] })).toEqual({ ok: true, findings: [] });
  });

  it("a secret in an identity field refuses the event instead of persisting it", () => {
    seed();
    const a = open("exec-a");
    expect(refusedCode(a.observe(obs({ host_event_id: "s3", kind: "request_started", requested_model: `model ${SECRET}`, correlation: { run_id: RUN, execution_id: "exec-a", request_id: "req-s3" } })))).toBe("secret_in_identity");
    expect(fs.readFileSync(path.join(root, ".guild", "runs", RUN, "trace.jsonl"), "utf8")).not.toContain(SECRET);
  });

  it("dropped telemetry, oversized payloads and retention make coverage incomplete", () => {
    seed();
    const a = open("exec-a", { max_sidecar_bytes: 64, max_host_event_bytes: 4096 });
    const ok = captured(a.observe(obs({ host_event_id: "o1", content: "short" })));
    expect(readTrace(root, RUN).coverage.state).toBe("complete");

    const big = captured(a.observe(obs({ host_event_id: "o2", content: "x".repeat(500) })));
    expect(big.capture.state).toBe("partial");
    expect(big.payload_ref!.availability).toBe("redacted");
    const bigSidecar = JSON.parse(fs.readFileSync(path.join(root, ".guild", big.payload_ref!.path), "utf8"));
    expect(bigSidecar.truncated).toBe(true);
    expect(bigSidecar.original_bytes).toBe(500);
    expect(Buffer.byteLength(bigSidecar.content, "utf8")).toBeLessThanOrEqual(64);

    expect(refusedCode(a.observe("{" + " ".repeat(5000) + "}"))).toBe("oversize_host_event");
    expect(refusedCode(a.observe("not json"))).toBe("malformed_host_event");
    expect(a.recordUpstreamLoss({ dropped: 3 }).status).toBe("captured");

    let trace = readTrace(root, RUN);
    expect(trace.coverage.state).toBe("partial");
    expect(trace.coverage.missing).toBeGreaterThanOrEqual(5);
    expect(trace.manifest.losses).toMatchObject({ oversize_host_event: 1, malformed_host_event: 1, upstream_dropped: 3, payload_truncated: 1 });
    expect(trace.events.filter((e) => e.event_class === "loss").length).toBeGreaterThanOrEqual(3);

    // A drop of unknown size makes the denominator unknown.
    a.recordUpstreamLoss({ dropped: null });
    trace = readTrace(root, RUN);
    expect(trace.coverage.eligible).toBeNull();

    // Retention: the original sidecar is gone, the safe hash stays, the drilldown is unavailable.
    expireTraceSidecar(root, RUN, ok.event_id, "retention window elapsed", NOW);
    trace = readTrace(root, RUN);
    const expired = trace.events.find((e) => e.event_id === ok.event_id)!;
    expect(expired.payload_ref!.availability).toBe("expired");
    expect(expired.payload_ref!.sha256).toBe(ok.payload_ref!.sha256);
    expect(expired.payload_ref!.reason).toBe("retention window elapsed");
    expect(trace.manifest.losses.retention_expired).toBe(1);
  });

  it("the trace is bounded: past the event cap nothing is appended and the loss is counted", () => {
    seed();
    const a = open("exec-a", { max_trace_events: 2 });
    captured(a.observe(obs({ host_event_id: "c1", content: "x" })));
    captured(a.observe(obs({ host_event_id: "c2", content: "x" })));
    expect(refusedCode(a.observe(obs({ host_event_id: "c3", content: "x" })))).toBe("trace_cap_reached");
    const trace = readTrace(root, RUN);
    expect(trace.events).toHaveLength(2);
    expect(trace.manifest.losses.trace_cap_reached).toBe(1);
    expect(trace.coverage.state).toBe("partial");
    expect(TRACE_CAPTURE_LIMITS.max_trace_events).toBeGreaterThan(2);
  });

  it("a torn trailing line from a crashed append is cut and counted, not parsed", () => {
    seed();
    const a = open("exec-a");
    captured(a.observe(obs({ host_event_id: "t1", content: "x" })));
    fs.appendFileSync(path.join(root, ".guild", "runs", RUN, "trace.jsonl"), '{"schema_version":"guild.trace.anal');
    captured(open("exec-a").observe(obs({ host_event_id: "t2", content: "x" })));
    const trace = readTrace(root, RUN);
    expect(trace.invalid_lines).toBe(0);
    expect(trace.events.map((e) => e.sequence)).toEqual([0, 1]);
    expect(trace.manifest.losses.torn_tail).toBe(1);
  });

  it("negative control: a raw secret, a private binding file or hidden reasoning in the export fails", () => {
    seed();
    const a = open("exec-a");
    const e = captured(a.observe(obs({ host_event_id: "n1", content: "clean" })));
    const set = traceExportSet(root, RUN);
    expect(set.some((p) => p.includes("lineage/"))).toBe(false);
    expect(set.some((p) => /binding/.test(p))).toBe(false);
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A] }).ok).toBe(true);

    const sidecarPath = path.join(root, ".guild", e.payload_ref!.path);
    const clean = fs.readFileSync(sidecarPath, "utf8");
    fs.writeFileSync(sidecarPath, clean.replace("clean", SECRET));
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A] }).ok).toBe(false);
    fs.writeFileSync(sidecarPath, clean.replace("clean", GRANT_A));
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A] }).ok).toBe(false);
    fs.writeFileSync(sidecarPath, clean.replace('"content"', '"reasoning":"hidden","content"'));
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A] }).ok).toBe(false);
    fs.writeFileSync(sidecarPath, clean);

    const privateFile = assignmentEvidencePath(RUN, "attempt-a1");
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A], paths: [...set, privateFile] }).ok).toBe(false);
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A], paths: [...set, `runs/${RUN}/run-binding.json`] }).ok).toBe(false);
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A] }).ok).toBe(true);
  });
});

// ── Codex round 1 regressions ────────────────────────────────────────────────

describe("T01 capture boundary regressions", () => {
  it("F1: JSON-quoted credentials are scrubbed and the audit flags them if planted", () => {
    seed();
    const e = captured(open("exec-a").observe(obs({ host_event_id: "r1", content: '{"password":"hunter2hunter2","api_key":"ordinary-private-value"}' })));
    const bytes = fs.readFileSync(path.join(root, ".guild", e.payload_ref!.path), "utf8");
    expect(bytes).not.toContain("hunter2hunter2");
    expect(bytes).not.toContain("ordinary-private-value");
    expect(e.payload_ref!.availability).toBe("redacted");
    fs.writeFileSync(path.join(root, ".guild", e.payload_ref!.path), bytes.replace("[REDACTED]", "ordinary-private-value"));
    expect(auditTraceExport(root, RUN, { private_literals: [] }).ok).toBe(false);
  });

  it("F2: a hash-shaped private literal cannot pass as an identity value", () => {
    seed();
    const hashy = H("b");
    const authority = traceAuthorityFor(root, RUN, [hashy]);
    const a = openTraceCapture({ root, authority, execution_id: "exec-a", now: NOW });
    expect(refusedCode(a.observe(obs({ host_event_id: "r2", kind: "request_started", requested_model: hashy, correlation: { run_id: RUN, execution_id: "exec-a", request_id: "req-r2" } })))).toBe("secret_in_identity");
  });

  it("F3: ids must all belong to one assignment, and its pins are used", () => {
    seed();
    seedAttempt("exec-a", "attempt-a2", "grant-private-a2", ["goal-2"]);
    // Re-seeded attempt-a2 carries agent-1 too; make a distinct instance via a fresh run.
    const a = open("exec-a");
    expect(refusedCode(a.observe(obs({ host_event_id: "r3", correlation: { run_id: RUN, execution_id: "exec-a", logical_task_id: "task-1", agent_instance_id: "agent-1", goal_id: "goal-9" } })))).toBe("correlation_conflict");
    const one = captured(a.observe(obs({ host_event_id: "r4", correlation: { run_id: RUN, execution_id: "exec-a", logical_task_id: "task-1", goal_id: "goal-2" } })));
    expect(one.lineage.attempt_id).toBeNull();
    expect(one.lineage.goal_id).toBe("goal-2");
    expect(one.pins.assignment).toBe(H("3"));
  });

  it("F4: a prompt or handoff without content is a missing payload, not complete", () => {
    seed();
    const e = captured(open("exec-a").observe(obs({ host_event_id: "r5", kind: "handoff" })));
    expect(e.capture.state).toBe("unavailable");
    expect(e.capture.missing).toBe(1);
    const trace = readTrace(root, RUN);
    expect(trace.coverage.state).not.toBe("complete");
    expect(trace.manifest.losses.payload_missing).toBe(1);
  });

  it("F5: a torn append makes coverage incomplete", () => {
    seed();
    captured(open("exec-a").observe(obs({ host_event_id: "r6", content: "x" })));
    fs.appendFileSync(path.join(root, ".guild", "runs", RUN, "trace.jsonl"), '{"torn');
    captured(open("exec-a").observe(obs({ host_event_id: "r7", content: "x" })));
    const trace = readTrace(root, RUN);
    expect(trace.coverage.state).toBe("partial");
    expect(trace.coverage.missing).toBe(1);
  });

  it("F6: overflowing usage counters become unavailable, never a thrown write", () => {
    seed();
    const e = captured(open("exec-b").observe(obs({
      host_event_id: "r8", kind: "request_completed",
      correlation: { run_id: RUN, execution_id: "exec-b", request_id: "req-r8" },
      response: { provider: "openai", model: "gpt-5.6-sol", usage: { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 } },
    })));
    expect(e.usage).toMatchObject({ input_inclusive: null, output: null, total: null });
    expect(e.usage!.coverage.state).toBe("unavailable");
  });
});

describe("T01 capture boundary regressions, round 2", () => {
  it("R2-F1: credential keys are redacted for any value type and escaped key spelling", () => {
    seed();
    const a = open("exec-a");
    for (const [id, content, raw] of [["q1", '{"password":12345678}', "12345678"], ["q2", '{"pass\\u0077ord":"hunter2hunter2"}', "hunter2hunter2"]] as const) {
      const e = captured(a.observe(obs({ host_event_id: id, content })));
      const bytes = fs.readFileSync(path.join(root, ".guild", e.payload_ref!.path), "utf8");
      expect(JSON.parse(bytes).content).not.toContain(raw);
    }
    expect(auditTraceExport(root, RUN, { private_literals: [] }).ok).toBe(true);
  });

  it("R2-F2: read-time torn tails, invalid lines and missing sidecars make coverage incomplete", () => {
    seed();
    const e = captured(open("exec-a").observe(obs({ host_event_id: "q3", content: "x" })));
    expect(readTrace(root, RUN).coverage.state).toBe("complete");
    const tracePath = path.join(root, ".guild", "runs", RUN, "trace.jsonl");
    const clean = fs.readFileSync(tracePath, "utf8");
    fs.appendFileSync(tracePath, '{"torn');
    expect(readTrace(root, RUN).coverage.state).toBe("partial");
    fs.writeFileSync(tracePath, clean + "not json\n");
    const t = readTrace(root, RUN);
    expect(t.invalid_lines).toBe(1);
    expect(t.coverage.state).toBe("partial");
    fs.writeFileSync(tracePath, clean);
    fs.rmSync(path.join(root, ".guild", e.payload_ref!.path));
    expect(readTrace(root, RUN).coverage.state).not.toBe("complete");
  });

  it("R2-F3: coverage comes from durable events, not a stale manifest", () => {
    seed();
    const a = open("exec-a");
    captured(a.observe(obs({ host_event_id: "q4", content: "x" })));
    const manifestPath = path.join(root, ".guild", "runs", RUN, "trace-capture-manifest.json");
    const stale = fs.readFileSync(manifestPath, "utf8");
    captured(a.observe(obs({ host_event_id: "q5", kind: "handoff" })));
    fs.writeFileSync(manifestPath, stale); // crash before the manifest write
    expect(open("exec-a").observe(obs({ host_event_id: "q5", kind: "handoff" })).status).toBe("duplicate");
    const t = readTrace(root, RUN);
    expect(t.coverage.state).not.toBe("complete");
    expect(t.coverage.missing).toBe(1);
  });

  it("R2-F4: the sidecar cap bounds the JSON-encoded bytes", () => {
    seed();
    const e = captured(open("exec-a", { max_sidecar_bytes: 1024 }).observe(obs({ host_event_id: "q6", content: "\u0000".repeat(4000) })));
    const sidecar = fs.readFileSync(path.join(root, ".guild", e.payload_ref!.path), "utf8");
    expect(Buffer.byteLength(JSON.stringify(JSON.parse(sidecar).content), "utf8")).toBeLessThanOrEqual(1024);
    expect(JSON.parse(sidecar).truncated).toBe(true);
    expect(e.capture.state).toBe("partial");
  });
});

describe("T01 capture boundary regressions, round 3", () => {
  const sidecarContent = (e: { payload_ref: { path: string } | null }) =>
    JSON.parse(fs.readFileSync(path.join(root, ".guild", e.payload_ref!.path), "utf8")).content as string;

  it("R3-F1: hidden reasoning inside serialized content is removed", () => {
    seed();
    const a = open("exec-a");
    const e = captured(a.observe(obs({ host_event_id: "w1", content: '{"thinking":"hidden chain text"}' })));
    expect(sidecarContent(e)).not.toContain("hidden chain text");
    const p = captured(a.observe(obs({ host_event_id: "w2", content: 'note {"reasoning":"secret plan"} end' })));
    expect(sidecarContent(p)).not.toContain("secret plan");
    expect(auditTraceExport(root, RUN, { private_literals: [] }).ok).toBe(true);
  });

  it("R3-F2: object-valued credentials in prose are redacted", () => {
    seed();
    const e = captured(open("exec-a").observe(obs({ host_event_id: "w3", content: 'Credentials: {"api_key":{"value":"ordinary-private-value"}} done' })));
    expect(sidecarContent(e)).not.toContain("ordinary-private-value");
    expect(sidecarContent(e)).toContain("done");
  });

  it("R3-F3: losses past the event cap stay in coverage", () => {
    seed();
    const a = open("exec-a", { max_trace_events: 1 });
    captured(a.observe(obs({ host_event_id: "w4", content: "x" })));
    expect(refusedCode(a.observe("not json"))).toBe("malformed_host_event");
    expect(readTrace(root, RUN).coverage.state).toBe("partial");
    a.recordUpstreamLoss({ dropped: null });
    expect(readTrace(root, RUN).coverage.eligible).toBeNull();
  });

  it("R3-F4: deeply nested serialized content is refused and counted, not thrown", () => {
    seed();
    const a = open("exec-a");
    const r = a.observe(obs({ host_event_id: "w5", content: '{"x":'.repeat(30000) + "0" + "}".repeat(30000) }));
    expect(r.status).not.toBe("duplicate");
    expect(readTrace(root, RUN).coverage.state).not.toBe("complete");
  });

  it("R3-F5: short private literals are redacted too", () => {
    seed();
    const authority = traceAuthorityFor(root, RUN, ["abc"]);
    const e = captured(openTraceCapture({ root, authority, execution_id: "exec-a", now: NOW }).observe(obs({ host_event_id: "w6", content: "use grant abc now" })));
    expect(sidecarContent(e)).not.toMatch(/\babc\b/);
    expect(auditTraceExport(root, RUN, { private_literals: ["abc"] }).ok).toBe(true);
  });
});

describe("T01 capture boundary regressions, round 4", () => {
  const sidecarContent = (e: { payload_ref: { path: string } | null }) =>
    JSON.parse(fs.readFileSync(path.join(root, ".guild", e.payload_ref!.path), "utf8")).content as string;

  it("R4-F1: unquoted keys with compound values are redacted whole", () => {
    seed();
    const e = captured(open("exec-a").observe(obs({ host_event_id: "z1", content: 'Credentials: api_key: { "value": "ordinary-private-value" } done' })));
    expect(sidecarContent(e)).not.toContain("ordinary-private-value");
    expect(sidecarContent(e)).toContain("done");
  });

  it("R4-F2: decoded string values and nested serialized JSON are scrubbed", () => {
    seed();
    const a = open("exec-a");
    const lit = captured(a.observe(obs({ host_event_id: "z2", content: '{"note":"grant-private-\\u00611"}' })));
    expect(JSON.parse(sidecarContent(lit)).note).not.toBe(GRANT_A);
    const nested = captured(a.observe(obs({ host_event_id: "z3", content: JSON.stringify({ wrapper: JSON.stringify({ thinking: "hidden chain text" }) }) })));
    expect(sidecarContent(nested)).not.toContain("hidden chain text");
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A, GRANT_B] }).ok).toBe(true);
  });

  it("R4-F3: a goal owned by another source is never attributed locally", () => {
    seedRun();
    seedAttempt("exec-a", "attempt-a1", GRANT_A, ["source-b/goal-foreign"]);
    const auth = traceAuthorityFor(root, RUN);
    expect(auth.assignments[0]!.goal_ids).toEqual([]);
  });

  it("R4-F4: a run with no capture yet reports unavailable coverage, not complete", () => {
    seed();
    const t = readTrace(root, RUN);
    expect(t.coverage.state).toBe("unavailable");
    expect(t.coverage.eligible).toBeNull();
  });
});

describe("T01 capture boundary regressions, confirm round", () => {
  const sidecarContent = (e: { payload_ref: { path: string } | null }) =>
    JSON.parse(fs.readFileSync(path.join(root, ".guild", e.payload_ref!.path), "utf8")).content as string;

  it("C-F2: serialized JSON past the inspection depth is withheld, not persisted", () => {
    seed();
    let content = JSON.stringify({ thinking: "hidden chain text" });
    for (let i = 0; i < 4; i++) content = JSON.stringify({ wrapper: content });
    const e = captured(open("exec-a").observe(obs({ host_event_id: "y1", content })));
    expect(e.payload_ref).toBeNull();
    expect(e.capture.state).toBe("unavailable");
    expect(readTrace(root, RUN).manifest.losses.payload_withheld).toBe(1);
  });

  it("C-F2: JSON fragments inside prose are decoded and scrubbed", () => {
    seed();
    const e = captured(open("exec-a").observe(obs({ host_event_id: "y2", content: 'note {"note":"grant-private-\\u00611"} end' })));
    expect(sidecarContent(e)).not.toContain("u00611");
    expect(sidecarContent(e)).toContain("end");
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A] }).ok).toBe(true);
  });
});

describe("T01 PEM private key blocks", () => {
  const sidecarContent = (e: { payload_ref: { path: string } | null }) =>
    JSON.parse(fs.readFileSync(path.join(root, ".guild", e.payload_ref!.path), "utf8")).content as string;
  const BODY = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7";
  const pem = (label: string, body = BODY) => `-----BEGIN ${label}-----\n${body}\nTAILBYTESxyz\n-----END ${label}-----`;
  const capture = (id: string, content: string) => captured(open("exec-a").observe(obs({ host_event_id: id, content })));
  const assertGone = (out: string) => {
    expect(out).not.toContain(BODY);
    expect(out).not.toContain("TAILBYTES");
    expect(out).not.toContain("BEGIN");
    expect(out).not.toMatch(/-----END/);
  };

  it("redacts a raw block whole, for every private key label", () => {
    seed();
    ["PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "OPENSSH PRIVATE KEY", "ENCRYPTED PRIVATE KEY", "PGP PRIVATE KEY BLOCK"].forEach((label, i) => {
      const out = sidecarContent(capture(`pem${i}`, `before ${pem(label)} after`));
      assertGone(out);
      expect(out).toContain("before");
      expect(out).toContain("after");
    });
    expect(auditTraceExport(root, RUN, { private_literals: [] }).ok).toBe(true);
  });

  it("redacts a block JSON-escaped inside a JSON document and inside prose", () => {
    seed();
    assertGone(sidecarContent(capture("pj1", JSON.stringify({ key: pem("RSA PRIVATE KEY"), keep: "visible" }))));
    expect(sidecarContent(capture("pj2", JSON.stringify({ key: pem("RSA PRIVATE KEY"), keep: "visible" })))).toContain("visible");
    assertGone(sidecarContent(capture("pj3", `config ${JSON.stringify({ key: pem("OPENSSH PRIVATE KEY") })} end`)));
  });

  it("a block with no END is redacted to the end of the field, never leaving the tail", () => {
    seed();
    const truncatedBlock = `-----BEGIN PRIVATE KEY-----\n${BODY}\nTAILBYTESxyz`;
    assertGone(sidecarContent(capture("pt1", `x ${truncatedBlock}`)));
    const doc = sidecarContent(capture("pt2", JSON.stringify({ key: truncatedBlock, keep: "visible" })));
    assertGone(doc);
    expect(JSON.parse(doc).keep).toBe("visible");
  });

  it("redacts two blocks in one field and keeps the text between them", () => {
    seed();
    const out = sidecarContent(capture("pd1", `${pem("RSA PRIVATE KEY")} middle ${pem("EC PRIVATE KEY")}`));
    assertGone(out);
    expect(out).toContain("middle");
    expect(out.match(/<PEM-PRIVATE-KEY-REDACTED>/g)?.length).toBe(2);
  });

  it("the export audit flags a planted PEM body", () => {
    seed();
    const e = capture("pa1", "clean");
    const p = path.join(root, ".guild", e.payload_ref!.path);
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("clean", `-----BEGIN OPENSSH PRIVATE KEY-----\\n${BODY}`));
    expect(auditTraceExport(root, RUN, { private_literals: [] }).ok).toBe(false);
  });
});

describe("T01 scrubber confirm counterexamples", () => {
  const sidecarOf = (e: { payload_ref: { path: string } | null }) =>
    JSON.parse(fs.readFileSync(path.join(root, ".guild", e.payload_ref!.path), "utf8")).content as string;

  it("a PEM block whose END label differs keeps redacting to the end of the field", () => {
    seed();
    const e = captured(open("exec-a").observe(obs({ host_event_id: "k1", content: "-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PUBLIC KEY-----\nTAILPRIVATEBYTES" })));
    expect(sidecarOf(e)).not.toContain("TAILPRIVATEBYTES");
    expect(sidecarOf(e)).not.toContain("MIIEvQ");
  });

  it("array fragments in prose are decoded and scrubbed", () => {
    seed();
    const e = captured(open("exec-a").observe(obs({ host_event_id: "k2", content: String.raw`note ["grant-private-\u00611"] end` })));
    expect(sidecarOf(e)).not.toContain("u00611");
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A] }).ok).toBe(true);
  });

  it("JSON wrapped in prose past the inspection depth is withheld", () => {
    seed();
    let content = JSON.stringify({ thinking: "hidden chain text" });
    for (let i = 0; i < 4; i++) content = JSON.stringify({ wrapper: "note " + content + " end" });
    const e = captured(open("exec-a").observe(obs({ host_event_id: "k3", content })));
    expect(e.payload_ref).toBeNull();
    expect(e.capture.state).toBe("unavailable");
  });
});

describe("T01 scrubber fragment budget", () => {
  it("content past the embedded-fragment budget is withheld, not persisted unscrubbed", () => {
    seed();
    const content = "[] ".repeat(1000) + String.raw`note {"value":"grant-private-\u00611"} end`;
    const e = captured(open("exec-a").observe(obs({ host_event_id: "b1", content })));
    expect(e.payload_ref).toBeNull();
    expect(e.capture.state).toBe("unavailable");
    expect(auditTraceExport(root, RUN, { private_literals: [GRANT_A] }).ok).toBe(true);
  });
});

import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  analyzeRun,
  compareRuns,
  resolveComparisonTarget,
  routeRecommendation,
  decideRecommendation,
  updateRecommendationStatus,
  writeRunComparison,
  writeRunAnalysis,
  withRecommendationLock,
  type RunAnalysis,
} from "../../src/modules/telemetry/workflows/run-analysis";

const RUN_A = "run-20260812-010000-alpha";
const RUN_B = "run-20260812-020000-beta";

function recommendationEnvelope(
  sourceId: string,
  scope: "plugin" | "project",
  kind: string,
  evidenceRefs: string[],
): { schema_version: "guild.recommendation.v1"; source_id: string; evidence_signature: string } {
  return {
    schema_version: "guild.recommendation.v1",
    source_id: sourceId,
    evidence_signature: crypto.createHash("sha256").update([scope, kind, ...[...evidenceRefs].sort()].join("\n")).digest("hex"),
  };
}

function seedRun(
  root: string,
  runId: string,
  opts: {
    withConfig?: boolean;
    events?: Array<Record<string, unknown>>;
    scope?: "initiative" | "independent";
    omitRunClass?: boolean;
  } = {},
): string {
  const runDir = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  const scope = opts.scope ?? "initiative";
  fs.writeFileSync(
    path.join(runDir, "run.yaml"),
    [
      "schema_version: guild.run.v1",
      `run_id: ${runId}`,
      "command: /guild:build",
      `run_scope: ${scope}`,
      `initiative_attachment: ${scope === "initiative" ? "alpha" : "null"}`,
      `independent_run_group: ${scope === "independent" ? "research" : "null"}`,
      "entry_prompt_ref: logs/payloads/entry.json",
      `config_snapshot_ref: ${opts.withConfig === false ? "null" : "plugin-config-snapshot.json"}`,
      ...(opts.omitRunClass ? [] : ["run_class: full"]),
      "status: closed",
      "started_at: 2026-08-12T01:00:00Z",
      "host:",
      "  requested: auto",
      "  resolved: codex",
      "workspace:",
      "  is_workspace: true",
      `  root: ${root}`,
      "phase: ops",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runDir, "provenance.json"),
    JSON.stringify({ schema_version: "guild.provenance.v1", run_id: runId, status: "closed" }) + "\n",
    "utf8",
  );
  if (opts.withConfig !== false) {
    fs.writeFileSync(
      path.join(runDir, "plugin-config-snapshot.json"),
      JSON.stringify({
        schema_version: "guild.plugin_config_snapshot.v1", run_id: runId, effective: {}, config_source_layers: {},
        plugin: { version: "2.6.0", ref: "sha256:plugin" },
        host_adapter: { requested: "auto", resolved: "codex", capabilities_ref: null },
        registry_hashes: { skills: null, agents: null },
        command_surface_version: "sha256:commands",
        redaction_policy: "scrubbed-config-v1",
        environment_capabilities: {},
      }) + "\n",
      "utf8",
    );
  }
  const events = opts.events ?? [
    { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:00Z", run_id: runId, lane_id: "", event_class: "prompt_received", actor_type: "lead", actor_id: "main", status: "ok", span_id: "prompt-1", prompt_hash: "hash-1", redaction: "omitted" },
    { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:01Z", run_id: runId, lane_id: "lane-a", event_class: "agent_dispatched", actor_type: "agent", actor_id: "tooling", task_id: "T1", span_id: "agent-1", status: "ok" },
    { ts: "2026-08-12T01:00:02.000Z", event: "tool_call", run_id: runId, lane_id: "lane-a", tool: "Bash", command_redacted: "npm test", status: "ok", latency_ms: 10, result_excerpt_redacted: "ok", tokens_in: 10, tokens_out: 5 },
    { ts: "2026-08-12T01:00:03.000Z", event: "phase_start", run_id: runId, phase: "execute" },
    { ts: "2026-08-12T01:00:04.000Z", event: "loop_round_start", run_id: runId, lane_id: "lane-a", loop_layer: "L3", round_number: 1, cap: 3 },
    { ts: "2026-08-12T01:00:05.000Z", event: "gate_decision", run_id: runId, gate: "gate-3-plan", decision: "approved", source: "user" },
    { schema_version: "guild.trace_event.v1", event_id: "evt-close", event_name: "run_closed", run_id: runId, at: "2026-08-12T01:00:06Z" },
  ];
  fs.writeFileSync(
    path.join(runDir, "logs", "v1.4-events.jsonl"),
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf8",
  );
  return runDir;
}

function appendRepeatedFailure(root: string, runId: string): void {
  fs.appendFileSync(path.join(root, ".guild", "runs", runId, "logs", "v1.4-events.jsonl"), [
    { ts: "2026-08-12T01:00:07.000Z", event: "tool_call", run_id: runId, lane_id: "lane-a", tool: "Bash", command_redacted: "failing command", result_excerpt_redacted: "failed", status: "err", latency_ms: 1 },
    { ts: "2026-08-12T01:00:08.000Z", event: "tool_call", run_id: runId, lane_id: "lane-a", tool: "Bash", command_redacted: "failing command", result_excerpt_redacted: "failed", status: "err", latency_ms: 1 },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n");
}

describe("run-tracing-evaluation — plugin-owned analysis", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-analysis-"));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("fails full-run analysis eligibility when the frozen config snapshot is missing", () => {
    seedRun(root, RUN_A, { withConfig: false });
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("plugin-config-snapshot.json");
    expect(analysis.assessments.instruction_following.status).toBe("unobservable");
  });

  it("rejects malformed and wrong-run config snapshots instead of counting file existence", () => {
    const dir = seedRun(root, RUN_A);
    const snapshot = path.join(dir, "plugin-config-snapshot.json");
    fs.writeFileSync(snapshot, "not json\n");
    expect(analyzeRun(root, RUN_A).eligible).toBe(false);
    fs.writeFileSync(snapshot, JSON.stringify({ schema_version: "guild.plugin_config_snapshot.v1", run_id: RUN_B, effective: {}, config_source_layers: {} }));
    expect(analyzeRun(root, RUN_A).eligible).toBe(false);
  });

  it("rejects incomplete plugin identity snapshots instead of granting full-run eligibility", () => {
    const dir = seedRun(root, RUN_A);
    fs.writeFileSync(path.join(dir, "plugin-config-snapshot.json"), JSON.stringify({
      schema_version: "guild.plugin_config_snapshot.v1", run_id: RUN_A, effective: {}, config_source_layers: {},
    }));
    expect(analyzeRun(root, RUN_A).eligible).toBe(false);
  });

  it("infers migration-safe initiative scope for old runs with only initiative_attachment", () => {
    const dir = seedRun(root, RUN_A);
    const file = path.join(dir, "run.yaml");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("run_scope: initiative\n", "").replace("independent_run_group: null\n", ""));
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.identity.run_scope).toBe("initiative");
    expect(analysis.identity.initiative_id).toBe("alpha");
    expect(analysis.eligible).toBe(true);
  });

  it("treats historical manifests without run_class as full runs", () => {
    seedRun(root, RUN_A, { withConfig: false, omitRunClass: true });
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("plugin-config-snapshot.json");
  });

  it("reports malformed trace lines as incomplete evidence", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), "{bad json\n");
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.completeness.missing).toContain("trace parseability");
    expect(analysis.findings.some((item) => item.kind === "telemetry_gap")).toBe(true);
  });

  it("produces evidence-bound deterministic findings and non-zero usage", () => {
    const repeated = [
      { ts: "2026-08-12T01:00:02.000Z", event: "tool_call", run_id: RUN_A, lane_id: "lane-a", tool: "Bash", command_redacted: "npm test", status: "err", latency_ms: 10, result_excerpt_redacted: "same failure", tokens_in: 12, tokens_out: 3 },
      { ts: "2026-08-12T01:00:03.000Z", event: "tool_call", run_id: RUN_A, lane_id: "lane-a", tool: "Bash", command_redacted: "npm test", status: "err", latency_ms: 11, result_excerpt_redacted: "same failure", tokens_in: 11, tokens_out: 4 },
    ];
    const baseDir = seedRun(root, RUN_A);
    const log = path.join(baseDir, "logs", "v1.4-events.jsonl");
    fs.appendFileSync(log, repeated.map((event) => JSON.stringify(event)).join("\n") + "\n");

    const first = analyzeRun(root, RUN_A);
    const second = analyzeRun(root, RUN_A);
    expect(first).toEqual(second);
    expect(first.eligible).toBe(true);
    expect(first.usage.llm_event_count).toBeGreaterThan(0);
    expect(first.usage.tokens.total).toBeGreaterThan(0);
    const finding = first.findings.find((item) => item.kind === "repeated_failure");
    expect(finding?.evidence_refs.length).toBeGreaterThanOrEqual(2);
    expect(first.recommendations.every((item) => item.evidence_refs.length > 0)).toBe(true);
    expect(first.recommendations.every((item) => item.routing.requires_user_approval)).toBe(true);
  });

  it("detects repeated user steering as prompt inefficiency without claiming satisfaction", () => {
    const dir = seedRun(root, RUN_A);
    const events = [1, 2].map((index) => ({
      schema_version: "guild.trace.analysis.v2",
      ts: `2026-08-12T01:00:0${index}Z`,
      run_id: RUN_A,
      lane_id: "",
      event_class: "user_steering_received",
      actor_type: "lead",
      actor_id: "main",
      status: "ok",
      prompt_hash: `sha256:${index}`,
      redaction: "omitted",
      span_id: `steer-${index}`,
      signature: "user-steering",
    }));
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.findings.some((item) => item.kind === "prompt_inefficiency")).toBe(true);
    expect(analysis.assessments.prompt_efficiency.status).toBe("ambiguous");
  });

  it("writes canonical analysis.md, analysis.json, and proposal-only recommendations", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const written = writeRunAnalysis(root, analysis);
    expect(fs.existsSync(written.json)).toBe(true);
    expect(fs.existsSync(written.markdown)).toBe(true);
    expect(fs.existsSync(written.recommendations)).toBe(true);
    expect(JSON.parse(fs.readFileSync(written.json, "utf8"))).toEqual(analysis);
    expect(fs.readFileSync(written.markdown, "utf8")).toContain("Evidence completeness");
  });

  it("refuses analysis output through a symlinked .guild/analysis directory", () => {
    seedRun(root, RUN_A);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-analysis-outside-"));
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".guild", "analysis"));
    expect(() => writeRunAnalysis(root, analyzeRun(root, RUN_A))).toThrow(/symlink|escapes/i);
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("comparison is stable under run-order changes and clusters repeated evidence", () => {
    seedRun(root, RUN_A);
    seedRun(root, RUN_B);
    const a = analyzeRun(root, RUN_A);
    const b = analyzeRun(root, RUN_B);
    expect(compareRuns([a, b])).toEqual(compareRuns([b, a]));
    expect(compareRuns([a, b]).run_ids).toEqual([RUN_A, RUN_B]);
  });

  it("excludes ineligible runs from cross-run finding clusters and recommendations", () => {
    seedRun(root, RUN_A, { withConfig: false });
    seedRun(root, RUN_B, { withConfig: false });
    const comparison = compareRuns([analyzeRun(root, RUN_A), analyzeRun(root, RUN_B)]);
    expect(comparison.completeness.eligible_runs).toBe(0);
    expect(comparison.repeated_signatures).toEqual([]);
    expect(comparison.recommendations).toEqual([]);
  });

  it("deduplicates legacy tool usage and its semantic twin by span_id", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), [
      JSON.stringify({ ts: "2026-08-12T01:00:07.000Z", event: "tool_call", run_id: RUN_A, lane_id: "lane-a", tool: "Agent", command_redacted: "dispatch tooling", result_excerpt_redacted: "ok", status: "ok", span_id: "same-span", latency_ms: 20, tokens_in: 7, tokens_out: 3 }),
      JSON.stringify({ schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:07Z", run_id: RUN_A, lane_id: "lane-a", event_class: "tool_call_finished", actor_type: "tool", actor_id: "Agent", status: "ok", span_id: "same-span", duration_ms: 20, tokens: { input: 7, output: 3 } }),
    ].join("\n") + "\n");
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.usage.tokens.total).toBe(25);
    expect(analysis.usage.duration_ms).toBe(30);
  });

  it("rejects invalid and cross-run trace rows from evidence and eligibility", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), [
      JSON.stringify({ schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:08Z", run_id: RUN_B, lane_id: "", event_class: "prompt_received", actor_type: "user", actor_id: "foreign", status: "ok", span_id: "foreign", prompt_hash: "hash", redaction: "omitted" }),
      JSON.stringify({ schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:09Z", run_id: RUN_A, lane_id: "", event_class: "gate_concluded", actor_type: "system", actor_id: "bad", status: "ok" }),
    ].join("\n") + "\n");
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
    expect(analysis.usage.specialists_dispatched).not.toContain("foreign");
  });

  it("does not let a malformed legacy row supply missing phase evidence", () => {
    const dir = seedRun(root, RUN_A);
    const log = path.join(dir, "logs", "v1.4-events.jsonl");
    const withoutPhase = fs.readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event["event"] !== "phase_start");
    withoutPhase.push({ run_id: RUN_A, event: "phase_start" });
    fs.writeFileSync(log, withoutPhase.map((event) => JSON.stringify(event)).join("\n") + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
    expect(analysis.completeness.missing).toContain("phase");
  });

  it("does not let a lifecycle row smuggle conflicting loop evidence", () => {
    const dir = seedRun(root, RUN_A);
    const log = path.join(dir, "logs", "v1.4-events.jsonl");
    const withoutLoop = fs.readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event["event"] !== "loop_round_start");
    withoutLoop.push({
      schema_version: "guild.trace_event.v1",
      event_id: "evt-smuggled-loop",
      event_name: "run_closed",
      run_id: RUN_A,
      at: "2026-08-12T01:00:06Z",
      ts: "2026-08-12T01:00:06.000Z",
      event: "loop_round_start",
      tool: "",
      specialist: "",
      payload_digest: "sha256:smuggled-loop",
      ok: true,
      ms: 0,
      loop_layer: "L1",
      loop_round: 1,
    });
    fs.writeFileSync(log, withoutLoop.map((event) => JSON.stringify(event)).join("\n") + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
    expect(analysis.completeness.missing).toContain("loop");
  });

  it("does not let a typed trace row fall through to a conflicting legacy category", () => {
    const dir = seedRun(root, RUN_A);
    const log = path.join(dir, "logs", "v1.4-events.jsonl");
    const withoutLoop = fs.readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event["event"] !== "loop_round_start");
    withoutLoop.push({
      schema_version: "guild.trace.degradation.v1",
      ts: "2026-08-12T01:00:04Z",
      run_id: RUN_A,
      lane_id: "",
      surface: "hook",
      reason: "fallback",
      attempted: "native",
      fallback: "degraded",
      severity: "warn",
      event: "loop_round_start",
    });
    fs.writeFileSync(log, withoutLoop.map((event) => JSON.stringify(event)).join("\n") + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
    expect(analysis.completeness.missing).toContain("loop");
  });

  it("does not let a non-string schema marker enter legacy categorization", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      schema_version: 7,
      ts: "2026-08-12T01:00:07.000Z",
      event: "loop_round_start",
      run_id: RUN_A,
      lane_id: "lane-a",
      loop_layer: "L1",
      round_number: 1,
      cap: 5,
    }) + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
  });

  it("rejects a legacy degradation row whose payload kind does not match", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      schema_version: "guild.trace_event.v1",
      event_type: "feature_degraded",
      kind: "feature_degraded",
      run_id: RUN_A,
      ts: "2026-08-12T01:00:07Z",
      degradation: {},
    }) + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
  });

  it("accepts schema-valid nullable fields through the typed trace validator", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      schema_version: "guild.trace.model_inspection.v1",
      ts: "2026-08-12T01:00:07Z",
      run_id: RUN_A,
      lane_id: "",
      host_family: "codex",
      host_surface: "cli",
      identity_trust: "verified",
      catalog_state: "absent",
      selection_model: null,
      actual_model: "unknown",
      independence: "none_written",
      unknowns_count: 1,
    }) + "\n");

    expect(analyzeRun(root, RUN_A).eligible).toBe(true);
  });

  it("counts valid-JSON non-object trace rows as invalid instead of silently dropping them", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), "[]\n42\nnull\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
  });

  it("accepts a valid run-file-scoped hook mirror without inventing a cross-run failure", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      ts: "2026-08-12T01:00:07.000Z",
      event: "UserPromptSubmit",
      tool: "",
      specialist: "",
      payload_digest: "sha256:prompt",
      ok: true,
      ms: 3,
    }) + "\n");

    expect(analyzeRun(root, RUN_A).eligible).toBe(true);
  });

  it("accepts the production loop and codex hook mirrors emitted by capture-telemetry", () => {
    const dir = seedRun(root, RUN_A);
    const common = { tool: "", specialist: "", ok: true, ms: 3 };
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), [
      { ...common, ts: "2026-08-12T01:00:07.000Z", event: "loop_round_start", payload_digest: "sha256:loop-start", loop_layer: "L1", loop_round: 1, span_id: "hook-loop-start" },
      { ...common, ts: "2026-08-12T01:00:08.000Z", event: "loop_round_end", payload_digest: "sha256:loop-end", loop_layer: "L1", loop_round: 1, loop_terminated: true, span_id: "hook-loop-end" },
      { ...common, ts: "2026-08-12T01:00:09.000Z", event: "codex_review_round", payload_digest: "sha256:codex", loop_gate: "G-spec", loop_round: 1, loop_terminated: true, span_id: "hook-codex" },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n");

    expect(analyzeRun(root, RUN_A).eligible).toBe(true);
  });

  it("rejects a malformed production loop hook mirror", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      ts: "2026-08-12T01:00:07.000Z",
      event: "loop_round_start",
      tool: "",
      specialist: "",
      payload_digest: "sha256:loop",
      ok: true,
      ms: 3,
      loop_layer: "L1",
    }) + "\n");

    expect(analyzeRun(root, RUN_A).eligible).toBe(false);
  });

  it("never treats a run-bound loop row as an implicit hook mirror", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      ts: "2026-08-12T01:00:07.000Z",
      event: "loop_round_start",
      run_id: RUN_A,
      tool: "",
      specialist: "",
      payload_digest: "sha256:discriminator",
      ok: true,
      ms: 3,
      loop_layer: "L1",
      loop_round: 1,
    }) + "\n");

    expect(analyzeRun(root, RUN_A).eligible).toBe(false);
  });

  it("deduplicates a hook mirror and its semantic twin by span_id", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), [
      { ts: "2026-08-12T01:00:07.000Z", event: "SubagentStop", tool: "", specialist: "tooling", payload_digest: "sha256:response", ok: true, ms: 20, span_id: "same-hook-span", tokens: { input: 7, output: 3 } },
      { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:07Z", run_id: RUN_A, lane_id: "lane-a", event_class: "agent_response_received", actor_type: "agent", actor_id: "tooling", status: "ok", span_id: "same-hook-span", duration_ms: 20, tokens: { input: 7, output: 3 } },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.usage.tokens.total).toBe(25);
    expect(analysis.usage.duration_ms).toBe(30);
  });

  it("rejects a malformed hook mirror instead of trusting its event name", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      event: "UserPromptSubmit",
      prompt: "approve",
    }) + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
  });

  it("writes discoverable comparison artifacts and a stable comparison index", () => {
    seedRun(root, RUN_A);
    seedRun(root, RUN_B);
    const comparison = compareRuns([analyzeRun(root, RUN_A), analyzeRun(root, RUN_B)]);
    const written = writeRunComparison(root, comparison);
    expect(fs.existsSync(written.json)).toBe(true);
    expect(fs.existsSync(written.markdown)).toBe(true);
    expect(fs.existsSync(written.recommendations)).toBe(true);
    const index = JSON.parse(fs.readFileSync(written.index, "utf8"));
    expect(index.comparisons).toEqual([
      expect.objectContaining({ comparison_id: comparison.comparison_id, run_ids: [RUN_A, RUN_B] }),
    ]);
  });

  it("resolves initiative and independent-group targets from run manifests", () => {
    seedRun(root, RUN_A, { scope: "initiative" });
    seedRun(root, RUN_B, { scope: "independent" });
    expect(resolveComparisonTarget(root, { kind: "initiative", id: "alpha" }).map((item) => item.run_id)).toEqual([RUN_A]);
    expect(resolveComparisonTarget(root, { kind: "independent", id: "research" }).map((item) => item.run_id)).toEqual([RUN_B]);
  });

  it("does not let a corrupt unrelated run poison a targeted comparison", () => {
    seedRun(root, RUN_A, { scope: "initiative" });
    const corrupt = path.join(root, ".guild", "runs", "run-20260812-030000-corrupt");
    fs.mkdirSync(corrupt, { recursive: true });
    fs.writeFileSync(path.join(corrupt, "run.yaml"), "run_scope: [unterminated\n");
    expect(resolveComparisonTarget(root, { kind: "initiative", id: "alpha" }).map((item) => item.run_id)).toEqual([RUN_A]);
  });

  it("routes plugin recommendations behind approval and project recommendations to a proposal queue", () => {
    const base = {
      id: "rec-1",
      source_analysis_id: `analysis:${RUN_A}`,
      confidence: "high" as const,
      severity: "medium" as const,
      evidence_refs: [`.guild/runs/${RUN_A}/logs/v1.4-events.jsonl#line:1`],
      affected_runs: [RUN_A],
      status: "proposed" as const,
    };
    expect(routeRecommendation({ ...base, scope: "plugin", kind: "telemetry_gap", proposed_action: "add event" }).action).toBe("ask_user_before_filing");
    expect(routeRecommendation({ ...base, scope: "project", kind: "create_skill", proposed_action: "draft skill" }).action).toBe("queue_proposal_only");
  });

  it("writes only project-scoped recommendations to an idempotent proposal queue", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    analysis.recommendations = [
      {
        ...recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/run.yaml`]),
        id: "rec-project", source_analysis_id: analysis.analysis_id, scope: "project", kind: "create_skill",
        confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
        proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only",
        requires_user_approval: true, status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
      },
      {
        ...recommendationEnvelope(RUN_A, "plugin", "telemetry_gap", [`.guild/runs/${RUN_A}/run.yaml`]),
        id: "rec-plugin", source_analysis_id: analysis.analysis_id, scope: "plugin", kind: "telemetry_gap",
        confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
        proposed_action: "Draft a Guild issue.", suggested_owner: "guild-plugin", next_action: "ask_user_before_filing",
        requires_user_approval: true, status: "proposed", routing: { action: "ask_user_before_filing", requires_user_approval: true, target: "guild-plugin" },
      },
    ];
    writeRunAnalysis(root, analysis);
    writeRunAnalysis(root, analysis);
    const queue = fs.readFileSync(path.join(root, ".guild", "recommendations", "queue.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(queue).toEqual([expect.objectContaining({ id: "rec-project", scope: "project", status: "proposed" })]);
  });

  it("preserves recorded decisions across regeneration and de-duplicates by evidence signature", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence),
      id: "rec-project-first", source_analysis_id: analysis.analysis_id, scope: "project", kind: "create_skill",
      confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only",
      requires_user_approval: true, status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    decideRecommendation(root, RUN_A, "rec-project-first", "accept");

    analysis.recommendations = [{ ...analysis.recommendations[0], id: "rec-project-regenerated", status: "proposed" }];
    const written = writeRunAnalysis(root, analysis);
    const queue = fs.readFileSync(path.join(root, ".guild", "recommendations", "queue.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const source = fs.readFileSync(path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(queue).toEqual([expect.objectContaining({ id: "rec-project-regenerated", status: "queued" })]);
    expect(source).toEqual([expect.objectContaining({ id: "rec-project-regenerated", status: "queued" })]);
    expect(JSON.parse(fs.readFileSync(written.json, "utf8")).recommendations[0].status).toBe("queued");
    const activity = fs.readFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(activity).toContainEqual(expect.objectContaining({
      effect: "status_migrated", previous_recommendation_id: "rec-project-first", recommendation_id: "rec-project-regenerated",
    }));
  });

  it("audits a regenerated analysis identity for the same run and stable recommendation id", () => {
    seedRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    const first = analyzeRun(root, RUN_A);
    first.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence), id: "rec-stable", source_analysis_id: first.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }, {
      ...recommendationEnvelope(RUN_A, "project", "update_workflow", [`.guild/runs/${RUN_A}/provenance.json`]), id: "rec-stable-two", source_analysis_id: first.analysis_id,
      scope: "project", kind: "update_workflow", confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/provenance.json`], affected_runs: [RUN_A],
      proposed_action: "Update a project workflow.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, first);
    decideRecommendation(root, RUN_A, "rec-stable", "accept");
    decideRecommendation(root, RUN_A, "rec-stable-two", "accept");

    fs.appendFileSync(path.join(root, ".guild", "runs", RUN_A, "logs", "v1.4-events.jsonl"),
      JSON.stringify({ ts: "2026-08-12T01:00:09.000Z", event: "phase_start", run_id: RUN_A, phase: "review" }) + "\n");
    const regenerated = analyzeRun(root, RUN_A);
    expect(regenerated.analysis_id).not.toBe(first.analysis_id);
    regenerated.recommendations = first.recommendations.map((item) => ({ ...item, source_analysis_id: regenerated.analysis_id, status: "proposed" }));
    writeRunAnalysis(root, regenerated);

    const source = fs.readFileSync(path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(source).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "rec-stable", source_analysis_id: regenerated.analysis_id, status: "queued" }),
      expect.objectContaining({ id: "rec-stable-two", source_analysis_id: regenerated.analysis_id, status: "queued" }),
    ]));
    const activity = fs.readFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(activity).toContainEqual(expect.objectContaining({
      effect: "status_migrated", source_id: RUN_A, source_analysis_id: regenerated.analysis_id,
      previous_source_id: RUN_A, previous_source_analysis_id: first.analysis_id,
    }));
  });

  it("carries progressed decisions when regeneration changes signature or removes the detector output", () => {
    seedRun(root, RUN_A);
    const first = analyzeRun(root, RUN_A);
    const oldEvidence = [`.guild/runs/${RUN_A}/run.yaml`];
    first.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", oldEvidence), id: "rec-durable", source_analysis_id: first.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: oldEvidence, affected_runs: [RUN_A],
      proposed_action: "Draft the durable skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, first);
    decideRecommendation(root, RUN_A, "rec-durable", "accept");

    fs.appendFileSync(path.join(root, ".guild", "runs", RUN_A, "logs", "v1.4-events.jsonl"),
      JSON.stringify({ ts: "2026-08-12T01:00:09.000Z", event: "phase_start", run_id: RUN_A, phase: "review" }) + "\n");
    const changed = analyzeRun(root, RUN_A);
    const newEvidence = [`.guild/runs/${RUN_A}/provenance.json`];
    changed.recommendations = [{
      ...first.recommendations[0],
      ...recommendationEnvelope(RUN_A, "project", "update_workflow", newEvidence),
      id: "rec-new-detector", source_analysis_id: changed.analysis_id, kind: "update_workflow",
      evidence_refs: newEvidence, proposed_action: "Update the newly detected workflow.", status: "proposed",
    }];
    writeRunAnalysis(root, changed);
    let source = fs.readFileSync(path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(source).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "rec-durable", source_analysis_id: changed.analysis_id, status: "queued" }),
      expect.objectContaining({ id: "rec-new-detector", source_analysis_id: changed.analysis_id, status: "proposed" }),
    ]));

    fs.appendFileSync(path.join(root, ".guild", "runs", RUN_A, "logs", "v1.4-events.jsonl"),
      JSON.stringify({ ts: "2026-08-12T01:00:10.000Z", event: "phase_end", run_id: RUN_A, phase: "review", outcome: "pass" }) + "\n");
    const disappeared = analyzeRun(root, RUN_A);
    disappeared.recommendations = [];
    writeRunAnalysis(root, disappeared);
    source = fs.readFileSync(path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(source).toEqual([expect.objectContaining({
      id: "rec-durable", source_analysis_id: disappeared.analysis_id, status: "queued",
    })]);
    expect(() => writeRunAnalysis(root, disappeared)).not.toThrow();
  });

  it("fails closed on malformed or symlink-escaped recommendation sources", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/run.yaml`]),
      id: "rec-project", source_analysis_id: analysis.analysis_id, scope: "project", kind: "create_skill",
      confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only",
      requires_user_approval: true, status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    const source = path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`);
    fs.writeFileSync(source, "{}\n");
    expect(() => decideRecommendation(root, RUN_A, "rec-project", "accept")).toThrow(/schema_version|\.id must be one safe path component/);

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rec-outside-"));
    const outside = path.join(outsideDir, "outside.jsonl");
    fs.writeFileSync(outside, JSON.stringify(analysis.recommendations[0]) + "\n");
    fs.unlinkSync(source);
    fs.symlinkSync(outside, source);
    try {
      expect(() => decideRecommendation(root, RUN_A, "rec-project", "accept")).toThrow(/not a contained regular file/);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("records user decisions without auto-filing or mutating project capabilities", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    analysis.recommendations = [
      {
        ...recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/run.yaml`]),
        id: "rec-project", source_analysis_id: analysis.analysis_id, scope: "project", kind: "create_skill",
        confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
        proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only",
        requires_user_approval: true, status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
      },
      {
        ...recommendationEnvelope(RUN_A, "plugin", "telemetry_gap", [`.guild/runs/${RUN_A}/run.yaml`]),
        id: "rec-plugin", source_analysis_id: analysis.analysis_id, scope: "plugin", kind: "telemetry_gap",
        confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
        proposed_action: "Draft a Guild issue.", suggested_owner: "guild-plugin", next_action: "ask_user_before_filing",
        requires_user_approval: true, status: "proposed", routing: { action: "ask_user_before_filing", requires_user_approval: true, target: "guild-plugin" },
      },
    ];
    writeRunAnalysis(root, analysis);
    expect(decideRecommendation(root, RUN_A, "rec-project", "accept")).toMatchObject({ status: "queued", effect: "project_proposal_queued" });
    expect(decideRecommendation(root, RUN_A, "rec-plugin", "accept")).toMatchObject({ status: "accepted", effect: "plugin_draft_written" });
    expect(fs.existsSync(path.join(root, ".guild", "recommendations", "drafts", "rec-plugin.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".guild", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".guild", "agents"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".git"))).toBe(false);
  });

  it("supports explicit audited status transitions and rejects unsafe ids", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/run.yaml`]),
      id: "rec-project", source_analysis_id: analysis.analysis_id, scope: "project", kind: "create_skill",
      confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only",
      requires_user_approval: true, status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    expect(() => updateRecommendationStatus(root, RUN_A, "rec-project", "implemented")).toThrow(/transition|approval/i);
    decideRecommendation(root, RUN_A, "rec-project", "accept");
    expect(() => updateRecommendationStatus(root, RUN_A, "rec-project", "filed")).toThrow(/scope|transition/i);
    expect(updateRecommendationStatus(root, RUN_A, "rec-project", "implemented")).toMatchObject({ status: "implemented" });
    expect(() => decideRecommendation(root, "../escape", "rec-project", "accept")).toThrow(/safe path component/);
  });

  it("persists a strict standalone recommendation schema and rejects invalid runtime scope", () => {
    seedRun(root, RUN_A);
    appendRepeatedFailure(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.recommendations.length).toBeGreaterThan(0);
    expect(analysis.recommendations[0]).toMatchObject({
      schema_version: "guild.recommendation.v1",
      source_id: RUN_A,
      evidence_signature: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(() => routeRecommendation({ scope: "outside" as never })).toThrow(/scope/i);
  });

  it("fails before status mutation when activity history is malformed or escaped", () => {
    seedRun(root, RUN_A);
    appendRepeatedFailure(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    analysis.recommendations = [{
      ...analysis.recommendations[0], id: "rec-project", source_id: RUN_A, scope: "project", kind: "create_skill",
      ...recommendationEnvelope(RUN_A, "project", "create_skill", analysis.recommendations[0].evidence_refs),
      suggested_owner: "project", next_action: "queue_proposal_only",
      routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    const source = path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`);
    const before = fs.readFileSync(source, "utf8");
    const activity = path.join(root, ".guild", "recommendations", "activity.jsonl");
    fs.writeFileSync(activity, "{}\n");
    expect(() => decideRecommendation(root, RUN_A, "rec-project", "accept")).toThrow(/activity/i);
    expect(fs.readFileSync(source, "utf8")).toBe(before);

    fs.unlinkSync(activity);
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activity-outside-"));
    const outside = path.join(outsideDir, "activity.jsonl");
    fs.writeFileSync(outside, "");
    fs.symlinkSync(outside, activity);
    try {
      expect(() => decideRecommendation(root, RUN_A, "rec-project", "accept")).toThrow(/activity|contained/i);
      expect(fs.readFileSync(source, "utf8")).toBe(before);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects pre-existing duplicate evidence signatures instead of inheriting by file order", () => {
    seedRun(root, RUN_A);
    appendRepeatedFailure(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const base = {
      ...analysis.recommendations[0], source_id: RUN_A, scope: "project" as const, kind: "create_skill" as const,
      ...recommendationEnvelope(RUN_A, "project", "create_skill", analysis.recommendations[0].evidence_refs),
      suggested_owner: "project" as const, next_action: "queue_proposal_only" as const,
      routing: { action: "queue_proposal_only" as const, requires_user_approval: true as const, target: "project-local" as const },
    };
    analysis.recommendations = [{ ...base, id: "rec-first" }];
    writeRunAnalysis(root, analysis);
    const queue = path.join(root, ".guild", "recommendations", "queue.jsonl");
    fs.writeFileSync(queue, [
      JSON.stringify({ ...base, id: "rec-first", status: "queued" }),
      JSON.stringify({ ...base, id: "rec-second", status: "rejected" }),
    ].join("\n") + "\n");
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/duplicate evidence signature/i);
  });

  it("preserves plugin approval across a regenerated comparison source id", () => {
    seedRun(root, RUN_A);
    seedRun(root, RUN_B);
    appendRepeatedFailure(root, RUN_A);
    const first = compareRuns([analyzeRun(root, RUN_A), analyzeRun(root, RUN_B)]);
    const base = analyzeRun(root, RUN_A).recommendations[0];
    first.recommendations = [{
      ...base, id: "rec-plugin-stable", source_id: first.comparison_id, source_analysis_id: first.comparison_id,
      scope: "plugin", kind: "telemetry_gap", suggested_owner: "guild-plugin", next_action: "ask_user_before_filing",
      routing: { action: "ask_user_before_filing", requires_user_approval: true, target: "guild-plugin" },
      affected_runs: [RUN_A, RUN_B], evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`, `.guild/runs/${RUN_B}/run.yaml`],
      ...recommendationEnvelope(first.comparison_id, "plugin", "telemetry_gap", [`.guild/runs/${RUN_A}/run.yaml`, `.guild/runs/${RUN_B}/run.yaml`]),
    }];
    writeRunComparison(root, first);
    decideRecommendation(root, first.comparison_id, "rec-plugin-stable", "accept");

    const regenerated = { ...first, comparison_id: "comparison-regenerated", source_hashes: first.source_hashes.map((hash) => `${hash}-new`) };
    regenerated.recommendations = [{ ...first.recommendations[0], source_id: regenerated.comparison_id, source_analysis_id: regenerated.comparison_id, status: "proposed" }];
    const written = writeRunComparison(root, regenerated);
    const record = JSON.parse(fs.readFileSync(written.recommendations, "utf8").trim());
    expect(record.status).toBe("accepted");
    const activity = fs.readFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(activity).toContainEqual(expect.objectContaining({
      effect: "status_migrated",
      source_id: regenerated.comparison_id,
      previous_source_id: first.comparison_id,
      previous_recommendation_id: "rec-plugin-stable",
      recommendation_id: "rec-plugin-stable",
    }));
  });

  it("rejects symlinked run inputs that escape the project", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-input-outside-"));
    seedRun(outside, RUN_A);
    fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
    fs.symlinkSync(path.join(outside, ".guild", "runs", RUN_A), path.join(root, ".guild", "runs", RUN_A));
    try {
      expect(() => analyzeRun(root, RUN_A)).toThrow(/symlink|contained|escapes/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each(["run.yaml", "provenance.json", path.join("logs", "v1.4-events.jsonl")])(
    "rejects a nested symlinked run input: %s",
    (relative) => {
      const attackRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-nested-run-input-"));
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-nested-run-outside-"));
      const dir = seedRun(attackRoot, RUN_A);
      const target = path.join(dir, relative);
      const external = path.join(outside, path.basename(relative));
      fs.copyFileSync(target, external);
      fs.unlinkSync(target);
      fs.symlinkSync(external, target);
      try {
        expect(() => analyzeRun(attackRoot, RUN_A)).toThrow(/symlink|contained|escapes/i);
      } finally {
        fs.rmSync(attackRoot, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it("rejects pre-progressed, cross-bound, missing-evidence, and duplicate generated recommendations", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const base = {
      ...recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/run.yaml`]),
      id: "rec-generated", source_analysis_id: analysis.analysis_id, scope: "project" as const, kind: "create_skill" as const,
      confidence: "high" as const, severity: "medium" as const, evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project" as const, next_action: "queue_proposal_only" as const,
      requires_user_approval: true as const, status: "proposed" as const,
      routing: { action: "queue_proposal_only" as const, requires_user_approval: true as const, target: "project-local" as const },
    };
    analysis.recommendations = [{ ...base, status: "implemented" }];
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/proposed|transition/i);
    analysis.recommendations = [{ ...base, source_id: RUN_B }];
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/source_id|bound/i);
    analysis.recommendations = [{ ...base, evidence_refs: [`.guild/runs/${RUN_A}/missing.json`], evidence_signature: recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/missing.json`]).evidence_signature }];
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/evidence|regular file|exist/i);
    analysis.recommendations = [{ ...base, id: "rec-first" }, { ...base, id: "rec-second" }];
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/duplicate evidence signature/i);
  });

  it("rejects semantically unauthorized activity before regeneration", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence), id: "rec-project", source_analysis_id: analysis.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    fs.writeFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), JSON.stringify({
      schema_version: "guild.recommendation_activity.v1", activity_id: "activity-forged", at: "2026-08-12T01:00:00Z",
      source_id: RUN_A, source_analysis_id: analysis.analysis_id, recommendation_id: "rec-project", evidence_signature: analysis.recommendations[0].evidence_signature,
      scope: "project", from_status: "proposed", to_status: "implemented", effect: "status_recorded",
    }) + "\n");
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/activity|transition|source_analysis/i);
  });

  it("rejects a shaped activity promotion that no persisted source or queue state corroborates", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence), id: "rec-forged", source_analysis_id: analysis.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    fs.writeFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), JSON.stringify({
      schema_version: "guild.recommendation_activity.v1", activity_id: "activity-shaped-forgery", at: "2026-08-12T01:00:00Z",
      source_id: RUN_A, source_analysis_id: analysis.analysis_id, recommendation_id: "rec-forged",
      evidence_signature: analysis.recommendations[0].evidence_signature, scope: "project",
      from_status: "proposed", to_status: "queued", effect: "project_proposal_queued",
    }) + "\n");
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/corroborated|persisted|activity/i);
  });

  it("rejects activity corroboration from a persisted record with a different identity", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence), id: "rec-identity-bound", source_analysis_id: analysis.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    const mismatched = {
      ...analysis.recommendations[0],
      id: "rec-different-identity",
      source_id: RUN_B,
      source_analysis_id: "analysis-different-identity",
      status: "queued" as const,
    };
    fs.writeFileSync(path.join(root, ".guild", "recommendations", "queue.jsonl"), JSON.stringify(mismatched) + "\n");
    fs.writeFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), JSON.stringify({
      schema_version: "guild.recommendation_activity.v1", activity_id: "activity-identity-mismatch", at: "2026-08-12T01:00:00Z",
      source_id: RUN_A, source_analysis_id: analysis.analysis_id, recommendation_id: "rec-identity-bound",
      evidence_signature: analysis.recommendations[0].evidence_signature, scope: "project",
      from_status: "proposed", to_status: "queued", effect: "project_proposal_queued",
    }) + "\n");
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/identity|corroborated|persisted/i);
  });

  it("recovers an interrupted multi-file transaction before the next writer runs", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const written = writeRunAnalysis(root, analysis);
    const previous = fs.readFileSync(written.json, "utf8");
    fs.writeFileSync(written.json, "partial write\n");
    const journal = path.join(root, ".guild", "recommendations", ".transaction.json");
    fs.writeFileSync(journal, JSON.stringify({
      schema_version: "guild.recommendation_transaction.v1",
      transaction_id: "transaction-interrupted",
      files: [{ path: path.relative(root, written.json), previous }],
    }) + "\n");
    fs.writeFileSync(path.join(root, ".guild", "recommendations", ".write.lock"), JSON.stringify({
      schema_version: "guild.recommendation_lock.v1", pid: 99999999, created_at: "2026-08-12T01:00:00Z",
    }) + "\n");
    expect(() => decideRecommendation(root, RUN_A, "missing-recommendation", "accept")).toThrow(/not found/i);
    expect(fs.readFileSync(written.json, "utf8")).toBe(previous);
    expect(fs.existsSync(journal)).toBe(false);
  });

  it("refuses a crafted recovery journal that targets project capabilities", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    writeRunAnalysis(root, analysis);
    const injected = path.join(root, ".guild", "skills", "injected.md");
    const journal = path.join(root, ".guild", "recommendations", ".transaction.json");
    fs.writeFileSync(journal, JSON.stringify({
      schema_version: "guild.recommendation_transaction.v1",
      transaction_id: "transaction-capability-escape",
      files: [{ path: path.relative(root, injected), previous: "malicious capability\n" }],
    }) + "\n");
    fs.writeFileSync(path.join(root, ".guild", "recommendations", ".write.lock"), JSON.stringify({
      schema_version: "guild.recommendation_lock.v1", pid: 99999999, created_at: "2026-08-12T01:00:00Z",
    }) + "\n");
    expect(() => decideRecommendation(root, RUN_A, "missing-recommendation", "accept")).toThrow(/analyzer-owned|transaction target/i);
    expect(fs.existsSync(injected)).toBe(false);
    expect(fs.existsSync(journal)).toBe(true);
  });

  it("admits only one writer during concurrent stale-lock recovery", async () => {
    const recommendations = path.join(root, ".guild", "recommendations");
    fs.mkdirSync(recommendations, { recursive: true });
    fs.writeFileSync(path.join(recommendations, ".write.lock"), JSON.stringify({
      schema_version: "guild.recommendation_lock.v1", pid: 99999999, created_at: "2026-08-12T01:00:00Z",
    }) + "\n");
    const marker = path.join(root, "writers.txt");
    const moduleUrl = pathToFileURL(path.resolve(__dirname, "../../src/modules/telemetry/workflows/run-analysis.ts")).href;
    const script = `
      import fs from "node:fs";
      import runAnalysis from ${JSON.stringify(moduleUrl)};
      const { withRecommendationLock } = runAnalysis;
      try {
        withRecommendationLock(${JSON.stringify(root)}, () => {
          fs.appendFileSync(${JSON.stringify(marker)}, process.pid + "\\n");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
        });
      } catch (error) {
        process.stderr.write(String(error));
        process.exitCode = 2;
      }
    `;
    const launch = (): Promise<{ code: number | null; stderr: string }> => new Promise((resolve) => {
      const child = spawn(process.execPath, ["--import", require.resolve("tsx"), "--input-type=module", "-e", script], {
        cwd: path.resolve(__dirname, ".."),
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolve({ code, stderr }));
    });
    const results = await Promise.all([launch(), launch()]);
    expect(results.filter((result) => result.code === 0)).toHaveLength(1);
    expect(results.filter((result) => result.code === 2)).toHaveLength(1);
    expect(results.find((result) => result.code === 2)?.stderr).toMatch(/lock|recovery/i);
    expect(fs.readFileSync(marker, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("does not delete a replacement recovery claim during stale-lock cleanup", () => {
    const recommendations = path.join(root, ".guild", "recommendations");
    const lock = path.join(recommendations, ".write.lock");
    const recovery = path.join(recommendations, ".write.lock.recovery");
    fs.mkdirSync(recommendations, { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({
      schema_version: "guild.recommendation_lock.v1", pid: 99999999, created_at: "2026-08-12T01:00:00Z",
    }) + "\n");
    const originalUnlink = fs.unlinkSync.bind(fs);
    let replaced = false;
    const unlink = jest.spyOn(fs, "unlinkSync").mockImplementation(((file: fs.PathLike) => {
      originalUnlink(file);
      if (!replaced && String(file) === lock) {
        replaced = true;
        originalUnlink(recovery);
        fs.writeFileSync(recovery, "replacement-claim\n");
      }
    }) as typeof fs.unlinkSync);
    try {
      withRecommendationLock(root, () => undefined);
    } finally {
      unlink.mockRestore();
    }
    expect(fs.readFileSync(recovery, "utf8")).toBe("replacement-claim\n");
  });

  it.each(["activity", "queue", "Activity", "QUEUE"])("rejects reserved recommendation source id %s", (runId) => {
    seedRun(root, runId);
    const analysis = analyzeRun(root, runId);
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/reserved|source id/i);
  });

  it("rolls back every analysis output when a later file write fails", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence), id: "rec-project", source_analysis_id: analysis.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    const written = writeRunAnalysis(root, analysis);
    const queue = path.join(root, ".guild", "recommendations", "queue.jsonl");
    const before = new Map([written.json, written.markdown, written.recommendations, queue].map((file) => [file, fs.readFileSync(file, "utf8")]));
    const originalRename = fs.renameSync.bind(fs);
    let injected = false;
    const rename = jest.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (!injected && String(to) === queue) { injected = true; throw new Error("injected queue write failure"); }
      return originalRename(from, to);
    }) as typeof fs.renameSync);
    try {
      analysis.recommendations[0].proposed_action = "Changed action that must roll back.";
      expect(() => writeRunAnalysis(root, analysis)).toThrow(/injected queue write failure/);
    } finally {
      rename.mockRestore();
    }
    for (const [file, contents] of before) expect(fs.readFileSync(file, "utf8")).toBe(contents);
    expect(fs.existsSync(path.join(root, ".guild", "recommendations", ".transaction.json"))).toBe(false);
  });
});
